import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, giveawaysTable, giveawayEntriesTable, tradeFulfillmentsTable, lootDropsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
import { addInventoryItem, rollLootDrop } from "../bot/inventory";
import { clampCoinAward } from "../bot/points";
import {
  CreateGiveawayBody,
  GetGiveawayParams,
  StartGiveawayParams,
  EndGiveawayParams,
  RerollGiveawayParams,
  GetGiveawayEntriesParams,
  ListGiveawaysQueryParams,
} from "@workspace/api-zod";
import { announceGiveawayStart, announceGiveawayEnd } from "../bot/bot-service";
import { getActiveTheme } from "../bot/bot-themes";

const router: IRouter = Router();

function serializeGiveaway(g: typeof giveawaysTable.$inferSelect, entryCount: number = 0) {
  return {
    id: g.id,
    title: g.title,
    prize: g.prize,
    description: g.description ?? null,
    prizeAssetId: g.prizeAssetId ?? null,
    prizeIconUrl: g.prizeIconUrl ?? null,
    prizeKind: (g.prizeKind ?? "cs2") as "cs2" | "bot_item" | "bot_coins",
    prizeBotCoins: g.prizeBotCoins ?? null,
    prizeBotRarity: g.prizeBotRarity ?? null,
    status: g.status,
    channel: g.channel,
    keyword: g.keyword,
    requireFollower: g.requireFollower,
    subscriberOnly: g.subscriberOnly,
    minSubTier: g.minSubTier ?? null,
    winnerId: g.winnerId ?? null,
    winnerUsername: g.winnerUsername ?? null,
    entryCount,
    createdAt: g.createdAt.toISOString(),
    startedAt: g.startedAt?.toISOString() ?? null,
    endedAt: g.endedAt?.toISOString() ?? null,
  };
}

router.get("/giveaway", async (req, res) => {
  const query = ListGiveawaysQueryParams.safeParse(req.query);
  const status = query.success ? query.data.status : undefined;
  const limit = query.success ? (query.data.limit ?? 20) : 20;

  let dbQuery = db.select().from(giveawaysTable).orderBy(desc(giveawaysTable.createdAt)).limit(limit);
  if (status) {
    // @ts-expect-error drizzle where chaining
    dbQuery = dbQuery.where(eq(giveawaysTable.status, status));
  }
  const rows = await dbQuery;

  const result = await Promise.all(
    rows.map(async (g) => {
      const [{ count: cnt }] = await db
        .select({ count: count() })
        .from(giveawayEntriesTable)
        .where(eq(giveawayEntriesTable.giveawayId, g.id));
      return serializeGiveaway(g, Number(cnt));
    })
  );
  res.json(result);
});

router.post("/giveaway", async (req, res) => {
  const body = CreateGiveawayBody.parse(req.body);
  const [giveaway] = await db
    .insert(giveawaysTable)
    .values({
      title: body.title,
      prize: body.prize,
      prizeAssetId: body.prizeAssetId ?? null,
      prizeIconUrl: body.prizeIconUrl ?? null,
      prizeKind: body.prizeKind ?? "cs2",
      prizeBotCoins: body.prizeBotCoins ?? null,
      prizeBotRarity: body.prizeBotRarity ?? null,
      description: body.description ?? null,
      keyword: body.keyword ?? "!enter",
      channel: body.channel ?? "goblinl00t",
      requireFollower: body.requireFollower ?? false,
      subscriberOnly: body.subscriberOnly ?? false,
      minSubTier: body.minSubTier ?? null,
    })
    .returning();
  res.status(201).json(serializeGiveaway(giveaway!, 0));
});

/**
 * POST /giveaway/seed-test — dev/test helper.
 *
 * The streamer needs a fast way to try the elimination wheel without waiting
 * for real chatters to enter. This:
 *   1. Ends any currently active giveaway on the caller's channel (mirrors the
 *      one-active-at-a-time invariant enforced by `/giveaway/:id/start`).
 *   2. Creates a fresh `active` giveaway with a coin prize (no Steam asset
 *      needed, no manual fulfillment).
 *   3. Bulk-inserts ~30 fake entries with varied ticket counts so the wheel
 *      has a juicy field to chew through.
 *
 * Auth-scoped to the caller's `usersTable.twitchUsername` (falls back to
 * "goblinl00t" so unauthed dev calls still seed against the legacy default
 * channel — matches the rest of giveaway.ts' channel resolution).
 */
router.post("/giveaway/seed-test", async (req, res) => {
  const { userId } = getAuth(req);
  let channel = "goblinl00t";
  if (userId) {
    const [user] = await db
      .select()
      .from(usersTable)
      .where(eq(usersTable.clerkUserId, userId))
      .limit(1);
    if (user?.twitchUsername) channel = user.twitchUsername.toLowerCase();
  }

  // End any currently active giveaway (matches /giveaway/:id/start behavior so
  // the "currently active" UI never has two rows competing for the spotlight).
  await db
    .update(giveawaysTable)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(giveawaysTable.status, "active"));

  const now = new Date();
  const [giveaway] = await db
    .insert(giveawaysTable)
    .values({
      title: "Test Giveaway — Elimination Wheel Demo",
      prize: "500 Goblin Coins",
      prizeKind: "bot_coins",
      prizeBotCoins: 500,
      description: "Dummy entries seeded so you can try the wheel without waiting for chat.",
      status: "active",
      channel,
      keyword: "!enter",
      requireFollower: false,
      subscriberOnly: false,
      startedAt: now,
    })
    .returning();

  // Hand-rolled cast of fake viewers — varied vibes so the wheel feels alive.
  // Ticket counts are weighted: most viewers have 1 ticket, a handful are
  // whales with 3-7, exercising the elimination wheel's odds calculations too.
  const FAKE_VIEWERS: Array<{ name: string; tickets: number }> = [
    { name: "loot_pirate", tickets: 5 },
    { name: "neon_cat", tickets: 1 },
    { name: "speedrun_sam", tickets: 3 },
    { name: "vapor_witch", tickets: 2 },
    { name: "pixel_paladin", tickets: 1 },
    { name: "midnight_moose", tickets: 1 },
    { name: "crit_kitty", tickets: 4 },
    { name: "boss_battle_bri", tickets: 1 },
    { name: "noscope_nina", tickets: 7 },
    { name: "rage_quit_ron", tickets: 1 },
    { name: "frag_master_flex", tickets: 2 },
    { name: "tilted_tom", tickets: 1 },
    { name: "lucky_lola", tickets: 6 },
    { name: "casual_carl", tickets: 1 },
    { name: "speedy_steve", tickets: 1 },
    { name: "sniper_sue", tickets: 3 },
    { name: "boss_baby_b", tickets: 1 },
    { name: "wizard_winston", tickets: 2 },
    { name: "ninja_nora", tickets: 1 },
    { name: "loot_lurker", tickets: 1 },
    { name: "ghost_glenda", tickets: 4 },
    { name: "tank_tilly", tickets: 1 },
    { name: "healer_hank", tickets: 1 },
    { name: "dps_diana", tickets: 2 },
    { name: "buff_bart", tickets: 1 },
    { name: "rng_randy", tickets: 5 },
    { name: "minmax_milo", tickets: 1 },
    { name: "afk_alex", tickets: 1 },
    { name: "clutch_clara", tickets: 3 },
    { name: "yolo_yara", tickets: 1 },
  ];

  await db.insert(giveawayEntriesTable).values(
    FAKE_VIEWERS.map((v) => ({
      giveawayId: giveaway!.id,
      username: v.name,
      tickets: v.tickets,
    }))
  );

  res.status(201).json(serializeGiveaway(giveaway!, FAKE_VIEWERS.length));
});

router.get("/giveaway/current", async (_req, res) => {
  const [active] = await db
    .select()
    .from(giveawaysTable)
    .where(eq(giveawaysTable.status, "active"))
    .limit(1);

  if (!active) {
    res.json({ giveaway: null, entries: [] });
    return;
  }

  const entries = await db
    .select()
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, active.id))
    .orderBy(desc(giveawayEntriesTable.enteredAt));

  const serializedEntries = entries.map((e) => ({
    id: e.id,
    giveawayId: e.giveawayId,
    username: e.username,
    tickets: e.tickets,
    enteredAt: e.enteredAt.toISOString(),
  }));

  const [{ count: cnt }] = await db
    .select({ count: count() })
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, active.id));

  res.json({
    giveaway: serializeGiveaway(active, Number(cnt)),
    entries: serializedEntries,
  });
});

router.get("/giveaway/:id", async (req, res) => {
  const { id } = GetGiveawayParams.parse({ id: Number(req.params["id"]) });
  const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);

  if (!giveaway) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  const entries = await db
    .select()
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id))
    .orderBy(desc(giveawayEntriesTable.enteredAt));

  const serializedEntries = entries.map((e) => ({
    id: e.id,
    giveawayId: e.giveawayId,
    username: e.username,
    tickets: e.tickets,
    enteredAt: e.enteredAt.toISOString(),
  }));

  const [{ count: cnt }] = await db
    .select({ count: count() })
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id));

  res.json({ giveaway: serializeGiveaway(giveaway, Number(cnt)), entries: serializedEntries });
});

router.post("/giveaway/:id/start", async (req, res) => {
  const { id } = StartGiveawayParams.parse({ id: Number(req.params["id"]) });

  // End any currently active giveaway first
  await db
    .update(giveawaysTable)
    .set({ status: "ended", endedAt: new Date() })
    .where(eq(giveawaysTable.status, "active"));

  const [giveaway] = await db
    .update(giveawaysTable)
    .set({ status: "active", startedAt: new Date() })
    .where(eq(giveawaysTable.id, id))
    .returning();

  if (!giveaway) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  void announceGiveawayStart({
    prize: giveaway.prize,
    keyword: giveaway.keyword,
    channel: giveaway.channel,
  });

  const [{ count: cnt }] = await db
    .select({ count: count() })
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id));

  res.json(serializeGiveaway(giveaway, Number(cnt)));
});

router.post("/giveaway/:id/end", async (req, res) => {
  const { id } = EndGiveawayParams.parse({ id: Number(req.params["id"]) });

  const entries = await db
    .select()
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id));

  if (entries.length === 0) {
    res.status(400).json({ error: "No entries to draw from" });
    return;
  }

  // Weighted draw by tickets
  const pool: typeof entries = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.tickets; i++) pool.push(entry);
  }
  const winner = pool[Math.floor(Math.random() * pool.length)]!;

  const [giveaway] = await db
    .update(giveawaysTable)
    .set({
      status: "ended",
      endedAt: new Date(),
      winnerId: winner.id,
      winnerUsername: winner.username,
    })
    .where(eq(giveawaysTable.id, id))
    .returning();

  if (!giveaway) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  void announceGiveawayEnd({
    prize: giveaway.prize,
    channel: giveaway.channel,
    winner: winner.username,
    entryCount: entries.length,
  });

  // Award bot prizes directly; only CS2 prizes need streamer-managed delivery.
  const prizeKind = (giveaway.prizeKind ?? "cs2") as "cs2" | "bot_item" | "bot_coins";
  const bonusCoins = Math.max(0, giveaway.prizeBotCoins ?? 0);
  // HARD coin-cap helper: every coin-credit insert below clamps so balance ≤ cap.
  type LootRarity = ReturnType<typeof rollLootDrop>["rarity"];
  async function awardCoins(item: string, points: number, rarity: LootRarity = "epic") {
    const credited = await clampCoinAward(giveaway!.channel, winner.username, points);
    if (credited > 0) {
      await db.insert(lootDropsTable).values({
        channel: giveaway!.channel,
        username: winner.username,
        item,
        rarity,
        points: credited,
      });
    }
  }
  if (prizeKind === "bot_coins") {
    const amount = Math.max(1, giveaway.prizeBotCoins ?? 0);
    await awardCoins(`Giveaway Prize: ${giveaway.title}`, amount);
  } else if (prizeKind === "bot_item") {
    const loot = rollLootDrop({ luckBuffActive: true, theme: getActiveTheme() });
    const result = await addInventoryItem(giveaway.channel, winner.username, loot);
    if (!result.ok) {
      // Inventory full — fall back to coin compensation so the prize is never silently dropped.
      await awardCoins(`Giveaway Prize (pouch was full): ${loot.item}`, loot.coinValue, loot.rarity);
    }
    // Optional combo prize: bonus coins on top of the loot drop.
    if (bonusCoins > 0) {
      await awardCoins(`Giveaway Bonus: ${giveaway.title}`, bonusCoins);
    }
  } else {
    void db.insert(tradeFulfillmentsTable).values({
      giveawayId: giveaway.id,
      winnerTwitchUsername: winner.username,
      prize: giveaway.prize,
      status: "pending",
    }).onConflictDoNothing();
    // Optional combo prize: bonus coins on top of the CS2 skin.
    if (bonusCoins > 0) {
      await awardCoins(`Giveaway Bonus: ${giveaway.title}`, bonusCoins);
    }
  }

  res.json({
    giveaway: serializeGiveaway(giveaway, entries.length),
    winner: {
      id: winner.id,
      giveawayId: winner.giveawayId,
      username: winner.username,
      tickets: winner.tickets,
      enteredAt: winner.enteredAt.toISOString(),
    },
  });
});

router.post("/giveaway/:id/reroll", async (req, res) => {
  const { id } = RerollGiveawayParams.parse({ id: Number(req.params["id"]) });

  const entries = await db
    .select()
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id));

  if (entries.length === 0) {
    res.status(400).json({ error: "No entries to reroll from" });
    return;
  }

  const pool: typeof entries = [];
  for (const entry of entries) {
    for (let i = 0; i < entry.tickets; i++) pool.push(entry);
  }
  const winner = pool[Math.floor(Math.random() * pool.length)]!;

  const [giveaway] = await db
    .update(giveawaysTable)
    .set({ winnerId: winner.id, winnerUsername: winner.username })
    .where(eq(giveawaysTable.id, id))
    .returning();

  if (!giveaway) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  void announceGiveawayEnd({
    prize: giveaway.prize,
    channel: giveaway.channel,
    winner: winner.username,
    entryCount: entries.length,
  });

  res.json({
    giveaway: serializeGiveaway(giveaway, entries.length),
    winner: {
      id: winner.id,
      giveawayId: winner.giveawayId,
      username: winner.username,
      tickets: winner.tickets,
      enteredAt: winner.enteredAt.toISOString(),
    },
  });
});

router.get("/giveaway/:id/entries", async (req, res) => {
  const { id } = GetGiveawayEntriesParams.parse({ id: Number(req.params["id"]) });

  const entries = await db
    .select()
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id))
    .orderBy(desc(giveawayEntriesTable.enteredAt));

  res.json(
    entries.map((e) => ({
      id: e.id,
      giveawayId: e.giveawayId,
      username: e.username,
      tickets: e.tickets,
      enteredAt: e.enteredAt.toISOString(),
    }))
  );
});

export default router;

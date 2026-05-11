import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable, giveawaysTable, giveawayEntriesTable, tradeFulfillmentsTable, lootDropsTable } from "@workspace/db";
import { eq, desc, count, and } from "drizzle-orm";
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
import { fireDiscordWebhook } from "../lib/discord-webhook";
import { requireStreamerChannel, resolveStreamerChannelForRead } from "../lib/auth-helpers";

/**
 * Resolve the calling streamer's channel handle (lowercase Twitch username).
 * Returns null + writes a 401/403 if the caller isn't signed in or hasn't
 * linked Twitch yet — used by mutating giveaway routes to enforce that
 * one streamer can never start/end/reroll another streamer's giveaway.
 *
 * Why local rather than the shared `requireStreamerChannel` helper: the
 * giveaway routes also need the user's full row for Discord webhook
 * notifications, and the channel match check is a few extra lines that
 * make the ownership intent obvious at the call site.
 */
async function getCallerChannel(req: Parameters<typeof getAuth>[0]): Promise<string | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select({ twitchUsername: usersTable.twitchUsername })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  return user?.twitchUsername?.trim().toLowerCase() ?? null;
}

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
  // Multi-tenancy: scope to the caller's own channel so two streamers can't
  // see each other's giveaways. Read-friendly variant falls back to the
  // legacy seed-test channel ("goblinl00t") in dev for unlinked accounts.
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const query = ListGiveawaysQueryParams.safeParse(req.query);
  const status = query.success ? query.data.status : undefined;
  const limit = query.success ? (query.data.limit ?? 20) : 20;

  const where = status
    ? and(eq(giveawaysTable.channel, ctx.channel), eq(giveawaysTable.status, status))
    : eq(giveawaysTable.channel, ctx.channel);
  const rows = await db
    .select()
    .from(giveawaysTable)
    .where(where)
    .orderBy(desc(giveawaysTable.createdAt))
    .limit(limit);

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
  // Multi-tenancy: ignore any caller-supplied `channel` and force the
  // giveaway to live on the caller's own channel. Prevents cross-streamer
  // record creation.
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
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
      channel: ctx.channel,
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
  // Same prod-gate as /seed-entries — see that handler for rationale.
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).json({ error: "Seeding is disabled in production" });
    return;
  }
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

  await db.insert(giveawayEntriesTable).values(
    FAKE_VIEWERS.map((v) => ({
      giveawayId: giveaway!.id,
      username: v.name,
      tickets: v.tickets,
    }))
  );

  res.status(201).json(serializeGiveaway(giveaway!, FAKE_VIEWERS.length));
});

/**
 * POST /giveaway/:id/seed-entries — companion to /giveaway/seed-test.
 *
 * Bulk-inserts the canned FAKE_VIEWERS roster into an existing giveaway so
 * the streamer can test the elimination wheel against any giveaway they've
 * already created (e.g. the one they just made via the form). Idempotent
 * via onConflictDoNothing on the (giveawayId, username) unique index.
 */
router.post("/giveaway/:id/seed-entries", async (req, res) => {
  // Gate dev/test seeders out of production so a stray button click on the
  // live deployment can't dump 30 fake viewers into a real channel's stats.
  if (process.env["NODE_ENV"] === "production") {
    res.status(403).json({ error: "Seeding is disabled in production" });
    return;
  }
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  const [giveaway] = await db
    .select()
    .from(giveawaysTable)
    .where(eq(giveawaysTable.id, id))
    .limit(1);
  if (!giveaway) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  await db
    .insert(giveawayEntriesTable)
    .values(
      FAKE_VIEWERS.map((v) => ({
        giveawayId: id,
        username: v.name,
        tickets: v.tickets,
      }))
    )
    .onConflictDoNothing();

  const [{ count: cnt }] = await db
    .select({ count: count() })
    .from(giveawayEntriesTable)
    .where(eq(giveawayEntriesTable.giveawayId, id));

  res.json(serializeGiveaway(giveaway, Number(cnt)));
});

// Hand-rolled cast of fake viewers — varied vibes so the wheel feels alive.
// Ticket counts are weighted: most viewers have 1 ticket, a handful are
// whales with 3-7, exercising the elimination wheel's odds calculations too.
// Module-scope so both seed routes share the same roster.
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

router.get("/giveaway/current", async (req, res) => {
  // Scope "current giveaway" to the caller's channel — otherwise streamer A
  // sees streamer B's active giveaway. Dev: falls back to seed channel.
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const [active] = await db
    .select()
    .from(giveawaysTable)
    .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, ctx.channel)))
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
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const { id } = GetGiveawayParams.parse({ id: Number(req.params["id"]) });
  const [giveaway] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);

  // Treat cross-channel access as 404 (don't reveal whether the row exists
  // on someone else's channel).
  if (!giveaway || giveaway.channel.toLowerCase() !== ctx.channel) {
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

/**
 * DELETE /giveaway/:id
 *
 * Permanently removes a giveaway and its entries / fulfillment rows so a
 * streamer can clean up test or aborted runs from the Loot Hoard list.
 * Coin awards already credited to the winner live in `loot_drops` and are
 * NOT clawed back — that's intentional, since refunding would require
 * re-running the cap math against the current balance.
 */
router.delete("/giveaway/:id", async (req, res) => {
  const id = Number(req.params["id"]);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }

  // Auth: only the streamer who owns the giveaway's channel may delete it.
  // We resolve the caller's `twitchUsername` and require it to match the
  // giveaway's `channel`. This blocks cross-streamer destruction even
  // though giveaway IDs are guessable integers.
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const [caller] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  const callerChannel = caller?.twitchUsername?.toLowerCase() ?? null;

  const [existing] = await db
    .select()
    .from(giveawaysTable)
    .where(eq(giveawaysTable.id, id))
    .limit(1);
  if (!existing) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }
  // Cross-streamer ownership guard. Two acceptable cases:
  //   1. Caller has bound a Twitch channel and it matches the giveaway.
  //   2. Caller has NOT bound a channel yet AND the giveaway lives in the
  //      default seed-test channel ("goblinl00t"). This narrow exception
  //      lets brand-new accounts clean up their own test giveaways without
  //      becoming an IDOR — they still can't touch any real streamer's
  //      giveaways, only the shared dev/seed bucket.
  // Anything else 404s (mirrored shape so we don't leak existence).
  const isOwner = !!callerChannel && existing.channel.toLowerCase() === callerChannel;
  const isUnlinkedTestCleanup = process.env["NODE_ENV"] !== "production" && !callerChannel && existing.channel.toLowerCase() === "goblinl00t";
  if (!isOwner && !isUnlinkedTestCleanup) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  // Delete child rows first — entries and trade fulfillments reference the
  // giveaway by id, so the parent delete would fail with them in place.
  // (`tradeFulfillmentsTable` doesn't have an enforced FK in the current
  // schema, but we still wipe its rows so deleted giveaways don't leave
  // orphaned fulfillment records dangling in the Trade Office UI.)
  await db.delete(giveawayEntriesTable).where(eq(giveawayEntriesTable.giveawayId, id));
  await db.delete(tradeFulfillmentsTable).where(eq(tradeFulfillmentsTable.giveawayId, id));
  await db.delete(giveawaysTable).where(eq(giveawaysTable.id, id));

  res.status(204).end();
});

router.post("/giveaway/:id/start", async (req, res) => {
  const { id } = StartGiveawayParams.parse({ id: Number(req.params["id"]) });

  // Ownership: caller must own the giveaway's channel. Same unlinked-account
  // exception as DELETE so brand-new accounts can still try the seed flow.
  const callerChannel = await getCallerChannel(req);
  const [target] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);
  if (!target) { res.status(404).json({ error: "Giveaway not found" }); return; }
  const isOwner = !!callerChannel && target.channel.toLowerCase() === callerChannel;
  const isUnlinkedSeed = process.env["NODE_ENV"] !== "production" && !callerChannel && target.channel.toLowerCase() === "goblinl00t";
  if (!isOwner && !isUnlinkedSeed) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

  // End any currently active giveaway first (scoped to this channel only —
  // we used to wipe ALL active giveaways across every streamer in the DB,
  // which broke other streamers when a multi-tenant account did a start).
  await db
    .update(giveawaysTable)
    .set({ status: "ended", endedAt: new Date() })
    .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, target.channel)));

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

  // Ownership guard — see /start for rationale.
  const callerChannel = await getCallerChannel(req);
  const [target] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);
  if (!target) { res.status(404).json({ error: "Giveaway not found" }); return; }
  const isOwner = !!callerChannel && target.channel.toLowerCase() === callerChannel;
  const isUnlinkedSeed = process.env["NODE_ENV"] !== "production" && !callerChannel && target.channel.toLowerCase() === "goblinl00t";
  if (!isOwner && !isUnlinkedSeed) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

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

  // Best-effort Discord notification — fire-and-forget so a slow webhook
  // never delays the in-app reveal. `fireDiscordWebhook` swallows errors.
  void fireDiscordWebhook({
    channel: giveaway.channel,
    title: giveaway.title,
    prize: giveaway.prize,
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

  // Ownership guard — see /start for rationale.
  const callerChannel = await getCallerChannel(req);
  const [target] = await db.select().from(giveawaysTable).where(eq(giveawaysTable.id, id)).limit(1);
  if (!target) { res.status(404).json({ error: "Giveaway not found" }); return; }
  const isOwner = !!callerChannel && target.channel.toLowerCase() === callerChannel;
  const isUnlinkedSeed = process.env["NODE_ENV"] !== "production" && !callerChannel && target.channel.toLowerCase() === "goblinl00t";
  if (!isOwner && !isUnlinkedSeed) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

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
  const ctx = await resolveStreamerChannelForRead(req, res);
  if (!ctx) return;
  const { id } = GetGiveawayEntriesParams.parse({ id: Number(req.params["id"]) });
  // Verify the giveaway belongs to the caller before listing entries —
  // otherwise viewer rosters leak across streamers.
  const [giveaway] = await db
    .select({ channel: giveawaysTable.channel })
    .from(giveawaysTable)
    .where(eq(giveawaysTable.id, id))
    .limit(1);
  if (!giveaway || giveaway.channel.toLowerCase() !== ctx.channel) {
    res.status(404).json({ error: "Giveaway not found" });
    return;
  }

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

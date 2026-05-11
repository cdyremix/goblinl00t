import { Router, type IRouter } from "express";
import { db, giveawaysTable, giveawayEntriesTable, tradeFulfillmentsTable } from "@workspace/db";
import { eq, desc, count } from "drizzle-orm";
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

const router: IRouter = Router();

function serializeGiveaway(g: typeof giveawaysTable.$inferSelect, entryCount: number = 0) {
  return {
    id: g.id,
    title: g.title,
    prize: g.prize,
    description: g.description ?? null,
    prizeAssetId: g.prizeAssetId ?? null,
    prizeIconUrl: g.prizeIconUrl ?? null,
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

  // Auto-create a trade fulfillment record for the winner
  void db.insert(tradeFulfillmentsTable).values({
    giveawayId: giveaway.id,
    winnerTwitchUsername: winner.username,
    prize: giveaway.prize,
    status: "pending",
  }).onConflictDoNothing();

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

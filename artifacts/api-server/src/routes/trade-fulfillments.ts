import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, tradeFulfillmentsTable } from "@workspace/db";
import { eq, desc } from "drizzle-orm";

const router = Router();

function serializeFulfillment(f: typeof tradeFulfillmentsTable.$inferSelect) {
  return {
    id: f.id,
    giveawayId: f.giveawayId,
    winnerTwitchUsername: f.winnerTwitchUsername,
    prize: f.prize,
    steamTradeUrl: f.steamTradeUrl ?? null,
    status: f.status,
    tradeLockUntil: f.tradeLockUntil?.toISOString() ?? null,
    streamerNotes: f.streamerNotes ?? null,
    createdAt: f.createdAt.toISOString(),
  };
}

router.get("/trade-fulfillments", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const rows = await db
    .select()
    .from(tradeFulfillmentsTable)
    .orderBy(desc(tradeFulfillmentsTable.createdAt));

  res.json(rows.map(serializeFulfillment));
});

router.put("/trade-fulfillments/:id", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }

  const id = Number(req.params["id"]);
  if (isNaN(id)) { res.status(400).json({ error: "Invalid id" }); return; }

  const body = req.body as {
    status?: string;
    steamTradeUrl?: string | null;
    tradeLockUntil?: string | null;
    streamerNotes?: string | null;
  };

  const VALID_STATUSES = ["pending", "trade_locked", "sent", "skipped"];
  if (body.status && !VALID_STATUSES.includes(body.status)) {
    res.status(400).json({ error: "Invalid status" });
    return;
  }

  const updates: Partial<typeof tradeFulfillmentsTable.$inferInsert> = {};
  if (body.status !== undefined) updates.status = body.status;
  if ("steamTradeUrl" in body) updates.steamTradeUrl = body.steamTradeUrl ?? null;
  if ("tradeLockUntil" in body) {
    updates.tradeLockUntil = body.tradeLockUntil ? new Date(body.tradeLockUntil) : null;
  }
  if ("streamerNotes" in body) updates.streamerNotes = body.streamerNotes ?? null;

  const [updated] = await db
    .update(tradeFulfillmentsTable)
    .set(updates)
    .where(eq(tradeFulfillmentsTable.id, id))
    .returning();

  if (!updated) { res.status(404).json({ error: "Not found" }); return; }
  res.json(serializeFulfillment(updated));
});

export default router;

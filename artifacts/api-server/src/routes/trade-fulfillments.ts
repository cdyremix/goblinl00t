import { Router } from "express";
import { db, tradeFulfillmentsTable, giveawaysTable } from "@workspace/db";
import { eq, desc, and, inArray } from "drizzle-orm";
import { requireStreamerChannel } from "../lib/auth-helpers";
import { userHasFeature } from "../lib/tier-helpers";

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

/**
 * Trade-office routes — channel-scoped + tier-gated.
 *
 * Previously these were globally readable / writable by any signed-in
 * caller, which let one streamer view and mutate another streamer's
 * fulfillment rows. Both endpoints now:
 *   1) Require a linked Twitch account (`requireStreamerChannel`),
 *   2) Filter / verify ownership by joining through `giveawaysTable.channel`
 *      (the fulfillments table itself has no `channel` column — every
 *      row is anchored to its parent giveaway, which IS channel-scoped),
 *   3) Require the `skin-trading` feature (Horde Master+) since the
 *      whole Trade Office surface is part of the paid CS2 toolkit.
 */
router.get("/trade-fulfillments", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  if (!userHasFeature(ctx.user, "skin-trading")) {
    res.status(403).json({
      error: "Trade Office is a Horde Master perk.",
      feature: "skin-trading",
    });
    return;
  }

  const rows = await db
    .select({ f: tradeFulfillmentsTable })
    .from(tradeFulfillmentsTable)
    .innerJoin(giveawaysTable, eq(giveawaysTable.id, tradeFulfillmentsTable.giveawayId))
    .where(eq(giveawaysTable.channel, ctx.channel))
    .orderBy(desc(tradeFulfillmentsTable.createdAt));

  res.json(rows.map((r) => serializeFulfillment(r.f)));
});

router.put("/trade-fulfillments/:id", async (req, res) => {
  const ctx = await requireStreamerChannel(req, res);
  if (!ctx) return;
  if (!userHasFeature(ctx.user, "skin-trading")) {
    res.status(403).json({
      error: "Trade Office is a Horde Master perk.",
      feature: "skin-trading",
    });
    return;
  }

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

  // Ownership check: confirm this fulfillment id belongs to a giveaway
  // on the caller's channel BEFORE mutating. 404 (don't leak existence)
  // if it belongs to another streamer.
  const ownedIds = await db
    .select({ id: tradeFulfillmentsTable.id })
    .from(tradeFulfillmentsTable)
    .innerJoin(giveawaysTable, eq(giveawaysTable.id, tradeFulfillmentsTable.giveawayId))
    .where(
      and(
        eq(tradeFulfillmentsTable.id, id),
        eq(giveawaysTable.channel, ctx.channel),
      ),
    );
  if (ownedIds.length === 0) {
    res.status(404).json({ error: "Not found" });
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

// Suppress unused-import warning (kept for future bulk-by-id queries).
void inArray;

export default router;

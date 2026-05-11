import { db, lootDropsTable, pointRedemptionsTable, giveawayEntriesTable, giveawaysTable } from "@workspace/db";
import { eq, sum, sql } from "drizzle-orm";

export const REDEEM_COST_PER_ENTRY = 100;

export async function getPointsBalance(username: string): Promise<{ earned: number; redeemed: number; balance: number }> {
  const [earnedRow] = await db
    .select({ total: sum(lootDropsTable.points) })
    .from(lootDropsTable)
    .where(eq(lootDropsTable.username, username));
  const [redeemedRow] = await db
    .select({ total: sum(pointRedemptionsTable.points) })
    .from(pointRedemptionsTable)
    .where(eq(pointRedemptionsTable.username, username));

  const earned = Number(earnedRow?.total ?? 0);
  const redeemed = Number(redeemedRow?.total ?? 0);
  return { earned, redeemed, balance: earned - redeemed };
}

export type RedeemResult =
  | { ok: true; pointsSpent: number; ticketsAdded: number; balanceAfter: number }
  | { ok: false; code: "no_active" | "not_active" | "insufficient" | "not_found"; message: string; balance?: number };

/**
 * Redeem `entries` extra giveaway tickets for `username` against the given giveaway.
 * Runs in a SERIALIZABLE transaction so balance read + redemption insert + ticket
 * upsert are atomic with respect to concurrent redemptions. Relies on the
 * unique index on (giveaway_id, username) to make ticket inserts idempotent.
 */
export async function redeemEntriesForUser(opts: {
  giveawayId: number;
  username: string;
  entries: number;
}): Promise<RedeemResult> {
  const entries = Math.max(1, Math.floor(opts.entries));
  const cost = entries * REDEEM_COST_PER_ENTRY;
  const username = opts.username;

  return await db.transaction(async (tx) => {
    const [giveaway] = await tx
      .select()
      .from(giveawaysTable)
      .where(eq(giveawaysTable.id, opts.giveawayId))
      .limit(1);
    if (!giveaway) return { ok: false, code: "not_found", message: "Giveaway not found" } as const;
    if (giveaway.status !== "active") {
      return { ok: false, code: "not_active", message: "Giveaway is not active" } as const;
    }

    const [earnedRow] = await tx
      .select({ total: sum(lootDropsTable.points) })
      .from(lootDropsTable)
      .where(eq(lootDropsTable.username, username));
    const [redeemedRow] = await tx
      .select({ total: sum(pointRedemptionsTable.points) })
      .from(pointRedemptionsTable)
      .where(eq(pointRedemptionsTable.username, username));
    const balance = Number(earnedRow?.total ?? 0) - Number(redeemedRow?.total ?? 0);

    if (balance < cost) {
      return { ok: false, code: "insufficient", message: `Need ${cost}, have ${balance}`, balance } as const;
    }

    await tx.insert(pointRedemptionsTable).values({
      channel: giveaway.channel,
      username,
      points: cost,
      kind: "entries",
      giveawayId: giveaway.id,
      ticketsAdded: entries,
    });

    // Atomic upsert against the (giveaway_id, username) unique index.
    await tx
      .insert(giveawayEntriesTable)
      .values({ giveawayId: giveaway.id, username, tickets: entries })
      .onConflictDoUpdate({
        target: [giveawayEntriesTable.giveawayId, giveawayEntriesTable.username],
        set: { tickets: sql`${giveawayEntriesTable.tickets} + ${entries}` },
      });

    return { ok: true, pointsSpent: cost, ticketsAdded: entries, balanceAfter: balance - cost } as const;
  }, { isolationLevel: "serializable" });
}

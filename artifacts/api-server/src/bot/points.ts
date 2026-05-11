import { db, lootDropsTable, pointRedemptionsTable, giveawayEntriesTable, giveawaysTable, usersTable } from "@workspace/db";
import { eq, sum, sql, and } from "drizzle-orm";

export const REDEEM_COST_PER_ENTRY = 100;

/**
 * Resolve the configured coin cap (max balance) for the channel that owns
 * `username`. Today the bot runs against a single channel, so the cap is
 * read off the user row whose `twitchUsername` matches. Returns `null` for
 * "no cap configured".
 */
async function getCoinCapFor(username: string): Promise<number | null> {
  const [row] = await db
    .select({ coinCap: usersTable.coinCap })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, username.toLowerCase()))
    .limit(1);
  return row?.coinCap ?? null;
}

export async function getPointsBalance(
  username: string,
  channel?: string,
): Promise<{ earned: number; redeemed: number; balance: number; cap: number | null }> {
  // Optional channel filter — when supplied, restricts the sums to a single
  // streamer's channel so the same username on two channels has independent
  // balances. Callers that omit it get the legacy global-by-username behavior
  // (kept for !coins and the leaderboard, which currently run against the
  // single configured bot channel).
  const earnedWhere = channel
    ? and(eq(lootDropsTable.username, username), eq(lootDropsTable.channel, channel))
    : eq(lootDropsTable.username, username);
  const redeemedWhere = channel
    ? and(eq(pointRedemptionsTable.username, username), eq(pointRedemptionsTable.channel, channel))
    : eq(pointRedemptionsTable.username, username);
  const [earnedRow] = await db
    .select({ total: sum(lootDropsTable.points) })
    .from(lootDropsTable)
    .where(earnedWhere);
  const [redeemedRow] = await db
    .select({ total: sum(pointRedemptionsTable.points) })
    .from(pointRedemptionsTable)
    .where(redeemedWhere);

  const earned = Number(earnedRow?.total ?? 0);
  const redeemed = Number(redeemedRow?.total ?? 0);
  const raw = earned - redeemed;
  const cap = await getCoinCapFor(username);
  // Cap is informational/displayed: clip the visible balance so the leaderboard
  // and !coins both honor the configured ceiling. New earnings still write to
  // loot_drops (we don't drop them on the floor) — the cap just clamps display.
  const balance = cap !== null ? Math.min(raw, cap) : raw;
  return { earned, redeemed, balance, cap };
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

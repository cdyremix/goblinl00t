import { db, lootDropsTable, pointRedemptionsTable, giveawayEntriesTable, giveawaysTable, usersTable } from "@workspace/db";
import { eq, sum, sql, and } from "drizzle-orm";

export const REDEEM_COST_PER_ENTRY = 100;

/**
 * Resolve the configured coin cap (max balance) for `channel`. The cap is
 * stored on the streamer's `usersTable` row (whose `twitchUsername` equals
 * the channel name), NOT on the viewer's row — viewers aren't in usersTable
 * at all. Returns `null` for "no cap configured" or "channel unknown".
 */
async function getCoinCapForChannel(channel: string): Promise<number | null> {
  const ch = channel.replace(/^#/, "").toLowerCase();
  const [row] = await db
    .select({ coinCap: usersTable.coinCap })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  return row?.coinCap ?? null;
}

export async function getPointsBalance(
  username: string,
  channel?: string,
): Promise<{ earned: number; redeemed: number; balance: number; cap: number | null }> {
  // Cap lives on the streamer's row; we only know the streamer when `channel`
  // is supplied. Without it (legacy global-by-username calls) we skip the cap
  // lookup — the WRITE path (`clampCoinAward`) is the source of truth anyway.
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
  const cap = channel ? await getCoinCapForChannel(channel) : null;
  // Cap is now enforced at WRITE time (see clampCoinAward) — every coin-awarding
  // call site must clamp `points` before inserting into loot_drops. This read
  // path still clamps defensively in case historical rows pushed someone over
  // the cap (or the cap was lowered after-the-fact).
  const balance = cap !== null ? Math.min(raw, cap) : raw;
  return { earned, redeemed, balance, cap };
}

/**
 * HARD-CAP enforcement at award time. Returns the number of coins that may
 * actually be inserted into `loot_drops` for `username` on `channel` such that
 * the resulting balance does not exceed the configured `coinCap`. Callers MUST
 * use the returned value for the insert (or skip the insert when 0).
 *
 * - Returns `requested` unchanged when no cap is configured (null).
 * - Returns 0 when the user is already at/over the cap.
 * - Caps over-shoots to (cap - currentBalance), never negative.
 */
export async function clampCoinAward(
  channel: string,
  username: string,
  requested: number,
): Promise<number> {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  const cap = await getCoinCapForChannel(channel);
  if (cap === null) return Math.floor(requested);
  // Compute raw (uncapped) balance for this channel+username.
  const [earnedRow] = await db
    .select({ total: sum(lootDropsTable.points) })
    .from(lootDropsTable)
    .where(and(eq(lootDropsTable.username, username), eq(lootDropsTable.channel, channel)));
  const [redeemedRow] = await db
    .select({ total: sum(pointRedemptionsTable.points) })
    .from(pointRedemptionsTable)
    .where(and(eq(pointRedemptionsTable.username, username), eq(pointRedemptionsTable.channel, channel)));
  const raw = Number(earnedRow?.total ?? 0) - Number(redeemedRow?.total ?? 0);
  const headroom = cap - raw;
  if (headroom <= 0) return 0;
  return Math.min(Math.floor(requested), headroom);
}

/**
 * Transaction-aware variant of clampCoinAward. Use inside an existing tx
 * when the read+write must be atomic with surrounding work (e.g. selling
 * an inventory item). Falls back to the non-tx path when no tx is given.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function clampCoinAwardTx(tx: any, channel: string, username: string, requested: number): Promise<number> {
  if (!Number.isFinite(requested) || requested <= 0) return 0;
  // Cap is per-channel (streamer row), NOT per-viewer.
  const ch = channel.replace(/^#/, "").toLowerCase();
  const [capRow] = await tx
    .select({ coinCap: usersTable.coinCap })
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  const cap: number | null = capRow?.coinCap ?? null;
  if (cap === null) return Math.floor(requested);
  const [earnedRow] = await tx
    .select({ total: sum(lootDropsTable.points) })
    .from(lootDropsTable)
    .where(and(eq(lootDropsTable.username, username), eq(lootDropsTable.channel, channel)));
  const [redeemedRow] = await tx
    .select({ total: sum(pointRedemptionsTable.points) })
    .from(pointRedemptionsTable)
    .where(and(eq(pointRedemptionsTable.username, username), eq(pointRedemptionsTable.channel, channel)));
  const raw = Number(earnedRow?.total ?? 0) - Number(redeemedRow?.total ?? 0);
  const headroom = cap - raw;
  if (headroom <= 0) return 0;
  return Math.min(Math.floor(requested), headroom);
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

    // Channel-scope the balance to `giveaway.channel` — coins earned in
    // streamer A's channel must NOT be spendable inside streamer B's
    // giveaway. Without this filter a multi-tenant DB lets viewers cross
    // the wires (HIGH-severity tenancy break flagged by code review).
    const [earnedRow] = await tx
      .select({ total: sum(lootDropsTable.points) })
      .from(lootDropsTable)
      .where(and(eq(lootDropsTable.username, username), eq(lootDropsTable.channel, giveaway.channel)));
    const [redeemedRow] = await tx
      .select({ total: sum(pointRedemptionsTable.points) })
      .from(pointRedemptionsTable)
      .where(and(eq(pointRedemptionsTable.username, username), eq(pointRedemptionsTable.channel, giveaway.channel)));
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

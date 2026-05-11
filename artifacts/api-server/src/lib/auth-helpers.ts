import { type Request, type Response } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

/**
 * Resolve the calling streamer's row + canonical channel handle (lower-cased
 * Twitch username). Used by routes that mutate per-channel state to enforce
 * that one streamer can never poke another streamer's data.
 *
 * Returns `null` and writes the appropriate error response if the caller is
 * unauthenticated or hasn't linked Twitch yet — callers must early-return.
 */
export async function requireStreamerChannel(
  req: Request,
  res: Response,
): Promise<{ user: typeof usersTable.$inferSelect; channel: string } | null> {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return null;
  }
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  if (!user) {
    res.status(401).json({ error: "Unknown user" });
    return null;
  }
  const channel = user.twitchUsername?.trim().toLowerCase();
  if (!channel) {
    res.status(403).json({ error: "Connect your Twitch account first." });
    return null;
  }
  return { user, channel };
}

/**
 * Naive in-memory token-bucket rate limiter keyed by an arbitrary string
 * (typically the Clerk userId or remote IP). Single-process only — fine
 * for the current single-server deployment, would need Redis if we ever
 * scale horizontally.
 *
 * Each bucket holds `max` tokens and refills `max` per `windowMs`. Returns
 * true if the request is allowed, false if it should be rejected with 429.
 */
const BUCKETS = new Map<string, { tokens: number; resetAt: number }>();

export function rateLimit(
  key: string,
  opts: { max: number; windowMs: number },
): boolean {
  const now = Date.now();
  const bucket = BUCKETS.get(key);
  if (!bucket || bucket.resetAt < now) {
    BUCKETS.set(key, { tokens: opts.max - 1, resetAt: now + opts.windowMs });
    return true;
  }
  if (bucket.tokens <= 0) return false;
  bucket.tokens -= 1;
  return true;
}

// Periodically prune stale buckets so the map doesn't grow unbounded over
// the lifetime of the process.
setInterval(() => {
  const now = Date.now();
  for (const [k, b] of BUCKETS) {
    if (b.resetAt < now) BUCKETS.delete(k);
  }
}, 5 * 60 * 1000).unref();

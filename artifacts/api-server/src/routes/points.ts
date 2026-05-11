import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { REDEEM_COST_PER_ENTRY, getPointsBalance, redeemEntriesForUser } from "../bot/points";

const router: IRouter = Router();

/**
 * Resolve the chat username (Twitch handle) of the authenticated dashboard user.
 * Redemption operates on this username — callers cannot redeem for someone else.
 */
async function getAuthedTwitchUsername(req: Parameters<typeof getAuth>[0]): Promise<string | null> {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select({ twitchUsername: usersTable.twitchUsername })
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  const handle = user?.twitchUsername?.trim().toLowerCase();
  return handle ? handle : null;
}

router.get("/points/me", async (req, res) => {
  const username = await getAuthedTwitchUsername(req);
  if (!username) {
    res.status(401).json({ error: "Sign in and link your Twitch username in settings to view points." });
    return;
  }
  // The dashboard's "my points" view is the streamer looking at their own
  // balance in their own channel — channel == their twitchUsername. This
  // also resolves the cap correctly (cap is per-streamer-row).
  const balance = await getPointsBalance(username, username);
  res.json({ username, ...balance, costPerEntry: REDEEM_COST_PER_ENTRY });
});

router.post("/giveaway/:id/redeem", async (req, res) => {
  const username = await getAuthedTwitchUsername(req);
  if (!username) {
    res.status(401).json({ error: "Sign in and link your Twitch username in settings to redeem points." });
    return;
  }

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid giveaway id" });
    return;
  }
  const body = req.body as { entries?: number };
  const entries = Math.max(1, Math.floor(Number(body.entries ?? 1)));

  const result = await redeemEntriesForUser({ giveawayId: id, username, entries });
  if (!result.ok) {
    const status = result.code === "not_found" ? 404 : 400;
    res.status(status).json({ error: result.message, code: result.code });
    return;
  }

  res.json({
    ticketsAdded: result.ticketsAdded,
    pointsSpent: result.pointsSpent,
    balanceAfter: result.balanceAfter,
  });
});

export default router;

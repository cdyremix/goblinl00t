import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router: IRouter = Router();

/**
 * Stream session control. Operations → "Start Stream" stamps a server-side
 * timestamp on usersTable.streamStartedAt; "End Stream" clears it. Stats
 * endpoints with `?range=stream` and `/loot/recent?since=stream` filter to
 * rows newer than this stamp. Falls back to the last 12h when null.
 */

async function getCallerUser(req: Parameters<typeof getAuth>[0]) {
  const { userId } = getAuth(req);
  if (!userId) return null;
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, userId))
    .limit(1);
  return user ?? null;
}

router.get("/stream/status", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  res.json({
    streamStartedAt: user.streamStartedAt?.toISOString() ?? null,
    isLive: Boolean(user.streamStartedAt),
  });
});

router.post("/stream/start", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  const startedAt = new Date();
  await db
    .update(usersTable)
    .set({ streamStartedAt: startedAt })
    .where(eq(usersTable.id, user.id));
  res.json({
    streamStartedAt: startedAt.toISOString(),
    isLive: true,
  });
});

router.post("/stream/end", async (req, res) => {
  const user = await getCallerUser(req);
  if (!user) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }
  await db
    .update(usersTable)
    .set({ streamStartedAt: null })
    .where(eq(usersTable.id, user.id));
  res.json({
    streamStartedAt: null,
    isLive: false,
  });
});

export default router;

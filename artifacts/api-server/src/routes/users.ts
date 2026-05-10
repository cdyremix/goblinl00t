import { Router } from "express";
import { getAuth } from "@clerk/express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

const router = Router();

async function getOrCreateUser(clerkUserId: string) {
  const [existing] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  if (existing) return existing;
  const [created] = await db
    .insert(usersTable)
    .values({ clerkUserId, subscriptionTier: "free" })
    .returning();
  return created!;
}

router.get("/users/me", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const user = await getOrCreateUser(userId);
  res.json({ user });
});

router.put("/users/me/subscription", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { tier } = req.body as { tier: string };
  const valid = ["free", "premium", "pro"];
  if (!valid.includes(tier)) { res.status(400).json({ error: "Invalid tier" }); return; }
  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set({ subscriptionTier: tier })
    .where(eq(usersTable.clerkUserId, userId))
    .returning();
  res.json({ user: updated });
});

router.delete("/users/me/twitch", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const [updated] = await db
    .update(usersTable)
    .set({ twitchUserId: null, twitchUsername: null, twitchAccessToken: null, twitchRefreshToken: null })
    .where(eq(usersTable.clerkUserId, userId))
    .returning();
  res.json({ user: updated });
});

export default router;

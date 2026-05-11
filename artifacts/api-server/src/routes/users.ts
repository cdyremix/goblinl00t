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

/**
 * PUT /users/me/subscription
 *
 * Direct tier writes are restricted to "free" only — paid tiers
 * (`premium` / `pro`) are entitlement-bearing and MUST flow through
 * Stripe so we don't hand out paid features to anyone with curl. The
 * dashboard's tier picker / Rank tab routes paid selections through
 * `/api/stripe/checkout` (or the Billing Portal); the only legitimate
 * caller of this endpoint is "I picked the free plan in the post-signup
 * modal" or "downgrade me to free" (after the Stripe sub is cancelled).
 *
 * `routes/stripe.ts#GET /subscription` reconciles the active sub's
 * product `metadata.tier` back into `usersTable.subscriptionTier` on
 * every read, so paid tiers stay in sync without a writable surface
 * here.
 */
router.put("/users/me/subscription", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const { tier } = req.body as { tier: string };
  if (tier !== "free") {
    res.status(403).json({
      error: "Paid tiers can only be set via Stripe checkout. Use POST /stripe/checkout.",
    });
    return;
  }
  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set({ subscriptionTier: "free", tierSelected: true })
    .where(eq(usersTable.clerkUserId, userId))
    .returning();
  res.json({ user: updated });
});

// Lightweight acknowledgment endpoint — flips `tierSelected` without
// changing the active tier. Used when the post-signup picker is dismissed
// after the user is already on the right plan, so the modal doesn't
// re-open on the next page load.
router.put("/users/me/tier-acknowledge", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set({ tierSelected: true })
    .where(eq(usersTable.clerkUserId, userId))
    .returning();
  res.json({ user: updated });
});

const VALID_AVATAR_PRESETS = ["goblin", "ogre", "wizard", "knight", "rogue", "king"];

router.put("/users/me/profile", async (req, res) => {
  const { userId } = getAuth(req);
  if (!userId) { res.status(401).json({ error: "Unauthorized" }); return; }
  const body = req.body as { avatarPreset?: string | null };
  const updates: Partial<typeof usersTable.$inferInsert> = {};
  if ("avatarPreset" in body) {
    if (body.avatarPreset !== null && !VALID_AVATAR_PRESETS.includes(body.avatarPreset ?? "")) {
      res.status(400).json({ error: "Invalid avatar preset" });
      return;
    }
    updates.avatarPreset = body.avatarPreset ?? null;
  }
  await getOrCreateUser(userId);
  const [updated] = await db
    .update(usersTable)
    .set(updates)
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

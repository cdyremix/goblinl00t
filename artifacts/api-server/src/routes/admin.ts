import { Router } from "express";
import { db, usersTable } from "@workspace/db";
import { eq, desc, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "../lib/auth-helpers";

const router = Router();

/**
 * GET /admin/me — quick "am I an admin?" probe used by the dashboard
 * to decide whether to show the Admin sidebar link. Returns 200 with
 * `{ isAdmin: true }` when the caller is an admin, 403 otherwise.
 */
router.get("/admin/me", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;
  res.json({ isAdmin: true, user: ctx.user });
});

/**
 * GET /admin/users — full streamer roster. Includes every column the
 * admin dashboard might want to display. Sorted newest-first so freshly
 * signed-up accounts surface at the top of the table.
 */
router.get("/admin/users", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const rows = await db
    .select({
      id: usersTable.id,
      clerkUserId: usersTable.clerkUserId,
      twitchUsername: usersTable.twitchUsername,
      twitchUserId: usersTable.twitchUserId,
      steamUsername: usersTable.steamUsername,
      steamId64: usersTable.steamId64,
      subscriptionTier: usersTable.subscriptionTier,
      tierSelected: usersTable.tierSelected,
      isAdmin: usersTable.isAdmin,
      botTheme: usersTable.botTheme,
      botName: usersTable.botName,
      goblinEventsEnabled: usersTable.goblinEventsEnabled,
      lootDropsEnabled: usersTable.lootDropsEnabled,
      coinRedemptionEnabled: usersTable.coinRedemptionEnabled,
      coinCap: usersTable.coinCap,
      stripeCustomerId: usersTable.stripeCustomerId,
      stripeSubscriptionId: usersTable.stripeSubscriptionId,
      createdAt: usersTable.createdAt,
    })
    .from(usersTable)
    .orderBy(desc(usersTable.createdAt));

  res.json({ users: rows });
});

const PatchUserBody = z.object({
  subscriptionTier: z.enum(["free", "premium", "pro"]).optional(),
  isAdmin: z.boolean().optional(),
  tierSelected: z.boolean().optional(),
  botTheme: z.enum(["goblin", "cs2"]).optional(),
  botName: z.string().min(1).max(60).optional(),
  goblinEventsEnabled: z.boolean().optional(),
  lootDropsEnabled: z.boolean().optional(),
  coinRedemptionEnabled: z.boolean().optional(),
  coinCap: z.number().int().nonnegative().nullable().optional(),
});

/**
 * PATCH /admin/users/:id — admin-only override of any per-user field.
 * Only fields explicitly listed in `PatchUserBody` are writable; the
 * Stripe IDs / Twitch tokens are never reachable from this endpoint
 * because flipping them on a live account would corrupt the Stripe
 * sync + bot-channel mapping.
 *
 * Note: when the admin promotes a user to a paid tier from this
 * endpoint, no Stripe charge is created — this is a manual entitlement
 * override (e.g. comp accounts for a partnered streamer). The next
 * `/api/stripe/subscription` reconcile WILL still overwrite the tier
 * based on the user's actual active Stripe subscription, so manual
 * promotions are sticky only if the user has no Stripe sub.
 */
router.patch("/admin/users/:id", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const id = Number(req.params["id"]);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: "Invalid user id" });
    return;
  }

  const parsed = PatchUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid body", issues: parsed.error.issues });
    return;
  }

  // Block self-demotion of admin so the project owner can't accidentally
  // strip their own super-user rights and lock themselves out.
  if (
    parsed.data.isAdmin === false &&
    id === ctx.user.id
  ) {
    res.status(400).json({ error: "Refusing to demote yourself." });
    return;
  }

  const updates: Partial<typeof usersTable.$inferInsert> = { ...parsed.data };
  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [updated] = await db
    .update(usersTable)
    .set(updates)
    .where(eq(usersTable.id, id))
    .returning();
  if (!updated) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ user: updated });
});

/**
 * GET /admin/stats — system-wide summary card for the admin dashboard.
 * Aggregates total users, paid users by tier, twitch-linked count, etc.
 */
router.get("/admin/stats", async (req, res) => {
  const ctx = await requireAdmin(req, res);
  if (!ctx) return;

  const [counts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      free: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'free')::int`,
      premium: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'premium')::int`,
      pro: sql<number>`count(*) filter (where ${usersTable.subscriptionTier} = 'pro')::int`,
      twitchLinked: sql<number>`count(*) filter (where ${usersTable.twitchUsername} is not null)::int`,
      steamLinked: sql<number>`count(*) filter (where ${usersTable.steamId64} is not null)::int`,
      admins: sql<number>`count(*) filter (where ${usersTable.isAdmin} = true)::int`,
    })
    .from(usersTable);

  res.json({ stats: counts ?? null });
});

export default router;

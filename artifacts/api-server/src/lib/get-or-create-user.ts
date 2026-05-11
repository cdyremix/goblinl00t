import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { clerkClient } from "@clerk/express";
import { isSuperUserEmail } from "./super-user";

/**
 * Per-process TTL cache of "we've already reconciled admin status for this
 * Clerk userId in the last hour." Without this, every `/users/me` (which
 * the dashboard polls liberally via React Query) would hit Clerk's API
 * and burn through our rate budget. One hour is a reasonable trade-off
 * between freshness (newly added super-user emails take effect within
 * an hour) and Clerk API economy.
 */
const ADMIN_CHECK_TTL_MS = 60 * 60 * 1000;
const ADMIN_CHECKED: Map<string, number> = new Map();

function recentlyChecked(clerkUserId: string): boolean {
  const exp = ADMIN_CHECKED.get(clerkUserId);
  return typeof exp === "number" && exp > Date.now();
}

function markChecked(clerkUserId: string) {
  ADMIN_CHECKED.set(clerkUserId, Date.now() + ADMIN_CHECK_TTL_MS);
}

// Periodically prune stale entries so the map doesn't grow unbounded.
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of ADMIN_CHECKED) {
    if (v < now) ADMIN_CHECKED.delete(k);
  }
}, 10 * 60 * 1000).unref();

/**
 * Single source of truth for "is this Clerk userId in our DB?". Looks
 * the row up, creates it on first sight (with `subscriptionTier="free"`
 * for normal sign-ups), AND on every call re-asserts super-user status
 * by checking the Clerk-side primary email against the allowlist.
 *
 * Re-asserting on every call (rather than only on insert) means:
 *   - the project owner never needs a manual DB poke after a wipe
 *   - newly added entries in `SUPER_USER_EMAILS` take effect on next
 *     `/users/me` hit, no migration required
 *   - admins always see themselves as Pro tier in the UI without us
 *     having to special-case it in `useSubscriptionTier`
 *
 * The Clerk lookup is best-effort — if the SDK call fails for any reason
 * we fall back to whatever `isAdmin` is currently in the DB so a flaky
 * Clerk API doesn't kick the project owner out of admin.
 */
export async function getOrCreateUser(clerkUserId: string) {
  const existing = await loadUser(clerkUserId);
  if (!existing) {
    const [created] = await db
      .insert(usersTable)
      .values({ clerkUserId, subscriptionTier: "free" })
      .returning();
    // First sight of this user — always reconcile so the project owner
    // gets admin on signup. Subsequent hits go through the TTL cache.
    return await applyAdminGrants(clerkUserId, created!);
  }
  // Skip the Clerk lookup if we've reconciled this user within the TTL
  // window. The DB still holds the source of truth for `isAdmin`, so
  // skipping the lookup is safe — we just defer the next "did the
  // SUPER_USER_EMAILS list change?" check by up to an hour.
  if (recentlyChecked(clerkUserId)) return existing;
  return await applyAdminGrants(clerkUserId, existing);
}

async function loadUser(clerkUserId: string) {
  const [u] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.clerkUserId, clerkUserId))
    .limit(1);
  return u;
}

async function applyAdminGrants(
  clerkUserId: string,
  user: typeof usersTable.$inferSelect,
): Promise<typeof usersTable.$inferSelect> {
  let primaryEmail: string | null = null;
  try {
    const cu = await clerkClient.users.getUser(clerkUserId);
    primaryEmail =
      cu.emailAddresses.find((e) => e.id === cu.primaryEmailAddressId)
        ?.emailAddress ?? cu.emailAddresses[0]?.emailAddress ?? null;
  } catch {
    // Clerk lookup failed — keep existing isAdmin flag, don't kick the
    // project owner out of admin just because Clerk's API is flaky.
    // Also DON'T mark cache so we retry on the next /users/me hit.
    return user;
  }
  // Mark the TTL cache before we return so subsequent calls within the
  // window skip the Clerk round-trip entirely.
  markChecked(clerkUserId);

  const shouldBeAdmin = isSuperUserEmail(primaryEmail);
  if (shouldBeAdmin && !user.isAdmin) {
    // First-time admin grant. Auto-acknowledge tier picker + bump to
    // pro so every feature gate passes immediately. The tier here is
    // cosmetic — `userHasFeature` short-circuits on `isAdmin` anyway,
    // but a "pro" tier keeps the dashboard cards looking right.
    const [updated] = await db
      .update(usersTable)
      .set({
        isAdmin: true,
        subscriptionTier: "pro",
        tierSelected: true,
      })
      .where(eq(usersTable.clerkUserId, clerkUserId))
      .returning();
    return updated!;
  }
  return user;
}

import type { usersTable } from "@workspace/db";

/**
 * Server-side mirror of `lib/plans.tsx` on the dashboard. The dashboard's
 * `<FeatureLock>` / `useSubscriptionTier()` hide gated UI but every paid
 * surface MUST also call `userHasFeature()` here — UI gates can be
 * bypassed by anyone with curl, so the API is the actual entitlement
 * boundary.
 *
 * Keep this list in sync with `artifacts/goblin-dashboard/src/lib/plans.tsx`.
 */
export type TierId = "free" | "premium" | "pro";

export const TIER_RANK: Record<TierId, number> = {
  free: 0,
  premium: 1,
  pro: 2,
};

export type FeatureId =
  | "unlimited-giveaways"
  | "all-themes"
  | "skin-trading"
  | "discord-webhooks"
  | "custom-responses"
  | "full-ledger-export"
  | "custom-bot-name"
  | "advanced-analytics"
  | "priority-support";

export const FEATURE_MIN_TIER: Record<FeatureId, TierId> = {
  "unlimited-giveaways": "premium",
  "all-themes": "premium",
  "skin-trading": "premium",
  "discord-webhooks": "premium",
  "custom-responses": "premium",
  "full-ledger-export": "premium",
  "custom-bot-name": "pro",
  "advanced-analytics": "pro",
  "priority-support": "pro",
};

export function normalizeTier(raw: unknown): TierId {
  return raw === "premium" || raw === "pro" ? raw : "free";
}

/**
 * Server-side feature check. Two flags short-circuit to `true` for
 * every feature:
 *   - `isAdmin`: super-user, also grants `/admin/*` access (see `requireAdmin`).
 *   - `isStaff`:  feature-gate bypass ONLY (no admin powers). Used for
 *                moderators / internal staff who need to manage things
 *                and exercise every paid surface without a Stripe sub.
 * `requireAdmin` deliberately does NOT honor `isStaff` — it stays strict
 * on `isAdmin` so staff accounts can't reach destructive admin endpoints.
 */
export function userHasFeature(
  user:
    | Pick<typeof usersTable.$inferSelect, "subscriptionTier" | "isAdmin" | "isStaff">
    | null
    | undefined,
  feature: FeatureId,
): boolean {
  if (user?.isAdmin || user?.isStaff) return true;
  const tier = normalizeTier(user?.subscriptionTier);
  const need = FEATURE_MIN_TIER[feature];
  return TIER_RANK[tier] >= TIER_RANK[need];
}

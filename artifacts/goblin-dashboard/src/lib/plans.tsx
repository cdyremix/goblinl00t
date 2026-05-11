import { Crown, Shield, Sword } from "lucide-react";
import type { ReactNode } from "react";

export type TierId = "free" | "premium" | "pro";

export interface Plan {
  id: TierId;
  name: string;
  price: string;
  period: string;
  icon: ReactNode;
  color: string;
  highlight: boolean;
  badge?: string;
  blurb: string;
}

export const TIER_RANK: Record<TierId, number> = {
  free: 0,
  premium: 1,
  pro: 2,
};

export const PLANS: Plan[] = [
  {
    id: "free",
    name: "Cave Dweller",
    price: "$0",
    period: "forever",
    icon: <Shield className="w-6 h-6 text-muted-foreground" />,
    color: "border-border/50",
    highlight: false,
    blurb: "Everything a small streamer needs to bring chaos to chat.",
  },
  {
    id: "premium",
    name: "Horde Master",
    price: "$4.99",
    period: "per month",
    icon: <Sword className="w-6 h-6 text-purple-400" />,
    color: "border-purple-500/40",
    highlight: true,
    badge: "Most Popular",
    blurb: "For streamers running real giveaways and skin drops.",
  },
  {
    id: "pro",
    name: "Goblin King",
    price: "$9.99",
    period: "per month",
    icon: <Crown className="w-6 h-6 text-amber-400" />,
    color: "border-amber-500/40",
    highlight: false,
    badge: "Full Power",
    blurb: "Sponsorship-ready analytics and white-glove onboarding.",
  },
];

/**
 * Single source of truth for what each rank unlocks. Every plan card on
 * the pricing page renders the SAME list — features above a tier's rank
 * are shown greyed out so streamers can compare apples-to-apples and see
 * exactly what an upgrade buys them.
 *
 * `id` is the gating key used by `hasFeature()` / `useFeature()` in the
 * dashboard. If you add a new feature, also gate the matching surface
 * (Settings card, page, button, etc.) with the same id.
 */
export interface Feature {
  id: FeatureId;
  label: string;
  /** Lowest tier that includes this feature. */
  minTier: TierId;
}

export type FeatureId =
  | "core-chat"
  | "coin-economy"
  | "single-giveaway"
  | "elimination-wheel"
  | "recent-stats"
  | "default-theme"
  | "community-support"
  | "unlimited-giveaways"
  | "all-themes"
  | "skin-trading"
  | "discord-webhooks"
  | "custom-responses"
  | "full-ledger-export"
  | "custom-bot-name"
  | "advanced-analytics"
  | "priority-support";

export const FEATURES: Feature[] = [
  { id: "core-chat", label: "Core chat commands", minTier: "free" },
  { id: "coin-economy", label: "Coin economy & inventory", minTier: "free" },
  { id: "single-giveaway", label: "One active giveaway at a time", minTier: "free" },
  { id: "elimination-wheel", label: "Elimination wheel", minTier: "free" },
  { id: "recent-stats", label: "Recent-stream stats", minTier: "free" },
  { id: "default-theme", label: "Default Goblin theme", minTier: "free" },
  { id: "community-support", label: "Community support", minTier: "free" },
  { id: "unlimited-giveaways", label: "Unlimited concurrent giveaways", minTier: "premium" },
  { id: "all-themes", label: "All bot themes (Goblin + CS2)", minTier: "premium" },
  { id: "skin-trading", label: "Skin trading & Trade Office", minTier: "premium" },
  { id: "discord-webhooks", label: "Discord webhook announcements", minTier: "premium" },
  { id: "custom-responses", label: "Custom command responses", minTier: "premium" },
  { id: "full-ledger-export", label: "Full ledger history & CSV export", minTier: "premium" },
  { id: "custom-bot-name", label: "Custom bot display name", minTier: "pro" },
  { id: "advanced-analytics", label: "Advanced sponsorship analytics", minTier: "pro" },
  { id: "priority-support", label: "Priority support & onboarding", minTier: "pro" },
];

export function hasFeature(tier: TierId | string | null | undefined, feature: FeatureId): boolean {
  const t = (tier as TierId) ?? "free";
  if (!(t in TIER_RANK)) return false;
  const f = FEATURES.find((x) => x.id === feature);
  if (!f) return false;
  return TIER_RANK[t] >= TIER_RANK[f.minTier];
}

export function minTierFor(feature: FeatureId): TierId {
  return FEATURES.find((f) => f.id === feature)?.minTier ?? "free";
}

export function planNameFor(tier: TierId): string {
  return PLANS.find((p) => p.id === tier)?.name ?? tier;
}

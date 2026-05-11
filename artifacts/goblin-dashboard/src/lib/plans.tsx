import { Crown, Shield, Sword } from "lucide-react";
import type { ReactNode } from "react";

export interface Plan {
  id: "free" | "premium" | "pro";
  name: string;
  price: string;
  period: string;
  icon: ReactNode;
  color: string;
  highlight: boolean;
  badge?: string;
  blurb: string;
  features: string[];
  locked: string[];
}

export const TIER_RANK: Record<Plan["id"], number> = {
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
    features: [
      "1 Twitch channel",
      "All 14 chat commands (loot, coins, giveaways, steal, hoard…)",
      "Coin economy + 5-slot inventory",
      "1 bot theme",
      "1 active giveaway at a time",
      "Elimination wheel + recent-stream stats",
      "Community Discord support",
    ],
    locked: [
      "All bot themes + Trade Office",
      "Discord webhook on giveaway end",
      "Custom command responses",
      "Full Ledger (week / month / year + CSV export)",
    ],
  },
  {
    id: "premium",
    name: "Horde Master",
    price: "$9.99",
    period: "per month",
    icon: <Sword className="w-6 h-6 text-purple-400" />,
    color: "border-purple-500/40",
    highlight: true,
    badge: "Most Popular",
    blurb: "For streamers running real giveaways and skin drops.",
    features: [
      "Everything in Cave Dweller",
      "Unlimited active giveaways",
      "All bot themes + Trade Office",
      "Steam inventory integration",
      "Discord webhook on giveaway end",
      "Custom command responses (per-channel)",
      "Full Ledger (day / week / month / year + CSV export)",
      "Email support",
    ],
    locked: [
      "Multiple Twitch channels",
      "Custom bot name",
    ],
  },
  {
    id: "pro",
    name: "Goblin King",
    price: "$24.99",
    period: "per month",
    icon: <Crown className="w-6 h-6 text-amber-400" />,
    color: "border-amber-500/40",
    highlight: false,
    badge: "Full Power",
    blurb: "Sponsorship-ready analytics and white-glove onboarding.",
    features: [
      "Everything in Horde Master",
      "Unlimited Twitch channels",
      "Custom bot name",
      "Sponsorship-ready analytics export",
      "Priority support (same-day)",
      "Early access to new themes & commands",
    ],
    locked: [],
  },
];

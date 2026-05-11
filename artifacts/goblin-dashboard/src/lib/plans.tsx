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
      "Core chat commands",
      "Coin economy & inventory",
      "One active giveaway at a time",
      "Elimination wheel",
      "Recent-stream stats",
      "Default bot theme",
      "Community support",
    ],
    locked: [
      "Unlimited giveaways",
      "All bot themes & skin trading",
      "Discord webhooks",
      "Custom command responses",
      "Full ledger & exports",
    ],
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
    features: [
      "Everything in Cave Dweller",
      "Unlimited giveaways",
      "All bot themes",
      "Skin trading tools",
      "Discord webhooks",
      "Custom command responses",
      "Full ledger & exports",
    ],
    locked: [
      "Multiple Twitch channels",
      "Custom bot name",
    ],
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
    features: [
      "Everything in Horde Master",
      "Multiple Twitch channels",
      "Custom bot name",
      "Advanced analytics",
      "Priority support",
      "Early access to new features",
      "White-glove onboarding",
    ],
    locked: [],
  },
];

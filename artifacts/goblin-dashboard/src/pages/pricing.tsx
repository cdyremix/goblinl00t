import { Link } from "wouter";
import { Check, Coins, Crown, Sword } from "lucide-react";

const TIERS = [
  {
    id: "free",
    name: "Goblin Scout",
    icon: Coins,
    price: "Free",
    cadence: "forever",
    blurb: "Everything a small streamer needs to bring chaos to chat.",
    features: [
      "Twitch chat bot (offline-mode safe)",
      "Loot drops + 5-slot inventory",
      "Goblin coins economy",
      "Up to 1 active giveaway",
      "Goblin theme",
    ],
    cta: "Current plan",
    disabled: true,
  },
  {
    id: "pro",
    name: "Loot Lord",
    icon: Sword,
    price: "$9",
    cadence: "/ month",
    blurb: "For streamers who run real giveaways and want CS2 skin support.",
    features: [
      "Everything in Goblin Scout",
      "CS2 skin giveaways + Trade Office",
      "Steam inventory integration",
      "Discord webhook on giveaway end",
      "CSV export from Ledger",
      "Custom command responses",
    ],
    cta: "Coming soon",
    disabled: true,
    highlight: true,
  },
  {
    id: "partner",
    name: "Hoard Master",
    icon: Crown,
    price: "$29",
    cadence: "/ month",
    blurb: "Sponsorship-ready analytics and white-glove onboarding.",
    features: [
      "Everything in Loot Lord",
      "Multi-channel support",
      "Sponsorship-ready analytics export",
      "Priority email support",
      "Custom branding on overlays",
    ],
    cta: "Coming soon",
    disabled: true,
  },
];

export default function Pricing() {
  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="text-center max-w-2xl mx-auto">
        <h1 className="text-4xl font-bold tracking-tight text-primary">Pricing</h1>
        <p className="text-muted-foreground mt-3 text-lg">
          Pick the loot pile that matches your stream. Everything in the free plan is
          free forever — paid tiers cover the things that cost us money to operate.
        </p>
      </div>

      <div className="grid md:grid-cols-3 gap-5 max-w-5xl mx-auto">
        {TIERS.map((t) => {
          const Icon = t.icon;
          return (
            <div
              key={t.id}
              className={`rounded-xl border p-6 flex flex-col gap-4 ${
                t.highlight
                  ? "border-primary/60 bg-primary/5 shadow-[0_0_40px_rgba(255,180,0,0.12)]"
                  : "border-border bg-card"
              }`}
              data-testid={`pricing-tier-${t.id}`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center">
                  <Icon className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-bold text-xl leading-tight">{t.name}</h2>
                  <p className="text-xs text-muted-foreground">{t.blurb}</p>
                </div>
              </div>

              <div className="flex items-end gap-1">
                <span className="text-3xl font-bold">{t.price}</span>
                <span className="text-sm text-muted-foreground mb-1">{t.cadence}</span>
              </div>

              <ul className="space-y-1.5 text-sm flex-1">
                {t.features.map((f) => (
                  <li key={f} className="flex items-start gap-2">
                    <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
              </ul>

              <button
                type="button"
                disabled={t.disabled}
                className={`mt-auto w-full text-sm font-bold py-2 rounded-md ${
                  t.disabled
                    ? "bg-muted text-muted-foreground cursor-not-allowed"
                    : "bg-primary text-primary-foreground hover:brightness-110"
                }`}
              >
                {t.cta}
              </button>
            </div>
          );
        })}
      </div>

      <p className="text-center text-xs text-muted-foreground">
        Need something custom?{" "}
        <Link href="/help" className="text-primary hover:underline">
          Get in touch
        </Link>
        .
      </p>
    </div>
  );
}

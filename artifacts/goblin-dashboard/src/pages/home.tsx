import { Link } from "wouter";
import { useEffect, useState } from "react";
import {
  Gift, Sword, Package, Zap, Star, ChevronRight, Terminal,
  Sparkles, Trophy, MessageSquare, ShieldCheck, Plug, Wand2,
  CheckCircle2, XCircle,
} from "lucide-react";
import { useAuth } from "@clerk/react";
import { PLANS, DISPLAYED_FEATURES, hasFeature } from "@/lib/plans";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

type CmdGroup = "general" | "goblin" | "cs2" | "hearthstone";

const COMMANDS: { cmd: string; desc: string; rarity: string; group: CmdGroup }[] = [
  { cmd: "!loot", desc: "Roll for a random inventory drop — common to legendary rarity", rarity: "legendary", group: "general" },
  { cmd: "!enter", desc: "Enter the active giveaway", rarity: "epic", group: "general" },
  { cmd: "!giveaway", desc: "Check if a giveaway is running and how many entries so far", rarity: "rare", group: "general" },
  { cmd: "!inventory", desc: "List the items in your pouch (5-slot cap)", rarity: "uncommon", group: "general" },
  { cmd: "!sell", desc: "Sell an inventory slot for coins — !sell <slot> or !sell all", rarity: "uncommon", group: "general" },
  { cmd: "!use", desc: "Activate a buff item from your inventory — !use <slot>", rarity: "rare", group: "general" },
  { cmd: "!redeem", desc: "Redeem coins for extra giveaway entries (100 coins = 1 entry)", rarity: "rare", group: "general" },
  { cmd: "!coins", desc: "Check your coin balance (alias for !points)", rarity: "common", group: "general" },
  { cmd: "!help", desc: "Show the bot's currently-enabled commands", rarity: "common", group: "general" },
  { cmd: "!goblin", desc: "Summon the goblin for a chaotic response", rarity: "uncommon", group: "goblin" },
  { cmd: "!steal", desc: "Attempt a theft from another viewer — the goblin decides the outcome", rarity: "rare", group: "goblin" },
  { cmd: "!feed", desc: "Offer a snack to keep the goblin happy and running smoothly", rarity: "common", group: "goblin" },
  { cmd: "!tradeurl", desc: "Submit your Steam trade URL after winning a CS2 skin giveaway", rarity: "common", group: "cs2" },
  { cmd: "!skin", desc: "Summon the bot (CS2 alias of !goblin)", rarity: "uncommon", group: "cs2" },
  { cmd: "!scam", desc: "Attempt a trade scam — CS2 alias of !steal", rarity: "rare", group: "cs2" },
  { cmd: "!innkeeper", desc: "Summon the Innkeeper for a Tavern Brawl response", rarity: "uncommon", group: "hearthstone" },
  { cmd: "!brew", desc: "Offer the Innkeeper a brew — Hearthstone alias of !feed", rarity: "common", group: "hearthstone" },
];

const GROUP_META: Record<CmdGroup, { label: string; tag: string; tagClass: string }> = {
  general:     { label: "General Commands",          tag: "always available", tagClass: "text-muted-foreground" },
  goblin:      { label: "Goblin Horde Commands",     tag: "Goblin theme",     tagClass: "text-amber-400" },
  cs2:         { label: "CS2 Arms Deal Commands",    tag: "CS2 theme",        tagClass: "text-blue-400" },
  hearthstone: { label: "Hearthstone Tavern Commands", tag: "Hearthstone theme", tagClass: "text-orange-400" },
};

const RARITY_STYLES: Record<string, string> = {
  legendary: "border-amber-500/40 bg-amber-500/5 text-amber-400",
  epic: "border-purple-500/40 bg-purple-500/5 text-purple-400",
  rare: "border-blue-500/40 bg-blue-500/5 text-blue-400",
  uncommon: "border-green-500/40 bg-green-500/5 text-green-400",
  common: "border-border/50 bg-card/50 text-muted-foreground",
};

const CMD_LABEL: Record<string, string> = {
  legendary: "LEGENDARY",
  epic: "EPIC",
  rare: "RARE",
  uncommon: "UNCOMMON",
  common: "COMMON",
};

// Looping fake-chat reel — gives the hero something alive to look at without
// embedding a real bot session. Each line: who said it, what they said, optional
// rarity tint.
type ChatLine = { who: string; whoColor: string; text: string; tint?: string };
const CHAT_REEL: ChatLine[] = [
  { who: "loot_pirate", whoColor: "text-blue-400", text: "!loot" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "🟣 @loot_pirate rolls EPIC — Cursed Crown 👑 (+250 coins) SCREEEEE!!", tint: "text-purple-400" },
  { who: "neon_cat", whoColor: "text-pink-400", text: "!enter" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "✅ @neon_cat is in the pool! 47 entries so far." },
  { who: "vapor_witch", whoColor: "text-purple-400", text: "!loot" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "✨ GOLDEN LEGENDARY!! @vapor_witch cracked Ragnaros the Firelord! (+5000 pts) THE TAVERN IS IN UPROAR!!", tint: "text-yellow-300" },
  { who: "speedrun_sam", whoColor: "text-green-400", text: "!steal neon_cat" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "🦝 speedrun_sam mugged neon_cat for 80 coins. Chaos prevails." },
  { who: "pixel_knight", whoColor: "text-orange-400", text: "!gift neon_cat 200" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "💸 pixel_knight gifted neon_cat 200 coins. Very generous." },
  { who: "chaos_reaper", whoColor: "text-red-400", text: "!top" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "🏆 Top coins: 1. vapor_witch 5,420 · 2. loot_pirate 1,340 · 3. neon_cat 980" },
  { who: "streamer", whoColor: "text-primary/80", text: "ending the giveaway — spin that wheel!" },
  { who: "Goblin L00t", whoColor: "text-primary", text: "🎉 WINNER: @neon_cat wins the Mystery Box! GG everyone!", tint: "text-green-300" },
];

export function Home() {
  const { isLoaded, isSignedIn } = useAuth();

  // Chat reel cycles one new line every ~1.6s.
  const [reelHead, setReelHead] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setReelHead((i) => (i + 1) % CHAT_REEL.length), 1600);
    return () => clearInterval(id);
  }, []);
  const visibleReel = Array.from({ length: 6 }, (_, k) => {
    const idx = (reelHead + k) % CHAT_REEL.length;
    return { ...CHAT_REEL[idx], _key: `${reelHead}-${k}` };
  });

  return (
    <div className="min-h-screen bg-background text-foreground dark selection:bg-primary/30 overflow-x-hidden">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={`${basePath}/goblin-logo.png`} alt="Goblin L00t" className="w-8 h-8 object-contain" />
            <span className="font-medieval text-xl font-bold tracking-tight text-primary">Goblin L00t</span>
          </div>
          <div className="hidden md:flex items-center gap-6 text-sm text-muted-foreground">
            <a href="#how" className="hover:text-foreground transition-colors">How it works</a>
            <a href="#features" className="hover:text-foreground transition-colors">Features</a>
            <a href="#commands" className="hover:text-foreground transition-colors">Commands</a>
            <a href="#pricing" className="hover:text-foreground transition-colors">Pricing</a>
          </div>
          <div className="flex items-center gap-3">
            {isLoaded && isSignedIn ? (
              <Link href="/dashboard" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-bold hover:brightness-110 transition-all" data-testid="link-dashboard">
                Dashboard
                <ChevronRight className="w-4 h-4" />
              </Link>
            ) : (
              <>
                <Link href="/sign-in" className="text-sm text-muted-foreground hover:text-foreground transition-colors font-medium px-3 py-2 rounded-md hover:bg-muted/30">
                  Sign In
                </Link>
                <Link href="/sign-up" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-bold hover:brightness-110 transition-all" data-testid="link-get-started">
                  Get Started
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-28 pb-20 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(46,204,113,0.15),transparent)]" />
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-6xl mx-auto grid lg:grid-cols-[1.1fr_1fr] gap-12 items-center">
          {/* Left: copy */}
          <div className="text-center lg:text-left">
            <div className="inline-flex items-center gap-2 bg-card border border-primary/30 rounded-full px-4 py-1.5 text-sm text-primary font-mono mb-6 shadow-[0_0_20px_rgba(46,204,113,0.15)]">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
              </span>
              Live in Twitch chat
            </div>

            <h1 className="font-medieval text-5xl md:text-7xl font-bold tracking-tight leading-[0.95] mb-6">
              <span className="text-foreground">Run giveaways your</span>{" "}
              <span className="text-primary">chat will brag about.</span>
            </h1>

            <p className="text-lg text-muted-foreground max-w-xl lg:mx-0 mx-auto mb-8 leading-relaxed">
              Goblin L00t turns your Twitch chat into a loot economy — viewers earn coins, roll for drops,
              and battle through an elimination wheel for whatever prize you put on the line. Three themes:
              Goblin Horde, CS2 Arms Deal, or Hearthstone Tavern. Pick your chaos.
            </p>

            <div className="flex flex-col sm:flex-row gap-4 lg:justify-start justify-center mb-6">
              {isLoaded && isSignedIn ? (
                <Link href="/dashboard" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_30px_rgba(46,204,113,0.3)]" data-testid="link-get-started">
                  Open Dashboard
                  <ChevronRight className="w-5 h-5" />
                </Link>
              ) : (
                <Link href="/sign-up" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_30px_rgba(46,204,113,0.3)]" data-testid="link-get-started">
                  Connect your channel
                  <ChevronRight className="w-5 h-5" />
                </Link>
              )}
              <a href="#how" className="flex items-center justify-center gap-2 bg-card border border-border hover:border-primary/50 text-foreground px-8 py-3.5 rounded-lg text-base font-bold transition-all">
                See how it works
              </a>
            </div>

            <p className="text-xs text-muted-foreground/80 lg:text-left text-center">
              No credit card. Works with any Twitch channel. <span className="text-foreground/80">Setup in under 2 minutes.</span>
            </p>
          </div>

          {/* Right: looping fake-chat demo */}
          <div className="relative">
            <div className="absolute -inset-4 bg-primary/10 blur-3xl rounded-full pointer-events-none" />
            <div className="relative rounded-2xl border border-border/60 bg-card/80 backdrop-blur shadow-2xl overflow-hidden">
              <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border/60 bg-background/40">
                <span className="w-2.5 h-2.5 rounded-full bg-red-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                <span className="w-2.5 h-2.5 rounded-full bg-green-500/70" />
                <span className="ml-2 text-xs font-mono text-muted-foreground">twitch.tv/yourchannel · #chat</span>
                <span className="ml-auto inline-flex items-center gap-1 text-[10px] font-mono text-primary">
                  <MessageSquare className="w-3 h-3" /> live
                </span>
              </div>
              <div className="p-4 h-[340px] overflow-hidden font-mono text-[13px] leading-relaxed space-y-2" aria-live="polite">
                {visibleReel.map((line, i) => (
                  <div
                    key={line._key}
                    className="flex gap-2 animate-in fade-in slide-in-from-bottom-2 duration-500"
                    style={{ opacity: 0.3 + (i / visibleReel.length) * 0.7 }}
                  >
                    <span className={`${line.whoColor} font-bold shrink-0`}>{line.who}:</span>
                    <span className={line.tint ?? "text-foreground/90"}>{line.text}</span>
                  </div>
                ))}
              </div>
              <div className="px-4 py-2.5 border-t border-border/60 bg-background/40 flex items-center gap-2 text-xs text-muted-foreground">
                <Sparkles className="w-3.5 h-3.5 text-primary" />
                Real bot output. Customize every reply from your dashboard.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Social-proof strip */}
      <section className="border-y border-border/50 bg-card/30">
        <div className="max-w-6xl mx-auto px-6 py-6 grid grid-cols-2 md:grid-cols-4 gap-6 text-center">
          <ProofStat value="2 min" label="Average setup time" />
          <ProofStat value="14" label="Built-in chat commands" />
          <ProofStat value="3" label="Themes" />
          <ProofStat value="5" label="Loot rarity tiers" />
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="py-20 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">From zero to chaos in three steps</h2>
            <p className="text-muted-foreground">No code. No OBS plugins. Just connect and play.</p>
          </div>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <StepCard
              n={1}
              icon={<Plug className="w-5 h-5 text-primary" />}
              title="Connect your channel"
              desc="Sign in, point the bot at your Twitch channel, and Goblin L00t joins your chat. Zero config required."
            />
            <StepCard
              n={2}
              icon={<Wand2 className="w-5 h-5 text-purple-400" />}
              title="Pick a theme"
              desc="Match the bot to your stream — every command response, prize label, and loot drop re-skins to fit the theme you choose."
            />
            <StepCard
              n={3}
              icon={<Trophy className="w-5 h-5 text-amber-400" />}
              title="Run your first giveaway"
              desc="Save a preset, hit Launch, and watch entries roll in. The elimination wheel handles the drama."
            />
          </div>
        </div>
      </section>

      {/* Features — three hero cards, three secondary */}
      <section id="features" className="py-20 px-6 bg-card/30 border-y border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-14">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3">Everything a giveaway stream needs</h2>
            <p className="text-muted-foreground">One bot. One dashboard. Replaces a stack of Twitch extensions.</p>
          </div>

          {/* Hero feature trio */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
            <HeroFeature
              icon={<Gift className="w-7 h-7 text-primary" />}
              title="Giveaway engine"
              desc="Create a giveaway in seconds, save reusable presets, and end with an animated elimination wheel that picks winners on stream."
              accent="primary"
            />
            <HeroFeature
              icon={<Sword className="w-7 h-7 text-purple-400" />}
              title="Loot economy"
              desc="Viewers earn coins, roll for rarity-tiered loot, manage a 5-slot pouch, and trade items for extra giveaway entries."
              accent="purple"
            />
            <HeroFeature
              icon={<Package className="w-7 h-7 text-blue-400" />}
              title="Themed prizes"
              desc="Goblin Horde for chaos and custom rewards, CS2 Arms Deal for skin giveaways with Steam inventory + a Trade Office to track delivery. More themes coming."
              accent="blue"
            />
          </div>

          {/* Secondary feature trio */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Zap className="w-6 h-6 text-blue-400" />}
              title="Chaos events"
              desc="The goblin steals coins, drops surprise loot, and keeps your chat alive between giveaways."
              accent="blue"
            />
            <FeatureCard
              icon={<Terminal className="w-6 h-6 text-primary" />}
              title="Customize every reply"
              desc="Override what the bot says for any built-in command — per channel, per theme, no redeploys."
              accent="primary"
            />
            <FeatureCard
              icon={<Star className="w-6 h-6 text-amber-400" />}
              title="Stream-scoped stats"
              desc="The Ledger filters by day/week/month/year and surfaces engagement tips so you know exactly what's landing."
              accent="amber"
            />
          </div>
        </div>
      </section>

      {/* Commands reference (deeper-dive) */}
      <section id="commands" className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">Chat commands at a glance</h2>
            <p className="text-muted-foreground">
              The core commands every viewer can use. Each one is theme-aware, customizable, and can be toggled on or off from your dashboard. Theme-specific commands unlock automatically when you pick a theme.
            </p>
          </div>
          <div className="space-y-10">
            {(["general"] as CmdGroup[]).map((group) => {
              const items = COMMANDS.filter((c) => c.group === group);
              const meta = GROUP_META[group];
              return (
                <div key={group} className="space-y-3">
                  <div className="flex items-center gap-3">
                    <h3 className="text-xl font-bold text-foreground">{meta.label}</h3>
                    <span className={`text-[10px] uppercase tracking-wider font-mono font-semibold ${meta.tagClass}`}>{meta.tag}</span>
                  </div>
                  {items.map((cmd) => (
                    <div
                      key={cmd.cmd}
                      className={`flex items-center gap-4 px-5 py-4 rounded-lg border transition-all hover:scale-[1.01] ${RARITY_STYLES[cmd.rarity]}`}
                      data-testid={`command-${cmd.cmd.replace("!", "")}`}
                    >
                      <code className="font-mono font-bold text-base shrink-0 w-32">{cmd.cmd}</code>
                      <div className="h-4 w-px bg-border" />
                      <p className="text-sm flex-1">{cmd.desc}</p>
                      <span className="text-xs font-mono font-bold tracking-wider shrink-0 opacity-60">{CMD_LABEL[cmd.rarity]}</span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing — mirrors "The Scroll" tier verbiage from /account so the
          public landing page and the in-dashboard rank picker stay in sync. */}
      <section id="pricing" className="py-20 px-6 bg-card/30 border-y border-border/50">
        <div className="max-w-6xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl md:text-4xl font-bold text-foreground mb-3 font-medieval">Pick your rank</h2>
            <p className="text-muted-foreground max-w-2xl mx-auto">
              The free tier is fully usable forever. Paid ranks unlock the things that
              cost us money to operate — CS2 trading, Discord webhooks, the full Ledger,
              and multi-channel support.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 max-w-5xl mx-auto">
            {PLANS.map((plan) => (
              <div
                key={plan.id}
                className={`relative rounded-xl border bg-card/60 p-6 flex flex-col ${
                  plan.highlight
                    ? "border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.15)]"
                    : plan.color
                }`}
                data-testid={`pricing-tier-${plan.id}`}
              >
                {plan.badge && (
                  <div
                    className={`absolute top-0 right-0 text-[10px] font-bold px-3 py-1 ${
                      plan.highlight ? "bg-purple-600 text-white" : "bg-primary text-primary-foreground"
                    }`}
                  >
                    {plan.badge}
                  </div>
                )}
                <div className="flex items-center gap-3 mb-4">
                  <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center">
                    {plan.icon}
                  </div>
                  <div>
                    <h3 className="font-medieval font-bold text-lg text-foreground">{plan.name}</h3>
                    <div className="flex items-baseline gap-1">
                      <span className="text-2xl font-bold font-mono text-primary">{plan.price}</span>
                      <span className="text-xs text-muted-foreground">/{plan.period}</span>
                    </div>
                  </div>
                </div>

                <p className="text-sm text-muted-foreground mb-4">{plan.blurb}</p>

                <ul className="space-y-1.5 mb-6 flex-1">
                  {DISPLAYED_FEATURES.map((feat) => {
                    const included = hasFeature(plan.id, feat.id);
                    return (
                      <li
                        key={feat.id}
                        className={`flex items-start gap-2 text-sm ${
                          included ? "text-foreground" : "text-muted-foreground/50"
                        }`}
                      >
                        {included ? (
                          <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        ) : (
                          <XCircle className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5" />
                        )}
                        <span>{feat.label}</span>
                      </li>
                    );
                  })}
                </ul>

                {isLoaded && isSignedIn ? (
                  <Link
                    href="/account?tab=rank"
                    className={`mt-auto w-full text-sm font-bold py-2.5 rounded-md text-center ${
                      plan.highlight
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-muted text-foreground hover:bg-muted/70"
                    }`}
                  >
                    {plan.id === "free" ? "Manage your rank" : `Upgrade to ${plan.name}`}
                  </Link>
                ) : (
                  <Link
                    href="/sign-up"
                    className={`mt-auto w-full text-sm font-bold py-2.5 rounded-md text-center ${
                      plan.highlight
                        ? "bg-primary text-primary-foreground hover:brightness-110"
                        : "bg-muted text-foreground hover:bg-muted/70"
                    }`}
                  >
                    {plan.id === "free" ? "Start free" : `Get ${plan.name}`}
                  </Link>
                )}
              </div>
            ))}
          </div>

          <p className="text-center text-xs text-muted-foreground mt-6">
            Billing handled securely by{" "}
            <a
              href="https://stripe.com"
              target="_blank"
              rel="noopener noreferrer"
              className="underline decoration-dotted hover:text-primary"
            >
              Stripe
            </a>
            . Cancel anytime from your account.
          </p>
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_50%,rgba(46,204,113,0.08),transparent)]" />
        <div className="relative max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold text-foreground mb-4">Ready to run your first giveaway?</h2>
          <p className="text-muted-foreground mb-8 text-lg">
            Sign up, point the bot at your channel, and let chat fight for the loot.
          </p>
          {isLoaded && isSignedIn ? (
            <Link href="/dashboard" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_40px_rgba(46,204,113,0.25)]" data-testid="cta-dashboard">
              Open Dashboard
              <ChevronRight className="w-5 h-5" />
            </Link>
          ) : (
            <Link href="/sign-up" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_40px_rgba(46,204,113,0.25)]" data-testid="cta-dashboard">
              Get started — connect your channel
              <ChevronRight className="w-5 h-5" />
            </Link>
          )}
          <div className="mt-6 flex items-center justify-center gap-2 text-xs text-muted-foreground">
            <ShieldCheck className="w-3.5 h-3.5" />
            We only use the Twitch scopes the bot actually needs. Disconnect any time.
          </div>
        </div>
      </section>

      <footer className="border-t border-border/50 py-8 px-6 text-center text-sm text-muted-foreground">
        <p>Goblin L00t &mdash; Built for streamers who want chaos in their chat.</p>
      </footer>
    </div>
  );
}

function StepCard({ n, icon, title, desc }: { n: number; icon: React.ReactNode; title: string; desc: string }) {
  return (
    <div className="relative p-6 rounded-xl border border-border/50 bg-card/40 hover:border-primary/30 transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-10 h-10 rounded-lg bg-background border border-border/50 flex items-center justify-center">
          {icon}
        </div>
        <span className="text-3xl font-medieval text-primary/70 leading-none">0{n}</span>
      </div>
      <h3 className="font-bold text-lg text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function HeroFeature({ icon, title, desc, accent }: { icon: React.ReactNode; title: string; desc: string; accent: string }) {
  const ringMap: Record<string, string> = {
    primary: "border-primary/30 hover:border-primary/60 hover:shadow-[0_0_30px_rgba(46,204,113,0.12)]",
    purple: "border-purple-500/30 hover:border-purple-500/60 hover:shadow-[0_0_30px_rgba(168,85,247,0.12)]",
    blue: "border-blue-500/30 hover:border-blue-500/60 hover:shadow-[0_0_30px_rgba(59,130,246,0.12)]",
  };
  return (
    <div className={`p-7 rounded-2xl border bg-card/60 transition-all ${ringMap[accent] ?? ""}`}>
      <div className="w-14 h-14 rounded-xl bg-background border border-border/50 flex items-center justify-center mb-5">
        {icon}
      </div>
      <h3 className="font-bold text-xl text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground leading-relaxed">{desc}</p>
    </div>
  );
}

function FeatureCard({ icon, title, desc, accent }: { icon: React.ReactNode; title: string; desc: string; accent: string }) {
  const glowMap: Record<string, string> = {
    primary: "hover:border-primary/40 hover:shadow-[0_0_20px_rgba(46,204,113,0.08)]",
    purple: "hover:border-purple-500/40 hover:shadow-[0_0_20px_rgba(168,85,247,0.08)]",
    green: "hover:border-green-500/40 hover:shadow-[0_0_20px_rgba(34,197,94,0.08)]",
    blue: "hover:border-blue-500/40 hover:shadow-[0_0_20px_rgba(59,130,246,0.08)]",
    amber: "hover:border-amber-500/40 hover:shadow-[0_0_20px_rgba(245,158,11,0.08)]",
  };
  return (
    <div className={`p-6 rounded-xl border border-border/50 bg-card/50 transition-all ${glowMap[accent] ?? ""}`}>
      <div className="w-12 h-12 rounded-lg bg-background border border-border/50 flex items-center justify-center mb-4">
        {icon}
      </div>
      <h3 className="font-bold text-lg text-foreground mb-2">{title}</h3>
      <p className="text-muted-foreground text-sm leading-relaxed">{desc}</p>
    </div>
  );
}

function ProofStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="text-2xl md:text-3xl font-bold text-primary font-medieval leading-none">{value}</div>
      <div className="text-xs text-muted-foreground mt-1.5 uppercase tracking-wider font-mono">{label}</div>
    </div>
  );
}

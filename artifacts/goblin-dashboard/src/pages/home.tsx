import { Link } from "wouter";
import { Gift, Sword, Package, Zap, Star, ChevronRight, Terminal } from "lucide-react";
import { useAuth } from "@clerk/react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

const COMMANDS = [
  { cmd: "!loot", desc: "Roll for random goblin loot — common to legendary rarity drops", rarity: "legendary" },
  { cmd: "!enter", desc: "Enter the active giveaway — goblin writes your name in the book", rarity: "epic" },
  { cmd: "!giveaway", desc: "Check if a giveaway is running and how many entries so far", rarity: "rare" },
  { cmd: "!hoard", desc: "See your full loot inventory and total points accumulated", rarity: "uncommon" },
  { cmd: "!goblin", desc: "Summon the goblin for a chaotic response", rarity: "uncommon" },
  { cmd: "!steal", desc: "Attempt a theft from another viewer — the goblin decides the outcome", rarity: "rare" },
  { cmd: "!feedgoblin", desc: "Offer a snack to keep the goblin happy and running smoothly", rarity: "common" },
  { cmd: "!inventory", desc: "Alias for !hoard — check your collected loot and stats", rarity: "common" },
];

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

export function Home() {
  const { isLoaded, isSignedIn } = useAuth();

  return (
    <div className="min-h-screen bg-background text-foreground dark selection:bg-primary/30 overflow-x-hidden">
      {/* Nav */}
      <header className="fixed top-0 left-0 right-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <img src={`${basePath}/goblin-logo.png`} alt="Goblin L00t" className="w-8 h-8 object-contain" />
            <span className="font-medieval text-xl font-bold tracking-tight text-primary">Goblin L00t</span>
          </div>
          <div className="flex items-center gap-3">
            <a href="https://twitch.tv/goblinl00t" target="_blank" rel="noopener noreferrer" className="text-sm text-muted-foreground hover:text-foreground transition-colors hidden sm:block">Twitch</a>
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
                <Link href="/sign-up" className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-md text-sm font-bold hover:brightness-110 transition-all" data-testid="link-dashboard">
                  Get Started
                  <ChevronRight className="w-4 h-4" />
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="pt-32 pb-24 px-6 relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_50%_at_50%_-20%,rgba(255,180,0,0.15),transparent)]" />
        <div className="absolute top-24 left-1/2 -translate-x-1/2 w-[600px] h-[300px] bg-primary/10 rounded-full blur-3xl pointer-events-none" />

        <div className="relative max-w-4xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 bg-card border border-primary/30 rounded-full px-4 py-1.5 text-sm text-primary font-mono mb-8 shadow-[0_0_20px_rgba(255,180,0,0.15)]">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-primary" />
            </span>
            Live in Twitch Chat
          </div>

          <h1 className="font-medieval text-6xl md:text-8xl font-bold tracking-tight leading-none mb-6">
            <span className="text-foreground">Goblin</span>
            <span className="text-primary"> L00t</span>
          </h1>

          <p className="text-xl text-muted-foreground max-w-2xl mx-auto mb-10 leading-relaxed">
            A mischievous bot that lives in your stream — stealing chaos, dropping loot, and making every giveaway an event your chat will remember.
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            {isLoaded && isSignedIn ? (
              <Link href="/dashboard" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_30px_rgba(255,180,0,0.3)]" data-testid="link-get-started">
                Open Dashboard
                <ChevronRight className="w-5 h-5" />
              </Link>
            ) : (
              <Link href="/sign-up" className="flex items-center justify-center gap-2 bg-primary text-primary-foreground px-8 py-3.5 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_30px_rgba(255,180,0,0.3)]" data-testid="link-get-started">
                Start for Free
                <ChevronRight className="w-5 h-5" />
              </Link>
            )}
            <a href="https://twitch.tv/goblinl00t" target="_blank" rel="noopener noreferrer" className="flex items-center justify-center gap-2 bg-card border border-border hover:border-primary/50 text-foreground px-8 py-3.5 rounded-lg text-base font-bold transition-all" data-testid="link-twitch">
              Watch on Twitch
            </a>
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-20 px-6 bg-card/30 border-y border-border/50">
        <div className="max-w-6xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-16 text-foreground">What the Goblin Does</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <FeatureCard
              icon={<Gift className="w-6 h-6 text-primary" />}
              title="Giveaway Engine"
              desc="Run stream giveaways with a single command. The goblin announces, collects entries, picks winners, and even rerolls — all through Twitch chat."
              accent="primary"
            />
            <FeatureCard
              icon={<Sword className="w-6 h-6 text-purple-400" />}
              title="Loot System"
              desc="Viewers roll for loot drops — from rusty nails to legendary shinies. Rarity tiers, point values, and a live leaderboard keep chat grinding."
              accent="purple"
            />
            <FeatureCard
              icon={<Package className="w-6 h-6 text-green-400" />}
              title="Hoard Tracking"
              desc="Every loot drop is saved. Viewers can check their inventory, see their total points, and compete on the leaderboard."
              accent="green"
            />
            <FeatureCard
              icon={<Zap className="w-6 h-6 text-blue-400" />}
              title="Chaos Events"
              desc="The goblin steals points, drops surprise loot, and responds to chaos commands — keeping your chat alive between giveaways."
              accent="blue"
            />
            <FeatureCard
              icon={<Terminal className="w-6 h-6 text-primary" />}
              title="Dashboard Control"
              desc="A full control panel to create giveaways, monitor entries, view live stats, and toggle bot commands — no Twitch chat needed."
              accent="primary"
            />
            <FeatureCard
              icon={<Star className="w-6 h-6 text-amber-400" />}
              title="Real-time Stats"
              desc="Track command usage, top looters, total drops, and giveaway history. Know exactly what's happening in your stream."
              accent="amber"
            />
          </div>
        </div>
      </section>

      {/* Commands */}
      <section className="py-20 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-12">
            <h2 className="text-3xl font-bold text-foreground mb-3">Chat Commands</h2>
            <p className="text-muted-foreground">Everything your viewers can type in chat to interact with the goblin.</p>
          </div>
          <div className="space-y-3">
            {COMMANDS.map((cmd) => (
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
        </div>
      </section>

      {/* CTA */}
      <section className="py-24 px-6 text-center relative overflow-hidden">
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_60%_80%_at_50%_50%,rgba(255,180,0,0.08),transparent)]" />
        <div className="relative max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold text-foreground mb-4">Ready to run your first giveaway?</h2>
          <p className="text-muted-foreground mb-8 text-lg">Open the dashboard to create a giveaway, check bot status, and manage everything from one place.</p>
          <Link href="/dashboard" className="inline-flex items-center gap-2 bg-primary text-primary-foreground px-8 py-4 rounded-lg text-base font-bold hover:brightness-110 transition-all shadow-[0_0_40px_rgba(255,180,0,0.25)]" data-testid="cta-dashboard">
            Open Dashboard
            <ChevronRight className="w-5 h-5" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-border/50 py-8 px-6 text-center text-sm text-muted-foreground">
        <p>Goblin L00t &mdash; Built for streamers who want chaos in their chat.</p>
      </footer>
    </div>
  );
}

function FeatureCard({ icon, title, desc, accent }: { icon: React.ReactNode; title: string; desc: string; accent: string }) {
  const glowMap: Record<string, string> = {
    primary: "hover:border-primary/40 hover:shadow-[0_0_20px_rgba(255,180,0,0.08)]",
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

import { Link, useLocation } from "wouter";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Gift, BarChart3, Terminal, Home, User, LogOut, Settings2, Send } from "lucide-react";
import { Hint } from "@/components/hint";
import { Button } from "@/components/ui/button";

export function Layout({ children }: { children: React.ReactNode }) {
  const [location] = useLocation();
  const { user } = useUser();
  const { signOut } = useClerk();
  const { getToken, isSignedIn } = useAuth();

  const settingsQuery = useQuery<{ botTheme: "goblin" | "cs2" }>({
    queryKey: ["bot-settings"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const isCS2 = settingsQuery.data?.botTheme === "cs2";

  const allLinks = [
    {
      href: "/dashboard",
      label: "Operations",
      icon: LayoutDashboard,
      hint: "The goblin's war room — bot status, active giveaway, and a live feed of loot drops happening in your stream right now.",
    },
    {
      href: "/giveaway",
      label: "Loot Hoard",
      icon: Gift,
      hint: "Create and manage giveaways. Forge a new one, start it when you're ready, and the goblin will announce it in chat — viewers type the keyword to enter.",
    },
    {
      href: "/stats",
      label: "Ledger",
      icon: BarChart3,
      hint: "The goblin's accounting books — top looters ranked by points, command usage charts, and overall stream activity numbers.",
    },
    {
      href: "/commands",
      label: "Spells",
      icon: Terminal,
      hint: "Toggle which chat commands the goblin responds to. Disable spells you don't want active without restarting anything.",
    },
    {
      href: "/account",
      label: "The Scroll",
      icon: User,
      hint: "Your account, subscription rank, and Twitch channel binding. Upgrade your rank to unlock more of the goblin's power.",
    },
    {
      href: "/settings",
      label: "Forge",
      icon: Settings2,
      hint: "Bot theme and game-specific settings. Switch between Goblin mode and CS2 Arms Deal mode, and configure your Steam trade link for skin giveaways.",
    },
    {
      href: "/trade-office",
      label: "Trade Office",
      icon: Send,
      hint: "Manage CS2 skin deliveries to giveaway winners. Track trade URLs, mark items as sent or trade-locked, and add notes for each pending trade.",
      cs2Only: true,
    },
  ];

  const links = allLinks.filter((l) => !("cs2Only" in l) || isCS2);

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground selection:bg-primary/30 dark">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col backdrop-blur-sm">
        {/* Brand */}
        <div className="h-16 flex items-center px-4 border-b border-border gap-3">
          <img src="/goblin-logo.png" alt="Goblin L00t" className="w-9 h-9 object-contain" />
          <span className="font-medieval font-bold text-xl tracking-tight text-primary leading-none">Goblin L00t</span>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-6 px-4 space-y-1">
          {links.map((link) => {
            const isActive = location.startsWith(link.href);
            const Icon = link.icon;

            return (
              <div key={link.href} className="flex items-center gap-1">
                <Link
                  href={link.href}
                  className={`flex-1 flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 ${
                    isActive
                      ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(255,180,0,0.1)]"
                      : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
                  }`}
                  data-testid={`nav-${link.label.toLowerCase().replace(" ", "-")}`}
                >
                  <Icon className="w-5 h-5 shrink-0" />
                  <span className="font-medium text-sm">{link.label}</span>
                </Link>
                <Hint text={link.hint} side="right" />
              </div>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-border space-y-3">
          {user && (
            <div className="flex items-center gap-3 px-2">
              {user.imageUrl ? (
                <img src={user.imageUrl} alt="Avatar" className="w-7 h-7 rounded-full border border-border shrink-0" />
              ) : (
                <div className="w-7 h-7 rounded-full bg-muted border border-border flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-muted-foreground" />
                </div>
              )}
              <span className="text-xs text-muted-foreground truncate flex-1">
                {user.fullName ?? user.username ?? user.primaryEmailAddress?.emailAddress}
              </span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <Link
              href="/"
              className="flex items-center gap-2 px-3 py-2 text-muted-foreground hover:text-foreground transition-colors text-sm flex-1 rounded-md hover:bg-muted/30"
            >
              <Home className="w-4 h-4" />
              Exit Cave
            </Link>
            <button
              onClick={() => signOut({ redirectUrl: "/" })}
              className="flex items-center gap-2 px-2 py-2 text-muted-foreground hover:text-destructive transition-colors text-sm rounded-md hover:bg-destructive/10"
              title="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        <div className="relative z-10 p-8 max-w-7xl mx-auto min-h-full">
          {children}
        </div>
      </main>
    </div>
  );
}

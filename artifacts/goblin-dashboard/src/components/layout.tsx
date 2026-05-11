import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { LayoutDashboard, Gift, BarChart3, Home, User, LogOut, Settings2, Send, Sparkles } from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";

const NEW_SECTIONS_KEY_PREFIX = "goblin-loot-seen-sections";

function seenKey(userId: string | null | undefined) {
  return `${NEW_SECTIONS_KEY_PREFIX}:${userId ?? "anon"}`;
}

function loadSeen(userId: string | null | undefined): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(userId));
    return new Set(raw ? (JSON.parse(raw) as string[]) : []);
  } catch {
    return new Set();
  }
}

function saveSeen(userId: string | null | undefined, seen: Set<string>) {
  try {
    localStorage.setItem(seenKey(userId), JSON.stringify([...seen]));
  } catch {
    // ignore
  }
}

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

  const profileQuery = useQuery<{ user: { avatarPreset: string | null; twitchUsername: string | null } }>({
    queryKey: ["users", "me"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
  });

  const isCS2 = settingsQuery.data?.botTheme === "cs2";
  const avatarPreset = profileQuery.data?.user.avatarPreset ?? null;
  const twitchUsername = profileQuery.data?.user.twitchUsername ?? null;
  const displayName = twitchUsername ?? "Unknown Goblin";

  const allLinks = [
    { href: "/dashboard", label: "Operations", icon: LayoutDashboard },
    { href: "/giveaway", label: "Loot Hoard", icon: Gift },
    { href: "/stats", label: "Ledger", icon: BarChart3 },
    { href: "/account", label: "The Scroll", icon: User },
    { href: "/settings", label: "Forge", icon: Settings2 },
    { href: "/trade-office", label: "Trade Office", icon: Send, cs2Only: true, newWhen: isCS2 },
  ];

  const links = allLinks.filter((l) => !("cs2Only" in l) || isCS2);

  // Highlight newly-revealed sections until visited.
  // When a link's `newWhen` is true and the user hasn't visited that route yet,
  // show a "NEW" pulse beside it. Marks seen on click or when the user navigates there.
  const userId = user?.id ?? null;
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen(userId));

  // When the signed-in user changes, reload that user's seen-set.
  useEffect(() => {
    setSeen(loadSeen(userId));
  }, [userId]);

  useEffect(() => {
    const matched = links.find((l) => location.startsWith(l.href) && "newWhen" in l && l.newWhen && !seen.has(l.href));
    if (matched) {
      const next = new Set(seen);
      next.add(matched.href);
      setSeen(next);
      saveSeen(userId, next);
    }
  }, [location, links, seen, userId]);

  function markSeen(href: string) {
    if (seen.has(href)) return;
    const next = new Set(seen);
    next.add(href);
    setSeen(next);
    saveSeen(userId, next);
  }

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
            const isNew = "newWhen" in link && link.newWhen && !seen.has(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => markSeen(link.href)}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-md transition-all duration-200 ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(255,180,0,0.1)]"
                    : isNew
                    ? "bg-primary/5 text-foreground border border-primary/40 shadow-[0_0_20px_rgba(255,180,0,0.15)]"
                    : "text-muted-foreground hover:bg-muted/50 hover:text-foreground border border-transparent"
                }`}
                data-testid={`nav-${link.label.toLowerCase().replace(" ", "-")}`}
              >
                <Icon className="w-5 h-5 shrink-0" />
                <span className="font-medium text-sm flex-1">{link.label}</span>
                {isNew && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded bg-primary text-primary-foreground">
                    <Sparkles className="w-2.5 h-2.5" />
                    New
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* User footer */}
        <div className="p-4 border-t border-border space-y-3">
          {user && (
            <div className="flex items-center gap-3 px-2">
              <UserAvatar
                presetId={avatarPreset}
                imageUrl={user.imageUrl}
                fallbackText={twitchUsername ?? "G"}
                className="w-7 h-7"
                emojiClass="text-sm"
              />
              <span className="text-xs text-muted-foreground truncate flex-1">
                {displayName}
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

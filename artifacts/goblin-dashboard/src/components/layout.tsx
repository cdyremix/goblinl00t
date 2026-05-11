import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Gift, BarChart3, User, LogOut, Settings2, Send, Sparkles, ChevronDown,
} from "lucide-react";
import { UserAvatar } from "@/components/user-avatar";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";

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
  const [accountOpen, setAccountOpen] = useState(false);

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

  // "The Scroll" (account page) used to sit in the main nav; it now lives
  // inside the expandable user menu as "Account Settings".
  const allLinks = [
    { href: "/dashboard", label: "Operations", icon: LayoutDashboard },
    { href: "/giveaway", label: "Loot Hoard", icon: Gift },
    { href: "/stats", label: "Ledger", icon: BarChart3 },
    { href: "/settings", label: "Forge", icon: Settings2 },
    { href: "/trade-office", label: "Trade Office", icon: Send, cs2Only: true, newWhen: isCS2 },
  ];

  const links = allLinks.filter((l) => !("cs2Only" in l) || isCS2);

  // Auto-expand the user menu while the user is on /account so the highlighted
  // sub-link is visible without an extra click.
  useEffect(() => {
    if (location.startsWith("/account")) setAccountOpen(true);
  }, [location]);

  // Highlight newly-revealed sections until visited.
  const userId = user?.id ?? null;
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen(userId));

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

  const accountActive = location.startsWith("/account");

  return (
    <div className="min-h-screen w-full flex bg-background text-foreground selection:bg-primary/30 dark">
      {/* Sidebar */}
      <aside className="w-64 border-r border-border bg-card/50 flex flex-col backdrop-blur-sm">
        {/* Brand */}
        <div className="h-16 flex items-center px-4 border-b border-border gap-3">
          <img src="/goblin-logo.png" alt="Goblin L00t" className="w-9 h-9 object-contain" />
          <span className="font-medieval font-bold text-xl tracking-tight text-primary leading-none">Goblin L00t</span>
        </div>

        {/* User identity + account menu (directly under logo) */}
        {user && (
          <div className="px-3 pt-3 pb-2 border-b border-border space-y-1">
            <Collapsible open={accountOpen} onOpenChange={setAccountOpen}>
              <CollapsibleTrigger
                className={`w-full flex items-center gap-3 px-2 py-2 rounded-md transition-colors text-left group ${
                  accountActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/50 text-foreground"
                }`}
                data-testid="button-account-menu"
              >
                <UserAvatar
                  presetId={avatarPreset}
                  imageUrl={user.imageUrl}
                  fallbackText={twitchUsername ?? "G"}
                  className="w-7 h-7"
                  emojiClass="text-sm"
                />
                <span className="text-sm font-medium truncate flex-1">{displayName}</span>
                <ChevronDown
                  className={`w-4 h-4 shrink-0 text-muted-foreground transition-transform ${accountOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                <div className="pt-1 pl-2 space-y-0.5">
                  <Link
                    href="/account"
                    onClick={() => markSeen("/account")}
                    className={`flex items-center gap-2 px-3 py-2 rounded-md text-sm transition-colors ${
                      accountActive
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                    }`}
                    data-testid="link-account-settings"
                  >
                    <User className="w-4 h-4 shrink-0" />
                    Account Settings
                  </Link>
                  <button
                    onClick={() => signOut({ redirectUrl: "/" })}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-md text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent"
                    data-testid="button-sign-out"
                  >
                    <LogOut className="w-4 h-4 shrink-0" />
                    Sign Out
                  </button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 py-4 px-4 space-y-1 overflow-y-auto">
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

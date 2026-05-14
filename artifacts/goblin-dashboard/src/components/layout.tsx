import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Gift, BarChart3, User, LogOut, Settings2, Send, Sparkles, ChevronDown, BookOpen,
  Plug, X, MessageCircle, Crown, Users2,
} from "lucide-react";
import { useSubscriptionTier } from "@/hooks/use-tier";
import { UserAvatar } from "@/components/user-avatar";
import { OnboardingTour } from "@/components/onboarding-tour";
import { TierSelectModal } from "@/components/tier-select-modal";
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

  const settingsQuery = useQuery<{ botTheme: "goblin" | "cs2" | "hearthstone" }>({
    queryKey: ["bot-settings"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load");
      return res.json();
    },
  });

  const profileQuery = useQuery<{ user: { avatarPreset: string | null; twitchUsername: string | null; tierSelected: boolean } }>({
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
  // Community (/users) is both a dedicated sidebar entry and a tab inside
  // Operations (`/dashboard`).
  const { isAdmin } = useSubscriptionTier();

  const allLinks = [
    { href: "/dashboard", label: "Operations", icon: LayoutDashboard },
    { href: "/giveaway", label: "Loot Horde", icon: Gift },
    { href: "/stats", label: "Ledger", icon: BarChart3 },
    { href: "/settings", label: "Forge", icon: Settings2 },
    { href: "/trade-office", label: "Trade Office", icon: Send, cs2Only: true, newWhen: isCS2 },
    // Admin Console — only rendered for super-users (`usersTable.isAdmin`).
    // Server still enforces 403 on `/api/admin/*` so even if a normal user
    // forces the route, the page lights up empty + every action 403s.
    { href: "/admin", label: "Admin Console", icon: Crown, adminOnly: true },
  ];

  const links = allLinks.filter((l) => {
    if ("cs2Only" in l && l.cs2Only && !isCS2) return false;
    if ("adminOnly" in l && l.adminOnly && !isAdmin) return false;
    return true;
  });

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
    <div className="h-full w-full flex overflow-hidden bg-background text-foreground selection:bg-primary/30 dark">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-card/50 flex flex-col backdrop-blur-sm h-full overflow-hidden">
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
        <nav className="flex-1 min-h-0 py-4 px-4 space-y-1 overflow-y-auto">
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
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_15px_rgba(46,204,113,0.1)]"
                    : isNew
                    ? "bg-primary/5 text-foreground border border-primary/40 shadow-[0_0_20px_rgba(46,204,113,0.15)]"
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

        {/* Help / pricing / community links pinned at the bottom of the sidebar.
            "Join Discord" intentionally targets a placeholder URL until the
            project has its own server — the goal is to surface the channel
            so streamers know support exists, not to fake an active community. */}
        <div className="shrink-0 border-t border-border px-4 py-3 space-y-1">
          <Link
            href="/help"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              location.startsWith("/help")
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
            }`}
            data-testid="link-help-guide"
          >
            <BookOpen className="w-4 h-4 shrink-0" />
            <span className="font-medium">Help &amp; Guide</span>
          </Link>
          <Link
            href="/support"
            className={`flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors ${
              location.startsWith("/support")
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
            }`}
            data-testid="link-contact-support"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">Contact Support</span>
          </Link>
          <div className="px-3 pt-1 flex items-center gap-3 text-[10px] text-muted-foreground/60 uppercase tracking-wider">
            <Link href="/terms" className="hover:text-foreground" data-testid="link-terms">Terms</Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-foreground" data-testid="link-privacy">Privacy</Link>
            <span>·</span>
            <Link href="/changelog" className="hover:text-foreground" data-testid="link-changelog">Changelog</Link>
          </div>
        </div>
      </aside>
      <OnboardingTour />
      {/* Post-signup tier picker — opens once per account whenever the
          streamer has not yet flipped `tierSelected`. Modal is non-dismissible
          so every new account picks a starting rank before using the rest of
          the dashboard. */}
      <TierSelectModal
        open={!!isSignedIn && profileQuery.data?.user.tierSelected === false}
        onPicked={() => profileQuery.refetch()}
      />

      {/* Main Content */}
      <main className="flex-1 overflow-auto bg-[radial-gradient(ellipse_at_top_right,_var(--tw-gradient-stops))] from-primary/5 via-background to-background relative">
        <div className="absolute inset-0 opacity-[0.03] pointer-events-none mix-blend-overlay bg-[url('https://grainy-gradients.vercel.app/noise.svg')]" />
        <div className="relative z-10 p-8 max-w-7xl mx-auto min-h-full">
          <ConnectTwitchReminder
            show={!profileQuery.isLoading && profileQuery.data !== undefined && !twitchUsername && !location.startsWith("/account")}
            userId={user?.id}
          />
          {children}
        </div>
      </main>
    </div>
  );
}

/**
 * Top-of-page reminder shown to authed streamers who haven't connected a Twitch
 * account yet. Without it, the bot has no channel to join, every command rolls
 * up to "Unknown Goblin", and stats stay empty — so this is a hard gate on the
 * product working at all.
 *
 * Dismissed copies live in sessionStorage (per Clerk userId) so the banner
 * doesn't nag mid-session, but reappears on next visit until they actually
 * connect. We always hide it on `/account` itself — they're already there.
 */
function ConnectTwitchReminder({ show, userId }: { show: boolean; userId: string | null | undefined }) {
  const dismissKey = `goblin-loot-twitch-reminder-dismissed:${userId ?? "anon"}`;
  const [dismissed, setDismissed] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(dismissKey) === "1";
    } catch {
      return false;
    }
  });

  if (!show || dismissed) return null;

  function dismiss() {
    try {
      sessionStorage.setItem(dismissKey, "1");
    } catch {
      // ignore quota / private mode
    }
    setDismissed(true);
  }

  return (
    <div
      className="mb-6 flex items-start gap-3 rounded-lg border border-primary/40 bg-primary/10 px-4 py-3 shadow-[0_0_30px_rgba(46,204,113,0.08)]"
      role="status"
      data-testid="banner-connect-twitch"
    >
      <div className="w-9 h-9 rounded-md bg-primary/20 border border-primary/30 flex items-center justify-center shrink-0">
        <Plug className="w-4 h-4 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-foreground">Connect Twitch to bring the goblin into your chat</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          The bot needs your Twitch channel before it can join, drop loot, or run giveaways. Takes about 30 seconds.
        </p>
      </div>
      <Link
        href="/account?tab=channel"
        className="shrink-0 inline-flex items-center gap-1.5 bg-primary text-primary-foreground text-xs font-bold px-3 py-1.5 rounded-md hover:brightness-110 transition-all"
        data-testid="link-connect-twitch"
      >
        Connect Twitch
      </Link>
      <button
        type="button"
        onClick={dismiss}
        className="shrink-0 text-muted-foreground hover:text-foreground transition-colors p-1 -m-1"
        aria-label="Dismiss reminder for this session"
        data-testid="button-dismiss-twitch-reminder"
      >
        <X className="w-4 h-4" />
      </button>
    </div>
  );
}

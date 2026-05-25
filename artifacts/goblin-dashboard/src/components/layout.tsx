import { useEffect, useState } from "react";
import { Link, useLocation } from "wouter";
import { useUser, useClerk, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import {
  LayoutDashboard, Gift, BarChart3, User, LogOut, Settings2, Send, Sparkles, ChevronDown, BookOpen,
  Plug, X, MessageCircle, Crown, Users2, ShieldAlert, Zap,
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
  // Chat Users (/users) is accessible via sidebar; the duplicate tab inside
  // the Dashboard has been removed to avoid confusion.
  const { isAdmin } = useSubscriptionTier();

  const allLinks = [
    { href: "/dashboard", label: "Dashboard", description: "Bot status & live activity", icon: LayoutDashboard },
    { href: "/giveaway", label: "Giveaways", description: "Run giveaways & spin the wheel", icon: Gift },
    { href: "/stats", label: "Stats", description: "Activity, coins & leaderboards", icon: BarChart3 },
    { href: "/users", label: "Community", description: "Manage viewers & inventory", icon: Users2 },
    { href: "/settings", label: "Settings", description: "Theme, economy & integrations", icon: Settings2 },
    { href: "/trade-office", label: "Trade Office", description: "Fulfill CS2 skin deliveries", icon: Send, cs2Only: true, newWhen: isCS2 },
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
    <div className="h-screen w-full flex overflow-hidden bg-background text-foreground selection:bg-primary/30 dark">
      {/* Sidebar */}
      <aside className="w-64 shrink-0 border-r border-border bg-card/60 flex flex-col backdrop-blur-sm h-full overflow-hidden">
        {/* Brand */}
        <div className="h-16 flex items-center px-5 border-b border-border gap-3 shrink-0">
          <div className="w-9 h-9 rounded-lg bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
            <img src="/goblin-logo.png" alt="Goblin L00t" className="w-6 h-6 object-contain" />
          </div>
          <div className="flex-1 min-w-0">
            <span className="font-medieval font-bold text-lg tracking-tight text-primary leading-none block">Goblin L00t</span>
            <span className="text-[10px] text-muted-foreground/50 tracking-widest uppercase font-medium">Dashboard</span>
          </div>
        </div>

        {/* User identity + account menu */}
        {user && (
          <div className="px-3 pt-3 pb-2 border-b border-border/60 space-y-1 shrink-0">
            <Collapsible open={accountOpen} onOpenChange={setAccountOpen}>
              <CollapsibleTrigger
                className={`w-full flex items-center gap-3 px-2.5 py-2 rounded-lg transition-colors text-left group ${
                  accountActive
                    ? "bg-primary/10 text-primary"
                    : "hover:bg-muted/40 text-foreground"
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
                  className={`w-3.5 h-3.5 shrink-0 text-muted-foreground/60 transition-transform duration-200 ${accountOpen ? "rotate-180" : ""}`}
                />
              </CollapsibleTrigger>
              <CollapsibleContent className="overflow-hidden data-[state=closed]:animate-collapsible-up data-[state=open]:animate-collapsible-down">
                <div className="pt-1 pl-2 space-y-0.5">
                  <Link
                    href="/account"
                    onClick={() => markSeen("/account")}
                    className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                      accountActive
                        ? "bg-primary/10 text-primary border border-primary/20"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
                    }`}
                    data-testid="link-account-settings"
                  >
                    <User className="w-3.5 h-3.5 shrink-0" />
                    Account Settings
                  </Link>
                  <button
                    onClick={() => signOut({ redirectUrl: "/" })}
                    className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors border border-transparent"
                    data-testid="button-sign-out"
                  >
                    <LogOut className="w-3.5 h-3.5 shrink-0" />
                    Sign Out
                  </button>
                </div>
              </CollapsibleContent>
            </Collapsible>
          </div>
        )}

        {/* Nav */}
        <nav className="flex-1 min-h-0 py-3 px-3 space-y-0.5 overflow-y-auto">
          <p className="px-3 pb-1.5 pt-0.5 text-[10px] font-semibold text-muted-foreground/40 uppercase tracking-widest select-none">
            Navigation
          </p>
          {links.map((link) => {
            const isActive = location.startsWith(link.href);
            const Icon = link.icon;
            const isNew = "newWhen" in link && link.newWhen && !seen.has(link.href);

            return (
              <Link
                key={link.href}
                href={link.href}
                onClick={() => markSeen(link.href)}
                className={`relative flex items-center gap-3 px-3 py-2.5 rounded-lg transition-all duration-150 ${
                  isActive
                    ? "bg-primary/10 text-primary border border-primary/20 shadow-[0_0_12px_rgba(46,204,113,0.08)]"
                    : isNew
                    ? "bg-primary/5 text-foreground border border-primary/35 shadow-[0_0_18px_rgba(46,204,113,0.12)]"
                    : "text-muted-foreground hover:bg-muted/40 hover:text-foreground border border-transparent"
                }`}
                data-testid={`nav-${link.label.toLowerCase().replace(" ", "-")}`}
              >
                <Icon className={`w-4 h-4 shrink-0 mt-0.5 ${isActive ? "text-primary" : ""}`} />
                <div className="flex-1 min-w-0">
                  <span className="font-medium text-sm leading-none block">{link.label}</span>
                  {"description" in link && link.description && (
                    <span className="text-[10px] text-muted-foreground/50 leading-none mt-0.5 block truncate">{(link as { description: string }).description}</span>
                  )}
                </div>
                {isNew && (
                  <span className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-full bg-primary text-primary-foreground">
                    <Sparkles className="w-2.5 h-2.5" />
                    New
                  </span>
                )}
              </Link>
            );
          })}
        </nav>

        {/* Footer — Help, Support, legal meta */}
        <div className="shrink-0 border-t border-border/60 px-3 py-3 space-y-0.5">
          <Link
            href="/help"
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
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
            className={`flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors ${
              location.startsWith("/support")
                ? "bg-primary/10 text-primary border border-primary/20"
                : "text-muted-foreground hover:text-foreground hover:bg-muted/40 border border-transparent"
            }`}
            data-testid="link-contact-support"
          >
            <MessageCircle className="w-4 h-4 shrink-0" />
            <span className="font-medium">Contact Support</span>
          </Link>
          <div className="px-3 pt-1.5 flex items-center gap-2.5 text-[10px] text-muted-foreground/40 uppercase tracking-widest">
            <Link href="/terms" className="hover:text-muted-foreground transition-colors" data-testid="link-terms">Terms</Link>
            <span>·</span>
            <Link href="/privacy" className="hover:text-muted-foreground transition-colors" data-testid="link-privacy">Privacy</Link>
            <span>·</span>
            <Link href="/changelog" className="hover:text-muted-foreground transition-colors" data-testid="link-changelog">Changelog</Link>
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
          <AdminControlBanner />
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
 * Shown whenever the admin is controlling another streamer's account via
 * the `?as=` param.  Reminds the admin which channel they are operating as
 * and provides an escape hatch back to their own dashboard.
 */
function AdminControlBanner() {
  const [location] = useLocation();
  // Read from the live URL each render so it updates on navigation.
  const params = new URLSearchParams(window.location.search);
  const adminAs = params.get("as")?.trim().toLowerCase() ?? null;

  if (!adminAs) return null;

  // Build links that carry the ?as= param to other pages.
  const asParam = `?as=${encodeURIComponent(adminAs)}`;

  return (
    <div
      className="mb-6 flex items-center gap-3 rounded-lg border border-amber-500/50 bg-amber-500/10 px-4 py-3 shadow-[0_0_20px_rgba(245,158,11,0.08)]"
      role="status"
      data-testid="banner-admin-control"
    >
      <div className="w-9 h-9 rounded-md bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
        <ShieldAlert className="w-4 h-4 text-amber-400" />
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-sm font-semibold text-amber-300">
          Admin control: <span className="font-mono">{adminAs}</span>
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 flex flex-wrap gap-x-3">
          <Link href={`/dashboard${asParam}`} className={`hover:text-foreground transition-colors ${location === "/dashboard" ? "text-amber-400 font-medium" : ""}`}>Dashboard</Link>
          <Link href={`/settings${asParam}`} className={`hover:text-foreground transition-colors ${location === "/settings" ? "text-amber-400 font-medium" : ""}`}>Settings</Link>
          <Link href={`/giveaway${asParam}`} className={`hover:text-foreground transition-colors ${location === "/giveaway" ? "text-amber-400 font-medium" : ""}`}>Giveaways</Link>
          <Link href={`/stats${asParam}`} className={`hover:text-foreground transition-colors ${location === "/stats" ? "text-amber-400 font-medium" : ""}`}>Stats</Link>
          <Link href={`/trade-office${asParam}`} className={`hover:text-foreground transition-colors ${location === "/trade-office" ? "text-amber-400 font-medium" : ""}`}>Trade Office</Link>
        </p>
      </div>
      <Link
        href="/dashboard"
        className="shrink-0 inline-flex items-center gap-1.5 bg-amber-500/20 border border-amber-500/40 text-amber-300 text-xs font-bold px-3 py-1.5 rounded-md hover:bg-amber-500/30 transition-all"
        data-testid="button-exit-admin-control"
      >
        <X className="w-3 h-3" />
        Exit
      </Link>
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

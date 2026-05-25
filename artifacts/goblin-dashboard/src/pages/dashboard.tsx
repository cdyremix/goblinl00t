import {
  useGetBotStatus,
  useGetStatsOverview,
  useGetRecentLoot,
  useListGiveaways,
  useRestartBot,
  useBotPartChannel,
  useBotJoinChannel,
  type Giveaway,
  type LootDrop,
  type StatsOverview,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Crown, Gem, Users, Zap, Trophy, Coins, RefreshCw, WifiOff, Wifi,
  Copy, Radio, Tv, Clock, Gift, Package, LayoutDashboard, Eye, ArrowLeft,
} from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import { useSubscriptionTier } from "@/hooks/use-tier";

/**
 * Operations Center (/dashboard)
 *
 * Redesigned with a unified StreamHero that replaces the old bot-controls pill
 * and thin stream banner. The hero shows live Twitch data (viewer count, game
 * art, stream thumbnail background, duration) alongside bot health and controls
 * all in one place so streamers get the full picture at a glance.
 */

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

interface StreamInfo {
  isLive: boolean;
  viewerCount: number | null;
  title: string | null;
  gameName: string | null;
  startedAt: string | null;
  gameId: string | null;
  thumbnailUrl: string | null;
  tags?: string[];
}

function getRarityConfig(rarity: string) {
  switch (rarity.toLowerCase()) {
    case "legendary": return { border: "border-amber-500/40", bg: "bg-amber-500/8", dot: "bg-amber-400", label: "text-amber-400" };
    case "epic":      return { border: "border-purple-500/40", bg: "bg-purple-500/8", dot: "bg-purple-400", label: "text-purple-400" };
    case "rare":      return { border: "border-blue-500/40", bg: "bg-blue-500/8", dot: "bg-blue-400", label: "text-blue-400" };
    case "uncommon":  return { border: "border-green-500/40", bg: "bg-green-500/8", dot: "bg-green-400", label: "text-green-400" };
    default:          return { border: "border-border/50", bg: "bg-muted/30", dot: "bg-zinc-500", label: "text-zinc-400" };
  }
}

// ── StreamHero ────────────────────────────────────────────────────────────────
// Unified stream status + bot health + controls panel. Shows the stream
// thumbnail as an atmospheric background when live, game box art when
// available, and all key stats at a glance.

function StreamHero({
  streamInfo,
  botStatus,
  botLoading,
  uptimeSecs,
  restarting,
  parting,
  joining,
  myChannel,
  botIsInMyChannel,
  onRestart,
  onPart,
  onJoin,
  adminView,
}: {
  streamInfo: StreamInfo | undefined;
  botStatus: { connected: boolean; channels?: string[] } | undefined;
  botLoading: boolean;
  uptimeSecs: number | undefined;
  restarting: boolean;
  parting: boolean;
  joining: boolean;
  myChannel: string | null;
  botIsInMyChannel: boolean | null;
  onRestart: () => void;
  onPart: () => void;
  onJoin: () => void;
  adminView?: boolean;
}) {
  const isLive = streamInfo?.isLive === true;

  // Stream duration live ticker
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!isLive || !streamInfo?.startedAt) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [isLive, streamInfo?.startedAt]);

  const streamDurationSecs =
    isLive && streamInfo?.startedAt
      ? Math.floor((Date.now() - new Date(streamInfo.startedAt).getTime()) / 1000)
      : null;

  const gameBoxArtUrl = streamInfo?.gameId
    ? `https://static-cdn.jtvnw.net/ttv-boxart/${streamInfo.gameId}-144x192.jpg`
    : null;

  const thumbUrl = streamInfo?.thumbnailUrl
    ? streamInfo.thumbnailUrl.replace("{width}", "1280").replace("{height}", "720")
    : null;

  const botOnline = !botLoading && !!botStatus?.connected;
  const botOffline = !botLoading && !botStatus?.connected;

  return (
    <div
      className={`relative rounded-2xl overflow-hidden border transition-all duration-500 ${
        isLive
          ? "border-red-500/25 shadow-[0_0_50px_rgba(239,68,68,0.07)]"
          : "border-border/60"
      } bg-card`}
    >
      {/* Atmospheric stream thumbnail background — only when live */}
      {isLive && thumbUrl && (
        <div className="absolute inset-0 pointer-events-none">
          <img
            src={thumbUrl}
            alt=""
            className="w-full h-full object-cover opacity-[0.14] scale-105"
          />
          <div className="absolute inset-0 bg-gradient-to-r from-card/98 via-card/88 to-card/70" />
          <div className="absolute inset-0 bg-gradient-to-t from-card/50 to-transparent" />
        </div>
      )}

      <div className="relative p-5 sm:p-6">
        <div className="flex items-start gap-5 flex-wrap">

          {/* Game box art — small thumbnail, only while live with a game */}
          {gameBoxArtUrl && isLive && (
            <img
              src={gameBoxArtUrl}
              alt={streamInfo?.gameName ?? ""}
              className="w-12 h-auto rounded-lg border border-white/10 shadow-xl shrink-0 hidden sm:block"
              onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
            />
          )}

          {/* Stream info */}
          <div className="flex-1 min-w-0 space-y-2.5">
            {/* Status row */}
            <div className="flex items-center gap-3 flex-wrap">
              {isLive ? (
                <span className="inline-flex items-center gap-1.5">
                  <span className="relative flex h-2.5 w-2.5">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-red-500" />
                  </span>
                  <span className="text-sm font-bold text-red-400 tracking-[0.12em]">LIVE</span>
                </span>
              ) : (
                <span className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground">
                  <Radio className="w-4 h-4" />
                  Offline
                </span>
              )}

              {streamInfo?.gameName && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Tv className="w-3.5 h-3.5 shrink-0" />
                  <span className="font-medium text-foreground/80">{streamInfo.gameName}</span>
                </span>
              )}

              {streamInfo?.viewerCount != null && (
                <span className="inline-flex items-center gap-1.5">
                  <Users className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xl font-bold tabular-nums leading-none">
                    {streamInfo.viewerCount.toLocaleString()}
                  </span>
                  <span className="text-sm text-muted-foreground">viewers</span>
                </span>
              )}

              {streamDurationSecs != null && (
                <span className="inline-flex items-center gap-1.5 text-sm text-muted-foreground">
                  <Clock className="w-3.5 h-3.5 shrink-0" />
                  <span className="tabular-nums font-medium text-foreground/70">
                    {formatUptime(streamDurationSecs)}
                  </span>
                </span>
              )}
            </div>

            {/* Stream title or offline hint */}
            {streamInfo?.title ? (
              <p className="text-sm text-muted-foreground/75 truncate max-w-xl">
                "{streamInfo.title}"
              </p>
            ) : !isLive ? (
              <p className="text-sm text-muted-foreground/70">
                Showing the last 12 hours of activity — stats update automatically when you go live.
              </p>
            ) : null}
          </div>

          {/* ── Bot status + controls ── */}
          <div className="flex items-center gap-2 flex-wrap shrink-0">
            {/* Status pill */}
            <div
              className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-full border text-xs font-semibold transition-all ${
                botLoading
                  ? "border-border bg-background text-muted-foreground"
                  : botOnline
                    ? "bg-green-950/40 border-green-500/30 text-green-400"
                    : "bg-red-950/30 border-red-500/20 text-red-400"
              }`}
            >
              {botLoading ? (
                <span className="w-2 h-2 rounded-full bg-muted animate-pulse" />
              ) : botOnline ? (
                <>
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
                  </span>
                  <span data-testid="status-connected">BOT ONLINE</span>
                  {uptimeSecs != null && (
                    <span className="text-green-600/70 font-normal tabular-nums">
                      {formatUptime(uptimeSecs)}
                    </span>
                  )}
                </>
              ) : (
                <>
                  <span className="w-2 h-2 rounded-full bg-red-500" />
                  <span data-testid="status-disconnected">BOT OFFLINE</span>
                </>
              )}
            </div>

            {!adminView && (
              <>
                {/* Restart bot */}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onRestart}
                  disabled={restarting}
                  className="gap-1.5 h-8 px-3 text-xs rounded-full"
                  data-testid="btn-restart-bot"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${restarting ? "animate-spin" : ""}`} />
                  {restarting ? "Restarting…" : "Restart Bot"}
                </Button>

                {/* Connect / disconnect */}
                {myChannel && (
                  botIsInMyChannel ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onPart}
                      disabled={parting}
                      className="gap-1.5 h-8 px-3 text-xs rounded-full text-muted-foreground hover:text-destructive hover:bg-destructive/10"
                      data-testid="btn-disconnect-bot"
                      title="Remove the bot from your channel (Twitch link stays intact)"
                    >
                      <WifiOff className="w-3.5 h-3.5" />
                      {parting ? "Disconnecting…" : "Disconnect Bot"}
                    </Button>
                  ) : (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={onJoin}
                      disabled={joining}
                      className="gap-1.5 h-8 px-3 text-xs rounded-full text-green-500 hover:text-green-400 hover:bg-green-500/10"
                      data-testid="btn-reconnect-bot"
                      title="Re-add the bot to your channel"
                    >
                      <Wifi className="w-3.5 h-3.5" />
                      {joining ? "Reconnecting…" : "Reconnect Bot"}
                    </Button>
                  )
                )}
              </>
            )}
          </div>
        </div>
      </div>

      {/* Live tags strip at bottom */}
      {isLive && streamInfo?.tags && streamInfo.tags.length > 0 && (
        <div className="relative border-t border-white/5 px-5 sm:px-6 py-2 flex items-center gap-2 flex-wrap">
          {streamInfo.tags.slice(0, 6).map((tag) => (
            <span
              key={tag}
              className="text-[10px] font-medium px-2 py-0.5 rounded-full bg-white/5 text-muted-foreground/60 border border-white/5"
            >
              {tag}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

// ── ActiveGiveawayBanner ──────────────────────────────────────────────────────
// Shown at the top of the overview when a giveaway is running or pending, so
// the streamer always has a one-click path to manage the active event.

function ActiveGiveawayBanner({
  giveaway,
}: {
  giveaway: { id: number; title: string; prize: string; status: string };
}) {
  const isPending = giveaway.status === "pending";
  return (
    <div
      className={`flex items-center gap-4 px-5 py-4 rounded-2xl border ${
        isPending
          ? "border-primary/30 bg-primary/5 shadow-[0_0_30px_rgba(46,204,113,0.06)]"
          : "border-amber-500/30 bg-amber-950/20 shadow-[0_0_30px_rgba(245,158,11,0.06)]"
      }`}
    >
      <div
        className={`w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${
          isPending ? "bg-primary/20 border border-primary/25" : "bg-amber-500/20 border border-amber-500/25"
        }`}
      >
        {isPending
          ? <Gift className="w-5 h-5 text-primary" />
          : <Trophy className="w-5 h-5 text-amber-400" />
        }
      </div>

      <div className="flex-1 min-w-0">
        <p className="font-bold text-sm text-foreground truncate">{giveaway.title}</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          {isPending
            ? `🎟️ Open for entries · ${giveaway.prize}`
            : "🎡 Wheel is spinning — waiting for a winner"}
        </p>
      </div>

      <Link
        href={`/giveaway/${giveaway.id}`}
        className="shrink-0 inline-flex items-center gap-1.5 text-xs font-bold px-4 py-2 rounded-lg bg-background border border-border hover:border-primary/50 hover:text-primary transition-all"
      >
        Open →
      </Link>
    </div>
  );
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({
  title,
  value,
  icon,
  loading,
  accent = "default",
}: {
  title: string;
  value?: number;
  icon: React.ReactNode;
  loading: boolean;
  accent?: "default" | "green" | "amber" | "blue" | "purple";
}) {
  const accentLine: Record<string, string> = {
    default: "bg-border",
    green:   "bg-green-500",
    amber:   "bg-amber-500",
    blue:    "bg-blue-500",
    purple:  "bg-purple-500",
  };
  return (
    <Card className="border-border/50 bg-card/60 overflow-hidden relative">
      <div className={`absolute bottom-0 left-0 right-0 h-0.5 ${accentLine[accent]} opacity-50`} />
      <CardContent className="p-5">
        <div className="flex items-start justify-between mb-3">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider leading-snug">
            {title}
          </span>
          <div className="p-1.5 rounded-md bg-muted/50 text-muted-foreground shrink-0">
            {icon}
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-9 w-20" />
        ) : (
          <div className="text-3xl font-bold font-mono tracking-tight">
            {(value ?? 0).toLocaleString()}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── GiftIcon ──────────────────────────────────────────────────────────────────

function GiftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </svg>
  );
}

// ── CreatorToolLink ───────────────────────────────────────────────────────────

function CreatorToolLink({
  label,
  description,
  locked,
  onClick,
}: {
  label: string;
  description: string;
  locked: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={locked ? undefined : onClick}
      disabled={locked}
      className={`w-full text-left rounded-xl border p-3 space-y-1 transition-all ${
        locked
          ? "border-border/25 bg-muted/15 opacity-55 cursor-not-allowed"
          : "border-border/50 bg-background/40 hover:border-primary/40 hover:bg-primary/5 cursor-pointer"
      }`}
    >
      <div className="flex items-center gap-2">
        <Copy className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-semibold text-foreground flex-1">{label}</span>
        {locked && (
          <span className="text-[9px] bg-amber-500/20 text-amber-400 border border-amber-500/30 px-1.5 py-0.5 rounded-full font-bold">
            PRO
          </span>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground pl-5 leading-relaxed">{description}</p>
    </button>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────

export function Dashboard() {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const { tier, hasFeature } = useSubscriptionTier();

  // Admin "view as" mode — pass ?as=channelname to view any streamer's dashboard.
  // The backend resolveStreamerChannelForRead accepts this param for admin callers.
  const adminAs = new URLSearchParams(window.location.search).get("as")?.toLowerCase() ?? null;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: botStatus, isLoading: botLoading, refetch: refetchBotStatus } = useGetBotStatus({ query: { refetchInterval: 10000 } as any });

  const { mutate: restartBot, isPending: restarting } = useRestartBot({
    mutation: {
      onSuccess: () => { void refetchBotStatus(); },
    },
  });
  const { mutate: partChannel, isPending: parting } = useBotPartChannel({
    mutation: {
      onSuccess: () => {
        void refetchBotStatus();
        toast({ title: "Bot disconnected", description: "The goblin left your channel. Reconnect any time." });
      },
      onError: () => toast({ title: "Failed to disconnect bot", variant: "destructive" }),
    },
  });
  const { mutate: joinChannel, isPending: joining } = useBotJoinChannel({
    mutation: {
      onSuccess: () => {
        void refetchBotStatus();
        toast({ title: "Bot reconnected", description: "The goblin is back in your channel!" });
      },
      onError: () => toast({ title: "Failed to reconnect bot", variant: "destructive" }),
    },
  });

  // Fetch the user's own Twitch channel to know whether the bot is in it.
  const { data: profileData } = useQuery<{ user: { twitchUsername: string | null } }>({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
      return res.json() as Promise<{ user: { twitchUsername: string | null } }>;
    },
  });
  const myChannel = profileData?.user.twitchUsername?.toLowerCase() ?? null;
  const botIsInMyChannel = myChannel ? (botStatus?.channels ?? []).includes(myChannel) : null;

  // ── Channel-scoped queries — normal mode (disabled in admin view) ────────────
  const { data: _statsNormal, isLoading: _statsNormalLoading } = useGetStatsOverview(
    { range: "stream" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !adminAs } as any },
  );
  const { data: _lootNormal, isLoading: _lootNormalLoading } = useGetRecentLoot(
    { limit: 15, since: "stream" },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !adminAs } as any },
  );
  const { data: _streamInfoNormal } = useQuery<StreamInfo>({
    queryKey: ["stream-info"],
    enabled: !adminAs,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/stats/stream-info", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return { isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null, gameId: null, thumbnailUrl: null, tags: [] };
      return res.json() as Promise<StreamInfo>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });
  const { data: _giveawaysNormal, isLoading: _giveawaysNormalLoading } = useListGiveaways(
    undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    { query: { enabled: !adminAs } as any },
  );

  // ── Admin "view as" queries — only fire when ?as= is present ─────────────────
  const { data: _statsAdmin, isLoading: _statsAdminLoading } = useQuery({
    queryKey: ["admin-stats-overview", adminAs],
    enabled: !!adminAs,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`/api/stats/overview?range=stream&as=${adminAs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return null;
      return r.json();
    },
    refetchInterval: 30_000,
  });
  const { data: _lootAdmin, isLoading: _lootAdminLoading } = useQuery({
    queryKey: ["admin-recent-loot", adminAs],
    enabled: !!adminAs,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`/api/loot/recent?limit=15&since=stream&as=${adminAs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const { data: _giveawaysAdmin, isLoading: _giveawaysAdminLoading } = useQuery({
    queryKey: ["admin-giveaways", adminAs],
    enabled: !!adminAs,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`/api/giveaway?as=${adminAs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return [];
      return r.json();
    },
  });
  const { data: _streamInfoAdmin } = useQuery<StreamInfo>({
    queryKey: ["admin-stream-info", adminAs],
    enabled: !!adminAs,
    queryFn: async () => {
      const token = await getToken();
      const r = await fetch(`/api/stats/stream-info?as=${adminAs}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { isLive: false, viewerCount: null, title: null, gameName: null, startedAt: null, gameId: null, thumbnailUrl: null, tags: [] };
      return r.json() as Promise<StreamInfo>;
    },
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  // ── Unified — admin view overrides normal when ?as= is set ───────────────────
  const stats = (adminAs ? _statsAdmin : _statsNormal) as StatsOverview | undefined;
  const statsLoading = adminAs ? _statsAdminLoading : _statsNormalLoading;
  const recentLoot = (adminAs ? _lootAdmin : _lootNormal) as LootDrop[] | undefined;
  const lootLoading = adminAs ? _lootAdminLoading : _lootNormalLoading;
  const allGiveaways = (adminAs ? _giveawaysAdmin : _giveawaysNormal) as Giveaway[] | undefined;
  const giveawaysLoading = adminAs ? _giveawaysAdminLoading : _giveawaysNormalLoading;
  const streamInfo = adminAs ? _streamInfoAdmin : _streamInfoNormal;

  const recentWinners = (allGiveaways ?? [])
    .filter((g) => g.status === "ended" && !!g.winnerUsername)
    .sort((a, b) => new Date(b.endedAt ?? b.createdAt).getTime() - new Date(a.endedAt ?? a.createdAt).getTime())
    .slice(0, 5);

  const activeGiveaway = (allGiveaways ?? []).find(
    (g) => g.status === "active" || g.status === "pending"
  ) ?? null;

  // Bot uptime live ticker
  const [, setSecTick] = useState(0);
  useEffect(() => {
    if (!botStatus?.connected) return;
    const id = setInterval(() => setSecTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [botStatus?.connected]);

  const botStartedAt = (botStatus as { startedAt?: string | null } | undefined)?.startedAt;
  const obsChannel = (botStatus as { channel?: string } | undefined)?.channel;
  const uptimeSecs =
    botStatus?.connected && botStartedAt
      ? Math.floor((Date.now() - new Date(botStartedAt).getTime()) / 1000)
      : undefined;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">

      {/* ── Admin view banner ── */}
      {adminAs && (
        <div className="flex items-center gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3">
          <Eye className="w-4 h-4 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-semibold text-amber-300">
              Admin view — <span className="font-mono">@{adminAs}</span>
            </p>
            <p className="text-xs text-amber-400/70">Read-only. Bot controls are hidden.</p>
          </div>
          <Link href="/dashboard">
            <Button variant="outline" size="sm" className="border-amber-500/40 text-amber-300 hover:bg-amber-500/10 shrink-0">
              <ArrowLeft className="w-3.5 h-3.5 mr-1.5" />
              Exit
            </Button>
          </Link>
        </div>
      )}

      {/* ── Page header ── */}
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
          <LayoutDashboard className="w-5 h-5 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
          <p className="text-muted-foreground text-sm">
            {adminAs ? `Viewing @${adminAs}'s channel` : "Bot status and live stream activity."}
          </p>
        </div>
      </div>

      {/* ── Stream + Bot Status Hero ── */}
      <StreamHero
        streamInfo={streamInfo}
        botStatus={botStatus}
        botLoading={botLoading}
        uptimeSecs={uptimeSecs}
        restarting={restarting}
        parting={parting}
        joining={joining}
        myChannel={myChannel}
        botIsInMyChannel={botIsInMyChannel}
        onRestart={() => restartBot()}
        onPart={() => partChannel()}
        onJoin={() => joinChannel()}
        adminView={!!adminAs}
      />

      {/* ── Active giveaway callout ── */}
      {!giveawaysLoading && activeGiveaway && (
        <ActiveGiveawayBanner giveaway={activeGiveaway} />
      )}

      <div className="space-y-6 mt-2">

          {/* Session stats — scoped to "current stream" (last 12h fallback) */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              title="Loot Dropped"
              value={stats?.totalLootDrops}
              icon={<Gem className="w-4 h-4" />}
              loading={statsLoading}
              accent="green"
            />
            <StatCard
              title="Giveaways Run"
              value={stats?.totalGiveaways}
              icon={<GiftIcon className="w-4 h-4" />}
              loading={statsLoading}
              accent="amber"
            />
            <StatCard
              title="Unique Looters"
              value={stats?.uniqueUsers}
              icon={<Users className="w-4 h-4" />}
              loading={statsLoading}
              accent="blue"
            />
            <StatCard
              title="Recent Entries"
              value={stats?.recentEntries}
              icon={<Zap className="w-4 h-4" />}
              loading={statsLoading}
              accent="purple"
            />
          </div>

          {/* Main content grid */}
          <div className="grid grid-cols-1 xl:grid-cols-3 gap-6">

            {/* Left col: Recent Winners */}
            <div className="xl:col-span-2">
              <Card className="border-border/50 overflow-hidden h-full">
                <CardHeader className="border-b border-border/50 bg-card/50 pb-4">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <Crown className="w-4 h-4 text-amber-400" />
                      Recent Winners
                    </CardTitle>
                    <Link
                      href="/giveaway"
                      className="text-xs text-muted-foreground hover:text-primary underline-offset-2 hover:underline transition-colors"
                      data-testid="link-recent-winners-hoard"
                    >
                      Manage giveaways →
                    </Link>
                  </div>
                  <CardDescription>Your last few crowned champions.</CardDescription>
                </CardHeader>
                <CardContent className="p-5">
                  {giveawaysLoading ? (
                    <div className="space-y-3">
                      {[1, 2, 3].map((i) => (
                        <Skeleton key={i} className="h-14 w-full rounded-xl" />
                      ))}
                    </div>
                  ) : recentWinners.length === 0 ? (
                    <div className="text-center py-12">
                      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mx-auto mb-3 border border-border/50">
                        <Trophy className="w-7 h-7 text-muted-foreground/40" />
                      </div>
                      <h3 className="text-base font-bold mb-1">No winners yet</h3>
                      <p className="text-muted-foreground text-sm mb-4 max-w-xs mx-auto">
                        Run a giveaway and the hall of fame fills in automatically.
                      </p>
                      <Link
                        href="/giveaway"
                        className="inline-flex items-center gap-2 bg-card border border-border hover:border-primary/50 text-foreground px-4 py-2 rounded-lg text-sm font-bold transition-all"
                        data-testid="link-empty-start-giveaway"
                      >
                        Start a Giveaway
                      </Link>
                    </div>
                  ) : (
                    <ul className="space-y-2">
                      {recentWinners.map((g) => (
                        <li key={g.id}>
                          <Link
                            href={`/giveaway/${g.id}`}
                            className="flex items-center gap-3 rounded-xl border border-border/40 bg-background/40 px-4 py-3 hover:border-amber-500/40 hover:bg-amber-500/5 transition-all group"
                            data-testid={`link-recent-winner-${g.id}`}
                          >
                            <div className="shrink-0 w-9 h-9 rounded-full bg-amber-500/15 border border-amber-500/25 flex items-center justify-center">
                              <Crown className="w-4 h-4 text-amber-400" />
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="font-bold text-sm group-hover:text-primary transition-colors truncate">
                                @{g.winnerUsername}
                              </p>
                              <p className="text-xs text-muted-foreground truncate mt-0.5">
                                {g.title}
                                {" · "}
                                {g.prizeKind === "bot_coins" && g.prizeBotCoins ? (
                                  <span className="inline-flex items-center gap-0.5 text-amber-400/90">
                                    <Coins className="w-3 h-3" />
                                    {g.prizeBotCoins}
                                  </span>
                                ) : (
                                  g.prize
                                )}
                              </p>
                            </div>
                            <span className="text-[10px] font-mono text-muted-foreground/60 shrink-0 uppercase">
                              {new Date(g.endedAt ?? g.createdAt).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                            </span>
                          </Link>
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </div>

            {/* Right col: Creator Tools + Live Loot Feed */}
            <div className="flex flex-col gap-5">

              {/* Creator Tools */}
              <Card className="border-border/50 shrink-0">
                <CardHeader className="border-b border-border/50 pb-3.5">
                  <CardTitle className="text-base flex items-center gap-2">
                    <Package className="w-4 h-4 text-primary" />
                    Creator Tools
                  </CardTitle>
                  <CardDescription className="text-xs">Share these links with your community</CardDescription>
                </CardHeader>
                <CardContent className="p-4 space-y-2.5">
                  {obsChannel ? (
                    <>
                      <CreatorToolLink
                        label="Viewer Portal"
                        description="Viewers track coins, enter giveaways, and roll loot in their browser"
                        locked={!hasFeature("viewer-portal")}
                        onClick={() => {
                          const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                          const url = `${window.location.origin}${base}/viewer/${obsChannel}`;
                          void navigator.clipboard.writeText(url);
                          toast({ title: "Viewer portal link copied!", description: url });
                        }}
                      />
                      <CreatorToolLink
                        label="OBS Loot Overlay"
                        description="Browser source in OBS — shows live loot drops as they happen"
                        locked={!hasFeature("obs-overlay")}
                        onClick={() => {
                          const base = import.meta.env.BASE_URL.replace(/\/$/, "");
                          const url = `${window.location.origin}${base}/overlay/${obsChannel}`;
                          void navigator.clipboard.writeText(url);
                          toast({ title: "OBS overlay URL copied!", description: url });
                        }}
                      />
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground leading-relaxed">
                      Link your Twitch account in{" "}
                      <Link href="/account?tab=channel" className="text-primary hover:underline">
                        Account Settings
                      </Link>{" "}
                      to unlock these links.
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Live Loot Feed */}
              <Card className="flex-1 flex flex-col border-border/50 min-h-72">
                <CardHeader className="border-b border-border/50 pb-3.5">
                  <CardTitle className="text-base flex items-center gap-2">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-60" />
                      <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                    </span>
                    Live Loot Feed
                  </CardTitle>
                </CardHeader>
                <CardContent className="p-0 flex-1 overflow-hidden relative">
                  <div className="absolute inset-0 overflow-y-auto p-3 space-y-1.5">
                    {lootLoading ? (
                      Array.from({ length: 5 }).map((_, i) => (
                        <div key={i} className="flex gap-2.5 items-center p-2.5 rounded-lg bg-muted/30 border border-border/30">
                          <Skeleton className="w-2 h-2 rounded-full shrink-0" />
                          <div className="space-y-1.5 flex-1">
                            <Skeleton className="h-3 w-20" />
                            <Skeleton className="h-2.5 w-28" />
                          </div>
                        </div>
                      ))
                    ) : recentLoot && recentLoot.length > 0 ? (
                      recentLoot.map((drop) => {
                        const rc = getRarityConfig(drop.rarity);
                        return (
                          <div
                            key={drop.id}
                            className={`flex gap-2.5 items-start p-2.5 rounded-lg border ${rc.border} ${rc.bg} transition-colors`}
                          >
                            <span className={`w-2 h-2 rounded-full shrink-0 mt-1.5 ${rc.dot}`} />
                            <div className="flex-1 min-w-0">
                              <div className="flex items-baseline justify-between gap-2">
                                <span className={`font-bold text-xs ${rc.label} truncate`}>
                                  @{drop.username}
                                </span>
                                <span className="text-[10px] font-mono text-muted-foreground/50 shrink-0 tabular-nums">
                                  {new Date(drop.droppedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                                </span>
                              </div>
                              <p className="text-[11px] text-muted-foreground/80 truncate mt-0.5">
                                {drop.item}
                              </p>
                            </div>
                          </div>
                        );
                      })
                    ) : (
                      <div className="flex flex-col items-center justify-center h-40 text-center">
                        <Gem className="w-7 h-7 text-muted-foreground/25 mb-2" />
                        <p className="text-sm text-muted-foreground/70">No drops in this window yet.</p>
                      </div>
                    )}
                  </div>
                </CardContent>
              </Card>
            </div>
          </div>
      </div>
    </div>
  );
}

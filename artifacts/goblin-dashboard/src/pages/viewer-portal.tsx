/**
 * Viewer Portal — /viewer/:channel
 *
 * Standalone public page (no Layout, no Clerk) where Twitch viewers can:
 *  - Log in with their Twitch account (lightweight cookie-based OAuth)
 *  - See their coin balance, rank, and inventory
 *  - Roll loot, enter giveaways, sell/use items, redeem coins
 *  - Gift coins, steal from others (goblin theme), submit trade URL (CS2 theme)
 *  - Browse the live leaderboard and chat feed
 *
 * Adapts visually to the channel's active bot theme (goblin / cs2 / hearthstone).
 */
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback, useRef } from "react";
import { useToast } from "@/hooks/use-toast";

// ── Theme system ──────────────────────────────────────────────────────────────

type Theme = "goblin" | "cs2" | "hearthstone";

interface ThemeConfig {
  emoji: string;
  botEmoji: string;
  name: string;
  subline: string;
  lootLabel: string;
  lootEmoji: string;
  stealable: boolean;
  hasTradeUrl: boolean;
  pageBg: string;
  headerBg: string;
  headerBorder: string;
  cardBg: string;
  cardBorder: string;
  primaryBtnBase: string;
  statBg: string;
  statBorder: string;
  giveawayBg: string;
  giveawayBorder: string;
  giveawayText: string;
  leaderRowHighlight: string;
  leaderBorderAccent: string;
  rankColor: string;
  sectionHeading: string;
  footerText: string;
}

const THEMES: Record<Theme, ThemeConfig> = {
  goblin: {
    emoji: "👺",
    botEmoji: "🧌",
    name: "Goblin Hoard",
    subline: "Hehehe… time to loot!",
    lootLabel: "Roll the Hoard",
    lootEmoji: "🎲",
    stealable: true,
    hasTradeUrl: false,
    pageBg: "bg-zinc-950",
    headerBg: "bg-amber-950/20",
    headerBorder: "border-amber-900/30",
    cardBg: "bg-zinc-900/50",
    cardBorder: "border-zinc-800/60",
    primaryBtnBase: "bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60",
    statBg: "bg-zinc-800/60",
    statBorder: "border-zinc-700/50",
    giveawayBg: "bg-amber-950/20",
    giveawayBorder: "border-amber-500/30",
    giveawayText: "text-amber-200",
    leaderRowHighlight: "bg-amber-500/5",
    leaderBorderAccent: "border-l-amber-500",
    rankColor: "text-amber-400",
    sectionHeading: "text-amber-900/60",
    footerText: "text-zinc-600",
  },
  cs2: {
    emoji: "🔫",
    botEmoji: "🎯",
    name: "CS2 Arms Deal",
    subline: "Open cases. Collect skins.",
    lootLabel: "Open a Case",
    lootEmoji: "📦",
    stealable: false,
    hasTradeUrl: true,
    pageBg: "bg-slate-950",
    headerBg: "bg-slate-900/80",
    headerBorder: "border-blue-900/30",
    cardBg: "bg-slate-900/50",
    cardBorder: "border-slate-700/60",
    primaryBtnBase: "bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/60",
    statBg: "bg-slate-800/60",
    statBorder: "border-slate-700/50",
    giveawayBg: "bg-blue-950/20",
    giveawayBorder: "border-blue-500/30",
    giveawayText: "text-blue-200",
    leaderRowHighlight: "bg-blue-500/5",
    leaderBorderAccent: "border-l-blue-500",
    rankColor: "text-blue-400",
    sectionHeading: "text-slate-600",
    footerText: "text-slate-600",
  },
  hearthstone: {
    emoji: "🍺",
    botEmoji: "🃏",
    name: "Hearthstone Tavern",
    subline: "RNGsus decides all.",
    lootLabel: "Crack a Pack",
    lootEmoji: "🃏",
    stealable: false,
    hasTradeUrl: false,
    pageBg: "bg-zinc-950",
    headerBg: "bg-orange-950/20",
    headerBorder: "border-orange-900/30",
    cardBg: "bg-zinc-900/50",
    cardBorder: "border-zinc-800/60",
    primaryBtnBase: "bg-orange-500/10 border-orange-500/30 text-orange-400 hover:bg-orange-500/20 hover:border-orange-500/60",
    statBg: "bg-zinc-800/60",
    statBorder: "border-zinc-700/50",
    giveawayBg: "bg-orange-950/20",
    giveawayBorder: "border-orange-500/30",
    giveawayText: "text-orange-200",
    leaderRowHighlight: "bg-orange-500/5",
    leaderBorderAccent: "border-l-orange-500",
    rankColor: "text-orange-400",
    sectionHeading: "text-orange-900/50",
    footerText: "text-zinc-600",
  },
};

// ── Rarity colours ────────────────────────────────────────────────────────────

type Rarity = "common" | "uncommon" | "rare" | "epic" | "legendary";

const RARITY = {
  legendary: { border: "border-amber-500/40",  bg: "bg-amber-950/30",  dot: "bg-amber-400",  label: "text-amber-300",  badge: "bg-amber-900/60 text-amber-200"  },
  epic:      { border: "border-purple-500/40", bg: "bg-purple-950/30", dot: "bg-purple-400", label: "text-purple-300", badge: "bg-purple-900/60 text-purple-200" },
  rare:      { border: "border-blue-500/40",   bg: "bg-blue-950/30",   dot: "bg-blue-400",   label: "text-blue-300",   badge: "bg-blue-900/60 text-blue-200"   },
  uncommon:  { border: "border-green-500/40",  bg: "bg-green-950/30",  dot: "bg-green-400",  label: "text-green-300",  badge: "bg-green-900/60 text-green-200"  },
  common:    { border: "border-zinc-600/30",   bg: "bg-zinc-900/40",   dot: "bg-zinc-500",   label: "text-zinc-400",   badge: "bg-zinc-800/60 text-zinc-300"   },
} satisfies Record<Rarity, object>;

function rarityStyle(r: string) {
  return RARITY[(r as Rarity) in RARITY ? (r as Rarity) : "common"];
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface AuthMe { loggedIn: boolean; username?: string; channel?: string }

interface LeaderEntry { username: string; balance: number }

interface Giveaway {
  id: number; title: string; prize: string; status: string; prizeIconUrl?: string | null;
}

interface StatusData {
  giveaway: Giveaway | null;
  entryCount: number;
  leaderboard: LeaderEntry[];
  proRequired?: boolean;
  redeemAction?: "entries" | "loot" | "luck";
  entriesOpen?: boolean;
  theme?: Theme;
}

interface InventoryItem {
  id: number; item: string; rarity: string; kind: string;
  buffEffect?: string | null; coinValue: number; chargesRemaining: number; isActive: boolean;
}

interface MeData {
  username: string;
  balance: { balance: number; cap: number | null };
  inventory: InventoryItem[];
  rank: number | null;
}

interface ChatMessage {
  username: string; display: string; message: string;
  color: string | null; isBot: boolean; timestamp: string;
}

interface LootResult {
  type: "item" | "coins"; item: string; rarity: string;
  slot?: number; coins?: number; flavor: string;
}

// ── API helpers ───────────────────────────────────────────────────────────────

async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

function postJSON(url: string, body: unknown) {
  return apiFetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ── Cooldown hook ─────────────────────────────────────────────────────────────

function useCooldown(seconds: number) {
  const [remaining, setRemaining] = useState(0);
  const start = useCallback((initialRemaining?: number) => {
    setRemaining(initialRemaining ?? seconds);
  }, [seconds]);
  useEffect(() => {
    if (remaining <= 0) return;
    const id = setInterval(() => setRemaining((n) => Math.max(0, n - 1)), 1000);
    return () => clearInterval(id);
  }, [remaining]);
  return { remaining, onCooldown: remaining > 0, start };
}

// ── Sub-components ────────────────────────────────────────────────────────────

function LiveDot({ color = "green" }: { color?: "green" | "red" | "amber" }) {
  const map = { green: "bg-green-400", red: "bg-red-400", amber: "bg-amber-400" };
  return (
    <span className="relative flex h-2 w-2 shrink-0">
      <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${map[color]} opacity-75`} />
      <span className={`relative inline-flex h-2 w-2 rounded-full ${map[color]}`} />
    </span>
  );
}

function TwitchLogo({ className = "w-4 h-4" }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden>
      <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z" />
    </svg>
  );
}

function SectionLabel({ children, aside }: { children: React.ReactNode; aside?: string }) {
  return (
    <div className="flex items-center gap-2 mb-3">
      <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">{children}</span>
      {aside && <span className="ml-auto text-[9px] text-zinc-700 font-mono">{aside}</span>}
    </div>
  );
}

function InventorySlot({
  item, tc, onSell, selling, onUse, using,
}: {
  item: InventoryItem | null;
  tc: ThemeConfig;
  onSell?: () => void;
  selling?: boolean;
  onUse?: () => void;
  using?: boolean;
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-800/50 bg-zinc-900/20 min-h-[90px] p-2 gap-1">
        <span className="text-xl opacity-15">📦</span>
        <span className="text-[9px] text-zinc-700">Empty</span>
      </div>
    );
  }
  const s = rarityStyle(item.rarity);
  const isBuff = item.kind === "buff";
  return (
    <div className={`flex flex-col rounded-xl border ${s.border} ${s.bg} p-2.5 min-h-[90px] gap-1`}>
      <div className="flex items-center gap-1">
        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
        <span className={`text-[9px] font-bold uppercase tracking-wide ${s.label} truncate flex-1`}>{item.rarity}</span>
        {isBuff && (
          <span className={`text-[8px] rounded px-1 py-0.5 font-bold shrink-0 ${
            item.isActive ? "bg-green-800/60 text-green-300" : "bg-zinc-700/60 text-zinc-400"
          }`}>
            {item.isActive ? "ON" : "BUFF"}
          </span>
        )}
      </div>
      <span className="text-[10px] font-semibold text-white leading-snug flex-1 line-clamp-2">{item.item}</span>
      {isBuff && item.chargesRemaining > 0 && (
        <span className="text-[9px] text-zinc-500">{item.chargesRemaining}× left</span>
      )}
      {!isBuff && item.coinValue > 0 && (
        <span className="text-[9px] text-amber-400">{item.coinValue}🪙</span>
      )}
      <div className="mt-auto pt-1">
        {isBuff && onUse ? (
          <button
            onClick={onUse}
            disabled={using || item.isActive}
            className="w-full text-[9px] rounded-lg px-1.5 py-1 bg-green-900/40 hover:bg-green-800/50 text-green-400 hover:text-green-200 border border-green-700/30 transition-colors disabled:opacity-40 font-semibold"
            title={item.isActive ? "Already active" : "Activate this buff"}
          >
            {using ? "…" : item.isActive ? "✨ Active" : "✨ Use"}
          </button>
        ) : !isBuff && onSell ? (
          <button
            onClick={onSell}
            disabled={selling}
            className="w-full text-[9px] rounded-lg px-1.5 py-1 bg-zinc-700/50 hover:bg-zinc-600/60 text-zinc-400 hover:text-zinc-200 transition-colors disabled:opacity-40"
          >
            {selling ? "…" : `Sell ${item.coinValue}🪙`}
          </button>
        ) : null}
      </div>
    </div>
  );
}

function ChatBubble({ msg, viewerName, tc }: { msg: ChatMessage; viewerName: string | null; tc: ThemeConfig }) {
  const isMe = msg.username === viewerName;
  return (
    <div className={`flex gap-1.5 items-baseline text-sm leading-snug ${msg.isBot ? "rounded-lg px-2 py-0.5 bg-purple-950/30 -mx-1" : ""}`}>
      <span
        className="font-bold shrink-0 text-xs whitespace-nowrap"
        style={{ color: msg.color ?? (msg.isBot ? "#9147ff" : "#71717a") }}
      >
        {msg.isBot ? `${tc.botEmoji} ` : ""}{msg.display}:
      </span>
      <span className={`break-words min-w-0 flex-1 ${isMe ? "text-white font-medium" : "text-zinc-300"}`}>
        {msg.message}
      </span>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export function ViewerPortal() {
  const params = useParams<{ channel: string }>();
  const channel = (params.channel ?? "").toLowerCase();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Queries ──
  const { data: auth, isLoading: authLoading } = useQuery<AuthMe>({
    queryKey: ["viewer-auth-me"],
    queryFn: () => apiFetch("/api/viewer/auth/me"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const isLoggedIn = auth?.loggedIn === true && auth.channel === channel;
  const viewerName = auth?.username ?? null;

  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({
    queryKey: ["viewer-status", channel],
    queryFn: () => apiFetch(`/api/viewer/${channel}/status`),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  const { data: me, refetch: refetchMe } = useQuery<MeData>({
    queryKey: ["viewer-me", channel],
    queryFn: () => apiFetch(`/api/viewer/${channel}/me`),
    enabled: isLoggedIn,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const { data: chatData } = useQuery<{ messages: ChatMessage[] }>({
    queryKey: ["viewer-chat", channel],
    queryFn: () => apiFetch(`/api/viewer/${channel}/chat`),
    refetchInterval: 3000,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  const refetchAll = useCallback(() => {
    void refetchStatus();
    if (isLoggedIn) void refetchMe();
  }, [refetchStatus, refetchMe, isLoggedIn]);

  const chatMessages = chatData?.messages ?? [];
  const chatContainerRef = useRef<HTMLDivElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const c = chatContainerRef.current;
    if (!c) return;
    if (c.scrollHeight - c.scrollTop - c.clientHeight < 120) {
      chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatMessages.length]);

  // ── Theme ──
  const theme: Theme = (status?.theme && status.theme in THEMES ? status.theme : "goblin") as Theme;
  const tc = THEMES[theme];

  // ── Derived state ──
  const balance = me?.balance.balance ?? 0;
  const cap = me?.balance.cap;
  const inventory = me?.inventory ?? [];
  const slots = Array.from({ length: 5 }, (_, i) => inventory[i] ?? null);
  const leaderboard = status?.leaderboard ?? [];
  const giveaway = status?.giveaway ?? null;
  const redeemAction = status?.redeemAction ?? "entries";
  const entriesOpen = status?.entriesOpen ?? false;
  const REDEEM_COST = redeemAction === "luck" ? 300 : redeemAction === "loot" ? 200 : 100;
  const maxRedeemEntries = redeemAction === "entries" ? Math.floor(balance / REDEEM_COST) : 1;
  const canRedeem = balance >= REDEEM_COST;

  // ── Local interaction state ──
  const lootCooldown = useCooldown(30);
  const [lastLoot, setLastLoot] = useState<LootResult | null>(null);
  const [hasEntered, setHasEntered] = useState(false);
  useEffect(() => { setHasEntered(false); }, [giveaway?.id]);
  const [redeemEntries, setRedeemEntries] = useState(1);
  const [sellingId, setSellingId] = useState<number | null>(null);
  const [usingId, setUsingId] = useState<number | null>(null);
  const [giftTarget, setGiftTarget] = useState<string | null>(null);
  const [giftAmount, setGiftAmount] = useState("100");
  const [stealingTarget, setStealingTarget] = useState<string | null>(null);
  const [tradeUrlDraft, setTradeUrlDraft] = useState("");
  const [tradeUrlSaved, setTradeUrlSaved] = useState(false);

  // ── Mutations ──

  const lootMutation = useMutation({
    mutationFn: () => apiFetch(`/api/viewer/${channel}/loot`, { method: "POST" }),
    onSuccess: (data: LootResult) => {
      setLastLoot(data);
      lootCooldown.start(30);
      void refetchAll();
      const s = rarityStyle(data.rarity);
      toast({
        title: data.type === "item"
          ? `${tc.lootEmoji} ${data.item}!`
          : `${tc.lootEmoji} Full pouch — +${data.coins}🪙`,
        description: data.flavor,
        className: `border ${s.border}`,
      });
    },
    onError: (err: Error) => {
      if (err.message.includes("cooldown") || err.message.includes("On cooldown")) {
        const match = /(\d+)/.exec(err.message);
        if (match) lootCooldown.start(parseInt(match[1]!, 10));
      }
      toast({ title: "Roll failed", description: err.message, variant: "destructive" });
    },
  });

  const enterMutation = useMutation({
    mutationFn: () => apiFetch(`/api/viewer/${channel}/enter`, { method: "POST" }),
    onSuccess: () => {
      setHasEntered(true);
      void refetchAll();
      toast({ title: "✅ Entered!", description: "Good luck in the giveaway!" });
    },
    onError: (err: Error) => {
      toast({ title: "Entry failed", description: err.message, variant: "destructive" });
    },
  });

  const redeemMutation = useMutation({
    mutationFn: () => postJSON(`/api/viewer/${channel}/redeem`, { entries: redeemEntries }),
    onSuccess: (data: {
      ticketsAdded?: number; pointsSpent?: number; balanceAfter?: number;
      action?: string; type?: string; item?: string; rarity?: string;
      slot?: number; coins?: number; flavor?: string;
    }) => {
      void refetchAll();
      if (data.action === "loot") {
        toast({ title: data.type === "item" ? `🎲 ${data.item}!` : `🎲 Full — +${data.coins}🪙`, description: data.flavor });
      } else if (data.action === "luck") {
        toast({ title: "🍀 Lucky Charm!", description: `Slot ${data.slot} — next loot roll gets upgraded rarity!` });
      } else {
        toast({
          title: `🎟️ +${data.ticketsAdded} ticket${(data.ticketsAdded ?? 1) !== 1 ? "s" : ""}!`,
          description: `Spent ${data.pointsSpent}🪙 · balance: ${data.balanceAfter}🪙`,
        });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Redeem failed", description: err.message, variant: "destructive" });
    },
  });

  const sellMutation = useMutation({
    mutationFn: (itemId: number) => postJSON(`/api/viewer/${channel}/sell`, { itemId }),
    onSuccess: (data: { coinsEarned: number; item: { item: string } }) => {
      setSellingId(null);
      void refetchAll();
      toast({ title: `💰 +${data.coinsEarned}🪙`, description: data.item?.item });
    },
    onError: (err: Error) => {
      setSellingId(null);
      toast({ title: "Sell failed", description: err.message, variant: "destructive" });
    },
  });

  const useItemMutation = useMutation({
    mutationFn: (itemId: number) => postJSON(`/api/viewer/${channel}/use`, { itemId }),
    onSuccess: (data: { item: InventoryItem; charges: number }) => {
      setUsingId(null);
      void refetchAll();
      toast({ title: `✨ ${data.item.item} activated!`, description: `${data.charges} charge${data.charges !== 1 ? "s" : ""} remaining` });
    },
    onError: (err: Error) => {
      setUsingId(null);
      toast({ title: "Use failed", description: err.message, variant: "destructive" });
    },
  });

  const giftMutation = useMutation({
    mutationFn: (vars: { target: string; amount: number }) =>
      postJSON(`/api/viewer/${channel}/gift`, vars),
    onSuccess: (data: { credited: number }, vars) => {
      setGiftTarget(null);
      setGiftAmount("100");
      void refetchAll();
      const note = data.credited < vars.amount ? " (partially capped)" : "";
      toast({ title: `🎁 Gifted ${data.credited}🪙 to @${vars.target}!${note}` });
    },
    onError: (err: Error) => {
      toast({ title: "Gift failed", description: err.message, variant: "destructive" });
    },
  });

  const stealMutation = useMutation({
    mutationFn: (target: string) => postJSON(`/api/viewer/${channel}/steal`, { target }),
    onSuccess: (data: { ok: boolean; stolen?: number; message?: string }, target) => {
      setStealingTarget(null);
      void refetchAll();
      if (data.ok) {
        toast({ title: `👺 Stole ${data.stolen}🪙 from @${target}!`, description: "HEHEHE goblin wins again!" });
      } else {
        toast({ title: "👺 Steal failed!", description: data.message ?? "Better luck next time" });
      }
    },
    onError: (err: Error) => {
      setStealingTarget(null);
      const isCooldown = err.message.includes("cooldown");
      toast({
        title: isCooldown ? "👺 On cooldown!" : "Steal failed",
        description: err.message,
        variant: isCooldown ? "default" : "destructive",
      });
    },
  });

  const tradeUrlMutation = useMutation({
    mutationFn: (tradeUrl: string) => postJSON(`/api/viewer/${channel}/tradeurl`, { tradeUrl }),
    onSuccess: () => {
      setTradeUrlSaved(true);
      toast({ title: "✅ Trade URL saved!", description: "The streamer will send your skin soon 🎁" });
    },
    onError: (err: Error) => {
      toast({ title: "Trade URL failed", description: err.message, variant: "destructive" });
    },
  });

  // ── Helpers ──
  function handleLogin() {
    window.location.href = `/api/viewer/auth/init?channel=${encodeURIComponent(channel)}`;
  }

  async function handleLogout() {
    await fetch("/api/viewer/auth/logout", { method: "POST", credentials: "include" });
    await qc.invalidateQueries({ queryKey: ["viewer-auth-me"] });
    await qc.invalidateQueries({ queryKey: ["viewer-me", channel] });
  }

  async function handleSwitchAccount() {
    await fetch("/api/viewer/auth/logout", { method: "POST", credentials: "include" });
    window.location.href = `/api/viewer/auth/init?channel=${encodeURIComponent(channel)}&force_verify=true`;
  }

  const redeemEmoji = redeemAction === "luck" ? "🍀" : redeemAction === "loot" ? tc.lootEmoji : "🎟️";
  const redeemLabel = redeemAction === "luck" ? "Luck Buff" : redeemAction === "loot" ? "Loot Redeem" : "Get Tickets";

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      className={`min-h-screen ${tc.pageBg} text-white`}
      style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
    >
      {/* ── Header ── */}
      <header className={`sticky top-0 z-20 border-b ${tc.headerBg} ${tc.headerBorder} backdrop-blur-sm`}>
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="text-2xl">{tc.emoji}</span>
            <div className="min-w-0">
              <div className="flex items-baseline gap-1.5 flex-wrap">
                <span className="font-bold text-white text-sm leading-none">Goblin L00t</span>
                <span className="text-zinc-600 text-xs hidden sm:inline">·</span>
                <span className="text-zinc-500 text-xs hidden sm:inline">#{channel}</span>
              </div>
              <div className="text-[10px] text-zinc-600 hidden sm:block mt-0.5">{tc.name}</div>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            {authLoading ? (
              <div className="h-8 w-24 rounded-full bg-zinc-800 animate-pulse" />
            ) : isLoggedIn ? (
              <>
                <span className="text-sm text-zinc-300 font-medium hidden sm:block max-w-[110px] truncate">
                  @{viewerName}
                </span>
                <button
                  onClick={handleSwitchAccount}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-purple-900/40 hover:bg-purple-800/50 text-purple-300 hover:text-purple-100 border border-purple-700/40 transition-colors"
                  title="Log out and sign in as a different account"
                >
                  Switch
                </button>
                <button
                  onClick={handleLogout}
                  className="text-xs px-2.5 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
                >
                  Log out
                </button>
              </>
            ) : (
              <button
                onClick={handleLogin}
                className="flex items-center gap-1.5 px-4 py-2 rounded-full font-semibold text-sm transition-all hover:opacity-90 active:scale-95"
                style={{ background: "#9147ff", color: "#fff" }}
              >
                <TwitchLogo /> Login
              </button>
            )}
          </div>
        </div>
        <div className="sm:hidden px-4 pb-2 text-[10px] text-zinc-600">#{channel} · {tc.name}</div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-5 space-y-5">

        {/* ── Giveaway hero card (public — show regardless of login) ── */}
        {!statusLoading && giveaway && (
          <section className={`rounded-2xl border ${tc.giveawayBorder} ${tc.giveawayBg} p-4 sm:p-5`}>
            <div className="flex items-start gap-4">
              {giveaway.prizeIconUrl && (
                <img
                  src={giveaway.prizeIconUrl}
                  alt=""
                  className="w-14 h-14 rounded-xl object-cover shrink-0 border border-white/10"
                />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  {giveaway.status === "pending" ? (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-green-400">
                      <LiveDot color="green" /> Accepting Entries
                    </span>
                  ) : (
                    <span className="flex items-center gap-1.5 text-xs font-bold text-red-400">
                      <LiveDot color="red" /> Wheel Spinning
                    </span>
                  )}
                </div>
                <p className="font-bold text-white text-sm leading-snug truncate">{giveaway.title}</p>
                <p className={`text-sm mt-0.5 truncate ${tc.giveawayText}`}>🏆 {giveaway.prize}</p>
                <p className="text-xs text-zinc-500 mt-0.5">{status?.entryCount ?? 0} entrants</p>
              </div>
              {isLoggedIn && entriesOpen && !hasEntered && (
                <button
                  onClick={() => enterMutation.mutate()}
                  disabled={enterMutation.isPending}
                  className="shrink-0 px-4 py-2.5 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-400 text-black transition-colors active:scale-95 disabled:opacity-50 shadow-lg shadow-amber-900/20"
                >
                  {enterMutation.isPending ? "…" : "Enter!"}
                </button>
              )}
              {hasEntered && (
                <span className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-green-900/40 text-green-400 border border-green-500/30">
                  ✅ Entered
                </span>
              )}
              {isLoggedIn && !entriesOpen && giveaway.status === "pending" && (
                <span className="shrink-0 px-3 py-2 rounded-xl text-xs bg-zinc-800/60 text-zinc-500 border border-zinc-700/40">
                  🔒 Closed
                </span>
              )}
            </div>
          </section>
        )}

        {/* ── Login prompt ── */}
        {!authLoading && !isLoggedIn && (
          <div className="rounded-2xl border border-zinc-700/40 bg-zinc-900/60 p-8 text-center space-y-5">
            <div className="text-6xl">{tc.emoji}</div>
            <div>
              <h2 className="text-2xl font-bold text-white">{tc.subline}</h2>
              <p className="text-zinc-400 mt-2 text-sm max-w-xs mx-auto leading-relaxed">
                Log in with Twitch to roll loot, enter giveaways, earn coins, and climb the leaderboard in #{channel}.
              </p>
            </div>
            <button
              onClick={handleLogin}
              className="inline-flex items-center gap-2 px-7 py-3 rounded-full font-bold text-base transition-all hover:opacity-90 active:scale-95 shadow-xl"
              style={{ background: "#9147ff", color: "#fff" }}
            >
              <TwitchLogo className="w-5 h-5" /> Login with Twitch
            </button>
            <p className="text-[10px] text-zinc-600">Leaderboard and giveaway info are always public below ↓</p>
          </div>
        )}

        {/* ── Personal card (logged in) ── */}
        {isLoggedIn && (
          <section className={`rounded-2xl border ${tc.cardBorder} ${tc.cardBg} p-4 sm:p-5 space-y-4`}>

            {/* Stats row */}
            {me ? (
              <div className="flex flex-wrap gap-2">
                <div className={`flex flex-col items-center px-4 py-3 rounded-xl border ${tc.statBg} ${tc.statBorder} min-w-[76px] flex-1`}>
                  <span className="text-xl font-bold text-white tabular-nums leading-none">
                    {balance.toLocaleString()}
                    <span className="text-base ml-0.5">🪙</span>
                  </span>
                  <span className="text-[9px] text-zinc-500 mt-1 uppercase tracking-widest font-bold">Coins</span>
                </div>
                {cap != null && (
                  <div className={`flex flex-col items-center px-4 py-3 rounded-xl border ${tc.statBg} ${tc.statBorder} min-w-[76px]`}>
                    <span className="text-xl font-bold text-amber-300 tabular-nums leading-none">{cap.toLocaleString()}</span>
                    <span className="text-[9px] text-zinc-500 mt-1 uppercase tracking-widest font-bold">Cap</span>
                  </div>
                )}
                <div className={`flex flex-col items-center px-4 py-3 rounded-xl border ${tc.statBg} ${tc.statBorder} min-w-[76px]`}>
                  <span className="text-xl font-bold text-white leading-none">
                    {inventory.length}<span className="text-sm text-zinc-600">/5</span>
                  </span>
                  <span className="text-[9px] text-zinc-500 mt-1 uppercase tracking-widest font-bold">Items</span>
                </div>
                {me.rank != null && (
                  <div className={`flex flex-col items-center px-4 py-3 rounded-xl border ${tc.statBg} ${tc.statBorder} min-w-[76px]`}>
                    <span className={`text-xl font-bold tabular-nums leading-none ${tc.rankColor}`}>#{me.rank}</span>
                    <span className="text-[9px] text-zinc-500 mt-1 uppercase tracking-widest font-bold">Rank</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="flex gap-2">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-[68px] flex-1 rounded-xl bg-zinc-800/60 animate-pulse" />
                ))}
              </div>
            )}

            {/* Action buttons grid */}
            <div className="grid grid-cols-3 gap-2">
              {/* Roll Loot */}
              <button
                onClick={() => lootMutation.mutate()}
                disabled={lootCooldown.onCooldown || lootMutation.isPending}
                className={`flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl font-semibold text-xs transition-all border disabled:opacity-40 ${tc.primaryBtnBase} active:scale-95`}
              >
                <span className="text-2xl">{lootMutation.isPending ? "⏳" : tc.lootEmoji}</span>
                <span className="text-center leading-snug">
                  {lootCooldown.onCooldown
                    ? `${lootCooldown.remaining}s`
                    : lootMutation.isPending
                      ? "Rolling…"
                      : tc.lootLabel}
                </span>
                <span className="text-[9px] text-zinc-600 font-normal">!loot</span>
              </button>

              {/* Enter Giveaway */}
              <button
                onClick={() => enterMutation.mutate()}
                disabled={!giveaway || !entriesOpen || enterMutation.isPending || hasEntered}
                className="flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl font-semibold text-xs transition-all border disabled:opacity-40 bg-amber-500/10 border-amber-500/30 text-amber-400 hover:bg-amber-500/20 hover:border-amber-500/60 active:scale-95"
              >
                <span className="text-2xl">{hasEntered ? "✅" : "🏆"}</span>
                <span className="text-center leading-snug">
                  {!giveaway
                    ? "No Giveaway"
                    : !entriesOpen
                      ? "Entries Closed"
                      : hasEntered
                        ? "Entered!"
                        : enterMutation.isPending
                          ? "Entering…"
                          : "Enter Giveaway"}
                </span>
                <span className="text-[9px] text-zinc-600 font-normal">!enter</span>
              </button>

              {/* Redeem */}
              <button
                onClick={() => redeemMutation.mutate()}
                disabled={!canRedeem || redeemMutation.isPending}
                className="flex flex-col items-center gap-1.5 px-2 py-4 rounded-xl font-semibold text-xs transition-all border disabled:opacity-40 bg-blue-500/10 border-blue-500/30 text-blue-400 hover:bg-blue-500/20 hover:border-blue-500/60 active:scale-95"
              >
                <span className="text-2xl">{redeemEmoji}</span>
                <span className="text-center leading-snug">
                  {redeemMutation.isPending ? "Redeeming…" : redeemLabel}
                </span>
                <span className="text-[9px] text-zinc-600 font-normal">{REDEEM_COST}🪙 · !redeem</span>
              </button>
            </div>

            {/* Ticket count picker (entries mode only) */}
            {redeemAction === "entries" && giveaway && entriesOpen && maxRedeemEntries > 1 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-950/20 border border-blue-500/15 text-xs">
                <span className="text-blue-300 font-medium flex-1">Tickets to redeem:</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRedeemEntries((n) => Math.max(1, n - 1))}
                    className="w-6 h-6 rounded bg-zinc-700 hover:bg-zinc-600 font-bold flex items-center justify-center"
                  >−</button>
                  <span className="tabular-nums font-bold text-blue-200 w-6 text-center">{redeemEntries}</span>
                  <button
                    onClick={() => setRedeemEntries((n) => Math.min(maxRedeemEntries, n + 1))}
                    className="w-6 h-6 rounded bg-zinc-700 hover:bg-zinc-600 font-bold flex items-center justify-center"
                  >+</button>
                </div>
                <span className="text-zinc-400 tabular-nums">{redeemEntries * REDEEM_COST}🪙</span>
              </div>
            )}

            {/* CS2 Trade URL panel */}
            {tc.hasTradeUrl && !tradeUrlSaved && (
              <div className="rounded-xl border border-blue-500/20 bg-blue-950/10 p-4 space-y-2.5">
                <div className="flex items-center gap-2">
                  <span>🔗</span>
                  <span className="text-sm font-semibold text-blue-300">Steam Trade URL</span>
                  <span className="text-xs text-zinc-500 ml-1">— needed if you win a skin</span>
                </div>
                <div className="flex gap-2">
                  <input
                    value={tradeUrlDraft}
                    onChange={(e) => setTradeUrlDraft(e.target.value)}
                    placeholder="https://steamcommunity.com/tradeoffer/new/…"
                    className="flex-1 text-xs rounded-lg px-3 py-2 bg-zinc-800/80 border border-zinc-700/50 text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-blue-500/50 min-w-0"
                  />
                  <button
                    onClick={() => tradeUrlMutation.mutate(tradeUrlDraft)}
                    disabled={!tradeUrlDraft.includes("steamcommunity.com/tradeoffer/new/") || tradeUrlMutation.isPending}
                    className="px-3 py-2 rounded-lg text-xs font-bold bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-40 transition-colors shrink-0"
                  >
                    {tradeUrlMutation.isPending ? "…" : "Save"}
                  </button>
                </div>
              </div>
            )}
            {tc.hasTradeUrl && tradeUrlSaved && (
              <div className="rounded-xl border border-green-500/20 bg-green-950/10 px-4 py-3 text-xs text-green-400 flex items-center gap-2">
                ✅ Trade URL saved — the streamer will send your skin soon!
              </div>
            )}

            {/* Last loot result flash */}
            {lastLoot && (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${rarityStyle(lastLoot.rarity).border} ${rarityStyle(lastLoot.rarity).bg}`}>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${rarityStyle(lastLoot.rarity).dot}`} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`font-semibold text-sm ${rarityStyle(lastLoot.rarity).label}`}>{lastLoot.item}</span>
                    {lastLoot.type === "coins" && (
                      <span className="text-amber-400 text-xs">→ {lastLoot.coins}🪙</span>
                    )}
                  </div>
                  <p className="text-xs text-zinc-500 mt-0.5 truncate">{lastLoot.flavor}</p>
                </div>
                <span className={`text-[9px] px-2 py-0.5 rounded-full font-bold shrink-0 ${rarityStyle(lastLoot.rarity).badge}`}>
                  {lastLoot.rarity}
                </span>
              </div>
            )}
          </section>
        )}

        {/* ── Inventory ── */}
        {isLoggedIn && (
          <section>
            <SectionLabel aside="!use · !sell">🎒 My Inventory</SectionLabel>
            <div className="grid grid-cols-5 gap-2">
              {slots.map((item, i) => (
                <InventorySlot
                  key={item?.id ?? `empty-${i}`}
                  item={item}
                  tc={tc}
                  onSell={item && item.kind !== "buff" ? () => { setSellingId(item.id); sellMutation.mutate(item.id); } : undefined}
                  selling={item ? sellingId === item.id : false}
                  onUse={item && item.kind === "buff" ? () => { setUsingId(item.id); useItemMutation.mutate(item.id); } : undefined}
                  using={item ? usingId === item.id : false}
                />
              ))}
            </div>
          </section>
        )}

        {/* ── Leaderboard ── */}
        <section>
          <SectionLabel aside={isLoggedIn ? (tc.stealable ? "!gift · !steal" : "!gift") : undefined}>
            🏆 Leaderboard
          </SectionLabel>

          {statusLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-12 rounded-xl bg-zinc-800/60 animate-pulse" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-6 text-center text-zinc-500 text-sm">
              No coin holders yet — be the first to roll!
            </div>
          ) : (
            <div className={`rounded-2xl border ${tc.cardBorder} ${tc.cardBg} overflow-hidden`}>
              {leaderboard.map((entry, i) => {
                const isMe = entry.username === viewerName;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                const isGiftOpen = giftTarget === entry.username;

                return (
                  <div key={entry.username}>
                    {/* Leaderboard row */}
                    <div
                      className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-800/40 last:border-0 ${
                        isMe ? `${tc.leaderRowHighlight} border-l-2 ${tc.leaderBorderAccent}` : ""
                      }`}
                    >
                      <span className="w-5 text-sm text-zinc-500 font-mono text-center shrink-0">
                        {medal ?? `${i + 1}`}
                      </span>
                      <span className={`flex-1 text-sm font-medium truncate ${isMe ? tc.rankColor : "text-zinc-200"}`}>
                        {entry.username}{isMe ? " (you)" : ""}
                      </span>
                      <span className="text-sm font-bold text-amber-400 tabular-nums shrink-0">
                        {entry.balance.toLocaleString()}🪙
                      </span>
                      {isLoggedIn && !isMe && (
                        <div className="flex items-center gap-1 shrink-0 ml-1">
                          <button
                            onClick={() => {
                              setGiftTarget(isGiftOpen ? null : entry.username);
                              if (!isGiftOpen) setGiftAmount("100");
                            }}
                            className={`text-xs px-2 py-1 rounded-lg font-medium transition-colors ${
                              isGiftOpen
                                ? "bg-green-800/50 text-green-200 border border-green-500/40"
                                : "bg-zinc-700/40 hover:bg-zinc-600/60 text-zinc-500 hover:text-zinc-200"
                            }`}
                            title={`Gift coins to @${entry.username}`}
                          >
                            🎁
                          </button>
                          {tc.stealable && (
                            <button
                              onClick={() => {
                                setStealingTarget(entry.username);
                                stealMutation.mutate(entry.username);
                              }}
                              disabled={stealMutation.isPending && stealingTarget === entry.username}
                              className="text-xs px-2 py-1 rounded-lg font-medium bg-zinc-700/40 hover:bg-amber-900/50 text-zinc-500 hover:text-amber-300 transition-colors disabled:opacity-50"
                              title={`Steal coins from @${entry.username} (55% success, 3-min cooldown)`}
                            >
                              {stealMutation.isPending && stealingTarget === entry.username ? "…" : "👺"}
                            </button>
                          )}
                        </div>
                      )}
                    </div>

                    {/* Gift inline panel */}
                    {isGiftOpen && (
                      <div className="px-4 py-3.5 bg-green-950/20 border-b border-zinc-800/40 border-l-2 border-l-green-600/40 space-y-2.5">
                        <p className="text-xs font-semibold text-green-400">🎁 Gift coins to @{entry.username}</p>
                        <div className="flex gap-1.5 flex-wrap">
                          {[50, 100, 250, 500].map((amt) => (
                            <button
                              key={amt}
                              onClick={() => setGiftAmount(String(amt))}
                              className={`text-xs px-2.5 py-1 rounded-lg border transition-colors ${
                                giftAmount === String(amt)
                                  ? "bg-green-700/50 border-green-500/50 text-green-200"
                                  : "bg-zinc-800/50 border-zinc-700/40 text-zinc-400 hover:border-zinc-500/60 hover:text-zinc-200"
                              }`}
                            >
                              {amt}🪙
                            </button>
                          ))}
                          <input
                            type="number"
                            min="1"
                            value={giftAmount}
                            onChange={(e) => setGiftAmount(e.target.value)}
                            className="text-xs w-20 rounded-lg px-2 py-1 bg-zinc-800/80 border border-zinc-700/50 text-zinc-200 focus:outline-none focus:border-green-500/50"
                            placeholder="custom"
                          />
                        </div>
                        <div className="flex gap-2 items-center">
                          <button
                            onClick={() => {
                              const amt = parseInt(giftAmount, 10);
                              if (amt > 0) giftMutation.mutate({ target: entry.username, amount: amt });
                            }}
                            disabled={
                              !giftAmount ||
                              parseInt(giftAmount, 10) <= 0 ||
                              parseInt(giftAmount, 10) > balance ||
                              giftMutation.isPending
                            }
                            className="text-xs px-4 py-1.5 rounded-lg font-bold bg-green-700 hover:bg-green-600 text-white disabled:opacity-40 transition-colors"
                          >
                            {giftMutation.isPending ? "Sending…" : `Send ${giftAmount}🪙`}
                          </button>
                          <button
                            onClick={() => setGiftTarget(null)}
                            className="text-xs px-3 py-1.5 rounded-lg bg-zinc-700/50 text-zinc-400 hover:text-zinc-200 transition-colors"
                          >
                            Cancel
                          </button>
                          {parseInt(giftAmount, 10) > balance && (
                            <span className="text-xs text-red-400">Not enough coins</span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Live Chat ── */}
        <section>
          <SectionLabel aside="synced with Twitch">
            <span className="flex items-center gap-2"><LiveDot color="green" /> Live Chat</span>
          </SectionLabel>
          <div
            ref={chatContainerRef}
            className={`h-64 overflow-y-auto rounded-2xl border ${tc.cardBorder} ${tc.cardBg} px-3 py-2.5 space-y-1.5 scroll-smooth`}
          >
            {chatMessages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-zinc-600 text-sm text-center">
                  No chat activity yet.<br />
                  <span className="text-zinc-700 text-xs">Messages appear as viewers interact.</span>
                </p>
              </div>
            ) : (
              chatMessages.map((msg, i) => (
                <ChatBubble key={i} msg={msg} viewerName={viewerName} tc={tc} />
              ))
            )}
            <div ref={chatEndRef} />
          </div>
        </section>

        {/* ── Footer ── */}
        <footer className={`text-center text-xs ${tc.footerText} pb-4`}>
          {tc.emoji} Powered by{" "}
          <a href="/" className="hover:text-zinc-400 transition-colors underline underline-offset-2">
            Goblin L00t
          </a>
        </footer>

      </main>
    </div>
  );
}

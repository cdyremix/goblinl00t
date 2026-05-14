/**
 * Viewer Portal — /viewer/:channel
 *
 * Standalone public page (no Layout, no Clerk) where Twitch viewers can:
 *  - Log in with their Twitch account
 *  - See their coin balance, rank, and inventory
 *  - Roll loot, enter giveaways, sell items, and redeem coins
 *  - Browse the channel leaderboard
 */
import { useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState, useEffect, useCallback } from "react";
import { useToast } from "@/hooks/use-toast";

// ── Rarity colours (shared with overlay) ───────────────────────────────────
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

// ── Types ──────────────────────────────────────────────────────────────────

interface AuthMe {
  loggedIn: boolean;
  username?: string;
  channel?: string;
}

interface LeaderEntry { username: string; balance: number }

interface Giveaway {
  id: number;
  title: string;
  prize: string;
  status: string;
  prizeIconUrl?: string | null;
}

interface StatusData {
  giveaway: Giveaway | null;
  entryCount: number;
  leaderboard: LeaderEntry[];
}

interface InventoryItem {
  id: number;
  item: string;
  rarity: string;
  kind: string;
  buffEffect?: string | null;
  coinValue: number;
  chargesRemaining: number;
  isActive: boolean;
}

interface MeData {
  username: string;
  balance: { balance: number; cap: number | null };
  inventory: InventoryItem[];
  rank: number | null;
}

interface LootResult {
  type: "item" | "coins";
  item: string;
  rarity: string;
  slot?: number;
  coins?: number;
  flavor: string;
}

// ── API helpers ─────────────────────────────────────────────────────────────

async function apiFetch(url: string, init?: RequestInit) {
  const res = await fetch(url, { credentials: "include", ...init });
  if (!res.ok) {
    const body = await res.json().catch(() => ({})) as { error?: string };
    throw new Error(body.error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ── Cooldown hook ───────────────────────────────────────────────────────────

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

// ── Components ──────────────────────────────────────────────────────────────

function StatPill({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center px-5 py-3 rounded-xl bg-zinc-800/60 border border-zinc-700/50 min-w-[90px]">
      <span className="text-xl font-bold text-white tabular-nums">{value}</span>
      <span className="text-xs text-zinc-400 mt-0.5">{label}</span>
    </div>
  );
}

function InventorySlot({ item, onSell, selling }: {
  item: InventoryItem | null;
  onSell?: () => void;
  selling?: boolean;
}) {
  if (!item) {
    return (
      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-zinc-700/50 bg-zinc-900/30 aspect-square p-3 min-h-[90px]">
        <span className="text-2xl opacity-20">📦</span>
        <span className="text-xs text-zinc-600 mt-1">Empty</span>
      </div>
    );
  }
  const s = rarityStyle(item.rarity);
  return (
    <div className={`flex flex-col rounded-xl border ${s.border} ${s.bg} p-3 min-h-[90px] gap-1.5 relative`}>
      <div className="flex items-center gap-1.5">
        <span className={`w-2 h-2 rounded-full shrink-0 ${s.dot}`} />
        <span className={`text-xs font-semibold uppercase tracking-wide ${s.label}`}>{item.rarity}</span>
        {item.kind === "buff" && (
          <span className="ml-auto text-xs bg-zinc-700/60 text-zinc-300 rounded px-1.5 py-0.5">Buff</span>
        )}
      </div>
      <span className="text-sm font-medium text-white leading-tight flex-1">{item.item}</span>
      {item.kind === "buff" && item.chargesRemaining > 0 && (
        <span className="text-xs text-zinc-400">{item.chargesRemaining} charge{item.chargesRemaining !== 1 ? "s" : ""}</span>
      )}
      {item.coinValue > 0 && item.kind !== "buff" && (
        <span className="text-xs text-amber-400">{item.coinValue} 🪙</span>
      )}
      {onSell && item.kind !== "buff" && (
        <button
          onClick={onSell}
          disabled={selling}
          className="mt-1 text-xs rounded-lg px-2 py-1 bg-zinc-700/60 hover:bg-zinc-600/60 text-zinc-300 hover:text-white transition-colors disabled:opacity-50"
        >
          {selling ? "Selling…" : `Sell (${item.coinValue}🪙)`}
        </button>
      )}
    </div>
  );
}

// ── Main page ───────────────────────────────────────────────────────────────

export function ViewerPortal() {
  const params = useParams<{ channel: string }>();
  const channel = (params.channel ?? "").toLowerCase();
  const { toast } = useToast();
  const qc = useQueryClient();

  // ── Session check ──
  const { data: auth, isLoading: authLoading } = useQuery<AuthMe>({
    queryKey: ["viewer-auth-me"],
    queryFn: () => apiFetch("/api/viewer/auth/me"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
  });

  const isLoggedIn = auth?.loggedIn === true && auth.channel === channel;
  const viewerName = auth?.username ?? null;

  // ── Public status ──
  const { data: status, isLoading: statusLoading, refetch: refetchStatus } = useQuery<StatusData>({
    queryKey: ["viewer-status", channel],
    queryFn: () => apiFetch(`/api/viewer/${channel}/status`),
    refetchInterval: 15_000,
    staleTime: 10_000,
  });

  // ── Personal data ──
  const { data: me, refetch: refetchMe } = useQuery<MeData>({
    queryKey: ["viewer-me", channel],
    queryFn: () => apiFetch(`/api/viewer/${channel}/me`),
    enabled: isLoggedIn,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const refetchAll = useCallback(() => {
    void refetchStatus();
    if (isLoggedIn) void refetchMe();
  }, [refetchStatus, refetchMe, isLoggedIn]);

  // ── Loot cooldown ──
  const lootCooldown = useCooldown(30);
  const [lastLoot, setLastLoot] = useState<LootResult | null>(null);

  // ── Entry tracking ──
  const [hasEntered, setHasEntered] = useState(false);
  useEffect(() => { setHasEntered(false); }, [status?.giveaway?.id]);

  // ── Redeem UI ──
  const [redeemEntries, setRedeemEntries] = useState(1);

  // ── Selling state ──
  const [sellingId, setSellingId] = useState<number | null>(null);

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
          ? `🎲 Found: ${data.item}!`
          : `🎲 Pouch full — earned ${data.coins}🪙`,
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
    mutationFn: () =>
      apiFetch(`/api/viewer/${channel}/redeem`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ entries: redeemEntries }),
      }),
    onSuccess: (data: { ticketsAdded: number; pointsSpent: number; balanceAfter: number }) => {
      void refetchAll();
      toast({
        title: `🎟️ Redeemed ${data.ticketsAdded} ticket${data.ticketsAdded !== 1 ? "s" : ""}!`,
        description: `Spent ${data.pointsSpent}🪙 — balance: ${data.balanceAfter}🪙`,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Redeem failed", description: err.message, variant: "destructive" });
    },
  });

  const sellMutation = useMutation({
    mutationFn: (itemId: number) =>
      apiFetch(`/api/viewer/${channel}/sell`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId }),
      }),
    onSuccess: (data: { coinsEarned: number; item: { item: string } }) => {
      setSellingId(null);
      void refetchAll();
      toast({ title: `💰 Sold for ${data.coinsEarned}🪙`, description: data.item?.item });
    },
    onError: (err: Error) => {
      setSellingId(null);
      toast({ title: "Sell failed", description: err.message, variant: "destructive" });
    },
  });

  function handleSell(item: InventoryItem) {
    setSellingId(item.id);
    sellMutation.mutate(item.id);
  }

  function handleLogin() {
    window.location.href = `/api/viewer/auth/init?channel=${encodeURIComponent(channel)}`;
  }

  async function handleLogout() {
    await fetch("/api/viewer/auth/logout", { method: "POST", credentials: "include" });
    await qc.invalidateQueries({ queryKey: ["viewer-auth-me"] });
    await qc.invalidateQueries({ queryKey: ["viewer-me", channel] });
  }

  const balance = me?.balance.balance ?? 0;
  const cap = me?.balance.cap;
  const inventory = me?.inventory ?? [];
  const slots = Array.from({ length: 5 }, (_, i) => inventory[i] ?? null);
  const leaderboard = status?.leaderboard ?? [];
  const giveaway = status?.giveaway ?? null;
  const REDEEM_COST = 100;
  const maxRedeemEntries = Math.floor(balance / REDEEM_COST);

  return (
    <div
      className="min-h-screen bg-zinc-950 text-white"
      style={{ fontFamily: "'Bricolage Grotesque', sans-serif" }}
    >
      {/* ── Header ── */}
      <header className="sticky top-0 z-20 border-b border-zinc-800/80 bg-zinc-950/90 backdrop-blur-sm">
        <div className="max-w-2xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xl">🧌</span>
            <span className="font-bold text-white truncate">Goblin L00t</span>
            <span className="text-zinc-500 hidden sm:inline">·</span>
            <span className="text-zinc-400 text-sm truncate hidden sm:inline">#{channel}</span>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {authLoading ? (
              <div className="h-8 w-24 rounded-full bg-zinc-800 animate-pulse" />
            ) : isLoggedIn ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-zinc-300 font-medium hidden sm:inline">@{viewerName}</span>
                <button
                  onClick={handleLogout}
                  className="text-xs px-3 py-1.5 rounded-full bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                >
                  Log out
                </button>
              </div>
            ) : (
              <button
                onClick={handleLogin}
                className="flex items-center gap-2 px-4 py-2 rounded-full font-semibold text-sm transition-all hover:opacity-90 active:scale-95"
                style={{ background: "#9147ff", color: "#fff" }}
              >
                <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
                </svg>
                Login with Twitch
              </button>
            )}
          </div>
        </div>
        {/* Mobile channel label */}
        <div className="sm:hidden px-4 pb-2 text-xs text-zinc-500">#{channel}</div>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">

        {/* ── Login prompt (not logged in) ── */}
        {!authLoading && !isLoggedIn && (
          <div className="rounded-2xl border border-zinc-700/50 bg-zinc-900/60 p-6 text-center space-y-4">
            <div className="text-4xl">🧌</div>
            <div>
              <h2 className="text-xl font-bold text-white">Join the Horde!</h2>
              <p className="text-zinc-400 mt-1 text-sm">
                Log in with your Twitch account to roll loot, enter giveaways, and track your coins.
              </p>
            </div>
            <button
              onClick={handleLogin}
              className="inline-flex items-center gap-2 px-6 py-3 rounded-full font-bold text-base transition-all hover:opacity-90 active:scale-95 shadow-lg"
              style={{ background: "#9147ff", color: "#fff" }}
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24" fill="currentColor">
                <path d="M11.571 4.714h1.715v5.143H11.57zm4.715 0H18v5.143h-1.714zM6 0L1.714 4.286v15.428h5.143V24l4.286-4.286h3.428L22.286 12V0zm14.571 11.143l-3.428 3.428h-3.429l-3 3v-3H6.857V1.714h13.714z"/>
              </svg>
              Login with Twitch
            </button>
          </div>
        )}

        {/* ── Personal stats + actions (logged in) ── */}
        {isLoggedIn && (
          <section className="space-y-4">
            {/* Stats row */}
            {me ? (
              <div className="flex flex-wrap gap-3 justify-center sm:justify-start">
                <StatPill
                  label="Coins"
                  value={
                    <span className="flex items-center gap-1">
                      {balance.toLocaleString()}
                      <span className="text-base">🪙</span>
                    </span>
                  }
                />
                {cap && (
                  <StatPill label="Cap" value={<span className="text-amber-300">{cap.toLocaleString()}🪙</span>} />
                )}
                <StatPill label="Inventory" value={`${inventory.length}/5`} />
                {me.rank && (
                  <StatPill label="Rank" value={<span className="text-primary">#{me.rank}</span>} />
                )}
              </div>
            ) : (
              <div className="flex gap-3">
                {[1, 2, 3].map((i) => (
                  <div key={i} className="h-16 w-24 rounded-xl bg-zinc-800 animate-pulse" />
                ))}
              </div>
            )}

            {/* Action buttons */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {/* Roll Loot */}
              <button
                onClick={() => lootMutation.mutate()}
                disabled={lootCooldown.onCooldown || lootMutation.isPending}
                className="flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl font-semibold text-sm transition-all border disabled:opacity-50 bg-primary/10 hover:bg-primary/20 border-primary/30 text-primary hover:border-primary/60 active:scale-95"
              >
                <span className="text-2xl">{lootMutation.isPending ? "⏳" : "🎲"}</span>
                {lootCooldown.onCooldown
                  ? `Cooldown ${lootCooldown.remaining}s`
                  : lootMutation.isPending
                    ? "Rolling…"
                    : "Roll Loot"}
              </button>

              {/* Enter Giveaway */}
              <button
                onClick={() => enterMutation.mutate()}
                disabled={!giveaway || enterMutation.isPending || hasEntered}
                className="flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl font-semibold text-sm transition-all border disabled:opacity-50 bg-amber-500/10 hover:bg-amber-500/20 border-amber-500/30 text-amber-400 hover:border-amber-500/60 active:scale-95"
              >
                <span className="text-2xl">{hasEntered ? "✅" : "🏆"}</span>
                {!giveaway
                  ? "No Giveaway"
                  : hasEntered
                    ? "Entered!"
                    : enterMutation.isPending
                      ? "Entering…"
                      : "Enter Giveaway"}
              </button>

              {/* Redeem coins */}
              <button
                onClick={() => redeemMutation.mutate()}
                disabled={!giveaway || maxRedeemEntries < 1 || redeemMutation.isPending}
                className="flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl font-semibold text-sm transition-all border disabled:opacity-50 bg-blue-500/10 hover:bg-blue-500/20 border-blue-500/30 text-blue-400 hover:border-blue-500/60 active:scale-95"
              >
                <span className="text-2xl">🎟️</span>
                {redeemMutation.isPending ? "Redeeming…" : `Redeem ${REDEEM_COST}🪙`}
              </button>

              {/* Sell all / sell item (shows slot count) */}
              <div className="flex flex-col items-center gap-1.5 px-3 py-4 rounded-xl text-sm border border-zinc-700/40 bg-zinc-800/30 text-zinc-400">
                <span className="text-2xl">🎒</span>
                <span className="font-semibold">{inventory.length}/5 items</span>
                <span className="text-xs text-zinc-500">Sell below ↓</span>
              </div>
            </div>

            {/* Redeem entry count picker */}
            {giveaway && maxRedeemEntries > 1 && (
              <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-blue-950/20 border border-blue-500/20 text-sm">
                <span className="text-blue-300 font-medium flex-1">Redeem how many tickets?</span>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => setRedeemEntries((n) => Math.max(1, n - 1))}
                    className="w-7 h-7 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-bold text-white flex items-center justify-center"
                  >−</button>
                  <span className="tabular-nums font-bold text-blue-200 w-8 text-center">{redeemEntries}</span>
                  <button
                    onClick={() => setRedeemEntries((n) => Math.min(maxRedeemEntries, n + 1))}
                    className="w-7 h-7 rounded-lg bg-zinc-700 hover:bg-zinc-600 font-bold text-white flex items-center justify-center"
                  >+</button>
                </div>
                <span className="text-zinc-400">{redeemEntries * REDEEM_COST}🪙</span>
              </div>
            )}

            {/* Last loot result */}
            {lastLoot && (
              <div className={`flex items-center gap-3 px-4 py-3 rounded-xl border ${rarityStyle(lastLoot.rarity).border} ${rarityStyle(lastLoot.rarity).bg}`}>
                <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${rarityStyle(lastLoot.rarity).dot}`} />
                <div className="flex-1 min-w-0">
                  <span className={`font-semibold text-sm ${rarityStyle(lastLoot.rarity).label}`}>{lastLoot.item}</span>
                  {lastLoot.type === "coins" && (
                    <span className="text-amber-400 text-sm ml-2">→ {lastLoot.coins}🪙</span>
                  )}
                  <p className="text-xs text-zinc-400 truncate">{lastLoot.flavor}</p>
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ${rarityStyle(lastLoot.rarity).badge}`}>
                  {lastLoot.rarity}
                </span>
              </div>
            )}

            {/* Inventory */}
            <div>
              <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">My Inventory</h3>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {slots.map((item, i) => (
                  <InventorySlot
                    key={item?.id ?? `empty-${i}`}
                    item={item}
                    onSell={item ? () => handleSell(item) : undefined}
                    selling={item ? sellingId === item.id : false}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        {/* ── Active Giveaway ── */}
        <section>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Active Giveaway
          </h3>
          {statusLoading ? (
            <div className="h-24 rounded-2xl bg-zinc-800 animate-pulse" />
          ) : giveaway ? (
            <div className="rounded-2xl border border-amber-500/30 bg-amber-950/20 p-5 flex items-start gap-4">
              {giveaway.prizeIconUrl && (
                <img src={giveaway.prizeIconUrl} alt="" className="w-12 h-12 rounded-lg object-cover shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="flex items-center gap-1 text-xs font-bold text-red-400">
                    <span className="relative flex h-2 w-2">
                      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                      <span className="relative inline-flex h-2 w-2 rounded-full bg-red-400" />
                    </span>
                    LIVE
                  </span>
                  <span className="font-bold text-white truncate">{giveaway.title}</span>
                </div>
                <p className="text-sm text-amber-200 mt-0.5 truncate">🏆 {giveaway.prize}</p>
                <p className="text-xs text-zinc-400 mt-1">{status?.entryCount ?? 0} entrants</p>
              </div>
              {isLoggedIn && !hasEntered && (
                <button
                  onClick={() => enterMutation.mutate()}
                  disabled={enterMutation.isPending}
                  className="shrink-0 px-4 py-2 rounded-xl font-bold text-sm bg-amber-500 hover:bg-amber-400 text-black transition-colors active:scale-95 disabled:opacity-50"
                >
                  {enterMutation.isPending ? "…" : "Enter!"}
                </button>
              )}
              {hasEntered && (
                <span className="shrink-0 px-3 py-2 rounded-xl text-xs font-bold bg-green-900/40 text-green-400 border border-green-500/30">
                  ✅ Entered
                </span>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-5 text-center text-zinc-500 text-sm">
              No active giveaway right now.
            </div>
          )}
        </section>

        {/* ── Leaderboard ── */}
        <section>
          <h3 className="text-sm font-semibold text-zinc-400 uppercase tracking-wider mb-3">
            Leaderboard
          </h3>
          {statusLoading ? (
            <div className="space-y-2">
              {[1, 2, 3].map((i) => (
                <div key={i} className="h-10 rounded-xl bg-zinc-800 animate-pulse" />
              ))}
            </div>
          ) : leaderboard.length === 0 ? (
            <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/40 p-5 text-center text-zinc-500 text-sm">
              No coin holders yet — be the first to roll!
            </div>
          ) : (
            <div className="rounded-2xl border border-zinc-700/30 bg-zinc-900/20 overflow-hidden">
              {leaderboard.map((entry, i) => {
                const isMe = entry.username === viewerName;
                const medal = i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : null;
                return (
                  <div
                    key={entry.username}
                    className={`flex items-center gap-3 px-4 py-3 border-b border-zinc-800/50 last:border-0 ${
                      isMe ? "bg-primary/5 border-l-2 border-l-primary" : ""
                    }`}
                  >
                    <span className="w-6 text-sm text-zinc-500 font-mono text-center">
                      {medal ?? `${i + 1}`}
                    </span>
                    <span className={`flex-1 text-sm font-medium truncate ${isMe ? "text-primary" : "text-zinc-200"}`}>
                      {isMe ? `${entry.username} (you)` : entry.username}
                    </span>
                    <span className="text-sm font-bold text-amber-400 tabular-nums">
                      {entry.balance.toLocaleString()}🪙
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        {/* ── Footer ── */}
        <footer className="text-center text-xs text-zinc-600 pb-4">
          Powered by Goblin L00t 🧌 · <a href="/" className="hover:text-zinc-400 transition-colors">goblinl00t.com</a>
        </footer>
      </main>
    </div>
  );
}

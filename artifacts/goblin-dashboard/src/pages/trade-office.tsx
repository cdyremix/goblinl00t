import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Package, ExternalLink, CheckCircle2, Clock, Send, Ban, ChevronDown,
  AlertCircle, Copy, Check, Edit3, Save, X, Search, Boxes
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Hint } from "@/components/hint";
import { SteamItemCard, type SteamItem } from "@/components/steam-item-card";
import { FeatureLock } from "@/hooks/use-tier";

type TradeStatus = "pending" | "trade_locked" | "sent" | "skipped";

interface TradeFulfillment {
  id: number;
  giveawayId: number;
  winnerTwitchUsername: string;
  prize: string;
  steamTradeUrl: string | null;
  status: TradeStatus;
  tradeLockUntil: string | null;
  streamerNotes: string | null;
  createdAt: string;
}

interface SteamInventory {
  items: SteamItem[];
  totalCount: number;
}

interface BotSettings {
  botTheme: "goblin" | "cs2";
  botName: string;
  steamTradeUrl: string | null;
  steamId64: string | null;
  steamUsername: string | null;
}

const STATUS_CONFIG: Record<TradeStatus, { label: string; color: string; icon: React.ElementType }> = {
  pending: { label: "Pending", color: "text-amber-400 bg-amber-400/10 border-amber-400/30", icon: Clock },
  trade_locked: { label: "Trade Locked", color: "text-blue-400 bg-blue-400/10 border-blue-400/30", icon: AlertCircle },
  sent: { label: "Sent", color: "text-green-400 bg-green-400/10 border-green-400/30", icon: CheckCircle2 },
  skipped: { label: "Skipped", color: "text-muted-foreground bg-muted/30 border-border", icon: Ban },
};

function useTrades() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<TradeFulfillment[]>({
    queryKey: ["trade-fulfillments"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/trade-fulfillments", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load");
      return res.json() as Promise<TradeFulfillment[]>;
    },
  });

  const update = useMutation<TradeFulfillment, Error, { id: number } & Partial<TradeFulfillment>>({
    mutationFn: async ({ id, ...data }) => {
      const token = await getToken();
      const res = await fetch(`/api/trade-fulfillments/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to update");
      return res.json() as Promise<TradeFulfillment>;
    },
    onSuccess: (updated) => {
      qc.setQueryData<TradeFulfillment[]>(["trade-fulfillments"], (old) =>
        old?.map((t) => (t.id === updated.id ? updated : t)) ?? [updated]
      );
    },
  });

  return { query, update };
}

function useSteamInventory(enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery<SteamInventory>({
    queryKey: ["steam-inventory"],
    enabled,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/steam/inventory", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error ?? "Failed to fetch inventory");
      }
      return res.json() as Promise<SteamInventory>;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function useSettings() {
  const { getToken } = useAuth();
  return useQuery<BotSettings>({
    queryKey: ["bot-settings"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json() as Promise<BotSettings>;
    },
  });
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async (e) => {
        e.stopPropagation();
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="p-1 rounded text-muted-foreground hover:text-foreground transition-colors"
      title="Copy to clipboard"
    >
      {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  );
}

function TradeRow({ trade }: { trade: TradeFulfillment }) {
  const { update } = useTrades();
  const [expanded, setExpanded] = useState(false);
  const [editingUrl, setEditingUrl] = useState(false);
  const [urlDraft, setUrlDraft] = useState(trade.steamTradeUrl ?? "");
  const [notesDraft, setNotesDraft] = useState(trade.streamerNotes ?? "");
  const [lockDate, setLockDate] = useState(
    trade.tradeLockUntil ? trade.tradeLockUntil.split("T")[0]! : ""
  );

  const cfg = STATUS_CONFIG[trade.status];
  const StatusIcon = cfg.icon;

  function setStatus(status: TradeStatus) {
    update.mutate({ id: trade.id, status });
  }

  function saveEdits() {
    update.mutate({
      id: trade.id,
      steamTradeUrl: urlDraft || null,
      streamerNotes: notesDraft || null,
      tradeLockUntil: lockDate ? new Date(lockDate).toISOString() : null,
      ...(lockDate && trade.status === "pending" ? { status: "trade_locked" as TradeStatus } : {}),
    });
    setEditingUrl(false);
  }

  const createdDate = new Date(trade.createdAt).toLocaleDateString("en-US", {
    month: "short", day: "numeric", year: "numeric",
  });

  return (
    <div className={`rounded-xl border transition-all duration-200 overflow-hidden ${
      trade.status === "sent" ? "border-border/50 opacity-70" : "border-border bg-card/60"
    }`}>
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-muted/20"
        onClick={() => setExpanded((e) => !e)}
      >
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-semibold text-sm text-foreground">@{trade.winnerTwitchUsername}</span>
            <span className="text-xs text-muted-foreground">won</span>
            <span className="text-sm text-primary font-medium truncate max-w-[260px]">{trade.prize}</span>
            <span className="text-xs text-muted-foreground">{createdDate}</span>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {trade.steamTradeUrl ? (
            <span className="text-xs text-green-400 flex items-center gap-1">
              <CheckCircle2 className="w-3 h-3" /> Trade URL
            </span>
          ) : (
            <span className="text-xs text-amber-400 flex items-center gap-1">
              <Clock className="w-3 h-3" /> No URL yet
            </span>
          )}

          <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex items-center gap-1 ${cfg.color}`}>
            <StatusIcon className="w-3 h-3" />
            {cfg.label}
          </span>

          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${expanded ? "rotate-180" : ""}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-4 space-y-4 bg-muted/5">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Winner's Steam Trade URL</span>
              <Hint text="Winners submit this via !tradeurl in chat. You can also paste it manually here." side="right" />
            </div>
            {editingUrl ? (
              <div className="flex gap-2">
                <Input
                  value={urlDraft}
                  onChange={(e) => setUrlDraft(e.target.value)}
                  placeholder="https://steamcommunity.com/tradeoffer/new/?partner=..."
                  className="font-mono text-xs flex-1"
                  autoFocus
                />
                <Button size="sm" onClick={saveEdits} className="gap-1">
                  <Save className="w-3.5 h-3.5" /> Save
                </Button>
                <Button size="sm" variant="outline" onClick={() => setEditingUrl(false)}>
                  <X className="w-3.5 h-3.5" />
                </Button>
              </div>
            ) : trade.steamTradeUrl ? (
              <div className="flex items-center gap-2 bg-muted/30 rounded-md px-3 py-2">
                <code className="text-xs text-foreground/80 truncate flex-1">{trade.steamTradeUrl}</code>
                <CopyButton text={trade.steamTradeUrl} />
                <button onClick={() => setEditingUrl(true)} className="p-1 text-muted-foreground hover:text-foreground">
                  <Edit3 className="w-3.5 h-3.5" />
                </button>
                <a
                  href={trade.steamTradeUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="p-1 text-primary hover:text-primary/80"
                  title="Open Steam trade offer"
                  onClick={(e) => e.stopPropagation()}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            ) : (
              <button
                onClick={() => setEditingUrl(true)}
                className="w-full text-left text-xs text-muted-foreground border border-dashed border-border rounded-md px-3 py-2 hover:border-primary/40 hover:text-foreground transition-colors"
              >
                + Paste winner's trade URL (or they can use !tradeurl in chat)
              </button>
            )}
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Trade Lock Until</span>
            <div className="flex gap-2 items-center">
              <Input
                type="date"
                value={lockDate}
                onChange={(e) => setLockDate(e.target.value)}
                className="text-xs w-40"
              />
              {lockDate && (
                <span className="text-xs text-blue-400">Item locked until {new Date(lockDate).toLocaleDateString()}</span>
              )}
            </div>
          </div>

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Notes</span>
            <Textarea
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder="e.g. Item is trade locked until Dec 18 — remind winner to check back"
              className="text-xs min-h-[60px] resize-none"
            />
          </div>

          <Button size="sm" variant="outline" onClick={saveEdits} className="gap-1.5">
            <Save className="w-3.5 h-3.5" /> Save Notes & Lock Date
          </Button>

          <div className="flex flex-wrap gap-2 pt-1 border-t border-border/50">
            <span className="text-xs text-muted-foreground self-center">Mark as:</span>
            {(["pending", "trade_locked", "sent", "skipped"] as TradeStatus[]).map((s) => {
              const c = STATUS_CONFIG[s];
              const Icon = c.icon;
              return (
                <button
                  key={s}
                  onClick={() => setStatus(s)}
                  disabled={trade.status === s || update.isPending}
                  className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border font-medium transition-all ${
                    trade.status === s
                      ? c.color + " opacity-100"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground disabled:opacity-40"
                  }`}
                >
                  <Icon className="w-3 h-3" />
                  {c.label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function InventoryDrawer() {
  const settingsQuery = useSettings();
  const inventoryQuery = useSteamInventory(!!settingsQuery.data?.steamId64);
  const [search, setSearch] = useState("");
  const [filterTradable, setFilterTradable] = useState<"all" | "tradable" | "locked">("all");

  if (!settingsQuery.data?.steamId64) {
    return (
      <div className="rounded-xl border border-dashed border-border bg-card/40 p-5 text-center text-sm space-y-2">
        <Boxes className="w-8 h-8 text-muted-foreground/40 mx-auto" />
        <p className="text-muted-foreground">Connect your Steam account to see your inventory here for quick winner lookup.</p>
        <Button variant="outline" size="sm" asChild>
          <a href="/settings">Go to Settings</a>
        </Button>
      </div>
    );
  }

  const items = inventoryQuery.data?.items ?? [];
  const filtered = items
    .filter((i) => {
      if (filterTradable === "tradable" && !i.tradable) return false;
      if (filterTradable === "locked" && i.tradable) return false;
      if (search && !i.name.toLowerCase().includes(search.toLowerCase())) return false;
      return true;
    });

  return (
    <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <Boxes className="w-4 h-4 text-blue-400" />
          <h2 className="text-sm font-semibold text-foreground">Your CS2 Inventory</h2>
          <Hint text="Quick reference for sending skins to winners. Search and filter to find an item, then send via Steam trade offer." side="right" />
        </div>
        <span className="text-xs text-muted-foreground">{items.length} items</span>
      </div>

      <div className="flex gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search skins..."
            className="pl-9 h-8 text-xs"
          />
        </div>
        <div className="flex gap-1 rounded-md bg-muted/30 p-0.5">
          {(["all", "tradable", "locked"] as const).map((f) => (
            <button
              key={f}
              onClick={() => setFilterTradable(f)}
              className={`px-2.5 py-1 text-xs rounded transition-colors capitalize ${
                filterTradable === f
                  ? "bg-primary/20 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {f}
            </button>
          ))}
        </div>
      </div>

      {inventoryQuery.isLoading && (
        <div className="h-24 flex items-center justify-center text-muted-foreground text-xs animate-pulse">
          Loading inventory…
        </div>
      )}

      {inventoryQuery.data && filtered.length === 0 && (
        <div className="h-24 flex items-center justify-center text-muted-foreground text-xs">
          No items match your filter.
        </div>
      )}

      {filtered.length > 0 && (
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2 max-h-64 overflow-y-auto pr-1">
          {filtered.map((item) => (
            <SteamItemCard key={item.assetId} item={item} compact />
          ))}
        </div>
      )}

      <a
        href="https://steamcommunity.com/my/tradeoffers/sent/"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center justify-center gap-1.5 text-xs text-primary hover:underline pt-1"
      >
        Open Steam Trade Offers <ExternalLink className="w-3 h-3" />
      </a>
    </div>
  );
}

export default function TradeOffice() {
  const { query } = useTrades();
  const [filterStatus, setFilterStatus] = useState<TradeStatus | "all">("all");

  const trades = query.data ?? [];
  const filtered = filterStatus === "all" ? trades : trades.filter((t) => t.status === filterStatus);
  const pendingCount = trades.filter((t) => t.status === "pending").length;
  const lockedCount = trades.filter((t) => t.status === "trade_locked").length;

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm animate-pulse">
        Loading trade records...
      </div>
    );
  }

  return (
    <FeatureLock
      feature="skin-trading"
      description="Trade Office is part of the CS2 skin-giveaway toolkit — manage trade URLs, locks, and delivery status from one place."
      className="min-h-[60vh]"
    >
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="font-medieval text-3xl text-foreground flex items-center gap-3">
          <Send className="w-7 h-7 text-primary" />
          Trade Office
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Manage skin deliveries to giveaway winners. Winners submit their trade URL in chat with{" "}
          <code className="font-mono text-xs bg-muted px-1 py-0.5 rounded">!tradeurl</code>.
        </p>
      </div>

      <InventoryDrawer />

      {trades.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {(["all", "pending", "trade_locked", "sent"] as const).map((s) => {
            const count = s === "all" ? trades.length : trades.filter((t) => t.status === s).length;
            const cfg = s === "all" ? null : STATUS_CONFIG[s];
            return (
              <button
                key={s}
                onClick={() => setFilterStatus(s)}
                className={`rounded-xl border px-4 py-3 text-left transition-all ${
                  filterStatus === s
                    ? "border-primary bg-primary/10"
                    : "border-border bg-card/60 hover:border-primary/40"
                }`}
              >
                <div className="text-2xl font-bold text-foreground">{count}</div>
                <div className="text-xs text-muted-foreground capitalize mt-0.5">
                  {s === "all" ? "Total" : cfg?.label}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {pendingCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-amber-400/30 bg-amber-400/5 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm text-amber-300 font-medium">
              {pendingCount} pending trade{pendingCount !== 1 ? "s" : ""} need attention
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Send each winner their skin once they've submitted a trade URL.
            </p>
          </div>
        </div>
      )}

      {lockedCount > 0 && (
        <div className="flex items-start gap-3 rounded-lg border border-blue-400/30 bg-blue-400/5 px-4 py-3">
          <AlertCircle className="w-4 h-4 text-blue-400 shrink-0 mt-0.5" />
          <p className="text-sm text-blue-300">
            {lockedCount} item{lockedCount !== 1 ? "s are" : " is"} trade locked — check the notes for unlock dates.
          </p>
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 text-center space-y-3 rounded-xl border border-dashed border-border">
          <Package className="w-10 h-10 text-muted-foreground/40" />
          <div>
            <p className="text-sm text-muted-foreground font-medium">No trade records yet</p>
            <p className="text-xs text-muted-foreground/70 mt-1">
              Trade records are created automatically when you end a giveaway with a winner.
            </p>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((trade) => (
            <TradeRow key={trade.id} trade={trade} />
          ))}
        </div>
      )}
    </div>
    </FeatureLock>
  );
}

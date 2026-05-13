import { useState, useMemo } from "react";
import {
  useListChatUsers,
  useAdjustChatUserCoins,
  useRemoveChatUserInventoryItem,
  useAddChatUserInventoryItem,
  useSellChatUserInventoryItem,
  useUseChatUserInventoryItem,
  useRedeemForChatUser,
  useGetChatUsersLootTable,
  getListChatUsersQueryKey,
  type ChatUser,
  type ChatUserInventoryItem,
  type LootTableItem,
  type BuffTableItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Label } from "@/components/ui/label";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { useToast } from "@/hooks/use-toast";
import {
  Users2, Coins, Search, Package, ChevronDown, ChevronRight,
  Trash2, Zap, Star, Info, TrendingUp, Clock, Plus, Minus, Ticket, ShoppingCart, Sparkles,
  Loader2,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RARITY_COLOR: Record<string, string> = {
  common: "text-muted-foreground",
  uncommon: "text-green-400",
  rare: "text-blue-400",
  epic: "text-purple-400",
  legendary: "text-amber-400",
};

const RARITY_BADGE: Record<string, string> = {
  common: "border-muted-foreground/30 text-muted-foreground",
  uncommon: "border-green-500/40 text-green-400",
  rare: "border-blue-500/40 text-blue-400",
  epic: "border-purple-500/40 text-purple-400",
  legendary: "border-amber-500/40 text-amber-400",
};

const RARITY_DOT: Record<string, string> = {
  common: "bg-muted-foreground",
  uncommon: "bg-green-400",
  rare: "bg-blue-400",
  epic: "bg-purple-400",
  legendary: "bg-amber-400",
};

const RARITY_ORDER = ["common", "uncommon", "rare", "epic", "legendary"];

const SUB_TIER_LABEL: Record<string, string> = {
  "1000": "T1 Sub",
  "2000": "T2 Sub",
  "3000": "T3 Sub",
};

const REDEEM_COST_PER_ENTRY = 100;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatFollowDuration(followedAt: string): string {
  const diff = Date.now() - new Date(followedAt).getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1) return "today";
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  const years = Math.floor(days / 365);
  const remMonths = Math.floor((days % 365) / 30);
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

function formatFollowDate(followedAt: string): string {
  return new Date(followedAt).toLocaleDateString(undefined, { dateStyle: "medium" });
}

// ---------------------------------------------------------------------------
// RarityDot
// ---------------------------------------------------------------------------

function RarityDot({ rarity }: { rarity: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${RARITY_DOT[rarity] ?? "bg-muted-foreground"}`}
      title={rarity}
    />
  );
}

// ---------------------------------------------------------------------------
// TwitchBadges
// ---------------------------------------------------------------------------

function TwitchBadges({ user }: { user: ChatUser }) {
  const tw = user.twitch;
  if (!tw) return <span className="text-xs text-muted-foreground/50 italic">–</span>;
  const { followedAt, isSubscriber, subTier } = tw;
  if (isSubscriber === null && followedAt === null) {
    return (
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <span className="inline-flex items-center gap-1 text-xs text-muted-foreground/50 italic cursor-help">
              <Info className="w-3 h-3" /> Re-link Twitch
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Re-connect your Twitch account on the Account page to see follow / sub data.
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    );
  }
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {isSubscriber && subTier && (
        <Badge variant="outline" className="text-[10px] gap-1 text-fuchsia-400 border-fuchsia-500/40 py-0 px-1.5">
          <Star className="w-2.5 h-2.5" />
          {SUB_TIER_LABEL[subTier] ?? `T${subTier}`}
        </Badge>
      )}
      {followedAt ? (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Badge variant="outline" className="text-[10px] gap-1 text-sky-400 border-sky-500/40 py-0 px-1.5 cursor-help">
                <Clock className="w-2.5 h-2.5" />
                {formatFollowDuration(followedAt)}
              </Badge>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Following since {formatFollowDate(followedAt)}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      ) : (
        <span className="text-xs text-muted-foreground/40">not following</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory item row
// ---------------------------------------------------------------------------

interface InventoryItemRowProps {
  item: ChatUserInventoryItem;
  onRemove: () => void;
  onSell: () => void;
  onUse: () => void;
  isBusy: boolean;
}

function InventoryItemRow({ item, onRemove, onSell, onUse, isBusy }: InventoryItemRowProps) {
  const isBuff = item.kind === "buff";

  return (
    <div className="group flex items-start gap-3 p-3 rounded-lg border border-border/30 bg-card/30 hover:bg-card/60 transition-colors">
      {/* Rarity indicator */}
      <div className="mt-0.5">
        <RarityDot rarity={item.rarity} />
      </div>

      {/* Item details */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="font-medium text-sm text-foreground/90">{item.item}</span>
          <Badge variant="outline" className={`text-[10px] py-0 px-1.5 ${RARITY_BADGE[item.rarity] ?? ""}`}>
            {item.rarity}
          </Badge>
          {isBuff && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 gap-0.5 text-amber-400 border-amber-500/40">
              <Zap className="w-2.5 h-2.5" />
              Buff
            </Badge>
          )}
          {isBuff && item.isActive && (
            <Badge variant="outline" className="text-[10px] py-0 px-1.5 text-green-400 border-green-500/40">
              Active
            </Badge>
          )}
        </div>

        {/* Description / flavor */}
        {isBuff && item.buffEffect && (
          <p className="text-xs text-muted-foreground mt-1 leading-relaxed">
            {item.buffEffect === "luck" && "Upgrades your next loot rolls to a higher rarity."}
            {item.buffEffect === "coins" && "Doubles the coins earned from your next sell."}
            {item.buffEffect === "tickets" && "Grants an extra giveaway ticket on your next !enter."}
          </p>
        )}
        {!isBuff && (
          <p className="text-xs text-muted-foreground mt-1">
            Regular loot item — sell to convert to coins.
          </p>
        )}

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-1.5 text-[10px] text-muted-foreground/70">
          <span className="inline-flex items-center gap-1">
            <Coins className="w-3 h-3 text-amber-400/70" />
            <span className="text-amber-400/80">{item.coinValue.toLocaleString()} coins</span>
          </span>
          {isBuff && item.chargesRemaining > 0 && (
            <span>{item.chargesRemaining} charge{item.chargesRemaining !== 1 ? "s" : ""} remaining</span>
          )}
          <span>Slot {item.slot}</span>
        </div>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        {isBuff && (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 px-2 text-[10px] text-amber-400 border-amber-500/30 hover:bg-amber-500/10"
                  onClick={onUse}
                  disabled={isBusy}
                >
                  <Zap className="w-3 h-3 mr-1" />
                  Use
                </Button>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">Activate this buff for the viewer</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        )}
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[10px] text-green-400 border-green-500/30 hover:bg-green-500/10"
                onClick={onSell}
                disabled={isBusy}
              >
                <ShoppingCart className="w-3 h-3 mr-1" />
                Sell
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Sell for {item.coinValue.toLocaleString()} coins (credits the viewer)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-destructive/60 hover:text-destructive hover:bg-destructive/10"
                onClick={onRemove}
                disabled={isBusy}
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">Remove (no coin refund)</TooltipContent>
          </Tooltip>
        </TooltipProvider>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Inventory panel
// ---------------------------------------------------------------------------

interface InventoryPanelProps {
  user: ChatUser;
  onAddItem: () => void;
  onRedeem: () => void;
  onRemoveItem: (item: ChatUserInventoryItem) => void;
  onSellItem: (item: ChatUserInventoryItem) => void;
  onUseItem: (item: ChatUserInventoryItem) => void;
  isBusy: boolean;
}

function InventoryPanel({ user, onAddItem, onRedeem, onRemoveItem, onSellItem, onUseItem, isBusy }: InventoryPanelProps) {
  return (
    <div className="px-6 py-4 space-y-3">
      {/* Action bar */}
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="text-xs text-muted-foreground">
          {user.inventoryCount}/5 slots used
        </span>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onRedeem}
            disabled={isBusy}
          >
            <Ticket className="w-3.5 h-3.5" />
            Redeem Tickets
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="h-7 text-xs gap-1.5"
            onClick={onAddItem}
            disabled={isBusy || user.inventoryCount >= 5}
          >
            <Plus className="w-3.5 h-3.5" />
            Add Item
          </Button>
        </div>
      </div>

      {/* Items */}
      {user.inventory.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-6 text-center text-muted-foreground/50">
          <Package className="w-8 h-8" />
          <p className="text-xs">{user.username}'s pouch is empty.</p>
          <Button size="sm" variant="ghost" className="text-xs mt-1" onClick={onAddItem}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Add first item
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          {user.inventory.map((item) => (
            <InventoryItemRow
              key={item.id}
              item={item}
              onRemove={() => onRemoveItem(item)}
              onSell={() => onSellItem(item)}
              onUse={() => onUseItem(item)}
              isBusy={isBusy}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Item dialog
// ---------------------------------------------------------------------------

interface AddItemDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  username: string;
  lootItems: LootTableItem[];
  buffItems: BuffTableItem[];
  onConfirm: (itemName: string) => void;
  isPending: boolean;
}

function AddItemDialog({ open, onOpenChange, username, lootItems, buffItems, onConfirm, isPending }: AddItemDialogProps) {
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState("loot");

  const filteredLoot = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? lootItems.filter((i) => i.item.toLowerCase().includes(q) || i.rarity.toLowerCase().includes(q)) : lootItems;
    return [...list].sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  }, [lootItems, search]);

  const filteredBuffs = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = q ? buffItems.filter((i) => i.item.toLowerCase().includes(q) || i.effect.toLowerCase().includes(q)) : buffItems;
    return [...list].sort((a, b) => RARITY_ORDER.indexOf(b.rarity) - RARITY_ORDER.indexOf(a.rarity));
  }, [buffItems, search]);

  function handleSubmit() {
    if (!selected) return;
    onConfirm(selected);
    setSelected(null);
    setSearch("");
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { onOpenChange(v); if (!v) { setSelected(null); setSearch(""); } }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="font-medieval flex items-center gap-2">
            <Sparkles className="w-5 h-5 text-primary" />
            Add Item for {username}
          </DialogTitle>
          <DialogDescription>
            Pick any item from the loot or buff table to drop directly into their pouch.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search items…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="pl-9"
            />
          </div>

          <Tabs value={tab} onValueChange={setTab}>
            <TabsList className="w-full">
              <TabsTrigger value="loot" className="flex-1">Loot Items ({filteredLoot.length})</TabsTrigger>
              <TabsTrigger value="buff" className="flex-1">Buffs ({filteredBuffs.length})</TabsTrigger>
            </TabsList>

            <TabsContent value="loot">
              <ScrollArea className="h-64">
                <div className="space-y-1 pr-2 pt-1">
                  {filteredLoot.map((item) => (
                    <button
                      key={`${item.theme}-${item.item}`}
                      onClick={() => setSelected(item.item === selected ? null : item.item)}
                      className={`w-full flex items-center gap-3 px-3 py-2 rounded-md text-left text-sm transition-colors border ${
                        selected === item.item
                          ? "bg-primary/15 border-primary/40"
                          : "border-transparent hover:bg-muted/30"
                      }`}
                    >
                      <RarityDot rarity={item.rarity} />
                      <span className="flex-1 font-medium">{item.item}</span>
                      <span className={`text-[10px] capitalize ${RARITY_COLOR[item.rarity] ?? ""}`}>{item.rarity}</span>
                      <span className="text-[10px] text-muted-foreground/60 uppercase">{item.theme}</span>
                      <span className="text-[10px] text-amber-400/80 font-mono">{item.points.toLocaleString()}c</span>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="buff">
              <ScrollArea className="h-64">
                <div className="space-y-1 pr-2 pt-1">
                  {filteredBuffs.map((item) => (
                    <button
                      key={item.item}
                      onClick={() => setSelected(item.item === selected ? null : item.item)}
                      className={`w-full flex items-start gap-3 px-3 py-2.5 rounded-md text-left text-sm transition-colors border ${
                        selected === item.item
                          ? "bg-primary/15 border-primary/40"
                          : "border-transparent hover:bg-muted/30"
                      }`}
                    >
                      <RarityDot rarity={item.rarity} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{item.item}</span>
                          <Badge variant="outline" className={`text-[9px] py-0 px-1 ${RARITY_BADGE[item.rarity] ?? ""}`}>
                            {item.rarity}
                          </Badge>
                        </div>
                        <p className="text-[11px] text-muted-foreground mt-0.5 leading-relaxed">{item.flavor}</p>
                        <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground/60">
                          <span>{item.charges} charge{item.charges !== 1 ? "s" : ""}</span>
                          <span className="text-amber-400/70">{item.coinValue.toLocaleString()}c sell value</span>
                          <span className="capitalize text-primary/70">{item.effect} buff</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={!selected || isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Plus className="w-4 h-4 mr-2" />}
            {isPending ? "Adding…" : "Add to Pouch"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Redeem Tickets dialog
// ---------------------------------------------------------------------------

interface RedeemDialogProps {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  username: string;
  coins: number;
  onConfirm: (entries: number) => void;
  isPending: boolean;
}

function RedeemDialog({ open, onOpenChange, username, coins, onConfirm, isPending }: RedeemDialogProps) {
  const [entries, setEntries] = useState("1");
  const n = Math.max(1, Math.trunc(Number(entries) || 1));
  const cost = n * REDEEM_COST_PER_ENTRY;
  const canAfford = coins >= cost;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle className="font-medieval flex items-center gap-2">
            <Ticket className="w-5 h-5 text-primary" />
            Redeem Tickets for {username}
          </DialogTitle>
          <DialogDescription>
            Spend {username}'s coins on extra giveaway ticket entries. Requires an active giveaway.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="rounded-lg border border-border/50 bg-muted/20 p-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Current balance</span>
              <span className="font-mono text-amber-400">{coins.toLocaleString()} coins</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Cost per ticket</span>
              <span className="font-mono">{REDEEM_COST_PER_ENTRY} coins</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Total cost</span>
              <span className={`font-mono font-semibold ${!canAfford ? "text-destructive" : "text-foreground"}`}>
                {cost.toLocaleString()} coins
              </span>
            </div>
            <div className="flex justify-between border-t border-border/40 pt-1 mt-1">
              <span className="text-muted-foreground">Balance after</span>
              <span className={`font-mono ${!canAfford ? "text-destructive" : "text-green-400"}`}>
                {Math.max(0, coins - cost).toLocaleString()} coins
              </span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="redeem-entries">Tickets to redeem</Label>
            <Input
              id="redeem-entries"
              type="number"
              min={1}
              max={Math.floor(coins / REDEEM_COST_PER_ENTRY) || 1}
              value={entries}
              onChange={(e) => setEntries(e.target.value)}
              disabled={isPending}
            />
          </div>

          {!canAfford && (
            <p className="text-xs text-destructive">
              {username} doesn't have enough coins to redeem {n} ticket{n !== 1 ? "s" : ""}.
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={isPending}>Cancel</Button>
          <Button onClick={() => onConfirm(n)} disabled={!canAfford || isPending}>
            {isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <Ticket className="w-4 h-4 mr-2" />}
            {isPending ? "Redeeming…" : `Redeem ${n} Ticket${n !== 1 ? "s" : ""}`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// User row
// ---------------------------------------------------------------------------

interface RowProps {
  user: ChatUser;
  onAdjustCoins: (username: string) => void;
  onAddItem: (username: string) => void;
  onRedeem: (username: string) => void;
  onRemoveItem: (username: string, item: ChatUserInventoryItem) => void;
  onSellItem: (username: string, item: ChatUserInventoryItem) => void;
  onUseItem: (username: string, item: ChatUserInventoryItem) => void;
  isBusy: boolean;
}

function UserRow({ user, onAdjustCoins, onAddItem, onRedeem, onRemoveItem, onSellItem, onUseItem, isBusy }: RowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`row-chat-user-${user.username}`}
      >
        <td className="pl-4 py-3 w-8">
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground/40" />}
        </td>
        <td className="px-3 py-3">
          <span className="font-mono text-sm font-medium">{user.username}</span>
        </td>
        <td className="px-3 py-3">
          <span className="font-mono inline-flex items-center gap-1.5 text-amber-400 text-sm">
            <Coins className="w-3.5 h-3.5" />
            {user.coins.toLocaleString()}
          </span>
        </td>
        <td className="px-3 py-3">
          <TwitchBadges user={user} />
        </td>
        <td className="px-3 py-3">
          {user.inventoryCount === 0 ? (
            <span className="text-muted-foreground/40 text-xs">empty</span>
          ) : (
            <div className="flex items-center gap-1.5">
              <Package className="w-3.5 h-3.5 text-muted-foreground/60" />
              <span className="text-sm text-muted-foreground">{user.inventoryCount}/5</span>
              <div className="flex gap-0.5">
                {user.inventory.slice(0, 5).map((it) => (
                  <RarityDot key={it.id} rarity={it.rarity} />
                ))}
              </div>
            </div>
          )}
        </td>
        <td className="px-3 py-3 text-right" onClick={(e) => e.stopPropagation()}>
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => onAdjustCoins(user.username)}
            data-testid={`button-adjust-${user.username}`}
          >
            <Coins className="w-3 h-3 mr-1" />
            Coins
          </Button>
        </td>
      </tr>

      {expanded && (
        <tr>
          <td colSpan={6} className="bg-muted/10 border-b border-border/30">
            <InventoryPanel
              user={user}
              onAddItem={() => onAddItem(user.username)}
              onRedeem={() => onRedeem(user.username)}
              onRemoveItem={(item) => onRemoveItem(user.username, item)}
              onSellItem={(item) => onSellItem(user.username, item)}
              onUseItem={(item) => onUseItem(user.username, item)}
              isBusy={isBusy}
            />
          </td>
        </tr>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export function ChatUsers() {
  const { data: users, isLoading } = useListChatUsers();
  const { data: lootTable } = useGetChatUsersLootTable();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"coins" | "username" | "inventory">("coins");
  const [activeUsername, setActiveUsername] = useState<string | null>(null);

  // Dialogs
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [addItemOpen, setAddItemOpen] = useState(false);
  const [redeemOpen, setRedeemOpen] = useState(false);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  // Remove / sell / use confirm dialogs
  const [removeTarget, setRemoveTarget] = useState<{ username: string; item: ChatUserInventoryItem } | null>(null);
  const [sellTarget, setSellTarget] = useState<{ username: string; item: ChatUserInventoryItem } | null>(null);
  const [useTarget, setUseTarget] = useState<{ username: string; item: ChatUserInventoryItem } | null>(null);

  const adjustMutation = useAdjustChatUserCoins();
  const removeMutation = useRemoveChatUserInventoryItem();
  const addItemMutation = useAddChatUserInventoryItem();
  const sellItemMutation = useSellChatUserInventoryItem();
  const useItemMutation = useUseChatUserInventoryItem();
  const redeemMutation = useRedeemForChatUser();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListChatUsersQueryKey() });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = (users ?? []).filter((u) => !q || u.username.includes(q));
    if (sortBy === "coins") list = [...list].sort((a, b) => b.coins - a.coins);
    else if (sortBy === "username") list = [...list].sort((a, b) => a.username.localeCompare(b.username));
    else if (sortBy === "inventory") list = [...list].sort((a, b) => b.inventoryCount - a.inventoryCount);
    return list;
  }, [users, search, sortBy]);

  const totalCoins = useMemo(() => (users ?? []).reduce((s, u) => s + u.coins, 0), [users]);
  const subsCount = useMemo(() => (users ?? []).filter((u) => u.twitch?.isSubscriber).length, [users]);
  const hasTwitchData = (users ?? []).some((u) => u.twitch && (u.twitch.followedAt !== null || u.twitch.isSubscriber !== null));

  const activeUser = users?.find((u) => u.username === activeUsername) ?? null;

  // Adjust coins
  function openAdjust(username: string) { setActiveUsername(username); setDelta(""); setReason(""); setAdjustOpen(true); }

  function submitAdjust(sign: 1 | -1) {
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n <= 0) { toast({ title: "Enter a positive amount", variant: "destructive" }); return; }
    if (!activeUsername) return;
    adjustMutation.mutate(
      { username: activeUsername, data: { delta: sign * n, reason: reason || undefined } },
      {
        onSuccess: (res) => {
          toast({ title: sign > 0 ? "Coins awarded" : "Coins removed", description: `${activeUsername} now holds ${res.balance.toLocaleString()} coins.` });
          void invalidate();
          setAdjustOpen(false);
        },
        onError: () => toast({ title: "Adjustment failed", variant: "destructive" }),
      },
    );
  }

  // Add item
  function openAddItem(username: string) { setActiveUsername(username); setAddItemOpen(true); }

  function handleAddItem(itemName: string) {
    if (!activeUsername) return;
    addItemMutation.mutate(
      { username: activeUsername, data: { itemName } },
      {
        onSuccess: (res) => {
          if (!res.ok) {
            toast({ title: res.reason === "full" ? "Pouch is full (5/5 slots)" : "Failed to add item", variant: "destructive" });
            return;
          }
          toast({ title: "Item added", description: `${itemName} dropped into ${activeUsername}'s pouch (slot ${res.slot}).` });
          void invalidate();
          setAddItemOpen(false);
        },
        onError: () => toast({ title: "Failed to add item", variant: "destructive" }),
      },
    );
  }

  // Redeem tickets
  function openRedeem(username: string) { setActiveUsername(username); setRedeemOpen(true); }

  function handleRedeem(entries: number) {
    if (!activeUsername) return;
    redeemMutation.mutate(
      { username: activeUsername, data: { entries } },
      {
        onSuccess: (res) => {
          if (!res.ok) {
            toast({ title: "Redemption failed", description: res.message ?? res.code ?? "Unknown error", variant: "destructive" });
            return;
          }
          toast({
            title: "Tickets redeemed",
            description: `${res.ticketsAdded} ticket${(res.ticketsAdded ?? 1) !== 1 ? "s" : ""} for ${activeUsername}. Balance: ${res.balanceAfter?.toLocaleString()} coins.`,
          });
          void invalidate();
          setRedeemOpen(false);
        },
        onError: (err: Error) => toast({ title: "Redemption failed", description: err.message, variant: "destructive" }),
      },
    );
  }

  // Remove item
  function confirmRemove() {
    if (!removeTarget) return;
    removeMutation.mutate(
      { username: removeTarget.username, itemId: removeTarget.item.id },
      {
        onSuccess: () => {
          toast({ title: "Item removed", description: `${removeTarget.item.item} removed from ${removeTarget.username}'s pouch.` });
          void invalidate();
          setRemoveTarget(null);
        },
        onError: () => toast({ title: "Failed to remove item", variant: "destructive" }),
      },
    );
  }

  // Sell item
  function confirmSell() {
    if (!sellTarget) return;
    sellItemMutation.mutate(
      { username: sellTarget.username, itemId: sellTarget.item.id },
      {
        onSuccess: (res) => {
          toast({ title: "Item sold", description: `+${res.coinsEarned.toLocaleString()} coins credited to ${sellTarget.username}. Balance: ${res.balanceAfter.toLocaleString()}.` });
          void invalidate();
          setSellTarget(null);
        },
        onError: () => toast({ title: "Sell failed", variant: "destructive" }),
      },
    );
  }

  // Use item
  function confirmUse() {
    if (!useTarget) return;
    useItemMutation.mutate(
      { username: useTarget.username, itemId: useTarget.item.id },
      {
        onSuccess: (res) => {
          toast({ title: "Buff activated", description: `${res.item} is now active for ${useTarget.username} (${res.chargesRemaining} charges left).` });
          void invalidate();
          setUseTarget(null);
        },
        onError: () => toast({ title: "Failed to activate buff", variant: "destructive" }),
      },
    );
  }

  const anyMutationPending =
    removeMutation.isPending || addItemMutation.isPending ||
    sellItemMutation.isPending || useItemMutation.isPending || redeemMutation.isPending;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Users2 className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Community</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">
          Every viewer with coins or items in your channel. Expand a row to manage their pouch.
        </p>
      </div>

      {/* Stats bar */}
      {!isLoading && users && users.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3">
            <Users2 className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Members</div>
              <div className="font-semibold">{users.length.toLocaleString()}</div>
            </div>
          </div>
          <div className="rounded-lg border border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3">
            <Coins className="w-4 h-4 text-amber-400" />
            <div>
              <div className="text-xs text-muted-foreground">Coins in Circulation</div>
              <div className="font-semibold text-amber-400">{totalCoins.toLocaleString()}</div>
            </div>
          </div>
          {hasTwitchData && (
            <div className="rounded-lg border border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3">
              <Star className="w-4 h-4 text-fuchsia-400" />
              <div>
                <div className="text-xs text-muted-foreground">Subscribers</div>
                <div className="font-semibold text-fuchsia-400">{subsCount.toLocaleString()}</div>
              </div>
            </div>
          )}
          <div className="rounded-lg border border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3">
            <TrendingUp className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Sort</div>
              <div className="flex gap-1 mt-0.5">
                {(["coins", "username", "inventory"] as const).map((s) => (
                  <button
                    key={s}
                    onClick={() => setSortBy(s)}
                    className={`text-[10px] px-1.5 py-0.5 rounded capitalize transition-colors ${
                      sortBy === s ? "bg-primary/20 text-primary" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {s === "inventory" ? "pouch" : s}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50 py-4">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="font-medieval">The Mob</CardTitle>
              <CardDescription>Click a row to expand the viewer's pouch and manage their items.</CardDescription>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                placeholder="Search username…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9 bg-background"
                data-testid="input-search-chat-users"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">
                {users && users.length === 0
                  ? "No community members yet. Once viewers earn coins or pull loot they'll show up here."
                  : "No users match that search."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="pl-4 py-3 w-8" />
                  <th className="px-3 py-3 font-semibold">Username</th>
                  <th className="px-3 py-3 font-semibold">Coins</th>
                  <th className="px-3 py-3 font-semibold">Twitch</th>
                  <th className="px-3 py-3 font-semibold">Pouch</th>
                  <th className="px-3 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((u) => (
                  <UserRow
                    key={u.username}
                    user={u}
                    onAdjustCoins={openAdjust}
                    onAddItem={openAddItem}
                    onRedeem={openRedeem}
                    onRemoveItem={(username, item) => setRemoveTarget({ username, item })}
                    onSellItem={(username, item) => setSellTarget({ username, item })}
                    onUseItem={(username, item) => setUseTarget({ username, item })}
                    isBusy={anyMutationPending}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* ── Add Item dialog ─────────────────────────────────────── */}
      <AddItemDialog
        open={addItemOpen}
        onOpenChange={setAddItemOpen}
        username={activeUsername ?? ""}
        lootItems={lootTable?.items ?? []}
        buffItems={lootTable?.buffs ?? []}
        onConfirm={handleAddItem}
        isPending={addItemMutation.isPending}
      />

      {/* ── Redeem Tickets dialog ─────────────────────────────── */}
      <RedeemDialog
        open={redeemOpen}
        onOpenChange={setRedeemOpen}
        username={activeUsername ?? ""}
        coins={activeUser?.coins ?? 0}
        onConfirm={handleRedeem}
        isPending={redeemMutation.isPending}
      />

      {/* ── Adjust Coins dialog ───────────────────────────────── */}
      <Dialog open={adjustOpen} onOpenChange={setAdjustOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="font-medieval flex items-center gap-2">
              <Coins className="w-5 h-5 text-amber-400" />
              Adjust coins for {activeUsername}
            </DialogTitle>
            <DialogDescription>
              Awards write through the loot feed; deductions record as a streamer adjustment.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="delta">Amount</Label>
              <Input
                id="delta"
                type="number"
                min={1}
                placeholder="e.g. 100"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                disabled={adjustMutation.isPending}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Reason (optional)</Label>
              <Input
                id="reason"
                placeholder="e.g. Correct score"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                disabled={adjustMutation.isPending}
              />
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="ghost" onClick={() => setAdjustOpen(false)} disabled={adjustMutation.isPending}>
              Cancel
            </Button>
            <Button
              variant="outline"
              className="text-destructive border-destructive/30 hover:bg-destructive/10"
              onClick={() => submitAdjust(-1)}
              disabled={adjustMutation.isPending}
            >
              <Minus className="w-3.5 h-3.5 mr-1" /> Remove
            </Button>
            <Button onClick={() => submitAdjust(1)} disabled={adjustMutation.isPending}>
              {adjustMutation.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1" /> : <Plus className="w-3.5 h-3.5 mr-1" />}
              Award
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Remove item confirm ───────────────────────────────── */}
      <AlertDialog open={!!removeTarget} onOpenChange={(v) => { if (!v) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove {removeTarget?.item.item}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the item from {removeTarget?.username}'s pouch with no coin refund.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={removeMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={confirmRemove}
              disabled={removeMutation.isPending}
            >
              {removeMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Sell item confirm ─────────────────────────────────── */}
      <AlertDialog open={!!sellTarget} onOpenChange={(v) => { if (!v) setSellTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sell {sellTarget?.item.item}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will sell the item and credit {sellTarget?.item.coinValue.toLocaleString()} coins directly to {sellTarget?.username}'s balance.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={sellItemMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmSell} disabled={sellItemMutation.isPending}>
              {sellItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Sell for {sellTarget?.item.coinValue.toLocaleString()} coins
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* ── Use item confirm ──────────────────────────────────── */}
      <AlertDialog open={!!useTarget} onOpenChange={(v) => { if (!v) setUseTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Activate {useTarget?.item.item}?</AlertDialogTitle>
            <AlertDialogDescription>
              This will activate the buff for {useTarget?.username}. Any existing buff of the same type will be deactivated.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={useItemMutation.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmUse} disabled={useItemMutation.isPending}>
              {useItemMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Activate Buff
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ChatUsers;

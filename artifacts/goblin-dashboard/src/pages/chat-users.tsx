import { useState, useMemo } from "react";
import {
  useListChatUsers,
  useAdjustChatUserCoins,
  useRemoveChatUserInventoryItem,
  getListChatUsersQueryKey,
  type ChatUser,
  type ChatUserInventoryItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
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
  Users2, Coins, Search, Plus, Minus, Package, ChevronDown, ChevronRight,
  Trash2, Zap, Star, Info, TrendingUp, Clock,
} from "lucide-react";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RARITY_COLOR: Record<string, string> = {
  common: "text-muted-foreground border-muted",
  uncommon: "text-green-400 border-green-500/40",
  rare: "text-blue-400 border-blue-500/40",
  epic: "text-purple-400 border-purple-500/40",
  legendary: "text-amber-400 border-amber-500/40",
};

const RARITY_DOT: Record<string, string> = {
  common: "bg-muted-foreground",
  uncommon: "bg-green-400",
  rare: "bg-blue-400",
  epic: "bg-purple-400",
  legendary: "bg-amber-400",
};

const SUB_TIER_LABEL: Record<string, string> = {
  "1000": "Tier 1",
  "2000": "Tier 2",
  "3000": "Tier 3",
};

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
// Sub-components
// ---------------------------------------------------------------------------

function RarityDot({ rarity }: { rarity: string }) {
  return (
    <span
      className={`inline-block w-2 h-2 rounded-full shrink-0 ${RARITY_DOT[rarity] ?? "bg-muted-foreground"}`}
      title={rarity}
    />
  );
}

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
              <Info className="w-3 h-3" />
              Re-link Twitch
            </span>
          </TooltipTrigger>
          <TooltipContent side="top" className="max-w-xs text-xs">
            Twitch follow &amp; subscription data requires re-connecting your Twitch account from the Account page to grant the needed permissions.
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
          {SUB_TIER_LABEL[subTier] ?? `T${subTier}`} Sub
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
// Inventory panel (expandable)
// ---------------------------------------------------------------------------

interface InventoryPanelProps {
  username: string;
  inventory: ChatUserInventoryItem[];
  onRemove: (item: ChatUserInventoryItem) => void;
  removeIsPending: boolean;
}

function InventoryPanel({ username, inventory, onRemove, removeIsPending }: InventoryPanelProps) {
  if (inventory.length === 0) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground/60 text-xs py-1">
        <Package className="w-3.5 h-3.5" />
        {username}'s pouch is empty.
      </div>
    );
  }

  return (
    <table className="w-full text-xs">
      <thead>
        <tr className="text-left text-[10px] uppercase text-muted-foreground/60">
          <th className="pr-3 pb-1.5 font-semibold w-6">#</th>
          <th className="pr-3 pb-1.5 font-semibold">Item</th>
          <th className="pr-3 pb-1.5 font-semibold">Rarity</th>
          <th className="pr-3 pb-1.5 font-semibold">Kind</th>
          <th className="pr-3 pb-1.5 font-semibold">Value</th>
          <th className="pr-3 pb-1.5 font-semibold">Status</th>
          <th className="pb-1.5" />
        </tr>
      </thead>
      <tbody className="divide-y divide-border/30">
        {inventory.map((item) => (
          <tr key={item.id} className="group">
            <td className="pr-3 py-1.5 text-muted-foreground/50">{item.slot}</td>
            <td className="pr-3 py-1.5 max-w-[160px]">
              <div className="flex items-center gap-1.5 min-w-0">
                <RarityDot rarity={item.rarity} />
                <span className="truncate font-medium text-foreground/90" title={item.item}>
                  {item.item}
                </span>
              </div>
              {item.buffEffect && (
                <div className="text-[10px] text-muted-foreground/60 mt-0.5 pl-3.5 truncate" title={item.buffEffect}>
                  {item.buffEffect}
                </div>
              )}
            </td>
            <td className="pr-3 py-1.5">
              <span className={`capitalize ${RARITY_COLOR[item.rarity] ?? ""}`}>{item.rarity}</span>
            </td>
            <td className="pr-3 py-1.5">
              {item.kind === "buff" ? (
                <Badge variant="outline" className="text-[10px] gap-0.5 text-amber-400 border-amber-500/40 py-0 px-1">
                  <Zap className="w-2.5 h-2.5" />
                  Buff
                </Badge>
              ) : (
                <span className="text-muted-foreground/60 capitalize">{item.kind}</span>
              )}
            </td>
            <td className="pr-3 py-1.5">
              <span className="inline-flex items-center gap-1 text-amber-400 font-mono">
                <Coins className="w-3 h-3" />
                {item.coinValue.toLocaleString()}
              </span>
            </td>
            <td className="pr-3 py-1.5 text-muted-foreground/60">
              {item.kind === "buff" ? (
                item.isActive ? (
                  <span className="text-green-400">{item.chargesRemaining > 0 ? `${item.chargesRemaining}× left` : "Active"}</span>
                ) : (
                  <span>Inactive</span>
                )
              ) : (
                <span>—</span>
              )}
            </td>
            <td className="py-1.5 text-right">
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0 opacity-0 group-hover:opacity-100 transition-opacity text-destructive/70 hover:text-destructive hover:bg-destructive/10"
                onClick={() => onRemove(item)}
                disabled={removeIsPending}
                title="Remove item"
              >
                <Trash2 className="w-3 h-3" />
              </Button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---------------------------------------------------------------------------
// Row
// ---------------------------------------------------------------------------

interface RowProps {
  user: ChatUser;
  onAdjust: (username: string) => void;
  onRemoveItem: (username: string, item: ChatUserInventoryItem) => void;
  removeIsPending: boolean;
  removingItemId: number | null;
}

function UserRow({ user, onAdjust, onRemoveItem, removeIsPending, removingItemId }: RowProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-muted/20 transition-colors cursor-pointer"
        onClick={() => setExpanded((v) => !v)}
        data-testid={`row-chat-user-${user.username}`}
      >
        {/* Expand toggle */}
        <td className="pl-4 py-3 w-8">
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground/60" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
          )}
        </td>
        {/* Username */}
        <td className="px-3 py-3 font-medium text-foreground">
          <span className="font-mono text-sm">{user.username}</span>
        </td>
        {/* Coins */}
        <td className="px-3 py-3">
          <span className="font-mono inline-flex items-center gap-1.5 text-amber-400 text-sm">
            <Coins className="w-3.5 h-3.5" />
            {user.coins.toLocaleString()}
          </span>
        </td>
        {/* Twitch status */}
        <td className="px-3 py-3">
          <TwitchBadges user={user} />
        </td>
        {/* Pouch */}
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
        {/* Actions — stop propagation so the row expand doesn't fire */}
        <td
          className="px-3 py-3 text-right"
          onClick={(e) => e.stopPropagation()}
        >
          <Button
            size="sm"
            variant="outline"
            className="text-xs h-7"
            onClick={() => onAdjust(user.username)}
            data-testid={`button-adjust-${user.username}`}
          >
            <Coins className="w-3 h-3 mr-1" />
            Coins
          </Button>
        </td>
      </tr>

      {/* Expanded inventory panel */}
      {expanded && (
        <tr>
          <td colSpan={6} className="bg-muted/10 border-b border-border/30">
            <div className="px-6 py-3">
              <InventoryPanel
                username={user.username}
                inventory={user.inventory}
                onRemove={(item) => onRemoveItem(user.username, item)}
                removeIsPending={removeIsPending && removingItemId === null}
              />
            </div>
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
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"coins" | "username" | "inventory">("coins");

  // Adjust coins dialog
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);
  const [delta, setDelta] = useState("");
  const [reason, setReason] = useState("");

  // Remove item confirm dialog
  const [removeTarget, setRemoveTarget] = useState<{ username: string; item: ChatUserInventoryItem } | null>(null);
  const [removingItemId, setRemovingItemId] = useState<number | null>(null);

  const adjustMutation = useAdjustChatUserCoins();
  const removeMutation = useRemoveChatUserInventoryItem();

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

  function openAdjust(username: string) {
    setActiveUsername(username);
    setDelta("");
    setReason("");
    setAdjustOpen(true);
  }

  function submitAdjust(sign: 1 | -1) {
    const n = Math.trunc(Number(delta));
    if (!Number.isFinite(n) || n <= 0) {
      toast({ title: "Enter a positive coin amount", variant: "destructive" });
      return;
    }
    if (!activeUsername) return;
    adjustMutation.mutate(
      { username: activeUsername, data: { delta: sign * n, reason: reason || undefined } },
      {
        onSuccess: (res) => {
          toast({
            title: sign > 0 ? "Coins awarded" : "Coins removed",
            description: `${activeUsername} now holds ${res.balance.toLocaleString()} coins.`,
          });
          void queryClient.invalidateQueries({ queryKey: getListChatUsersQueryKey() });
          setAdjustOpen(false);
        },
        onError: () => toast({ title: "Adjustment failed", variant: "destructive" }),
      },
    );
  }

  function handleRemoveItem(username: string, item: ChatUserInventoryItem) {
    setRemoveTarget({ username, item });
  }

  function confirmRemove() {
    if (!removeTarget) return;
    setRemovingItemId(removeTarget.item.id);
    removeMutation.mutate(
      { username: removeTarget.username, itemId: removeTarget.item.id },
      {
        onSuccess: () => {
          toast({
            title: "Item removed",
            description: `${removeTarget.item.item} removed from ${removeTarget.username}'s pouch.`,
          });
          void queryClient.invalidateQueries({ queryKey: getListChatUsersQueryKey() });
          setRemoveTarget(null);
          setRemovingItemId(null);
        },
        onError: () => {
          toast({ title: "Failed to remove item", variant: "destructive" });
          setRemovingItemId(null);
        },
      },
    );
  }

  const hasTwitchData = (users ?? []).some((u) => u.twitch && (u.twitch.followedAt !== null || u.twitch.isSubscriber !== null));

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <div className="flex items-center gap-3">
          <Users2 className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Community</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">
          Every viewer with coins or items in your channel. Click a row to inspect their pouch.
        </p>
      </div>

      {/* Stats bar */}
      {!isLoading && users && users.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div className="rounded-lg border border-border/50 bg-card/40 px-4 py-3 flex items-center gap-3">
            <Users2 className="w-4 h-4 text-muted-foreground" />
            <div>
              <div className="text-xs text-muted-foreground">Members</div>
              <div className="font-semibold text-foreground">{users.length.toLocaleString()}</div>
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
                      sortBy === s
                        ? "bg-primary/20 text-primary"
                        : "text-muted-foreground hover:text-foreground"
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
              <CardDescription>Click any row to expand the viewer's pouch.</CardDescription>
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
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">
                {users && users.length === 0
                  ? "No community members yet. Once viewers start earning coins or pulling loot, they'll show up here."
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
                    onAdjust={openAdjust}
                    onRemoveItem={handleRemoveItem}
                    removeIsPending={removeMutation.isPending}
                    removingItemId={removingItemId}
                  />
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Adjust Coins dialog */}
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
                placeholder="100"
                value={delta}
                onChange={(e) => setDelta(e.target.value)}
                className="bg-background"
                data-testid="input-adjust-amount"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="reason">Note (optional)</Label>
              <Input
                id="reason"
                placeholder="raid bonus, refund, etc."
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className="bg-background"
                maxLength={80}
                data-testid="input-adjust-reason"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive/10 gap-1.5"
              onClick={() => submitAdjust(-1)}
              disabled={adjustMutation.isPending}
              data-testid="button-deduct-coins"
            >
              <Minus className="w-3.5 h-3.5" />
              Take
            </Button>
            <Button
              className="gap-1.5"
              onClick={() => submitAdjust(1)}
              disabled={adjustMutation.isPending}
              data-testid="button-award-coins"
            >
              <Plus className="w-3.5 h-3.5" />
              Award
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove item confirm */}
      <AlertDialog open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="font-medieval flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-destructive" />
              Remove item?
            </AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove{" "}
              <span className="font-semibold text-foreground">{removeTarget?.item.item}</span>{" "}
              from{" "}
              <span className="font-semibold text-foreground">{removeTarget?.username}</span>'s pouch.
              No coin refund is given — this is an admin action.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmRemove}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

export default ChatUsers;

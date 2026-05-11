import { useState, useMemo } from "react";
import { useListChatUsers, useAdjustChatUserCoins, getListChatUsersQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import { Users2, Coins, Search, Plus, Minus, Package } from "lucide-react";

const RARITY_COLOR: Record<string, string> = {
  common: "text-muted-foreground border-muted",
  uncommon: "text-green-400 border-green-500/40",
  rare: "text-blue-400 border-blue-500/40",
  epic: "text-purple-400 border-purple-500/40",
  legendary: "text-amber-400 border-amber-500/40",
};

export function ChatUsers() {
  const { data: users, isLoading } = useListChatUsers();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [search, setSearch] = useState("");
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [activeUsername, setActiveUsername] = useState<string | null>(null);
  const [delta, setDelta] = useState<string>("");
  const [reason, setReason] = useState<string>("");

  const adjustMutation = useAdjustChatUserCoins();

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return users ?? [];
    return (users ?? []).filter((u) => u.username.includes(q));
  }, [users, search]);

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
      {
        username: activeUsername,
        data: { delta: sign * n, reason: reason || undefined },
      },
      {
        onSuccess: (res) => {
          toast({
            title: sign > 0 ? "Coins awarded" : "Coins removed",
            description: `${activeUsername} now holds ${res.balance.toLocaleString()} coins.`,
          });
          queryClient.invalidateQueries({ queryKey: getListChatUsersQueryKey() });
          setAdjustOpen(false);
        },
        onError: () => toast({ title: "Adjustment failed", variant: "destructive" }),
      },
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <div className="flex items-center gap-3">
          <Users2 className="w-8 h-8 text-primary" />
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">Chat Users</h1>
        </div>
        <p className="text-muted-foreground mt-2 text-lg">
          Every viewer with coins or items in your channel. Hand out rewards, fix mistakes, settle scores.
        </p>
      </div>

      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div>
              <CardTitle className="font-medieval">The Mob</CardTitle>
              <CardDescription>Sorted by coin balance, descending.</CardDescription>
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
                <Skeleton key={i} className="h-14 w-full" />
              ))}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-12 text-center">
              <Users2 className="w-10 h-10 mx-auto text-muted-foreground/40 mb-3" />
              <p className="text-muted-foreground">
                {users && users.length === 0
                  ? "No chat users yet. Once viewers start earning coins or pulling loot, they'll show up here."
                  : "No users match that search."}
              </p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-muted/30">
                <tr className="text-left text-xs uppercase text-muted-foreground">
                  <th className="px-6 py-3 font-semibold">Username</th>
                  <th className="px-6 py-3 font-semibold">Coins</th>
                  <th className="px-6 py-3 font-semibold">Pouch</th>
                  <th className="px-6 py-3 font-semibold text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/40">
                {filtered.map((u) => (
                  <tr key={u.username} className="hover:bg-muted/20 transition-colors" data-testid={`row-chat-user-${u.username}`}>
                    <td className="px-6 py-3 font-medium text-foreground">{u.username}</td>
                    <td className="px-6 py-3">
                      <span className="font-mono inline-flex items-center gap-1.5 text-amber-400">
                        <Coins className="w-3.5 h-3.5" />
                        {u.coins.toLocaleString()}
                      </span>
                    </td>
                    <td className="px-6 py-3">
                      {u.inventoryCount === 0 ? (
                        <span className="text-muted-foreground text-xs">empty</span>
                      ) : (
                        <div className="flex flex-wrap gap-1">
                          <Badge variant="outline" className="text-xs gap-1">
                            <Package className="w-3 h-3" />
                            {u.inventoryCount} / 5
                          </Badge>
                          {u.inventory.slice(0, 3).map((it) => (
                            <Badge
                              key={it.id}
                              variant="outline"
                              className={`text-[10px] ${RARITY_COLOR[it.rarity] ?? ""}`}
                              title={it.item}
                            >
                              {it.item.length > 18 ? `${it.item.slice(0, 18)}…` : it.item}
                            </Badge>
                          ))}
                          {u.inventory.length > 3 && (
                            <Badge variant="outline" className="text-[10px] text-muted-foreground">
                              +{u.inventory.length - 3}
                            </Badge>
                          )}
                        </div>
                      )}
                    </td>
                    <td className="px-6 py-3 text-right">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => openAdjust(u.username)}
                        data-testid={`button-adjust-${u.username}`}
                      >
                        Adjust Coins
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

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
    </div>
  );
}

export default ChatUsers;

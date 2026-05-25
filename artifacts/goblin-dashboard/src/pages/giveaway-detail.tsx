import { useParams, useLocation } from "wouter";
import { useState } from "react";
import { useAuth } from "@clerk/react";
import {
  useGetGiveaway,
  useGetGiveawayEntries,
  useStartGiveaway,
  useEndGiveaway,
  useRestartGiveaway,
  useAddGiveawayEntry,
  useDeleteGiveawayEntry,
  useGetBotSettings,
  getGetBotSettingsQueryKey,
  getGetGiveawayQueryKey,
  getGetGiveawayEntriesQueryKey,
  getGetCurrentGiveawayQueryKey,
  getListGiveawaysQueryKey,
} from "@workspace/api-client-react";
import { Input } from "@/components/ui/input";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { Trophy, Users, Hash, Calendar, Play, Square, RotateCcw, ArrowLeft, Crown, Plus, X, BarChart2 } from "lucide-react";
import { Link } from "wouter";
import { EliminationWheel } from "@/components/elimination-wheel";

function getRarityClass(rarity?: string) {
  switch (rarity) {
    case "legendary": return "text-amber-400 border-amber-500/30 bg-amber-500/10";
    case "epic": return "text-purple-400 border-purple-500/30 bg-purple-500/10";
    case "rare": return "text-blue-400 border-blue-500/30 bg-blue-500/10";
    case "uncommon": return "text-green-400 border-green-500/30 bg-green-500/10";
    default: return "text-muted-foreground border-border bg-muted";
  }
}

export function GiveawayDetail() {
  const params = useParams<{ id: string }>();
  const id = Number(params.id);
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data, isLoading } = useGetGiveaway(id, {
    query: { enabled: !!id, queryKey: getGetGiveawayQueryKey(id) },
  });
  const { data: entries, isLoading: entriesLoading } = useGetGiveawayEntries(id, {
    query: { enabled: !!id, queryKey: getGetGiveawayEntriesQueryKey(id) },
  });

  const { getToken } = useAuth();
  const { data: analytics, isLoading: analyticsLoading } = useQuery({
    queryKey: ["giveaway-analytics", id],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch(`/api/giveaway/${id}/analytics`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return null;
      return res.json() as Promise<{
        totalEntries: number;
        totalTickets: number;
        manualTickets: number;
        redeemedTickets: number;
        redemptionCount: number;
        entryTimeline: Array<{ bucket: string; count: number }>;
      }>;
    },
    enabled: !!id,
    staleTime: 30_000,
  });

  const startMutation = useStartGiveaway();
  const endMutation = useEndGiveaway();
  // Issue #3: "Reroll Winner" replaced with "Restart Giveaway" — same
  // entries, status flips back to active, winner cleared. Feels less
  // adversarial than rerolling and lets chat keep entering.
  const restartMutation = useRestartGiveaway();
  const addEntryMutation = useAddGiveawayEntry();
  const deleteEntryMutation = useDeleteGiveawayEntry();
  // Wheel settings come from /api/settings; this hook is Clerk-authed via the global fetcher.
  const { isSignedIn } = useAuth();
  const { data: botSettings } = useGetBotSettings({
    query: { enabled: !!isSignedIn, queryKey: getGetBotSettingsQueryKey() },
  });
  const wheelMode = (botSettings?.wheelMode === "manual" ? "manual" : "auto") as "auto" | "manual";
  const wheelSpeed = (
    botSettings?.wheelSpeed === "slow" || botSettings?.wheelSpeed === "fast"
      ? botSettings.wheelSpeed
      : "medium"
  ) as "slow" | "medium" | "fast";

  const [wheelOpen, setWheelOpen] = useState(false);
  // Tracks whether the wheel actually ran an elimination this open (vs
  // the streamer dismissing without spinning). Used to decide whether to
  // refetch on close — avoids button flicker when nothing happened.
  const [didDraw, setDidDraw] = useState(false);
  // Inline manual-entry editor state for issue #4. Held local so we can
  // clear after a successful add.
  const [newEntryUsername, setNewEntryUsername] = useState("");

  function invalidateAll() {
    queryClient.invalidateQueries({ queryKey: getGetGiveawayQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetGiveawayEntriesQueryKey(id) });
    queryClient.invalidateQueries({ queryKey: getGetCurrentGiveawayQueryKey() });
    queryClient.invalidateQueries({ queryKey: getListGiveawaysQueryKey() });
  }

  function handleStart() {
    startMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Giveaway started!", description: "The goblin announced it in chat." });
        invalidateAll();
      },
      onError: () => toast({ title: "Failed to start", variant: "destructive" }),
    });
  }

  // Open the wheel WITHOUT touching the server. The wheel itself picks
  // the winner organically through eliminations; we only call the
  // server `end` mutation once the wheel reports the last contender
  // standing via `onWinnerDecided`. Closing via X without spinning
  // leaves the giveaway active.
  function handleEnd() {
    setDidDraw(false);
    setWheelOpen(true);
  }

  // Wheel finished — its last contender standing IS the winner. Tell
  // the server to record it. The server validates the username is in
  // the entries pool before writing.
  function handleWinnerDecided(username: string) {
    setDidDraw(true);
    endMutation.mutate(
      { id, data: { winnerUsername: username } },
      {
        onSuccess: () => {
          toast({ title: `Winner: ${username}`, description: "Recorded — chat has been notified." });
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Couldn't record winner";
          toast({ title: "Failed to record winner", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleWheelClose() {
    setWheelOpen(false);
    if (didDraw) invalidateAll();
  }

  function handleRestart() {
    restartMutation.mutate({ id }, {
      onSuccess: () => {
        toast({ title: "Giveaway restarted!", description: "Entries kept; chat can keep entering." });
        invalidateAll();
      },
      onError: (err: unknown) => {
        const msg = err instanceof Error ? err.message : "Failed to restart";
        toast({ title: "Couldn't restart", description: msg, variant: "destructive" });
      },
    });
  }

  function handleAddEntry(e: React.FormEvent) {
    e.preventDefault();
    const username = newEntryUsername.trim().toLowerCase();
    if (!username) return;
    addEntryMutation.mutate(
      { id, data: { username, tickets: 1 } },
      {
        onSuccess: () => {
          toast({ title: "Entry added", description: `${username} added with 1 ticket.` });
          setNewEntryUsername("");
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Couldn't add entry";
          toast({ title: "Add failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  function handleDeleteEntry(entryId: number, username: string) {
    deleteEntryMutation.mutate(
      { id, entryId },
      {
        onSuccess: () => {
          toast({ title: "Entry removed", description: `${username} removed.` });
          invalidateAll();
        },
        onError: (err: unknown) => {
          const msg = err instanceof Error ? err.message : "Couldn't remove entry";
          toast({ title: "Remove failed", description: msg, variant: "destructive" });
        },
      },
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 animate-in fade-in duration-300">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-32" />)}
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!data?.giveaway) {
    return (
      <div className="text-center py-24">
        <h2 className="text-2xl font-bold text-foreground mb-2">Giveaway not found</h2>
        <p className="text-muted-foreground mb-6">The goblin lost track of this one.</p>
        <Link href="/giveaway" className="text-primary hover:underline">Back to Horde</Link>
      </div>
    );
  }

  const giveaway = data.giveaway;
  const isPending = giveaway.status === "pending";
  const isActive = giveaway.status === "active";
  const isEnded = giveaway.status === "ended";

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div>
        <Link href="/giveaway" className="inline-flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors text-sm mb-4" data-testid="link-back">
          <ArrowLeft className="w-4 h-4" />
          Back to Horde
        </Link>
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 mb-2">
              <h1 className="text-4xl font-bold text-foreground">{giveaway.title}</h1>
              <StatusBadge status={giveaway.status} />
            </div>
            {giveaway.description && (
              <p className="text-muted-foreground text-lg">{giveaway.description}</p>
            )}
          </div>
          <div className="flex items-center gap-3 shrink-0">
            {isPending && (
              <Button
                onClick={handleStart}
                disabled={startMutation.isPending}
                className="bg-primary text-primary-foreground font-bold gap-2 shadow-[0_0_20px_rgba(255,180,0,0.25)]"
                data-testid="button-start-giveaway"
              >
                <Play className="w-4 h-4" />
                {startMutation.isPending ? "Starting..." : "Start Giveaway"}
              </Button>
            )}
            {isActive && (
              <Button
                onClick={handleEnd}
                disabled={endMutation.isPending}
                variant="destructive"
                className="font-bold gap-2"
                data-testid="button-end-giveaway"
              >
                <Square className="w-4 h-4" />
                {endMutation.isPending ? "Recording…" : "🎡 Spin Wheel"}
              </Button>
            )}
            {isEnded && (
              <Button
                onClick={handleRestart}
                disabled={restartMutation.isPending}
                variant="outline"
                className="font-bold gap-2 border-border hover:border-primary/50"
                data-testid="button-restart-giveaway"
              >
                <RotateCcw className="w-4 h-4" />
                {restartMutation.isPending ? "Restarting..." : "Restart Giveaway"}
              </Button>
            )}
          </div>
        </div>
      </div>

      <EliminationWheel
        open={wheelOpen}
        onClose={handleWheelClose}
        entries={(entries ?? []).map((e) => ({ id: e.id, username: e.username, tickets: e.tickets }))}
        mode={wheelMode}
        speed={wheelSpeed}
        flavorEnabled={botSettings?.eliminationFlavorEnabled ?? true}
        onWinnerDecided={handleWinnerDecided}
        recordingWinner={endMutation.isPending}
      />

      {/* Stats Row */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <InfoCard icon={<Trophy className="w-5 h-5 text-primary" />} label="Prize" value={giveaway.prize} />
        <InfoCard icon={<Hash className="w-5 h-5 text-blue-400" />} label="Keyword" value={`!${giveaway.keyword}`} mono />
        <InfoCard icon={<Users className="w-5 h-5 text-green-400" />} label="Entries" value={String(giveaway.entryCount)} mono />
        <InfoCard
          icon={<Calendar className="w-5 h-5 text-muted-foreground" />}
          label="Created"
          value={new Date(giveaway.createdAt).toLocaleDateString()}
        />
      </div>

      {/* Winner Banner */}
      {isEnded && giveaway.winnerUsername && (
        <div className="relative overflow-hidden rounded-xl border border-amber-500/30 bg-amber-500/5 p-6">
          <div className="absolute top-0 right-0 w-64 h-64 bg-amber-500/10 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none" />
          <div className="relative flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-amber-500/20 border border-amber-500/30 flex items-center justify-center shrink-0">
              <Crown className="w-8 h-8 text-amber-400" />
            </div>
            <div>
              <p className="text-sm text-amber-400/70 font-mono uppercase tracking-wider mb-1">Winner</p>
              <h2 className="text-3xl font-bold text-amber-400" data-testid="text-winner">{giveaway.winnerUsername}</h2>
              <p className="text-muted-foreground text-sm mt-1">Drawn from {giveaway.entryCount} entries &mdash; Prize: {giveaway.prize}</p>
            </div>
          </div>
        </div>
      )}

      {/* Entries List */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2 text-xl">
            <Users className="w-5 h-5 text-primary" />
            Entries
            <span className="ml-auto text-sm font-normal text-muted-foreground font-mono">{giveaway.entryCount} total</span>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {/* Issue #4: inline manual entry editor. Visible while the
              giveaway is open so the streamer can patch up missed chatters
              or add raid leaders by hand. Hidden once ended — restart
              first if you need to edit. */}
          {!isEnded && (
            <form onSubmit={handleAddEntry} className="flex items-center gap-2 px-6 py-3 border-b border-border/50 bg-muted/20">
              <Plus className="w-4 h-4 text-muted-foreground shrink-0" />
              <Input
                value={newEntryUsername}
                onChange={(e) => setNewEntryUsername(e.target.value)}
                placeholder="Add a username manually…"
                className="h-8 text-sm flex-1"
                data-testid="input-add-entry"
                disabled={addEntryMutation.isPending}
              />
              <Button
                type="submit"
                size="sm"
                disabled={!newEntryUsername.trim() || addEntryMutation.isPending}
                data-testid="button-add-entry"
              >
                {addEntryMutation.isPending ? "Adding…" : "Add Entry"}
              </Button>
            </form>
          )}
          {entriesLoading ? (
            <div className="p-6 space-y-3">
              {Array.from({ length: 5 }).map((_, i) => (
                <div key={i} className="flex items-center justify-between">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-24" />
                </div>
              ))}
            </div>
          ) : entries && entries.length > 0 ? (
            <div className="divide-y divide-border/50 max-h-[480px] overflow-y-auto">
              {entries.map((entry, index) => {
                const isWinner = entry.username === giveaway.winnerUsername;
                return (
                  <div
                    key={entry.id}
                    className={`flex items-center justify-between px-6 py-3.5 transition-colors ${isWinner ? "bg-amber-500/5" : "hover:bg-muted/30"}`}
                    data-testid={`row-entry-${entry.id}`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-muted-foreground w-6 text-right shrink-0">{index + 1}</span>
                      <span className={`font-medium ${isWinner ? "text-amber-400 font-bold" : "text-foreground"}`}>
                        {isWinner && <Crown className="w-3.5 h-3.5 inline mr-1.5 text-amber-400" />}
                        {entry.username}
                      </span>
                    </div>
                    <div className="flex items-center gap-4 text-sm text-muted-foreground">
                      <span className="font-mono">{entry.tickets} ticket{entry.tickets !== 1 ? "s" : ""}</span>
                      <span>{new Date(entry.enteredAt).toLocaleTimeString()}</span>
                      {!isEnded && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-7 w-7 text-muted-foreground hover:text-destructive"
                          onClick={() => handleDeleteEntry(entry.id, entry.username)}
                          disabled={deleteEntryMutation.isPending}
                          data-testid={`button-delete-entry-${entry.id}`}
                          title="Remove entry"
                        >
                          <X className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 text-muted-foreground">
              <Users className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>No entries yet. Start the giveaway and let chat type the keyword.</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entry Analytics */}
      <Card className="overflow-hidden border-border/50">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <BarChart2 className="w-4 h-4 text-primary" />
            Entry Analytics
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {analyticsLoading ? (
            <Skeleton className="h-24 w-full" />
          ) : !analytics ? (
            <p className="text-sm text-muted-foreground text-center py-4">No entries recorded yet.</p>
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{analytics.totalEntries}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Participants</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{analytics.totalTickets}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Total Tickets</p>
                </div>
                <div className="rounded-lg bg-muted/30 border border-border/50 p-3 text-center">
                  <p className="text-2xl font-bold text-foreground">{analytics.redemptionCount}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Coin Redemptions</p>
                </div>
              </div>
              {analytics.totalTickets > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Ticket Source</p>
                  <div className="flex h-2.5 rounded-full overflow-hidden gap-px">
                    <div
                      className="bg-primary"
                      style={{ width: `${Math.round((analytics.manualTickets / analytics.totalTickets) * 100)}%` }}
                      title={`Manual: ${analytics.manualTickets}`}
                    />
                    <div className="bg-amber-500 flex-1" title={`Redeemed: ${analytics.redeemedTickets}`} />
                  </div>
                  <div className="flex gap-4 text-xs text-muted-foreground">
                    <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-primary mr-1.5 align-middle" />Manual ({analytics.manualTickets})</span>
                    <span><span className="inline-block w-2.5 h-2.5 rounded-sm bg-amber-500 mr-1.5 align-middle" />Redeemed ({analytics.redeemedTickets})</span>
                  </div>
                </div>
              )}
              {analytics.entryTimeline.length > 1 && (
                <div className="space-y-1.5">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Entry Rate (5-min buckets)</p>
                  <div className="flex items-end gap-0.5 h-16">
                    {(() => {
                      const max = Math.max(...analytics.entryTimeline.map((b) => b.count), 1);
                      return analytics.entryTimeline.map((b, i) => (
                        <div
                          key={i}
                          className="flex-1 bg-primary/50 hover:bg-primary/80 rounded-t-sm transition-colors"
                          style={{ height: `${Math.max(8, (b.count / max) * 100)}%` }}
                          title={`${new Date(b.bucket).toLocaleTimeString()}: ${b.count} entries`}
                        />
                      ));
                    })()}
                  </div>
                </div>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function InfoCard({ icon, label, value, mono }: { icon: React.ReactNode; label: string; value: string; mono?: boolean }) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-4">
      <div className="flex items-center gap-2 text-sm text-muted-foreground mb-2">
        {icon}
        <span>{label}</span>
      </div>
      <p className={`text-lg font-bold text-foreground truncate ${mono ? "font-mono" : ""}`}>{value}</p>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "active") return <Badge className="bg-primary/20 text-primary border-primary/30 animate-pulse">ACTIVE</Badge>;
  if (status === "pending") return <Badge variant="outline" className="text-muted-foreground">PENDING</Badge>;
  if (status === "ended") return <Badge variant="secondary">ENDED</Badge>;
  return null;
}

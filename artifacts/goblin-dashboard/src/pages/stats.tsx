import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useToast } from "@/hooks/use-toast";
import {
  useGetStatsOverview,
  useGetCommandStats,
  useGetTopLooters,
  useGetEngagementReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { BarChart3, Trophy, Gem, Users, Zap, Gift, Command, Clock, Lightbulb, AlertTriangle, Download, Lock } from "lucide-react";
import { useSubscriptionTier, LockedHint } from "@/hooks/use-tier";
import { Link } from "wouter";

const RARITY_COLORS: Record<string, { bg: string; text: string; bar: string }> = {
  legendary: { bg: "bg-amber-500/10", text: "text-amber-400", bar: "bg-amber-500" },
  epic: { bg: "bg-purple-500/10", text: "text-purple-400", bar: "bg-purple-500" },
  rare: { bg: "bg-blue-500/10", text: "text-blue-400", bar: "bg-blue-500" },
  uncommon: { bg: "bg-green-500/10", text: "text-green-400", bar: "bg-green-500" },
  common: { bg: "bg-muted", text: "text-muted-foreground", bar: "bg-muted-foreground" },
};

type Range = "day" | "week" | "month" | "year" | "all";

export function Stats() {
  const [range, setRange] = useState<Range>("week");
  const [exportKind, setExportKind] = useState<"loot" | "commands" | "giveaways">("loot");
  const [exporting, setExporting] = useState(false);
  const { getToken } = useAuth();
  const { toast } = useToast();
  // CSV export + extended ledger ranges are gated behind the
  // "full-ledger-export" feature (Horde Master+). Free tier still sees
  // Day / Week with a locked hint pointing at upgrade.
  const { hasFeature: hasTierFeature } = useSubscriptionTier();
  const canExport = hasTierFeature("full-ledger-export");
  // Pin free users back to "week" if they had selected a paid range and
  // got downgraded — prevents stale state from masking the gate.
  const effectiveRange: Range = canExport
    ? range
    : range === "month" || range === "year" || range === "all"
      ? "week"
      : range;

  /**
   * Pull the CSV through an authed fetch, then trigger a synthetic download.
   * We deliberately don't open a new tab against `/api/stats/export?...`
   * — the proxy would not carry the Clerk Bearer token, so the route would
   * 401. The Blob → object URL → anchor click pattern survives the auth
   * gate and works in every browser we care about.
   */
  async function exportCsv() {
    if (!canExport) {
      toast({
        title: "Export is a paid feature",
        description: "Upgrade to Horde Master to download CSV ledger exports.",
        variant: "destructive",
      });
      return;
    }
    setExporting(true);
    try {
      const token = await getToken();
      const res = await fetch(`/api/stats/export?range=${effectiveRange}&kind=${exportKind}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`Export failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `goblin-loot-${exportKind}-${range}-${new Date().toISOString().slice(0, 10)}.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      toast({ title: "Export ready", description: `Downloaded ${exportKind} (${range}).` });
    } catch (err) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : "Try again in a moment.",
        variant: "destructive",
      });
    } finally {
      setExporting(false);
    }
  }

  const { data: overview, isLoading: overviewLoading } = useGetStatsOverview({ range: effectiveRange });
  const { data: commandStats, isLoading: commandsLoading } = useGetCommandStats({ range: effectiveRange });
  const { data: topLooters, isLoading: lootersLoading } = useGetTopLooters({ limit: 10, range: effectiveRange });
  const { data: engagement, isLoading: engagementLoading } = useGetEngagementReport({ range: effectiveRange });

  const maxCommandCount = commandStats ? Math.max(...commandStats.map((c) => c.usageCount), 1) : 1;
  const maxPoints = topLooters ? Math.max(...topLooters.map((u) => u.totalPoints), 1) : 1;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-primary">Ledger</h1>
          <p className="text-muted-foreground mt-2 text-lg">The goblin's full accounting of loot and chaos.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Tabs
            value={effectiveRange}
            onValueChange={(v) => {
              const next = v as Range;
              if (!canExport && (next === "month" || next === "year" || next === "all")) return;
              setRange(next);
            }}
          >
            <TabsList data-testid="tabs-stats-range">
              <TabsTrigger value="day">Day</TabsTrigger>
              <TabsTrigger value="week">Week</TabsTrigger>
              <TabsTrigger value="month" disabled={!canExport} title={!canExport ? "Horde Master required" : undefined}>
                Month {!canExport && <Lock className="inline w-3 h-3 ml-1 text-amber-400" />}
              </TabsTrigger>
              <TabsTrigger value="year" disabled={!canExport} title={!canExport ? "Horde Master required" : undefined}>
                Year {!canExport && <Lock className="inline w-3 h-3 ml-1 text-amber-400" />}
              </TabsTrigger>
              <TabsTrigger value="all" disabled={!canExport} title={!canExport ? "Horde Master required" : undefined}>
                All-time {!canExport && <Lock className="inline w-3 h-3 ml-1 text-amber-400" />}
              </TabsTrigger>
            </TabsList>
          </Tabs>
          <div className="flex items-center gap-2">
            <Select value={exportKind} onValueChange={(v) => setExportKind(v as "loot" | "commands" | "giveaways")}>
              <SelectTrigger className="w-[140px]" data-testid="select-export-kind" disabled={!canExport}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="loot">Loot drops</SelectItem>
                <SelectItem value="commands">Commands</SelectItem>
                <SelectItem value="giveaways">Giveaways</SelectItem>
              </SelectContent>
            </Select>
            {canExport ? (
              <Button
                type="button"
                variant="outline"
                onClick={exportCsv}
                disabled={exporting}
                data-testid="button-export-csv"
                className="gap-2"
              >
                <Download className="w-4 h-4" />
                {exporting ? "Exporting…" : "Export CSV"}
              </Button>
            ) : (
              // Locked state: single anchor (no nested interactive
              // elements — earlier we wrapped a `<LockedHint>` (also a
              // link) inside this `<Link>`, which is invalid markup and
              // breaks keyboard / screen-reader navigation).
              <Link
                href="/account?tab=rank"
                className="inline-flex items-center gap-2 px-3 py-2 rounded-md border border-amber-500/40 bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 text-sm font-semibold"
                data-testid="button-export-csv-locked"
                title="CSV export requires Horde Master+"
              >
                <Lock className="w-4 h-4" />
                Export CSV
                <span className="text-[10px] uppercase tracking-wide font-bold">
                  Horde Master+
                </span>
              </Link>
            )}
          </div>
        </div>
      </div>

      {/* Overview Cards */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <OverviewCard icon={<Gem className="w-5 h-5 text-primary" />} label="Loot Drops" value={overview?.totalLootDrops} loading={overviewLoading} />
        <OverviewCard icon={<Gift className="w-5 h-5 text-purple-400" />} label="Giveaways" value={overview?.totalGiveaways} loading={overviewLoading} />
        <OverviewCard icon={<Users className="w-5 h-5 text-green-400" />} label="Unique Looters" value={overview?.uniqueUsers} loading={overviewLoading} />
        <OverviewCard icon={<Zap className="w-5 h-5 text-blue-400" />} label="Commands Fired" value={overview?.totalCommandsUsed} loading={overviewLoading} />
        <OverviewCard icon={<Trophy className="w-5 h-5 text-amber-400" />} label="Entries Submitted" value={overview?.recentEntries} loading={overviewLoading} />
        <div className="bg-card border border-border/50 rounded-xl p-5 flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center">
            <Gift className="w-5 h-5 text-primary" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground uppercase tracking-wide font-mono mb-1">Active Giveaway</p>
            {overviewLoading ? (
              <Skeleton className="h-6 w-20" />
            ) : (
              <p className={`font-bold text-lg ${overview?.activeGiveaway ? "text-primary" : "text-muted-foreground"}`}>
                {overview?.activeGiveaway ? "RUNNING" : "NONE"}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Engagement Tips */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-400" />
            Engagement Tips
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-3">
          {engagementLoading ? (
            Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-16 w-full" />)
          ) : engagement && engagement.tips.length > 0 ? (
            engagement.tips.map((tip) => (
              <div
                key={tip.id}
                className={`flex gap-3 p-3 rounded-md border ${
                  tip.severity === "warn"
                    ? "border-destructive/30 bg-destructive/5"
                    : "border-border/50 bg-muted/20"
                }`}
                data-testid={`tip-${tip.id}`}
              >
                <div className="shrink-0 mt-0.5">
                  {tip.severity === "warn"
                    ? <AlertTriangle className="w-4 h-4 text-destructive" />
                    : <Lightbulb className="w-4 h-4 text-amber-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold text-foreground">{tip.title}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{tip.detail}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground text-center py-4">
              No data in this window — pick a wider range to see suggestions.
            </p>
          )}
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        {/* Top Looters */}
        <Card className="border-border/50">
          <CardHeader className="border-b border-border/50">
            <CardTitle className="flex items-center gap-2">
              <Trophy className="w-5 h-5 text-amber-400" />
              Top Looters
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {lootersLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : topLooters && topLooters.length > 0 ? (
              topLooters.map((user, index) => {
                const rarityStyle = RARITY_COLORS[user.bestRarity] ?? RARITY_COLORS["common"]!;
                const barWidth = (user.totalPoints / maxPoints) * 100;
                return (
                  <div key={user.username} className="space-y-1.5" data-testid={`row-looter-${index}`}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-muted-foreground w-5 text-right">{index + 1}</span>
                        <span className={`w-2 h-2 rounded-full ${rarityStyle.bar}`} />
                        <span className="font-bold text-foreground">{user.username}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        <span className="text-xs">{user.lootCount} drops</span>
                        <span className="font-mono font-bold text-foreground">{user.totalPoints.toLocaleString()} coins</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className={`h-full rounded-full transition-all duration-500 ${rarityStyle.bar}`}
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <Trophy className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No loot data in this window.</p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Command Usage */}
        <Card className="border-border/50">
          <CardHeader className="border-b border-border/50">
            <CardTitle className="flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-blue-400" />
              Command Usage
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6 space-y-4">
            {commandsLoading ? (
              Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)
            ) : commandStats && commandStats.length > 0 ? (
              commandStats.map((cmd) => {
                const barWidth = (cmd.usageCount / maxCommandCount) * 100;
                return (
                  <div key={cmd.command} className="space-y-1.5" data-testid={`row-command-${cmd.command.replace("!", "")}`}>
                    <div className="flex items-center justify-between text-sm">
                      <div className="flex items-center gap-2">
                        <Command className="w-3.5 h-3.5 text-muted-foreground" />
                        <span className="font-mono font-bold text-foreground">{cmd.command}</span>
                      </div>
                      <div className="flex items-center gap-3 text-muted-foreground">
                        {cmd.lastUsedAt && (
                          <span className="text-xs flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(cmd.lastUsedAt).toLocaleTimeString()}
                          </span>
                        )}
                        <span className="font-mono font-bold text-foreground">{cmd.usageCount}x</span>
                      </div>
                    </div>
                    <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                      <div
                        className="h-full rounded-full bg-blue-500 transition-all duration-500"
                        style={{ width: `${barWidth}%` }}
                      />
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                <BarChart3 className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p>No command activity in this window.</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

function OverviewCard({ icon, label, value, loading }: { icon: React.ReactNode; label: string; value?: number; loading: boolean }) {
  return (
    <div className="bg-card border border-border/50 rounded-xl p-5">
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-muted-foreground uppercase tracking-wide font-mono">{label}</p>
        <div className="w-8 h-8 rounded-md bg-background border border-border flex items-center justify-center">
          {icon}
        </div>
      </div>
      {loading ? (
        <Skeleton className="h-8 w-20" />
      ) : (
        <p className="text-3xl font-bold font-mono tracking-tight">{value?.toLocaleString() ?? 0}</p>
      )}
    </div>
  );
}

import { useState } from "react";
import {
  useGetStatsOverview,
  useGetCommandStats,
  useGetTopLooters,
  useGetEngagementReport,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart3, Trophy, Gem, Users, Zap, Gift, Command, Clock, Lightbulb, AlertTriangle } from "lucide-react";

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

  const { data: overview, isLoading: overviewLoading } = useGetStatsOverview({ range });
  const { data: commandStats, isLoading: commandsLoading } = useGetCommandStats({ range });
  const { data: topLooters, isLoading: lootersLoading } = useGetTopLooters({ limit: 10, range });
  const { data: engagement, isLoading: engagementLoading } = useGetEngagementReport({ range });

  const maxCommandCount = commandStats ? Math.max(...commandStats.map((c) => c.usageCount), 1) : 1;
  const maxPoints = topLooters ? Math.max(...topLooters.map((u) => u.totalPoints), 1) : 1;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-primary">Ledger</h1>
          <p className="text-muted-foreground mt-2 text-lg">The goblin's full accounting of loot and chaos.</p>
        </div>
        <Tabs value={range} onValueChange={(v) => setRange(v as Range)}>
          <TabsList data-testid="tabs-stats-range">
            <TabsTrigger value="day">Day</TabsTrigger>
            <TabsTrigger value="week">Week</TabsTrigger>
            <TabsTrigger value="month">Month</TabsTrigger>
            <TabsTrigger value="year">Year</TabsTrigger>
            <TabsTrigger value="all">All-time</TabsTrigger>
          </TabsList>
        </Tabs>
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

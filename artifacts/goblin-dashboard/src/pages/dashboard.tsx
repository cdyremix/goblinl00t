import { useGetBotStatus, useGetStatsOverview, useGetRecentLoot, useGetCurrentGiveaway } from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AlertCircle, CheckCircle2, ShieldAlert, Sparkles, Gem, ArrowRight, Activity, Users, Zap } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Link } from "wouter";

export function Dashboard() {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: botStatus, isLoading: botLoading } = useGetBotStatus({ query: { refetchInterval: 10000 } as any });
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: currentGiveaway, isLoading: giveawayLoading } = useGetCurrentGiveaway({ query: { refetchInterval: 10000 } as any });
  
  const { data: stats, isLoading: statsLoading } = useGetStatsOverview();
  const { data: recentLoot, isLoading: lootLoading } = useGetRecentLoot({ limit: 10 });

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-4xl font-bold tracking-tight text-primary">Operations Center</h1>
          <p className="text-muted-foreground mt-2 text-lg">The heart of the goblin cave.</p>
        </div>

        <div className="flex items-center gap-3 bg-card px-4 py-2 rounded-full border border-border">
          <Activity className="w-5 h-5 text-muted-foreground" />
          <div className="flex flex-col">
            <span className="text-xs text-muted-foreground uppercase tracking-wider font-mono">Status</span>
            {botLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : botStatus?.connected ? (
              <span className="flex items-center gap-2 text-green-500 font-bold tracking-wide" data-testid="status-connected">
                <span className="relative flex h-2.5 w-2.5">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-green-500"></span>
                </span>
                ONLINE
              </span>
            ) : (
              <span className="flex items-center gap-2 text-destructive font-bold tracking-wide" data-testid="status-disconnected">
                <AlertCircle className="w-3.5 h-3.5" />
                OFFLINE
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Top Stats Row */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <StatCard 
          title="Total Loot Dropped" 
          value={stats?.totalLootDrops} 
          icon={<Gem className="w-5 h-5 text-primary" />} 
          loading={statsLoading} 
        />
        <StatCard 
          title="Giveaways Run" 
          value={stats?.totalGiveaways} 
          icon={<GiftIcon />} 
          loading={statsLoading} 
        />
        <StatCard 
          title="Unique Looters" 
          value={stats?.uniqueUsers} 
          icon={<Users className="w-5 h-5 text-secondary" />} 
          loading={statsLoading} 
        />
        <StatCard 
          title="Recent Entries" 
          value={stats?.recentEntries} 
          icon={<Zap className="w-5 h-5 text-accent" />} 
          loading={statsLoading} 
        />
      </div>

      <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
        <div className="xl:col-span-2 space-y-8">
          {/* Active Giveaway Panel */}
          <Card className="border-primary/20 shadow-[0_0_30px_rgba(255,180,0,0.05)] overflow-hidden relative">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/4 pointer-events-none"></div>
            <CardHeader className="border-b border-border/50 bg-card/50">
              <div className="flex items-center justify-between">
                <CardTitle className="text-xl flex items-center gap-2">
                  <Sparkles className="w-5 h-5 text-primary" />
                  Current Hoard
                </CardTitle>
                {currentGiveaway?.giveaway ? (
                  <Badge variant="outline" className="bg-primary/10 text-primary border-primary/20 animate-pulse">ACTIVE</Badge>
                ) : (
                  <Badge variant="outline" className="bg-muted text-muted-foreground">IDLE</Badge>
                )}
              </div>
            </CardHeader>
            <CardContent className="p-6">
              {giveawayLoading ? (
                <div className="space-y-4">
                  <Skeleton className="h-8 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                </div>
              ) : currentGiveaway?.giveaway ? (
                <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
                  <div>
                    <h3 className="text-3xl font-bold text-foreground mb-2">{currentGiveaway.giveaway.title}</h3>
                    <p className="text-xl text-primary font-medium mb-4">Prize: {currentGiveaway.giveaway.prize}</p>
                    <div className="flex items-center gap-4 text-sm">
                      <div className="bg-muted px-3 py-1.5 rounded-md border border-border">
                        <span className="text-muted-foreground">Keyword: </span>
                        <span className="font-mono text-foreground font-bold">{currentGiveaway.giveaway.keyword}</span>
                      </div>
                      <div className="bg-muted px-3 py-1.5 rounded-md border border-border">
                        <span className="text-muted-foreground">Entries: </span>
                        <span className="font-mono text-foreground font-bold">{currentGiveaway.giveaway.entryCount}</span>
                      </div>
                    </div>
                  </div>
                  <Link href={`/giveaway/${currentGiveaway.giveaway.id}`} className="group flex items-center gap-2 bg-primary text-primary-foreground px-6 py-3 rounded-lg font-bold hover:brightness-110 transition-all shadow-[0_0_20px_rgba(255,180,0,0.3)]">
                    Manage Run
                    <ArrowRight className="w-4 h-4 group-hover:translate-x-1 transition-transform" />
                  </Link>
                </div>
              ) : (
                <div className="text-center py-12">
                  <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mx-auto mb-4 border border-border/50">
                    <GiftIcon className="w-8 h-8 text-muted-foreground/50" />
                  </div>
                  <h3 className="text-xl font-bold text-foreground mb-2">No active giveaways</h3>
                  <p className="text-muted-foreground mb-6 max-w-md mx-auto">The goblin is sleeping on the pile. Time to wake him up and give away some loot.</p>
                  <Link href="/giveaway" className="inline-flex items-center gap-2 bg-card border border-border hover:border-primary/50 text-foreground px-6 py-3 rounded-lg font-bold transition-all">
                    Start New Giveaway
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        {/* Live Loot Feed */}
        <div className="xl:col-span-1">
          <Card className="h-full flex flex-col border-border/50">
            <CardHeader className="border-b border-border/50 pb-4">
              <CardTitle className="text-lg flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-accent animate-pulse"></div>
                Live Loot Feed
              </CardTitle>
            </CardHeader>
            <CardContent className="p-0 flex-1 overflow-hidden relative">
              <div className="absolute inset-0 overflow-y-auto p-4 space-y-3 custom-scrollbar">
                {lootLoading ? (
                  Array.from({ length: 5 }).map((_, i) => (
                    <div key={i} className="flex gap-3 items-center p-3 rounded-md bg-muted/50 border border-border/50">
                      <Skeleton className="w-10 h-10 rounded-md" />
                      <div className="space-y-2 flex-1">
                        <Skeleton className="h-4 w-24" />
                        <Skeleton className="h-3 w-32" />
                      </div>
                    </div>
                  ))
                ) : recentLoot && recentLoot.length > 0 ? (
                  recentLoot.map((drop) => (
                    <div key={drop.id} className="flex gap-3 items-start p-3 rounded-md bg-card border border-border/50 hover:border-border transition-colors">
                      <div className={`w-10 h-10 rounded-md flex items-center justify-center border shrink-0 ${getRarityColors(drop.rarity)}`}>
                        <Gem className="w-5 h-5" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-bold text-foreground truncate">{drop.username}</span>
                          <span className="text-xs font-mono text-muted-foreground shrink-0">{new Date(drop.droppedAt).toLocaleTimeString()}</span>
                        </div>
                        <p className="text-sm text-muted-foreground truncate mt-0.5">Found <span className="text-foreground">{drop.item}</span></p>
                      </div>
                    </div>
                  ))
                ) : (
                  <div className="text-center py-8 text-muted-foreground">
                    <p>No recent loot drops.</p>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function StatCard({ title, value, icon, loading }: { title: string, value?: number, icon: React.ReactNode, loading: boolean }) {
  return (
    <Card className="border-border/50 bg-card/50">
      <CardContent className="p-6">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-medium text-muted-foreground">{title}</h3>
          <div className="p-2 bg-background rounded-md border border-border">
            {icon}
          </div>
        </div>
        {loading ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-3xl font-bold font-mono tracking-tight">{value?.toLocaleString() || 0}</div>
        )}
      </CardContent>
    </Card>
  );
}

function getRarityColors(rarity: string) {
  switch(rarity.toLowerCase()) {
    case 'legendary': return 'bg-amber-500/10 text-amber-500 border-amber-500/30';
    case 'epic': return 'bg-purple-500/10 text-purple-500 border-purple-500/30';
    case 'rare': return 'bg-blue-500/10 text-blue-500 border-blue-500/30';
    case 'uncommon': return 'bg-green-500/10 text-green-500 border-green-500/30';
    default: return 'bg-gray-500/10 text-gray-400 border-gray-500/30';
  }
}

function GiftIcon(props: React.SVGProps<SVGSVGElement>) {
  return (
    <svg
      {...props}
      xmlns="http://www.w3.org/2000/svg"
      width="24"
      height="24"
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

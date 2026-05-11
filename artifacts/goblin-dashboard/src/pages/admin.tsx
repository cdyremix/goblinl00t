import { useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Crown, Search, Shield, Sword, Tv, Box, Coins, RefreshCw, AlertTriangle } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";

type Tier = "free" | "premium" | "pro";

interface AdminUser {
  id: number;
  clerkUserId: string;
  twitchUsername: string | null;
  twitchUserId: string | null;
  steamUsername: string | null;
  steamId64: string | null;
  subscriptionTier: Tier;
  tierSelected: boolean;
  isAdmin: boolean;
  botTheme: string;
  botName: string;
  goblinEventsEnabled: boolean;
  lootDropsEnabled: boolean;
  coinRedemptionEnabled: boolean;
  coinCap: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
}

interface AdminStats {
  total: number;
  free: number;
  premium: number;
  pro: number;
  twitchLinked: number;
  steamLinked: number;
  admins: number;
}

const TIER_BADGE: Record<Tier, { label: string; className: string; icon: React.ReactNode }> = {
  free: { label: "Free", className: "bg-muted text-muted-foreground border-border", icon: <Shield className="w-3 h-3" /> },
  premium: { label: "Premium", className: "bg-purple-500/15 text-purple-300 border-purple-500/40", icon: <Sword className="w-3 h-3" /> },
  pro: { label: "Pro", className: "bg-amber-500/15 text-amber-300 border-amber-500/40", icon: <Crown className="w-3 h-3" /> },
};

export function Admin() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [filter, setFilter] = useState("");

  async function authedFetch(url: string, init: RequestInit = {}) {
    const token = await getToken();
    return fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  }

  const usersQuery = useQuery<{ users: AdminUser[] }>({
    queryKey: ["admin", "users"],
    queryFn: async () => {
      const r = await authedFetch("/api/admin/users");
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return r.json();
    },
  });

  const statsQuery = useQuery<{ stats: AdminStats | null }>({
    queryKey: ["admin", "stats"],
    queryFn: async () => {
      const r = await authedFetch("/api/admin/stats");
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return r.json();
    },
  });

  const patchMutation = useMutation({
    mutationFn: async ({ id, body }: { id: number; body: Partial<AdminUser> }) => {
      const r = await authedFetch(`/api/admin/users/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Update failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin", "users"] });
      qc.invalidateQueries({ queryKey: ["admin", "stats"] });
      toast({ title: "User updated", description: "Changes saved." });
    },
    onError: (err: Error) =>
      toast({ title: "Update failed", description: err.message, variant: "destructive" }),
  });

  const filtered = useMemo(() => {
    const all = usersQuery.data?.users ?? [];
    const q = filter.trim().toLowerCase();
    if (!q) return all;
    return all.filter((u) =>
      [u.twitchUsername, u.steamUsername, u.clerkUserId, u.botName]
        .filter(Boolean)
        .some((s) => s!.toLowerCase().includes(q)),
    );
  }, [usersQuery.data, filter]);

  const stats = statsQuery.data?.stats;

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary flex items-center gap-3">
            <Crown className="w-9 h-9 text-amber-400" />
            Admin Console
          </h1>
          <p className="text-muted-foreground mt-2 text-lg">
            Super-user controls for the entire Goblin L00t roster.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            qc.invalidateQueries({ queryKey: ["admin"] });
          }}
        >
          <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total streamers" value={stats?.total ?? "—"} icon={<Box className="w-4 h-4" />} />
        <StatCard label="Twitch linked" value={stats?.twitchLinked ?? "—"} icon={<Tv className="w-4 h-4" />} />
        <StatCard label="Premium subs" value={stats?.premium ?? "—"} icon={<Sword className="w-4 h-4 text-purple-400" />} />
        <StatCard label="Pro subs" value={stats?.pro ?? "—"} icon={<Crown className="w-4 h-4 text-amber-400" />} />
      </div>

      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2 font-medieval text-xl">
            <Shield className="w-5 h-5 text-primary" />
            Streamers
          </CardTitle>
          <div className="relative max-w-sm">
            <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Filter by Twitch handle, Steam, Clerk ID…"
              className="pl-8"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              data-testid="input-admin-filter"
            />
          </div>
        </CardHeader>
        <CardContent className="p-0">
          {usersQuery.isLoading ? (
            <div className="p-8 text-sm text-muted-foreground text-center">Loading…</div>
          ) : usersQuery.error ? (
            <div className="p-8 text-sm text-destructive text-center flex items-center justify-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              {(usersQuery.error as Error).message}
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-sm text-muted-foreground text-center">No matching users.</div>
          ) : (
            <div className="divide-y divide-border/60">
              {filtered.map((u) => (
                <UserRow
                  key={u.id}
                  user={u}
                  saving={patchMutation.isPending}
                  onPatch={(body) => patchMutation.mutate({ id: u.id, body })}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, icon }: { label: string; value: number | string; icon: React.ReactNode }) {
  return (
    <Card className="border-border/50">
      <CardContent className="p-4 flex items-center justify-between">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted-foreground font-mono">{label}</p>
          <p className="text-2xl font-bold text-foreground mt-0.5">{value}</p>
        </div>
        <div className="w-8 h-8 rounded-md bg-muted flex items-center justify-center text-muted-foreground">{icon}</div>
      </CardContent>
    </Card>
  );
}

function UserRow({
  user,
  saving,
  onPatch,
}: {
  user: AdminUser;
  saving: boolean;
  onPatch: (body: Partial<AdminUser>) => void;
}) {
  const tier = (user.subscriptionTier in TIER_BADGE ? user.subscriptionTier : "free") as Tier;
  const badge = TIER_BADGE[tier];
  return (
    <div className="px-5 py-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-foreground">
            {user.twitchUsername ?? <span className="italic text-muted-foreground">unlinked</span>}
          </p>
          <Badge className={`gap-1 text-[10px] ${badge.className}`} variant="outline">
            {badge.icon}
            {badge.label}
          </Badge>
          {user.isAdmin && (
            <Badge className="gap-1 text-[10px] bg-amber-500/20 text-amber-300 border-amber-500/40" variant="outline">
              <Crown className="w-3 h-3" />
              ADMIN
            </Badge>
          )}
          {user.stripeSubscriptionId && (
            <Badge variant="outline" className="text-[10px]">
              Stripe sub
            </Badge>
          )}
        </div>
        <div className="mt-1 text-xs text-muted-foreground space-y-0.5">
          <p className="font-mono truncate">{user.clerkUserId}</p>
          <div className="flex items-center gap-3 flex-wrap">
            {user.steamUsername && <span>Steam: {user.steamUsername}</span>}
            <span>Bot: {user.botName} ({user.botTheme})</span>
            <span className="flex items-center gap-1"><Coins className="w-3 h-3" /> Cap: {user.coinCap ?? "∞"}</span>
            <span>Joined: {new Date(user.createdAt).toLocaleDateString()}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-3 shrink-0">
        <div className="flex flex-col gap-1">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">Tier</label>
          <Select
            value={tier}
            onValueChange={(value) => onPatch({ subscriptionTier: value as Tier })}
            disabled={saving}
          >
            <SelectTrigger className="h-8 w-[120px] text-xs" data-testid={`select-tier-${user.id}`}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="free">Free</SelectItem>
              <SelectItem value="premium">Premium</SelectItem>
              <SelectItem value="pro">Pro</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex flex-col gap-1 items-center">
          <label className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">Admin</label>
          <Switch
            checked={user.isAdmin}
            disabled={saving}
            onCheckedChange={(v) => onPatch({ isAdmin: v })}
            aria-label="Toggle admin"
            data-testid={`switch-admin-${user.id}`}
          />
        </div>
      </div>
    </div>
  );
}

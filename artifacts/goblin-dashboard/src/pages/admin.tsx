import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown, Search, Shield, Sword, Tv, Box, Coins, RefreshCw, AlertTriangle, Trash2,
  Pencil, Mail, Key, Receipt, ExternalLink, Loader2, Wrench, Lock, UserPlus, Eye, EyeOff,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  total: number; free: number; premium: number; pro: number;
  twitchLinked: number; steamLinked: number; admins: number;
}

interface AdminUserDetail {
  user: AdminUser;
  clerk: {
    email: string | null;
    firstName: string | null;
    lastName: string | null;
    createdAt: number | null;
    lastSignInAt: number | null;
  } | null;
  subscription: {
    id: string;
    status: string;
    currentPeriodEnd: number;
    cancelAtPeriodEnd: boolean;
    productName: string;
    tier: string | null;
    unitAmount: number | null;
    currency: string;
    interval: string | null;
  } | null;
}

interface AdminInvoice {
  id: string;
  number: string | null;
  status: string;
  amountPaid: number;
  amountDue: number;
  amountRefunded: number;
  currency: string;
  createdAt: number;
  hostedInvoiceUrl: string | null;
  invoicePdf: string | null;
  chargeId: string | null;
  refundable: boolean;
}

const TIER_BADGE: Record<Tier, { label: string; className: string; icon: React.ReactNode }> = {
  free: { label: "Free", className: "bg-muted text-muted-foreground border-border", icon: <Shield className="w-3 h-3" /> },
  premium: { label: "Premium", className: "bg-purple-500/15 text-purple-300 border-purple-500/40", icon: <Sword className="w-3 h-3" /> },
  pro: { label: "Pro", className: "bg-amber-500/15 text-amber-300 border-amber-500/40", icon: <Crown className="w-3 h-3" /> },
};

// Shared authedFetch outside the component so the Edit dialog (which lives
// in its own component tree) can reuse it without prop-drilling getToken.
function useAuthedFetch() {
  const { getToken } = useAuth();
  return async (url: string, init: RequestInit = {}) => {
    const token = await getToken();
    return fetch(url, {
      ...init,
      headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` },
    });
  };
}

function fmtMoney(amountCents: number, currency: string) {
  try {
    return new Intl.NumberFormat(undefined, { style: "currency", currency: currency.toUpperCase() })
      .format(amountCents / 100);
  } catch {
    return `${(amountCents / 100).toFixed(2)} ${currency.toUpperCase()}`;
  }
}

export function Admin() {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  const [filter, setFilter] = useState("");
  const [editingId, setEditingId] = useState<number | null>(null);
  const [deletingUser, setDeletingUser] = useState<AdminUser | null>(null);
  const [creatingUser, setCreatingUser] = useState(false);
  const { toast } = useToast();

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

  const deleteMutation = useMutation({
    mutationFn: async (id: number) => {
      const r = await authedFetch(`/api/admin/users/${id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Delete failed");
      }
      return r.json();
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      toast({ title: "User deleted", description: "Account removed from Clerk and Stripe." });
    },
    onError: (err: Error) =>
      toast({ title: "Delete failed", description: err.message, variant: "destructive" }),
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
          onClick={async () => {
            // Use refetch (rather than invalidateQueries) so the button
            // gets a real promise to await — that's what drives the
            // spinner via isFetching, and it surfaces errors as toasts
            // instead of silently failing.
            try {
              await Promise.all([usersQuery.refetch(), statsQuery.refetch()]);
            } catch (err) {
              const msg = err instanceof Error ? err.message : "Refresh failed";
              toast({ title: "Refresh failed", description: msg, variant: "destructive" });
            }
          }}
          disabled={usersQuery.isFetching || statsQuery.isFetching}
          data-testid="button-admin-refresh"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 mr-1.5 ${usersQuery.isFetching || statsQuery.isFetching ? "animate-spin" : ""}`}
          />
          Refresh
        </Button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Total streamers" value={stats?.total ?? "—"} icon={<Box className="w-4 h-4" />} />
        <StatCard label="Twitch linked" value={stats?.twitchLinked ?? "—"} icon={<Tv className="w-4 h-4" />} />
        <StatCard label="Premium subs" value={stats?.premium ?? "—"} icon={<Sword className="w-4 h-4 text-purple-400" />} />
        <StatCard label="Pro subs" value={stats?.pro ?? "—"} icon={<Crown className="w-4 h-4 text-amber-400" />} />
      </div>

      <MaintenanceToggleCard />

      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <CardTitle className="flex items-center gap-2 font-medieval text-xl">
              <Shield className="w-5 h-5 text-primary" />
              Streamers
            </CardTitle>
            <Button
              size="sm"
              onClick={() => setCreatingUser(true)}
              data-testid="button-admin-create-user"
            >
              <UserPlus className="w-3.5 h-3.5 mr-1.5" /> Create user
            </Button>
          </div>
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
                  onEdit={() => setEditingId(u.id)}
                  onDelete={() => setDeletingUser(u)}
                />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <CreateUserDialog
        open={creatingUser}
        onClose={() => setCreatingUser(false)}
        onCreated={() => {
          qc.invalidateQueries({ queryKey: ["admin"] });
          setCreatingUser(false);
        }}
      />

      {/* Edit dialog — fetches the enriched user detail on open. Mounted
          here so opening it doesn't reset the filter / scroll position. */}
      {editingId !== null && (
        <EditUserDialog
          userId={editingId}
          onClose={() => setEditingId(null)}
        />
      )}

      <AlertDialog
        open={deletingUser !== null}
        onOpenChange={(v) => !v && setDeletingUser(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this account?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes <span className="font-bold">{deletingUser?.twitchUsername ?? deletingUser?.clerkUserId}</span> from Clerk and the
              Goblin L00t database, and cancels their Stripe subscription if one is
              active. Chat history (loot, redemptions, leaderboards) is preserved
              by channel name. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete">Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete"
              onClick={() => {
                if (!deletingUser) return;
                deleteMutation.mutate(deletingUser.id);
                setDeletingUser(null);
              }}
            >
              Delete account
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

/**
 * Toggles the public-facing maintenance wall on/off. Persists to the
 * `app_settings` singleton via `/admin/maintenance`. When the deploy
 * env has `MAINTENANCE_MODE` truthy, the env override wins server-side
 * and we lock the switch + show why so the admin doesn't think it's
 * broken when their click "doesn't take".
 */
function MaintenanceToggleCard() {
  const { getToken } = useAuth();
  const qc = useQueryClient();
  const { toast } = useToast();

  const stateQuery = useQuery<{ enabled: boolean; envOverride: boolean }>({
    queryKey: ["admin", "maintenance"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/admin/maintenance", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load maintenance state");
      return res.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async (enabled: boolean) => {
      const token = await getToken();
      const res = await fetch("/api/admin/maintenance", {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ enabled }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? "Failed to update maintenance mode");
      }
      return json as { enabled: boolean; envOverride: boolean };
    },
    onSuccess: (json) => {
      qc.setQueryData(["admin", "maintenance"], json);
      // Bust the public status query so the admin's own banner / wall
      // reflects the new state without a manual refresh.
      qc.invalidateQueries({ queryKey: ["maintenance", "status"] });
      toast({
        title: json.enabled ? "Maintenance mode ON" : "Maintenance mode OFF",
        description: json.enabled
          ? "Public visitors will see the launch wall."
          : "Site is now public.",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Could not update", description: err.message, variant: "destructive" });
    },
  });

  const enabled = stateQuery.data?.enabled ?? false;
  const envOverride = stateQuery.data?.envOverride ?? false;
  const loading = stateQuery.isLoading;

  return (
    <Card className="border-border/50">
      <CardHeader className="border-b border-border/50">
        <CardTitle className="flex items-center gap-2 font-medieval text-xl">
          <Wrench className="w-5 h-5 text-amber-400" />
          Maintenance Mode
        </CardTitle>
      </CardHeader>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <Label htmlFor="maintenance-toggle" className="text-base font-semibold">
                Public launch wall
              </Label>
              {enabled ? (
                <Badge variant="default" className="bg-amber-500 text-black hover:bg-amber-500">
                  ON
                </Badge>
              ) : (
                <Badge variant="outline" className="text-muted-foreground">
                  OFF
                </Badge>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              When ON, public visitors see the "Goblin L00t is testing" modal with the
              notify-me email form. Admins (you) bypass it automatically. Sign-in stays
              reachable so you can keep working.
            </p>
            {envOverride && (
              <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-300">
                <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  The <code className="px-1 py-0.5 rounded bg-black/30">MAINTENANCE_MODE</code> env var
                  is forcing this ON. Toggling here is disabled until that env var is
                  unset on the server.
                </span>
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            {(toggle.isPending || loading) && (
              <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
            )}
            <Switch
              id="maintenance-toggle"
              checked={enabled}
              disabled={loading || envOverride || toggle.isPending}
              onCheckedChange={(v) => toggle.mutate(v)}
              data-testid="switch-maintenance-mode"
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Provisions a new streamer account: creates the Clerk user (email +
 * password) and the matching DB row in one shot. Optional Twitch handle
 * pre-fills the row but does NOT bind `twitchUserId` — the streamer
 * still has to complete OAuth themselves before the bot can act as them.
 */
function CreateUserDialog({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: () => void;
}) {
  const authedFetch = useAuthedFetch();
  const { toast } = useToast();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [twitchUsername, setTwitchUsername] = useState("");
  const [tier, setTier] = useState<Tier>("free");
  const [isAdmin, setIsAdmin] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  // Reset the form whenever the dialog re-opens so a previous attempt's
  // half-typed values don't bleed into the next create flow.
  useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
      setTwitchUsername("");
      setTier("free");
      setIsAdmin(false);
      setShowPassword(false);
    }
  }, [open]);

  const create = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          password,
          twitchUsername: twitchUsername.trim() || null,
          subscriptionTier: tier,
          isAdmin,
        }),
      });
      const json = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(json?.error ?? `Create failed (${r.status})`);
      return json;
    },
    onSuccess: () => {
      toast({ title: "User created", description: `${email} can now sign in.` });
      onCreated();
    },
    onError: (err: Error) => {
      toast({ title: "Create failed", description: err.message, variant: "destructive" });
    },
  });

  function genTempPassword() {
    // 20 chars from a balanced alphabet, drawn via crypto.getRandomValues
    // so the temp credential isn't predictable. Math.random would be
    // acceptable for a "shared once + rotated" temp password but using
    // CSPRNG costs nothing and removes the foot-gun for any future
    // reuse of this helper.
    const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789!@#$%^&*";
    const buf = new Uint32Array(20);
    crypto.getRandomValues(buf);
    let out = "";
    for (let i = 0; i < buf.length; i++) {
      out += chars[buf[i]! % chars.length];
    }
    setPassword(out);
    // Surface it briefly so the admin can copy/share — they explicitly
    // asked for a generated password, so masking the result of a
    // generate-click would be more annoying than protective.
    setShowPassword(true);
  }

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim() || password.length < 8) return;
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-medieval">
            <UserPlus className="w-5 h-5 text-amber-400" />
            Create user
          </DialogTitle>
          <DialogDescription>
            Provisions a Clerk account + a matching DB row. The user can sign in
            immediately with the email + password you set here.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={onSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input
              id="create-email"
              type="email"
              required
              autoComplete="off"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="streamer@example.com"
              data-testid="input-create-email"
            />
          </div>

          <div className="space-y-1.5">
            <div className="flex items-center justify-between">
              <Label htmlFor="create-password">Password</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs"
                onClick={genTempPassword}
                data-testid="button-create-password-generate"
              >
                Generate
              </Button>
            </div>
            <div className="relative">
              <Input
                id="create-password"
                type={showPassword ? "text" : "password"}
                required
                minLength={8}
                autoComplete="new-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="At least 8 chars"
                className="pr-10 font-mono"
                data-testid="input-create-password"
              />
              <button
                type="button"
                onClick={() => setShowPassword((s) => !s)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
            <p className="text-xs text-muted-foreground">
              Share this with the user. They can change it from their account page.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-twitch">Twitch handle (optional)</Label>
            <Input
              id="create-twitch"
              value={twitchUsername}
              onChange={(e) => setTwitchUsername(e.target.value)}
              placeholder="goblinl00t"
              data-testid="input-create-twitch"
            />
            <p className="text-xs text-muted-foreground">
              Pre-fills the row. The user still needs to complete Twitch OAuth from
              their account page before the bot can authenticate as them.
            </p>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="create-tier">Tier</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                <SelectTrigger id="create-tier" data-testid="select-create-tier">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-col justify-end">
              <Label className="flex items-center gap-2 cursor-pointer">
                <Switch
                  checked={isAdmin}
                  onCheckedChange={setIsAdmin}
                  data-testid="switch-create-admin"
                />
                <span className="text-sm">Super admin</span>
              </Label>
            </div>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !email.trim() || password.length < 8}
              data-testid="button-create-submit"
            >
              {create.isPending ? (
                <Loader2 className="w-4 h-4 mr-1.5 animate-spin" />
              ) : (
                <UserPlus className="w-4 h-4 mr-1.5" />
              )}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
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
  onEdit,
  onDelete,
}: {
  user: AdminUser;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const tier = (user.subscriptionTier in TIER_BADGE ? user.subscriptionTier : "free") as Tier;
  const badge = TIER_BADGE[tier];
  return (
    <div className="px-5 py-4 flex flex-wrap items-center gap-4">
      <div className="flex-1 min-w-[200px]">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-bold text-foreground" data-testid={`text-user-${user.id}`}>
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
            <Badge variant="outline" className="text-[10px]">Stripe sub</Badge>
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

      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="outline"
          size="sm"
          onClick={onEdit}
          data-testid={`button-edit-${user.id}`}
        >
          <Pencil className="w-3.5 h-3.5 mr-1.5" />
          Edit
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="text-destructive hover:text-destructive hover:bg-destructive/10"
          onClick={onDelete}
          data-testid={`button-delete-${user.id}`}
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* ───────────────── Edit user dialog ───────────────── */

function EditUserDialog({ userId, onClose }: { userId: number; onClose: () => void }) {
  const qc = useQueryClient();
  const authedFetch = useAuthedFetch();
  const { toast } = useToast();

  const detailQuery = useQuery<AdminUserDetail>({
    queryKey: ["admin", "user", userId],
    queryFn: async () => {
      const r = await authedFetch(`/api/admin/users/${userId}`);
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return r.json();
    },
  });

  function invalidate() {
    qc.invalidateQueries({ queryKey: ["admin", "user", userId] });
    qc.invalidateQueries({ queryKey: ["admin", "users"] });
    qc.invalidateQueries({ queryKey: ["admin", "stats"] });
  }

  const detail = detailQuery.data;

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle className="font-medieval text-2xl flex items-center gap-2">
            <Pencil className="w-5 h-5 text-primary" />
            Edit account
          </DialogTitle>
          <DialogDescription>
            {detail ? (
              <>
                Editing <span className="font-bold">{detail.user.twitchUsername ?? detail.clerk?.email ?? detail.user.clerkUserId}</span>.
                Changes apply immediately — be careful.
              </>
            ) : "Loading account…"}
          </DialogDescription>
        </DialogHeader>

        {detailQuery.isLoading || !detail ? (
          <div className="py-12 flex items-center justify-center text-muted-foreground">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : (
          <Tabs defaultValue="identity" className="w-full">
            <TabsList className="grid grid-cols-4 w-full">
              <TabsTrigger value="identity">Identity</TabsTrigger>
              <TabsTrigger value="subscription">Subscription</TabsTrigger>
              <TabsTrigger value="billing">
                <Receipt className="w-3.5 h-3.5 mr-1.5" />
                Billing
              </TabsTrigger>
              <TabsTrigger value="danger" className="text-destructive">Danger</TabsTrigger>
            </TabsList>

            <TabsContent value="identity" className="space-y-5 mt-4">
              <IdentitySection
                detail={detail}
                authedFetch={authedFetch}
                onSaved={() => { invalidate(); toast({ title: "Identity saved" }); }}
                onError={(m) => toast({ title: "Save failed", description: m, variant: "destructive" })}
              />
            </TabsContent>

            <TabsContent value="subscription" className="space-y-5 mt-4">
              <SubscriptionSection
                detail={detail}
                authedFetch={authedFetch}
                onChanged={() => { invalidate(); toast({ title: "Subscription updated" }); }}
                onError={(m) => toast({ title: "Update failed", description: m, variant: "destructive" })}
              />
            </TabsContent>

            <TabsContent value="billing" className="space-y-3 mt-4">
              <BillingSection
                userId={userId}
                hasCustomer={!!detail.user.stripeCustomerId}
                authedFetch={authedFetch}
                onChanged={() => toast({ title: "Refund issued" })}
                onError={(m) => toast({ title: "Refund failed", description: m, variant: "destructive" })}
              />
            </TabsContent>

            <TabsContent value="danger" className="mt-4">
              <DangerSection
                detail={detail}
                authedFetch={authedFetch}
                onDeleted={() => { invalidate(); onClose(); toast({ title: "User deleted" }); }}
                onError={(m) => toast({ title: "Action failed", description: m, variant: "destructive" })}
              />
            </TabsContent>
          </Tabs>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} data-testid="button-close-edit">Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────── Identity tab ───────────────── */

function IdentitySection({
  detail,
  authedFetch,
  onSaved,
  onError,
}: {
  detail: AdminUserDetail;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onSaved: () => void;
  onError: (m: string) => void;
}) {
  const [twitchUsername, setTwitchUsername] = useState(detail.user.twitchUsername ?? "");
  const [steamUsername, setSteamUsername] = useState(detail.user.steamUsername ?? "");
  const [email, setEmail] = useState(detail.clerk?.email ?? "");
  const [password, setPassword] = useState("");
  const [busyKind, setBusyKind] = useState<"profile" | "email" | "password" | null>(null);

  // Reset local state if the underlying detail changes (e.g. after save
  // we invalidate the query and a fresh detail flows in).
  useEffect(() => {
    setTwitchUsername(detail.user.twitchUsername ?? "");
    setSteamUsername(detail.user.steamUsername ?? "");
    setEmail(detail.clerk?.email ?? "");
  }, [detail]);

  async function saveProfile() {
    setBusyKind("profile");
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          twitchUsername: twitchUsername.trim() || null,
          steamUsername: steamUsername.trim() || null,
        }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKind(null);
    }
  }

  async function saveEmail() {
    if (!email.trim()) return;
    setBusyKind("email");
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Email change failed");
      }
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKind(null);
    }
  }

  async function savePassword() {
    if (password.length < 8) {
      onError("Password must be at least 8 characters");
      return;
    }
    setBusyKind("password");
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Password reset failed");
      }
      setPassword("");
      onSaved();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Profile</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="admin-twitch-username">Twitch username</Label>
              <Input
                id="admin-twitch-username"
                value={twitchUsername}
                onChange={(e) => setTwitchUsername(e.target.value)}
                placeholder="goblinl00t"
                data-testid="input-edit-twitch-username"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Lowercased on save. The bot rejoins this channel on next restart.
              </p>
            </div>
            <div>
              <Label htmlFor="admin-steam-username">Steam username</Label>
              <Input
                id="admin-steam-username"
                value={steamUsername}
                onChange={(e) => setSteamUsername(e.target.value)}
                placeholder="(optional)"
                data-testid="input-edit-steam-username"
              />
            </div>
          </div>
          <Button onClick={saveProfile} disabled={busyKind === "profile"} data-testid="button-save-profile">
            {busyKind === "profile" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Save profile
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Email
          </h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="admin-email">Primary email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                data-testid="input-edit-email"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Saved as a verified primary email in Clerk. Old addresses are removed.
              </p>
            </div>
            <Button onClick={saveEmail} disabled={busyKind === "email" || !email.trim()} data-testid="button-save-email">
              {busyKind === "email" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Update email
            </Button>
          </div>
          {detail.clerk && (
            <div className="text-[11px] text-muted-foreground font-mono space-y-0.5">
              <div>Clerk ID: {detail.user.clerkUserId}</div>
              {detail.clerk.lastSignInAt && <div>Last sign-in: {new Date(detail.clerk.lastSignInAt).toLocaleString()}</div>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Key className="w-4 h-4" /> Password
          </h3>
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="admin-pw">Set new password</Label>
              <Input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Min 8 characters"
                data-testid="input-edit-password"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Forces sign-out of all other sessions. Share over a secure channel.
              </p>
            </div>
            <Button onClick={savePassword} disabled={busyKind === "password" || password.length < 8} data-testid="button-save-password">
              {busyKind === "password" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Set password
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────── Subscription tab ───────────────── */

function SubscriptionSection({
  detail,
  authedFetch,
  onChanged,
  onError,
}: {
  detail: AdminUserDetail;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [tier, setTier] = useState<Tier>(detail.user.subscriptionTier);
  const [isAdmin, setIsAdmin] = useState(detail.user.isAdmin);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);

  useEffect(() => {
    setTier(detail.user.subscriptionTier);
    setIsAdmin(detail.user.isAdmin);
  }, [detail]);

  async function save() {
    setBusy(true);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionTier: tier, isAdmin }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Save failed");
      }
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function cancelSub() {
    setCancelling(true);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/subscription/cancel`, {
        method: "POST",
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Cancel failed");
      }
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setCancelling(false);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Manual entitlement (DB override)</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label>Tier</Label>
              <Select value={tier} onValueChange={(v) => setTier(v as Tier)}>
                <SelectTrigger data-testid="select-edit-tier"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="free">Free</SelectItem>
                  <SelectItem value="premium">Premium</SelectItem>
                  <SelectItem value="pro">Pro</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-[10px] text-muted-foreground mt-1">
                Comp / partner override only. Active Stripe subs re-overwrite this on the next read.
              </p>
            </div>
            <div className="flex flex-col gap-1">
              <Label>Super-user</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={isAdmin}
                  onCheckedChange={setIsAdmin}
                  data-testid="switch-edit-admin"
                />
                <span className="text-sm text-muted-foreground">Bypass all feature gates</span>
              </div>
            </div>
          </div>
          <Button onClick={save} disabled={busy} data-testid="button-save-subscription">
            {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
            Save
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Active Stripe subscription</h3>
          {detail.subscription ? (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-x-6 gap-y-1">
                <span><span className="text-muted-foreground">Plan:</span> <span className="font-bold">{detail.subscription.productName}</span></span>
                <span><span className="text-muted-foreground">Status:</span> <Badge variant="outline" className="capitalize">{detail.subscription.status}</Badge></span>
                <span><span className="text-muted-foreground">Renews:</span> {new Date(detail.subscription.currentPeriodEnd).toLocaleDateString()}</span>
                {detail.subscription.cancelAtPeriodEnd && (
                  <Badge variant="outline" className="border-amber-500/40 text-amber-300">Cancels at period end</Badge>
                )}
              </div>
              <p className="text-xs text-muted-foreground font-mono">{detail.subscription.id}</p>
              <Button
                variant="outline"
                className="text-destructive hover:bg-destructive/10"
                onClick={cancelSub}
                disabled={cancelling}
                data-testid="button-cancel-subscription"
              >
                {cancelling ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Cancel subscription now
              </Button>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No active Stripe subscription.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

/* ───────────────── Billing tab ───────────────── */

function BillingSection({
  userId,
  hasCustomer,
  authedFetch,
  onChanged,
  onError,
}: {
  userId: number;
  hasCustomer: boolean;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [refundingId, setRefundingId] = useState<string | null>(null);

  const invoicesQuery = useQuery<{ invoices: AdminInvoice[] }>({
    queryKey: ["admin", "user", userId, "invoices"],
    queryFn: async () => {
      const r = await authedFetch(`/api/admin/users/${userId}/invoices`);
      if (!r.ok) throw new Error(`Failed: ${r.status}`);
      return r.json();
    },
    enabled: hasCustomer,
  });

  async function refund(inv: AdminInvoice) {
    if (!inv.chargeId) return;
    setRefundingId(inv.chargeId);
    try {
      const r = await authedFetch(`/api/admin/users/${userId}/refund`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ chargeId: inv.chargeId, reason: "requested_by_customer" }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Refund failed");
      }
      qc.invalidateQueries({ queryKey: ["admin", "user", userId, "invoices"] });
      onChanged();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setRefundingId(null);
    }
  }

  if (!hasCustomer) {
    return <p className="text-sm text-muted-foreground p-2">User has no Stripe customer yet — no invoices to show.</p>;
  }
  if (invoicesQuery.isLoading) {
    return <div className="py-6 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-muted-foreground" /></div>;
  }
  if (invoicesQuery.error) {
    return <p className="text-sm text-destructive">Failed to load invoices.</p>;
  }
  const invoices = invoicesQuery.data?.invoices ?? [];
  if (invoices.length === 0) {
    return <p className="text-sm text-muted-foreground p-2">No invoices yet.</p>;
  }

  return (
    <div className="border border-border/60 rounded-md overflow-hidden">
      <table className="w-full text-sm">
        <thead className="bg-muted/30 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th className="text-left px-3 py-2">Invoice</th>
            <th className="text-left px-3 py-2">Date</th>
            <th className="text-right px-3 py-2">Paid</th>
            <th className="text-right px-3 py-2">Refunded</th>
            <th className="text-left px-3 py-2">Status</th>
            <th className="text-right px-3 py-2"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border/50">
          {invoices.map((inv) => (
            <tr key={inv.id} className="hover:bg-muted/20">
              <td className="px-3 py-2 font-mono text-xs">{inv.number ?? inv.id}</td>
              <td className="px-3 py-2 text-xs">{new Date(inv.createdAt).toLocaleDateString()}</td>
              <td className="px-3 py-2 text-right">{fmtMoney(inv.amountPaid, inv.currency)}</td>
              <td className="px-3 py-2 text-right text-rose-300">
                {inv.amountRefunded > 0 ? fmtMoney(inv.amountRefunded, inv.currency) : "—"}
              </td>
              <td className="px-3 py-2">
                <Badge variant="outline" className="capitalize text-[10px]">{inv.status}</Badge>
              </td>
              <td className="px-3 py-2 text-right space-x-1 whitespace-nowrap">
                {inv.hostedInvoiceUrl && (
                  <Button asChild variant="ghost" size="sm">
                    <a href={inv.hostedInvoiceUrl} target="_blank" rel="noreferrer" data-testid={`link-invoice-${inv.id}`}>
                      <ExternalLink className="w-3 h-3" />
                    </a>
                  </Button>
                )}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => refund(inv)}
                  disabled={!inv.refundable || refundingId === inv.chargeId}
                  data-testid={`button-refund-${inv.id}`}
                >
                  {refundingId === inv.chargeId ? <Loader2 className="w-3 h-3 animate-spin" /> : "Refund"}
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ───────────────── Danger zone tab ───────────────── */

function DangerSection({
  detail,
  authedFetch,
  onDeleted,
  onError,
}: {
  detail: AdminUserDetail;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onDeleted: () => void;
  onError: (m: string) => void;
}) {
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function doDelete() {
    setBusy(true);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}`, { method: "DELETE" });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Delete failed");
      }
      onDeleted();
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
      setConfirming(false);
    }
  }

  return (
    <Card className="border-destructive/40">
      <CardContent className="p-4 space-y-3">
        <h3 className="font-semibold text-sm text-destructive flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4" />
          Delete account permanently
        </h3>
        <p className="text-sm text-muted-foreground">
          Cancels the active Stripe subscription, deletes the Clerk user, and removes the database row
          (cascading custom commands and giveaway presets). Channel-scoped chat history is preserved.
        </p>
        <Button
          variant="destructive"
          onClick={() => setConfirming(true)}
          disabled={busy}
          data-testid="button-open-delete"
        >
          <Trash2 className="w-3.5 h-3.5 mr-1.5" />
          Delete this account
        </Button>

        <AlertDialog open={confirming} onOpenChange={(v) => !v && setConfirming(false)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Are you absolutely sure?</AlertDialogTitle>
              <AlertDialogDescription>
                Deleting <span className="font-bold">{detail.user.twitchUsername ?? detail.clerk?.email ?? detail.user.clerkUserId}</span> is
                irreversible. The user will be signed out everywhere and unable to sign back in.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={(e) => { e.preventDefault(); doDelete(); }}
                disabled={busy}
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                data-testid="button-confirm-delete-account"
              >
                {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
                Delete forever
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

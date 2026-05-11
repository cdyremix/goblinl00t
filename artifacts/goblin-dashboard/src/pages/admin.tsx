import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@clerk/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Crown, Search, Shield, Sword, Tv, Box, Coins, RefreshCw, AlertTriangle, Trash2,
  Pencil, Mail, Key, Receipt, ExternalLink, Loader2, Wrench, Lock, UserPlus, Eye, EyeOff,
  CheckCircle2, XCircle, MoreHorizontal, UserCog, UserX,
} from "lucide-react";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel,
  DropdownMenuSeparator, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  isDev: boolean;
  botTheme: string;
  botName: string;
  goblinEventsEnabled: boolean;
  lootDropsEnabled: boolean;
  coinRedemptionEnabled: boolean;
  coinCap: number | null;
  stripeCustomerId: string | null;
  stripeSubscriptionId: string | null;
  createdAt: string;
  // Pulled from Clerk on each list refresh. `null` means the lookup
  // failed (Clerk transient error) — the row should render an
  // "unknown" indicator rather than silently claiming unverified.
  emailVerified: boolean | null;
  // When false, Clerk's SignIn component will only offer email-code
  // sign-in (no password input shown). Operator should set a password.
  passwordEnabled: boolean | null;
}

interface AdminStats {
  total: number; free: number; premium: number; pro: number;
  twitchLinked: number; steamLinked: number; admins: number;
}

interface AdminUserDetail {
  user: AdminUser;
  clerk: {
    email: string | null;
    emailVerified: boolean | null;
    passwordEnabled: boolean | null;
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

/**
 * Pull a structured `{ message, fields }` out of a non-OK fetch Response.
 * Server validation errors come back as `{ error, issues }` where `issues`
 * is the raw zod issue list — we map each issue's leaf path segment to
 * its message so the calling component can render it inline next to the
 * exact field that failed instead of dumping a generic toast. Anything
 * the server didn't tag with a path falls through into `message` so the
 * caller still has something meaningful to show at the top of the card.
 */
async function parseApiError(r: Response): Promise<{ message: string; fields: Record<string, string> }> {
  let body: unknown;
  try {
    body = await r.json();
  } catch {
    return { message: `Request failed (${r.status})`, fields: {} };
  }
  const obj = (body ?? {}) as { error?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> };
  const fields: Record<string, string> = {};
  for (const iss of obj.issues ?? []) {
    const leaf = iss.path?.[iss.path.length - 1];
    if (typeof leaf === "string" && iss.message) fields[leaf] = iss.message;
  }
  const message = obj.error ?? `Request failed (${r.status})`;
  return { message, fields };
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

  // One-click row actions. Role flips piggy-back on PATCH /admin/users/:id
  // — the same endpoint the Edit dialog uses, so the mutex check + the
  // promotion-auto-verify side-effect both still fire. Email-verify hits
  // its own dedicated endpoint. We disambiguate by `user.id` in the
  // pending check so multiple rows can show their own spinner state.
  const quickAction = useMutation({
    mutationFn: async ({ user, action }: { user: AdminUser; action: QuickAction }) => {
      if (action === "verify-email") {
        const r = await authedFetch(`/api/admin/users/${user.id}/email/verify`, {
          method: "POST",
        });
        if (!r.ok) {
          const err = (await r.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error ?? "Verify failed");
        }
        return { kind: "verify" as const };
      }
      const body =
        action === "make-admin"
          ? { isAdmin: true, isDev: false }
          : action === "make-dev"
            ? { isAdmin: false, isDev: true }
            : { isAdmin: false, isDev: false };
      const r = await authedFetch(`/api/admin/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Update failed");
      }
      return { kind: "role" as const, action };
    },
    onSuccess: (result) => {
      qc.invalidateQueries({ queryKey: ["admin"] });
      if (result.kind === "verify") {
        toast({ title: "Email verified", description: "All addresses on this account are now verified." });
      } else {
        const label =
          result.action === "make-admin"
            ? "Promoted to super admin"
            : result.action === "make-dev"
              ? "Promoted to dev"
              : "Demoted to regular user";
        toast({ title: label });
      }
    },
    onError: (err: Error) =>
      toast({ title: "Action failed", description: err.message, variant: "destructive" }),
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
                  onQuickAction={(action) => quickAction.mutate({ user: u, action })}
                  quickActionPending={quickAction.isPending && quickAction.variables?.user.id === u.id}
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
  // Three-way role selector. "none" = ordinary streamer (just gets the
  // chosen tier). "dev" = full feature bypass, no admin. "admin" = full
  // super-user. Modeled as a single value (rather than two booleans) so
  // the UI can't accidentally check both.
  const [role, setRole] = useState<"none" | "dev" | "admin">("none");
  const [showPassword, setShowPassword] = useState(false);
  // Inline validation state. `touched` only flips after the user has
  // blurred a field (or attempted submit), so the dialog doesn't yell
  // at them while they're still typing the first character.
  const [touched, setTouched] = useState<{ email: boolean; password: boolean; twitchUsername: boolean }>({
    email: false,
    password: false,
    twitchUsername: false,
  });
  // Per-field server errors returned by the API after submit (`issues[]`
  // shaped like Zod). Cleared on every input change so the user gets
  // immediate feedback that they're addressing the problem.
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string; twitchUsername?: string }>({});
  const [formError, setFormError] = useState<string | null>(null);
  // The dialog only opens for super-admins (route is requireAdmin), and
  // per product policy super-admins create accounts with no validation
  // gate — fake emails, weak passwords, odd handles all welcome. The
  // server agrees and will pass `skipPasswordChecks: true` to Clerk.
  // We still surface the strength meter for visibility but it never
  // blocks submit.
  const bypassValidation = true;

  // Reset the form whenever the dialog re-opens so a previous attempt's
  // half-typed values don't bleed into the next create flow.
  useEffect(() => {
    if (open) {
      setEmail("");
      setPassword("");
      setTwitchUsername("");
      setTier("free");
      setRole("none");
      setShowPassword(false);
      setTouched({ email: false, password: false, twitchUsername: false });
      setFieldErrors({});
      setFormError(null);
    }
  }, [open]);

  // Local validation. Only enforced when bypass is OFF.
  const emailTrimmed = email.trim();
  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailTrimmed);
  const pwStrength = scorePasswordStrength(password);
  const localEmailError = bypassValidation
    ? null
    : !emailTrimmed
      ? "Email is required."
      : !emailValid
        ? "Enter a valid email address."
        : null;
  const localPasswordError = bypassValidation
    ? password.length === 0
      ? "Password is required."
      : null
    : password.length === 0
      ? "Password is required."
      : password.length < 8
        ? "Password must be at least 8 characters."
        : null;
  // Username is OPTIONAL. When provided + bypass off, it must look like
  // a real Twitch handle. With bypass on, anything non-empty is allowed
  // (admin can seed a placeholder; will be overwritten by Twitch OAuth).
  const twitchTrimmed = twitchUsername.trim();
  const localTwitchError =
    twitchTrimmed.length === 0
      ? null
      : bypassValidation
        ? null
        : !/^[a-zA-Z0-9_]{4,25}$/.test(twitchTrimmed)
          ? "Twitch handles are 4–25 characters, letters/numbers/underscore only."
          : null;
  const canSubmit = !localEmailError && !localPasswordError && !localTwitchError;

  const create = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/admin/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: emailTrimmed,
          password,
          twitchUsername: twitchTrimmed || null,
          subscriptionTier: tier,
          isAdmin: role === "admin",
          isDev: role === "dev",
        }),
      });
      const json = (await r.json().catch(() => ({}))) as {
        error?: string;
        issues?: Array<{ path?: (string | number)[]; message?: string }>;
      };
      if (!r.ok) {
        const next: { email?: string; password?: string; twitchUsername?: string } = {};
        for (const iss of json.issues ?? []) {
          const key = String(iss.path?.[0] ?? "");
          if (key === "email" && iss.message) next.email = iss.message;
          if (key === "password" && iss.message) next.password = iss.message;
          if (key === "twitchUsername" && iss.message) next.twitchUsername = iss.message;
        }
        // If the server returned a generic message and no per-field
        // issues (e.g. Clerk rejection, duplicate email), surface it as
        // a form-level inline banner.
        const err = new Error(json.error ?? `Create failed (${r.status})`);
        (err as Error & { fieldErrors?: typeof next }).fieldErrors = next;
        throw err;
      }
      return json;
    },
    onSuccess: () => {
      toast({ title: "User created", description: `${emailTrimmed} can now sign in.` });
      onCreated();
    },
    onError: (err: Error & { fieldErrors?: { email?: string; password?: string; twitchUsername?: string } }) => {
      const fe = err.fieldErrors ?? {};
      setFieldErrors(fe);
      // Show the form-level banner when the failure isn't field-specific
      // (duplicate email, Clerk weak-password rejection, network error).
      if (!fe.email && !fe.password && !fe.twitchUsername) setFormError(err.message);
      else setFormError(null);
      // Force-show the inline messages even if the user never blurred.
      setTouched({ email: true, password: true, twitchUsername: true });
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
    setTouched({ email: true, password: true, twitchUsername: true });
    setFormError(null);
    setFieldErrors({});
    if (!canSubmit) return;
    create.mutate();
  }

  // Errors to actually render: server-supplied take precedence over
  // local (since the server might know things the client doesn't, e.g.
  // duplicate email), and we only render local ones once touched.
  const emailErr = fieldErrors.email ?? (touched.email ? localEmailError : null);
  const passwordErr = fieldErrors.password ?? (touched.password ? localPasswordError : null);
  const twitchErr = fieldErrors.twitchUsername ?? (touched.twitchUsername ? localTwitchError : null);

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
        <form onSubmit={onSubmit} className="space-y-4" noValidate>
          {formError && (
            <div
              role="alert"
              className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive flex items-start gap-2"
              data-testid="alert-create-form-error"
            >
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{formError}</span>
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="create-email">Email</Label>
            <Input
              id="create-email"
              type="email"
              autoComplete="off"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (fieldErrors.email) setFieldErrors((p) => ({ ...p, email: undefined }));
                if (formError) setFormError(null);
              }}
              onBlur={() => setTouched((t) => ({ ...t, email: true }))}
              placeholder="streamer@example.com"
              aria-invalid={!!emailErr}
              className={emailErr ? "border-destructive focus-visible:ring-destructive" : ""}
              data-testid="input-create-email"
            />
            {emailErr && (
              <p className="text-xs text-destructive" data-testid="error-create-email">
                {emailErr}
              </p>
            )}
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
                autoComplete="new-password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (fieldErrors.password) setFieldErrors((p) => ({ ...p, password: undefined }));
                  if (formError) setFormError(null);
                }}
                onBlur={() => setTouched((t) => ({ ...t, password: true }))}
                placeholder={bypassValidation ? "Any password" : "At least 8 chars"}
                aria-invalid={!!passwordErr}
                className={`pr-10 font-mono ${passwordErr ? "border-destructive focus-visible:ring-destructive" : ""}`}
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
            {password.length > 0 && (
              <PasswordStrengthMeter score={pwStrength.score} label={pwStrength.label} />
            )}
            {passwordErr ? (
              <p className="text-xs text-destructive" data-testid="error-create-password">
                {passwordErr}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Share this with the user. They can change it from their account page.
              </p>
            )}
          </div>

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
            <p className="text-xs text-muted-foreground">
              The user will appear as <span className="font-semibold">Unknown Goblin</span> until
              they connect their Twitch account from the account page.
            </p>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="create-twitch">Twitch handle (optional)</Label>
            <Input
              id="create-twitch"
              autoComplete="off"
              value={twitchUsername}
              onChange={(e) => {
                setTwitchUsername(e.target.value);
                if (fieldErrors.twitchUsername) {
                  setFieldErrors((p) => ({ ...p, twitchUsername: undefined }));
                }
                if (formError) setFormError(null);
              }}
              onBlur={() => setTouched((t) => ({ ...t, twitchUsername: true }))}
              placeholder="goblinl00t"
              aria-invalid={!!twitchErr}
              className={twitchErr ? "border-destructive focus-visible:ring-destructive" : ""}
              data-testid="input-create-twitch"
            />
            {twitchErr ? (
              <p className="text-xs text-destructive" data-testid="error-create-twitch">
                {twitchErr}
              </p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Placeholder only — overwritten with the real handle when the user connects Twitch.
              </p>
            )}
          </div>

          <div className="space-y-2">
            <Label>Role</Label>
            <div className="grid grid-cols-3 gap-2">
              <RolePill
                active={role === "none"}
                onClick={() => setRole("none")}
                title="Streamer"
                desc="Standard account at the chosen tier."
                testId="role-none"
              />
              <RolePill
                active={role === "dev"}
                onClick={() => setRole("dev")}
                title="Dev"
                desc="Full bot/dashboard access. No admin panel."
                testId="role-dev"
              />
              <RolePill
                active={role === "admin"}
                onClick={() => setRole("admin")}
                title="Super admin"
                desc="Full bot/dashboard + admin panel."
                testId="role-admin"
              />
            </div>
          </div>

          {bypassValidation && (
            <p
              className="text-[11px] text-amber-400/90 leading-tight"
              data-testid="hint-create-admin-bypass"
            >
              Super admin role auto-skips email format, password strength, and Twitch handle
              checks (including Clerk's password policy).
            </p>
          )}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              Cancel
            </Button>
            <Button
              type="submit"
              disabled={create.isPending || !canSubmit}
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

/**
 * Lightweight password strength scorer. Returns 0–4 plus a label so the
 * meter UI can color + describe consistently. Heuristic only — combines
 * length buckets with a character-class-variety bonus. Intentionally
 * doesn't pull in `zxcvbn` (~400KB) for a single dialog.
 */
function scorePasswordStrength(pw: string): { score: 0 | 1 | 2 | 3 | 4; label: string } {
  if (!pw) return { score: 0, label: "Empty" };
  let s = 0;
  if (pw.length >= 8) s++;
  if (pw.length >= 12) s++;
  if (pw.length >= 16) s++;
  let classes = 0;
  if (/[a-z]/.test(pw)) classes++;
  if (/[A-Z]/.test(pw)) classes++;
  if (/[0-9]/.test(pw)) classes++;
  if (/[^a-zA-Z0-9]/.test(pw)) classes++;
  if (classes >= 3) s++;
  if (pw.length < 6) s = 0;
  const score = Math.min(4, s) as 0 | 1 | 2 | 3 | 4;
  const label = ["Very weak", "Weak", "Fair", "Strong", "Very strong"][score]!;
  return { score, label };
}

function PasswordStrengthMeter({ score, label }: { score: 0 | 1 | 2 | 3 | 4; label: string }) {
  const colors = [
    "bg-destructive",
    "bg-orange-500",
    "bg-amber-400",
    "bg-lime-500",
    "bg-emerald-500",
  ];
  const labelColor = [
    "text-destructive",
    "text-orange-400",
    "text-amber-400",
    "text-lime-400",
    "text-emerald-400",
  ];
  return (
    <div className="space-y-1" data-testid="password-strength-meter">
      <div className="flex gap-1">
        {[0, 1, 2, 3, 4].map((i) => (
          <div
            key={i}
            className={`h-1 flex-1 rounded-full transition-colors ${
              i <= score ? colors[score] : "bg-border/60"
            }`}
          />
        ))}
      </div>
      <p className={`text-[11px] ${labelColor[score]}`}>{label}</p>
    </div>
  );
}

function RolePill({
  active, onClick, title, desc, testId,
}: { active: boolean; onClick: () => void; title: string; desc: string; testId: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`text-left rounded-md border px-3 py-2 transition-colors ${
        active
          ? "border-amber-400 bg-amber-500/10 ring-1 ring-amber-400/40"
          : "border-border/60 hover:border-border bg-background"
      }`}
    >
      <div className="text-sm font-semibold">{title}</div>
      <div className="text-[10px] text-muted-foreground leading-tight mt-0.5">{desc}</div>
    </button>
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

type QuickAction =
  | "make-admin"
  | "make-dev"
  | "make-regular"
  | "verify-email";

function UserRow({
  user,
  onEdit,
  onDelete,
  onQuickAction,
  quickActionPending,
}: {
  user: AdminUser;
  onEdit: () => void;
  onDelete: () => void;
  onQuickAction: (action: QuickAction) => void;
  quickActionPending: boolean;
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
          {user.isDev && !user.isAdmin && (
            <Badge className="gap-1 text-[10px] bg-sky-500/20 text-sky-300 border-sky-500/40" variant="outline">
              DEV
            </Badge>
          )}
          {user.emailVerified === true ? (
            <Badge
              className="gap-1 text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
              variant="outline"
              data-testid={`badge-email-verified-${user.id}`}
            >
              <CheckCircle2 className="w-3 h-3" />
              Email verified
            </Badge>
          ) : user.emailVerified === false ? (
            <Badge
              className="gap-1 text-[10px] bg-rose-500/15 text-rose-300 border-rose-500/40"
              variant="outline"
              data-testid={`badge-email-unverified-${user.id}`}
            >
              <XCircle className="w-3 h-3" />
              Email unverified
            </Badge>
          ) : (
            <Badge
              className="gap-1 text-[10px] text-muted-foreground"
              variant="outline"
              data-testid={`badge-email-unknown-${user.id}`}
            >
              Email status unknown
            </Badge>
          )}
          {user.passwordEnabled === false && (
            <Badge
              className="gap-1 text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/40"
              variant="outline"
              data-testid={`badge-no-password-${user.id}`}
              title="Clerk's sign-in will only offer 'email me a code' for this account. Set a password in the Identity tab."
            >
              <Key className="w-3 h-3" />
              No password
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
        {/* Quick-action dropdown — one-click role flips and email
            verify so the operator doesn't have to open the full Edit
            dialog for the most common admin chores. The full dialog
            still owns identity/billing/danger-zone ops. */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={quickActionPending}
              data-testid={`button-quick-actions-${user.id}`}
              aria-label="Quick actions"
            >
              {quickActionPending ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <MoreHorizontal className="w-3.5 h-3.5" />
              )}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <DropdownMenuLabel className="text-xs">Role</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={user.isAdmin}
              onClick={() => onQuickAction("make-admin")}
              data-testid={`menu-make-admin-${user.id}`}
            >
              <Crown className="w-3.5 h-3.5 mr-2 text-amber-400" />
              Make super admin
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={user.isDev && !user.isAdmin}
              onClick={() => onQuickAction("make-dev")}
              data-testid={`menu-make-dev-${user.id}`}
            >
              <UserCog className="w-3.5 h-3.5 mr-2 text-sky-400" />
              Make dev account
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={!user.isAdmin && !user.isDev}
              onClick={() => onQuickAction("make-regular")}
              data-testid={`menu-make-regular-${user.id}`}
            >
              <UserX className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
              Make regular user
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuLabel className="text-xs">Auth</DropdownMenuLabel>
            <DropdownMenuItem
              disabled={user.emailVerified === true}
              onClick={() => onQuickAction("verify-email")}
              data-testid={`menu-verify-email-${user.id}`}
            >
              <CheckCircle2 className="w-3.5 h-3.5 mr-2 text-emerald-400" />
              Mark email verified
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onClick={onDelete}
              className="text-destructive focus:text-destructive focus:bg-destructive/10"
              data-testid={`menu-delete-${user.id}`}
            >
              <Trash2 className="w-3.5 h-3.5 mr-2" />
              Delete account
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
                onSaved={invalidate}
              />
            </TabsContent>

            <TabsContent value="subscription" className="space-y-5 mt-4">
              <SubscriptionSection
                detail={detail}
                authedFetch={authedFetch}
                onChanged={invalidate}
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
}: {
  detail: AdminUserDetail;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onSaved: () => void;
}) {
  const [twitchUsername, setTwitchUsername] = useState(detail.user.twitchUsername ?? "");
  const [steamUsername, setSteamUsername] = useState(detail.user.steamUsername ?? "");
  const [email, setEmail] = useState(detail.clerk?.email ?? "");
  const [password, setPassword] = useState("");
  const [busyKind, setBusyKind] = useState<"profile" | "email" | "password" | "verify" | null>(null);

  // Per-card error state — surfaced inline next to the offending field
  // (and at the top of the card for non-field errors) instead of being
  // fired off as a toast. This lets the user see exactly which input
  // the server rejected and why, especially for the twitchUsername
  // regex / length validations on PATCH /admin/users/:id.
  const [profileErrors, setProfileErrors] = useState<{ top?: string; twitchUsername?: string; steamUsername?: string }>({});
  const [emailError, setEmailError] = useState<string | null>(null);
  const [passwordError, setPasswordError] = useState<string | null>(null);
  const [verifyError, setVerifyError] = useState<string | null>(null);

  // Tiny "Saved ✓" pulse instead of a toast — same surface, cheaper UX.
  const [savedFlash, setSavedFlash] = useState<"profile" | "email" | "password" | "verify" | null>(null);
  function flashSaved(kind: "profile" | "email" | "password" | "verify") {
    setSavedFlash(kind);
    setTimeout(() => setSavedFlash((cur) => (cur === kind ? null : cur)), 2400);
  }

  // Reset local state if the underlying detail changes (e.g. after save
  // we invalidate the query and a fresh detail flows in).
  useEffect(() => {
    setTwitchUsername(detail.user.twitchUsername ?? "");
    setSteamUsername(detail.user.steamUsername ?? "");
    setEmail(detail.clerk?.email ?? "");
  }, [detail]);

  async function saveProfile() {
    setBusyKind("profile");
    setProfileErrors({});
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
        const { message, fields } = await parseApiError(r);
        setProfileErrors({
          top: fields["twitchUsername"] || fields["steamUsername"] ? undefined : message,
          twitchUsername: fields["twitchUsername"],
          steamUsername: fields["steamUsername"],
        });
        return;
      }
      flashSaved("profile");
      onSaved();
    } finally {
      setBusyKind(null);
    }
  }

  async function saveEmail() {
    if (!email.trim()) return;
    setBusyKind("email");
    setEmailError(null);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      if (!r.ok) {
        const { message, fields } = await parseApiError(r);
        setEmailError(fields["email"] ?? message);
        return;
      }
      flashSaved("email");
      onSaved();
    } finally {
      setBusyKind(null);
    }
  }

  async function markEmailVerified() {
    setBusyKind("verify");
    setVerifyError(null);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/email/verify`, {
        method: "POST",
      });
      if (!r.ok) {
        const { message } = await parseApiError(r);
        setVerifyError(message);
        return;
      }
      flashSaved("verify");
      onSaved();
    } finally {
      setBusyKind(null);
    }
  }

  async function savePassword() {
    setBusyKind("password");
    setPasswordError(null);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      if (!r.ok) {
        const { message, fields } = await parseApiError(r);
        setPasswordError(fields["password"] ?? message);
        return;
      }
      setPassword("");
      flashSaved("password");
      onSaved();
    } finally {
      setBusyKind(null);
    }
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm">Profile</h3>
          {profileErrors.top && (
            <p
              className="text-xs text-destructive flex items-center gap-1.5"
              role="alert"
              data-testid="error-profile-top"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {profileErrors.top}
            </p>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <Label htmlFor="admin-twitch-username">Twitch username</Label>
              <Input
                id="admin-twitch-username"
                value={twitchUsername}
                onChange={(e) => {
                  setTwitchUsername(e.target.value);
                  if (profileErrors.twitchUsername) {
                    setProfileErrors((p) => ({ ...p, twitchUsername: undefined }));
                  }
                }}
                placeholder="goblinl00t"
                aria-invalid={!!profileErrors.twitchUsername}
                data-testid="input-edit-twitch-username"
              />
              {profileErrors.twitchUsername ? (
                <p className="text-[11px] text-destructive mt-1" data-testid="error-edit-twitch-username">
                  {profileErrors.twitchUsername}
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Lowercased on save. Letters, numbers, underscore. Re-linking Twitch overwrites this.
                </p>
              )}
            </div>
            <div>
              <Label htmlFor="admin-steam-username">Steam username</Label>
              <Input
                id="admin-steam-username"
                value={steamUsername}
                onChange={(e) => {
                  setSteamUsername(e.target.value);
                  if (profileErrors.steamUsername) {
                    setProfileErrors((p) => ({ ...p, steamUsername: undefined }));
                  }
                }}
                placeholder="(optional)"
                aria-invalid={!!profileErrors.steamUsername}
                data-testid="input-edit-steam-username"
              />
              {profileErrors.steamUsername && (
                <p className="text-[11px] text-destructive mt-1" data-testid="error-edit-steam-username">
                  {profileErrors.steamUsername}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button onClick={saveProfile} disabled={busyKind === "profile"} data-testid="button-save-profile">
              {busyKind === "profile" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save profile
            </Button>
            {savedFlash === "profile" && (
              <span className="text-xs text-emerald-300 flex items-center gap-1" data-testid="flash-profile-saved">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-4 space-y-3">
          <h3 className="font-semibold text-sm flex items-center gap-1.5">
            <Mail className="w-4 h-4" /> Email
            {detail.clerk?.emailVerified === true ? (
              <Badge
                className="gap-1 text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                variant="outline"
                data-testid="badge-edit-email-verified"
              >
                <CheckCircle2 className="w-3 h-3" />
                Verified
              </Badge>
            ) : detail.clerk?.emailVerified === false ? (
              <Badge
                className="gap-1 text-[10px] bg-rose-500/15 text-rose-300 border-rose-500/40"
                variant="outline"
                data-testid="badge-edit-email-unverified"
              >
                <XCircle className="w-3 h-3" />
                Unverified
              </Badge>
            ) : detail.clerk ? (
              <Badge className="gap-1 text-[10px] text-muted-foreground" variant="outline">
                Status unknown
              </Badge>
            ) : null}
            {detail.clerk?.emailVerified === false && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 text-xs"
                onClick={markEmailVerified}
                disabled={busyKind === "verify"}
                data-testid="button-mark-email-verified"
              >
                {busyKind === "verify" ? (
                  <Loader2 className="w-3 h-3 animate-spin mr-1" />
                ) : (
                  <CheckCircle2 className="w-3 h-3 mr-1" />
                )}
                Mark verified
              </Button>
            )}
          </h3>
          {detail.clerk?.emailVerified === false && (
            <p className="text-[11px] text-amber-300/80 -mt-1">
              Skips Clerk's verification round-trip. Use for dev/test accounts where the mailbox is fake.
            </p>
          )}
          {verifyError && (
            <p
              className="text-xs text-destructive flex items-center gap-1.5"
              role="alert"
              data-testid="error-verify-email"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {verifyError}
            </p>
          )}
          {savedFlash === "verify" && (
            <p className="text-xs text-emerald-300 flex items-center gap-1" data-testid="flash-verify-saved">
              <CheckCircle2 className="w-3.5 h-3.5" /> Marked verified
            </p>
          )}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="admin-email">Primary email</Label>
              <Input
                id="admin-email"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (emailError) setEmailError(null);
                }}
                aria-invalid={!!emailError}
                data-testid="input-edit-email"
              />
              {emailError ? (
                <p className="text-[11px] text-destructive mt-1" data-testid="error-edit-email">
                  {emailError}
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Saved as a verified primary email in Clerk. Old addresses are removed.
                </p>
              )}
            </div>
            <Button onClick={saveEmail} disabled={busyKind === "email" || !email.trim()} data-testid="button-save-email">
              {busyKind === "email" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Update email
            </Button>
            {savedFlash === "email" && (
              <span className="text-xs text-emerald-300 flex items-center gap-1 pb-2" data-testid="flash-email-saved">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
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
            {detail.clerk?.passwordEnabled === true ? (
              <Badge
                className="gap-1 text-[10px] bg-emerald-500/15 text-emerald-300 border-emerald-500/40"
                variant="outline"
                data-testid="badge-password-enabled"
              >
                <CheckCircle2 className="w-3 h-3" />
                Set
              </Badge>
            ) : detail.clerk?.passwordEnabled === false ? (
              <Badge
                className="gap-1 text-[10px] bg-amber-500/15 text-amber-300 border-amber-500/40"
                variant="outline"
                data-testid="badge-password-disabled"
              >
                <XCircle className="w-3 h-3" />
                Not set
              </Badge>
            ) : null}
          </h3>
          {detail.clerk?.passwordEnabled === false && (
            <p className="text-[11px] text-amber-300/80 -mt-1">
              No password on this Clerk account — sign-in only offers an emailed code.
              Set one below so the user can sign in with email + password.
            </p>
          )}
          <div className="flex gap-2 items-end">
            <div className="flex-1">
              <Label htmlFor="admin-pw">Set new password</Label>
              <Input
                id="admin-pw"
                type="password"
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (passwordError) setPasswordError(null);
                }}
                placeholder="Any length — admin override"
                aria-invalid={!!passwordError}
                data-testid="input-edit-password"
              />
              {passwordError ? (
                <p className="text-[11px] text-destructive mt-1" data-testid="error-edit-password">
                  {passwordError}
                </p>
              ) : (
                <p className="text-[10px] text-muted-foreground mt-1">
                  Forces sign-out of all other sessions. Share over a secure channel.
                </p>
              )}
            </div>
            <Button onClick={savePassword} disabled={busyKind === "password" || password.length === 0} data-testid="button-save-password">
              {busyKind === "password" ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Set password
            </Button>
            {savedFlash === "password" && (
              <span className="text-xs text-emerald-300 flex items-center gap-1 pb-2" data-testid="flash-password-saved">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
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
}: {
  detail: AdminUserDetail;
  authedFetch: ReturnType<typeof useAuthedFetch>;
  onChanged: () => void;
}) {
  const [tier, setTier] = useState<Tier>(detail.user.subscriptionTier);
  const [isAdmin, setIsAdmin] = useState(detail.user.isAdmin);
  const [isDev, setIsDev] = useState(detail.user.isDev);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [cancelError, setCancelError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);

  useEffect(() => {
    setTier(detail.user.subscriptionTier);
    setIsAdmin(detail.user.isAdmin);
    setIsDev(detail.user.isDev);
  }, [detail]);

  async function save() {
    setBusy(true);
    setSaveError(null);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscriptionTier: tier, isAdmin, isDev }),
      });
      if (!r.ok) {
        const { message } = await parseApiError(r);
        setSaveError(message);
        return;
      }
      setSavedFlash(true);
      setTimeout(() => setSavedFlash(false), 2400);
      onChanged();
    } finally {
      setBusy(false);
    }
  }

  async function cancelSub() {
    setCancelling(true);
    setCancelError(null);
    try {
      const r = await authedFetch(`/api/admin/users/${detail.user.id}/subscription/cancel`, {
        method: "POST",
      });
      if (!r.ok) {
        const { message } = await parseApiError(r);
        setCancelError(message);
        return;
      }
      onChanged();
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
              <Label>Super admin</Label>
              <div className="flex items-center gap-2 h-10">
                <Switch
                  checked={isAdmin}
                  onCheckedChange={(v) => {
                    setIsAdmin(v);
                    // Mutex with dev — admin already implies feature
                    // bypass and adds admin powers, so dev becomes a no-op.
                    if (v) setIsDev(false);
                  }}
                  data-testid="switch-edit-admin"
                />
                <span className="text-sm text-muted-foreground">Bypass all gates + admin panel</span>
              </div>
            </div>
          </div>
          <div>
            <Label>Dev account</Label>
            <div className="flex items-center gap-2 h-10">
              <Switch
                checked={isDev}
                onCheckedChange={(v) => {
                  setIsDev(v);
                  if (v) setIsAdmin(false);
                }}
                disabled={isAdmin}
                data-testid="switch-edit-dev"
              />
              <span className="text-sm text-muted-foreground">
                Bypass all feature gates (no admin panel)
              </span>
            </div>
          </div>
          {saveError && (
            <p
              className="text-xs text-destructive flex items-center gap-1.5"
              role="alert"
              data-testid="error-subscription-save"
            >
              <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
              {saveError}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={save} disabled={busy} data-testid="button-save-subscription">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" /> : null}
              Save
            </Button>
            {savedFlash && (
              <span className="text-xs text-emerald-300 flex items-center gap-1" data-testid="flash-subscription-saved">
                <CheckCircle2 className="w-3.5 h-3.5" /> Saved
              </span>
            )}
          </div>
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
              {cancelError && (
                <p
                  className="text-xs text-destructive flex items-center gap-1.5"
                  role="alert"
                  data-testid="error-subscription-cancel"
                >
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                  {cancelError}
                </p>
              )}
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

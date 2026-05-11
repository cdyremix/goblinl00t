import { useState } from "react";
import { useUser, useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Separator } from "@/components/ui/separator";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

type ClerkUser = NonNullable<ReturnType<typeof useUser>["user"]>;
type ClerkEmail = ClerkUser["emailAddresses"][number];
import { useToast } from "@/hooks/use-toast";
import { Hint } from "@/components/hint";
import { UserAvatar } from "@/components/user-avatar";
import { AVATAR_PRESETS } from "@/lib/avatar-presets";
import {
  Crown, Sword, Shield, Tv, CheckCircle2, XCircle, Gem, KeyRound, Mail, Pencil, AlertCircle, Loader2
} from "lucide-react";

interface UserProfile {
  id: number;
  clerkUserId: string;
  twitchUserId: string | null;
  twitchUsername: string | null;
  subscriptionTier: string;
  avatarPreset: string | null;
  createdAt: string;
}

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

const PLANS = [
  {
    id: "free",
    name: "Cave Dweller",
    price: "$0",
    period: "forever",
    icon: <Shield className="w-6 h-6 text-muted-foreground" />,
    color: "border-border/50",
    highlight: false,
    features: [
      "1 Twitch channel",
      "!loot and !goblin commands",
      "Basic loot leaderboard",
      "Community support",
    ],
    locked: [
      "Giveaway system",
      "!steal, !hoard, !feedgoblin",
      "Multiple channels",
    ],
  },
  {
    id: "premium",
    name: "Hoard Master",
    price: "$9.99",
    period: "per month",
    icon: <Sword className="w-6 h-6 text-purple-400" />,
    color: "border-purple-500/40",
    highlight: true,
    badge: "Most Popular",
    features: [
      "3 Twitch channels",
      "All 8 chat commands",
      "Full giveaway system",
      "Full leaderboard & stats",
      "Email support",
    ],
    locked: [
      "Custom bot name",
      "Unlimited channels",
    ],
  },
  {
    id: "pro",
    name: "Goblin King",
    price: "$24.99",
    period: "per month",
    icon: <Crown className="w-6 h-6 text-amber-400" />,
    color: "border-amber-500/40",
    highlight: false,
    badge: "Full Power",
    features: [
      "Unlimited channels",
      "All 8 chat commands",
      "Full giveaway system",
      "Full leaderboard & stats",
      "Custom goblin bot name",
      "Priority support",
      "Early access to new features",
    ],
    locked: [],
  },
];

export function Account() {
  const { user: clerkUser, isLoaded } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [avatarPickerOpen, setAvatarPickerOpen] = useState(false);
  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);

  async function authedFetch(path: string, init: RequestInit = {}) {
    const token = await getToken();
    return fetch(`${BASE}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        Authorization: `Bearer ${token}`,
      },
    });
  }

  const { data: profile, isLoading: profileLoading } = useQuery<{ user: UserProfile }>({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const r = await authedFetch("/api/users/me");
      return r.json();
    },
    enabled: isLoaded && !!clerkUser,
  });

  const subscriptionMutation = useMutation({
    mutationFn: async (tier: string) => {
      const r = await authedFetch("/api/users/me/subscription", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      toast({ title: "Scroll updated!", description: "Your plan has been changed." });
    },
    onError: () => toast({ title: "Failed to update plan", variant: "destructive" }),
  });

  const avatarMutation = useMutation({
    mutationFn: async (avatarPreset: string | null) => {
      const r = await authedFetch("/api/users/me/profile", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ avatarPreset }),
      });
      if (!r.ok) throw new Error("Failed to save avatar");
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      toast({ title: "Avatar changed", description: "Your goblin form is updated." });
    },
    onError: () => toast({ title: "Failed to save avatar", variant: "destructive" }),
  });

  const disconnectMutation = useMutation({
    mutationFn: async () => {
      const r = await authedFetch("/api/users/me/twitch", { method: "DELETE" });
      return r.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      toast({ title: "Twitch channel banished", description: "Your channel has been disconnected." });
    },
    onError: () => toast({ title: "Failed to disconnect", variant: "destructive" }),
  });

  const currentTier = profile?.user.subscriptionTier ?? "free";
  const twitchConnected = !!profile?.user.twitchUsername;

  return (
    <div className="space-y-10 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div>
        <h1 className="font-medieval text-4xl font-bold tracking-tight text-primary">The Scroll</h1>
        <p className="text-muted-foreground mt-2 text-lg">Manage your hoard membership and channel bindings.</p>
      </div>

      {/* Profile */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <CardTitle className="flex items-center gap-2 font-medieval">
            <Gem className="w-5 h-5 text-primary" />
            Your Identity
          </CardTitle>
        </CardHeader>
        <CardContent className="p-6 space-y-6">
          {!isLoaded || profileLoading ? (
            <div className="space-y-3">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64" />
            </div>
          ) : (
            <>
              {/* Identity (avatar + name + email + plan, all in one row) */}
              <div className="flex items-start gap-5">
                <div className="relative group">
                  <UserAvatar
                    presetId={profile?.user.avatarPreset}
                    imageUrl={clerkUser?.imageUrl}
                    fallbackText={profile?.user.twitchUsername ?? "?"}
                    className="w-20 h-20"
                    emojiClass="text-4xl"
                  />
                  <button
                    type="button"
                    onClick={() => setAvatarPickerOpen(true)}
                    title="Change avatar"
                    aria-label="Change avatar"
                    className="absolute -bottom-1 -right-1 w-7 h-7 rounded-full bg-primary text-primary-foreground border-2 border-background flex items-center justify-center shadow-md hover:scale-110 transition-transform"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="flex-1 min-w-0 space-y-1.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="font-bold text-xl text-foreground truncate">
                      {profile?.user.twitchUsername ?? "Unknown Goblin"}
                    </p>
                    {profile?.user.twitchUsername ? (
                      <Badge variant="outline" className="text-[10px] border-green-500/40 text-green-400 gap-1">
                        <Tv className="w-2.5 h-2.5" /> From Twitch
                      </Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] border-muted-foreground/30 text-muted-foreground">
                        Connect Twitch to set name
                      </Badge>
                    )}
                  </div>
                  <p className="text-muted-foreground text-sm truncate">{clerkUser?.primaryEmailAddress?.emailAddress}</p>
                  <div>
                    <PlanBadge tier={currentTier} />
                  </div>
                </div>
              </div>

              <Separator className="opacity-50" />

              {/* Email & Password (Clerk-managed via modal) */}
              <div className="space-y-3 max-w-sm">
                <div className="flex items-center gap-2">
                  <Label className="text-sm font-semibold">Email & Password</Label>
                  <Hint text="Email and password changes need verification, so they're handled in a secure pop-up." />
                </div>
                <div className="flex gap-2">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setEmailDialogOpen(true)}>
                    <Mail className="w-3.5 h-3.5" /> Change Email
                  </Button>
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => setPasswordDialogOpen(true)}>
                    <KeyRound className="w-3.5 h-3.5" /> Change Password
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      {/* Twitch Connection */}
      <Card className="border-border/50">
        <CardHeader className="border-b border-border/50">
          <div className="flex items-center gap-2">
            <CardTitle className="font-medieval flex items-center gap-2">
              <Tv className="w-5 h-5 text-purple-400" />
              Channel Binding
            </CardTitle>
            <Hint text="Connect your Twitch channel so the goblin bot can join and respond to chat commands. One click — no manual token copying needed." />
          </div>
          <CardDescription>Bind the goblin to your Twitch stream. One click and he's there.</CardDescription>
        </CardHeader>
        <CardContent className="p-6">
          {profileLoading ? (
            <Skeleton className="h-12 w-64" />
          ) : twitchConnected ? (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-purple-500/10 border border-purple-500/30 flex items-center justify-center">
                  <Tv className="w-5 h-5 text-purple-400" />
                </div>
                <div>
                  <p className="font-bold text-foreground">twitch.tv/{profile?.user.twitchUsername}</p>
                  <p className="text-sm text-green-500 flex items-center gap-1">
                    <CheckCircle2 className="w-3.5 h-3.5" /> Connected
                  </p>
                </div>
              </div>
              <Button
                variant="outline"
                className="border-destructive/50 text-destructive hover:bg-destructive/10"
                onClick={() => disconnectMutation.mutate()}
                disabled={disconnectMutation.isPending}
              >
                <XCircle className="w-4 h-4 mr-2" />
                {disconnectMutation.isPending ? "Banishing..." : "Disconnect Channel"}
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-between flex-wrap gap-4">
              <div>
                <p className="text-foreground font-medium">No channel bound yet</p>
                <p className="text-sm text-muted-foreground">The goblin is homeless. Give him a stream to haunt.</p>
              </div>
              <a
                href={`${BASE}/api/auth/twitch`}
                className="inline-flex items-center gap-2 bg-purple-600 hover:bg-purple-500 text-white px-5 py-2.5 rounded-lg font-bold transition-all shadow-[0_0_20px_rgba(168,85,247,0.3)]"
              >
                <Tv className="w-4 h-4" />
                Authorize on Twitch
              </a>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Subscription Plans */}
      <div>
        <div className="flex items-center gap-2 mb-6">
          <h2 className="font-medieval text-2xl font-bold text-foreground">Choose Your Rank</h2>
          <Hint text="Each rank unlocks more of the goblin's power. Upgrade to run giveaways, use all commands, and add multiple channels." />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => {
            const isActive = currentTier === plan.id;
            return (
              <div
                key={plan.id}
                className={`relative rounded-xl border bg-card/50 overflow-hidden transition-all ${
                  plan.highlight
                    ? "border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.1)]"
                    : plan.color
                } ${isActive ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""}`}
              >
                {plan.badge && (
                  <div className={`absolute top-0 right-0 text-xs font-bold px-3 py-1 ${plan.highlight ? "bg-purple-600 text-white" : "bg-amber-500 text-black"}`}>
                    {plan.badge}
                  </div>
                )}
                <div className="p-6">
                  <div className="flex items-center gap-3 mb-4">
                    <div className="w-12 h-12 rounded-xl bg-background border border-border flex items-center justify-center">
                      {plan.icon}
                    </div>
                    <div>
                      <h3 className="font-medieval font-bold text-lg text-foreground">{plan.name}</h3>
                      <div className="flex items-baseline gap-1">
                        <span className="text-2xl font-bold font-mono text-primary">{plan.price}</span>
                        <span className="text-xs text-muted-foreground">/{plan.period}</span>
                      </div>
                    </div>
                  </div>

                  <Separator className="mb-4 opacity-50" />

                  <ul className="space-y-2 mb-6">
                    {plan.features.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-foreground">
                        <CheckCircle2 className="w-4 h-4 text-green-500 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                    {plan.locked.map((f) => (
                      <li key={f} className="flex items-start gap-2 text-sm text-muted-foreground/50">
                        <XCircle className="w-4 h-4 text-muted-foreground/30 shrink-0 mt-0.5" />
                        {f}
                      </li>
                    ))}
                  </ul>

                  {isActive ? (
                    <div className="w-full py-2.5 rounded-lg bg-primary/10 border border-primary/30 text-primary font-bold text-sm text-center flex items-center justify-center gap-2">
                      <CheckCircle2 className="w-4 h-4" />
                      Current Rank
                    </div>
                  ) : (
                    <Button
                      className="w-full font-bold"
                      variant={plan.highlight ? "default" : "outline"}
                      onClick={() => subscriptionMutation.mutate(plan.id)}
                      disabled={subscriptionMutation.isPending}
                    >
                      {subscriptionMutation.isPending ? "Updating..." : `Choose ${plan.name}`}
                    </Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground mt-4 text-center">
          Premium & Pro billing coming soon via Stripe. Plans saved for when payments go live.
        </p>
      </div>

      {/* Email change dialog */}
      {clerkUser && (
        <ChangeEmailDialog
          open={emailDialogOpen}
          onOpenChange={setEmailDialogOpen}
          user={clerkUser}
          onSuccess={() => toast({ title: "Email updated", description: "Your primary email has been changed." })}
        />
      )}

      {/* Password change dialog */}
      {clerkUser && (
        <ChangePasswordDialog
          open={passwordDialogOpen}
          onOpenChange={setPasswordDialogOpen}
          user={clerkUser}
          onSuccess={() => toast({ title: "Password updated", description: "Your password has been changed." })}
        />
      )}

      {/* Avatar picker dialog */}
      <Dialog open={avatarPickerOpen} onOpenChange={setAvatarPickerOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="font-medieval">Choose your goblin form</DialogTitle>
            <DialogDescription>This avatar shows up in the sidebar and on your profile.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-3 gap-3 pt-2">
            {AVATAR_PRESETS.map((p) => {
              const selected = profile?.user.avatarPreset === p.id;
              return (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => {
                    avatarMutation.mutate(p.id, { onSuccess: () => setAvatarPickerOpen(false) });
                  }}
                  disabled={avatarMutation.isPending}
                  title={p.label}
                  className={`aspect-square rounded-xl bg-gradient-to-br ${p.bg} flex flex-col items-center justify-center gap-1 border-2 transition-all hover:scale-105 ${
                    selected ? "border-primary ring-2 ring-primary/40" : "border-border/50 opacity-90 hover:opacity-100"
                  }`}
                >
                  <span className="text-3xl">{p.emoji}</span>
                  <span className="text-[10px] font-medium text-foreground/80 uppercase tracking-wide">{p.label}</span>
                </button>
              );
            })}
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

type DialogProps = {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  user: ClerkUser;
  onSuccess: () => void;
};

function clerkErrorMessage(err: unknown): string {
  const e = err as { errors?: Array<{ message?: string; longMessage?: string }>; message?: string };
  return e.errors?.[0]?.longMessage ?? e.errors?.[0]?.message ?? e.message ?? "Something went wrong.";
}

function ChangeEmailDialog({ open, onOpenChange, user, onSuccess }: DialogProps) {
  const [step, setStep] = useState<"input" | "verify">("input");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [pendingEmail, setPendingEmail] = useState<ClerkEmail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function discardPending() {
    if (!pendingEmail) return;
    try {
      await pendingEmail.destroy();
    } catch {
      // Best-effort cleanup; ignore if Clerk rejects (already verified, network, etc.)
    }
  }

  function reset() {
    setStep("input");
    setEmail("");
    setCode("");
    setPendingEmail(null);
    setError(null);
    setBusy(false);
  }

  async function handleStart(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const created = await user.createEmailAddress({ email: email.trim() });
      await created.prepareVerification({ strategy: "email_code" });
      setPendingEmail(created);
      setStep("verify");
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleVerify(e: React.FormEvent) {
    e.preventDefault();
    if (!pendingEmail) return;
    setError(null);
    setBusy(true);
    try {
      await pendingEmail.attemptVerification({ code: code.trim() });
      await user.update({ primaryEmailAddressId: pendingEmail.id });
      onSuccess();
      // Successful — no need to discard; clear pendingEmail so close-handler doesn't destroy it.
      setPendingEmail(null);
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleBack() {
    await discardPending();
    setPendingEmail(null);
    setCode("");
    setError(null);
    setStep("input");
  }

  return (
    <Dialog
      open={open}
      onOpenChange={async (v) => {
        if (busy) return;
        if (!v) {
          await discardPending();
          reset();
        }
        onOpenChange(v);
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medieval flex items-center gap-2">
            <Mail className="w-4 h-4 text-primary" /> Change email
          </DialogTitle>
          <DialogDescription>
            {step === "input"
              ? "Enter your new email. We'll send a verification code to confirm."
              : `Enter the 6-digit code we sent to ${email}.`}
          </DialogDescription>
        </DialogHeader>

        {step === "input" ? (
          <form onSubmit={handleStart} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="new-email">New email</Label>
              <Input
                id="new-email"
                type="email"
                autoFocus
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="goblin@cave.gg"
              />
            </div>
            {error && (
              <p role="alert" aria-live="polite" className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !email.trim()} className="gap-1.5">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Send code
              </Button>
            </DialogFooter>
          </form>
        ) : (
          <form onSubmit={handleVerify} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="email-code">Verification code</Label>
              <Input
                id="email-code"
                inputMode="numeric"
                autoComplete="one-time-code"
                autoFocus
                required
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                placeholder="123456"
                maxLength={6}
                pattern="[0-9]{6}"
              />
            </div>
            {error && (
              <p role="alert" aria-live="polite" className="text-xs text-destructive flex items-center gap-1.5">
                <AlertCircle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
            <DialogFooter>
              <Button type="button" variant="ghost" disabled={busy} onClick={handleBack}>Back</Button>
              <Button type="submit" disabled={busy || code.length !== 6} className="gap-1.5">
                {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                Verify & save
              </Button>
            </DialogFooter>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ChangePasswordDialog({ open, onOpenChange, user, onSuccess }: DialogProps) {
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function reset() {
    setCurrentPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setSignOutOthers(true);
    setError(null);
    setBusy(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword !== confirmPassword) {
      setError("New password and confirmation don't match.");
      return;
    }
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    setBusy(true);
    try {
      const params: { newPassword: string; signOutOfOtherSessions: boolean; currentPassword?: string } = {
        newPassword,
        signOutOfOtherSessions: signOutOthers,
      };
      if (user.passwordEnabled) params.currentPassword = currentPassword;
      await user.updatePassword(params);
      onSuccess();
      onOpenChange(false);
      reset();
    } catch (err) {
      setError(clerkErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        if (busy) return;
        onOpenChange(v);
        if (!v) reset();
      }}
    >
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="font-medieval flex items-center gap-2">
            <KeyRound className="w-4 h-4 text-primary" /> Change password
          </DialogTitle>
          <DialogDescription>
            {user.passwordEnabled
              ? "Enter your current password and choose a new one."
              : "Set a password for your account."}
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {user.passwordEnabled && (
            <div className="space-y-1.5">
              <Label htmlFor="current-password">Current password</Label>
              <Input
                id="current-password"
                type="password"
                autoComplete="current-password"
                required
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
              />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="new-password">New password</Label>
            <Input
              id="new-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-password">Confirm new password</Label>
            <Input
              id="confirm-password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
            />
          </div>
          <label className="flex items-center gap-2 text-xs text-muted-foreground cursor-pointer">
            <input
              type="checkbox"
              checked={signOutOthers}
              onChange={(e) => setSignOutOthers(e.target.checked)}
              className="rounded border-border"
            />
            Sign out of other sessions
          </label>
          {error && (
            <p role="alert" aria-live="polite" className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" disabled={busy} onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="submit" disabled={busy} className="gap-1.5">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Save password
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PlanBadge({ tier }: { tier: string }) {
  if (tier === "pro") return <Badge className="bg-amber-500/20 text-amber-400 border-amber-500/30 font-medieval"><Crown className="w-3 h-3 mr-1" />Goblin King</Badge>;
  if (tier === "premium") return <Badge className="bg-purple-500/20 text-purple-400 border-purple-500/30 font-medieval"><Sword className="w-3 h-3 mr-1" />Hoard Master</Badge>;
  return <Badge variant="outline" className="text-muted-foreground font-medieval"><Shield className="w-3 h-3 mr-1" />Cave Dweller</Badge>;
}

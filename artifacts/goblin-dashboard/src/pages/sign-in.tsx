import { useState } from "react";
import { SignIn } from "@clerk/react";
// `useSignIn` is imported from the /legacy subpath because v6's main
// export is the new signal-based API which restricts `strategy` types
// and omits `isLoaded`/`setActive`. The legacy hook still ships the
// classic SignInResource that accepts `strategy: "password"` directly.
import { useSignIn } from "@clerk/react/legacy";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Wrench } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

export function SignInPage() {
  const [showDevForm, setShowDevForm] = useState(false);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 dark">
      <div className="w-full max-w-md space-y-4">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          fallbackRedirectUrl={`${basePath}/dashboard`}
        />

        {/* Direct password sign-in escape hatch — bypasses Clerk's hosted
            UI entirely. Necessary because Clerk's prebuilt <SignIn /> can
            default to email-code as the first factor depending on instance
            config, even when the user has a password set. This form calls
            signIn.create({ strategy: "password" }) directly so dev/admin
            accounts (whose mailboxes are fake and can't receive a code)
            can always get in. */}
        {showDevForm ? (
          <DevPasswordSignIn onClose={() => setShowDevForm(false)} />
        ) : (
          <button
            type="button"
            onClick={() => setShowDevForm(true)}
            className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline w-full text-center flex items-center justify-center gap-1.5"
            data-testid="button-show-dev-signin"
          >
            <Wrench className="w-3 h-3" />
            Dev / direct password sign-in
          </button>
        )}
      </div>
    </div>
  );
}

// Clerk error codes that indicate the password is in a known breach list
// and the user is being forced to reset. We surface a "dev bypass" button
// only when one of these fires.
const PWNED_ERROR_CODES = new Set([
  "form_password_pwned",
  "form_password_pwned_sign_in",
  "form_password_compromised",
]);

function DevPasswordSignIn({ onClose }: { onClose: () => void }) {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pwnedBlocked, setPwnedBlocked] = useState(false);
  const [bypassing, setBypassing] = useState(false);

  async function attemptSignIn(): Promise<boolean> {
    if (!isLoaded || !signIn) return false;
    const result = await signIn.create({
      identifier: identifier.trim(),
      password,
      strategy: "password",
    });
    if (result.status === "complete") {
      await setActive({ session: result.createdSessionId });
      setLocation("/dashboard");
      return true;
    }
    setError(`Sign-in incomplete (status: ${result.status}). Use the form above instead.`);
    return false;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setError(null);
    setPwnedBlocked(false);
    setBusy(true);
    try {
      await attemptSignIn();
    } catch (err) {
      const clerkErr = (err as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> })?.errors?.[0];
      if (clerkErr?.code && PWNED_ERROR_CODES.has(clerkErr.code)) {
        setPwnedBlocked(true);
      }
      const msg = clerkErr?.longMessage ?? clerkErr?.message ?? (err instanceof Error ? err.message : "Sign-in failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleBypassAndRetry() {
    setError(null);
    setBypassing(true);
    try {
      const r = await fetch(`${basePath}/api/auth/dev-bypass-pwned`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: identifier.trim(), password }),
      });
      if (!r.ok) {
        const body = (await r.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Bypass failed.");
        return;
      }
      // Clerk has cleared the compromised flag — retry the sign-in.
      setPwnedBlocked(false);
      await attemptSignIn();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Bypass failed.");
    } finally {
      setBypassing(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3"
      data-testid="form-dev-signin"
    >
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-1.5 text-amber-300">
          <Wrench className="w-3.5 h-3.5" />
          Direct password sign-in
        </h3>
        <button
          type="button"
          onClick={onClose}
          className="text-[11px] text-muted-foreground hover:text-foreground"
          data-testid="button-hide-dev-signin"
        >
          Hide
        </button>
      </div>
      <p className="text-[11px] text-amber-200/80 leading-relaxed">
        Skips Clerk's email-code flow. Use for dev/admin accounts with fake mailboxes
        that can't receive a verification code.
      </p>
      <div className="space-y-2">
        <Label htmlFor="dev-identifier" className="text-xs">Email</Label>
        <Input
          id="dev-identifier"
          type="email"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="test@test.com"
          required
          data-testid="input-dev-identifier"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="dev-password" className="text-xs">Password</Label>
        <Input
          id="dev-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          data-testid="input-dev-password"
        />
      </div>
      {error && (
        <p className="text-xs text-destructive" data-testid="text-dev-signin-error">{error}</p>
      )}
      {pwnedBlocked && (
        <div className="rounded border border-amber-500/40 bg-amber-500/10 p-2.5 space-y-2">
          <p className="text-[11px] text-amber-200 leading-relaxed">
            This password was found in a public breach list and Clerk is forcing a reset.
            For dev/admin accounts (fake mailbox), bypass the check below — the
            credentials still need to be valid.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="w-full border-amber-500/50 hover:bg-amber-500/20"
            onClick={handleBypassAndRetry}
            disabled={bypassing || !identifier.trim() || !password}
            data-testid="button-dev-bypass-pwned"
          >
            {bypassing && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
            Bypass breach check & retry
          </Button>
        </div>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || !isLoaded || !identifier.trim() || !password}
        data-testid="button-dev-signin-submit"
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
        Sign in with password
      </Button>
    </form>
  );
}

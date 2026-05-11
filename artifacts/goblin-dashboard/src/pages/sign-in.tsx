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
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 dark">
      <div className="w-full max-w-md space-y-4">
        <SignIn
          routing="path"
          path={`${basePath}/sign-in`}
          signUpUrl={`${basePath}/sign-up`}
          fallbackRedirectUrl={`${basePath}/dashboard`}
        />

        {/* Direct password sign-in escape hatch — always visible so users
            stuck on Clerk's hosted "Password compromised" / "Verify email"
            screens can hit Back, scroll down, and route around without
            having to re-discover the form. Calls signIn.create({
            strategy: "password" }) directly, sidestepping the hosted UI's
            strategy chooser AND the breach-check screen (the dev/admin
            bypass endpoint clears the flag mid-flow). Required because
            Replit-managed Clerk doesn't let us disable either flow at the
            instance level. */}
        <DevPasswordSignIn />
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

// Heuristic: if the email looks like a throwaway dev/test address, we
// auto-prompt the bypass UI so the user doesn't have to fail-then-discover.
// Real users with these patterns are vanishingly rare; worst case is they
// see a tooltip-sized hint they can ignore.
const DEV_EMAIL_PATTERNS = [
  /@test\./i,
  /@example\./i,
  /@localhost$/i,
  /^test@/i,
  /^dev@/i,
  /^admin@/i,
];
function looksLikeDevEmail(email: string): boolean {
  const trimmed = email.trim();
  if (!trimmed) return false;
  return DEV_EMAIL_PATTERNS.some((re) => re.test(trimmed));
}

function DevPasswordSignIn() {
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

  const showDevHint = looksLikeDevEmail(identifier);

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-4 space-y-3"
      data-testid="form-dev-signin"
    >
      <h3 className="text-sm font-semibold flex items-center gap-1.5 text-amber-300">
        <Wrench className="w-3.5 h-3.5" />
        Direct password sign-in
      </h3>
      <p className="text-[11px] text-amber-200/80 leading-relaxed">
        Skips the form above entirely — including the email-code step AND the
        "password compromised" wall. Use for dev/admin accounts with fake
        mailboxes that can't receive a verification code.
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
      {showDevHint && !pwnedBlocked && !error && (
        <p className="text-[11px] text-amber-200/70 leading-relaxed" data-testid="text-dev-email-hint">
          Looks like a dev account — if Clerk says the password is compromised after you hit
          sign-in, a "Bypass breach check" button will appear here.
        </p>
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

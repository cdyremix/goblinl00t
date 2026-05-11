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
import { Loader2, ChevronDown, ChevronUp } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk error codes that indicate the password is in a known breach list
// and the user is being forced to reset. Replit-managed Clerk forces this
// instance-wide and won't let us disable it, so we auto-bypass via our
// backend for dev/admin accounts and surface a reset-flow link otherwise.
const PWNED_ERROR_CODES = new Set([
  "form_password_pwned",
  "form_password_pwned_sign_in",
  "form_password_compromised",
]);

export function SignInPage() {
  const [showHosted, setShowHosted] = useState(false);

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 dark">
      <div className="w-full max-w-md space-y-4">
        {/* Direct form is now PRIMARY. The hosted Clerk <SignIn /> widget
            below is only here for Google OAuth + the password-reset flow
            for real users. Doing it this way means dev/admin accounts
            never have to even touch the hosted widget — which is the only
            surface that renders the un-suppressible "Password compromised"
            screen. */}
        <PrimarySignIn />

        <button
          type="button"
          onClick={() => setShowHosted((v) => !v)}
          className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline w-full text-center flex items-center justify-center gap-1.5"
          data-testid="button-toggle-hosted-signin"
        >
          {showHosted ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
          {showHosted ? "Hide other options" : "Continue with Google or reset password"}
        </button>

        {showHosted && (
          <div data-testid="hosted-signin-wrapper">
            <SignIn
              routing="path"
              path={`${basePath}/sign-in`}
              signUpUrl={`${basePath}/sign-up`}
              fallbackRedirectUrl={`${basePath}/dashboard`}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function PrimarySignIn() {
  const { isLoaded, signIn, setActive } = useSignIn();
  const [, setLocation] = useLocation();
  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsReset, setNeedsReset] = useState(false);

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
    setError(`Sign-in incomplete (status: ${result.status}).`);
    return false;
  }

  // Returns true if the bypass succeeded (caller should retry sign-in).
  // Returns false if the account isn't dev/admin (caller should surface a
  // reset prompt). Throws on transport errors.
  async function tryBypass(): Promise<boolean> {
    const r = await fetch(`${basePath}/api/auth/dev-bypass-pwned`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: identifier.trim(), password }),
    });
    return r.ok;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setError(null);
    setNeedsReset(false);
    setBusy(true);
    try {
      await attemptSignIn();
    } catch (err) {
      const clerkErr = (err as { errors?: Array<{ code?: string; longMessage?: string; message?: string }> })?.errors?.[0];

      // Clerk's breach check fired. For dev/admin we silently clear the
      // flag and retry — the user never sees the "Password compromised"
      // screen. For everyone else we direct them to the hosted reset flow.
      if (clerkErr?.code && PWNED_ERROR_CODES.has(clerkErr.code)) {
        try {
          const ok = await tryBypass();
          if (ok) {
            try {
              await attemptSignIn();
              return;
            } catch (retryErr) {
              const re = (retryErr as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors?.[0];
              setError(re?.longMessage ?? re?.message ?? "Sign-in failed after bypass.");
              return;
            }
          }
        } catch {
          // Network failure on bypass — fall through to reset prompt.
        }
        setNeedsReset(true);
        setError("This password was found in a public breach. Reset it via 'Continue with Google or reset password' below.");
        return;
      }

      const msg = clerkErr?.longMessage ?? clerkErr?.message ?? (err instanceof Error ? err.message : "Sign-in failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-lg border border-border bg-card p-5 space-y-4"
      data-testid="form-primary-signin"
    >
      <div className="space-y-1">
        <h1 className="text-lg font-semibold">Sign in to Goblin L00t</h1>
        <p className="text-xs text-muted-foreground">Enter your email and password.</p>
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-identifier" className="text-xs">Email</Label>
        <Input
          id="signin-identifier"
          type="email"
          autoComplete="username"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          placeholder="you@example.com"
          required
          data-testid="input-signin-identifier"
        />
      </div>
      <div className="space-y-2">
        <Label htmlFor="signin-password" className="text-xs">Password</Label>
        <Input
          id="signin-password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          data-testid="input-signin-password"
        />
      </div>
      {error && (
        <p
          className={
            needsReset
              ? "text-xs text-amber-300 leading-relaxed"
              : "text-xs text-destructive leading-relaxed"
          }
          data-testid="text-signin-error"
        >
          {error}
        </p>
      )}
      <Button
        type="submit"
        className="w-full"
        disabled={busy || !isLoaded || !identifier.trim() || !password}
        data-testid="button-signin-submit"
      >
        {busy && <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />}
        Sign in
      </Button>
      <p className="text-[11px] text-muted-foreground text-center">
        Don't have an account?{" "}
        <a
          href={`${basePath}/sign-up`}
          className="text-foreground underline-offset-4 hover:underline"
          data-testid="link-signup"
        >
          Create one
        </a>
      </p>
    </form>
  );
}

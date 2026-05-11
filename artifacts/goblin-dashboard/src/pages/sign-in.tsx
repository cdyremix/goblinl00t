import { useState } from "react";
// `useSignIn` is imported from the /legacy subpath because v6's main
// export is the new signal-based API which restricts `strategy` types
// and omits `isLoaded`/`setActive`. The legacy hook still ships the
// classic SignInResource that accepts `strategy: "password"` directly.
import { useSignIn } from "@clerk/react/legacy";
import { useLocation } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2 } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

// Clerk error codes that indicate the password is in a known breach list
// and the user is being forced to reset. Replit-managed Clerk forces this
// instance-wide and won't let us disable it, so we auto-bypass via our
// backend for dev/admin accounts and surface a friendly error otherwise.
const PWNED_ERROR_CODES = new Set([
  "form_password_pwned",
  "form_password_pwned_sign_in",
  "form_password_compromised",
]);

export function SignInPage() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 py-8 dark">
      <div className="w-full max-w-md space-y-3">
        {/* This page deliberately does NOT mount Clerk's hosted <SignIn />
            widget. That widget renders the un-suppressible "Password
            compromised" screen and the greyed-out "Email code" option,
            neither of which is customizable on Replit-managed Clerk.
            We talk to Clerk's API directly via signIn.create / Google
            redirect, and the dev-bypass-pwned endpoint silently clears
            the breach flag for dev/admin accounts mid-flow. */}
        <PrimarySignIn />
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
  const [googleBusy, setGoogleBusy] = useState(false);
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

      // Clerk's breach check fired. Dev/admin: silently clear and retry,
      // user never sees the "Password compromised" screen. Everyone else:
      // surface a clear "contact admin" error since we don't expose a
      // password-reset flow on this page.
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
        setError("This password was found in a public breach. Pick a different password — for managed accounts, ask an admin to reset it for you.");
        return;
      }

      const msg = clerkErr?.longMessage ?? clerkErr?.message ?? (err instanceof Error ? err.message : "Sign-in failed");
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  async function handleGoogle() {
    if (!isLoaded || !signIn) return;
    setError(null);
    setGoogleBusy(true);
    try {
      // Clerk's OAuth handoff. Returning here; if the user is new, Clerk
      // will route them through transfer/sign-up automatically.
      await signIn.authenticateWithRedirect({
        strategy: "oauth_google",
        redirectUrl: `${window.location.origin}${basePath}/sign-in`,
        redirectUrlComplete: `${window.location.origin}${basePath}/dashboard`,
      });
    } catch (err) {
      const clerkErr = (err as { errors?: Array<{ longMessage?: string; message?: string }> })?.errors?.[0];
      setError(clerkErr?.longMessage ?? clerkErr?.message ?? "Google sign-in failed");
      setGoogleBusy(false);
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

      <div className="flex items-center gap-2 my-1">
        <span className="h-px flex-1 bg-border" />
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">or</span>
        <span className="h-px flex-1 bg-border" />
      </div>

      <Button
        type="button"
        variant="outline"
        className="w-full"
        onClick={handleGoogle}
        disabled={googleBusy || !isLoaded}
        data-testid="button-signin-google"
      >
        {googleBusy ? (
          <Loader2 className="w-3.5 h-3.5 animate-spin mr-1.5" />
        ) : (
          <GoogleIcon className="w-4 h-4 mr-2" />
        )}
        Continue with Google
      </Button>

      <p className="text-[11px] text-muted-foreground text-center pt-1">
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

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16 19 13 24 13c3.1 0 5.8 1.2 7.9 3l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.4 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2c-2 1.5-4.6 2.4-7.3 2.4-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.5 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.3-4.2 5.6l6.2 5.2C40.9 35.4 44 30.1 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

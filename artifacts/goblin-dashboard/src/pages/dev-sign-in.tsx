import { useState } from "react";
import { useLocation } from "wouter";
// Use the legacy entry point: it returns the classic
// `{ isLoaded, signIn, setActive }` shape with the imperative
// `signIn.create({ strategy: "ticket", ticket })` method we need to
// exchange a Clerk sign-in token for a session. The new signal-based
// `useSignIn` from "@clerk/react" doesn't expose `setActive`/`create`
// directly.
import { useSignIn } from "@clerk/react/legacy";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Wrench, AlertCircle } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * DEV-ONLY sign-in shortcut. Mounted at `/dev-sign-in` and only when
 * `import.meta.env.DEV` is true (Vite strips the route from prod
 * builds). Posts to `POST /api/auth/dev-sign-in` to mint a Clerk
 * sign-in ticket, then completes the sign-in via Clerk's `ticket`
 * strategy so we skip the email-OTP / new-device verification dance
 * entirely.
 *
 * The server endpoint also fails closed in production (returns 404),
 * so this is defense-in-depth: a leaked dev build can't actually use
 * it against a live app.
 */
export default function DevSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${basePath}/api/auth/dev-sign-in`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const json = (await r.json().catch(() => ({}))) as { ticket?: string; error?: string };
      if (!r.ok || !json.ticket) {
        setError(json.error ?? `Request failed (${r.status})`);
        return;
      }
      const result = await signIn.create({ strategy: "ticket", ticket: json.ticket });
      if (result.status === "complete" && result.createdSessionId) {
        await setActive({ session: result.createdSessionId });
        setLocation("/dashboard");
        return;
      }
      setError(`Sign-in returned status: ${result.status}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-background px-4 dark">
      <Card className="w-full max-w-md border-amber-500/40">
        <CardHeader>
          <CardTitle className="font-medieval flex items-center gap-2 text-amber-400">
            <Wrench className="w-4 h-4" /> Dev sign-in
          </CardTitle>
          <CardDescription>
            Skips Clerk's email-OTP and new-device verification. Only mounted in
            development builds — disabled in production.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="dev-email">Account email</Label>
              <Input
                id="dev-email"
                type="email"
                autoComplete="email"
                required
                autoFocus
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  if (error) setError(null);
                }}
                placeholder="someone@example.com"
                data-testid="input-dev-email"
              />
              <p className="text-[11px] text-muted-foreground">
                The email must already exist in Clerk. Use the Admin Console to
                provision a fresh account first.
              </p>
            </div>
            {error && (
              <p
                role="alert"
                className="text-xs text-destructive flex items-center gap-1.5"
                data-testid="error-dev-sign-in"
              >
                <AlertCircle className="w-3.5 h-3.5" /> {error}
              </p>
            )}
            <Button
              type="submit"
              disabled={busy || !isLoaded || email.trim().length === 0}
              className="w-full gap-1.5"
              data-testid="button-dev-sign-in"
            >
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Sign in
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

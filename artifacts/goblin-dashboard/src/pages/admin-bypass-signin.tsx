import { useState } from "react";
import { useLocation } from "wouter";
import { useSignIn } from "@clerk/react/legacy";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, ShieldCheck, AlertCircle, ChevronLeft } from "lucide-react";

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Admin / Dev bypass sign-in page.
 *
 * Uses the global override code (known only to admins and devs) to skip
 * Clerk's email-OTP / new-device verification flow entirely. The server
 * checks the code AND verifies the user is isAdmin or isStaff in the DB
 * before minting a sign-in ticket — so leaking the URL alone is not enough
 * to bypass authentication.
 *
 * Mounted at `/admin-bypass` — NOT gated on import.meta.env.DEV, because
 * it needs to work on the live published app as well.
 */
export default function AdminBypassSignIn() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const [, setLocation] = useLocation();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!isLoaded || !signIn) return;
    setError(null);
    setBusy(true);
    try {
      const r = await fetch(`${basePath}/api/auth/admin-bypass`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), code: code.trim() }),
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
      <div className="w-full max-w-md space-y-4">
        <Button
          variant="ghost"
          size="sm"
          className="text-muted-foreground hover:text-foreground -ml-1"
          onClick={() => setLocation("/sign-in")}
        >
          <ChevronLeft className="w-4 h-4 mr-1" />
          Back to sign in
        </Button>

        <Card className="border-amber-500/30">
          <CardHeader>
            <CardTitle className="font-medieval flex items-center gap-2 text-amber-400">
              <ShieldCheck className="w-5 h-5" /> Admin Override
            </CardTitle>
            <CardDescription>
              Enter your account email and the override code to skip new-device
              verification. Only works for admin and dev accounts.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="bypass-email">Email</Label>
                <Input
                  id="bypass-email"
                  type="email"
                  autoComplete="email"
                  placeholder="your@email.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  disabled={busy}
                  required
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bypass-code">Override code</Label>
                <Input
                  id="bypass-code"
                  type="text"
                  inputMode="numeric"
                  placeholder="••••••"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  disabled={busy}
                  required
                  autoComplete="off"
                />
              </div>

              {error && (
                <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={busy || !email || !code}>
                {busy ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : <ShieldCheck className="w-4 h-4 mr-2" />}
                {busy ? "Verifying…" : "Bypass verification"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

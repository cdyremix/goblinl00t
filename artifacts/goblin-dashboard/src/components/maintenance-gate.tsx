import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useAuth } from "@clerk/react";
import { Sparkles, Wrench, Mail, LogIn, ShieldCheck } from "lucide-react";

interface MaintenanceStatus {
  enabled: boolean;
  isAdmin: boolean;
}

const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");

/**
 * Paths that stay reachable even while maintenance mode is on. Sign-in
 * is needed so an admin can authenticate and bypass the wall. Terms /
 * privacy stay public for legal continuity. `/sign-up` is intentionally
 * NOT allowlisted — closed beta during maintenance — admins are pre-
 * provisioned. Everything else is blocked until either maintenance mode
 * is off OR the caller's server-resolved `isAdmin` flag is true.
 */
const ALLOWED_PATH_PREFIXES = ["/sign-in", "/terms", "/privacy"];

function pathIsAllowed(path: string): boolean {
  return ALLOWED_PATH_PREFIXES.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Wraps the app router. While `MAINTENANCE_MODE` is on (server-side
 * env), non-admin visitors get a full-screen modal with a "notify me"
 * email form + a Dev Login link to sign-in. Admins get a slim banner
 * but otherwise see the full app so they can keep testing in prod.
 *
 * The status is fetched from the public `/api/maintenance/status` —
 * the server is the source of truth so flipping the env var takes
 * effect on the next page load (or query refetch) without a redeploy.
 */
export function MaintenanceGate({ children }: { children: React.ReactNode }) {
  const { isLoaded: authLoaded, isSignedIn, getToken } = useAuth();
  const [location] = useLocation();

  const { data, isLoading, isError } = useQuery<MaintenanceStatus>({
    queryKey: ["maintenance", "status", isSignedIn],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (isSignedIn) {
        const token = await getToken();
        if (token) headers["Authorization"] = `Bearer ${token}`;
      }
      const res = await fetch("/api/maintenance/status", { headers });
      if (!res.ok) throw new Error("Failed to load maintenance status");
      return res.json();
    },
    enabled: authLoaded,
    refetchOnWindowFocus: true,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: 1,
  });

  // While the status query is in flight, show a neutral splash instead
  // of children. Without this, a non-admin could theoretically read the
  // app for the brief unresolved window. Splash is short (<200ms typical).
  if (!authLoaded || isLoading) return <StatusSplash />;

  // If the status request fails outright (network down, server 5xx) we
  // fail CLOSED — show the wall. Rationale: if the API can't be reached
  // the app won't work anyway, and we'd rather over-show the wall than
  // leak the dashboard while the server is in an unknown state.
  if (isError || !data) return <MaintenanceModal />;

  // Off → render the app normally, no banner, no overhead.
  if (!data.enabled) return <>{children}</>;

  // Admin bypass — surface a slim banner so it's obvious the wall is
  // active for everyone else, but let the admin keep working.
  if (data.isAdmin) {
    return (
      <>
        <div
          className="sticky top-0 z-[60] w-full bg-amber-500/95 text-black text-xs font-semibold px-4 py-1.5 flex items-center justify-center gap-2 shadow"
          data-testid="banner-maintenance-admin"
        >
          <ShieldCheck className="w-3.5 h-3.5" />
          Maintenance mode is ON — public visitors see the launch wall. You're bypassing it as an admin.
        </div>
        {children}
      </>
    );
  }

  // Allow sign-in / sign-up / legal pages through so admins can log in
  // and the legal footer keeps working. Everything else gets the wall.
  if (pathIsAllowed(location)) return <>{children}</>;

  return <MaintenanceModal />;
}

function StatusSplash() {
  return (
    <div className="flex min-h-[100dvh] items-center justify-center bg-[#0d0f0e]">
      <div className="flex flex-col items-center gap-3 opacity-70">
        <img
          src={`${basePath}/goblin-logo.png`}
          alt="Goblin"
          className="w-14 h-14 object-contain animate-pulse"
        />
      </div>
    </div>
  );
}

function MaintenanceModal() {
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const signup = useMutation({
    mutationFn: async (addr: string) => {
      const res = await fetch("/api/waitlist", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: addr, source: "maintenance-modal" }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(json?.error ?? "Could not save your email. Please try again.");
      }
      return json;
    },
    onSuccess: () => {
      setSubmitted(true);
      setErrorMsg(null);
    },
    onError: (err: Error) => {
      setErrorMsg(err.message);
    },
  });

  useEffect(() => {
    // Lock background scroll while the wall is up.
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, []);

  function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    if (!email.trim()) return;
    signup.mutate(email.trim());
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0d0f0e] px-4 dark"
      data-testid="modal-maintenance"
      role="dialog"
      aria-modal="true"
    >
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_30%,rgba(245,170,30,0.10),transparent_60%)]" />

      <div className="relative w-full max-w-lg rounded-2xl border border-[#2a3530] bg-[#111512] p-8 shadow-[0_0_60px_rgba(0,0,0,0.7)]">
        <div className="flex flex-col items-center text-center">
          <img
            src={`${basePath}/goblin-logo.png`}
            alt="Goblin L00t"
            className="w-20 h-20 object-contain mb-4 drop-shadow-[0_0_18px_rgba(245,170,30,0.4)]"
          />

          <div className="inline-flex items-center gap-2 rounded-full border border-amber-500/40 bg-amber-500/10 px-3 py-1 mb-4">
            <Wrench className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs font-semibold tracking-wide text-amber-300 uppercase">
              Tweaking the cave
            </span>
          </div>

          <h1 className="text-3xl font-bold text-[#e8e0d0] mb-2 font-medieval">
            Goblin L00t is testing
          </h1>
          <p className="text-sm text-[#9e9585] leading-relaxed max-w-sm">
            We're polishing rough edges and tuning the loot drops before launch. The bot will be live soon — drop your email and we'll holler the moment it's ready.
          </p>
        </div>

        {submitted ? (
          <div
            className="mt-6 rounded-lg border border-green-500/30 bg-green-500/10 px-4 py-4 text-center"
            data-testid="state-waitlist-success"
          >
            <Sparkles className="w-5 h-5 text-green-400 mx-auto mb-1" />
            <p className="text-sm font-semibold text-green-300">You're on the list!</p>
            <p className="text-xs text-[#9e9585] mt-1">
              We'll email you the second the goblin opens shop.
            </p>
          </div>
        ) : (
          <form onSubmit={onSubmit} className="mt-6 space-y-3">
            <label htmlFor="waitlist-email" className="block text-xs font-medium text-[#9e9585]">
              Notify me when live
            </label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#9e9585]" />
                <input
                  id="waitlist-email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full rounded-md border border-[#2a3530] bg-[#1d2420] pl-9 pr-3 py-2 text-sm text-[#e8e0d0] placeholder:text-[#5e564b] focus:outline-none focus:ring-2 focus:ring-amber-500/50"
                  data-testid="input-waitlist-email"
                />
              </div>
              <button
                type="submit"
                disabled={signup.isPending}
                className="rounded-md bg-amber-500 px-4 py-2 text-sm font-bold text-black hover:bg-amber-400 disabled:opacity-60 disabled:cursor-not-allowed transition-colors"
                data-testid="button-waitlist-submit"
              >
                {signup.isPending ? "…" : "Notify me"}
              </button>
            </div>
            {errorMsg && (
              <p className="text-xs text-red-400" data-testid="text-waitlist-error">
                {errorMsg}
              </p>
            )}
          </form>
        )}

        <div className="mt-6 pt-5 border-t border-[#1c2421] flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-[#9e9585]">
          <span>Dev / testing access only</span>
          <a
            href={`${basePath}/sign-in`}
            className="inline-flex items-center gap-1.5 rounded-md border border-[#2a3530] bg-[#1a221e] hover:bg-[#222e28] px-3 py-1.5 text-xs font-medium text-[#e8e0d0] transition-colors"
            data-testid="link-dev-login"
          >
            <LogIn className="w-3.5 h-3.5" />
            Dev login
          </a>
        </div>
      </div>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { useAuth, useUser } from "@clerk/react";
import { Lock, Sparkles } from "lucide-react";
import { Link } from "wouter";
import type { ReactNode } from "react";
import {
  hasFeature,
  minTierFor,
  planNameFor,
  type FeatureId,
  type TierId,
} from "@/lib/plans";

interface MeResponse {
  user: { subscriptionTier: string; isAdmin?: boolean };
}

/**
 * Caller's current subscription tier. Reads /users/me (cached by Clerk
 * auth state). Returns "free" while loading so feature gates default to
 * the safe / locked side rather than briefly leaking premium UI.
 *
 * Admin accounts (`user.isAdmin === true`) get every feature unlocked
 * regardless of `subscriptionTier`. The reported `tier` is still the
 * real DB value so the Rank tab UI stays accurate, but `hasFeature`
 * short-circuits to `true` for admins to mirror the server behavior in
 * `tier-helpers.ts`.
 */
export function useSubscriptionTier(): {
  tier: TierId;
  loading: boolean;
  isAdmin: boolean;
  hasFeature: (f: FeatureId) => boolean;
} {
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const { isLoaded: userLoaded } = useUser();
  const enabled = isLoaded && userLoaded && !!isSignedIn;

  const { data, isLoading } = useQuery<MeResponse>({
    queryKey: ["users", "me"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/users/me", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load profile");
      return res.json();
    },
    enabled,
  });

  const raw = data?.user.subscriptionTier ?? "free";
  const tier: TierId =
    raw === "premium" || raw === "pro" || raw === "free" ? raw : "free";
  const isAdmin = !!data?.user.isAdmin;

  return {
    tier,
    loading: !enabled || isLoading,
    isAdmin,
    hasFeature: (f: FeatureId) => isAdmin || hasFeature(tier, f),
  };
}

/**
 * Wrap any UI surface that requires a paid feature. When locked, the
 * children render with a frosted overlay + an "Upgrade" CTA pointing
 * at /account?tab=rank. When unlocked, children render unchanged.
 *
 * Use this for cards / form sections that the streamer should still SEE
 * (so they understand what they'd unlock) but not interact with.
 */
export function FeatureLock({
  feature,
  children,
  className = "",
  description,
}: {
  feature: FeatureId;
  children: ReactNode;
  className?: string;
  description?: string;
}) {
  const { hasFeature: has, loading } = useSubscriptionTier();
  const unlocked = has(feature);
  const min = minTierFor(feature);
  const minName = planNameFor(min);

  if (loading || unlocked) return <>{children}</>;

  return (
    <div className={`relative ${className}`} data-testid={`feature-lock-${feature}`}>
      <div className="pointer-events-none select-none opacity-40 blur-[1px]">
        {children}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center rounded-xl bg-background/70 backdrop-blur-[2px] border border-amber-500/30">
        <div className="text-center px-4 py-3 max-w-sm">
          <div className="inline-flex items-center justify-center w-10 h-10 rounded-full bg-amber-500/20 border border-amber-500/40 mb-2">
            <Lock className="w-5 h-5 text-amber-400" />
          </div>
          <p className="text-sm font-semibold text-foreground">
            Unlock with <span className="text-amber-400">{minName}</span>
          </p>
          {description && (
            <p className="text-xs text-muted-foreground mt-1">{description}</p>
          )}
          <Link
            href="/account?tab=rank"
            className="inline-flex items-center gap-1.5 mt-3 px-3 py-1.5 rounded-md bg-amber-500 hover:bg-amber-400 text-black text-xs font-bold transition-colors"
            data-testid={`button-upgrade-${feature}`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            See ranks
          </Link>
        </div>
      </div>
    </div>
  );
}

/**
 * Smaller inline badge for marking a single button / row as locked.
 * Use when you want the surrounding UI to stay interactive but the
 * specific control to be disabled w/ an upgrade hint.
 */
export function LockedHint({ feature, className = "" }: { feature: FeatureId; className?: string }) {
  const min = minTierFor(feature);
  const minName = planNameFor(min);
  return (
    <Link
      href="/account?tab=rank"
      className={`inline-flex items-center gap-1 text-xs font-medium text-amber-400 hover:text-amber-300 ${className}`}
      data-testid={`locked-hint-${feature}`}
    >
      <Lock className="w-3 h-3" /> {minName}+
    </Link>
  );
}

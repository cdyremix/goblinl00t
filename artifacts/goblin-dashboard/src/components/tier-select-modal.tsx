import { useUser, useAuth } from "@clerk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, XCircle } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { PLANS, FEATURES, hasFeature, type Plan } from "@/lib/plans";

const BASE = import.meta.env.BASE_URL.replace(/\/$/, "");

interface Props {
  open: boolean;
  onPicked: () => void;
}

/**
 * Post-signup tier picker. Opens once per account when `tierSelected` is
 * false on the streamer's row. Choosing any tier (including the free one)
 * flips the flag so it never re-opens. The modal is intentionally NOT
 * dismissible via overlay/X — every new account picks a starting rank
 * before the rest of the dashboard becomes usable.
 */
export function TierSelectModal({ open, onPicked }: Props) {
  const { isLoaded, isSignedIn } = useUser();
  const { getToken } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const pickMutation = useMutation({
    mutationFn: async (tier: Plan["id"]) => {
      const token = await getToken();
      // Free tier — flip tier_selected via the legacy endpoint and we're done.
      // Paid tiers — kick off Stripe Checkout and redirect; the success URL
      // brings the user back to /account?tab=rank&checkout=success and the
      // subscription webhook reconciles their tier server-side.
      if (tier === "free") {
        const r = await fetch(`${BASE}/api/users/me/subscription`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ tier }),
        });
        if (!r.ok) throw new Error("Failed to set rank");
        return { kind: "free" as const };
      }
      // Acknowledge the rank pick BEFORE redirecting to Stripe — otherwise
      // `tierSelected` stays false and this non-dismissible modal will
      // re-open the moment the user lands back on the dashboard (whether
      // they completed checkout or hit cancel). Tier reconciliation from
      // the actual subscription still happens server-side via
      // GET /stripe/subscription on /account.
      await fetch(`${BASE}/api/users/me/tier-acknowledge`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
      }).catch(() => {
        /* non-fatal — checkout still proceeds */
      });
      const r = await fetch(`${BASE}/api/stripe/checkout`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tier }),
      });
      if (!r.ok) {
        const err = (await r.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error ?? "Failed to start checkout");
      }
      const { url } = (await r.json()) as { url: string };
      return { kind: "checkout" as const, url };
    },
    onSuccess: (data, tier) => {
      if (data.kind === "checkout") {
        // Top-level navigation so we escape the Replit preview iframe.
        // Use the current window's location, NOT window.top — accessing
        // window.top.location across the Replit preview iframe boundary
        // throws "permission denied to access property 'assign' on
        // cross-origin object". Setting location.href on the current
        // window still escapes to a full page navigation.
        window.location.href = data.url;
        return;
      }
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      const plan = PLANS.find((p) => p.id === tier);
      toast({
        title: `Welcome, ${plan?.name ?? "goblin"}!`,
        description: "You're on the free plan. Upgrade any time from The Scroll.",
      });
      onPicked();
    },
    onError: (err: Error) =>
      toast({
        title: "Couldn't save your rank",
        description: err.message,
        variant: "destructive",
      }),
  });

  if (!isLoaded || !isSignedIn) return null;

  return (
    <Dialog open={open} onOpenChange={() => { /* not dismissible */ }}>
      <DialogContent
        className="max-w-4xl w-[95vw] max-h-[90vh] overflow-y-auto flex flex-col [&>button]:hidden"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="font-medieval text-2xl text-primary">
            Pick your rank
          </DialogTitle>
          <DialogDescription>
            Every goblin needs a starting rank. The free tier is fully usable —
            upgrade any time from <span className="text-foreground">The Scroll</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mt-2">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className={`relative rounded-xl border bg-card/50 p-5 flex flex-col ${
                plan.highlight
                  ? "border-purple-500/50 shadow-[0_0_30px_rgba(168,85,247,0.1)]"
                  : plan.color
              }`}
              data-testid={`tier-pick-${plan.id}`}
            >
              {plan.badge && (
                <div
                  className={`absolute top-0 right-0 text-[10px] font-bold px-2.5 py-0.5 rounded-bl-md ${
                    plan.highlight
                      ? "bg-purple-600 text-white"
                      : "bg-amber-500 text-black"
                  }`}
                >
                  {plan.badge}
                </div>
              )}
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-lg bg-background border border-border flex items-center justify-center">
                  {plan.icon}
                </div>
                <div>
                  <h3 className="font-medieval font-bold text-base text-foreground">
                    {plan.name}
                  </h3>
                  <div className="flex items-baseline gap-1">
                    <span className="text-xl font-bold font-mono text-primary">
                      {plan.price}
                    </span>
                    <span className="text-[11px] text-muted-foreground">
                      /{plan.period}
                    </span>
                  </div>
                </div>
              </div>

              <Separator className="mb-3 opacity-50" />

              {/* Full FEATURES list with check/X parity — every plan
                  card shows the same rows so the streamer can compare
                  apples-to-apples. Mirrors the rank cards on /account. */}
              <ul className="space-y-1.5 mb-4 flex-1">
                {FEATURES.map((feat) => {
                  const included = hasFeature(plan.id, feat.id);
                  return (
                    <li
                      key={feat.id}
                      className={`flex items-start gap-2 text-xs ${
                        included ? "text-foreground" : "text-muted-foreground/50"
                      }`}
                    >
                      {included ? (
                        <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                      ) : (
                        <XCircle className="w-3.5 h-3.5 text-muted-foreground/30 shrink-0 mt-0.5" />
                      )}
                      <span>{feat.label}</span>
                    </li>
                  );
                })}
              </ul>

              <Button
                className="w-full font-bold"
                variant={plan.highlight ? "default" : "outline"}
                onClick={() => pickMutation.mutate(plan.id)}
                disabled={pickMutation.isPending}
                data-testid={`button-pick-${plan.id}`}
              >
                {pickMutation.isPending && pickMutation.variables === plan.id
                  ? "Saving…"
                  : plan.id === "free"
                    ? "Start free"
                    : `Choose ${plan.name}`}
              </Button>
            </div>
          ))}
        </div>

        <p className="text-[11px] text-muted-foreground text-center mt-3">
          Paid ranks are billed monthly via Stripe. You can switch or cancel
          any time from The Scroll.
        </p>
      </DialogContent>
    </Dialog>
  );
}

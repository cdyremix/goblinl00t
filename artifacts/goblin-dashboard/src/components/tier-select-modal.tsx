import { useUser, useAuth } from "@clerk/react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2 } from "lucide-react";
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
import { PLANS, type Plan } from "@/lib/plans";

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
      const r = await fetch(`${BASE}/api/users/me/subscription`, {
        method: "PUT",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ tier }),
      });
      if (!r.ok) throw new Error("Failed to set rank");
      return r.json();
    },
    onSuccess: (_data, tier) => {
      queryClient.invalidateQueries({ queryKey: ["users", "me"] });
      const plan = PLANS.find((p) => p.id === tier);
      toast({
        title: `Welcome, ${plan?.name ?? "goblin"}!`,
        description: tier === "free"
          ? "You're on the free plan. Upgrade any time from The Scroll."
          : "Billing comes online soon — you'll keep your selection.",
      });
      onPicked();
    },
    onError: () =>
      toast({ title: "Couldn't save your rank", variant: "destructive" }),
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

              <ul className="space-y-1.5 mb-4 flex-1">
                {plan.features.slice(0, 5).map((f) => (
                  <li
                    key={f}
                    className="flex items-start gap-2 text-xs text-foreground"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
                    <span>{f}</span>
                  </li>
                ))}
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
          Paid tiers are billing-soon. You can switch ranks any time from The Scroll.
        </p>
      </DialogContent>
    </Dialog>
  );
}

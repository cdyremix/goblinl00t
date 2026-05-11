import { useEffect, useMemo, useState } from "react";
import { useUser, useAuth } from "@clerk/react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "wouter";
import { Check, Circle, ChevronDown, Sparkles } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";

/**
 * Onboarding checklist shown at the top of the dashboard until the streamer
 * has hit every milestone. Once everything is checked off, the card
 * auto-collapses and dismisses itself for the rest of the session — they
 * don't need a permanent "Welcome to the goblin cave" banner.
 *
 * Each step pulls from data we already have:
 *   - signed in: from Clerk
 *   - twitch connected: GET /users/me
 *   - steam connected: GET /settings (optional, marked optional)
 *   - first command run: stats overview totalCommandsUsed > 0
 *   - first giveaway:  stats overview totalGiveaways > 0
 */
export function OnboardingChecklist() {
  const { user } = useUser();
  const { getToken, isSignedIn } = useAuth();

  const profile = useQuery<{ user: { twitchUsername: string | null } }>({
    queryKey: ["users", "me"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/users/me", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const settings = useQuery<{ steamId64: string | null }>({
    queryKey: ["bot-settings"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const overview = useQuery<{ totalCommandsUsed: number; totalGiveaways: number }>({
    queryKey: ["onboarding-overview"],
    enabled: !!isSignedIn,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/stats/overview?range=all", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
  });

  const steps = useMemo(() => {
    const twitchConnected = !!profile.data?.user?.twitchUsername;
    const steamConnected = !!settings.data?.steamId64;
    const firstCommand = (overview.data?.totalCommandsUsed ?? 0) > 0;
    const firstGiveaway = (overview.data?.totalGiveaways ?? 0) > 0;
    return [
      { id: "signin", label: "Sign in to Goblin L00t", done: !!user, href: null, optional: false },
      { id: "twitch", label: "Connect your Twitch account", done: twitchConnected, href: "/account?tab=channel", optional: false },
      { id: "command", label: "First chat command runs", done: firstCommand, href: "/help", optional: false },
      { id: "giveaway", label: "Run your first giveaway", done: firstGiveaway, href: "/giveaway", optional: false },
      { id: "steam", label: "Connect Steam (for CS2 giveaways)", done: steamConnected, href: "/settings", optional: true },
    ];
  }, [user, profile.data, settings.data, overview.data]);

  const requiredDone = steps.filter((s) => !s.optional).every((s) => s.done);
  const allDone = steps.every((s) => s.done);
  const completed = steps.filter((s) => s.done).length;

  // Persist dismissal per-Clerk-user. Once they've ticked every required box
  // we suppress the card forever for that account — they know the ropes.
  const dismissKey = user ? `goblin-loot-onboarding-dismissed:${user.id}` : null;
  const [dismissed, setDismissed] = useState(false);
  useEffect(() => {
    if (!dismissKey) return;
    setDismissed(localStorage.getItem(dismissKey) === "1");
  }, [dismissKey]);
  // Auto-persist dismissal once everything (including optional) is done.
  useEffect(() => {
    if (allDone && dismissKey && !dismissed) {
      localStorage.setItem(dismissKey, "1");
      setDismissed(true);
    }
  }, [allDone, dismissKey, dismissed]);

  // Default to OPEN until required steps are done; once they are, default to
  // collapsed but still let the streamer expand it to see the optional Steam step.
  const [open, setOpen] = useState(true);
  useEffect(() => {
    if (requiredDone) setOpen(false);
  }, [requiredDone]);

  if (dismissed) return null;
  // Don't pop a flash of the card during the initial query — wait until at
  // least one of the data sources has resolved.
  if (profile.isLoading && overview.isLoading) return null;

  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="rounded-xl border border-primary/30 bg-primary/5"
      data-testid="card-onboarding-checklist"
    >
      <CollapsibleTrigger className="w-full flex items-center justify-between gap-3 p-4 text-left">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-9 h-9 rounded-lg bg-primary/15 border border-primary/30 flex items-center justify-center shrink-0">
            <Sparkles className="w-4 h-4 text-primary" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-sm">Get the goblin set up</p>
            <p className="text-xs text-muted-foreground">
              {completed}/{steps.length} done · finish these to unlock the full bot
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {requiredDone && (
            <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-emerald-500/15 text-emerald-300 border border-emerald-500/30">
              Ready
            </span>
          )}
          <ChevronDown className={`w-4 h-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
        </div>
      </CollapsibleTrigger>
      <CollapsibleContent className="overflow-hidden">
        <ul className="px-4 pb-4 space-y-2">
          {steps.map((s) => (
            <li
              key={s.id}
              className={`flex items-center gap-3 rounded-md px-3 py-2 text-sm border ${
                s.done
                  ? "border-emerald-500/20 bg-emerald-500/5 text-emerald-200"
                  : "border-border/50 bg-card/40"
              }`}
              data-testid={`onboarding-step-${s.id}`}
            >
              {s.done ? (
                <Check className="w-4 h-4 text-emerald-400 shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className="flex-1">
                {s.label}
                {s.optional && (
                  <span className="ml-2 text-[10px] uppercase tracking-wider text-muted-foreground/70">optional</span>
                )}
              </span>
              {!s.done && s.href && (
                <Link
                  href={s.href}
                  className="text-xs font-bold text-primary hover:underline"
                  data-testid={`onboarding-go-${s.id}`}
                >
                  Go →
                </Link>
              )}
            </li>
          ))}
        </ul>
      </CollapsibleContent>
    </Collapsible>
  );
}

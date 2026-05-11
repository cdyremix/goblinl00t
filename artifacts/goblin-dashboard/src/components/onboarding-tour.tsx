import { useEffect, useState } from "react";
import { useUser } from "@clerk/react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Sparkles, LayoutDashboard, Settings2, Users2, BookOpen, ChevronRight } from "lucide-react";
import { Link } from "wouter";

const STORAGE_KEY_PREFIX = "goblin-loot-onboarded";

interface Step {
  icon: React.ReactNode;
  title: string;
  body: string;
}

const STEPS: Step[] = [
  {
    icon: <Sparkles className="w-5 h-5 text-primary" />,
    title: "Welcome to the cave",
    body: "I'm your goblin bot. I drop loot, run giveaways, and stir up chat chaos on Twitch — all from this dashboard.",
  },
  {
    icon: <LayoutDashboard className="w-5 h-5 text-primary" />,
    title: "Operations",
    body: "Your live HQ. Watch the bot status, the loot feed, and your active giveaway. Manage your viewers' coins from Chat Users.",
  },
  {
    icon: <Settings2 className="w-5 h-5 text-primary" />,
    title: "Forge & Loot Horde",
    body: "Tune commands, theme, and economy in the Forge. Build giveaways and hand out Quick Prizes from the Loot Horde.",
  },
  {
    icon: <BookOpen className="w-5 h-5 text-primary" />,
    title: "Need help?",
    body: "Click the Help & Guide link at the bottom of the sidebar any time for the full manual.",
  },
];

export function OnboardingTour() {
  const { user, isLoaded } = useUser();
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState(0);

  useEffect(() => {
    if (!isLoaded || !user) return;
    const key = `${STORAGE_KEY_PREFIX}:${user.id}`;
    if (typeof window === "undefined") return;
    if (localStorage.getItem(key)) return;
    setOpen(true);
  }, [isLoaded, user]);

  function dismiss() {
    if (user) {
      try {
        localStorage.setItem(`${STORAGE_KEY_PREFIX}:${user.id}`, "1");
      } catch {
        // ignore quota errors
      }
    }
    setOpen(false);
    setStep(0);
  }

  const current = STEPS[step]!;
  const isLast = step === STEPS.length - 1;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) dismiss(); }}>
      <DialogContent className="sm:max-w-md" data-testid="dialog-onboarding">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 font-medieval">
            {current.icon}
            {current.title}
          </DialogTitle>
          <DialogDescription className="text-sm leading-relaxed pt-1">
            {current.body}
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center justify-center gap-1.5 py-2">
          {STEPS.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 rounded-full transition-all ${
                i === step ? "w-6 bg-primary" : "w-1.5 bg-muted"
              }`}
            />
          ))}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button variant="ghost" onClick={dismiss} data-testid="button-skip-tour">
            Skip
          </Button>
          {!isLast ? (
            <Button onClick={() => setStep((s) => s + 1)} className="gap-1.5" data-testid="button-next-tour">
              Next <ChevronRight className="w-3.5 h-3.5" />
            </Button>
          ) : (
            <Button onClick={dismiss} className="gap-1.5" data-testid="button-finish-tour" asChild>
              <Link href="/dashboard">Got it <Users2 className="w-3.5 h-3.5" /></Link>
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

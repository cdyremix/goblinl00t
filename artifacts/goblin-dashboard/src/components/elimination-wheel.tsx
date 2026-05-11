import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, Skull, Play, X } from "lucide-react";

export interface WheelEntry {
  id: number | string;
  username: string;
  tickets: number;
}

export interface EliminationWheelProps {
  open: boolean;
  onClose: () => void;
  /** All entries currently in the giveaway (server-side ticket weighting honored). */
  entries: WheelEntry[];
  /** The pre-determined winner returned by the server. */
  winner: string | null;
  /** "auto" spins through every elimination automatically; "manual" needs user clicks between spins. */
  mode: "auto" | "manual";
  /** Animation pacing. */
  speed: "slow" | "medium" | "fast";
  /** Optional callback once the final winner reveal completes. */
  onComplete?: () => void;
}

/**
 * Elimination wheel: starts with every entry, eliminates one per round until
 * exactly two remain, then a final dramatic spin reveals the winner. The
 * order is generated client-side: every loser is shuffled into a random
 * elimination sequence, and the server-chosen `winner` is placed last.
 *
 * Each round highlights the eliminated entry briefly before grey-ing it out.
 * In manual mode the streamer must click "Spin" between rounds; in auto mode
 * the wheel paces itself. The "final two" phase always pauses for a beat for
 * dramatic effect, regardless of mode.
 */
export function EliminationWheel({
  open,
  onClose,
  entries,
  winner,
  mode,
  speed,
  onComplete,
}: EliminationWheelProps) {
  // Pre-compute the elimination order once when the modal opens with a winner.
  const eliminationOrder = useMemo(() => {
    if (!winner || entries.length === 0) return [] as string[];
    const losers = entries
      .map((e) => e.username)
      .filter((u) => u !== winner);
    // Fisher–Yates shuffle.
    for (let i = losers.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [losers[i], losers[j]] = [losers[j]!, losers[i]!];
    }
    return losers;
  }, [winner, entries]);

  // index points at the next loser to eliminate. When index === eliminationOrder.length
  // the only remaining entries are the final two (winner + 1 last loser), or just the
  // winner if there were no losers.
  const [index, setIndex] = useState(0);
  const [eliminated, setEliminated] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  const [phase, setPhase] = useState<"idle" | "spinning" | "final-two" | "revealed">("idle");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Reset whenever the modal re-opens or winner/entries change.
  useEffect(() => {
    if (!open) return;
    setIndex(0);
    setEliminated(new Set());
    setHighlight(null);
    setPhase(eliminationOrder.length === 0 && winner ? "revealed" : "idle");
  }, [open, eliminationOrder, winner]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const speedMs = { slow: 1500, medium: 900, fast: 450 }[speed];
  const highlightMs = Math.max(180, Math.floor(speedMs * 0.55));

  // The crucial transition: when there are only 2 entries left (winner + last loser),
  // pause and enter "final-two" so the streamer/audience can build hype.
  const remaining = entries.length - eliminated.size;

  function eliminateOne() {
    const target = eliminationOrder[index];
    if (!target) return;
    setHighlight(target);
    timerRef.current = setTimeout(() => {
      setEliminated((prev) => {
        const next = new Set(prev);
        next.add(target);
        return next;
      });
      setHighlight(null);
      const newIndex = index + 1;
      setIndex(newIndex);
      const remainingAfter = entries.length - (eliminated.size + 1);
      if (remainingAfter <= 2) {
        setPhase("final-two");
      } else if (mode === "auto") {
        timerRef.current = setTimeout(() => setPhase("spinning"), Math.floor(speedMs * 0.4));
      } else {
        setPhase("idle");
      }
    }, highlightMs);
  }

  function revealWinner() {
    // Eliminate the last remaining loser (if any), then mark revealed.
    if (index < eliminationOrder.length) {
      const target = eliminationOrder[index]!;
      setHighlight(target);
      timerRef.current = setTimeout(() => {
        setEliminated((prev) => {
          const next = new Set(prev);
          next.add(target);
          return next;
        });
        setHighlight(null);
        setIndex(index + 1);
        setPhase("revealed");
        onComplete?.();
      }, Math.max(highlightMs, 800));
    } else {
      setPhase("revealed");
      onComplete?.();
    }
  }

  // Auto-progression effect: while in "spinning" phase, eliminate one per tick.
  useEffect(() => {
    if (!open) return;
    if (phase !== "spinning") return;
    if (mode !== "auto") return;
    if (index >= eliminationOrder.length) return;
    if (remaining <= 2) {
      setPhase("final-two");
      return;
    }
    eliminateOne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, mode, open]);

  function handleStart() {
    if (mode === "auto") {
      setPhase("spinning");
    } else {
      // In manual mode, "Start" advances one round.
      eliminateOne();
    }
  }

  const isComplete = phase === "revealed";

  // Screen-reader announcement for the current state of the wheel.
  const liveAnnouncement = isComplete && winner
    ? `Winner: ${winner}`
    : phase === "final-two"
      ? `Final two remaining. Spin to crown the winner.`
      : highlight
        ? `${highlight} eliminated. ${remaining - 1} survivors remaining.`
        : phase === "spinning"
          ? `Spinning. ${remaining} survivors remaining.`
          : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-2xl font-medieval">
            <Crown className="w-6 h-6 text-amber-400" />
            Elimination Wheel
          </DialogTitle>
          <DialogDescription>
            {phase === "idle" && remaining > 2 && (
              <>The goblin has chosen a winner. {mode === "auto" ? "Press Start to spin through eliminations." : "Click Spin to eliminate one entry per round."}</>
            )}
            {phase === "spinning" && <>Spinning… {remaining} survivors</>}
            {phase === "final-two" && <>🔥 The final two! Spin once more to crown the winner.</>}
            {phase === "revealed" && winner && <>🏆 Winner: <span className="text-amber-400 font-bold">{winner}</span></>}
          </DialogDescription>
        </DialogHeader>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        {/* Entries grid */}
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2 max-h-[60vh] overflow-y-auto p-1">
          {entries.map((e) => {
            const isOut = eliminated.has(e.username);
            const isHighlighted = highlight === e.username;
            const isWinner = isComplete && e.username === winner;
            return (
              <div
                key={e.id}
                data-testid={`wheel-entry-${e.username}`}
                className={`
                  rounded-lg border px-3 py-2 text-sm font-medium transition-all duration-200
                  ${isWinner ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_20px_rgba(255,180,0,0.4)] scale-105" : ""}
                  ${isHighlighted ? "bg-rose-500/30 border-rose-400 text-rose-100 scale-105 animate-pulse" : ""}
                  ${isOut && !isWinner ? "bg-muted/30 border-border/40 text-muted-foreground/60 line-through" : ""}
                  ${!isOut && !isHighlighted && !isWinner ? "bg-card border-border text-foreground" : ""}
                `}
              >
                <div className="flex items-center gap-1.5">
                  {isWinner && <Crown className="w-3.5 h-3.5 shrink-0" />}
                  {isOut && !isWinner && <Skull className="w-3.5 h-3.5 shrink-0 opacity-50" />}
                  <span className="truncate">{e.username}</span>
                </div>
                <div className="text-[10px] text-muted-foreground/70 mt-0.5">
                  {e.tickets} ticket{e.tickets !== 1 ? "s" : ""}
                </div>
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono">
            {remaining} / {entries.length} surviving
          </div>
          <div className="flex gap-2">
            {phase === "idle" && remaining > 2 && (
              <Button onClick={handleStart} className="gap-2 bg-primary text-primary-foreground" data-testid="button-wheel-start">
                <Play className="w-4 h-4" />
                {mode === "auto" ? "Start" : "Spin"}
              </Button>
            )}
            {phase === "idle" && remaining <= 2 && remaining > 1 && (
              <Button onClick={() => setPhase("final-two")} className="gap-2 bg-primary text-primary-foreground">
                Continue to Final Spin
              </Button>
            )}
            {phase === "final-two" && (
              <Button
                onClick={revealWinner}
                className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold animate-pulse"
                data-testid="button-wheel-final-spin"
              >
                <Crown className="w-4 h-4" />
                Final Spin
              </Button>
            )}
            {phase === "spinning" && mode === "manual" && (
              <Button onClick={eliminateOne} className="gap-2" data-testid="button-wheel-spin">
                <Play className="w-4 h-4" />
                Spin
              </Button>
            )}
            {isComplete && (
              <Button onClick={onClose} variant="outline" className="gap-2" data-testid="button-wheel-close">
                <X className="w-4 h-4" />
                Close
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

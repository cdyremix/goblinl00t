import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, Skull, Play, X, Settings, Shuffle, Sparkles } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUpdateBotSettings, getGetBotSettingsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { pickEliminationFlavor, pickFinalTwoFlavor, pickVictoryFlavor } from "./elimination-flavors";
import { PixelFightScene } from "./pixel-fight-scene";

export interface WheelEntry {
  id: number | string;
  username: string;
  /** How many tickets this user holds — each one becomes a separate slot on the wheel. */
  tickets: number;
}

export interface EliminationWheelProps {
  open: boolean;
  onClose: () => void;
  /** All entries currently in the giveaway, with their ticket counts. */
  entries: WheelEntry[];
  /**
   * The pre-determined winner returned by the server. When `null`, the
   * wheel sits at an idle "ready to draw" state and (if `onDrawWinner` is
   * provided) shows a "Draw Winner!" CTA — the streamer is in control of
   * when the giveaway actually ends server-side. Once the parent picks a
   * winner and passes it in, the elimination animation is unlocked.
   */
  winner: string | null;
  /** "auto" spins through every elimination automatically; "manual" needs user clicks between spins. */
  mode: "auto" | "manual";
  /** Animation pacing. */
  speed: "slow" | "medium" | "fast";
  /** When true, show RPG-style flavor text on each elimination. */
  flavorEnabled: boolean;
  /**
   * Streamer-initiated draw. When provided, the wheel shows a "Draw
   * Winner!" button whenever it's open with no winner yet — clicking it
   * is what actually ends the giveaway server-side. Without this prop the
   * wheel assumes the parent has already picked a winner before opening.
   */
  onDrawWinner?: () => void;
  /** Loading flag for the draw-winner network call. */
  drawingWinner?: boolean;
  /** Optional callback once the final winner reveal completes. */
  onComplete?: () => void;
}

/**
 * Each ticket gets its own slot card on the wheel — viewers with more
 * tickets occupy more board real estate, so visually they have more
 * "chances to win." The server has already chosen the winner; we pick
 * one of that user's tickets at random to be THE winning slot, and
 * eliminate every other slot (including their duplicate tickets) in
 * a shuffled order until that slot is the last one standing.
 */
type Slot = {
  /** Stable per-render key — `${username}-${ticketIdx}`. */
  key: string;
  username: string;
  /** 1-based ticket number for this user. */
  ticketIndex: number;
};

function buildSlots(entries: WheelEntry[]): Slot[] {
  const out: Slot[] = [];
  for (const e of entries) {
    const tickets = Math.max(1, e.tickets);
    for (let i = 0; i < tickets; i++) {
      out.push({ key: `${e.username}-${i}`, username: e.username, ticketIndex: i + 1 });
    }
  }
  return out;
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

export function EliminationWheel({
  open,
  onClose,
  entries,
  winner,
  mode,
  speed,
  flavorEnabled,
  onDrawWinner,
  drawingWinner,
  onComplete,
}: EliminationWheelProps) {
  // All slots, one per ticket. Recomputed when entries change.
  const slots = useMemo(() => buildSlots(entries), [entries]);

  // Pick the winning slot (one of the winner's tickets) deterministically
  // per (winner, slots) pair so re-renders don't shuffle which ticket "won".
  const winningSlotKey = useMemo(() => {
    if (!winner) return null;
    const winnerSlots = slots.filter((s) => s.username === winner);
    if (winnerSlots.length === 0) return null;
    return winnerSlots[Math.floor(Math.random() * winnerSlots.length)]!.key;
    // We intentionally re-roll only when the slot list itself changes.
  }, [slots, winner]);

  // The order in which non-winning slots are eliminated. Stored in state so
  // the streamer can hit "Shuffle" to re-randomize before / between spins.
  const [eliminationOrder, setEliminationOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [eliminated, setEliminated] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);
  // "shuffling" plays a brief animation that flashes random slot cards so
  // viewers see the order genuinely being re-randomized when the streamer
  // hits the Shuffle button. It's purely cosmetic — the new order is
  // already committed by the time the animation plays out.
  const [phase, setPhase] = useState<"idle" | "spinning" | "shuffling" | "final-two" | "revealed">("idle");
  const [flavorText, setFlavorText] = useState<string | null>(null);
  // Set of slot keys currently lit up by the shuffle animation (just for
  // glow — they're not eliminated).
  const [shuffleHighlights, setShuffleHighlights] = useState<Set<string>>(new Set());
  // When true, the pixel-art "final showdown" scene is mounted between the
  // final-two banner and the slot grid. Driven manually from the Final Spin
  // button so the streamer is always the one who triggers it.
  const [showPixelFight, setShowPixelFight] = useState(false);
  const [pixelFightDone, setPixelFightDone] = useState(false);
  // Mounted toggle for the winner celebration overlay. Pops once when the
  // wheel transitions into the revealed phase; the streamer can dismiss it
  // and the underlying wheel stays visible behind.
  const [showCelebration, setShowCelebration] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Single full-reset effect — runs ONLY when the modal re-opens or the
  // underlying slot pool changes. Critically, `eliminationOrder` is NOT in
  // the deps: the Shuffle button rewrites the unprocessed tail of the
  // order in place, and we must not blow away the streamer's progress
  // (index / eliminated / phase) when that happens.
  useEffect(() => {
    if (!open) return;
    if (!winningSlotKey) {
      // No winner yet (e.g. waiting on the server response). Clear local
      // wheel state so we don't display stale eliminations from a prior run.
      setEliminationOrder([]);
      setIndex(0);
      setEliminated(new Set());
      setHighlight(null);
      setFlavorText(null);
      setPhase("idle");
      return;
    }
    const losers = slots.map((s) => s.key).filter((k) => k !== winningSlotKey);
    const initialOrder = shuffle(losers);
    setEliminationOrder(initialOrder);
    setIndex(0);
    setEliminated(new Set());
    setHighlight(null);
    setFlavorText(null);
    setShowPixelFight(false);
    setPixelFightDone(false);
    // If there's nothing to eliminate (single-slot giveaway), jump
    // straight to the reveal — otherwise sit idle until the streamer
    // (or the auto-spin effect) kicks things off.
    setPhase(initialOrder.length === 0 ? "revealed" : "idle");
  }, [open, slots, winningSlotKey]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const t of shuffleTimersRef.current) clearTimeout(t);
    };
  }, []);

  // Cancel any in-flight timers when the modal closes — otherwise a
  // background setTimeout fired after the streamer hits Close keeps
  // mutating state on an unmounted-from-the-user's-POV component, which
  // can re-open the celebration overlay or flicker the slot grid the
  // next time the modal is opened.
  useEffect(() => {
    if (open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    setShuffleHighlights(new Set());
  }, [open]);

  // Pop the winner celebration overlay exactly once when the wheel reveals
  // a winner. We don't auto-pop on every re-render of the revealed phase —
  // the streamer might dismiss and we'd just put it right back.
  useEffect(() => {
    if (phase === "revealed" && winner) setShowCelebration(true);
    if (phase !== "revealed") setShowCelebration(false);
  }, [phase, winner]);

  const speedMs = { slow: 1500, medium: 900, fast: 450 }[speed];
  const highlightMs = Math.max(180, Math.floor(speedMs * 0.55));

  // Track remaining slots (winner's slot + everyone not yet eliminated).
  const remainingSlots = slots.length - eliminated.size;

  function eliminateOne() {
    const targetKey = eliminationOrder[index];
    if (!targetKey) return;
    const targetSlot = slots.find((s) => s.key === targetKey);
    if (!targetSlot) return;

    setHighlight(targetKey);
    if (flavorEnabled) {
      setFlavorText(pickEliminationFlavor(targetSlot.username));
    }
    timerRef.current = setTimeout(() => {
      setEliminated((prev) => {
        const next = new Set(prev);
        next.add(targetKey);
        return next;
      });
      setHighlight(null);
      const newIndex = index + 1;
      setIndex(newIndex);
      const remainingAfter = slots.length - (eliminated.size + 1);
      if (remainingAfter <= 2) {
        setPhase("final-two");
        if (flavorEnabled && winner) {
          // Find the other surviving slot's username for the showdown line.
          const surviving = slots.filter(
            (s) => s.key !== targetKey && !eliminated.has(s.key) && s.key !== winningSlotKey,
          );
          const lastLoser = surviving[0]?.username ?? "???";
          setFlavorText(pickFinalTwoFlavor([winner, lastLoser]));
        }
      } else if (mode === "auto") {
        timerRef.current = setTimeout(() => setPhase("spinning"), Math.floor(speedMs * 0.4));
      } else {
        setPhase("idle");
      }
    }, highlightMs);
  }

  // Identify the final loser (the slot that's NOT the winner among the two
  // remaining survivors) so the pixel fight scene can label both fighters.
  // We compute this from current state instead of pre-storing it because
  // the streamer can shuffle right up until they hit Final Spin.
  const finalLoserUsername = useMemo(() => {
    if (phase !== "final-two") return null;
    const surviving = slots.filter(
      (s) => !eliminated.has(s.key) && s.key !== winningSlotKey,
    );
    return surviving[0]?.username ?? null;
  }, [phase, slots, eliminated, winningSlotKey]);

  function revealWinner() {
    // In the final-two phase, play the pixel fight first; the scene's
    // onDone callback chains back into the actual reveal.
    if (phase === "final-two" && !showPixelFight && !pixelFightDone && finalLoserUsername && winner) {
      setShowPixelFight(true);
      return;
    }
    if (index < eliminationOrder.length) {
      const targetKey = eliminationOrder[index]!;
      const targetSlot = slots.find((s) => s.key === targetKey);
      setHighlight(targetKey);
      if (flavorEnabled && targetSlot) {
        setFlavorText(pickEliminationFlavor(targetSlot.username));
      }
      timerRef.current = setTimeout(() => {
        setEliminated((prev) => {
          const next = new Set(prev);
          next.add(targetKey);
          return next;
        });
        setHighlight(null);
        setIndex(index + 1);
        setPhase("revealed");
        if (flavorEnabled && winner) {
          setFlavorText(pickVictoryFlavor(winner));
        }
        onComplete?.();
      }, Math.max(highlightMs, 800));
    } else {
      setPhase("revealed");
      if (flavorEnabled && winner) setFlavorText(pickVictoryFlavor(winner));
      onComplete?.();
    }
  }

  // Auto-progression effect: while in "spinning" phase, eliminate one per tick.
  useEffect(() => {
    if (!open) return;
    if (phase !== "spinning") return;
    if (mode !== "auto") return;
    if (index >= eliminationOrder.length) return;
    if (remainingSlots <= 2) {
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
      eliminateOne();
    }
  }

  // Re-shuffle the elimination order, then play a brief "shuffling"
  // animation so the audience can see entries cycling. The new order is
  // committed immediately — the animation is purely cosmetic and gates
  // the Spin button so nothing fires mid-shuffle.
  function handleShuffle() {
    if (!winningSlotKey) return;
    const remainingKeys = slots
      .map((s) => s.key)
      .filter((k) => !eliminated.has(k)); // includes the winning slot
    const remainingLosers = remainingKeys.filter((k) => k !== winningSlotKey);
    const reshuffled = shuffle(remainingLosers);
    setEliminationOrder((prev) => [...prev.slice(0, index), ...reshuffled]);

    // Cancel any in-flight shuffle animation, then flash random batches of
    // remaining slots in quick succession. ~12 frames over ~1.2s feels
    // genuinely "shuffling" without dragging the streamer's pacing.
    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    setPhase("shuffling");
    if (flavorEnabled) setFlavorText("🔀 Reshuffling the bones…");
    const frames = 12;
    const frameMs = 100;
    for (let f = 0; f < frames; f++) {
      const t = setTimeout(() => {
        // Light up ~25% of the remaining slots at random for this frame.
        const sample = shuffle(remainingKeys).slice(0, Math.max(3, Math.floor(remainingKeys.length / 4)));
        setShuffleHighlights(new Set(sample));
      }, f * frameMs);
      shuffleTimersRef.current.push(t);
    }
    // Final frame: clear highlights and return to idle so the streamer can
    // resume control. The actual wheel state is already updated.
    const done = setTimeout(() => {
      setShuffleHighlights(new Set());
      setPhase("idle");
      if (flavorEnabled) setFlavorText(null);
    }, frames * frameMs + 50);
    shuffleTimersRef.current.push(done);
  }

  const isComplete = phase === "revealed";

  // Screen-reader announcement for the current state of the wheel.
  const liveAnnouncement = isComplete && winner
    ? `Winner: ${winner}`
    : phase === "final-two"
      ? `Final two slots remaining. Spin to crown the winner.`
      : highlight
        ? `Slot eliminated. ${remainingSlots - 1} slots remaining.`
        : phase === "spinning"
          ? `Spinning. ${remainingSlots} slots remaining.`
          : "";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* Bumped from max-w-2xl — the slot grid was cramped on viewers' wide
          monitors and the streamer asked for more breathing room so the
          wheel reads on stream. */}
      {/* `max-h-[90vh]` + scrollable body keeps the modal centered in the
          viewport even on shorter screens — without it, a tall slot grid
          + flavor banner + footer pushed the dialog past the viewport top
          (Radix centers via translate-y-[-50%] from top:50%, which only
          looks centered when content fits). */}
      {/* Keep Radix's default top-[50%]/translate-y-[-50%] centering so the
          modal is anchored vertically in the middle of the viewport. The
          earlier "anchor at top" override caused the content to render off-
          screen on some browsers when the inner grid was taller than the
          viewport — the user saw only the dimmed overlay. Constraining
          `max-h-[90vh]` + giving the body its own scroll container keeps
          everything visible regardless of viewer count. */}
      <DialogContent className="max-w-5xl w-[95vw] max-h-[90vh] relative overflow-hidden flex flex-col">
        {/* Winner celebration overlay — rendered INSIDE the wheel's
            DialogContent (not as a nested Dialog) so we keep a single
            focus trap and a clean modal a11y tree. Confetti respects
            prefers-reduced-motion: when set, the layer renders nothing
            and we just show the winner banner + dismiss button. */}
        {showCelebration && winner && (
          <WinnerCelebrationOverlay
            winner={winner}
            onDismiss={() => setShowCelebration(false)}
          />
        )}
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-2xl font-medieval">
                <Crown className="w-6 h-6 text-amber-400" />
                Elimination Wheel
              </DialogTitle>
              <DialogDescription className="mt-1">
                {phase === "idle" && !winner && onDrawWinner && (
                  <>Ready to draw. The goblin will pick a winner the moment you click below — close this modal to back out without ending the giveaway.</>
                )}
                {phase === "idle" && remainingSlots > 2 && winner && (
                  <>The goblin has chosen a winner. {mode === "auto" ? "Press Start to spin through eliminations." : "Click Spin to eliminate one slot per round."}</>
                )}
                {phase === "spinning" && <>Spinning… {remainingSlots} slots remaining</>}
                {phase === "shuffling" && <>🔀 Reshuffling the bones…</>}
                {phase === "final-two" && <>🔥 The final two! Spin once more to crown the winner.</>}
                {phase === "revealed" && winner && <>🏆 Winner: <span className="text-amber-400 font-bold">{winner}</span></>}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleShuffle}
                disabled={isComplete || phase === "spinning" || phase === "shuffling"}
                title="Reshuffle remaining entries"
                data-testid="button-wheel-shuffle"
              >
                <Shuffle className="w-4 h-4" />
              </Button>
              <WheelSettingsPopover
                mode={mode}
                speed={speed}
                flavorEnabled={flavorEnabled}
              />
            </div>
          </div>
        </DialogHeader>

        <div className="sr-only" aria-live="polite" aria-atomic="true">
          {liveAnnouncement}
        </div>

        {/* Pixel-art final showdown — mounted only during the final-two
            phase, after the streamer hits "Final Spin." When it finishes
            (or is skipped via reduced-motion), we mark pixelFightDone and
            re-invoke revealWinner() to chain straight into the reveal. */}
        {showPixelFight && winner && finalLoserUsername && phase === "final-two" && (
          <PixelFightScene
            winner={winner}
            loser={finalLoserUsername}
            onDone={() => {
              setShowPixelFight(false);
              setPixelFightDone(true);
              // Trigger the actual reveal after the scene resolves.
              setTimeout(() => revealWinner(), 50);
            }}
          />
        )}

        {/* RPG flavor banner */}
        {flavorEnabled && flavorText && (
          <div
            key={flavorText}
            className={`rounded-md border px-4 py-3 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${
              isComplete
                ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
                : phase === "final-two"
                  ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
                  : "bg-purple-500/10 border-purple-500/40 text-purple-200"
            }`}
            data-testid="text-wheel-flavor"
          >
            {flavorText}
          </div>
        )}

        {/* Slots grid — one card per ticket. Wider grid + bigger cards now
            that the modal is max-w-5xl. The grid scrolls inside the modal
            so the header / controls stay pinned. */}
        <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 lg:grid-cols-10 gap-2 flex-1 min-h-0 overflow-y-auto p-1">
          {slots.map((s) => {
            const isOut = eliminated.has(s.key);
            const isHighlighted = highlight === s.key;
            const isShuffleLit = shuffleHighlights.has(s.key);
            const isWinningSlot = isComplete && s.key === winningSlotKey;
            return (
              <div
                key={s.key}
                data-testid={`wheel-slot-${s.key}`}
                className={`
                  rounded-lg border px-2 py-2 text-xs font-medium transition-all duration-150
                  ${isWinningSlot ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_20px_rgba(255,180,0,0.4)] scale-110" : ""}
                  ${isHighlighted ? "bg-rose-500/30 border-rose-400 text-rose-100 scale-110 animate-pulse" : ""}
                  ${isShuffleLit && !isWinningSlot && !isHighlighted ? "bg-purple-500/20 border-purple-400/70 text-purple-100 scale-105" : ""}
                  ${isOut && !isWinningSlot ? "bg-muted/30 border-border/40 text-muted-foreground/60 line-through" : ""}
                  ${!isOut && !isHighlighted && !isWinningSlot && !isShuffleLit ? "bg-card border-border text-foreground" : ""}
                `}
              >
                <div className="flex items-center gap-1">
                  {isWinningSlot && <Crown className="w-3 h-3 shrink-0" />}
                  {isOut && !isWinningSlot && <Skull className="w-3 h-3 shrink-0 opacity-50" />}
                  <span className="truncate">{s.username}</span>
                </div>
                <div className="text-[9px] text-muted-foreground/70 mt-0.5 font-mono">
                  #{s.ticketIndex}
                </div>
              </div>
            );
          })}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono">
            {remainingSlots} / {slots.length} slots
          </div>
          <div className="flex gap-2">
            {/* Draw-winner CTA: shown only when the parent has explicitly
                deferred the server end-call to the streamer (onDrawWinner
                supplied) AND no winner has been chosen yet. Closing the
                modal in this state is a no-op on the giveaway. */}
            {phase === "idle" && !winner && onDrawWinner && (
              <Button
                onClick={onDrawWinner}
                disabled={!!drawingWinner}
                className="gap-2 bg-primary text-primary-foreground font-bold animate-pulse"
                data-testid="button-wheel-draw-winner"
              >
                <Crown className="w-4 h-4" />
                {drawingWinner ? "Drawing…" : "Draw Winner!"}
              </Button>
            )}
            {phase === "idle" && winner && remainingSlots > 2 && (
              <Button onClick={handleStart} className="gap-2 bg-primary text-primary-foreground" data-testid="button-wheel-start">
                <Play className="w-4 h-4" />
                {mode === "auto" ? "Start" : "Spin"}
              </Button>
            )}
            {phase === "idle" && remainingSlots <= 2 && remainingSlots > 1 && (
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

/**
 * Confetti-and-crown overlay rendered inside the wheel's DialogContent
 * once a winner is revealed. Implemented as an absolute layer (not a
 * nested Dialog) so the wheel modal keeps a single focus trap and clean
 * screen-reader semantics. Confetti is pure CSS — 80 absolutely
 * positioned divs animated by inline keyframes; if the user has
 * `prefers-reduced-motion: reduce`, the confetti layer is omitted and
 * only the static crown + winner banner renders.
 */
function WinnerCelebrationOverlay({
  winner,
  onDismiss,
}: {
  winner: string;
  onDismiss: () => void;
}) {
  // Detect reduced-motion preference once per mount. We don't subscribe
  // to changes — if the user toggles mid-celebration that's fine, the
  // overlay is short-lived.
  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  // Pre-compute confetti specs once per mount so they don't reshuffle
  // on every render (which would tear the animation).
  const pieces = useMemo(() => {
    if (reducedMotion) return [];
    const colors = ["#fbbf24", "#a855f7", "#22c55e", "#ef4444", "#3b82f6", "#ec4899", "#f97316"];
    return Array.from({ length: 80 }).map((_, i) => ({
      id: i,
      left: Math.random() * 100,
      delay: Math.random() * 0.6,
      duration: 2 + Math.random() * 2,
      color: colors[Math.floor(Math.random() * colors.length)]!,
      rotate: Math.random() * 360,
      size: 6 + Math.floor(Math.random() * 8),
    }));
  }, [reducedMotion]);

  return (
    <div
      className="absolute inset-0 z-20 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg"
      data-testid="overlay-winner-celebration"
      role="status"
      aria-live="polite"
    >
      {!reducedMotion && (
        <style>{`
          @keyframes goblin-confetti-fall {
            0%   { transform: translateY(-20px) rotate(0deg); opacity: 1; }
            100% { transform: translateY(110vh) rotate(720deg); opacity: 0; }
          }
          @keyframes goblin-crown-pop {
            0%   { transform: scale(0.4) rotate(-15deg); opacity: 0; }
            60%  { transform: scale(1.15) rotate(5deg); opacity: 1; }
            100% { transform: scale(1) rotate(0deg); opacity: 1; }
          }
        `}</style>
      )}

      {/* Confetti layer — absolutely positioned, pointer-events:none so it
          never blocks the dismiss button. Skipped entirely when the user
          prefers reduced motion. */}
      {!reducedMotion && (
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {pieces.map((p) => (
            <div
              key={p.id}
              className="absolute top-0"
              style={{
                left: `${p.left}%`,
                width: `${p.size}px`,
                height: `${p.size * 1.4}px`,
                background: p.color,
                transform: `rotate(${p.rotate}deg)`,
                animation: `goblin-confetti-fall ${p.duration}s ease-in ${p.delay}s forwards`,
                borderRadius: "2px",
              }}
            />
          ))}
        </div>
      )}

      <div className="text-center space-y-3 relative z-10 px-6">
        <div
          className="mx-auto"
          style={
            reducedMotion
              ? undefined
              : { animation: "goblin-crown-pop 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) forwards" }
          }
        >
          <Crown className="w-20 h-20 text-amber-400 drop-shadow-[0_0_25px_rgba(255,180,0,0.6)] mx-auto" />
        </div>
        <h2 className="text-3xl font-medieval text-amber-300">We have a champion!</h2>
        <div className="text-base">
          <span className="block text-2xl font-bold text-foreground my-2" data-testid="text-winner-username">
            @{winner}
          </span>
          <span className="block text-muted-foreground">
            has plundered the loot. Congratulations!
          </span>
        </div>
        <div className="flex justify-center pt-2">
          <Button
            onClick={onDismiss}
            className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
            data-testid="button-dismiss-celebration"
          >
            <Sparkles className="w-4 h-4" />
            Continue
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Settings popover hung off the wheel header. Lets the streamer tweak
 * mode / speed / RPG-flavor toggle without leaving the modal — the
 * dedicated wheel settings card on the Forge page was removed in favor
 * of this in-context control.
 *
 * Writes flow through `useUpdateBotSettings` (the same hook the Forge
 * page uses) so changes persist server-side and the parent component
 * picks them up via `useGetBotSettings` invalidation. Local mode/speed
 * props update on the next render — no need to lift state here.
 */
function WheelSettingsPopover({
  mode,
  speed,
  flavorEnabled,
}: {
  mode: "auto" | "manual";
  speed: "slow" | "medium" | "fast";
  flavorEnabled: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useUpdateBotSettings();

  function update(patch: {
    wheelMode?: "auto" | "manual";
    wheelSpeed?: "slow" | "medium" | "fast";
    eliminationFlavorEnabled?: boolean;
  }) {
    mutation.mutate(
      { data: patch },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetBotSettingsQueryKey() });
        },
        onError: () => toast({ title: "Couldn't save wheel settings", variant: "destructive" }),
      },
    );
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          title="Wheel settings"
          data-testid="button-wheel-settings"
        >
          <Settings className="w-4 h-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 space-y-4">
        <div>
          <h4 className="font-semibold text-sm flex items-center gap-1.5">
            <Sparkles className="w-3.5 h-3.5 text-primary" />
            Wheel Settings
          </h4>
          <p className="text-xs text-muted-foreground mt-1">
            Tweak how the wheel spins. Saves automatically.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="popover-wheel-mode" className="text-xs font-semibold">Spin Mode</Label>
          <Select value={mode} onValueChange={(v) => update({ wheelMode: v as "auto" | "manual" })}>
            <SelectTrigger id="popover-wheel-mode" data-testid="select-popover-wheel-mode" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">Auto — spin through automatically</SelectItem>
              <SelectItem value="manual">Manual — click to spin each round</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label htmlFor="popover-wheel-speed" className="text-xs font-semibold">Spin Speed</Label>
          <Select value={speed} onValueChange={(v) => update({ wheelSpeed: v as "slow" | "medium" | "fast" })}>
            <SelectTrigger id="popover-wheel-speed" data-testid="select-popover-wheel-speed" className="h-9">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="slow">Slow — dramatic build-up</SelectItem>
              <SelectItem value="medium">Medium — balanced</SelectItem>
              <SelectItem value="fast">Fast — rapid-fire</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-center justify-between gap-3 rounded-md border border-border/60 px-3 py-2">
          <div className="min-w-0">
            <Label htmlFor="popover-flavor-toggle" className="text-xs font-semibold cursor-pointer">
              RPG Flavor Text
            </Label>
            <p className="text-[10px] text-muted-foreground mt-0.5">
              Show themed messages on each elimination.
            </p>
          </div>
          <Switch
            id="popover-flavor-toggle"
            checked={flavorEnabled}
            onCheckedChange={(v) => update({ eliminationFlavorEnabled: v })}
            data-testid="switch-popover-flavor"
          />
        </div>
      </PopoverContent>
    </Popover>
  );
}

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
  /** How many tickets this user holds — shown as a stack on their card. */
  tickets: number;
}

export interface EliminationWheelProps {
  open: boolean;
  onClose: () => void;
  /** All entries currently in the giveaway, with their ticket counts. */
  entries: WheelEntry[];
  /**
   * The pre-determined winner returned by the server. When `null`, the
   * wheel sits idle until the streamer clicks "Start Eliminations" — at
   * which point we call `onDrawWinner` to fetch the winner and then
   * auto-spin the eliminations as soon as the parent re-passes a
   * non-null `winner`. This keeps the streamer to a single click.
   */
  winner: string | null;
  /** "auto" spins through every elimination automatically; "manual" needs user clicks between spins. */
  mode: "auto" | "manual";
  /** Animation pacing. */
  speed: "slow" | "medium" | "fast";
  /** When true, show RPG-style flavor text on each elimination. */
  flavorEnabled: boolean;
  /**
   * Streamer-initiated draw. When provided, the wheel's primary CTA is
   * "Start Eliminations" — clicking it (a) fires this callback so the
   * server picks the winner, then (b) auto-spins the eliminations the
   * moment the parent feeds back a non-null `winner`. Without this prop
   * the wheel assumes the parent has already drawn before opening.
   */
  onDrawWinner?: () => void;
  /** Loading flag for the draw-winner network call. */
  drawingWinner?: boolean;
  /** Optional callback once the final winner reveal completes. */
  onComplete?: () => void;
}

/**
 * In the new model each USER gets one card; their ticket count is shown
 * as a stack badge that ticks down by one per elimination round. A user
 * is fully eliminated only when their stack hits zero. This is much
 * easier to follow on stream than the old per-ticket card grid (where a
 * viewer with 5 tickets occupied 5 visually-identical cards).
 */
type UserSlot = {
  username: string;
  originalTickets: number;
};

function buildUserSlots(entries: WheelEntry[]): UserSlot[] {
  return entries.map((e) => ({
    username: e.username,
    originalTickets: Math.max(1, e.tickets),
  }));
}

function shuffle<T>(arr: T[]): T[] {
  const copy = arr.slice();
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy;
}

/**
 * Build the elimination order — a flat list of usernames where each
 * occurrence of a username represents one ticket strip from that user.
 * The winner's tickets are NEVER added to the order, so they're
 * guaranteed to survive every spin.
 */
function buildOrder(userSlots: UserSlot[], winnerUsername: string): string[] {
  const targets: string[] = [];
  for (const u of userSlots) {
    if (u.username === winnerUsername) continue;
    for (let i = 0; i < u.originalTickets; i++) targets.push(u.username);
  }
  return shuffle(targets);
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
  const userSlots = useMemo(() => buildUserSlots(entries), [entries]);

  // Per-user remaining ticket counts. Decremented on every elimination
  // round. A user is "out" when their value hits 0.
  const [tickets, setTickets] = useState<Record<string, number>>({});
  const [eliminationOrder, setEliminationOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  // "shuffling" plays a brief animation that flashes random user cards
  // so viewers see the elimination order genuinely being re-randomized.
  const [phase, setPhase] = useState<
    "idle" | "spinning" | "shuffling" | "final-two" | "fight" | "revealed"
  >("idle");
  const [flavorText, setFlavorText] = useState<string | null>(null);
  const [shuffleHighlights, setShuffleHighlights] = useState<Set<string>>(new Set());
  // True when the streamer clicked "Start Eliminations" before a winner
  // existed — we hold onto this flag so that as soon as the parent
  // returns the winner, we auto-spin without a second click.
  const [autoStartAfterDraw, setAutoStartAfterDraw] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Reset effect — runs when the modal opens or the entry pool changes.
  // We deliberately KEEP the existing tickets/index/phase if the only
  // thing that changed is `winner` going null→string, so the auto-start
  // flow can pick up exactly where the streamer left off.
  useEffect(() => {
    if (!open) return;
    const initialTickets: Record<string, number> = {};
    for (const u of userSlots) initialTickets[u.username] = u.originalTickets;
    setTickets(initialTickets);
    setEliminationOrder([]);
    setIndex(0);
    setHighlight(null);
    setFlavorText(null);
    setPhase("idle");
    setAutoStartAfterDraw(false);
  }, [open, userSlots]);

  // When the parent finally returns a winner (after Start Eliminations
  // fired the draw), build the elimination order and auto-spin.
  useEffect(() => {
    if (!open || !winner) return;
    if (eliminationOrder.length > 0) return;
    // Defensive: if the server-chosen winner isn't in our local entries
    // snapshot (entries can lag behind the server when chat is fast),
    // splice them in with a single ticket so the wheel still has a
    // valid card to crown — otherwise `finalOpponent` ends up null
    // mid-fight and the overlay refuses to render, soft-locking the UI.
    const winnerInSlots = userSlots.some((u) => u.username === winner);
    if (!winnerInSlots) {
      setTickets((prev) => ({ ...prev, [winner]: 1 }));
    }
    const baseSlots = winnerInSlots
      ? userSlots
      : [...userSlots, { username: winner, originalTickets: 1 }];
    const order = buildOrder(baseSlots, winner);
    setEliminationOrder(order);
    if (order.length === 0) {
      // Single-user giveaway — straight to reveal.
      setPhase("revealed");
      if (flavorEnabled) setFlavorText(pickVictoryFlavor(winner));
      return;
    }
    if (autoStartAfterDraw) {
      // Tiny defer so React commits the order first.
      timerRef.current = setTimeout(() => {
        setPhase(mode === "auto" ? "spinning" : "idle");
        if (mode === "manual") {
          // In manual mode, kick off the first round so the streamer
          // sees something happen immediately after Start.
          eliminateOneRef.current?.();
        }
      }, 50);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, winner, userSlots]);

  // Cleanup on unmount and on close.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      for (const t of shuffleTimersRef.current) clearTimeout(t);
    };
  }, []);
  useEffect(() => {
    if (open) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    setShuffleHighlights(new Set());
  }, [open]);

  const speedMs = { slow: 1500, medium: 900, fast: 450 }[speed];
  const highlightMs = Math.max(180, Math.floor(speedMs * 0.55));

  // Living = users with at least one ticket left. The winner is always
  // in this list until the very end of the final spin.
  const livingUsers = useMemo(
    () => userSlots.filter((u) => (tickets[u.username] ?? u.originalTickets) > 0),
    [userSlots, tickets],
  );
  const livingCount = livingUsers.length;

  // The lone survivor besides the winner — used to label the pixel fight.
  const finalOpponent = useMemo(() => {
    if (!winner) return null;
    const others = livingUsers.filter((u) => u.username !== winner);
    return others.length === 1 ? others[0]!.username : null;
  }, [livingUsers, winner]);

  // Lightweight in-flight lock so rapid manual clicks (or an auto-tick
  // racing a manual click) can't enqueue overlapping eliminations and
  // double-decrement the same ticket.
  const eliminatingRef = useRef(false);

  // Strip one ticket from the next user in the elimination order.
  // Wrapped in a ref so the auto-start effect can call the latest copy
  // without a closure-over-stale-state bug.
  const eliminateOneRef = useRef<() => void>(() => {});
  function eliminateOne() {
    if (eliminatingRef.current) return;
    const targetUser = eliminationOrder[index];
    if (!targetUser) return;
    eliminatingRef.current = true;

    setHighlight(targetUser);
    if (flavorEnabled) {
      const remainingForTarget = (tickets[targetUser] ?? 0) - 1;
      // Only emit "eliminated!" flavor when this strip puts them at 0 —
      // mid-stack ticket losses use a softer "ticket torched" line.
      if (remainingForTarget <= 0) {
        setFlavorText(pickEliminationFlavor(targetUser));
      } else {
        setFlavorText(`💥 A ticket is torched from @${targetUser}'s stash…`);
      }
    }
    timerRef.current = setTimeout(() => {
      // Atomically update tickets AND decide the next phase from the
      // SAME post-update snapshot — derive `livingAfter` inside the
      // updater so we never race against a stale closure.
      let livingAfter = 0;
      let opponentUsername: string | null = null;
      setTickets((prev) => {
        const next = {
          ...prev,
          [targetUser]: Math.max(0, (prev[targetUser] ?? 0) - 1),
        };
        for (const u of userSlots) {
          const remaining = next[u.username] ?? u.originalTickets;
          if (remaining > 0) {
            livingAfter++;
            if (winner && u.username !== winner && !opponentUsername) {
              opponentUsername = u.username;
            }
          }
        }
        return next;
      });
      setHighlight(null);
      setIndex((prev) => prev + 1);

      if (livingAfter <= 2) {
        setPhase("final-two");
        if (flavorEnabled && winner) {
          setFlavorText(pickFinalTwoFlavor([winner, opponentUsername ?? "???"]));
        }
      } else if (mode === "auto") {
        timerRef.current = setTimeout(() => setPhase("spinning"), Math.floor(speedMs * 0.4));
      } else {
        setPhase("idle");
      }
      eliminatingRef.current = false;
    }, highlightMs);
  }
  eliminateOneRef.current = eliminateOne;

  // Auto-progression: while spinning in auto mode, eliminate one per tick.
  useEffect(() => {
    if (!open) return;
    if (phase !== "spinning") return;
    if (mode !== "auto") return;
    if (index >= eliminationOrder.length) return;
    if (livingCount <= 2) {
      setPhase("final-two");
      return;
    }
    eliminateOne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, mode, open]);

  /**
   * Single primary CTA. When no winner has been drawn yet AND the
   * parent supplied `onDrawWinner`, we fire the draw + flag auto-start
   * so the eliminations begin the moment the winner comes back. When a
   * winner is already known we just kick off the spin directly.
   */
  function handleStart() {
    if (!winner && onDrawWinner) {
      setAutoStartAfterDraw(true);
      onDrawWinner();
      return;
    }
    if (mode === "auto") {
      setPhase("spinning");
    } else {
      eliminateOne();
    }
  }

  /**
   * Re-shuffle the unprocessed tail of the elimination order. The
   * already-eliminated rounds are kept; only what's coming next gets
   * randomized. Plays a brief glow animation across remaining users so
   * the audience can see something happened.
   */
  function handleShuffle() {
    if (!winner || eliminationOrder.length === 0) return;
    const tail = eliminationOrder.slice(index);
    if (tail.length <= 1) return;
    const reshuffled = shuffle(tail);
    setEliminationOrder((prev) => [...prev.slice(0, index), ...reshuffled]);

    const livingNames = livingUsers.map((u) => u.username);
    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    const wasPhase = phase;
    setPhase("shuffling");
    if (flavorEnabled) setFlavorText("🔀 Reshuffling the bones…");
    const frames = 12;
    const frameMs = 90;
    for (let f = 0; f < frames; f++) {
      const t = setTimeout(() => {
        const sample = shuffle(livingNames).slice(
          0,
          Math.max(2, Math.floor(livingNames.length / 3)),
        );
        setShuffleHighlights(new Set(sample));
      }, f * frameMs);
      shuffleTimersRef.current.push(t);
    }
    const done = setTimeout(() => {
      setShuffleHighlights(new Set());
      // Return to the prior phase so an auto-spin in progress resumes.
      setPhase(wasPhase === "spinning" ? "spinning" : "idle");
      if (flavorEnabled) setFlavorText(null);
    }, frames * frameMs + 50);
    shuffleTimersRef.current.push(done);
  }

  /**
   * Triggered by the streamer in the final-two phase. Plays the pixel
   * fight; when it finishes we strip the opponent's remaining tickets
   * to zero, mark the phase as revealed, and let the streamer dismiss
   * via the Continue button rendered inside the same overlay.
   */
  function handleFinalSpin() {
    setPhase("fight");
  }

  function finishFight() {
    if (winner && finalOpponent) {
      setTickets((prev) => ({ ...prev, [finalOpponent]: 0 }));
    }
    setPhase("revealed");
    if (flavorEnabled && winner) setFlavorText(pickVictoryFlavor(winner));
    onComplete?.();
  }

  const isComplete = phase === "revealed";

  // Screen-reader announcement for the current state of the wheel.
  const liveAnnouncement = isComplete && winner
    ? `Winner: ${winner}`
    : phase === "final-two"
      ? `Final two remain. Spin once more to crown the winner.`
      : highlight
        ? `${highlight} loses a ticket.`
        : phase === "spinning"
          ? `Spinning. ${livingCount} users still in.`
          : "";

  // Header CTA visibility helpers.
  const showStartCta = phase === "idle" && (!winner || livingCount > 2);
  const startLabel =
    !winner && onDrawWinner
      ? drawingWinner || autoStartAfterDraw
        ? "Drawing…"
        : "Start Eliminations"
      : mode === "auto"
        ? "Start"
        : "Spin";

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      {/* Definite `h-[85vh]` is critical — without it the inner grid
          can't size against `flex-1 min-h-0`, the modal grows to its
          full content, and Radix's translate-y centering drops the
          bottom half off-screen on shorter viewports. */}
      <DialogContent
        className="max-w-5xl w-[95vw] h-[85vh] max-h-[800px] overflow-hidden flex flex-col gap-3 p-4 sm:p-6 [&>button]:hidden"
      >
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-2xl font-medieval">
                <Crown className="w-6 h-6 text-amber-400" />
                Elimination Wheel
              </DialogTitle>
              <DialogDescription className="mt-1">
                {phase === "idle" && !winner && onDrawWinner && (
                  <>Ready when you are. Click below to start the eliminations — the goblin will pick a winner and the wheel will spin.</>
                )}
                {phase === "idle" && winner && livingCount > 2 && (
                  <>{mode === "auto" ? "Press Start to spin through eliminations." : "Click Spin to strip one ticket per round."}</>
                )}
                {phase === "spinning" && <>Spinning… {livingCount} contenders still in</>}
                {phase === "shuffling" && <>🔀 Reshuffling the bones…</>}
                {phase === "final-two" && <>🔥 The final two! Hit Final Spin to crown the winner.</>}
                {phase === "fight" && <>⚔️ The showdown begins…</>}
                {phase === "revealed" && winner && (
                  <>🏆 Winner: <span className="text-amber-400 font-bold">{winner}</span></>
                )}
              </DialogDescription>
            </div>
            <div className="flex items-center gap-1 shrink-0">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={handleShuffle}
                disabled={
                  isComplete ||
                  phase === "shuffling" ||
                  phase === "fight" ||
                  phase === "final-two" ||
                  !winner ||
                  eliminationOrder.length - index <= 1
                }
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

        {/* RPG flavor banner */}
        {flavorEnabled && flavorText && (
          <div
            key={flavorText}
            className={`rounded-md border px-4 py-3 text-sm font-medium animate-in fade-in slide-in-from-top-2 duration-300 ${
              isComplete
                ? "bg-amber-500/10 border-amber-500/40 text-amber-200"
                : phase === "final-two" || phase === "fight"
                  ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
                  : "bg-purple-500/10 border-purple-500/40 text-purple-200"
            }`}
            data-testid="text-wheel-flavor"
          >
            {flavorText}
          </div>
        )}

        {/* Slots grid + pixel-fight overlay share a single relative
            wrapper so the fight scene is scoped to the grid area only. */}
        <div className="relative flex-1 min-h-0">
          {/* One card per USER. The ticket count badge ticks down on
              every elimination round; users with 0 tickets are crossed
              out with a skull but still rendered so the audience can
              see the carnage. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 h-full overflow-y-auto p-1">
            {userSlots.map((u) => {
              const remaining = tickets[u.username] ?? u.originalTickets;
              const isOut = remaining <= 0;
              const isHighlighted = highlight === u.username;
              const isShuffleLit = shuffleHighlights.has(u.username);
              const isWinner = isComplete && u.username === winner;
              return (
                <div
                  key={u.username}
                  data-testid={`wheel-slot-${u.username}`}
                  className={`
                    rounded-lg border px-3 py-2.5 text-sm font-medium transition-all duration-150
                    ${isWinner ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_24px_rgba(255,180,0,0.45)] scale-110" : ""}
                    ${isHighlighted ? "bg-rose-500/30 border-rose-400 text-rose-100 scale-105 animate-pulse" : ""}
                    ${isShuffleLit && !isWinner && !isHighlighted ? "bg-purple-500/20 border-purple-400/70 text-purple-100 scale-105" : ""}
                    ${isOut && !isWinner ? "bg-muted/30 border-border/40 text-muted-foreground/60 line-through" : ""}
                    ${!isOut && !isHighlighted && !isWinner && !isShuffleLit ? "bg-card border-border text-foreground" : ""}
                  `}
                >
                  <div className="flex items-center gap-1.5">
                    {isWinner && <Crown className="w-4 h-4 shrink-0 text-amber-400" />}
                    {isOut && !isWinner && <Skull className="w-4 h-4 shrink-0 opacity-60" />}
                    <span className="truncate flex-1">{u.username}</span>
                    {/* Ticket badge: shown until the user is out. The
                        original count stays visible alongside the
                        remaining count so the audience can clock how
                        much of a buffer each player started with. */}
                    {!isOut && (
                      <span
                        className={`text-[10px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
                          isHighlighted
                            ? "bg-rose-900/60 text-rose-100"
                            : "bg-muted text-muted-foreground"
                        }`}
                        data-testid={`wheel-tickets-${u.username}`}
                      >
                        🎟 {remaining}
                        {u.originalTickets > 1 && (
                          <span className="opacity-60">/{u.originalTickets}</span>
                        )}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Pixel-art final showdown — replaces the old "winner
              celebration" overlay entirely. The fight scene plays out,
              then we swap to a winner-reveal panel inside the SAME
              overlay with a Continue button that closes the wheel. No
              second modal, no nested dialogs. */}
          {(phase === "fight" || phase === "revealed") && winner && finalOpponent && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg p-4">
              <div className="w-full max-w-3xl space-y-4">
                {phase === "fight" && (
                  <PixelFightScene
                    winner={winner}
                    loser={finalOpponent}
                    onDone={() => {
                      // Micro-defer so the scene's final frame commits
                      // before we swap state — without this React
                      // batches and the cheer pose flickers.
                      setTimeout(finishFight, 50);
                    }}
                  />
                )}
                {phase === "revealed" && (
                  <div
                    className="text-center space-y-4"
                    data-testid="panel-winner-reveal"
                  >
                    <Crown className="w-20 h-20 text-amber-400 drop-shadow-[0_0_25px_rgba(255,180,0,0.6)] mx-auto" />
                    <h2 className="text-3xl font-medieval text-amber-300">
                      We have a champion!
                    </h2>
                    <div
                      className="text-2xl font-bold text-foreground"
                      data-testid="text-winner-username"
                    >
                      @{winner}
                    </div>
                    <p className="text-sm text-muted-foreground">
                      has plundered the loot. Congratulations!
                    </p>
                    <div className="flex justify-center pt-2">
                      <Button
                        onClick={onClose}
                        className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                        data-testid="button-wheel-continue"
                      >
                        <Sparkles className="w-4 h-4" />
                        Continue
                      </Button>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Edge case: single-user giveaway (no opponent for the fight
              scene). Show a plain reveal overlay so the streamer still
              has a Continue button to close the wheel. */}
          {phase === "revealed" && winner && !finalOpponent && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg p-4">
              <div className="text-center space-y-4" data-testid="panel-winner-reveal">
                <Crown className="w-20 h-20 text-amber-400 drop-shadow-[0_0_25px_rgba(255,180,0,0.6)] mx-auto" />
                <h2 className="text-3xl font-medieval text-amber-300">
                  We have a champion!
                </h2>
                <div
                  className="text-2xl font-bold text-foreground"
                  data-testid="text-winner-username"
                >
                  @{winner}
                </div>
                <div className="flex justify-center pt-2">
                  <Button
                    onClick={onClose}
                    className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                    data-testid="button-wheel-continue"
                  >
                    <Sparkles className="w-4 h-4" />
                    Continue
                  </Button>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Controls */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono">
            {livingCount} / {userSlots.length} contenders
          </div>
          <div className="flex gap-2">
            {showStartCta && (
              <Button
                onClick={handleStart}
                disabled={!!drawingWinner || autoStartAfterDraw}
                className="gap-2 bg-primary text-primary-foreground font-bold"
                data-testid="button-wheel-start"
              >
                <Play className="w-4 h-4" />
                {startLabel}
              </Button>
            )}
            {phase === "spinning" && mode === "manual" && (
              <Button onClick={eliminateOne} className="gap-2" data-testid="button-wheel-spin">
                <Play className="w-4 h-4" />
                Spin
              </Button>
            )}
            {phase === "final-two" && (
              <Button
                onClick={handleFinalSpin}
                className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold animate-pulse"
                data-testid="button-wheel-final-spin"
              >
                <Crown className="w-4 h-4" />
                Final Spin
              </Button>
            )}
            {/* Revealed state has no extra footer button — the Continue
                button lives inside the overlay panel for prominence. */}
            {!isComplete && phase !== "fight" && (
              <Button
                onClick={onClose}
                variant="outline"
                className="gap-2"
                data-testid="button-wheel-close"
              >
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
 * Settings popover hung off the wheel header. Lets the streamer tweak
 * mode / speed / RPG-flavor toggle without leaving the modal.
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

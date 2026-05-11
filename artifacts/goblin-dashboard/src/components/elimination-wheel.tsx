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
  /** The pre-determined winner returned by the server. */
  winner: string | null;
  /** "auto" spins through every elimination automatically; "manual" needs user clicks between spins. */
  mode: "auto" | "manual";
  /** Animation pacing. */
  speed: "slow" | "medium" | "fast";
  /** When true, show RPG-style flavor text on each elimination. */
  flavorEnabled: boolean;
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
  const [phase, setPhase] = useState<"idle" | "spinning" | "final-two" | "revealed">("idle");
  const [flavorText, setFlavorText] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    // If there's nothing to eliminate (single-slot giveaway), jump
    // straight to the reveal — otherwise sit idle until the streamer
    // (or the auto-spin effect) kicks things off.
    setPhase(initialOrder.length === 0 ? "revealed" : "idle");
  }, [open, slots, winningSlotKey]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

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

  function revealWinner() {
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

  // Re-shuffle the elimination order. Only meaningful before the first spin
  // (after that, eliminated slots are locked in); we still allow it if the
  // streamer wants to re-roll mid-stream.
  function handleShuffle() {
    if (!winningSlotKey) return;
    const remainingLosers = slots
      .map((s) => s.key)
      .filter((k) => k !== winningSlotKey && !eliminated.has(k));
    const reshuffled = shuffle(remainingLosers);
    // Replace the unprocessed tail of the order with the freshly shuffled losers.
    setEliminationOrder((prev) => [...prev.slice(0, index), ...reshuffled]);
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
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1 min-w-0">
              <DialogTitle className="flex items-center gap-2 text-2xl font-medieval">
                <Crown className="w-6 h-6 text-amber-400" />
                Elimination Wheel
              </DialogTitle>
              <DialogDescription className="mt-1">
                {phase === "idle" && remainingSlots > 2 && (
                  <>The goblin has chosen a winner. {mode === "auto" ? "Press Start to spin through eliminations." : "Click Spin to eliminate one slot per round."}</>
                )}
                {phase === "spinning" && <>Spinning… {remainingSlots} slots remaining</>}
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
                disabled={isComplete || phase === "spinning"}
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
                : phase === "final-two"
                  ? "bg-rose-500/10 border-rose-500/40 text-rose-200"
                  : "bg-purple-500/10 border-purple-500/40 text-purple-200"
            }`}
            data-testid="text-wheel-flavor"
          >
            {flavorText}
          </div>
        )}

        {/* Slots grid — one card per ticket */}
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-[55vh] overflow-y-auto p-1">
          {slots.map((s) => {
            const isOut = eliminated.has(s.key);
            const isHighlighted = highlight === s.key;
            const isWinningSlot = isComplete && s.key === winningSlotKey;
            return (
              <div
                key={s.key}
                data-testid={`wheel-slot-${s.key}`}
                className={`
                  rounded-lg border px-2 py-1.5 text-xs font-medium transition-all duration-200
                  ${isWinningSlot ? "bg-amber-500/20 border-amber-400 text-amber-300 shadow-[0_0_20px_rgba(255,180,0,0.4)] scale-110" : ""}
                  ${isHighlighted ? "bg-rose-500/30 border-rose-400 text-rose-100 scale-110 animate-pulse" : ""}
                  ${isOut && !isWinningSlot ? "bg-muted/30 border-border/40 text-muted-foreground/60 line-through" : ""}
                  ${!isOut && !isHighlighted && !isWinningSlot ? "bg-card border-border text-foreground" : ""}
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
            {phase === "idle" && remainingSlots > 2 && (
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

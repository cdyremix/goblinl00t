import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Crown, Skull, Play, Settings, Shuffle, Sparkles } from "lucide-react";
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
  /** How many tickets this user holds — shown as a stack badge on their card. */
  tickets: number;
}

export interface EliminationWheelProps {
  open: boolean;
  onClose: () => void;
  /** All entries currently in the giveaway, with their ticket counts. */
  entries: WheelEntry[];
  /**
   * Optional pre-determined winner — for replaying an already-ended
   * giveaway. In the LIVE flow this MUST be null/undefined: the wheel
   * picks the winner organically when the streamer clicks
   * "Start Eliminations" (weighted random by tickets), runs real
   * eliminations against everyone else, and the last contender
   * standing IS the winner. The wheel then reports them via
   * `onWinnerDecided` so the parent can record on the server.
   */
  winner?: string | null;
  /** Spin mode setting from the streamer's bot settings (cosmetic only — wheel always auto-progresses). */
  mode: "auto" | "manual";
  /** Animation pacing. */
  speed: "slow" | "medium" | "fast";
  /** When true, show RPG-style flavor text on each elimination. */
  flavorEnabled: boolean;
  /**
   * Fired EXACTLY ONCE per open, the moment the wheel reaches the
   * `revealed` phase with a winner. Parent should record this winner
   * on the server (e.g. `useEndGiveaway({ winnerUsername })`).
   */
  onWinnerDecided?: (username: string) => void;
  /** Optional indicator while parent is recording the winner on the server. */
  recordingWinner?: boolean;
  /** Optional callback once the final winner reveal completes. */
  onComplete?: () => void;
}

/**
 * One card per user, with a ticket-stack badge that ticks down on every
 * elimination round. A user is fully eliminated only when their stack
 * hits 0 — much easier to follow on stream than the old per-ticket
 * card grid where one viewer with 5 tickets occupied 5 identical cards.
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
 * occurrence represents one ticket strip from that user. The winner's
 * tickets are NEVER added so they're guaranteed to survive every spin.
 */
function buildOrder(userSlots: UserSlot[], winnerUsername: string): string[] {
  const targets: string[] = [];
  for (const u of userSlots) {
    if (u.username === winnerUsername) continue;
    for (let i = 0; i < u.originalTickets; i++) targets.push(u.username);
  }
  return shuffle(targets);
}

/**
 * Pick a winner client-side using weighted random by ticket count
 * (matches the server's legacy fallback behavior so existing odds /
 * loyalty incentives are unchanged). The last contender standing on
 * the wheel IS this user — eliminations target everyone else.
 */
function pickWeightedWinner(entries: WheelEntry[]): string | null {
  const pool: string[] = [];
  for (const e of entries) {
    const t = Math.max(1, e.tickets);
    for (let i = 0; i < t; i++) pool.push(e.username);
  }
  if (pool.length === 0) return null;
  return pool[Math.floor(Math.random() * pool.length)] ?? null;
}

export function EliminationWheel({
  open,
  onClose,
  entries,
  winner: predeterminedWinner,
  mode: _mode, // kept for API compat / settings popover; wheel always auto-runs.
  speed,
  flavorEnabled,
  onWinnerDecided,
  recordingWinner,
  onComplete,
}: EliminationWheelProps) {
  const baseUserSlots = useMemo(() => buildUserSlots(entries), [entries]);

  // The wheel chooses the winner LOCALLY when the streamer clicks
  // "Start Eliminations" (or honors `predeterminedWinner` if the parent
  // is replaying an already-ended giveaway). Either way this string is
  // the single source of truth for "who survives" while the modal is
  // open, and gets fed to `onWinnerDecided` once we hit the reveal.
  const [internalWinner, setInternalWinner] = useState<string | null>(null);
  const winner = predeterminedWinner ?? internalWinner;

  // For the replay path (predeterminedWinner supplied) the username
  // might not be in the entries snapshot if entries were edited after
  // the giveaway ended. Splice them in so `finalOpponent` derivation
  // and the card grid never see a null/missing slot. NOT used in the
  // live flow — the wheel only picks names that exist in `entries`.
  const [extraWinnerSlot, setExtraWinnerSlot] = useState<UserSlot | null>(null);
  const userSlots = useMemo(
    () => (extraWinnerSlot ? [...baseUserSlots, extraWinnerSlot] : baseUserSlots),
    [baseUserSlots, extraWinnerSlot],
  );

  // Display order — purely visual ordering of the cards in the grid.
  // The Shuffle button reshuffles this; it works pre-draw (before any
  // winner has been picked) and during the wait for auto-spin to kick
  // in. Once the wheel starts eliminating we leave the visual order
  // alone so the streamer can track who got knocked out where.
  const [displayOrder, setDisplayOrder] = useState<string[]>([]);

  // Per-user remaining ticket counts. Decremented on every elimination.
  const [tickets, setTickets] = useState<Record<string, number>>({});
  const [eliminationOrder, setEliminationOrder] = useState<string[]>([]);
  const [index, setIndex] = useState(0);
  const [highlight, setHighlight] = useState<string | null>(null);
  // "shuffling" plays a brief animation that flashes random cards so
  // viewers see the order being re-randomized on stream.
  const [phase, setPhase] = useState<
    "idle" | "spinning" | "shuffling" | "final-two" | "fight" | "revealed"
  >("idle");
  const [flavorText, setFlavorText] = useState<string | null>(null);
  const [shuffleHighlights, setShuffleHighlights] = useState<Set<string>>(new Set());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shuffleTimersRef = useRef<ReturnType<typeof setTimeout>[]>([]);

  // Fires `onWinnerDecided` exactly once per open. Reset on each open.
  const winnerReportedRef = useRef(false);

  // Tracks previous `open` so the reset effect only fires on a
  // false→true transition. CRITICAL: parents call `invalidate()` /
  // `invalidateAll()` immediately on successful record, which refetches
  // entries WHILE the modal is still open. If we reset on every
  // `baseUserSlots` change we'd wipe `phase`/`internalWinner` mid-
  // session, re-enable Start, and permit a second `onWinnerDecided` →
  // a duplicate end-mutation. Scoping the reset to open transitions
  // means in-session entry refetches are ignored entirely.
  const prevOpenRef = useRef(false);
  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = open;
    if (!open || wasOpen) return;
    // false → true: fresh open, do the reset.
    const initialTickets: Record<string, number> = {};
    for (const u of baseUserSlots) initialTickets[u.username] = u.originalTickets;
    setTickets(initialTickets);
    setDisplayOrder(baseUserSlots.map((u) => u.username));
    setExtraWinnerSlot(null);
    setEliminationOrder([]);
    setIndex(0);
    setHighlight(null);
    setFlavorText(null);
    setPhase("idle");
    setInternalWinner(null);
    winnerReportedRef.current = false;
    // Crucial: clear the in-flight lock so a previous spin tick that
    // never completed (because the modal closed mid-highlight-timeout)
    // can't permanently jam the next session's elimination loop.
    eliminatingRef.current = false;
  }, [open, baseUserSlots]);

  // Replay path: parent supplied a `predeterminedWinner` for an already
  // -ended giveaway. Build the elimination order against that winner so
  // the visual replay still ends with them standing. The LIVE flow does
  // NOT use this branch — `handleStart` builds the order itself the
  // instant it picks the winner.
  useEffect(() => {
    if (!open || !predeterminedWinner) return;
    if (eliminationOrder.length > 0) return;
    const winnerInSlots = userSlots.some((u) => u.username === predeterminedWinner);
    let effectiveSlots = userSlots;
    if (!winnerInSlots) {
      const patched: UserSlot = { username: predeterminedWinner, originalTickets: 1 };
      setExtraWinnerSlot(patched);
      setTickets((prev) => ({ ...prev, [predeterminedWinner]: 1 }));
      setDisplayOrder((prev) => (prev.includes(predeterminedWinner) ? prev : [...prev, predeterminedWinner]));
      effectiveSlots = [...userSlots, patched];
    }
    const order = buildOrder(effectiveSlots, predeterminedWinner);
    setEliminationOrder(order);
    if (order.length === 0) {
      setPhase("revealed");
      if (flavorEnabled) setFlavorText(pickVictoryFlavor(predeterminedWinner));
      onComplete?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, predeterminedWinner, userSlots]);

  // Once we land on `revealed` with a known winner, tell the parent so
  // they can record on the server. Guarded by a ref so it fires once
  // per open, no matter which code path drove us into `revealed`
  // (eliminateOne tail, spinning useEffect lone-survivor, finishFight,
  // or single-user shortcut). REPLAY MODE guard: when the parent
  // supplied `predeterminedWinner`, this is a re-open of an
  // already-ended giveaway — the server already knows the winner and
  // we MUST NOT call back, otherwise we'd issue a duplicate
  // end-mutation against an already-ended row.
  useEffect(() => {
    if (phase !== "revealed") return;
    if (winnerReportedRef.current) return;
    if (!winner) return;
    if (predeterminedWinner != null) return;
    winnerReportedRef.current = true;
    onWinnerDecided?.(winner);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, winner]);

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
    timerRef.current = null;
    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    setShuffleHighlights(new Set());
    // Same reasoning as the open-reset: any spin tick that was mid-flight
    // when the streamer hit close needs the lock cleared so the next
    // open doesn't inherit a stuck `true`.
    eliminatingRef.current = false;
  }, [open]);

  const speedMs = { slow: 1500, medium: 900, fast: 450 }[speed];
  const highlightMs = Math.max(180, Math.floor(speedMs * 0.55));

  // Living = users with at least one ticket left. Winner stays in this
  // list until the final spin strips their opponent's last ticket.
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

  // In-flight lock so back-to-back spin ticks (or HMR re-renders during
  // dev) can't enqueue overlapping eliminations and double-decrement.
  const eliminatingRef = useRef(false);

  const eliminateOneRef = useRef<() => void>(() => {});
  function eliminateOne() {
    if (eliminatingRef.current) return;
    const targetUser = eliminationOrder[index];
    if (!targetUser) return;
    eliminatingRef.current = true;

    setHighlight(targetUser);
    if (flavorEnabled) {
      const remainingForTarget = (tickets[targetUser] ?? 0) - 1;
      // Only emit the "ELIMINATED!" flavor when this strip puts them at 0;
      // mid-stack ticket losses get a softer "torched" line.
      if (remainingForTarget <= 0) {
        setFlavorText(pickEliminationFlavor(targetUser));
      } else {
        setFlavorText(`💥 A ticket is torched from @${targetUser}'s stash…`);
      }
    }
    timerRef.current = setTimeout(() => {
      // Atomically update tickets AND derive the next phase from the
      // SAME post-update snapshot — never race against a stale closure.
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

      if (livingAfter <= 1 || (livingAfter <= 2 && !opponentUsername)) {
        // Edge case: the winner is the lone survivor (their multi-ticket
        // stack is the only thing left). There IS no opponent for the
        // pixel fight, so jumping to "final-two" would strand the footer
        // CTA — neither Start Final Battle (needs opponent) nor Continue
        // (needs revealed) would render. Skip straight to reveal.
        setPhase("revealed");
        if (flavorEnabled && winner) setFlavorText(pickVictoryFlavor(winner));
        onComplete?.();
      } else if (livingAfter <= 2) {
        // Manual final-two pause. Streamer hits "Start Final Battle" in
        // the footer to kick off the pixel showdown.
        setPhase("final-two");
        if (flavorEnabled && winner) {
          setFlavorText(pickFinalTwoFlavor([winner, opponentUsername ?? "???"]));
        }
      } else {
        // Always queue the next spin — the wheel runs to completion
        // without any user input once Start Eliminations is clicked.
        timerRef.current = setTimeout(() => setPhase("spinning"), Math.floor(speedMs * 0.4));
      }
      eliminatingRef.current = false;
    }, highlightMs);
  }
  eliminateOneRef.current = eliminateOne;

  // Auto-progression: while spinning, eliminate one per tick.
  useEffect(() => {
    if (!open) return;
    if (phase !== "spinning") return;
    if (index >= eliminationOrder.length) return;
    if (livingCount <= 2) {
      // Same defensive branch as in eliminateOne's tail — if the lone
      // survivor IS the winner there's no opponent for the fight, so
      // skip the manual-pause phase and reveal immediately.
      if (!finalOpponent) {
        setPhase("revealed");
        if (flavorEnabled && winner) setFlavorText(pickVictoryFlavor(winner));
        onComplete?.();
      } else {
        setPhase("final-two");
        if (flavorEnabled && winner) {
          setFlavorText(pickFinalTwoFlavor([winner, finalOpponent]));
        }
      }
      return;
    }
    eliminateOne();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index, open]);

  // Final two → fight is now MANUAL. Streamer hits "Start Final Battle"
  // in the footer to trigger the showdown; that gives them control over
  // when to peak the stream's tension instead of an arbitrary 1.6s pause.

  /**
   * Single primary CTA. The wheel picks the winner ITSELF (weighted
   * random by tickets) the moment the streamer commits, then runs real
   * eliminations against everyone else. The server isn't told about
   * the winner until we hit `revealed` (the `onWinnerDecided` effect
   * handles that). If the parent supplied a `predeterminedWinner` for
   * a replay we honor it instead — the order was already built by the
   * predeterminedWinner useEffect above.
   */
  function handleStart() {
    if (!winner) {
      const picked = pickWeightedWinner(entries);
      if (!picked) return; // no entries — nothing to spin
      setInternalWinner(picked);
      const slotsForOrder = buildUserSlots(entries);
      const order = buildOrder(slotsForOrder, picked);
      setEliminationOrder(order);
      if (order.length === 0) {
        // Single-user giveaway — straight to reveal. The
        // onWinnerDecided effect will fire once `winner` resolves to
        // `picked` on the next render.
        setPhase("revealed");
        if (flavorEnabled) setFlavorText(pickVictoryFlavor(picked));
        onComplete?.();
        return;
      }
      // Tiny defer so React commits the order + winner state before the
      // spin loop sees them.
      timerRef.current = setTimeout(() => setPhase("spinning"), 50);
      return;
    }
    // Replay path — order was already built by the effect above.
    setPhase("spinning");
  }

  /**
   * Pre-draw and during the brief idle window, Shuffle reshuffles the
   * VISUAL card order so streamers can spice up the line-up before
   * starting. Once the wheel is actively spinning we leave it alone.
   * The animation flashes random cards purple so viewers can see the
   * shuffle happen.
   */
  function handleShuffle() {
    if (userSlots.length < 2) return;
    if (phase === "fight" || phase === "revealed") return;
    if (phase === "shuffling") return;

    const names = userSlots.map((u) => u.username);
    const reshuffled = shuffle(names);
    setDisplayOrder(reshuffled);

    for (const t of shuffleTimersRef.current) clearTimeout(t);
    shuffleTimersRef.current = [];
    const wasPhase = phase;
    setPhase("shuffling");
    if (flavorEnabled) setFlavorText("🔀 Reshuffling the bones…");
    const frames = 10;
    const frameMs = 80;
    for (let f = 0; f < frames; f++) {
      const t = setTimeout(() => {
        const sample = shuffle(names).slice(
          0,
          Math.max(2, Math.floor(names.length / 3)),
        );
        setShuffleHighlights(new Set(sample));
      }, f * frameMs);
      shuffleTimersRef.current.push(t);
    }
    const done = setTimeout(() => {
      setShuffleHighlights(new Set());
      // Resume whatever phase we were in. If we were spinning, the
      // auto-effect picks back up immediately.
      setPhase(wasPhase === "spinning" ? "spinning" : "idle");
      if (flavorEnabled) setFlavorText(null);
    }, frames * frameMs + 50);
    shuffleTimersRef.current.push(done);
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

  // Footer CTA is single-button and phase-driven:
  //   idle (no winner yet) → "Start Eliminations"
  //   final-two            → "Start Final Battle"
  //   revealed             → "Continue" (closes the modal)
  // Spinning / shuffling / fight phases hide the button entirely so the
  // streamer can't accidentally double-fire while animations play.
  // Idle-with-no-winner is the only state where Start makes sense.
  // Replay mode (predetermined winner) STILL needs a Start — the
  // streamer should kick off the visual replay deliberately.
  const showStartCta = phase === "idle";
  const showFinalBattleCta = phase === "final-two" && !!winner && !!finalOpponent;
  const showContinueCta = phase === "revealed";
  // Disable Start while there are no entries to spin (defensive — the
  // parent should already have hidden the open trigger in that case).
  const startDisabled = entries.length === 0;

  // Screen-reader announcement.
  const liveAnnouncement = isComplete && winner
    ? `Winner: ${winner}`
    : phase === "final-two"
      ? `Final two remain. The showdown begins.`
      : highlight
        ? `${highlight} loses a ticket.`
        : phase === "spinning"
          ? `Spinning. ${livingCount} contenders still in.`
          : "";

  // Display the user cards in shuffled order; tolerate transient
  // mismatches between displayOrder and userSlots (e.g. while entries
  // refetch) by appending any users not yet in the order.
  const orderedSlots = useMemo(() => {
    const byName = new Map(userSlots.map((u) => [u.username, u] as const));
    const seen = new Set<string>();
    const out: UserSlot[] = [];
    for (const name of displayOrder) {
      const u = byName.get(name);
      if (u && !seen.has(name)) {
        out.push(u);
        seen.add(name);
      }
    }
    for (const u of userSlots) {
      if (!seen.has(u.username)) out.push(u);
    }
    return out;
  }, [userSlots, displayOrder]);

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
                {phase === "idle" && (
                  <>Click <span className="font-semibold text-amber-400">Start Eliminations</span> — the wheel knocks out contestants one by one until two remain, then crowns the last contender standing.</>
                )}
                {phase === "spinning" && <>Spinning… {livingCount} contenders still in</>}
                {phase === "shuffling" && <>🔀 Reshuffling the bones…</>}
                {phase === "final-two" && <>🔥 The final two! The showdown begins…</>}
                {phase === "fight" && <>⚔️ Final clash!</>}
                {phase === "revealed" && winner && (
                  <>🏆 Winner: <span className="text-amber-400 font-bold">{winner}</span>
                  {recordingWinner && <span className="ml-2 text-xs text-muted-foreground">(recording…)</span>}</>
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
                  userSlots.length < 2
                }
                title="Reshuffle card order"
                data-testid="button-wheel-shuffle"
              >
                <Shuffle className="w-4 h-4" />
              </Button>
              <WheelSettingsPopover
                mode={_mode}
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
          {/* One card per USER, rendered in `displayOrder`. The ticket
              badge ticks down on every elimination round; users at 0
              are crossed out + skull-marked. */}
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 gap-2 h-full overflow-y-auto p-1">
            {orderedSlots.map((u) => {
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

          {/* Pixel-art final showdown overlay. Fight plays out, then we
              swap to a winner-reveal panel inside the SAME overlay. The
              footer "Continue" button is the single source of truth for
              closing — we no longer duplicate it inside the panel. */}
          {(phase === "fight" || phase === "revealed") && winner && finalOpponent && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/95 backdrop-blur-sm rounded-lg p-4">
              <div className="w-full max-w-3xl space-y-4">
                {phase === "fight" && (
                  <PixelFightScene
                    winner={winner}
                    loser={finalOpponent}
                    onDone={() => setTimeout(finishFight, 50)}
                  />
                )}
                {phase === "revealed" && (
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
                    <p className="text-sm text-muted-foreground">
                      has plundered the loot. Hit Continue to close the wheel.
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Edge case: no opponent (single-user giveaway). Show a plain
              reveal overlay; footer Continue still closes the wheel. */}
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
              </div>
            </div>
          )}
        </div>

        {/* Footer — single phase-driven CTA. The label rotates through
            Start Eliminations → Start Final Battle → Continue as the
            wheel progresses. Spinning / shuffling / fight phases hide
            the button so the streamer can't accidentally re-fire it. */}
        <div className="flex items-center justify-between gap-3 pt-2 border-t border-border/50">
          <div className="text-xs text-muted-foreground font-mono">
            {livingCount} / {userSlots.length} contenders
          </div>
          <div className="flex gap-2">
            {showStartCta && (
              <Button
                onClick={handleStart}
                disabled={startDisabled}
                className="gap-2 bg-primary text-primary-foreground font-bold"
                data-testid="button-wheel-start"
              >
                <Play className="w-4 h-4" />
                Start Eliminations
              </Button>
            )}
            {showFinalBattleCta && (
              <Button
                onClick={() => setPhase("fight")}
                className="gap-2 bg-rose-600 hover:bg-rose-700 text-white font-bold"
                data-testid="button-wheel-final-battle"
              >
                <Sparkles className="w-4 h-4" />
                Start Final Battle
              </Button>
            )}
            {showContinueCta && (
              <Button
                onClick={onClose}
                className="gap-2 bg-amber-500 hover:bg-amber-600 text-black font-bold"
                data-testid="button-wheel-continue"
              >
                <Sparkles className="w-4 h-4" />
                Continue
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
 * speed / flavor toggle without leaving the modal. (Mode is kept for
 * legacy compat — the wheel itself always auto-progresses now.)
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

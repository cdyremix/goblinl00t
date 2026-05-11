import { useEffect, useMemo, useState } from "react";

/**
 * Pixel-art-style face-off animation between the final two giveaway slots.
 * Pure CSS — no sprite assets, no canvas. Two stylized character columns
 * built from <div> blocks, animated through a small phase machine.
 *
 * Sequence (~5s total):
 *   1. face-off  — both characters bob, swords drawn
 *   2. clash     — they lunge at each other (overlapping)
 *   3. fall      — loser collapses, winner does a small jump
 *   4. cheer     — winner stands tall, crown appears
 *
 * Honors `prefers-reduced-motion`: when set, we skip straight to the cheer
 * pose and call `onDone` after a short pause so the UX still feels intentional.
 *
 * Cosmetic only — the server already chose the winner; this scene is purely
 * for stream entertainment between "final two" and "winner reveal."
 */
export function PixelFightScene({
  winner,
  loser,
  onDone,
}: {
  winner: string;
  loser: string;
  onDone: () => void;
}) {
  type Phase = "face-off" | "clash" | "fall" | "cheer";

  const reducedMotion = useMemo(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  }, []);

  const [phase, setPhase] = useState<Phase>(reducedMotion ? "cheer" : "face-off");

  useEffect(() => {
    if (reducedMotion) {
      const t = setTimeout(onDone, 1200);
      return () => clearTimeout(t);
    }
    const timers: ReturnType<typeof setTimeout>[] = [];
    timers.push(setTimeout(() => setPhase("clash"), 1400));
    timers.push(setTimeout(() => setPhase("fall"), 2300));
    timers.push(setTimeout(() => setPhase("cheer"), 3300));
    timers.push(setTimeout(onDone, 4900));
    return () => timers.forEach(clearTimeout);
  }, [reducedMotion, onDone]);

  const winnerAlive = phase !== "fall" || true; // winner is always alive
  const loserDown = phase === "fall" || phase === "cheer";
  const clashing = phase === "clash";
  const cheering = phase === "cheer";

  return (
    <div
      className="rounded-lg border border-amber-500/30 bg-gradient-to-b from-purple-950/40 to-amber-950/30 p-6 my-2"
      data-testid="pixel-fight-scene"
      role="img"
      aria-label={`${winner} defeats ${loser}`}
    >
      <style>{`
        @keyframes goblin-fight-bob {
          0%, 100% { transform: translateY(0); }
          50%      { transform: translateY(-3px); }
        }
        @keyframes goblin-fight-lunge-left {
          0%   { transform: translateX(0); }
          100% { transform: translateX(48px); }
        }
        @keyframes goblin-fight-lunge-right {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-48px); }
        }
        @keyframes goblin-fight-fall {
          0%   { transform: rotate(0deg) translateY(0); opacity: 1; }
          100% { transform: rotate(85deg) translateY(20px); opacity: 0.6; }
        }
        @keyframes goblin-fight-cheer-jump {
          0%   { transform: translateY(0); }
          40%  { transform: translateY(-14px); }
          100% { transform: translateY(0); }
        }
        @keyframes goblin-fight-crown-pop {
          0%   { transform: translateY(8px) scale(0.4); opacity: 0; }
          60%  { transform: translateY(-2px) scale(1.2); opacity: 1; }
          100% { transform: translateY(0) scale(1); opacity: 1; }
        }
        @keyframes goblin-fight-spark {
          0%   { transform: scale(0.4); opacity: 0; }
          50%  { transform: scale(1.3); opacity: 1; }
          100% { transform: scale(1.6); opacity: 0; }
        }
      `}</style>

      <div className="text-center text-xs uppercase tracking-[0.3em] text-amber-300/80 font-mono mb-3">
        ⚔️  Final Showdown  ⚔️
      </div>

      <div className="relative h-40 flex items-end justify-center gap-2">
        {/* Left fighter (winner) */}
        <div
          className="flex flex-col items-center"
          style={{
            animation: cheering
              ? "goblin-fight-cheer-jump 0.6s ease-out 1"
              : clashing
                ? "goblin-fight-lunge-left 0.4s ease-in forwards"
                : "goblin-fight-bob 0.9s ease-in-out infinite",
          }}
        >
          {cheering && (
            <div
              className="text-2xl mb-0.5"
              style={{ animation: "goblin-fight-crown-pop 0.5s ease-out 1" }}
            >
              👑
            </div>
          )}
          <PixelGoblin tone="amber" facing="right" alive={winnerAlive} sword={!cheering} />
          <div className="mt-1.5 px-2 py-0.5 rounded bg-amber-500/20 border border-amber-400/40 text-amber-200 text-[11px] font-bold font-mono max-w-[140px] truncate">
            {winner}
          </div>
        </div>

        {/* VS badge / clash spark */}
        <div className="self-center px-2">
          {clashing ? (
            <div
              className="text-3xl"
              style={{ animation: "goblin-fight-spark 0.45s ease-out 1" }}
            >
              💥
            </div>
          ) : (
            <div className="text-xs font-bold text-muted-foreground tracking-widest opacity-80">
              VS
            </div>
          )}
        </div>

        {/* Right fighter (loser) */}
        <div
          className="flex flex-col items-center"
          style={{
            animation: loserDown
              ? "goblin-fight-fall 0.6s ease-in forwards"
              : clashing
                ? "goblin-fight-lunge-right 0.4s ease-in forwards"
                : "goblin-fight-bob 0.9s ease-in-out infinite",
            transformOrigin: "bottom center",
          }}
        >
          <PixelGoblin tone="rose" facing="left" alive={!loserDown} sword={!loserDown} />
          <div className="mt-1.5 px-2 py-0.5 rounded bg-rose-500/20 border border-rose-400/40 text-rose-200 text-[11px] font-bold font-mono max-w-[140px] truncate">
            {loser}
          </div>
        </div>
      </div>

      <div className="text-center mt-3 text-xs text-muted-foreground italic">
        {phase === "face-off" && "Both fighters draw their blades…"}
        {phase === "clash"    && "Steel meets steel!"}
        {phase === "fall"     && "A challenger has fallen!"}
        {phase === "cheer"    && `🏆 ${winner} stands victorious!`}
      </div>
    </div>
  );
}

/**
 * A tiny "pixel-art" goblin built from div blocks. We render a 5-wide grid
 * of ~6px squares to fake a sprite without shipping any binary assets.
 * The `tone` controls the palette (winner=amber, loser=rose) and `facing`
 * mirrors the sword.
 */
function PixelGoblin({
  tone,
  facing,
  alive,
  sword,
}: {
  tone: "amber" | "rose";
  facing: "left" | "right";
  alive: boolean;
  sword: boolean;
}) {
  const skin = tone === "amber" ? "#7fbf6a" : "#9b6a6a";
  const armor = tone === "amber" ? "#8b6a2a" : "#5a3838";
  const eye = alive ? "#facc15" : "#444";
  const px = 6;
  const cell = (color: string | null) => (
    <div
      style={{
        width: px,
        height: px,
        backgroundColor: color ?? "transparent",
        imageRendering: "pixelated",
      }}
    />
  );

  // 6 rows × 5 cols. Sword arm flips for facing.
  const _ = null;
  const S = skin;
  const A = armor;
  const E = eye;
  const W = sword ? "#cbd5e1" : null; // sword steel
  const grid: (string | null)[][] = [
    [_, S, S, S, _],            // ears + head top
    [_, S, E, S, _],            // face row 1 (one eye visible from this angle)
    [_, S, S, S, _],            // face row 2
    [A, A, A, A, _],            // shoulders / armor
    [_, S, A, S, W],            // body + sword arm
    [_, S, _, S, _],            // legs
  ];
  if (facing === "left") {
    grid.forEach((row) => row.reverse());
  }

  return (
    <div
      className="flex flex-col"
      style={{ filter: alive ? "none" : "grayscale(0.7) brightness(0.7)" }}
    >
      {grid.map((row, ri) => (
        <div key={ri} className="flex">
          {row.map((c, ci) => (
            <div key={ci}>{cell(c)}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

import { useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

type RarityLevel = "common" | "uncommon" | "rare" | "epic" | "legendary";

const RARITY_STYLES: Record<RarityLevel, { border: string; bg: string; dot: string; label: string }> = {
  legendary: { border: "border-amber-500/40",  bg: "bg-amber-950/60",  dot: "bg-amber-400",  label: "text-amber-300"  },
  epic:      { border: "border-purple-500/40", bg: "bg-purple-950/60", dot: "bg-purple-400", label: "text-purple-300" },
  rare:      { border: "border-blue-500/40",   bg: "bg-blue-950/60",   dot: "bg-blue-400",   label: "text-blue-300"   },
  uncommon:  { border: "border-green-500/40",  bg: "bg-green-950/60",  dot: "bg-green-400",  label: "text-green-300"  },
  common:    { border: "border-zinc-600/30",   bg: "bg-zinc-900/60",   dot: "bg-zinc-500",   label: "text-zinc-300"   },
};

function timeAgo(iso: string): string {
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h`;
}

interface Drop {
  id: number;
  username: string;
  item: string;
  rarity: string;
  points: number;
  droppedAt: string;
}

interface Winner {
  id: number;
  title: string | null;
  prize: string;
  winnerUsername: string | null;
  endedAt: string | null;
}

function DropRow({ drop }: { drop: Drop }) {
  const r = RARITY_STYLES[(drop.rarity as RarityLevel) ?? "common"] ?? RARITY_STYLES.common;
  return (
    <div className={`flex items-center gap-2.5 px-3 py-2 rounded-lg border backdrop-blur-sm ${r.border} ${r.bg}`}>
      <span className={`w-2 h-2 rounded-full shrink-0 ${r.dot}`} />
      <span className="font-bold text-white text-sm truncate" style={{ maxWidth: 100 }}>{drop.username}</span>
      <span className="text-xs text-zinc-500 shrink-0">got</span>
      <span className={`text-sm font-semibold flex-1 truncate ${r.label}`}>{drop.item}</span>
      {drop.points > 0 && (
        <span className="text-xs text-amber-400 shrink-0 font-medium">{drop.points}🪙</span>
      )}
      <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(drop.droppedAt)}</span>
    </div>
  );
}

function WinnerRow({ winner }: { winner: Winner }) {
  if (!winner.winnerUsername) return null;
  return (
    <div className="flex items-center gap-2.5 px-3 py-2 rounded-lg border border-yellow-500/40 bg-yellow-950/60 backdrop-blur-sm">
      <span className="text-base shrink-0">🏆</span>
      <span className="font-bold text-yellow-300 text-sm truncate" style={{ maxWidth: 100 }}>{winner.winnerUsername}</span>
      <span className="text-xs text-zinc-500 shrink-0">won</span>
      <span className="text-sm font-semibold text-white flex-1 truncate">{winner.prize}</span>
      {winner.endedAt && (
        <span className="text-[10px] text-zinc-600 shrink-0">{timeAgo(winner.endedAt)}</span>
      )}
    </div>
  );
}

interface FeedData {
  channel: string;
  recentDrops: Drop[];
  recentWinners: Winner[];
}

export function OverlayPage() {
  const { channel } = useParams<{ channel: string }>();
  const [, setTick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setTick((t) => t + 1), 10_000);
    return () => clearInterval(id);
  }, []);

  const { data } = useQuery<FeedData>({
    queryKey: ["overlay-feed", channel],
    queryFn: async () => {
      const res = await fetch(`/api/overlay/${channel ?? ""}/feed`);
      if (!res.ok) throw new Error("fetch failed");
      return res.json() as Promise<FeedData>;
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
  });

  type FeedItem =
    | { type: "winner"; data: Winner; ts: string }
    | { type: "drop"; data: Drop; ts: string };

  const items: FeedItem[] = [
    ...(data?.recentWinners ?? []).map<FeedItem>((w) => ({ type: "winner", data: w, ts: w.endedAt ?? "" })),
    ...(data?.recentDrops ?? []).map<FeedItem>((d) => ({ type: "drop", data: d, ts: d.droppedAt })),
  ].sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime()).slice(0, 12);

  return (
    <div
      className="p-3 space-y-1.5"
      style={{ fontFamily: "'Bricolage Grotesque', 'Inter', sans-serif", background: "transparent" }}
    >
      {items.length === 0 && (
        <div className="text-zinc-600 text-xs text-center py-4">
          Waiting for loot activity in #{channel ?? ""}…
        </div>
      )}
      {items.map((item) =>
        item.type === "winner" ? (
          <WinnerRow key={`w-${item.data.id}`} winner={item.data} />
        ) : (
          <DropRow key={`d-${item.data.id}`} drop={item.data} />
        )
      )}
    </div>
  );
}

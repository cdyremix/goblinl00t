import { Lock } from "lucide-react";

export interface SteamItem {
  assetId: string;
  classId: string;
  name: string;
  marketHashName: string;
  iconUrl: string;
  tradable: boolean;
  rarityColor: string;
  rarityName: string;
  wear: string | null;
  type: string;
}

export function SteamItemCard({ item, compact = false }: { item: SteamItem; compact?: boolean }) {
  return (
    <div
      className="relative rounded-lg border border-border bg-card/80 p-1.5 flex flex-col items-center gap-1 group hover:border-primary/40 transition-colors"
      title={`${item.name}${item.wear ? ` (${item.wear})` : ""} · ${item.rarityName}${!item.tradable ? " · TRADE LOCKED" : ""}`}
    >
      {!item.tradable && (
        <div className="absolute top-1 right-1 z-10 bg-background/80 rounded-full p-0.5">
          <Lock className="w-3 h-3 text-blue-400" />
        </div>
      )}
      <div
        className="w-full aspect-square rounded overflow-hidden flex items-center justify-center text-center p-2"
        style={{
          background: `linear-gradient(135deg, ${item.rarityColor}33 0%, ${item.rarityColor}11 50%, transparent 100%)`,
          borderBottom: `2px solid ${item.rarityColor}`,
        }}
      >
        {item.iconUrl ? (
          <img src={item.iconUrl} alt={item.name} className="w-full h-full object-contain" loading="lazy" />
        ) : (
          <span className="text-[10px] font-mono font-bold leading-tight" style={{ color: item.rarityColor }}>
            {item.name.split(" | ")[0]}
          </span>
        )}
      </div>
      {!compact && (
        <>
          <p className="text-[10px] text-center text-foreground/80 leading-tight line-clamp-2 w-full">
            {item.name}
          </p>
          {item.wear && (
            <p className="text-[9px] text-muted-foreground">
              {item.wear.replace("Factory New", "FN").replace("Minimal Wear", "MW").replace("Field-Tested", "FT").replace("Well-Worn", "WW").replace("Battle-Scarred", "BS")}
            </p>
          )}
        </>
      )}
    </div>
  );
}

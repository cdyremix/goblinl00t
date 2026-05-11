import { useMemo, useState } from "react";
import { useGetSteamInventory, getGetSteamInventoryQueryKey } from "@workspace/api-client-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Search, Package, AlertCircle } from "lucide-react";

export interface PickedItem {
  name: string;
  marketHashName: string;
  assetId: string;
  iconUrl: string;
  rarityColor: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  onPick: (item: PickedItem) => void;
}

export function InventoryPicker({ open, onOpenChange, onPick }: Props) {
  const [query, setQuery] = useState("");
  const { data, isLoading, error } = useGetSteamInventory({
    query: { enabled: open, queryKey: getGetSteamInventoryQueryKey() },
  });

  const items = useMemo(() => {
    const all = data?.items ?? [];
    const q = query.trim().toLowerCase();
    if (!q) return all;
    return all.filter(
      (i) =>
        i.name.toLowerCase().includes(q) ||
        i.marketHashName.toLowerCase().includes(q) ||
        i.type.toLowerCase().includes(q)
    );
  }, [data, query]);

  const errMsg = error
    ? error instanceof Error
      ? error.message
      : (error as unknown as { error?: string }).error ?? "Unknown error"
    : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-3xl max-h-[85vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Package className="w-5 h-5 text-primary" /> Pick a prize from your CS2 inventory
          </DialogTitle>
          <DialogDescription>
            Click any item to use it as the giveaway prize. Make sure your Steam inventory is public.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            autoFocus
            placeholder="Search by name, weapon, or skin..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9 bg-background"
          />
        </div>

        <div className="flex-1 overflow-y-auto -mx-6 px-6">
          {errMsg ? (
            <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
              <AlertCircle className="w-5 h-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-medium text-destructive">Couldn't load your inventory</p>
                <p className="text-muted-foreground mt-1">{errMsg}</p>
              </div>
            </div>
          ) : isLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <Skeleton key={i} className="aspect-[4/3] rounded-lg" />
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Package className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p>{data && data.items.length === 0 ? "Your inventory is empty." : "No items match your search."}</p>
            </div>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3 pb-2">
              {items.map((item) => (
                <button
                  key={item.assetId}
                  type="button"
                  onClick={() =>
                    onPick({
                      name: item.name,
                      marketHashName: item.marketHashName,
                      assetId: item.assetId,
                      iconUrl: item.iconUrl,
                      rarityColor: item.rarityColor,
                    })
                  }
                  className="group relative bg-card border border-border/50 rounded-lg p-3 text-left hover:border-primary/50 hover:bg-card/80 transition-all"
                  data-testid={`button-pick-${item.assetId}`}
                  style={{ borderTopColor: item.rarityColor, borderTopWidth: 2 }}
                >
                  <div className="aspect-[4/3] mb-2 flex items-center justify-center bg-background/50 rounded">
                    <img
                      src={item.iconUrl}
                      alt={item.name}
                      loading="lazy"
                      className="max-w-full max-h-full object-contain"
                    />
                  </div>
                  <p className="text-xs font-medium text-foreground line-clamp-2 group-hover:text-primary">
                    {item.name}
                  </p>
                  {item.wear && (
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mt-0.5">
                      {item.wear}
                    </p>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

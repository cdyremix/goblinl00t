import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, Crosshair, Sword, ExternalLink, Save, CheckCircle2,
  AlertCircle, Link2, User2, Hash, RefreshCw, Lock, ShieldCheck
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/hint";

type BotTheme = "goblin" | "cs2";

interface BotSettings {
  botTheme: BotTheme;
  botName: string;
  steamTradeUrl: string | null;
  steamId64: string | null;
  steamUsername: string | null;
}

interface SteamItem {
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

interface SteamInventory {
  items: SteamItem[];
  totalCount: number;
}

interface ThemeCard {
  id: BotTheme;
  name: string;
  tagline: string;
  emoji: string;
  defaultBotName: string;
  previewLines: string[];
}

const THEMES: ThemeCard[] = [
  {
    id: "goblin",
    name: "Goblin Hoard",
    tagline: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
    emoji: "👺",
    defaultBotName: "GoblinL00t",
    previewLines: [
      "HEHEHE! xXSniper found [RARE] Dragon Scale! (+120 pts) SCREEE!! goblin want to STEAL!!",
      "🎉 GIVEAWAY TIME!!!! Prize: Mystery Box - Type !enter!! HEHEHE goblin running GIVEAWAY!!",
      "*goblin checks ledger* ChatUser haz 12 loot itemz worth 340 pts! Keep farming!! 📦",
    ],
  },
  {
    id: "cs2",
    name: "CS2 Arms Deal",
    tagline: "Counter-Strike 2 mode — drop skins, run skin giveaways, and collect Steam trade links.",
    emoji: "🔫",
    defaultBotName: "CaseDrop",
    previewLines: [
      "🟣 xXSniper opened a case: [CLASSIFIED] Butterfly Knife | Fade! (+800 pts) INSANE DROP!",
      "🎁 SKIN GIVEAWAY! AK-47 | Asiimov FN — type !enter to be in the draw!",
      "📦 xXSniper's inventory: 8 skins | 1,240 pts. Still no knife tho PepeHands",
    ],
  },
];

function useSettings() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<BotSettings>({
    queryKey: ["bot-settings"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/settings", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to load settings");
      return res.json() as Promise<BotSettings>;
    },
  });

  const mutation = useMutation<BotSettings, Error, Partial<BotSettings>>({
    mutationFn: async (data) => {
      const token = await getToken();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json() as Promise<BotSettings>;
    },
    onSuccess: (data) => qc.setQueryData(["bot-settings"], data),
  });

  return { query, mutation };
}

function useSteamInventory(enabled: boolean) {
  const { getToken } = useAuth();
  return useQuery<SteamInventory>({
    queryKey: ["steam-inventory"],
    enabled,
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/steam/inventory", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json() as { error: string };
        throw new Error(err.error ?? "Failed to fetch inventory");
      }
      return res.json() as Promise<SteamInventory>;
    },
    retry: false,
    staleTime: 60_000,
  });
}

function isSteamTradeUrl(url: string) {
  return url === "" || url.includes("steamcommunity.com/tradeoffer/new/");
}

function isSteamId64(id: string) {
  return id === "" || /^\d{17}$/.test(id);
}

export default function SettingsPage() {
  const { query, mutation } = useSettings();
  const settings = query.data;

  const [pendingTheme, setPendingTheme] = useState<BotTheme | null>(null);
  const [botName, setBotName] = useState("");
  const [botNameTouched, setBotNameTouched] = useState(false);
  const [tradeUrl, setTradeUrl] = useState("");
  const [tradeUrlTouched, setTradeUrlTouched] = useState(false);
  const [steamId64, setSteamId64] = useState("");
  const [steamId64Touched, setSteamId64Touched] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const [showInventory, setShowInventory] = useState(false);

  // Sync initial values from server
  useEffect(() => {
    if (settings && !botNameTouched) setBotName(settings.botName);
    if (settings && !tradeUrlTouched) setTradeUrl(settings.steamTradeUrl ?? "");
    if (settings && !steamId64Touched) setSteamId64(settings.steamId64 ?? "");
  }, [settings, botNameTouched, tradeUrlTouched, steamId64Touched]);

  const inventoryQuery = useSteamInventory(showInventory && !!(settings?.steamId64));

  const activeTheme = pendingTheme ?? settings?.botTheme ?? "goblin";
  const isCS2 = activeTheme === "cs2";
  const tradeUrlValue = tradeUrlTouched ? tradeUrl : (settings?.steamTradeUrl ?? "");
  const steamId64Value = steamId64Touched ? steamId64 : (settings?.steamId64 ?? "");
  const botNameValue = botNameTouched ? botName : (settings?.botName ?? "GoblinL00t");

  const tradeUrlValid = isSteamTradeUrl(tradeUrlValue);
  const steamId64Valid = isSteamId64(steamId64Value);
  const botNameValid = botNameValue.trim().length > 0 && botNameValue.trim().length <= 32;

  const isDirty =
    (pendingTheme !== null && pendingTheme !== settings?.botTheme) ||
    (botNameTouched && botNameValue !== settings?.botName) ||
    (tradeUrlTouched && tradeUrlValue !== (settings?.steamTradeUrl ?? "")) ||
    (steamId64Touched && steamId64Value !== (settings?.steamId64 ?? ""));

  async function handleSave() {
    const payload: Partial<BotSettings> = {};
    if (pendingTheme !== null) payload.botTheme = pendingTheme;
    if (botNameTouched) payload.botName = botNameValue.trim();
    if (tradeUrlTouched) payload.steamTradeUrl = tradeUrlValue || null;
    if (steamId64Touched) payload.steamId64 = steamId64Value || null;
    await mutation.mutateAsync(payload);
    setPendingTheme(null);
    setBotNameTouched(false);
    setTradeUrlTouched(false);
    setSteamId64Touched(false);
    setSavedFeedback(true);
    setTimeout(() => setSavedFeedback(false), 2500);
  }

  if (query.isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm animate-pulse">
        Loading settings...
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="font-medieval text-3xl text-foreground flex items-center gap-3">
          <Settings2 className="w-7 h-7 text-primary" />
          Bot Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Customize your bot's personality, name, and game-specific options.
        </p>
      </div>

      {/* Bot Name */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Bot Display Name</h2>
          <Hint
            text="The name the bot uses when referring to itself in chat messages. Not the Twitch account name — that's set via the TWITCH_BOT_USERNAME env var."
            side="right"
          />
        </div>
        <div className="flex gap-2 items-start max-w-sm">
          <div className="flex-1 space-y-1">
            <div className="relative">
              <User2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                value={botNameValue}
                onChange={(e) => { setBotName(e.target.value); setBotNameTouched(true); }}
                placeholder="GoblinL00t"
                maxLength={32}
                className={`pl-9 ${botNameTouched && !botNameValid ? "border-destructive" : ""}`}
              />
            </div>
            {botNameTouched && !botNameValid && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Must be 1–32 characters
              </p>
            )}
          </div>
          {THEMES.find((t) => t.id === activeTheme) && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0 text-xs"
              onClick={() => {
                const def = THEMES.find((t) => t.id === activeTheme)!.defaultBotName;
                setBotName(def);
                setBotNameTouched(true);
              }}
            >
              Use default
            </Button>
          )}
        </div>
        <p className="text-xs text-muted-foreground">
          Default for this theme: <span className="font-mono text-foreground/60">{THEMES.find((t) => t.id === activeTheme)?.defaultBotName}</span>
        </p>
      </section>

      {/* Theme Picker */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Bot Theme</h2>
          <Hint
            text="The theme controls the bot's language and personality in chat. Switch to CS2 mode for Counter-Strike flavored messages and skin giveaway support."
            side="right"
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {THEMES.map((theme) => {
            const selected = activeTheme === theme.id;
            return (
              <button
                key={theme.id}
                onClick={() => setPendingTheme(theme.id)}
                className={`text-left rounded-xl border p-5 transition-all duration-200 space-y-3 ${
                  selected
                    ? "border-primary bg-primary/10 shadow-[0_0_20px_rgba(255,180,0,0.12)]"
                    : "border-border bg-card/60 hover:border-primary/40 hover:bg-card"
                }`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{theme.emoji}</span>
                      <span className={`font-semibold text-base ${selected ? "text-primary" : "text-foreground"}`}>
                        {theme.name}
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 leading-snug">{theme.tagline}</p>
                  </div>
                  {selected && <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />}
                </div>

                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Chat preview</p>
                  {theme.previewLines.map((line, i) => (
                    <div key={i} className="flex gap-1.5 items-start">
                      <span className="text-muted-foreground/50 text-xs shrink-0 mt-0.5">›</span>
                      <p className="text-xs text-muted-foreground leading-snug font-mono">{line}</p>
                    </div>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* CS2-specific settings */}
      {isCS2 && (
        <section className="space-y-5 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-foreground">CS2 Settings</h2>
          </div>

          {/* Your Steam Trade URL (for posting in announcements) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="steam-trade-url" className="text-sm">Your Steam Trade URL</Label>
              <Hint
                text="Your own trade URL. The bot posts it in chat after giveaway ends so winners know where to send the trade request."
                side="right"
              />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="steam-trade-url"
                  placeholder="https://steamcommunity.com/tradeoffer/new/?partner=..."
                  value={tradeUrlValue}
                  onChange={(e) => { setTradeUrl(e.target.value); setTradeUrlTouched(true); }}
                  className={`pl-9 font-mono text-xs ${tradeUrlTouched && !tradeUrlValid ? "border-destructive focus-visible:ring-destructive" : ""}`}
                />
              </div>
              <Button variant="outline" size="icon" asChild title="Find your trade URL on Steam">
                <a href="https://steamcommunity.com/my/tradeoffers/privacy" target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
            {tradeUrlTouched && !tradeUrlValid && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                Must be a valid Steam trade offer URL
              </p>
            )}
          </div>

          {/* Steam ID 64 for inventory */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="steam-id64" className="text-sm">Steam ID 64</Label>
              <Hint
                text="Your 17-digit Steam ID, used to load your CS2 inventory. Find it at steamid.io — enter your profile URL and copy the SteamID64."
                side="right"
              />
            </div>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Hash className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
                <Input
                  id="steam-id64"
                  placeholder="76561198000000000"
                  value={steamId64Value}
                  onChange={(e) => { setSteamId64(e.target.value); setSteamId64Touched(true); }}
                  className={`pl-9 font-mono text-sm ${steamId64Touched && !steamId64Valid ? "border-destructive" : ""}`}
                  maxLength={17}
                />
              </div>
              <Button variant="outline" size="sm" asChild className="shrink-0 text-xs">
                <a href="https://steamid.io" target="_blank" rel="noopener noreferrer" className="flex items-center gap-1">
                  <ExternalLink className="w-3.5 h-3.5" /> Find my ID
                </a>
              </Button>
            </div>
            {steamId64Touched && !steamId64Valid && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" /> Must be exactly 17 digits
              </p>
            )}
          </div>

          {/* CS2 Inventory */}
          {(settings?.steamId64 || steamId64Value) && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">CS2 Inventory</h3>
                  <Hint text="Your Steam inventory must be set to public. If it's private, Steam won't return your skins." side="right" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => setShowInventory(true)}
                  disabled={inventoryQuery.isFetching}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${inventoryQuery.isFetching ? "animate-spin" : ""}`} />
                  {showInventory ? "Refresh" : "Load Inventory"}
                </Button>
              </div>

              {inventoryQuery.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{inventoryQuery.error?.message}</p>
                </div>
              )}

              {inventoryQuery.isFetching && (
                <div className="h-32 flex items-center justify-center text-muted-foreground text-sm animate-pulse">
                  Loading inventory from Steam...
                </div>
              )}

              {inventoryQuery.data && !inventoryQuery.isFetching && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {inventoryQuery.data.totalCount} total items · {inventoryQuery.data.items.filter((i) => !i.tradable).length} trade locked
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-72 overflow-y-auto pr-1">
                    {inventoryQuery.data.items.slice(0, 60).map((item) => (
                      <div
                        key={item.assetId}
                        className="relative rounded-lg border border-border bg-card/80 p-1.5 flex flex-col items-center gap-1 group hover:border-primary/40 transition-colors"
                        title={`${item.name}${item.wear ? ` (${item.wear})` : ""} · ${item.rarityName}${!item.tradable ? " · TRADE LOCKED" : ""}`}
                      >
                        {!item.tradable && (
                          <div className="absolute top-1 right-1 z-10">
                            <Lock className="w-3 h-3 text-blue-400" />
                          </div>
                        )}
                        <div
                          className="w-full aspect-square rounded overflow-hidden"
                          style={{ borderBottom: `2px solid ${item.rarityColor}` }}
                        >
                          <img
                            src={item.iconUrl}
                            alt={item.name}
                            className="w-full h-full object-contain"
                            loading="lazy"
                          />
                        </div>
                        <p className="text-[10px] text-center text-foreground/80 leading-tight line-clamp-2 w-full">
                          {item.name}
                        </p>
                        {item.wear && (
                          <p className="text-[9px] text-muted-foreground">{item.wear.replace("Factory New", "FN").replace("Minimal Wear", "MW").replace("Field-Tested", "FT").replace("Well-Worn", "WW").replace("Battle-Scarred", "BS")}</p>
                        )}
                      </div>
                    ))}
                  </div>
                  {inventoryQuery.data.items.length > 60 && (
                    <p className="text-xs text-muted-foreground text-center">Showing first 60 of {inventoryQuery.data.items.length} items</p>
                  )}
                </>
              )}
            </div>
          )}

          {/* CS2 commands info */}
          <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sword className="w-4 h-4 text-blue-400" />
              Winner trade URL collection
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              After winning, viewers type{" "}
              <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!tradeurl https://...</span>{" "}
              in chat to submit their Steam trade URL. You can also track and manage all pending trades from the{" "}
              <span className="text-primary">Trade Office</span> in the sidebar.
            </p>
          </div>
        </section>
      )}

      {/* Save */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending || (tradeUrlTouched && !tradeUrlValid) || (steamId64Touched && !steamId64Valid) || !botNameValid}
          className="gap-2"
        >
          {mutation.isPending ? (
            <><div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />Saving...</>
          ) : savedFeedback ? (
            <><CheckCircle2 className="w-4 h-4" />Saved!</>
          ) : (
            <><Save className="w-4 h-4" />Save Settings</>
          )}
        </Button>
        {isDirty && !mutation.isPending && (
          <p className="text-xs text-muted-foreground">You have unsaved changes</p>
        )}
        {mutation.isError && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to save — try again
          </p>
        )}
      </div>
    </div>
  );
}

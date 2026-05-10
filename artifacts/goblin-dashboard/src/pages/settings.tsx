import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, Crosshair, Sword, ExternalLink, Save, CheckCircle2,
  AlertCircle, Link2, User2, RefreshCw, Lock, ShieldCheck, Unlink, Sparkles
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/hint";
import { SteamItemCard, type SteamItem } from "@/components/steam-item-card";
import { defaultBotNameFor, isThemeDefaultName, GOBLIN_DEFAULT_NAME } from "@/lib/cs2-agents";

type BotTheme = "goblin" | "cs2";

interface BotSettings {
  botTheme: BotTheme;
  botName: string;
  steamTradeUrl: string | null;
  steamId64: string | null;
  steamUsername: string | null;
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
  previewLines: string[];
}

const THEMES: ThemeCard[] = [
  {
    id: "goblin",
    name: "Goblin Hoard",
    tagline: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
    emoji: "👺",
    previewLines: [
      "HEHEHE! xXSniper found [RARE] Dragon Scale! (+120 pts) SCREEE!! goblin want to STEAL!!",
      "🎉 GIVEAWAY TIME!!!! Prize: Mystery Box - Type !enter!! HEHEHE!!",
      "*goblin checks ledger* ChatUser haz 12 loot itemz! Keep farming!! 📦",
    ],
  },
  {
    id: "cs2",
    name: "CS2 Arms Deal",
    tagline: "Counter-Strike 2 mode — drop skins, run skin giveaways, and collect Steam trade links.",
    emoji: "🔫",
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

function useSteamConnection() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const connect = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/steam/connect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to connect Steam");
      return res.json() as Promise<{ steamId64: string; steamUsername: string }>;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bot-settings"] });
      void qc.invalidateQueries({ queryKey: ["steam-inventory"] });
    },
  });

  const disconnect = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/steam/disconnect", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to disconnect Steam");
      return res.json();
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["bot-settings"] });
      qc.removeQueries({ queryKey: ["steam-inventory"] });
    },
  });

  return { connect, disconnect };
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

export default function SettingsPage() {
  const { query, mutation } = useSettings();
  const { connect, disconnect } = useSteamConnection();
  const settings = query.data;

  const [pendingTheme, setPendingTheme] = useState<BotTheme | null>(null);
  const [botName, setBotName] = useState("");
  const [botNameTouched, setBotNameTouched] = useState(false);
  const [tradeUrl, setTradeUrl] = useState("");
  const [tradeUrlTouched, setTradeUrlTouched] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Sync initial values from server
  useEffect(() => {
    if (settings && !botNameTouched) setBotName(settings.botName);
    if (settings && !tradeUrlTouched) setTradeUrl(settings.steamTradeUrl ?? "");
  }, [settings, botNameTouched, tradeUrlTouched]);

  const activeTheme = pendingTheme ?? settings?.botTheme ?? "goblin";
  const isCS2 = activeTheme === "cs2";

  const inventoryQuery = useSteamInventory(!!settings?.steamId64);

  const tradeUrlValue = tradeUrlTouched ? tradeUrl : (settings?.steamTradeUrl ?? "");
  const botNameValue = botNameTouched ? botName : (settings?.botName ?? GOBLIN_DEFAULT_NAME);

  const tradeUrlValid = isSteamTradeUrl(tradeUrlValue);
  const botNameValid = botNameValue.trim().length > 0 && botNameValue.trim().length <= 32;

  const isDirty =
    (pendingTheme !== null && pendingTheme !== settings?.botTheme) ||
    (botNameTouched && botNameValue !== settings?.botName) ||
    (tradeUrlTouched && tradeUrlValue !== (settings?.steamTradeUrl ?? ""));

  function handleThemeChange(newTheme: BotTheme) {
    const fromTheme = pendingTheme ?? settings?.botTheme ?? "goblin";
    setPendingTheme(newTheme);
    // Only auto-swap the bot name if the user has NOT customized it:
    //   - They haven't typed in the field this session (botNameTouched is false), AND
    //   - The saved server value is recognized as a default for the previous theme.
    const savedName = settings?.botName ?? "";
    const isUntouchedDefault = !botNameTouched && isThemeDefaultName(savedName, fromTheme);
    if (isUntouchedDefault) {
      setBotName(defaultBotNameFor(newTheme));
      setBotNameTouched(true);
    }
  }

  function rerollDefaultName() {
    setBotName(defaultBotNameFor(activeTheme));
    setBotNameTouched(true);
  }

  async function handleSave() {
    const payload: Partial<BotSettings> = {};
    if (pendingTheme !== null) payload.botTheme = pendingTheme;
    if (botNameTouched) payload.botName = botNameValue.trim();
    if (tradeUrlTouched) payload.steamTradeUrl = tradeUrlValue || null;
    await mutation.mutateAsync(payload);
    setPendingTheme(null);
    setBotNameTouched(false);
    setTradeUrlTouched(false);
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
            text="The name the bot uses when referring to itself in chat messages. Switching themes auto-fills the default name for that theme — pick CS2 to randomize a CS2 agent name."
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
                placeholder={defaultBotNameFor(activeTheme)}
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
          <Button
            variant="outline"
            size="sm"
            className="shrink-0 text-xs gap-1.5"
            onClick={rerollDefaultName}
            title={isCS2 ? "Re-roll a random CS2 agent name" : "Reset to GoblinL00t"}
          >
            <Sparkles className="w-3.5 h-3.5" />
            {isCS2 ? "Random agent" : "Reset default"}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          {isCS2
            ? "CS2 mode uses a random Counter-Strike agent name as the default — click 'Random agent' to re-roll."
            : "Goblin mode uses the classic GoblinL00t name."}
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
                onClick={() => handleThemeChange(theme.id)}
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

          {/* Steam connection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm">Steam Account</Label>
              <Hint
                text="Connect your Steam account to load your CS2 inventory and use it for giveaways. In test mode this is a mock connection — production would redirect to Steam OpenID."
                side="right"
              />
            </div>

            {settings?.steamId64 ? (
              <div className="flex items-center gap-3 rounded-lg border border-green-500/30 bg-green-500/5 px-4 py-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-600 to-blue-900 flex items-center justify-center shrink-0">
                  <ShieldCheck className="w-5 h-5 text-white" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-sm font-semibold text-foreground">{settings.steamUsername ?? "Steam User"}</span>
                    <CheckCircle2 className="w-3.5 h-3.5 text-green-400" />
                  </div>
                  <p className="text-xs text-muted-foreground font-mono truncate">SteamID64: {settings.steamId64}</p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="shrink-0 gap-1.5 text-xs"
                  onClick={() => disconnect.mutate()}
                  disabled={disconnect.isPending}
                >
                  <Unlink className="w-3.5 h-3.5" />
                  Disconnect
                </Button>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed border-border bg-card/40 px-4 py-5 text-center space-y-3">
                <p className="text-sm text-muted-foreground">Connect your Steam account to load your CS2 inventory</p>
                <Button
                  onClick={() => connect.mutate()}
                  disabled={connect.isPending}
                  className="gap-2 bg-[#171a21] hover:bg-[#1b2838] text-white border border-[#66c0f4]/40"
                >
                  {connect.isPending ? (
                    <><div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />Connecting…</>
                  ) : (
                    <>
                      <svg viewBox="0 0 24 24" className="w-4 h-4" fill="currentColor">
                        <path d="M11.979 0C5.678 0 .511 4.86.022 11.037l6.432 2.658c.545-.371 1.203-.59 1.912-.59.063 0 .125.004.188.006l2.861-4.142V8.91c0-2.495 2.028-4.524 4.524-4.524 2.494 0 4.524 2.031 4.524 4.527s-2.03 4.525-4.524 4.525h-.105l-4.076 2.911c0 .052.004.105.004.159 0 1.875-1.515 3.396-3.39 3.396-1.635 0-3.016-1.173-3.331-2.727L.436 15.27C1.862 20.307 6.486 24 11.979 24c6.627 0 11.999-5.373 11.999-12S18.605 0 11.979 0zM7.54 18.21l-1.473-.61c.262.543.714.999 1.314 1.25 1.297.539 2.793-.076 3.332-1.375.263-.63.264-1.319.005-1.949s-.75-1.121-1.377-1.383c-.624-.26-1.29-.249-1.878-.03l1.523.63c.957.4 1.409 1.5 1.009 2.456-.397.957-1.497 1.41-2.454 1.012H7.54zm11.415-9.303c0-1.662-1.353-3.015-3.015-3.015-1.665 0-3.015 1.353-3.015 3.015 0 1.665 1.35 3.015 3.015 3.015 1.663 0 3.015-1.35 3.015-3.015zm-5.273-.005c0-1.252 1.013-2.266 2.265-2.266 1.249 0 2.266 1.014 2.266 2.266 0 1.251-1.017 2.265-2.266 2.265-1.253 0-2.265-1.014-2.265-2.265z"/>
                      </svg>
                      Connect Steam
                    </>
                  )}
                </Button>
                {connect.isError && (
                  <p className="text-xs text-destructive flex items-center justify-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5" /> {connect.error?.message}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground/70">
                  Test mode — uses a sample inventory for demo purposes
                </p>
              </div>
            )}
          </div>

          {/* Your Steam Trade URL */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="steam-trade-url" className="text-sm">Your Steam Trade URL</Label>
              <Hint
                text="Your own trade URL. The bot posts it in chat after a giveaway ends so winners know where to send the trade request."
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

          {/* CS2 Inventory */}
          {settings?.steamId64 && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-semibold text-foreground">CS2 Inventory</h3>
                  <Hint text="Your loaded CS2 inventory. Use these items for skin giveaways — winners receive the item via Steam trade." side="right" />
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-1.5 text-xs"
                  onClick={() => inventoryQuery.refetch()}
                  disabled={inventoryQuery.isFetching}
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${inventoryQuery.isFetching ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>

              {inventoryQuery.isError && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2.5">
                  <AlertCircle className="w-4 h-4 text-destructive shrink-0 mt-0.5" />
                  <p className="text-xs text-destructive">{inventoryQuery.error?.message}</p>
                </div>
              )}

              {inventoryQuery.isFetching && !inventoryQuery.data && (
                <div className="h-32 flex items-center justify-center text-muted-foreground text-sm animate-pulse">
                  Loading inventory from Steam...
                </div>
              )}

              {inventoryQuery.data && (
                <>
                  <p className="text-xs text-muted-foreground">
                    {inventoryQuery.data.totalCount} total items · {inventoryQuery.data.items.filter((i) => !i.tradable).length} trade locked
                  </p>
                  <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 gap-2 max-h-72 overflow-y-auto pr-1">
                    {inventoryQuery.data.items.slice(0, 60).map((item) => (
                      <SteamItemCard key={item.assetId} item={item} />
                    ))}
                  </div>
                </>
              )}
            </div>
          )}

          {/* Trade URL collection info */}
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
          disabled={!isDirty || mutation.isPending || (tradeUrlTouched && !tradeUrlValid) || !botNameValid}
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


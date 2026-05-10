import { useState, useEffect } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, Crosshair, Sword, ExternalLink, Save, CheckCircle2,
  AlertCircle, Link2, User2, ShieldCheck, Unlink
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Hint } from "@/components/hint";
import { defaultBotNameFor } from "@/lib/cs2-agents";

type BotTheme = "goblin" | "cs2";

interface BotSettings {
  botTheme: BotTheme;
  botName: string;
  steamTradeUrl: string | null;
  steamId64: string | null;
  steamUsername: string | null;
}

const THEME_OPTIONS: { id: BotTheme; name: string; emoji: string; description: string }[] = [
  {
    id: "goblin",
    name: "Goblin Hoard",
    emoji: "👺",
    description: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
  },
  {
    id: "cs2",
    name: "CS2 Arms Deal",
    emoji: "🔫",
    description: "Counter-Strike 2 mode — drop skins, run skin giveaways, and collect Steam trade links.",
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

function isSteamTradeUrl(url: string) {
  return url === "" || url.includes("steamcommunity.com/tradeoffer/new/");
}

export default function SettingsPage() {
  const { query, mutation } = useSettings();
  const { connect, disconnect } = useSteamConnection();
  const settings = query.data;

  const [pendingTheme, setPendingTheme] = useState<BotTheme | null>(null);
  const [botNameDraft, setBotNameDraft] = useState<string | null>(null);
  const [tradeUrl, setTradeUrl] = useState("");
  const [tradeUrlTouched, setTradeUrlTouched] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  // Sync trade URL initial value from server
  useEffect(() => {
    if (settings && !tradeUrlTouched) setTradeUrl(settings.steamTradeUrl ?? "");
  }, [settings, tradeUrlTouched]);

  const activeTheme = pendingTheme ?? settings?.botTheme ?? "goblin";
  const isCS2 = activeTheme === "cs2";
  const themeDefaultName = defaultBotNameFor(activeTheme);

  // Bot name input: controlled. When the user hasn't typed anything (draft is null)
  // we show the saved name in the field. The placeholder always shows the themed default.
  const savedName = settings?.botName ?? "";
  const inputValue = botNameDraft ?? savedName;
  const trimmed = inputValue.trim();
  const nameValid = trimmed.length === 0 || trimmed.length <= 32;
  const nameChanged = botNameDraft !== null && trimmed !== savedName;

  const tradeUrlValue = tradeUrlTouched ? tradeUrl : (settings?.steamTradeUrl ?? "");
  const tradeUrlValid = isSteamTradeUrl(tradeUrlValue);

  const isDirty =
    (pendingTheme !== null && pendingTheme !== settings?.botTheme) ||
    (tradeUrlTouched && tradeUrlValue !== (settings?.steamTradeUrl ?? ""));

  async function handleUpdateBotName() {
    if (!nameValid || !nameChanged) return;
    // Empty input → reset to the current theme's default.
    const newName = trimmed === "" ? themeDefaultName : trimmed;
    await mutation.mutateAsync({ botName: newName });
    setBotNameDraft(null);
  }

  async function handleSave() {
    const payload: Partial<BotSettings> = {};
    if (pendingTheme !== null) {
      payload.botTheme = pendingTheme;
      // If the user is on the previous theme's default name, swap to the new theme's default.
      const fromTheme = settings?.botTheme ?? "goblin";
      if (savedName === defaultBotNameFor(fromTheme)) {
        payload.botName = defaultBotNameFor(pendingTheme);
      }
    }
    if (tradeUrlTouched) payload.steamTradeUrl = tradeUrlValue || null;
    await mutation.mutateAsync(payload);
    setPendingTheme(null);
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
      <section className="space-y-2">
        <Label htmlFor="bot-name" className="text-lg font-semibold text-foreground">Bot Display Name</Label>
        <p className="text-xs text-muted-foreground">
          The name the bot uses in chat. Leave blank to use the default for your theme.
        </p>
        <div className="flex gap-2 items-start max-w-sm">
          <div className="flex-1 space-y-1">
            <div className="relative">
              <User2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="bot-name"
                value={inputValue}
                onChange={(e) => setBotNameDraft(e.target.value)}
                placeholder={themeDefaultName}
                maxLength={32}
                className={`pl-9 placeholder:text-muted-foreground/50 ${!nameValid ? "border-destructive" : ""}`}
              />
            </div>
            {!nameValid && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Must be 32 characters or fewer
              </p>
            )}
          </div>
          {nameChanged && (
            <Button
              size="sm"
              className="shrink-0 gap-1.5"
              onClick={handleUpdateBotName}
              disabled={!nameValid || mutation.isPending}
            >
              {mutation.isPending ? (
                <div className="w-3.5 h-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              ) : (
                <Save className="w-3.5 h-3.5" />
              )}
              Update
            </Button>
          )}
        </div>
      </section>

      {/* Theme Selector */}
      <section className="space-y-2 max-w-sm">
        <Label htmlFor="bot-theme" className="text-lg font-semibold text-foreground">Bot Theme</Label>
        <p className="text-xs text-muted-foreground">
          Controls the bot's language and personality in chat.
        </p>
        <Select value={activeTheme} onValueChange={(v) => setPendingTheme(v as BotTheme)}>
          <SelectTrigger id="bot-theme" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((theme) => (
              <SelectItem key={theme.id} value={theme.id}>
                <div className="flex items-center gap-2">
                  <span className="text-base">{theme.emoji}</span>
                  <span>{theme.name}</span>
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground/80 leading-snug">
          {THEME_OPTIONS.find((t) => t.id === activeTheme)?.description}
        </p>
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
                text="Connect your Steam account to load your CS2 inventory in the Trade Office. In test mode this is a mock connection — production would redirect to Steam OpenID."
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
                <p className="text-sm text-muted-foreground">Connect your Steam account to load your CS2 inventory in the Trade Office</p>
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

      {/* Save (theme + trade URL) */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending || (tradeUrlTouched && !tradeUrlValid)}
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

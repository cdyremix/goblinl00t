import { useState } from "react";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Settings2, Crosshair, Sword, ExternalLink, Save, CheckCircle2, AlertCircle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Hint } from "@/components/hint";

type BotTheme = "goblin" | "cs2";

interface BotSettings {
  botTheme: BotTheme;
  steamTradeUrl: string | null;
}

interface ThemeCard {
  id: BotTheme;
  name: string;
  tagline: string;
  emoji: string;
  color: string;
  previewLines: string[];
}

const THEMES: ThemeCard[] = [
  {
    id: "goblin",
    name: "Goblin Hoard",
    tagline: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
    emoji: "👺",
    color: "amber",
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
    color: "blue",
    previewLines: [
      "🟣 xXSniper opened a case: [CLASSIFIED] Butterfly Knife | Fade! (+800 pts) INSANE DROP!",
      "🎁 SKIN GIVEAWAY! AK-47 | Asiimov FN — type !enter to be in the draw!",
      "📦 xXSniper's inventory: 8 skins | 1,240 pts. Still no knife tho PepeHands",
    ],
  },
];

function useSettings() {
  const { getToken } = useAuth();

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

  const qc = useQueryClient();
  const mutation = useMutation<BotSettings, Error, Partial<BotSettings>>({
    mutationFn: async (data) => {
      const token = await getToken();
      const res = await fetch("/api/settings", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) throw new Error("Failed to save settings");
      return res.json() as Promise<BotSettings>;
    },
    onSuccess: (data) => {
      qc.setQueryData(["bot-settings"], data);
    },
  });

  return { query, mutation };
}

function isSteamTradeUrl(url: string): boolean {
  return url === "" || url.includes("steamcommunity.com/tradeoffer/new/");
}

export default function SettingsPage() {
  const { query, mutation } = useSettings();
  const [pendingTheme, setPendingTheme] = useState<BotTheme | null>(null);
  const [tradeUrl, setTradeUrl] = useState<string>("");
  const [tradeUrlTouched, setTradeUrlTouched] = useState(false);
  const [savedFeedback, setSavedFeedback] = useState(false);

  const settings = query.data;
  const activeTheme = pendingTheme ?? settings?.botTheme ?? "goblin";
  const isCS2 = activeTheme === "cs2";
  const tradeUrlValue = tradeUrlTouched ? tradeUrl : (settings?.steamTradeUrl ?? "");
  const tradeUrlValid = isSteamTradeUrl(tradeUrlValue);

  const isDirty =
    (pendingTheme !== null && pendingTheme !== settings?.botTheme) ||
    (tradeUrlTouched && tradeUrlValue !== (settings?.steamTradeUrl ?? ""));

  async function handleSave() {
    const payload: Partial<BotSettings> = {};
    if (pendingTheme !== null) payload.botTheme = pendingTheme;
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
          Choose your bot's personality and configure game-specific options.
        </p>
      </div>

      {/* Theme Picker */}
      <section className="space-y-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-foreground">Bot Theme</h2>
          <Hint
            text="The theme controls the bot's language and personality in chat. Switch to CS2 mode to get Counter-Strike flavored messages for skin giveaways."
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
                {/* Card header */}
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
                  {selected && (
                    <CheckCircle2 className="w-5 h-5 text-primary shrink-0 mt-0.5" />
                  )}
                </div>

                {/* Preview lines */}
                <div className="space-y-1.5 pt-1 border-t border-border/50">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">
                    Chat preview
                  </p>
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
        <section className="space-y-4 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-foreground">CS2 Settings</h2>
          </div>

          {/* Steam Trade URL */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label htmlFor="steam-trade-url" className="text-sm">
                Steam Trade URL
              </Label>
              <Hint
                text="Your Steam trade offer URL so winners can receive skins automatically. Found in Steam → Inventory → Trade Offers → Who can send me trade offers?"
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
                  onChange={(e) => {
                    setTradeUrl(e.target.value);
                    setTradeUrlTouched(true);
                  }}
                  className={`pl-9 font-mono text-xs ${
                    tradeUrlTouched && !tradeUrlValid
                      ? "border-destructive focus-visible:ring-destructive"
                      : ""
                  }`}
                />
              </div>
              <Button
                variant="outline"
                size="icon"
                asChild
                title="How to find your trade URL"
              >
                <a
                  href="https://steamcommunity.com/my/tradeoffers/privacy"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <ExternalLink className="w-4 h-4" />
                </a>
              </Button>
            </div>
            {tradeUrlTouched && !tradeUrlValid && (
              <p className="flex items-center gap-1.5 text-xs text-destructive">
                <AlertCircle className="w-3.5 h-3.5" />
                Must be a valid Steam trade offer URL (steamcommunity.com/tradeoffer/new/...)
              </p>
            )}
            <p className="text-xs text-muted-foreground">
              Winners of skin giveaways will need to send you a trade offer — paste your link here so
              the bot can post it in chat after a giveaway ends.
            </p>
          </div>

          {/* CS2 commands info */}
          <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sword className="w-4 h-4 text-blue-400" />
              CS2-themed commands
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              In CS2 mode all existing commands work but speak Counter-Strike — <span className="font-mono text-foreground/70">!loot</span> becomes a case
              opening, <span className="font-mono text-foreground/70">!hoard</span> shows your skin inventory, and giveaway
              announcements reference skins, floats, and trade offers.
            </p>
          </div>
        </section>
      )}

      {/* Save bar */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={!isDirty || mutation.isPending || (tradeUrlTouched && !tradeUrlValid)}
          className="gap-2"
        >
          {mutation.isPending ? (
            <>
              <div className="w-4 h-4 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
              Saving...
            </>
          ) : savedFeedback ? (
            <>
              <CheckCircle2 className="w-4 h-4" />
              Saved!
            </>
          ) : (
            <>
              <Save className="w-4 h-4" />
              Save Settings
            </>
          )}
        </Button>
        {isDirty && !mutation.isPending && (
          <p className="text-xs text-muted-foreground">You have unsaved changes</p>
        )}
        {mutation.isError && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" />
            Failed to save — try again
          </p>
        )}
      </div>
    </div>
  );
}

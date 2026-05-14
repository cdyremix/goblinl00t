import { useState, useEffect } from "react";
import { Link } from "wouter";
import { useAuth } from "@clerk/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Settings2, Crosshair, Sword, Save, CheckCircle2,
  AlertCircle, User2, ShieldCheck, Unlink, Terminal, Plus, Trash2, Clock, ChevronDown,
  Send, Loader2,
} from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Hint } from "@/components/hint";
import { defaultBotNameFor } from "@/lib/cs2-agents";
import { FeatureLock, useSubscriptionTier, LockedHint } from "@/hooks/use-tier";
import { hasFeature } from "@/lib/plans";

type BotTheme = "goblin" | "cs2" | "hearthstone";

type RarityWeights = {
  common: number;
  uncommon: number;
  rare: number;
  epic: number;
  legendary: number;
};

const DEFAULT_RARITY_WEIGHTS: RarityWeights = {
  common: 50,
  uncommon: 30,
  rare: 15,
  epic: 4,
  legendary: 1,
};

interface BotSettings {
  botTheme: BotTheme;
  botName: string;
  steamTradeUrl: string | null;
  steamId64: string | null;
  steamUsername: string | null;
  goblinEventsEnabled: boolean;
  lootDropsEnabled: boolean;
  coinRedemptionEnabled: boolean;
  coinCap: number | null;
  wheelMode: "auto" | "manual";
  wheelSpeed: "slow" | "medium" | "fast";
  eliminationFlavorEnabled: boolean;
  /** Optional Discord webhook URL — see below for validation rules. */
  discordWebhookUrl: string | null;
  /** Custom rarity weights for !loot rolls. null = server defaults. */
  lootRarityWeights: RarityWeights | null;
}

const THEME_OPTIONS: { id: BotTheme; name: string; emoji: string; description: string }[] = [
  {
    id: "goblin",
    name: "Goblin Horde",
    emoji: "👺",
    description: "The original mischievous loot goblin — chaotic, greedy, and very excitable.",
  },
  {
    id: "cs2",
    name: "CS2 Arms Deal",
    emoji: "🔫",
    description: "Counter-Strike 2 mode — drop skins, run skin giveaways, and collect Steam trade links.",
  },
  {
    id: "hearthstone",
    name: "Hearthstone Tavern",
    emoji: "🍺",
    description: "Tavern Brawl mode — crack packs, roll legendaries, and let RNGsus decide your fate.",
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

  // Real Steam OpenID 2.0 sign-in. The server returns the URL we should send
  // the user to; Steam authenticates them and posts back to our callback,
  // which sets a cookie and redirects to /settings?connected=steam.
  const connect = useMutation({
    mutationFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/steam/auth/init", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to start Steam sign-in");
      }
      const { url } = (await res.json()) as { url: string };
      // Break out of the Replit preview iframe — Steam's OpenID page
      // refuses to be framed, so an in-frame redirect would silently fail.
      window.location.href = url;
      return { url };
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

// ---------------------------------------------------------------------------
// ThemeChatPreview — live-cycling fake chat window showing what each bot theme
// looks like in practice. Renders inside the Theme tab between the selector and
// any theme-specific settings panel.
// ---------------------------------------------------------------------------

type ChatLine = { who: string; whoColor: string; text: string; tint?: string };

const THEME_REELS: Record<BotTheme, ChatLine[]> = {
  goblin: [
    { who: "loot_pirate",  whoColor: "text-blue-400",   text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🟣 EPIC!! @loot_pirate found a Dragon Scale! (+175 pts) SCREEEEE!!", tint: "text-purple-400" },
    { who: "neon_cat",     whoColor: "text-pink-400",   text: "!enter" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "✅ @neon_cat is in the pool! 23 entries so far." },
    { who: "vapor_witch",  whoColor: "text-purple-400", text: "!steal neon_cat" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🦝 vapor_witch mugged neon_cat for 60 coins. Chaos prevails." },
    { who: "speedrun_sam", whoColor: "text-green-400",  text: "!goblin" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "HEHEHE! The goblin sees speedrun_sam watching... better grab more loot! 🪙" },
    { who: "pixel_knight", whoColor: "text-orange-400", text: "!inventory" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🎒 @pixel_knight: [1] Dragon Scale [2] Lucky Charm [3] empty" },
    { who: "chaos_reaper", whoColor: "text-red-400",    text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "✨ GOLDEN LEGENDARY!! @chaos_reaper cracked open a Cursed Idol! (+2500 pts) 🪙", tint: "text-yellow-300" },
  ],
  cs2: [
    { who: "loot_pirate",  whoColor: "text-blue-400",   text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🟣 CLASSIFIED!! @loot_pirate unboxed AWP | Hyper Beast (FT) (+800 pts) chat is NOT okay", tint: "text-purple-400" },
    { who: "neon_cat",     whoColor: "text-pink-400",   text: "!enter" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "neon_cat threw their name in the pool. Float factory will decide fate." },
    { who: "vapor_witch",  whoColor: "text-purple-400", text: "!scam loot_pirate" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "vapor_witch attempted a trade scam on loot_pirate and lost 20 coins. Bruh." },
    { who: "speedrun_sam", whoColor: "text-green-400",  text: "!skin" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🔫 speedrun_sam inspected the case... it's a StatTrak M4A4 | Howl. Insane." },
    { who: "pixel_knight", whoColor: "text-orange-400", text: "!tradeurl https://steamcommunity.com/tradeoffer/..." },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "✅ @pixel_knight: Trade URL saved! The streamer will send your skin soon 🎁" },
    { who: "chaos_reaper", whoColor: "text-red-400",    text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "⭐ COVERT UNBOX! @chaos_reaper pulled Karambit | Fade (FN) (+5000 pts) KNIFEEEEE 🔪", tint: "text-yellow-300" },
  ],
  hearthstone: [
    { who: "loot_pirate",  whoColor: "text-blue-400",   text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🟣 EPIC!! @loot_pirate cracked a pack: Sylvanas Windrunner! (+600 pts) RNGsus is pleased!", tint: "text-purple-400" },
    { who: "neon_cat",     whoColor: "text-pink-400",   text: "!enter" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "✅ @neon_cat entered the Tavern Brawl! 18 challengers so far." },
    { who: "vapor_witch",  whoColor: "text-purple-400", text: "!innkeeper" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🍺 Welcome to the Tavern, vapor_witch! Pull up a chair — your pack is on the house." },
    { who: "speedrun_sam", whoColor: "text-green-400",  text: "!brew" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "🍖 speedrun_sam bought the Innkeeper a round. The tavern erupts in applause!" },
    { who: "pixel_knight", whoColor: "text-orange-400", text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "👀 @pixel_knight searched but found nothing. The Innkeeper shrugs." },
    { who: "chaos_reaper", whoColor: "text-red-400",    text: "!loot" },
    { who: "Goblin L00t",  whoColor: "text-primary",    text: "✨ GOLDEN LEGENDARY!! @chaos_reaper pulled Golden Ragnaros the Firelord! (+5000 pts) THE TAVERN IS IN UPROAR!! 🔥", tint: "text-yellow-300" },
  ],
};

function ThemeChatPreview({ theme }: { theme: BotTheme }) {
  const reel = THEME_REELS[theme];
  const [head, setHead] = useState(0);
  useEffect(() => {
    setHead(0);
  }, [theme]);
  useEffect(() => {
    const id = setInterval(() => setHead((i) => (i + 1) % reel.length), 1700);
    return () => clearInterval(id);
  }, [reel]);

  const lines = Array.from({ length: 5 }, (_, k) => {
    const idx = (head + k) % reel.length;
    return { ...reel[idx], _key: `${theme}-${head}-${k}` };
  });

  const themeAccent =
    theme === "cs2" ? "border-blue-500/30 bg-blue-500/5" :
    theme === "hearthstone" ? "border-orange-500/30 bg-orange-500/5" :
    "border-primary/20 bg-primary/5";

  const themeBar =
    theme === "cs2" ? "bg-blue-500" :
    theme === "hearthstone" ? "bg-orange-500" :
    "bg-primary";

  const themeLabel =
    theme === "cs2" ? "CS2 Arms Deal" :
    theme === "hearthstone" ? "Hearthstone Tavern" :
    "Goblin Horde";

  return (
    <div className={`rounded-xl border ${themeAccent} overflow-hidden`}>
      <div className="flex items-center gap-2 px-4 py-2 border-b border-border/40 bg-card/60">
        <div className={`w-2 h-2 rounded-full ${themeBar} animate-pulse`} />
        <span className="text-xs font-mono text-muted-foreground">twitch.tv/yourchannel · #{themeLabel.toLowerCase().replace(/ /g, "-")}</span>
      </div>
      <div className="px-4 py-3 space-y-1 font-mono text-xs min-h-[120px]">
        {lines.map((line) => (
          <div key={line._key} className="flex gap-2 leading-relaxed">
            <span className={`shrink-0 font-semibold ${line.whoColor}`}>{line.who}:</span>
            <span className={line.tint ?? "text-foreground/80"}>{line.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { query, mutation } = useSettings();
  const { connect, disconnect } = useSteamConnection();
  const { tier } = useSubscriptionTier();
  const canAllThemes = hasFeature(tier, "all-themes");
  const canCustomBotName = hasFeature(tier, "custom-bot-name");
  const settings = query.data;

  const [pendingTheme, setPendingTheme] = useState<BotTheme | null>(null);
  const [botNameDraft, setBotNameDraft] = useState<string | null>(null);
  const [savedFeedback, setSavedFeedback] = useState(false);
  const savedTheme: BotTheme = settings?.botTheme ?? "goblin";
  const activeTheme: BotTheme = pendingTheme ?? savedTheme;
  const isCS2 = activeTheme === "cs2";
  const isHearthstone = activeTheme === "hearthstone";
  const themeDefaultName = defaultBotNameFor(activeTheme);

  // Bot name in the input. When the user hasn't typed (draft null), show the saved name.
  const savedName = settings?.botName ?? "";
  const inputValue = botNameDraft ?? savedName;
  const trimmed = inputValue.trim();
  const nameValid = trimmed.length === 0 || trimmed.length <= 32;

  // Empty input means "use the active theme's default"
  const effectiveName = trimmed === "" ? themeDefaultName : trimmed;
  const nameChanged = effectiveName !== savedName;

  const themeChanged = pendingTheme !== null && pendingTheme !== savedTheme;

  const hasChanges = nameChanged || themeChanged;
  const allValid = nameValid;

  function handleThemeSelect(newTheme: BotTheme) {
    setPendingTheme(newTheme);
    // If the bot name in the input is the previous theme's default, swap to the
    // new theme's default so the user sees the change immediately.
    const currentlyDisplayed = botNameDraft ?? savedName;
    if (currentlyDisplayed === defaultBotNameFor(activeTheme)) {
      setBotNameDraft(defaultBotNameFor(newTheme));
    }
  }

  async function handleSave() {
    if (!hasChanges || !allValid) return;
    const payload: Partial<BotSettings> = {};
    if (themeChanged) payload.botTheme = pendingTheme!;
    if (nameChanged) payload.botName = effectiveName;
    await mutation.mutateAsync(payload);
    setPendingTheme(null);
    setBotNameDraft(null);
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
    <div className="space-y-6 max-w-3xl">
      {/* Header */}
      <div>
        <h1 className="font-medieval text-3xl text-foreground flex items-center gap-3">
          <Settings2 className="w-7 h-7 text-primary" />
          Bot Settings
        </h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Customize your bot's personality, behavior, and game-specific options.
        </p>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className="grid w-full grid-cols-2 max-w-xs">
          <TabsTrigger value="general" data-testid="tab-settings-general">General</TabsTrigger>
          <TabsTrigger value="theme" data-testid="tab-settings-theme">Theme</TabsTrigger>
        </TabsList>

      {/* ============================================================ */}
      {/* GENERAL TAB                                                  */}
      {/* ============================================================ */}
      <TabsContent value="general" forceMount className="space-y-8 mt-0 data-[state=inactive]:hidden">

      {/* Bot Name */}
      <section className="space-y-2 max-w-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="bot-name" className="text-lg font-semibold text-foreground">Bot Display Name</Label>
          <Hint
            text="The name the bot uses when referring to itself in chat. Leave blank to use the default name for your selected theme."
            side="right"
          />
          {!canCustomBotName && <LockedHint feature="custom-bot-name" />}
        </div>
        <div className="flex gap-2 items-start">
          <div className="flex-1 space-y-1">
            <div className="relative">
              <User2 className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
              <Input
                id="bot-name"
                value={inputValue}
                onChange={(e) => canCustomBotName && setBotNameDraft(e.target.value)}
                placeholder={themeDefaultName}
                maxLength={32}
                disabled={!canCustomBotName}
                title={canCustomBotName ? undefined : "Custom bot name requires the Goblin King rank."}
                className={`pl-9 placeholder:text-muted-foreground/50 ${!nameValid ? "border-destructive" : ""} ${!canCustomBotName ? "cursor-not-allowed opacity-60" : ""}`}
              />
            </div>
            {!nameValid && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="w-3 h-3" /> Must be 32 characters or fewer
              </p>
            )}
          </div>
          <Button
            size="sm"
            className="shrink-0 gap-1.5"
            onClick={handleSave}
            disabled={!hasChanges || !allValid || mutation.isPending}
          >
            {mutation.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
            ) : savedFeedback ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {savedFeedback ? "Saved" : "Update"}
          </Button>
        </div>
        {mutation.isError && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="w-3.5 h-3.5" /> Failed to save — try again
          </p>
        )}
      </section>

      {/* Discord Webhook */}
      <section className="space-y-3 max-w-2xl">
        <FeatureLock
          feature="discord-webhooks"
          description="Auto-post a winner embed to your Discord server every time a giveaway ends."
        >
          <DiscordWebhookSection
            value={settings?.discordWebhookUrl ?? null}
            saving={mutation.isPending}
            onSave={(v) => mutation.mutate({ discordWebhookUrl: v })}
          />
        </FeatureLock>
      </section>

      {/* Economy & Loot */}
      <section className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-2">
          <span className="text-lg">💰</span>
          <h2 className="text-lg font-semibold text-foreground">Economy &amp; Loot</h2>
          <Hint
            text="Controls coin earning, redemption, and special-item drops. These rules apply globally to chat — toggling them off takes effect immediately."
            side="right"
          />
        </div>

        {/* Random Goblin Events */}
        <div className="rounded-xl border border-amber-500/20 bg-amber-500/5 p-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">👺</span>
                <Label htmlFor="goblin-events" className="text-base font-semibold text-foreground">Random Goblin Events</Label>
                <Hint text="Every 5–15 minutes the goblin pops into chat to drop coins on a recent chatter — or steal some. Requires viewers to have spoken since the bot started." side="right" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Surprise drops &amp; steals on recent chatters at random intervals.
              </p>
            </div>
            <Switch
              id="goblin-events"
              checked={settings?.goblinEventsEnabled ?? true}
              disabled={mutation.isPending}
              onCheckedChange={(v) => mutation.mutate({ goblinEventsEnabled: v })}
              data-testid="switch-goblin-events"
            />
          </div>
        </div>

        <div className="rounded-xl border border-purple-500/20 bg-purple-500/5 p-5 space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">✨</span>
                <Label htmlFor="loot-drops" className="text-base font-semibold text-foreground">Special-Item Loot Drops</Label>
                <Hint text="When ON, !loot occasionally drops buff items (Lucky Charm, Goblin Blessing, Horde Magnet, Trickster's Die) instead of plain sellable items. Turn OFF to make !loot only roll regular items." side="right" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Allow buff items (Lucky Charm, Goblin Blessing, etc.) to roll from !loot.
              </p>
            </div>
            <Switch
              id="loot-drops"
              checked={settings?.lootDropsEnabled ?? true}
              disabled={mutation.isPending}
              onCheckedChange={(v) => mutation.mutate({ lootDropsEnabled: v })}
              data-testid="switch-loot-drops"
            />
          </div>
        </div>

        <div className="rounded-xl border border-blue-500/20 bg-blue-500/5 p-5 space-y-1">
          <div className="flex items-start justify-between gap-4">
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <span className="text-lg">🎟️</span>
                <Label htmlFor="coin-redemption" className="text-base font-semibold text-foreground">Coin Redemption</Label>
                <Hint text="When ON, viewers can spend coins for extra giveaway tickets via !redeem (and the dashboard redeem button). Turn OFF to disable both paths." side="right" />
              </div>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                Let viewers spend coins for extra giveaway entries (100 coins = 1 entry).
              </p>
            </div>
            <Switch
              id="coin-redemption"
              checked={settings?.coinRedemptionEnabled ?? true}
              disabled={mutation.isPending}
              onCheckedChange={(v) => mutation.mutate({ coinRedemptionEnabled: v })}
              data-testid="switch-coin-redemption"
            />
          </div>
        </div>

        <CoinCapSection
          value={settings?.coinCap ?? null}
          saving={mutation.isPending}
          onSave={(v) => mutation.mutate({ coinCap: v })}
        />

        <LootDropRatesSection
          value={settings?.lootRarityWeights ?? null}
          saving={mutation.isPending}
          onSave={(v) => mutation.mutate({ lootRarityWeights: v })}
        />

      </section>

      {/* Scheduled Announcements */}
      <section className="space-y-4 max-w-2xl">
        <div className="flex items-center gap-2">
          <span className="text-lg">📢</span>
          <h2 className="text-lg font-semibold text-foreground">Scheduled Announcements</h2>
          <Hint
            text="The bot automatically posts these messages to your Twitch chat at the interval you set. Useful for reminding viewers about !loot, !enter, or your social links."
            side="right"
          />
        </div>
        <AnnouncementsSection />
      </section>

      </TabsContent>

      {/* ============================================================ */}
      {/* THEME TAB                                                    */}
      {/* ============================================================ */}
      <TabsContent value="theme" forceMount className="space-y-8 mt-0 data-[state=inactive]:hidden">

      {/* Theme Selector */}
      <section className="space-y-2 max-w-sm">
        <div className="flex items-center gap-2">
          <Label htmlFor="bot-theme" className="text-lg font-semibold text-foreground">Bot Theme</Label>
          <Hint
            text="Controls the bot's language and personality in chat. CS2 and Hearthstone themes unlock themed loot items, custom bot phrases, and matching giveaway messages. Only commands relevant to the active theme will be available below."
            side="right"
          />
        </div>
        <Select
          value={activeTheme}
          onValueChange={(v) => {
            // Non-goblin themes are gated behind "all-themes" — silently
            // ignore the selection rather than mutate so a downgraded user
            // can't sneak it on. The locked hint next to the label tells them why.
            if (v !== "goblin" && !canAllThemes) return;
            handleThemeSelect(v as BotTheme);
          }}
        >
          <SelectTrigger id="bot-theme" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {THEME_OPTIONS.map((theme) => {
              const locked = theme.id !== "goblin" && !canAllThemes;
              return (
                <SelectItem
                  key={theme.id}
                  value={theme.id}
                  disabled={locked}
                  className={locked ? "opacity-60" : ""}
                >
                  <div className="flex items-center gap-2">
                    <span className="text-base">{theme.emoji}</span>
                    <span>{theme.name}</span>
                    {locked && <LockedHint feature="all-themes" className="ml-1" />}
                  </div>
                </SelectItem>
              );
            })}
          </SelectContent>
        </Select>
        <div className="pt-2">
          <Button
            size="sm"
            className="gap-1.5"
            onClick={handleSave}
            disabled={!hasChanges || !allValid || mutation.isPending}
          >
            {mutation.isPending ? (
              <div className="w-3.5 h-3.5 border-2 border-primary-foreground/40 border-t-primary-foreground rounded-full animate-spin" />
            ) : savedFeedback && themeChanged ? (
              <CheckCircle2 className="w-3.5 h-3.5" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            {themeChanged ? "Apply Theme" : "Apply"}
          </Button>
        </div>
      </section>

      {/* Animated chat preview — updates per theme so streamers can see what
          their chat will look like before committing to a theme change. */}
      <ThemeChatPreview theme={activeTheme} />

      {/* CS2-specific settings (rendered above Chat Commands when CS2 is active) */}
      {isCS2 && (
        <section className="space-y-5 rounded-xl border border-blue-500/20 bg-blue-500/5 p-5">
          <div className="flex items-center gap-2">
            <Crosshair className="w-4 h-4 text-blue-400" />
            <h2 className="text-base font-semibold text-foreground">CS2 Settings</h2>
          </div>

          {/* Steam connection */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold">Steam Account</Label>
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
                  Sign in with your real Steam account. We only store your public SteamID and profile name.
                </p>
              </div>
            )}
          </div>

          {/* How winner skin delivery works */}
          <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Sword className="w-4 h-4 text-blue-400" />
              Winner skin delivery
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              When a viewer wins a skin giveaway, they post their Steam trade URL in chat with{" "}
              <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!tradeurl https://...</span>.
              You then send the skin directly from your inventory using their trade URL — no action required from
              the winner. Track and manage all pending deliveries from the{" "}
              <Link
                href="/trade-office"
                className="text-primary font-semibold underline-offset-2 hover:underline"
                data-testid="link-trade-office"
              >
                Trade Office
              </Link>{" "}
              in the sidebar.
            </p>
          </div>
        </section>
      )}

      {/* Hearthstone-specific info panel */}
      {isHearthstone && (
        <section className="space-y-5 rounded-xl border border-orange-500/20 bg-orange-500/5 p-5">
          <div className="flex items-center gap-2">
            <span className="text-lg">🍺</span>
            <h2 className="text-base font-semibold text-foreground">Hearthstone Tavern Settings</h2>
          </div>

          {/* Loot table preview */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <Label className="text-sm font-semibold">Prize Table</Label>
              <Hint
                text="When viewers type !loot the bot rolls against this table. Rarity odds are the same as every theme — only the prizes change."
                side="right"
              />
            </div>
            <div className="rounded-lg border border-border bg-card/60 divide-y divide-border/60 text-xs">
              {[
                { rarity: "Common", badge: "bg-border/60 text-muted-foreground", prizes: "Coin Token · Wisp · Murloc Raider · Arcane Dust (40) · Basic Card Pack", chance: "50%" },
                { rarity: "Uncommon", badge: "bg-green-500/20 text-green-400", prizes: "Fireball · Polymorph · Arcane Intellect · Rare Card Pack · Arcane Dust (100)", chance: "30%" },
                { rarity: "Rare", badge: "bg-blue-500/20 text-blue-400", prizes: "Doomsayer · Patches the Pirate · Brawl · Epic Card Pack · Arcane Dust (400)", chance: "15%" },
                { rarity: "Epic", badge: "bg-purple-500/20 text-purple-400", prizes: "Ragnaros the Firelord · Sylvanas Windrunner · Deathwing · Ysera the Dreamer", chance: "4%" },
                { rarity: "Legendary", badge: "bg-amber-500/20 text-amber-400", prizes: "✨ Golden Ragnaros · 🌟 Signature Brann Bronzebeard · ✨ Golden Ysera", chance: "1%" },
              ].map(({ rarity, badge, prizes, chance }) => (
                <div key={rarity} className="flex items-start gap-3 px-4 py-2.5">
                  <div className="flex items-center gap-2 w-28 shrink-0">
                    <span className={`text-[10px] font-bold uppercase px-1.5 py-0.5 rounded ${badge}`}>{rarity}</span>
                    <span className="text-[10px] text-muted-foreground font-mono">{chance}</span>
                  </div>
                  <p className="text-muted-foreground leading-relaxed">{prizes}</p>
                </div>
              ))}
            </div>
          </div>

          {/* Theme-specific commands */}
          <div className="rounded-lg border border-border bg-card/60 p-4 space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Terminal className="w-4 h-4 text-orange-400" />
              Tavern Brawl commands
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              Hearthstone mode adds two Innkeeper-flavored commands on top of all the standard ones.{" "}
              <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!innkeeper</span>{" "}
              summons the Innkeeper for a Tavern taunt (alias of <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!goblin</span>).{" "}
              <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!brew</span>{" "}
              offers a refreshment (alias of <span className="font-mono text-foreground/70 bg-muted px-1 rounded">!feed</span>).
              Toggle and customize both in the Chat Commands section below.
            </p>
          </div>
        </section>
      )}

      {/* Commands (collapsible, rendered after theme settings) */}
      <CommandsSection activeTheme={activeTheme} />

      </TabsContent>
      </Tabs>
    </div>
  );
}

// =====================================================================
// Coin cap subsection — local draft so the user can type freely before saving
// =====================================================================

const RARITY_CONFIG: {
  key: keyof RarityWeights;
  label: string;
  emoji: string;
  color: string;
  barColor: string;
}[] = [
  { key: "common",    label: "Common",    emoji: "⚪", color: "text-muted-foreground", barColor: "bg-muted-foreground/60" },
  { key: "uncommon",  label: "Uncommon",  emoji: "🟢", color: "text-green-400",        barColor: "bg-green-400/70" },
  { key: "rare",      label: "Rare",      emoji: "🔵", color: "text-blue-400",         barColor: "bg-blue-400/70" },
  { key: "epic",      label: "Epic",      emoji: "🟣", color: "text-purple-400",       barColor: "bg-purple-400/70" },
  { key: "legendary", label: "Legendary", emoji: "🟡", color: "text-yellow-400",       barColor: "bg-yellow-400/70" },
];

function LootDropRatesSection({
  value,
  saving,
  onSave,
}: {
  value: RarityWeights | null;
  saving: boolean;
  onSave: (v: RarityWeights | null) => void;
}) {
  const saved = value ?? DEFAULT_RARITY_WEIGHTS;
  const [draft, setDraft] = useState<RarityWeights | null>(null);
  const current = draft ?? saved;

  const total = Object.values(current).reduce((s, n) => s + n, 0);
  const pct = (key: keyof RarityWeights) =>
    total > 0 ? ((current[key] / total) * 100).toFixed(1) : "0.0";

  const isModified =
    draft !== null &&
    (Object.keys(DEFAULT_RARITY_WEIGHTS) as (keyof RarityWeights)[]).some(
      (k) => draft[k] !== saved[k],
    );
  const isDefault =
    (Object.keys(DEFAULT_RARITY_WEIGHTS) as (keyof RarityWeights)[]).every(
      (k) => current[k] === DEFAULT_RARITY_WEIGHTS[k],
    );

  function handleChange(key: keyof RarityWeights, raw: string) {
    const n = Math.max(0, Math.floor(Number(raw) || 0));
    setDraft({ ...(draft ?? saved), [key]: n });
  }

  function handleSave() {
    if (!isModified || total === 0) return;
    onSave(isDefault ? null : current);
    setDraft(null);
  }

  function handleReset() {
    setDraft({ ...DEFAULT_RARITY_WEIGHTS });
  }

  return (
    <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-lg">🎲</span>
          <span className="text-base font-semibold text-foreground">Loot Drop Rates</span>
          <Hint
            text="Adjust the relative chance of each rarity appearing when viewers use !loot. Values are weights — they don't need to add up to 100. Reset to restore the defaults."
            side="right"
          />
        </div>
        <Button
          size="sm"
          variant="ghost"
          className="text-xs h-7 px-2 text-muted-foreground hover:text-foreground"
          onClick={handleReset}
          disabled={saving || isDefault}
        >
          Reset to defaults
        </Button>
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed -mt-2">
        Relative weights — higher numbers mean more frequent drops. The actual % shown is calculated from the total.
      </p>
      <div className="space-y-3">
        {RARITY_CONFIG.map(({ key, label, emoji, color, barColor }) => (
          <div key={key} className="flex items-center gap-3">
            <span className="w-24 text-sm font-medium flex items-center gap-1.5 shrink-0">
              <span>{emoji}</span>
              <span className={color}>{label}</span>
            </span>
            <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-300 ${barColor}`}
                style={{ width: `${pct(key)}%` }}
              />
            </div>
            <span className="w-10 text-xs text-right text-muted-foreground tabular-nums shrink-0">
              {pct(key)}%
            </span>
            <Input
              type="number"
              min={0}
              value={current[key]}
              onChange={(e) => handleChange(key, e.target.value)}
              className="w-16 h-7 text-sm text-center px-1 shrink-0"
            />
          </div>
        ))}
      </div>
      <div className="flex gap-2 pt-1">
        <Button
          size="sm"
          disabled={!isModified || total === 0 || saving}
          onClick={handleSave}
          className="gap-1.5"
        >
          <Save className="w-3.5 h-3.5" />
          Save Rates
        </Button>
        {isModified && (
          <Button size="sm" variant="ghost" onClick={() => setDraft(null)} disabled={saving}>
            Discard
          </Button>
        )}
      </div>
    </div>
  );
}

function CoinCapSection({
  value,
  saving,
  onSave,
}: {
  value: number | null;
  saving: boolean;
  onSave: (v: number | null) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const display = draft ?? (value === null ? "" : String(value));
  const trimmed = display.trim();
  const parsed = trimmed === "" ? null : Math.floor(Number(trimmed));
  const valid = trimmed === "" || (Number.isFinite(parsed) && parsed! >= 0);
  const changed = (parsed ?? null) !== value;

  function handleSave() {
    if (!valid || !changed) return;
    onSave(parsed);
    setDraft(null);
  }

  return (
    <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">🪙</span>
        <Label htmlFor="coin-cap" className="text-base font-semibold text-foreground">Coin Balance Cap</Label>
        <Hint
          text="Maximum displayed coin balance per viewer. New earnings still record in the ledger, but !coins, the leaderboard, and redemption checks all clip to this number. Leave blank for no cap."
          side="right"
        />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        Maximum displayed coin balance per viewer. Leave blank for no cap.
      </p>
      <div className="flex gap-2 items-start">
        <Input
          id="coin-cap"
          inputMode="numeric"
          value={display}
          onChange={(e) => setDraft(e.target.value.replace(/[^\d]/g, ""))}
          placeholder="No cap"
          className={`max-w-[200px] ${!valid ? "border-destructive" : ""}`}
          data-testid="input-coin-cap"
        />
        <Button size="sm" disabled={!valid || !changed || saving} onClick={handleSave}>
          <Save className="w-3.5 h-3.5 mr-1" />
          Save
        </Button>
      </div>
    </div>
  );
}

// =====================================================================
// AnnouncementsSection
// =====================================================================

interface Announcement {
  id: number;
  message: string;
  intervalMinutes: number;
  enabled: boolean;
  lastPostedAt: string | null;
}

function useAnnouncements() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<Announcement[]>({
    queryKey: ["announcements"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/announcements", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load announcements");
      return res.json();
    },
  });

  const create = useMutation<Announcement, Error, { message: string; intervalMinutes: number }>({
    mutationFn: async (body) => {
      const token = await getToken();
      const res = await fetch("/api/announcements", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed to create"); }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const patch = useMutation<Announcement, Error, { id: number; patch: Partial<Announcement> }>({
    mutationFn: async ({ id, patch: body }) => {
      const token = await getToken();
      const res = await fetch(`/api/announcements/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      if (!res.ok) { const e = await res.json().catch(() => ({})); throw new Error(e.error ?? "Failed to update"); }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  const remove = useMutation<void, Error, number>({
    mutationFn: async (id) => {
      const token = await getToken();
      const res = await fetch(`/api/announcements/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete");
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["announcements"] }),
  });

  return { query, create, patch, remove };
}

const INTERVAL_OPTIONS = [
  { value: 10,  label: "10 min" },
  { value: 15,  label: "15 min" },
  { value: 20,  label: "20 min" },
  { value: 30,  label: "30 min" },
  { value: 45,  label: "45 min" },
  { value: 60,  label: "1 hour" },
  { value: 90,  label: "1.5 hours" },
  { value: 120, label: "2 hours" },
];

function AnnouncementsSection() {
  const { query, create, patch, remove } = useAnnouncements();
  const [showForm, setShowForm] = useState(false);
  const [msgDraft, setMsgDraft] = useState("");
  const [intervalDraft, setIntervalDraft] = useState(30);

  const rows = query.data ?? [];
  const msgValid = msgDraft.trim().length > 0 && msgDraft.trim().length <= 500;

  async function handleCreate() {
    if (!msgValid) return;
    await create.mutateAsync({ message: msgDraft.trim(), intervalMinutes: intervalDraft });
    setMsgDraft("");
    setIntervalDraft(30);
    setShowForm(false);
  }

  return (
    <div className="space-y-3">
      {query.isLoading ? (
        <div className="rounded-xl border border-border bg-card/40 p-6 text-sm text-muted-foreground animate-pulse">
          Loading announcements…
        </div>
      ) : rows.length === 0 && !showForm ? (
        <div className="rounded-xl border border-dashed border-border bg-card/30 px-5 py-8 text-center space-y-2">
          <p className="text-sm text-muted-foreground">No scheduled announcements yet.</p>
          <p className="text-xs text-muted-foreground/70">Add one and the bot will post it to your Twitch chat on a loop.</p>
        </div>
      ) : (
        <div className="rounded-xl border border-border bg-card/40 divide-y divide-border/60">
          {rows.map((row) => (
            <div key={row.id} className={`flex items-start gap-3 px-4 py-3 ${row.enabled ? "" : "opacity-60"}`}>
              <Switch
                checked={row.enabled}
                onCheckedChange={(v) => patch.mutate({ id: row.id, patch: { enabled: v } })}
                disabled={patch.isPending}
                aria-label="Toggle announcement"
                className="mt-0.5 shrink-0"
              />
              <div className="flex-1 min-w-0 space-y-0.5">
                <p className="text-xs text-foreground leading-relaxed break-words">{row.message}</p>
                <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground">
                  <Clock className="w-3 h-3" />
                  <span>Every {INTERVAL_OPTIONS.find(o => o.value === row.intervalMinutes)?.label ?? `${row.intervalMinutes} min`}</span>
                  {row.lastPostedAt && (
                    <>
                      <span className="opacity-40">·</span>
                      <span>Last posted {new Date(row.lastPostedAt).toLocaleTimeString()}</span>
                    </>
                  )}
                </div>
              </div>
              <Button
                variant="ghost"
                size="icon"
                className="shrink-0 text-muted-foreground hover:text-destructive"
                onClick={() => remove.mutate(row.id)}
                disabled={remove.isPending}
                aria-label="Delete announcement"
              >
                <Trash2 className="w-4 h-4" />
              </Button>
            </div>
          ))}
        </div>
      )}

      {showForm ? (
        <div className="rounded-xl border border-border bg-card/40 p-4 space-y-3">
          <Textarea
            value={msgDraft}
            onChange={(e) => setMsgDraft(e.target.value)}
            placeholder="e.g. Type !loot in chat to roll for a random item! 🎲"
            rows={2}
            maxLength={500}
            className="text-sm resize-none"
            autoFocus
          />
          <div className="flex items-center gap-2 flex-wrap">
            <Select value={String(intervalDraft)} onValueChange={(v) => setIntervalDraft(Number(v))}>
              <SelectTrigger className="w-32 h-8 text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INTERVAL_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={String(o.value)} className="text-xs">
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <span className="text-xs text-muted-foreground">repeat interval</span>
            <div className="flex gap-2 ml-auto">
              <Button size="sm" variant="ghost" onClick={() => { setShowForm(false); setMsgDraft(""); }}>
                Cancel
              </Button>
              <Button size="sm" disabled={!msgValid || create.isPending} onClick={() => void handleCreate()}>
                {create.isPending ? (
                  <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
                ) : (
                  <Plus className="w-3.5 h-3.5 mr-1.5" />
                )}
                Add
              </Button>
            </div>
          </div>
          {create.isError && (
            <p className="text-xs text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {create.error?.message}
            </p>
          )}
        </div>
      ) : (
        <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowForm(true)}>
          <Plus className="w-3.5 h-3.5" /> New announcement
        </Button>
      )}
    </div>
  );
}

/**
 * Discord webhook URL — fires an end-of-giveaway embed if set. We validate
 * the shape client-side (the server applies the same regex) so the streamer
 * gets immediate feedback if they paste a non-webhook URL. Empty string
 * clears the value on the server.
 */
function DiscordWebhookSection({
  value,
  saving,
  onSave,
}: {
  value: string | null;
  saving: boolean;
  onSave: (v: string | null) => void;
}) {
  const { getToken } = useAuth();
  const { toast } = useToast();
  const [draft, setDraft] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const display = draft ?? value ?? "";
  const trimmed = display.trim();
  const isWebhook = /^https:\/\/(?:[a-z]+\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/i.test(trimmed);
  const valid = trimmed === "" || isWebhook;
  const changed = (trimmed === "" ? null : trimmed) !== (value ?? null);
  const savedIsValid = value !== null && /^https:\/\/(?:discord\.com|discordapp\.com)\/api\/webhooks\//.test(value);

  function handleSave() {
    if (!valid || !changed) return;
    onSave(trimmed === "" ? null : trimmed);
    setDraft(null);
  }

  async function handleTest() {
    setTesting(true);
    try {
      const token = await getToken().catch(() => null);
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const r = await fetch("/api/settings/test-webhook", { method: "POST", headers });
      const body = await r.json().catch(() => ({})) as { ok?: boolean; error?: string };
      if (r.ok) {
        toast({ title: "Test sent!", description: "Check your Discord channel for the test embed." });
      } else {
        toast({ title: "Test failed", description: body.error ?? "Something went wrong.", variant: "destructive" });
      }
    } catch {
      toast({ title: "Test failed", description: "Network error — check your connection.", variant: "destructive" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-xl border border-indigo-500/20 bg-indigo-500/5 p-5 space-y-3">
      <div className="flex items-center gap-2">
        <span className="text-lg">💬</span>
        <Label htmlFor="discord-webhook" className="text-base font-semibold text-foreground">Discord Webhook</Label>
        <Hint
          text="Paste a Discord channel webhook URL. When set, every ended giveaway posts a winner embed there. Leave blank to disable."
          side="right"
        />
      </div>
      <p className="text-xs text-muted-foreground leading-relaxed">
        When a giveaway ends, the goblin posts a winner announcement to this Discord channel. Server Settings → Integrations → Webhooks → New Webhook → Copy URL.
      </p>
      <div className="flex flex-wrap gap-2 items-start">
        <Input
          id="discord-webhook"
          type="url"
          value={display}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="https://discord.com/api/webhooks/…"
          className={`flex-1 min-w-[260px] ${!valid ? "border-destructive" : ""}`}
          data-testid="input-discord-webhook"
        />
        <Button size="sm" disabled={!valid || !changed || saving} onClick={handleSave} data-testid="button-save-discord-webhook">
          <Save className="w-3.5 h-3.5 mr-1" />
          Save
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={!savedIsValid || changed || testing}
          onClick={handleTest}
          data-testid="button-test-discord-webhook"
        >
          {testing ? <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" /> : <Send className="w-3.5 h-3.5 mr-1" />}
          Send test
        </Button>
      </div>
      {!valid && (
        <p className="text-xs text-destructive">
          That doesn't look like a Discord webhook URL. It should start with <code>https://discord.com/api/webhooks/</code>.
        </p>
      )}
      {savedIsValid && !changed && (
        <p className="text-xs text-muted-foreground">
          Webhook saved. Use "Send test" to fire a sample embed to your Discord channel.
        </p>
      )}
    </div>
  );
}

// =====================================================================
// Commands section (built-in toggles + custom command CRUD)
// =====================================================================

type CommandTheme = "goblin" | "cs2" | "hearthstone" | "both";

interface BotCommand {
  id?: number;
  name: string;
  description: string;
  responseText?: string;
  enabled: boolean;
  cooldownSeconds: number;
  theme: CommandTheme;
  isCustom: boolean;
  customizable?: boolean;
  availableTokens?: string[];
  defaultResponse?: string | null;
  customResponse?: string | null;
}

function useCommands() {
  const { getToken } = useAuth();
  const qc = useQueryClient();

  const query = useQuery<BotCommand[]>({
    queryKey: ["commands"],
    queryFn: async () => {
      const token = await getToken();
      const res = await fetch("/api/commands", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) throw new Error("Failed to load commands");
      return res.json();
    },
  });

  const toggle = useMutation({
    mutationFn: async (name: string) => {
      const token = await getToken();
      const res = await fetch(`/api/commands/${encodeURIComponent(name.replace(/^!/, ""))}/toggle`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Toggle failed");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }),
  });

  const createCustom = useMutation<
    BotCommand,
    Error,
    { name: string; responseText: string; cooldownSeconds: number; theme: CommandTheme }
  >({
    mutationFn: async (input) => {
      const token = await getToken();
      const res = await fetch("/api/custom-commands", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify(input),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to create command");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }),
  });

  const remove = useMutation({
    mutationFn: async (id: number) => {
      const token = await getToken();
      const res = await fetch(`/api/custom-commands/${id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to delete");
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }),
  });

  const setResponse = useMutation<BotCommand, Error, { name: string; response: string }>({
    mutationFn: async ({ name, response }) => {
      const token = await getToken();
      const res = await fetch(`/api/commands/${encodeURIComponent(name.replace(/^!/, ""))}/response`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ response }),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error ?? "Failed to save response");
      }
      return res.json();
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["commands"] }),
  });

  return { query, toggle, createCustom, remove, setResponse };
}

function CommandsSection({ activeTheme }: { activeTheme: BotTheme }) {
  const { query, toggle, createCustom, remove, setResponse } = useCommands();
  const [showForm, setShowForm] = useState(false);
  const [open, setOpen] = useState(false);

  const visible = (query.data ?? []).filter(
    (c) => c.theme === "both" || c.theme === activeTheme,
  );
  const builtIns = visible.filter((c) => !c.isCustom);
  const generalBuiltIns = builtIns.filter((c) => c.theme === "both");
  const themedBuiltIns = builtIns.filter((c) => c.theme === activeTheme);
  const customs = visible.filter((c) => c.isCustom);
  const totalCount = visible.length;
  const enabledCount = visible.filter((c) => c.enabled).length;
  const themeLabel =
    activeTheme === "cs2" ? "CS2 Arms Deal" :
    activeTheme === "hearthstone" ? "Hearthstone Tavern" :
    "Goblin Horde";

  return (
    <Collapsible open={open} onOpenChange={setOpen} asChild>
      <section className="space-y-3 rounded-xl border border-border bg-card/40 p-4">
        <CollapsibleTrigger
          className="flex w-full items-center justify-between gap-3 group"
          data-testid="toggle-commands-section"
        >
          <div className="flex items-center gap-2 min-w-0">
            <Label className="text-lg font-semibold text-foreground flex items-center gap-2 cursor-pointer">
              <Terminal className="w-4 h-4 text-primary" />
              Chat Commands
            </Label>
            <Hint
              text="Toggle which commands the bot responds to in chat. Only commands relevant to your selected theme are shown. You can also add your own custom commands."
              side="right"
            />
            {!query.isLoading && (
              <span className="text-xs text-muted-foreground font-mono ml-1">
                {enabledCount}/{totalCount} on
              </span>
            )}
          </div>
          <ChevronDown
            className={`w-4 h-4 text-muted-foreground shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </CollapsibleTrigger>

        <CollapsibleContent className="space-y-3 data-[state=closed]:hidden">
      <p className="text-xs text-muted-foreground">
        Showing commands for <span className="text-foreground font-medium">{themeLabel}</span> mode. General commands work in every theme.
      </p>

      {query.isLoading ? (
        <div className="rounded-xl border border-border bg-card/40 p-6 text-sm text-muted-foreground animate-pulse">
          Loading commands…
        </div>
      ) : (
        <>
          {/* General commands (theme-agnostic) */}
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">General Commands</h3>
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground font-mono">always available</span>
              <Hint text="These commands work regardless of which theme is active — coin balance, inventory, giveaway entry, redemption, etc." side="right" />
            </div>
            <div className="rounded-xl border border-border bg-card/40 divide-y divide-border/60">
              {generalBuiltIns.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center">No general commands.</div>
              ) : (
                generalBuiltIns.map((cmd) => (
                  <BuiltInCommandRow
                    key={cmd.name}
                    cmd={cmd}
                    onToggle={() => toggle.mutate(cmd.name)}
                    toggling={toggle.isPending}
                    onSaveResponse={(response) => setResponse.mutateAsync({ name: cmd.name, response })}
                  />
                ))
              )}
            </div>
          </div>

          {/* Theme-specific commands */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">{themeLabel} Commands</h3>
              <span className="text-[10px] uppercase tracking-wide text-primary/70 font-semibold">
                {activeTheme === "cs2" ? "CS2" : activeTheme === "hearthstone" ? "Hearthstone" : "Goblin"}
              </span>
              <Hint text={`Theme-specific flavor commands. These only appear and respond while the ${themeLabel} theme is active.`} side="right" />
            </div>
            <div className="rounded-xl border border-border bg-card/40 divide-y divide-border/60">
              {themedBuiltIns.length === 0 ? (
                <div className="p-6 text-sm text-muted-foreground text-center italic">
                  No {themeLabel}-specific commands.
                </div>
              ) : (
                themedBuiltIns.map((cmd) => (
                  <BuiltInCommandRow
                    key={cmd.name}
                    cmd={cmd}
                    onToggle={() => toggle.mutate(cmd.name)}
                    toggling={toggle.isPending}
                    onSaveResponse={(response) => setResponse.mutateAsync({ name: cmd.name, response })}
                  />
                ))
              )}
            </div>
          </div>
        </>
      )}

      {/* Custom commands */}
      <div className="space-y-2 pt-2">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">Custom Commands</h3>
          {!showForm && (
            <Button size="sm" variant="outline" className="gap-1.5" onClick={() => setShowForm(true)}>
              <Plus className="w-3.5 h-3.5" /> New command
            </Button>
          )}
        </div>

        {showForm && (
          <NewCustomCommandForm
            defaultTheme={activeTheme}
            onCancel={() => setShowForm(false)}
            onSubmit={async (data) => {
              await createCustom.mutateAsync(data);
              setShowForm(false);
            }}
            error={createCustom.isError ? createCustom.error?.message : undefined}
            pending={createCustom.isPending}
          />
        )}

        {customs.length === 0 && !showForm ? (
          <p className="text-xs text-muted-foreground italic">No custom commands yet for this theme.</p>
        ) : (
          <div className="rounded-xl border border-border bg-card/40 divide-y divide-border/60">
            {customs.map((cmd) => (
              <div key={cmd.id} className={`flex items-start justify-between gap-3 px-4 py-3 ${cmd.enabled ? "" : "opacity-60"}`}>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <code className="font-mono font-bold text-sm text-foreground">{cmd.name}</code>
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
                      <Clock className="w-2.5 h-2.5" />
                      {cmd.cooldownSeconds}s
                    </span>
                    {cmd.theme !== "both" && (
                      <span className="text-[10px] uppercase tracking-wide text-primary/70 font-semibold">
                        {cmd.theme === "cs2" ? "CS2" : cmd.theme === "hearthstone" ? "Hearthstone" : "Goblin"}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-snug whitespace-pre-wrap break-words">
                    {cmd.responseText}
                  </p>
                </div>
                <div className="flex items-center gap-2 shrink-0 pt-0.5">
                  <Switch
                    checked={cmd.enabled}
                    onCheckedChange={() => toggle.mutate(cmd.name)}
                    disabled={toggle.isPending}
                    aria-label={`Toggle ${cmd.name}`}
                  />
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    onClick={() => cmd.id && remove.mutate(cmd.id)}
                    disabled={remove.isPending}
                    aria-label={`Delete ${cmd.name}`}
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
        </CollapsibleContent>
      </section>
    </Collapsible>
  );
}

function BuiltInCommandRow({
  cmd,
  onToggle,
  toggling,
  onSaveResponse,
}: {
  cmd: BotCommand;
  onToggle: () => void;
  toggling: boolean;
  onSaveResponse: (response: string) => Promise<unknown>;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(cmd.customResponse ?? "");
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Custom command-response editor is a Premium feature. Free users see
  // the row + the toggle, but the "Customize reply" button swaps to a
  // LockedHint linking to the Rank tab. Server enforces the same gate
  // in `routes/commands.ts`, so curl-only bypass is also blocked.
  const { hasFeature: hasFeat } = useSubscriptionTier();
  const canCustomResponses = hasFeat("custom-responses");

  const customizable = Boolean(cmd.customizable);
  const hasCustom = typeof cmd.customResponse === "string" && cmd.customResponse.length > 0;
  const tokens = cmd.availableTokens ?? [];

  function startEditing() {
    setDraft(cmd.customResponse ?? "");
    setSaveErr(null);
    setEditing(true);
  }

  async function save(value: string) {
    setSaving(true);
    setSaveErr(null);
    try {
      await onSaveResponse(value);
      setEditing(false);
    } catch (e) {
      setSaveErr(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className={`px-4 py-3 ${cmd.enabled ? "" : "opacity-60"}`}>
      <div className="flex items-center justify-between">
        <div className="flex-1 min-w-0 pr-3">
          <div className="flex items-center gap-2 mb-0.5 flex-wrap">
            <code className="font-mono font-bold text-sm text-foreground">{cmd.name}</code>
            <span className="flex items-center gap-1 text-[10px] text-muted-foreground font-mono bg-muted px-1.5 py-0.5 rounded">
              <Clock className="w-2.5 h-2.5" />
              {cmd.cooldownSeconds}s
            </span>
            {hasCustom && (
              <span className="text-[10px] uppercase tracking-wide text-primary font-semibold bg-primary/10 px-1.5 py-0.5 rounded">
                custom reply
              </span>
            )}
          </div>
          <p className="text-xs text-muted-foreground leading-snug">{cmd.description}</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {customizable && !editing && (
            canCustomResponses ? (
              <Button
                variant="ghost"
                size="sm"
                className="text-xs h-7 px-2"
                onClick={startEditing}
                data-testid={`button-edit-response-${cmd.name.replace(/^!/, "")}`}
              >
                {hasCustom ? "Edit reply" : "Customize reply"}
              </Button>
            ) : (
              <LockedHint feature="custom-responses" />
            )
          )}
          <Switch
            checked={cmd.enabled}
            onCheckedChange={onToggle}
            disabled={toggling}
            aria-label={`Toggle ${cmd.name}`}
          />
        </div>
      </div>

      {customizable && editing && (
        <div className="mt-3 rounded-md border border-primary/30 bg-primary/5 p-3 space-y-2">
          <Label htmlFor={`resp-${cmd.name}`} className="text-xs font-semibold">
            Custom reply for <code className="font-mono">{cmd.name}</code>
          </Label>
          <Textarea
            id={`resp-${cmd.name}`}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={cmd.defaultResponse ?? "Your custom chat reply…"}
            maxLength={400}
            rows={2}
            className="text-sm"
          />
          {tokens.length > 0 && (
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[11px] text-muted-foreground">Tokens:</span>
              {tokens.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setDraft((d) => `${d}${d && !d.endsWith(" ") ? " " : ""}{${t}}`)}
                  className="font-mono text-[11px] bg-muted hover:bg-muted/70 text-foreground px-1.5 py-0.5 rounded border border-border"
                >
                  {`{${t}}`}
                </button>
              ))}
            </div>
          )}
          {cmd.defaultResponse && (
            <p className="text-[11px] text-muted-foreground">
              Default: <span className="italic">{cmd.defaultResponse}</span>
            </p>
          )}
          {saveErr && (
            <p className="text-[11px] text-destructive flex items-center gap-1">
              <AlertCircle className="w-3 h-3" /> {saveErr}
            </p>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              disabled={saving || draft.trim().length === 0}
              onClick={() => save(draft.trim())}
            >
              {saving ? "Saving…" : "Save reply"}
            </Button>
            {hasCustom && (
              <Button
                size="sm"
                variant="outline"
                disabled={saving}
                onClick={() => save("")}
              >
                Reset to default
              </Button>
            )}
            <Button size="sm" variant="ghost" disabled={saving} onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function NewCustomCommandForm({
  defaultTheme,
  onSubmit,
  onCancel,
  error,
  pending,
}: {
  defaultTheme: BotTheme;
  onSubmit: (data: { name: string; responseText: string; cooldownSeconds: number; theme: CommandTheme }) => Promise<void>;
  onCancel: () => void;
  error: string | undefined;
  pending: boolean;
}) {
  const [name, setName] = useState("");
  const [responseText, setResponseText] = useState("");
  const [cooldown, setCooldown] = useState(10);
  const [theme, setTheme] = useState<CommandTheme>(
    defaultTheme === "goblin" || defaultTheme === "cs2" ? defaultTheme : "both",
  );

  const trimmedName = name.trim().toLowerCase();
  const nameOk = /^!?[a-z0-9_]{2,32}$/.test(trimmedName);
  const responseOk = responseText.trim().length > 0 && responseText.length <= 400;
  const cooldownOk = Number.isInteger(cooldown) && cooldown >= 0 && cooldown <= 3600;
  const valid = nameOk && responseOk && cooldownOk;

  return (
    <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label htmlFor="cmd-name" className="text-xs">Command name</Label>
          <Input
            id="cmd-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="!discord"
            maxLength={32}
            className="font-mono"
          />
          {!nameOk && name.length > 0 && (
            <p className="text-[11px] text-destructive">Letters, numbers, underscores only (2–32 chars)</p>
          )}
        </div>
        <div className="space-y-1">
          <Label htmlFor="cmd-cooldown" className="text-xs">Cooldown (seconds)</Label>
          <Input
            id="cmd-cooldown"
            type="number"
            min={0}
            max={3600}
            value={cooldown}
            onChange={(e) => setCooldown(Number(e.target.value))}
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cmd-response" className="text-xs">Response message</Label>
        <Textarea
          id="cmd-response"
          value={responseText}
          onChange={(e) => setResponseText(e.target.value)}
          placeholder="Hey {user}, join us at discord.gg/goblin!"
          maxLength={400}
          rows={2}
        />
        <p className="text-[11px] text-muted-foreground">
          Use <code className="font-mono">{"{user}"}</code> to mention the chatter who triggered the command.
        </p>
      </div>

      <div className="space-y-1">
        <Label htmlFor="cmd-theme" className="text-xs">Available in</Label>
        <Select value={theme} onValueChange={(v) => setTheme(v as CommandTheme)}>
          <SelectTrigger id="cmd-theme">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="both">Both themes</SelectItem>
            <SelectItem value="goblin">Goblin Horde only</SelectItem>
            <SelectItem value="cs2">CS2 Arms Deal only</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {error && (
        <p className="text-xs text-destructive flex items-center gap-1">
          <AlertCircle className="w-3 h-3" /> {error}
        </p>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={!valid || pending}
          onClick={() =>
            onSubmit({
              name: trimmedName,
              responseText: responseText.trim(),
              cooldownSeconds: cooldown,
              theme,
            })
          }
        >
          {pending ? "Creating…" : "Create command"}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel} disabled={pending}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

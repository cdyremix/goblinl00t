import tmi from "tmi.js";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, tradeFulfillmentsTable, customCommandsTable, usersTable, scheduledAnnouncementsTable } from "@workspace/db";
import { eq, and, isNotNull, sql } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getRarityEmoji } from "./loot-tables";
import { pickRandom, formatMessage } from "./goblin-phrases";
import { type BotTheme } from "./bot-themes";
import { getChannelTheme, getChannelThemePhrases } from "./channel-theme";
import { getPointsBalance, clampCoinAward, REDEEM_COST_PER_ENTRY, redeemEntriesForUser } from "./points";
import { getChannelSettings } from "./channel-settings";
import { checkGating, type Gateable } from "./gating";
import {
  rollLootDrop,
  addInventoryItem,
  listInventory,
  sellInventoryItem,
  useInventoryItem,
  consumeBuffCharge,
  hasActiveBuff,
  inventoryFullMessage,
  getBuffFlavor,
  INVENTORY_CAP,
  type RolledLoot,
} from "./inventory";
import { startGoblinEvents, setGoblinEventSink, trackChatter } from "./goblin-events";
import { getCustomResponseFor, renderTemplate } from "./command-responses";
import { getToggleFor, getAllToggles } from "./command-toggles";

export type CommandTheme = "goblin" | "cs2" | "hearthstone" | "both";

interface BuiltInCommand {
  description: string;
  cooldownSeconds: number;
  theme: CommandTheme;
  /**
   * If set, this command is an alias for another canonical command. Aliases
   * are NOT listed by /commands (the Spells page) — they share enabled state
   * and cooldown with their canonical and toggle together. The handler block
   * below already routes both names to the same logic.
   */
  aliasOf?: string;
  /**
   * If true, the streamer can override the chat reply via
   * PUT /commands/:name/response. The handler must call
   * `getCustomResponseFor(channel, canonical)` and fall back to the built-in
   * default when null. Templates may reference any token listed in
   * `availableTokens`.
   */
  customizable?: boolean;
  availableTokens?: readonly string[];
  /** Sample/default text shown next to the textarea on the Spells page. */
  defaultResponse?: string;
}

const BUILT_IN_COMMANDS: Record<string, BuiltInCommand> = {
  "!loot":      {
    description: "Roll for a random loot drop — not every roll wins!",
    cooldownSeconds: 30, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "👀 {user} searched but found nothing this time.",
  },
  "!enter":     {
    description: "Enter the active giveaway",
    cooldownSeconds: 5, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "HEHEHE! {user} iz in da pool! *scribbles name*",
  },
  "!giveaway":  {
    description: "Check if a giveaway is running",
    cooldownSeconds: 5, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "🎁 No giveaway running right now!",
  },
  "!inventory": {
    description: "List your loot inventory slots",
    cooldownSeconds: 15, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "🎒 @{user}: Pouch is empty — type !loot to grab something!",
  },
  "!sell":      {
    description: "Sell an inventory item — !sell <slot> or !sell all",
    cooldownSeconds: 5, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "💰 {user} sold their loot!",
  },
  "!use":       {
    description: "Activate a buff item — !use <slot>",
    cooldownSeconds: 5, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "✨ {user} activated a buff!",
  },
  "!help":      {
    description: "Show available commands for the active theme",
    cooldownSeconds: 30, theme: "both",
    customizable: true,
    availableTokens: ["user", "commands", "theme"],
    defaultResponse: "📜 {user}: {commands}",
  },
  "!coins":     {
    description: "Check your coin balance",
    cooldownSeconds: 10, theme: "both",
    customizable: true,
    availableTokens: ["user", "balance", "entries", "cost"],
    defaultResponse: "💰 {user}: {balance}🪙 · !redeem for {entries} extra entries",
  },
  "!redeem":    {
    description: "Spend coins for extra giveaway entries",
    cooldownSeconds: 5, theme: "both",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "🎟️ {user} redeemed coins for extra giveaway entries!",
  },
  "!goblin":    {
    description: "Summon the goblin for a themed taunt",
    cooldownSeconds: 10, theme: "goblin",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "HEHEHE! {user} summoned the goblin!",
  },
  "!steal":     {
    description: "Steal coins from a viewer — !steal @user",
    cooldownSeconds: 20, theme: "goblin",
    customizable: true,
    availableTokens: ["user", "target"],
    defaultResponse: "{user} sneaks up on {target} and runs off with their loot!",
  },
  "!feed":      {
    description: "Feed the goblin a snack",
    cooldownSeconds: 10, theme: "goblin",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "🍖 {user} fed the goblin! YUM!",
  },
  // CS2 flavor aliases — share toggle/cooldown with their goblin canonical.
  "!skin":        { description: "Alias of !goblin (CS2 theme)",         cooldownSeconds: 10, theme: "cs2",         aliasOf: "!goblin" },
  "!scam":        { description: "Alias of !steal (CS2 theme)",          cooldownSeconds: 20, theme: "cs2",         aliasOf: "!steal"  },
  "!case":        { description: "Alias of !feed (CS2 theme)",           cooldownSeconds: 10, theme: "cs2",         aliasOf: "!feed"   },
  // Hearthstone flavor aliases — same pattern, point back to goblin canonicals.
  "!innkeeper":   { description: "Summon the Innkeeper (Hearthstone)",   cooldownSeconds: 10, theme: "hearthstone", aliasOf: "!goblin" },
  "!brew":        { description: "Offer the Innkeeper a brew (Hearthstone)", cooldownSeconds: 10, theme: "hearthstone", aliasOf: "!feed" },
  "!tradeurl":  {
    description: "Submit your Steam trade URL after winning a skin",
    cooldownSeconds: 10, theme: "cs2",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "✅ {user}: Trade URL saved! The streamer will send your skin soon 🎁",
  },
  "!top": {
    description: "Show the top 5 coin holders in this channel",
    cooldownSeconds: 60, theme: "both",
  },
  "!gift": {
    description: "Gift coins to another viewer — !gift <@username> <amount>",
    cooldownSeconds: 15, theme: "both",
  },
};

/** Build the !help reply: short, theme-aware command list. Channel-scoped
 *  so per-streamer disabled commands don't show up in another channel's reply. */
// Short per-command descriptions shown in the !help response.
const HELP_DESCRIPTIONS: Record<string, string> = {
  "!loot":      "grab a random item",
  "!inventory": "see your items",
  "!sell":      "sell <slot> or all",
  "!use":       "activate a buff",
  "!enter":     "join the giveaway",
  "!giveaway":  "giveaway status",
  "!redeem":    "coins → entries",
  "!coins":     "coin balance",
  "!steal":     "steal coins @user",
  "!goblin":    "summon the goblin",
  "!skin":      "summon the bot",
  "!innkeeper": "summon the Innkeeper",
  "!brew":      "offer a brew",
  "!feed":      "feed the goblin",
  "!case":      "open a case",
  "!tradeurl":  "submit trade URL",
  "!top":       "top 5 coin holders",
  "!gift":      "gift coins @user amount",
};

async function buildHelpCommandList(channel: string, activeTheme: BotTheme): Promise<string> {
  const toggles = await getAllToggles(channel);
  const entries = Object.entries(BUILT_IN_COMMANDS)
    .filter(([name, meta]) => {
      if (meta.aliasOf) return false;
      if (meta.theme !== "both" && meta.theme !== activeTheme) return false;
      return typeof toggles[name] === "boolean" ? toggles[name]! : true;
    })
    .map(([name]) => {
      const desc = HELP_DESCRIPTIONS[name];
      return desc ? `${name} (${desc})` : name;
    });
  return entries.join(" · ");
}

/** Reverse map canonical → aliases. */
const COMMAND_ALIASES: Record<string, string[]> = {};
for (const [name, meta] of Object.entries(BUILT_IN_COMMANDS)) {
  if (meta.aliasOf) {
    (COMMAND_ALIASES[meta.aliasOf] ??= []).push(name);
  }
}

interface CustomCommandCacheEntry {
  id: number;
  userId: number;
  responseText: string;
  cooldownSeconds: number;
  enabled: boolean;
  theme: CommandTheme;
}
/**
 * Custom-command lookup cache, RE-KEYED by channel for multi-tenant safety.
 * Outer map: lowercase channel (== owner's `usersTable.twitchUsername`).
 * Inner map: lowercase command name → entry.
 *
 * Bot chat-handler reads via `CUSTOM_COMMANDS.get(channel)?.get(name)` so a
 * custom command created by streamer A can ONLY fire in streamer A's channel
 * — never in streamer B's. The legacy flat map merged every streamer's
 * customs into one global keyspace, which would have leaked cross-channel
 * the moment a second streamer signed up.
 */
const CUSTOM_COMMANDS = new Map<string, Map<string, CustomCommandCacheEntry>>();

export async function reloadCustomCommands(): Promise<void> {
  try {
    // Join customCommandsTable → usersTable so each row carries its
    // owner's `twitchUsername`, which is the channel key for the bot
    // chat handler. Rows whose owner hasn't linked Twitch yet are
    // skipped — their custom commands cannot fire on any channel until
    // the link completes (and a subsequent reload picks them up).
    const rows = await db
      .select({
        id: customCommandsTable.id,
        userId: customCommandsTable.userId,
        name: customCommandsTable.name,
        responseText: customCommandsTable.responseText,
        cooldownSeconds: customCommandsTable.cooldownSeconds,
        enabled: customCommandsTable.enabled,
        theme: customCommandsTable.theme,
        twitchUsername: usersTable.twitchUsername,
      })
      .from(customCommandsTable)
      .innerJoin(usersTable, eq(customCommandsTable.userId, usersTable.id));
    // Build the next snapshot fully before mutating the live cache so that
    // in-flight chat messages don't see a transiently-empty map.
    const next = new Map<string, Map<string, CustomCommandCacheEntry>>();
    for (const row of rows) {
      const ch = row.twitchUsername?.trim().toLowerCase();
      if (!ch) continue;
      let perChannel = next.get(ch);
      if (!perChannel) { perChannel = new Map(); next.set(ch, perChannel); }
      perChannel.set(row.name.toLowerCase(), {
        id: row.id,
        userId: row.userId,
        responseText: row.responseText,
        cooldownSeconds: row.cooldownSeconds,
        enabled: row.enabled,
        theme: row.theme as CommandTheme,
      });
    }
    CUSTOM_COMMANDS.clear();
    for (const [ch, m] of next) CUSTOM_COMMANDS.set(ch, m);
  } catch (err) {
    logger.error({ err }, "Failed to load custom commands");
  }
}

export interface BotState {
  connected: boolean;
  /**
   * Primary/legacy channel — kept for back-compat with the single-tenant
   * dashboard surface (`/api/bot/status` consumers and admin readouts).
   * Resolved from `TWITCH_CHANNEL` env or the first joined channel.
   */
  channel: string;
  /**
   * Full list of currently-joined channels. The bot now multi-joins —
   * one entry per linked streamer's `twitchUsername`. Mutated by
   * `joinChannel` / `partChannel` so the dashboard can reflect live
   * membership without a restart.
   */
  channels: string[];
  username: string;
  startedAt: Date | null;
  lastMessageAt: Date | null;
}

// ── Live-chat ring buffer ────────────────────────────────────────────────────

export interface ChatMessage {
  username: string;
  display: string;
  message: string;
  color: string | null;
  isBot: boolean;
  timestamp: string;
}

const CHAT_RING = new Map<string, ChatMessage[]>();
const RING_MAX = 75;

export function pushChatMessage(channel: string, msg: ChatMessage): void {
  const arr = CHAT_RING.get(channel) ?? [];
  arr.push(msg);
  if (arr.length > RING_MAX) arr.splice(0, arr.length - RING_MAX);
  CHAT_RING.set(channel, arr);
}

export function getRecentChatMessages(channel: string, limit = 50): ChatMessage[] {
  const arr = CHAT_RING.get(channel) ?? [];
  return arr.slice(-limit);
}

const COMMAND_COOLDOWNS = new Map<string, Map<string, number>>();

/**
 * Short-term dedup cache for Twitch message IDs. tmi.js assigns each chat
 * message a UUID via `tags.id`; if the same ID arrives twice within the TTL
 * (stale client, tmi.js reconnect, etc.) we silently drop the duplicate.
 * Entries are pruned when the set grows large enough to avoid a memory leak.
 */
const SEEN_MESSAGE_IDS = new Set<string>();
const SEEN_MESSAGE_TTL_MS = 10_000;
function markSeen(id: string): boolean {
  if (SEEN_MESSAGE_IDS.has(id)) return true; // duplicate
  SEEN_MESSAGE_IDS.add(id);
  // Evict after TTL — fire-and-forget, no timer leak risk.
  setTimeout(() => SEEN_MESSAGE_IDS.delete(id), SEEN_MESSAGE_TTL_MS);
  return false;
}

const COMMAND_COOLDOWN_SECONDS: Record<string, number> = Object.fromEntries(
  Object.entries(BUILT_IN_COMMANDS).map(([k, v]) => [k, v.cooldownSeconds])
);

// NOTE: per-channel on/off state for built-in commands lives in
// `usersTable.commandToggles` (jsonb) and is read at request time via
// `getToggleFor(channel, canonical, true)` from `bot/command-toggles.ts`.
// The legacy module-global `COMMAND_ENABLED` map was removed because it
// silently shared on/off state across every streamer the bot served.

let client: tmi.Client | null = null;
/**
 * Incremented every time startBot() creates a new tmi.Client. The message
 * handler captures this value at registration time and bails out if the
 * module-level counter has moved on — i.e. the old client survived a failed
 * disconnect() and is still delivering messages alongside the new one.
 * Without this guard every chat command fires twice after a bot restart
 * because both the stale and the fresh client call handleMessage().
 */
let clientGeneration = 0;

let botState: BotState = {
  connected: false,
  channel: process.env["TWITCH_CHANNEL"] ?? "goblinl00t",
  channels: [],
  username: process.env["TWITCH_BOT_USERNAME"] ?? "GoblinL00tBot",
  startedAt: null,
  lastMessageAt: null,
};

function isOnCooldown(channel: string, username: string, command: string): boolean {
  const key = `${channel}:${username}:${command}`;
  const now = Date.now();
  const cooldownMs = (COMMAND_COOLDOWN_SECONDS[command] ?? 10) * 1000;
  const lastUsed = COMMAND_COOLDOWNS.get(command)?.get(key) ?? 0;
  return now - lastUsed < cooldownMs;
}

function setCooldown(channel: string, username: string, command: string): void {
  if (!COMMAND_COOLDOWNS.has(command)) {
    COMMAND_COOLDOWNS.set(command, new Map());
  }
  const key = `${channel}:${username}:${command}`;
  COMMAND_COOLDOWNS.get(command)!.set(key, Date.now());
}

async function logCommand(command: string, username: string, channel: string) {
  try {
    await db.insert(commandLogsTable).values({ command, username, channel });
  } catch (err) {
    logger.error({ err }, "Failed to log command");
  }
}

/**
 * Send a direct reply to the viewer who typed the command.
 *
 * Tries `client.whisper()` first so the response is private; if tmi.js
 * rejects the whisper (the bot account isn't verified, rate-limited, etc.)
 * it falls back to a normal public `say()` so the message is never lost.
 *
 * NOTE: Twitch has restricted bot whispers since 2023. Unverified bot
 * accounts will commonly hit failures — the fallback ensures chat still
 * works regardless.
 */
async function replyToUser(channel: string, username: string, message: string): Promise<void> {
  if (!client) return;
  try {
    await client.whisper(username, message);
  } catch {
    // Whisper failed (not verified, rate-limited, etc.) — fall back to chat.
    try { await client.say(channel, message); } catch (fallbackErr) {
      logger.warn({ err: fallbackErr, username, channel }, "replyToUser: both whisper and say failed");
    }
  }
}

async function handleMessage(channel: string, tags: tmi.ChatUserstate, message: string) {
  // Deduplicate every incoming message. Use the Twitch message UUID when
  // available; fall back to a content fingerprint so the guard still fires
  // even if this tmi.js build doesn't surface tags.id. The `if (msgId &&…)`
  // form was silently skipping the check when id was undefined — replaced
  // with an unconditional markSeen call using a reliable key.
  const dedupKey =
    tags["id"] ??
    `${channel}:${(tags.username ?? "").toLowerCase()}:${message.trim()}`;
  if (markSeen(dedupKey)) return;

  const username = (tags.username ?? tags["display-name"] ?? "unknown").toLowerCase();
  trackChatter(channel, username);
  const msg = message.trim();
  const parts = msg.split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (!command || !command.startsWith("!")) return;

  // Blacklist check — silently ignore any command from a blocked username.
  const channelKey = channel.replace(/^#/, "").toLowerCase();
  {
    const blSettings = await getChannelSettings(channelKey);
    if (blSettings.botBlacklist.includes(username)) return;
  }
  // Theme is per-channel (read from `usersTable.botTheme` for the
  // channel's owner). Resolved once per message and threaded into every
  // handler that branches on theme — replaces the previous module-global
  // `getActiveTheme()` which would have leaked one streamer's theme
  // selection into every other channel the bot serves.
  const channelTheme = await getChannelTheme(channelKey);
  const channelCustoms = CUSTOM_COMMANDS.get(channelKey);
  const custom = channelCustoms?.get(command);
  if (custom) {
    if (!custom.enabled) return;
    if (isOnCooldown(channel, username, command)) return;
    setCooldown(channel, username, command);
    void logCommand(command, username, channel);
    botState.lastMessageAt = new Date();
    const reply = custom.responseText.replace(/\{user\}/gi, `@${username}`);
    if (client) {
      void replyToUser(channel, username, reply);
    }
    return;
  }

  // Built-in dispatch + per-channel enable/disable check. Resolving to the
  // canonical name first so aliases share the toggle with their canonical.
  if (!(command in BUILT_IN_COMMANDS)) return;
  const canonical = BUILT_IN_COMMANDS[command]?.aliasOf ?? command;

  // Theme runtime gate: goblin-only commands don't fire on CS2 channels
  // and vice versa. Currently only affects `buildHelpCommandList` — this
  // check ensures the handler itself is also silenced on the wrong theme.
  const cmdTheme = BUILT_IN_COMMANDS[canonical]?.theme;
  if (cmdTheme && cmdTheme !== "both" && cmdTheme !== channelTheme) return;

  const enabled = await getToggleFor(channelKey, canonical, true);
  if (!enabled) return;
  if (isOnCooldown(channel, username, command)) return;

  setCooldown(channel, username, command);
  void logCommand(command, username, channel);
  botState.lastMessageAt = new Date();

  const phrases = await getChannelThemePhrases(channelKey);

  try {
    if (command === "!loot") {
      const ch = channel.replace(/^#/, "");
      const luckActive = await hasActiveBuff(ch, username, "luck");

      // ~25% miss chance — luck buff bypasses the miss. Keeps the economy
      // from inflating too fast and gives the luck buff a meaningful upside.
      const LOOT_MISS_CHANCE = 0.25;
      if (!luckActive && Math.random() < LOOT_MISS_CHANCE) {
        const customMiss = await getCustomResponseFor(ch, "!loot");
        const missMsg = customMiss
          ? renderTemplate(customMiss, { user: `@${username}` })
          : formatMessage(pickRandom(phrases.lootMiss), { user: `@${username}` });
        void replyToUser(channel, username, missMsg);
        return;
      }

      const settings = await getChannelSettings(ch);
      const loot = rollLootDrop({
        luckBuffActive: luckActive,
        allowBuffs: settings.lootDropsEnabled,
        theme: channelTheme,
        weights: settings.lootRarityWeights ?? undefined,
      });
      // Charge consumption is atomic with the insert — a "full" result will
      // not burn the buff (see addInventoryItem).
      const result = await addInventoryItem(ch, username, loot, {
        consumeLuckOnSuccess: luckActive,
      });
      const emoji = getRarityEmoji(loot.rarity);
      const flavor = pickRandom(phrases.lootResponses[loot.rarity]);

      if (!result.ok) {
        void replyToUser(channel, username, inventoryFullMessage(username));
        return;
      }

      // Mirror to loot_drops as activity log (coins=0; coins are credited only on !sell).
      await db.insert(lootDropsTable).values({
        channel: ch, username, item: loot.item, rarity: loot.rarity, points: 0,
      });

      const slotTag = `[${result.slot}/${INVENTORY_CAP}]`;
      if (loot.kind === "buff") {
        void replyToUser(
          channel,
          username,
          `${emoji} @${username} found [BUFF] ${loot.item}! ${slotTag} · ${loot.flavor} · !use ${result.slot} (${loot.charges}×) · !sell ${result.slot} for ${loot.coinValue}🪙`
        );
      } else {
        void replyToUser(
          channel,
          username,
          `${emoji} @${username} snagged [${loot.rarity.toUpperCase()}] ${loot.item}! ${slotTag} · !sell ${result.slot} for ${loot.coinValue}🪙 · ${flavor}`
        );
      }
    }

    if (command === "!inventory") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      if (items.length === 0) {
        void replyToUser(channel, username, `🎒 @${username}: Pouch is empty — type !loot to grab something!`);
      } else {
        const lines = items.map((it, i) => {
          const e = getRarityEmoji(it.rarity);
          if (it.kind === "buff") {
            const flavor = getBuffFlavor(it.item);
            const active = it.isActive ? "ACTIVE · " : "";
            const desc = flavor ? ` (${flavor})` : "";
            return `[${i + 1}]${e}${it.item}${desc} BUFF [${active}${it.chargesRemaining}× left] · !use ${i + 1} · !sell ${i + 1} for ${it.coinValue}🪙`;
          }
          return `[${i + 1}]${e}${it.item} ${it.coinValue}🪙 · !sell ${i + 1}`;
        });
        void replyToUser(channel, username, `🎒 @${username} [${items.length}/${INVENTORY_CAP}]: ${lines.join(" · ")}`);
      }
    }

    if (command === "!sell") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      if (items.length === 0) {
        void replyToUser(channel, username, `🎒 @${username}: Nothing to sell — pouch is empty!`);
        return;
      }
      const arg = (parts[1] ?? "").toLowerCase();
      let totalCoins = 0;
      let soldCount = 0;
      let targetItems: typeof items = [];
      if (arg === "all") {
        targetItems = items.filter((i) => i.kind === "item");
        if (targetItems.length === 0) {
          void replyToUser(channel, username, `🧪 @${username}: All items are buffs — !use <slot> to activate or !sell <slot> to dump one.`);
          return;
        }
      } else {
        const slot = Number.parseInt(arg, 10);
        if (!Number.isFinite(slot) || slot < 1 || slot > items.length) {
          void replyToUser(channel, username, `@${username}: !sell 1–${items.length} or !sell all`);
          return;
        }
        targetItems = [items[slot - 1]!];
      }
      const soldNames: string[] = [];
      for (const it of targetItems) {
        const r = await sellInventoryItem({ channel: ch, username, itemId: it.id });
        if (r.ok && r.coinsEarned !== undefined) {
          totalCoins += r.coinsEarned;
          soldCount += 1;
          soldNames.push(it.item);
        }
      }
      if (soldCount === 0) {
        void replyToUser(channel, username, `@${username}: Sale failed — check !inventory and retry.`);
        return;
      }
      const summary = soldCount === 1 ? soldNames[0] : `${soldCount} items`;
      void replyToUser(channel, username, `💰 @${username} sold ${summary} for ${totalCoins}🪙!`);
    }

    if (command === "!use") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      const slot = Number.parseInt(parts[1] ?? "", 10);
      if (!Number.isFinite(slot) || slot < 1 || slot > items.length) {
        void replyToUser(channel, username, `@${username}: !use 1–${items.length || INVENTORY_CAP} — buffs only.`);
        return;
      }
      const target = items[slot - 1]!;
      const r = await useInventoryItem({ channel: ch, username, itemId: target.id });
      if (!r.ok) {
        if (r.reason === "not_buff") {
          void replyToUser(channel, username, `@${username}: ${target.item} isn't a buff — !sell ${slot} for ${target.coinValue}🪙 instead.`);
        } else {
          void replyToUser(channel, username, `@${username}: Couldn't activate that item.`);
        }
        return;
      }
      const charges = r.item!.chargesRemaining;
      void replyToUser(channel, username, `✨ @${username} activated ${r.item!.item}! (${charges} charge${charges === 1 ? "" : "s"} left)`);
    }

    if (command === "!enter") {
      // Scope to the chat channel so a `!enter` in streamer A's chat can't
      // accidentally bind to streamer B's active giveaway when both are
      // running concurrently in the multi-tenant DB.
      const chForGiveaway = channel.replace(/^#/, "").toLowerCase();
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.status, "pending"), eq(giveawaysTable.channel, chForGiveaway)))
        .limit(1);

      if (!active) {
        // Check if there's an active (wheel-spinning) giveaway — give a better message.
        const [spinning] = await db
          .select({ id: giveawaysTable.id })
          .from(giveawaysTable)
          .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, chForGiveaway)))
          .limit(1);
        if (spinning) {
          void replyToUser(channel, username, `@${username}: The giveaway has started — entries are now closed! 🎡`);
        } else {
          void replyToUser(channel, username, phrases.enterNoGiveaway(username));
        }
        return;
      }

      const keyword = active.keyword ?? "!enter";
      if (command !== keyword.toLowerCase()) return;

      const gate = await checkGating(active as Gateable, tags, channel);
      if (!gate.allowed) {
        void replyToUser(channel, username, gate.reason ?? `@${username}: You're not eligible to enter.`);
        return;
      }

      const [existing] = await db
        .select()
        .from(giveawayEntriesTable)
        .where(
          and(
            eq(giveawayEntriesTable.giveawayId, active.id),
            eq(giveawayEntriesTable.username, username)
          )
        )
        .limit(1);

      if (existing) {
        void replyToUser(channel, username, phrases.enterAlreadyIn(username));
        return;
      }

      const ch = channel.replace(/^#/, "");
      let tickets = 1;
      const ticketsBuff = await hasActiveBuff(ch, username, "tickets");

      // Insert first; only consume the ticket buff once the entry actually lands.
      const inserted = await db
        .insert(giveawayEntriesTable)
        .values({
          giveawayId: active.id,
          username,
          tickets: ticketsBuff ? 2 : 1,
        })
        .onConflictDoNothing({ target: [giveawayEntriesTable.giveawayId, giveawayEntriesTable.username] })
        .returning({ id: giveawayEntriesTable.id });

      if (inserted.length === 0) {
        // Concurrent insert won the race — treat as "already in", do not burn buff.
        void replyToUser(channel, username, phrases.enterAlreadyIn(username));
        return;
      }

      if (ticketsBuff && (await consumeBuffCharge(ch, username, "tickets"))) {
        tickets = 2;
      }

      const phrase = formatMessage(pickRandom(phrases.enterResponses), { user: username });
      const suffix = tickets > 1 ? ` 🧲 +1 bonus ticket!` : "";
      void replyToUser(channel, username, `${phrase}${suffix}`);
    }

    if (command === "!help") {
      const ch = channel.replace(/^#/, "");
      const list = await buildHelpCommandList(ch, channelTheme);
      const custom = await getCustomResponseFor(ch, "!help");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, commands: list, theme: channelTheme })
        : `📜 @${username}: ${list}`;
      void replyToUser(channel, username, reply);
    }

    if (command === "!goblin" || command === "!skin") {
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!goblin");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}` })
        : pickRandom(phrases.goblinResponses);
      void replyToUser(channel, username, reply);
    }

    if (command === "!steal" || command === "!scam") {
      const target = parts[1]?.replace("@", "") ?? null;
      if (!target) {
        void replyToUser(channel, username, phrases.stealNoTarget);
        return;
      }
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!steal");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, target })
        : formatMessage(pickRandom(phrases.stealResponses), { target });
      void replyToUser(channel, username, reply);
    }

    if (command === "!feed" || command === "!case") {
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!feed");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}` })
        : pickRandom(phrases.feedResponses);
      void replyToUser(channel, username, reply);
    }

    if (command === "!tradeurl") {
      const tradeUrl = parts[1] ?? null;
      const isValidTradeUrl = (() => {
        if (!tradeUrl) return false;
        try {
          const u = new URL(tradeUrl);
          return (
            (u.hostname === "steamcommunity.com" || u.hostname === "www.steamcommunity.com") &&
            u.pathname.startsWith("/tradeoffer/new") &&
            u.searchParams.has("partner") &&
            u.searchParams.has("token")
          );
        } catch { return false; }
      })();
      if (!isValidTradeUrl) {
        void replyToUser(channel, username, `@${username}: !tradeurl <Steam trade URL> — find yours at steamcommunity.com/id/YOU/tradeoffers/privacy`);
        return;
      }
      const [pending] = await db
        .select()
        .from(tradeFulfillmentsTable)
        .where(
          and(
            eq(tradeFulfillmentsTable.winnerTwitchUsername, username),
            eq(tradeFulfillmentsTable.status, "pending")
          )
        )
        .limit(1);

      if (!pending) {
        void replyToUser(channel, username, `@${username}: No pending win found — contact the streamer if this seems wrong.`);
        return;
      }
      await db
        .update(tradeFulfillmentsTable)
        .set({ steamTradeUrl: tradeUrl })
        .where(eq(tradeFulfillmentsTable.id, pending.id));
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!tradeurl");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}` })
        : `✅ @${username}: Trade URL saved! The streamer will send your skin soon 🎁`;
      void replyToUser(channel, username, reply);
    }

    if (command === "!coins") {
      const ch = channel.replace(/^#/, "");
      const { balance } = await getPointsBalance(username, ch);
      const entries = Math.floor(balance / REDEEM_COST_PER_ENTRY);
      const custom = await getCustomResponseFor(ch, "!coins");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, balance, entries, cost: REDEEM_COST_PER_ENTRY })
        : `💰 @${username}: ${balance}🪙 · ${entries > 0 ? `!redeem for ${entries} extra ${entries === 1 ? "entry" : "entries"}` : `earn more by chatting!`}`;
      void replyToUser(channel, username, reply);
    }

    if (command === "!redeem") {
      const ch = channel.replace(/^#/, "");
      const settings = await getChannelSettings(ch);
      if (!settings.coinRedemptionEnabled) {
        void replyToUser(channel, username, `🎟️ @${username}: Coin redemption is off right now.`);
        return;
      }

      const action = settings.redeemAction ?? "entries";

      // ── Loot Roll mode ──────────────────────────────────────────────────────
      if (action === "loot") {
        const COST = 200;
        const { balance } = await getPointsBalance(username, ch);
        if (balance < COST) {
          void replyToUser(channel, username, `🎲 @${username}: Need ${COST}🪙 to redeem a loot roll — you have ${balance}🪙.`);
          return;
        }
        const loot = rollLootDrop({
          luckBuffActive: false,
          allowBuffs: settings.lootDropsEnabled,
          theme: channelTheme,
          weights: settings.lootRarityWeights ?? undefined,
        });
        const addResult = await addInventoryItem(ch, username, loot, { consumeLuckOnSuccess: false });
        if (!addResult.ok) {
          void replyToUser(channel, username, inventoryFullMessage(username));
          return;
        }
        await db.insert(lootDropsTable).values({ channel: ch, username, item: "!redeem (loot roll)", rarity: "common", points: -COST });
        await db.insert(lootDropsTable).values({ channel: ch, username, item: loot.item, rarity: loot.rarity, points: 0 });
        const emoji = getRarityEmoji(loot.rarity);
        const slotTag = `[${addResult.slot}/${INVENTORY_CAP}]`;
        if (loot.kind === "buff") {
          void replyToUser(channel, username, `🎲 @${username} spent ${COST}🪙 for a loot roll — 🍀[BUFF] ${loot.item}! ${slotTag} · ${loot.flavor} · !use ${addResult.slot}`);
        } else {
          const flavor = pickRandom(phrases.lootResponses[loot.rarity]);
          void replyToUser(channel, username, `🎲 @${username} spent ${COST}🪙 for a loot roll — ${emoji}[${loot.rarity.toUpperCase()}] ${loot.item}! ${slotTag} · !sell ${addResult.slot} for ${loot.coinValue}🪙 · ${flavor}`);
        }
        return;
      }

      // ── Luck Buff mode ──────────────────────────────────────────────────────
      if (action === "luck") {
        const COST = 300;
        const { balance } = await getPointsBalance(username, ch);
        if (balance < COST) {
          void replyToUser(channel, username, `🍀 @${username}: Need ${COST}🪙 for a Lucky Charm — you have ${balance}🪙.`);
          return;
        }
        const luckyCharm: RolledLoot = {
          item: "Lucky Charm",
          rarity: "uncommon",
          kind: "buff",
          buffEffect: "luck",
          coinValue: 50,
          charges: 5,
          flavor: "+25% chance to upgrade your next loot rolls",
        };
        const addResult = await addInventoryItem(ch, username, luckyCharm, { consumeLuckOnSuccess: false });
        if (!addResult.ok) {
          void replyToUser(channel, username, inventoryFullMessage(username));
          return;
        }
        await db.insert(lootDropsTable).values({ channel: ch, username, item: "!redeem (lucky charm)", rarity: "common", points: -COST });
        void replyToUser(channel, username, `🍀 @${username} spent ${COST}🪙 — Lucky Charm in slot [${addResult.slot}/${INVENTORY_CAP}]! · !use ${addResult.slot} to activate · Boosts next 5 loot rolls.`);
        return;
      }

      // ── Entries mode (default) ───────────────────────────────────────────────
      const requested = Math.max(1, Math.floor(Number(parts[1] ?? 1)));
      // Channel-scope so coins earned in this channel are only spent into
      // this channel's giveaway (matches the channel-scoped balance read
      // inside `redeemEntriesForUser`).
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, ch)))
        .limit(1);
      if (!active) {
        void replyToUser(channel, username, `🎟️ @${username}: No active giveaway to redeem into.`);
        return;
      }

      // Gate redemption the same as a normal !enter (cheap fail-fast before the txn).
      const gate = await checkGating(active as Gateable, tags, channel);
      if (!gate.allowed) {
        void replyToUser(channel, username, gate.reason ?? `@${username}: You're not eligible to redeem.`);
        return;
      }

      const result = await redeemEntriesForUser({
        giveawayId: active.id,
        username,
        entries: requested,
      });
      if (!result.ok) {
        if (result.code === "insufficient" && typeof result.balance === "number") {
          const affordable = Math.floor(result.balance / REDEEM_COST_PER_ENTRY);
          void replyToUser(channel, username, `🎟️ @${username}: Not enough coins — you can afford ${affordable} extra ${affordable === 1 ? "entry" : "entries"} right now.`);
        } else {
          void replyToUser(channel, username, `@${username}: ${result.message}`);
        }
        return;
      }

      void replyToUser(channel, username, `🎟️ @${username} spent ${result.pointsSpent}🪙 for ${result.ticketsAdded} extra ${result.ticketsAdded === 1 ? "entry" : "entries"}! Balance: ${result.balanceAfter}🪙`);
    }

    if (command === "!giveaway") {
      const ch = channel.replace(/^#/, "").toLowerCase();
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, ch)))
        .limit(1);

      if (active) {
        const entries = await db
          .select()
          .from(giveawayEntriesTable)
          .where(eq(giveawayEntriesTable.giveawayId, active.id));

        void replyToUser(
          channel,
          username,
          `🎁 GIVEAWAY: ${active.prize} · ${entries.length} ${entries.length === 1 ? "entry" : "entries"} · Type ${active.keyword} to join!`
        );
      } else {
        void replyToUser(channel, username, phrases.giveawayNone);
      }
    }

    if (command === "!top") {
      const ch = channel.replace(/^#/, "").toLowerCase();
      try {
        const rows = await db.execute(sql`
          SELECT u.username,
            COALESCE((SELECT SUM(ld.points) FROM loot_drops ld WHERE ld.username = u.username AND ld.channel = ${ch}), 0)
            - COALESCE((SELECT SUM(pr.points_spent) FROM point_redemptions pr WHERE pr.username = u.username AND pr.channel = ${ch}), 0)
            AS balance
          FROM (SELECT DISTINCT username FROM loot_drops WHERE channel = ${ch}) u
          ORDER BY balance DESC
          LIMIT 5
        `);
        if (!(rows.rows as unknown[]).length) {
          void replyToUser(channel, username, `🏆 No coin holders yet in #${ch}!`);
          return;
        }
        const medals = ["🥇", "🥈", "🥉", "4️⃣", "5️⃣"];
        const list = (rows.rows as Array<{ username: string; balance: string | number }>)
          .map((r, i) => `${medals[i] ?? String(i + 1)} ${r.username}: ${Number(r.balance)}🪙`)
          .join(" · ");
        void replyToUser(channel, username, `🏆 Top Coin Holders: ${list}`);
      } catch (topErr) {
        logger.error({ err: topErr }, "Error in !top command");
      }
    }

    if (command === "!gift") {
      const ch = channel.replace(/^#/, "").toLowerCase();
      const rawTarget = (parts[1] ?? "").replace(/^@/, "").toLowerCase();
      const amount = Math.floor(Number(parts[2] ?? "0"));

      if (!rawTarget || !amount || amount <= 0 || !Number.isFinite(amount)) {
        void replyToUser(channel, username, `@${username}: Usage: !gift @username <amount>`);
        return;
      }
      if (rawTarget === username) {
        void replyToUser(channel, username, `@${username}: You can't gift coins to yourself!`);
        return;
      }
      try {
        const { balance } = await getPointsBalance(username, ch);
        if (balance < amount) {
          void replyToUser(channel, username, `@${username}: Not enough coins — you have ${balance}🪙 but need ${amount}🪙.`);
          return;
        }
        await db.insert(lootDropsTable).values({
          username,
          channel: ch,
          item: `Gift to @${rawTarget}`,
          rarity: "common",
          points: -amount,
        });
        const credited = await clampCoinAward(ch, rawTarget, amount);
        if (credited > 0) {
          await db.insert(lootDropsTable).values({
            username: rawTarget,
            channel: ch,
            item: `Gift from @${username}`,
            rarity: "common",
            points: credited,
          });
        }
        const capNote = credited < amount ? ` (capped — ${rawTarget} hit the coin limit)` : "";
        void replyToUser(channel, username, `🎁 @${username} gifted ${amount}🪙 to @${rawTarget}!${capNote}`);
      } catch (giftErr) {
        logger.error({ err: giftErr }, "Error in !gift command");
      }
    }
  } catch (err) {
    logger.error({ err, command, username }, "Error handling bot command");
  }
}

export async function announceGiveawayStart(giveaway: {
  prize: string;
  keyword: string;
  channel: string;
}): Promise<void> {
  if (!client || !botState.connected) return;
  const phrases = await getChannelThemePhrases(giveaway.channel);
  const phrase = formatMessage(pickRandom(phrases.giveawayStart), {
    prize: giveaway.prize,
    keyword: giveaway.keyword,
  });
  void client.say(`#${giveaway.channel}`, phrase);
}

export async function announceGiveawayEnd(giveaway: {
  prize: string;
  channel: string;
  winner: string;
  entryCount: number;
}): Promise<void> {
  if (!client || !botState.connected) return;
  const phrases = await getChannelThemePhrases(giveaway.channel);
  const phrase = formatMessage(pickRandom(phrases.giveawayEnd), {
    prize: giveaway.prize,
    winner: giveaway.winner,
    count: giveaway.entryCount,
  });
  void client.say(`#${giveaway.channel}`, phrase);
}

export function getBotState(): BotState {
  return { ...botState };
}

/**
 * Build the Spells-page command listing for one streamer's dashboard.
 *
 * - Built-in `enabled` flag is read from `usersTable.commandToggles` for
 *   the supplied `channel` (falls back to true when no override exists).
 * - Custom commands are listed for the supplied `userId` so an unlinked
 *   streamer can still see/edit their own customs even though those
 *   customs cannot fire on any channel until they link Twitch. Loading
 *   from the DB on read keeps the per-channel chat cache as a pure
 *   chat-handler optimization.
 */
export async function getCommandConfig(opts: { channel?: string; userId?: number } = {}) {
  const toggles = opts.channel ? await getAllToggles(opts.channel) : {};
  const builtIns = await Promise.all(
    Object.entries(BUILT_IN_COMMANDS)
      .filter(([, meta]) => !meta.aliasOf)
      .map(async ([name, meta]) => {
        const customResponse = meta.customizable && opts.channel
          ? await getCustomResponseFor(opts.channel, name)
          : null;
        const enabled = typeof toggles[name] === "boolean" ? toggles[name]! : true;
        return {
          name,
          description: meta.description,
          enabled,
          cooldownSeconds: COMMAND_COOLDOWN_SECONDS[name] ?? 10,
          theme: meta.theme,
          aliases: COMMAND_ALIASES[name] ?? [],
          isCustom: false as const,
          customizable: Boolean(meta.customizable),
          availableTokens: [...(meta.availableTokens ?? [])],
          defaultResponse: meta.defaultResponse ?? null,
          customResponse,
        };
      }),
  );
  let customs: Array<{
    id: number;
    name: string;
    description: string;
    responseText: string;
    enabled: boolean;
    cooldownSeconds: number;
    theme: CommandTheme;
    isCustom: true;
  }> = [];
  if (opts.userId !== undefined) {
    const rows = await db
      .select()
      .from(customCommandsTable)
      .where(eq(customCommandsTable.userId, opts.userId));
    customs = rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: "Custom command",
      responseText: c.responseText,
      enabled: c.enabled,
      cooldownSeconds: c.cooldownSeconds,
      theme: c.theme as CommandTheme,
      isCustom: true as const,
    }));
  }
  return [...builtIns, ...customs];
}

export function isBuiltInCommand(name: string): boolean {
  return name in BUILT_IN_COMMANDS;
}

/** Resolve canonical name (handling aliases). Returns null if unknown. */
export function resolveCanonical(name: string): string | null {
  const meta = BUILT_IN_COMMANDS[name];
  if (!meta) return null;
  return meta.aliasOf ?? name;
}

/** True iff the canonical command supports streamer-customized responses. */
export function isCommandCustomizable(canonical: string): boolean {
  return Boolean(BUILT_IN_COMMANDS[canonical]?.customizable);
}

export type { BotTheme };

let _activeBotName = "GoblinL00t";
export function setActiveBotName(name: string): void { _activeBotName = name; }
export function getActiveBotName(): string { return _activeBotName; }

function normalizeChannel(name: string): string {
  return name.replace(/^#/, "").trim().toLowerCase();
}

/**
 * Build the canonical list of channels the bot should join on connect.
 * Sources, in order of preference, deduped + lowercased:
 *   1. Every linked streamer in `usersTable.twitchUsername` (the live
 *      multi-tenant signup roster).
 *   2. The legacy `TWITCH_CHANNEL` env var (kept for back-compat with
 *      single-tenant deployments and local dev).
 *   3. The `goblinl00t` fallback so dev mode without any DB rows still
 *      lands somewhere chat-visible.
 *
 * Failure to read the DB falls back to (2) + (3) so the bot still boots.
 */
async function loadJoinableChannels(): Promise<string[]> {
  const set = new Set<string>();
  try {
    const rows = await db
      .select({ twitchUsername: usersTable.twitchUsername })
      .from(usersTable)
      .where(isNotNull(usersTable.twitchUsername));
    for (const row of rows) {
      const ch = row.twitchUsername ? normalizeChannel(row.twitchUsername) : "";
      if (ch) set.add(ch);
    }
  } catch (err) {
    logger.error({ err }, "Failed to load streamer channel list — falling back to env");
  }
  const envChannel = process.env["TWITCH_CHANNEL"];
  if (envChannel) set.add(normalizeChannel(envChannel));
  set.add("goblinl00t");
  return [...set];
}

/**
 * Dynamically join a Twitch channel after the bot is already connected.
 * Called from the Twitch-link auth callback (`routes/auth.ts`) so a
 * brand-new streamer's bot starts working immediately, no restart
 * required. No-ops gracefully if the bot is offline (no OAuth token in
 * dev) or already joined.
 */
export async function joinChannel(name: string): Promise<void> {
  const ch = normalizeChannel(name);
  if (!ch) return;
  if (botState.channels.includes(ch)) return;
  // Offline mode (no OAuth token / not yet connected): record the
  // intended membership so the next `startBot()` reload picks it up,
  // then bail. The DB-backed `loadJoinableChannels()` is the source of
  // truth on cold boot, so this assignment mostly matters for the
  // dashboard `BotState` readout.
  if (!client || !botState.connected) {
    botState.channels = [...botState.channels, ch];
    return;
  }
  try {
    await client.join(ch);
    botState.channels = [...botState.channels, ch];
    logger.info({ channel: ch }, "Bot joined channel");
  } catch (err) {
    logger.error({ err, channel: ch }, "Failed to join channel");
  }
}

/**
 * Dynamically leave a Twitch channel. Called from admin user-delete and
 * twitchUsername-rename flows so the bot doesn't keep watching chats
 * for streamers who no longer have an account.
 */
export async function partChannel(name: string): Promise<void> {
  const ch = normalizeChannel(name);
  if (!ch) return;
  // Offline mode: just drop from the local list — there's no live tmi
  // session to leave anyway.
  if (!client || !botState.connected) {
    botState.channels = botState.channels.filter((c) => c !== ch);
    return;
  }
  try {
    await client.part(ch);
    botState.channels = botState.channels.filter((c) => c !== ch);
    logger.info({ channel: ch }, "Bot parted channel");
  } catch (err) {
    logger.error({ err, channel: ch }, "Failed to part channel");
  }
}

let announcementSchedulerInterval: ReturnType<typeof setInterval> | null = null;

async function startAnnouncementScheduler(): Promise<void> {
  if (announcementSchedulerInterval) {
    clearInterval(announcementSchedulerInterval);
    announcementSchedulerInterval = null;
  }
  announcementSchedulerInterval = setInterval(() => {
    void (async () => {
      if (!client || !botState.connected) return;
      const now = new Date();
      try {
        const rows = await db
          .select()
          .from(scheduledAnnouncementsTable)
          .where(eq(scheduledAnnouncementsTable.enabled, true));
        for (const row of rows) {
          const intervalMs = row.intervalMinutes * 60 * 1000;
          const lastPosted = row.lastPostedAt ? new Date(row.lastPostedAt).getTime() : 0;
          if (now.getTime() - lastPosted >= intervalMs) {
            const ch = `#${row.channel}`;
            try {
              await client.say(ch, row.message);
              await db
                .update(scheduledAnnouncementsTable)
                .set({ lastPostedAt: now })
                .where(eq(scheduledAnnouncementsTable.id, row.id));
            } catch (sayErr) {
              logger.error({ err: sayErr, channel: row.channel, announcementId: row.id }, "Failed to post announcement");
            }
          }
        }
      } catch (err) {
        logger.error({ err }, "Announcement scheduler error");
      }
    })();
  }, 60_000);
  logger.info("Announcement scheduler started");
}

export async function startBot(): Promise<void> {
  const oauthToken = process.env["TWITCH_OAUTH_TOKEN"];
  const username = process.env["TWITCH_BOT_USERNAME"] ?? "GoblinL00tBot";
  const channels = await loadJoinableChannels();
  const primaryChannel = normalizeChannel(process.env["TWITCH_CHANNEL"] ?? channels[0] ?? "goblinl00t");

  await reloadCustomCommands();

  // Wire goblin events to use this bot's say(), then start the scheduler.
  setGoblinEventSink((ch, msg) => {
    if (client && botState.connected) {
      void client.say(ch, msg);
    }
  });
  startGoblinEvents();
  void startAnnouncementScheduler();

  // BOT_ENABLED must be explicitly set to "true" to connect to Twitch IRC.
  // This prevents the Replit dev server (which shares the same OAuth token
  // secret) from connecting alongside the production deployment and causing
  // duplicate responses in chat.
  if (process.env["BOT_ENABLED"] !== "true") {
    logger.warn({ channels }, "BOT_ENABLED != true — bot running in offline mode (dashboard only)");
    botState = { ...botState, connected: false, channel: primaryChannel, channels, username, startedAt: null };
    return;
  }

  if (!oauthToken) {
    logger.warn({ channels }, "TWITCH_OAUTH_TOKEN not set — bot running in offline mode (dashboard only)");
    botState = { ...botState, connected: false, channel: primaryChannel, channels, username, startedAt: null };
    return;
  }

  const token = oauthToken.startsWith("oauth:") ? oauthToken : `oauth:${oauthToken}`;

  try {
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
    }

    // Claim this generation AFTER disconnect so any in-flight messages on
    // the old socket are already drained (or will fail the stale-gen check).
    const gen = ++clientGeneration;

    client = new tmi.Client({
      options: { debug: false },
      identity: { username, password: token },
      channels,
    });

    client.on("message", (ch, tags, message) => {
      // Bail out if a newer client has since been created — this handler
      // belongs to a stale connection that survived a failed disconnect().
      if (clientGeneration !== gen) return;
      pushChatMessage(ch.replace(/^#/, "").toLowerCase(), {
        username: (tags.username ?? tags["display-name"] ?? "?").toLowerCase(),
        display: tags["display-name"] ?? tags.username ?? "?",
        message,
        color: tags.color ?? null,
        isBot: false,
        timestamp: new Date().toISOString(),
      });
      void handleMessage(ch, tags, message);
    });

    client.on("connected", () => {
      // Merge the connect-time snapshot with any live mutations that
      // landed during the (async) connect — e.g. a Twitch-link callback
      // calling joinChannel() while we were still negotiating. Without
      // this merge those joins would be silently clobbered.
      // Always normalise every entry so stale `#channel` values from a
      // previous run can't propagate and cause double-hash say() calls.
      const merged = Array.from(
        new Set([...channels, ...botState.channels].map(normalizeChannel))
      );
      botState = { connected: true, channel: primaryChannel, channels: merged, username, startedAt: new Date(), lastMessageAt: null };
      logger.info({ channels: merged, username }, "Bot connected to Twitch!");
    });

    client.on("disconnected", (reason) => {
      botState = { ...botState, connected: false };
      logger.warn({ reason }, "Bot disconnected");
    });

    await client.connect();
  } catch (err) {
    logger.error({ err }, "Failed to start Twitch bot");
    botState = { ...botState, connected: false };
  }
}

export async function restartBot(): Promise<BotState> {
  // Announce in every joined channel before tearing down the connection.
  // The short delay after say() lets tmi.js flush the PRIVMSG over the
  // IRC socket before startBot() disconnects the client.
  if (client && botState.connected && botState.channels.length > 0) {
    logger.info({ channels: botState.channels }, "restartBot: sending announcement");
    await Promise.allSettled(
      botState.channels.map((ch) =>
        client!.say(`#${ch}`, "🔄 GoblinL00t bot is restarting — back in a sec!")
      )
    );
    // Give tmi.js time to flush the outgoing IRC PRIVMSG before disconnect.
    await new Promise((resolve) => setTimeout(resolve, 600));
  } else {
    logger.warn(
      { connected: botState.connected, channels: botState.channels },
      "restartBot: skipping announcement (not connected or no channels)"
    );
  }
  await startBot();
  return getBotState();
}

/**
 * Post a message to a Twitch channel from the bot and record it in the local
 * chat ring buffer so the viewer portal can display it immediately without
 * waiting for the Twitch round-trip echo.
 */
export async function sayInChannel(channel: string, message: string): Promise<void> {
  if (!client || !botState.connected) return;
  const tmiChannel = channel.startsWith("#") ? channel : `#${channel}`;
  try {
    await client.say(tmiChannel, message);
    pushChatMessage(channel.replace(/^#/, "").toLowerCase(), {
      username: (botState.username ?? "goblinl00t").toLowerCase(),
      display: botState.username ?? "GoblinL00t",
      message,
      color: "#9147ff",
      isBot: true,
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    logger.error({ err: (err as Error).message, channel }, "sayInChannel failed");
  }
}

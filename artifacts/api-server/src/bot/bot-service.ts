import tmi from "tmi.js";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, tradeFulfillmentsTable, customCommandsTable, usersTable } from "@workspace/db";
import { eq, and, isNotNull } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getRarityEmoji } from "./loot-tables";
import { pickRandom, formatMessage } from "./goblin-phrases";
import { type BotTheme } from "./bot-themes";
import { getChannelTheme, getChannelThemePhrases } from "./channel-theme";
import { getPointsBalance, REDEEM_COST_PER_ENTRY, redeemEntriesForUser } from "./points";
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
  INVENTORY_CAP,
} from "./inventory";
import { startGoblinEvents, setGoblinEventSink, trackChatter } from "./goblin-events";
import { getCustomResponseFor, renderTemplate } from "./command-responses";
import { getToggleFor, getAllToggles } from "./command-toggles";

export type CommandTheme = "goblin" | "cs2" | "both";

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
  "!loot":       { description: `Roll for a random inventory drop (cap ${INVENTORY_CAP})`, cooldownSeconds: 30, theme: "both"   },
  "!enter":      { description: "Enter the active giveaway",                cooldownSeconds: 5,  theme: "both"   },
  "!giveaway":   { description: "Check if a giveaway is running",           cooldownSeconds: 5,  theme: "both"   },
  "!inventory":  { description: "List your loot inventory slots",           cooldownSeconds: 15, theme: "both"   },
  "!sell":       { description: "Sell an inventory item — !sell <slot> or !sell all", cooldownSeconds: 5, theme: "both" },
  "!use":        { description: "Activate a buff item from your inventory — !use <slot>", cooldownSeconds: 5, theme: "both" },
  "!help":       {
    description: "Show a short list of available commands for the active theme",
    cooldownSeconds: 30,
    theme: "both",
    customizable: true,
    availableTokens: ["user", "commands", "theme"],
    defaultResponse: "{user}: Try {commands} — full guide in the dashboard.",
  },
  "!goblin":     {
    description: "Summon the bot for a themed taunt (alias: !skin)",
    cooldownSeconds: 10,
    theme: "goblin",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "HEHEHE! {user} summoned the goblin!",
  },
  "!steal":      {
    description: "Attempt to mug another viewer (alias: !scam)",
    cooldownSeconds: 20,
    theme: "goblin",
    customizable: true,
    availableTokens: ["user", "target"],
    defaultResponse: "{user} sneaks up on {target} and runs off with their loot!",
  },
  "!hoard":      {
    description: "Check your coin balance (alias: !stash)",
    cooldownSeconds: 15,
    theme: "goblin",
    customizable: true,
    availableTokens: ["user", "balance", "earned"],
    defaultResponse: "🪙 {user}: {balance} coins in your hoard ({earned} earned all-time).",
  },
  "!feedgoblin": {
    description: "Feed the bot a snack (alias: !case)",
    cooldownSeconds: 10,
    theme: "goblin",
    customizable: true,
    availableTokens: ["user"],
    defaultResponse: "🍖 {user} fed the goblin! YUM!",
  },
  // CS2 flavor commands — pure aliases of the goblin set; share toggle/cooldown.
  "!skin":       { description: "Alias of !goblin", cooldownSeconds: 10, theme: "cs2", aliasOf: "!goblin" },
  "!scam":       { description: "Alias of !steal", cooldownSeconds: 20, theme: "cs2", aliasOf: "!steal" },
  "!stash":      { description: "Alias of !hoard", cooldownSeconds: 15, theme: "cs2", aliasOf: "!hoard" },
  "!case":       { description: "Alias of !feedgoblin", cooldownSeconds: 10, theme: "cs2", aliasOf: "!feedgoblin" },
  "!tradeurl":   { description: "Submit your Steam trade URL after winning a skin", cooldownSeconds: 10, theme: "cs2" },
  "!redeem":     { description: "Redeem coins for extra giveaway entries (100 coins = 1 entry)", cooldownSeconds: 5, theme: "both" },
  "!points":     {
    description: "Check your coin balance (alias: !coins)",
    cooldownSeconds: 10,
    theme: "both",
    customizable: true,
    availableTokens: ["user", "balance", "entries", "cost"],
    defaultResponse: "💰 {user}: You have {balance} coins (worth {entries} extra giveaway entries at {cost} coins each).",
  },
  "!coins":      { description: "Alias of !points", cooldownSeconds: 10, theme: "both", aliasOf: "!points" },
};

/** Build the !help reply: short, theme-aware command list. Channel-scoped
 *  so per-streamer disabled commands don't show up in another channel's reply. */
async function buildHelpCommandList(channel: string, activeTheme: BotTheme): Promise<string> {
  const toggles = await getAllToggles(channel);
  const enabledCanonicals = Object.entries(BUILT_IN_COMMANDS)
    .filter(([name, meta]) => {
      if (meta.aliasOf) return false;
      if (meta.theme !== "both" && meta.theme !== activeTheme) return false;
      return typeof toggles[name] === "boolean" ? toggles[name]! : true;
    })
    .map(([name]) => name);
  // Cap to keep chat short; the dashboard /help has the full table.
  return enabledCanonicals.slice(0, 10).join(" ");
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

async function handleMessage(channel: string, tags: tmi.ChatUserstate, message: string) {
  // Deduplicate by Twitch message ID — belt-and-suspenders on top of the
  // generation counter. Guards against any scenario (stale client, tmi.js
  // internal reconnect, etc.) that could deliver the same message twice.
  const msgId = tags["id"];
  if (msgId && markSeen(msgId)) return;

  const username = (tags.username ?? tags["display-name"] ?? "unknown").toLowerCase();
  trackChatter(channel, username);
  const msg = message.trim();
  const parts = msg.split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (!command || !command.startsWith("!")) return;

  // Custom commands — channel-scoped lookup so a custom from streamer A
  // never fires in streamer B's channel.
  const channelKey = channel.replace(/^#/, "").toLowerCase();
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
      try { await client.say(channel, reply); } catch (err) { logger.error({ err }, "Failed to send custom reply"); }
    }
    return;
  }

  // Built-in dispatch + per-channel enable/disable check. Resolving to the
  // canonical name first so toggling "!hoard" off also disables "!stash"
  // in the same channel (aliases share the toggle, as before).
  if (!(command in BUILT_IN_COMMANDS)) return;
  const canonical = BUILT_IN_COMMANDS[command]?.aliasOf ?? command;
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
      const settings = await getChannelSettings(ch);
      const loot = rollLootDrop({
        luckBuffActive: luckActive,
        allowBuffs: settings.lootDropsEnabled,
        theme: channelTheme,
      });
      // Charge consumption is atomic with the insert — a "full" result will
      // not burn the buff (see addInventoryItem).
      const result = await addInventoryItem(ch, username, loot, {
        consumeLuckOnSuccess: luckActive,
      });
      const emoji = getRarityEmoji(loot.rarity);
      const flavor = pickRandom(phrases.lootResponses[loot.rarity]);

      if (!result.ok) {
        void client?.say(channel, inventoryFullMessage(username));
        return;
      }

      // Mirror to loot_drops as activity log (coins=0; coins are credited only on !sell).
      await db.insert(lootDropsTable).values({
        channel: ch, username, item: loot.item, rarity: loot.rarity, points: 0,
      });

      const slotMsg = `slot ${result.slot}/${INVENTORY_CAP}`;
      if (loot.kind === "buff") {
        void client?.say(
          channel,
          `${emoji} ${username} found a [BUFF] ${loot.item}! (${slotMsg}) — !use ${result.slot} to activate (${loot.flavor}, ${loot.charges} charges) or !sell ${result.slot} for ${loot.coinValue} coins.`
        );
      } else {
        void client?.say(
          channel,
          `${emoji} ${username} found [${loot.rarity.toUpperCase()}] ${loot.item}! (${slotMsg}) — !sell ${result.slot} for ${loot.coinValue} coins. ${flavor}`
        );
      }
    }

    if (command === "!inventory") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      if (items.length === 0) {
        void client?.say(channel, `🎒 ${username}: Your goblin pouch is empty. Try !loot to grab something!`);
      } else {
        const lines = items.map((it, i) => {
          const e = getRarityEmoji(it.rarity);
          if (it.kind === "buff") {
            const status = it.isActive ? `ACTIVE×${it.chargesRemaining}` : `${it.chargesRemaining} charges`;
            return `[${i + 1}] ${e} ${it.item} (BUFF, ${status}, sell ${it.coinValue})`;
          }
          return `[${i + 1}] ${e} ${it.item} (${it.coinValue} coins)`;
        });
        void client?.say(channel, `🎒 ${username} (${items.length}/${INVENTORY_CAP}): ${lines.join(" • ")}`);
      }
    }

    if (command === "!sell") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      if (items.length === 0) {
        void client?.say(channel, `${username}: Nothing to sell — your pouch is empty!`);
        return;
      }
      const arg = (parts[1] ?? "").toLowerCase();
      let totalCoins = 0;
      let soldCount = 0;
      let targetItems: typeof items = [];
      if (arg === "all") {
        targetItems = items.filter((i) => i.kind === "item");
        if (targetItems.length === 0) {
          void client?.say(channel, `${username}: All your items are buffs — !use them or !sell <slot> to dump one.`);
          return;
        }
      } else {
        const slot = Number.parseInt(arg, 10);
        if (!Number.isFinite(slot) || slot < 1 || slot > items.length) {
          void client?.say(channel, `${username}: Try !sell <slot 1-${items.length}> or !sell all`);
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
        void client?.say(channel, `${username}: Sale failed — try !inventory and try again.`);
        return;
      }
      const summary = soldCount === 1 ? soldNames[0] : `${soldCount} items`;
      void client?.say(channel, `💰 ${username} sold ${summary} for ${totalCoins} coins!`);
    }

    if (command === "!use") {
      const ch = channel.replace(/^#/, "");
      const items = await listInventory(ch, username);
      const slot = Number.parseInt(parts[1] ?? "", 10);
      if (!Number.isFinite(slot) || slot < 1 || slot > items.length) {
        void client?.say(channel, `${username}: Try !use <slot 1-${items.length || INVENTORY_CAP}> — buffs only.`);
        return;
      }
      const target = items[slot - 1]!;
      const r = await useInventoryItem({ channel: ch, username, itemId: target.id });
      if (!r.ok) {
        if (r.reason === "not_buff") {
          void client?.say(channel, `${username}: ${target.item} isn't a buff — !sell ${slot} for ${target.coinValue} coins instead.`);
        } else {
          void client?.say(channel, `${username}: Couldn't activate that item.`);
        }
        return;
      }
      void client?.say(channel, `✨ ${username} activated ${r.item!.item}! (${r.item!.chargesRemaining} charges remaining)`);
    }

    if (command === "!enter") {
      // Scope to the chat channel so a `!enter` in streamer A's chat can't
      // accidentally bind to streamer B's active giveaway when both are
      // running concurrently in the multi-tenant DB.
      const chForGiveaway = channel.replace(/^#/, "").toLowerCase();
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(and(eq(giveawaysTable.status, "active"), eq(giveawaysTable.channel, chForGiveaway)))
        .limit(1);

      if (!active) {
        void client?.say(channel, phrases.enterNoGiveaway(username));
        return;
      }

      const keyword = active.keyword ?? "!enter";
      if (command !== keyword.toLowerCase()) return;

      const gate = await checkGating(active as Gateable, tags, channel);
      if (!gate.allowed) {
        void client?.say(channel, `${username}: ${gate.reason}`);
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
        void client?.say(channel, phrases.enterAlreadyIn(username));
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
        void client?.say(channel, phrases.enterAlreadyIn(username));
        return;
      }

      if (ticketsBuff && (await consumeBuffCharge(ch, username, "tickets"))) {
        tickets = 2;
      }

      const phrase = formatMessage(pickRandom(phrases.enterResponses), { user: username });
      const suffix = tickets > 1 ? ` 🧲 (Hoard Magnet: +1 ticket!)` : "";
      void client?.say(channel, `${phrase}${suffix}`);
    }

    if (command === "!help") {
      const ch = channel.replace(/^#/, "");
      const list = await buildHelpCommandList(ch, channelTheme);
      const custom = await getCustomResponseFor(ch, "!help");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, commands: list, theme: channelTheme })
        : `${username}: ${list} — full guide in the dashboard.`;
      void client?.say(channel, reply);
    }

    if (command === "!goblin" || command === "!skin") {
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!goblin");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}` })
        : pickRandom(phrases.goblinResponses);
      void client?.say(channel, reply);
    }

    if (command === "!steal" || command === "!scam") {
      const target = parts[1]?.replace("@", "") ?? null;
      if (!target) {
        void client?.say(channel, phrases.stealNoTarget);
        return;
      }
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!steal");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, target })
        : formatMessage(pickRandom(phrases.stealResponses), { target });
      void client?.say(channel, reply);
    }

    if (command === "!hoard" || command === "!stash") {
      const ch = channel.replace(/^#/, "");
      const { balance, earned } = await getPointsBalance(username, ch);
      const custom = await getCustomResponseFor(ch, "!hoard");
      if (custom) {
        void client?.say(channel, renderTemplate(custom, { user: `@${username}`, balance, earned }));
      } else if (earned === 0) {
        void client?.say(channel, phrases.hoardEmpty(username));
      } else {
        void client?.say(channel, `🪙 ${username}: ${balance} coins in your hoard (${earned} earned all-time).`);
      }
    }

    if (command === "!feedgoblin" || command === "!case") {
      const ch = channel.replace(/^#/, "");
      const custom = await getCustomResponseFor(ch, "!feedgoblin");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}` })
        : pickRandom(phrases.feedResponses);
      void client?.say(channel, reply);
    }

    if (command === "!tradeurl") {
      const tradeUrl = parts[1] ?? null;
      if (!tradeUrl || !tradeUrl.includes("steamcommunity.com/tradeoffer/new/")) {
        void client?.say(
          channel,
          `${username}: Please provide your Steam trade URL — !tradeurl https://steamcommunity.com/tradeoffer/new/?partner=...`
        );
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
        void client?.say(channel, `${username}: No pending giveaway win found for your account! Contact the streamer if you think this is wrong.`);
        return;
      }
      await db
        .update(tradeFulfillmentsTable)
        .set({ steamTradeUrl: tradeUrl })
        .where(eq(tradeFulfillmentsTable.id, pending.id));
      void client?.say(channel, `✅ ${username}: Trade URL saved! The streamer will send your skin soon 🎁`);
    }

    if (command === "!points" || command === "!coins") {
      const ch = channel.replace(/^#/, "");
      const { balance } = await getPointsBalance(username, ch);
      const entries = Math.floor(balance / REDEEM_COST_PER_ENTRY);
      const custom = await getCustomResponseFor(ch, "!points");
      const reply = custom
        ? renderTemplate(custom, { user: `@${username}`, balance, entries, cost: REDEEM_COST_PER_ENTRY })
        : `💰 ${username}: You have ${balance} coins (worth ${entries} extra giveaway ${entries === 1 ? "entry" : "entries"} at ${REDEEM_COST_PER_ENTRY} coins each).`;
      void client?.say(channel, reply);
    }

    if (command === "!redeem") {
      const ch = channel.replace(/^#/, "");
      const settings = await getChannelSettings(ch);
      if (!settings.coinRedemptionEnabled) {
        void client?.say(channel, `${username}: The goblin isn't trading coins for tickets right now.`);
        return;
      }
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
        void client?.say(channel, `${username}: No active giveaway to redeem into right now.`);
        return;
      }

      // Gate redemption the same as a normal !enter (cheap fail-fast before the txn).
      const gate = await checkGating(active as Gateable, tags, channel);
      if (!gate.allowed) {
        void client?.say(channel, `${username}: ${gate.reason}`);
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
          void client?.say(channel, `${username}: Not enough coins — ${result.message}. You can afford ${affordable} extra ${affordable === 1 ? "entry" : "entries"}.`);
        } else {
          void client?.say(channel, `${username}: ${result.message}`);
        }
        return;
      }

      void client?.say(channel, `🎟️ ${username} redeemed ${result.pointsSpent} coins for ${result.ticketsAdded} extra ${result.ticketsAdded === 1 ? "entry" : "entries"}! Balance: ${result.balanceAfter} coins.`);
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

        void client?.say(
          channel,
          `🎁 GIVEAWAY IN PROGRESS!! Prize: ${active.prize} | ${entries.length} entries so far! Type ${active.keyword} to enter!!`
        );
      } else {
        void client?.say(channel, phrases.giveawayNone);
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
      void handleMessage(ch, tags, message);
    });

    client.on("connected", () => {
      // Merge the connect-time snapshot with any live mutations that
      // landed during the (async) connect — e.g. a Twitch-link callback
      // calling joinChannel() while we were still negotiating. Without
      // this merge those joins would be silently clobbered.
      const merged = Array.from(new Set([...channels, ...botState.channels]));
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
  if (client && botState.connected) {
    const channels = [...botState.channels];
    await Promise.allSettled(
      channels.map((ch) => client!.say(`#${ch}`, "🔄 GoblinL00t bot is restarting — back in a sec!"))
    );
  }
  await startBot();
  return getBotState();
}

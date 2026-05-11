import tmi from "tmi.js";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, tradeFulfillmentsTable, customCommandsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rollLoot, getRarityEmoji } from "./loot-tables";
import { pickRandom, formatMessage } from "./goblin-phrases";
import { getThemePhrases, setActiveTheme, getActiveTheme, type BotTheme } from "./bot-themes";
import { getPointsBalance, REDEEM_COST_PER_ENTRY, redeemEntriesForUser } from "./points";
import { checkGating, type Gateable } from "./gating";

export type CommandTheme = "goblin" | "cs2" | "both";

interface BuiltInCommand {
  description: string;
  cooldownSeconds: number;
  theme: CommandTheme;
}

const BUILT_IN_COMMANDS: Record<string, BuiltInCommand> = {
  "!loot":       { description: "Roll for random loot with rarity tiers",   cooldownSeconds: 30, theme: "both"   },
  "!enter":      { description: "Enter the active giveaway",                cooldownSeconds: 5,  theme: "both"   },
  "!giveaway":   { description: "Check if a giveaway is running",           cooldownSeconds: 5,  theme: "both"   },
  "!inventory":  { description: "Check your loot inventory",                cooldownSeconds: 15, theme: "both"   },
  "!goblin":     { description: "Summon the goblin for a random response",  cooldownSeconds: 10, theme: "goblin" },
  "!steal":      { description: "Attempt to steal from another viewer",     cooldownSeconds: 20, theme: "goblin" },
  "!hoard":      { description: "Check your goblin hoard",                  cooldownSeconds: 15, theme: "goblin" },
  "!feedgoblin": { description: "Feed the goblin a snack",                  cooldownSeconds: 10, theme: "goblin" },
  "!tradeurl":   { description: "Submit your Steam trade URL after winning a skin", cooldownSeconds: 10, theme: "cs2" },
  "!redeem":     { description: "Redeem loot points for extra giveaway entries (100 pts = 1 entry)", cooldownSeconds: 5, theme: "both" },
  "!points":     { description: "Check your loot point balance",            cooldownSeconds: 10, theme: "both" },
};

interface CustomCommandCacheEntry {
  id: number;
  userId: number;
  responseText: string;
  cooldownSeconds: number;
  enabled: boolean;
  theme: CommandTheme;
}
const CUSTOM_COMMANDS = new Map<string, CustomCommandCacheEntry>();

export async function reloadCustomCommands(): Promise<void> {
  try {
    const rows = await db.select().from(customCommandsTable);
    // Build the next snapshot fully before mutating the live cache so that
    // in-flight chat messages don't see a transiently-empty map.
    const next = new Map<string, CustomCommandCacheEntry>();
    for (const row of rows) {
      next.set(row.name.toLowerCase(), {
        id: row.id,
        userId: row.userId,
        responseText: row.responseText,
        cooldownSeconds: row.cooldownSeconds,
        enabled: row.enabled,
        theme: row.theme as CommandTheme,
      });
    }
    CUSTOM_COMMANDS.clear();
    for (const [k, v] of next) CUSTOM_COMMANDS.set(k, v);
  } catch (err) {
    logger.error({ err }, "Failed to load custom commands");
  }
}

export interface BotState {
  connected: boolean;
  channel: string;
  username: string;
  startedAt: Date | null;
  lastMessageAt: Date | null;
}

const COMMAND_COOLDOWNS = new Map<string, Map<string, number>>();
const COMMAND_ENABLED: Record<string, boolean> = Object.fromEntries(
  Object.keys(BUILT_IN_COMMANDS).map((k) => [k, true])
);

const COMMAND_COOLDOWN_SECONDS: Record<string, number> = Object.fromEntries(
  Object.entries(BUILT_IN_COMMANDS).map(([k, v]) => [k, v.cooldownSeconds])
);

let client: tmi.Client | null = null;
let botState: BotState = {
  connected: false,
  channel: process.env["TWITCH_CHANNEL"] ?? "goblinl00t",
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
  const username = tags["display-name"] ?? tags.username ?? "unknown";
  const msg = message.trim();
  const parts = msg.split(/\s+/);
  const command = parts[0]?.toLowerCase();

  if (!command || !command.startsWith("!")) return;

  // Custom commands
  const custom = CUSTOM_COMMANDS.get(command);
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

  if (!(command in COMMAND_ENABLED)) return;
  if (!COMMAND_ENABLED[command]) return;
  if (isOnCooldown(channel, username, command)) return;

  setCooldown(channel, username, command);
  void logCommand(command, username, channel);
  botState.lastMessageAt = new Date();

  const phrases = getThemePhrases();

  try {
    if (command === "!loot") {
      const loot = rollLoot();
      const emoji = getRarityEmoji(loot.rarity);
      const flavor = pickRandom(phrases.lootResponses[loot.rarity]);
      await db.insert(lootDropsTable).values({
        username,
        item: loot.item,
        rarity: loot.rarity,
        points: loot.points,
        channel: channel.replace("#", ""),
      });
      void client?.say(
        channel,
        `${emoji} ${username} found [${loot.rarity.toUpperCase()}] ${loot.item}! (+${loot.points} pts) ${emoji} ${flavor}`
      );
    }

    if (command === "!enter") {
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.status, "active"))
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

      await db.insert(giveawayEntriesTable).values({
        giveawayId: active.id,
        username,
        tickets: 1,
      });

      const phrase = formatMessage(pickRandom(phrases.enterResponses), { user: username });
      void client?.say(channel, phrase);
    }

    if (command === "!goblin") {
      void client?.say(channel, pickRandom(phrases.goblinResponses));
    }

    if (command === "!steal") {
      const target = parts[1]?.replace("@", "") ?? null;
      if (!target) {
        void client?.say(channel, phrases.stealNoTarget);
        return;
      }
      const phrase = formatMessage(pickRandom(phrases.stealResponses), { target });
      void client?.say(channel, phrase);
    }

    if (command === "!hoard" || command === "!inventory") {
      const entries = await db
        .select()
        .from(lootDropsTable)
        .where(eq(lootDropsTable.username, username));

      const count = entries.length;
      const totalPts = entries.reduce((sum, e) => sum + e.points, 0);

      if (count === 0) {
        void client?.say(channel, phrases.hoardEmpty(username));
      } else {
        void client?.say(channel, phrases.hoardFull(username, count, totalPts));
      }
    }

    if (command === "!feedgoblin") {
      void client?.say(channel, pickRandom(phrases.feedResponses));
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

    if (command === "!points") {
      const { balance } = await getPointsBalance(username);
      const entries = Math.floor(balance / REDEEM_COST_PER_ENTRY);
      void client?.say(channel, `💰 ${username}: You have ${balance} loot points (worth ${entries} extra giveaway ${entries === 1 ? "entry" : "entries"} at ${REDEEM_COST_PER_ENTRY} pts each).`);
    }

    if (command === "!redeem") {
      const requested = Math.max(1, Math.floor(Number(parts[1] ?? 1)));
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.status, "active"))
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
          void client?.say(channel, `${username}: Not enough points — ${result.message}. You can afford ${affordable} extra ${affordable === 1 ? "entry" : "entries"}.`);
        } else {
          void client?.say(channel, `${username}: ${result.message}`);
        }
        return;
      }

      void client?.say(channel, `🎟️ ${username} redeemed ${result.pointsSpent} pts for ${result.ticketsAdded} extra ${result.ticketsAdded === 1 ? "entry" : "entries"}! Balance: ${result.balanceAfter} pts.`);
    }

    if (command === "!giveaway") {
      const [active] = await db
        .select()
        .from(giveawaysTable)
        .where(eq(giveawaysTable.status, "active"))
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
  const phrases = getThemePhrases();
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
  const phrases = getThemePhrases();
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

export function getCommandConfig() {
  const builtIns = Object.entries(BUILT_IN_COMMANDS).map(([name, meta]) => ({
    name,
    description: meta.description,
    enabled: COMMAND_ENABLED[name] ?? true,
    cooldownSeconds: COMMAND_COOLDOWN_SECONDS[name] ?? 10,
    theme: meta.theme,
    isCustom: false as const,
  }));
  const customs = Array.from(CUSTOM_COMMANDS.entries()).map(([name, c]) => ({
    id: c.id,
    name,
    description: "Custom command",
    responseText: c.responseText,
    enabled: c.enabled,
    cooldownSeconds: c.cooldownSeconds,
    theme: c.theme,
    isCustom: true as const,
  }));
  return [...builtIns, ...customs];
}

export function toggleCommandEnabled(name: string): boolean {
  const lower = name.toLowerCase();
  const custom = CUSTOM_COMMANDS.get(lower);
  if (custom) {
    custom.enabled = !custom.enabled;
    return custom.enabled;
  }
  if (!(name in COMMAND_ENABLED)) throw new Error(`Unknown command: ${name}`);
  COMMAND_ENABLED[name] = !COMMAND_ENABLED[name];
  return COMMAND_ENABLED[name]!;
}

export function isBuiltInCommand(name: string): boolean {
  return name in BUILT_IN_COMMANDS;
}

export function getCustomCommandCache() {
  return CUSTOM_COMMANDS;
}

export { setActiveTheme, getActiveTheme };
export type { BotTheme };

let _activeBotName = "GoblinL00t";
export function setActiveBotName(name: string): void { _activeBotName = name; }
export function getActiveBotName(): string { return _activeBotName; }

export async function startBot(): Promise<void> {
  const oauthToken = process.env["TWITCH_OAUTH_TOKEN"];
  const channel = process.env["TWITCH_CHANNEL"] ?? "goblinl00t";
  const username = process.env["TWITCH_BOT_USERNAME"] ?? "GoblinL00tBot";

  await reloadCustomCommands();

  if (!oauthToken) {
    logger.warn("TWITCH_OAUTH_TOKEN not set — bot running in offline mode (dashboard only)");
    botState = { ...botState, connected: false, channel, username, startedAt: null };
    return;
  }

  const token = oauthToken.startsWith("oauth:") ? oauthToken : `oauth:${oauthToken}`;

  try {
    if (client) {
      try { await client.disconnect(); } catch { /* ignore */ }
    }

    client = new tmi.Client({
      options: { debug: false },
      identity: { username, password: token },
      channels: [channel],
    });

    client.on("message", (ch, tags, message) => {
      void handleMessage(ch, tags, message);
    });

    client.on("connected", () => {
      botState = { connected: true, channel, username, startedAt: new Date(), lastMessageAt: null };
      logger.info({ channel, username }, "Bot connected to Twitch!");
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
  await startBot();
  return getBotState();
}

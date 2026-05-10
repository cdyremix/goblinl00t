import tmi from "tmi.js";
import { db, giveawaysTable, giveawayEntriesTable, lootDropsTable, commandLogsTable, tradeFulfillmentsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { logger } from "../lib/logger";
import { rollLoot, getRarityEmoji } from "./loot-tables";
import { pickRandom, formatMessage } from "./goblin-phrases";
import { getThemePhrases, setActiveTheme, getActiveTheme, type BotTheme } from "./bot-themes";

export interface BotState {
  connected: boolean;
  channel: string;
  username: string;
  startedAt: Date | null;
  lastMessageAt: Date | null;
}

const COMMAND_COOLDOWNS = new Map<string, Map<string, number>>();
const COMMAND_ENABLED: Record<string, boolean> = {
  "!loot": true,
  "!goblin": true,
  "!steal": true,
  "!hoard": true,
  "!inventory": true,
  "!feedgoblin": true,
  "!enter": true,
  "!giveaway": true,
  "!tradeurl": true,
};

const COMMAND_COOLDOWN_SECONDS: Record<string, number> = {
  "!loot": 30,
  "!goblin": 10,
  "!steal": 20,
  "!hoard": 15,
  "!inventory": 15,
  "!feedgoblin": 10,
  "!enter": 5,
  "!giveaway": 5,
  "!tradeurl": 10,
};

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
  return Object.keys(COMMAND_ENABLED).map((name) => ({
    name,
    description: getCommandDescription(name),
    enabled: COMMAND_ENABLED[name] ?? true,
    cooldownSeconds: COMMAND_COOLDOWN_SECONDS[name] ?? 10,
  }));
}

export function toggleCommandEnabled(name: string): boolean {
  if (!(name in COMMAND_ENABLED)) throw new Error(`Unknown command: ${name}`);
  COMMAND_ENABLED[name] = !COMMAND_ENABLED[name];
  return COMMAND_ENABLED[name]!;
}

export { setActiveTheme, getActiveTheme };
export type { BotTheme };

let _activeBotName = "GoblinL00t";
export function setActiveBotName(name: string): void { _activeBotName = name; }
export function getActiveBotName(): string { return _activeBotName; }

function getCommandDescription(cmd: string): string {
  const descriptions: Record<string, string> = {
    "!loot": "Roll for random loot with rarity tiers",
    "!goblin": "Summon the bot for a random response",
    "!steal": "Attempt to steal from another user",
    "!hoard": "Check your loot inventory",
    "!inventory": "Check your loot inventory (alias)",
    "!feedgoblin": "Feed the goblin a snack",
    "!enter": "Enter the active giveaway",
    "!giveaway": "Check if a giveaway is running",
  };
  return descriptions[cmd] ?? "Bot command";
}

export async function startBot(): Promise<void> {
  const oauthToken = process.env["TWITCH_OAUTH_TOKEN"];
  const channel = process.env["TWITCH_CHANNEL"] ?? "goblinl00t";
  const username = process.env["TWITCH_BOT_USERNAME"] ?? "GoblinL00tBot";

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

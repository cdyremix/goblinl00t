import { db, lootDropsTable, goblinEventsTable } from "@workspace/db";
import { logger } from "../lib/logger";
import { getPointsBalance, clampCoinAward } from "./points";
import { getChannelSettings } from "./channel-settings";

type SayFn = (channel: string, message: string) => void;

interface ChatterInfo {
  username: string;
  lastSeen: number;
}

const RECENT_CHATTERS = new Map<string, Map<string, ChatterInfo>>();
const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 min

const TICK_DEFAULT_MIN_MS = 5 * 60 * 1000;   // 5 min (default lower bound)
const TICK_DEFAULT_MAX_MS = 15 * 60 * 1000;  // 15 min (default upper bound)

// Track when each channel last received a goblin drop, so per-channel interval
// settings are honoured even though we run a single global timer.
const LAST_CHANNEL_FIRE = new Map<string, number>();

let timer: NodeJS.Timeout | null = null;
let saySink: SayFn | null = null;

export function setGoblinEventSink(say: SayFn | null): void {
  saySink = say;
}

export function trackChatter(channel: string, username: string): void {
  const ch = channel.replace(/^#/, "");
  if (!username || username === "unknown") return;
  if (!RECENT_CHATTERS.has(ch)) RECENT_CHATTERS.set(ch, new Map());
  RECENT_CHATTERS.get(ch)!.set(username, { username, lastSeen: Date.now() });
}

function pickRecentChatter(channel: string, blacklist: string[]): string | null {
  const map = RECENT_CHATTERS.get(channel);
  if (!map || map.size === 0) return null;
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const live: string[] = [];
  for (const [name, info] of map) {
    if (info.lastSeen >= cutoff) {
      if (!blacklist.includes(name)) live.push(name);
    } else {
      map.delete(name);
    }
  }
  if (live.length === 0) return null;
  return live[Math.floor(Math.random() * live.length)]!;
}

function randomAmount(): number {
  // 5–50, weighted toward smaller
  const r = Math.random();
  if (r < 0.6) return 5 + Math.floor(Math.random() * 16);   // 5–20
  if (r < 0.9) return 20 + Math.floor(Math.random() * 21);  // 20–40
  return 40 + Math.floor(Math.random() * 11);               // 40–50
}

async function fireDrop(channel: string, target: string): Promise<void> {
  const requested = randomAmount();
  const amount = await clampCoinAward(channel, target, requested);
  if (amount <= 0) return;
  await db.insert(lootDropsTable).values({
    channel,
    username: target,
    item: "Goblin's Gift",
    rarity: "uncommon",
    points: amount,
  });
  await db.insert(goblinEventsTable).values({
    channel,
    kind: "drop",
    targetUsername: target,
    amount,
  });
  saySink?.(`#${channel}`, `👺💰 The goblin appears, hands ${target} a fistful of ${amount} coins, and cackles into the shadows!`);
}

async function tick(): Promise<void> {
  try {
    for (const channel of RECENT_CHATTERS.keys()) {
      const settings = await getChannelSettings(channel);
      if (!settings.goblinEventsEnabled) continue;

      // Per-channel interval gate
      const intervalMs = settings.lootDropIntervalMinutes != null
        ? settings.lootDropIntervalMinutes * 60 * 1000
        : null; // null = use default random schedule (already handled by schedule())

      if (intervalMs !== null) {
        const lastFire = LAST_CHANNEL_FIRE.get(channel) ?? 0;
        if (Date.now() - lastFire < intervalMs) continue;
      }

      const target = pickRecentChatter(channel, settings.botBlacklist);
      if (!target) continue;

      await fireDrop(channel, target);
      LAST_CHANNEL_FIRE.set(channel, Date.now());
    }
  } catch (err) {
    logger.error({ err }, "Goblin event tick failed");
  } finally {
    schedule();
  }
}

function schedule(): void {
  const delay = TICK_DEFAULT_MIN_MS + Math.floor(Math.random() * (TICK_DEFAULT_MAX_MS - TICK_DEFAULT_MIN_MS));
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => { void tick(); }, delay);
  if (typeof timer.unref === "function") timer.unref();
}

export function startGoblinEvents(): void {
  if (timer) return;
  logger.info("Goblin events scheduler started");
  schedule();
}

export function stopGoblinEvents(): void {
  if (timer) clearTimeout(timer);
  timer = null;
}

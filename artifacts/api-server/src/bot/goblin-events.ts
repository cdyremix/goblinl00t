import { db, lootDropsTable, pointRedemptionsTable, goblinEventsTable, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { getPointsBalance, clampCoinAward } from "./points";

type SayFn = (channel: string, message: string) => void;

interface ChatterInfo {
  username: string;
  lastSeen: number;
}

const RECENT_CHATTERS = new Map<string, Map<string, ChatterInfo>>();
const RECENT_WINDOW_MS = 30 * 60 * 1000; // 30 min
const TICK_MIN_MS = 5 * 60 * 1000;        // 5 min
const TICK_MAX_MS = 15 * 60 * 1000;       // 15 min

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

function pickRecentChatter(channel: string): string | null {
  const map = RECENT_CHATTERS.get(channel);
  if (!map || map.size === 0) return null;
  const cutoff = Date.now() - RECENT_WINDOW_MS;
  const live: string[] = [];
  for (const [name, info] of map) {
    if (info.lastSeen >= cutoff) live.push(name);
    else map.delete(name);
  }
  if (live.length === 0) return null;
  return live[Math.floor(Math.random() * live.length)]!;
}

async function isEnabledForChannel(channel: string): Promise<boolean> {
  const ch = channel.replace(/^#/, "").toLowerCase();
  try {
    const [user] = await db
      .select({ enabled: usersTable.goblinEventsEnabled })
      .from(usersTable)
      .where(eq(usersTable.twitchUsername, ch))
      .limit(1);
    if (!user) return true; // default-on if no user record
    return user.enabled;
  } catch (err) {
    logger.warn({ err }, "Failed to read goblinEventsEnabled, defaulting to enabled");
    return true;
  }
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
  // Honor the channel's coin cap so random goblin gifts can't push viewers
  // past the configured ceiling (silently skip if they're already at cap).
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

async function fireSteal(channel: string, target: string): Promise<void> {
  const { balance } = await getPointsBalance(target);
  if (balance <= 0) return; // nothing to steal — silently skip
  const amount = Math.min(balance, randomAmount());
  await db.insert(pointRedemptionsTable).values({
    channel,
    username: target,
    points: amount,
    kind: "goblin_steal",
    giveawayId: null,
    ticketsAdded: 0,
  });
  await db.insert(goblinEventsTable).values({
    channel,
    kind: "steal",
    targetUsername: target,
    amount,
  });
  saySink?.(`#${channel}`, `👺🪙 The goblin SNATCHES ${amount} coins from ${target} and disappears! "MINE!"`);
}

async function tick(): Promise<void> {
  try {
    for (const channel of RECENT_CHATTERS.keys()) {
      const enabled = await isEnabledForChannel(channel);
      if (!enabled) continue;
      const target = pickRecentChatter(channel);
      if (!target) continue;
      const isDrop = Math.random() < 0.55; // slightly favor drops
      if (isDrop) await fireDrop(channel, target);
      else await fireSteal(channel, target);
    }
  } catch (err) {
    logger.error({ err }, "Goblin event tick failed");
  } finally {
    schedule();
  }
}

function schedule(): void {
  const delay = TICK_MIN_MS + Math.floor(Math.random() * (TICK_MAX_MS - TICK_MIN_MS));
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

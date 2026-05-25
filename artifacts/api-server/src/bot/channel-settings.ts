import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import type { RarityWeights } from "./inventory";

/**
 * In-memory cache of per-channel runtime settings the bot reads on every
 * chat command. Backed by `usersTable` (one row per Clerk user; the bot
 * runs in a single channel right now so we key by the lowercase channel name).
 *
 * Refresh from `routes/settings.ts` after a successful PUT so chat sees
 * changes immediately without a server restart.
 */
export interface ChannelSettings {
  lootDropsEnabled: boolean;
  coinRedemptionEnabled: boolean;
  /** What !redeem does with spent coins: entries | loot | luck */
  redeemAction: "entries" | "loot" | "luck";
  coinCap: number | null;
  goblinEventsEnabled: boolean;
  /** Minimum minutes between random goblin drops. null = random 5–15 min. */
  lootDropIntervalMinutes: number | null;
  /** Lowercase Twitch usernames the bot should completely ignore. */
  botBlacklist: string[];
  wheelMode: "auto" | "manual";
  wheelSpeed: "slow" | "medium" | "fast";
  /** Custom rarity weights for !loot rolls. null = use DEFAULT_RARITY_WEIGHTS. */
  lootRarityWeights: RarityWeights | null;
  /**
   * Minimum rarity the bot announces in chat after a successful !loot drop.
   * Drops below this tier are silently added to inventory.
   * null / "all" = announce everything (default). Buffs always announce.
   */
  lootAnnounceMinRarity: string | null;
}

const DEFAULTS: ChannelSettings = {
  lootDropsEnabled: true,
  coinRedemptionEnabled: true,
  redeemAction: "entries",
  coinCap: null,
  goblinEventsEnabled: true,
  lootDropIntervalMinutes: null,
  botBlacklist: [],
  wheelMode: "auto",
  wheelSpeed: "medium",
  lootRarityWeights: null,
  lootAnnounceMinRarity: null,
};

const cache = new Map<string, ChannelSettings>();

function normalize(channel: string): string {
  return channel.replace(/^#/, "").toLowerCase();
}

async function loadFromDb(channel: string): Promise<ChannelSettings> {
  // Today the bot runs against a single channel matching the linked
  // twitchUsername. Look up the matching users row; fall back to defaults.
  const ch = normalize(channel);
  const [user] = await db
    .select()
    .from(usersTable)
    .where(eq(usersTable.twitchUsername, ch))
    .limit(1);
  if (!user) return { ...DEFAULTS };
  return {
    lootDropsEnabled: user.lootDropsEnabled,
    coinRedemptionEnabled: user.coinRedemptionEnabled,
    coinCap: user.coinCap,
    goblinEventsEnabled: user.goblinEventsEnabled,
    lootDropIntervalMinutes: user.lootDropIntervalMinutes ?? null,
    botBlacklist: Array.isArray(user.botBlacklist) ? (user.botBlacklist as string[]).map((u) => u.toLowerCase()) : [],
    wheelMode: (user.wheelMode === "manual" ? "manual" : "auto"),
    wheelSpeed:
      user.wheelSpeed === "slow" || user.wheelSpeed === "fast" ? user.wheelSpeed : "medium",
    redeemAction:
      user.redeemAction === "loot" || user.redeemAction === "luck" ? user.redeemAction : "entries",
    lootRarityWeights: user.lootRarityWeights ?? null,
    lootAnnounceMinRarity: user.lootAnnounceMinRarity ?? null,
  };
}

export async function getChannelSettings(channel: string): Promise<ChannelSettings> {
  const ch = normalize(channel);
  const hit = cache.get(ch);
  if (hit) return hit;
  const fresh = await loadFromDb(ch);
  cache.set(ch, fresh);
  return fresh;
}

/** Force a re-read on next access. Call from settings PUT handlers. */
export function invalidateChannelSettings(channel: string): void {
  cache.delete(normalize(channel));
}

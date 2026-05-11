import { pgTable, serial, text, timestamp, boolean, integer, jsonb } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  twitchUserId: text("twitch_user_id"),
  twitchUsername: text("twitch_username"),
  twitchAccessToken: text("twitch_access_token"),
  twitchRefreshToken: text("twitch_refresh_token"),
  subscriptionTier: text("subscription_tier").notNull().default("premium"),
  botTheme: text("bot_theme").notNull().default("goblin"),
  botName: text("bot_name").notNull().default("Goblin L00t"),
  steamTradeUrl: text("steam_trade_url"),
  steamId64: text("steam_id64"),
  steamUsername: text("steam_username"),
  avatarPreset: text("avatar_preset"),
  goblinEventsEnabled: boolean("goblin_events_enabled").notNull().default(true),
  // When false, !loot will not roll buff items (only plain sellable items).
  lootDropsEnabled: boolean("loot_drops_enabled").notNull().default(true),
  // When false, viewers cannot redeem coins for giveaway entries (!redeem & POST /redeem).
  coinRedemptionEnabled: boolean("coin_redemption_enabled").notNull().default(true),
  // Per-user max coin balance. null = no cap.
  coinCap: integer("coin_cap"),
  // Elimination wheel config: 'auto' spins through all eliminations on its own,
  // 'manual' requires the streamer to click "Spin" between rounds.
  wheelMode: text("wheel_mode").notNull().default("auto"),
  // Animation pacing: 'slow' | 'medium' | 'fast'.
  wheelSpeed: text("wheel_speed").notNull().default("medium"),
  // When true, the elimination wheel shows RPG-style flavor text on each
  // elimination (e.g. "{user} was struck by a goblin's club!"). Purely
  // cosmetic — no chat side effects, just modal eye candy.
  eliminationFlavorEnabled: boolean("elimination_flavor_enabled").notNull().default(true),
  // Deprecated — kept for back-compat with existing data. Operations now
  // shows a passive "current stream" window (last 6h) instead of a manual
  // start/end stamp. Reads still consult this column when set so legacy
  // sessions don't disappear, but no UI writes to it anymore.
  streamStartedAt: timestamp("stream_started_at"),
  // Per-channel overrides for built-in command responses. Keyed by canonical
  // command name (with leading `!`). Values are message templates that may
  // include tokens like {user}, {balance}, {target} — see BUILT_IN_COMMANDS
  // in bot-service.ts for which tokens each command supports.
  commandResponses: jsonb("command_responses").$type<Record<string, string>>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  twitchUserId: text("twitch_user_id"),
  twitchUsername: text("twitch_username"),
  twitchAccessToken: text("twitch_access_token"),
  twitchRefreshToken: text("twitch_refresh_token"),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  botTheme: text("bot_theme").notNull().default("goblin"),
  botName: text("bot_name").notNull().default("GoblinL00t"),
  steamTradeUrl: text("steam_trade_url"),
  steamId64: text("steam_id64"),
  steamUsername: text("steam_username"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

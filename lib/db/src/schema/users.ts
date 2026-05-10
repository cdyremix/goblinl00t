import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const usersTable = pgTable("users", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id").notNull().unique(),
  twitchUserId: text("twitch_user_id"),
  twitchUsername: text("twitch_username"),
  twitchAccessToken: text("twitch_access_token"),
  twitchRefreshToken: text("twitch_refresh_token"),
  subscriptionTier: text("subscription_tier").notNull().default("free"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

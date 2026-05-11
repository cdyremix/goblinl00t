import { pgTable, text, serial, integer, boolean, timestamp } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const giveawayPresetsTable = pgTable("giveaway_presets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
  channel: text("channel").notNull(),
  title: text("title").notNull(),
  description: text("description"),
  prize: text("prize").notNull(),
  prizeKind: text("prize_kind").notNull().default("cs2"),
  prizeBotCoins: integer("prize_bot_coins"),
  prizeBotRarity: text("prize_bot_rarity"),
  keyword: text("keyword").notNull().default("!enter"),
  requireFollower: boolean("require_follower").notNull().default(false),
  subscriberOnly: boolean("subscriber_only").notNull().default(false),
  minSubTier: text("min_sub_tier"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type GiveawayPreset = typeof giveawayPresetsTable.$inferSelect;
export type NewGiveawayPreset = typeof giveawayPresetsTable.$inferInsert;

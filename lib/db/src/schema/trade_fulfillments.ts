import { pgTable, serial, text, integer, timestamp } from "drizzle-orm/pg-core";

export const tradeFulfillmentsTable = pgTable("trade_fulfillments", {
  id: serial("id").primaryKey(),
  giveawayId: integer("giveaway_id").notNull(),
  winnerTwitchUsername: text("winner_twitch_username").notNull(),
  prize: text("prize").notNull(),
  steamTradeUrl: text("steam_trade_url"),
  status: text("status").notNull().default("pending"),
  tradeLockUntil: timestamp("trade_lock_until"),
  streamerNotes: text("streamer_notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type TradeFulfillment = typeof tradeFulfillmentsTable.$inferSelect;

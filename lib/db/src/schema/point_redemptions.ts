import { pgTable, text, serial, integer, timestamp } from "drizzle-orm/pg-core";

export const pointRedemptionsTable = pgTable("point_redemptions", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull().default("goblinl00t"),
  username: text("username").notNull(),
  kind: text("kind").notNull().default("entries"),
  points: integer("points").notNull(),
  giveawayId: integer("giveaway_id"),
  ticketsAdded: integer("tickets_added").notNull().default(0),
  redeemedAt: timestamp("redeemed_at").notNull().defaultNow(),
});

export type PointRedemption = typeof pointRedemptionsTable.$inferSelect;
export type InsertPointRedemption = typeof pointRedemptionsTable.$inferInsert;

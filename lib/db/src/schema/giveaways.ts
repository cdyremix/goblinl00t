import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const giveawayStatusEnum = pgEnum("giveaway_status", ["pending", "active", "ended"]);

export const giveawaysTable = pgTable("giveaways", {
  id: serial("id").primaryKey(),
  title: text("title").notNull(),
  prize: text("prize").notNull(),
  description: text("description"),
  status: giveawayStatusEnum("status").notNull().default("pending"),
  channel: text("channel").notNull().default("goblinl00t"),
  keyword: text("keyword").notNull().default("!enter"),
  maxEntries: integer("max_entries"),
  winnerId: integer("winner_id"),
  winnerUsername: text("winner_username"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  startedAt: timestamp("started_at"),
  endedAt: timestamp("ended_at"),
});

export const insertGiveawaySchema = createInsertSchema(giveawaysTable).omit({
  id: true,
  createdAt: true,
  startedAt: true,
  endedAt: true,
  winnerId: true,
  winnerUsername: true,
});

export type InsertGiveaway = z.infer<typeof insertGiveawaySchema>;
export type Giveaway = typeof giveawaysTable.$inferSelect;

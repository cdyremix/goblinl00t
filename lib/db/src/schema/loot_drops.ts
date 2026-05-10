import { pgTable, text, serial, integer, timestamp, pgEnum } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const rarityEnum = pgEnum("loot_rarity", ["common", "uncommon", "rare", "epic", "legendary"]);

export const lootDropsTable = pgTable("loot_drops", {
  id: serial("id").primaryKey(),
  username: text("username").notNull(),
  item: text("item").notNull(),
  rarity: rarityEnum("rarity").notNull(),
  points: integer("points").notNull().default(0),
  channel: text("channel").notNull().default("goblinl00t"),
  droppedAt: timestamp("dropped_at").notNull().defaultNow(),
});

export const insertLootDropSchema = createInsertSchema(lootDropsTable).omit({
  id: true,
  droppedAt: true,
});

export type InsertLootDrop = z.infer<typeof insertLootDropSchema>;
export type LootDrop = typeof lootDropsTable.$inferSelect;

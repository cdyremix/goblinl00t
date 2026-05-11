import { pgTable, text, serial, integer, boolean, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { rarityEnum } from "./loot_drops";

export const userInventoryTable = pgTable(
  "user_inventory",
  {
    id: serial("id").primaryKey(),
    channel: text("channel").notNull().default("goblinl00t"),
    username: text("username").notNull(),
    item: text("item").notNull(),
    rarity: rarityEnum("rarity").notNull(),
    kind: text("kind").notNull().default("item"),
    buffEffect: text("buff_effect"),
    coinValue: integer("coin_value").notNull().default(0),
    chargesRemaining: integer("charges_remaining").notNull().default(0),
    isActive: boolean("is_active").notNull().default(false),
    acquiredAt: timestamp("acquired_at").notNull().defaultNow(),
  },
  (t) => ({
    userIdx: index("user_inventory_user_idx").on(t.channel, t.username),
  })
);

export const insertUserInventorySchema = createInsertSchema(userInventoryTable).omit({
  id: true,
  acquiredAt: true,
});

export type InsertUserInventoryItem = z.infer<typeof insertUserInventorySchema>;
export type UserInventoryItem = typeof userInventoryTable.$inferSelect;

export const INVENTORY_CAP = 5;

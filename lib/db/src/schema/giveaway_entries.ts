import { pgTable, text, serial, integer, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";
import { giveawaysTable } from "./giveaways";

export const giveawayEntriesTable = pgTable(
  "giveaway_entries",
  {
    id: serial("id").primaryKey(),
    giveawayId: integer("giveaway_id").notNull().references(() => giveawaysTable.id, { onDelete: "cascade" }),
    username: text("username").notNull(),
    tickets: integer("tickets").notNull().default(1),
    enteredAt: timestamp("entered_at").notNull().defaultNow(),
  },
  (t) => ({
    giveawayUserUq: uniqueIndex("giveaway_entries_giveaway_user_uq").on(t.giveawayId, t.username),
  })
);

export const insertGiveawayEntrySchema = createInsertSchema(giveawayEntriesTable).omit({
  id: true,
  enteredAt: true,
});

export type InsertGiveawayEntry = z.infer<typeof insertGiveawayEntrySchema>;
export type GiveawayEntry = typeof giveawayEntriesTable.$inferSelect;

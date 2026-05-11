import { pgTable, text, serial, integer, timestamp, index } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const goblinEventsTable = pgTable(
  "goblin_events",
  {
    id: serial("id").primaryKey(),
    channel: text("channel").notNull().default("goblinl00t"),
    kind: text("kind").notNull(),
    targetUsername: text("target_username").notNull(),
    amount: integer("amount").notNull().default(0),
    occurredAt: timestamp("occurred_at").notNull().defaultNow(),
  },
  (t) => ({
    channelIdx: index("goblin_events_channel_idx").on(t.channel, t.occurredAt),
  })
);

export const insertGoblinEventSchema = createInsertSchema(goblinEventsTable).omit({
  id: true,
  occurredAt: true,
});

export type InsertGoblinEvent = z.infer<typeof insertGoblinEventSchema>;
export type GoblinEvent = typeof goblinEventsTable.$inferSelect;

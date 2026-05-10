import { pgTable, text, serial, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const commandLogsTable = pgTable("command_logs", {
  id: serial("id").primaryKey(),
  command: text("command").notNull(),
  username: text("username").notNull(),
  channel: text("channel").notNull(),
  executedAt: timestamp("executed_at").notNull().defaultNow(),
});

export const insertCommandLogSchema = createInsertSchema(commandLogsTable).omit({
  id: true,
  executedAt: true,
});

export type InsertCommandLog = z.infer<typeof insertCommandLogSchema>;
export type CommandLog = typeof commandLogsTable.$inferSelect;

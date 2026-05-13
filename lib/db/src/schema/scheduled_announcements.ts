import { pgTable, serial, text, integer, boolean, timestamp } from "drizzle-orm/pg-core";

export const scheduledAnnouncementsTable = pgTable("scheduled_announcements", {
  id: serial("id").primaryKey(),
  channel: text("channel").notNull(),
  message: text("message").notNull(),
  intervalMinutes: integer("interval_minutes").notNull().default(30),
  enabled: boolean("enabled").notNull().default(true),
  lastPostedAt: timestamp("last_posted_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

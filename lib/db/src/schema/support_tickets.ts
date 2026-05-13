import { pgTable, serial, text, timestamp, pgEnum } from "drizzle-orm/pg-core";

export const ticketCategoryEnum = pgEnum("ticket_category", [
  "bug",
  "feature",
  "help",
  "other",
]);

export const ticketStatusEnum = pgEnum("ticket_status", [
  "open",
  "in_progress",
  "resolved",
  "closed",
]);

/**
 * In-house support tickets submitted via the Help & Guide page.
 * `clerkUserId` and `twitchUsername` are populated when the submitter
 * is logged in; anonymous submissions (e.g. pre-login) only require email.
 */
export const supportTicketsTable = pgTable("support_tickets", {
  id: serial("id").primaryKey(),
  clerkUserId: text("clerk_user_id"),
  email: text("email").notNull(),
  twitchUsername: text("twitch_username"),
  category: ticketCategoryEnum("category").notNull().default("help"),
  subject: text("subject").notNull(),
  message: text("message").notNull(),
  status: ticketStatusEnum("status").notNull().default("open"),
  adminNote: text("admin_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type SupportTicket = typeof supportTicketsTable.$inferSelect;
export type NewSupportTicket = typeof supportTicketsTable.$inferInsert;

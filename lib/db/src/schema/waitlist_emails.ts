import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

/**
 * Pre-launch waitlist signups captured by the maintenance-mode modal.
 * One row per email — `email` is unique so repeat submissions during
 * maintenance windows don't bloat the table. Timestamp lets us sort
 * by signup recency and (eventually) export to a mailer.
 */
export const waitlistEmailsTable = pgTable("waitlist_emails", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  source: text("source"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export type WaitlistEmail = typeof waitlistEmailsTable.$inferSelect;
export type NewWaitlistEmail = typeof waitlistEmailsTable.$inferInsert;

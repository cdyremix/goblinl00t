import { pgTable, integer, boolean, timestamp } from "drizzle-orm/pg-core";

/**
 * Singleton row keyed on id=1. Holds global app-level toggles that
 * aren't tied to any single streamer (currently just the maintenance
 * wall). Lazily upserted on first read by `lib/maintenance-state.ts`.
 *
 * Adding a new global flag? Just add a column here with a sane default
 * and extend the helper — no other migration needed.
 */
export const appSettingsTable = pgTable("app_settings", {
  id: integer("id").primaryKey(),
  maintenanceMode: boolean("maintenance_mode").notNull().default(false),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export type AppSettings = typeof appSettingsTable.$inferSelect;

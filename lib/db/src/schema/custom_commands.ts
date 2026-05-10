import { pgTable, text, serial, integer, boolean, timestamp, unique } from "drizzle-orm/pg-core";
import { usersTable } from "./users";

export const customCommandsTable = pgTable(
  "custom_commands",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id").notNull().references(() => usersTable.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    responseText: text("response_text").notNull(),
    cooldownSeconds: integer("cooldown_seconds").notNull().default(10),
    enabled: boolean("enabled").notNull().default(true),
    theme: text("theme").notNull().default("both"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    uniqUserName: unique().on(t.userId, t.name),
  }),
);

export type CustomCommand = typeof customCommandsTable.$inferSelect;
export type NewCustomCommand = typeof customCommandsTable.$inferInsert;

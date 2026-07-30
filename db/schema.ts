import { bigint, boolean, index, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

export const operations = pgTable("operations", {
  id: uuid().primaryKey(),
  userId: text("user_id").notNull(),
  tool: text().notNull(),
  filename: text().notNull(),
  mime: text().notNull(),
  size: bigint({ mode: "number" }).notNull(),
  favorite: boolean().notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("operations_user_created_idx").on(table.userId, table.createdAt)]);

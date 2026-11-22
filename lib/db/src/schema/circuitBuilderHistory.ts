import {
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const circuitBuilderHistory = pgTable(
  "circuit_studio_history",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    title: text("title").notNull(),
    mode: text("mode").notNull(),
    savedState: jsonb("saved_state").$type<unknown>().notNull(),
    currentSpec: jsonb("current_spec").$type<unknown>().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userSessionIndex: uniqueIndex("circuit_studio_history_user_session_idx").on(
      table.userId,
      table.sessionId,
    ),
    userUpdatedIndex: index("circuit_studio_history_user_updated_idx").on(
      table.userId,
      table.updatedAt,
    ),
  }),
);

export type CircuitBuilderHistoryRecord = typeof circuitBuilderHistory.$inferSelect;

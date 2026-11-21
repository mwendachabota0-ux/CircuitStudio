import { createInsertSchema } from "drizzle-zod";
import { pgTable, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const circuitBuilderHistoryDeletions = pgTable(
  "circuit_studio_history_deletions",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    deletedAt: timestamp("deleted_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userSessionIndex: uniqueIndex("circuit_studio_history_deletions_user_session_idx").on(
      table.userId,
      table.sessionId,
    ),
  }),
);

export const insertCircuitBuilderHistoryDeletionSchema = createInsertSchema(
  circuitBuilderHistoryDeletions,
).omit({ deletedAt: true });

export type InsertCircuitBuilderHistoryDeletion = z.infer<
  typeof insertCircuitBuilderHistoryDeletionSchema
>;
export type CircuitBuilderHistoryDeletion =
  typeof circuitBuilderHistoryDeletions.$inferSelect;

import {
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const circuitStudioV2Drafts = pgTable(
  "circuit_studio_v2_drafts",
  {
    userId: text("user_id").notNull(),
    sessionId: text("session_id").notNull(),
    representation: text("representation").notNull(),
    schemaVersion: integer("schema_version").notNull(),
    draft: jsonb("draft").$type<unknown>().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull(),
  },
  (table) => ({
    userSessionPrimaryKey: primaryKey({
      name: "circuit_studio_v2_drafts_user_session_pk",
      columns: [table.userId, table.sessionId],
    }),
  }),
);

export type CircuitStudioV2DraftRecord =
  typeof circuitStudioV2Drafts.$inferSelect;

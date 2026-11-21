import {
  bigint,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const circuitAiUsage = pgTable("circuit_studio_ai_usage", {
  userId: text("user_id").primaryKey(),
  tokensUsed: bigint("tokens_used", { mode: "number" }).notNull().default(0),
  selectedKeyNumber: integer("selected_key_number").notNull().default(1),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export const circuitAiReservations = pgTable(
  "circuit_studio_ai_reservations",
  {
    requestId: text("request_id").primaryKey(),
    userId: text("user_id").notNull(),
    reservedTokens: bigint("reserved_tokens", { mode: "number" }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    userIdIndex: index("circuit_studio_ai_reservations_user_idx").on(
      table.userId,
    ),
    createdAtIndex: index("circuit_studio_ai_reservations_created_idx").on(
      table.createdAt,
    ),
  }),
);

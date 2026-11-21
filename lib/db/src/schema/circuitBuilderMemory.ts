import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

export const circuitBuilderMemories = pgTable(
  "circuit_studio_memories",
  {
    id: serial("id").primaryKey(),
    userId: text("user_id").notNull(),
    category: text("category").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    userIdIndex: index("circuit_studio_memories_user_idx").on(table.userId),
    updatedAtIndex: index("circuit_studio_memories_updated_idx").on(
      table.updatedAt,
    ),
  }),
);

export type CircuitBuilderMemory = typeof circuitBuilderMemories.$inferSelect;

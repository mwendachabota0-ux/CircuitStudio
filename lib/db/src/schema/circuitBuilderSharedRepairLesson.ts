import { createInsertSchema } from "drizzle-zod";
import {
  index,
  integer,
  pgTable,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { z } from "zod/v4";

export const circuitBuilderSharedRepairLessons = pgTable(
  "circuit_studio_shared_repair_lessons",
  {
    id: serial("id").primaryKey(),
    content: text("content").notNull(),
    contentKey: text("content_key").notNull(),
    occurrenceCount: integer("occurrence_count").notNull().default(1),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => ({
    contentKeyUnique: uniqueIndex(
      "circuit_studio_shared_repair_lesson_key_unique",
    ).on(table.contentKey),
    popularityIndex: index(
      "circuit_studio_shared_repair_lesson_popularity_idx",
    ).on(table.occurrenceCount.desc(), table.updatedAt.desc()),
  }),
);

export const insertCircuitBuilderSharedRepairLessonSchema = createInsertSchema(
  circuitBuilderSharedRepairLessons,
).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCircuitBuilderSharedRepairLesson = z.infer<
  typeof insertCircuitBuilderSharedRepairLessonSchema
>;
export type CircuitBuilderSharedRepairLesson =
  typeof circuitBuilderSharedRepairLessons.$inferSelect;

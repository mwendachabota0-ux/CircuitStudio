import { and, desc, eq, inArray, notInArray, sql } from "drizzle-orm";
import {
  circuitBuilderMemories,
  circuitBuilderSharedRepairLessons,
  db,
} from "@workspace/db";
import {
  normalizeCircuitBuilderMemoryContent,
  type CircuitBuilderMemoryRecord,
  type CircuitBuilderMemorySuggestion,
} from "./circuitBuilderMemory";

const MAX_SAVED_MEMORIES = 30;
const MAX_SHARED_REPAIR_LESSONS = 500;

export async function listUserCircuitBuilderMemories(
  userId: string,
): Promise<CircuitBuilderMemoryRecord[]> {
  const rows = await db
    .select({
      id: circuitBuilderMemories.id,
      category: circuitBuilderMemories.category,
      content: circuitBuilderMemories.content,
      updatedAt: circuitBuilderMemories.updatedAt,
    })
    .from(circuitBuilderMemories)
    .where(eq(circuitBuilderMemories.userId, userId))
    .orderBy(desc(circuitBuilderMemories.updatedAt))
    .limit(MAX_SAVED_MEMORIES);
  return rows.map((memory) => ({
    ...memory,
    category: memory.category as CircuitBuilderMemoryRecord["category"],
  }));
}

export async function listSharedCircuitBuilderRepairLessons(): Promise<string[]> {
  const rows = await db
    .select({ content: circuitBuilderSharedRepairLessons.content })
    .from(circuitBuilderSharedRepairLessons)
    .orderBy(
      desc(circuitBuilderSharedRepairLessons.occurrenceCount),
      desc(circuitBuilderSharedRepairLessons.updatedAt),
    )
    .limit(MAX_SHARED_REPAIR_LESSONS);
  return rows.map((row) => row.content);
}

export async function saveSharedCircuitBuilderRepairLesson(
  content: string,
): Promise<boolean> {
  const normalized = normalizeCircuitBuilderMemoryContent(content);
  if (!normalized) return false;
  const contentKey = normalized.toLocaleLowerCase();

  await db.transaction(async (tx) => {
    await tx
      .insert(circuitBuilderSharedRepairLessons)
      .values({ content: normalized, contentKey })
      .onConflictDoUpdate({
        target: circuitBuilderSharedRepairLessons.contentKey,
        set: {
          occurrenceCount: sql`LEAST(${circuitBuilderSharedRepairLessons.occurrenceCount} + 1, 100)`,
          updatedAt: new Date(),
        },
      });

    const retained = await tx
      .select({ id: circuitBuilderSharedRepairLessons.id })
      .from(circuitBuilderSharedRepairLessons)
      .orderBy(
        desc(circuitBuilderSharedRepairLessons.occurrenceCount),
        desc(circuitBuilderSharedRepairLessons.updatedAt),
      )
      .limit(MAX_SHARED_REPAIR_LESSONS);
    if (retained.length) {
      await tx
        .delete(circuitBuilderSharedRepairLessons)
        .where(notInArray(
          circuitBuilderSharedRepairLessons.id,
          retained.map((lesson) => lesson.id),
        ));
    }
  });

  return true;
}

export async function applyGeneratedCircuitBuilderMemoryChanges(
  userId: string,
  existingMemories: CircuitBuilderMemoryRecord[],
  updates: CircuitBuilderMemorySuggestion[],
  removals: number[],
): Promise<number> {
  const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]));
  const validRemovals = [...new Set(removals)].filter((id) =>
    existingById.has(id),
  );
  let changedCount = 0;

  await db.transaction(async (tx) => {
    if (validRemovals.length > 0) {
      await tx
        .delete(circuitBuilderMemories)
        .where(
          and(
            eq(circuitBuilderMemories.userId, userId),
            inArray(circuitBuilderMemories.id, validRemovals),
          ),
        );
    }

    const removedIds = new Set(validRemovals);
    const workingMemories = existingMemories.filter(
      (memory) => !removedIds.has(memory.id),
    );

    for (const suggestion of updates) {
      const content = normalizeCircuitBuilderMemoryContent(suggestion.content);
      if (!content) continue;

      if (suggestion.id !== undefined) {
        const existing = workingMemories.find(
          (memory) => memory.id === suggestion.id,
        );
        if (!existing) continue;

        const duplicate = workingMemories.find(
          (memory) =>
            memory.id !== existing.id &&
            memory.category === suggestion.category &&
            normalizeCircuitBuilderMemoryContent(memory.content).toLowerCase() ===
              content.toLowerCase(),
        );
        if (duplicate) {
          await tx
            .delete(circuitBuilderMemories)
            .where(
              and(
                eq(circuitBuilderMemories.userId, userId),
                eq(circuitBuilderMemories.id, existing.id),
              ),
            );
          continue;
        }

        if (
          existing.category === suggestion.category &&
          normalizeCircuitBuilderMemoryContent(existing.content) === content
        ) {
          continue;
        }

        const updatedAt = new Date();
        await tx
          .update(circuitBuilderMemories)
          .set({
            category: suggestion.category,
            content,
            updatedAt,
          })
          .where(
            and(
              eq(circuitBuilderMemories.userId, userId),
              eq(circuitBuilderMemories.id, existing.id),
            ),
          );
        Object.assign(existing, {
          category: suggestion.category,
          content,
          updatedAt,
        });
        changedCount += 1;
        continue;
      }

      const duplicate = workingMemories.find(
        (memory) =>
          memory.category === suggestion.category &&
          normalizeCircuitBuilderMemoryContent(memory.content).toLowerCase() ===
            content.toLowerCase(),
      );
      if (duplicate) continue;

      const [inserted] = await tx
        .insert(circuitBuilderMemories)
        .values({ userId, category: suggestion.category, content })
        .returning({
          id: circuitBuilderMemories.id,
          category: circuitBuilderMemories.category,
          content: circuitBuilderMemories.content,
          updatedAt: circuitBuilderMemories.updatedAt,
        });
      if (inserted) {
        workingMemories.push({
          ...inserted,
          category: inserted.category as CircuitBuilderMemoryRecord["category"],
        });
        changedCount += 1;
      }
    }

    const saved = await tx
      .select({ id: circuitBuilderMemories.id })
      .from(circuitBuilderMemories)
      .where(eq(circuitBuilderMemories.userId, userId))
      .orderBy(desc(circuitBuilderMemories.updatedAt));
    const overflowIds = saved.slice(MAX_SAVED_MEMORIES).map((memory) => memory.id);
    if (overflowIds.length > 0) {
      await tx
        .delete(circuitBuilderMemories)
        .where(
          and(
            eq(circuitBuilderMemories.userId, userId),
            inArray(circuitBuilderMemories.id, overflowIds),
          ),
        );
    }
  });

  return changedCount;
}

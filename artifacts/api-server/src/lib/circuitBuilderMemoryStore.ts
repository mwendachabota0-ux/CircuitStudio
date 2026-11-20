import { and, desc, eq, inArray } from "drizzle-orm";
import { circuitBuilderMemories, db } from "@workspace/db";
import {
  normalizeCircuitBuilderMemoryContent,
  type CircuitBuilderMemoryRecord,
  type CircuitBuilderMemorySuggestion,
} from "./circuitBuilderMemory";

const MAX_SAVED_MEMORIES = 30;

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

export async function applyGeneratedCircuitBuilderMemoryChanges(
  userId: string,
  existingMemories: CircuitBuilderMemoryRecord[],
  updates: CircuitBuilderMemorySuggestion[],
  removals: number[],
): Promise<void> {
  const existingById = new Map(existingMemories.map((memory) => [memory.id, memory]));
  const validRemovals = [...new Set(removals)].filter((id) =>
    existingById.has(id),
  );

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
    const stillAvailable = existingMemories.filter(
      (memory) => !removedIds.has(memory.id),
    );

    for (const suggestion of updates) {
      const content = normalizeCircuitBuilderMemoryContent(suggestion.content);
      if (!content) continue;

      if (suggestion.id !== undefined) {
        const existing = stillAvailable.find(
          (memory) => memory.id === suggestion.id,
        );
        if (!existing) continue;

        const duplicate = stillAvailable.find(
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

        await tx
          .update(circuitBuilderMemories)
          .set({
            category: suggestion.category,
            content,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(circuitBuilderMemories.userId, userId),
              eq(circuitBuilderMemories.id, existing.id),
            ),
          );
        continue;
      }

      const duplicate = stillAvailable.find(
        (memory) =>
          memory.category === suggestion.category &&
          normalizeCircuitBuilderMemoryContent(memory.content).toLowerCase() ===
            content.toLowerCase(),
      );
      if (duplicate) continue;

      await tx.insert(circuitBuilderMemories).values({
        userId,
        category: suggestion.category,
        content,
      });
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
}

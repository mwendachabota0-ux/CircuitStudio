import { and, eq, sql } from "drizzle-orm";
import { circuitStudioV2Drafts, db } from "@workspace/db";
import {
  createCircuitDocumentV2DraftPersistence,
  type CircuitDocumentV2DraftRecord,
  type CircuitDocumentV2DraftRepository,
} from "./circuitDocumentDraftService";

const databaseRepository: CircuitDocumentV2DraftRepository = {
  async createIfAbsent(record: CircuitDocumentV2DraftRecord) {
    const [created] = await db
      .insert(circuitStudioV2Drafts)
      .values(record)
      .onConflictDoNothing({
        target: [
          circuitStudioV2Drafts.userId,
          circuitStudioV2Drafts.sessionId,
        ],
      })
      .returning();
    return created ?? null;
  },

  async updateIfRevision(
    record: CircuitDocumentV2DraftRecord,
    expectedRevision: number,
  ) {
    const [updated] = await db
      .update(circuitStudioV2Drafts)
      .set({
        representation: record.representation,
        schemaVersion: record.schemaVersion,
        revision: sql`${circuitStudioV2Drafts.revision} + 1`,
        draft: record.draft,
        updatedAt: record.updatedAt,
      })
      .where(
        and(
          eq(circuitStudioV2Drafts.userId, record.userId),
          eq(circuitStudioV2Drafts.sessionId, record.sessionId),
          eq(circuitStudioV2Drafts.revision, expectedRevision),
        ),
      )
      .returning();
    return updated ?? null;
  },

  async getOwned(userId: string, sessionId: string) {
    const [record] = await db
      .select()
      .from(circuitStudioV2Drafts)
      .where(
        and(
          eq(circuitStudioV2Drafts.userId, userId),
          eq(circuitStudioV2Drafts.sessionId, sessionId),
        ),
      )
      .limit(1);
    return record ?? null;
  },
};

export const circuitDocumentV2DraftPersistence =
  createCircuitDocumentV2DraftPersistence(databaseRepository);

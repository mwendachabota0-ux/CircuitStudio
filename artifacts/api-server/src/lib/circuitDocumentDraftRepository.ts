import { and, eq } from "drizzle-orm";
import { circuitStudioV2Drafts, db } from "@workspace/db";
import {
  createCircuitDocumentV2DraftPersistence,
  type CircuitDocumentV2DraftRecord,
  type CircuitDocumentV2DraftRepository,
} from "./circuitDocumentDraftService";

const databaseRepository: CircuitDocumentV2DraftRepository = {
  async upsertOwned(record: CircuitDocumentV2DraftRecord): Promise<void> {
    await db.transaction(async (transaction) => {
      await transaction
        .insert(circuitStudioV2Drafts)
        .values(record)
        .onConflictDoUpdate({
          target: [
            circuitStudioV2Drafts.userId,
            circuitStudioV2Drafts.sessionId,
          ],
          set: {
            representation: record.representation,
            schemaVersion: record.schemaVersion,
            draft: record.draft,
            updatedAt: record.updatedAt,
          },
        });
    });
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

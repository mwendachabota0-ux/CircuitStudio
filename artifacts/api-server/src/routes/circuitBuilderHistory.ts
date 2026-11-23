import {
  DeleteCircuitBuilderHistoryParams,
  ListDeletedCircuitBuilderHistoryResponse,
  ListCircuitBuilderHistoryResponse,
  SyncCircuitBuilderHistoryBody,
  SyncCircuitBuilderHistoryResponse,
} from "@workspace/api-zod";
import { and, desc, eq, lt } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  circuitBuilderHistory,
  circuitBuilderHistoryDeletions,
  db,
} from "@workspace/db";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to access saved conversations." });
    return;
  }
  next();
};

router.get(
  "/circuit-builder/history",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    const records = await db
      .select()
      .from(circuitBuilderHistory)
      .where(eq(circuitBuilderHistory.userId, userId))
      .orderBy(desc(circuitBuilderHistory.updatedAt));
    const deletions = await db
      .select({ sessionId: circuitBuilderHistoryDeletions.sessionId })
      .from(circuitBuilderHistoryDeletions)
      .where(eq(circuitBuilderHistoryDeletions.userId, userId));
    const deletedSessionIds = new Set(deletions.map((deletion) => deletion.sessionId));

    res.json(
      ListCircuitBuilderHistoryResponse.parse(
        records.filter((record) => !deletedSessionIds.has(record.sessionId)).map((record) => ({
          id: record.sessionId,
          title: record.title,
          createdAt: record.createdAt.getTime(),
          updatedAt: record.updatedAt.getTime(),
          mode: record.mode,
          saved: record.savedState,
          currentSpec: record.currentSpec,
        })),
      ),
    );
  },
);

router.get(
  "/circuit-builder/history/deletions",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    const records = await db
      .select()
      .from(circuitBuilderHistoryDeletions)
      .where(eq(circuitBuilderHistoryDeletions.userId, userId))
      .orderBy(desc(circuitBuilderHistoryDeletions.deletedAt));

    res.json(
      ListDeletedCircuitBuilderHistoryResponse.parse(
        records.map((record) => ({
          sessionId: record.sessionId,
          deletedAt: record.deletedAt.getTime(),
        })),
      ),
    );
  },
);

router.put(
  "/circuit-builder/history",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = SyncCircuitBuilderHistoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = getAuth(req).userId!;
    const uniqueSessions = [
      ...new Map(parsed.data.sessions.map((session) => [session.id, session])).values(),
    ];
    let savedCount = 0;

    await db.transaction(async (transaction) => {
      const deletions = await transaction
        .select({ sessionId: circuitBuilderHistoryDeletions.sessionId })
        .from(circuitBuilderHistoryDeletions)
        .where(eq(circuitBuilderHistoryDeletions.userId, userId));
      const deletedSessionIds = new Set(deletions.map((deletion) => deletion.sessionId));

      for (const session of uniqueSessions) {
        if (deletedSessionIds.has(session.id)) continue;
        const updatedAt = new Date(session.updatedAt);
        const [saved] = await transaction
          .insert(circuitBuilderHistory)
          .values({
            userId,
            sessionId: session.id,
            title: session.title,
            mode: session.mode,
            savedState: session.saved,
            currentSpec: session.currentSpec,
            createdAt: new Date(session.createdAt),
            updatedAt,
          })
          .onConflictDoUpdate({
            target: [circuitBuilderHistory.userId, circuitBuilderHistory.sessionId],
            set: {
              title: session.title,
              mode: session.mode,
              savedState: session.saved,
              currentSpec: session.currentSpec,
              createdAt: new Date(session.createdAt),
              updatedAt,
            },
            setWhere: lt(circuitBuilderHistory.updatedAt, updatedAt),
          })
          .returning({ sessionId: circuitBuilderHistory.sessionId });

        if (saved) savedCount += 1;
      }
    });

    res.json(SyncCircuitBuilderHistoryResponse.parse({ savedCount }));
  },
);

router.delete(
  "/circuit-builder/history/:sessionId",
  requireAuth,
  async (req, res): Promise<void> => {
    const parsed = DeleteCircuitBuilderHistoryParams.safeParse(req.params);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = getAuth(req).userId!;
    await db.transaction(async (transaction) => {
      await transaction
        .delete(circuitBuilderHistory)
        .where(and(
          eq(circuitBuilderHistory.userId, userId),
          eq(circuitBuilderHistory.sessionId, parsed.data.sessionId),
        ));
      await transaction
        .insert(circuitBuilderHistoryDeletions)
        .values({
          userId,
          sessionId: parsed.data.sessionId,
        })
        .onConflictDoNothing();
    });

    res.sendStatus(204);
  },
);

export default router;

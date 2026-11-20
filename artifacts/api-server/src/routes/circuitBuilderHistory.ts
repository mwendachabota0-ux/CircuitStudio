import {
  ListCircuitBuilderHistoryResponse,
  SyncCircuitBuilderHistoryBody,
  SyncCircuitBuilderHistoryResponse,
} from "@workspace/api-zod";
import { desc, eq, lte } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter, type RequestHandler } from "express";
import { circuitBuilderHistory, db } from "@workspace/db";

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

    res.json(
      ListCircuitBuilderHistoryResponse.parse(
        records.map((record) => ({
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
      for (const session of uniqueSessions) {
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
            setWhere: lte(circuitBuilderHistory.updatedAt, updatedAt),
          })
          .returning({ sessionId: circuitBuilderHistory.sessionId });

        if (saved) savedCount += 1;
      }
    });

    res.json(SyncCircuitBuilderHistoryResponse.parse({ savedCount }));
  },
);

export default router;

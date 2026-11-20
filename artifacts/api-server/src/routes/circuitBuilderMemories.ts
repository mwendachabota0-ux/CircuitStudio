import {
  DeleteCircuitBuilderMemoryParams,
  ListCircuitBuilderMemoriesResponse,
  UpdateCircuitBuilderMemoryBody,
  UpdateCircuitBuilderMemoryParams,
  UpdateCircuitBuilderMemoryResponse,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import { Router, type IRouter, type RequestHandler } from "express";
import { circuitBuilderMemories, db } from "@workspace/db";
import { normalizeCircuitBuilderMemoryContent } from "../lib/circuitBuilderMemory";
import { listUserCircuitBuilderMemories } from "../lib/circuitBuilderMemoryStore";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to manage saved assumptions." });
    return;
  }
  next();
};

router.get(
  "/circuit-builder/memories",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    const memories = await listUserCircuitBuilderMemories(userId);
    res.json(ListCircuitBuilderMemoriesResponse.parse(memories));
  },
);

router.delete(
  "/circuit-builder/memories",
  requireAuth,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId!;
    await db
      .delete(circuitBuilderMemories)
      .where(eq(circuitBuilderMemories.userId, userId));
    res.sendStatus(204);
  },
);

router.patch(
  "/circuit-builder/memories/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = UpdateCircuitBuilderMemoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const parsed = UpdateCircuitBuilderMemoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const content = normalizeCircuitBuilderMemoryContent(parsed.data.content);
    if (!content) {
      res.status(400).json({ error: "Assumption text cannot be empty." });
      return;
    }

    const userId = getAuth(req).userId!;
    const [memory] = await db
      .update(circuitBuilderMemories)
      .set({ content, updatedAt: new Date() })
      .where(
        and(
          eq(circuitBuilderMemories.id, params.data.id),
          eq(circuitBuilderMemories.userId, userId),
        ),
      )
      .returning({
        id: circuitBuilderMemories.id,
        category: circuitBuilderMemories.category,
        content: circuitBuilderMemories.content,
        updatedAt: circuitBuilderMemories.updatedAt,
      });

    if (!memory) {
      res.status(404).json({ error: "Saved assumption not found." });
      return;
    }

    res.json(UpdateCircuitBuilderMemoryResponse.parse(memory));
  },
);

router.delete(
  "/circuit-builder/memories/:id",
  requireAuth,
  async (req, res): Promise<void> => {
    const params = DeleteCircuitBuilderMemoryParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }

    const userId = getAuth(req).userId!;
    const [memory] = await db
      .delete(circuitBuilderMemories)
      .where(
        and(
          eq(circuitBuilderMemories.id, params.data.id),
          eq(circuitBuilderMemories.userId, userId),
        ),
      )
      .returning({ id: circuitBuilderMemories.id });

    if (!memory) {
      res.status(404).json({ error: "Saved assumption not found." });
      return;
    }

    res.sendStatus(204);
  },
);

export default router;

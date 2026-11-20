import {
  ChatWithCircuitBuilderResponse,
  DeleteCircuitBuilderMemoryParams,
  LearnFromCircuitBuilderHistoryBody,
  LearnFromCircuitBuilderHistoryResponse,
  ListCircuitBuilderMemoriesResponse,
  UpdateCircuitBuilderMemoryBody,
  UpdateCircuitBuilderMemoryParams,
  UpdateCircuitBuilderMemoryResponse,
} from "@workspace/api-zod";
import { and, eq } from "drizzle-orm";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { circuitBuilderMemories, db } from "@workspace/db";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import {
  formatCircuitBuilderHistoryLearningInput,
  normalizeCircuitBuilderMemoryContent,
} from "../lib/circuitBuilderMemory";
import {
  applyGeneratedCircuitBuilderMemoryChanges,
  listUserCircuitBuilderMemories,
} from "../lib/circuitBuilderMemoryStore";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to manage saved assumptions." });
    return;
  }
  next();
};

const historyImportLimiter = rateLimit({
  windowMs: 60_000,
  limit: 2,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before reviewing saved chats again." },
});

const historyLearningInstructions = `You extract small, reusable user-specific assumptions from earlier Circuit Studio conversations. Do not continue or recap those conversations. Save only clearly stated preferences, repeated or explicitly chosen circuit decisions, and durable project context that is likely to help later. Do not infer preferences from assistant suggestions or a single temporary request. Ignore unrelated topics. Never treat old context as fact: future chats will present every saved item as tentative and let the user correct it. Do not ask questions or create/delete memories. Return one JSON object with a memoryUpdates array of at most two items, each containing category ("work-style", "design-decision", or "past-context"), content (at most 300 characters), and an existing id only when correcting that exact saved assumption. The array may be empty.`;

const emptyBrief = {
  goal: "",
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

router.post(
  "/circuit-builder/memories/import",
  requireAuth,
  historyImportLimiter,
  async (req, res): Promise<void> => {
    const parsed = LearnFromCircuitBuilderHistoryBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const userId = getAuth(req).userId!;
    let failureStage = "load_memories";
    try {
      const existingMemories = await listUserCircuitBuilderMemories(userId);
      const learningInput = formatCircuitBuilderHistoryLearningInput(
        parsed.data.conversations,
        existingMemories,
      );
      failureStage = "model_generation";
      const response = await generateWithAccountUsage(
        userId,
        {
          inputText: `${historyLearningInstructions}\n\n${learningInput}`,
          maxOutputTokens: 8192,
        },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: learningInput,
            config: {
              systemInstruction: historyLearningInstructions,
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              temperature: 0.1,
            },
          }),
      );

      failureStage = "validate_model_response";
      const text = response.text?.trim();
      if (!text) throw new Error("Empty memory-learning response.");
      const decoded: unknown = JSON.parse(text);
      if (!isRecord(decoded) || !Array.isArray(decoded.memoryUpdates)) {
        throw new Error("Memory-learning response has no memoryUpdates array.");
      }

      const validated = ChatWithCircuitBuilderResponse.parse({
        answer: "Saved conversation review.",
        brief: emptyBrief,
        memoryUpdates: decoded.memoryUpdates,
      });

      failureStage = "save_memories";
      const learnedCount = await applyGeneratedCircuitBuilderMemoryChanges(
        userId,
        existingMemories,
        validated.memoryUpdates ?? [],
        [],
      );
      res.json(LearnFromCircuitBuilderHistoryResponse.parse({ learnedCount }));
    } catch (error) {
      if (error instanceof CircuitAiError) {
        req.log.warn(
          { statusCode: error.statusCode, failureStage },
          "Saved conversation learning failed",
        );
        res.status(error.statusCode).json({ error: error.message });
        return;
      }

      req.log.warn(
        { failureStage, errorType: error instanceof Error ? error.name : "unknown" },
        "Saved conversation learning failed",
      );
      const isInvalidModelResponse = failureStage === "validate_model_response";
      res.status(isInvalidModelResponse ? 502 : 503).json({
        error: isInvalidModelResponse
          ? "The assistant could not extract reusable assumptions from those chats."
          : "Saved assumptions could not be updated. Please try again.",
      });
    }
  },
);

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

import { SetAiKeySelectionBody } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  CircuitAiError,
  getCircuitAiStatus,
  getCircuitAiUsage,
  selectCircuitAiKey,
} from "../lib/circuitAi";

const router: IRouter = Router();
const statusLimiter = rateLimit({
  windowMs: 60_000,
  limit: 30,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before checking AI status again." },
});
const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to view AI usage." });
    return;
  }
  next();
};

router.get("/ai/usage", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  try {
    res.json(await getCircuitAiUsage(userId!));
  } catch {
    req.log.error({ reason: "usage_read_failed" }, "Could not read AI usage");
    res.status(503).json({ error: "AI usage is temporarily unavailable." });
  }
});

router.get(
  "/ai/status",
  requireAuth,
  statusLimiter,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    try {
      res.json(await getCircuitAiStatus(userId!));
    } catch {
      req.log.error({ reason: "ai_status_check_failed" }, "Could not check AI status");
      res.status(503).json({ error: "AI status is temporarily unavailable." });
    }
  },
);

router.put("/ai/key-selection", requireAuth, async (req, res): Promise<void> => {
  const userId = getAuth(req).userId;
  const parsed = SetAiKeySelectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    res.json(await selectCircuitAiKey(userId!, parsed.data.keyNumber));
  } catch (error) {
    if (error instanceof CircuitAiError) {
      res.status(error.statusCode).json({ error: error.message });
      return;
    }
    req.log.error({ reason: "key_selection_failed" }, "Could not select AI key");
    res.status(503).json({ error: "AI key selection is temporarily unavailable." });
  }
});

export default router;

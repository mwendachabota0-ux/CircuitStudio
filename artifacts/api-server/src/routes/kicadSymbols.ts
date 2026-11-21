import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { searchKicadSymbols } from "../lib/kicadSymbols";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to search schematic symbols." });
    return;
  }
  next();
};

const searchLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before searching the symbol library again." },
});

router.get(
  "/circuits/library/search",
  requireAuth,
  searchLimiter,
  async (req, res): Promise<void> => {
    const query = typeof req.query.q === "string" ? req.query.q.slice(0, 120) : "";
    const library = typeof req.query.library === "string"
      ? req.query.library.slice(0, 120)
      : "";
    const requestedLimit = typeof req.query.limit === "string"
      ? Number(req.query.limit)
      : 40;

    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      res.status(400).json({ error: "limit must be an integer from 1 to 100." });
      return;
    }

    try {
      res.json(await searchKicadSymbols(query, library, requestedLimit));
    } catch (error) {
      req.log.error(
        { reason: error instanceof Error ? error.name : "unknown" },
        "KiCad symbol search failed",
      );
      res.status(503).json({
        error: "The schematic symbol catalog is temporarily unavailable.",
      });
    }
  },
);

export default router;

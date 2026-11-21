import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { getKicadSymbolData, searchKicadSymbols } from "../lib/kicadSymbols";

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

const symbolDataLimiter = rateLimit({
  windowMs: 60_000,
  limit: 90,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before loading more symbol previews." },
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
    const requestedOffset = typeof req.query.offset === "string"
      ? Number(req.query.offset)
      : 0;

    if (!Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 100) {
      res.status(400).json({ error: "limit must be an integer from 1 to 100." });
      return;
    }
    if (
      !Number.isInteger(requestedOffset) ||
      requestedOffset < 0 ||
      requestedOffset > 1_000_000
    ) {
      res.status(400).json({ error: "offset must be an integer from 0 to 1000000." });
      return;
    }

    try {
      res.json(await searchKicadSymbols(query, library, requestedLimit, requestedOffset));
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

router.get(
  "/circuits/library/symbol-data",
  requireAuth,
  symbolDataLimiter,
  async (req, res): Promise<void> => {
    const symbolId =
      typeof req.query.symbolId === "string" ? req.query.symbolId : "";
    if (
      symbolId.length > 160 ||
      !/^[^:\s]+:[^:\s]+$/.test(symbolId)
    ) {
      res.status(400).json({ error: "A valid KiCad symbol ID is required." });
      return;
    }

    try {
      res.json(await getKicadSymbolData(symbolId));
    } catch (error) {
      req.log.warn(
        { reason: error instanceof Error ? error.name : "unknown" },
        "KiCad symbol preview could not be loaded",
      );
      res.status(503).json({
        error: "The KiCad symbol preview is temporarily unavailable.",
      });
    }
  },
);

export default router;

import { GenerateCircuitBody } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import {
  formatCircuitComponentGuide,
  formatRelevantCircuitComponentResearchContext,
} from "@workspace/circuit-geometry";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import {
  CircuitSpecCompatibilityError,
  parseUsableCircuit,
} from "../lib/circuitSpec";

const router: IRouter = Router();

const generationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait a moment before generating another circuit." },
});

const requireAuth: RequestHandler = (req, res, next) => {
  const { userId } = getAuth(req);
  if (!userId) {
    res.status(401).json({ error: "Sign in to generate a circuit." });
    return;
  }
  next();
};

const circuitSystemInstructions = `You convert plain-language circuit requests into editable JSON for the CircuitDraw schematic renderer.
Return exactly one JSON object, with no Markdown fences, comments, or prose. The shape is:
{"title":"Circuit name","width":680,"height":480,"elements":[...]}

Coordinates are pixels from the top-left, with y increasing downward. Use a 10 px grid and keep a 40 px margin.

${formatCircuitComponentGuide()}

Use 80–100 px for most two-terminal parts. Keep at least 20 px between distinct symbol bodies where possible, reserve clear space for labels and pin names, and avoid compressing a multi-branch circuit into one long row. Give connected parts visible lead wires; route around symbol bodies and text. Use short, unique designators in "label" (R1, C1, Q1, D1, L1, MK1, SW1, B1, ANT1) and descriptive values in "value". Give wires unique IDs (W1, W2, ...) so connection diagnostics can identify them. Put supply at the top, ground at the bottom, and signal flow left to right where practical. Increase width or height when needed to preserve margins.

Do not invent unsupported component types or draw SVG. If a requested part has no supported equivalent, state the limitation instead of assigning it imaginary pins. For a two-transistor astable multivibrator or alternating LED flasher, keep each transistor's base separate from its collector and emitter, give each base its own resistor to the positive supply, and cross-couple each collector to the opposite transistor's base through a timing capacitor. Never connect a transistor's base directly to its own collector or connect a timing capacitor to that same transistor's base. Make a best effort to ensure every connection and value follows the request. Structural validation checks the drawing and selected topology rules only; it is not general electrical validation or simulation.`;

router.post(
  "/circuits/generate",
  requireAuth,
  generationLimiter,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    const parsed = GenerateCircuitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    try {
      const relevantComponentContext =
        formatRelevantCircuitComponentResearchContext([parsed.data.prompt]);
      const systemInstructions = [
        circuitSystemInstructions,
        relevantComponentContext,
      ].filter(Boolean).join("\n\n");
      const inputText = `${systemInstructions}\n\nCircuit request:\n${parsed.data.prompt}`;
      const response = await generateWithAccountUsage(
        userId!,
        { inputText, maxOutputTokens: 3072 },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: parsed.data.prompt,
            config: {
              systemInstruction: systemInstructions,
              responseMimeType: "application/json",
              maxOutputTokens: 3072,
              temperature: 0.2,
            },
          }),
      );

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      res.json(parseUsableCircuit(JSON.parse(text)));
    } catch (err) {
      if (err instanceof CircuitAiError) {
        if (err.statusCode >= 500) {
          req.log.error({ statusCode: err.statusCode }, "Circuit generation failed");
        }
        res.status(err.statusCode).json({ error: err.message });
        return;
      }
      req.log.error({ reason: "invalid_or_unusable_model_output" }, "Circuit generation failed");
      res.status(502).json({
        error: err instanceof CircuitSpecCompatibilityError
          ? err.message
          : "Gemini could not produce a usable schematic. Try describing the parts and connections more specifically.",
      });
    }
  },
);

export default router;

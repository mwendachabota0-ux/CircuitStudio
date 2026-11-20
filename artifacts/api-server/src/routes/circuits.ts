import { GenerateCircuitBody } from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import { parseUsableCircuit } from "../lib/circuitSpec";

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

Coordinates are pixels from the top-left, with y increasing downward. Use a 10 px grid and keep a 40 px margin. Use only these element types:
resistor, capacitor, electrolytic, inductor, diode, zener, led, battery, switch, mic, speaker, lamp, acsource, crystal, npn, pnp, opamp, ground, antenna, terminal, wire, junction, label, box.

Two-terminal parts use "from":[x,y] and "to":[x,y]. Minimum terminal distances in pixels: resistor 50, capacitor/electrolytic 12, inductor 64, diode/zener/led 20, battery 10, switch 36, mic 36, speaker 24, lamp 28, acsource 32, crystal 18. Use 80–100 px for most parts. npn/pnp/opamp use "at":[x,y]. For npn, Base=[x-25,y], Collector=[x+25,y-44], Emitter=[x+25,y+44]. For pnp, Base=[x-25,y], Emitter=[x+25,y-44], Collector=[x+25,y+44]. For opamp, inverting=[x-40,y-20], non-inverting=[x-40,y+20], output=[x+40,y].

Single-point parts ground, antenna, and terminal use "at":[x,y]. Wires use "points":[[x1,y1],[x2,y2],...] and only horizontal or vertical segments; include every corner. Connect wire endpoints exactly to component pins. A wire intentionally ending in open space must have "open":true. Crossings do not connect unless a junction is explicit. Use short, unique designators in "label" (R1, C1, Q1, D1, L1, MK1, SW1, B1, ANT1) and descriptive values in "value". Put supply at the top, ground at the bottom, and signal flow left to right where practical.

Do not invent unsupported component types or draw SVG. Make a best effort to ensure every connection and value follows the request. The renderer's structural warnings are not an electrical rules check: do not claim the design is electrically verified.`;

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
      const inputText = `${circuitSystemInstructions}\n\nCircuit request:\n${parsed.data.prompt}`;
      const response = await generateWithAccountUsage(
        userId!,
        { inputText, maxOutputTokens: 3072 },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: parsed.data.prompt,
            config: {
              systemInstruction: circuitSystemInstructions,
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
        error: "Gemini could not produce a usable schematic. Try describing the parts and connections more specifically.",
      });
    }
  },
);

export default router;

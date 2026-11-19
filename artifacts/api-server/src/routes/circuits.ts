import { GoogleGenAI } from "@google/genai";
import { GenerateCircuitBody, GenerateCircuitResponse } from "@workspace/api-zod";
import rateLimit from "express-rate-limit";
import { Router, type IRouter } from "express";

const router: IRouter = Router();

const generationLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait a moment before generating another circuit." },
});

const circuitSystemInstructions = `You convert plain-language circuit requests into editable JSON for the CircuitDraw schematic renderer.
Return exactly one JSON object, with no Markdown fences, comments, or prose. The shape is:
{"title":"Circuit name","width":680,"height":480,"elements":[...]}

Coordinates are pixels from the top-left, with y increasing downward. Use a 10 px grid and keep a 40 px margin. Use only these element types:
resistor, capacitor, electrolytic, inductor, diode, zener, led, battery, switch, mic, speaker, lamp, acsource, crystal, npn, pnp, opamp, ground, antenna, terminal, wire, junction, label, box.

Two-terminal parts use "from":[x,y] and "to":[x,y]. Minimum terminal distances in pixels: resistor 50, capacitor/electrolytic 12, inductor 64, diode/zener/led 20, battery 10, switch 36, mic 36, speaker 24, lamp 28, acsource 32, crystal 18. Use 80–100 px for most parts. npn/pnp/opamp use "at":[x,y]. For npn, Base=[x-25,y], Collector=[x+25,y-44], Emitter=[x+25,y+44]. For pnp, Base=[x-25,y], Emitter=[x+25,y-44], Collector=[x+25,y+44]. For opamp, inverting=[x-40,y-20], non-inverting=[x-40,y+20], output=[x+40,y].

Single-point parts ground, antenna, and terminal use "at":[x,y]. Wires use "points":[[x1,y1],[x2,y2],...] and only horizontal or vertical segments; include every corner. Connect wire endpoints exactly to component pins. A wire intentionally ending in open space must have "open":true. Crossings do not connect unless a junction is explicit. Use short, unique designators in "label" (R1, C1, Q1, D1, L1, MK1, SW1, B1, ANT1) and descriptive values in "value". Put supply at the top, ground at the bottom, and signal flow left to right where practical.

Do not invent unsupported component types or draw SVG. Make a best effort to ensure every connection and value follows the request. The renderer's structural warnings are not an electrical rules check: do not claim the design is electrically verified.`;

const supportedTypes = new Set([
  "resistor",
  "capacitor",
  "electrolytic",
  "inductor",
  "diode",
  "zener",
  "led",
  "battery",
  "switch",
  "mic",
  "speaker",
  "lamp",
  "acsource",
  "crystal",
  "npn",
  "pnp",
  "opamp",
  "ground",
  "antenna",
  "terminal",
  "wire",
  "junction",
  "label",
  "box",
]);

router.post(
  "/circuits/generate",
  generationLimiter,
  async (req, res): Promise<void> => {
    const parsed = GenerateCircuitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      res.status(503).json({ error: "Gemini is not configured for circuit generation." });
      return;
    }

    try {
      const client = new GoogleGenAI({ apiKey });
      const response = await client.models.generateContent({
        model: "gemini-2.5-flash",
        contents: parsed.data.prompt,
        config: {
          systemInstruction: circuitSystemInstructions,
          responseMimeType: "application/json",
          maxOutputTokens: 8192,
          temperature: 0.2,
        },
      });

      const text = response.text?.trim();
      if (!text) {
        throw new Error("Gemini returned an empty response.");
      }

      const circuit = GenerateCircuitResponse.parse(JSON.parse(text));
      if (circuit.elements.length === 0) {
        throw new Error("Gemini returned a circuit with no elements.");
      }
      const unsupported = circuit.elements.find((element) => !supportedTypes.has(element.type));
      if (unsupported) {
        throw new Error(`Gemini returned unsupported element type: ${unsupported.type}`);
      }

      res.json(circuit);
    } catch (err) {
      req.log.error({ err }, "Gemini circuit generation failed");
      res.status(502).json({
        error: "Gemini could not produce a usable schematic. Try describing the parts and connections more specifically.",
      });
    }
  },
);

export default router;

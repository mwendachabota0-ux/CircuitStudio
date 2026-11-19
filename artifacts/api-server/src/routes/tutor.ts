import {
  AskCircuitTutorBody,
  AskCircuitTutorResponse,
  ReviewCircuitBody,
  ReviewCircuitResponse,
} from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import { parseUsableCircuit } from "../lib/circuitSpec";

const router: IRouter = Router();
const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to use the circuit tutor." });
    return;
  }
  next();
};
const tutorLimiter = rateLimit({
  windowMs: 60_000,
  limit: 6,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before asking the tutor another question." },
});
const reviewLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before requesting another circuit review." },
});

const tutorInstructions = `You are Circuit Studio's educational circuit tutor. Explain circuit concepts clearly and cautiously. You are not an electrical engineer, simulator, safety reviewer, or certifier.

Return one JSON object with the fields answer (string), observed (array of directly visible or explicitly supplied facts), inferred (array of clearly labeled hypotheses), unknowns (array of uncertainties), missingValues (array of important values or context not supplied), and optional proposedEdit.

Separate observation from inference. Do not invent component values, connections, image details, or user intent. If an image is unclear, say what cannot be read. Never claim that a circuit is electrically correct, safe to build, simulated, compliant, or certified.

When an edit proposal is requested, return proposedEdit with a short summary and a complete CircuitSpec. Start from the supplied currentSpec, preserve unrelated parts, and only make the requested changes. Do not apply the edit; the user must choose whether to use it. Use only supported CircuitDraw element types: resistor, capacitor, electrolytic, inductor, diode, zener, led, battery, switch, mic, speaker, lamp, acsource, crystal, npn, pnp, opamp, ground, antenna, terminal, wire, junction, label, box. Return JSON only, without Markdown fences.`;

const reviewInstructions = `Review this editable CircuitSpec for clarity and obvious drawing-structure or educational issues. Return one concise paragraph only. Mention uncertainty and missing values when relevant. Do not claim electrical correctness, simulation, safety, legal compliance, or certification. This review is educational guidance, not an electrical rules check.`;

function imageMatchesDeclaredType(bytes: Buffer, mimeType: string): boolean {
  if (mimeType === "image/png") {
    return (
      bytes.length >= 8 &&
      bytes.subarray(0, 8).equals(
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      )
    );
  }
  if (mimeType === "image/jpeg") {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (mimeType === "image/webp") {
    return (
      bytes.length >= 12 &&
      bytes.toString("ascii", 0, 4) === "RIFF" &&
      bytes.toString("ascii", 8, 12) === "WEBP"
    );
  }
  return false;
}

function sendAiError(
  req: Parameters<RequestHandler>[0],
  res: Parameters<RequestHandler>[1],
  error: unknown,
  fallbackMessage: string,
): void {
  if (error instanceof CircuitAiError) {
    if (error.statusCode >= 500) {
      req.log.error(
        { statusCode: error.statusCode },
        "Circuit Studio AI request failed",
      );
    }
    res.status(error.statusCode).json({ error: error.message });
    return;
  }
  req.log.error({ reason: "invalid_or_unusable_model_output" }, fallbackMessage);
  res.status(502).json({
    error: "Gemini returned a response that could not be safely used. Please try again.",
  });
}

router.post(
  "/circuits/tutor",
  requireAuth,
  tutorLimiter,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    const parsed = AskCircuitTutorBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const questionText = parsed.data.question?.trim() ?? "";
    if (parsed.data.proposeEdits && !parsed.data.currentSpec) {
      res.status(400).json({
        error: "A current CircuitSpec is required before requesting an edit proposal.",
      });
      return;
    }

    let currentSpec;
    if (parsed.data.currentSpec) {
      try {
        currentSpec = parseUsableCircuit(parsed.data.currentSpec);
      } catch {
        res.status(400).json({ error: "The current CircuitSpec is not valid." });
        return;
      }
    }

    let image: { mimeType: string; dataBase64: string } | undefined;
    let imageTokenEstimate = 0;
    if (parsed.data.image) {
      const { dataBase64, mimeType } = parsed.data.image;
      if (
        !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
          dataBase64,
        )
      ) {
        res.status(400).json({ error: "The uploaded image data is invalid." });
        return;
      }
      const bytes = Buffer.from(dataBase64, "base64");
      if (bytes.length < 1) {
        res.status(400).json({ error: "The uploaded image is empty." });
        return;
      }
      if (bytes.length > 4 * 1024 * 1024) {
        res.status(413).json({ error: "Images must be 4 MiB or smaller." });
        return;
      }
      if (bytes.toString("base64") !== dataBase64) {
        res.status(400).json({ error: "The uploaded image data is invalid." });
        return;
      }
      if (!imageMatchesDeclaredType(bytes, mimeType)) {
        res.status(400).json({
          error: "The image content does not match its PNG, JPEG, or WebP file type.",
        });
        return;
      }
      image = { mimeType, dataBase64 };
      imageTokenEstimate = 1024;
    }
    if (!questionText && !image) {
      res.status(400).json({ error: "Enter a question or attach a circuit image." });
      return;
    }

    const userMessage = [
      questionText ||
        "Explain what can be observed in this circuit image. Separate visible details from inference, uncertainty, and missing values.",
      currentSpec
        ? `Current CircuitSpec:\n${JSON.stringify(currentSpec)}`
        : "",
      parsed.data.proposeEdits
        ? "Return a proposed edit based on the current CircuitSpec, but do not apply it."
        : "Do not include a proposedEdit.",
    ]
      .filter(Boolean)
      .join("\n\n");

    try {
      const response = await generateWithAccountUsage(
        userId!,
        {
          inputText: `${tutorInstructions}\n\n${userMessage}`,
          maxOutputTokens: 2048,
          imageTokenEstimate,
        },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: [
              {
                role: "user",
                parts: [
                  { text: userMessage },
                  ...(image
                    ? [
                        {
                          inlineData: {
                            mimeType: image.mimeType,
                            data: image.dataBase64,
                          },
                        },
                      ]
                    : []),
                ],
              },
            ],
            config: {
              systemInstruction: tutorInstructions,
              responseMimeType: "application/json",
              maxOutputTokens: 2048,
              temperature: 0.2,
            },
          }),
      );
      const text = response.text?.trim();
      if (!text) throw new Error("Empty tutor response.");
      const tutorResponse = AskCircuitTutorResponse.parse(JSON.parse(text));
      if (tutorResponse.proposedEdit) {
        const proposedSpec = parseUsableCircuit(tutorResponse.proposedEdit.spec);
        tutorResponse.proposedEdit.spec = proposedSpec;
      }
      res.json(tutorResponse);
    } catch (error) {
      sendAiError(
        req,
        res,
        error,
        "Circuit tutor response could not be validated",
      );
    }
  },
);

router.post(
  "/circuits/review",
  requireAuth,
  reviewLimiter,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    const parsed = ReviewCircuitBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    let spec;
    try {
      spec = parseUsableCircuit(parsed.data.spec);
    } catch {
      res.status(400).json({ error: "The CircuitSpec is not valid." });
      return;
    }

    const contents = JSON.stringify(spec);
    try {
      const response = await generateWithAccountUsage(
        userId!,
        {
          inputText: `${reviewInstructions}\n\nCircuitSpec:\n${contents}`,
          maxOutputTokens: 768,
        },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: `Review this CircuitSpec:\n${contents}`,
            config: {
              systemInstruction: reviewInstructions,
              maxOutputTokens: 768,
              temperature: 0.2,
            },
          }),
      );
      const review = response.text?.trim();
      if (!review) throw new Error("Empty editor review.");
      res.json(ReviewCircuitResponse.parse({ review }));
    } catch (error) {
      sendAiError(req, res, error, "Circuit editor review failed");
    }
  },
);

export default router;

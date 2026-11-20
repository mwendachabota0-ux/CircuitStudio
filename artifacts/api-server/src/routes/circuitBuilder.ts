import {
  ChatWithCircuitBuilderBody,
  ChatWithCircuitBuilderResponse,
} from "@workspace/api-zod";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import { parseUsableCircuit } from "../lib/circuitSpec";
import { getSafeErrorType } from "../lib/providerErrorDiagnostics";

const router: IRouter = Router();

const requireAuth: RequestHandler = (req, res, next) => {
  if (!getAuth(req).userId) {
    res.status(401).json({ error: "Sign in to use the circuit builder." });
    return;
  }
  next();
};

const builderLimiter = rateLimit({
  windowMs: 60_000,
  limit: 8,
  standardHeaders: "draft-8",
  legacyHeaders: false,
  message: { error: "Please wait before sending another builder message." },
});

const builderInstructions = `You are Circuit Studio's conversational circuit-building assistant. Help the user clarify a circuit idea and turn it into a proposed editable schematic. Be concise and collaborative; teach only when it helps the user make a decision.

Return exactly one JSON object with these fields: nextMode ("chat" or "build"), answer (string), brief ({goal:string, requirements:string[], assumptions:string[], openQuestions:string[]}), and optional proposal ({summary:string, spec:CircuitSpec}). Do not include Markdown fences or extra fields.

Keep the brief short. Requirements must come from explicit user statements. Put uncertain but necessary choices in assumptions, never present them as facts. Keep only useful unanswered questions. Ask at most one focused question at a time when a missing detail materially affects the design.

Treat the supplied brief as the source of truth. Retain accurate details unless the user explicitly changes or resolves them; incorporate new information without silently discarding existing notes.

Choose nextMode from the user's intent, not only the currently selected tab. In chat mode, normally discuss and clarify the design without a proposal. If the latest user message asks or clearly signals that they want the agreed circuit built, drawn, made, generated, or turned into a complete draft now—even in casual or indirect wording—set nextMode to "build" and follow the build-mode rules in this same response. Examples include "build it now", "go ahead and draw it", "make the circuit", and "turn this into a schematic". Do not switch for explanations, hypotheticals, questions about how building works, or requests to wait or not build yet. In build mode, set nextMode to "build".

In build mode, if the request is clear enough, include a complete proposed CircuitSpec. If a critical requirement is unclear, ask one focused question and omit the proposal, but keep nextMode as "build". For edits, start from the supplied current CircuitSpec and preserve unrelated components, values, labels, and connections. For an explicitly new or replacement design, do not preserve an unrelated example circuit.

Use only supported CircuitDraw element types: resistor, capacitor, electrolytic, inductor, diode, zener, led, battery, switch, mic, speaker, lamp, acsource, crystal, npn, pnp, opamp, ground, antenna, terminal, wire, junction, label, box. Use clear reference designators and keep all coordinates and wire segments compatible with CircuitDraw.

Before returning a proposal, make it pass CircuitDraw structural validation. For every two-terminal part, the straight-line distance from "from" to "to" must meet these minimums: resistor 50 px; capacitor and electrolytic 12 px; inductor 64 px; diode, zener, and LED 20 px; battery 10 px; switch and mic 36 px; speaker 24 px; lamp 28 px; AC source 32 px; crystal 18 px. Do not use the same 30 px spacing for every part. Keep wire segments horizontal or vertical, connect their endpoints exactly to component pins or other wire endpoints, avoid zero-length segments, and do not route wires through two-terminal parts. Mark a wire endpoint open only when it is intentionally left disconnected.

Never invent an exact manufacturer part number, footprint, rating, or user requirement. Clearly state assumptions and unknowns. A structurally renderable proposal is not proof of electrical correctness, safety, compliance, or fitness to build.`;

const emptyBrief = {
  goal: "",
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

router.post(
  "/circuits/build-chat",
  requireAuth,
  builderLimiter,
  async (req, res): Promise<void> => {
    const userId = getAuth(req).userId;
    const parsed = ChatWithCircuitBuilderBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }

    let currentSpec;
    try {
      currentSpec = parseUsableCircuit(parsed.data.currentSpec);
    } catch {
      res.status(400).json({ error: "The current CircuitSpec is not valid." });
      return;
    }

    const history = parsed.data.history ?? [];
    const brief = parsed.data.brief ?? emptyBrief;
    const conversation = history
      .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
      .join("\n");
    const userMessage = [
      `Mode: ${parsed.data.mode}`,
      `Current design brief:\n${JSON.stringify(brief)}`,
      conversation ? `Recent conversation:\n${conversation}` : "",
      `Current CircuitSpec:\n${JSON.stringify(currentSpec)}`,
      `Latest user message:\n${parsed.data.message.trim()}`,
    ]
      .filter(Boolean)
      .join("\n\n");
    const inputText = `${builderInstructions}\n\n${userMessage}`;

    let failureStage = "model_generation";
    let outputLength = 0;
    let finishReason = "unknown";
    try {
      const response = await generateWithAccountUsage(
        userId!,
        { inputText, maxOutputTokens: 8192 },
        (client) =>
          client.models.generateContent({
            model: "gemini-2.5-flash",
            contents: userMessage,
            config: {
              systemInstruction: builderInstructions,
              responseMimeType: "application/json",
              maxOutputTokens: 8192,
              temperature: 0.2,
            },
          }),
      );

      finishReason = response.candidates?.[0]?.finishReason ?? "unknown";
      failureStage = "read_response_text";
      const text = response.text?.trim();
      if (!text) throw new Error("Empty builder response.");
      outputLength = text.length;

      failureStage = "parse_json";
      const decoded = JSON.parse(text);
      failureStage = "validate_response_schema";
      const result = ChatWithCircuitBuilderResponse.parse(decoded);
      result.nextMode ??= result.proposal ? "build" : parsed.data.mode;
      if (parsed.data.mode === "build") result.nextMode = "build";

      if (result.proposal) {
        failureStage = "validate_circuit_spec";
        result.proposal.spec = parseUsableCircuit(result.proposal.spec);
      }
      if (result.nextMode !== "build") {
        delete result.proposal;
      }

      res.json(result);
    } catch (error) {
      if (error instanceof CircuitAiError) {
        if (error.statusCode >= 500) {
          req.log.error(
            {
              statusCode: error.statusCode,
              retryable: error.retryable,
              ...(error.providerDiagnostics ?? {}),
            },
            "Circuit builder request failed",
          );
        }
        res.setHeader("X-Circuit-AI-Retryable", String(error.retryable));
        if (error.retryAfterMs !== undefined) {
          res.setHeader(
            "Retry-After",
            String(Math.ceil(error.retryAfterMs / 1000)),
          );
        }
        res.status(error.statusCode).json({ error: error.message });
        return;
      }
      req.log.error(
        {
          reason: "invalid_or_unusable_model_output",
          failureStage,
          errorType: getSafeErrorType(error),
          outputLength,
          finishReason,
        },
        "Circuit builder response could not be validated",
      );
      res.setHeader("X-Circuit-AI-Output-Invalid", "true");
      res.setHeader("X-Circuit-AI-Retryable", "true");
      res.status(502).json({
        error: "The assistant response did not match Circuit Studio's required format.",
      });
    }
  },
);

export default router;

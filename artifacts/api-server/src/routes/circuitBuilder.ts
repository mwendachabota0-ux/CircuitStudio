import {
  ChatWithCircuitBuilderBody,
  ChatWithCircuitBuilderResponse,
} from "@workspace/api-zod";
import { formatCircuitComponentGuide } from "@workspace/circuit-geometry";
import type { GenerateContentResponse } from "@google/genai";
import { getAuth } from "@clerk/express";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type RequestHandler } from "express";
import { CircuitAiError, generateWithAccountUsage } from "../lib/circuitAi";
import {
  generateWithThinkingBudgetFallback,
  getBuilderThinkingBudgets,
} from "../lib/circuitBuilderGeneration";
import {
  CircuitSpecCompatibilityError,
  parseUsableCircuit,
} from "../lib/circuitSpec";
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

Choose nextMode from the meaning of the user's request and conversation context, not from keywords or the currently selected tab. Do not require words such as "build", "draw", "create", or "generate". If the user describes a concrete circuit outcome they want, asks for a schematic or edit indirectly, or indicates that the agreed design should be made usable, set nextMode to "build" and follow the build-mode rules in this same response. This includes natural phrasing such as "I need a flasher that alternates these lights", "could we have it switch every second?", or "that sounds right for my project". If they are asking for an explanation, comparing possibilities, brainstorming, speaking hypothetically, or asking to wait, stay in "chat". If their goal or a critical design choice is genuinely unclear, ask one focused question in chat instead of guessing. The selected tab is only a default when intent is unclear; do not force build mode just because the user previously selected Build.

In build mode, if the request is clear enough, include a complete proposed CircuitSpec. If a critical requirement is unclear, ask one focused question and omit the proposal, but keep nextMode as "build". For edits, start from the supplied current CircuitSpec and preserve unrelated components, values, labels, and connections. For an explicitly new or replacement design, do not preserve an unrelated example circuit.

Use only the component types, required properties, pin locations, and minimum lengths in this actual CircuitDraw reference:
${formatCircuitComponentGuide()}

Use clear reference designators and unique wire IDs (W1, W2, ...). Keep wire segments horizontal or vertical, avoid zero-length segments and routes through two-terminal parts, and connect wire endpoints exactly to pins or other wire endpoints. Set open:true on a wire only when it is intentionally left disconnected. If a requested component has no supported equivalent, state the limitation instead of inventing a type or pin model.

When the user asks to repair a current workbench draft or a prior proposal using validator findings, preserve every non-wire element exactly, including its type, identity, value, orientation, and coordinates. Do not redesign or reposition the layout. Only add, remove, reroute, or snap wires. If the requested design is a two-transistor astable multivibrator or alternating flasher, each base must be separate from its collector and emitter, each base must have its own resistor to the positive supply, and each timing capacitor must connect one collector to the opposite transistor's base. Never connect a capacitor from a transistor's collector back to that same transistor's base.

Only blocking validation errors trigger automatic repair attempts. Warnings are advisory layout notes and should not be treated as proof of a wiring fault. Avoid disconnected wire endpoints and wires that pass through or short component symbols. CircuitDraw does not perform general electrical validation or simulation.

Never invent an exact manufacturer part number, footprint, rating, or user requirement. Clearly state assumptions and unknowns. A structurally renderable proposal is not proof of electrical correctness, safety, compliance, or fitness to build.`;

function buildContinuationContents(
  originalContents: string,
  partialOutput: string,
): string {
  return `${originalContents}

The previous Gemini key reached its output limit while working on this response. Continue from its partial work below. Preserve useful details, repair any incomplete JSON, and return one complete valid JSON object that follows the required schema. Do not repeat the partial text as a separate answer.

Partial assistant output:
${partialOutput || "(The previous attempt returned no text.)"}`;
}

const emptyBrief = {
  goal: "",
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

function summarizeTokenUsage(response: GenerateContentResponse): Record<string, number> {
  const usage = response.usageMetadata;
  const values: Record<string, number | undefined> = {
    promptTokenCount: usage?.promptTokenCount,
    candidatesTokenCount: usage?.candidatesTokenCount,
    thoughtsTokenCount: usage?.thoughtsTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  };
  const summary: Record<string, number> = {};
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === "number" && Number.isFinite(value)) summary[name] = value;
  }
  return summary;
}

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
    let failureStage = "model_generation";
    let outputLength = 0;
    let finishReason = "unknown";
    const generationAttempts: Array<{
      thinkingBudget: number;
      finishReason: string;
      outputLength: number;
      tokenUsage: Record<string, number>;
      keyNumber?: number;
      continuedFromOutputLength: number;
    }> = [];
    let lastUsedKeyNumber: number | undefined;
    try {
      const generation = await generateWithThinkingBudgetFallback({
        budgets: getBuilderThinkingBudgets(parsed.data.responseFormatRetry ?? false),
        generate: async (thinkingBudget, continuation) => {
          const contents = continuation
            ? buildContinuationContents(userMessage, continuation.partialOutput)
            : userMessage;
          let keyNumber: number | undefined;
          const result = await generateWithAccountUsage(
            userId!,
            {
              inputText: `${builderInstructions}\n\n${contents}`,
              maxOutputTokens: 8192,
              ...(continuation && lastUsedKeyNumber !== undefined
                ? { afterKeyNumber: lastUsedKeyNumber }
                : {}),
              onKeyUsed: (usedKeyNumber) => {
                keyNumber = usedKeyNumber;
                lastUsedKeyNumber = usedKeyNumber;
              },
            },
            (client) =>
              client.models.generateContent({
                model: "gemini-2.5-flash",
                contents,
                config: {
                  systemInstruction: builderInstructions,
                  responseMimeType: "application/json",
                  maxOutputTokens: 8192,
                  temperature: 0.2,
                  thinkingConfig: { thinkingBudget },
                },
              }),
          );
          generationAttempts.push({
            thinkingBudget,
            finishReason: result.candidates?.[0]?.finishReason ?? "unknown",
            outputLength: result.text?.length ?? 0,
            tokenUsage: summarizeTokenUsage(result),
            ...(keyNumber === undefined ? {} : { keyNumber }),
            continuedFromOutputLength: continuation?.partialOutput.length ?? 0,
          });
          return result;
        },
        isMaxTokens: (result) => result.candidates?.[0]?.finishReason === "MAX_TOKENS",
        getPartialOutput: (result) => result.text,
      });
      const response = generation.response;

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
              generationAttempts,
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
          generationAttempts,
        },
        "Circuit builder response could not be validated",
      );
      res.setHeader("X-Circuit-AI-Output-Invalid", "true");
      res.setHeader("X-Circuit-AI-Retryable", "true");
      res.status(502).json({
        error: error instanceof CircuitSpecCompatibilityError
          ? error.message
          : "The assistant response did not match Circuit Studio's required format.",
      });
    }
  },
);

export default router;

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
import { getDefaultKicadSymbolIds } from "../lib/circuitBuilderKicadDefaults";
import { isMainsChargerBuildRequest } from "../lib/circuitBuilderSafety";
import { normalizeCircuitBuilderResponse } from "../lib/circuitBuilderResponse";
import {
  CircuitSpecCompatibilityError,
  hydrateKicadSymbols,
  parseUsableCircuit,
} from "../lib/circuitSpec";
import { enforceBuildPermission } from "../lib/circuitBuilderPermission";
import {
  formatKicadSymbolPinGuide,
  findMentionedKicadSymbolIds,
  getKicadSymbolData,
  getKicadSymbolIndexEntry,
} from "../lib/kicadSymbols";
import { getSafeErrorType } from "../lib/providerErrorDiagnostics";
import {
  formatCircuitBuilderMemoryContext,
  selectRelevantCircuitBuilderMemories,
} from "../lib/circuitBuilderMemory";
import {
  applyGeneratedCircuitBuilderMemoryChanges,
  listUserCircuitBuilderMemories,
} from "../lib/circuitBuilderMemoryStore";

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

Return exactly one JSON object with these fields: nextMode ("chat" or "build"), answer (string), brief ({goal:string, requirements:string[], assumptions:string[], openQuestions:string[]}), optional proposal ({summary:string, spec:CircuitSpec}), suggestedActions (up to two {label:string, prompt:string, replyTo?:string} items), memoryUpdates (up to two {id?:number, category:"work-style"|"design-decision"|"past-context", content:string} items), memoryRemovals (an array of saved assumption IDs to delete), and optional repairLesson (string or null). If nothing should be remembered or removed, return empty arrays. Do not include Markdown fences or extra fields.

Keep the brief short. Requirements must come from explicit user statements. Put uncertain but necessary choices in assumptions, never present them as facts. Keep only useful unanswered questions. Ask at most one focused question at a time when a missing detail materially affects the design.

Suggested actions must match the latest assistant answer. If answer ends with a question, offer only possible replies to that exact question, not unrelated design alternatives or generic next steps. For each such action, set replyTo to an exact copy of the question at the end of answer. Make the prompt a response the user could send, or a safe way to find the requested information. Never invent user-specific facts or numeric values; if the answer is unknown, offer to check a label or datasheet, say they do not know yet, or omit suggestions. End a question with the question mark so it is clear which question needs an answer. If answer does not ask a question, suggested actions may be relevant next steps and must not include replyTo.

Example: if answer asks "What is the current draw of your 24V DC motor?" and no current value is known, suitable suggestions are "I'll check the motor label" / "I don't know the current yet". Do not suggest "Use a transistor instead" because that does not answer the current question.

Treat the supplied brief as the source of truth. Retain accurate details unless the user explicitly changes or resolves them; incorporate new information without silently discarding existing notes.

Saved assumptions from earlier chats are included only when they appear relevant. Treat them as tentative, never facts. The user's current message always wins. Ignore old context when the user starts a different topic, and do not make a new chat feel like a continuation unless the user signals that it is.

Saved circuit repair lessons describe a previously corrected drawing mistake. Apply a matching prevention rule when generating or repairing a relevant circuit, but do not force unrelated lessons into a new design. A lesson is not proof of electrical correctness or safety.

Before asking a question, check the current brief, recent conversation, and relevant saved assumptions. Do not ask the user to repeat a detail that is already answered. If a relevant saved assumption may answer it, state that assumption tentatively and invite correction instead of asking the same question again. Ask only when a material detail is still unknown.

Use memoryUpdates sparingly to preserve only concise, reusable information that can improve future conversations: explicit or repeated collaboration preferences, circuit decisions the user wants reused, or durable context about an ongoing project. Do not save one-off requests, complete transcripts, temporary values, assistant guesses, secrets, contact details, or sensitive personal information. For a correction, update the matching saved assumption by its exact id. Only remove an assumption when the user explicitly asks to forget it; put its id in memoryRemovals. Otherwise return empty memory arrays.

Only when the latest request includes explicit structural validation findings and you are proposing a correction, include repairLesson as a concise "Mistake: ... Fix: ... Avoid next time: ..." note. Base it only on the reported findings and the proposed correction; do not claim electrical correctness or safety. If there is no clear reusable lesson, omit it or set it to null. Never put repair lessons in memoryUpdates; Circuit Studio saves them only after its checks pass and the user applies the proposal.

Treat the requested mode as an authorization boundary. "Mode: build" means the user explicitly selected Build, directly requested a schematic, or approved a permission question; only then may you return nextMode "build" or a proposal. "Mode: chat" means permission has not been granted. In Chat, do not switch modes or return a proposal based on inferred intent, even when the user describes a concrete circuit goal or says an idea sounds right. Continue clarifying in Chat. When the design is ready for a schematic, ask exactly "Would you like me to switch to Build and prepare an editable schematic now?" and offer up to two direct yes/no replies whose replyTo exactly matches that question. Do not set buildApprovalRequested; it is server-owned. If the user asks an explanation, compares possibilities, brainstorms, speaks hypothetically, or asks to wait, answer in Chat without asking for build approval.

A greeting or other social opener by itself is not a circuit request. Reply briefly in chat; do not treat an existing brief or current schematic as a new instruction to build. Never infer approval from a prior brief, current schematic, or an ambiguous positive reaction.

In Build mode, if the request is clear enough, include a complete proposed CircuitSpec. If a critical requirement is unclear, ask one focused question and omit the proposal. For edits, start from the supplied current CircuitSpec and preserve unrelated components, values, labels, and connections. For an explicitly new or replacement design, do not preserve an unrelated example circuit.

For new schematic layouts, prioritize readability over density: leave clear space between symbols, give two-terminal parts visible lead wires with at least 10 px beyond the listed minimum terminal distance, keep labels away from symbols and wire crossings, align related power and return paths, and route every wire with horizontal and vertical segments, adding corner points wherever a route turns. Arrange parallel parts so their relationship is visible without overlapping their bodies, pins, labels, or wires. Keep a separate control path visually distinct from a load's power path. For motor-driver diagrams, show the fuse and motor in the power path, the flyback diode clearly across the motor, and the MOSFET return and gate-control wiring separately. These are drawing-layout instructions, not proof of electrical correctness. When asked only to repair wiring or respond to validator findings, follow the preservation rules below instead of changing component positions. Move a component only when the user explicitly asks for a layout change.

Use only the component types, required properties, pin locations, and minimum lengths in this actual CircuitDraw reference:
${formatCircuitComponentGuide()}

Safety and component support:
- Do not generate a schematic proposal for a phone/device charger or AC/DC supply wired directly to household mains, high-voltage AC, or a switch-mode mains primary. Explain that this is hazardous and safety-critical, and offer a low-voltage-only follow-up that uses a certified, isolated commercial adapter as an external source. Never claim a generated drawing is safe, certified, or ready to connect to mains.
- For unsupported symbols or missing verified IC/connector pinouts, explain the exact limitation without inventing symbols, pins, ratings, or part numbers. Suggest up to two concrete next prompts when a safe alternative exists. Suggested actions must be short, specific, and compatible with the user's goal; never suggest a way to recreate a rejected hazardous design.
- If the user requests an IC but has not supplied a verified pinout, ask for the exact part and pinout before proposing that block. Generic pin blocks are drawing aids, not validation of the IC's actual pin mapping.
- In Build mode, use the official KiCad library as the default source for schematic symbols. Prefer a supplied KiCad candidate whenever it matches a requested part instead of substituting a built-in approximation. Use type "kicad" with the exact symbolId and a valid unit/bodyStyle from its supplied definition. Use only listed pin numbers, names, and offsets; never invent a KiCad ID or pinout. The server attaches exact source drawings and pin geometry after generation. Do not return symbolData yourself. A library symbol is not confirmation of a physical part choice, rating, electrical correctness, or safety.

Use clear reference designators and unique wire IDs (W1, W2, ...). Connect every required pin exactly to a wire endpoint or another pin: all pins on supported discrete parts are required; a relay needs both coil pins, COM, and at least one of NC/NO, while the unused contact may remain open. Unused IC, connector, and KiCad symbol pins may remain unconnected. Keep wire segments horizontal or vertical, avoid zero-length segments and routes through two-terminal parts, and connect wire endpoints exactly to pins or other wire endpoints. Set open:true on a wire only when it is intentionally left disconnected. If a requested component has no supported equivalent, state the limitation instead of inventing a type or pin model.

When the user asks to repair a current workbench draft or a prior proposal using validator findings, preserve every non-wire element exactly, including its type, identity, value, orientation, and coordinates. Do not redesign or reposition the layout. Only add, remove, reroute, or snap wires. If the requested design is a two-transistor astable multivibrator or alternating flasher, each base must be separate from its collector and emitter, each base must have its own resistor to the positive supply, and each timing capacitor must connect one collector to the opposite transistor's base. Never connect a capacitor from a transistor's collector back to that same transistor's base.

Only blocking validation errors trigger automatic repair attempts. Warnings are advisory layout notes and should not be treated as proof of a wiring fault. Avoid disconnected wire endpoints and wires that pass through or short component symbols. CircuitDraw does not perform general electrical validation or simulation.

Never invent an exact manufacturer part number, footprint, rating, or user requirement. Clearly state assumptions and unknowns. A structurally renderable proposal is not proof of electrical correctness, safety, compliance, or fitness to build.`;

function selectedKicadSymbolIds(messages: string[]): string[] {
  const ids = new Set<string>();
  const pattern = /exact KiCad symbol ID:\s*([^\s,;]+)/gi;
  for (const message of messages) {
    for (const match of message.matchAll(pattern)) {
      const id = match[1]?.replace(/[.!?]+$/, "");
      if (id && /^[^:\s]+:[^:\s]+$/.test(id)) ids.add(id);
    }
  }
  return [...ids].slice(-8);
}

function withoutKicadGeometry<T extends { elements: Array<Record<string, unknown>> }>(
  spec: T,
): T {
  return {
    ...spec,
    elements: spec.elements.map(({ symbolData: _symbolData, ...element }) => element),
  } as T;
}

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
    if (isMainsChargerBuildRequest(parsed.data.message)) {
      res.json({
        nextMode: "chat",
        answer: "A phone charger wired directly to household mains is a hazardous, safety-critical design. Circuit Studio will not generate mains-side or switch-mode charger circuitry. A safer route is to use a certified, isolated commercial 5 V adapter as a sealed power source, then work only on a low-voltage output-side schematic. That drawing is still educational and is not a complete or certified charger.",
        brief,
        suggestedActions: [
          {
            label: "Draft the low-voltage output side",
            prompt: "Create an educational schematic for only the low-voltage 5 V output side, powered by an external certified isolated adapter. Do not include any input power-conversion circuitry. Ask whether the output connector should be USB-A or USB-C before choosing connector pins.",
          },
          {
            label: "Explain the adapter approach",
            prompt: "Explain at a high level how a certified isolated 5 V adapter changes the scope of a phone-charger project, and what the low-voltage output schematic still needs to specify.",
          },
        ],
      });
      return;
    }
    let existingMemories: Awaited<
      ReturnType<typeof listUserCircuitBuilderMemories>
    > = [];
    try {
      existingMemories = await listUserCircuitBuilderMemories(userId!);
    } catch (error) {
      req.log.warn(
        { errorType: getSafeErrorType(error) },
        "Saved Circuit Studio assumptions could not be loaded",
      );
    }
    const relevantMemories = selectRelevantCircuitBuilderMemories(
      existingMemories,
      [
        parsed.data.message,
        brief.goal,
        ...brief.requirements,
        ...brief.assumptions,
      ].join(" "),
    );
    const savedMemoryContext = formatCircuitBuilderMemoryContext(
      relevantMemories,
    );
    let kicadDefinitions = "";
    try {
      currentSpec = await hydrateKicadSymbols(currentSpec);
      const buildContext = [
        parsed.data.message,
        brief.goal,
        ...brief.requirements,
        ...brief.assumptions,
        ...history.map((message) => message.content),
      ].join(" ");
      const ids = new Set([
        ...selectedKicadSymbolIds([
          ...history.map((message) => message.content),
          parsed.data.message,
        ]),
        ...(parsed.data.mode === "build"
          ? [
            ...getDefaultKicadSymbolIds(buildContext),
            ...await findMentionedKicadSymbolIds(buildContext),
          ]
          : []),
        ...currentSpec.elements.flatMap((element) =>
          element.type === "kicad" && typeof element.symbolId === "string"
            ? [element.symbolId]
            : []
        ),
      ]);
      const definitions = await Promise.all([...ids].map(async (id) => {
        const entry = await getKicadSymbolIndexEntry(id);
        if (!entry) {
          throw new CircuitSpecCompatibilityError(
            `KiCad symbol ${id} is not in the installed symbol catalog.`,
          );
        }
        const symbolData = await getKicadSymbolData(id);
        return formatKicadSymbolPinGuide(entry, symbolData);
      }));
      if (definitions.length) {
        kicadDefinitions = `Selected KiCad library symbols (pin offsets are relative to each symbol's at origin, in screen coordinates):\n${definitions.join("\n\n")}`;
      }
    } catch (error) {
      if (error instanceof CircuitSpecCompatibilityError) {
        res.status(400).json({ error: error.message });
        return;
      }
      req.log.warn(
        { reason: error instanceof Error ? error.name : "unknown" },
        "KiCad symbol definitions could not be loaded",
      );
      res.status(503).json({
        error: "The selected KiCad symbol definitions are temporarily unavailable. Try again when the symbol catalog is reachable.",
      });
      return;
    }
    const conversation = history
      .map((message) => `${message.role === "assistant" ? "Assistant" : "User"}: ${message.content}`)
      .join("\n");
    const userMessage = [
      `Mode: ${parsed.data.mode}`,
      `Current design brief:\n${JSON.stringify(brief)}`,
      conversation ? `Recent conversation:\n${conversation}` : "",
      kicadDefinitions,
      `Current CircuitSpec:\n${JSON.stringify(withoutKicadGeometry(currentSpec))}`,
      savedMemoryContext,
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
              onKeyFallback: (failedKeyNumber, nextKeyNumber) => {
                req.log.info(
                  { failedKeyNumber, nextKeyNumber },
                  "Gemini key failed; trying the next configured key",
                );
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
      const validatedResult = ChatWithCircuitBuilderResponse.parse(
        normalizeCircuitBuilderResponse(decoded, brief),
      );
      validatedResult.nextMode ??= validatedResult.proposal ? "build" : parsed.data.mode;
      const result = enforceBuildPermission(
        validatedResult,
        parsed.data.mode,
        history,
        parsed.data.message,
      );

      if (result.proposal) {
        failureStage = "validate_circuit_spec";
        result.proposal.spec = await hydrateKicadSymbols(
          parseUsableCircuit(result.proposal.spec),
        );
      }
      if (result.nextMode !== "build") {
        delete result.proposal;
      }

      try {
        await applyGeneratedCircuitBuilderMemoryChanges(
          userId!,
          existingMemories,
          result.memoryUpdates ?? [],
          result.memoryRemovals ?? [],
        );
      } catch (error) {
        req.log.warn(
          { errorType: getSafeErrorType(error) },
          "Saved Circuit Studio assumptions could not be updated",
        );
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
          validationIssuePaths: error && typeof error === "object" &&
            Array.isArray((error as { issues?: unknown }).issues)
            ? (error as { issues: Array<{ path?: unknown; code?: unknown }> }).issues
              .slice(0, 8)
              .map((issue) => ({
                path: Array.isArray(issue.path)
                  ? issue.path.filter((part): part is string | number =>
                    typeof part === "string" || typeof part === "number")
                  : [],
                code: typeof issue.code === "string" ? issue.code : "unknown",
              }))
            : undefined,
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

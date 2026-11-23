import {
  GenerateCircuitDocumentV2Body,
  GenerateCircuitDocumentV2Response,
} from "@workspace/api-zod/generated/api";
import { getAuth } from "@clerk/express";
import type { GenerateContentResponse } from "@google/genai";
import rateLimit from "express-rate-limit";
import { Router, type IRouter, type Request, type RequestHandler } from "express";
import {
  CIRCUIT_DOCUMENT_V2_GENERATION_MODEL,
  CircuitDocumentV2GenerationError,
  generateCircuitDocumentV2ElectricalProposal,
  type CircuitDocumentV2ModelRequest,
  type CircuitDocumentV2ModelResponse,
} from "../lib/circuitDocumentV2Generation.ts";
import { isMainsChargerBuildRequest } from "../lib/circuitBuilderSafety.ts";

type GenerationRouterOptions = {
  resolveUserId?: (request: Request) => string | null | undefined;
  generateModel?: (
    request: CircuitDocumentV2ModelRequest,
  ) => Promise<CircuitDocumentV2ModelResponse>;
  createDocumentId?: () => string;
};

function summarizeUsage(response: GenerateContentResponse): Record<string, number> {
  const usage = response.usageMetadata;
  const values: Record<string, number | undefined> = {
    promptTokenCount: usage?.promptTokenCount,
    candidatesTokenCount: usage?.candidatesTokenCount,
    thoughtsTokenCount: usage?.thoughtsTokenCount,
    totalTokenCount: usage?.totalTokenCount,
  };
  return Object.fromEntries(
    Object.entries(values).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1]),
    ),
  );
}

export function createCircuitDocumentV2GenerationRouter(
  options: GenerationRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const resolveUserId =
    options.resolveUserId ?? ((request: Request) => getAuth(request).userId);
  const generateModel = options.generateModel ?? (async (input) => {
    const { generateWithAccountUsage } = await import("../lib/circuitAi.ts");
    const response = await generateWithAccountUsage(
      input.userId,
      {
        inputText: `${input.systemInstruction}\n\n${input.prompt}`,
        maxOutputTokens: 8192,
        onKeyFallback: (failedKeyNumber, nextKeyNumber) => {
          input.onKeyFallback?.(failedKeyNumber, nextKeyNumber);
        },
      },
      async (client) => {
        return client.models.generateContent({
          model: CIRCUIT_DOCUMENT_V2_GENERATION_MODEL,
          contents: input.prompt,
          config: {
            systemInstruction: input.systemInstruction,
            responseMimeType: "application/json",
            maxOutputTokens: 8192,
            temperature: 0.2,
          },
        });
      },
    );
    return {
      text: response.text ?? "",
      metadata: {
        finishReason: response.candidates?.[0]?.finishReason ?? "unknown",
        responseCharacters: response.text?.length ?? 0,
        ...summarizeUsage(response),
      },
    };
  });

  const generationLimiter = rateLimit({
    windowMs: 60_000,
    limit: 8,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    message: { error: "Please wait before generating another V2 circuit proposal." },
  });

  const requireAuth: RequestHandler = (request, response, next) => {
    const userId = resolveUserId(request);
    if (!userId) {
      response.status(401).json({ error: "Sign in to generate a V2 circuit proposal." });
      return;
    }
    response.locals.circuitDocumentV2UserId = userId;
    next();
  };

  router.post(
    "/circuit-documents/v2/generate",
    requireAuth,
    generationLimiter,
    async (request, response): Promise<void> => {
      const parsed = GenerateCircuitDocumentV2Body.safeParse(request.body);
      if (!parsed.success) {
        response.status(400).json({ error: parsed.error.message });
        return;
      }

      const prompt = parsed.data.prompt.trim();
      if (isMainsChargerBuildRequest(prompt)) {
        response.status(422).json({
          error: "Circuit Studio does not generate mains-side or high-voltage charger designs. Use a low-voltage-only design with a certified, isolated adapter as the external source.",
        });
        return;
      }

      const userId = response.locals.circuitDocumentV2UserId as string;
      let modelMetadata: Record<string, number | string> = {};
      try {
        const proposal = await generateCircuitDocumentV2ElectricalProposal({
          userId,
          prompt,
          createDocumentId: options.createDocumentId,
          generateModel: async (modelRequest) => {
            const result = await generateModel({
              ...modelRequest,
              onKeyFallback: (failedKeyNumber, nextKeyNumber) => {
                request.log.info(
                  { failedKeyNumber, nextKeyNumber },
                  "Gemini key failed; trying the next configured key",
                );
              },
            });
            modelMetadata = result.metadata ?? {};
            return result;
          },
        });
        const validatedResponse = GenerateCircuitDocumentV2Response.safeParse(proposal);
        if (!validatedResponse.success) {
          request.log.error(
            { reason: "v2_response_contract_mismatch" },
            "V2 electrical generation failed",
          );
          response.status(502).json({
            code: "response-contract-invalid",
            error: "Circuit Studio could not validate the generated V2 proposal response.",
            diagnostics: [],
          });
          return;
        }

        request.log.info(
          {
            model: CIRCUIT_DOCUMENT_V2_GENERATION_MODEL,
            promptCharacters: prompt.length,
            responseCharacters: typeof modelMetadata.responseCharacters === "number"
              ? modelMetadata.responseCharacters
              : undefined,
            finishReason: modelMetadata.finishReason,
            promptTokenCount: modelMetadata.promptTokenCount,
            candidatesTokenCount: modelMetadata.candidatesTokenCount,
            totalTokenCount: modelMetadata.totalTokenCount,
            documentId: proposal.document.id,
            componentCount: proposal.document.electrical.components.length,
            netCount: proposal.document.electrical.nets.length,
            diagnosticCount: proposal.validation.diagnostics.length,
          },
          "Generated a staged V2 electrical proposal",
        );
        response.json(validatedResponse.data);
      } catch (error) {
        if (
          error instanceof Error &&
          error.name === "CircuitAiError" &&
          "statusCode" in error &&
          typeof error.statusCode === "number"
        ) {
          const statusCode = error.statusCode;
          if (statusCode >= 500) {
            request.log.error(
              { statusCode, reason: "gemini_generation_failed" },
              "V2 electrical generation failed",
            );
          }
          response.status(statusCode).json({ error: error.message });
          return;
        }
        if (error instanceof CircuitDocumentV2GenerationError) {
          request.log.warn(
            {
              code: error.code,
              diagnosticCount: error.diagnostics.length,
              responseCharacters: typeof modelMetadata.responseCharacters === "number"
                ? modelMetadata.responseCharacters
                : undefined,
            },
            "Gemini returned an unusable V2 electrical proposal",
          );
          response.status(502).json({
            code: error.code,
            error: error.message,
            diagnostics: error.diagnostics,
          });
          return;
        }
        request.log.error(
          { reason: "unexpected_v2_generation_failure" },
          "V2 electrical generation failed",
        );
        response.status(502).json({
          code: "generation-failed",
          error: "Circuit Studio could not generate a V2 electrical proposal. Please try again.",
          diagnostics: [],
        });
      }
    },
  );

  return router;
}

const router = createCircuitDocumentV2GenerationRouter();

export default router;


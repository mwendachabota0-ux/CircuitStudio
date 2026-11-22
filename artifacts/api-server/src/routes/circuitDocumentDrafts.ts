import { getAuth } from "@clerk/express";
import {
  LoadCircuitDocumentV2DraftParams,
  LoadCircuitDocumentV2DraftResponse,
  SaveCircuitDocumentV2DraftBody,
  SaveCircuitDocumentV2DraftParams,
  SaveCircuitDocumentV2DraftResponse,
} from "@workspace/api-zod/generated/api";
import type {
  CircuitDocumentV2DraftError,
  CircuitDocumentV2DraftErrorCode,
} from "@workspace/api-zod";
import {
  Router,
  type IRouter,
  type Request,
  type RequestHandler,
  type Response,
} from "express";
import type {
  CircuitDocumentV2DraftLoadResult,
  CircuitDocumentV2DraftPersistence,
} from "../lib/circuitDocumentDraftService";

type CircuitDocumentDraftRouteOptions = {
  persistence: CircuitDocumentV2DraftPersistence;
  resolveUserId?: (request: Request) => string | null | undefined;
};

type DraftDiagnostic = CircuitDocumentV2DraftError["diagnostics"][number];

const VALID_ERROR_CODES = new Set<CircuitDocumentV2DraftErrorCode>([
  "authentication-required",
  "invalid-session-id",
  "invalid-request",
  "invalid-scope",
  "invalid-revision",
  "malformed-envelope",
  "unsupported-envelope-version",
  "unsupported-representation",
  "unsupported-schema-version",
  "mixed-representations",
  "invalid-document",
  "wrong-representation",
  "schema-version-mismatch",
  "revision-conflict",
  "storage-failed",
]);

function safeErrorCode(code: string): CircuitDocumentV2DraftErrorCode {
  return VALID_ERROR_CODES.has(code as CircuitDocumentV2DraftErrorCode)
    ? (code as CircuitDocumentV2DraftErrorCode)
    : "invalid-document";
}

function sendDraftError(
  response: Response,
  status: number,
  code: CircuitDocumentV2DraftErrorCode,
  message: string,
  diagnostics: DraftDiagnostic[] = [],
): void {
  const body: CircuitDocumentV2DraftError = { code, message, diagnostics };
  response.status(status).json(body);
}

function toDiagnostics(
  issues: Array<{ path: PropertyKey[]; message: string }>,
): DraftDiagnostic[] {
  return issues.map((issue) => ({
    path: issue.path.map(String).join("."),
    message: issue.message,
  }));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function errorForLoad(
  response: Response,
  result: Exclude<CircuitDocumentV2DraftLoadResult, { status: "empty" | "loaded" }>,
): void {
  if (result.status === "failed") {
    sendDraftError(response, 503, "storage-failed", result.message);
    return;
  }
  sendDraftError(
    response,
    422,
    safeErrorCode(result.code),
    result.message,
    result.diagnostics,
  );
}

export function createCircuitDocumentV2DraftRouter(
  options: CircuitDocumentDraftRouteOptions,
): IRouter {
  const persistence = options.persistence;
  const resolveUserId =
    options.resolveUserId ?? ((request: Request) => getAuth(request).userId);
  const router: IRouter = Router();

  const requireAuth: RequestHandler = (request, response, next) => {
    const userId = resolveUserId(request);
    if (!userId) {
      sendDraftError(
        response,
        401,
        "authentication-required",
        "Sign in to access V2 circuit documents.",
      );
      return;
    }
    response.locals.circuitDocumentUserId = userId;
    next();
  };

  router.get(
    "/circuit-documents/v2/sessions/:sessionId",
    requireAuth,
    async (request, response): Promise<void> => {
      const parsedParams = LoadCircuitDocumentV2DraftParams.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        sendDraftError(
          response,
          400,
          "invalid-session-id",
          "The session identifier is invalid.",
          toDiagnostics(parsedParams.error.issues),
        );
        return;
      }

      try {
        const userId = response.locals.circuitDocumentUserId as string;
        const result = await persistence.load(
          userId,
          parsedParams.data.sessionId,
        );
        if (result.status === "empty") {
          response.json(LoadCircuitDocumentV2DraftResponse.parse({ status: "empty" }));
          return;
        }
        if (result.status === "failed" || result.status === "quarantined") {
          errorForLoad(response, result);
          return;
        }

        response.json(
          LoadCircuitDocumentV2DraftResponse.parse({
            status: "loaded",
            representation: result.draft.representation,
            schemaVersion: result.draft.document.schemaVersion,
            revision: result.revision,
            updatedAt: result.updatedAt,
            draft: result.draft,
          }),
        );
      } catch {
        sendDraftError(
          response,
          503,
          "storage-failed",
          "The V2 circuit document could not be loaded.",
        );
      }
    },
  );

  router.put(
    "/circuit-documents/v2/sessions/:sessionId",
    requireAuth,
    async (request, response): Promise<void> => {
      const parsedParams = SaveCircuitDocumentV2DraftParams.safeParse(
        request.params,
      );
      if (!parsedParams.success) {
        sendDraftError(
          response,
          400,
          "invalid-session-id",
          "The session identifier is invalid.",
          toDiagnostics(parsedParams.error.issues),
        );
        return;
      }

      const unknownFields = isRecord(request.body)
        ? Object.keys(request.body).filter(
            (key) => key !== "expectedRevision" && key !== "draft",
          )
        : [];
      if (unknownFields.length > 0) {
        sendDraftError(
          response,
          400,
          "invalid-request",
          "The request contains unsupported fields.",
          unknownFields.map((path) => ({
            path,
            message: "Unexpected request field.",
          })),
        );
        return;
      }

      const parsedBody = SaveCircuitDocumentV2DraftBody.safeParse(request.body);
      if (!parsedBody.success) {
        sendDraftError(
          response,
          400,
          "invalid-request",
          "The V2 circuit document request is invalid.",
          toDiagnostics(parsedBody.error.issues),
        );
        return;
      }

      try {
        const userId = response.locals.circuitDocumentUserId as string;
        // Pass the original envelope: Zod's generated object schemas strip
        // unknown keys, while the persistence validator must reject them.
        const result = await persistence.save(
          userId,
          parsedParams.data.sessionId,
          parsedBody.data.expectedRevision,
          isRecord(request.body) ? request.body.draft : undefined,
        );
        if (result.status === "conflict") {
          sendDraftError(
            response,
            409,
            "revision-conflict",
            "The saved V2 document changed. Reload it before saving again.",
          );
          return;
        }
        if (result.status === "failed") {
          sendDraftError(response, 503, "storage-failed", result.message);
          return;
        }
        if (result.status === "rejected") {
          sendDraftError(
            response,
            400,
            safeErrorCode(result.code),
            result.message,
            result.diagnostics,
          );
          return;
        }

        response.json(
          SaveCircuitDocumentV2DraftResponse.parse({
            status: "saved",
            representation: result.draft.representation,
            schemaVersion: result.draft.document.schemaVersion,
            revision: result.revision,
            updatedAt: result.updatedAt,
            draft: result.draft,
          }),
        );
      } catch {
        sendDraftError(
          response,
          503,
          "storage-failed",
          "The V2 circuit document could not be saved.",
        );
      }
    },
  );

  return router;
}

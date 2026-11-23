import {
  CIRCUIT_DRAFT_ENVELOPE_VERSION,
  CIRCUIT_DRAFT_FORMAT,
  parsePersistedCircuitDraft,
  type CircuitDocumentV2Draft,
  type CircuitDraftDiagnostic,
} from "@workspace/circuit-document";

export type CircuitDocumentV2DraftRecord = {
  userId: string;
  sessionId: string;
  representation: string;
  schemaVersion: number;
  draft: unknown;
  updatedAt: Date;
};

export interface CircuitDocumentV2DraftRepository {
  upsertOwned(record: CircuitDocumentV2DraftRecord): Promise<void>;
  getOwned(
    userId: string,
    sessionId: string,
  ): Promise<CircuitDocumentV2DraftRecord | null>;
}

export type CircuitDocumentV2DraftSaveResult =
  | { status: "saved"; updatedAt: Date; draft: CircuitDocumentV2Draft }
  | {
      status: "rejected";
      code: string;
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
    }
  | { status: "failed"; code: "storage-failed"; message: string };

export type CircuitDocumentV2DraftLoadResult =
  | { status: "empty" }
  | { status: "loaded"; updatedAt: Date; draft: CircuitDocumentV2Draft }
  | {
      status: "quarantined";
      code: string;
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
      rawDraft: unknown;
    }
  | { status: "failed"; code: "storage-failed"; message: string };

function validScope(userId: string, sessionId: string): boolean {
  return (
    userId.trim().length > 0 &&
    sessionId.trim().length > 0 &&
    sessionId.length <= 128
  );
}

export function createCircuitDocumentV2DraftPersistence(
  repository: CircuitDocumentV2DraftRepository,
  now: () => Date = () => new Date(),
) {
  return {
    async save(
      userId: string,
      sessionId: string,
      input: unknown,
    ): Promise<CircuitDocumentV2DraftSaveResult> {
      if (!validScope(userId, sessionId)) {
        return {
          status: "rejected",
          code: "invalid-scope",
          message: "A signed-in user and valid session ID are required.",
          diagnostics: [],
        };
      }

      const parsed = parsePersistedCircuitDraft(input);
      if (parsed.status !== "v2") {
        return {
          status: "rejected",
          code:
            parsed.status === "quarantined"
              ? parsed.code
              : "wrong-representation",
          message:
            parsed.status === "quarantined"
              ? parsed.message
              : "Only explicitly marked CircuitDocumentV2 drafts can be saved here.",
          diagnostics:
            parsed.status === "quarantined" ? parsed.diagnostics : [],
        };
      }

      const updatedAt = now();
      const draft: CircuitDocumentV2Draft = {
        format: CIRCUIT_DRAFT_FORMAT,
        envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
        representation: "circuit-document-v2",
        document: parsed.document,
      };
      try {
        await repository.upsertOwned({
          userId,
          sessionId,
          representation: "circuit-document-v2",
          schemaVersion: parsed.document.schemaVersion,
          draft,
          updatedAt,
        });
      } catch {
        return {
          status: "failed",
          code: "storage-failed",
          message:
            "The v2 circuit draft could not be saved. The previous saved draft remains available.",
        };
      }

      return { status: "saved", updatedAt, draft };
    },

    async load(
      userId: string,
      sessionId: string,
    ): Promise<CircuitDocumentV2DraftLoadResult> {
      if (!validScope(userId, sessionId)) return { status: "empty" };
      let record: CircuitDocumentV2DraftRecord | null;
      try {
        record = await repository.getOwned(userId, sessionId);
      } catch {
        return {
          status: "failed",
          code: "storage-failed",
          message: "The v2 circuit draft could not be loaded.",
        };
      }
      if (!record) return { status: "empty" };

      const parsed = parsePersistedCircuitDraft(record.draft);
      if (record.representation !== "circuit-document-v2") {
        return {
          status: "quarantined",
          code: "unsupported-representation",
          message:
            "The saved record uses an unsupported circuit representation.",
          diagnostics: [],
          rawDraft: record.draft,
        };
      }
      if (record.schemaVersion !== 2) {
        return {
          status: "quarantined",
          code: "unsupported-schema-version",
          message: `CircuitDocument schema version ${record.schemaVersion} is not supported.`,
          diagnostics: [],
          rawDraft: record.draft,
        };
      }
      if (parsed.status !== "v2") {
        return {
          status: "quarantined",
          code:
            parsed.status === "quarantined"
              ? parsed.code
              : "wrong-representation",
          message:
            parsed.status === "quarantined"
              ? parsed.message
              : "A legacy CircuitSpec cannot be interpreted as a v2 draft.",
          diagnostics:
            parsed.status === "quarantined" ? parsed.diagnostics : [],
          rawDraft: record.draft,
        };
      }
      if (parsed.document.schemaVersion !== record.schemaVersion) {
        return {
          status: "quarantined",
          code: "schema-version-mismatch",
          message:
            "The stored schema version does not match the saved document.",
          diagnostics: [],
          rawDraft: record.draft,
        };
      }
      return {
        status: "loaded",
        updatedAt: record.updatedAt,
        draft: {
          format: CIRCUIT_DRAFT_FORMAT,
          envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
          representation: "circuit-document-v2",
          document: parsed.document,
        },
      };
    },
  };
}

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
  revision: number;
  draft: unknown;
  updatedAt: Date;
};

export interface CircuitDocumentV2DraftRepository {
  createIfAbsent(
    record: CircuitDocumentV2DraftRecord,
  ): Promise<CircuitDocumentV2DraftRecord | null>;
  updateIfRevision(
    record: CircuitDocumentV2DraftRecord,
    expectedRevision: number,
  ): Promise<CircuitDocumentV2DraftRecord | null>;
  getOwned(
    userId: string,
    sessionId: string,
  ): Promise<CircuitDocumentV2DraftRecord | null>;
}

export type CircuitDocumentV2DraftSaveResult =
  | {
      status: "saved";
      revision: number;
      updatedAt: Date;
      draft: CircuitDocumentV2Draft;
    }
  | { status: "conflict" }
  | {
      status: "rejected";
      code: string;
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
    }
  | { status: "failed"; code: "storage-failed"; message: string };

export type CircuitDocumentV2DraftLoadResult =
  | { status: "empty" }
  | {
      status: "loaded";
      revision: number;
      updatedAt: Date;
      draft: CircuitDocumentV2Draft;
    }
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

const MAX_EXPECTED_REVISION = 2_147_483_646;

export function createCircuitDocumentV2DraftPersistence(
  repository: CircuitDocumentV2DraftRepository,
  now: () => Date = () => new Date(),
) {
  return {
    async save(
      userId: string,
      sessionId: string,
      expectedRevision: number,
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
      if (
        !Number.isSafeInteger(expectedRevision) ||
        expectedRevision < 0 ||
        expectedRevision > MAX_EXPECTED_REVISION
      ) {
        return {
          status: "rejected",
          code: "invalid-revision",
          message: "A valid expected storage revision is required.",
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
        const record: CircuitDocumentV2DraftRecord = {
          userId,
          sessionId,
          representation: "circuit-document-v2",
          schemaVersion: parsed.document.schemaVersion,
          revision: expectedRevision + 1,
          draft,
          updatedAt,
        };
        const stored =
          expectedRevision === 0
            ? await repository.createIfAbsent(record)
            : await repository.updateIfRevision(record, expectedRevision);
        if (!stored) return { status: "conflict" };
        return {
          status: "saved",
          revision: stored.revision,
          updatedAt: stored.updatedAt,
          draft,
        };
      } catch {
        return {
          status: "failed",
          code: "storage-failed",
          message:
            "The v2 circuit draft could not be saved. The previous saved draft remains available.",
        };
      }
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
        revision: record.revision,
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

export type CircuitDocumentV2DraftPersistence = ReturnType<
  typeof createCircuitDocumentV2DraftPersistence
>;

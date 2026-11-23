import {
  createCircuitDocumentV2Draft,
  importLegacyCircuitSpec,
  loadCircuitDocumentV2Draft,
  projectCircuitDocumentToLegacy,
  reconcileCircuitDraftCopies,
  saveCircuitDocumentV2Draft,
  type CircuitDocumentV2,
  type CircuitDocumentV2Draft,
  type CircuitDraftStorage,
  type CircuitDraftStorageLoadResult,
  type LegacyCircuitSpec,
  type LegacyCircuitTools,
} from "@workspace/circuit-document";

export const CIRCUIT_DOCUMENT_V2_SESSION_METADATA_KEY =
  "circuitStudioV2SessionId";
export const CIRCUIT_DOCUMENT_V2_SESSION_STORAGE_PREFIX =
  "circuit-studio-document-v2-session-v1:";

// Keep false until a disposable development database has been independently
// verified to contain the V2 table. The environment opt-in alone is not enough.
export const CIRCUIT_DOCUMENT_V2_DATABASE_VERIFIED = false;
export const CIRCUIT_DOCUMENT_V2_SYNC_READINESS =
  "server-sync-blocked-by-database-verification" as const;

export type CircuitDocumentV2FeatureFlags = {
  labEnabled: boolean;
  serverSyncOptedIn: boolean;
  serverSyncEnabled: boolean;
  serverSyncBlockedByDatabase: boolean;
};

export function resolveCircuitDocumentV2FeatureFlags(
  labFlag: string | undefined,
  syncFlag: string | undefined,
  databaseVerified = CIRCUIT_DOCUMENT_V2_DATABASE_VERIFIED,
): CircuitDocumentV2FeatureFlags {
  const labEnabled = labFlag === "true";
  const serverSyncOptedIn = syncFlag === "true";
  return {
    labEnabled,
    serverSyncOptedIn,
    serverSyncEnabled:
      labEnabled && serverSyncOptedIn && databaseVerified,
    serverSyncBlockedByDatabase:
      labEnabled && serverSyncOptedIn && !databaseVerified,
  };
}

export function canAccessCircuitDocumentV2Lab(
  labEnabled: boolean,
  isSignedIn: boolean,
  userId: string | null | undefined,
): boolean {
  return labEnabled && isSignedIn && Boolean(userId?.trim());
}

export function getCircuitDocumentV2ProposalApprovalBlockReason(input: {
  status: "ready" | "partial" | "blocked";
  isValid: boolean;
  diagnostics: ReadonlyArray<{ severity: "error" | "warning" }>;
  currentDraftQuarantined?: boolean;
}): string | null {
  if (input.status === "blocked") {
    return "Drawing preparation is blocked. Inspect or reject this proposal instead.";
  }
  if (!input.isValid) {
    return "V2 validation found errors. This proposal cannot be approved.";
  }
  if (input.diagnostics.some((diagnostic) => diagnostic.severity === "error")) {
    return "Error-level validation or drawing diagnostics must be resolved before approval.";
  }
  if (input.currentDraftQuarantined) {
    return "The saved V2 draft is quarantined. Recover it before approving a replacement.";
  }
  return null;
}

export function resolveCircuitDocumentV2ProposalDecision<TDocument>(
  currentDocument: TDocument | null,
  proposedDocument: TDocument,
  decision: "approve" | "reject",
): {
  currentDocument: TDocument | null;
  proposedDocument: null;
} {
  return {
    currentDocument:
      decision === "approve" ? proposedDocument : currentDocument,
    proposedDocument: null,
  };
}

function createSecureId(): string {
  if (!globalThis.crypto?.randomUUID) {
    throw new Error("Secure ID generation is unavailable in this browser.");
  }
  return globalThis.crypto.randomUUID();
}

export function prepareCircuitDocumentV2ProposalForApproval(
  document: CircuitDocumentV2,
  currentSessionId: string | null,
  idFactory: () => string = createSecureId,
): { document: CircuitDocumentV2; sessionId: string } {
  const sessionId = isValidSessionId(currentSessionId)
    ? currentSessionId
    : `v2-session-${idFactory()}`;

  return {
    sessionId,
    document: {
      ...document,
      metadata: {
        ...document.metadata,
        [CIRCUIT_DOCUMENT_V2_SESSION_METADATA_KEY]: sessionId,
      },
    },
  };
}

function isValidSessionId(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= 128 &&
    /\S/.test(value)
  );
}

export function getCircuitDocumentV2SessionStorageKey(userId: string): string {
  if (!userId.trim()) throw new TypeError("A signed-in user ID is required.");
  return `${CIRCUIT_DOCUMENT_V2_SESSION_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function loadCircuitDocumentV2SessionId(
  storage: Pick<CircuitDraftStorage, "getItem">,
  userId: string,
): string | null {
  try {
    const candidate = storage.getItem(
      getCircuitDocumentV2SessionStorageKey(userId),
    );
    return isValidSessionId(candidate) ? candidate : null;
  } catch {
    return null;
  }
}

export function saveCircuitDocumentV2SessionId(
  storage: Pick<CircuitDraftStorage, "setItem">,
  userId: string,
  sessionId: string,
): boolean {
  if (!isValidSessionId(sessionId)) return false;
  try {
    storage.setItem(
      getCircuitDocumentV2SessionStorageKey(userId),
      sessionId,
    );
    return true;
  } catch {
    return false;
  }
}

export function getCircuitDocumentV2DocumentSessionId(
  document: CircuitDocumentV2,
): string | null {
  const sessionId =
    document.metadata?.[CIRCUIT_DOCUMENT_V2_SESSION_METADATA_KEY];
  return isValidSessionId(sessionId) ? sessionId : null;
}

export type CircuitDocumentV2ImportResult =
  | {
      status: "created";
      document: CircuitDocumentV2;
      sessionId: string;
      importStatus: "complete" | "complete-with-warnings";
      diagnostics: ReturnType<typeof importLegacyCircuitSpec>["diagnostics"];
    }
  | {
      status: "blocked";
      diagnostics: ReturnType<typeof importLegacyCircuitSpec>["diagnostics"];
    };

export function createCircuitDocumentV2Copy(
  source: LegacyCircuitSpec,
  tools: LegacyCircuitTools,
  idFactory: () => string = createSecureId,
): CircuitDocumentV2ImportResult {
  const documentId = `v2-document-${idFactory()}`;
  const sessionId = `v2-session-${idFactory()}`;
  const imported = importLegacyCircuitSpec(source, tools, { documentId });

  if (!imported.trusted || !imported.document || imported.status === "blocked") {
    return { status: "blocked", diagnostics: imported.diagnostics };
  }

  const document = createCircuitDocumentV2Draft({
    ...imported.document,
    metadata: {
      ...imported.document.metadata,
      [CIRCUIT_DOCUMENT_V2_SESSION_METADATA_KEY]: sessionId,
    },
  }).document;

  return {
    status: "created",
    document,
    sessionId,
    importStatus: imported.status,
    diagnostics: imported.diagnostics,
  };
}

export type CircuitDocumentV2RemoteSaveInput = {
  sessionId: string;
  expectedRevision: number;
  draft: CircuitDocumentV2Draft;
};

export type CircuitDocumentV2RemoteSave = (
  input: CircuitDocumentV2RemoteSaveInput,
) => Promise<{ revision: number }>;

export type CircuitDocumentV2LocalFirstSaveResult =
  | {
      status: "local-save-failed";
      message: string;
    }
  | {
      status: "local-only";
      draft: CircuitDocumentV2Draft;
      sessionPointerSaved: boolean;
    }
  | {
      status: "synced";
      draft: CircuitDocumentV2Draft;
      revision: number;
      sessionPointerSaved: boolean;
    }
  | {
      status: "server-unavailable";
      draft: CircuitDocumentV2Draft;
      sessionPointerSaved: boolean;
      message: string;
    }
  | {
      status: "revision-conflict";
      draft: CircuitDocumentV2Draft;
      sessionPointerSaved: boolean;
      message: string;
    };

export function isCircuitDocumentV2RevisionConflict(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const record = error as Record<string, unknown>;
  const data =
    record.data && typeof record.data === "object"
      ? (record.data as Record<string, unknown>)
      : null;
  return (
    record.status === 409 ||
    record.code === "revision-conflict" ||
    data?.code === "revision-conflict"
  );
}

export async function saveCircuitDocumentV2LocalFirst(options: {
  storage: CircuitDraftStorage | null;
  userId: string;
  document: CircuitDocumentV2;
  sessionId: string | null;
  serverSyncEnabled: boolean;
  expectedRevision: number;
  saveRemote?: CircuitDocumentV2RemoteSave;
}): Promise<CircuitDocumentV2LocalFirstSaveResult> {
  const { storage, userId, document, sessionId } = options;
  const local = storage
    ? saveCircuitDocumentV2Draft(storage, userId, document)
    : {
        ok: false as const,
        code: "storage-unavailable" as const,
        message: "Browser storage is unavailable.",
        diagnostics: [],
      };
  if (!local.ok) {
    return { status: "local-save-failed", message: local.message };
  }

  const sessionPointerSaved = storage && sessionId
    ? saveCircuitDocumentV2SessionId(storage, userId, sessionId)
    : false;
  if (!options.serverSyncEnabled) {
    return {
      status: "local-only",
      draft: local.draft,
      sessionPointerSaved,
    };
  }
  if (!sessionId || !options.saveRemote) {
    return {
      status: "server-unavailable",
      draft: local.draft,
      sessionPointerSaved,
      message: "The V2 server session is unavailable; the local copy is safe.",
    };
  }

  try {
    const saved = await options.saveRemote({
      sessionId,
      expectedRevision: options.expectedRevision,
      draft: local.draft,
    });
    return {
      status: "synced",
      draft: local.draft,
      revision: saved.revision,
      sessionPointerSaved,
    };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "The V2 server copy could not be saved.";
    if (isCircuitDocumentV2RevisionConflict(error)) {
      return {
        status: "revision-conflict",
        draft: local.draft,
        sessionPointerSaved,
        message,
      };
    }
    return {
      status: "server-unavailable",
      draft: local.draft,
      sessionPointerSaved,
      message,
    };
  }
}

export function loadCircuitDocumentV2LocalDraft(
  storage: Pick<CircuitDraftStorage, "getItem"> | null,
  userId: string,
): CircuitDraftStorageLoadResult {
  if (!storage) {
    return {
      status: "quarantined",
      code: "storage-unavailable",
      message: "Browser storage is unavailable.",
      diagnostics: [],
    };
  }
  return loadCircuitDocumentV2Draft(storage, userId);
}

export {
  projectCircuitDocumentToLegacy,
  reconcileCircuitDraftCopies,
};

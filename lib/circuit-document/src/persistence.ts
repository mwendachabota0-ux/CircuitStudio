import { CircuitDocumentV2Schema, type CircuitDocumentV2 } from "./model.ts";
import { validateCircuitDocumentV2 } from "./validation.ts";
import type { LegacyCircuitSpec } from "./legacy.ts";

export const CIRCUIT_DRAFT_FORMAT = "circuit-studio-draft" as const;
export const CIRCUIT_DRAFT_ENVELOPE_VERSION = 1 as const;
export const CIRCUIT_DRAFT_REPRESENTATIONS = [
  "legacy-circuit-spec",
  "circuit-document-v2",
] as const;
export const CIRCUIT_DOCUMENT_V2_DRAFT_STORAGE_PREFIX =
  "circuit-studio-document-v2-v1:";

export type LegacyCircuitDraft = {
  format: typeof CIRCUIT_DRAFT_FORMAT;
  envelopeVersion: typeof CIRCUIT_DRAFT_ENVELOPE_VERSION;
  representation: "legacy-circuit-spec";
  document: LegacyCircuitSpec;
};

export type CircuitDocumentV2Draft = {
  format: typeof CIRCUIT_DRAFT_FORMAT;
  envelopeVersion: typeof CIRCUIT_DRAFT_ENVELOPE_VERSION;
  representation: "circuit-document-v2";
  document: CircuitDocumentV2;
};

export type PersistedCircuitDraft = LegacyCircuitDraft | CircuitDocumentV2Draft;

export type CircuitDraftQuarantineCode =
  | "malformed-envelope"
  | "unsupported-envelope-version"
  | "unsupported-representation"
  | "unsupported-schema-version"
  | "mixed-representations"
  | "invalid-document"
  | "wrong-representation"
  | "conflicting-copies";

export type CircuitDraftDiagnostic = {
  path: string;
  message: string;
};

export type CircuitDraftReadResult =
  | {
      status: "legacy";
      representation: "legacy-circuit-spec";
      document: LegacyCircuitSpec;
    }
  | {
      status: "v2";
      representation: "circuit-document-v2";
      document: CircuitDocumentV2;
    }
  | {
      status: "quarantined";
      code: CircuitDraftQuarantineCode;
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
      rawValue: unknown;
    };

export interface CircuitDraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export type CircuitDraftSaveResult =
  | { ok: true; draft: CircuitDocumentV2Draft }
  | {
      ok: false;
      code:
        CircuitDraftQuarantineCode | "storage-unavailable" | "invalid-scope";
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
    };

export type CircuitDraftStorageLoadResult =
  | { status: "empty" }
  | { status: "v2"; draft: CircuitDocumentV2Draft }
  | {
      status: "quarantined";
      code:
        CircuitDraftQuarantineCode | "storage-unavailable" | "invalid-scope";
      message: string;
      diagnostics: CircuitDraftDiagnostic[];
      rawValue?: string;
    };

export type CircuitDraftCopyReconciliation =
  | { status: "empty" }
  | {
      status: "resolved";
      source: "local" | "server";
      representation: "legacy-circuit-spec" | "circuit-document-v2";
      document: LegacyCircuitSpec | CircuitDocumentV2;
    }
  | {
      status: "quarantined";
      code: CircuitDraftQuarantineCode;
      message: string;
      authoritativeRepresentation?:
        "legacy-circuit-spec" | "circuit-document-v2";
      localValue?: unknown;
      serverValue?: unknown;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function isLegacyCircuitSpec(value: unknown): value is LegacyCircuitSpec {
  return (
    isRecord(value) &&
    typeof value.title === "string" &&
    Array.isArray(value.elements)
  );
}

function quarantine(
  code: CircuitDraftQuarantineCode,
  message: string,
  rawValue: unknown,
  diagnostics: CircuitDraftDiagnostic[] = [],
): CircuitDraftReadResult {
  return { status: "quarantined", code, message, diagnostics, rawValue };
}

export function createLegacyCircuitDraft(
  document: LegacyCircuitSpec,
): LegacyCircuitDraft {
  return {
    format: CIRCUIT_DRAFT_FORMAT,
    envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
    representation: "legacy-circuit-spec",
    document,
  };
}

export function createCircuitDocumentV2Draft(
  value: unknown,
): CircuitDocumentV2Draft {
  const parsed = CircuitDocumentV2Schema.parse(value);
  const validation = validateCircuitDocumentV2(parsed);
  if (!validation.isValid) {
    throw new TypeError(
      "CircuitDocumentV2 contains invalid electrical or drawing data.",
    );
  }
  return {
    format: CIRCUIT_DRAFT_FORMAT,
    envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
    representation: "circuit-document-v2",
    document: parsed,
  };
}

/**
 * Decode a versioned envelope or an existing unwrapped legacy CircuitSpec.
 * The raw legacy value is returned unchanged; no format conversion occurs.
 */
export function parsePersistedCircuitDraft(
  value: unknown,
): CircuitDraftReadResult {
  if (!isRecord(value)) {
    return quarantine(
      "malformed-envelope",
      "A saved circuit draft must be an object.",
      value,
    );
  }

  const hasRepresentationMarker =
    "format" in value || "representation" in value || "document" in value;
  if (!hasRepresentationMarker && isLegacyCircuitSpec(value)) {
    return {
      status: "legacy",
      representation: "legacy-circuit-spec",
      document: value,
    };
  }

  if (!hasRepresentationMarker || value.format !== CIRCUIT_DRAFT_FORMAT) {
    return quarantine(
      "malformed-envelope",
      "The circuit draft does not have a supported representation marker.",
      value,
    );
  }

  if (
    "currentSpec" in value ||
    "legacySpec" in value ||
    "legacyDocument" in value ||
    ("title" in value && "elements" in value)
  ) {
    return quarantine(
      "mixed-representations",
      "The saved envelope contains both legacy and versioned circuit data.",
      value,
    );
  }

  const allowedEnvelopeKeys = new Set([
    "format",
    "envelopeVersion",
    "representation",
    "document",
  ]);
  const unexpectedKeys = Object.keys(value).filter(
    (key) => !allowedEnvelopeKeys.has(key),
  );
  if (unexpectedKeys.length > 0) {
    return quarantine(
      "malformed-envelope",
      "The circuit draft envelope contains unrecognized fields.",
      value,
      unexpectedKeys.map((path) => ({
        path,
        message: "Unexpected envelope field.",
      })),
    );
  }

  if (value.envelopeVersion !== CIRCUIT_DRAFT_ENVELOPE_VERSION) {
    return quarantine(
      "unsupported-envelope-version",
      "This circuit draft envelope version is not supported.",
      value,
    );
  }

  if (value.representation === "legacy-circuit-spec") {
    if (!isLegacyCircuitSpec(value.document)) {
      return quarantine(
        "invalid-document",
        "The saved legacy CircuitSpec is malformed.",
        value,
      );
    }
    return {
      status: "legacy",
      representation: "legacy-circuit-spec",
      document: value.document,
    };
  }

  if (value.representation !== "circuit-document-v2") {
    return quarantine(
      "unsupported-representation",
      "This circuit draft representation is not supported.",
      value,
    );
  }

  const candidate = value.document;
  if (
    isRecord(candidate) &&
    typeof candidate.schemaVersion === "number" &&
    candidate.schemaVersion !== 2
  ) {
    return quarantine(
      "unsupported-schema-version",
      `CircuitDocument schema version ${candidate.schemaVersion} is not supported.`,
      value,
    );
  }

  const parsed = CircuitDocumentV2Schema.safeParse(candidate);
  if (!parsed.success) {
    return quarantine(
      "invalid-document",
      "The saved CircuitDocumentV2 does not match its schema.",
      value,
      parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    );
  }

  const validation = validateCircuitDocumentV2(parsed.data);
  const diagnostics = [
    ...validation.schemaErrors,
    ...validation.electricalErrors,
    ...validation.drawingErrors,
  ].map(({ path, message }) => ({ path, message }));
  if (!validation.isValid) {
    return quarantine(
      "invalid-document",
      "The saved CircuitDocumentV2 failed model validation.",
      value,
      diagnostics,
    );
  }

  return {
    status: "v2",
    representation: "circuit-document-v2",
    document: parsed.data,
  };
}

function stableSerialize(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableSerialize).join(",")}]`;
  }
  if (isRecord(value)) {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableSerialize(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value) ?? "undefined";
}

/**
 * Reconcile independently stored copies only when they agree. A representation
 * conflict is surfaced; v2 is identified as canonical when present, but no
 * divergent copy is silently selected by timestamp or write order.
 */
export function reconcileCircuitDraftCopies(
  localValue: unknown | null,
  serverValue: unknown | null,
): CircuitDraftCopyReconciliation {
  if (localValue === null && serverValue === null) return { status: "empty" };
  const local =
    localValue === null ? null : parsePersistedCircuitDraft(localValue);
  const server =
    serverValue === null ? null : parsePersistedCircuitDraft(serverValue);
  if (local === null || server === null) {
    const present = local ?? server!;
    if (present.status === "quarantined") {
      return {
        status: "quarantined",
        code: present.code,
        message: present.message,
        ...(present.status === "quarantined"
          ? { localValue, serverValue }
          : {}),
      };
    }
    return {
      status: "resolved",
      source: local === null ? "server" : "local",
      representation: present.representation,
      document: present.document,
    };
  }

  if (local.status === "quarantined") {
    if (server.status === "quarantined") {
      return {
        status: "quarantined",
        code: local.code,
        message: "Both local and server drafts require recovery.",
        localValue,
        serverValue,
      };
    }
    return {
      status: "quarantined",
      code: local.code,
      message: local.message,
      authoritativeRepresentation: server.representation,
      localValue,
      serverValue,
    };
  }
  if (server.status === "quarantined") {
    return {
      status: "quarantined",
      code: server.code,
      message: server.message,
      authoritativeRepresentation: local.representation,
      localValue,
      serverValue,
    };
  }

  if (local.representation !== server.representation) {
    return {
      status: "quarantined",
      code: "mixed-representations",
      message:
        "Local and server drafts use different representations; neither was merged.",
      authoritativeRepresentation: "circuit-document-v2",
      localValue,
      serverValue,
    };
  }

  if (stableSerialize(local.document) !== stableSerialize(server.document)) {
    return {
      status: "quarantined",
      code: "conflicting-copies",
      message:
        "Local and server drafts differ; review or reconcile them before restoring.",
      authoritativeRepresentation: local.representation,
      localValue,
      serverValue,
    };
  }

  return {
    status: "resolved",
    source: "server",
    representation: server.representation,
    document: server.document,
  };
}

export function getCircuitDocumentV2DraftStorageKey(userId: string): string {
  if (!userId.trim()) throw new TypeError("A signed-in user ID is required.");
  return `${CIRCUIT_DOCUMENT_V2_DRAFT_STORAGE_PREFIX}${encodeURIComponent(userId)}`;
}

export function saveCircuitDocumentV2Draft(
  storage: CircuitDraftStorage,
  userId: string,
  value: unknown,
): CircuitDraftSaveResult {
  let storageKey: string;
  try {
    storageKey = getCircuitDocumentV2DraftStorageKey(userId);
  } catch {
    return {
      ok: false,
      code: "invalid-scope",
      message: "A signed-in user ID is required to save a v2 circuit draft.",
      diagnostics: [],
    };
  }

  let draft: CircuitDocumentV2Draft;
  try {
    draft = createCircuitDocumentV2Draft(value);
  } catch (error) {
    const read = parsePersistedCircuitDraft({
      format: CIRCUIT_DRAFT_FORMAT,
      envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
      representation: "circuit-document-v2",
      document: value,
    });
    return {
      ok: false,
      code: read.status === "quarantined" ? read.code : "invalid-document",
      message:
        error instanceof Error ? error.message : "The v2 document is invalid.",
      diagnostics: read.status === "quarantined" ? read.diagnostics : [],
    };
  }

  let serialized: string;
  try {
    serialized = JSON.stringify(draft);
  } catch {
    return {
      ok: false,
      code: "invalid-document",
      message: "The v2 document could not be serialized.",
      diagnostics: [],
    };
  }

  try {
    storage.setItem(storageKey, serialized);
    return { ok: true, draft };
  } catch {
    return {
      ok: false,
      code: "storage-unavailable",
      message: "Browser storage could not save the v2 circuit draft.",
      diagnostics: [],
    };
  }
}

export function loadCircuitDocumentV2Draft(
  storage: Pick<CircuitDraftStorage, "getItem">,
  userId: string,
): CircuitDraftStorageLoadResult {
  let storageKey: string;
  try {
    storageKey = getCircuitDocumentV2DraftStorageKey(userId);
  } catch {
    return {
      status: "quarantined",
      code: "invalid-scope",
      message: "A signed-in user ID is required to restore a v2 circuit draft.",
      diagnostics: [],
    };
  }

  let rawValue: string | null;
  try {
    rawValue = storage.getItem(storageKey);
  } catch {
    return {
      status: "quarantined",
      code: "storage-unavailable",
      message: "Browser storage could not read the v2 circuit draft.",
      diagnostics: [],
    };
  }
  if (rawValue === null) return { status: "empty" };

  let value: unknown;
  try {
    value = JSON.parse(rawValue);
  } catch {
    return {
      status: "quarantined",
      code: "malformed-envelope",
      message: "The stored v2 circuit draft is not valid JSON.",
      diagnostics: [],
      rawValue,
    };
  }

  const parsed = parsePersistedCircuitDraft(value);
  if (parsed.status === "v2")
    return {
      status: "v2",
      draft: createCircuitDocumentV2Draft(parsed.document),
    };
  return {
    status: "quarantined",
    code: parsed.status === "legacy" ? "wrong-representation" : parsed.code,
    message:
      parsed.status === "legacy"
        ? "A legacy CircuitSpec was found in the v2 draft slot."
        : parsed.message,
    diagnostics: parsed.status === "legacy" ? [] : parsed.diagnostics,
    rawValue,
  };
}

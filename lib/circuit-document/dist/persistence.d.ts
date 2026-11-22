import { type CircuitDocumentV2 } from "./model.ts";
import type { LegacyCircuitSpec } from "./legacy.ts";
export declare const CIRCUIT_DRAFT_FORMAT: "circuit-studio-draft";
export declare const CIRCUIT_DRAFT_ENVELOPE_VERSION: 1;
export declare const CIRCUIT_DRAFT_REPRESENTATIONS: readonly ["legacy-circuit-spec", "circuit-document-v2"];
export declare const CIRCUIT_DOCUMENT_V2_DRAFT_STORAGE_PREFIX = "circuit-studio-document-v2-v1:";
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
export type CircuitDraftQuarantineCode = "malformed-envelope" | "unsupported-envelope-version" | "unsupported-representation" | "unsupported-schema-version" | "mixed-representations" | "invalid-document" | "wrong-representation" | "conflicting-copies";
export type CircuitDraftDiagnostic = {
    path: string;
    message: string;
};
export type CircuitDraftReadResult = {
    status: "legacy";
    representation: "legacy-circuit-spec";
    document: LegacyCircuitSpec;
} | {
    status: "v2";
    representation: "circuit-document-v2";
    document: CircuitDocumentV2;
} | {
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
export type CircuitDraftSaveResult = {
    ok: true;
    draft: CircuitDocumentV2Draft;
} | {
    ok: false;
    code: CircuitDraftQuarantineCode | "storage-unavailable" | "invalid-scope";
    message: string;
    diagnostics: CircuitDraftDiagnostic[];
};
export type CircuitDraftStorageLoadResult = {
    status: "empty";
} | {
    status: "v2";
    draft: CircuitDocumentV2Draft;
} | {
    status: "quarantined";
    code: CircuitDraftQuarantineCode | "storage-unavailable" | "invalid-scope";
    message: string;
    diagnostics: CircuitDraftDiagnostic[];
    rawValue?: string;
};
export type CircuitDraftCopyReconciliation = {
    status: "empty";
} | {
    status: "resolved";
    source: "local" | "server";
    representation: "legacy-circuit-spec" | "circuit-document-v2";
    document: LegacyCircuitSpec | CircuitDocumentV2;
} | {
    status: "quarantined";
    code: CircuitDraftQuarantineCode;
    message: string;
    authoritativeRepresentation?: "legacy-circuit-spec" | "circuit-document-v2";
    localValue?: unknown;
    serverValue?: unknown;
};
export declare function createLegacyCircuitDraft(document: LegacyCircuitSpec): LegacyCircuitDraft;
export declare function createCircuitDocumentV2Draft(value: unknown): CircuitDocumentV2Draft;
/**
 * Decode a versioned envelope or an existing unwrapped legacy CircuitSpec.
 * The raw legacy value is returned unchanged; no format conversion occurs.
 */
export declare function parsePersistedCircuitDraft(value: unknown): CircuitDraftReadResult;
/**
 * Reconcile independently stored copies only when they agree. A representation
 * conflict is surfaced; v2 is identified as canonical when present, but no
 * divergent copy is silently selected by timestamp or write order.
 */
export declare function reconcileCircuitDraftCopies(localValue: unknown | null, serverValue: unknown | null): CircuitDraftCopyReconciliation;
export declare function getCircuitDocumentV2DraftStorageKey(userId: string): string;
export declare function saveCircuitDocumentV2Draft(storage: CircuitDraftStorage, userId: string, value: unknown): CircuitDraftSaveResult;
export declare function loadCircuitDocumentV2Draft(storage: Pick<CircuitDraftStorage, "getItem">, userId: string): CircuitDraftStorageLoadResult;
//# sourceMappingURL=persistence.d.ts.map
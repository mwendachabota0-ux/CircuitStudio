import type { CircuitDocumentDiagnostic, CircuitDocumentV2 } from "./model.ts";
export declare const CIRCUIT_ROUTING_ALGORITHM_VERSION: "circuit-routing/1";
export type CircuitRoutingOptions = {
    /** Orthogonal search grid in pixels. Defaults to the documented 10 px grid. */
    gridPx?: number;
    /** Minimum clearance from resolved symbol body bounds. Defaults to 12 px. */
    clearancePx?: number;
    /** Bounded search envelope beyond the current tree and target. */
    searchMarginCells?: number;
    /** Maximum A* nodes expanded for one branch connection. */
    maxExpandedNodes?: number;
};
export type CircuitRoutingRequest = {
    document: CircuitDocumentV2;
    options?: CircuitRoutingOptions;
    algorithmVersion: typeof CIRCUIT_ROUTING_ALGORITHM_VERSION;
};
export type CircuitRoutingResult = {
    status: "complete";
    document: CircuitDocumentV2;
    diagnostics: CircuitDocumentDiagnostic[];
    routedNetIds: string[];
    skippedNetIds: string[];
    blockedNetIds: [];
    algorithmVersion: typeof CIRCUIT_ROUTING_ALGORITHM_VERSION;
} | {
    status: "incomplete";
    document: CircuitDocumentV2;
    diagnostics: CircuitDocumentDiagnostic[];
    routedNetIds: string[];
    skippedNetIds: string[];
    blockedNetIds: string[];
    algorithmVersion: typeof CIRCUIT_ROUTING_ALGORITHM_VERSION;
} | {
    status: "blocked";
    diagnostics: CircuitDocumentDiagnostic[];
    algorithmVersion: typeof CIRCUIT_ROUTING_ALGORITHM_VERSION;
};
//# sourceMappingURL=routing-types.d.ts.map
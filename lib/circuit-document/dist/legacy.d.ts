import { type CircuitDocumentDiagnostic, type CircuitDocumentV2 } from "./model.ts";
export type LegacyCircuitElement = Record<string, unknown> & {
    type: string;
};
export type LegacyCircuitSpec = Record<string, unknown> & {
    title?: string;
    width?: number;
    height?: number;
    elements: LegacyCircuitElement[];
};
export type LegacyPinMembership = {
    elementIndex: number;
    pinIndex: number;
    pinName: string;
    netKey: string;
    netName: string;
    connected: boolean;
};
export type LegacyRouteMembership = {
    elementIndex: number;
    netKey: string;
    netName: string;
};
export type LegacyMembershipNetlist = {
    parts: Array<{
        designator: string;
        type: string;
        value: string;
    }>;
    nets: Array<{
        name: string;
        pins: string[];
    }>;
    pinMembership?: LegacyPinMembership[];
    routeMembership?: LegacyRouteMembership[];
};
export type LegacyCircuitValidation = {
    errors: string[];
    warnings?: string[];
    topologyErrors?: string[];
};
export type LegacyCircuitTools = {
    netlistWithMembership: (spec: LegacyCircuitSpec, allowStructuralErrors?: boolean) => LegacyMembershipNetlist;
    validate: (spec: LegacyCircuitSpec) => LegacyCircuitValidation;
};
export type LegacyImportResult = {
    status: "complete" | "complete-with-warnings" | "blocked";
    trusted: boolean;
    document?: CircuitDocumentV2;
    partialDocument?: unknown;
    original: LegacyCircuitSpec;
    diagnostics: CircuitDocumentDiagnostic[];
};
export type LegacyProjectionResult = {
    status: "representable" | "not-representable";
    spec?: LegacyCircuitSpec;
    diagnostics: CircuitDocumentDiagnostic[];
};
/**
 * Converts legacy coordinates through CircuitDraw's own netlist grouping.
 * This adapter does not reimplement legacy connectivity or alter the input.
 */
export declare function importLegacyCircuitSpec(original: LegacyCircuitSpec, tools: LegacyCircuitTools, options?: {
    documentId?: string;
}): LegacyImportResult;
/**
 * Projects only the subset whose identities and complete wire geometry can be
 * expressed safely by the existing CircuitSpec format.
 */
export declare function projectCircuitDocumentToLegacy(value: unknown, tools: LegacyCircuitTools): LegacyProjectionResult;
//# sourceMappingURL=legacy.d.ts.map
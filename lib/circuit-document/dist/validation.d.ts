import { type CircuitDocumentDiagnostic, type CircuitPinReference } from "./model.ts";
export type CircuitDocumentValidationResult = {
    schemaErrors: CircuitDocumentDiagnostic[];
    electricalErrors: CircuitDocumentDiagnostic[];
    drawingErrors: CircuitDocumentDiagnostic[];
    drawingWarnings: CircuitDocumentDiagnostic[];
    consistencyWarnings: CircuitDocumentDiagnostic[];
    unassignedPins: CircuitPinReference[];
    isValid: boolean;
};
export declare function checkCircuitDrawingConsistency(value: unknown): CircuitDocumentDiagnostic[];
export declare function validateCircuitDocumentV2(value: unknown): CircuitDocumentValidationResult;
export declare function arePinsElectricallyConnected(value: unknown, first: CircuitPinReference, second: CircuitPinReference): boolean;
//# sourceMappingURL=validation.d.ts.map
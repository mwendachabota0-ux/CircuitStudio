import type { CircuitDocumentDiagnostic, CircuitDocumentV2 } from './model.ts';
import type { CircuitLayoutHints, CircuitLayoutMetrics } from './layout-types.ts';
import type { CircuitRoutingOptions } from './routing-types.ts';
export declare const CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION: "circuit-drawing-preparation/1";
export type CircuitDrawingPreparationRequest = {
    document: CircuitDocumentV2;
    placementHints?: CircuitLayoutHints;
    routingOptions?: CircuitRoutingOptions;
    algorithmVersion: typeof CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION;
};
export type CircuitDrawingPreparationMetrics = {
    placement?: CircuitLayoutMetrics;
    routing?: {
        routedNetCount: number;
        skippedNetCount: number;
        blockedNetCount: number;
    };
};
type CircuitDrawingPreparationBase = {
    algorithmVersion: typeof CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION;
    diagnostics: CircuitDocumentDiagnostic[];
    metrics?: CircuitDrawingPreparationMetrics;
    routedNetIds: string[];
    skippedNetIds: string[];
    blockedNetIds: string[];
};
export type CircuitDrawingPreparationResult = (CircuitDrawingPreparationBase & {
    status: 'invalid-input';
    document?: never;
    stages: {
        placement: 'not-run';
        routing: 'not-run';
    };
}) | (CircuitDrawingPreparationBase & {
    status: 'placement-blocked';
    document: CircuitDocumentV2;
    stages: {
        placement: 'blocked';
        routing: 'not-run';
    };
}) | (CircuitDrawingPreparationBase & {
    status: 'routing-blocked';
    document: CircuitDocumentV2;
    stages: {
        placement: 'complete';
        routing: 'blocked';
    };
}) | (CircuitDrawingPreparationBase & {
    status: 'partial';
    document: CircuitDocumentV2;
    stages: {
        placement: 'complete';
        routing: 'complete' | 'incomplete';
    };
}) | (CircuitDrawingPreparationBase & {
    status: 'complete';
    document: CircuitDocumentV2;
    stages: {
        placement: 'complete';
        routing: 'complete';
    };
});
export {};
//# sourceMappingURL=drawing-preparation-types.d.ts.map
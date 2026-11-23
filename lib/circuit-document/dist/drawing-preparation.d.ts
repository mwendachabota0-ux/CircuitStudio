import { type CircuitDrawingPreparationRequest, type CircuitDrawingPreparationResult } from './drawing-preparation-types.ts';
/**
 * Places only unplaced components, then routes eligible nets without existing
 * routes. Existing placements and manual drawing data are never reworked.
 */
export declare function prepareCircuitDocumentDrawing(request: CircuitDrawingPreparationRequest): CircuitDrawingPreparationResult;
//# sourceMappingURL=drawing-preparation.d.ts.map
import { type CircuitElementGeometry, type CircuitGeometryResolution } from '@workspace/circuit-geometry';
import type { CircuitComponentV2, CircuitDocumentV2 } from './model.ts';
type CircuitPlacementV2 = CircuitDocumentV2['drawing']['placements'][number];
/**
 * Resolve geometry from canonical component data and placement fields only.
 * placement.properties is intentionally not spread into this source object.
 */
export declare function createCircuitGeometryElement(component: CircuitComponentV2, placement: CircuitPlacementV2): CircuitElementGeometry;
export declare function resolveCircuitDocumentComponentGeometry(component: CircuitComponentV2, placement: CircuitPlacementV2): CircuitGeometryResolution;
/**
 * Identifies attempted shadow copies of geometry properties. The canonical
 * value comes from component data, legacyGeometry, or explicit placement
 * transform fields; placement.properties is never a geometry authority.
 */
export declare function getPlacementGeometryPropertyConflicts(component: CircuitComponentV2, placement: CircuitPlacementV2): string[];
export {};
//# sourceMappingURL=geometry.d.ts.map
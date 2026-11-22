import type { CircuitDocumentV2, CircuitPoint } from './model.ts';
export type CircuitPlacementMode = 'place-unplaced' | 'reflow' | 'preserve-pinned';
export type CircuitPlacement = CircuitDocumentV2['drawing']['placements'][number];
export type PlacementMobilityDecision = {
    mobility: 'movable';
    reason: 'unplaced' | 'explicit-reflow' | 'explicitly-unpinned';
} | {
    mobility: 'protected';
    reason: 'existing-placement' | 'user-pinned' | 'legacy-placement' | 'request-pinned' | 'request-fixed-position';
    fixedPosition?: CircuitPoint;
};
export type PlacementMobilityRequest = {
    componentId: string;
    mode: CircuitPlacementMode;
    placement?: CircuitPlacement;
    pinnedComponentIds?: readonly string[];
    fixedPositions?: Readonly<Record<string, CircuitPoint>>;
};
export type PlacementRouteImpact = {
    movedComponentIds: string[];
    affectedNetIds: string[];
    affectedRouteIds: string[];
    unroutedNetIds: string[];
    requiresRerouting: boolean;
};
/**
 * Determines whether one existing placement may move under an explicit mode.
 * Unmarked legacy placements are protected by default in preserve-pinned;
 * reflow is the explicit authorization to move an old unmarked placement.
 */
export declare function resolvePlacementMobility(request: PlacementMobilityRequest): PlacementMobilityDecision;
/**
 * Reports every existing route on a net touched by a moved component. It does
 * not edit placements, routes, junctions, or crossings.
 */
export declare function getPlacementRouteImpact(document: CircuitDocumentV2, movedComponentIds: readonly string[]): PlacementRouteImpact;
//# sourceMappingURL=placement-policy.d.ts.map
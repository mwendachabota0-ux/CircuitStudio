import type {
  CircuitDocumentDiagnostic,
  CircuitDocumentV2,
} from './model.ts';
import type { CircuitPlacementMode, PlacementRouteImpact } from './placement-policy.ts';
import type { CircuitGeometryBounds } from '@workspace/circuit-geometry';

export const CIRCUIT_LAYOUT_ALGORITHM_VERSION = 'circuit-layout/1' as const;

export type CircuitLayoutDirection =
  | 'left-to-right'
  | 'right-to-left'
  | 'top-to-bottom'
  | 'bottom-to-top';

export type CircuitLayoutRole = 'source' | 'input' | 'active' | 'output' | 'unknown';
export type CircuitLayoutNetRole = 'power' | 'return' | 'signal' | 'unknown';

export type CircuitLayoutHints = {
  direction?: CircuitLayoutDirection;
  gridPx?: number;
  bodyClearancePx?: number;
  routeCorridorPx?: number;
  pinnedComponentIds?: string[];
  fixedPositions?: Record<string, [number, number]>;
  componentRoles?: Record<string, CircuitLayoutRole>;
  netRolesById?: Record<string, CircuitLayoutNetRole>;
  canvasPolicy?: 'respect-existing' | 'allow-overflow';
};

export type CircuitLayoutRequest = {
  document: CircuitDocumentV2;
  mode: CircuitPlacementMode;
  hints?: CircuitLayoutHints;
  algorithmVersion: typeof CIRCUIT_LAYOUT_ALGORITHM_VERSION;
};

export type CircuitLayoutMetrics = {
  componentCount: number;
  unplacedBefore: number;
  movedExisting: number;
  connectedSubcircuitCount: number;
  bodyOverlapCount: number;
  minimumClearanceViolationCount: number;
  textCollisionCount: number;
  canvasOverflowCount: number;
  layoutBounds?: CircuitGeometryBounds;
  estimatedRouteComplexity: {
    netsWithMoreThanTwoPins: number;
    excessFanout: number;
    feedbackGroups: number;
    blockedPinAccessCount: number;
  };
};

export type CircuitLayoutResult =
  | {
      status: 'complete';
      document: CircuitDocumentV2;
      diagnostics: CircuitDocumentDiagnostic[];
      metrics: CircuitLayoutMetrics;
      routeImpact: PlacementRouteImpact;
      algorithmVersion: typeof CIRCUIT_LAYOUT_ALGORITHM_VERSION;
    }
  | {
      status: 'blocked';
      candidatePlacements?: CircuitDocumentV2['drawing']['placements'];
      diagnostics: CircuitDocumentDiagnostic[];
      metrics?: CircuitLayoutMetrics;
      routeImpact?: PlacementRouteImpact;
      algorithmVersion: typeof CIRCUIT_LAYOUT_ALGORITHM_VERSION;
    };

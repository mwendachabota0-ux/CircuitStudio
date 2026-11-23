import type { CircuitDocumentV2, CircuitPoint } from './model.ts';

export type CircuitPlacementMode =
  | 'place-unplaced'
  | 'reflow'
  | 'preserve-pinned';

export type CircuitPlacement = CircuitDocumentV2['drawing']['placements'][number];

export type PlacementMobilityDecision =
  | {
      mobility: 'movable';
      reason: 'unplaced' | 'explicit-reflow' | 'explicitly-unpinned';
    }
  | {
      mobility: 'protected';
      reason:
        | 'existing-placement'
        | 'user-pinned'
        | 'legacy-placement'
        | 'request-pinned'
        | 'request-fixed-position';
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

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function validPoint(value: unknown): value is CircuitPoint {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

/**
 * Determines whether one existing placement may move under an explicit mode.
 * Existing placements without an explicit userPinned:false marker stay
 * protected in every mode; reflow only moves explicitly movable placements.
 */
export function resolvePlacementMobility(
  request: PlacementMobilityRequest,
): PlacementMobilityDecision {
  const fixedPosition = request.fixedPositions?.[request.componentId];
  if (fixedPosition !== undefined) {
    if (!validPoint(fixedPosition)) {
      throw new TypeError(
        `Fixed position for ${request.componentId} must contain two finite coordinates.`,
      );
    }
    return {
      mobility: 'protected',
      reason: 'request-fixed-position',
      fixedPosition: [fixedPosition[0], fixedPosition[1]],
    };
  }

  if (request.pinnedComponentIds?.includes(request.componentId)) {
    return { mobility: 'protected', reason: 'request-pinned' };
  }

  if (!request.placement) {
    return { mobility: 'movable', reason: 'unplaced' };
  }

  if (request.mode === 'place-unplaced') {
    return { mobility: 'protected', reason: 'existing-placement' };
  }

  if (request.mode === 'preserve-pinned') {
    return request.placement.userPinned === false
      ? { mobility: 'movable', reason: 'explicitly-unpinned' }
      : {
          mobility: 'protected',
          reason: request.placement.userPinned === true
            ? 'user-pinned'
            : 'legacy-placement',
        };
  }

  return request.placement.userPinned === false
    ? { mobility: 'movable', reason: 'explicit-reflow' }
    : {
        mobility: 'protected',
        reason: request.placement.userPinned === true
          ? 'user-pinned'
          : 'legacy-placement',
      };
}

/**
 * Reports every existing route on a net touched by a moved component. It does
 * not edit placements, routes, junctions, or crossings.
 */
export function getPlacementRouteImpact(
  document: CircuitDocumentV2,
  movedComponentIds: readonly string[],
): PlacementRouteImpact {
  const moved = [...new Set(movedComponentIds)].sort(compareIds);
  const movedSet = new Set(moved);
  const affectedNets = document.electrical.nets
    .filter((net) => net.members.some((member) => movedSet.has(member.componentId)))
    .sort((left, right) => compareIds(left.id, right.id));
  const affectedNetIds = affectedNets.map((net) => net.id);
  const affectedNetSet = new Set(affectedNetIds);
  const routesByNet = new Map<string, string[]>();
  for (const route of document.drawing.routes) {
    if (!affectedNetSet.has(route.netId)) continue;
    const routeIds = routesByNet.get(route.netId) ?? [];
    routeIds.push(route.id);
    routesByNet.set(route.netId, routeIds);
  }

  const affectedRouteIds = [...routesByNet.values()]
    .flat()
    .sort(compareIds);
  const unroutedNetIds = affectedNets
    .filter((net) => net.members.length > 1 && !routesByNet.has(net.id))
    .map((net) => net.id)
    .sort(compareIds);

  return {
    movedComponentIds: moved,
    affectedNetIds,
    affectedRouteIds,
    unroutedNetIds,
    requiresRerouting: affectedRouteIds.length > 0,
  };
}

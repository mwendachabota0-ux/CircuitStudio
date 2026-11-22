import {
  getCircuitComponentReference,
  type CircuitGeometryBounds,
  type CircuitGeometryResolution,
} from '@workspace/circuit-geometry';
import {
  CircuitDocumentV2Schema,
  type CircuitComponentV2,
  type CircuitDocumentDiagnostic,
  type CircuitDocumentV2,
  type CircuitPoint,
} from './model.ts';
import { resolveCircuitDocumentComponentGeometry } from './geometry.ts';
import {
  buildCircuitLayoutTopology,
  compareLayoutIds,
} from './layout-topology.ts';
import {
  CIRCUIT_LAYOUT_ALGORITHM_VERSION,
  type CircuitLayoutHints,
  type CircuitLayoutMetrics,
  type CircuitLayoutRequest,
  type CircuitLayoutResult,
} from './layout-types.ts';
import {
  getPlacementRouteImpact,
  resolvePlacementMobility,
  type CircuitPlacement,
} from './placement-policy.ts';
import {
  checkCircuitDrawingConsistency,
  validateCircuitDocumentV2,
} from './validation.ts';

const DEFAULT_GRID_PX = 10;
const DEFAULT_BODY_CLEARANCE_PX = 12;
const DEFAULT_ROUTE_CORRIDOR_PX = 24;
const SEARCH_RADIUS_IN_CELLS = 80;
const GEOMETRY_EPSILON = 0.000001;

type PreparedComponent = {
  component: CircuitComponentV2;
  originalPlacement?: CircuitPlacement;
  basePlacement: CircuitPlacement;
  geometry: Extract<CircuitGeometryResolution, { status: 'resolved' }>;
  movable: boolean;
  newlyPlaced: boolean;
  fixedPosition?: CircuitPoint;
};

type PositionedComponent = {
  componentId: string;
  placement: CircuitPlacement;
  geometry: Extract<CircuitGeometryResolution, { status: 'resolved' }>;
  occupiedBounds: CircuitGeometryBounds;
  collisionBounds: CircuitGeometryBounds;
};

type NormalizedHints = {
  direction: NonNullable<CircuitLayoutHints['direction']>;
  gridPx: number;
  bodyClearancePx: number;
  routeCorridorPx: number;
  pinnedComponentIds: readonly string[];
  fixedPositions: Readonly<Record<string, CircuitPoint>>;
  componentRoles: CircuitLayoutHints['componentRoles'];
  netRolesById: CircuitLayoutHints['netRolesById'];
  canvasPolicy: NonNullable<CircuitLayoutHints['canvasPolicy']>;
};

type BoundsAccumulator = {
  occupied: CircuitGeometryBounds;
  collision: CircuitGeometryBounds;
};

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const DEFAULT_HINTS: NormalizedHints = {
  direction: 'left-to-right',
  gridPx: DEFAULT_GRID_PX,
  bodyClearancePx: DEFAULT_BODY_CLEARANCE_PX,
  routeCorridorPx: DEFAULT_ROUTE_CORRIDOR_PX,
  pinnedComponentIds: [],
  fixedPositions: {},
  componentRoles: undefined,
  netRolesById: undefined,
  canvasPolicy: 'respect-existing',
};

function diagnostic(
  code: string,
  severity: CircuitDocumentDiagnostic['severity'],
  path: string,
  message: string,
): CircuitDocumentDiagnostic {
  return { code, severity, path, message };
}

function compareDiagnostics(
  left: CircuitDocumentDiagnostic,
  right: CircuitDocumentDiagnostic,
): number {
  return compareLayoutIds(left.path, right.path) ||
    compareLayoutIds(left.code, right.code) ||
    compareLayoutIds(left.message, right.message);
}

function uniqueSortedDiagnostics(
  diagnostics: CircuitDocumentDiagnostic[],
): CircuitDocumentDiagnostic[] {
  const seen = new Set<string>();
  return diagnostics
    .filter((entry) => {
      const key = `${entry.code}\u0000${entry.path}\u0000${entry.message}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(compareDiagnostics);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function isPoint(value: unknown): value is CircuitPoint {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

function samePoint(left: unknown, right: CircuitPoint): boolean {
  return isPoint(left) &&
    Math.abs(left[0] - right[0]) <= GEOMETRY_EPSILON &&
    Math.abs(left[1] - right[1]) <= GEOMETRY_EPSILON;
}

function addPoints(first: CircuitPoint, second: CircuitPoint): CircuitPoint {
  return [first[0] + second[0], first[1] + second[1]];
}

function subtractPoints(first: CircuitPoint, second: CircuitPoint): CircuitPoint {
  return [first[0] - second[0], first[1] - second[1]];
}

function translatedBounds(
  bounds: CircuitGeometryBounds,
  delta: CircuitPoint,
): CircuitGeometryBounds {
  return {
    x0: bounds.x0 + delta[0],
    y0: bounds.y0 + delta[1],
    x1: bounds.x1 + delta[0],
    y1: bounds.y1 + delta[1],
  };
}

function unionBounds(
  first: CircuitGeometryBounds,
  second: CircuitGeometryBounds,
): CircuitGeometryBounds {
  return {
    x0: Math.min(first.x0, second.x0),
    y0: Math.min(first.y0, second.y0),
    x1: Math.max(first.x1, second.x1),
    y1: Math.max(first.y1, second.y1),
  };
}

function inflateBounds(
  bounds: CircuitGeometryBounds,
  amount: number,
): CircuitGeometryBounds {
  return {
    x0: bounds.x0 - amount,
    y0: bounds.y0 - amount,
    x1: bounds.x1 + amount,
    y1: bounds.y1 + amount,
  };
}

function intersects(
  first: CircuitGeometryBounds,
  second: CircuitGeometryBounds,
): boolean {
  return first.x0 < second.x1 - GEOMETRY_EPSILON &&
    first.x1 > second.x0 + GEOMETRY_EPSILON &&
    first.y0 < second.y1 - GEOMETRY_EPSILON &&
    first.y1 > second.y0 + GEOMETRY_EPSILON;
}

function rectangleGap(
  first: CircuitGeometryBounds,
  second: CircuitGeometryBounds,
): number {
  const gapX = Math.max(0, first.x0 - second.x1, second.x0 - first.x1);
  const gapY = Math.max(0, first.y0 - second.y1, second.y0 - first.y1);
  return Math.hypot(gapX, gapY);
}

function unionAll(
  bounds: readonly CircuitGeometryBounds[],
): CircuitGeometryBounds | null {
  return bounds.reduce<CircuitGeometryBounds | null>(
    (current, entry) => current ? unionBounds(current, entry) : { ...entry },
    null,
  );
}

function geometryBounds(
  geometry: Extract<CircuitGeometryResolution, { status: 'resolved' }>,
  routeCorridorPx: number,
): BoundsAccumulator {
  const occupied = unionAll([
    geometry.bodyBounds,
    ...geometry.textBounds.map((text) => text.bounds),
  ]) ?? { ...geometry.bodyBounds };
  const pinAccessBounds = geometry.pins.map((pin) => ({
    x0: pin.point[0] - routeCorridorPx / 2,
    y0: pin.point[1] - routeCorridorPx / 2,
    x1: pin.point[0] + routeCorridorPx / 2,
    y1: pin.point[1] + routeCorridorPx / 2,
  }));
  return {
    occupied,
    collision: unionAll([occupied, ...pinAccessBounds]) ?? { ...occupied },
  };
}

function translateGeometry(
  geometry: Extract<CircuitGeometryResolution, { status: 'resolved' }>,
  delta: CircuitPoint,
): Extract<CircuitGeometryResolution, { status: 'resolved' }> {
  return {
    ...geometry,
    pins: geometry.pins.map((pin) => ({
      ...pin,
      point: addPoints(pin.point, delta),
      ...(pin.bodyPoint ? { bodyPoint: addPoints(pin.bodyPoint, delta) } : {}),
    })),
    bodyBounds: translatedBounds(geometry.bodyBounds, delta),
    textBounds: geometry.textBounds.map((text) => ({
      ...text,
      bounds: translatedBounds(text.bounds, delta),
    })),
    transform: {
      ...geometry.transform,
      ...(geometry.transform.origin
        ? { origin: addPoints(geometry.transform.origin, delta) }
        : {}),
    },
  };
}

function normalizeHints(
  hints: CircuitLayoutHints | undefined,
): { hints?: NormalizedHints; diagnostics: CircuitDocumentDiagnostic[] } {
  if (hints === undefined) {
    return { hints: DEFAULT_HINTS, diagnostics: [] };
  }
  if (!isRecord(hints)) {
    return {
      diagnostics: [
        diagnostic('layout-hints-invalid', 'error', 'hints', 'Layout hints must be an object.'),
      ],
    };
  }

  const diagnostics: CircuitDocumentDiagnostic[] = [];
  const directions = [
    'left-to-right',
    'right-to-left',
    'top-to-bottom',
    'bottom-to-top',
  ] as const;
  const direction = hints.direction ?? DEFAULT_HINTS.direction;
  if (!directions.includes(direction as (typeof directions)[number])) {
    diagnostics.push(diagnostic(
      'layout-hint-invalid',
      'error',
      'hints.direction',
      'Choose a supported layout direction.',
    ));
  }

  const positiveInteger = (
    key: 'gridPx',
    fallback: number,
  ): number => {
    const value = hints[key] ?? fallback;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value <= 0
    ) {
      diagnostics.push(diagnostic(
        'layout-hint-invalid',
        'error',
        `hints.${key}`,
        `${key} must be a positive finite number.`,
      ));
      return fallback;
    }
    return value;
  };
  const nonNegative = (
    key: 'bodyClearancePx' | 'routeCorridorPx',
    fallback: number,
  ): number => {
    const value = hints[key] ?? fallback;
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < 0
    ) {
      diagnostics.push(diagnostic(
        'layout-hint-invalid',
        'error',
        `hints.${key}`,
        `${key} must be a non-negative finite number.`,
      ));
      return fallback;
    }
    return value;
  };

  const pinnedRaw = hints.pinnedComponentIds ?? [];
  if (
    !Array.isArray(pinnedRaw) ||
    pinnedRaw.some((id) => typeof id !== 'string' || id.length === 0)
  ) {
    diagnostics.push(diagnostic(
      'layout-hint-invalid',
      'error',
      'hints.pinnedComponentIds',
      'Pinned component IDs must be non-empty strings.',
    ));
  }

  const fixedRaw = hints.fixedPositions ?? {};
  const fixedPositions: Record<string, CircuitPoint> = {};
  if (!isRecord(fixedRaw)) {
    diagnostics.push(diagnostic(
      'layout-hint-invalid',
      'error',
      'hints.fixedPositions',
      'Fixed positions must be an object of component IDs and finite points.',
    ));
  } else {
    for (const [componentId, point] of Object.entries(fixedRaw)) {
      if (!componentId || !isPoint(point)) {
        diagnostics.push(diagnostic(
          'layout-hint-invalid',
          'error',
          `hints.fixedPositions.${componentId || '?'}`,
          'A fixed position must contain two finite coordinates.',
        ));
        continue;
      }
      fixedPositions[componentId] = [point[0], point[1]];
    }
  }

  const canvasPolicy = hints.canvasPolicy ?? DEFAULT_HINTS.canvasPolicy;
  if (canvasPolicy !== 'respect-existing' && canvasPolicy !== 'allow-overflow') {
    diagnostics.push(diagnostic(
      'layout-hint-invalid',
      'error',
      'hints.canvasPolicy',
      'Canvas policy must be "respect-existing" or "allow-overflow".',
    ));
  }

  const componentRoles = hints.componentRoles;
  if (componentRoles !== undefined) {
    const validRoles = new Set(['source', 'input', 'active', 'output', 'unknown']);
    if (
      !isRecord(componentRoles) ||
      Object.values(componentRoles).some((role) => !validRoles.has(String(role)))
    ) {
      diagnostics.push(diagnostic(
        'layout-hint-invalid',
        'error',
        'hints.componentRoles',
        'Component roles must use a supported layout role.',
      ));
    }
  }
  const netRolesById = hints.netRolesById;
  if (netRolesById !== undefined) {
    const validRoles = new Set(['power', 'return', 'signal', 'unknown']);
    if (
      !isRecord(netRolesById) ||
      Object.values(netRolesById).some((role) => !validRoles.has(String(role)))
    ) {
      diagnostics.push(diagnostic(
        'layout-hint-invalid',
        'error',
        'hints.netRolesById',
        'Net roles must use a supported layout role.',
      ));
    }
  }

  if (diagnostics.length > 0) return { diagnostics };
  return {
    hints: {
      direction: direction as NormalizedHints['direction'],
      gridPx: positiveInteger('gridPx', DEFAULT_GRID_PX),
      bodyClearancePx: nonNegative('bodyClearancePx', DEFAULT_BODY_CLEARANCE_PX),
      routeCorridorPx: nonNegative('routeCorridorPx', DEFAULT_ROUTE_CORRIDOR_PX),
      pinnedComponentIds: [...new Set(pinnedRaw as string[])].sort(compareLayoutIds),
      fixedPositions,
      componentRoles: componentRoles as CircuitLayoutHints['componentRoles'],
      netRolesById: netRolesById as CircuitLayoutHints['netRolesById'],
      canvasPolicy: canvasPolicy as NormalizedHints['canvasPolicy'],
    },
    diagnostics: [],
  };
}

function defaultUnplacedPlacement(
  component: CircuitComponentV2,
): { placement?: CircuitPlacement; error?: string } {
  const properties = component.properties;
  for (const key of ['from', 'to', 'at'] as const) {
    if (Object.hasOwn(properties, key) && !isPoint(properties[key])) {
      return { error: `The component has invalid ${key} geometry.` };
    }
  }
  if (
    Object.hasOwn(properties, 'rotation') &&
    (typeof properties.rotation !== 'number' ||
      !Number.isFinite(properties.rotation))
  ) {
    return { error: 'The component has an invalid rotation.' };
  }

  const reference = getCircuitComponentReference(component.type);
  if (!reference) return { error: `Geometry for "${component.type}" is unsupported.` };
  const requiredProperties: readonly string[] = reference.requiredProperties;
  const endpointGeometry =
    requiredProperties.includes('from') &&
    requiredProperties.includes('to');
  const from = isPoint(properties.from) ? properties.from : undefined;
  const to = isPoint(properties.to) ? properties.to : undefined;
  if (endpointGeometry && Boolean(from) !== Boolean(to)) {
    return { error: 'Both terminal endpoints are required to resolve this component geometry.' };
  }

  const rotation = typeof properties.rotation === 'number'
    ? properties.rotation
    : 0;
  const at = isPoint(properties.at) ? properties.at : undefined;
  const endpointCenter: CircuitPoint | undefined = from && to
    ? [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2]
    : undefined;
  const position: CircuitPoint = at
    ? [at[0], at[1]]
    : endpointCenter
      ? [...endpointCenter]
      : [0, 0];
  const legacyGeometry: NonNullable<CircuitPlacement['legacyGeometry']> = {};

  if (from && to) {
    legacyGeometry.from = [from[0], from[1]];
    legacyGeometry.to = [to[0], to[1]];
  } else if (endpointGeometry) {
    const terminalDistance = 'minimumTerminalDistance' in reference
      ? reference.minimumTerminalDistance
      : undefined;
    if (
      typeof terminalDistance !== 'number' ||
      !Number.isFinite(terminalDistance) ||
      terminalDistance <= 0
    ) {
      return { error: 'The component has no known terminal spacing for a safe initial layout.' };
    }
    const half = terminalDistance / 2;
    const radians = rotation * Math.PI / 180;
    legacyGeometry.from = [
      position[0] - Math.cos(radians) * half,
      position[1] - Math.sin(radians) * half,
    ];
    legacyGeometry.to = [
      position[0] + Math.cos(radians) * half,
      position[1] + Math.sin(radians) * half,
    ];
  }
  if (at) legacyGeometry.at = [at[0], at[1]];

  return {
    placement: {
      componentId: component.id,
      position,
      rotation,
      flip: properties.flip === true,
      userPinned: false,
      ...(Object.keys(legacyGeometry).length > 0 ? { legacyGeometry } : {}),
      properties: {},
    },
  };
}

function translatedPlacement(
  item: PreparedComponent,
  target: CircuitPoint,
): CircuitPlacement {
  const origin = item.basePlacement.position;
  const delta = subtractPoints(target, origin);
  const legacyGeometry = {
    ...(item.basePlacement.legacyGeometry
      ? cloneJson(item.basePlacement.legacyGeometry)
      : {}),
  };
  for (const key of ['from', 'to', 'at'] as const) {
    const point = legacyGeometry[key];
    if (point) legacyGeometry[key] = addPoints(point, delta);
  }

  const reference = getCircuitComponentReference(item.component.type);
  const requiredProperties: readonly string[] = reference?.requiredProperties ?? [];
  const isTwoTerminal = requiredProperties.includes('from') &&
    requiredProperties.includes('to');
  let movedFrom: CircuitPoint | undefined;
  let movedTo: CircuitPoint | undefined;
  if (isTwoTerminal && item.geometry.pins.length >= 2) {
    movedFrom = addPoints(item.geometry.pins[0].point, delta);
    movedTo = addPoints(item.geometry.pins[1].point, delta);
    legacyGeometry.from = movedFrom;
    legacyGeometry.to = movedTo;
  }

  const placementProperties = cloneJson(item.basePlacement.properties);
  const sourceLabelAt = placementProperties.labelAt ??
    item.component.properties.labelAt;
  if (isPoint(sourceLabelAt)) {
    placementProperties.labelAt = addPoints(sourceLabelAt, delta);
  }

  const canonicalPositions: Record<string, CircuitPoint | undefined> = {
    from: movedFrom,
    to: movedTo,
    at: target,
  };
  const oldCanonicalPositions: Record<string, CircuitPoint | undefined> = {
    from: isTwoTerminal ? item.geometry.pins[0]?.point : undefined,
    to: isTwoTerminal ? item.geometry.pins[1]?.point : undefined,
    at: origin,
  };
  for (const key of ['from', 'to', 'at'] as const) {
    const oldCanonical = oldCanonicalPositions[key];
    const nextCanonical = canonicalPositions[key];
    if (
      oldCanonical &&
      nextCanonical &&
      samePoint(placementProperties[key], oldCanonical)
    ) {
      placementProperties[key] = nextCanonical;
    }
  }

  return {
    ...item.basePlacement,
    position: [target[0], target[1]],
    ...(Object.keys(legacyGeometry).length > 0 ? { legacyGeometry } : {}),
    properties: placementProperties,
  };
}

function positionedComponent(
  item: PreparedComponent,
  placement: CircuitPlacement,
  routeCorridorPx: number,
): PositionedComponent {
  const delta = subtractPoints(placement.position, item.basePlacement.position);
  const geometry = translateGeometry(item.geometry, delta);
  const bounds = geometryBounds(geometry, routeCorridorPx);
  return {
    componentId: item.component.id,
    placement,
    geometry,
    occupiedBounds: bounds.occupied,
    collisionBounds: bounds.collision,
  };
}

function boundsFitCanvas(
  bounds: CircuitGeometryBounds,
  document: CircuitDocumentV2,
  policy: NormalizedHints['canvasPolicy'],
): boolean {
  if (policy === 'allow-overflow') return true;
  const { width, height } = document.drawing.canvas;
  return bounds.x0 >= -GEOMETRY_EPSILON &&
    bounds.y0 >= -GEOMETRY_EPSILON &&
    (width === undefined || bounds.x1 <= width + GEOMETRY_EPSILON) &&
    (height === undefined || bounds.y1 <= height + GEOMETRY_EPSILON);
}

function collidesWith(
  candidate: PositionedComponent,
  obstacles: readonly PositionedComponent[],
  bodyClearancePx: number,
): boolean {
  const expandedCandidate = inflateBounds(
    candidate.collisionBounds,
    bodyClearancePx / 2,
  );
  return obstacles.some((obstacle) =>
    obstacle.componentId !== candidate.componentId &&
    intersects(
      expandedCandidate,
      inflateBounds(obstacle.collisionBounds, bodyClearancePx / 2),
    )
  );
}

function* spiralOffsets(maxRadius: number): Generator<[number, number]> {
  yield [0, 0];
  for (let radius = 1; radius <= maxRadius; radius += 1) {
    for (let x = -radius; x <= radius; x += 1) yield [x, -radius];
    for (let y = -radius + 1; y <= radius; y += 1) yield [radius, y];
    for (let x = radius - 1; x >= -radius; x -= 1) yield [x, radius];
    for (let y = radius - 1; y > -radius; y -= 1) yield [-radius, y];
  }
}

function snapToGrid(value: number, gridPx: number): number {
  return Math.round(value / gridPx) * gridPx;
}

function envelopeDimensions(
  geometry: Extract<CircuitGeometryResolution, { status: 'resolved' }>,
  origin: CircuitPoint,
  routeCorridorPx: number,
): { width: number; height: number; left: number; right: number; top: number; bottom: number } {
  const bounds = geometryBounds(geometry, routeCorridorPx).collision;
  return {
    width: bounds.x1 - bounds.x0,
    height: bounds.y1 - bounds.y0,
    left: Math.max(0, origin[0] - bounds.x0),
    right: Math.max(0, bounds.x1 - origin[0]),
    top: Math.max(0, origin[1] - bounds.y0),
    bottom: Math.max(0, bounds.y1 - origin[1]),
  };
}

function layoutOrder(
  componentIds: readonly string[],
  topology: ReturnType<typeof buildCircuitLayoutTopology>,
): {
  orderedMovableIds: string[];
  rankByComponent: Map<string, number>;
  rowByComponent: Map<string, number>;
  groupOffsetByComponent: Map<string, number>;
  maxRankByGroup: Map<string, number>;
} {
  const rankByComponent = new Map<string, number>();
  const rowByComponent = new Map<string, number>();
  const groupOffsetByComponent = new Map<string, number>();
  const maxRankByGroup = new Map<string, number>();
  const orderedMovableIds: string[] = [];
  let perpendicularSlots = 0;

  for (const group of topology.groups) {
    const rankBuckets = new Map<number, string[]>();
    for (const componentId of group.order) {
      const rank = group.rankByComponent.get(componentId) ?? 0;
      const members = rankBuckets.get(rank) ?? [];
      members.push(componentId);
      rankBuckets.set(rank, members);
      rankByComponent.set(componentId, rank);
    }
    const ranks = [...rankBuckets.keys()].sort((left, right) => left - right);
    const maxRank = ranks.at(-1) ?? 0;
    maxRankByGroup.set(group.id, maxRank);
    for (const rank of ranks) {
      const members = rankBuckets.get(rank) ?? [];
      members.forEach((componentId, row) => {
        rowByComponent.set(componentId, row);
        groupOffsetByComponent.set(componentId, perpendicularSlots);
      });
    }
    const rowCount = Math.max(
      1,
      ...[...rankBuckets.values()].map((members) => members.length),
    );
    perpendicularSlots += rowCount + 2;
  }

  const knownIds = new Set(topology.groups.flatMap((group) => group.componentIds));
  const orderedAll = topology.groups.flatMap((group) => group.order);
  componentIds
    .filter((id) => !knownIds.has(id))
    .sort(compareLayoutIds)
    .forEach((id) => orderedAll.push(id));
  return {
    orderedMovableIds: orderedAll,
    rankByComponent,
    rowByComponent,
    groupOffsetByComponent,
    maxRankByGroup,
  };
}

function candidateFor(
  item: PreparedComponent,
  preferred: CircuitPoint,
  obstacles: readonly PositionedComponent[],
  document: CircuitDocumentV2,
  hints: NormalizedHints,
): { positioned?: PositionedComponent; placement?: CircuitPlacement } {
  const grid = hints.gridPx;
  for (const [offsetX, offsetY] of spiralOffsets(SEARCH_RADIUS_IN_CELLS)) {
    const target: CircuitPoint = [
      snapToGrid(preferred[0] + offsetX * grid, grid),
      snapToGrid(preferred[1] + offsetY * grid, grid),
    ];
    const placement = translatedPlacement(item, target);
    const candidate = positionedComponent(item, placement, hints.routeCorridorPx);
    const fitBounds = inflateBounds(
      candidate.collisionBounds,
      hints.bodyClearancePx / 2,
    );
    if (!boundsFitCanvas(fitBounds, document, hints.canvasPolicy)) continue;
    if (collidesWith(candidate, obstacles, hints.bodyClearancePx)) continue;
    return { positioned: candidate, placement };
  }
  return {};
}

function countTextCollisions(
  positioned: readonly PositionedComponent[],
): number {
  let count = 0;
  for (let firstIndex = 0; firstIndex < positioned.length; firstIndex += 1) {
    const first = positioned[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < positioned.length; secondIndex += 1) {
      const second = positioned[secondIndex];
      const firstBody = first.geometry.bodyBounds;
      const secondBody = second.geometry.bodyBounds;
      const firstTexts = first.geometry.textBounds.map((entry) => entry.bounds);
      const secondTexts = second.geometry.textBounds.map((entry) => entry.bounds);
      for (const text of firstTexts) {
        if (intersects(text, secondBody)) count += 1;
        for (const otherText of secondTexts) {
          if (intersects(text, otherText)) count += 1;
        }
      }
      for (const text of secondTexts) {
        if (intersects(text, firstBody)) count += 1;
      }
    }
  }
  return count;
}

function countBlockedPinAccess(
  positioned: readonly PositionedComponent[],
  routeCorridorPx: number,
): number {
  let count = 0;
  for (const current of positioned) {
    for (const pin of current.geometry.pins) {
      const access = {
        x0: pin.point[0] - routeCorridorPx / 2,
        y0: pin.point[1] - routeCorridorPx / 2,
        x1: pin.point[0] + routeCorridorPx / 2,
        y1: pin.point[1] + routeCorridorPx / 2,
      };
      for (const other of positioned) {
        if (
          other.componentId !== current.componentId &&
          intersects(access, other.geometry.bodyBounds)
        ) count += 1;
      }
    }
  }
  return count;
}

function buildMetrics(
  document: CircuitDocumentV2,
  positioned: readonly PositionedComponent[],
  topology: ReturnType<typeof buildCircuitLayoutTopology>,
  unplacedBefore: number,
  movedExisting: number,
  hints: NormalizedHints,
): CircuitLayoutMetrics {
  let bodyOverlapCount = 0;
  let minimumClearanceViolationCount = 0;
  for (let firstIndex = 0; firstIndex < positioned.length; firstIndex += 1) {
    for (let secondIndex = firstIndex + 1; secondIndex < positioned.length; secondIndex += 1) {
      const first = positioned[firstIndex].geometry.bodyBounds;
      const second = positioned[secondIndex].geometry.bodyBounds;
      if (intersects(first, second)) bodyOverlapCount += 1;
      if (rectangleGap(first, second) + GEOMETRY_EPSILON < hints.bodyClearancePx) {
        minimumClearanceViolationCount += 1;
      }
    }
  }

  const layoutBounds = unionAll(positioned.map(({ occupiedBounds }) => occupiedBounds));
  const canvasOverflowCount = positioned.filter(({ occupiedBounds }) => {
    const { width, height } = document.drawing.canvas;
    return occupiedBounds.x0 < 0 ||
      occupiedBounds.y0 < 0 ||
      (width !== undefined && occupiedBounds.x1 > width) ||
      (height !== undefined && occupiedBounds.y1 > height);
  }).length;

  return {
    componentCount: document.electrical.components.length,
    unplacedBefore,
    movedExisting,
    connectedSubcircuitCount: topology.groups.length,
    bodyOverlapCount,
    minimumClearanceViolationCount,
    textCollisionCount: countTextCollisions(positioned),
    canvasOverflowCount,
    ...(layoutBounds ? { layoutBounds } : {}),
    estimatedRouteComplexity: {
      netsWithMoreThanTwoPins: topology.netsWithMoreThanTwoPins,
      excessFanout: topology.excessFanout,
      feedbackGroups: topology.feedbackClusters.length,
      blockedPinAccessCount: countBlockedPinAccess(
        positioned,
        hints.routeCorridorPx,
      ),
    },
  };
}

function consistencyNetIds(
  document: CircuitDocumentV2,
  diagnostics: readonly CircuitDocumentDiagnostic[],
): string[] {
  const indexes = new Set<number>();
  for (const entry of diagnostics) {
    if (
      entry.code !== 'net-not-visibly-connected' &&
      entry.code !== 'net-visual-connection-unknown'
    ) continue;
    const match = /^electrical\.nets\.(\d+)$/.exec(entry.path);
    if (match) indexes.add(Number(match[1]));
  }
  return [...indexes]
    .map((index) => document.electrical.nets[index]?.id)
    .filter((id): id is string => !!id)
    .sort(compareLayoutIds);
}

function createBlockedResult(
  diagnostics: CircuitDocumentDiagnostic[],
  candidatePlacements?: CircuitPlacement[],
  metrics?: CircuitLayoutMetrics,
  routeImpact?: ReturnType<typeof getPlacementRouteImpact>,
): CircuitLayoutResult {
  return {
    status: 'blocked',
    ...(candidatePlacements ? { candidatePlacements } : {}),
    diagnostics: uniqueSortedDiagnostics(diagnostics),
    ...(metrics ? { metrics } : {}),
    ...(routeImpact ? { routeImpact } : {}),
    algorithmVersion: CIRCUIT_LAYOUT_ALGORITHM_VERSION,
  };
}

/**
 * Deterministically arranges eligible V2 component placements without editing
 * the electrical model or drawing routes. It returns a proposal only.
 */
export function layoutCircuitDocument(
  request: CircuitLayoutRequest,
): CircuitLayoutResult {
  if (request?.algorithmVersion !== CIRCUIT_LAYOUT_ALGORITHM_VERSION) {
    return createBlockedResult([
      diagnostic(
        'layout-version-unsupported',
        'error',
        'algorithmVersion',
        `This engine supports only ${CIRCUIT_LAYOUT_ALGORITHM_VERSION}.`,
      ),
    ]);
  }
  if (
    request.mode !== 'place-unplaced' &&
    request.mode !== 'reflow' &&
    request.mode !== 'preserve-pinned'
  ) {
    return createBlockedResult([
      diagnostic(
        'layout-mode-invalid',
        'error',
        'mode',
        'Choose place-unplaced, reflow, or preserve-pinned.',
      ),
    ]);
  }

  const normalized = normalizeHints(request.hints);
  if (!normalized.hints) {
    return createBlockedResult(normalized.diagnostics);
  }
  const hints = normalized.hints;

  const parsed = CircuitDocumentV2Schema.safeParse(request.document);
  if (!parsed.success) {
    return createBlockedResult(
      parsed.error.issues.map((issue) =>
        diagnostic(
          'layout-document-invalid',
          'error',
          issue.path.join('.'),
          issue.message,
        )
      ),
    );
  }
  const document = cloneJson(request.document);
  const validation = validateCircuitDocumentV2(document);
  const structuralErrors = [
    ...validation.schemaErrors,
    ...validation.electricalErrors,
    ...validation.drawingErrors,
  ];
  if (structuralErrors.length > 0) {
    return createBlockedResult(structuralErrors);
  }

  const components = [...document.electrical.components]
    .sort((left, right) => compareLayoutIds(left.id, right.id));
  const componentIds = new Set(components.map(({ id }) => id));
  const existingPlacementById = new Map(
    document.drawing.placements.map((placement) => [placement.componentId, placement]),
  );
  const invalidHintIds = [
    ...hints.pinnedComponentIds,
    ...Object.keys(hints.fixedPositions),
    ...Object.keys(hints.componentRoles ?? {}),
  ].filter((componentId) => !componentIds.has(componentId));
  if (invalidHintIds.length > 0) {
    return createBlockedResult([
      ...new Set(invalidHintIds).values(),
    ].sort(compareLayoutIds).map((componentId) =>
      diagnostic(
        'layout-hint-component-missing',
        'error',
        `hints.${componentId}`,
        `Layout hints reference missing component "${componentId}".`,
      )
    ));
  }

  const duplicateNetRoleIds = Object.keys(hints.netRolesById ?? {})
    .filter((netId) => !document.electrical.nets.some((net) => net.id === netId));
  if (duplicateNetRoleIds.length > 0) {
    return createBlockedResult(
      duplicateNetRoleIds.sort(compareLayoutIds).map((netId) =>
        diagnostic(
          'layout-hint-net-missing',
          'error',
          `hints.netRolesById.${netId}`,
          `Layout hints reference missing net "${netId}".`,
        )
      ),
    );
  }

  const diagnostics: CircuitDocumentDiagnostic[] = [];
  const prepared: PreparedComponent[] = [];
  const mobilityErrors: CircuitDocumentDiagnostic[] = [];
  for (const component of components) {
    const originalPlacement = existingPlacementById.get(component.id);
    const fixedPosition = hints.fixedPositions[component.id];
    const decision = resolvePlacementMobility({
      componentId: component.id,
      mode: request.mode,
      ...(originalPlacement ? { placement: originalPlacement } : {}),
      pinnedComponentIds: hints.pinnedComponentIds,
      fixedPositions: hints.fixedPositions,
    });
    const newlyPlaced = !originalPlacement;
    if (newlyPlaced && decision.mobility === 'protected' && !fixedPosition) {
      mobilityErrors.push(diagnostic(
        'layout-unplaced-component-protected',
        'error',
        `electrical.components.${component.id}`,
        `Component "${component.id}" is pinned but has no placement or fixed position.`,
      ));
      continue;
    }
    if (
      originalPlacement &&
      fixedPosition &&
      !samePoint(originalPlacement.position, fixedPosition)
    ) {
      mobilityErrors.push(diagnostic(
        'layout-fixed-position-conflict',
        'error',
        `drawing.placements.${component.id}.position`,
        `The fixed position for "${component.id}" conflicts with its protected placement.`,
      ));
      continue;
    }

    let basePlacement = originalPlacement;
    if (!basePlacement) {
      const created = defaultUnplacedPlacement(component);
      if (!created.placement) {
        mobilityErrors.push(diagnostic(
          'layout-geometry-unsupported',
          'error',
          `electrical.components.${component.id}`,
          created.error ?? `Geometry for "${component.id}" could not be resolved.`,
        ));
        continue;
      }
      basePlacement = created.placement;
    }

    const geometry = resolveCircuitDocumentComponentGeometry(
      component,
      basePlacement,
    );
    if (geometry.status === 'unsupported') {
      mobilityErrors.push(diagnostic(
        'layout-geometry-unsupported',
        newlyPlaced || decision.mobility === 'movable' ? 'error' : 'warning',
        `drawing.placements.${component.id}`,
        `Component "${component.id}" was not moved: ${geometry.message}`,
      ));
      continue;
    }

    prepared.push({
      component,
      ...(originalPlacement ? { originalPlacement } : {}),
      basePlacement,
      geometry,
      movable: decision.mobility === 'movable',
      newlyPlaced,
      ...(fixedPosition ? { fixedPosition } : {}),
    });
  }

  if (mobilityErrors.some((entry) => entry.severity === 'error')) {
    return createBlockedResult(mobilityErrors);
  }
  diagnostics.push(...mobilityErrors);

  const movableItems = prepared.filter((item) => item.movable);
  const unresolvedProtected = mobilityErrors.some(
    (entry) => entry.code === 'layout-geometry-unsupported' &&
      entry.severity === 'warning',
  );
  if (unresolvedProtected && movableItems.length > 0) {
    return createBlockedResult([
      ...diagnostics,
      diagnostic(
        'layout-obstacle-geometry-unknown',
        'error',
        'drawing.placements',
        'Movable components cannot be safely packed around a protected component whose bounds are unknown.',
      ),
    ]);
  }

  const topology = buildCircuitLayoutTopology(document, {
    direction: hints.direction,
    ...(hints.componentRoles ? { componentRoles: hints.componentRoles } : {}),
    ...(hints.netRolesById ? { netRolesById: hints.netRolesById } : {}),
  });

  const allKnownGeometry = prepared;
  const dimensions = allKnownGeometry.map((item) =>
    envelopeDimensions(item.geometry, item.basePlacement.position, hints.routeCorridorPx)
  );
  const maximumWidth = Math.max(1, ...dimensions.map(({ width }) => width));
  const maximumHeight = Math.max(1, ...dimensions.map(({ height }) => height));
  const maximumLeft = Math.max(0, ...dimensions.map(({ left }) => left));
  const maximumRight = Math.max(0, ...dimensions.map(({ right }) => right));
  const maximumTop = Math.max(0, ...dimensions.map(({ top }) => top));
  const maximumBottom = Math.max(0, ...dimensions.map(({ bottom }) => bottom));
  const collisionPadding = hints.bodyClearancePx / 2;
  const grid = hints.gridPx;
  const horizontal = hints.direction === 'left-to-right' ||
    hints.direction === 'right-to-left';
  const primarySpacing = Math.ceil(
    ((horizontal ? maximumWidth : maximumHeight) +
      hints.bodyClearancePx + 20) / grid,
  ) * grid;
  const secondarySpacing = Math.ceil(
    ((horizontal ? maximumHeight : maximumWidth) +
      hints.bodyClearancePx + 20) / grid,
  ) * grid;
  const marginX = Math.ceil(
    (20 + collisionPadding + (horizontal ? maximumLeft : maximumLeft)) / grid,
  ) * grid;
  const marginY = Math.ceil(
    (20 + collisionPadding + (horizontal ? maximumTop : maximumTop)) / grid,
  ) * grid;

  const placementById = new Map<string, CircuitPlacement>(
    document.drawing.placements.map((placement) => [
      placement.componentId,
      cloneJson(placement),
    ]),
  );
  const positionedById = new Map<string, PositionedComponent>();
  for (const item of prepared.filter((entry) => !entry.movable)) {
    const target = item.fixedPosition ?? item.basePlacement.position;
    const placement = item.newlyPlaced
      ? translatedPlacement(item, target)
      : item.basePlacement;
    placementById.set(item.component.id, placement);
    positionedById.set(
      item.component.id,
      positionedComponent(item, placement, hints.routeCorridorPx),
    );
  }

  const ordering = layoutOrder(components.map(({ id }) => id), topology);
  const movableById = new Map(
    movableItems.map((item) => [item.component.id, item]),
  );
  const groupSecondaryOffset = new Map<string, number>();
  let secondaryCursor = 0;
  for (const group of topology.groups) {
    groupSecondaryOffset.set(group.id, secondaryCursor);
    const groupRows = Math.max(
      1,
      ...[...new Set(group.order.map((id) => ordering.rowByComponent.get(id) ?? 0))]
        .map((row) => row + 1),
    );
    secondaryCursor += groupRows * secondarySpacing + secondarySpacing * 2;
  }

  const searchErrors: CircuitDocumentDiagnostic[] = [];
  for (const componentId of ordering.orderedMovableIds) {
    const item = movableById.get(componentId);
    if (!item) continue;
    const rank = ordering.rankByComponent.get(componentId) ?? 0;
    const group = topology.groups.find((entry) =>
      entry.componentIds.includes(componentId)
    );
    const maxRank = group
      ? ordering.maxRankByGroup.get(group.id) ?? rank
      : rank;
    const row = ordering.rowByComponent.get(componentId) ?? 0;
    const groupOffset = group
      ? groupSecondaryOffset.get(group.id) ?? 0
      : 0;

    let primaryIndex = rank;
    if (hints.direction === 'right-to-left' || hints.direction === 'bottom-to-top') {
      primaryIndex = maxRank - rank;
    }
    let preferredX: number;
    let preferredY: number;
    if (horizontal) {
      preferredX = marginX + primaryIndex * primarySpacing;
      preferredY = marginY + groupOffset + row * secondarySpacing;
      if (
        hints.direction === 'right-to-left' &&
        document.drawing.canvas.width !== undefined
      ) {
        preferredX = document.drawing.canvas.width -
          marginX -
          maximumRight -
          rank * primarySpacing;
      }
    } else {
      preferredX = marginX + groupOffset + row * secondarySpacing;
      preferredY = marginY + primaryIndex * primarySpacing;
      if (
        hints.direction === 'bottom-to-top' &&
        document.drawing.canvas.height !== undefined
      ) {
        preferredY = document.drawing.canvas.height -
          marginY -
          maximumBottom -
          rank * primarySpacing;
      }
    }

    const preferred: CircuitPoint = [
      snapToGrid(preferredX, grid),
      snapToGrid(preferredY, grid),
    ];
    const obstacles = [...positionedById.values()]
      .sort((left, right) => compareLayoutIds(left.componentId, right.componentId));
    const found = candidateFor(
      item,
      preferred,
      obstacles,
      document,
      hints,
    );
    if (!found.placement || !found.positioned) {
      searchErrors.push(diagnostic(
        'layout-no-safe-position',
        'error',
        `electrical.components.${componentId}`,
        `No collision-free position for "${componentId}" was found within the deterministic search limit.`,
      ));
      continue;
    }
    placementById.set(componentId, found.placement);
    positionedById.set(componentId, found.positioned);
  }

  const candidatePlacements = [
    ...document.drawing.placements.map((placement) =>
      placementById.get(placement.componentId) ?? cloneJson(placement)
    ),
    ...prepared
      .filter((item) => item.newlyPlaced)
      .sort((left, right) => compareLayoutIds(left.component.id, right.component.id))
      .map((item) => placementById.get(item.component.id))
      .filter((placement): placement is CircuitPlacement => !!placement),
  ];
  if (searchErrors.length > 0) {
    return createBlockedResult(
      [...diagnostics, ...searchErrors],
      candidatePlacements,
    );
  }

  const nextDocument = cloneJson(document);
  nextDocument.drawing.placements = candidatePlacements;
  const movedExistingIds = prepared
    .filter((item) =>
      item.originalPlacement &&
      item.movable &&
      placementById.get(item.component.id) &&
      !samePoint(
        placementById.get(item.component.id)?.position,
        item.originalPlacement.position,
      )
    )
    .map((item) => item.component.id)
    .sort(compareLayoutIds);
  const routeImpact = getPlacementRouteImpact(document, movedExistingIds);
  const finalPositioned = [...positionedById.values()]
    .sort((left, right) => compareLayoutIds(left.componentId, right.componentId));
  const metrics = buildMetrics(
    nextDocument,
    finalPositioned,
    topology,
    components.length - existingPlacementById.size,
    movedExistingIds.length,
    hints,
  );

  const constraintDiagnostics: CircuitDocumentDiagnostic[] = [];
  if (metrics.bodyOverlapCount > 0) {
    constraintDiagnostics.push(diagnostic(
      'layout-body-overlap',
      'error',
      'drawing.placements',
      `The candidate layout contains ${metrics.bodyOverlapCount} symbol-body overlap(s).`,
    ));
  }
  if (metrics.minimumClearanceViolationCount > 0) {
    constraintDiagnostics.push(diagnostic(
      'layout-clearance-violation',
      'error',
      'drawing.placements',
      `The candidate layout violates the requested body clearance in ${metrics.minimumClearanceViolationCount} component pair(s).`,
    ));
  }
  if (metrics.textCollisionCount > 0) {
    constraintDiagnostics.push(diagnostic(
      'layout-text-collision',
      'error',
      'drawing.placements',
      `The candidate layout contains ${metrics.textCollisionCount} text collision(s).`,
    ));
  }
  if (metrics.canvasOverflowCount > 0 && hints.canvasPolicy === 'respect-existing') {
    constraintDiagnostics.push(diagnostic(
      'layout-canvas-overflow',
      'error',
      'drawing.placements',
      `The candidate layout places ${metrics.canvasOverflowCount} component(s) outside the existing canvas.`,
    ));
  }
  if (routeImpact.requiresRerouting) {
    constraintDiagnostics.push(diagnostic(
      'layout-routes-stale',
      'error',
      'drawing.routes',
      `Moving components would leave ${routeImpact.affectedRouteIds.length} existing route(s) stale. Use a separate routing operation before committing this layout.`,
    ));
  }

  if (constraintDiagnostics.length > 0) {
    return createBlockedResult(
      [...diagnostics, ...constraintDiagnostics],
      candidatePlacements,
      metrics,
      routeImpact,
    );
  }

  const finalValidation = validateCircuitDocumentV2(nextDocument);
  const finalErrors = [
    ...finalValidation.schemaErrors,
    ...finalValidation.electricalErrors,
    ...finalValidation.drawingErrors,
  ];
  if (finalErrors.length > 0) {
    return createBlockedResult(
      [...diagnostics, ...finalErrors],
      candidatePlacements,
      metrics,
      routeImpact,
    );
  }
  const finalConsistencyWarnings = checkCircuitDrawingConsistency(nextDocument);
  diagnostics.push(...finalValidation.drawingWarnings, ...finalConsistencyWarnings);
  if (metrics.estimatedRouteComplexity.blockedPinAccessCount > 0) {
    diagnostics.push(diagnostic(
      'layout-pin-access-blocked',
      'warning',
      'drawing.placements',
      `The protected geometry contains ${metrics.estimatedRouteComplexity.blockedPinAccessCount} pin access corridor conflict(s).`,
    ));
  }
  const affectedComponentIds = new Set([
    ...movedExistingIds,
    ...prepared.filter((item) => item.newlyPlaced).map((item) => item.component.id),
  ]);
  const newlyPlacedNetIds = nextDocument.electrical.nets
    .filter((net) => net.members.some((member) =>
      prepared.some((item) =>
        item.newlyPlaced && item.component.id === member.componentId
      )
    ))
    .map((net) => net.id);
  const newlyPlacedNetIdSet = new Set(newlyPlacedNetIds);
  routeImpact.affectedNetIds = [...new Set([
    ...routeImpact.affectedNetIds,
    ...newlyPlacedNetIds,
  ])].sort(compareLayoutIds);
  routeImpact.affectedRouteIds = [...new Set([
    ...routeImpact.affectedRouteIds,
    ...nextDocument.drawing.routes
      .filter((route) => newlyPlacedNetIdSet.has(route.netId))
      .map((route) => route.id),
  ])].sort(compareLayoutIds);
  const inconsistentNetIds = consistencyNetIds(
    nextDocument,
    finalConsistencyWarnings,
  ).filter((netId) => {
    const net = nextDocument.electrical.nets.find((entry) => entry.id === netId);
    return !!net?.members.some((member) =>
      affectedComponentIds.has(member.componentId)
    );
  });
  routeImpact.unroutedNetIds = [...new Set([
    ...routeImpact.unroutedNetIds,
    ...inconsistentNetIds,
  ])].sort(compareLayoutIds);
  routeImpact.requiresRerouting =
    routeImpact.requiresRerouting || routeImpact.unroutedNetIds.length > 0;

  return {
    status: 'complete',
    document: nextDocument,
    diagnostics: uniqueSortedDiagnostics(diagnostics),
    metrics,
    routeImpact,
    algorithmVersion: CIRCUIT_LAYOUT_ALGORITHM_VERSION,
  };
}

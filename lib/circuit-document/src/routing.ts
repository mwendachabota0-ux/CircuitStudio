import type {
  CircuitGeometryBounds,
  CircuitGeometryResolution,
} from "@workspace/circuit-geometry";
import {
  CircuitDocumentV2Schema,
  type CircuitDocumentDiagnostic,
  type CircuitDocumentV2,
  type CircuitNetV2,
  type CircuitPinReference,
  type CircuitPoint,
} from "./model.ts";
import { resolveCircuitDocumentComponentGeometry } from "./geometry.ts";
import {
  CIRCUIT_ROUTING_ALGORITHM_VERSION,
  type CircuitRoutingOptions,
  type CircuitRoutingRequest,
  type CircuitRoutingResult,
} from "./routing-types.ts";
import { validateCircuitDocumentV2 } from "./validation.ts";

const DEFAULT_GRID_PX = 10;
const DEFAULT_CLEARANCE_PX = 12;
const DEFAULT_SEARCH_MARGIN_CELLS = 24;
const DEFAULT_MAX_EXPANDED_NODES = 30_000;
const EPSILON = 0.000001;

type NormalizedOptions = {
  gridPx: number;
  clearancePx: number;
  searchMarginCells: number;
  maxExpandedNodes: number;
};

type PlacedGeometry = {
  componentId: string;
  resolution: Extract<CircuitGeometryResolution, { status: "resolved" }>;
};

type Obstacle = {
  componentId: string;
  bounds: CircuitGeometryBounds;
};

type GridPoint = { col: number; row: number };
type SearchBounds = { minCol: number; maxCol: number; minRow: number; maxRow: number };
type Route = CircuitDocumentV2["drawing"]["routes"][number];
type Junction = CircuitDocumentV2["drawing"]["junctions"][number];
type Crossing = CircuitDocumentV2["drawing"]["crossings"][number];
type RoutePlan = { routes: Route[]; junctions: Junction[]; crossings: Crossing[] };

type ResolvedMember = {
  member: CircuitPinReference;
  point: CircuitPoint;
  bodyPoint?: CircuitPoint;
  origin?: CircuitPoint;
  bodyBounds: CircuitGeometryBounds;
  escapePath: CircuitPoint[];
  anchor: GridPoint;
};

type SearchResult =
  | { status: "found"; path: GridPoint[] }
  | { status: "no-path" }
  | { status: "limit" };

type IntersectionResult =
  | { kind: "none" }
  | { kind: "point"; point: CircuitPoint }
  | { kind: "overlap" };

type RouteInteractions = {
  crossings: Array<{ routeId: string; at: CircuitPoint; orientation: "horizontal" | "vertical" }>;
  junctionPoints: CircuitPoint[];
  conflict?: { code: string; message: string };
};

type HeapEntry = {
  point: GridPoint;
  key: string;
  g: number;
  h: number;
  sequence: number;
};

function compareIds(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function diagnostic(
  code: string,
  path: string,
  message: string,
  severity: CircuitDocumentDiagnostic["severity"] = "error",
): CircuitDocumentDiagnostic {
  return { code, severity, path, message };
}

function compareDiagnostics(
  left: CircuitDocumentDiagnostic,
  right: CircuitDocumentDiagnostic,
): number {
  return compareIds(left.path, right.path) ||
    compareIds(left.code, right.code) ||
    compareIds(left.message, right.message);
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

function cloneDocument(document: CircuitDocumentV2): CircuitDocumentV2 {
  return JSON.parse(JSON.stringify(document)) as CircuitDocumentV2;
}

function samePoint(left: CircuitPoint, right: CircuitPoint): boolean {
  return Math.abs(left[0] - right[0]) <= EPSILON &&
    Math.abs(left[1] - right[1]) <= EPSILON;
}

function pointKey(point: CircuitPoint): string {
  return `${point[0].toFixed(6)},${point[1].toFixed(6)}`;
}

function gridKey(point: GridPoint): string {
  return `${point.col},${point.row}`;
}

function gridPoint(col: number, row: number): GridPoint {
  return { col, row };
}

function toWorldPoint(point: GridPoint, gridPx: number): CircuitPoint {
  return [point.col * gridPx, point.row * gridPx];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeOptions(
  options: CircuitRoutingOptions | undefined,
): { options?: NormalizedOptions; diagnostics: CircuitDocumentDiagnostic[] } {
  if (options !== undefined && !isRecord(options)) {
    return {
      diagnostics: [diagnostic(
        "routing-options-invalid",
        "options",
        "Routing options must be an object.",
      )],
    };
  }
  const input = options ?? {};
  const normalized: NormalizedOptions = {
    gridPx: input.gridPx ?? DEFAULT_GRID_PX,
    clearancePx: input.clearancePx ?? DEFAULT_CLEARANCE_PX,
    searchMarginCells: input.searchMarginCells ?? DEFAULT_SEARCH_MARGIN_CELLS,
    maxExpandedNodes: input.maxExpandedNodes ?? DEFAULT_MAX_EXPANDED_NODES,
  };
  const diagnostics: CircuitDocumentDiagnostic[] = [];
  if (
    !Number.isInteger(normalized.gridPx) ||
    normalized.gridPx < 1 ||
    normalized.gridPx > 200
  ) {
    diagnostics.push(diagnostic(
      "routing-option-invalid",
      "options.gridPx",
      "gridPx must be an integer from 1 through 200.",
    ));
  }
  if (
    !Number.isFinite(normalized.clearancePx) ||
    normalized.clearancePx < 0 ||
    normalized.clearancePx > 500
  ) {
    diagnostics.push(diagnostic(
      "routing-option-invalid",
      "options.clearancePx",
      "clearancePx must be a finite number from 0 through 500.",
    ));
  }
  if (
    !Number.isInteger(normalized.searchMarginCells) ||
    normalized.searchMarginCells < 1 ||
    normalized.searchMarginCells > 100
  ) {
    diagnostics.push(diagnostic(
      "routing-option-invalid",
      "options.searchMarginCells",
      "searchMarginCells must be an integer from 1 through 100.",
    ));
  }
  if (
    !Number.isInteger(normalized.maxExpandedNodes) ||
    normalized.maxExpandedNodes < 1 ||
    normalized.maxExpandedNodes > 200_000
  ) {
    diagnostics.push(diagnostic(
      "routing-option-invalid",
      "options.maxExpandedNodes",
      "maxExpandedNodes must be an integer from 1 through 200000.",
    ));
  }
  return diagnostics.length > 0
    ? { diagnostics }
    : { options: normalized, diagnostics };
}

function resultBlocked(
  diagnostics: CircuitDocumentDiagnostic[],
): CircuitRoutingResult {
  return {
    status: "blocked",
    diagnostics: uniqueSortedDiagnostics(diagnostics),
    algorithmVersion: CIRCUIT_ROUTING_ALGORITHM_VERSION,
  };
}

function expandedBounds(
  bounds: CircuitGeometryBounds,
  clearancePx: number,
): CircuitGeometryBounds {
  return {
    x0: bounds.x0 - clearancePx,
    y0: bounds.y0 - clearancePx,
    x1: bounds.x1 + clearancePx,
    y1: bounds.y1 + clearancePx,
  };
}

function pointInBounds(
  point: CircuitPoint,
  bounds: CircuitGeometryBounds,
): boolean {
  return point[0] >= bounds.x0 - EPSILON &&
    point[0] <= bounds.x1 + EPSILON &&
    point[1] >= bounds.y0 - EPSILON &&
    point[1] <= bounds.y1 + EPSILON;
}

function segmentTouchesBounds(
  start: CircuitPoint,
  end: CircuitPoint,
  bounds: CircuitGeometryBounds,
): boolean {
  if (Math.abs(start[1] - end[1]) <= EPSILON) {
    const y = start[1];
    return y >= bounds.y0 - EPSILON &&
      y <= bounds.y1 + EPSILON &&
      Math.max(Math.min(start[0], end[0]), bounds.x0) <=
        Math.min(Math.max(start[0], end[0]), bounds.x1) + EPSILON;
  }
  if (Math.abs(start[0] - end[0]) <= EPSILON) {
    const x = start[0];
    return x >= bounds.x0 - EPSILON &&
      x <= bounds.x1 + EPSILON &&
      Math.max(Math.min(start[1], end[1]), bounds.y0) <=
        Math.min(Math.max(start[1], end[1]), bounds.y1) + EPSILON;
  }
  return false;
}

function canvasContains(
  point: CircuitPoint,
  canvas: CircuitDocumentV2["drawing"]["canvas"],
): boolean {
  return (canvas.width === undefined ||
      (point[0] >= -EPSILON && point[0] <= canvas.width + EPSILON)) &&
    (canvas.height === undefined ||
      (point[1] >= -EPSILON && point[1] <= canvas.height + EPSILON));
}

function gridCeilStrict(value: number, gridPx: number): number {
  return (Math.floor(value / gridPx) + 1) * gridPx;
}

function gridFloorStrict(value: number, gridPx: number): number {
  return (Math.ceil(value / gridPx) - 1) * gridPx;
}

function orderEscapeDirections(
  pin: CircuitPoint,
  reference: CircuitPoint | undefined,
): Array<{ name: "east" | "south" | "west" | "north"; dx: number; dy: number; order: number }> {
  const directions = [
    { name: "east" as const, dx: 1, dy: 0, order: 0 },
    { name: "south" as const, dx: 0, dy: 1, order: 1 },
    { name: "west" as const, dx: -1, dy: 0, order: 2 },
    { name: "north" as const, dx: 0, dy: -1, order: 3 },
  ];
  if (!reference) return directions;
  const vx = pin[0] - reference[0];
  const vy = pin[1] - reference[1];
  if (Math.hypot(vx, vy) <= EPSILON) return directions;
  return directions.sort((left, right) =>
    (right.dx * vx + right.dy * vy) -
      (left.dx * vx + left.dy * vy) ||
    left.order - right.order
  );
}

function simplifyPoints(points: CircuitPoint[]): CircuitPoint[] {
  const deduped: CircuitPoint[] = [];
  for (const point of points) {
    const previous = deduped[deduped.length - 1];
    if (!previous || !samePoint(previous, point)) {
      deduped.push([point[0], point[1]]);
    }
  }
  const result: CircuitPoint[] = [];
  for (const point of deduped) {
    while (result.length >= 2) {
      const first = result[result.length - 2];
      const middle = result[result.length - 1];
      const horizontal = Math.abs(first[1] - middle[1]) <= EPSILON &&
        Math.abs(middle[1] - point[1]) <= EPSILON;
      const vertical = Math.abs(first[0] - middle[0]) <= EPSILON &&
        Math.abs(middle[0] - point[0]) <= EPSILON;
      if (!horizontal && !vertical) break;
      result.pop();
    }
    result.push(point);
  }
  return result;
}

function makeEscapePath(
  member: {
    point: CircuitPoint;
    bodyPoint?: CircuitPoint;
    origin?: CircuitPoint;
  },
  ownObstacle: Obstacle,
  obstacles: readonly Obstacle[],
  options: NormalizedOptions,
  canvas: CircuitDocumentV2["drawing"]["canvas"],
): { path?: CircuitPoint[]; anchor?: GridPoint } {
  const paddedOwn = expandedBounds(ownObstacle.bounds, options.clearancePx);
  const reference = member.bodyPoint ?? member.origin;
  const directions = orderEscapeDirections(member.point, reference);
  const pinInsideOwn = pointInBounds(member.point, paddedOwn);
  const candidates: Array<{ path: CircuitPoint[]; anchor: GridPoint; length: number; order: number }> = [];

  for (const direction of directions) {
    let path: CircuitPoint[];
    if (direction.name === "east") {
      const x = gridCeilStrict(paddedOwn.x1, options.gridPx);
      const y = Math.round(member.point[1] / options.gridPx) * options.gridPx;
      path = simplifyPoints([member.point, [x, member.point[1]], [x, y]]);
    } else if (direction.name === "west") {
      const x = gridFloorStrict(paddedOwn.x0, options.gridPx);
      const y = Math.round(member.point[1] / options.gridPx) * options.gridPx;
      path = simplifyPoints([member.point, [x, member.point[1]], [x, y]]);
    } else if (direction.name === "south") {
      const y = gridCeilStrict(paddedOwn.y1, options.gridPx);
      const x = Math.round(member.point[0] / options.gridPx) * options.gridPx;
      path = simplifyPoints([member.point, [member.point[0], y], [x, y]]);
    } else {
      const y = gridFloorStrict(paddedOwn.y0, options.gridPx);
      const x = Math.round(member.point[0] / options.gridPx) * options.gridPx;
      path = simplifyPoints([member.point, [member.point[0], y], [x, y]]);
    }
    if (path.length === 0 || !path.every((point) => canvasContains(point, canvas))) {
      continue;
    }
    const anchorPoint = path[path.length - 1];
    const anchorCol = Math.round(anchorPoint[0] / options.gridPx);
    const anchorRow = Math.round(anchorPoint[1] / options.gridPx);
    if (
      Math.abs(anchorCol * options.gridPx - anchorPoint[0]) > EPSILON ||
      Math.abs(anchorRow * options.gridPx - anchorPoint[1]) > EPSILON
    ) continue;

    const candidateIsClear = path.slice(1).every((end, index) => {
      const start = path[index];
      for (const obstacle of obstacles) {
        const padded = expandedBounds(obstacle.bounds, options.clearancePx);
        if (obstacle.componentId === ownObstacle.componentId) {
          if (pinInsideOwn && index === 0) continue;
          if (segmentTouchesBounds(start, end, padded)) return false;
        } else if (segmentTouchesBounds(start, end, padded)) {
          return false;
        }
      }
      return true;
    });
    if (!candidateIsClear) continue;
    const isBlockedAnchor = obstacles.some((obstacle) =>
      pointInBounds(
        anchorPoint,
        expandedBounds(obstacle.bounds, options.clearancePx),
      )
    );
    if (isBlockedAnchor) continue;
    const length = path.slice(1).reduce((sum, point, index) =>
      sum + Math.abs(point[0] - path[index][0]) +
        Math.abs(point[1] - path[index][1]), 0);
    candidates.push({
      path,
      anchor: gridPoint(anchorCol, anchorRow),
      length,
      order: direction.order,
    });
  }

  candidates.sort((left, right) =>
    left.length - right.length ||
    left.order - right.order ||
    compareIds(gridKey(left.anchor), gridKey(right.anchor))
  );
  const selected = candidates[0];
  return selected
    ? { path: selected.path, anchor: selected.anchor }
    : {};
}

function compareHeapEntries(left: HeapEntry, right: HeapEntry): number {
  const leftF = left.g + left.h;
  const rightF = right.g + right.h;
  return leftF - rightF ||
    left.h - right.h ||
    left.point.row - right.point.row ||
    left.point.col - right.point.col ||
    left.sequence - right.sequence;
}

class MinHeap {
  private readonly items: HeapEntry[] = [];

  get size(): number {
    return this.items.length;
  }

  push(entry: HeapEntry): void {
    this.items.push(entry);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) / 2);
      if (compareHeapEntries(this.items[parent], entry) <= 0) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = entry;
  }

  pop(): HeapEntry | undefined {
    if (this.items.length === 0) return undefined;
    const first = this.items[0];
    const last = this.items.pop();
    if (this.items.length > 0 && last) {
      let index = 0;
      while (true) {
        const left = index * 2 + 1;
        const right = left + 1;
        if (left >= this.items.length) break;
        const child = right < this.items.length &&
            compareHeapEntries(this.items[right], this.items[left]) < 0
          ? right
          : left;
        if (compareHeapEntries(last, this.items[child]) <= 0) break;
        this.items[index] = this.items[child];
        index = child;
      }
      this.items[index] = last;
    }
    return first;
  }
}

function boundsForGridPoints(points: readonly GridPoint[]): SearchBounds {
  let minCol = Number.POSITIVE_INFINITY;
  let maxCol = Number.NEGATIVE_INFINITY;
  let minRow = Number.POSITIVE_INFINITY;
  let maxRow = Number.NEGATIVE_INFINITY;
  for (const point of points) {
    minCol = Math.min(minCol, point.col);
    maxCol = Math.max(maxCol, point.col);
    minRow = Math.min(minRow, point.row);
    maxRow = Math.max(maxRow, point.row);
  }
  return { minCol, maxCol, minRow, maxRow };
}

function heuristicToGoalBounds(
  point: GridPoint,
  goals: SearchBounds,
): number {
  const { minCol, maxCol, minRow, maxRow } = goals;
  const dx = point.col < minCol ? minCol - point.col
    : point.col > maxCol ? point.col - maxCol
    : 0;
  const dy = point.row < minRow ? minRow - point.row
    : point.row > maxRow ? point.row - maxRow
    : 0;
  return dx + dy;
}

function makeSearchBounds(
  start: GridPoint,
  goals: readonly GridPoint[],
  options: NormalizedOptions,
  canvas: CircuitDocumentV2["drawing"]["canvas"],
): SearchBounds {
  const goalBounds = boundsForGridPoints([start, ...goals]);
  let minCol = goalBounds.minCol - options.searchMarginCells;
  let maxCol = goalBounds.maxCol + options.searchMarginCells;
  let minRow = goalBounds.minRow - options.searchMarginCells;
  let maxRow = goalBounds.maxRow + options.searchMarginCells;
  if (canvas.width !== undefined) {
    minCol = Math.max(minCol, 0);
    maxCol = Math.min(maxCol, Math.floor(canvas.width / options.gridPx));
  }
  if (canvas.height !== undefined) {
    minRow = Math.max(minRow, 0);
    maxRow = Math.min(maxRow, Math.floor(canvas.height / options.gridPx));
  }
  return { minCol, maxCol, minRow, maxRow };
}

function withinSearchBounds(point: GridPoint, bounds: SearchBounds): boolean {
  return point.col >= bounds.minCol &&
    point.col <= bounds.maxCol &&
    point.row >= bounds.minRow &&
    point.row <= bounds.maxRow;
}

function routeCellBlocked(
  point: GridPoint,
  gridPx: number,
  obstacles: readonly Obstacle[],
  clearancePx: number,
): boolean {
  const world = toWorldPoint(point, gridPx);
  return obstacles.some((obstacle) =>
    pointInBounds(world, expandedBounds(obstacle.bounds, clearancePx))
  );
}

function routeStepBlocked(
  from: GridPoint,
  to: GridPoint,
  gridPx: number,
  obstacles: readonly Obstacle[],
  clearancePx: number,
): boolean {
  const start = toWorldPoint(from, gridPx);
  const end = toWorldPoint(to, gridPx);
  return obstacles.some((obstacle) =>
    segmentTouchesBounds(
      start,
      end,
      expandedBounds(obstacle.bounds, clearancePx),
    )
  );
}

function astar(
  start: GridPoint,
  goals: readonly GridPoint[],
  obstacles: readonly Obstacle[],
  options: NormalizedOptions,
  canvas: CircuitDocumentV2["drawing"]["canvas"],
): SearchResult {
  if (goals.length === 0) return { status: "no-path" };
  const bounds = makeSearchBounds(start, goals, options, canvas);
  const heuristicBounds = boundsForGridPoints(goals);
  const goalKeys = new Set(goals.map(gridKey));
  const open = new MinHeap();
  const bestCost = new Map<string, number>([[gridKey(start), 0]]);
  const parent = new Map<string, string>();
  let sequence = 0;
  let expanded = 0;
  let touchedBoundary = false;
  open.push({
    point: start,
    key: gridKey(start),
    g: 0,
    h: heuristicToGoalBounds(start, heuristicBounds),
    sequence: sequence++,
  });

  const neighbors = [
    { col: 0, row: -1 },
    { col: 1, row: 0 },
    { col: 0, row: 1 },
    { col: -1, row: 0 },
  ];
  while (open.size > 0) {
    const current = open.pop();
    if (!current || current.g !== bestCost.get(current.key)) continue;
    if (goalKeys.has(current.key)) {
      const reversed: GridPoint[] = [current.point];
      let key = current.key;
      while (parent.has(key)) {
        key = parent.get(key)!;
        const [col, row] = key.split(",").map(Number);
        reversed.push(gridPoint(col, row));
      }
      return { status: "found", path: reversed.reverse() };
    }
    if (expanded >= options.maxExpandedNodes) return { status: "limit" };
    expanded += 1;

    for (const offset of neighbors) {
      const next = gridPoint(
        current.point.col + offset.col,
        current.point.row + offset.row,
      );
      if (!withinSearchBounds(next, bounds)) {
        touchedBoundary = true;
        continue;
      }
      if (
        routeCellBlocked(next, options.gridPx, obstacles, options.clearancePx) ||
        routeStepBlocked(
          current.point,
          next,
          options.gridPx,
          obstacles,
          options.clearancePx,
        )
      ) continue;
      const key = gridKey(next);
      const nextCost = current.g + 1;
      if (nextCost >= (bestCost.get(key) ?? Number.POSITIVE_INFINITY)) continue;
      bestCost.set(key, nextCost);
      parent.set(key, current.key);
      open.push({
        point: next,
        key,
        g: nextCost,
        h: heuristicToGoalBounds(next, heuristicBounds),
        sequence: sequence++,
      });
    }
  }
  return touchedBoundary ? { status: "limit" } : { status: "no-path" };
}

function pointOnSegment(
  point: CircuitPoint,
  start: CircuitPoint,
  end: CircuitPoint,
): boolean {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const cross = (point[0] - start[0]) * dy - (point[1] - start[1]) * dx;
  if (Math.abs(cross) > EPSILON) return false;
  return point[0] >= Math.min(start[0], end[0]) - EPSILON &&
    point[0] <= Math.max(start[0], end[0]) + EPSILON &&
    point[1] >= Math.min(start[1], end[1]) - EPSILON &&
    point[1] <= Math.max(start[1], end[1]) + EPSILON;
}

function routeTouches(route: Route, point: CircuitPoint): boolean {
  return route.points.slice(1).some((end, index) =>
    pointOnSegment(point, route.points[index], end)
  );
}

function segmentIntersection(
  a: CircuitPoint,
  b: CircuitPoint,
  c: CircuitPoint,
  d: CircuitPoint,
): IntersectionResult {
  const r = [b[0] - a[0], b[1] - a[1]];
  const s = [d[0] - c[0], d[1] - c[1]];
  const cross = (left: number[], right: number[]) =>
    left[0] * right[1] - left[1] * right[0];
  const qmp = [c[0] - a[0], c[1] - a[1]];
  const denominator = cross(r, s);
  if (Math.abs(denominator) <= EPSILON) {
    if (Math.abs(cross(qmp, r)) > EPSILON) return { kind: "none" };
    const useX = Math.abs(r[0]) >= Math.abs(r[1]);
    const a0 = useX ? a[0] : a[1];
    const a1 = useX ? b[0] : b[1];
    const c0 = useX ? c[0] : c[1];
    const c1 = useX ? d[0] : d[1];
    const low = Math.max(Math.min(a0, a1), Math.min(c0, c1));
    const high = Math.min(Math.max(a0, a1), Math.max(c0, c1));
    if (high < low - EPSILON) return { kind: "none" };
    if (high > low + EPSILON) return { kind: "overlap" };
    const point = useX
      ? [low, Math.abs(r[0]) <= EPSILON ? a[1] : a[1] + (low - a[0]) * r[1] / r[0]]
      : [Math.abs(r[1]) <= EPSILON ? a[0] : a[0] + (low - a[1]) * r[0] / r[1], low];
    return { kind: "point", point: [point[0], point[1]] };
  }
  const t = cross(qmp, s) / denominator;
  const u = cross(qmp, r) / denominator;
  if (
    t < -EPSILON || t > 1 + EPSILON ||
    u < -EPSILON || u > 1 + EPSILON
  ) return { kind: "none" };
  return {
    kind: "point",
    point: [a[0] + t * r[0], a[1] + t * r[1]],
  };
}

function segmentAxis(
  start: CircuitPoint,
  end: CircuitPoint,
): "horizontal" | "vertical" | "diagonal" {
  if (Math.abs(start[1] - end[1]) <= EPSILON) return "horizontal";
  if (Math.abs(start[0] - end[0]) <= EPSILON) return "vertical";
  return "diagonal";
}

function routeAxisThrough(
  route: Route,
  point: CircuitPoint,
): "horizontal" | "vertical" | "diagonal" | null {
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const start = route.points[index];
    const end = route.points[index + 1];
    if (
      pointOnSegment(point, start, end) &&
      !samePoint(point, start) &&
      !samePoint(point, end)
    ) return segmentAxis(start, end);
  }
  for (let index = 1; index < route.points.length - 1; index += 1) {
    if (!samePoint(route.points[index], point)) continue;
    const before = segmentAxis(route.points[index - 1], route.points[index]);
    const after = segmentAxis(route.points[index], route.points[index + 1]);
    if (before === after) return before;
    return "diagonal";
  }
  return null;
}

function analyzeRouteInteractions(
  route: Route,
  otherRoutes: readonly Route[],
): RouteInteractions {
  const crossings: RouteInteractions["crossings"] = [];
  const junctionPoints: CircuitPoint[] = [];
  for (const other of otherRoutes) {
    for (let firstIndex = 0; firstIndex < route.points.length - 1; firstIndex += 1) {
      for (let secondIndex = 0; secondIndex < other.points.length - 1; secondIndex += 1) {
        const intersection = segmentIntersection(
          route.points[firstIndex],
          route.points[firstIndex + 1],
          other.points[secondIndex],
          other.points[secondIndex + 1],
        );
        if (intersection.kind === "none") continue;
        if (intersection.kind === "overlap") {
          return {
            crossings,
            junctionPoints,
            conflict: {
              code: "route-collinear-overlap",
              message: `New route "${route.id}" would overlap route "${other.id}" along a shared segment.`,
            },
          };
        }
        const at = intersection.point;
        if (route.netId === other.netId) {
          if (!junctionPoints.some((point) => samePoint(point, at))) {
            junctionPoints.push(at);
          }
          continue;
        }
        const routeAxis = routeAxisThrough(route, at);
        const otherAxis = routeAxisThrough(other, at);
        const isPerpendicular =
          (routeAxis === "horizontal" && otherAxis === "vertical") ||
          (routeAxis === "vertical" && otherAxis === "horizontal");
        if (!isPerpendicular) {
          return {
            crossings,
            junctionPoints,
            conflict: {
              code: "route-net-touch-ambiguous",
              message: `New route "${route.id}" would touch different-net route "${other.id}" without a clean perpendicular crossing.`,
            },
          };
        }
        const orientation = routeAxis as "horizontal" | "vertical";
        if (!crossings.some((crossing) =>
          crossing.routeId === other.id && samePoint(crossing.at, at)
        )) crossings.push({ routeId: other.id, at, orientation });
      }
    }
  }
  return { crossings, junctionPoints };
}

function addUniqueId(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}:${suffix}`)) suffix += 1;
  const id = `${base}:${suffix}`;
  used.add(id);
  return id;
}

function encodeId(value: string): string {
  return encodeURIComponent(value);
}

function routeIdBase(netId: string, members: CircuitPinReference[]): string {
  return `auto-route:${encodeId(netId)}:${members
    .map(({ componentId, pinId }) => `${encodeId(componentId)}.${encodeId(pinId)}`)
    .join(":")}`;
}

function markerIdBase(
  kind: "junction" | "crossing",
  netId: string,
  routeIds: readonly string[],
  at: CircuitPoint,
): string {
  return `auto-${kind}:${encodeId(netId)}:${routeIds
    .slice()
    .sort(compareIds)
    .map(encodeId)
    .join(":")}:${pointKey(at)}`;
}

function gridAligned(value: number, gridPx: number): boolean {
  return Math.abs(value / gridPx - Math.round(value / gridPx)) <= EPSILON;
}

function addGridPointsOnRoute(
  route: Route,
  target: Map<string, GridPoint>,
  obstacles: readonly Obstacle[],
  options: NormalizedOptions,
): void {
  const addPoint = (point: CircuitPoint) => {
    if (
      !gridAligned(point[0], options.gridPx) ||
      !gridAligned(point[1], options.gridPx) ||
      obstacles.some((obstacle) =>
        pointInBounds(
          point,
          expandedBounds(obstacle.bounds, options.clearancePx),
        )
      )
    ) return;
    const col = Math.round(point[0] / options.gridPx);
    const row = Math.round(point[1] / options.gridPx);
    const grid = gridPoint(col, row);
    target.set(gridKey(grid), grid);
  };
  for (let index = 0; index < route.points.length - 1; index += 1) {
    const start = route.points[index];
    const end = route.points[index + 1];
    if (
      !gridAligned(start[0], options.gridPx) ||
      !gridAligned(start[1], options.gridPx) ||
      !gridAligned(end[0], options.gridPx) ||
      !gridAligned(end[1], options.gridPx)
    ) continue;
    const axis = segmentAxis(start, end);
    if (axis === "diagonal") continue;
    const distance = axis === "horizontal"
      ? Math.abs(end[0] - start[0])
      : Math.abs(end[1] - start[1]);
    const steps = Math.round(distance / options.gridPx);
    const dx = axis === "horizontal"
      ? Math.sign(end[0] - start[0]) * options.gridPx
      : 0;
    const dy = axis === "vertical"
      ? Math.sign(end[1] - start[1]) * options.gridPx
      : 0;
    for (let step = 0; step <= steps; step += 1) {
      addPoint([start[0] + dx * step, start[1] + dy * step]);
    }
  }
}

function appendRouteMarkers(
  plan: RoutePlan,
  route: Route,
  interactions: RouteInteractions,
  allSameNetRoutes: readonly Route[],
  joinPoint: CircuitPoint | null,
  usedJunctionIds: Set<string>,
  usedCrossingIds: Set<string>,
): void {
  const junctionPoints = [...interactions.junctionPoints];
  if (joinPoint) junctionPoints.push(joinPoint);
  for (const at of junctionPoints) {
    const touching = [...allSameNetRoutes, route]
      .filter((entry) => entry.netId === route.netId && routeTouches(entry, at))
      .map(({ id }) => id)
      .filter((id, index, values) => values.indexOf(id) === index)
      .sort(compareIds);
    if (touching.length < 2) continue;
    const id = addUniqueId(
      markerIdBase("junction", route.netId, touching, at),
      usedJunctionIds,
    );
    if (plan.junctions.some((entry) =>
      samePoint(entry.at, at) &&
      entry.routeIds.length === touching.length &&
      entry.routeIds.every((routeId, index) => routeId === touching[index])
    )) continue;
    plan.junctions.push({ id, at, routeIds: touching, properties: {} });
  }

  for (const crossing of interactions.crossings) {
    const routeIds = [route.id, crossing.routeId].sort(compareIds);
    const id = addUniqueId(
      markerIdBase("crossing", route.netId, routeIds, crossing.at),
      usedCrossingIds,
    );
    if (plan.crossings.some((entry) =>
      samePoint(entry.at, crossing.at) &&
      entry.routeIds.length === routeIds.length &&
      entry.routeIds.every((routeId, index) => routeId === routeIds[index])
    )) continue;
    plan.crossings.push({
      id,
      at: crossing.at,
      orientation: crossing.orientation,
      routeIds,
      properties: {},
    });
  }
}

function buildRoutePlan(
  net: CircuitNetV2,
  document: CircuitDocumentV2,
  placementByComponent: Map<string, CircuitDocumentV2["drawing"]["placements"][number]>,
  geometryByComponent: Map<string, PlacedGeometry>,
  unknownGeometryIds: readonly string[],
  obstacles: readonly Obstacle[],
  options: NormalizedOptions,
  usedRouteIds: Set<string>,
  usedJunctionIds: Set<string>,
  usedCrossingIds: Set<string>,
): { plan?: RoutePlan; diagnostics: CircuitDocumentDiagnostic[] } {
  const pathBase = `electrical.nets.${net.id}`;
  const members = [...net.members].sort((left, right) =>
    compareIds(left.componentId, right.componentId) ||
    compareIds(left.pinId, right.pinId)
  );
  const diagnostics: CircuitDocumentDiagnostic[] = [];
  const resolved: ResolvedMember[] = [];

  for (const member of members) {
    const placement = placementByComponent.get(member.componentId);
    if (!placement) {
      diagnostics.push(diagnostic(
        "route-pin-placement-missing",
        `drawing.placements.${member.componentId}`,
        `Net "${net.id}" cannot route pin "${member.componentId}.${member.pinId}" because its component has no placement.`,
      ));
      continue;
    }
    const placedGeometry = geometryByComponent.get(member.componentId);
    if (!placedGeometry) {
      diagnostics.push(diagnostic(
        "route-pin-geometry-unknown",
        `drawing.placements.${member.componentId}`,
        `Net "${net.id}" cannot route pin "${member.componentId}.${member.pinId}" because its symbol geometry is unresolved.`,
      ));
      continue;
    }
    const pin = placedGeometry.resolution.pins.find(({ id }) => id === member.pinId);
    if (!pin) {
      diagnostics.push(diagnostic(
        "route-pin-coordinate-missing",
        `electrical.nets.${net.id}.members`,
        `Net "${net.id}" cannot route pin "${member.componentId}.${member.pinId}" because the shared geometry resolver returned no matching pin coordinate.`,
      ));
      continue;
    }
    resolved.push({
      member,
      point: [pin.point[0], pin.point[1]],
      ...(pin.bodyPoint ? { bodyPoint: [pin.bodyPoint[0], pin.bodyPoint[1]] } : {}),
      ...(placedGeometry.resolution.transform.origin
        ? { origin: [...placedGeometry.resolution.transform.origin] as CircuitPoint }
        : { origin: [...placement.position] as CircuitPoint }),
      bodyBounds: placedGeometry.resolution.bodyBounds,
      escapePath: [],
      anchor: gridPoint(0, 0),
    });
  }
  if (diagnostics.length > 0) return { diagnostics };

  const unknownObstacles = unknownGeometryIds.filter(
    (componentId) => !members.some((member) => member.componentId === componentId),
  );
  if (unknownObstacles.length > 0) {
    diagnostics.push(diagnostic(
      "route-obstacle-geometry-unknown",
      `drawing.placements.${unknownObstacles[0]}`,
      `Net "${net.id}" was not routed because placed component geometry is unresolved for ${unknownObstacles.join(", ")}; obstacle clearance cannot be guaranteed.`,
    ));
    return { diagnostics };
  }

  for (const member of resolved) {
    const ownObstacle = obstacles.find((entry) =>
      entry.componentId === member.member.componentId
    );
    if (!ownObstacle) {
      diagnostics.push(diagnostic(
        "route-pin-geometry-unknown",
        `drawing.placements.${member.member.componentId}`,
        `Net "${net.id}" cannot route pin "${member.member.componentId}.${member.member.pinId}" because its symbol body bounds are unavailable.`,
      ));
      continue;
    }
    const escape = makeEscapePath(
      member,
      ownObstacle,
      obstacles,
      options,
      document.drawing.canvas,
    );
    if (!escape.path || !escape.anchor) {
      diagnostics.push(diagnostic(
        "route-pin-access-blocked",
        `electrical.nets.${net.id}.members`,
        `Net "${net.id}" cannot safely escape pin "${member.member.componentId}.${member.member.pinId}" from its own symbol body.`,
      ));
      continue;
    }
    member.escapePath = escape.path;
    member.anchor = escape.anchor;
  }
  if (diagnostics.length > 0) return { diagnostics };

  const plan: RoutePlan = { routes: [], junctions: [], crossings: [] };
  const root = resolved[0];
  const tree = new Map<string, GridPoint>();
  tree.set(gridKey(root.anchor), root.anchor);
  const routeBaseSet = new Set(document.drawing.routes.map(({ id }) => id));
  for (const id of usedRouteIds) routeBaseSet.add(id);
  const routeIdSet = new Set(routeBaseSet);
  const localJunctionIds = new Set(usedJunctionIds);
  const localCrossingIds = new Set(usedCrossingIds);
  const sameNetRoutes: Route[] = [];

  for (let memberIndex = 1; memberIndex < resolved.length; memberIndex += 1) {
    const target = resolved[memberIndex];
    const goals = [...tree.values()].sort((left, right) =>
      left.row - right.row || left.col - right.col
    );
    const search = astar(
      target.anchor,
      goals,
      obstacles,
      options,
      document.drawing.canvas,
    );
    if (search.status !== "found") {
      diagnostics.push(diagnostic(
        search.status === "limit" ? "route-search-limit" : "route-no-path",
        `electrical.nets.${net.id}`,
        search.status === "limit"
          ? `Routing net "${net.id}" reached the configured A* search bound before connecting pin "${target.member.componentId}.${target.member.pinId}".`
          : `No body-clear route was found for net "${net.id}" to pin "${target.member.componentId}.${target.member.pinId}" within the configured search envelope.`,
      ));
      return { diagnostics };
    }

    const branchMembers = memberIndex === 1
      ? [root.member, target.member]
      : [target.member];
    const routeId = addUniqueId(
      routeIdBase(net.id, branchMembers),
      routeIdSet,
    );
    let routePoints: CircuitPoint[];
    let joinPoint: CircuitPoint | null = null;
    if (memberIndex === 1) {
      const rootToTargetGrid = search.path.slice().reverse()
        .map((point) => toWorldPoint(point, options.gridPx));
      const targetEscapeReversed = target.escapePath.slice().reverse();
      routePoints = simplifyPoints([
        ...root.escapePath,
        ...rootToTargetGrid.slice(1),
        ...targetEscapeReversed.slice(1),
      ]);
    } else {
      routePoints = simplifyPoints([
        ...target.escapePath,
        ...search.path.slice(1).map((point) => toWorldPoint(point, options.gridPx)),
      ]);
      const join = search.path[search.path.length - 1];
      joinPoint = toWorldPoint(join, options.gridPx);
    }
    if (routePoints.length < 2) {
      diagnostics.push(diagnostic(
        "route-degenerate",
        `electrical.nets.${net.id}`,
        `Net "${net.id}" produced no drawable segment while connecting pin "${target.member.componentId}.${target.member.pinId}".`,
      ));
      return { diagnostics };
    }
    const route: Route = {
      id: routeId,
      netId: net.id,
      points: routePoints,
      properties: {},
    };
    const otherRoutes = [
      ...document.drawing.routes,
      ...sameNetRoutes,
    ];
    const interactions = analyzeRouteInteractions(route, otherRoutes);
    if (interactions.conflict) {
      diagnostics.push(diagnostic(
        interactions.conflict.code,
        `drawing.routes.${route.id}`,
        interactions.conflict.message,
      ));
      return { diagnostics };
    }

    appendRouteMarkers(
      plan,
      route,
      interactions,
      [...document.drawing.routes, ...sameNetRoutes],
      joinPoint,
      localJunctionIds,
      localCrossingIds,
    );
    plan.routes.push(route);
    sameNetRoutes.push(route);
    addGridPointsOnRoute(route, tree, obstacles, options);
    if (joinPoint && gridAligned(joinPoint[0], options.gridPx) &&
      gridAligned(joinPoint[1], options.gridPx)) {
      const joinGrid = gridPoint(
        Math.round(joinPoint[0] / options.gridPx),
        Math.round(joinPoint[1] / options.gridPx),
      );
      if (!routeCellBlocked(
        joinGrid,
        options.gridPx,
        obstacles,
        options.clearancePx,
      )) tree.set(gridKey(joinGrid), joinGrid);
    }
  }
  return { plan, diagnostics };
}

function structuralErrors(
  validation: ReturnType<typeof validateCircuitDocumentV2>,
): CircuitDocumentDiagnostic[] {
  return [
    ...validation.schemaErrors,
    ...validation.electricalErrors,
    ...validation.drawingErrors,
  ];
}

export function routeCircuitDocument(
  request: CircuitRoutingRequest,
): CircuitRoutingResult {
  if (request?.algorithmVersion !== CIRCUIT_ROUTING_ALGORITHM_VERSION) {
    return resultBlocked([diagnostic(
      "routing-version-unsupported",
      "algorithmVersion",
      `This engine supports only ${CIRCUIT_ROUTING_ALGORITHM_VERSION}.`,
    )]);
  }
  const normalized = normalizeOptions(request.options);
  if (!normalized.options) return resultBlocked(normalized.diagnostics);

  const parsed = CircuitDocumentV2Schema.safeParse(request.document);
  if (!parsed.success) {
    return resultBlocked(parsed.error.issues.map((issue) =>
      diagnostic(
        "routing-document-invalid",
        issue.path.join("."),
        issue.message,
      )
    ));
  }
  let nextDocument = cloneDocument(parsed.data);
  const initialValidation = validateCircuitDocumentV2(nextDocument);
  const initialErrors = structuralErrors(initialValidation);
  if (initialErrors.length > 0) return resultBlocked(initialErrors);

  const componentById = new Map(
    nextDocument.electrical.components.map((component) => [component.id, component]),
  );
  const placementByComponent = new Map(
    nextDocument.drawing.placements.map((placement) => [placement.componentId, placement]),
  );
  const geometryByComponent = new Map<string, PlacedGeometry>();
  const obstacles: Obstacle[] = [];
  const unknownGeometryIds: string[] = [];
  for (const placement of nextDocument.drawing.placements
    .slice()
    .sort((left, right) => compareIds(left.componentId, right.componentId))) {
    const component = componentById.get(placement.componentId);
    if (!component) continue;
    const resolution = resolveCircuitDocumentComponentGeometry(component, placement);
    if (resolution.status === "unsupported") {
      unknownGeometryIds.push(component.id);
      continue;
    }
    geometryByComponent.set(component.id, {
      componentId: component.id,
      resolution,
    });
    obstacles.push({
      componentId: component.id,
      bounds: resolution.bodyBounds,
    });
  }

  const diagnostics: CircuitDocumentDiagnostic[] = [];
  const routedNetIds: string[] = [];
  const skippedNetIds: string[] = [];
  const blockedNetIds: string[] = [];
  const usedRouteIds = new Set(nextDocument.drawing.routes.map(({ id }) => id));
  const usedJunctionIds = new Set(nextDocument.drawing.junctions.map(({ id }) => id));
  const usedCrossingIds = new Set(nextDocument.drawing.crossings.map(({ id }) => id));
  const nets = nextDocument.electrical.nets
    .slice()
    .sort((left, right) => compareIds(left.id, right.id));

  for (const net of nets) {
    if (net.members.length < 2) continue;
    if (nextDocument.drawing.routes.some((route) => route.netId === net.id)) {
      skippedNetIds.push(net.id);
      diagnostics.push(diagnostic(
        "route-net-already-routed",
        `electrical.nets.${net.id}`,
        `Net "${net.id}" was left unchanged because it already has one or more drawing routes.`,
        "warning",
      ));
      continue;
    }
    const built = buildRoutePlan(
      net,
      nextDocument,
      placementByComponent,
      geometryByComponent,
      unknownGeometryIds,
      obstacles,
      normalized.options,
      usedRouteIds,
      usedJunctionIds,
      usedCrossingIds,
    );
    if (!built.plan) {
      blockedNetIds.push(net.id);
      diagnostics.push(...built.diagnostics);
      continue;
    }

    const candidate = cloneDocument(nextDocument);
    candidate.drawing.routes.push(...built.plan.routes);
    candidate.drawing.junctions.push(...built.plan.junctions);
    candidate.drawing.crossings.push(...built.plan.crossings);
    const candidateErrors = structuralErrors(validateCircuitDocumentV2(candidate));
    if (candidateErrors.length > 0) {
      blockedNetIds.push(net.id);
      diagnostics.push(diagnostic(
        "route-result-invalid",
        `electrical.nets.${net.id}`,
        `The proposed drawing additions for net "${net.id}" failed V2 validation and were discarded: ${candidateErrors[0].message}`,
      ));
      continue;
    }
    nextDocument = candidate;
    routedNetIds.push(net.id);
    diagnostics.push(...built.diagnostics);
    for (const route of built.plan.routes) usedRouteIds.add(route.id);
    for (const junction of built.plan.junctions) usedJunctionIds.add(junction.id);
    for (const crossing of built.plan.crossings) usedCrossingIds.add(crossing.id);
  }

  const finalValidation = validateCircuitDocumentV2(nextDocument);
  diagnostics.push(...finalValidation.drawingWarnings);
  diagnostics.push(...finalValidation.consistencyWarnings);
  const sortedDiagnostics = uniqueSortedDiagnostics(diagnostics);
  const common = {
    document: nextDocument,
    diagnostics: sortedDiagnostics,
    routedNetIds: routedNetIds.sort(compareIds),
    skippedNetIds: skippedNetIds.sort(compareIds),
    algorithmVersion: CIRCUIT_ROUTING_ALGORITHM_VERSION,
  };
  return blockedNetIds.length > 0
    ? {
        status: "incomplete",
        ...common,
        blockedNetIds: blockedNetIds.sort(compareIds),
      }
    : {
        status: "complete",
        ...common,
        blockedNetIds: [],
      };
}

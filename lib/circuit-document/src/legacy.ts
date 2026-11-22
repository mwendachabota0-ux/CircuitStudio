import {
  getCircuitElementSchemaError,
  type CircuitPoint as GeometryPoint,
} from "@workspace/circuit-geometry";
import {
  CircuitDocumentV2Schema,
  CIRCUIT_DOCUMENT_DRAWING_TYPES,
  getCircuitPinDefinitions,
  type CircuitComponentV2,
  type CircuitDocumentDiagnostic,
  type CircuitDocumentV2,
  type CircuitPinReference,
} from "./model.ts";
import {
  checkCircuitDrawingConsistency,
  validateCircuitDocumentV2,
} from "./validation.ts";

export type LegacyCircuitElement = Record<string, unknown> & { type: string };
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
  parts: Array<{ designator: string; type: string; value: string }>;
  nets: Array<{ name: string; pins: string[] }>;
  pinMembership?: LegacyPinMembership[];
  routeMembership?: LegacyRouteMembership[];
};

export type LegacyCircuitValidation = {
  errors: string[];
  warnings?: string[];
  topologyErrors?: string[];
};

export type LegacyCircuitTools = {
  netlistWithMembership: (
    spec: LegacyCircuitSpec,
    allowStructuralErrors?: boolean,
  ) => LegacyMembershipNetlist;
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

const drawingTypeSet = new Set<string>(CIRCUIT_DOCUMENT_DRAWING_TYPES);
const visualProperties = new Set([
  "labelPos",
  "labelNudge",
  "labelAt",
  "labelAnchor",
]);

const diagnostic = (
  code: string,
  severity: "error" | "warning",
  path: string,
  message: string,
): CircuitDocumentDiagnostic => ({ code, severity, path, message });

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function copyRecordExcept(
  value: Record<string, unknown>,
  excluded: Set<string>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([key]) => !excluded.has(key)),
  );
}

function copyPoint(value: unknown): [number, number] | undefined {
  return Array.isArray(value) &&
      value.length === 2 &&
      typeof value[0] === "number" &&
      Number.isFinite(value[0]) &&
      typeof value[1] === "number" &&
      Number.isFinite(value[1])
    ? [value[0], value[1]]
    : undefined;
}

function stableHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function generatedId(prefix: string, index: number, value: unknown): string {
  return `${prefix}-${index + 1}-${stableHash(JSON.stringify(value) ?? String(value))}`;
}

function componentPlacement(
  element: LegacyCircuitElement,
): {
  position: [number, number];
  rotation: number;
  legacyGeometry: { from?: [number, number]; to?: [number, number]; at?: [number, number] };
} | null {
  const from = copyPoint(element.from);
  const to = copyPoint(element.to);
  const at = copyPoint(element.at);
  let position: [number, number] | undefined;
  let rotation = typeof element.rotation === "number" && Number.isFinite(element.rotation)
    ? element.rotation
    : 0;
  if (at) {
    position = at;
  } else if (from && to) {
    position = [(from[0] + to[0]) / 2, (from[1] + to[1]) / 2];
    if (typeof element.rotation !== "number") {
      rotation = Math.atan2(to[1] - from[1], to[0] - from[0]) * 180 / Math.PI;
    }
  }
  if (!position) return null;
  return {
    position,
    rotation,
    legacyGeometry: {
      ...(from ? { from } : {}),
      ...(to ? { to } : {}),
      ...(at ? { at } : {}),
    },
  };
}

function componentProperties(element: LegacyCircuitElement): Record<string, unknown> {
  return copyRecordExcept(element, new Set([
    "type",
    "id",
    "label",
    "value",
    "from",
    "to",
    "at",
    "rotation",
    "flip",
    ...visualProperties,
  ]));
}

function drawingProperties(
  element: LegacyCircuitElement,
  excluded: string[],
): Record<string, unknown> {
  return copyRecordExcept(element, new Set(excluded));
}

function pointOnSegment(point: GeometryPoint, start: GeometryPoint, end: GeometryPoint): boolean {
  const cross = (point[0] - start[0]) * (end[1] - start[1]) -
    (point[1] - start[1]) * (end[0] - start[0]);
  if (Math.abs(cross) > 0.000001) return false;
  return point[0] >= Math.min(start[0], end[0]) - 0.000001 &&
    point[0] <= Math.max(start[0], end[0]) + 0.000001 &&
    point[1] >= Math.min(start[1], end[1]) - 0.000001 &&
    point[1] <= Math.max(start[1], end[1]) + 0.000001;
}

function routeIdsAtPoint(
  routes: CircuitDocumentV2["drawing"]["routes"],
  point: [number, number],
): string[] {
  return routes.filter((route) =>
    route.points.slice(1).some((end, index) =>
      pointOnSegment(point, route.points[index], end)
    )
  ).map((route) => route.id);
}

function makePinReference(component: CircuitComponentV2, pinIndex: number): CircuitPinReference | null {
  const pin = component.pins[pinIndex];
  return pin ? { componentId: component.id, pinId: pin.id } : null;
}

function blockImport(
  original: LegacyCircuitSpec,
  diagnostics: CircuitDocumentDiagnostic[],
  partialDocument?: unknown,
): LegacyImportResult {
  return {
    status: "blocked",
    trusted: false,
    ...(partialDocument === undefined ? {} : { partialDocument }),
    original,
    diagnostics,
  };
}

/**
 * Converts legacy coordinates through CircuitDraw's own netlist grouping.
 * This adapter does not reimplement legacy connectivity or alter the input.
 */
export function importLegacyCircuitSpec(
  original: LegacyCircuitSpec,
  tools: LegacyCircuitTools,
  options: { documentId?: string } = {},
): LegacyImportResult {
  const diagnostics: CircuitDocumentDiagnostic[] = [];
  if (!original || !Array.isArray(original.elements)) {
    return blockImport(original, [diagnostic(
      "legacy-document-invalid",
      "error",
      "elements",
      "Legacy CircuitSpec must contain an elements array.",
    )]);
  }

  const validation = tools.validate(original);
  const topologyErrors = new Set(validation.topologyErrors ?? []);
  validation.errors.forEach((message) => {
    const isTopologyOnly = topologyErrors.has(message);
    diagnostics.push(diagnostic(
      isTopologyOnly ? "legacy-topology-warning" : "legacy-geometry-invalid",
      isTopologyOnly ? "warning" : "error",
      "elements",
      message,
    ));
  });
  (validation.warnings ?? []).forEach((message) => {
    diagnostics.push(diagnostic(
      "legacy-validation-warning",
      "warning",
      "elements",
      message,
    ));
  });
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return blockImport(original, diagnostics);
  }

  let legacyNetlist: LegacyMembershipNetlist;
  try {
    legacyNetlist = tools.netlistWithMembership(original, true);
  } catch (error) {
    diagnostics.push(diagnostic(
      "legacy-netlist-unavailable",
      "error",
      "elements",
      `Legacy connectivity could not be derived: ${error instanceof Error ? error.message : "unknown netlist error"}`,
    ));
    return blockImport(original, diagnostics);
  }
  if (
    !isRecord(legacyNetlist) ||
    !Array.isArray(legacyNetlist.pinMembership) ||
    !Array.isArray(legacyNetlist.routeMembership)
  ) {
    diagnostics.push(diagnostic(
      "legacy-membership-missing",
      "error",
      "elements",
      "The legacy netlist did not provide exact pin and route membership; conversion will not infer it separately.",
    ));
    return blockImport(original, diagnostics);
  }

  const components: CircuitComponentV2[] = [];
  const placements: CircuitDocumentV2["drawing"]["placements"] = [];
  const componentByElementIndex = new Map<number, CircuitComponentV2>();
  const componentIds = new Set<string>();
  let generatedComponentId = false;

  original.elements.forEach((element, elementIndex) => {
    if (drawingTypeSet.has(element.type)) return;
    if (!isRecord(element)) {
      diagnostics.push(diagnostic(
        "legacy-component-invalid",
        "error",
        `elements.${elementIndex}`,
        "Component entry must be an object.",
      ));
      return;
    }
    const sourceId = typeof element.id === "string" && element.id.length > 0
      ? element.id
      : generatedId("legacy-component", elementIndex, { type: element.type, value: element.value });
    if (!element.id) {
      generatedComponentId = true;
      diagnostics.push(diagnostic(
        "legacy-component-id-generated",
        "warning",
        `elements.${elementIndex}.id`,
        `A stable import ID "${sourceId}" was generated because the legacy component had no ID.`,
      ));
    }
    if (componentIds.has(sourceId)) {
      diagnostics.push(diagnostic(
        "duplicate-component-id",
        "error",
        `elements.${elementIndex}.id`,
        `Legacy component ID "${sourceId}" is duplicated and cannot be preserved safely.`,
      ));
      return;
    }
    componentIds.add(sourceId);
    const properties = componentProperties(element);
    const pins = getCircuitPinDefinitions(element.type, properties);
    if (!pins) {
      diagnostics.push(diagnostic(
        "legacy-pin-identities-unresolved",
        "error",
        `elements.${elementIndex}`,
        `Stable pin identities are unavailable for ${sourceId} (${element.type}); unsupported or unresolved symbols are not assigned fabricated pins.`,
      ));
      return;
    }
    const schemaError = getCircuitElementSchemaError({
      ...properties,
      type: element.type,
      ...(copyPoint(element.from) ? { from: copyPoint(element.from) } : {}),
      ...(copyPoint(element.to) ? { to: copyPoint(element.to) } : {}),
      ...(copyPoint(element.at) ? { at: copyPoint(element.at) } : {}),
    });
    if (schemaError) {
      diagnostics.push(diagnostic(
        "legacy-component-invalid",
        "error",
        `elements.${elementIndex}`,
        `${sourceId}: ${schemaError}`,
      ));
      return;
    }
    const component = {
      id: sourceId,
      type: element.type,
      ...(typeof element.label === "string" ? { reference: element.label } : {}),
      ...(typeof element.value === "string" ? { value: element.value } : {}),
      properties,
      pins,
    } as CircuitComponentV2;
    const placement = componentPlacement(element);
    if (!placement) {
      diagnostics.push(diagnostic(
        "legacy-placement-missing",
        "error",
        `elements.${elementIndex}`,
        `Component "${sourceId}" has no valid physical position.`,
      ));
      return;
    }
    components.push(component);
    componentByElementIndex.set(elementIndex, component);
    placements.push({
      componentId: sourceId,
      position: placement.position,
      rotation: placement.rotation,
      flip: element.flip === true,
      legacyGeometry: placement.legacyGeometry,
      properties: copyRecordExcept(element, new Set([
        "type",
        "id",
        "label",
        "value",
        "from",
        "to",
        "at",
        "rotation",
        "flip",
      ])),
    });
  });

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return blockImport(original, diagnostics);
  }

  const membershipsByNet = new Map<string, {
    name: string;
    members: CircuitPinReference[];
    routeIds: string[];
  }>();
  const getNetGroup = (netKey: string, name: string) => {
    let group = membershipsByNet.get(netKey);
    if (!group) {
      group = { name, members: [], routeIds: [] };
      membershipsByNet.set(netKey, group);
    }
    return group;
  };
  const assignedPins = new Set<string>();
  const reportedPins = new Set<string>();
  const unassignedPins: CircuitPinReference[] = [];

  legacyNetlist.pinMembership.forEach((membership) => {
    const component = componentByElementIndex.get(membership.elementIndex);
    if (!component) {
      diagnostics.push(diagnostic(
        "legacy-pin-owner-missing",
        "error",
        `elements.${membership.elementIndex}`,
        "Legacy connectivity references a pin on a component that could not be imported.",
      ));
      return;
    }
    const reference = makePinReference(component, membership.pinIndex);
    if (!reference) {
      diagnostics.push(diagnostic(
        "legacy-pin-index-invalid",
        "error",
        `elements.${membership.elementIndex}`,
        `Legacy connectivity references unavailable pin index ${membership.pinIndex} on ${component.id}.`,
      ));
      return;
    }
    const membershipKey = `${reference.componentId}\u0000${reference.pinId}`;
    if (reportedPins.has(membershipKey)) {
      diagnostics.push(diagnostic(
        "legacy-pin-membership-duplicate",
        "error",
        `elements.${membership.elementIndex}`,
        `Legacy connectivity reports ${component.id}.${reference.pinId} more than once.`,
      ));
      return;
    }
    reportedPins.add(membershipKey);
    if (
      typeof membership.connected !== "boolean" ||
      typeof membership.netKey !== "string" ||
      membership.netKey.length === 0 ||
      typeof membership.netName !== "string"
    ) {
      diagnostics.push(diagnostic(
        "legacy-pin-membership-invalid",
        "error",
        `elements.${membership.elementIndex}`,
        `Legacy connectivity has an incomplete net assignment for ${component.id}.${reference.pinId}.`,
      ));
      return;
    }
    if (!membership.connected) {
      unassignedPins.push(reference);
      return;
    }
    const key = `${reference.componentId}\u0000${reference.pinId}`;
    if (assignedPins.has(key)) {
      diagnostics.push(diagnostic(
        "legacy-pin-ambiguous",
        "error",
        `elements.${membership.elementIndex}`,
        `Legacy pin ${component.id}.${reference.pinId} appears in more than one connectivity group.`,
      ));
      return;
    }
    assignedPins.add(key);
    getNetGroup(membership.netKey, membership.netName).members.push(reference);
  });

  components.forEach((component) => {
    component.pins.forEach((pin) => {
      if (!reportedPins.has(`${component.id}\u0000${pin.id}`)) {
        diagnostics.push(diagnostic(
          "legacy-pin-membership-incomplete",
          "error",
          `electrical.components.${component.id}.pins.${pin.id}`,
          `Legacy connectivity did not report a state for ${component.id}.${pin.id}; conversion will not infer it.`,
        ));
      }
    });
  });

  const routeElementByIndex = new Map<number, LegacyCircuitElement>();
  original.elements.forEach((element, elementIndex) => {
    if (element.type === "wire") routeElementByIndex.set(elementIndex, element);
  });
  const routes: CircuitDocumentV2["drawing"]["routes"] = [];
  const routeNetKeyById = new Map<string, string>();
  const routeIdsByElementIndex = new Map<number, string>();
  const reportedRouteIndexes = new Set<number>();
  legacyNetlist.routeMembership.forEach((membership, routeOrdinal) => {
    const element = routeElementByIndex.get(membership.elementIndex);
    if (!element || !Array.isArray(element.points)) {
      diagnostics.push(diagnostic(
        "legacy-route-owner-missing",
        "error",
        `elements.${membership.elementIndex}`,
        "Legacy connectivity references a route that is missing from the original document.",
      ));
      return;
    }
    if (reportedRouteIndexes.has(membership.elementIndex)) {
      diagnostics.push(diagnostic(
        "legacy-route-membership-duplicate",
        "error",
        `elements.${membership.elementIndex}`,
        "Legacy connectivity reports the same wire more than once.",
      ));
      return;
    }
    reportedRouteIndexes.add(membership.elementIndex);
    if (
      typeof membership.netKey !== "string" ||
      membership.netKey.length === 0 ||
      typeof membership.netName !== "string"
    ) {
      diagnostics.push(diagnostic(
        "legacy-route-membership-invalid",
        "error",
        `elements.${membership.elementIndex}`,
        "Legacy connectivity has an incomplete net assignment for a wire.",
      ));
      return;
    }
    const routeId = typeof element.id === "string" && element.id.length > 0
      ? element.id
      : generatedId("legacy-wire", membership.elementIndex, element.points);
    if (!element.id) {
      diagnostics.push(diagnostic(
        "legacy-route-id-generated",
        "warning",
        `elements.${membership.elementIndex}.id`,
        `A stable import ID "${routeId}" was generated for a wire without an ID.`,
      ));
    }
    const points = element.points.map(copyPoint);
    if (points.some((point) => !point)) {
      diagnostics.push(diagnostic(
        "legacy-route-invalid",
        "error",
        `elements.${membership.elementIndex}.points`,
        `Wire "${routeId}" contains an invalid coordinate.`,
      ));
      return;
    }
    const group = getNetGroup(membership.netKey, membership.netName);
    group.routeIds.push(routeId);
    routes.push({
      id: routeId,
      netId: "",
      points: points as [number, number][],
      ...(element.open === true ? { open: true } : {}),
      properties: drawingProperties(element, ["type", "id", "points", "open"]),
    });
    routeNetKeyById.set(routeId, membership.netKey);
    routeIdsByElementIndex.set(membership.elementIndex, routeId);
    void routeOrdinal;
  });
  routeElementByIndex.forEach((_element, elementIndex) => {
    if (!reportedRouteIndexes.has(elementIndex)) {
      diagnostics.push(diagnostic(
        "legacy-route-membership-incomplete",
        "error",
        `elements.${elementIndex}`,
        "Legacy connectivity did not report this wire's net; conversion will not drop or infer its route.",
      ));
    }
  });

  if (diagnostics.some((entry) => entry.severity === "error")) {
    return blockImport(original, diagnostics);
  }

  components.forEach((component) => {
    component.pins.forEach((pin) => {
      const key = `${component.id}\u0000${pin.id}`;
      if (!assignedPins.has(key) && !unassignedPins.some(
        (reference) => `${reference.componentId}\u0000${reference.pinId}` === key,
      )) {
        unassignedPins.push({ componentId: component.id, pinId: pin.id });
      }
    });
  });

  const netIds = new Map<string, string>();
  const usedNetIds = new Set<string>();
  const nets = [...membershipsByNet.entries()].map(([netKey, group]) => {
    const members = group.members.slice().sort((first, second) =>
      `${first.componentId}.${first.pinId}`.localeCompare(`${second.componentId}.${second.pinId}`)
    );
    const seed = members.length > 0
      ? members.map((member) => `${member.componentId}.${member.pinId}`).join("|")
      : `routes:${group.routeIds.slice().sort().join("|")}:${netKey}`;
    let id = `net-v2-${stableHash(seed)}`;
    let suffix = 1;
    while (usedNetIds.has(id)) id = `net-v2-${stableHash(seed)}-${suffix++}`;
    usedNetIds.add(id);
    netIds.set(netKey, id);
    return {
      id,
      ...(group.name ? { name: group.name } : {}),
      members,
    };
  });
  routes.forEach((route) => {
    const netKey = routeNetKeyById.get(route.id);
    const netId = netKey ? netIds.get(netKey) : undefined;
    if (!netId) {
      diagnostics.push(diagnostic(
        "legacy-route-net-missing",
        "error",
        `drawing.routes.${route.id}`,
        `Could not preserve a valid net association for route "${route.id}".`,
      ));
      return;
    }
    route.netId = netId;
  });

  const routeIdByElementIndex = routeIdsByElementIndex;
  const junctions: CircuitDocumentV2["drawing"]["junctions"] = [];
  const crossings: CircuitDocumentV2["drawing"]["crossings"] = [];
  const annotations: CircuitDocumentV2["drawing"]["annotations"] = [];
  original.elements.forEach((element, elementIndex) => {
    const id = typeof element.id === "string" && element.id.length > 0
      ? element.id
      : generatedId(`legacy-${element.type}`, elementIndex, element);
    if (element.type === "junction") {
      const at = typeof element.x === "number" && typeof element.y === "number"
        ? [element.x, element.y] as [number, number]
        : undefined;
      if (!at) return;
      junctions.push({
        id,
        at,
        routeIds: routeIdsAtPoint(routes, at),
        properties: drawingProperties(element, ["type", "id", "x", "y"]),
      });
    } else if (element.type === "crossing") {
      const at = copyPoint(element.at);
      if (!at) return;
      crossings.push({
        id,
        at,
        ...(element.orientation === "horizontal" || element.orientation === "vertical"
          ? { orientation: element.orientation }
          : {}),
        routeIds: routeIdsAtPoint(routes, at),
        properties: drawingProperties(element, ["type", "id", "at", "orientation"]),
      });
    } else if (element.type === "label") {
      const at = copyPoint(element.at);
      if (!at) return;
      annotations.push({
        id,
        type: "label",
        at,
        text: typeof element.text === "string" ? element.text : "",
        properties: drawingProperties(element, ["type", "id", "at", "text"]),
      });
    } else if (element.type === "box") {
      if (
        typeof element.x !== "number" ||
        typeof element.y !== "number" ||
        typeof element.w !== "number" ||
        typeof element.h !== "number"
      ) return;
      annotations.push({
        id,
        type: "box",
        x: element.x,
        y: element.y,
        w: element.w,
        h: element.h,
        properties: drawingProperties(element, ["type", "id", "x", "y", "w", "h"]),
      });
    }
    void elementIndex;
  });

  const originalMetadata = copyRecordExcept(original, new Set([
    "title",
    "width",
    "height",
    "elements",
  ]));
  const documentCandidate = {
    schemaVersion: 2,
    id: options.documentId ?? `legacy-${stableHash(JSON.stringify(original))}`,
    ...(typeof original.title === "string" ? { title: original.title } : {}),
    electrical: {
      components,
      nets,
      noConnects: [],
      unassignedPins,
    },
    drawing: {
      units: "px",
      canvas: {
        ...(typeof original.width === "number" ? { width: original.width } : {}),
        ...(typeof original.height === "number" ? { height: original.height } : {}),
      },
      placements,
      routes,
      junctions,
      crossings,
      annotations,
    },
    legacyImport: {
      sourceFormat: "CircuitSpec",
      groundSemantics: "global-ground",
      terminalLabelSemantics: "local-labels-do-not-merge",
      sourceMetadata: originalMetadata,
    },
  };
  const parsed = CircuitDocumentV2Schema.safeParse(documentCandidate);
  if (!parsed.success) {
    diagnostics.push(...parsed.error.issues.map((issue) => diagnostic(
      "converted-document-schema-invalid",
      "error",
      issue.path.join("."),
      issue.message,
    )));
    return blockImport(original, diagnostics, documentCandidate);
  }

  const modelValidation = validateCircuitDocumentV2(parsed.data);
  for (const entry of [
    ...modelValidation.electricalErrors,
    ...modelValidation.drawingErrors,
  ]) diagnostics.push(entry);
  if (!modelValidation.isValid) {
    return blockImport(original, diagnostics, parsed.data);
  }

  diagnostics.push(diagnostic(
    "legacy-ground-globally-merged",
    "warning",
    "legacyImport.groundSemantics",
    "Legacy conversion preserves CircuitDraw behavior: all legacy ground symbols belong to the global GND net.",
  ));
  diagnostics.push(diagnostic(
    "legacy-terminal-labels-local",
    "warning",
    "legacyImport.terminalLabelSemantics",
    "Repeated terminal labels remain separate unless legacy geometry already places them on the same net.",
  ));
  if (generatedComponentId) {
    diagnostics.push(diagnostic(
      "legacy-component-identities-generated",
      "warning",
      "electrical.components",
      "One or more source components lacked IDs; deterministic IDs were generated for this imported document.",
    ));
  }
  const consistency = checkCircuitDrawingConsistency(parsed.data);
  diagnostics.push(...consistency);
  const status = diagnostics.some((entry) => entry.severity === "warning")
    ? "complete-with-warnings"
    : "complete";
  return {
    status,
    trusted: true,
    document: parsed.data,
    original,
    diagnostics,
  };
}

function partitionSignature(document: CircuitDocumentV2): string {
  const netMembership = document.electrical.nets.map((net) =>
    net.members.map((member) => `${member.componentId}.${member.pinId}`).sort().join(",")
  ).sort();
  const routeMembership = document.electrical.nets.map((net) => {
    const routeIds = document.drawing.routes
      .filter((route) => route.netId === net.id)
      .map((route) => route.id)
      .sort();
    return `${net.members.map((member) => `${member.componentId}.${member.pinId}`).sort().join(",")}|${routeIds.join(",")}`;
  }).sort();
  return JSON.stringify({ netMembership, routeMembership });
}

function legacyElementFromComponent(
  component: CircuitComponentV2,
  placement: CircuitDocumentV2["drawing"]["placements"][number] | undefined,
): LegacyCircuitElement | null {
  if (!placement) return null;
  const element: Record<string, unknown> = {
    ...component.properties,
    ...placement.properties,
    type: component.type,
    id: component.id,
    ...(component.reference !== undefined ? { label: component.reference } : {}),
    ...(component.value !== undefined ? { value: component.value } : {}),
    rotation: placement.rotation,
    ...(placement.flip ? { flip: true } : {}),
  };
  const geometry = placement.legacyGeometry;
  if (geometry?.from && geometry.to) {
    element.from = geometry.from.slice();
    element.to = geometry.to.slice();
  } else if (geometry?.at) {
    element.at = geometry.at.slice();
  } else if (
    component.type !== "kicad" &&
    !["resistor", "capacitor", "electrolytic", "inductor", "diode", "zener", "led",
      "battery", "switch", "mic", "speaker", "lamp", "acsource", "crystal", "fuse",
      "thermistor", "photoresistor", "varistor", "photodiode", "schottky", "dcsource",
      "currentsource", "motor", "buzzer", "solarcell"].includes(component.type)
  ) {
    element.at = placement.position.slice();
  } else {
    return null;
  }
  return element as LegacyCircuitElement;
}

/**
 * Projects only the subset whose identities and complete wire geometry can be
 * expressed safely by the existing CircuitSpec format.
 */
export function projectCircuitDocumentToLegacy(
  value: unknown,
  tools: LegacyCircuitTools,
): LegacyProjectionResult {
  const diagnostics: CircuitDocumentDiagnostic[] = [];
  const parsed = CircuitDocumentV2Schema.safeParse(value);
  if (!parsed.success) {
    return {
      status: "not-representable",
      diagnostics: parsed.error.issues.map((issue) => diagnostic(
        "projection-schema-invalid",
        "error",
        issue.path.join("."),
        issue.message,
      )),
    };
  }
  const document = parsed.data;
  const validation = validateCircuitDocumentV2(document);
  if (
    validation.schemaErrors.length > 0 ||
    validation.electricalErrors.length > 0 ||
    validation.drawingErrors.length > 0
  ) {
    diagnostics.push(...validation.schemaErrors, ...validation.electricalErrors, ...validation.drawingErrors);
  }
  if (validation.consistencyWarnings.length > 0) {
    diagnostics.push(diagnostic(
      "projection-layout-incomplete",
      "error",
      "drawing",
      "The electrical topology is not fully represented by visible routes; projection will not fabricate wire paths.",
    ));
  }
  if (document.electrical.noConnects.length > 0) {
    diagnostics.push(diagnostic(
      "projection-no-connect-unsupported",
      "error",
      "electrical.noConnects",
      "Legacy CircuitSpec cannot preserve explicit no-connect markers.",
    ));
  }
  if (document.electrical.unassignedPins.length > 0) {
    diagnostics.push(diagnostic(
      "projection-unassigned-pin-unsupported",
      "error",
      "electrical.unassignedPins",
      "Legacy CircuitSpec cannot preserve the distinction between unassigned and intentionally unconnected pins.",
    ));
  }

  const groundNetIds = new Set<string>();
  document.electrical.components
    .filter((component) => component.type === "ground")
    .forEach((component) => {
      document.electrical.nets.forEach((net) => {
        if (net.members.some((member) => member.componentId === component.id)) {
          groundNetIds.add(net.id);
        }
      });
    });
  if (groundNetIds.size > 1) {
    diagnostics.push(diagnostic(
      "projection-ground-semantics-unsupported",
      "error",
      "electrical.nets",
      "Legacy CircuitSpec globally merges every ground symbol, so separate v2 ground nets cannot be projected safely.",
    ));
  }
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { status: "not-representable", diagnostics };
  }

  const placementByComponent = new Map(
    document.drawing.placements.map((placement) => [placement.componentId, placement]),
  );
  const elements: LegacyCircuitElement[] = [];
  for (const component of document.electrical.components) {
    const projected = legacyElementFromComponent(
      component,
      placementByComponent.get(component.id),
    );
    if (!projected) {
      diagnostics.push(diagnostic(
        "projection-placement-insufficient",
        "error",
        `drawing.placements.${component.id}`,
        `Complete source geometry for ${component.id} is unavailable; no default wire or component coordinates will be fabricated.`,
      ));
    } else {
      elements.push(projected);
    }
  }
  document.drawing.routes.forEach((route) => {
    elements.push({
      ...route.properties,
      type: "wire",
      id: route.id,
      points: route.points.map((point) => point.slice()),
      ...(route.open ? { open: true } : {}),
    });
  });
  document.drawing.junctions.forEach((junction) => {
    elements.push({
      ...junction.properties,
      type: "junction",
      id: junction.id,
      x: junction.at[0],
      y: junction.at[1],
    });
  });
  document.drawing.crossings.forEach((crossing) => {
    elements.push({
      ...crossing.properties,
      type: "crossing",
      id: crossing.id,
      at: crossing.at.slice(),
      ...(crossing.orientation ? { orientation: crossing.orientation } : {}),
    });
  });
  document.drawing.annotations.forEach((annotation) => {
    elements.push(annotation.type === "label"
      ? {
          ...annotation.properties,
          type: "label",
          id: annotation.id,
          at: annotation.at.slice(),
          text: annotation.text,
        }
      : {
          ...annotation.properties,
          type: "box",
          id: annotation.id,
          x: annotation.x,
          y: annotation.y,
          w: annotation.w,
          h: annotation.h,
        });
  });
  if (diagnostics.some((entry) => entry.severity === "error")) {
    return { status: "not-representable", diagnostics };
  }

  const spec: LegacyCircuitSpec = {
    title: document.title ?? "Circuit",
    ...(document.drawing.canvas.width !== undefined
      ? { width: document.drawing.canvas.width }
      : {}),
    ...(document.drawing.canvas.height !== undefined
      ? { height: document.drawing.canvas.height }
      : {}),
    elements,
  };
  const imported = importLegacyCircuitSpec(spec, tools, {
    documentId: document.id,
  });
  if (!imported.document || !imported.trusted) {
    diagnostics.push(...imported.diagnostics);
    diagnostics.push(diagnostic(
      "projection-legacy-validation-failed",
      "error",
      "elements",
      "The projected CircuitSpec failed the existing legacy geometry/netlist checks.",
    ));
    return { status: "not-representable", diagnostics };
  }
  if (partitionSignature(imported.document) !== partitionSignature(document)) {
    diagnostics.push(diagnostic(
      "projection-connectivity-changed",
      "error",
      "electrical.nets",
      "Legacy projection changed pin-to-net membership or route-to-net assignments.",
    ));
    return { status: "not-representable", diagnostics };
  }
  return { status: "representable", spec, diagnostics };
}

import {
  getCircuitPins,
  type CircuitElementGeometry,
} from "@workspace/circuit-geometry";
import {
  CircuitDocumentV2Schema,
  getCircuitPinDefinitions,
  type CircuitComponentV2,
  type CircuitDocumentDiagnostic,
  type CircuitDocumentV2,
  type CircuitPoint,
  type CircuitPinReference,
} from "./model.ts";

export type CircuitDocumentValidationResult = {
  schemaErrors: CircuitDocumentDiagnostic[];
  electricalErrors: CircuitDocumentDiagnostic[];
  drawingErrors: CircuitDocumentDiagnostic[];
  drawingWarnings: CircuitDocumentDiagnostic[];
  consistencyWarnings: CircuitDocumentDiagnostic[];
  unassignedPins: CircuitPinReference[];
  isValid: boolean;
};

const errorDiagnostic = (
  code: string,
  path: string,
  message: string,
): CircuitDocumentDiagnostic => ({ code, severity: "error", path, message });

const warningDiagnostic = (
  code: string,
  path: string,
  message: string,
): CircuitDocumentDiagnostic => ({ code, severity: "warning", path, message });

function pinKey(reference: CircuitPinReference): string {
  return `${reference.componentId}\u0000${reference.pinId}`;
}

function parseDocument(
  value: unknown,
  errors: CircuitDocumentDiagnostic[],
): CircuitDocumentV2 | null {
  const result = CircuitDocumentV2Schema.safeParse(value);
  if (result.success) return result.data;

  for (const issue of result.error.issues) {
    errors.push(errorDiagnostic(
      "schema-invalid",
      issue.path.join("."),
      issue.message,
    ));
  }
  return null;
}

function validateUniqueIds(
  values: Array<{ id: string }>,
  path: string,
  errors: CircuitDocumentDiagnostic[],
): void {
  const ids = new Set<string>();
  values.forEach((value, index) => {
    if (ids.has(value.id)) {
      errors.push(errorDiagnostic(
        "duplicate-id",
        `${path}.${index}.id`,
        `Duplicate ID "${value.id}".`,
      ));
    }
    ids.add(value.id);
  });
}

function validateElectrical(
  document: CircuitDocumentV2,
  errors: CircuitDocumentDiagnostic[],
  unassignedPins: CircuitPinReference[],
): void {
  const components = new Map<string, CircuitComponentV2>();
  const componentIndexes = new Map<string, number>();
  document.electrical.components.forEach((component, index) => {
    if (!components.has(component.id)) {
      components.set(component.id, component);
      componentIndexes.set(component.id, index);
    }
  });
  validateUniqueIds(document.electrical.components, "electrical.components", errors);
  validateUniqueIds(document.electrical.nets, "electrical.nets", errors);

  const knownPins = new Map<string, Set<string>>();
  document.electrical.components.forEach((component, componentIndex) => {
    const properties = component.properties ?? {};
    const canonicalPins = getCircuitPinDefinitions(component.type, properties);
    if (!canonicalPins) {
      errors.push(errorDiagnostic(
        "pin-identities-unavailable",
        `electrical.components.${componentIndex}`,
        `Stable pin identities could not be derived from the shared catalog for ${component.id} (${component.type}).`,
      ));
    } else {
      const actualIds = component.pins.map((pin) => pin.id);
      const canonicalIds = canonicalPins.map((pin) => pin.id);
      if (
        actualIds.length !== canonicalIds.length ||
        actualIds.some((id, index) => id !== canonicalIds[index])
      ) {
        errors.push(errorDiagnostic(
          "pin-definitions-mismatch",
          `electrical.components.${componentIndex}.pins`,
          `Pin identities for ${component.id} do not match the shared component or imported symbol data.`,
        ));
      }
    }

    const pins = new Set<string>();
    component.pins.forEach((pin, pinIndex) => {
      if (pins.has(pin.id)) {
        errors.push(errorDiagnostic(
          "duplicate-pin-id",
          `electrical.components.${componentIndex}.pins.${pinIndex}.id`,
          `Component ${component.id} contains duplicate pin identity "${pin.id}".`,
        ));
      }
      pins.add(pin.id);
    });
    knownPins.set(component.id, pins);
  });

  const assignmentCounts = new Map<string, number>();
  const seenInCategory = new Map<string, string>();
  const registerReference = (
    reference: CircuitPinReference,
    category: string,
    path: string,
  ) => {
    const component = components.get(reference.componentId);
    const validPins = knownPins.get(reference.componentId);
    if (!component || !validPins) {
      errors.push(errorDiagnostic(
        "component-reference-missing",
        path,
        `Pin reference points to missing component "${reference.componentId}".`,
      ));
      return;
    }
    if (!validPins.has(reference.pinId)) {
      errors.push(errorDiagnostic(
        "pin-reference-invalid",
        path,
        `Component ${reference.componentId} has no pin "${reference.pinId}".`,
      ));
      return;
    }
    const key = pinKey(reference);
    const previousCategory = seenInCategory.get(key);
    if (previousCategory) {
      errors.push(errorDiagnostic(
        "duplicate-pin-reference",
        path,
        `Pin ${reference.componentId}.${reference.pinId} appears more than once in ${previousCategory} or ${category}.`,
      ));
    } else {
      seenInCategory.set(key, category);
    }
    assignmentCounts.set(key, (assignmentCounts.get(key) ?? 0) + 1);
  };

  document.electrical.nets.forEach((net, netIndex) => {
    net.members.forEach((reference, memberIndex) => {
      registerReference(
        reference,
        "net membership",
        `electrical.nets.${netIndex}.members.${memberIndex}`,
      );
    });
  });
  document.electrical.noConnects.forEach((reference, index) => {
    registerReference(reference, "no-connect markers", `electrical.noConnects.${index}`);
  });
  document.electrical.unassignedPins.forEach((reference, index) => {
    registerReference(reference, "unassigned pins", `electrical.unassignedPins.${index}`);
    unassignedPins.push(reference);
  });

  document.electrical.components.forEach((component, componentIndex) => {
    component.pins.forEach((pin) => {
      const reference = { componentId: component.id, pinId: pin.id };
      const count = assignmentCounts.get(pinKey(reference)) ?? 0;
      if (count !== 1) {
        errors.push(errorDiagnostic(
          count === 0 ? "pin-state-missing" : "pin-assigned-more-than-once",
          `electrical.components.${componentIndex}.pins`,
          count === 0
            ? `Pin ${component.id}.${pin.id} must be listed on one net, marked no-connect, or listed as unassigned.`
            : `Pin ${component.id}.${pin.id} is assigned to more than one electrical state.`,
        ));
      }
    });
  });
}

function validateDrawing(
  document: CircuitDocumentV2,
  errors: CircuitDocumentDiagnostic[],
  warnings: CircuitDocumentDiagnostic[],
): void {
  const componentIds = new Set(document.electrical.components.map((component) => component.id));
  const netIds = new Set(document.electrical.nets.map((net) => net.id));
  const routeById = new Map(document.drawing.routes.map((route) => [route.id, route]));
  const netByRoute = new Map<string, string>();

  validateUniqueIds(document.drawing.routes, "drawing.routes", errors);
  validateUniqueIds(document.drawing.junctions, "drawing.junctions", errors);
  validateUniqueIds(document.drawing.crossings, "drawing.crossings", errors);
  validateUniqueIds(document.drawing.annotations, "drawing.annotations", errors);

  const placements = new Set<string>();
  document.drawing.placements.forEach((placement, index) => {
    if (!componentIds.has(placement.componentId)) {
      errors.push(errorDiagnostic(
        "placement-component-missing",
        `drawing.placements.${index}.componentId`,
        `Placement references missing component "${placement.componentId}".`,
      ));
    }
    if (placements.has(placement.componentId)) {
      errors.push(errorDiagnostic(
        "duplicate-placement",
        `drawing.placements.${index}.componentId`,
        `Component "${placement.componentId}" has more than one placement.`,
      ));
    }
    placements.add(placement.componentId);
  });

  document.drawing.routes.forEach((route, index) => {
    if (!netIds.has(route.netId)) {
      errors.push(errorDiagnostic(
        "route-net-missing",
        `drawing.routes.${index}.netId`,
        `Route "${route.id}" references missing net "${route.netId}".`,
      ));
    }
    netByRoute.set(route.id, route.netId);
    route.points.slice(1).forEach((point, pointIndex) => {
      const previous = route.points[pointIndex];
      if (previous[0] !== point[0] && previous[1] !== point[1]) {
        warnings.push(warningDiagnostic(
          "diagonal-route",
          `drawing.routes.${index}.points.${pointIndex + 1}`,
          `Route "${route.id}" contains a diagonal segment; electrical membership is unaffected.`,
        ));
      }
      if (previous[0] === point[0] && previous[1] === point[1]) {
        warnings.push(warningDiagnostic(
          "zero-length-route-segment",
          `drawing.routes.${index}.points.${pointIndex + 1}`,
          `Route "${route.id}" contains a zero-length segment.`,
        ));
      }
    });
  });

  const checkAnnotationRoutes = (
    id: string,
    at: CircuitPoint,
    routeIds: string[],
    path: string,
    kind: "junction" | "crossing",
  ) => {
    const referencedNets = new Set<string>();
    const uniqueRouteIds = new Set(routeIds);
    routeIds.forEach((routeId, routeIndex) => {
      const route = routeById.get(routeId);
      if (!route) {
        errors.push(errorDiagnostic(
          "drawing-route-missing",
          `${path}.routeIds.${routeIndex}`,
          `${kind} "${id}" references missing route "${routeId}".`,
        ));
        return;
      }
      referencedNets.add(route.netId);
      if (!routeTouches(route, at)) {
        errors.push(errorDiagnostic(
          `${kind}-route-not-at-point`,
          `${path}.routeIds.${routeIndex}`,
          `${kind} "${id}" references route "${routeId}" that does not pass through its annotation point.`,
        ));
      }
    });
    if (uniqueRouteIds.size !== routeIds.length) {
      errors.push(errorDiagnostic(
        `${kind}-route-duplicate`,
        `${path}.routeIds`,
        `${kind} "${id}" repeats a route reference.`,
      ));
    }
    if (kind === "junction" && referencedNets.size > 1) {
      errors.push(errorDiagnostic(
        "junction-crosses-nets",
        path,
        `Junction "${id}" visually touches routes from different net IDs; it cannot merge them.`,
      ));
    } else if (kind === "junction" && routeIds.length < 2) {
      errors.push(errorDiagnostic(
        "junction-under-specified",
        path,
        `Junction "${id}" references fewer than two routes.`,
      ));
    } else if (kind === "crossing" && referencedNets.size === 1 && routeIds.length > 1) {
      warnings.push(warningDiagnostic(
        "crossing-same-net",
        path,
        `Crossing "${id}" visually separates routes assigned to the same net ID.`,
      ));
    } else if (kind === "crossing" && routeIds.length < 2) {
      errors.push(errorDiagnostic(
        "crossing-under-specified",
        path,
        `Crossing "${id}" references fewer than two routes.`,
      ));
    }
  };

  document.drawing.junctions.forEach((junction, index) => {
    checkAnnotationRoutes(
      junction.id,
      junction.at as CircuitPoint,
      junction.routeIds,
      `drawing.junctions.${index}`,
      "junction",
    );
  });
  document.drawing.crossings.forEach((crossing, index) => {
    checkAnnotationRoutes(
      crossing.id,
      crossing.at as CircuitPoint,
      crossing.routeIds,
      `drawing.crossings.${index}`,
      "crossing",
    );
  });
  void netByRoute;
}

function pointOnSegment(
  point: readonly number[],
  start: readonly number[],
  end: readonly number[],
): boolean {
  const [x, y] = point;
  const [x1, y1] = start;
  const [x2, y2] = end;
  const cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1);
  if (Math.abs(cross) > 0.000001) return false;
  return x >= Math.min(x1, x2) - 0.000001 &&
    x <= Math.max(x1, x2) + 0.000001 &&
    y >= Math.min(y1, y2) - 0.000001 &&
    y <= Math.max(y1, y2) + 0.000001;
}

function routeTouches(route: CircuitDocumentV2["drawing"]["routes"][number], point: CircuitPoint): boolean {
  return route.points.some((candidate) =>
    Math.abs(candidate[0] - point[0]) <= 0.000001 &&
    Math.abs(candidate[1] - point[1]) <= 0.000001
  ) || route.points.slice(1).some((end, index) =>
    pointOnSegment(point, route.points[index], end)
  );
}

function worldPinPoints(
  component: CircuitComponentV2,
  placement: CircuitDocumentV2["drawing"]["placements"][number] | undefined,
): Map<string, CircuitPoint> {
  if (!placement) return new Map();
  const geometry: CircuitElementGeometry = {
    ...component.properties,
    type: component.type,
    ...placement.legacyGeometry,
    at: placement.legacyGeometry?.at ?? placement.position,
    flip: placement.flip,
    rotation: placement.rotation,
  };
  const pins = getCircuitPins(geometry);
  return new Map(component.pins.flatMap((pin, index) => {
    const point = pins[index]?.point;
    return point ? [[pin.id, point as CircuitPoint]] : [];
  }));
}

export function checkCircuitDrawingConsistency(
  value: unknown,
): CircuitDocumentDiagnostic[] {
  const parse = CircuitDocumentV2Schema.safeParse(value);
  if (!parse.success) {
    return parse.error.issues.map((issue) =>
      errorDiagnostic("schema-invalid", issue.path.join("."), issue.message)
    );
  }
  const document = parse.data;
  const placementByComponent = new Map(
    document.drawing.placements.map((placement) => [placement.componentId, placement]),
  );
  const componentById = new Map(
    document.electrical.components.map((component) => [component.id, component]),
  );
  const pinPoints = new Map<string, CircuitPoint>();

  document.electrical.components.forEach((component) => {
    const points = worldPinPoints(component, placementByComponent.get(component.id));
    points.forEach((point, pinId) => pinPoints.set(
      pinKey({ componentId: component.id, pinId }),
      point,
    ));
  });

  const warnings: CircuitDocumentDiagnostic[] = [];
  document.electrical.nets.forEach((net, netIndex) => {
    if (net.members.length < 2) return;
    const membersWithPoints = net.members.flatMap((member) => {
      const point = pinPoints.get(pinKey(member));
      return point ? [{ member, point }] : [];
    });
    if (membersWithPoints.length < 2) {
      warnings.push(warningDiagnostic(
        "net-visual-connection-unknown",
        `electrical.nets.${netIndex}`,
        `Net "${net.id}" has multiple members but not enough placed pin geometry to check its visible connection.`,
      ));
      return;
    }

    const disconnected = membersWithPoints.filter(({ member, point }) => {
      const hasSameNetRoute = document.drawing.routes.some(
        (route) => route.netId === net.id && routeTouches(route, point),
      );
      const hasCoincidentSameNetPin = membersWithPoints.some(
        (other) => other.member.componentId !== member.componentId ||
          other.member.pinId !== member.pinId,
      ) && membersWithPoints.some((other) =>
        (other.member.componentId !== member.componentId || other.member.pinId !== member.pinId) &&
        Math.abs(other.point[0] - point[0]) <= 0.000001 &&
        Math.abs(other.point[1] - point[1]) <= 0.000001
      );
      return !hasSameNetRoute && !hasCoincidentSameNetPin;
    });

    if (disconnected.length > 0) {
      warnings.push(warningDiagnostic(
        "net-not-visibly-connected",
        `electrical.nets.${netIndex}`,
        `Net "${net.id}" contains electrically connected pins that are not all represented by a visible route or coincident pin geometry.`,
      ));
    }
  });

  document.drawing.routes.forEach((route, routeIndex) => {
    const sameNetMembers = document.electrical.nets.find((net) => net.id === route.netId)?.members ?? [];
    if (sameNetMembers.length === 0) {
      warnings.push(warningDiagnostic(
        "route-has-no-electrical-pins",
        `drawing.routes.${routeIndex}`,
        `Route "${route.id}" belongs to a net with no component pin members.`,
      ));
      return;
    }
    const touchesAnyMember = sameNetMembers.some((member) => {
      const point = pinPoints.get(pinKey(member));
      return point ? routeTouches(route, point) : false;
    });
    if (!touchesAnyMember) {
      warnings.push(warningDiagnostic(
        "route-does-not-touch-net-pin",
        `drawing.routes.${routeIndex}`,
        `Route "${route.id}" does not visibly touch a pin assigned to net "${route.netId}".`,
      ));
    }
  });

  const explicitCrossings = new Set(
    document.drawing.crossings.flatMap((crossing) => crossing.routeIds.length > 1
      ? [crossing.routeIds.slice().sort().join("\u0000") + "\u0000" + crossing.at.join(",")]
      : []),
  );
  for (let firstIndex = 0; firstIndex < document.drawing.routes.length; firstIndex += 1) {
    const first = document.drawing.routes[firstIndex];
    for (let secondIndex = firstIndex + 1; secondIndex < document.drawing.routes.length; secondIndex += 1) {
      const second = document.drawing.routes[secondIndex];
      if (first.netId === second.netId) continue;
      const intersections: CircuitPoint[] = [];
      first.points.slice(1).forEach((firstEnd, i) => {
        const firstStart = first.points[i];
        second.points.slice(1).forEach((secondEnd, j) => {
          const secondStart = second.points[j];
          const candidates = [
            [firstStart[0], secondStart[1]],
            [secondStart[0], firstStart[1]],
          ] as CircuitPoint[];
          candidates.forEach((point) => {
            if (
              pointOnSegment(point, firstStart, firstEnd) &&
              pointOnSegment(point, secondStart, secondEnd) &&
              !intersections.some((existing) =>
                existing[0] === point[0] && existing[1] === point[1]
              )
            ) intersections.push(point);
          });
        });
      });
      intersections.forEach((point) => {
        const refs = [first.id, second.id].sort().join("\u0000");
        const marked = explicitCrossings.has(`${refs}\u0000${point.join(",")}`);
        if (!marked) {
          warnings.push(warningDiagnostic(
            "unmarked-route-crossing",
            "drawing.routes",
            `Different-net routes "${first.id}" and "${second.id}" cross at (${point[0]}, ${point[1]}) without an explicit visual crossing marker.`,
          ));
        }
      });
    }
  }

  void componentById;
  return warnings;
}

export function validateCircuitDocumentV2(value: unknown): CircuitDocumentValidationResult {
  const schemaErrors: CircuitDocumentDiagnostic[] = [];
  const electricalErrors: CircuitDocumentDiagnostic[] = [];
  const drawingErrors: CircuitDocumentDiagnostic[] = [];
  const drawingWarnings: CircuitDocumentDiagnostic[] = [];
  const consistencyWarnings: CircuitDocumentDiagnostic[] = [];
  const unassignedPins: CircuitPinReference[] = [];
  const document = parseDocument(value, schemaErrors);
  if (!document) {
    return {
      schemaErrors,
      electricalErrors,
      drawingErrors,
      drawingWarnings,
      consistencyWarnings,
      unassignedPins,
      isValid: false,
    };
  }

  validateElectrical(document, electricalErrors, unassignedPins);
  validateDrawing(document, drawingErrors, drawingWarnings);
  consistencyWarnings.push(...checkCircuitDrawingConsistency(document));
  return {
    schemaErrors,
    electricalErrors,
    drawingErrors,
    drawingWarnings,
    consistencyWarnings,
    unassignedPins,
    isValid: schemaErrors.length === 0 &&
      electricalErrors.length === 0 &&
      drawingErrors.length === 0,
  };
}

export function arePinsElectricallyConnected(
  value: unknown,
  first: CircuitPinReference,
  second: CircuitPinReference,
): boolean {
  const parsed = CircuitDocumentV2Schema.safeParse(value);
  if (!parsed.success) return false;
  const netId = parsed.data.electrical.nets.find((net) =>
    net.members.some((member) => pinKey(member) === pinKey(first))
  )?.id;
  return netId !== undefined && parsed.data.electrical.nets.some((net) =>
    net.id === netId &&
    net.members.some((member) => pinKey(member) === pinKey(second))
  );
}

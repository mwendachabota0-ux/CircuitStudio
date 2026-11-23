import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
  prepareCircuitDocumentDrawing,
  resolveCircuitDocumentComponentGeometry,
  validateCircuitDocumentV2,
} from "../src/index.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const fixture = (name) => {
  const entry = circuitDocumentFixtures.find((item) => item.name === name);
  assert.ok(entry, `fixture not found: ${name}`);
  return structuredClone(entry.document);
};

const request = (document, options = {}) => ({
  document,
  ...options,
  algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
});

const clearRoutes = (document) => {
  document.drawing.routes = [];
  document.drawing.junctions = [];
  document.drawing.crossings = [];
  return document;
};

const geometryByComponent = (document) => {
  const placements = new Map(
    document.drawing.placements.map((placement) => [placement.componentId, placement]),
  );
  return new Map(document.electrical.components.map((component) => {
    const placement = placements.get(component.id);
    assert.ok(placement, `missing placement for ${component.id}`);
    const geometry = resolveCircuitDocumentComponentGeometry(component, placement);
    assert.equal(geometry.status, "resolved");
    return [component.id, geometry];
  }));
};

const pointKey = (point) => `${point[0]},${point[1]}`;

function assertNetRouteTree(document, netId, geometry = geometryByComponent(document)) {
  const net = document.electrical.nets.find((entry) => entry.id === netId);
  assert.ok(net, `missing net ${netId}`);
  const routes = document.drawing.routes.filter((route) => route.netId === netId);
  assert.ok(routes.length > 0, `net ${netId} has no routes`);
  const routeIds = new Set(routes.map((route) => route.id));

  for (const member of net.members) {
    const pin = geometry.get(member.componentId)?.pins.find(({ id }) => id === member.pinId);
    assert.ok(pin, `missing resolved pin ${member.componentId}.${member.pinId}`);
    assert.ok(routes.some((route) =>
      pointKey(route.points[0]) === pointKey(pin.point) ||
      pointKey(route.points.at(-1)) === pointKey(pin.point)
    ), `no route endpoint matches ${member.componentId}.${member.pinId}`);
  }

  const connected = new Set([routes[0].id]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const junction of document.drawing.junctions) {
      if (!junction.routeIds.some((routeId) => connected.has(routeId))) continue;
      for (const routeId of junction.routeIds) {
        if (routeIds.has(routeId) && !connected.has(routeId)) {
          connected.add(routeId);
          changed = true;
        }
      }
    }
  }
  assert.equal(connected.size, routes.length, `routes for ${netId} do not form one tree`);
}

function assertMarkersDoNotJoinDifferentNets(document) {
  const routeById = new Map(document.drawing.routes.map((route) => [route.id, route]));
  for (const junction of document.drawing.junctions) {
    const netIds = new Set(junction.routeIds.map((routeId) => routeById.get(routeId)?.netId));
    assert.equal(netIds.size, 1, `junction ${junction.id} joins different nets`);
  }
  for (const crossing of document.drawing.crossings) {
    const netIds = new Set(crossing.routeIds.map((routeId) => routeById.get(routeId)?.netId));
    assert.ok(netIds.size > 1, `crossing ${crossing.id} does not represent separate nets`);
  }
}

test("series LED placement and routing produce a deterministic valid drawing", () => {
  const document = clearRoutes(fixture("series LED"));
  document.drawing.placements = document.drawing.placements
    .filter((placement) => placement.componentId !== "R1")
    .map((placement) => {
      if (placement.componentId === "B1") return { ...placement, userPinned: true };
      if (placement.componentId === "SW1") return { ...placement, userPinned: false };
      return placement;
    });
  const original = structuredClone(document);

  const first = prepareCircuitDocumentDrawing(request(document));
  const second = prepareCircuitDocumentDrawing(request(document));

  assert.equal(first.status, "complete");
  assert.deepEqual(first, second);
  assert.deepEqual(first.stages, { placement: "complete", routing: "complete" });
  assert.equal(first.metrics.placement.unplacedBefore, 1);
  assert.equal(first.metrics.routing.routedNetCount, 4);
  assert.deepEqual(first.routedNetIds, ["led-feed", "return", "supply", "switched"]);
  assert.deepEqual(first.document.electrical, original.electrical);
  assert.deepEqual(document, original);
  for (const placement of original.drawing.placements) {
    assert.deepEqual(
      first.document.drawing.placements.find(({ componentId }) =>
        componentId === placement.componentId
      ),
      placement,
    );
  }
  for (const net of first.document.electrical.nets) {
    assertNetRouteTree(first.document, net.id);
  }
  assert.equal(validateCircuitDocumentV2(first.document).isValid, true);
  assert.deepEqual(validateCircuitDocumentV2(first.document).consistencyWarnings, []);

  const repeated = prepareCircuitDocumentDrawing(request(first.document));
  assert.equal(repeated.status, "complete");
  assert.deepEqual(repeated.document, first.document);
});

test("parallel branches receive connected same-net trees without merging nets", () => {
  const document = clearRoutes(fixture("parallel branches"));
  const original = structuredClone(document);
  const result = prepareCircuitDocumentDrawing(request(document));

  assert.equal(result.status, "complete");
  assert.deepEqual(result.document.electrical, original.electrical);
  assert.deepEqual(document, original);
  assert.deepEqual(
    result.routedNetIds,
    ["branch-1", "branch-2", "negative", "positive"],
  );
  for (const net of result.document.electrical.nets) {
    assertNetRouteTree(result.document, net.id);
  }
  assertMarkersDoNotJoinDifferentNets(result.document);
  assert.equal(validateCircuitDocumentV2(result.document).isValid, true);
  assert.deepEqual(validateCircuitDocumentV2(result.document).consistencyWarnings, []);
});

test("transistor routing preserves protected placements and exact resolved pins", () => {
  const document = clearRoutes(fixture("single-transistor switch"));
  document.drawing.placements = document.drawing.placements.map((placement) =>
    placement.componentId === "Q1"
      ? { ...placement, userPinned: true }
      : placement
  );
  const original = structuredClone(document);
  const result = prepareCircuitDocumentDrawing(request(document));

  assert.equal(result.status, "partial");
  assert.deepEqual(document, original);
  assert.deepEqual(result.document.electrical, original.electrical);
  assert.deepEqual(result.document.drawing.placements, original.drawing.placements);
  assert.deepEqual(result.routedNetIds, ["return"]);
  assert.deepEqual(result.blockedNetIds, ["control"]);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "route-collinear-overlap"
  ));
  assertNetRouteTree(result.document, "return");
  assert.equal(validateCircuitDocumentV2(result.document).isValid, true);
});

test("eight-pin fanout is deterministic through the composed pipeline", () => {
  const document = clearRoutes(fixture("shared branch net"));
  const componentTemplate = document.electrical.components.find(({ id }) => id === "R2");
  const placementTemplate = document.drawing.placements.find(({ componentId }) =>
    componentId === "R2"
  );
  assert.ok(componentTemplate);
  assert.ok(placementTemplate);

  for (let index = 3; index <= 7; index += 1) {
    const componentId = `R${index}`;
    const x = 260 + (index - 2) * 120;
    const component = structuredClone(componentTemplate);
    const placement = structuredClone(placementTemplate);
    component.id = componentId;
    component.properties.from = [x, 80];
    component.properties.to = [x, 130];
    placement.componentId = componentId;
    placement.position = [x, 105];
    placement.legacyGeometry = { from: [x, 80], to: [x, 130] };
    document.electrical.components.push(component);
    document.drawing.placements.push(placement);
    document.electrical.nets.find(({ id }) => id === "branch").members.push({
      componentId,
      pinId: "1",
    });
    document.electrical.unassignedPins.push({ componentId, pinId: "2" });
  }
  document.drawing.canvas.width = 1000;
  const original = structuredClone(document);

  const first = prepareCircuitDocumentDrawing(request(document));
  const second = prepareCircuitDocumentDrawing(request(document));

  assert.equal(first.status, "complete");
  assert.deepEqual(first, second);
  assert.equal(first.document.drawing.routes.filter(({ netId }) =>
    netId === "branch"
  ).length, 7);
  assert.deepEqual(first.document.electrical, original.electrical);
  assert.deepEqual(document, original);
  assertNetRouteTree(first.document, "branch");
});

test("manual routes, junctions, crossings, and annotations remain unchanged", () => {
  const document = fixture("parallel branches");
  document.drawing.annotations.push({
    id: "manual-label",
    type: "label",
    at: [600, 450],
    text: "keep this note",
    properties: { source: "user" },
  });
  const original = structuredClone(document);
  const result = prepareCircuitDocumentDrawing(request(document));

  assert.equal(result.status, "complete");
  assert.deepEqual(result.document.drawing.routes, original.drawing.routes);
  assert.deepEqual(result.document.drawing.junctions, original.drawing.junctions);
  assert.deepEqual(result.document.drawing.crossings, original.drawing.crossings);
  assert.deepEqual(result.document.drawing.annotations, original.drawing.annotations);
  assert.deepEqual(result.document.electrical, original.electrical);
  assert.deepEqual(document, original);
  assert.deepEqual(
    result.skippedNetIds,
    ["branch-1", "branch-2", "negative", "positive"],
  );
  assert.deepEqual(prepareCircuitDocumentDrawing(request(result.document)).document, result.document);

  const crossed = fixture("separate crossing nets");
  const scaleAndOffset = ([x, y]) => [x * 10 + 1000, y * 10 + 1000];
  for (const component of crossed.electrical.components) {
    for (const key of ["from", "to", "at"]) {
      if (Array.isArray(component.properties[key])) {
        component.properties[key] = scaleAndOffset(component.properties[key]);
      }
    }
  }
  for (const placement of crossed.drawing.placements) {
    placement.position = scaleAndOffset(placement.position);
    if (!placement.legacyGeometry) continue;
    for (const key of ["from", "to", "at"]) {
      if (Array.isArray(placement.legacyGeometry[key])) {
        placement.legacyGeometry[key] = scaleAndOffset(
          placement.legacyGeometry[key],
        );
      }
    }
  }
  for (const route of crossed.drawing.routes) {
    route.points = route.points.map(scaleAndOffset);
  }
  for (const crossing of crossed.drawing.crossings) {
    crossing.at = scaleAndOffset(crossing.at);
  }
  crossed.drawing.canvas = { width: 3000, height: 3000 };
  const originalCrossings = structuredClone(crossed.drawing.crossings);
  const originalCrossRoutes = structuredClone(crossed.drawing.routes);
  const crossingResult = prepareCircuitDocumentDrawing(request(crossed));
  assert.equal(crossingResult.status, "complete");
  assert.deepEqual(crossingResult.document.drawing.routes, originalCrossRoutes);
  assert.deepEqual(crossingResult.document.drawing.crossings, originalCrossings);
  assertMarkersDoNotJoinDifferentNets(crossingResult.document);
});

test("a partial manual route is reported without being overwritten", () => {
  const document = fixture("series LED");
  const partialManualRoute = structuredClone(
    document.drawing.routes.find(({ netId }) => netId === "switched"),
  );
  partialManualRoute.points = [[150, 100], [180, 100]];
  document.drawing.routes = [partialManualRoute];
  document.drawing.junctions = [];
  document.drawing.crossings = [];
  const original = structuredClone(document);

  const result = prepareCircuitDocumentDrawing(request(document));

  assert.equal(result.status, "partial");
  assert.ok(result.skippedNetIds.includes("switched"));
  assert.deepEqual(
    result.document.drawing.routes.find(({ id }) => id === partialManualRoute.id),
    partialManualRoute,
  );
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "net-not-visibly-connected"
  ));
  assert.deepEqual(result.document.electrical, original.electrical);
  assert.deepEqual(document, original);
});

test("invalid input and blocked stages stop without replacing drawing data", () => {
  const invalid = fixture("series LED");
  invalid.electrical.nets[0].members[0].pinId = "missing-pin";
  const invalidResult = prepareCircuitDocumentDrawing(request(invalid));
  assert.equal(invalidResult.status, "invalid-input");
  assert.deepEqual(invalidResult.stages, { placement: "not-run", routing: "not-run" });
  assert.equal("document" in invalidResult, false);

  const placementBlocked = clearRoutes(fixture("series LED"));
  placementBlocked.drawing.placements = placementBlocked.drawing.placements
    .filter((placement) => placement.componentId !== "R1");
  const original = structuredClone(placementBlocked);
  const placementResult = prepareCircuitDocumentDrawing(request(placementBlocked, {
    placementHints: { pinnedComponentIds: ["R1"] },
  }));
  assert.equal(placementResult.status, "placement-blocked");
  assert.deepEqual(placementResult.stages, { placement: "blocked", routing: "not-run" });
  assert.deepEqual(placementResult.document, original);
  assert.deepEqual(placementBlocked, original);

  const routingBlocked = clearRoutes(fixture("shared branch net"));
  const routingOriginal = structuredClone(routingBlocked);
  const routingResult = prepareCircuitDocumentDrawing(request(routingBlocked, {
    routingOptions: { gridPx: 0 },
  }));
  assert.equal(routingResult.status, "routing-blocked");
  assert.deepEqual(routingResult.stages, { placement: "complete", routing: "blocked" });
  assert.deepEqual(routingResult.document, routingOriginal);
  assert.deepEqual(routingBlocked, routingOriginal);
});

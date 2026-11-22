import assert from "node:assert/strict";
import test from "node:test";
import {
  CIRCUIT_ROUTING_ALGORITHM_VERSION,
  resolveCircuitDocumentComponentGeometry,
  routeCircuitDocument,
  validateCircuitDocumentV2,
} from "../src/index.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const fixture = (name) => {
  const entry = circuitDocumentFixtures.find((item) => item.name === name);
  assert.ok(entry, `fixture not found: ${name}`);
  return structuredClone(entry.document);
};

const request = (document, options) => ({
  document,
  ...(options ? { options } : {}),
  algorithmVersion: CIRCUIT_ROUTING_ALGORITHM_VERSION,
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
    const result = resolveCircuitDocumentComponentGeometry(component, placement);
    assert.equal(result.status, "resolved");
    return [component.id, result];
  }));
};

const pointKey = (point) => `${point[0]},${point[1]}`;

const segmentTouchesBounds = (start, end, bounds) => {
  if (start[1] === end[1]) {
    return start[1] >= bounds.y0 && start[1] <= bounds.y1 &&
      Math.max(Math.min(start[0], end[0]), bounds.x0) <=
        Math.min(Math.max(start[0], end[0]), bounds.x1);
  }
  if (start[0] === end[0]) {
    return start[0] >= bounds.x0 && start[0] <= bounds.x1 &&
      Math.max(Math.min(start[1], end[1]), bounds.y0) <=
        Math.min(Math.max(start[1], end[1]), bounds.y1);
  }
  return true;
};

test("two-pin nets route deterministically to exact resolved pins without mutating the source", () => {
  const document = clearRoutes(fixture("series LED"));
  document.metadata = { source: "routing-test", nested: { keep: [1, 2, 3] } };
  document.drawing.annotations = [{
    id: "note",
    type: "label",
    at: [12, 16],
    text: "preserve this",
    properties: { custom: true },
  }];
  document.electrical.components[0].properties.futureElectrical = {
    classification: "extension",
    values: [5, 9],
  };
  const original = structuredClone(document);
  const resolved = geometryByComponent(document);

  const first = routeCircuitDocument(request(document));
  const second = routeCircuitDocument(request(document));
  const permuted = structuredClone(document);
  permuted.electrical.components.reverse();
  permuted.electrical.nets.reverse();
  permuted.electrical.nets.forEach((net) => net.members.reverse());
  permuted.drawing.placements.reverse();
  const permutedResult = routeCircuitDocument(request(permuted));

  assert.equal(first.status, "complete");
  assert.deepEqual(first.document.drawing.routes, second.document.drawing.routes);
  assert.deepEqual(first.document.drawing.routes, permutedResult.document.drawing.routes);
  assert.deepEqual(first.document.drawing.junctions, second.document.drawing.junctions);
  assert.deepEqual(first.document.drawing.crossings, second.document.drawing.crossings);
  assert.deepEqual(document, original);
  assert.deepEqual(first.document.electrical, original.electrical);
  assert.deepEqual(first.document.drawing.placements, original.drawing.placements);
  assert.deepEqual(first.document.drawing.annotations, original.drawing.annotations);
  assert.deepEqual(first.document.metadata, original.metadata);
  assert.equal(first.document.drawing.routes.length, 4);
  assert.deepEqual(first.routedNetIds, ["led-feed", "return", "supply", "switched"]);

  for (const route of first.document.drawing.routes) {
    const net = document.electrical.nets.find((entry) => entry.id === route.netId);
    const memberPoints = net.members.map(({ componentId, pinId }) =>
      resolved.get(componentId).pins.find((pin) => pin.id === pinId).point
    );
    assert.ok(memberPoints.some((point) => pointKey(point) === pointKey(route.points[0])));
    assert.ok(memberPoints.some((point) => pointKey(point) === pointKey(route.points.at(-1))));
    for (let index = 1; index < route.points.length; index += 1) {
      const previous = route.points[index - 1];
      const current = route.points[index];
      assert.ok(
        previous[0] === current[0] || previous[1] === current[1],
        `${route.id} contains a diagonal segment`,
      );
    }
  }
  assert.equal(validateCircuitDocumentV2(first.document).isValid, true);
});

test("multi-pin nets form one route tree with explicit same-net junctions", () => {
  const document = clearRoutes(fixture("shared branch net"));
  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "complete");
  assert.deepEqual(result.routedNetIds, ["branch"]);
  assert.equal(result.document.drawing.routes.filter((route) => route.netId === "branch").length, 2);
  assert.ok(result.document.drawing.junctions.length >= 1);
  for (const junction of result.document.drawing.junctions) {
    assert.ok(junction.routeIds.length >= 2);
    assert.ok(junction.routeIds.every((id) =>
      result.document.drawing.routes.find((route) => route.id === id)?.netId === "branch"
    ));
  }
  assert.equal(validateCircuitDocumentV2(result.document).isValid, true);
});

test("routes keep non-endpoint segments outside symbol-body clearance", () => {
  const document = clearRoutes(fixture("series LED"));
  const resolved = geometryByComponent(document);
  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "complete");
  for (const route of result.document.drawing.routes) {
    const net = document.electrical.nets.find((entry) => entry.id === route.netId);
    const startOwner = net.members.find(({ componentId, pinId }) =>
      pointKey(resolved.get(componentId).pins.find((pin) => pin.id === pinId).point) ===
      pointKey(route.points[0])
    )?.componentId;
    const endOwner = net.members.find(({ componentId, pinId }) =>
      pointKey(resolved.get(componentId).pins.find((pin) => pin.id === pinId).point) ===
      pointKey(route.points.at(-1))
    )?.componentId;
    for (let segmentIndex = 0; segmentIndex < route.points.length - 1; segmentIndex += 1) {
      const start = route.points[segmentIndex];
      const end = route.points[segmentIndex + 1];
      for (const [componentId, geometry] of resolved) {
        const bounds = {
          x0: geometry.bodyBounds.x0 - 12,
          y0: geometry.bodyBounds.y0 - 12,
          x1: geometry.bodyBounds.x1 + 12,
          y1: geometry.bodyBounds.y1 + 12,
        };
        const allowedPinEscape =
          (segmentIndex === 0 && componentId === startOwner) ||
          (segmentIndex === route.points.length - 2 && componentId === endOwner);
        if (allowedPinEscape) continue;
        assert.equal(
          segmentTouchesBounds(start, end, bounds),
          false,
          `${route.id} crosses clearance around ${componentId}`,
        );
      }
    }
  }
});

test("rotated and flipped KiCad pins retain exact transformed route endpoints", () => {
  const source = fixture("KiCad duplicate pins");
  const template = source.electrical.components[0];
  const templatePlacement = source.drawing.placements[0];
  const first = structuredClone(template);
  const second = structuredClone(template);
  first.id = "U_ROT";
  second.id = "U_FLIP";
  const selectedPinId = template.pins[0].id;
  const allPins = [
    ...first.pins.map((pin) => ({ componentId: first.id, pinId: pin.id })),
    ...second.pins.map((pin) => ({ componentId: second.id, pinId: pin.id })),
  ];
  const connected = [
    { componentId: first.id, pinId: selectedPinId },
    { componentId: second.id, pinId: selectedPinId },
  ];
  const document = {
    ...source,
    electrical: {
      components: [first, second],
      nets: [{ id: "transformed", name: "same label", members: connected }],
      noConnects: [],
      unassignedPins: allPins.filter((pin) =>
        !connected.some((member) =>
          member.componentId === pin.componentId && member.pinId === pin.pinId
        )
      ),
    },
    drawing: {
      ...source.drawing,
      placements: [
        {
          ...structuredClone(templatePlacement),
          componentId: first.id,
          position: [160, 170],
          rotation: 90,
          flip: true,
          legacyGeometry: { at: [160, 170] },
        },
        {
          ...structuredClone(templatePlacement),
          componentId: second.id,
          position: [430, 300],
          rotation: 0,
          flip: false,
          legacyGeometry: { at: [430, 300] },
        },
      ],
      routes: [],
      junctions: [],
      crossings: [],
    },
  };
  const firstPin = resolveCircuitDocumentComponentGeometry(first, document.drawing.placements[0])
    .pins.find((pin) => pin.id === selectedPinId).point;
  const secondPin = resolveCircuitDocumentComponentGeometry(second, document.drawing.placements[1])
    .pins.find((pin) => pin.id === selectedPinId).point;

  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "complete", JSON.stringify(result.diagnostics));
  const route = result.document.drawing.routes.find((entry) => entry.netId === "transformed");
  assert.ok(route);
  assert.deepEqual(
    [route.points[0], route.points.at(-1)].map(pointKey).sort(),
    [firstPin, secondPin].map(pointKey).sort(),
  );
});

test("existing routes are skipped and all prior drawing and electrical data stays intact", () => {
  const document = fixture("series LED");
  document.metadata = { revision: 7 };
  const original = structuredClone(document);
  const preservedRoute = structuredClone(document.drawing.routes[0]);

  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "complete");
  assert.ok(result.skippedNetIds.includes("supply"));
  assert.ok(result.document.drawing.routes.some((route) => route.id === preservedRoute.id));
  assert.deepEqual(result.document.drawing.routes[0], preservedRoute);
  assert.deepEqual(result.document.drawing.placements, original.drawing.placements);
  assert.deepEqual(result.document.drawing.annotations, original.drawing.annotations);
  assert.deepEqual(result.document.electrical, original.electrical);
  assert.deepEqual(document, original);
});

test("existing junction and crossing records are preserved unchanged", () => {
  const branchDocument = fixture("shared branch net");
  const crossingDocument = fixture("separate crossing nets");
  branchDocument.drawing.annotations = [{
    id: "keep-label",
    type: "label",
    at: [8, 8],
    text: "keep",
    properties: {},
  }];
  const originalBranch = structuredClone(branchDocument);
  const originalCrossing = structuredClone(crossingDocument);

  const branchResult = routeCircuitDocument(request(branchDocument));
  const crossingResult = routeCircuitDocument(request(crossingDocument));

  assert.deepEqual(branchResult.document.drawing.routes, originalBranch.drawing.routes);
  assert.deepEqual(branchResult.document.drawing.junctions, originalBranch.drawing.junctions);
  assert.deepEqual(branchResult.document.drawing.crossings, originalBranch.drawing.crossings);
  assert.deepEqual(branchResult.document.drawing.annotations, originalBranch.drawing.annotations);
  assert.deepEqual(crossingResult.document.drawing.routes, originalCrossing.drawing.routes);
  assert.deepEqual(crossingResult.document.drawing.junctions, originalCrossing.drawing.junctions);
  assert.deepEqual(crossingResult.document.drawing.crossings, originalCrossing.drawing.crossings);
});

test("no-connect and unassigned pins never produce routes", () => {
  for (const name of ["intentional no-connect", "unassigned pin"]) {
    const document = fixture(name);
    const result = routeCircuitDocument(request(document));
    assert.equal(result.status, "complete");
    assert.deepEqual(result.routedNetIds, []);
    assert.deepEqual(result.document.drawing.routes, []);
  }
});

test("missing placement blocks only that net and leaves its route tree atomic", () => {
  const document = clearRoutes(fixture("shared branch net"));
  document.drawing.placements = document.drawing.placements.filter(
    (placement) => placement.componentId !== "R2",
  );
  const original = structuredClone(document);

  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.blockedNetIds, ["branch"]);
  assert.deepEqual(result.document.drawing.routes, []);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "route-pin-placement-missing"
  ));
  assert.deepEqual(document, original);
});

test("a bounded A* exhaustion is explicit and commits no partial net", () => {
  const document = clearRoutes(fixture("far-apart same-net pins"));
  const result = routeCircuitDocument(request(document, {
    maxExpandedNodes: 1,
  }));

  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.blockedNetIds, ["same-net"]);
  assert.deepEqual(result.document.drawing.routes, []);
  assert.ok(result.diagnostics.some((entry) => entry.code === "route-search-limit"));
});

test("unresolved target geometry is reported instead of guessed", () => {
  const document = fixture("KiCad duplicate pins");
  const component = document.electrical.components[0];
  const connectedPinIds = component.pins.slice(0, 2).map((pin) => pin.id);
  document.electrical.nets = [{
    id: "unresolved",
    name: "unresolved",
    members: connectedPinIds.map((pinId) => ({ componentId: component.id, pinId })),
  }];
  document.electrical.unassignedPins = component.pins.slice(2).map((pin) => ({
    componentId: component.id,
    pinId: pin.id,
  }));
  component.properties.symbolData.units[0].graphics = [{
    type: "text",
    text: "missing anchor",
    points: [],
  }];
  clearRoutes(document);

  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "incomplete");
  assert.deepEqual(result.blockedNetIds, ["unresolved"]);
  assert.deepEqual(result.document.drawing.routes, []);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "route-pin-geometry-unknown"
  ));
});

test("a generated route marks a clean crossing with a different net without merging nets", () => {
  const document = fixture("separate crossing nets");
  const horizontal = structuredClone(
    document.drawing.routes.find((route) => route.netId === "horizontal"),
  );
  document.drawing.routes = [horizontal];
  document.drawing.junctions = [];
  document.drawing.crossings = [];

  const result = routeCircuitDocument(request(document));

  assert.equal(result.status, "complete", JSON.stringify(result.diagnostics));
  const verticalRoute = result.document.drawing.routes.find((route) =>
    route.netId === "vertical"
  );
  assert.ok(verticalRoute);
  assert.deepEqual(result.document.drawing.routes[0], horizontal);
  assert.deepEqual(result.document.electrical, document.electrical);
  assert.ok(result.document.drawing.crossings.some((crossing) =>
    crossing.routeIds.includes(horizontal.id) &&
    crossing.routeIds.includes(verticalRoute.id)
  ));
  assert.ok(result.document.drawing.junctions.every((junction) =>
    new Set(junction.routeIds.map((routeId) =>
      result.document.drawing.routes.find((route) => route.id === routeId)?.netId
    )).size === 1
  ));
  assert.equal(validateCircuitDocumentV2(result.document).isValid, true);
});

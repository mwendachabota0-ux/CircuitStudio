import assert from "node:assert/strict";
import test from "node:test";
import { layoutCircuitDocument } from "../src/index.ts";
import { validateCircuitDocumentV2 } from "../src/validation.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const fixture = (name) => {
  const entry = circuitDocumentFixtures.find((item) => item.name === name);
  assert.ok(entry, `fixture not found: ${name}`);
  return structuredClone(entry.document);
};

const request = (document, mode = "place-unplaced", hints) => ({
  document,
  mode,
  ...(hints ? { hints } : {}),
  algorithmVersion: "circuit-layout/1",
});

const byId = (placements) =>
  Object.fromEntries(
    placements
      .slice()
      .sort((left, right) => left.componentId.localeCompare(right.componentId))
      .map((placement) => [placement.componentId, placement]),
  );

const stripRoutes = (document) => {
  document.drawing.routes = [];
  document.drawing.junctions = [];
  document.drawing.crossings = [];
  return document;
};

test("place-unplaced lays out missing placements deterministically and preserves electrical data", () => {
  const document = fixture("series LED");
  document.electrical.components[0].properties.futureElectrical = {
    classification: "extension",
    values: [2, 4, 8],
  };
  const originalPlacements = document.drawing.placements.filter(
    (placement) => placement.componentId !== "R1",
  );
  const batteryPlacement = originalPlacements.find((placement) => placement.componentId === "B1");
  batteryPlacement.userPinned = false;
  document.drawing.placements = originalPlacements;
  const original = structuredClone(document);

  const first = layoutCircuitDocument(request(document));
  const second = layoutCircuitDocument(request(document));

  assert.equal(first.status, "complete");
  assert.equal(second.status, "complete");
  assert.deepEqual(byId(first.document.drawing.placements), byId(second.document.drawing.placements));
  assert.deepEqual(first.document.electrical, document.electrical);
  assert.deepEqual(first.document.drawing.routes, document.drawing.routes);
  assert.deepEqual(first.document.drawing.junctions, document.drawing.junctions);
  assert.deepEqual(first.document.drawing.crossings, document.drawing.crossings);
  assert.deepEqual(first.document.drawing.annotations, document.drawing.annotations);
  assert.deepEqual(
    byId(first.document.drawing.placements).B1,
    byId(original.drawing.placements).B1,
  );
  assert.equal(first.metrics.unplacedBefore, 1);
  assert.equal(first.metrics.bodyOverlapCount, 0);
  assert.equal(first.metrics.textCollisionCount, 0);
  assert.equal(first.metrics.canvasOverflowCount, 0);
  assert.deepEqual(first.routeImpact.affectedNetIds, ["led-feed", "switched"]);
  assert.deepEqual(first.routeImpact.affectedRouteIds, ["W2", "W3"]);
  assert.deepEqual(first.routeImpact.unroutedNetIds, ["led-feed", "switched"]);
  assert.equal(first.document.drawing.placements.find((entry) => entry.componentId === "R1").userPinned, false);
  assert.deepEqual(document, original);
});

test("reversing source arrays does not change the proposed positions", () => {
  const firstDocument = fixture("parallel branches");
  firstDocument.drawing.placements = [];
  const secondDocument = structuredClone(firstDocument);
  secondDocument.electrical.components.reverse();
  secondDocument.electrical.nets.reverse();
  secondDocument.electrical.nets.forEach((net) => net.members.reverse());

  const first = layoutCircuitDocument(request(firstDocument));
  const second = layoutCircuitDocument(request(secondDocument));

  assert.equal(first.status, "complete");
  assert.equal(second.status, "complete");
  assert.deepEqual(byId(first.document.drawing.placements), byId(second.document.drawing.placements));
});

test("reflow moves only explicitly unpinned placements and preserves legacy and pinned locks", () => {
  const document = stripRoutes(fixture("series LED"));
  document.drawing.placements = document.drawing.placements.map((placement) => {
    if (placement.componentId === "R1") {
      return {
        ...placement,
        position: [520, 390],
        legacyGeometry: {
          ...placement.legacyGeometry,
          from: [490, 390],
          to: [550, 390],
        },
        userPinned: false,
      };
    }
    if (placement.componentId === "SW1") return { ...placement, userPinned: true };
    return placement;
  });
  const originalById = byId(document.drawing.placements);
  const result = layoutCircuitDocument(request(document, "reflow"));

  assert.equal(result.status, "complete");
  const resultById = byId(result.document.drawing.placements);
  assert.deepEqual(resultById.B1, originalById.B1);
  assert.deepEqual(resultById.SW1, originalById.SW1);
  assert.deepEqual(resultById.D1, originalById.D1);
  assert.notDeepEqual(resultById.R1.position, originalById.R1.position);
  assert.equal(result.metrics.movedExisting, 1);
  assert.deepEqual(result.document.electrical, document.electrical);

  const preservePinned = layoutCircuitDocument(request(document, "preserve-pinned"));
  assert.equal(preservePinned.status, "complete");
  assert.deepEqual(byId(preservePinned.document.drawing.placements).B1, originalById.B1);
  assert.deepEqual(byId(preservePinned.document.drawing.placements).SW1, originalById.SW1);
  assert.notDeepEqual(
    byId(preservePinned.document.drawing.placements).R1.position,
    originalById.R1.position,
  );
});

test("moving routed components returns a blocked proposal instead of stale routes", () => {
  const document = fixture("series LED");
  document.drawing.placements = document.drawing.placements.map((placement) => {
    if (placement.componentId !== "R1") return { ...placement, userPinned: false };
    return {
      ...placement,
      position: [520, 390],
      legacyGeometry: {
        ...placement.legacyGeometry,
        from: [490, 390],
        to: [550, 390],
      },
      userPinned: false,
    };
  });
  const originalRoutes = structuredClone(document.drawing.routes);
  const result = layoutCircuitDocument(request(document, "reflow"));

  assert.equal(result.status, "blocked");
  assert.ok(result.diagnostics.some((entry) => entry.code === "layout-routes-stale"));
  assert.ok(result.routeImpact.requiresRerouting);
  assert.ok(result.routeImpact.affectedRouteIds.includes("W2"));
  assert.deepEqual(document.drawing.routes, originalRoutes);
});

test("reflow metrics report feedback loops and high-fanout nets", () => {
  const feedback = stripRoutes(fixture("astable flasher"));
  feedback.drawing.placements = feedback.drawing.placements.map((placement) => ({
    ...placement,
    userPinned: false,
  }));
  const feedbackResult = layoutCircuitDocument(request(feedback, "reflow"));
  assert.equal(feedbackResult.status, "complete");
  assert.ok(feedbackResult.metrics.estimatedRouteComplexity.feedbackGroups > 0);

  const fanoutResult = layoutCircuitDocument(request(fixture("shared branch net")));
  assert.equal(fanoutResult.status, "complete");
  assert.equal(fanoutResult.metrics.estimatedRouteComplexity.netsWithMoreThanTwoPins, 1);
  assert.equal(fanoutResult.metrics.estimatedRouteComplexity.excessFanout, 1);

  const sameNameNets = layoutCircuitDocument(request(fixture("duplicate display names")));
  assert.equal(sameNameNets.status, "complete");
  assert.equal(sameNameNets.metrics.connectedSubcircuitCount, 2);
});

test("unsupported KiCad text geometry is reported explicitly", () => {
  const document = fixture("KiCad duplicate pins");
  const component = document.electrical.components.find((entry) => entry.id === "U1");
  component.properties.symbolData.units[0].graphics = [
    { type: "text", text: "missing anchor", points: [] },
  ];
  document.drawing.placements = [];

  const result = layoutCircuitDocument(request(document));
  assert.equal(result.status, "blocked");
  assert.ok(result.diagnostics.some((entry) => entry.code === "layout-geometry-unsupported"));
});

test("empty, minimal, and larger valid documents have explicit outcomes", () => {
  const empty = fixture("intentional no-connect");
  empty.electrical.components = [];
  empty.electrical.nets = [];
  empty.electrical.noConnects = [];
  empty.electrical.unassignedPins = [];
  empty.drawing.placements = [];
  empty.drawing.routes = [];
  empty.drawing.junctions = [];
  empty.drawing.crossings = [];
  const emptyResult = layoutCircuitDocument(request(empty));
  assert.equal(emptyResult.status, "complete");
  assert.equal(emptyResult.metrics.componentCount, 0);

  const minimal = fixture("intentional no-connect");
  minimal.drawing.placements = [];
  const minimalResult = layoutCircuitDocument(request(minimal));
  assert.equal(minimalResult.status, "complete");
  assert.equal(minimalResult.metrics.unplacedBefore, 1);
  assert.equal(validateCircuitDocumentV2(minimalResult.document).isValid, true);

  const large = fixture("parallel branches");
  large.drawing.placements = [];
  const largeResult = layoutCircuitDocument(request(large));
  assert.equal(largeResult.status, "complete");
  assert.equal(largeResult.metrics.componentCount, 5);
  assert.equal(largeResult.metrics.bodyOverlapCount, 0);
  assert.equal(largeResult.metrics.textCollisionCount, 0);
  assert.equal(validateCircuitDocumentV2(largeResult.document).isValid, true);
});

test("impossible canvas and pinned-without-position states are blocked", () => {
  const tooSmall = fixture("series LED");
  tooSmall.drawing.placements = [];
  tooSmall.drawing.canvas = { width: 20, height: 20 };
  const canvasResult = layoutCircuitDocument(request(tooSmall));
  assert.equal(canvasResult.status, "blocked");
  assert.ok(canvasResult.diagnostics.some((entry) => entry.code === "layout-no-safe-position"));

  const pinned = fixture("series LED");
  pinned.drawing.placements = pinned.drawing.placements.filter(
    (placement) => placement.componentId !== "R1",
  );
  const pinnedResult = layoutCircuitDocument(request(pinned, "place-unplaced", {
    pinnedComponentIds: ["R1"],
  }));
  assert.equal(pinnedResult.status, "blocked");
  assert.ok(pinnedResult.diagnostics.some(
    (entry) => entry.code === "layout-unplaced-component-protected",
  ));
});

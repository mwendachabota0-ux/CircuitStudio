import assert from "node:assert/strict";
import test from "node:test";
import { CircuitDocumentV2Schema } from "../src/model.ts";
import {
  getPlacementRouteImpact,
  resolvePlacementMobility,
} from "../src/placement-policy.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const fixture = (name) =>
  circuitDocumentFixtures.find((entry) => entry.name === name).document;

function placement(userPinned) {
  return {
    componentId: "Q1",
    position: [120, 80],
    rotation: 0,
    flip: false,
    ...(userPinned === undefined ? {} : { userPinned }),
    properties: {},
  };
}

test("optional userPinned remains backward-compatible and round-trips either explicit state", () => {
  const document = structuredClone(fixture("series LED"));
  const originalPlacement = document.drawing.placements[0];
  assert.equal(CircuitDocumentV2Schema.safeParse(document).success, true);
  assert.equal(originalPlacement.userPinned, undefined);

  for (const userPinned of [true, false]) {
    const candidate = structuredClone(document);
    candidate.drawing.placements[0].userPinned = userPinned;
    const parsed = CircuitDocumentV2Schema.safeParse(candidate);
    assert.equal(parsed.success, true);
    assert.equal(parsed.data.drawing.placements[0].userPinned, userPinned);
  }
});

test("unmarked legacy placements remain protected, including during reflow", () => {
  const existing = placement(undefined);

  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "place-unplaced",
      placement: existing,
    }),
    { mobility: "protected", reason: "existing-placement" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "preserve-pinned",
      placement: existing,
    }),
    { mobility: "protected", reason: "legacy-placement" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "reflow",
      placement: existing,
    }),
    { mobility: "protected", reason: "legacy-placement" },
  );
});

test("explicit userPinned values are honored independently for each placement mode", () => {
  const pinned = placement(true);
  const unpinned = placement(false);

  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "preserve-pinned",
      placement: pinned,
    }),
    { mobility: "protected", reason: "user-pinned" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "reflow",
      placement: pinned,
    }),
    { mobility: "protected", reason: "user-pinned" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "preserve-pinned",
      placement: unpinned,
    }),
    { mobility: "movable", reason: "explicitly-unpinned" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "reflow",
      placement: unpinned,
    }),
    { mobility: "movable", reason: "explicit-reflow" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "place-unplaced",
      placement: unpinned,
    }),
    { mobility: "protected", reason: "existing-placement" },
  );
});

test("request-level pins and fixed positions override default mobility without mutation", () => {
  const existing = placement(false);
  const fixedPosition = [300, 240];
  const pinned = resolvePlacementMobility({
    componentId: "Q1",
    mode: "reflow",
    placement: existing,
    pinnedComponentIds: ["Q1"],
  });
  const fixed = resolvePlacementMobility({
    componentId: "Q1",
    mode: "reflow",
    placement: existing,
    pinnedComponentIds: ["Q1"],
    fixedPositions: { Q1: fixedPosition },
  });

  assert.deepEqual(pinned, { mobility: "protected", reason: "request-pinned" });
  assert.deepEqual(fixed, {
    mobility: "protected",
    reason: "request-fixed-position",
    fixedPosition: [300, 240],
  });
  assert.notEqual(fixed.fixedPosition, fixedPosition);
  assert.deepEqual(existing.position, [120, 80]);
  assert.throws(
    () => resolvePlacementMobility({
      componentId: "Q1",
      mode: "reflow",
      placement: existing,
      fixedPositions: { Q1: [Number.NaN, 240] },
    }),
    /two finite coordinates/,
  );
});

test("unplaced components are eligible unless the request explicitly fixes them", () => {
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "preserve-pinned",
    }),
    { mobility: "movable", reason: "unplaced" },
  );
  assert.deepEqual(
    resolvePlacementMobility({
      componentId: "Q1",
      mode: "place-unplaced",
      fixedPositions: { Q1: [10, 20] },
    }),
    {
      mobility: "protected",
      reason: "request-fixed-position",
      fixedPosition: [10, 20],
    },
  );
});

test("route impact is deterministic and reports all routes on affected nets without mutation", () => {
  const document = structuredClone(fixture("series LED"));
  const before = structuredClone(document);

  const impact = getPlacementRouteImpact(document, ["R1", "R1"]);

  assert.deepEqual(impact, {
    movedComponentIds: ["R1"],
    affectedNetIds: ["led-feed", "switched"],
    affectedRouteIds: ["W2", "W3"],
    unroutedNetIds: [],
    requiresRerouting: true,
  });
  assert.deepEqual(document, before);
});

test("route impact identifies affected multi-pin nets without inventing route edits", () => {
  const document = structuredClone(fixture("series LED"));
  document.drawing.routes = document.drawing.routes.filter(
    (route) => route.netId !== "led-feed",
  );
  const before = structuredClone(document);

  const impact = getPlacementRouteImpact(document, ["R1"]);

  assert.deepEqual(impact.affectedNetIds, ["led-feed", "switched"]);
  assert.deepEqual(impact.affectedRouteIds, ["W2"]);
  assert.deepEqual(impact.unroutedNetIds, ["led-feed"]);
  assert.equal(impact.requiresRerouting, true);
  assert.deepEqual(document, before);
});

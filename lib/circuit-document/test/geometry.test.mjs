import assert from "node:assert/strict";
import test from "node:test";
import {
  createCircuitGeometryElement,
  getPlacementGeometryPropertyConflicts,
  resolveCircuitDocumentComponentGeometry,
} from "../src/geometry.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const fixture = (name) =>
  circuitDocumentFixtures.find((entry) => entry.name === name).document;

function componentAndPlacement(document, componentId) {
  return {
    component: document.electrical.components.find((entry) => entry.id === componentId),
    placement: document.drawing.placements.find((entry) => entry.componentId === componentId),
  };
}

test("V2 geometry uses placement-owned text settings without shadowing component geometry", () => {
  const document = structuredClone(fixture("series LED"));
  const { component, placement } = componentAndPlacement(document, "R1");
  component.reference = "R1";
  placement.properties = {
    labelPos: "below",
    labelNudge: [3, 4],
  };

  const source = createCircuitGeometryElement(component, placement);
  const geometry = resolveCircuitDocumentComponentGeometry(component, placement);

  assert.equal(source.labelPos, "below");
  assert.deepEqual(source.labelNudge, [3, 4]);
  assert.equal(geometry.status, "resolved");
  assert.deepEqual(geometry.pins.map(({ point }) => point), [[210, 100], [270, 100]]);
  assert.deepEqual(
    geometry.textBounds.map(({ role, bounds }) => ({ role, y0: bounds.y0 })),
    [
      { role: "reference", y0: 120 },
      { role: "value", y0: 138 },
    ],
  );
  assert.deepEqual(getPlacementGeometryPropertyConflicts(component, placement), []);
});

test("placement label anchors are resolved from placement properties", () => {
  const document = structuredClone(fixture("series LED"));
  const { component, placement } = componentAndPlacement(document, "R1");
  component.reference = "R1";
  placement.properties = {
    labelAt: [400, 300],
    labelAnchor: "end",
    labelNudge: [100, 100],
  };

  const geometry = resolveCircuitDocumentComponentGeometry(component, placement);

  assert.equal(geometry.status, "resolved");
  const reference = geometry.textBounds.find((entry) => entry.role === "reference");
  assert.equal(reference.bounds.x1, 400);
  assert.equal(reference.bounds.y0, 286);
});

test("V2 resolver keeps explicit placement geometry authoritative over shadow properties", () => {
  const document = structuredClone(fixture("series LED"));
  const { component, placement } = componentAndPlacement(document, "R1");
  placement.properties = { from: [1, 2], to: [3, 4] };

  assert.deepEqual(
    getPlacementGeometryPropertyConflicts(component, placement),
    ["from", "to"],
  );
  const geometry = resolveCircuitDocumentComponentGeometry(component, placement);

  assert.equal(geometry.status, "resolved");
  assert.deepEqual(geometry.pins.map(({ point }) => point), [[210, 100], [270, 100]]);
});

test("missing selected KiCad geometry is reported as unsupported, not an empty bound", () => {
  const document = structuredClone(fixture("KiCad duplicate pins"));
  const { component, placement } = componentAndPlacement(document, "U1");
  delete component.properties.symbolData;

  const geometry = resolveCircuitDocumentComponentGeometry(component, placement);

  assert.equal(geometry.status, "unsupported");
  assert.equal(geometry.code, "pin-geometry-unavailable");
});

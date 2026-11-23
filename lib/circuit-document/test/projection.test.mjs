import assert from "node:assert/strict";
import { test } from "node:test";
import {
  importLegacyCircuitSpec,
  projectCircuitDocumentToLegacy,
} from "../src/legacy.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";
import { legacyCircuitTools, readLegacyFixture } from "./support.mjs";

function importFixture(filename) {
  const result = importLegacyCircuitSpec(readLegacyFixture(filename), legacyCircuitTools);
  assert.equal(result.trusted, true, `${filename} should import before projection`);
  return result.document;
}

function topologySignature(document) {
  const membership = document.electrical.nets.map((net) =>
    net.members.map((member) => `${member.componentId}.${member.pinId}`).sort().join(",")
  ).sort();
  const routes = document.electrical.nets.map((net) => {
    const routeIds = document.drawing.routes
      .filter((route) => route.netId === net.id)
      .map((route) => route.id)
      .sort();
    const members = net.members
      .map((member) => `${member.componentId}.${member.pinId}`)
      .sort()
      .join(",");
    return `${members}|${routeIds.join(",")}`;
  }).sort();
  return JSON.stringify({ membership, routes });
}

function pinNet(document, componentId, pinId) {
  return document.electrical.nets.find((net) =>
    net.members.some((member) =>
      member.componentId === componentId && member.pinId === pinId
    )
  );
}

for (const filename of [
  "series-led.json",
  "parallel-led-branches.json",
  "non-connecting-crossing.json",
]) {
  test(`legacy → v2 → legacy projection preserves ${filename} topology`, () => {
    const original = importFixture(filename);
    const projection = projectCircuitDocumentToLegacy(original, legacyCircuitTools);

    assert.equal(projection.status, "representable");
    assert.ok(projection.spec);
    const reimported = importLegacyCircuitSpec(projection.spec, legacyCircuitTools);
    assert.equal(reimported.trusted, true);
    assert.equal(topologySignature(reimported.document), topologySignature(original));
  });
}

test("projection preserves route points, component geometry, symbols, and visual markers", () => {
  const original = importFixture("parallel-led-branches.json");
  const projection = projectCircuitDocumentToLegacy(original, legacyCircuitTools);

  assert.equal(projection.status, "representable");
  assert.deepEqual(
    projection.spec.elements
      .filter((element) => element.type === "wire")
      .map((element) => ({ id: element.id, points: element.points })),
    original.drawing.routes.map((route) => ({ id: route.id, points: route.points })),
  );
  assert.equal(
    projection.spec.elements.filter((element) => element.type === "junction").length,
    original.drawing.junctions.length,
  );
});

test("crossing annotations remain visual-only and separate nets stay separate", () => {
  const original = importFixture("non-connecting-crossing.json");
  const projection = projectCircuitDocumentToLegacy(original, legacyCircuitTools);
  const crossing = projection.spec.elements.find((element) => element.type === "crossing");
  const reimported = importLegacyCircuitSpec(projection.spec, legacyCircuitTools);

  assert.equal(projection.status, "representable");
  assert.deepEqual(crossing.at, original.drawing.crossings[0].at);
  assert.equal(pinNet(reimported.document, "B_HL", "+").id === pinNet(reimported.document, "B_VT", "+").id, false);
});

test("v2 topology without a complete visual route is not projected as a misleading drawing", () => {
  const document = circuitDocumentFixtures.find((entry) =>
    entry.name === "far-apart same-net pins"
  ).document;
  const projection = projectCircuitDocumentToLegacy(document, legacyCircuitTools);

  assert.equal(projection.status, "not-representable");
  assert.ok(projection.diagnostics.some((entry) => entry.code === "projection-layout-incomplete"));
  assert.equal(projection.spec, undefined);
});

test("projection rejects explicit no-connect and unassigned states", () => {
  const document = circuitDocumentFixtures.find((entry) =>
    entry.name === "intentional no-connect"
  ).document;
  const projection = projectCircuitDocumentToLegacy(document, legacyCircuitTools);

  assert.equal(projection.status, "not-representable");
  assert.ok(projection.diagnostics.some((entry) => entry.code === "projection-no-connect-unsupported"));
  assert.ok(projection.diagnostics.some((entry) => entry.code === "projection-unassigned-pin-unsupported"));
});

test("projection rejects separate v2 ground nets that legacy CircuitDraw would merge", () => {
  const document = circuitDocumentFixtures.find((entry) =>
    entry.name === "separate ground nets"
  ).document;
  const projection = projectCircuitDocumentToLegacy(document, legacyCircuitTools);

  assert.equal(projection.status, "not-representable");
  assert.ok(projection.diagnostics.some(
    (entry) => entry.code === "projection-ground-semantics-unsupported",
  ));
});

test("malformed legacy projections never return a spec", () => {
  const document = circuitDocumentFixtures.find((entry) =>
    entry.name === "conflicting visual junction"
  ).document;
  const projection = projectCircuitDocumentToLegacy(document, legacyCircuitTools);

  assert.equal(projection.status, "not-representable");
  assert.ok(projection.diagnostics.some((entry) =>
    entry.severity === "error" && entry.code === "junction-crosses-nets"
  ));
  assert.equal(projection.spec, undefined);
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { importLegacyCircuitSpec } from "../src/legacy.ts";
import { ambiguousLegacyFixture } from "./fixtures/v2-fixtures.mjs";
import { CircuitDraw, legacyCircuitTools, readLegacyFixture } from "./support.mjs";

const pin = (componentId, pinId) => ({ componentId, pinId });

function sameNet(document, first, second) {
  return document.electrical.nets.some((net) =>
    net.members.some((member) =>
      member.componentId === first.componentId && member.pinId === first.pinId
    ) &&
    net.members.some((member) =>
      member.componentId === second.componentId && member.pinId === second.pinId
    )
  );
}

function netFor(document, reference) {
  return document.electrical.nets.find((net) =>
    net.members.some((member) =>
      member.componentId === reference.componentId && member.pinId === reference.pinId
    )
  );
}

function importFixture(filename) {
  return importLegacyCircuitSpec(readLegacyFixture(filename), legacyCircuitTools);
}

test("imports the series LED through CircuitDraw's exact legacy netlist", () => {
  const original = readLegacyFixture("series-led.json");
  const snapshot = structuredClone(original);
  const result = importLegacyCircuitSpec(original, legacyCircuitTools, { documentId: "imported-series" });

  assert.equal(result.trusted, true);
  assert.equal(result.document.id, "imported-series");
  assert.equal(result.document.schemaVersion, 2);
  assert.equal(sameNet(result.document, pin("B1", "+"), pin("SW1", "1")), true);
  assert.equal(sameNet(result.document, pin("R1", "2"), pin("D1", "A")), true);
  assert.deepEqual(original, snapshot);
  assert.equal(result.document.drawing.routes.length, 4);
  assert.ok(result.diagnostics.some((entry) => entry.code === "legacy-ground-globally-merged"));
});

test("imports parallel branches and preserves explicit single-net junctions", () => {
  const result = importFixture("parallel-led-branches.json");

  assert.equal(result.trusted, true);
  assert.equal(sameNet(result.document, pin("B1", "+"), pin("R1", "1")), true);
  assert.equal(sameNet(result.document, pin("R1", "1"), pin("R2", "1")), true);
  assert.ok(result.document.drawing.junctions.length >= 4);
  assert.ok(result.document.drawing.junctions.every((junction) => junction.routeIds.length >= 2));
});

test("imports a single-transistor switch with stable BJT pins", () => {
  const result = importFixture("single-transistor-switch.json");

  assert.equal(result.trusted, true);
  assert.equal(sameNet(result.document, pin("R_INPUT", "2"), pin("Q1", "B")), true);
  assert.equal(sameNet(result.document, pin("Q1", "E"), pin("R_PULLDOWN", "2")), true);
  assert.equal(sameNet(result.document, pin("Q1", "B"), pin("Q1", "C")), false);
});

test("imports an astable flasher without joining its transistor bases", () => {
  const original = readLegacyFixture("astable-flasher.json");
  const spec = CircuitDraw.autoFix(original).spec;
  const result = importLegacyCircuitSpec(spec, legacyCircuitTools);

  assert.equal(result.trusted, true);
  assert.equal(sameNet(result.document, pin("Q1", "B"), pin("Q2", "B")), false);
  assert.ok(result.document.electrical.nets.some((net) =>
    net.members.some((member) => member.componentId === "Q1" && member.pinId === "B")
  ));
});

test("imports crossing routes without merging their separate nets", () => {
  const result = importFixture("non-connecting-crossing.json");

  assert.equal(result.trusted, true);
  assert.equal(sameNet(result.document, pin("B_HL", "+"), pin("B_HR", "+")), true);
  assert.equal(sameNet(result.document, pin("B_VT", "+"), pin("B_VB", "+")), true);
  assert.equal(sameNet(result.document, pin("B_HL", "+"), pin("B_VT", "+")), false);
  assert.equal(result.document.drawing.crossings[0].routeIds.length, 2);
});

test("legacy ground symbols retain CircuitDraw's global-ground behavior", () => {
  const spec = {
    title: "Two legacy ground symbols",
    elements: [
      { type: "ground", id: "GND_A", at: [100, 100] },
      { type: "ground", id: "GND_D", at: [300, 100] },
      { type: "led", id: "D1", from: [100, 100], to: [140, 100] },
      { type: "led", id: "D2", from: [300, 100], to: [340, 100] },
      { type: "wire", id: "W_D1", points: [[140, 100], [180, 100]], open: true },
      { type: "wire", id: "W_D2", points: [[340, 100], [380, 100]], open: true },
    ],
  };
  const result = importLegacyCircuitSpec(spec, legacyCircuitTools);
  const firstGroundNet = netFor(result.document, pin("GND_A", "at"));

  assert.equal(result.trusted, true);
  assert.ok(firstGroundNet);
  assert.equal(firstGroundNet.name, "GND");
  assert.ok(firstGroundNet.members.some((member) => member.componentId === "GND_D"));
  assert.ok(firstGroundNet.members.some((member) => member.componentId === "D1" && member.pinId === "A"));
  assert.ok(firstGroundNet.members.some((member) => member.componentId === "D2" && member.pinId === "A"));
  assert.equal(result.document.legacyImport.groundSemantics, "global-ground");
});

test("repeated legacy terminal labels do not merge different coordinate nets", () => {
  const spec = {
    title: "Repeated but disconnected terminal labels",
    elements: [
      { type: "terminal", id: "T1", label: "SIGNAL", at: [100, 100] },
      { type: "resistor", id: "R1", from: [100, 100], to: [160, 100] },
      { type: "terminal", id: "T2", label: "SIGNAL", at: [300, 100] },
      { type: "resistor", id: "R2", from: [300, 100], to: [360, 100] },
      { type: "wire", id: "W_R1", points: [[160, 100], [200, 100]], open: true },
      { type: "wire", id: "W_R2", points: [[360, 100], [400, 100]], open: true },
    ],
  };
  const result = importLegacyCircuitSpec(spec, legacyCircuitTools);

  assert.equal(result.trusted, true);
  assert.equal(sameNet(result.document, pin("T1", "at"), pin("R1", "1")), true);
  assert.equal(sameNet(result.document, pin("T2", "at"), pin("R2", "1")), true);
  assert.equal(sameNet(result.document, pin("T1", "at"), pin("T2", "at")), false);
  assert.equal(result.document.legacyImport.terminalLabelSemantics, "local-labels-do-not-merge");
});

test("keeps legacy dcsource distinct from battery", () => {
  const result = importFixture("legacy-fm-transmitter-dcsource.json");
  const source = result.document?.electrical.components.find((component) => component.id === "V1");

  assert.equal(result.trusted, true);
  assert.equal(source.type, "dcsource");
  assert.deepEqual(source.pins.map((pin) => pin.id), ["+", "-"]);
});

test("imports verified KiCad unit pin identities from source symbol data", () => {
  const symbolData = {
    id: "Test:TwoPin",
    units: [{
      unit: 1,
      bodyStyle: 1,
      pins: [
        { number: "1", name: "IN", electricalType: "input", shape: "line", point: [-30, 0], bodyPoint: [-12, 0], showName: true, showNumber: true },
        { number: "2", name: "OUT", electricalType: "output", shape: "line", point: [30, 0], bodyPoint: [12, 0], showName: true, showNumber: true },
      ],
      graphics: [],
    }],
  };
  const spec = {
    title: "KiCad pin identities",
    elements: [{
      type: "kicad",
      id: "U1",
      label: "U1",
      value: "Test device",
      symbolId: "Test:TwoPin",
      at: [300, 180],
      unit: 1,
      bodyStyle: 1,
      symbolData,
    }],
  };
  const result = importLegacyCircuitSpec(spec, legacyCircuitTools);
  const component = result.document?.electrical.components.find((entry) => entry.id === "U1");

  assert.equal(result.trusted, true);
  assert.deepEqual(component.pins.map((pin) => pin.id), [
    "kicad:u1:b1:1:IN:0",
    "kicad:u1:b1:2:OUT:0",
  ]);
  assert.equal(component.properties.symbolData.id, "Test:TwoPin");
  assert.equal(result.document.drawing.placements[0].position[0], 300);
});

test("unresolved KiCad pins block conversion without modifying the original", () => {
  const original = structuredClone(ambiguousLegacyFixture.spec);
  const result = importLegacyCircuitSpec(original, legacyCircuitTools);

  assert.equal(result.status, "blocked");
  assert.equal(result.trusted, false);
  assert.equal(result.document, undefined);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "legacy-geometry-invalid" &&
    entry.message.includes("exact KiCad drawing and pin data")
  ));
  assert.deepEqual(result.original, original);
});

test("malformed junction geometry blocks trusted conversion", () => {
  const spec = {
    title: "Junction away from every route",
    elements: [
      { type: "battery", id: "B1", from: [100, 100], to: [100, 140] },
      { type: "wire", id: "W1", points: [[100, 100], [200, 100]], open: true },
      { type: "wire", id: "W2", points: [[100, 140], [200, 140]], open: true },
      { type: "led", id: "D1", from: [200, 100], to: [240, 100] },
      { type: "wire", id: "W3", points: [[240, 100], [280, 100]], open: true },
      { type: "junction", id: "J_BAD", x: 300, y: 300 },
    ],
  };
  const result = importLegacyCircuitSpec(spec, legacyCircuitTools);

  assert.equal(result.status, "blocked");
  assert.equal(result.trusted, false);
  assert.ok(result.diagnostics.some((entry) =>
    entry.code === "junction-route-not-at-point" ||
    entry.code === "junction-under-specified"
  ));
});

test("missing exact legacy membership is blocked rather than inferred", () => {
  const spec = readLegacyFixture("series-led.json");
  const toolsWithoutMembership = {
    validate: legacyCircuitTools.validate,
    netlistWithMembership: () => ({ parts: [], nets: [] }),
  };
  const result = importLegacyCircuitSpec(spec, toolsWithoutMembership);

  assert.equal(result.status, "blocked");
  assert.equal(result.trusted, false);
  assert.ok(result.diagnostics.some((entry) => entry.code === "legacy-membership-missing"));
});

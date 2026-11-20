import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import * as CircuitGeometry from "../../../../lib/circuit-geometry/src/index.ts";

const moduleStub = { exports: {} };
const source = readFileSync(new URL("../../public/circuit-draw.js", import.meta.url), "utf8");
runInNewContext(source, { module: moduleStub, CircuitGeometry });
const CircuitDraw = moduleStub.exports;
const astableFlasher = JSON.parse(readFileSync(new URL("./fixtures/astable-flasher.json", import.meta.url), "utf8"));

const minimumLengths = {
  resistor: 50,
  capacitor: 12,
  electrolytic: 12,
  inductor: 64,
  diode: 20,
  zener: 20,
  led: 20,
  battery: 10,
  switch: 36,
  mic: 36,
  speaker: 24,
  lamp: 28,
  acsource: 32,
  crystal: 18,
};

test("each two-terminal symbol at minimum plus 10px has no structural warnings", () => {
  for (const [type, minimum] of Object.entries(minimumLengths)) {
    const length = minimum + 10;
    const left = [100, 100];
    const right = [100 + length, 100];
    const report = CircuitDraw.validate({
      title: `${type} spacing check`,
      elements: [
        { type, id: `${type}1`, from: left, to: right },
        { type: "wire", id: "W1", open: true, points: [left, [80, 100]] },
        { type: "wire", id: "W2", open: true, points: [right, [right[0] + 20, 100]] },
      ],
    });

    assert.deepEqual(Array.from(report.errors), [], `${type} should have no errors`);
    assert.deepEqual(Array.from(report.warnings), [], `${type} should have no warnings`);
  }
});

test("canonical pin definitions are shared by generation, validation, and rendering", () => {
  assert.deepEqual(
    CircuitGeometry.getCircuitPins({ type: "npn", at: [100, 200], flip: true }),
    [
      { name: "B", point: [125, 200] },
      { name: "C", point: [75, 156] },
      { name: "E", point: [75, 244] },
    ],
  );
  assert.match(CircuitGeometry.formatCircuitPinGuide(), /NPN: B=\(x−25, y\), C=\(x\+25, y−44\), E=\(x\+25, y\+44\)/);
  assert.match(CircuitDraw.render(astableFlasher), /<svg/);
});

test("the valid astable flasher passes after safe rail-tail cleanup", () => {
  const before = CircuitDraw.validate(astableFlasher);
  assert.equal(before.errors.length, 0);
  assert.equal(before.warnings.length, 2);

  const repaired = CircuitDraw.autoFix(astableFlasher);
  assert.equal(repaired.changes.length, 2);
  assert.deepEqual(Array.from(repaired.spec.elements.find((element) => element.id === "W_RAIL_TOP").points[1]), [530, 50]);
  assert.deepEqual(Array.from(repaired.spec.elements.find((element) => element.id === "W_RAIL_BOTTOM").points[1]), [480, 440]);
  const after = CircuitDraw.validate(repaired.spec);
  assert.deepEqual(Array.from(after.errors), []);
  assert.deepEqual(Array.from(after.warnings), []);
});

test("astable feedback capacitors connected to their own transistor are rejected", () => {
  const invalid = structuredClone(astableFlasher);
  invalid.elements.find((element) => element.id === "W_C1_OPPOSITE_BASE").points = [
    [250, 280],
    [150, 280],
    [150, 250],
  ];
  invalid.elements.find((element) => element.id === "W_C2_OPPOSITE_BASE").points = [
    [430, 260],
    [530, 260],
    [530, 250],
  ];

  const report = CircuitDraw.validate(CircuitDraw.autoFix(invalid).spec);
  assert.ok(report.errors.some((error) => error.includes('Capacitor "C1" connects Q1.C back to Q1.B')));
  assert.ok(report.errors.some((error) => error.includes('Capacitor "C2" connects Q2.C back to Q2.B')));
});

test("auto-fix snaps only a uniquely nearest pin within eight pixels", () => {
  const slightlyOff = structuredClone(astableFlasher);
  slightlyOff.elements.find((element) => element.id === "W_LED1_COLLECTOR").points[2] = [203, 206];
  const snapped = CircuitDraw.autoFix(slightlyOff);
  assert.ok(snapped.changes.some((change) => change.includes("Snapped a wire endpoint")));
  assert.deepEqual(
    Array.from(snapped.spec.elements.find((element) => element.id === "W_LED1_COLLECTOR").points[2]),
    [200, 206],
  );

  const ambiguous = {
    title: "Ambiguous pin snap",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "resistor", id: "R2", from: [100, 110], to: [200, 110] },
      { type: "wire", id: "W1", points: [[100, 105], [100, 200]] },
    ],
  };
  const unchanged = CircuitDraw.autoFix(ambiguous);
  assert.deepEqual(Array.from(unchanged.changes), []);
  assert.deepEqual(Array.from(unchanged.spec.elements[2].points[0]), [100, 105]);
});

test("disconnected wire warnings identify the nearest pin and distance", () => {
  const report = CircuitDraw.validate({
    title: "Nearest pin details",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "wire", id: "W1", points: [[104, 100], [104, 150]] },
    ],
  });
  assert.ok(
    report.warnings.some((warning) =>
      warning.includes('W1') &&
      warning.includes('resistor "R1".1 at (100,100)') &&
      warning.includes('4 px away'),
    ),
  );
});

test("astable validation requires a resistor from each base to the positive supply", () => {
  const missingBaseFeeds = structuredClone(astableFlasher);
  missingBaseFeeds.elements = missingBaseFeeds.elements.filter(
    (element) => element.id !== "W_R3_BASE" && element.id !== "W_R4_BASE",
  );
  const report = CircuitDraw.validate(CircuitDraw.autoFix(missingBaseFeeds).spec);
  assert.ok(report.errors.some((error) => error.includes("Q1.B needs its own resistor to the positive supply")));
  assert.ok(report.errors.some((error) => error.includes("Q2.B needs its own resistor to the positive supply")));
});

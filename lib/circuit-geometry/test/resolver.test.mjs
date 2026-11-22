import assert from "node:assert/strict";
import test from "node:test";
import {
  getCircuitPinIdentities,
  getCircuitPins,
  resolveCircuitComponentGeometry,
  transformKicadPoint,
} from "../src/index.ts";

test("resolves two-terminal anchors and bounds from preserved endpoints", () => {
  const element = {
    type: "resistor",
    from: [10, 20],
    to: [110, 20],
    label: "R1",
    value: "1 kΩ",
    labelAt: [140, 18],
    labelAnchor: "start",
  };
  const resolved = resolveCircuitComponentGeometry(element);

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(
    resolved.pins.map(({ id, point }) => ({ id, point })),
    [
      { id: "1", point: [10, 20] },
      { id: "2", point: [110, 20] },
    ],
  );
  assert.deepEqual(resolved.bodyBounds, { x0: 35, y0: 10, x1: 85, y1: 30 });
  assert.deepEqual(
    resolved.textBounds.map(({ role }) => role),
    ["reference", "value"],
  );
  assert.deepEqual(resolved.transform, {
    origin: [10, 20],
    rotation: 0,
    flipX: false,
  });
  assert.equal(resolved.textBounds[0].confidence, "render-aligned");
  assert.equal(resolved.textBounds[0].bounds.x0, 140);
  assert.equal(resolved.textBounds[1].bounds.y0, 22);
});

test("resolves built-in flip and swap through canonical pin anchors", () => {
  const transistor = resolveCircuitComponentGeometry({
    type: "npn",
    at: [100, 200],
    flip: true,
  });
  const amplifier = resolveCircuitComponentGeometry({
    type: "opamp",
    at: [50, 60],
    swap: true,
  });

  assert.equal(transistor.status, "resolved");
  assert.deepEqual(
    transistor.pins.map(({ id, point }) => [id, point]),
    [
      ["B", [125, 200]],
      ["C", [75, 156]],
      ["E", [75, 244]],
    ],
  );
  assert.deepEqual(transistor.transform, {
    origin: [100, 200],
    rotation: 0,
    flipX: true,
  });
  assert.equal(amplifier.status, "resolved");
  assert.deepEqual(
    amplifier.pins.map(({ id, point }) => [id, point]),
    [
      ["INV", [10, 80]],
      ["NONINV", [10, 40]],
      ["OUT", [90, 60]],
    ],
  );
});

test("transistor body bounds include the unframed collector and emitter artwork", () => {
  const resolved = resolveCircuitComponentGeometry({
    type: "npn",
    at: [100, 200],
    circle: false,
  });

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.bodyBounds, {
    x0: 75,
    y0: 156,
    x1: 125,
    y1: 244,
  });
});

test("matches multi-line default label placement above two-terminal symbols", () => {
  const resolved = resolveCircuitComponentGeometry({
    type: "resistor",
    from: [0, 0],
    to: [100, 0],
    label: "R1",
    value: "10 kΩ",
  });

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(
    resolved.textBounds.map(({ role, bounds }) => ({ role, y0: bounds.y0 })),
    [
      { role: "reference", y0: -48 },
      { role: "value", y0: -30 },
    ],
  );
});

test("conservatively covers terminal labels whose side depends on connected wire direction", () => {
  const resolved = resolveCircuitComponentGeometry({
    type: "terminal",
    at: [20, 30],
    label: "PWR",
  });

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.textBounds[0].bounds, {
    x0: 20 - 10 - "PWR".length * 14 * 0.62,
    y0: 6,
    x1: 20 + 10 + "PWR".length * 14 * 0.62,
    y1: 50,
  });
  assert.equal(resolved.textBounds[0].confidence, "conservative-estimate");
});

test("resolves visible named pin labels for IC and connector blocks", () => {
  const resolved = resolveCircuitComponentGeometry({
    type: "ic",
    at: [100, 100],
    label: "U1",
    value: "Logic",
    pins: [
      { name: "A", side: "left" },
      { name: "B", side: "left" },
      { name: "Y", side: "right" },
    ],
  });

  assert.equal(resolved.status, "resolved");
  assert.deepEqual(
    resolved.textBounds
      .filter(({ role }) => role === "pin-name")
      .map(({ text, bounds }) => [text, bounds.x0, bounds.y0]),
    [
      ["A", 100 - 48 - "A".length * 9 * 0.56, 100 - 12 + 3 - 9],
      ["B", 100 - 48 - "B".length * 9 * 0.56, 100 + 12 + 3 - 9],
      ["Y", 100 + 48, 100 + 3 - 9],
    ],
  );
});

test("preserves duplicate KiCad pin identities and shares transformed geometry", () => {
  const element = {
    type: "kicad",
    symbolId: "Local:Test",
    at: [100, 50],
    rotation: 90,
    flip: true,
    unit: 1,
    bodyStyle: 1,
    label: "U1",
    value: "Test symbol",
    symbolData: {
      id: "Local:Test",
      units: [{
        unit: 1,
        bodyStyle: 1,
        pins: [
          {
            number: "1",
            name: "A",
            electricalType: "input",
            shape: "line",
            point: [20, 10],
            bodyPoint: [0, 0],
            showName: true,
            showNumber: true,
          },
          {
            number: "1",
            name: "A",
            electricalType: "input",
            shape: "line",
            point: [-20, 10],
            bodyPoint: [0, 0],
            showName: true,
            showNumber: true,
          },
        ],
        graphics: [
          {
            type: "rectangle",
            points: [[-12, -8], [12, 8]],
            strokeWidth: 2,
          },
          { type: "circle", points: [[0, 0]], radius: 3 },
          { type: "arc", points: [[0, 20], [20, 40], [40, 20]] },
          { type: "bezier", points: [[-5, 0], [0, 15], [5, 15], [10, 0]] },
          { type: "text", points: [[0, -12]], text: "CORE", fontSize: 10 },
        ],
      }],
    },
  };

  const resolved = resolveCircuitComponentGeometry(element);
  assert.equal(resolved.status, "resolved");
  assert.deepEqual(resolved.transform, {
    origin: [100, 50],
    rotation: 90,
    flipX: true,
    unit: 1,
    bodyStyle: 1,
  });
  assert.deepEqual(
    resolved.pins.map(({ id }) => id),
    [
      "kicad:u1:b1:1:A:0",
      "kicad:u1:b1:1:A:1",
    ],
  );
  assert.deepEqual(
    resolved.pins.map(({ point }) => point),
    getCircuitPins(element).map(({ point }) => point),
  );
  assert.deepEqual(transformKicadPoint([20, 10], [100, 50], 90, true), [90, 30]);
  assert.ok(resolved.bodyBounds.x0 < 80);
  assert.ok(resolved.bodyBounds.x1 > 110);
  assert.ok(resolved.textBounds.some(({ role, text }) => role === "symbol-text" && text === "CORE"));
  assert.ok(resolved.textBounds.some(({ role }) => role === "pin-name"));
  assert.ok(resolved.textBounds.some(({ role }) => role === "pin-number"));
  const firstName = resolved.textBounds.find(({ role, text }) => role === "pin-name" && text === "A");
  const firstNumber = resolved.textBounds.find(({ role, text }) => role === "pin-number" && text === "1");
  assert.ok(Math.abs(firstName.bounds.x1 - (100 - (10 / Math.sqrt(500)) * 5)) < 0.001);
  assert.ok(Math.abs(firstNumber.bounds.x0 - (90 + (10 / Math.sqrt(500)) * 8)) < 0.001);
  assert.deepEqual(getCircuitPinIdentities(element).map(({ id }) => id), resolved.pins.map(({ id }) => id));
});

test("uses unmarked KiCad geometry as an explicit unsupported result", () => {
  const resolved = resolveCircuitComponentGeometry({
    type: "kicad",
    symbolId: "Missing:Symbol",
    at: [20, 20],
  });

  assert.deepEqual(
    { status: resolved.status, code: resolved.code },
    { status: "unsupported", code: "pin-geometry-unavailable" },
  );
  assert.match(resolved.message, /pin identities or transformed pin anchors/);
});

test("does not mutate input and rejects unresolvable text geometry", () => {
  const element = {
    type: "ground",
    at: [5, 10],
    label: "GND",
    labelAt: "not-a-point",
  };
  const before = structuredClone(element);
  const resolved = resolveCircuitComponentGeometry(element);

  assert.deepEqual(element, before);
  assert.deepEqual(
    { status: resolved.status, code: resolved.code },
    { status: "unsupported", code: "text-geometry-unavailable" },
  );
});

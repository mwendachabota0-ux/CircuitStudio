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

function connectivitySignature(spec) {
  const membership = CircuitDraw.netlistWithMembership(spec, true);
  const groups = new Map();
  for (const pin of membership.pinMembership) {
    const members = groups.get(pin.netKey) ?? [];
    members.push(`P:${pin.elementIndex}:${pin.pinIndex}:${pin.connected ? 1 : 0}`);
    groups.set(pin.netKey, members);
  }
  for (const wire of membership.routeMembership) {
    const members = groups.get(wire.netKey) ?? [];
    members.push(`W:${wire.elementIndex}`);
    groups.set(wire.netKey, members);
  }
  return JSON.stringify(
    [...groups.values()]
      .map((members) => members.sort())
      .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))),
  );
}

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
  assert.match(CircuitDraw.render(CircuitDraw.autoFix(astableFlasher).spec), /<svg/);
});

test("layout analysis detects overlapping Studio labels", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Label overlap",
    elements: [
      { type: "label", id: "Label1", text: "Power input", at: [100, 100] },
      { type: "label", id: "Label2", text: "Main supply", at: [112, 100] },
    ],
  });

  assert.ok(warnings.some((warning) => warning.includes("overlaps text")));
});

test("layout analysis detects wires that cross readable text", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Wire through text",
    elements: [
      { type: "label", id: "Label1", text: "Power", at: [100, 100] },
      {
        type: "wire",
        id: "W1",
        open: true,
        points: [[80, 90], [180, 90]],
      },
    ],
  });

  assert.ok(warnings.some((warning) => warning.includes("crosses text")));
});

test("layout analysis allows separated labels and clear wire routes", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Clear layout",
    elements: [
      { type: "label", id: "Label1", text: "Power", at: [100, 100] },
      { type: "label", id: "Label2", text: "Output", at: [250, 100] },
      {
        type: "wire",
        id: "W1",
        open: true,
        points: [[80, 130], [280, 130]],
      },
    ],
  });

  assert.deepEqual(Array.from(warnings), []);
});

test("layout analysis detects overlapping component bodies", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Crowded components",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [180, 100] },
      { type: "led", id: "LED1", from: [140, 100], to: [200, 100] },
    ],
  });

  assert.ok(warnings.some((warning) => warning.includes("symbol bodies") && warning.includes("overlap")));
});

test("layout analysis detects wires crossing a component body", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Wire through component",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [180, 100] },
      { type: "wire", id: "W1", open: true, points: [[120, 100], [160, 100]] },
    ],
  });

  assert.ok(warnings.some((warning) => warning.includes("W1") && warning.includes("symbol body")));
});

test("layout analysis detects a perpendicular wire crossing a resistor body", () => {
  const spec = {
    title: "Wire through resistor",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [180, 100] },
      { type: "wire", id: "W1", open: true, points: [[140, 80], [140, 120]] },
    ],
  };

  const warnings = CircuitDraw.layoutWarnings(spec);
  assert.ok(
    warnings.some((warning) =>
      warning.includes('wire "W1"') &&
      warning.includes('symbol body for resistor "R1"'),
    ),
  );
});

test("layout analysis does not flag a lead wire ending before a component body", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Clear lead",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [180, 100] },
      { type: "wire", id: "W1", open: true, points: [[80, 100], [100, 100]] },
    ],
  });

  assert.deepEqual(Array.from(warnings), []);
});

test("layout analysis treats a wire ending at a component pin as a connection", () => {
  const warnings = CircuitDraw.layoutWarnings({
    title: "Connected transistor pin",
    elements: [
      { type: "npn", id: "Q1", at: [100, 100] },
      { type: "wire", id: "W1", open: true, points: [[125, 56], [125, 90]] },
    ],
  });

  assert.ok(!warnings.some((warning) => warning.includes("W1") && warning.includes("symbol body")));
});

test("KiCad symbols render source geometry, exact pin labels, and world-space pins", () => {
  const symbolData = {
    id: "Timer:NE555",
    units: [{
      unit: 1,
      bodyStyle: 1,
      pins: [
        {
          number: "2",
          name: "TRIG",
          electricalType: "input",
          shape: "line",
          point: [-30, 0],
          bodyPoint: [-12, 0],
          showName: true,
          showNumber: true,
        },
        {
          number: "3",
          name: "OUT",
          electricalType: "output",
          shape: "inverted_clock",
          point: [30, 0],
          bodyPoint: [12, 0],
          showName: true,
          showNumber: true,
        },
      ],
      graphics: [
        {
          type: "rectangle",
          points: [[-12, -16], [12, 16]],
          strokeWidth: 2,
          fillType: "background",
        },
        {
          type: "polyline",
          points: [[-12, -16], [12, -16], [12, 16], [-12, 16]],
          closed: true,
          strokeWidth: 2,
          fillType: "none",
        },
        {
          type: "circle",
          points: [[0, 0]],
          radius: 60,
          strokeWidth: 1,
          fillType: "none",
        },
        {
          type: "arc",
          points: [[-8, 0], [0, -8], [8, 0]],
          strokeWidth: 1,
          fillType: "none",
        },
        {
          type: "bezier",
          points: [[-5, 6], [-2, 0], [2, 0], [5, 6]],
          strokeWidth: 1,
          fillType: "none",
        },
        {
          type: "text",
          points: [[0, -6]],
          text: "<timer>",
          fontSize: 9,
          fillType: "outline",
        },
      ],
    }],
  };
  const spec = {
    title: "KiCad timer symbol",
    elements: [{
      type: "kicad",
      id: "U1",
      label: "U1",
      value: "NE555",
      symbolId: "Timer:NE555",
      at: [200, 150],
      rotation: 90,
      flip: true,
      symbolData,
    }],
  };

  const validation = CircuitDraw.validate(spec);
  assert.deepEqual(Array.from(validation.errors), []);
  assert.deepEqual(
    CircuitGeometry.getCircuitPins(spec.elements[0]),
    [
      { name: "2", point: [200, 180] },
      { name: "3", point: [200, 120] },
    ],
  );

  const svg = CircuitDraw.render(spec);
  assert.match(svg, /translate\(200 150\) rotate\(90\) scale\(-1 1\)/);
  assert.match(svg, /<rect x="-12" y="-16" width="24" height="32"/);
  assert.match(svg, /<circle cx="0" cy="0" r="60"/);
  assert.match(svg, / A8 8 0 0 /);
  assert.match(svg, / C-2 0 2 0 5 6/);
  assert.match(svg, /&lt;timer&gt;/);
  assert.match(svg, /TRIG/);
  assert.match(svg, /OUT/);
  assert.match(svg, /viewBox="100 50 /);
  assert.match(svg, /preserveAspectRatio="xMidYMid meet"/);

  const buildSheet = CircuitDraw.buildSheet(spec);
  assert.match(buildSheet, /\| U1 \| Timer:NE555 \| NE555 \|/);
  assert.match(buildSheet, /U1\.2/);
  assert.match(buildSheet, /U1\.3/);
});

test("KiCad symbols accept and render arbitrary fractional rotation angles", () => {
  const symbolData = {
    id: "Device:R",
    units: [{
      unit: 1,
      bodyStyle: 1,
      pins: [
        {
          number: "1",
          name: "A",
          electricalType: "passive",
          shape: "line",
          point: [-30, 0],
          bodyPoint: [-12, 0],
          showName: true,
          showNumber: true,
        },
        {
          number: "2",
          name: "B",
          electricalType: "passive",
          shape: "line",
          point: [30, 0],
          bodyPoint: [12, 0],
          showName: true,
          showNumber: true,
        },
      ],
      graphics: [{
        type: "rectangle",
        points: [[-12, -16], [12, 16]],
        strokeWidth: 2,
        fillType: "background",
      }],
    }],
  };
  const spec = {
    title: "Fractionally rotated KiCad symbol",
    elements: [{
      type: "kicad",
      id: "R1",
      symbolId: "Device:R",
      at: [200, 150],
      rotation: 37.5,
      symbolData,
    }],
  };

  const validation = CircuitDraw.validate(spec);
  assert.deepEqual(Array.from(validation.errors), []);
  assert.deepEqual(
    CircuitGeometry.getCircuitPins(spec.elements[0]),
    [
      { name: "1", point: [176.2, 131.74] },
      { name: "2", point: [223.8, 168.26] },
    ],
  );
  assert.match(CircuitDraw.render(spec), /translate\(200 150\) rotate\(37\.5\) scale\(1 1\)/);
});

test("KiCad symbols without hydrated source data cannot be rendered as valid drafts", () => {
  const report = CircuitDraw.validate({
    title: "Missing KiCad source",
    elements: [{
      type: "kicad",
      id: "R1",
      symbolId: "Device:R",
      at: [100, 100],
    }],
  });
  assert.ok(report.errors.some((error) => error.includes("drawing and pin data have not been loaded")));
  assert.throws(() => CircuitDraw.render({
    title: "Missing KiCad source",
    elements: [{
      type: "kicad",
      id: "R1",
      symbolId: "Device:R",
      at: [100, 100],
    }],
  }), /Invalid circuit spec/);
});

test("graphics-only KiCad symbols render source artwork without inventing pins", () => {
  const element = {
    type: "kicad",
    id: "X1",
    symbolId: "Graphic:Annotation_Number",
    at: [100, 100],
    symbolData: {
      id: "Graphic:Annotation_Number",
      units: [{
        unit: 1,
        bodyStyle: 1,
        pins: [],
        graphics: [{
          type: "circle",
          points: [[0, 0]],
          radius: 8.98,
          strokeWidth: 1.27,
          fillType: "background",
        }],
      }],
    },
  };
  const spec = { title: "Graphic-only KiCad symbol", elements: [element] };

  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  assert.deepEqual(CircuitGeometry.getCircuitPins(element), []);
  assert.match(CircuitDraw.render(spec), /<circle cx="0" cy="0" r="8\.98"/);
});

test("the valid astable flasher passes after safe rail-tail cleanup", () => {
  const before = CircuitDraw.validate(astableFlasher);
  assert.equal(before.errors.length, 2);
  assert.equal(before.warnings.length, 0);

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

test("astable validation reports a base-to-collector short directly", () => {
  const invalid = structuredClone(astableFlasher);
  invalid.elements.push({
    type: "wire",
    id: "W_Q1_BASE_COLLECTOR_SHORT",
    points: [[150, 250], [150, 206], [200, 206]],
  });

  const report = CircuitDraw.validate(invalid);
  assert.ok(
    report.errors.some((error) =>
      error.includes("Q1.B and Q1.C share one net") &&
      error.includes("prevents normal astable switching"),
    ),
  );
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

test("disconnected wire errors identify the nearest pin and distance", () => {
  const report = CircuitDraw.validate({
    title: "Nearest pin details",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "wire", id: "W1", points: [[104, 100], [104, 150]] },
    ],
  });
  assert.ok(
    report.errors.some((error) =>
      error.includes('W1') &&
      error.includes('resistor "R1".1 at (100,100)') &&
      error.includes('4 px away'),
    ),
  );
});

test("unconnected DC source and potentiometer pins are blocking errors", () => {
  const report = CircuitDraw.validate({
    title: "Required supply and wiper connections",
    elements: [
      { type: "dcsource", id: "VCC_5V", from: [100, 50], to: [100, 100] },
      { type: "potentiometer", id: "POT1", at: [280, 350] },
    ],
  });

  assert.ok(report.errors.some((error) => error.includes('dcsource "VCC_5V".-') && error.includes("required pin")));
  assert.ok(report.errors.some((error) => error.includes('potentiometer "POT1".W') && error.includes("required pin")));
  assert.ok(report.warnings.some((warning) => warning.includes("terminals are very close")));
});

test("relay needs both coil pins and COM, plus at least one contact", () => {
  const report = CircuitDraw.validate({
    title: "Relay without a switched contact",
    elements: [
      { type: "relay", id: "RL1", at: [200, 200] },
      { type: "wire", id: "W_COIL1", open: true, points: [[145, 180], [120, 180]] },
      { type: "wire", id: "W_COIL2", open: true, points: [[145, 220], [120, 220]] },
      { type: "wire", id: "W_COM", open: true, points: [[255, 200], [280, 200]] },
    ],
  });

  assert.ok(report.errors.some((error) => error.includes('relay "RL1" has neither NC nor NO contact connected')));
});

test("an unused relay contact remains advisory when the other contact is wired", () => {
  const report = CircuitDraw.validate({
    title: "Relay with unused NC contact",
    elements: [
      { type: "relay", id: "RL1", at: [200, 200] },
      { type: "wire", id: "W_COIL1", open: true, points: [[145, 180], [120, 180]] },
      { type: "wire", id: "W_COIL2", open: true, points: [[145, 220], [120, 220]] },
      { type: "wire", id: "W_COM", open: true, points: [[255, 200], [280, 200]] },
      { type: "wire", id: "W_NO", open: true, points: [[255, 230], [280, 230]] },
    ],
  });

  assert.deepEqual(Array.from(report.errors), []);
  assert.ok(report.warnings.some((warning) => warning.includes('relay "RL1".NC')));
});

test("diagonal routing remains an advisory warning rather than a blocking error", () => {
  const report = CircuitDraw.validate({
    title: "Diagonal wire layout",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [160, 100] },
      { type: "wire", id: "W1", open: true, points: [[100, 100], [140, 140]] },
      { type: "wire", id: "W2", open: true, points: [[160, 100], [180, 100]] },
    ],
  });
  assert.deepEqual(Array.from(report.errors), []);
  assert.ok(report.warnings.some((warning) => warning.includes("is diagonal")));
});

test("invalid but renderable schematics can be shown with explicit structural-error opt-in", () => {
  const spec = {
    title: "Needs repair",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
    ],
  };

  assert.ok(CircuitDraw.validate(spec).errors.length > 0);
  assert.throws(() => CircuitDraw.render(spec), /Invalid circuit spec/);
  assert.match(CircuitDraw.render(spec, { allowStructuralErrors: true }), /^<svg/);
});

test("a non-connecting wire crossing stays continuous and keeps the two nets separate", () => {
  const spec = {
    title: "Non-connecting wire bridge",
    elements: [
      { type: "wire", id: "WH", points: [[0, 50], [100, 50]] },
      { type: "wire", id: "WV", points: [[50, 0], [50, 100]] },
      { type: "battery", id: "B_HL", from: [0, 50], to: [0, 70] },
      { type: "battery", id: "B_HR", from: [100, 50], to: [100, 70] },
      { type: "battery", id: "B_VT", from: [50, 0], to: [70, 0] },
      { type: "battery", id: "B_VB", from: [50, 100], to: [70, 100] },
      { type: "wire", id: "W_HL_RETURN", open: true, points: [[0, 70], [0, 90]] },
      { type: "wire", id: "W_HR_RETURN", open: true, points: [[100, 70], [100, 90]] },
      { type: "wire", id: "W_VT_RETURN", open: true, points: [[70, 0], [90, 0]] },
      { type: "wire", id: "W_VB_RETURN", open: true, points: [[70, 100], [90, 100]] },
      { type: "crossing", id: "BR1", at: [50, 50], orientation: "horizontal" },
    ],
  };
  const validation = CircuitDraw.validate(spec);
  assert.deepEqual(Array.from(validation.errors), []);
  const svg = CircuitDraw.render(spec);
  assert.doesNotMatch(svg, /Q50 36 62 50/);
  assert.doesNotMatch(svg, /<circle cx="50" cy="50"/);
  assert.match(svg, /points="0,50 100,50"/);
  assert.match(svg, /points="50,0 50,100"/);

  const nets = CircuitDraw.netlist(spec).nets;
  const horizontal = nets.find((net) => net.pins.includes("B_HL.+"));
  const vertical = nets.find((net) => net.pins.includes("B_VT.+"));
  assert.ok(horizontal);
  assert.ok(vertical);
  assert.ok(horizontal.pins.includes("B_HR.+"));
  assert.ok(vertical.pins.includes("B_VB.+"));
  assert.equal(horizontal.pins.includes("B_VT.+"), false);
  assert.equal(vertical.pins.includes("B_HL.+"), false);
});

test("an explicit junction connects crossing wires and renders a junction dot", () => {
  const spec = {
    title: "Connected wire crossing",
    elements: [
      { type: "wire", id: "WH", points: [[0, 50], [100, 50]] },
      { type: "wire", id: "WV", points: [[50, 0], [50, 100]] },
      { type: "battery", id: "B_HL", from: [0, 50], to: [0, 70] },
      { type: "battery", id: "B_HR", from: [100, 50], to: [100, 70] },
      { type: "battery", id: "B_VT", from: [50, 0], to: [70, 0] },
      { type: "battery", id: "B_VB", from: [50, 100], to: [70, 100] },
      { type: "wire", id: "W_HL_RETURN", open: true, points: [[0, 70], [0, 90]] },
      { type: "wire", id: "W_HR_RETURN", open: true, points: [[100, 70], [100, 90]] },
      { type: "wire", id: "W_VT_RETURN", open: true, points: [[70, 0], [90, 0]] },
      { type: "wire", id: "W_VB_RETURN", open: true, points: [[70, 100], [90, 100]] },
      { type: "junction", id: "J1", x: 50, y: 50 },
    ],
  };
  const validation = CircuitDraw.validate(spec);
  assert.deepEqual(Array.from(validation.errors), []);
  assert.match(CircuitDraw.render(spec), /<circle cx="50" cy="50"/);

  const nets = CircuitDraw.netlist(spec).nets;
  const connected = nets.find((net) => net.pins.includes("B_HL.+"));
  assert.ok(connected);
  for (const pin of ["B_HR.+", "B_VT.+", "B_VB.+"]) {
    assert.ok(connected.pins.includes(pin), `${pin} should join at the junction`);
  }
});

test("a crossing annotation must sit on one horizontal and one vertical wire", () => {
  const report = CircuitDraw.validate({
    title: "Misplaced crossing annotation",
    elements: [
      { type: "wire", id: "WH", open: true, points: [[0, 50], [100, 50]] },
      { type: "wire", id: "WV", open: true, points: [[50, 0], [50, 100]] },
      { type: "crossing", id: "BR1", at: [25, 50] },
    ],
  });
  assert.ok(report.errors.some((error) => error.includes("must sit at the interior crossing")));
});

test("wire crossing a component is a blocking short-circuit error", () => {
  const report = CircuitDraw.validate({
    title: "Wire across resistor",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "wire", id: "W1", points: [[120, 100], [180, 100]] },
    ],
  });
  assert.ok(
    report.errors.some((error) =>
      error.includes('wire "W1" segment 1') &&
      error.includes('resistor "R1" between pins 1 and 2') &&
      error.includes('directly shorting it'),
    ),
  );
});

test("auto-fix routes a wire around a symbol without changing its connections", () => {
  const spec = {
    title: "Wire around resistor",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "wire", id: "W1", points: [[100, 100], [200, 100]] },
    ],
  };

  const beforeConnectivity = connectivitySignature(spec);
  const fixed = CircuitDraw.autoFix(spec);
  const wire = fixed.spec.elements.find((element) => element.id === "W1");

  assert.ok(fixed.changes.some((change) => change.includes('Rerouted wire "W1"')));
  assert.deepEqual(Array.from(wire.points[0]), [100, 100]);
  assert.deepEqual(Array.from(wire.points.at(-1)), [200, 100]);
  assert.ok(wire.points.some((point) => point[1] < 90 || point[1] > 110));
  assert.equal(
    CircuitDraw.validate(fixed.spec).errors.some((error) => error.includes("passes through resistor")),
    false,
  );
  assert.equal(
    CircuitDraw.layoutWarnings(fixed.spec).some((warning) => warning.includes("crosses the symbol body")),
    false,
  );
  assert.equal(connectivitySignature(fixed.spec), beforeConnectivity);
});

test("auto-fix keeps separate wire crossings and connected junction dots", () => {
  const spec = {
    title: "Crossings remain intentional",
    elements: [
      { type: "resistor", id: "R1", from: [100, 100], to: [200, 100] },
      { type: "wire", id: "W_R1", points: [[100, 100], [200, 100]] },
      {
        type: "kicad",
        id: "G1",
        symbolId: "Graphic:RoutingObstacle",
        at: [150, 75],
        symbolData: {
          id: "Graphic:RoutingObstacle",
          units: [{
            unit: 1,
            bodyStyle: 1,
            pins: [],
            graphics: [{
              type: "rectangle",
              points: [[-10, -5], [10, 5]],
              strokeWidth: 1,
              fillType: "none",
            }],
          }],
        },
      },
      { type: "wire", id: "W_PASSING", open: true, points: [[150, 110], [150, 160]] },
      { type: "wire", id: "W_SEPARATE_H", open: true, points: [[250, 50], [350, 50]] },
      { type: "wire", id: "W_SEPARATE_V", open: true, points: [[300, 0], [300, 100]] },
      { type: "crossing", id: "NC1", at: [300, 50] },
      { type: "wire", id: "W_JOINED_H", open: true, points: [[450, 50], [550, 50]] },
      { type: "wire", id: "W_JOINED_V", open: true, points: [[500, 0], [500, 100]] },
      { type: "junction", id: "J1", x: 500, y: 50 },
    ],
  };

  const beforeConnectivity = connectivitySignature(spec);
  const fixed = CircuitDraw.autoFix(spec);
  const svg = CircuitDraw.render(fixed.spec);
  const reroutedWire = fixed.spec.elements.find((element) => element.id === "W_R1");

  assert.ok(fixed.changes.some((change) => change.includes('Rerouted wire "W_R1"')));
  assert.ok(reroutedWire.points.some((point, index) => {
    const next = reroutedWire.points[index + 1];
    return point[1] === 118 && next?.[1] === 118 &&
      Math.min(point[0], next[0]) < 150 && Math.max(point[0], next[0]) > 150;
  }));
  assert.equal(connectivitySignature(fixed.spec), beforeConnectivity);
  assert.doesNotMatch(svg, /<circle cx="300" cy="50"/);
  assert.match(svg, /<circle cx="500" cy="50"/);
  assert.doesNotMatch(svg, /<circle cx="150" cy="118"/);
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

test("astable base feeds accept a +5V terminal without an ID", () => {
  const noTerminalId = structuredClone(astableFlasher);
  delete noTerminalId.elements.find((element) => element.id === "VCC1").id;
  const report = CircuitDraw.validate(CircuitDraw.autoFix(noTerminalId).spec);
  assert.equal(report.errors.some((error) => error.includes("needs its own resistor to the positive supply")), false);
});

test("astable transistor emitters must reach their return rail", () => {
  const disconnectedEmitter = structuredClone(astableFlasher);
  disconnectedEmitter.elements = disconnectedEmitter.elements.filter((element) => element.id !== "W_Q1_EMITTER");
  const report = CircuitDraw.validate(CircuitDraw.autoFix(disconnectedEmitter).spec);
  assert.ok(report.errors.some((error) => error.includes("Q1.E must connect to ground")));
});

test("astable emitter resistors are accepted as a path to ground", () => {
  const emitterResistor = structuredClone(astableFlasher);
  emitterResistor.elements = emitterResistor.elements.filter((element) => element.id !== "W_Q1_EMITTER");
  emitterResistor.elements.push(
    { type: "wire", id: "W_Q1_EMITTER_TOP", points: [[200, 294], [200, 350]] },
    { type: "resistor", id: "R5", from: [200, 350], to: [200, 400], value: "220 ohm" },
    { type: "wire", id: "W_Q1_EMITTER_BOTTOM", points: [[200, 400], [200, 440]] },
  );
  const report = CircuitDraw.validate(CircuitDraw.autoFix(emitterResistor).spec);
  assert.equal(report.errors.some((error) => error.includes("Q1.E must connect to ground")), false);
});

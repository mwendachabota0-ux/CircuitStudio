import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";
import * as CircuitGeometry from "../../../../lib/circuit-geometry/src/index.ts";

const moduleStub = { exports: {} };
const engineSource = readFileSync(new URL("../../public/circuit-draw.js", import.meta.url), "utf8");
runInNewContext(engineSource, { module: moduleStub, CircuitGeometry });
const CircuitDraw = moduleStub.exports;
const samples = JSON.parse(
  readFileSync(new URL("./fixtures/circuit-compatibility-samples.json", import.meta.url), "utf8"),
).map(({ name, spec }) => ({ title: name, spec }));
const compatibleFm = JSON.parse(
  readFileSync(new URL("./fixtures/fm-transmitter-compatible.json", import.meta.url), "utf8"),
);
const exampleKicadSymbolData = {
  id: "Device:AuditExample",
  units: [{
    unit: 1,
    bodyStyle: 1,
    pins: [],
    graphics: [{
      type: "rectangle",
      points: [[-10, -10], [10, 10]],
      strokeWidth: 1,
      fillType: "none",
    }],
  }],
};

function exampleElement(component) {
  if (component.type === "kicad") {
    return {
      type: "kicad",
      symbolId: "Device:AuditExample",
      at: [200, 200],
      symbolData: exampleKicadSymbolData,
    };
  }
  if ("minimumTerminalDistance" in component) {
    return {
      type: component.type,
      from: [100, 100],
      to: [100 + component.minimumTerminalDistance + 10, 100],
    };
  }
  if (component.type === "wire") {
    return { type: "wire", open: true, points: [[100, 100], [150, 100]] };
  }
  if (component.type === "junction") return { type: "junction", x: 100, y: 100 };
  if (component.type === "label") return { type: "label", at: [100, 100], text: "note" };
  if (component.type === "box") return { type: "box", x: 100, y: 100, w: 80, h: 40 };
  if (component.type === "ic" || component.type === "connector") {
    return {
      type: component.type,
      at: [200, 200],
      pins: [{ name: "IN", side: "left" }, { name: "OUT", side: "right" }],
    };
  }
  return { type: component.type, at: [200, 200] };
}

function openPinLeads(element) {
  const pins = CircuitGeometry.getCircuitPins(element);
  const anchor = Array.isArray(element.at)
    ? element.at
    : Array.isArray(element.from) && Array.isArray(element.to)
      ? [(element.from[0] + element.to[0]) / 2, (element.from[1] + element.to[1]) / 2]
      : null;
  return pins.map((pin, index) => {
    let dx = anchor ? pin.point[0] - anchor[0] : 1;
    let dy = anchor ? pin.point[1] - anchor[1] : 0;
    const length = Math.hypot(dx, dy) || 1;
    dx = Math.round((dx / length) * 24);
    dy = Math.round((dy / length) * 24);
    if (dx === 0 && dy === 0) dx = 24;
    return {
      type: "wire",
      id: `W_TEST_${index + 1}`,
      open: true,
      points: [pin.point, [pin.point[0] + dx, pin.point[1] + dy]],
    };
  });
}

test("the renderer and shared geometry expose the same exact component types", () => {
  assert.deepEqual(
    Array.from(CircuitDraw.types),
    CircuitGeometry.CIRCUIT_SUPPORTED_ELEMENT_TYPES,
  );
  assert.equal(samples.length, 5);
});

test("every catalog schema has a renderable CircuitDraw example", () => {
  for (const component of CircuitGeometry.CIRCUIT_COMPONENT_REFERENCE) {
    const element = exampleElement(component);
    const spec = component.type === "crossing"
      ? {
          title: `Reference: ${component.type}`,
          elements: [
            { type: "wire", id: "H", open: true, points: [[100, 200], [200, 200]] },
            { type: "wire", id: "V", open: true, points: [[150, 150], [150, 250]] },
            { ...element, at: [150, 200] },
          ],
        }
      : {
          title: `Reference: ${component.type}`,
          elements: [element, ...openPinLeads(element)],
        };
    assert.deepEqual(
      Array.from(CircuitDraw.validate(spec).errors),
      [],
      `${component.type} must match the documented required properties`,
    );
    assert.match(CircuitDraw.render(spec), /^<svg/, `${component.type} must render`);
  }
});

test("shared schemas cover catalog entries and reject missing IC pins", () => {
  for (const component of CircuitGeometry.CIRCUIT_COMPONENT_REFERENCE) {
    const element = exampleElement(component);
    assert.equal(CircuitGeometry.getCircuitElementSchemaError(element), null);
  }
  assert.match(
    CircuitGeometry.getCircuitElementSchemaError({ type: "ic", at: [100, 100] }),
    /ic element is missing required properties: pins/,
  );
  assert.match(
    CircuitGeometry.getCircuitElementSchemaError({ type: "speaker", at: [100, 100] }),
    /speaker element is missing required properties: from, to/,
  );
  assert.match(
    CircuitGeometry.getCircuitElementSchemaError({
      type: "crossing",
      at: [100, 100],
      orientation: "diagonal",
    }),
    /crossing orientation must be/,
  );
});

test("all five original samples parse but remain blocked by real compatibility findings", () => {
  const expectedUnsupported = [
    [],
    [],
    [],
    [],
    [],
  ];

  samples.forEach(({ title, spec }, index) => {
    assert.equal(typeof spec.title, "string", `${title} has a title`);
    assert.ok(Array.isArray(spec.elements), `${title} has elements`);
    const unsupported = spec.elements
      .filter((element) => !CircuitGeometry.isSupportedCircuitElementType(element.type))
      .map((element) => element.type);
    assert.deepEqual(unsupported, expectedUnsupported[index], `${title} component compatibility`);

    const before = CircuitDraw.validate(spec);
    const repaired = CircuitDraw.autoFix(spec);
    const after = CircuitDraw.validate(repaired.spec);
    assert.ok(before.errors.length > 0, `${title} must not be labeled build-ready`);
    assert.ok(after.errors.length > 0, `${title} remains blocked after limited auto-fix`);
    assert.throws(
      () => CircuitDraw.render(repaired.spec),
      /Invalid circuit spec/,
      `${title} must not render as a validated schematic`,
    );
  });
});

test("the original sample failures retain their specific actionable causes", () => {
  const findings = samples.map(({ spec }) => CircuitDraw.validate(spec).errors.join("\n"));
  assert.match(findings[0], /ic element is missing required properties: pins/);
  assert.match(findings[0], /Move this endpoint exactly to/);
  assert.match(findings[1], /speaker "SP1": needs "from":\[x,y\] and "to":\[x,y\]/);
  assert.match(findings[3], /passes through resistor "R2" between pins 1 and 2/);
  assert.match(findings[3], /Reroute around the symbol/);
  assert.match(findings[4], /ic element is missing required properties: pins/);
});

test("a rebuilt FM transmitter uses exact supported pin coordinates and renders", () => {
  const validation = CircuitDraw.validate(compatibleFm);
  assert.deepEqual(Array.from(validation.errors), []);
  assert.deepEqual(Array.from(validation.warnings), []);
  assert.match(CircuitDraw.render(compatibleFm), /^<svg/);
});

test("IC, potentiometer, and MOSFET symbols use explicit catalog entries", () => {
  const guide = CircuitGeometry.formatCircuitComponentGuide();
  for (const type of ["ic", "potentiometer", "mosfet"]) {
    assert.equal(CircuitGeometry.isSupportedCircuitElementType(type), true);
    assert.match(guide, /Use only these exact CircuitDraw element type identifiers and schemas/);
  }
  assert.match(guide, /no IC supply pins are modeled/);
});

test("loads researched component descriptions without repeating the unknown-pin error", () => {
  const entries = CircuitGeometry.CIRCUIT_COMPONENT_LIBRARY;
  assert.equal(entries.length, 50);
  assert.ok(entries.every((entry) => entry.longDescription.trim()));
  assert.ok(
    entries.every(
      (entry) => !entry.longDescription.includes("None-pin symbol drawing"),
    ),
  );

  const context =
    CircuitGeometry.formatRelevantCircuitComponentResearchContext([
      "I need an adjustable variable resistor",
    ]);
  assert.match(context, /potentiometer \(Potentiometer\)/i);
  assert.match(context, /adjustable resistor/i);
});

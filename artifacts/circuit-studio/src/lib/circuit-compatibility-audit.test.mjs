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

test("the renderer and shared geometry expose the same exact component types", () => {
  assert.deepEqual(
    Array.from(CircuitDraw.types),
    CircuitGeometry.CIRCUIT_SUPPORTED_ELEMENT_TYPES,
  );
  assert.equal(samples.length, 5);
});

test("every catalog schema has a renderable CircuitDraw example", () => {
  for (const component of CircuitGeometry.CIRCUIT_COMPONENT_REFERENCE) {
    let element;
    if ("minimumTerminalDistance" in component) {
      element = {
        type: component.type,
        from: [100, 100],
        to: [100 + component.minimumTerminalDistance + 10, 100],
      };
    } else if (["npn", "pnp", "opamp", "ground", "antenna", "terminal"].includes(component.type)) {
      element = { type: component.type, at: [200, 200] };
    } else if (component.type === "wire") {
      element = { type: "wire", open: true, points: [[100, 100], [150, 100]] };
    } else if (component.type === "junction") {
      element = { type: "junction", x: 100, y: 100 };
    } else if (component.type === "label") {
      element = { type: "label", at: [100, 100], text: "note" };
    } else {
      element = { type: "box", x: 100, y: 100, w: 80, h: 40 };
    }
    const spec = { title: `Reference: ${component.type}`, elements: [element] };
    assert.deepEqual(
      Array.from(CircuitDraw.validate(spec).errors),
      [],
      `${component.type} must match the documented required properties`,
    );
    assert.match(CircuitDraw.render(spec), /^<svg/, `${component.type} must render`);
  }
});

test("shared server schema checks reject unsupported types and missing pins", () => {
  for (const component of CircuitGeometry.CIRCUIT_COMPONENT_REFERENCE) {
    const element = Object.fromEntries(
      component.requiredProperties.map((property) => [property, property]),
    );
    element.type = component.type;
    assert.equal(CircuitGeometry.getCircuitElementSchemaError(element), null);
  }
  assert.match(
    CircuitGeometry.getCircuitElementSchemaError({ type: "ic", at: [100, 100] }),
    /Unsupported circuit element type: ic/,
  );
  assert.match(
    CircuitGeometry.getCircuitElementSchemaError({ type: "speaker", at: [100, 100] }),
    /speaker element is missing required properties: from, to/,
  );
});

test("all five original samples parse but remain blocked by real compatibility findings", () => {
  const expectedUnsupported = [
    ["ic", "potentiometer"],
    ["ic"],
    ["mosfet"],
    [],
    ["ic"],
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
  assert.match(findings[0], /unsupported CircuitDraw type "ic"/);
  assert.match(findings[0], /unsupported CircuitDraw type "potentiometer"/);
  assert.match(findings[0], /Move this endpoint exactly to/);
  assert.match(findings[1], /speaker "SP1": needs "from":\[x,y\] and "to":\[x,y\]/);
  assert.match(findings[2], /unsupported CircuitDraw type "mosfet"/);
  assert.match(findings[3], /passes through resistor "R2" between pins 1 and 2/);
  assert.match(findings[3], /Reroute around the symbol/);
  assert.match(findings[4], /unsupported CircuitDraw type "ic"/);
});

test("a rebuilt FM transmitter uses exact supported pin coordinates and renders", () => {
  const validation = CircuitDraw.validate(compatibleFm);
  assert.deepEqual(Array.from(validation.errors), []);
  assert.deepEqual(Array.from(validation.warnings), []);
  assert.match(CircuitDraw.render(compatibleFm), /^<svg/);
});

test("unsupported IC, potentiometer, and MOSFET symbols are explicit limitations", () => {
  const guide = CircuitGeometry.formatCircuitComponentGuide();
  for (const type of ["ic", "potentiometer", "mosfet"]) {
    assert.equal(CircuitGeometry.isSupportedCircuitElementType(type), false);
    assert.match(guide, /Use only these exact CircuitDraw element type identifiers and schemas/);
  }
  assert.match(guide, /no IC supply pins are modeled/);
});

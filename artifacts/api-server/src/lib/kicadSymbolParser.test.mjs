import assert from "node:assert/strict";
import { test } from "node:test";
import {
  mergeInheritedKicadUnits,
  parseKicadSymbolSource,
} from "./kicadSymbolParser.ts";

const symbolSource = `
(kicad_symbol_lib
  (version 20231120)
  (symbol "DraftExample"
    (symbol "DraftExample_0_1"
      (rectangle (start -2 -1) (end 2 1)
        (stroke (width 0.254) (type default))
        (fill (type background)))
      (pin_names (offset 0.5))
      (pin input line (at -5 0 0) (length 2.54)
        (name "DATA_IN" (effects (font (size 1.27 1.27))))
        (number "1" (effects (font (size 1.27 1.27)))))
    )
    (symbol "DraftExample_1_1"
      (polyline (pts (xy -2 -1) (xy 2 -1) (xy 2 1) (xy -2 1) (xy -2 -1))
        (stroke (width 0.254) (type default))
        (fill (type none)))
      (circle (center 0 0) (end 1 0)
        (stroke (width 0.254) (type default))
        (fill (type none)))
      (arc (start -1 0) (mid 0 -1) (end 1 0)
        (stroke (width 0.254) (type default))
        (fill (type none)))
      (bezier (pts (xy -1 0) (xy -1 -1) (xy 1 -1) (xy 1 0))
        (stroke (width 0.254) (type default))
        (fill (type none)))
      (text "draft note" (at 0 2 0) (effects (font (size 1.27 1.27))))
      (pin output inverted_clock (at 5 0 180) (length 2.54)
        (name "DATA_OUT" (effects (font (size 1.27 1.27))))
        (number "2" (effects (font (size 1.27 1.27)))))
    )
    (symbol "DraftExample_2_1"
      (pin passive line (at 0 -5 90) (length 2.54)
        (name "RETURN" (effects (font (size 1.27 1.27))))
        (number "3" (effects (font (size 1.27 1.27)))))
    )
  )
)`;

test("parses KiCad symbol graphics, pin coordinates, and hidden-text flags", () => {
  const parsed = parseKicadSymbolSource(symbolSource);
  assert.equal(parsed.extendsName, undefined);
  assert.deepEqual(
    parsed.units.map(({ unit, bodyStyle }) => [unit, bodyStyle]),
    [[1, 1], [2, 1]],
  );

  const firstUnit = parsed.units[0];
  assert.equal(firstUnit.graphics.length, 6);
  assert.deepEqual(firstUnit.graphics[0], {
    type: "rectangle",
    points: [[-20, 10], [20, -10]],
    strokeWidth: 2.54,
    fillType: "background",
  });
  assert.equal(firstUnit.graphics.find((graphic) => graphic.type === "text")?.text, "draft note");
  assert.equal(firstUnit.graphics.find((graphic) => graphic.type === "text")?.fontSize, 12.7);

  const input = firstUnit.pins.find((pin) => pin.number === "1");
  assert.deepEqual(input?.point, [-50, 0]);
  assert.deepEqual(input?.bodyPoint, [-24.6, 0]);
  assert.equal(input?.name, "DATA_IN");
  assert.equal(input?.electricalType, "input");
  assert.equal(input?.showName, true);

  const output = firstUnit.pins.find((pin) => pin.number === "2");
  assert.deepEqual(output?.point, [50, 0]);
  assert.ok(output?.bodyPoint);
  assert.ok(Math.abs(output.bodyPoint[0] - 24.6) < 0.000001);
  assert.ok(Math.abs(output.bodyPoint[1]) < 0.000001);
  assert.equal(output?.shape, "inverted_clock");
});

test("standard resistor leads meet the exact library body edges", () => {
  const resistorSource = `
  (kicad_symbol_lib
    (version 20231120)
    (symbol "Resistor"
      (symbol "Resistor_1_1"
        (rectangle (start -1.27 1.27) (end 1.27 -1.27)
          (stroke (width 0.254) (type default))
          (fill (type background)))
        (pin passive line (at -3.81 0 0) (length 2.54)
          (name "~") (number "1"))
        (pin passive line (at 3.81 0 180) (length 2.54)
          (name "~") (number "2"))
      )
    )
  )`;
  const parsed = parseKicadSymbolSource(resistorSource);
  const unit = parsed.units[0];
  const body = unit.graphics.find((graphic) => graphic.type === "rectangle");
  const left = unit.pins.find((pin) => pin.number === "1");
  const right = unit.pins.find((pin) => pin.number === "2");

  assert.deepEqual(body?.points, [[-12.7, -12.7], [12.7, 12.7]]);
  assert.deepEqual(left?.point, [-38.1, 0]);
  assert.deepEqual(left?.bodyPoint, [-12.7, 0]);
  assert.deepEqual(right?.point, [38.1, 0]);
  assert.ok(right?.bodyPoint);
  assert.ok(Math.abs(right.bodyPoint[0] - 12.7) < 0.000001);
  assert.ok(Math.abs(right.bodyPoint[1]) < 0.000001);
});

test("unit-zero-only symbols become a renderable unit with their original pins", () => {
  const parsed = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "UnitZeroSwitch"
        (symbol "UnitZeroSwitch_0_1"
          (circle (center 0 0) (radius 2)
            (stroke (width 0.254) (type default))
            (fill (type none)))
          (pin passive line (at -5.08 0 0) (length 2.54)
            (name "1") (number "1"))
          (pin passive line (at 5.08 0 180) (length 2.54)
            (name "2") (number "2")))))`);

  assert.equal(parsed.units.length, 1);
  assert.equal(parsed.units[0].unit, 1);
  assert.equal(parsed.units[0].bodyStyle, 1);
  assert.deepEqual(parsed.units[0].pins.map(({ number }) => number), ["1", "2"]);
  assert.ok(Math.abs(parsed.units[0].pins[0].point[0] + 50.8) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[0].point[1]) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[0].bodyPoint[0] + 25.4) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[0].bodyPoint[1]) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[1].point[0] - 50.8) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[1].point[1]) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[1].bodyPoint[0] - 25.4) < 0.000001);
  assert.ok(Math.abs(parsed.units[0].pins[1].bodyPoint[1]) < 0.000001);
  assert.equal(parsed.units[0].graphics[0].radius, 20);
});

test("graphics-only unit-zero symbols remain available for symbol previews", () => {
  const parsed = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "Annotation"
        (symbol "Annotation_0_1"
          (circle (center 0 0) (radius 0.898)
            (stroke (width 0.127) (type default))
            (fill (type background))))))`);

  assert.equal(parsed.units.length, 1);
  assert.deepEqual(
    {
      unit: parsed.units[0].unit,
      bodyStyle: parsed.units[0].bodyStyle,
      pins: parsed.units[0].pins,
      graphics: parsed.units[0].graphics,
    },
    {
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
    },
  );
});

test("shared unit-zero child geometry merges into every inherited unit", () => {
  const parent = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "Base"
        (symbol "Base_1_1"
          (rectangle (start -2 -2) (end 2 2)
            (stroke (width 0.254)) (fill (type none))))
        (symbol "Base_2_1"
          (rectangle (start -3 -3) (end 3 3)
            (stroke (width 0.254)) (fill (type none))))))`);
  const child = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "Child"
        (extends "Base")
        (symbol "Child_0_1"
          (circle (center 0 0) (radius 1)
            (stroke (width 0.254)) (fill (type none))))))`);

  assert.equal(child.units.length, 0);
  assert.ok(child.commonUnits);
  const merged = mergeInheritedKicadUnits(
    parent.units,
    child.units,
    child.commonUnits,
  );
  assert.equal(merged.length, 2);
  for (const unit of merged) {
    assert.equal(unit.graphics.length, 2);
    assert.ok(unit.graphics.some((graphic) => graphic.type === "circle"));
  }
});

test("merges inherited unit graphics and pins without dropping child definitions", () => {
  const parent = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "Base"
        (symbol "Base_1_1"
          (rectangle (start -2 -2) (end 2 2) (stroke (width 0.254)) (fill (type none)))
          (pin passive line (at -5 0 0) (length 2.54)
            (name "IN" (effects (font (size 1 1))))
            (number "1" (effects (font (size 1 1))))))))
  `).units;
  const child = parseKicadSymbolSource(`
    (kicad_symbol_lib (version 20231120)
      (symbol "Child"
        (extends "Base")
        (symbol "Child_1_1"
          (circle (center 0 0) (end 1 0) (stroke (width 0.254)) (fill (type none)))
          (pin output line (at 5 0 180) (length 2.54)
            (name "OUT" (effects (font (size 1 1))))
            (number "2" (effects (font (size 1 1))))))))
  `);
  assert.equal(child.extendsName, "Base");
  const merged = mergeInheritedKicadUnits(parent, child.units);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].pins.length, 2);
  assert.equal(merged[0].graphics.length, 2);
  assert.deepEqual(merged[0].pins.map((pin) => pin.number), ["1", "2"]);
});

test("rejects truncated or malformed KiCad symbol expressions", () => {
  assert.throws(
    () => parseKicadSymbolSource('(kicad_symbol_lib (symbol "broken"'),
    /Unclosed list/,
  );
  assert.throws(
    () => parseKicadSymbolSource('(kicad_symbol_lib (version 20231120))'),
    /no symbol definition/,
  );
});

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

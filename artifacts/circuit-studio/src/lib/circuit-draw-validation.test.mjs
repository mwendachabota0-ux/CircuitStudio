import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { test } from "node:test";

const moduleStub = { exports: {} };
const source = readFileSync(new URL("../../public/circuit-draw.js", import.meta.url), "utf8");
runInNewContext(source, { module: moduleStub });
const CircuitDraw = moduleStub.exports;

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

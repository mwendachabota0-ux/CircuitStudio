import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import * as CircuitGeometry from "../../circuit-geometry/src/index.ts";

const moduleStub = { exports: {} };
const circuitDrawSource = readFileSync(
  new URL("../../../artifacts/circuit-studio/public/circuit-draw.js", import.meta.url),
  "utf8",
);
runInNewContext(circuitDrawSource, { module: moduleStub, CircuitGeometry });

export const CircuitDraw = moduleStub.exports;

export const legacyCircuitTools = {
  netlistWithMembership(spec, allowStructuralErrors) {
    return CircuitDraw.netlistWithMembership(spec, allowStructuralErrors);
  },
  validate(spec) {
    const report = CircuitDraw.validate(spec);
    return {
      errors: Array.from(report.errors ?? []),
      warnings: Array.from(report.warnings ?? []),
      topologyErrors: Array.from(report.topologyErrors ?? []),
    };
  },
};

export function readLegacyFixture(filename) {
  return JSON.parse(readFileSync(
    new URL(`../../../artifacts/circuit-studio/src/lib/fixtures/${filename}`, import.meta.url),
    "utf8",
  ));
}

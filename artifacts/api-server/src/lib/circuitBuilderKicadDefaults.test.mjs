import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getDefaultKicadSymbolIds,
  shouldSearchKicadLibrary,
} from "./circuitBuilderKicadDefaults.ts";

test("does not load KiCad defaults for generic Studio-library components", () => {
  assert.deepEqual(getDefaultKicadSymbolIds("draw a circuit"), []);
  assert.deepEqual(
    getDefaultKicadSymbolIds("battery, resistor, LED, diode, NPN, fuse, switch"),
    [],
  );
});

test("loads KiCad candidates for exact parts and named power symbols", () => {
  const ids = getDefaultKicadSymbolIds(
    "Make an NE555P astable flasher with a generic NPN and 5V rail.",
  );

  for (const id of ["Timer:NE555P", "power:+5V"]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
  assert.equal(ids.length, 2);
});

test("leaves generic transistor and MOSFET requests in the Studio library", () => {
  const ids = getDefaultKicadSymbolIds("Use a PNP transistor and an N-channel MOSFET.");

  assert.deepEqual(ids, []);
});

test("keeps a generic 555 request eligible for a KiCad fallback without choosing an exact model", () => {
  const ids = getDefaultKicadSymbolIds("Draw a 555 timer circuit with an op-amp.");

  assert.ok(!ids.includes("Timer:NE555P"));
  assert.ok(!ids.includes("Amplifier_Operational:LM358"));
});

test("searches Studio first and consults KiCad only when fallback may be needed", () => {
  assert.equal(
    shouldSearchKicadLibrary({
      context: "Build a battery-powered LED circuit with a resistor.",
      hasStudioMatch: true,
    }),
    false,
  );
  assert.equal(
    shouldSearchKicadLibrary({
      context: "Build a battery-powered LM358 circuit.",
      hasStudioMatch: true,
    }),
    true,
  );
  assert.equal(
    shouldSearchKicadLibrary({
      context: "Build a 555 timer circuit with an LED.",
      hasStudioMatch: true,
    }),
    true,
  );
  assert.equal(
    shouldSearchKicadLibrary({
      context: "Build a circuit.",
      hasStudioMatch: false,
    }),
    true,
  );
});

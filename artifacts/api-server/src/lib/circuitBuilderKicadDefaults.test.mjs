import assert from "node:assert/strict";
import { test } from "node:test";
import {
  getDefaultKicadSymbolIds,
  shouldSearchKicadLibrary,
} from "./circuitBuilderKicadDefaults.ts";

test("uses exact KiCad symbol assets for common library components", () => {
  assert.deepEqual(getDefaultKicadSymbolIds("draw a circuit"), []);
  const ids = getDefaultKicadSymbolIds(
    "battery-powered circuit with a resistor, LED, diode, NPN, fuse, and SPST switch",
  );
  for (const id of [
    "Device:Battery",
    "Device:R",
    "Device:LED",
    "Device:D",
    "Transistor_BJT:Q_NPN_BCE",
    "Device:Fuse",
    "Switch:SW_SPST",
  ]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
});

test("loads KiCad candidates for exact parts and named power symbols", () => {
  const ids = getDefaultKicadSymbolIds(
    "Make an NE555P astable flasher with a generic NPN and 5V rail.",
  );

  for (const id of [
    "Timer:NE555P",
    "power:+5V",
    "Transistor_BJT:Q_NPN_BCE",
  ]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
  assert.equal(ids.length, 3);
});

test("chooses exact library geometry for transistor polarity and MOSFET channel", () => {
  const ids = getDefaultKicadSymbolIds("Use a PNP transistor and an NMOSFET.");

  assert.ok(ids.includes("Transistor_BJT:Q_PNP_BCE"));
  assert.ok(ids.includes("Transistor_FET:Q_NMOS_GDS"));
  assert.ok(!ids.includes("Transistor_BJT:Q_NPN_BCE"));
  assert.ok(!ids.includes("Transistor_FET:Q_PMOS_GDS"));
});

test("uses polarized capacitors and explicit switch types from their library symbols", () => {
  const polarized = getDefaultKicadSymbolIds("Add an electrolytic capacitor.");
  assert.ok(polarized.includes("Device:C_Polarized"));
  assert.ok(polarized.includes("Device:C"));

  assert.ok(getDefaultKicadSymbolIds("Add a push button.").includes("Switch:SW_Push"));
  assert.ok(getDefaultKicadSymbolIds("Add an SPDT switch.").includes("Switch:SW_SPDT"));
});

test("uses exact library drawings for common adjustable, sensor, and signal parts", () => {
  const ids = getDefaultKicadSymbolIds(
    "Add a potentiometer, photoresistor, photodiode, crystal, microphone, and DC motor.",
  );
  for (const id of [
    "Device:R_Potentiometer",
    "Device:R_Photo",
    "Device:D_Photo",
    "Device:Crystal",
    "Device:Microphone",
    "Motor:Motor_DC",
  ]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
});

test("keeps a generic 555 request eligible for a KiCad fallback without choosing an exact model", () => {
  const ids = getDefaultKicadSymbolIds("Draw a 555 timer circuit with an op-amp.");

  assert.ok(!ids.includes("Timer:NE555P"));
  assert.ok(!ids.includes("Amplifier_Operational:LM358"));
});

test("searches KiCad when a canonical library symbol matches a requested part", () => {
  assert.equal(
    shouldSearchKicadLibrary({
      context: "Build a battery-powered LED circuit with a resistor.",
      hasStudioMatch: true,
    }),
    true,
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

import assert from "node:assert/strict";
import { test } from "node:test";
import { getDefaultKicadSymbolIds } from "./circuitBuilderKicadDefaults.ts";

test("offers common KiCad symbols for new circuit builds", () => {
  assert.deepEqual(getDefaultKicadSymbolIds("draw a circuit"), [
    "Device:R",
    "Device:C",
    "Device:LED",
    "power:GND",
  ]);
});

test("adds exact KiCad candidates that match the requested circuit parts", () => {
  const ids = getDefaultKicadSymbolIds(
    "Make an NE555 astable flasher with an electrolytic capacitor, NPN transistor, pushbutton, and 5V supply.",
  );

  for (const id of [
    "Device:R",
    "Device:C",
    "Device:LED",
    "power:GND",
    "Transistor_BJT:Q_NPN_BCE",
    "Device:C_Polarized",
    "Timer:NE555P",
    "Switch:SW_Push",
    "power:+5V",
  ]) {
    assert.ok(ids.includes(id), `expected ${id}`);
  }
});

test("offers PNP and MOSFET symbols without substituting another pinout", () => {
  const ids = getDefaultKicadSymbolIds("Use a PNP transistor and an N-channel MOSFET.");

  assert.ok(ids.includes("Transistor_BJT:Q_PNP_BCE"));
  assert.ok(ids.includes("Transistor_FET:Q_NMOS_GDS"));
  assert.ok(!ids.includes("Transistor_FET:Q_PMOS_GDS"));
});

test("does not choose a specific IC for a generic IC request", () => {
  const ids = getDefaultKicadSymbolIds("Draw a 555 timer circuit with an op-amp.");

  assert.ok(!ids.includes("Timer:NE555P"));
  assert.ok(!ids.includes("Amplifier_Operational:LM358"));
});

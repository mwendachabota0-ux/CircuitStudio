import assert from "node:assert/strict";
import { test } from "node:test";
import { isMainsChargerBuildRequest } from "./circuitBuilderSafety.ts";

test("recognizes a phone charger requested from regional mains voltage", () => {
  assert.equal(
    isMainsChargerBuildRequest("Design a standard phone charger from 220-240V AC mains."),
    true,
  );
  assert.equal(
    isMainsChargerBuildRequest("Make a USB charger that plugs directly into a 120 V AC wall outlet."),
    true,
  );
});

test("does not intercept a clearly low-voltage-only adapter-side design", () => {
  assert.equal(
    isMainsChargerBuildRequest(
      "Create a 5V low-voltage-only output-side schematic from an external certified adapter; do not include mains wiring.",
    ),
    false,
  );
});

test("does not intercept unrelated low-voltage projects", () => {
  assert.equal(
    isMainsChargerBuildRequest("Build a 5V LED flasher with a battery."),
    false,
  );
});

test("recognizes a mains-powered mobile charging request without a voltage number", () => {
  assert.equal(
    isMainsChargerBuildRequest("Draw a phone charger wired directly to household power."),
    true,
  );
});

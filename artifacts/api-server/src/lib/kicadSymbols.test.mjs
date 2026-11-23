import assert from "node:assert/strict";
import { test } from "node:test";
import {
  findRelevantKicadSymbols,
  findMentionedKicadSymbolIds,
  searchKicadSymbols,
} from "./kicadSymbols.ts";

test("browses the complete KiCad catalog in stable pages", async () => {
  const firstPage = await searchKicadSymbols("", "", 100, 0);
  const secondPage = await searchKicadSymbols("", "", 100, 100);

  assert.equal(firstPage.total, 22_911);
  assert.equal(firstPage.catalogTotal, 22_911);
  assert.equal(firstPage.results.length, 100);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.total, firstPage.total);
  assert.equal(secondPage.results.length, 100);
  assert.equal(secondPage.hasMore, true);
  assert.notEqual(firstPage.results[0].id, secondPage.results[0].id);

  const lastPage = await searchKicadSymbols("", "", 100, 22_900);
  assert.equal(lastPage.results.length, 11);
  assert.equal(lastPage.hasMore, false);
});

test("starts with a dedicated page of 100 common symbols", async () => {
  const commonPage = await searchKicadSymbols("", "", 100, 0, "", true);
  const catalogPage = await searchKicadSymbols("", "", 100, 0);

  assert.equal(commonPage.catalogTotal, 22_911);
  assert.equal(commonPage.total, 100);
  assert.equal(commonPage.results.length, 100);
  assert.equal(commonPage.hasMore, false);
  assert.deepEqual(
    commonPage.results.slice(0, 6).map((entry) => entry.id),
    [
      "Device:R",
      "Device:R_Small",
      "Device:C",
      "Device:C_Small",
      "Device:C_Polarized",
      "Device:L",
    ],
  );
  assert.equal(catalogPage.results.length, 100);
  assert.ok(catalogPage.families.includes("Semiconductors"));
});

test("finds symbol names through punctuation, aliases, and small typos", async () => {
  const negativeRail = await searchKicadSymbols("-10V", "", 100, 0);
  assert.equal(negativeRail.results[0].id, "power:-10V");

  const operationalAmplifier = await searchKicadSymbols("op amp", "", 100, 0);
  assert.ok(
    operationalAmplifier.results.some(
      (entry) => entry.library === "Amplifier_Operational",
    ),
  );

  const typo = await searchKicadSymbols("resitor", "", 100, 0);
  assert.ok(typo.results.some((entry) => entry.id === "Device:R"));
});

test("filters symbols by clear component family groups", async () => {
  const passives = await searchKicadSymbols("", "", 100, 0, "Passives");
  const semiconductors = await searchKicadSymbols(
    "",
    "",
    100,
    0,
    "Semiconductors",
  );

  assert.ok(passives.results.some((entry) => entry.id === "Device:R"));
  assert.ok(
    semiconductors.results.some((entry) => entry.id === "Device:LED"),
  );
  assert.ok(
    semiconductors.results.every(
      (entry) => !["Device:R", "Device:C"].includes(entry.id),
    ),
  );
});

test("fills missing function descriptions from related KiCad symbols", async () => {
  const ieeeLogic = await searchKicadSymbols("", "74xx_IEEE", 100, 0);
  const fallbackEntry = ieeeLogic.results.find((entry) => entry.id === "74xx_IEEE:7400");

  assert.ok(fallbackEntry);
  assert.match(fallbackEntry.description, /NAND/i);
  assert.ok(ieeeLogic.results.every((entry) => entry.description.trim().length > 0));

  const xilinx = await searchKicadSymbols("", "FPGA_Xilinx", 100, 0);
  assert.ok(xilinx.results.every((entry) => entry.description.trim().length > 0));
});

test("serves cleaned short, long, and keyword descriptions with honest review status", async () => {
  const transistorResults = await searchKicadSymbols("2N3904", "", 10, 0);
  const transistor = transistorResults.results.find(
    (entry) => entry.id === "Transistor_BJT:2N3904",
  );

  assert.ok(transistor);
  assert.match(transistor.shortDescription, /Small Signal NPN Transistor/i);
  assert.match(transistor.longDescription, /pin count is not recorded/i);
  assert.deepEqual(transistor.keywords.split(", "), ["NPN", "Transistor", "2n3904"]);
  assert.equal(transistor.researchStatus, "catalog_reference");

  const needsReviewResults = await searchKicadSymbols(
    "4001",
    "4xxx_IEEE",
    10,
    0,
  );
  const needsReview = needsReviewResults.results.find(
    (entry) => entry.id === "4xxx_IEEE:4001",
  );
  assert.ok(needsReview);
  assert.equal(needsReview.researchStatus, "needs_review");
  assert.match(needsReview.longDescription, /has not been verified/i);
});

test("matches explicitly named parts to exact KiCad catalog symbols", async () => {
  const ids = await findMentionedKicadSymbolIds(
    "Draw this using an LM358 and a BC547 transistor.",
  );

  assert.deepEqual(ids, [
    "Amplifier_Operational:LM358",
    "Transistor_BJT:BC547",
  ]);
  assert.deepEqual(await findMentionedKicadSymbolIds("Use a 5V supply with R1 and C1."), []);
});

test("discovers relevant symbols across the full catalog for planning and builds", async () => {
  const preamp = await findRelevantKicadSymbols([
    "I want to amplify a microphone using a low-noise audio preamp.",
  ]);
  assert.ok(preamp.some((entry) => entry.id === "Amplifier_Audio:SSM2165"));

  const temperature = await findRelevantKicadSymbols([
    "Choose a temperature sensor to switch on a fan.",
    "Temperature sensing and fan control",
  ]);
  assert.ok(temperature.some((entry) => entry.library === "Sensor_Temperature"));
  assert.ok(temperature.some((entry) => entry.library === "Motor"));

  const commonOnly = await findRelevantKicadSymbols([
    "Please help me draw a circuit and show the symbols.",
  ]);
  assert.deepEqual(commonOnly, []);
});

test("uses component-purpose aliases to search catalog descriptions", async () => {
  const darknessSensor = await searchKicadSymbols("darkness", "", 20);
  assert.ok(
    darknessSensor.results.some((entry) =>
      /photo|light sensor|photodiode/i.test(
        `${entry.name} ${entry.description} ${entry.keywords}`,
      )
    ),
  );
});

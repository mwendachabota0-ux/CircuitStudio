import assert from "node:assert/strict";
import { test } from "node:test";
import { searchKicadSymbols } from "./kicadSymbols.ts";

test("browses the complete KiCad catalog in stable pages", async () => {
  const firstPage = await searchKicadSymbols("", "", 40, 0);
  const secondPage = await searchKicadSymbols("", "", 40, 40);

  assert.equal(firstPage.total, 22_911);
  assert.equal(firstPage.results.length, 40);
  assert.equal(firstPage.hasMore, true);
  assert.equal(secondPage.total, firstPage.total);
  assert.equal(secondPage.results.length, 40);
  assert.equal(secondPage.hasMore, true);
  assert.notEqual(firstPage.results[0].id, secondPage.results[0].id);

  const lastPage = await searchKicadSymbols("", "", 40, firstPage.total - 1);
  assert.equal(lastPage.results.length, 1);
  assert.equal(lastPage.hasMore, false);
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

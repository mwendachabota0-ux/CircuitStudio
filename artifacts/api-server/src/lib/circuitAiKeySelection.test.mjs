import assert from "node:assert/strict";
import { test } from "node:test";
import { orderKeysAfter } from "./circuitAiKeySelection.ts";

test("continues with the next configured AI key and wraps after the last key", () => {
  const keys = [{ number: 1 }, { number: 3 }, { number: 5 }];

  assert.deepEqual(orderKeysAfter(keys, 3), [
    { number: 5 },
    { number: 1 },
    { number: 3 },
  ]);
  assert.deepEqual(orderKeysAfter(keys, 5), [
    { number: 1 },
    { number: 3 },
    { number: 5 },
  ]);
});

test("uses the only configured key when no alternative exists", () => {
  assert.deepEqual(orderKeysAfter([{ number: 2 }], 2), [{ number: 2 }]);
});

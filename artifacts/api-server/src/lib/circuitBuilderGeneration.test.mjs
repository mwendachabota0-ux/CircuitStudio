import assert from "node:assert/strict";
import { test } from "node:test";
import {
  generateWithThinkingBudgetFallback,
  getBuilderThinkingBudgets,
} from "./circuitBuilderGeneration.ts";

test("retries MAX_TOKENS output once with a lower thinking budget", async () => {
  const budgets = [];
  const responses = [
    { finishReason: "MAX_TOKENS", text: '{"answer":' },
    { finishReason: "STOP", text: '{"answer":"ready"}' },
  ];

  const result = await generateWithThinkingBudgetFallback({
    budgets: getBuilderThinkingBudgets(false),
    generate: async (thinkingBudget) => {
      budgets.push(thinkingBudget);
      return responses.shift();
    },
    isMaxTokens: (response) => response.finishReason === "MAX_TOKENS",
    getPartialOutput: (response) => response.text,
  });

  assert.deepEqual(budgets, [1024, 512]);
  assert.deepEqual(result.attemptedBudgets, [1024, 512]);
  assert.equal(result.response.finishReason, "STOP");
});

test("format repair uses lower thinking budgets than the original request", () => {
  assert.deepEqual(getBuilderThinkingBudgets(true), [512, 256]);
});

test("does not spend a fallback call when generation finishes normally", async () => {
  const budgets = [];
  const result = await generateWithThinkingBudgetFallback({
    budgets: getBuilderThinkingBudgets(false),
    generate: async (thinkingBudget) => {
      budgets.push(thinkingBudget);
      return { finishReason: "STOP" };
    },
    isMaxTokens: (response) => response.finishReason === "MAX_TOKENS",
    getPartialOutput: () => undefined,
  });

  assert.deepEqual(budgets, [1024]);
  assert.deepEqual(result.attemptedBudgets, [1024]);
});

test("hands truncated output to the next-key continuation with a lower thinking budget", async () => {
  const calls = [];
  const responses = [
    { finishReason: "MAX_TOKENS", text: '{"answer":"partial work' },
    { finishReason: "STOP", text: '{"answer":"complete response"}' },
  ];

  const result = await generateWithThinkingBudgetFallback({
    budgets: getBuilderThinkingBudgets(false),
    generate: async (thinkingBudget, continuation) => {
      calls.push({ thinkingBudget, continuation });
      return responses.shift();
    },
    isMaxTokens: (response) => response.finishReason === "MAX_TOKENS",
    getPartialOutput: (response) => response.text,
  });

  assert.deepEqual(calls, [
    { thinkingBudget: 1024, continuation: null },
    {
      thinkingBudget: 512,
      continuation: { partialOutput: '{"answer":"partial work' },
    },
  ]);
  assert.equal(result.response.finishReason, "STOP");
});

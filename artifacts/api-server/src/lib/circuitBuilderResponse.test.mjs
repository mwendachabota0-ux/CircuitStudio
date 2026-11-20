import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeCircuitBuilderResponse } from "./circuitBuilderResponse.ts";

const brief = {
  goal: "Keep the existing goal",
  requirements: ["Use 5V"],
  assumptions: [],
  openQuestions: [],
};

test("a chat answer ignores an irrelevant malformed proposal", () => {
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer: "Hi! What would you like to work on?",
    brief,
    proposal: { spec: { elements: [{ type: "ic" }] } },
  }, brief);

  assert.deepEqual(result, {
    nextMode: "chat",
    answer: "Hi! What would you like to work on?",
    brief,
  });
});

test("missing or partial brief fields preserve the supplied notes", () => {
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer: "Let's discuss it.",
    brief: { requirements: ["new note"] },
  }, brief);

  assert.deepEqual(result, {
    nextMode: "chat",
    answer: "Let's discuss it.",
    brief: {
      goal: brief.goal,
      requirements: ["new note"],
      assumptions: brief.assumptions,
      openQuestions: brief.openQuestions,
    },
  });
});

test("build proposals are retained for strict schema and circuit validation", () => {
  const proposal = { summary: "Draft", spec: { title: "Draft", elements: [] } };
  const result = normalizeCircuitBuilderResponse({
    nextMode: "build",
    answer: "Here is a draft.",
    brief,
    proposal,
  }, brief);

  assert.equal(result.proposal, proposal);
});

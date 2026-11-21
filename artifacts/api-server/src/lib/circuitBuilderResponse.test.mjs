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

test("model output cannot set the server-owned build approval marker", () => {
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer: "What would you like to work on?",
    brief,
    buildApprovalRequested: true,
  }, brief);

  assert.equal("buildApprovalRequested" in result, false);
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

test("valid suggested actions survive response normalization", () => {
  const suggestedActions = [
    {
      label: "Draft a safe low-voltage stage",
      prompt: "Create an educational schematic using only a certified 5V DC adapter.",
    },
  ];
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer: "I can help with a safer low-voltage version.",
    brief,
    suggestedActions,
  }, brief);

  assert.deepEqual(result.suggestedActions, suggestedActions);
});

test("question suggestions must be linked to the exact question being asked", () => {
  const answer = "What is the current draw of your 24V DC motor?";
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer,
    brief,
    suggestedActions: [
      {
        label: "Use a transistor instead",
        prompt: "Use a transistor instead.",
        replyTo: "Should this use a transistor?",
      },
      {
        label: "I'll check the motor label",
        prompt: "I don't know the current draw yet. I'll check the motor label or datasheet.",
        replyTo: answer,
      },
      {
        label: "Guess a current",
        prompt: "Assume the motor draws 2A.",
      },
    ],
  }, brief);

  assert.deepEqual(result.suggestedActions, [{
    label: "I'll check the motor label",
    prompt: "I don't know the current draw yet. I'll check the motor label or datasheet.",
    replyTo: answer,
  }]);
});

test("question replies without an exact question link are removed", () => {
  const result = normalizeCircuitBuilderResponse({
    nextMode: "chat",
    answer: "What is the current draw of your 24V DC motor?",
    brief,
    suggestedActions: [
      {
        label: "Use a transistor instead",
        prompt: "Use a transistor instead.",
      },
    ],
  }, brief);

  assert.equal("suggestedActions" in result, false);
});

test("malformed and excess suggested actions are removed or capped", () => {
  const result = normalizeCircuitBuilderResponse({
    answer: "Choose a supported alternative.",
    brief,
    suggestedActions: [
      { label: " Good action ", prompt: " Keep the prompt " },
      { label: "", prompt: "Missing a label" },
      { label: "Second", prompt: "Second prompt" },
      { label: "Third", prompt: "This one is capped" },
    ],
  }, brief);

  assert.deepEqual(result.suggestedActions, [
    { label: "Good action", prompt: "Keep the prompt" },
    { label: "Second", prompt: "Second prompt" },
  ]);
});

test("memory updates are normalized and capped to two concise assumptions", () => {
  const result = normalizeCircuitBuilderResponse({
    answer: "Understood.",
    brief,
    memoryUpdates: [
      {
        id: 7,
        category: "work-style",
        content: "  Prefers concise answers.  ",
      },
      {
        category: "design-decision",
        content: "Use a sequential chase for the LED flasher.",
      },
      {
        category: "unknown",
        content: "This category is not allowed.",
      },
    ],
    memoryRemovals: [7, 7, -2, "8"],
  }, brief);

  assert.deepEqual(result.memoryUpdates, [
    {
      id: 7,
      category: "work-style",
      content: "Prefers concise answers.",
    },
    {
      category: "design-decision",
      content: "Use a sequential chase for the LED flasher.",
    },
  ]);
  assert.deepEqual(result.memoryRemovals, [7]);
});

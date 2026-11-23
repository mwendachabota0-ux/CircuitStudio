import assert from "node:assert/strict";
import { test } from "node:test";
import {
  BUILD_PERMISSION_QUESTION,
  enforceBuildPermission,
} from "./circuitBuilderPermission.ts";

const brief = { goal: "Switch a motor", requirements: [], assumptions: [], openQuestions: [] };
const proposal = { summary: "Motor driver", spec: { title: "Motor driver", elements: [] } };

test("holds a Chat proposal until Build mode is manually selected", () => {
  const result = enforceBuildPermission({
    nextMode: "build",
    answer: "Here is the draft.",
    brief,
    proposal,
  }, "chat", [], "I need a 24V motor switch.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.proposal, undefined);
  assert.equal(result.answer, BUILD_PERMISSION_QUESTION);
  assert.equal(result.buildApprovalRequested, true);
  assert.deepEqual(result.suggestedActions, []);
});

test("strips a proposal even when the model labels its response as Chat", () => {
  const result = enforceBuildPermission({
    nextMode: "chat",
    answer: "Here is a draft.",
    brief,
    proposal,
  }, "chat", [], "Please draw a motor controller.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.proposal, undefined);
  assert.equal(result.answer, BUILD_PERMISSION_QUESTION);
  assert.equal(result.buildApprovalRequested, true);
  assert.deepEqual(result.suggestedActions, []);
});

test("keeps clarification in Chat without asking for build approval early", () => {
  const answer = "What is the motor's current draw?";
  const result = enforceBuildPermission({
    nextMode: "build",
    answer,
    brief,
  }, "chat", [], "I need a 24V motor switch.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.answer, answer);
  assert.equal(result.buildApprovalRequested, undefined);
});

test("allows proposals only for a Build-mode request", () => {
  const response = { nextMode: "build", answer: "Here is the draft.", brief, proposal };
  assert.equal(enforceBuildPermission(response, "build", [], "Build it."), response);
});

test("an affirmative reply in Chat still waits for a manual Build click", () => {
  const result = enforceBuildPermission({
    nextMode: "build",
    answer: "Here is the draft.",
    brief,
    proposal,
  }, "chat", [{ role: "assistant", content: BUILD_PERMISSION_QUESTION }], "Yes, go ahead.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.proposal, undefined);
  assert.equal(result.answer, BUILD_PERMISSION_QUESTION);
  assert.equal(result.buildApprovalRequested, true);
});

test("a declined permission request does not ask again or expose a proposal", () => {
  const result = enforceBuildPermission({
    nextMode: "build",
    answer: "Here is the draft.",
    brief,
    proposal,
  }, "chat", [{ role: "assistant", content: BUILD_PERMISSION_QUESTION }], "Not yet, keep discussing.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.proposal, undefined);
  assert.equal(result.buildApprovalRequested, undefined);
  assert.match(result.answer, /won't create a schematic yet/);
});

test("tags a direct model-written permission question for the client", () => {
  const result = enforceBuildPermission({
    nextMode: "chat",
    answer: `I can make a draft. ${BUILD_PERMISSION_QUESTION}`,
    brief,
  }, "chat", [], "I want a motor controller.");

  assert.equal(result.nextMode, "chat");
  assert.equal(result.buildApprovalRequested, true);
  assert.deepEqual(result.suggestedActions, []);
});

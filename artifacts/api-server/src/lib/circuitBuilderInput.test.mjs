import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ChatWithCircuitBuilderBody,
  SyncCircuitBuilderHistoryBody,
} from "../../../../lib/api-zod/src/generated/api.ts";

const longMessage = "Describe the circuit requirement in detail. ".repeat(500);
const circuitSpec = {
  title: "Long prompt test",
  elements: [{ type: "ground", id: "GND1", at: [100, 100] }],
};
const brief = {
  goal: "",
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

test("builder accepts messages longer than the previous character cap", () => {
  const result = ChatWithCircuitBuilderBody.safeParse({
    message: longMessage,
    mode: "chat",
    currentSpec: circuitSpec,
  });

  assert.equal(result.success, true);
});

test("account history accepts and preserves long builder messages", () => {
  const result = SyncCircuitBuilderHistoryBody.safeParse({
    sessions: [{
      id: "long-message-session",
      title: "Long prompt test",
      createdAt: 1,
      updatedAt: 2,
      mode: "chat",
      saved: {
        brief,
        aiBrief: brief,
        messages: [{
          id: "long-message",
          role: "user",
          content: longMessage,
          createdAt: 1,
        }],
      },
      currentSpec: circuitSpec,
    }],
  });

  assert.equal(result.success, true);
  if (result.success) {
    assert.equal(result.data.sessions[0].saved.messages[0].content, longMessage);
  }
});

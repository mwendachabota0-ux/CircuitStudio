import assert from "node:assert/strict";
import { test } from "node:test";
import {
  formatCircuitBuilderMemoryContext,
  normalizeCircuitBuilderMemoryContent,
  selectRelevantCircuitBuilderMemories,
} from "./circuitBuilderMemory.ts";

const memories = [
  {
    id: 1,
    category: "work-style",
    content: "Prefers concise explanations with one question at a time.",
    updatedAt: new Date("2026-01-01T00:00:00Z"),
  },
  {
    id: 2,
    category: "design-decision",
    content: "For LED flasher builds, prefers a simple sequential chase.",
    updatedAt: new Date("2026-02-01T00:00:00Z"),
  },
  {
    id: 3,
    category: "past-context",
    content: "The greenhouse controller is powered by a 12V battery.",
    updatedAt: new Date("2026-03-01T00:00:00Z"),
  },
];

test("memory retrieval keeps work style but only adds matching circuit context", () => {
  const relevant = selectRelevantCircuitBuilderMemories(
    memories,
    "I want to build another LED flasher with a sequential chase.",
  );

  assert.deepEqual(relevant.map((memory) => memory.id), [1, 2]);
});

test("unrelated new topics do not inherit old build context", () => {
  const relevant = selectRelevantCircuitBuilderMemories(
    memories,
    "Can you explain how voltage and current differ?",
  );

  assert.deepEqual(relevant.map((memory) => memory.id), [1]);
});

test("memory prompt labels saved items as tentative assumptions", () => {
  const prompt = formatCircuitBuilderMemoryContext(memories.slice(0, 1));
  assert.match(prompt, /tentative/i);
  assert.match(prompt, /current message overrides it/i);
  assert.ok(prompt.includes("[1 | work-style]"));
});

test("memory text is whitespace-normalized and capped", () => {
  assert.equal(normalizeCircuitBuilderMemoryContent("  Use   a  555 timer.  "), "Use a 555 timer.");
  assert.equal(normalizeCircuitBuilderMemoryContent("x".repeat(350)).length, 300);
});

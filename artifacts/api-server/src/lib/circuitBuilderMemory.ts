export type CircuitBuilderMemoryCategory =
  | "work-style"
  | "design-decision"
  | "past-context";

export type CircuitBuilderMemoryRecord = {
  id: number;
  category: CircuitBuilderMemoryCategory;
  content: string;
  updatedAt: Date;
};

export type CircuitBuilderMemorySuggestion = {
  id?: number;
  category: CircuitBuilderMemoryCategory;
  content: string;
};

export function isCircuitBuilderMemoryCategory(
  value: unknown,
): value is CircuitBuilderMemoryCategory {
  return value === "work-style" ||
    value === "design-decision" ||
    value === "past-context";
}

const MAX_CONTEXT_MEMORIES = 6;
const MAX_WORK_STYLE_MEMORIES = 3;
const STOP_WORDS = new Set([
  "about", "after", "again", "also", "and", "are", "because", "been",
  "before", "being", "between", "build", "builder", "circuit", "circuits",
  "could", "does", "from", "have", "into", "just", "like", "more", "most",
  "need", "next", "only", "other", "please", "same", "should", "that",
  "their", "them", "then", "there", "these", "they", "this", "those",
  "through", "want", "were", "what", "when", "where", "which", "while",
  "will", "with", "would", "your",
]);

function tokenize(value: string): Set<string> {
  return new Set(
    value
      .toLocaleLowerCase()
      .match(/[a-z0-9+#.-]{2,}/g)
      ?.filter((term) => !STOP_WORDS.has(term)) ?? [],
  );
}

function recency(left: CircuitBuilderMemoryRecord, right: CircuitBuilderMemoryRecord): number {
  return right.updatedAt.getTime() - left.updatedAt.getTime();
}

export function normalizeCircuitBuilderMemoryContent(value: string): string {
  return value.normalize("NFKC").trim().replace(/\s+/g, " ").slice(0, 300);
}

export function selectRelevantCircuitBuilderMemories(
  memories: CircuitBuilderMemoryRecord[],
  currentContext: string,
): CircuitBuilderMemoryRecord[] {
  const workStyle = memories
    .filter((memory) => memory.category === "work-style")
    .sort(recency)
    .slice(0, MAX_WORK_STYLE_MEMORIES);
  const workStyleIds = new Set(workStyle.map((memory) => memory.id));
  const contextTerms = tokenize(currentContext);

  const relevant = memories
    .filter(
      (memory) =>
        memory.category !== "work-style" &&
        !workStyleIds.has(memory.id) &&
        contextTerms.size > 0,
    )
    .map((memory) => {
      const terms = tokenize(memory.content);
      const overlap = [...terms].filter((term) => contextTerms.has(term)).length;
      return { memory, overlap, total: Math.max(terms.size, 1) };
    })
    .filter((entry) => entry.overlap > 0)
    .sort((left, right) => {
      const scoreDifference =
        right.overlap / right.total - left.overlap / left.total;
      return scoreDifference || recency(left.memory, right.memory);
    })
    .slice(0, MAX_CONTEXT_MEMORIES - workStyle.length)
    .map((entry) => entry.memory);

  return [...workStyle, ...relevant];
}

export function formatCircuitBuilderMemoryContext(
  memories: CircuitBuilderMemoryRecord[],
): string {
  if (memories.length === 0) return "";
  const lines = memories.map(
    (memory) => `- [${memory.id} | ${memory.category}] ${memory.content}`,
  );
  return [
    "Saved assumptions from earlier chats (use only when relevant):",
    ...lines,
    "Treat every item as tentative, not as a fact. The user's current message overrides it. If the topic is new, do not force old context into the conversation. The user can correct, edit, or remove these assumptions.",
  ].join("\n");
}

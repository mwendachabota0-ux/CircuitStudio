type BuilderBrief = {
  goal: string;
  requirements: string[];
  assumptions: string[];
  openQuestions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function normalizeBriefList(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  return value
    .filter((item): item is string => typeof item === "string")
    .slice(0, 12)
    .map((item) => item.slice(0, 300));
}

function getFinalQuestion(answer: string): string | null {
  const text = answer.trim().replace(/[”"')\]]+\s*$/, "").trim();
  const questionEnd = text.lastIndexOf("?");
  if (questionEnd < 0 || text.slice(questionEnd + 1).trim()) return null;

  const beforeQuestion = text.slice(0, questionEnd);
  const sentenceBoundary = Math.max(
    beforeQuestion.lastIndexOf("."),
    beforeQuestion.lastIndexOf("!"),
    beforeQuestion.lastIndexOf("\n"),
    beforeQuestion.lastIndexOf("?"),
  );
  const question = text.slice(sentenceBoundary + 1, questionEnd + 1).trim();
  return question || null;
}

function normalizeQuestion(value: string): string {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function normalizeSuggestedActions(
  value: unknown,
  finalQuestion: string | null,
): Array<{ label: string; prompt: string; replyTo?: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter(
      (item) =>
        typeof item.label === "string" &&
        item.label.trim().length > 0 &&
        typeof item.prompt === "string" &&
        item.prompt.trim().length > 0 &&
        (!finalQuestion ||
          (typeof item.replyTo === "string" &&
            normalizeQuestion(item.replyTo) === normalizeQuestion(finalQuestion))),
    )
    .slice(0, 2)
    .map((item) => ({
      label: (item.label as string).trim().slice(0, 90),
      prompt: (item.prompt as string).trim().slice(0, 1000),
      ...(finalQuestion ? { replyTo: finalQuestion } : {}),
    }));
}

function normalizeMemoryUpdates(value: unknown): Array<{
  id?: number;
  category: "work-style" | "design-decision" | "past-context";
  content: string;
}> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter(
      (item) =>
        (item.category === "work-style" ||
          item.category === "design-decision" ||
          item.category === "past-context") &&
        typeof item.content === "string" &&
        item.content.trim().length > 0,
    )
    .slice(0, 2)
    .map((item) => ({
      ...(Number.isInteger(item.id) && (item.id as number) > 0
        ? { id: item.id as number }
        : {}),
      category: item.category as "work-style" | "design-decision" | "past-context",
      content: (item.content as string).trim().replace(/\s+/g, " ").slice(0, 300),
    }));
}

function normalizeMemoryRemovals(value: unknown): number[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter(
    (id): id is number => Number.isInteger(id) && id > 0,
  ))].slice(0, 10);
}

export function normalizeCircuitBuilderResponse(
  value: unknown,
  fallbackBrief: BuilderBrief,
): unknown {
  if (!isRecord(value)) return value;
  const response = { ...value };
  // This is set by the server after enforcing the build-permission boundary.
  delete response.buildApprovalRequested;
  const modelBrief = isRecord(response.brief) ? response.brief : {};

  response.brief = {
    goal: typeof modelBrief.goal === "string"
      ? modelBrief.goal.slice(0, 1000)
      : fallbackBrief.goal,
    requirements: normalizeBriefList(modelBrief.requirements, fallbackBrief.requirements),
    assumptions: normalizeBriefList(modelBrief.assumptions, fallbackBrief.assumptions),
    openQuestions: normalizeBriefList(modelBrief.openQuestions, fallbackBrief.openQuestions),
  };
  if ("memoryUpdates" in response) {
    response.memoryUpdates = normalizeMemoryUpdates(response.memoryUpdates);
  }
  if ("memoryRemovals" in response) {
    response.memoryRemovals = normalizeMemoryRemovals(response.memoryRemovals);
  }

  const finalQuestion = typeof response.answer === "string"
    ? getFinalQuestion(response.answer)
    : null;
  const suggestedActions = normalizeSuggestedActions(
    response.suggestedActions,
    finalQuestion,
  );
  if (suggestedActions.length > 0) {
    response.suggestedActions = suggestedActions;
  } else {
    delete response.suggestedActions;
  }

  // Chat replies never stage proposals. Drop one before schema validation so
  // an irrelevant malformed draft cannot turn a simple conversational reply
  // into a format error.
  if (response.nextMode === "chat") delete response.proposal;
  return response;
}

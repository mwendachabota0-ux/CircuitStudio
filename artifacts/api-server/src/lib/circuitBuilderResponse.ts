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

function normalizeSuggestedActions(
  value: unknown,
): Array<{ label: string; prompt: string }> {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is Record<string, unknown> => isRecord(item))
    .filter(
      (item) =>
        typeof item.label === "string" &&
        item.label.trim().length > 0 &&
        typeof item.prompt === "string" &&
        item.prompt.trim().length > 0,
    )
    .slice(0, 2)
    .map((item) => ({
      label: (item.label as string).trim().slice(0, 90),
      prompt: (item.prompt as string).trim().slice(0, 1000),
    }));
}

export function normalizeCircuitBuilderResponse(
  value: unknown,
  fallbackBrief: BuilderBrief,
): unknown {
  if (!isRecord(value)) return value;
  const response = { ...value };
  const modelBrief = isRecord(response.brief) ? response.brief : {};

  response.brief = {
    goal: typeof modelBrief.goal === "string"
      ? modelBrief.goal.slice(0, 1000)
      : fallbackBrief.goal,
    requirements: normalizeBriefList(modelBrief.requirements, fallbackBrief.requirements),
    assumptions: normalizeBriefList(modelBrief.assumptions, fallbackBrief.assumptions),
    openQuestions: normalizeBriefList(modelBrief.openQuestions, fallbackBrief.openQuestions),
  };

  const suggestedActions = normalizeSuggestedActions(response.suggestedActions);
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

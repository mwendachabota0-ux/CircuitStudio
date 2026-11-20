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

  // Chat replies never stage proposals. Drop one before schema validation so
  // an irrelevant malformed draft cannot turn a simple conversational reply
  // into a format error.
  if (response.nextMode === "chat") delete response.proposal;
  return response;
}

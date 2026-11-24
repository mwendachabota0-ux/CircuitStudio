type BuilderBrief = {
  goal: string;
  requirements: string[];
  assumptions: string[];
  openQuestions: string[];
};

const MAX_PROPOSAL_INTENT_NETS = 60;
const INTENT_SIZE_NOTICE =
  "Notice: Intent checking was skipped because the proposal exceeded an intent size limit (60 nets, 12 pins per net, or 24 characters per pin).";

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

function normalizeProposalIntent(value: unknown): string[][] | undefined {
  if (!Array.isArray(value) || value.length > MAX_PROPOSAL_INTENT_NETS) return undefined;
  const intent: string[][] = [];
  for (const net of value) {
    if (!Array.isArray(net) || net.length > 12) return undefined;
    const pins: string[] = [];
    for (const pin of net) {
      if (typeof pin !== 'string' || pin.length < 1 || pin.length > 24) {
        return undefined;
      }
      pins.push(pin);
    }
    intent.push(pins);
  }
  if (!intent.some((net) => new Set(net).size >= 2)) return undefined;
  return intent;
}

function proposalIntentExceedsSizeLimit(value: unknown): boolean {
  return Array.isArray(value) && (
    value.length > MAX_PROPOSAL_INTENT_NETS ||
    value.some((net) =>
      Array.isArray(net) &&
      (net.length > 12 || net.some((pin) => typeof pin === "string" && pin.length > 24)),
    )
  );
}

function addIntentSizeNotice(answer: unknown): string {
  const source = typeof answer === "string" ? answer.trim() : "";
  if (source.includes(INTENT_SIZE_NOTICE)) return source.slice(0, 3000);

  const finalQuestion = getFinalQuestion(source);
  if (finalQuestion) {
    const beforeQuestion = source.slice(0, source.lastIndexOf(finalQuestion)).trimEnd();
    const questionBudget = Math.max(0, 3000 - INTENT_SIZE_NOTICE.length - 4);
    const safeQuestion = finalQuestion.slice(-questionBudget);
    const suffix = `\n\n${INTENT_SIZE_NOTICE}\n\n${safeQuestion}`;
    const available = Math.max(0, 3000 - suffix.length);
    return `${beforeQuestion.slice(0, available).trimEnd()}${suffix}`;
  }

  const suffix = `\n\n${INTENT_SIZE_NOTICE}`;
  const available = Math.max(0, 3000 - suffix.length);
  return `${source.slice(0, available).trimEnd()}${suffix}`;
}

export function normalizeCircuitBuilderResponse(
  value: unknown,
  fallbackBrief: BuilderBrief,
): unknown {
  if (!isRecord(value)) return value;
  const response = { ...value };
  // This is set by the server after enforcing the build-permission boundary.
  delete response.buildApprovalRequested;
  if (isRecord(response.proposal)) {
    const proposal = { ...response.proposal };
    const intentWasDroppedForSize = proposalIntentExceedsSizeLimit(proposal.intent);
    const intent = normalizeProposalIntent(proposal.intent);
    if (intent === undefined) {
      delete proposal.intent;
    } else {
      proposal.intent = intent;
    }
    response.proposal = proposal;
    if (intentWasDroppedForSize && response.nextMode !== "chat") {
      response.answer = addIntentSizeNotice(response.answer);
    }
  }
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
  if (typeof response.repairLesson === "string") {
    response.repairLesson = response.repairLesson.trim().replace(/\s+/g, " ").slice(0, 300);
    if (!response.repairLesson) response.repairLesson = null;
  } else if (response.repairLesson !== null) {
    delete response.repairLesson;
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

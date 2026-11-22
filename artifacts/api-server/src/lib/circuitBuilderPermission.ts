type BuilderMode = "chat" | "build";
type BuilderHistoryItem = { role: "user" | "assistant"; content: string };
type BuilderResponse = {
  nextMode?: BuilderMode;
  answer: string;
  proposal?: unknown;
  suggestedActions?: Array<{ label: string; prompt: string; replyTo?: string }>;
  buildApprovalRequested?: boolean;
};

export const BUILD_PERMISSION_QUESTION =
  "Would you like me to switch to Build and prepare an editable schematic now?";

const BUILD_PERMISSION_ACTIONS = [
  {
    label: "Yes, prepare a draft",
    prompt: "Yes, please switch to Build and prepare an editable schematic for the circuit we discussed.",
    replyTo: BUILD_PERMISSION_QUESTION,
  },
  {
    label: "Not yet",
    prompt: "Not yet. Keep discussing the circuit with me in Chat; do not create a schematic.",
    replyTo: BUILD_PERMISSION_QUESTION,
  },
];

function isBuildPermissionQuestion(text: string): boolean {
  return text.trim().toLowerCase().endsWith(BUILD_PERMISSION_QUESTION.toLowerCase());
}

function isBuildPermissionDecline(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[’]/g, "'");
  return /^(?:no|nope|not yet|not now|wait|hold on|later)\b/.test(normalized) ||
    /\b(?:don't|do not)\s+(?:build|create|draft|make)\b/.test(normalized) ||
    /\bkeep (?:it )?(?:in )?chat\b|\bkeep discussing\b/.test(normalized);
}

export function enforceBuildPermission<T extends BuilderResponse>(
  response: T,
  requestedMode: BuilderMode,
  history: BuilderHistoryItem[],
  latestUserMessage: string,
): T & BuilderResponse {
  if (requestedMode === "build") return response;

  const result = {
    ...response,
    nextMode: "chat",
  } as T & BuilderResponse;
  const previousMessage = history.at(-1);
  const approvalWasPending =
    previousMessage?.role === "assistant" &&
    isBuildPermissionQuestion(previousMessage.content);

  if (approvalWasPending && isBuildPermissionDecline(latestUserMessage)) {
    delete result.proposal;
    delete result.suggestedActions;
    delete result.buildApprovalRequested;
    result.answer =
      "Understood. I'll stay in Chat and won't create a schematic yet.";
    return result;
  }

  if (response.nextMode === "build" && response.proposal) {
    delete result.proposal;
    result.answer = BUILD_PERMISSION_QUESTION;
    result.suggestedActions = BUILD_PERMISSION_ACTIONS;
    result.buildApprovalRequested = true;
    return result;
  }

  if (response.nextMode === "build") {
    delete result.proposal;
    delete result.buildApprovalRequested;
    return result;
  }

  if (isBuildPermissionQuestion(response.answer)) {
    delete result.proposal;
    result.suggestedActions = BUILD_PERMISSION_ACTIONS;
    result.buildApprovalRequested = true;
  }

  return result;
}

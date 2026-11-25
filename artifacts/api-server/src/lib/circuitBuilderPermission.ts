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
  "This request is on standby. Click Build mode above when you're ready, and I'll start the schematic.";

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

  if (response.proposal) {
    delete result.proposal;
    result.answer = BUILD_PERMISSION_QUESTION;
    result.suggestedActions = [];
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
    result.suggestedActions = [];
    result.buildApprovalRequested = true;
  }

  delete result.proposal;
  return result;
}

function normalize(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'").trim();
}

export function isExplicitBuildRequest(text: string): boolean {
  const message = normalize(text);
  const directCircuitAction =
    '(?:build|draw|create|generate|draft|prepare|sketch|design|add|include|insert|remove|delete|move|connect|change|adjust|set|fix|redraw|reroute|replace|update|modify)';
  if (
    !message ||
    /\b(?:don't|do not|not yet|not now|wait|hold off|not ready)\b/.test(message) ||
    /^(?:how|why|what|when|where)\b/.test(message) ||
    /\b(?:explain|teach me|tell me how|show me how)\b[\s\S]*\b(?:build|draw|create|generate|draft|design)\b/.test(message)
  ) {
    return false;
  }

  const directActionPattern = new RegExp(`^(?:please\\s+)?${directCircuitAction}\\b`);
  const requestedActionPattern = new RegExp(
    `^(?:(?:can|could|would) you|i want you to|i'd like you to)\\s+(?:please\\s+)?${directCircuitAction}\\b`,
  );
  const suggestedActionPattern = new RegExp(`^(?:let's|lets)\\s+${directCircuitAction}\\b`);
  const objectActionPattern = new RegExp(`\\b${directCircuitAction}\\s+(?:it|this|that|one)\\b`);
  return directActionPattern.test(message) ||
    requestedActionPattern.test(message) ||
    suggestedActionPattern.test(message) ||
    objectActionPattern.test(message) ||
    /\b(?:build|draw|create|generate|draft|prepare|sketch|design)\b.{0,80}\b(?:circuit|schematic|diagram|drawing|draft|layout)\b/.test(message);
}

export function isBuildApprovalDeclined(text: string): boolean {
  const message = normalize(text);
  return /^(?:no|nope|not yet|not now|wait|hold on|later)\b/.test(message) ||
    /\b(?:not yet|not now|wait|hold off)\b/.test(message) ||
    /\b(?:don't|do not)\s+(?:build|create|draft|make)\b/.test(message) ||
    /\bkeep (?:it )?(?:in )?chat\b|\bkeep discussing\b/.test(message);
}

export function isExplicitBuildApproval(
  text: string,
  approvalIsPending: boolean,
): boolean {
  if (!approvalIsPending || isBuildApprovalDeclined(text)) return false;
  const message = normalize(text);
  return /^(?:yes|yeah|yep|sure|okay|ok|sounds good|that works|go ahead|please do|do it|build it|create it|draw it|generate it|draft it|let's do it|lets do it)\b/.test(message) ||
    isExplicitBuildRequest(message);
}

export function enforceBuilderResponseMode<
  T extends { nextMode?: 'chat' | 'build'; proposal?: unknown },
>(
  response: T,
  requestedMode: 'chat' | 'build',
): T {
  if (requestedMode === 'build') return response;
  const guardedResponse = { ...response, nextMode: 'chat' as const } as T;
  delete (guardedResponse as { proposal?: unknown }).proposal;
  return guardedResponse;
}

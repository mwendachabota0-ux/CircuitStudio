function normalize(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'").trim();
}

export function isExplicitBuildRequest(text: string): boolean {
  const message = normalize(text);
  if (
    !message ||
    /\b(?:don't|do not|not yet|not now|wait|hold off|not ready)\b/.test(message) ||
    /^(?:how|why|what|when|where)\b/.test(message) ||
    /\b(?:explain|teach me|tell me how|show me how)\b[\s\S]*\b(?:build|draw|create|generate|draft|design)\b/.test(message)
  ) {
    return false;
  }

  return /^(?:please\s+)?(?:build|draw|create|generate|draft|prepare|sketch|design)\b/.test(message) ||
    /^(?:(?:can|could|would) you|i want you to|i'd like you to)\s+(?:please\s+)?(?:build|draw|create|generate|draft|prepare|sketch|design)\b/.test(message) ||
    /^(?:let's|lets)\s+(?:build|draw|create|generate|draft|prepare|sketch|design)\b/.test(message) ||
    /\b(?:build|draw|create|generate|draft|prepare|sketch|design)\s+(?:it|this|that|one)\b/.test(message) ||
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

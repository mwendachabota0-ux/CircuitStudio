function normalize(text: string): string {
  return text.toLowerCase().replace(/[’]/g, "'").trim();
}

export function isBuildApprovalDeclined(text: string): boolean {
  const message = normalize(text);
  return /^(?:no|nope|not yet|not now|wait|hold on|later)\b/.test(message) ||
    /\b(?:not yet|not now|wait|hold off)\b/.test(message) ||
    /\b(?:don't|do not)\s+(?:build|create|draft|make)\b/.test(message) ||
    /\bkeep (?:it )?(?:in )?chat\b|\bkeep discussing\b/.test(message);
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

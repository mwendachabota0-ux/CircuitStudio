export type CircuitBuilderMode = 'chat' | 'build';

export function getLocalBuilderModeIntent(text: string): CircuitBuilderMode | null {
  const normalized = text
    .toLowerCase()
    .replace(/[’]/g, "'")
    .replace(/[.!?,]+$/g, '')
    .trim();

  if (/^(?:please\s+)?(?:turn|switch|change|go)(?:\s+me)?\s+to(?:\s+the)?\s+build(?:\s+mode)?$/.test(normalized)
    || normalized === 'build mode') return 'build';
  if (/^(?:please\s+)?(?:turn|switch|change|go)(?:\s+me)?\s+to(?:\s+the)?\s+chat(?:\s+mode)?$/.test(normalized)
    || normalized === 'chat mode') return 'chat';

  // Circuit intent is semantic and context-dependent; let the AI classify
  // ordinary messages instead of guessing from individual words here.
  return null;
}

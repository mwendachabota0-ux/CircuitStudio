export type CircuitBuilderMode = 'chat' | 'build';

const buildModeCommand =
  /^(?:(?:let['’]s|lets)\s+)?(?:go ahead and\s+|and\s+)?(?:build|make|create|draw|generate)\b/;
const buildRequestQuestion =
  /^(?:can|could|will|would)\s+you\s+(?:please\s+)?(?:build|make|create|draw|generate)\b/;

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

  // Do not treat questions about building or requests to wait as a build command.
  if (/^(?:how\b|why\b|what if\b|should i\b|don't\b|do not\b|never\b|not yet\b|wait\b|hold off\b|stop\b)/.test(normalized)) {
    return null;
  }

  const withoutAcknowledgement = normalized.replace(
    /^(?:(?:okay|ok|sure|yes|great|alright|all right|sounds good|please|go ahead)[,\s]+)+/,
    '',
  );
  if (buildModeCommand.test(withoutAcknowledgement) || buildRequestQuestion.test(withoutAcknowledgement)) {
    return 'build';
  }
  return null;
}

export type BuilderHistoryMode = 'chat' | 'build';

export type BuilderHistorySession<SavedState, CircuitSpec> = {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mode: BuilderHistoryMode;
  saved: SavedState;
  currentSpec: CircuitSpec;
};

export type BuilderHistoryMemoryExcerpt = {
  title: string;
  context: string;
};

type HistoryMessage = { role: string; content: string };

function cleanExcerptText(value: unknown, limit: number): string {
  return typeof value === 'string'
    ? value.replace(/\s+/g, ' ').trim().slice(0, limit)
    : '';
}

export function getBuilderHistoryMemoryExcerpts<SavedState, CircuitSpec>(
  sessions: readonly BuilderHistorySession<SavedState, CircuitSpec>[],
): BuilderHistoryMemoryExcerpt[] {
  return sessions.flatMap((session) => {
    const saved = session.saved as {
      brief?: {
        goal?: unknown;
        requirements?: unknown;
        assumptions?: unknown;
        openQuestions?: unknown;
      };
      messages?: readonly HistoryMessage[];
    };
    const brief = saved.brief;
    const goal = cleanExcerptText(brief?.goal, 700);
    const requirements = Array.isArray(brief?.requirements)
      ? brief.requirements
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 5)
          .map((item) => cleanExcerptText(item, 180))
      : [];
    const assumptions = Array.isArray(brief?.assumptions)
      ? brief.assumptions
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 5)
          .map((item) => cleanExcerptText(item, 180))
      : [];
    const openQuestions = Array.isArray(brief?.openQuestions)
      ? brief.openQuestions
          .filter((item): item is string => typeof item === 'string')
          .slice(0, 3)
          .map((item) => cleanExcerptText(item, 180))
      : [];
    const userStatements = (saved.messages ?? [])
      .filter((message) => message.role === 'user')
      .slice(-8)
      .map((message) => cleanExcerptText(message.content, 260))
      .filter(Boolean);
    const spec = session.currentSpec as {
      title?: unknown;
      elements?: unknown;
    } | null;
    const circuitTitle = cleanExcerptText(spec?.title, 120);
    const circuitElements = Array.isArray(spec?.elements)
      ? spec.elements.filter(
          (element): element is Record<string, unknown> =>
            !!element && typeof element === 'object' && !Array.isArray(element),
        )
      : [];
    const componentSummary = circuitElements
      .filter(
        (element) =>
          typeof element.type === 'string' &&
          !['wire', 'text', 'line', 'rectangle', 'circle'].includes(element.type),
      )
      .slice(0, 16)
      .map((element) =>
        [
          cleanExcerptText(element.type, 40),
          cleanExcerptText(element.label, 60),
          cleanExcerptText(element.value, 80),
          cleanExcerptText(element.symbolId, 80),
        ].filter(Boolean).join(' '),
      )
      .filter(Boolean);
    const buildSummary = [
      circuitTitle ? `Circuit: ${circuitTitle}` : '',
      componentSummary.length ? `Components: ${componentSummary.join('; ')}` : '',
    ].filter(Boolean).join('\n');

    if (
      !goal &&
      requirements.length === 0 &&
      assumptions.length === 0 &&
      openQuestions.length === 0 &&
      userStatements.length === 0
    ) {
      return [];
    }

    const sections = [
      goal ? `Goal: ${goal}` : '',
      requirements.length ? `Requirements: ${requirements.join('; ')}` : '',
      assumptions.length ? `Prior assumptions: ${assumptions.join('; ')}` : '',
      openQuestions.length ? `Open questions: ${openQuestions.join('; ')}` : '',
      buildSummary,
      userStatements.length ? `Recent user statements: ${userStatements.join(' | ')}` : '',
    ].filter(Boolean);

    return [{
      title: cleanExcerptText(session.title, 160) || 'Circuit conversation',
      context: sections.join('\n').slice(0, 3000),
    }];
  }).slice(0, 12);
}

export function getBuilderHistoryTitle(messages: readonly HistoryMessage[]): string {
  const firstUserMessage = messages.find((message) => message.role === 'user');
  const title = firstUserMessage?.content.replace(/\s+/g, ' ').trim();
  if (!title) return 'New conversation';
  return title.length > 64 ? `${title.slice(0, 61).trimEnd()}…` : title;
}

export function getBuilderHistoryPreview(messages: readonly HistoryMessage[]): string {
  const latestMessage = messages.at(-1)?.content.replace(/\s+/g, ' ').trim();
  if (!latestMessage) return 'No messages yet';
  return latestMessage.length > 100 ? `${latestMessage.slice(0, 97).trimEnd()}…` : latestMessage;
}

export function createBuilderHistorySession<SavedState, CircuitSpec>({
  id,
  saved,
  currentSpec,
  mode,
  now = Date.now(),
  createdAt = now,
}: {
  id: string;
  saved: SavedState;
  currentSpec: CircuitSpec;
  mode: BuilderHistoryMode;
  now?: number;
  createdAt?: number;
}): BuilderHistorySession<SavedState, CircuitSpec> {
  const messages = (saved as { messages?: readonly HistoryMessage[] }).messages ?? [];
  return {
    id,
    title: getBuilderHistoryTitle(messages),
    createdAt,
    updatedAt: now,
    mode,
    saved,
    currentSpec,
  };
}

export function upsertBuilderHistorySession<SavedState, CircuitSpec>(
  sessions: readonly BuilderHistorySession<SavedState, CircuitSpec>[],
  nextSession: BuilderHistorySession<SavedState, CircuitSpec>,
): BuilderHistorySession<SavedState, CircuitSpec>[] {
  return [
    nextSession,
    ...sessions.filter((session) => session.id !== nextSession.id),
  ].sort((left, right) => right.updatedAt - left.updatedAt);
}

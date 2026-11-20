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

type HistoryMessage = { role: string; content: string };

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

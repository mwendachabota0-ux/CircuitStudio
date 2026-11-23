export type QuestionLinkedAction = {
  replyTo?: string;
};

export function getFinalAssistantQuestion(answer: string): string | null {
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

export function getContextualSuggestedActions<T extends QuestionLinkedAction>(
  answer: string,
  actions: T[],
): T[] {
  const question = getFinalAssistantQuestion(answer);
  if (!question) return actions.filter((action) => !action.replyTo);

  const normalizedQuestion = normalizeQuestion(question);
  return actions.filter(
    (action) =>
      typeof action.replyTo === "string" &&
      normalizeQuestion(action.replyTo) === normalizedQuestion,
  );
}

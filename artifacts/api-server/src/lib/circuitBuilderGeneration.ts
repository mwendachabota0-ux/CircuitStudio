export const DEFAULT_BUILDER_THINKING_BUDGET = 1024;
export const RESPONSE_RETRY_THINKING_BUDGET = 512;
export const FORMAT_RETRY_THINKING_BUDGET = 512;
export const FORMAT_RETRY_FALLBACK_THINKING_BUDGET = 256;

export type BuilderContinuation = { partialOutput: string };

export function getBuilderThinkingBudgets(responseFormatRetry: boolean): readonly [number, number] {
  return responseFormatRetry
    ? [FORMAT_RETRY_THINKING_BUDGET, FORMAT_RETRY_FALLBACK_THINKING_BUDGET]
    : [DEFAULT_BUILDER_THINKING_BUDGET, RESPONSE_RETRY_THINKING_BUDGET];
}

export async function generateWithThinkingBudgetFallback<T>(options: {
  budgets: readonly [number, number];
  generate: (
    thinkingBudget: number,
    continuation: BuilderContinuation | null,
  ) => Promise<T>;
  isMaxTokens: (response: T) => boolean;
  getPartialOutput: (response: T) => string | undefined;
}): Promise<{ response: T; attemptedBudgets: number[] }> {
  const [initialBudget, fallbackBudget] = options.budgets;
  const initialResponse = await options.generate(initialBudget, null);
  if (!options.isMaxTokens(initialResponse)) {
    return { response: initialResponse, attemptedBudgets: [initialBudget] };
  }

  const fallbackResponse = await options.generate(fallbackBudget, {
    partialOutput: options.getPartialOutput(initialResponse) ?? "",
  });
  return {
    response: fallbackResponse,
    attemptedBudgets: [initialBudget, fallbackBudget],
  };
}

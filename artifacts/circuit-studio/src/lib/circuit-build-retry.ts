import type {
  CircuitBuildChatInput,
  CircuitDesignBrief,
} from '@workspace/api-client-react';

export const MAX_AUTO_RETRIES = 2;

export type BuildRetryKind = 'generation' | 'repair' | 'format';
export type BuildRetryPolicy = { retryable: boolean; delayMs?: number };
export type BuildValidation = { errors: string[]; warnings: string[] };
export type BuildProposalInspection = {
  validation: BuildValidation;
  canRepair: boolean;
};

export type BuildAttemptFailureKind = 'generation' | 'validation' | 'output';
export type CircuitBuildMode = CircuitBuildChatInput['mode'];

export function getModeAfterFailedRequest(
  currentMode: CircuitBuildMode,
  requestMode: CircuitBuildMode,
): CircuitBuildMode {
  return requestMode === 'build' ? 'build' : currentMode;
}

export class CircuitBuildAttemptError extends Error {
  readonly retryCount: number;
  readonly canRetryManually: boolean;
  readonly failureKind: BuildAttemptFailureKind;
  readonly validationFindings: string[];
  readonly rejectedProposal: unknown;
  readonly cause: unknown;

  constructor(options: {
    retryCount: number;
    canRetryManually: boolean;
    failureKind: BuildAttemptFailureKind;
    cause?: unknown;
    validationFindings?: string[];
    rejectedProposal?: unknown;
  }) {
    super('Circuit build attempts did not produce a usable result.');
    this.name = 'CircuitBuildAttemptError';
    this.retryCount = options.retryCount;
    this.canRetryManually = options.canRetryManually;
    this.failureKind = options.failureKind;
    this.validationFindings = options.validationFindings ?? [];
    this.rejectedProposal = options.rejectedProposal;
    this.cause = options.cause;
  }
}

function readHeader(source: unknown, name: string): string | null {
  if (!source || typeof source !== 'object') return null;

  const get = (source as { get?: unknown }).get;
  if (typeof get === 'function') {
    const value = (get as (headerName: string) => string | null).call(source, name);
    if (value) return value;
  }

  const match = Object.entries(source as Record<string, unknown>)
    .find(([key]) => key.toLowerCase() === name.toLowerCase());
  return typeof match?.[1] === 'string' || typeof match?.[1] === 'number'
    ? String(match[1])
    : null;
}

function getErrorHeader(error: unknown, name: string): string | null {
  if (!error || typeof error !== 'object') return null;
  const record = error as { headers?: unknown; response?: { headers?: unknown } };
  return readHeader(record.headers, name) ?? readHeader(record.response?.headers, name);
}

export function getRetryAfterMs(error: unknown): number | undefined {
  const value = getErrorHeader(error, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

export function getBuildRetryPolicy(error: unknown): BuildRetryPolicy {
  const explicitRetryability = getErrorHeader(error, 'x-circuit-ai-retryable');
  const delayMs = getRetryAfterMs(error);
  if (explicitRetryability === 'false') return { retryable: false };
  if (explicitRetryability === 'true') return { retryable: true, delayMs };

  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 429) return { retryable: delayMs !== undefined, delayMs };
    if (status === 408 || status === 425 || (status >= 500 && status <= 599 && status !== 501 && status !== 505)) {
      return { retryable: true, delayMs };
    }
  }

  if (
    error instanceof TypeError &&
    /failed to fetch|fetch failed|network|connection reset|connection lost|socket hang up|timed? ?out|econnreset|etimedout/i.test(error.message)
  ) {
    return { retryable: true };
  }
  if (error instanceof Error && /failed to fetch|fetch failed|network|connection reset|connection lost|socket hang up|timed? ?out|econnreset|etimedout/i.test(error.message)) {
    return { retryable: true };
  }
  return { retryable: false };
}

export function isInvalidModelOutput(error: unknown): boolean {
  return getErrorHeader(error, 'x-circuit-ai-output-invalid') === 'true';
}

export function waitBeforeRetry(attempt: number, providerDelayMs?: number): Promise<void> {
  const delayMs = providerDelayMs ?? Math.min(4_000, 600 * (2 ** (attempt - 1)));
  return new Promise((resolve) => globalThis.setTimeout(resolve, delayMs));
}

export function shouldClearSubmittedDraft(
  draftRevisionAtStart: number,
  currentDraftRevision: number,
  currentDraft: string,
  submittedMessage: string,
): boolean {
  return currentDraftRevision === draftRevisionAtStart &&
    currentDraft.trim() === submittedMessage;
}

export function buildRepairMessage(findings: string[]): string {
  const preamble = 'The supplied current CircuitSpec is the last failing AI proposal, not the user’s workbench draft. Edit that proposal in place. Fix every validator finding below and return a complete corrected CircuitSpec:';
  const footer = 'Preserve the requested behavior and avoid unrelated changes. Do not return the previous invalid coordinates.';
  const included: string[] = [];
  let length = preamble.length + footer.length + 2;
  for (const finding of findings) {
    const line = `- ${finding.slice(0, 240)}`;
    if (length + line.length + 1 > 5_850) {
      included.push(`- ${findings.length - included.length} additional validation finding(s) were omitted; repair all remaining structural issues.`);
      break;
    }
    included.push(line);
    length += line.length + 1;
  }
  return `${preamble}\n${included.join('\n')}\n${footer}`.slice(0, 6_000);
}

export function buildRepairRequest(
  originalRequest: CircuitBuildChatInput,
  brief: CircuitDesignBrief,
  findings: string[],
  failingProposal: CircuitBuildChatInput['currentSpec'] = originalRequest.currentSpec,
): CircuitBuildChatInput {
  const history = [
    ...(originalRequest.history ?? []),
    { role: 'user' as const, content: originalRequest.message },
  ].slice(-8);

  return {
    ...originalRequest,
    mode: 'build',
    responseFormatRetry: false,
    currentSpec: failingProposal,
    brief,
    history,
    message: buildRepairMessage(findings),
  };
}

export function buildOutputRepairRequest(
  originalRequest: CircuitBuildChatInput,
): CircuitBuildChatInput {
  const history = [
    ...(originalRequest.history ?? []),
    { role: 'user' as const, content: originalRequest.message },
  ].slice(-8);

  return {
    ...originalRequest,
    responseFormatRetry: true,
    history,
    message: 'The previous attempt did not match Circuit Studio’s required response format. Answer the original latest request again using the included conversation, design brief, and current CircuitSpec. Return exactly one valid JSON object with the required fields. In Build mode, include a complete supported CircuitSpec when the request is clear enough. Do not add Markdown fences or extra fields.',
  };
}

export async function runCircuitBuildAttempts<TRequest, TResponse, TProposal, TInspection extends BuildProposalInspection>(
  options: {
    initialRequest: TRequest;
    send: (request: TRequest) => Promise<TResponse>;
    getProposal: (response: TResponse) => TProposal | null | undefined;
    inspectProposal: (proposal: TProposal) => TInspection;
    makeRepairRequest: (response: TResponse, findings: string[]) => TRequest;
    makeOutputRepairRequest?: (request: TRequest) => TRequest;
    onResponse?: (response: TResponse) => void;
    onRetry?: (attempt: number, kind: BuildRetryKind) => void;
    wait?: (attempt: number, providerDelayMs?: number) => Promise<void>;
  },
): Promise<{ response: TResponse; proposalInspection: TInspection | null; request: TRequest }> {
  let retries = 0;
  let workingRequest = options.initialRequest;
  let outputRepairAttempted = false;
  let lastInvalidProposal: TProposal | null = null;

  while (true) {
    let response: TResponse;
    try {
      response = await options.send(workingRequest);
    } catch (cause) {
      if (isInvalidModelOutput(cause)) {
        if (
          !outputRepairAttempted &&
          options.makeOutputRepairRequest &&
          retries < MAX_AUTO_RETRIES
        ) {
          outputRepairAttempted = true;
          retries += 1;
          options.onRetry?.(retries, 'format');
          await (options.wait ?? waitBeforeRetry)(retries);
          workingRequest = options.makeOutputRepairRequest(workingRequest);
          continue;
        }
        throw new CircuitBuildAttemptError({
          retryCount: retries,
          canRetryManually: true,
          failureKind: 'output',
          cause,
          rejectedProposal: lastInvalidProposal ?? undefined,
        });
      }

      const policy = getBuildRetryPolicy(cause);
      if (policy.retryable && retries < MAX_AUTO_RETRIES) {
        retries += 1;
        options.onRetry?.(retries, 'generation');
        await (options.wait ?? waitBeforeRetry)(retries, policy.delayMs);
        continue;
      }
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: policy.retryable,
        failureKind: 'generation',
        cause,
        rejectedProposal: lastInvalidProposal ?? undefined,
      });
    }

    options.onResponse?.(response);
    const proposal = options.getProposal(response);
    if (proposal == null) {
      return { response, proposalInspection: null, request: workingRequest };
    }

    const proposalInspection = options.inspectProposal(proposal);
    const findings = [
      ...proposalInspection.validation.errors,
      ...proposalInspection.validation.warnings,
    ];
    if (findings.length === 0) return { response, proposalInspection, request: workingRequest };
    lastInvalidProposal = proposal;

    if (!proposalInspection.canRepair) {
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: false,
        failureKind: 'validation',
        validationFindings: findings,
        rejectedProposal: proposal,
      });
    }
    if (retries >= MAX_AUTO_RETRIES) {
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: true,
        failureKind: 'validation',
        validationFindings: findings,
        rejectedProposal: proposal,
      });
    }

    retries += 1;
    options.onRetry?.(retries, 'repair');
    await (options.wait ?? waitBeforeRetry)(retries);
    workingRequest = options.makeRepairRequest(response, findings);
  }
}

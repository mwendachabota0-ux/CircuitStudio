import type {
  CircuitBuildChatInput,
  CircuitDesignBrief,
} from '@workspace/api-client-react';

export const MAX_AUTO_RETRIES = 3;

export type BuildRetryKind = 'generation' | 'repair' | 'format';
export type BuildRetryPolicy = { retryable: boolean; delayMs?: number };
export type BuildValidation = { errors: string[]; warnings: string[] };
export type BuildProposalInspection = {
  validation: BuildValidation;
  canRepair: boolean;
};

export function classifyProposalValidation(validation: BuildValidation): BuildValidation {
  const requiresLayoutRepair = (warning: string) =>
    warning.includes('is diagonal;') || warning.includes('has a zero-length segment');
  const layoutFindings = validation.warnings.filter(requiresLayoutRepair);
  return {
    errors: [...validation.errors, ...layoutFindings.map((finding) => `Drawing-quality issue: ${finding}`)],
    warnings: validation.warnings.filter((warning) => !requiresLayoutRepair(warning)),
  };
}

export type BuildAttemptFailureKind = 'generation' | 'validation' | 'output';
export type CircuitBuildMode = CircuitBuildChatInput['mode'];
export type RepairAttemptOutcome = 'reconstructed' | 'validated' | 'rejected' | 'exhausted';
export type RepairAttemptDiagnostic = {
  attempt: number;
  outcome: RepairAttemptOutcome;
  nonWireElementsModified: boolean;
  metadataModified: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

type ProtectedCircuitChanges = {
  nonWireElementsModified: boolean;
  metadataModified: boolean;
};

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
  readonly validationWarnings: string[];
  readonly repairAttemptCount: number;
  readonly repairDiagnostics: RepairAttemptDiagnostic[];
  readonly rejectedProposal: unknown;
  readonly cause: unknown;

  constructor(options: {
    retryCount: number;
    canRetryManually: boolean;
    failureKind: BuildAttemptFailureKind;
    cause?: unknown;
    validationFindings?: string[];
    validationWarnings?: string[];
    repairAttemptCount?: number;
    repairDiagnostics?: RepairAttemptDiagnostic[];
    rejectedProposal?: unknown;
  }) {
    super('Circuit build attempts did not produce a usable result.');
    this.name = 'CircuitBuildAttemptError';
    this.retryCount = options.retryCount;
    this.canRetryManually = options.canRetryManually;
    this.failureKind = options.failureKind;
    this.validationFindings = options.validationFindings ?? [];
    this.validationWarnings = options.validationWarnings ?? [];
    this.repairAttemptCount = options.repairAttemptCount ?? 0;
    this.repairDiagnostics = options.repairDiagnostics ?? [];
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
    if (status === 429) return { retryable: true, delayMs };
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
  const footer = 'Preserve every non-wire element exactly, including all positions and orientations. Do not redesign the layout; only add, remove, reroute, or snap wires. Preserve the requested behavior.';
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

function canonicalizeElement(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeElement);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalizeElement(item)]),
  );
}

function getNonWireElementsSignature(
  spec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): string {
  const protectedElements = spec.elements
    .filter((element) => element.type !== 'wire')
    .map((element) => JSON.stringify(canonicalizeElement(element)))
    .sort();
  return JSON.stringify(protectedElements);
}

export function getNonWireElementSignature(
  spec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): string {
  return getNonWireElementsSignature(spec);
}

function getMetadataSignature(
  spec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): string {
  const { elements: _elements, ...metadata } = spec;
  return JSON.stringify(canonicalizeElement(metadata));
}

export function getProtectedCircuitSignature(
  spec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): string {
  return JSON.stringify({
    metadata: getMetadataSignature(spec),
    nonWireElements: getNonWireElementsSignature(spec),
  });
}

export function getProtectedCircuitChanges(
  protectedSpec: NonNullable<CircuitBuildChatInput['currentSpec']>,
  proposedSpec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): ProtectedCircuitChanges {
  return {
    metadataModified: getMetadataSignature(protectedSpec) !== getMetadataSignature(proposedSpec),
    nonWireElementsModified:
      getNonWireElementsSignature(protectedSpec) !== getNonWireElementsSignature(proposedSpec),
  };
}

export function restoreProtectedNonWireElements(
  protectedSpec: NonNullable<CircuitBuildChatInput['currentSpec']>,
  proposedSpec: NonNullable<CircuitBuildChatInput['currentSpec']>,
): NonNullable<CircuitBuildChatInput['currentSpec']> {
  const { elements: protectedElements, ...protectedMetadata } = protectedSpec;
  return {
    ...protectedMetadata,
    elements: [
      ...protectedElements.filter((element) => element.type !== 'wire'),
      ...proposedSpec.elements.filter((element) => element.type === 'wire'),
    ],
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
    prepareResponse?: (response: TResponse) => TResponse;
    initialProtectedSpec?: TProposal;
    getProtectedCircuitSignature?: (proposal: TProposal) => string;
    getProtectedCircuitChanges?: (protectedSpec: TProposal, proposal: TProposal) => ProtectedCircuitChanges;
    restoreProtectedSpec?: (response: TResponse, protectedSpec: TProposal) => TResponse;
    makeRepairRequest: (response: TResponse, findings: string[]) => TRequest;
    makeOutputRepairRequest?: (request: TRequest) => TRequest;
    onResponse?: (response: TResponse) => void;
    onRetry?: (attempt: number, kind: BuildRetryKind) => void;
    wait?: (attempt: number, providerDelayMs?: number) => Promise<void>;
  },
): Promise<{
  response: TResponse;
  proposalInspection: TInspection | null;
  request: TRequest;
  repairAttemptCount: number;
  repairDiagnostics: RepairAttemptDiagnostic[];
}> {
  let retries = 0;
  let workingRequest = options.initialRequest;
  let outputRepairAttempted = false;
  let lastInvalidProposal: TProposal | null = null;
  let protectedSpec = options.initialProtectedSpec;
  let protectedCircuitSignature = protectedSpec !== undefined && options.getProtectedCircuitSignature
    ? options.getProtectedCircuitSignature(protectedSpec)
    : undefined;
  let isRepairAttempt = protectedSpec !== undefined;
  let repairAttemptCount = isRepairAttempt ? 1 : 0;
  const repairDiagnostics: RepairAttemptDiagnostic[] = [];

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
          repairAttemptCount,
          repairDiagnostics: isRepairAttempt
            ? [
                ...repairDiagnostics,
                {
                  attempt: repairAttemptCount,
                  outcome: 'rejected',
                  nonWireElementsModified: false,
                  metadataModified: false,
                  validationErrors: [],
                  validationWarnings: [],
                },
              ]
            : repairDiagnostics,
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
        canRetryManually: true,
        failureKind: 'generation',
        cause,
        rejectedProposal: lastInvalidProposal ?? undefined,
        repairAttemptCount,
        repairDiagnostics: isRepairAttempt
          ? [
              ...repairDiagnostics,
              {
                attempt: repairAttemptCount,
                outcome: 'rejected',
                nonWireElementsModified: false,
                metadataModified: false,
                validationErrors: [],
                validationWarnings: [],
              },
            ]
          : repairDiagnostics,
      });
    }

    let proposal = options.getProposal(response);
    if (proposal == null) {
      if (isRepairAttempt) {
        repairDiagnostics.push({
          attempt: repairAttemptCount,
          outcome: 'rejected',
          nonWireElementsModified: false,
          metadataModified: false,
          validationErrors: [],
          validationWarnings: [],
        });
      }
      options.onResponse?.(response);
      return {
        response,
        proposalInspection: null,
        request: workingRequest,
        repairAttemptCount,
        repairDiagnostics,
      };
    }

    if (protectedSpec === undefined) {
      protectedSpec = proposal;
      protectedCircuitSignature = options.getProtectedCircuitSignature?.(protectedSpec);
    }

    const protectedChanges = protectedSpec !== undefined && options.getProtectedCircuitChanges
      ? options.getProtectedCircuitChanges(protectedSpec, proposal)
      : { nonWireElementsModified: false, metadataModified: false };
    const signatureChanged = protectedCircuitSignature !== undefined &&
      options.getProtectedCircuitSignature &&
      options.getProtectedCircuitSignature(proposal) !== protectedCircuitSignature;
    if (signatureChanged && !options.restoreProtectedSpec) {
      const diagnostic = isRepairAttempt
        ? {
            attempt: repairAttemptCount,
            outcome: 'rejected' as const,
            ...protectedChanges,
            validationErrors: [],
            validationWarnings: [],
          }
        : undefined;
      if (diagnostic) repairDiagnostics.push(diagnostic);
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: true,
        failureKind: 'validation',
        validationFindings: ['The protected CircuitSpec could not be reconstructed before validation.'],
        rejectedProposal: proposal,
        repairAttemptCount,
        repairDiagnostics,
      });
    }

    if (protectedSpec !== undefined && options.restoreProtectedSpec) {
      response = options.restoreProtectedSpec(response, protectedSpec);
    }
    response = options.prepareResponse?.(response) ?? response;
    proposal = options.getProposal(response);
    options.onResponse?.(response);
    if (proposal == null) {
      if (isRepairAttempt) {
        repairDiagnostics.push({
          attempt: repairAttemptCount,
          outcome: 'rejected',
          ...protectedChanges,
          validationErrors: [],
          validationWarnings: [],
        });
      }
      return {
        response,
        proposalInspection: null,
        request: workingRequest,
        repairAttemptCount,
        repairDiagnostics,
      };
    }

    if (
      protectedCircuitSignature !== undefined &&
      options.getProtectedCircuitSignature &&
      options.getProtectedCircuitSignature(proposal) !== protectedCircuitSignature
    ) {
      const diagnostic = isRepairAttempt
        ? {
            attempt: repairAttemptCount,
            outcome: 'rejected' as const,
            ...protectedChanges,
            validationErrors: [],
            validationWarnings: [],
          }
        : undefined;
      if (diagnostic) repairDiagnostics.push(diagnostic);
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: true,
        failureKind: 'validation',
        validationFindings: ['The reconstructed CircuitSpec did not preserve its immutable baseline.'],
        rejectedProposal: proposal,
        repairAttemptCount,
        repairDiagnostics,
      });
    }

    const proposalInspection = options.inspectProposal(proposal);
    // Warnings are advisory layout notes. Only blocking validation errors
    // should consume automatic repair attempts or prevent a proposal staging.
    const findings = proposalInspection.validation.errors;
    const diagnostic: RepairAttemptDiagnostic | undefined = isRepairAttempt
      ? {
          attempt: repairAttemptCount,
          outcome: 'reconstructed',
          ...protectedChanges,
          validationErrors: findings,
          validationWarnings: proposalInspection.validation.warnings,
        }
      : undefined;
    if (diagnostic) repairDiagnostics.push(diagnostic);

    if (findings.length === 0) {
      if (diagnostic) diagnostic.outcome = 'validated';
      return {
        response,
        proposalInspection,
        request: workingRequest,
        repairAttemptCount,
        repairDiagnostics,
      };
    }
    lastInvalidProposal = proposal;

    if (!proposalInspection.canRepair) {
      if (diagnostic) diagnostic.outcome = 'rejected';
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: true,
        failureKind: 'validation',
        validationFindings: findings,
        validationWarnings: proposalInspection.validation.warnings,
        repairAttemptCount,
        repairDiagnostics,
        rejectedProposal: proposal,
      });
    }
    if (retries >= MAX_AUTO_RETRIES) {
      if (diagnostic) diagnostic.outcome = 'exhausted';
      throw new CircuitBuildAttemptError({
        retryCount: retries,
        canRetryManually: true,
        failureKind: 'validation',
        validationFindings: findings,
        validationWarnings: proposalInspection.validation.warnings,
        repairAttemptCount,
        repairDiagnostics,
        rejectedProposal: proposal,
      });
    }

    retries += 1;
    options.onRetry?.(retries, 'repair');
    await (options.wait ?? waitBeforeRetry)(retries);
    workingRequest = options.makeRepairRequest(response, findings);
    repairAttemptCount += 1;
    isRepairAttempt = true;
  }
}

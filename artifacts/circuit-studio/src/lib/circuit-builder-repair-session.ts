export type RepairRecoveryStatus = 'idle' | 'running' | 'staged' | 'rejected';
export type RepairRecoveryRetryKind = 'generation' | 'repair' | 'format';
export type RepairRecoveryDiagnosticOutcome =
  | 'reconstructed'
  | 'validated'
  | 'rejected'
  | 'exhausted'
  | 'stopped';

export type RepairRecoveryValidation = {
  errors: string[];
  warnings: string[];
  topologyErrors?: string[];
  topologyWarnings?: string[];
};

export type RepairRecoveryFeedback = {
  message: string;
  canRetryManually: boolean;
  validationFindings?: string[];
  validationWarnings?: string[];
};

export type RepairRecoveryDiagnostic = {
  attempt: number;
  outcome: RepairRecoveryDiagnosticOutcome;
  nonWireElementsModified: boolean;
  metadataModified: boolean;
  validationErrors: string[];
  validationWarnings: string[];
};

export type RepairRecoveryLesson<TSpec> = {
  beforeSpec: TSpec;
  afterSpec: TSpec;
  findings: string[];
  context?: string;
  content: string | null;
};

export type RepairRecoveryProposal<TSpec> = {
  summary: string;
  spec: TSpec;
};

export type RepairRecoveryState<TSpec, TRequest> = {
  version: 1;
  status: RepairRecoveryStatus;
  proposal?: RepairRecoveryProposal<TSpec>;
  proposalValidation?: RepairRecoveryValidation;
  rejectedProposalSpec?: TSpec;
  retryFeedback?: RepairRecoveryFeedback;
  repairDiagnostics: RepairRecoveryDiagnostic[];
  retryAttempt: number;
  retryKind?: RepairRecoveryRetryKind;
  lastRequest?: TRequest;
  lastProtectedElementsBaseSpec?: TSpec;
  proposalRepairLesson?: RepairRecoveryLesson<TSpec>;
  externalFixDraft: string;
  composerDraft: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value);

const isRepairRecoveryStatus = (value: unknown): value is RepairRecoveryStatus =>
  value === 'idle' || value === 'running' || value === 'staged' || value === 'rejected';

const isRetryKind = (value: unknown): value is RepairRecoveryRetryKind =>
  value === 'generation' || value === 'repair' || value === 'format';

const isDiagnosticOutcome = (value: unknown): value is RepairRecoveryDiagnosticOutcome =>
  value === 'reconstructed' ||
  value === 'validated' ||
  value === 'rejected' ||
  value === 'exhausted' ||
  value === 'stopped';

function normalizeStringList(value: unknown, maxItems: number, maxLength: number): string[] | null {
  if (!Array.isArray(value) || !value.every((item) => typeof item === 'string')) return null;
  return value.slice(0, maxItems).map((item) => item.slice(0, maxLength));
}

function normalizeValidation(value: unknown): RepairRecoveryValidation | undefined {
  if (!isRecord(value)) return undefined;
  const errors = normalizeStringList(value.errors, 40, 3000);
  const warnings = normalizeStringList(value.warnings, 40, 3000);
  if (!errors || !warnings) return undefined;
  const topologyErrors = value.topologyErrors === undefined
    ? undefined
    : normalizeStringList(value.topologyErrors, 40, 3000);
  const topologyWarnings = value.topologyWarnings === undefined
    ? undefined
    : normalizeStringList(value.topologyWarnings, 40, 3000);
  if (topologyErrors === null || topologyWarnings === null) return undefined;
  return {
    errors,
    warnings,
    ...(topologyErrors ? { topologyErrors } : {}),
    ...(topologyWarnings ? { topologyWarnings } : {}),
  };
}

function normalizeFeedback(value: unknown): RepairRecoveryFeedback | undefined {
  if (
    !isRecord(value) ||
    typeof value.message !== 'string' ||
    typeof value.canRetryManually !== 'boolean'
  ) return undefined;
  const validationFindings = value.validationFindings === undefined
    ? undefined
    : normalizeStringList(value.validationFindings, 40, 3000);
  const validationWarnings = value.validationWarnings === undefined
    ? undefined
    : normalizeStringList(value.validationWarnings, 40, 3000);
  if (validationFindings === null || validationWarnings === null) return undefined;
  return {
    message: value.message.slice(0, 3000),
    canRetryManually: value.canRetryManually,
    ...(validationFindings ? { validationFindings } : {}),
    ...(validationWarnings ? { validationWarnings } : {}),
  };
}

function normalizeDiagnostics(value: unknown): RepairRecoveryDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item): RepairRecoveryDiagnostic[] => {
    if (
      !isRecord(item) ||
      !Number.isInteger(item.attempt) ||
      (item.attempt as number) < 0 ||
      !isDiagnosticOutcome(item.outcome) ||
      typeof item.nonWireElementsModified !== 'boolean' ||
      typeof item.metadataModified !== 'boolean'
    ) return [];
    const validationErrors = normalizeStringList(item.validationErrors, 40, 3000);
    const validationWarnings = normalizeStringList(item.validationWarnings, 40, 3000);
    if (!validationErrors || !validationWarnings) return [];
    return [{
      attempt: Math.min(item.attempt as number, 100),
      outcome: item.outcome,
      nonWireElementsModified: item.nonWireElementsModified,
      metadataModified: item.metadataModified,
      validationErrors,
      validationWarnings,
    }];
  }).slice(-20);
}

export function createEmptyRepairRecoveryState<TSpec, TRequest>(): RepairRecoveryState<TSpec, TRequest> {
  return {
    version: 1,
    status: 'idle',
    repairDiagnostics: [],
    retryAttempt: 0,
    externalFixDraft: '',
    composerDraft: '',
  };
}

export function normalizeRepairRecoveryState<TSpec, TRequest>(
  value: unknown,
  isCircuitSpec: (value: unknown) => value is TSpec,
  isCircuitBuildRequest: (value: unknown) => value is TRequest,
): RepairRecoveryState<TSpec, TRequest> {
  if (!isRecord(value) || value.version !== 1) {
    return createEmptyRepairRecoveryState<TSpec, TRequest>();
  }

  const proposal = isRecord(value.proposal) &&
    typeof value.proposal.summary === 'string' &&
    value.proposal.summary.length <= 500 &&
    isCircuitSpec(value.proposal.spec)
    ? { summary: value.proposal.summary, spec: value.proposal.spec }
    : undefined;
  const proposalValidation = normalizeValidation(value.proposalValidation);
  const rejectedProposalSpec = isCircuitSpec(value.rejectedProposalSpec)
    ? value.rejectedProposalSpec
    : undefined;
  let retryFeedback = normalizeFeedback(value.retryFeedback);
  const repairDiagnostics = normalizeDiagnostics(value.repairDiagnostics);
  const retryAttempt = Number.isInteger(value.retryAttempt) && (value.retryAttempt as number) >= 0
    ? Math.min(value.retryAttempt as number, 100)
    : 0;
  const retryKind = isRetryKind(value.retryKind) ? value.retryKind : undefined;
  const lastRequest = isCircuitBuildRequest(value.lastRequest) ? value.lastRequest : undefined;
  const lastProtectedElementsBaseSpec = isCircuitSpec(value.lastProtectedElementsBaseSpec)
    ? value.lastProtectedElementsBaseSpec
    : undefined;

  let proposalRepairLesson: RepairRecoveryLesson<TSpec> | undefined;
  if (isRecord(value.proposalRepairLesson)) {
    const findings = normalizeStringList(value.proposalRepairLesson.findings, 12, 700);
    if (
      isCircuitSpec(value.proposalRepairLesson.beforeSpec) &&
      isCircuitSpec(value.proposalRepairLesson.afterSpec) &&
      findings?.length &&
      (value.proposalRepairLesson.context === undefined ||
        typeof value.proposalRepairLesson.context === 'string') &&
      (value.proposalRepairLesson.content === null ||
        typeof value.proposalRepairLesson.content === 'string')
    ) {
      proposalRepairLesson = {
        beforeSpec: value.proposalRepairLesson.beforeSpec,
        afterSpec: value.proposalRepairLesson.afterSpec,
        findings,
        ...(typeof value.proposalRepairLesson.context === 'string'
          ? { context: value.proposalRepairLesson.context.slice(0, 1600) }
          : {}),
        content: typeof value.proposalRepairLesson.content === 'string'
          ? value.proposalRepairLesson.content.slice(0, 300)
          : null,
      };
    }
  }

  let status: RepairRecoveryStatus = isRepairRecoveryStatus(value.status)
    ? value.status
    : 'idle';
  if (status === 'running') {
    if (proposal) {
      status = 'staged';
    } else if (rejectedProposalSpec || lastRequest) {
      status = 'rejected';
      retryFeedback = {
        message: 'The request was interrupted by a page refresh. Your saved candidate and findings are available to continue.',
        canRetryManually: !!lastRequest,
        ...(retryFeedback?.validationFindings?.length
          ? { validationFindings: retryFeedback.validationFindings }
          : {}),
        ...(retryFeedback?.validationWarnings?.length
          ? { validationWarnings: retryFeedback.validationWarnings }
          : {}),
      };
    } else {
      status = 'idle';
    }
  } else if (proposal) {
    status = 'staged';
  } else if (rejectedProposalSpec) {
    status = 'rejected';
  }

  return {
    version: 1,
    status,
    ...(proposal ? { proposal } : {}),
    ...(proposalValidation ? { proposalValidation } : {}),
    ...(rejectedProposalSpec ? { rejectedProposalSpec } : {}),
    ...(retryFeedback ? { retryFeedback } : {}),
    repairDiagnostics,
    retryAttempt,
    ...(retryKind ? { retryKind } : {}),
    ...(lastRequest ? { lastRequest } : {}),
    ...(lastProtectedElementsBaseSpec ? { lastProtectedElementsBaseSpec } : {}),
    ...(proposalRepairLesson ? { proposalRepairLesson } : {}),
    externalFixDraft: typeof value.externalFixDraft === 'string'
      ? value.externalFixDraft.slice(0, 50000)
      : '',
    composerDraft: typeof value.composerDraft === 'string'
      ? value.composerDraft.slice(0, 10000)
      : '',
  };
}

export function updateRepairRecoveryState<TSpec, TRequest>(
  current: RepairRecoveryState<TSpec, TRequest>,
  patch: Partial<RepairRecoveryState<TSpec, TRequest>>,
): RepairRecoveryState<TSpec, TRequest> {
  const next = { ...current } as RepairRecoveryState<TSpec, TRequest> & Record<string, unknown>;
  for (const [key, value] of Object.entries(patch)) {
    if (value === undefined) {
      delete next[key];
    } else {
      next[key] = value;
    }
  }
  return next;
}

export function discardStagedRepairProposal<TSpec, TRequest>(
  state: RepairRecoveryState<TSpec, TRequest>,
): RepairRecoveryState<TSpec, TRequest> {
  return updateRepairRecoveryState(state, {
    status: state.rejectedProposalSpec ? 'rejected' : 'idle',
    proposal: undefined,
    proposalValidation: undefined,
    proposalRepairLesson: undefined,
  });
}

export function clearAppliedRepairRecovery<TSpec, TRequest>(
  state: RepairRecoveryState<TSpec, TRequest>,
): RepairRecoveryState<TSpec, TRequest> {
  return {
    ...createEmptyRepairRecoveryState<TSpec, TRequest>(),
    composerDraft: state.composerDraft,
  };
}

export function getBuilderHistoryStorageKey(userId: string): string {
  return `circuit-studio-builder-chat-v1:${encodeURIComponent(userId)}`;
}

export function getNextBuilderHistoryTimestamp(
  previousUpdatedAt: number | undefined,
  now = Date.now(),
): number {
  return Math.max(now, previousUpdatedAt === undefined ? 0 : previousUpdatedAt + 1);
}

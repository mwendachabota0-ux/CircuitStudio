import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatWithCircuitBuilderMutationKey,
  getGetAiUsageQueryKey,
  getListCircuitBuilderHistoryQueryKey,
  getListDeletedCircuitBuilderHistoryQueryKey,
  getListCircuitBuilderMemoriesQueryKey,
  chatWithCircuitBuilder,
  getCircuitSymbolData,
  reviewCircuitProposal,
  useChatWithCircuitBuilder,
  useGetAiUsage,
  useListCircuitBuilderHistory,
  useListDeletedCircuitBuilderHistory,
  useLearnFromCircuitBuilderHistory,
  useDeleteCircuitBuilderHistory,
  useReviewCircuitProposal,
  useSaveCircuitBuilderFeedback,
  useSaveCircuitBuilderRepairLesson,
  useSyncCircuitBuilderHistory,
} from '@workspace/api-client-react';
import type {
  CircuitBuilderHistorySession as ApiBuilderHistoryEntry,
  CircuitBuilderFeedbackInput,
  CircuitBuilderHistoryExcerpt,
  CircuitBuilderSuggestedAction,
  CircuitProposalReview,
  CircuitBuildChatInput,
  CircuitBuildChatMessage,
  CircuitBuilderRepairLessonInput,
  CircuitDesignBrief,
  CircuitSpec,
  CircuitSymbolSearchItem,
} from '@workspace/api-client-react';
import type { CircuitComponentLibraryEntry } from '@workspace/circuit-geometry';
import {
  buildManualRetryRequest,
  buildLayoutRepairRequest,
  buildOutputRepairRequest,
  buildRepairRequest,
  buildWireRebuildRequest,
  buildWholeCircuitRetryRequest,
  CircuitBuildAttemptError,
  classifyProposalValidation,
  getProtectedCircuitChanges,
  getProtectedCircuitSignature,
  getLayoutInvariantChanges,
  getLayoutInvariantSignature,
  getCircuitNetlistSignature,
  getPinToNetSignature,
  hasStablePinConnectivitySignature,
  formatRepairAttemptSummary,
  getModeAfterFailedRequest,
  getRetryRecoveryKind,
  MAX_AUTO_RETRIES,
  normalizeCircuitBuildRequest,
  restoreProtectedNonWireElements,
  runCircuitBuildAttempts,
  type BuildRetryKind,
} from '../lib/circuit-build-retry';
import {
  clearAppliedRepairRecovery,
  createEmptyRepairRecoveryState,
  discardStagedRepairProposal,
  getBuilderHistoryStorageKey,
  getNextBuilderHistoryTimestamp,
  normalizeRepairRecoveryState,
  updateRepairRecoveryState,
  type RepairRecoveryState,
} from '../lib/circuit-builder-repair-session';
import { getLocalBuilderModeIntent } from '../lib/circuit-build-intent';
import {
  isExplicitBuildApproval,
  isExplicitBuildRequest,
} from '../lib/circuit-build-authorization';
import {
  getContextualSuggestedActions,
  getFinalAssistantQuestion,
} from '../lib/suggested-action-context';
import {
  buildExternalCircuitFixProposal,
  buildExternalCircuitFixPrompt,
  getExternalCircuitFixLessonFindings,
  hydrateExternalCircuitFixSymbols,
  getExternalCircuitFixContextKey,
  partitionExternalCircuitFixFindings,
  shouldShowExternalCircuitFixPaste,
  type ExternalCircuitFixContext,
} from '../lib/circuit-external-fix';
import {
  Check,
  CheckCircle2,
  Copy,
  Brain,
  Maximize2,
  History,
  Library,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import './circuit-builder-chat.css';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  createBuilderHistorySession,
  filterDeletedBuilderHistorySessions,
  getBuilderHistoryPreview,
  getBuilderHistoryTitle,
  upsertBuilderHistorySession,
  getBuilderHistoryMemoryExcerpts,
  getBuilderHistorySyncCandidates,
  mergeBuilderHistorySessions,
  type BuilderHistorySession,
} from '../lib/circuit-builder-history';
import { ComponentLibraryDialog } from './component-library-dialog';
import CircuitBuilderComposer, {
  type CircuitBuilderComposerHandle,
} from './circuit-builder-composer';
import { CircuitBuilderFeedback } from './circuit-builder-feedback';
import {
  CircuitBuilderMemoryDialog,
  type CircuitBuilderMemoryImportStatus,
} from './circuit-builder-memory-dialog';

type ChatMode = 'chat' | 'build';
type ThreadMessage = CircuitBuildChatMessage & {
  id: string;
  createdAt: number;
  suggestedActions?: CircuitBuilderSuggestedAction[];
  buildApprovalRequest?: boolean;
};
type RepairState = RepairRecoveryState<CircuitSpec, CircuitBuildChatInput>;
type SavedState = {
  brief: CircuitDesignBrief;
  aiBrief: CircuitDesignBrief;
  messages: ThreadMessage[];
  repair: RepairState;
};
type BuilderHistoryEntry = BuilderHistorySession<SavedState, CircuitBuildChatInput['currentSpec']>;
type ValidationReport = {
  errors: string[];
  warnings: string[];
  topologyErrors?: string[];
  topologyWarnings?: string[];
};
type ProposalQualityReviewState =
  | { kind: 'idle' | 'loading' | 'unavailable' | 'cancelled' }
  | { kind: 'skipped'; reason?: 'blocking-findings' | 'external-correction' }
  | { kind: 'ready'; review: CircuitProposalReview };
type LayoutRepairOutcome =
  | {
      kind: 'success';
      proposal: { summary: string; spec: NonNullable<CircuitBuildChatInput['currentSpec']> };
      inspection: ReturnType<typeof inspectProposal>;
    }
  | { kind: 'failure'; message: string };
type ProposalFeedbackReason = Exclude<
  CircuitBuilderFeedbackInput['reason'],
  'overall'
>;
type RetryFeedback = {
  message: string;
  canRetryManually: boolean;
  validationFindings?: string[];
  validationWarnings?: string[];
};
type RejectedSpecCopyState = 'idle' | 'copied' | 'error';
type RepairLessonEvidence = {
  beforeSpec: CircuitSpec;
  findings: string[];
  context?: string;
};
type ProposalRepairLesson = RepairLessonEvidence & {
  afterSpec: CircuitSpec;
  content: string | null;
};
type RepairLessonNotice = {
  kind: 'saving' | 'saved' | 'known' | 'none' | 'error';
  message: string;
};

const emptyBrief = (): CircuitDesignBrief => ({
  goal: '',
  requirements: [],
  assumptions: [],
  openQuestions: [],
});

const initialMessage: ThreadMessage = {
  id: 'welcome',
  role: 'assistant',
  content: 'Tell me what you want this circuit to do. We can sort out the details first, then shape an editable draft when you are ready.',
  createdAt: 0,
};

const isStringList = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === 'string');

const noteLines = (value: string): string[] =>
  value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean).slice(0, 12).map((line) => line.slice(0, 300));

function isSameRepairDraft(before: CircuitSpec, after: CircuitSpec): boolean {
  if (before.title !== after.title) return false;
  const afterParts = new Set(
    after.elements
      .filter((element) => element.type !== 'wire')
      .map((element) => `${element.type}:${element.id}`),
  );
  return before.elements
    .filter((element) => element.type !== 'wire')
    .some((element) => afterParts.has(`${element.type}:${element.id}`));
}

function normalizeBrief(value: Partial<CircuitDesignBrief> | undefined): CircuitDesignBrief {
  return {
    goal: typeof value?.goal === 'string' ? value.goal.slice(0, 1000) : '',
    requirements: isStringList(value?.requirements) ? value.requirements.slice(0, 12).map((item) => item.slice(0, 300)) : [],
    assumptions: isStringList(value?.assumptions) ? value.assumptions.slice(0, 12).map((item) => item.slice(0, 300)) : [],
    openQuestions: isStringList(value?.openQuestions) ? value.openQuestions.slice(0, 12).map((item) => item.slice(0, 300)) : [],
  };
}

function inspectProposal(spec: CircuitBuildChatInput['currentSpec']): {
  svg: string;
  validation: ValidationReport;
  canRepair: boolean;
} {
  if (!window.CircuitDraw) {
    return {
      svg: '',
      validation: { errors: ['The schematic preview library is not ready.'], warnings: [] },
      canRepair: false,
    };
  }
  try {
    const validation = classifyProposalValidation(window.CircuitDraw.validate(spec));
    if (validation.errors.length) return { svg: '', validation, canRepair: true };
    const svg = window.CircuitDraw.render(spec);
    if (!svg) {
      return {
        svg: '',
        validation: { errors: ['The schematic renderer did not produce a preview.'], warnings: validation.warnings },
        canRepair: true,
      };
    }
    return { svg, validation, canRepair: true };
  } catch (error) {
    return {
      svg: '',
      validation: {
        errors: [error instanceof Error ? error.message : 'This proposal could not be rendered.'],
        warnings: [],
      },
      canRepair: true,
    };
  }
}

function getConnectivitySignature(spec: CircuitSpec, allowStructuralErrors = false): string | null {
  if (!window.CircuitDraw) return null;
  try {
    const netlist = window.CircuitDraw.netlist(spec, allowStructuralErrors);
    return netlist.parts.length
      ? getPinToNetSignature(netlist)
      : null;
  } catch {
    return null;
  }
}

function inspectLayoutProposal(spec: CircuitSpec): {
  svg: string;
  validation: ValidationReport;
  canRepair: boolean;
} {
  const inspection = inspectProposal(spec);
  if (!inspection.svg || !window.CircuitDraw) return inspection;

  const layoutFindings = window.CircuitDraw.layoutWarnings(spec)
    .map((finding) => `Drawing-quality issue: ${finding}`);
  return layoutFindings.length
    ? {
        ...inspection,
        validation: {
          ...inspection.validation,
          errors: [...inspection.validation.errors, ...layoutFindings],
        },
      }
    : inspection;
}

function withLayoutWarnings(
  review: CircuitProposalReview,
  spec: CircuitSpec,
): CircuitProposalReview {
  const deterministicWarnings = window.CircuitDraw?.layoutWarnings(spec) ?? [];
  return {
    ...review,
    readabilityWarnings: [...new Set([
      ...review.readabilityWarnings,
      ...deterministicWarnings,
    ])].slice(0, 5),
  };
}

function renderRejectedProposalPreview(
  spec: CircuitBuildChatInput['currentSpec'] | null | undefined,
): string {
  if (!spec || !window.CircuitDraw) return '';
  try {
    return window.CircuitDraw.render(spec, { allowStructuralErrors: true });
  } catch {
    return '';
  }
}

function formatValidationFailure(repairAttemptCount: number): string {
  return formatRepairAttemptSummary(repairAttemptCount);
}

function asCircuitSpec(value: unknown): CircuitBuildChatInput['currentSpec'] | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as CircuitBuildChatInput['currentSpec'];
  return typeof candidate.title === 'string' && Array.isArray(candidate.elements)
    ? candidate
    : null;
}

function mergeBriefPreservingManualEdits(
  previousAiBrief: CircuitDesignBrief,
  currentBrief: CircuitDesignBrief,
  nextAiBrief: CircuitDesignBrief,
): CircuitDesignBrief {
  const mergeList = (previous: string[], current: string[], next: string[]) => {
    const previousItems = new Set(previous);
    const currentItems = new Set(current);
    const removedByUser = new Set(previous.filter((item) => !currentItems.has(item)));
    const addedByUser = current.filter((item) => !previousItems.has(item));
    const addedItems = new Set(addedByUser);
    const nextAiItems = next.filter((item) => !removedByUser.has(item));
    return [
      ...addedByUser,
      ...nextAiItems.filter((item) => !addedItems.has(item)),
    ].slice(0, 12);
  };

  return {
    goal: currentBrief.goal !== previousAiBrief.goal ? currentBrief.goal : nextAiBrief.goal,
    requirements: mergeList(previousAiBrief.requirements, currentBrief.requirements, nextAiBrief.requirements),
    assumptions: mergeList(previousAiBrief.assumptions, currentBrief.assumptions, nextAiBrief.assumptions),
    openQuestions: mergeList(previousAiBrief.openQuestions, currentBrief.openQuestions, nextAiBrief.openQuestions),
  };
}

function normalizeSavedState(value: unknown): SavedState {
  const parsed = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Partial<SavedState>
    : {};
  const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter((message): message is ThreadMessage =>
          !!message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          typeof message.id === 'string' &&
          typeof message.createdAt === 'number',
          ).slice(-60).map((message) => {
            const actions = Array.isArray(message.suggestedActions)
              ? message.suggestedActions.filter(isSuggestedAction).slice(0, 2)
              : [];
            return {
              ...message,
              ...(message.buildApprovalRequest === true
                ? { buildApprovalRequest: true }
                : { buildApprovalRequest: undefined }),
              ...(actions.length ? { suggestedActions: actions } : { suggestedActions: undefined }),
            };
          })
      : [];
  const brief = normalizeBrief(parsed.brief);
  // Older saved sessions did not record the AI's last draft separately.
  // Treat their existing notes as user-owned so migration never overwrites them.
  const aiBrief = parsed.aiBrief ? normalizeBrief(parsed.aiBrief) : emptyBrief();
  return {
    brief,
    aiBrief,
    messages: messages.length ? messages : [initialMessage],
    repair: normalizeRepairRecoveryState(
      parsed.repair,
      isCircuitSpec,
      isCircuitBuildRequest,
    ),
  };
}

function readSavedState(key: string): SavedState {
  const fallback = normalizeSavedState(null);
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? normalizeSavedState(JSON.parse(raw)) : fallback;
  } catch {
    return fallback;
  }
}

function isCircuitSpec(value: unknown): value is CircuitBuildChatInput['currentSpec'] {
  return !!value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    typeof (value as { title?: unknown }).title === 'string' &&
    Array.isArray((value as { elements?: unknown }).elements);
}

function isCircuitBuildRequest(value: unknown): value is CircuitBuildChatInput {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const request = value as Partial<CircuitBuildChatInput>;
  if (
    typeof request.message !== 'string' ||
    (request.mode !== 'chat' && request.mode !== 'build') ||
    !isCircuitSpec(request.currentSpec)
  ) return false;
  if (
    request.responseFormatRetry !== undefined &&
    typeof request.responseFormatRetry !== 'boolean'
  ) return false;
  if (
    request.history !== undefined &&
    (!Array.isArray(request.history) ||
      request.history.length > 8 ||
      !request.history.every((message) =>
        !!message &&
        (message.role === 'user' || message.role === 'assistant') &&
        typeof message.content === 'string',
      ))
  ) return false;
  return request.brief === undefined ||
    (!!request.brief &&
      typeof request.brief.goal === 'string' &&
      isStringList(request.brief.requirements) &&
      isStringList(request.brief.assumptions) &&
      isStringList(request.brief.openQuestions));
}

function isHistoryTimestamp(value: unknown): value is number {
  return typeof value === 'number' &&
    Number.isFinite(value) &&
    Math.abs(value) <= 8_640_000_000_000_000;
}

function createHistoryId(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function readBuilderHistorySessions(key: string): BuilderHistoryEntry[] {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((value): BuilderHistoryEntry[] => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
      const entry = value as Partial<BuilderHistoryEntry>;
      if (
        typeof entry.id !== 'string' ||
        !entry.id ||
        !isCircuitSpec(entry.currentSpec) ||
        !isHistoryTimestamp(entry.createdAt) ||
        !isHistoryTimestamp(entry.updatedAt) ||
        (entry.mode !== 'chat' && entry.mode !== 'build')
      ) return [];
      const saved = normalizeSavedState(entry.saved);
      return [{
        id: entry.id,
        title: getBuilderHistoryTitle(saved.messages),
        createdAt: entry.createdAt as number,
        updatedAt: entry.updatedAt as number,
        mode: entry.mode,
        saved,
        currentSpec: entry.currentSpec,
      }];
    }).sort((left, right) => right.updatedAt - left.updatedAt);
  } catch {
    return [];
  }
}

function readBuilderHistoryBootstrap(storageKey: string, currentSpec: CircuitBuildChatInput['currentSpec']) {
  const historyKey = `${storageKey}:history-v1`;
  const sessions = readBuilderHistorySessions(historyKey);
  const hasStoredHistory = sessions.length > 0;
  const legacySaved = readSavedState(storageKey);
  const hasLegacyConversation = legacySaved.messages.some((message) => message.id !== 'welcome') ||
    !!legacySaved.brief.goal ||
    !!legacySaved.brief.requirements.length ||
    !!legacySaved.brief.assumptions.length ||
    !!legacySaved.brief.openQuestions.length;
  const availableSessions = hasStoredHistory
    ? sessions
    : [createBuilderHistorySession({
        id: createHistoryId(),
        saved: legacySaved,
        currentSpec,
        mode: 'chat',
      })];
  let activeId: string | null = null;
  try {
    activeId = window.localStorage.getItem(`${storageKey}:active-session-v1`);
  } catch {
    // A fresh workbench can still be used if storage is blocked.
  }
  const active = availableSessions.find((session) => session.id === activeId) ?? availableSessions[0];
  return {
    sessions: availableSessions,
    active,
    hasStoredHistory,
    hasLegacyConversation,
    restoreSpec: hasStoredHistory ? active.currentSpec : null,
  };
}

function normalizeAccountHistorySession(value: ApiBuilderHistoryEntry): BuilderHistoryEntry | null {
  if (
    typeof value.id !== 'string' ||
    !value.id ||
    !isCircuitSpec(value.currentSpec) ||
    !isHistoryTimestamp(value.createdAt) ||
    !isHistoryTimestamp(value.updatedAt) ||
    (value.mode !== 'chat' && value.mode !== 'build')
  ) return null;

  const saved = normalizeSavedState(value.saved);
  return {
    id: value.id,
    title: getBuilderHistoryTitle(saved.messages),
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    mode: value.mode,
    saved,
    currentSpec: value.currentSpec,
  };
}

function formatHistoryTime(timestamp: number): string {
  const elapsed = Math.max(0, Date.now() - timestamp);
  if (elapsed < 60_000) return 'Just now';
  if (elapsed < 60 * 60_000) return `${Math.floor(elapsed / 60_000)}m ago`;
  if (elapsed < 24 * 60 * 60_000) return `${Math.floor(elapsed / (60 * 60_000))}h ago`;
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp);
}

function newMessage(
  role: CircuitBuildChatMessage['role'],
  content: string,
  suggestedActions?: CircuitBuilderSuggestedAction[],
  options?: { buildApprovalRequest?: boolean },
): ThreadMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(suggestedActions?.length ? { suggestedActions: suggestedActions.slice(0, 2) } : {}),
    ...(options?.buildApprovalRequest ? { buildApprovalRequest: true } : {}),
  };
}

function isSuggestedAction(value: unknown): value is CircuitBuilderSuggestedAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  return typeof action.label === 'string' &&
    typeof action.prompt === 'string' &&
    (action.replyTo === undefined || typeof action.replyTo === 'string');
}

export type CircuitBuilderChatProps = {
  userId: string;
  currentSpec: CircuitBuildChatInput['currentSpec'];
  validationFindings: string[];
  canRepairCurrentDraft: boolean;
  hasUnappliedJsonEdits: boolean;
  jsonRepairRequest: JsonRepairRequest | null;
  schematicFeedbackHost: HTMLElement | null;
  onJsonRepairRequestHandled: (id: number) => void;
  onProposalStateChange: (hasProposal: boolean) => void;
  onApplySpec: (
    spec: CircuitBuildChatInput['currentSpec'],
    source?: 'proposal' | 'history',
  ) => void;
  onTaskComplete: (mode: 'chat' | 'build') => void;
};

export type JsonRepairRequest = {
  id: number;
  rawJson: string;
  parseError: string;
  baseSpec: CircuitBuildChatInput['currentSpec'];
  validationFindings?: string[];
};

export function CircuitBuilderChat({
  userId,
  currentSpec,
  validationFindings,
  canRepairCurrentDraft,
  hasUnappliedJsonEdits,
  jsonRepairRequest,
  schematicFeedbackHost,
  onJsonRepairRequestHandled,
  onProposalStateChange,
  onApplySpec,
  onTaskComplete,
}: CircuitBuilderChatProps) {
  const storageKey = getBuilderHistoryStorageKey(userId);
  const historyStorageKey = `${storageKey}:history-v1`;
  const activeSessionStorageKey = `${storageKey}:active-session-v1`;
  const queryClient = useQueryClient();
  const historyQuery = useListCircuitBuilderHistory({
    query: {
      queryKey: [...getListCircuitBuilderHistoryQueryKey(), userId],
      retry: 1,
      refetchOnMount: 'always',
    },
  });
  const historyDeletionsQuery = useListDeletedCircuitBuilderHistory({
    query: {
      queryKey: [...getListDeletedCircuitBuilderHistoryQueryKey(), userId],
      retry: 1,
      refetchOnMount: 'always',
    },
  });
  const buildAbortControllerRef = useRef<AbortController | null>(null);
  const proposalReviewAbortControllerRef = useRef<AbortController | null>(null);
  const proposalReviewLayoutRepairActiveRef = useRef(false);
  const historySyncMutation = useSyncCircuitBuilderHistory();
  const historyDeleteMutation = useDeleteCircuitBuilderHistory();
  const chatMutation = useChatWithCircuitBuilder({
    mutation: {
      mutationKey: getChatWithCircuitBuilderMutationKey(),
      mutationFn: ({ data }) => chatWithCircuitBuilder(data, {
        signal: buildAbortControllerRef.current?.signal,
      }),
    },
  });
  const proposalReviewMutation = useReviewCircuitProposal({
    mutation: {
      mutationFn: ({ data }) => reviewCircuitProposal(data, {
        signal: proposalReviewAbortControllerRef.current?.signal,
      }),
    },
  });
  const feedbackMutation = useSaveCircuitBuilderFeedback();
  const repairLessonMutation = useSaveCircuitBuilderRepairLesson();
  const historyImportMutation = useLearnFromCircuitBuilderHistory();
  const usageQuery = useGetAiUsage({
    query: { queryKey: getGetAiUsageQueryKey(), retry: 1 },
  });
  const [historyBootstrap] = useState(() => readBuilderHistoryBootstrap(storageKey, currentSpec));
  const [sessions, setSessions] = useState<BuilderHistoryEntry[]>(historyBootstrap.sessions);
  const [activeSessionId, setActiveSessionId] = useState(historyBootstrap.active.id);
  const [saved, setSaved] = useState<SavedState>(historyBootstrap.active.saved);
  const [mode, setMode] = useState<ChatMode>(historyBootstrap.active.mode);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyDeleteTarget, setHistoryDeleteTarget] = useState<BuilderHistoryEntry | null>(null);
  const [historyDeleteError, setHistoryDeleteError] = useState('');
  const [memoryOpen, setMemoryOpen] = useState(false);
  const [historySaveError, setHistorySaveError] = useState('');
  const [historyHydrated, setHistoryHydrated] = useState(false);
  const [historyImportStatus, setHistoryImportStatus] =
    useState<CircuitBuilderMemoryImportStatus>({ kind: 'idle' });
  const [clearChatOpen, setClearChatOpen] = useState(false);
  const [appliedProposalFeedback, setAppliedProposalFeedback] = useState<{
    id: number;
    circuitTitle: string;
    requestSummary: string;
    specSignature: string;
  } | null>(null);
  const appliedProposalFeedbackIdRef = useRef(0);
  const [proposalSvg, setProposalSvg] = useState('');
  const [proposalQualityReview, setProposalQualityReview] =
    useState<ProposalQualityReviewState>({ kind: 'idle' });
  const [layoutRepairNotice, setLayoutRepairNotice] = useState('');
  const [proposalError, setProposalError] = useState('');
  const [repairLessonNotice, setRepairLessonNotice] =
    useState<RepairLessonNotice | null>(null);
  const [dismissedRepairNoticeKey, setDismissedRepairNoticeKey] =
    useState<string | null>(null);
  const [rejectedProposalSvg, setRejectedProposalSvg] = useState('');
  const [rejectedPreviewOpen, setRejectedPreviewOpen] = useState(false);
  const [rejectedSpecCopyState, setRejectedSpecCopyState] = useState<RejectedSpecCopyState>('idle');
  const [externalFixCopiedContextKey, setExternalFixCopiedContextKey] = useState<string | null>(null);
  const [externalFixCopyState, setExternalFixCopyState] = useState<RejectedSpecCopyState>('idle');
  const [componentLibraryOpen, setComponentLibraryOpen] = useState(false);
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefGoalDraft, setBriefGoalDraft] = useState('');
  const [briefRequirementsDraft, setBriefRequirementsDraft] = useState('');
  const [briefAssumptionsDraft, setBriefAssumptionsDraft] = useState('');
  const [briefOpenQuestionsDraft, setBriefOpenQuestionsDraft] = useState('');
  const [requestCycleActive, setRequestCycleActive] = useState(false);
  const [isStoppingWork, setIsStoppingWork] = useState(false);
  const [externalFixFeedback, setExternalFixFeedback] = useState('');
  const [externalFixValidationPending, setExternalFixValidationPending] = useState(false);
  const [repairStopAvailable, setRepairStopAvailable] = useState(false);
  const [repairStopRequested, setRepairStopRequested] = useState(false);
  const repairState = saved.repair;
  const proposal = repairState.proposal ?? null;
  const proposalValidation = repairState.proposalValidation ?? null;
  const proposalRepairLesson = repairState.proposalRepairLesson ?? null;
  const rejectedProposalSpec = repairState.rejectedProposalSpec ?? null;
  const externalFixDraft = repairState.externalFixDraft;
  const composerDraft = repairState.composerDraft;
  const lastRequest = repairState.lastRequest ?? null;
  const lastProtectedElementsBaseSpec = repairState.lastProtectedElementsBaseSpec ?? null;
  const retryAttempt = repairState.retryAttempt;
  const retryKind = repairState.retryKind ?? null;
  const retryFeedback = repairState.retryFeedback ?? null;
  const repairDiagnostics = repairState.repairDiagnostics;
  const updateRepairState = (patch: Partial<RepairState>) => {
    setSaved((current) => ({
      ...current,
      repair: updateRepairRecoveryState(current.repair, patch),
    }));
  };
  const setRepairStatus = (status: RepairState['status']) => updateRepairState({ status });
  const setProposal = (value: RepairState['proposal'] | null) => {
    setSaved((current) => ({
      ...current,
      repair: updateRepairRecoveryState(current.repair, {
        proposal: value ?? undefined,
        status: value
          ? 'staged'
          : current.repair.rejectedProposalSpec
            ? 'rejected'
            : 'idle',
      }),
    }));
  };
  const setProposalValidation = (value: RepairState['proposalValidation'] | null) =>
    updateRepairState({
      proposalValidation: value
        ? {
            errors: value.errors.slice(0, 40).map((finding) => finding.slice(0, 3000)),
            warnings: value.warnings.slice(0, 40).map((warning) => warning.slice(0, 3000)),
            ...(value.topologyErrors
              ? { topologyErrors: value.topologyErrors.slice(0, 40).map((item) => item.slice(0, 3000)) }
              : {}),
            ...(value.topologyWarnings
              ? { topologyWarnings: value.topologyWarnings.slice(0, 40).map((item) => item.slice(0, 3000)) }
              : {}),
          }
        : undefined,
    });
  const setProposalRepairLesson = (value: RepairState['proposalRepairLesson'] | null) =>
    updateRepairState({
      proposalRepairLesson: value
        ? {
            ...value,
            findings: value.findings.slice(0, 12).map((finding) => finding.slice(0, 700)),
            ...(value.context ? { context: value.context.slice(0, 1600) } : {}),
            content: value.content?.slice(0, 300) ?? null,
          }
        : undefined,
    });
  const setRejectedProposalSpec = (value: CircuitBuildChatInput['currentSpec'] | null) =>
    updateRepairState({
      rejectedProposalSpec: value ?? undefined,
      status: value ? 'rejected' : proposal ? 'staged' : 'idle',
    });
  const setExternalFixDraft = (value: string) =>
    updateRepairState({ externalFixDraft: value.slice(0, 50000) });
  const setComposerDraft = (value: string) =>
    updateRepairState({ composerDraft: value.slice(0, 10000) });
  const setLastRequest = (value: CircuitBuildChatInput | null) =>
    updateRepairState({ lastRequest: value ?? undefined });
  const setLastProtectedElementsBaseSpec = (
    value: CircuitBuildChatInput['currentSpec'] | null,
  ) => updateRepairState({ lastProtectedElementsBaseSpec: value ?? undefined });
  const setRetryAttempt = (value: number) => updateRepairState({ retryAttempt: value });
  const setRetryKind = (value: BuildRetryKind | null) =>
    updateRepairState({ retryKind: value ?? undefined });
  const setRetryFeedback = (value: RetryFeedback | null) =>
    updateRepairState({
      retryFeedback: value
        ? {
            ...value,
            message: value.message.slice(0, 3000),
            ...(value.validationFindings
              ? { validationFindings: value.validationFindings.slice(0, 40).map((item) => item.slice(0, 3000)) }
              : {}),
            ...(value.validationWarnings
              ? { validationWarnings: value.validationWarnings.slice(0, 40).map((item) => item.slice(0, 3000)) }
              : {}),
          }
        : undefined,
    });
  const setRepairDiagnostics = (value: RepairState['repairDiagnostics']) =>
    updateRepairState({
      repairDiagnostics: value.slice(-20).map((diagnostic) => ({
        ...diagnostic,
        validationErrors: diagnostic.validationErrors.slice(0, 40).map((item) => item.slice(0, 3000)),
        validationWarnings: diagnostic.validationWarnings.slice(0, 40).map((item) => item.slice(0, 3000)),
      })),
    });
  const composerRef = useRef<CircuitBuilderComposerHandle>(null);
  const externalFixValidationRef = useRef(false);
  const activeSessionIdRef = useRef(activeSessionId);
  activeSessionIdRef.current = activeSessionId;
  const handledJsonRepairRequestRef = useRef<number | null>(null);
  const observedWorkbenchRepairRef = useRef<{
    sessionId: string;
    spec: CircuitSpec;
    findings: string[];
  } | null>(null);
  const applyingProposalSpecRef = useRef<string | null>(null);
  const proposalReviewRunIdRef = useRef(0);
  const stopRepairAfterAttemptRef = useRef(false);
  const pendingRestoreRef = useRef<{
    sessionId: string;
    specSignature: string;
    spec: CircuitBuildChatInput['currentSpec'];
  } | null>(
    historyBootstrap.restoreSpec
      ? {
          sessionId: historyBootstrap.active.id,
          specSignature: JSON.stringify(historyBootstrap.restoreSpec),
          spec: historyBootstrap.restoreSpec,
        }
      : null,
  );
  const historyImportAttemptedForUser = useRef<string | null>(null);
  const historyBootstrapCompleteRef = useRef(false);
  const lastHistorySaveSignatureRef = useRef(new Map<string, string>());
  const pendingHistorySyncSignatureRef = useRef(new Map<string, string>());
  const pendingHistorySyncTimersRef = useRef(new Map<string, number>());
  const activeSession = sessions.find((session) => session.id === activeSessionId) ?? historyBootstrap.active;
  const historyForMemory = useMemo(() => {
    const currentSession = createBuilderHistorySession({
      id: activeSessionId,
      saved,
      currentSpec,
      mode,
      now: Date.now(),
      createdAt: activeSession.createdAt,
    });
    return getBuilderHistoryMemoryExcerpts(
      upsertBuilderHistorySession(sessions, currentSession),
    );
  }, [activeSession.createdAt, activeSessionId, currentSpec, mode, saved, sessions]);
  const syncHistorySessions = useCallback(async (historySessions: readonly BuilderHistoryEntry[]) => {
    for (let offset = 0; offset < historySessions.length; offset += 5) {
      await historySyncMutation.mutateAsync({
        data: { sessions: historySessions.slice(offset, offset + 5) },
      });
    }
  }, [historySyncMutation.mutateAsync]);
  const saveRepairLesson = useCallback(async (draft: ProposalRepairLesson) => {
    setRepairLessonNotice({ kind: 'saving', message: 'Saving repair lesson…' });
    const useEvidence = !draft.content?.trim();
    const data: CircuitBuilderRepairLessonInput = useEvidence
      ? {
          kind: 'learn',
          beforeSpec: draft.beforeSpec,
          afterSpec: draft.afterSpec,
          findings: draft.findings.slice(0, 12).map((finding) => finding.slice(0, 700)),
          ...(draft.context ? { context: draft.context.slice(0, 1600) } : {}),
        }
      : { kind: 'save', content: draft.content!.trim().slice(0, 300) };

    try {
      const result = await repairLessonMutation.mutateAsync({ data });
      await queryClient.invalidateQueries({
        queryKey: getListCircuitBuilderMemoriesQueryKey(),
      });
      if (useEvidence) {
        void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
      }
      setRepairLessonNotice(
        result.lesson
          ? {
              kind: result.saved ? 'saved' : 'known',
              message: result.saved
                  ? 'Repair lesson saved for similar issues.'
                : 'This repair lesson is already saved.',
            }
          : {
              kind: 'none',
              message: 'No reusable repair lesson found.',
            },
      );
    } catch (error) {
      setRepairLessonNotice({
        kind: 'error',
        message: 'Circuit applied, but its repair lesson could not be saved.',
      });
    }
  }, [queryClient, repairLessonMutation.mutateAsync]);

  useEffect(() => {
    if (!repairLessonNotice || repairLessonNotice.kind === 'saving') return;
    const timeout = window.setTimeout(
      () => setRepairLessonNotice(null),
      repairLessonNotice.kind === 'error' ? 8_000 : 5_000,
    );
    return () => window.clearTimeout(timeout);
  }, [repairLessonNotice]);

  const clearProposalQualityReview = () => {
    proposalReviewRunIdRef.current += 1;
    proposalReviewAbortControllerRef.current?.abort();
    proposalReviewAbortControllerRef.current = null;
    if (proposalReviewLayoutRepairActiveRef.current) {
      buildAbortControllerRef.current?.abort();
    }
    proposalReviewLayoutRepairActiveRef.current = false;
    setProposalQualityReview({ kind: 'idle' });
    setLayoutRepairNotice('');
  };

  const stopProposalQualityReview = () => {
    proposalReviewRunIdRef.current += 1;
    proposalReviewAbortControllerRef.current?.abort();
    proposalReviewAbortControllerRef.current = null;
    if (proposalReviewLayoutRepairActiveRef.current) {
      buildAbortControllerRef.current?.abort();
    }
    proposalReviewLayoutRepairActiveRef.current = false;
    setProposalQualityReview({ kind: 'cancelled' });
    setLayoutRepairNotice('');
  };

  const stopBuilderWork = () => {
    setIsStoppingWork(true);
    buildAbortControllerRef.current?.abort();
  };

  useEffect(() => () => {
    buildAbortControllerRef.current?.abort();
    proposalReviewAbortControllerRef.current?.abort();
  }, []);

  const runLayoutRepair = useCallback(async (
    spec: NonNullable<CircuitBuildChatInput['currentSpec']>,
    originalRequest: CircuitBuildChatInput,
    brief: CircuitDesignBrief,
    findings: string[],
  ): Promise<LayoutRepairOutcome> => {
    if (!window.CircuitDraw) {
      return {
        kind: 'failure',
        message: 'The layout repair service is unavailable; the original proposal was kept.',
      };
    }
    const layoutRequest = buildLayoutRepairRequest(
      originalRequest,
      brief,
      spec,
      findings,
    );
    const abortController = new AbortController();
    buildAbortControllerRef.current = abortController;
    let latestBrief = brief;
    setRetryAttempt(0);
    setRetryKind(null);
    chatMutation.reset();

    try {
      const result = await runCircuitBuildAttempts({
        initialRequest: layoutRequest,
        initialProtectedSpec: spec,
        signal: abortController.signal,
        getConnectivitySignature: (candidate) =>
          getConnectivitySignature(candidate as CircuitSpec),
        send: (workingRequest) => chatMutation.mutateAsync({ data: workingRequest }),
        getProposal: (response) => response.proposal?.spec ?? null,
        inspectProposal: inspectLayoutProposal,
        prepareResponse: (response) => {
          if (!response.proposal?.spec || !window.CircuitDraw) return response;
          const beforeConnectivity = getConnectivitySignature(response.proposal.spec, true);
          const autoFixed = window.CircuitDraw.autoFix(response.proposal.spec);
          const afterConnectivity = getConnectivitySignature(autoFixed.spec, true);
          if (
            autoFixed.changes.length &&
            !hasStablePinConnectivitySignature(beforeConnectivity, afterConnectivity)
          ) return response;
          return autoFixed.changes.length
            ? { ...response, proposal: { ...response.proposal, spec: autoFixed.spec } }
            : response;
        },
        getProtectedCircuitSignature: (candidate) =>
          getLayoutInvariantSignature(candidate as NonNullable<CircuitBuildChatInput['currentSpec']>),
        getProtectedCircuitChanges: (baseline, candidate) =>
          getLayoutInvariantChanges(
            baseline as NonNullable<CircuitBuildChatInput['currentSpec']>,
            candidate as NonNullable<CircuitBuildChatInput['currentSpec']>,
          ),
        makeRepairRequest: (response, validationFindings) => buildLayoutRepairRequest(
          originalRequest,
          latestBrief,
          response.proposal?.spec ?? spec,
          validationFindings,
        ),
        makeOutputRepairRequest: buildOutputRepairRequest,
        onResponse: (response) => {
          latestBrief = response.brief ?? latestBrief;
        },
        onRetry: (attempt, kind) => {
          setRetryAttempt(attempt);
          setRetryKind(kind);
        },
      });
      void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });

      const candidate = result.response.proposal;
      const candidateSpec = candidate?.spec;
      const inspection = result.proposalInspection;
      if (!candidateSpec || !inspection || inspection.validation.errors.length || !inspection.svg) {
        return {
          kind: 'failure',
          message: 'The layout attempt did not pass pin and wire checks; the original proposal was kept.',
        };
      }

      if (
        getLayoutInvariantSignature(spec) !== getLayoutInvariantSignature(candidateSpec)
      ) {
        return {
          kind: 'failure',
          message: 'The layout attempt changed a component or its details; the original proposal was kept.',
        };
      }

      try {
        const beforeNetlist = getCircuitNetlistSignature(window.CircuitDraw.netlist(spec));
        const afterNetlist = getCircuitNetlistSignature(window.CircuitDraw.netlist(candidateSpec));
        if (beforeNetlist !== afterNetlist) {
          return {
            kind: 'failure',
            message: 'The layout attempt changed pin-to-pin connectivity; the original proposal was kept.',
          };
        }
      } catch {
        return {
          kind: 'failure',
          message: 'Studio could not verify the pin-to-pin connections after reflow; the original proposal was kept.',
        };
      }

      return {
        kind: 'success',
        proposal: {
          summary: candidate.summary,
          spec: candidateSpec,
        },
        inspection,
      };
    } catch (error) {
      const remainingLayoutFindings = error instanceof CircuitBuildAttemptError
        ? error.validationFindings.filter((finding) => finding.includes('Visual layout issue')).length
        : 0;
      return {
        kind: 'failure',
        message: remainingLayoutFindings
          ? `Studio could not clear ${remainingLayoutFindings} visual layout issue${remainingLayoutFindings === 1 ? '' : 's'} without changing the circuit; the original proposal was kept.`
          : 'The layout attempt could not be completed; the original proposal was kept.',
      };
    } finally {
      if (buildAbortControllerRef.current === abortController) {
        buildAbortControllerRef.current = null;
      }
      setIsStoppingWork(false);
    }
  }, [chatMutation.mutateAsync, queryClient]);

  const runProposalQualityReview = useCallback(async (
    spec: CircuitSpec,
    originalRequest: string,
    brief: CircuitDesignBrief,
    options?: {
      automaticLayoutRepair?: boolean;
      buildRequest?: CircuitBuildChatInput;
    },
  ) => {
    const runId = ++proposalReviewRunIdRef.current;
    const abortController = new AbortController();
    proposalReviewAbortControllerRef.current = abortController;
    proposalReviewLayoutRepairActiveRef.current = false;
    setProposalQualityReview({ kind: 'loading' });
    setLayoutRepairNotice('');
    try {
    let firstReview: CircuitProposalReview | null = null;
    try {
      firstReview = await proposalReviewMutation.mutateAsync({
        data: {
          spec,
          originalRequest: originalRequest.slice(0, 6000) || 'Review this staged circuit proposal.',
          brief,
        },
      });
      void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
    } catch {
      // Local text and wire collision checks can still trigger a safe layout pass.
    }
    if (proposalReviewRunIdRef.current !== runId) return;

    const deterministicWarnings = window.CircuitDraw?.layoutWarnings(spec) ?? [];
    const initialReview = firstReview
      ? withLayoutWarnings(firstReview, spec)
      : deterministicWarnings.length
        ? {
            intentConcerns: [],
            readabilityWarnings: deterministicWarnings.slice(0, 5),
            unknowns: [],
          }
        : null;

    if (
      options?.automaticLayoutRepair &&
      options.buildRequest &&
      initialReview?.readabilityWarnings.length
    ) {
      setLayoutRepairNotice(
        'Studio found readability issues and is trying a layout-only repair. The original will stay unless its parts and connections match.',
      );
      proposalReviewLayoutRepairActiveRef.current = true;
      let outcome: LayoutRepairOutcome;
      try {
        outcome = await runLayoutRepair(
          spec,
          options.buildRequest,
          brief,
          initialReview.readabilityWarnings,
        );
      } finally {
        proposalReviewLayoutRepairActiveRef.current = false;
      }
      if (proposalReviewRunIdRef.current !== runId) return;
      if (outcome.kind === 'failure') {
        setLayoutRepairNotice(outcome.message);
        setProposalQualityReview({
          kind: 'ready',
          review: {
            ...initialReview,
            readabilityWarnings: [
              ...initialReview.readabilityWarnings.slice(0, 4),
              outcome.message,
            ],
          },
        });
        return;
      }

      setProposal(outcome.proposal);
      setProposalSvg(outcome.inspection.svg);
      setProposalValidation(outcome.inspection.validation);
      setProposalError('');
      setLayoutRepairNotice(
        'Layout updated after Studio confirmed the same parts and pin-to-pin connections.',
      );

      let finalReview: CircuitProposalReview | null = null;
      try {
        finalReview = await proposalReviewMutation.mutateAsync({
          data: {
            spec: outcome.proposal.spec,
            originalRequest: originalRequest.slice(0, 6000) || 'Review this staged circuit proposal.',
            brief,
          },
        });
        void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
      } catch {
        // Keep the verified layout and report the local checks below.
      }
      if (proposalReviewRunIdRef.current !== runId) return;

      const nextReview = finalReview
        ? withLayoutWarnings(finalReview, outcome.proposal.spec)
        : {
            ...initialReview,
            readabilityWarnings: window.CircuitDraw?.layoutWarnings(outcome.proposal.spec).slice(0, 5) ?? [],
          };
      setProposalQualityReview({ kind: 'ready', review: nextReview });
      if (!finalReview) {
        setLayoutRepairNotice(
          'Layout updated and connections verified; the second AI readability review was unavailable.',
        );
      }
      return;
    }

    if (initialReview) {
      setProposalQualityReview({ kind: 'ready', review: initialReview });
    } else {
      setProposalQualityReview({ kind: 'unavailable' });
    }
    } finally {
      if (proposalReviewAbortControllerRef.current === abortController) {
        proposalReviewAbortControllerRef.current = null;
      }
      proposalReviewLayoutRepairActiveRef.current = false;
    }
  }, [proposalReviewMutation.mutateAsync, queryClient, runLayoutRepair]);

  const retryProposalLayout = () => {
    const spec = proposal?.spec ? asCircuitSpec(proposal.spec) : null;
    if (!spec || !lastRequest) return;
    const brief = saved.brief;
    const buildRequest = normalizeCircuitBuildRequest({
      ...lastRequest,
      mode: 'build',
      currentSpec: spec,
      brief,
    });
    void runProposalQualityReview(
      spec,
      buildRequest.message,
      brief,
      { automaticLayoutRepair: true, buildRequest },
    );
  };

  const saveProposalFeedback = async (input: CircuitBuilderFeedbackInput) => {
    const result = await feedbackMutation.mutateAsync({ data: input });
    if (!result.saved) {
      throw new Error('Feedback could not be saved. Please try again.');
    }
    await queryClient.invalidateQueries({
      queryKey: getListCircuitBuilderMemoriesQueryKey(),
    });
  };

  useEffect(() => {
    if (hasUnappliedJsonEdits) return;
    const current = currentSpec as CircuitSpec | null;
    if (!current) {
      observedWorkbenchRepairRef.current = null;
      return;
    }

    const findings = validationFindings
      .slice(0, 12)
      .map((finding) => finding.slice(0, 700));
    const previous = observedWorkbenchRepairRef.current;
    const currentSignature = JSON.stringify(current);
    if (
      previous?.sessionId === activeSessionId &&
      previous.findings.length > 0 &&
      findings.length === 0 &&
      JSON.stringify(previous.spec) !== currentSignature
    ) {
      if (applyingProposalSpecRef.current === currentSignature) {
        applyingProposalSpecRef.current = null;
      } else if (isSameRepairDraft(previous.spec, current)) {
        void saveRepairLesson({
          content: null,
          beforeSpec: previous.spec,
          afterSpec: current,
          findings: previous.findings,
          context: 'The user manually corrected this workbench draft after CircuitDraw reported the listed issues.',
        });
      }
    }

    observedWorkbenchRepairRef.current = findings.length
      ? { sessionId: activeSessionId, spec: current, findings }
      : null;
  }, [
    activeSessionId,
    currentSpec,
    hasUnappliedJsonEdits,
    saveRepairLesson,
    validationFindings,
  ]);

  const runHistoryImport = useCallback(async () => {
    if (!historyForMemory.length) return;
    setHistoryImportStatus({ kind: 'loading' });
    try {
      const result = await historyImportMutation.mutateAsync({
        data: { conversations: historyForMemory },
      });
      const savedResult = {
        learnedCount: result.learnedCount,
        conversationCount: historyForMemory.length,
      };
      try {
        window.localStorage.setItem(
          `circuit-studio-history-memory-import-v1:${userId}`,
          JSON.stringify(savedResult),
        );
      } catch {
        // Assumptions are saved to the account; this marker only avoids re-importing in this browser.
      }
      setHistoryImportStatus({ kind: 'done', ...savedResult });
      void queryClient.invalidateQueries({
        queryKey: getListCircuitBuilderMemoriesQueryKey(),
      });
    } catch {
      setHistoryImportStatus({ kind: 'error' });
    }
  }, [historyForMemory, historyImportMutation.mutateAsync, queryClient, userId]);

  useEffect(() => {
    if (historyBootstrapCompleteRef.current) return;

    if (historyQuery.isError) {
      setHistoryHydrated(true);
      setHistorySaveError('Could not load account history. Existing conversations remain available on this device.');
      return;
    }
    if (historyDeletionsQuery.isError) {
      setHistoryHydrated(true);
      setHistorySaveError('Could not check deleted account history. Existing conversations remain available on this device.');
      return;
    }
    if (!historyQuery.isSuccess || !historyDeletionsQuery.isSuccess) return;

    const deletedSessionIds = new Set(
      (historyDeletionsQuery.data ?? []).map((deletion) => deletion.sessionId),
    );
    const accountSessions = (historyQuery.data ?? [])
      .map(normalizeAccountHistorySession)
      .filter((session): session is BuilderHistoryEntry =>
        !!session && !deletedSessionIds.has(session.id),
      );
    const hasLocalHistory = historyBootstrap.hasStoredHistory ||
      historyBootstrap.hasLegacyConversation ||
      sessions.some((session) => session.saved.messages.some((message) => message.id !== 'welcome'));
    const localSessions = hasLocalHistory
      ? filterDeletedBuilderHistorySessions(sessions, deletedSessionIds)
      : [];
    const mergedSessions = mergeBuilderHistorySessions(localSessions, accountSessions);
    const fallbackSession = deletedSessionIds.has(historyBootstrap.active.id)
      ? createBuilderHistorySession({
          id: createHistoryId(),
          saved: normalizeSavedState(null),
          currentSpec,
          mode: 'chat',
        })
      : historyBootstrap.active;
    const availableSessions = mergedSessions.length ? mergedSessions : [fallbackSession];
    const localActiveId = hasLocalHistory ? activeSessionId : '';
    const restoredSession = availableSessions.find((session) => session.id === localActiveId) ??
      availableSessions[0];

    historyBootstrapCompleteRef.current = true;
    setHistoryHydrated(true);
    setHistorySaveError('');
    setSessions(availableSessions);
    setActiveSessionId(restoredSession.id);
    setSaved(restoredSession.saved);
    setMode(restoredSession.mode);
    if (accountSessions.length) historyImportAttemptedForUser.current = userId;

    try {
      window.localStorage.setItem(activeSessionStorageKey, restoredSession.id);
    } catch {
      // The account copy is still available if browser storage is blocked.
    }

    if (JSON.stringify(currentSpec) !== JSON.stringify(restoredSession.currentSpec)) {
      pendingRestoreRef.current = {
        sessionId: restoredSession.id,
        specSignature: JSON.stringify(restoredSession.currentSpec),
        spec: restoredSession.currentSpec,
      };
      onApplySpec(restoredSession.currentSpec, 'history');
    }

    const sessionsToSync = getBuilderHistorySyncCandidates(localSessions, accountSessions);
    if (sessionsToSync.length) {
      void syncHistorySessions(sessionsToSync)
        .then(() => setHistorySaveError(''))
        .catch(() => {
          setHistorySaveError('Could not sync conversation history to your account. This device still has its local copy.');
        });
    }
  }, [
    activeSessionId,
    activeSessionStorageKey,
    currentSpec,
    historyBootstrap,
    historyQuery.data,
    historyQuery.isError,
    historyQuery.isSuccess,
    historyDeletionsQuery.data,
    historyDeletionsQuery.isError,
    historyDeletionsQuery.isSuccess,
    onApplySpec,
    sessions,
    syncHistorySessions,
    userId,
  ]);

  useEffect(() => {
    if (
      !historyBootstrapCompleteRef.current ||
      !historyForMemory.length ||
      historyImportAttemptedForUser.current === userId
    ) {
      return;
    }
    historyImportAttemptedForUser.current = userId;

    let previousResult: string | null = null;
    try {
      previousResult = window.localStorage.getItem(
        `circuit-studio-history-memory-import-v1:${userId}`,
      );
    } catch {
      // Continue with the one-time scan if browser storage is unavailable.
    }

    if (previousResult) {
      try {
        const parsed: unknown = JSON.parse(previousResult);
        const record = parsed && typeof parsed === 'object'
          ? parsed as Record<string, unknown>
          : {};
        setHistoryImportStatus({
          kind: 'done',
          ...(typeof record.learnedCount === 'number'
            ? { learnedCount: record.learnedCount }
            : {}),
          ...(typeof record.conversationCount === 'number'
            ? { conversationCount: record.conversationCount }
            : {}),
        });
      } catch {
        setHistoryImportStatus({ kind: 'done' });
      }
      return;
    }

    void runHistoryImport();
  }, [historyForMemory.length, runHistoryImport, userId]);

  useEffect(() => {
    onProposalStateChange(!!proposal);
  }, [proposal, onProposalStateChange]);

  useEffect(() => () => {
    for (const timer of pendingHistorySyncTimersRef.current.values()) {
      window.clearTimeout(timer);
    }
    pendingHistorySyncTimersRef.current.clear();
    pendingHistorySyncSignatureRef.current.clear();
  }, []);

  useEffect(() => {
    if (!proposal) {
      setProposalSvg('');
      return;
    }
    const inspection = inspectProposal(proposal.spec);
    setProposalSvg(inspection.svg);
    if (!proposalValidation) setProposalValidation(inspection.validation);
  }, [proposal]);

  useEffect(() => {
    setRejectedProposalSvg(renderRejectedProposalPreview(rejectedProposalSpec));
    if (!rejectedProposalSpec) setRejectedPreviewOpen(false);
  }, [rejectedProposalSpec]);

  useLayoutEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Storage can be unavailable in private browsing; the session remains usable.
    }
  }, [saved, storageKey]);

  useEffect(() => {
    const restore = pendingRestoreRef.current;
    if (!restore || restore.sessionId !== activeSessionId) return;
    if (JSON.stringify(currentSpec) !== restore.specSignature) onApplySpec(restore.spec);
  }, []);

  useLayoutEffect(() => {
    if (!activeSessionId) return;
    const restore = pendingRestoreRef.current;
    if (restore?.sessionId === activeSessionId) {
      if (JSON.stringify(currentSpec) !== restore.specSignature) return;
      pendingRestoreRef.current = null;
    }

    const existing = sessions.find((session) => session.id === activeSessionId);
    const nextSession = createBuilderHistorySession({
      id: activeSessionId,
      saved,
      currentSpec,
      mode,
      now: getNextBuilderHistoryTimestamp(existing?.updatedAt),
      createdAt: existing?.createdAt,
    });
    const sessionChanged = !existing ||
      existing.title !== nextSession.title ||
      existing.mode !== nextSession.mode ||
      JSON.stringify(existing.saved) !== JSON.stringify(nextSession.saved) ||
      JSON.stringify(existing.currentSpec) !== JSON.stringify(nextSession.currentSpec);
    const nextSessions = sessionChanged
      ? upsertBuilderHistorySession(sessions, nextSession)
      : sessions;
    if (sessionChanged) setSessions(nextSessions);

    try {
      window.localStorage.setItem(historyStorageKey, JSON.stringify(nextSessions));
      window.localStorage.setItem(activeSessionStorageKey, activeSessionId);
      setHistorySaveError('');
    } catch {
      setHistorySaveError('This browser could not save a local copy. Account sync may still be available.');
    }

  }, [activeSessionId, saved, currentSpec, mode, sessions, historyStorageKey, activeSessionStorageKey]);

  useEffect(() => {
    if (
      !historyHydrated ||
      !historyBootstrapCompleteRef.current ||
      !historyQuery.isSuccess
    ) return;

    const restore = pendingRestoreRef.current;
    if (
      restore?.sessionId === activeSession.id &&
      JSON.stringify(currentSpec) !== restore.specSignature
    ) return;

    const signature = JSON.stringify(activeSession);
    if (
      lastHistorySaveSignatureRef.current.get(activeSession.id) === signature ||
      pendingHistorySyncSignatureRef.current.get(activeSession.id) === signature
    ) return;

    pendingHistorySyncSignatureRef.current.set(activeSession.id, signature);
    const previousTimer = pendingHistorySyncTimersRef.current.get(activeSession.id);
    if (previousTimer !== undefined) window.clearTimeout(previousTimer);
    const sessionToSync = activeSession;
    const timer = window.setTimeout(() => {
      pendingHistorySyncTimersRef.current.delete(sessionToSync.id);
      if (
        pendingHistorySyncSignatureRef.current.get(sessionToSync.id) !== signature
      ) return;
      pendingHistorySyncSignatureRef.current.delete(sessionToSync.id);
      lastHistorySaveSignatureRef.current.set(sessionToSync.id, signature);
      void syncHistorySessions([sessionToSync])
        .then(() => setHistorySaveError(''))
        .catch(() => {
          if (lastHistorySaveSignatureRef.current.get(sessionToSync.id) === signature) {
            lastHistorySaveSignatureRef.current.delete(sessionToSync.id);
          }
          setHistorySaveError('Could not sync conversation history to your account. This device still has its local copy.');
        });
    }, 450);
    pendingHistorySyncTimersRef.current.set(activeSession.id, timer);
  }, [
    activeSession,
    currentSpec,
    historyHydrated,
    historyQuery.isSuccess,
    syncHistorySessions,
  ]);

  const visibleMessages = saved.messages;
  const aiUnavailable = usageQuery.data ? !usageQuery.data.canUseAi : false;
  const currentSpecSignature = useMemo(
    () => JSON.stringify(currentSpec ?? null),
    [currentSpec],
  );
  const repairNoticeKey = validationFindings.join('\u0000');

  useEffect(() => {
    if (!canRepairCurrentDraft || validationFindings.length === 0) {
      setDismissedRepairNoticeKey(null);
    }
  }, [canRepairCurrentDraft, validationFindings.length]);

  const localProposalState = useMemo(() => {
    if (!proposal) return null;
    return proposalValidation;
  }, [proposal, proposalValidation]);

  const externalFixContext = useMemo<ExternalCircuitFixContext | null>(() => {
    if (!rejectedProposalSpec || !retryFeedback) return null;
    const { reportedProblems, advisoryWarnings } = partitionExternalCircuitFixFindings(
      retryFeedback.validationFindings ?? [],
      retryFeedback.validationWarnings ?? [],
      retryFeedback.message,
    );
    return {
      rejectedSpec: rejectedProposalSpec as CircuitSpec,
      reportedProblems,
      advisoryWarnings,
      originalRequest: lastRequest?.message ?? '',
      designBrief: saved.brief,
    };
  }, [rejectedProposalSpec, retryFeedback, lastRequest, saved.brief]);
  const externalFixContextKey = externalFixContext
    ? getExternalCircuitFixContextKey(externalFixContext)
    : '';
  const externalFixContextKeyRef = useRef(externalFixContextKey);
  externalFixContextKeyRef.current = externalFixContextKey;
  const showExternalFixPaste = shouldShowExternalCircuitFixPaste(
    externalFixCopiedContextKey,
    externalFixContextKey,
  );

  useEffect(() => {
    if (!externalFixContextKey) {
      setExternalFixCopiedContextKey(null);
      setExternalFixCopyState('idle');
      setExternalFixDraft('');
      return;
    }
    if (externalFixDraft.trim()) {
      if (externalFixCopiedContextKey !== externalFixContextKey) {
        setExternalFixCopiedContextKey(externalFixContextKey);
      }
      return;
    }
    if (externalFixCopiedContextKey && externalFixCopiedContextKey !== externalFixContextKey) {
      setExternalFixCopiedContextKey(null);
      setExternalFixCopyState('idle');
    }
  }, [externalFixContextKey, externalFixCopiedContextKey, externalFixDraft]);

  useEffect(() => {
    if (!rejectedProposalSpec) setRejectedPreviewOpen(false);
  }, [rejectedProposalSpec]);

  const addMessage = (message: ThreadMessage) => {
    setSaved((current) => ({ ...current, messages: [...current.messages, message].slice(-60) }));
  };

  const copyRejectedSpec = async () => {
    if (!rejectedProposalSpec) return;
    try {
      await navigator.clipboard.writeText(JSON.stringify(rejectedProposalSpec, null, 2));
      setRejectedSpecCopyState('copied');
    } catch {
      setRejectedSpecCopyState('error');
    }
  };

  const copyExternalCircuitFixPrompt = async () => {
    if (!externalFixContext || !externalFixContextKey) return;
    try {
      await navigator.clipboard.writeText(buildExternalCircuitFixPrompt(externalFixContext));
      setExternalFixDraft('');
      setExternalFixFeedback('');
      setExternalFixCopiedContextKey(externalFixContextKey);
      setExternalFixCopyState('copied');
    } catch {
      setExternalFixCopiedContextKey(null);
      setExternalFixCopyState('error');
    }
  };

  const submitExternalCircuitFix = async () => {
    if (
      !externalFixContext ||
      !showExternalFixPaste ||
      !externalFixDraft.trim() ||
      proposal ||
      externalFixValidationPending ||
      externalFixValidationRef.current ||
      requestCycleActive ||
      chatMutation.isPending
    ) return;

    setExternalFixFeedback('');
    let candidate: ReturnType<typeof buildExternalCircuitFixProposal>;
    try {
      candidate = buildExternalCircuitFixProposal(
        externalFixContext.rejectedSpec,
        externalFixDraft,
      );
    } catch (error) {
      setExternalFixFeedback(
        error instanceof Error ? error.message : 'The pasted CircuitSpec could not be read.',
      );
      return;
    }
    if (!window.CircuitDraw) {
      setExternalFixFeedback('Drawing checks are not ready yet. Try staging the correction again in a moment.');
      return;
    }

    const sessionIdAtStart = activeSessionId;
    const contextKeyAtStart = externalFixContextKey;
    externalFixValidationRef.current = true;
    setExternalFixValidationPending(true);
    try {
      const correctedSpec = await hydrateExternalCircuitFixSymbols(
        candidate.spec,
        (symbolId) => getCircuitSymbolData({ symbolId }),
      );
      if (
        activeSessionIdRef.current !== sessionIdAtStart ||
        externalFixContextKeyRef.current !== contextKeyAtStart
      ) return;
      const inspection = inspectProposal(correctedSpec);
      const lessonFindings = getExternalCircuitFixLessonFindings(externalFixContext);
      setMode('build');
      setProposal({
        summary: candidate.summary,
        spec: correctedSpec,
      });
      setProposalValidation(inspection.validation);
      setProposalSvg(inspection.svg);
      setProposalError('');
      setLayoutRepairNotice('');
      setProposalQualityReview({
        kind: 'skipped',
        reason: inspection.validation.errors.length
          ? 'blocking-findings'
          : 'external-correction',
      });
      setProposalRepairLesson(
        inspection.validation.errors.length ||
          !candidate.diff.hasElementChanges ||
          !lessonFindings.length
          ? null
          : {
              beforeSpec: externalFixContext.rejectedSpec,
              afterSpec: correctedSpec,
              findings: lessonFindings,
              context: 'Applied external CircuitSpec correction.',
              content: null,
            },
      );
      updateRepairState({ repairDiagnostics: [], retryAttempt: 0, retryKind: undefined });
    } catch (error) {
      if (
        activeSessionIdRef.current === sessionIdAtStart &&
        externalFixContextKeyRef.current === contextKeyAtStart
      ) {
        setExternalFixFeedback(
          error instanceof Error
            ? error.message
            : 'The pasted correction could not be prepared for validation.',
        );
      }
    } finally {
      externalFixValidationRef.current = false;
      setExternalFixValidationPending(false);
    }
  };

  const runRequest = async (
    request: CircuitBuildChatInput,
    draftRevisionAtStart: number,
    protectedElementsBaseSpec?: NonNullable<CircuitBuildChatInput['currentSpec']>,
    preserveRejectedProposal = false,
    rememberForRetry = true,
    repairLessonSeed?: RepairLessonEvidence,
    preservedRejectedProposalOverride?: CircuitBuildChatInput['currentSpec'],
    allowConnectivityChange = false,
  ) => {
    const safeRequest = normalizeCircuitBuildRequest(request);
    stopRepairAfterAttemptRef.current = false;
    setRepairStopRequested(false);
    setRepairStopAvailable(Boolean(preserveRejectedProposal || protectedElementsBaseSpec));
    if (rememberForRetry) setLastRequest(safeRequest);
    if (preserveRejectedProposal && preservedRejectedProposalOverride) {
      setRejectedProposalSpec(preservedRejectedProposalOverride);
      setRejectedProposalSvg(renderRejectedProposalPreview(preservedRejectedProposalOverride));
    }
    setLastProtectedElementsBaseSpec(protectedElementsBaseSpec ?? null);
    if (!preserveRejectedProposal) setRetryFeedback(null);
    setRepairDiagnostics([]);
    setProposalRepairLesson(null);
    setRepairLessonNotice(null);
    clearProposalQualityReview();
    if (!preserveRejectedProposal) {
      setRejectedProposalSpec(null);
      setRejectedProposalSvg('');
    }
    setRejectedSpecCopyState('idle');
    setRetryAttempt(0);
    setRetryKind(null);
    setRepairStatus('running');
    setRequestCycleActive(true);
    chatMutation.reset();
    const abortController = new AbortController();
    buildAbortControllerRef.current = abortController;
    let latestBrief = safeRequest.brief ?? emptyBrief();
    try {
      const {
        response,
        proposalInspection,
        request: completedRequest,
        repairDiagnostics: completedRepairDiagnostics,
        repairLessonContext,
      } = await runCircuitBuildAttempts({
        initialRequest: safeRequest,
        allowConnectivityChange,
        signal: abortController.signal,
        send: (workingRequest) => chatMutation.mutateAsync({ data: workingRequest }),
        getProposal: (result) => result.proposal?.spec ?? null,
        inspectProposal,
        prepareResponse: (result) => {
          if (!result.proposal?.spec || !window.CircuitDraw) return result;
          const beforeConnectivity = getConnectivitySignature(result.proposal.spec, true);
          const autoFixed = window.CircuitDraw.autoFix(result.proposal.spec);
          const afterConnectivity = getConnectivitySignature(autoFixed.spec, true);
          if (
            autoFixed.changes.length &&
            !hasStablePinConnectivitySignature(beforeConnectivity, afterConnectivity)
          ) return result;
          return autoFixed.changes.length
            ? { ...result, proposal: { ...result.proposal, spec: autoFixed.spec } }
            : result;
        },
        getConnectivitySignature: (candidate) =>
          getConnectivitySignature(candidate as CircuitSpec),
        initialProtectedSpec: protectedElementsBaseSpec ?? undefined,
        getProtectedCircuitSignature: (spec) =>
          getProtectedCircuitSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
        getProtectedCircuitChanges: (baseline, candidate) =>
          getProtectedCircuitChanges(
            baseline as NonNullable<CircuitBuildChatInput['currentSpec']>,
            candidate as NonNullable<CircuitBuildChatInput['currentSpec']>,
          ),
        restoreProtectedSpec: (result, baseline) => {
          if (!result.proposal?.spec) return result;
          return {
            ...result,
            proposal: {
              ...result.proposal,
              spec: restoreProtectedNonWireElements(
                baseline as NonNullable<CircuitBuildChatInput['currentSpec']>,
                result.proposal.spec,
              ),
            },
          };
        },
        makeRepairRequest: (result, findings) => buildRepairRequest(
          safeRequest,
          latestBrief,
          findings,
          result.proposal?.spec ?? request.currentSpec,
        ),
        makeOutputRepairRequest: buildOutputRepairRequest,
        onResponse: (result) => {
          latestBrief = result.brief ?? latestBrief;
        },
        onRetry: (attempt, kind) => {
          setRetryAttempt(attempt);
          setRetryKind(kind);
          if (kind === 'repair') setRepairStopAvailable(true);
        },
        shouldStopRepair: () => stopRepairAfterAttemptRef.current,
      });
        const nextMode = response.nextMode ?? completedRequest.mode;
        const nextBrief = response.brief ?? latestBrief;
        latestBrief = nextBrief;
        const hasStagedRepair = nextMode === 'build' &&
          !!response.proposal &&
          !!proposalInspection;

        setMode(nextMode);
        if (hasStagedRepair || !preserveRejectedProposal) {
          setRetryFeedback(null);
        } else {
          const preservedSpec = asCircuitSpec(preservedRejectedProposalOverride) ??
            asCircuitSpec(rejectedProposalSpec);
          if (preservedSpec) {
            setRejectedProposalSpec(preservedSpec);
            setRejectedProposalSvg(renderRejectedProposalPreview(preservedSpec));
          }
          setRetryFeedback({
            message: 'Studio answered without returning a repaired circuit proposal. The existing draft and your repair reference are still available; clarify the request or continue the repair.',
            canRetryManually: true,
            ...(retryFeedback?.validationFindings?.length
              ? { validationFindings: retryFeedback.validationFindings }
              : {}),
            ...(retryFeedback?.validationWarnings?.length
              ? { validationWarnings: retryFeedback.validationWarnings }
              : {}),
          });
        }
        setSaved((current) => ({
          ...current,
          brief: mergeBriefPreservingManualEdits(current.aiBrief, current.brief, nextBrief),
          aiBrief: nextBrief,
          messages: [
            ...current.messages,
            newMessage(
              'assistant',
              response.answer,
              response.suggestedActions,
              { buildApprovalRequest: response.buildApprovalRequested },
            ),
          ].slice(-60),
        }));
        if (hasStagedRepair || !preserveRejectedProposal) {
          setRejectedProposalSpec(null);
          setRejectedProposalSvg('');
        }
        setRepairDiagnostics(completedRepairDiagnostics);
        setRepairStatus(hasStagedRepair ? 'staged' : preserveRejectedProposal ? 'rejected' : 'idle');
        if (nextMode === 'build' && response.proposal && proposalInspection) {
          setProposal(response.proposal);
          setProposalError('');
          setProposalValidation(proposalInspection.validation);
          setProposalSvg(proposalInspection.svg);
          if (proposalInspection.validation.errors.length) {
            setProposalQualityReview({ kind: 'skipped', reason: 'blocking-findings' });
          } else {
            void runProposalQualityReview(
              response.proposal.spec,
              safeRequest.message,
              nextBrief,
              { automaticLayoutRepair: true, buildRequest: safeRequest },
            );
          }
          const automaticSeed = repairLessonContext
            ? {
                beforeSpec: asCircuitSpec(repairLessonContext.rejectedProposal),
                findings: repairLessonContext.validationFindings,
                context: safeRequest.message,
              }
            : null;
          const lessonSeed = repairLessonSeed ?? (
            automaticSeed?.beforeSpec
              ? {
                  beforeSpec: automaticSeed.beforeSpec,
                  findings: automaticSeed.findings,
                  context: automaticSeed.context,
                }
              : null
          );
          setProposalRepairLesson(
            lessonSeed && lessonSeed.findings.length
              ? {
                  ...lessonSeed,
                  afterSpec: response.proposal.spec,
                  content: response.repairLesson?.trim() || null,
                  context: (lessonSeed.context ?? safeRequest.message).slice(0, 1600),
                }
              : null,
          );
        } else {
          setProposalRepairLesson(null);
        }
        void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
        void queryClient.invalidateQueries({ queryKey: getListCircuitBuilderMemoriesQueryKey() });
        onTaskComplete(nextMode);
    } catch (error) {
      if (abortController.signal.aborted) {
        setRepairStatus(preserveRejectedProposal ? 'rejected' : 'idle');
        return;
      }
      setSaved((current) => ({
        ...current,
        brief: mergeBriefPreservingManualEdits(current.aiBrief, current.brief, latestBrief),
        aiBrief: latestBrief,
      }));
      setMode((currentMode) => getModeAfterFailedRequest(currentMode, safeRequest.mode));
      if (error instanceof CircuitBuildAttemptError) {
        const rejectedSpec = asCircuitSpec(error.rejectedProposal) ??
          (preserveRejectedProposal
            ? asCircuitSpec(preservedRejectedProposalOverride) ?? rejectedProposalSpec
            : null);
        setRejectedProposalSpec(rejectedSpec);
        setRejectedProposalSvg(renderRejectedProposalPreview(rejectedSpec));
        setRepairDiagnostics(error.repairDiagnostics);
        const validationFindings = error.validationFindings.length
          ? error.validationFindings
          : preserveRejectedProposal ? retryFeedback?.validationFindings ?? [] : [];
        const validationWarnings = error.validationWarnings.length
          ? error.validationWarnings
          : preserveRejectedProposal ? retryFeedback?.validationWarnings ?? [] : [];
        const causeMessage = error.cause instanceof Error
          ? error.cause.message
          : 'The request did not go through. Your message is still here.';
        let message: string;
        if (error.failureKind === 'validation') {
          message = error.validationFindings.length
            ? formatValidationFailure(error.repairAttemptCount)
            : 'The proposal could not be checked. Your message is still here.';
        } else if (error.failureKind === 'output') {
          const compatibilityMessage = error.cause instanceof Error
            ? error.cause.message
            : '';
          message = /unsupported circuit element type:|element is missing required properties:/i.test(compatibilityMessage)
            ? `${compatibilityMessage} Your message and notes are unchanged; you can retry or choose a supported component.`
            : 'The assistant response still did not match Circuit Studio’s required format. Your message and notes are unchanged; you can retry or simplify the request.';
        } else {
          message = error.retryCount > 0
            ? `The request failed after ${error.retryCount} automatic retr${error.retryCount === 1 ? 'y' : 'ies'}. ${causeMessage}`
            : causeMessage;
        }
        if (error.stoppedByUser) {
          message = rejectedSpec
            ? 'Repair stopped after the current attempt. The latest proposal and its findings are available below; you can continue the repair manually.'
            : 'Repair stopped after the current attempt. Your existing circuit and repair reference are still available.';
        }
        if (preserveRejectedProposal && rejectedSpec && error.failureKind !== 'validation') {
          message = `${message} The previous proposal is preserved below for another repair attempt.`;
        }
        setRetryFeedback({
          message,
          canRetryManually: error.canRetryManually,
          ...(validationFindings.length ? { validationFindings } : {}),
          ...(validationWarnings.length ? { validationWarnings } : {}),
        });
      } else {
        setRepairDiagnostics([]);
        if (!preserveRejectedProposal) {
          setRejectedProposalSpec(null);
          setRejectedProposalSvg('');
        }
        setRetryFeedback({
          message: `${error instanceof Error ? error.message : 'The request did not go through. Your message is still here.'}${preserveRejectedProposal ? ' The previous proposal remains available for another repair attempt.' : ''}`,
          canRetryManually: true,
          ...(preserveRejectedProposal && retryFeedback?.validationFindings?.length
            ? { validationFindings: retryFeedback.validationFindings }
            : {}),
          ...(preserveRejectedProposal && retryFeedback?.validationWarnings?.length
            ? { validationWarnings: retryFeedback.validationWarnings }
            : {}),
        });
      }
      setRepairStatus('rejected');
    } finally {
      if (!abortController.signal.aborted) {
        composerRef.current?.clearDraftIfUnchanged(draftRevisionAtStart, safeRequest.message);
      }
      if (buildAbortControllerRef.current === abortController) {
        buildAbortControllerRef.current = null;
      }
      setRequestCycleActive(false);
      setRepairStopAvailable(false);
      setRepairStopRequested(false);
      stopRepairAfterAttemptRef.current = false;
      setRetryAttempt(0);
      setRetryKind(null);
      setIsStoppingWork(false);
    }
  };

  const handleSubmitMessage = async (content: string, draftRevisionAtStart: number) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || briefEditing || hasUnappliedJsonEdits) return;
    if (chatMutation.isPending || requestCycleActive) return;
    const intent = getLocalBuilderModeIntent(normalizedContent);
    if (proposal && intent !== 'chat') return;
    if (intent === 'chat') {
      const userMessage = newMessage('user', normalizedContent);
      const assistantMessage = newMessage('assistant', 'Chat mode is on. We can clarify the idea without changing the schematic.');
      composerRef.current?.clearDraftIfUnchanged(draftRevisionAtStart, normalizedContent);
      setMode('chat');
      setSaved((current) => ({
        ...current,
        messages: [...current.messages, userMessage, assistantMessage].slice(-60),
      }));
      return;
    }

    const lastMessage = saved.messages.at(-1);
    const approvalIsPending =
      lastMessage?.role === 'assistant' && lastMessage.buildApprovalRequest === true;
    const buildIsAuthorized =
      mode === 'build' ||
      intent === 'build' ||
      isExplicitBuildRequest(normalizedContent) ||
      isExplicitBuildApproval(normalizedContent, approvalIsPending);
    const requestMode: ChatMode = buildIsAuthorized ? 'build' : mode;
    // Direct build requests and explicit approvals may enter Build mode. An
    // inferred request stays in Chat until the user approves the question.
    setMode(requestMode);
    const userMessage = newMessage('user', normalizedContent);
    setSaved((current) => ({
      ...current,
      messages: [...current.messages, userMessage].slice(-60),
    }));
    const history = saved.messages
      .slice(-8)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    await runRequest({
      message: normalizedContent,
      mode: requestMode,
      currentSpec,
      history,
      brief: saved.brief,
    }, draftRevisionAtStart);
  };

  const retryRequest = async () => {
    if (!lastRequest || chatMutation.isPending || requestCycleActive) return;
    const findings = retryFeedback?.validationFindings ?? [];
    const continuingRejectedProposal = !!rejectedProposalSpec && findings.length > 0;
    const request = buildManualRetryRequest(
      lastRequest,
      saved.brief,
      rejectedProposalSpec,
      findings,
    );
    await runRequest(
      request,
      composerRef.current?.getDraftRevision() ?? 0,
      lastProtectedElementsBaseSpec ?? (continuingRejectedProposal ? rejectedProposalSpec : undefined) ?? undefined,
      continuingRejectedProposal,
      false,
    );
  };

  const runRecoveryRetry = async () => {
    if (!lastRequest || chatMutation.isPending || requestCycleActive) return;
    const findings = retryFeedback?.validationFindings ?? [];
    const rejectedSpec = asCircuitSpec(rejectedProposalSpec);
    const recoveryKind = getRetryRecoveryKind(
      repairDiagnostics,
      findings,
      rejectedProposalSpec,
    );
    if (!rejectedSpec || !recoveryKind) return;

    const repairLessonSeed = rejectedSpec && findings.length
      ? {
          beforeSpec: rejectedSpec,
          findings,
          context: (() => {
            const attemptedRepairs = repairDiagnostics.reduce(
              (maximum, diagnostic) => Math.max(maximum, diagnostic.attempt),
              0,
            );
            return recoveryKind === 'rewire'
              ? `After ${attemptedRepairs} automatic repair attempts, the circuit wiring was rebuilt while preserving its components.`
              : `A new circuit proposal was created after ${attemptedRepairs} automatic repair attempts could not resolve component or specification errors.`;
          })(),
        }
      : undefined;
    const request = recoveryKind === 'rewire'
      ? buildWireRebuildRequest(lastRequest, saved.brief, rejectedSpec, findings)
      : buildWholeCircuitRetryRequest(lastRequest, saved.brief);
    const protectedBaseline = recoveryKind === 'rewire'
      ? asCircuitSpec(request.currentSpec)
      : null;

    await runRequest(
      request,
      composerRef.current?.getDraftRevision() ?? 0,
      protectedBaseline ?? undefined,
      recoveryKind === 'rewire',
      true,
      repairLessonSeed,
      undefined,
      recoveryKind === 'rewire',
    );
  };

  const repairCurrentDraft = () => {
    if (
      !canRepairCurrentDraft ||
      !validationFindings.length ||
      !currentSpec ||
      hasUnappliedJsonEdits ||
      proposal ||
      chatMutation.isPending ||
      requestCycleActive ||
      briefEditing
    ) return;

    const message = [
      'Repair the current workbench draft using the CircuitDraw validation findings below.',
      'Preserve every existing component, value, label, orientation, and position exactly. Repair the wiring only, unless a finding explicitly requires otherwise.',
      'Return a complete corrected proposal and do not claim that structural validation proves electrical correctness or safety.',
      '',
      'Validator findings:',
      ...validationFindings.map((finding) => `- ${finding}`),
    ].join('\n');
    const history = saved.messages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const userMessage = newMessage('user', message);
    setMode('build');
    setSaved((current) => ({
      ...current,
      messages: [...current.messages, userMessage].slice(-60),
    }));
    void runRequest({
      message,
      mode: 'build',
      currentSpec,
      history,
      brief: saved.brief,
    }, composerRef.current?.getDraftRevision() ?? 0, currentSpec);
  };

  useEffect(() => {
    const request = jsonRepairRequest;
    if (
      !request ||
      handledJsonRepairRequestRef.current === request.id ||
      proposal ||
      chatMutation.isPending ||
      requestCycleActive
    ) return;

    handledJsonRepairRequestRef.current = request.id;
    const validationContext = request.validationFindings?.length
      ? `CircuitDraw found these structural issues:\n${request.validationFindings.map((finding) => `- ${finding}`).join('\n')}`
      : `JSON parse or shape issue: ${request.parseError}`;
    const messagePrefix = [
      'The user edited the CircuitSpec JSON directly and clicked Apply edit for help.',
      'Use the raw edit to understand the intended changes. Preserve clear intent, repair the CircuitSpec when possible, and do not discard the requested changes just because the JSON is malformed.',
      'If the intended circuit behavior cannot be inferred without guessing, ask one focused clarification instead of inventing behavior.',
      'Return a complete corrected CircuitSpec as a staged proposal. Do not claim that drawing validation proves electrical correctness or safety.',
      '',
      validationContext.slice(0, 1200),
      '',
      'User-edited CircuitSpec JSON:',
      '```json',
    ].join('\n');
    const closingFence = '\n```';
    const rawJsonBudget = Math.max(0, 5900 - messagePrefix.length - closingFence.length);
    const rawJsonContext = request.rawJson.length <= rawJsonBudget
      ? request.rawJson
      : `${request.rawJson.slice(0, Math.max(0, rawJsonBudget - 54))}\n[Remaining JSON omitted to fit the builder request.]`;
    const message = `${messagePrefix}\n${rawJsonContext}${closingFence}`;
    const history = saved.messages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const userMessage = newMessage('user', message);
    setMode('build');
    setSaved((current) => ({
      ...current,
      messages: [...current.messages, userMessage].slice(-60),
    }));

    void runRequest({
      message,
      mode: 'build',
      currentSpec: request.baseSpec,
      history,
      brief: saved.brief,
    }, composerRef.current?.getDraftRevision() ?? 0).finally(() => {
      onJsonRepairRequestHandled(request.id);
    });
  }, [
    jsonRepairRequest,
    proposal,
    chatMutation.isPending,
    requestCycleActive,
    saved,
    currentSpec,
    runRequest,
    onJsonRepairRequestHandled,
  ]);

  const editBrief = () => {
    setBriefGoalDraft(saved.brief.goal);
    setBriefRequirementsDraft(saved.brief.requirements.join('\n'));
    setBriefAssumptionsDraft(saved.brief.assumptions.join('\n'));
    setBriefOpenQuestionsDraft(saved.brief.openQuestions.join('\n'));
    setBriefEditing(true);
  };

  const saveBrief = () => {
    setSaved((current) => ({
      ...current,
      brief: {
        goal: briefGoalDraft.trim().slice(0, 1000),
        requirements: noteLines(briefRequirementsDraft),
        assumptions: noteLines(briefAssumptionsDraft),
        openQuestions: noteLines(briefOpenQuestionsDraft),
      },
    }));
    setBriefEditing(false);
  };

  const clearTransientConversationState = () => {
    chatMutation.reset();
    setSaved((current) => ({
      ...current,
      repair: createEmptyRepairRecoveryState<CircuitSpec, CircuitBuildChatInput>(),
    }));
    setProposalSvg('');
    setProposalError('');
    setRepairLessonNotice(null);
    clearProposalQualityReview();
    setRejectedProposalSvg('');
    setRejectedPreviewOpen(false);
    setRejectedSpecCopyState('idle');
    setExternalFixCopiedContextKey(null);
    setExternalFixCopyState('idle');
    setBriefEditing(false);
  };

  const clearCurrentConversation = () => {
    if (chatMutation.isPending || requestCycleActive) return;
    clearTransientConversationState();
    setSaved(normalizeSavedState(null));
    setMode('chat');
    setHistoryOpen(false);
    setClearChatOpen(false);
  };

  const startNewConversation = () => {
    if (chatMutation.isPending || requestCycleActive) return;
    const now = getNextBuilderHistoryTimestamp(activeSession.updatedAt);
    const currentSession = createBuilderHistorySession({
      id: activeSessionId,
      saved,
      currentSpec,
      mode,
      now,
      createdAt: activeSession.createdAt,
    });
    const nextSession = createBuilderHistorySession({
      id: createHistoryId(),
      saved: normalizeSavedState(null),
      currentSpec,
      mode: 'chat',
    });
    setSessions((current) => upsertBuilderHistorySession(
      upsertBuilderHistorySession(current, currentSession),
      nextSession,
    ));
    clearTransientConversationState();
    setActiveSessionId(nextSession.id);
    setSaved(nextSession.saved);
    setMode('chat');
    setHistoryOpen(false);
  };

  const openHistorySession = (session: BuilderHistoryEntry) => {
    if (
      session.id === activeSessionId ||
      chatMutation.isPending ||
      requestCycleActive
    ) {
      setHistoryOpen(false);
      return;
    }
    const now = getNextBuilderHistoryTimestamp(activeSession.updatedAt);
    const currentSession = createBuilderHistorySession({
      id: activeSessionId,
      saved,
      currentSpec,
      mode,
      now,
      createdAt: activeSession.createdAt,
    });
    setSessions((current) => upsertBuilderHistorySession(current, currentSession));
    pendingRestoreRef.current = {
      sessionId: session.id,
      specSignature: JSON.stringify(session.currentSpec),
      spec: session.currentSpec,
    };
    clearTransientConversationState();
    setActiveSessionId(session.id);
    setSaved(session.saved);
    setMode(session.mode);
    onApplySpec(session.currentSpec, 'history');
    setHistoryOpen(false);
  };

  const deleteHistorySession = async () => {
    const target = historyDeleteTarget;
    if (
      !target ||
      historyDeleteMutation.isPending ||
      historySyncMutation.isPending ||
      chatMutation.isPending ||
      requestCycleActive
    ) return;

    setHistoryDeleteError('');
    try {
      await historyDeleteMutation.mutateAsync({ sessionId: target.id });
      const nextSessions = sessions.filter((session) => session.id !== target.id);

      if (target.id === activeSessionId) {
        const nextSession = createBuilderHistorySession({
          id: createHistoryId(),
          saved: normalizeSavedState(null),
          currentSpec,
          mode: 'chat',
        });
        nextSessions.unshift(nextSession);
        pendingRestoreRef.current = null;
        clearTransientConversationState();
        setActiveSessionId(nextSession.id);
        setSaved(nextSession.saved);
        setMode('chat');
      }

      setSessions(nextSessions);
      setHistoryDeleteTarget(null);
      void queryClient.invalidateQueries({
        queryKey: [...getListCircuitBuilderHistoryQueryKey(), userId],
      });
      void queryClient.invalidateQueries({
        queryKey: [...getListDeletedCircuitBuilderHistoryQueryKey(), userId],
      });
    } catch {
      setHistoryDeleteError('This conversation could not be deleted. It is still saved; please try again.');
    }
  };

  const prepareComponentPrompt = (
    entry: CircuitComponentLibraryEntry | CircuitSymbolSearchItem,
  ) => {
    setMode('build');
    if ('id' in entry) {
      const description = [
        entry.shortDescription || entry.description,
        entry.longDescription,
        entry.keywords ? `Search terms: ${entry.keywords}` : '',
        entry.researchStatus === 'needs_review'
          ? 'Description status: needs review; purpose is unverified.'
          : '',
      ].filter(Boolean).join(' ');
      composerRef.current?.setDraft(
        `Use this exact KiCad symbol ID: ${entry.id}. Add ${entry.name} to my current schematic using its real library pin names and positions.${description ? ` Symbol details: ${description}.` : ''}`,
      );
      return;
    }
    composerRef.current?.setDraft(
      entry.category === 'Drawing'
        ? `Add a ${entry.displayName} (${entry.type}) drawing annotation to my current schematic. Do not treat it as an electrical component.`
        : `Use a ${entry.displayName} (${entry.type}) in my current design. Reference: ${entry.shortDescription} ${entry.longDescription} Use its supported pin model and ask me for any missing ratings or verified pinout before assuming them.`,
    );
  };

  const prepareSuggestedAction = (
    action: CircuitBuilderSuggestedAction,
    isReplyToQuestion: boolean,
  ) => {
    if (!isReplyToQuestion && isExplicitBuildRequest(action.prompt)) setMode('build');
    composerRef.current?.setDraft(action.prompt);
  };

  const discardProposal = () => {
    setSaved((current) => ({
      ...current,
      repair: discardStagedRepairProposal(current.repair),
    }));
    setProposalSvg('');
    clearProposalQualityReview();
  };

  const reviseProposalFromFeedback = async (
    reason: ProposalFeedbackReason,
    details: string,
  ) => {
    const currentProposal = proposal;
    const revisionSpec = currentProposal?.spec ?? currentSpec;
    if (!revisionSpec || chatMutation.isPending || requestCycleActive) return;
    const reasonText: Record<ProposalFeedbackReason, string> = {
      'incorrect-wiring': 'the wiring was incorrect',
      'wrong-parts-or-values': 'the parts or values were wrong',
      'poor-readability': 'the schematic was hard to read',
      'missed-request': 'the proposal did not match the request',
      other: 'another issue needed correction',
    };
    const goal = saved.brief.goal.trim() ||
      lastRequest?.message.trim() ||
      revisionSpec.title;
    const userDetail = details.trim()
      ? ` My detail: ${details.trim().slice(0, 500)}`
      : '';
    const revisionPrompt = [
      `Please revise the "${revisionSpec.title}" circuit based on my feedback: ${reasonText[reason]}.${userDetail}`,
      `Keep the original goal: "${goal.slice(0, 600)}".`,
      'Address the specific issue, improve the schematic readability where needed, and do not invent missing ratings or values.',
      'Return a new staged proposal for me to review; do not apply it to the workbench.',
    ].join(' ').slice(0, 3000);
    const history = saved.messages
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));
    const request: CircuitBuildChatInput = {
      message: revisionPrompt,
      mode: 'build',
      currentSpec: revisionSpec,
      history,
      brief: saved.brief,
    };
    setRejectedProposalSpec(revisionSpec);
    setRejectedProposalSvg(renderRejectedProposalPreview(revisionSpec));
    setMode('build');
    setSaved((current) => ({
      ...current,
      messages: [...current.messages, newMessage('user', revisionPrompt)].slice(-60),
    }));
    if (currentProposal) discardProposal();
    await runRequest(
      request,
      composerRef.current?.getDraftRevision() ?? 0,
      undefined,
      true,
      true,
      undefined,
      revisionSpec,
    );
  };

  const applyProposal = () => {
    if (
      !proposal ||
      !proposalSvg ||
      !proposalValidation ||
      proposalValidation.errors.length ||
      proposalQualityReview.kind === 'loading'
    ) return;
    setAppliedProposalFeedback({
      id: ++appliedProposalFeedbackIdRef.current,
      circuitTitle: proposal.spec.title,
      requestSummary: saved.brief.goal || lastRequest?.message || '',
      specSignature: JSON.stringify(proposal.spec),
    });
    onApplySpec(proposal.spec);
    if (proposalRepairLesson) void saveRepairLesson(proposalRepairLesson);
    setSaved((current) => ({
      ...current,
      repair: clearAppliedRepairRecovery(current.repair),
    }));
    setProposalSvg('');
    clearProposalQualityReview();
    setRejectedProposalSvg('');
    setExternalFixCopiedContextKey(null);
    setExternalFixCopyState('idle');
  };

  const errorMessage = retryFeedback?.message ?? (
    chatMutation.error instanceof Error
      ? chatMutation.error.message
      : 'The request did not go through. Your message is still here.'
  );
  const retryRecoveryKind = getRetryRecoveryKind(
    repairDiagnostics,
    retryFeedback?.validationFindings ?? [],
    rejectedProposalSpec,
  );
  const proposalTopologyErrors = proposalValidation?.topologyErrors ?? [];
  const proposalTopologyWarnings = proposalValidation?.topologyWarnings ?? [];
  const isExternalCircuitFixProposal =
    proposal?.summary.startsWith('External correction:') ?? false;
  const proposalStructuralErrors = proposalValidation?.errors.filter(
    (finding) => !proposalTopologyErrors.includes(finding),
  ) ?? [];
  const proposalLayoutWarnings = proposalValidation?.warnings.filter(
    (warning) => !proposalTopologyWarnings.includes(warning),
  ) ?? [];
  const hasBrief = Boolean(saved.brief.goal || saved.brief.requirements.length || saved.brief.assumptions.length || saved.brief.openQuestions.length);
  const retryHistorySync = () => {
    if (!historyQuery.isSuccess || !historyDeletionsQuery.isSuccess) {
      void historyQuery.refetch();
      void historyDeletionsQuery.refetch();
      return;
    }

    void syncHistorySessions(sessions)
      .then(() => setHistorySaveError(''))
      .catch(() => {
        setHistorySaveError('Could not sync conversation history to your account. This device still has its local copy.');
      });
  };

  return (
    <section className="builder-chat" aria-label="Conversational circuit builder" data-testid="panel-circuit-builder-chat">
      <header className="builder-chat__header">
        <div className="builder-chat__identity">
          <div>
            <h2>Build through conversation</h2>
            <p className="builder-chat__session-title" title={activeSession.title}>{activeSession.title}</p>
          </div>
        </div>
        <div className="builder-chat__header-tools">
          <button
            className="builder-chat__icon-link"
            type="button"
            onClick={startNewConversation}
            disabled={!historyHydrated || chatMutation.isPending || requestCycleActive}
            aria-label="Start a new conversation"
            title="Start a new conversation"
            data-testid="button-new-builder-conversation"
          >
            <Plus aria-hidden="true" />
          </button>
          <button
            className={`builder-chat__icon-link${historyOpen ? ' is-active' : ''}`}
            type="button"
            onClick={() => setHistoryOpen((open) => !open)}
            disabled={!historyHydrated || chatMutation.isPending || requestCycleActive}
            aria-expanded={historyOpen}
            aria-controls="builder-conversation-history"
            aria-label={`Recent conversations, ${sessions.length} saved`}
            title="Recent conversations"
            data-testid="button-builder-history"
          >
            <History aria-hidden="true" />
          </button>
          <button
            className={`builder-chat__icon-link${memoryOpen ? ' is-active' : ''}`}
            type="button"
            onClick={() => setMemoryOpen(true)}
            disabled={!historyHydrated}
            aria-expanded={memoryOpen}
            aria-label="Review saved assumptions"
            title="What I remember"
            data-testid="button-builder-memory"
          >
            <Brain aria-hidden="true" />
          </button>
          <button
            className="builder-chat__icon-link"
            type="button"
            onClick={() => setComponentLibraryOpen(true)}
            aria-label="Open component library"
            title="Browse component library"
            data-testid="button-open-component-library"
          >
            <Library aria-hidden="true" />
          </button>
          <button
            className="builder-chat__icon-link"
            type="button"
            onClick={() => setClearChatOpen(true)}
            disabled={!historyHydrated || chatMutation.isPending || requestCycleActive}
            aria-label="Clear current chat"
            title="Clear current chat"
            data-testid="button-clear-builder-chat"
          >
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>

      <CircuitBuilderMemoryDialog
        open={memoryOpen}
        onOpenChange={setMemoryOpen}
        historyImportStatus={historyImportStatus}
        onRetryHistoryImport={() => void runHistoryImport()}
      />

      {historyOpen && (
        <section
          className="builder-chat__history"
          id="builder-conversation-history"
          aria-label="Recent conversations"
          data-testid="panel-builder-history"
        >
          <div className="builder-chat__history-heading">
            <div>
              <strong>Recent chats</strong>
              <span>{sessions.length} saved</span>
            </div>
            <button type="button" className="builder-chat__text-link" onClick={() => setHistoryOpen(false)}>Close</button>
          </div>
          {historySaveError && (
            <p className="builder-chat__history-error" role="status">
              {historySaveError}{' '}
              <button className="builder-chat__text-link" type="button" onClick={retryHistorySync} data-testid="button-retry-history-sync">
                Retry sync
              </button>
            </p>
          )}
          <div className="builder-chat__history-list" role="list">
            {sessions.map((session) => (
              <div className="builder-chat__history-row" key={session.id} role="listitem">
                <button
                  type="button"
                  className={`builder-chat__history-item${session.id === activeSessionId ? ' is-current' : ''}`}
                  onClick={() => openHistorySession(session)}
                  disabled={!historyHydrated || historyDeleteMutation.isPending || chatMutation.isPending || requestCycleActive}
                  aria-current={session.id === activeSessionId ? 'page' : undefined}
                  data-testid={`button-builder-history-${session.id}`}
                >
                  <span className="builder-chat__history-item-top">
                    <strong>{session.title}</strong><time dateTime={new Date(session.updatedAt).toISOString()}>{formatHistoryTime(session.updatedAt)}</time>
                  </span>
                  <span className="builder-chat__history-preview">{getBuilderHistoryPreview(session.saved.messages)}</span>
                </button>
                <button
                  type="button"
                  className="builder-chat__history-delete"
                  onClick={() => {
                    setHistoryDeleteError('');
                    setHistoryDeleteTarget(session);
                  }}
                  disabled={!historyHydrated || historyDeleteMutation.isPending || historySyncMutation.isPending || chatMutation.isPending || requestCycleActive}
                  aria-label={`Delete conversation: ${session.title}`}
                  title="Delete conversation"
                  data-testid={`button-delete-builder-history-${session.id}`}
                >
                  <Trash2 aria-hidden="true" />
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {historySaveError && !historyOpen && (
        <p className="builder-chat__history-error" role="status">
          {historySaveError}{' '}
          <button className="builder-chat__text-link" type="button" onClick={retryHistorySync} data-testid="button-retry-history-sync">
            Retry sync
          </button>
        </p>
      )}

      <div className="builder-chat__mode-row">
        <div className="builder-chat__mode-tabs" role="tablist" aria-label="Conversation mode" data-testid="group-builder-modes">
          <button type="button" role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'is-active' : ''} onClick={() => setMode('chat')} disabled={!historyHydrated} data-testid="button-builder-mode-chat">
            <MessageCircle aria-hidden="true" /> Chat
          </button>
          <button type="button" role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'is-active' : ''} onClick={() => setMode('build')} disabled={!historyHydrated} data-testid="button-builder-mode-build">
            <Wrench aria-hidden="true" /> Build
          </button>
        </div>
        <p className="builder-chat__sr-only" role="status" aria-live="polite" data-testid="status-builder-mode">{mode === 'chat' ? 'Clarify the idea, no edits proposed' : 'Shape an editable draft for review'}</p>
      </div>
      {canRepairCurrentDraft &&
        validationFindings.length > 0 &&
        dismissedRepairNoticeKey !== repairNoticeKey && (
        <div className="builder-chat__repair-notice" data-testid="panel-repair-current-draft">
          <div>
            <strong>{validationFindings.length} structural issue{validationFindings.length === 1 ? '' : 's'} found</strong>
            <p>Studio will check the fix. Your drawing changes only when you apply it.</p>
          </div>
          <div className="builder-chat__repair-notice-actions">
            <button
              type="button"
              className="builder-chat__repair-action"
              onClick={repairCurrentDraft}
              disabled={aiUnavailable || chatMutation.isPending || requestCycleActive || briefEditing || !!proposal}
              title={proposal ? 'Apply or discard the staged proposal first.' : undefined}
              data-testid="button-repair-current-draft"
            >
              <Wrench aria-hidden="true" />
              {requestCycleActive ? 'Repairing…' : 'Repair draft with AI'}
            </button>
            <button
              type="button"
              className="builder-chat__repair-dismiss"
              onClick={() => setDismissedRepairNoticeKey(repairNoticeKey)}
              aria-label="Close structural issue banner"
              title="Close"
              data-testid="button-dismiss-repair-notice"
            >
              <X aria-hidden="true" />
            </button>
          </div>
        </div>
      )}

      <div className="builder-chat__body">
        <div className="builder-chat__conversation">
          <div className="builder-chat__thread" role="log" aria-live="polite" aria-label="Conversation" data-testid="list-builder-messages">
            {visibleMessages.map((message, index) => {
              const assistantQuestion = message.role === 'assistant'
                ? getFinalAssistantQuestion(message.content)
                : null;
              const suggestedActions = message.role === 'assistant'
                ? getContextualSuggestedActions(
                    message.content,
                    Array.isArray(message.suggestedActions)
                      ? message.suggestedActions.filter(isSuggestedAction)
                      : [],
                  ).slice(0, 2)
                : [];
              return (
              <article className={`builder-chat__message is-${message.role}`} key={message.id} data-testid={`message-builder-${message.role}-${index}`}>
                <span className="builder-chat__message-label">{message.role === 'assistant' ? 'Studio' : 'You'}</span>
                <p>{message.content}</p>
                {suggestedActions.length > 0 && (
                  <div className="builder-chat__suggested-actions" data-testid={`list-builder-suggested-actions-${index}`}>
                    <span>{assistantQuestion ? 'Possible replies' : 'Suggested next steps'} · review before sending</span>
                    <div>
                      {suggestedActions.map((action, actionIndex) => (
                        <button
                          key={`${message.id}-action-${actionIndex}`}
                          type="button"
                          onClick={() => prepareSuggestedAction(action, !!assistantQuestion)}
                          data-testid={`button-builder-suggested-action-${index}-${actionIndex}`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
              );
            })}
            {(chatMutation.isPending || requestCycleActive) && (
              <div className="builder-chat__thinking" role="status" data-testid="status-builder-loading">
                <span className="builder-chat__thinking-mark"><Sparkles aria-hidden="true" /></span>
                <span><i /><i /><i /></span>
                <small>{retryAttempt > 0
                  ? retryKind === 'format'
                    ? `Fixing response format · retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                    : retryKind === 'repair'
                    ? `Preparing proposal · retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                    : `Automatic retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                  : mode === 'build' ? 'Working through a draft' : 'Thinking it through'}</small>
                {repairStopAvailable && (
                  <button
                    type="button"
                    className="builder-chat__text-link"
                    onClick={() => {
                      stopRepairAfterAttemptRef.current = true;
                      setRepairStopRequested(true);
                    }}
                    disabled={repairStopRequested}
                    data-testid="button-stop-repair-after-current-attempt"
                  >
                    {repairStopRequested ? 'Stopping after this attempt…' : 'Stop after this repair attempt'}
                  </button>
                )}
              </div>
            )}
          </div>
          {retryFeedback && !requestCycleActive && (
            <>
              <div className="builder-chat__error" role="alert" data-testid="status-builder-error">
                <span>{errorMessage}</span>
                <div className="builder-chat__retry-actions">
                  {retryFeedback.canRetryManually && (
                    <button type="button" className="builder-chat__text-link" onClick={retryRequest} disabled={!lastRequest || hasUnappliedJsonEdits} data-testid="button-retry-builder-chat">
                      {rejectedProposalSpec && retryFeedback.validationFindings?.length ? 'Continue repair' : 'Retry'}
                    </button>
                  )}
                  {retryRecoveryKind && (
                    <button
                      type="button"
                      className="builder-chat__fresh-retry"
                      onClick={() => void runRecoveryRetry()}
                      disabled={!lastRequest || hasUnappliedJsonEdits}
                      data-testid={`button-${retryRecoveryKind}-circuit`}
                    >
                      {retryRecoveryKind === 'rewire' ? 'Rewire circuit' : 'Rebuild circuit'}
                    </button>
                  )}
                </div>
              </div>
              {!!retryFeedback.validationFindings?.length && (
                <details className="builder-chat__validation-findings" data-testid="list-builder-validation-findings">
                  <summary>
                    <strong>{retryFeedback.validationFindings.length} blocking validation error{retryFeedback.validationFindings.length === 1 ? '' : 's'}</strong>
                  </summary>
                  <ol>{retryFeedback.validationFindings.map((finding, index) => <li key={`failure-${index}`}>{finding}</li>)}</ol>
                </details>
              )}
              {!!retryFeedback.validationWarnings?.length && (
                <details className="builder-chat__validation-findings is-warning" data-testid="list-builder-validation-warnings">
                  <summary>
                    <strong>{retryFeedback.validationWarnings.length} advisory warning{retryFeedback.validationWarnings.length === 1 ? '' : 's'} (not blocking)</strong>
                  </summary>
                  <ol>{retryFeedback.validationWarnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}</ol>
                </details>
              )}
              {rejectedProposalSpec && (
                <section
                  className="builder-chat__rejected-preview"
                  aria-label="Schematic needing repair"
                  data-testid="preview-rejected-proposal"
                >
                  <div className="builder-chat__rejected-preview-head">
                    <span className="builder-chat__repair-badge">Needs repair</span>
                    {!!rejectedProposalSvg && (
                      <button
                        type="button"
                        className="builder-chat__rejected-preview-toggle"
                        aria-haspopup="dialog"
                        aria-controls="dialog-rejected-proposal-preview"
                        onClick={() => setRejectedPreviewOpen(true)}
                        data-testid="button-toggle-rejected-preview"
                      >
                        <Maximize2 aria-hidden="true" />
                        Expand preview
                      </button>
                    )}
                    <span className="builder-chat__rejected-preview-title">{rejectedProposalSpec.title}</span>
                  </div>
                  {rejectedProposalSvg
                    ? <div
                        className="builder-chat__preview builder-chat__rejected-preview-canvas"
                      >
                        <div className="builder-chat__svg" dangerouslySetInnerHTML={{ __html: rejectedProposalSvg }} />
                      </div>
                    : <p className="builder-chat__rejected-preview-empty">This schematic could not be rendered yet.</p>}
                  <p className="builder-chat__rejected-preview-note">Preview only · not applied</p>
                </section>
              )}
              {rejectedProposalSpec && (
                <details className="builder-chat__rejected" data-testid="details-rejected-proposal">
                  <summary>Inspect rejected CircuitSpec (read-only; not applied)</summary>
                  <div className="builder-chat__rejected-copy-row">
                    <button
                      type="button"
                      className="builder-chat__text-link builder-chat__rejected-copy"
                      onClick={copyRejectedSpec}
                      data-testid="button-copy-rejected-spec"
                    >
                      {rejectedSpecCopyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {rejectedSpecCopyState === 'copied' ? 'Copied' : 'Copy CircuitSpec'}
                    </button>
                    {rejectedSpecCopyState === 'error' && (
                      <span className="builder-chat__rejected-copy-error" role="status">
                        Clipboard access failed.
                      </span>
                    )}
                    <button
                      type="button"
                      className="builder-chat__text-link builder-chat__rejected-copy builder-chat__external-fix-copy"
                      onClick={copyExternalCircuitFixPrompt}
                      disabled={!externalFixContext || chatMutation.isPending || requestCycleActive || externalFixValidationPending}
                      data-testid="button-copy-external-repair-context"
                    >
                      {externalFixCopyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {externalFixCopyState === 'copied' ? 'Context copied' : 'Copy context for external help'}
                    </button>
                    {externalFixCopyState === 'error' && (
                      <span className="builder-chat__rejected-copy-error" role="status">
                        Clipboard access failed. Allow clipboard access and try again.
                      </span>
                    )}
                  </div>
                  <pre>{JSON.stringify(rejectedProposalSpec, null, 2)}</pre>
                </details>
              )}
              {showExternalFixPaste && externalFixContext && (
                <section
                  className="builder-chat__external-fix"
                  aria-label="Paste an external CircuitSpec fix"
                  data-testid="panel-external-circuit-fix"
                >
                  <h3>Paste the corrected CircuitSpec</h3>
                  <p>Paste the complete corrected CircuitSpec here. CircuitStudio checks and stages it as a full replacement; it will not ask AI to repair or regenerate it.</p>
                  <label htmlFor="external-circuit-fix-json">Corrected CircuitSpec JSON</label>
                  <textarea
                    id="external-circuit-fix-json"
                    value={externalFixDraft}
                    maxLength={50000}
                    onChange={(event) => {
                      setExternalFixDraft(event.target.value);
                      setExternalFixFeedback('');
                    }}
                    disabled={chatMutation.isPending || requestCycleActive || externalFixValidationPending}
                    spellCheck={false}
                    rows={8}
                    placeholder="Paste the complete CircuitSpec JSON (code fences are okay)."
                    data-testid="input-external-circuit-fix"
                  />
                  {externalFixFeedback && (
                    <p className="builder-chat__external-fix-feedback is-error" role="alert">
                      {externalFixFeedback}
                    </p>
                  )}
                  <button
                    type="button"
                    className="builder-chat__external-fix-submit"
                    onClick={submitExternalCircuitFix}
                    disabled={!externalFixDraft.trim() || chatMutation.isPending || requestCycleActive || externalFixValidationPending || !!proposal}
                    data-testid="button-submit-external-circuit-fix"
                  >
                    {externalFixValidationPending ? 'Loading symbols and checking…' : 'Check and stage replacement'}
                  </button>
                  <p className="builder-chat__external-fix-note">Applying the staged correction saves a short lesson for similar issues. Structural checks do not prove electrical correctness or safety.</p>
                </section>
              )}
            </>
          )}
          {aiUnavailable && (
            <div className="builder-chat__unavailable" role="status" data-testid="status-builder-ai-unavailable">
              <span><strong>Gemini is not configured.</strong> Your message and brief remain editable; AI requests may fail until a key is configured.</span>
            </div>
          )}
          {usageQuery.isError && (
            <div className="builder-chat__usage-error" role="status" data-testid="status-builder-usage-error">
              AI availability could not be checked. <button className="builder-chat__text-link" type="button" onClick={() => usageQuery.refetch()} data-testid="button-retry-usage-inline">Try again</button>
            </div>
          )}

          {proposal && (
            <section className="builder-chat__proposal" aria-label="Proposed circuit draft" data-testid="panel-builder-proposal">
              <div className="builder-chat__proposal-head">
                <div>
                  <p className="builder-chat__eyebrow">Staged proposal · review before applying</p>
                  <h3>{proposal.summary}</h3>
                </div>
                <button type="button" className="builder-chat__icon-link" aria-label="Discard proposal" onClick={discardProposal} data-testid="button-discard-proposal">
                  <X aria-hidden="true" />
                </button>
              </div>
              <div className="builder-chat__preview" data-testid="preview-builder-proposal">
                {proposalSvg
                  ? <div className="builder-chat__svg" dangerouslySetInnerHTML={{ __html: proposalSvg }} />
                  : <div className="builder-chat__preview-empty" data-testid="status-builder-preview-error">Preview unavailable until the proposal is valid.</div>}
              </div>
              <div className={`builder-chat__validation${proposalValidation?.errors.length ? ' has-errors' : proposalValidation?.warnings.length ? ' has-warnings' : ' is-valid'}`} data-testid="status-builder-validation">
                {proposalStructuralErrors.length > 0 && (
                  <div className="builder-chat__validation-group is-error">
                    <strong>Blocking pin or wire findings</strong>
                    <ul>{proposalStructuralErrors.map((item, index) => <li className="is-error" key={`structural-${index}`}>{item}</li>)}</ul>
                  </div>
                )}
                {proposalTopologyErrors.length > 0 && (
                  <div className="builder-chat__validation-group is-error">
                    <strong>Blocking circuit connection findings</strong>
                    <ul>{proposalTopologyErrors.map((item, index) => <li className="is-error" key={`topology-error-${index}`}>{item}</li>)}</ul>
                  </div>
                )}
                {!proposalStructuralErrors.length && !proposalTopologyErrors.length && (
                  <div className="builder-chat__validation-group">
                    <CheckCircle2 aria-hidden="true" />
                    <strong>Pin and wire structure passed; no tested direct short was detected.</strong>
                  </div>
                )}
                {proposalTopologyWarnings.length > 0 && (
                  <div className="builder-chat__validation-group is-topology">
                    <strong>Circuit connection warnings</strong>
                    <ul>{proposalTopologyWarnings.map((item, index) => <li key={`topology-warning-${index}`}>{item}</li>)}</ul>
                  </div>
                )}
                {proposalLayoutWarnings.length > 0 && (
                  <div className="builder-chat__validation-group">
                    <strong>Drawing and layout warnings</strong>
                    <ul>{proposalLayoutWarnings.map((item, index) => <li key={`layout-warning-${index}`}>{item}</li>)}</ul>
                  </div>
                )}
                {proposalError && <p>{proposalError}</p>}
                <p className="builder-chat__validation-disclaimer">These checks cover pin and wire structure plus a few obvious faults. They do not simulate the circuit or prove electrical correctness or safety.</p>
              </div>
              <div className="builder-chat__quality-review" data-testid="panel-proposal-quality-review">
                <strong>Intent and readability review</strong>
                {proposalQualityReview.kind === 'loading' && (
                  <div className="builder-chat__quality-review-loading">
                    <p role="status">{layoutRepairNotice || 'Studio is checking how well the draft matches your request and whether it is readable…'}</p>
                    <button
                      type="button"
                      className="builder-chat__text-link"
                      onClick={stopProposalQualityReview}
                      data-testid="button-stop-proposal-review"
                    >
                      Stop review
                    </button>
                  </div>
                )}
                {proposalQualityReview.kind === 'cancelled' && (
                  <p role="status">Review stopped. Your proposal is unchanged.</p>
                )}
                {layoutRepairNotice && proposalQualityReview.kind !== 'loading' && (
                  <p className="builder-chat__quality-review-note" role="status">{layoutRepairNotice}</p>
                )}
                {proposalQualityReview.kind === 'skipped' && (
                  <p>{proposalQualityReview.reason === 'external-correction'
                    ? 'AI review was skipped so this external correction stays unchanged. Check that it still matches your request; structural checks are separate.'
                    : 'AI review was skipped because blocking structural findings need attention first.'}</p>
                )}
                {proposalQualityReview.kind === 'unavailable' && (
                  <p>AI review was unavailable. Check request fit and readability yourself; the separate pin and wire checks still apply.</p>
                )}
                {proposalQualityReview.kind === 'ready' && (
                  <>
                    {proposalQualityReview.review.intentConcerns.length > 0 && (
                      <div className="builder-chat__quality-review-group">
                        <strong>Possible request mismatches</strong>
                        <ul>{proposalQualityReview.review.intentConcerns.map((item, index) => <li key={`intent-${index}`}>{item}</li>)}</ul>
                      </div>
                    )}
                    {proposalQualityReview.review.readabilityWarnings.length > 0 && (
                      <div className="builder-chat__quality-review-group is-layout">
                        <strong>Readability warnings</strong>
                        <ul>{proposalQualityReview.review.readabilityWarnings.map((item, index) => <li key={`readability-${index}`}>{item}</li>)}</ul>
                        <button
                          type="button"
                          className="builder-chat__text-link is-muted"
                          onClick={retryProposalLayout}
                          disabled={chatMutation.isPending || requestCycleActive}
                          data-testid="button-improve-proposal-layout"
                        >
                          Try layout improvement again
                        </button>
                      </div>
                    )}
                    {proposalQualityReview.review.unknowns.length > 0 && (
                      <div className="builder-chat__quality-review-group">
                        <strong>Unknowns to confirm</strong>
                        <ul>{proposalQualityReview.review.unknowns.map((item, index) => <li key={`unknown-${index}`}>{item}</li>)}</ul>
                      </div>
                    )}
                    {!proposalQualityReview.review.intentConcerns.length &&
                      !proposalQualityReview.review.readabilityWarnings.length &&
                      !proposalQualityReview.review.unknowns.length && (
                        <p>No specific request-fit or readability concerns were flagged.</p>
                      )}
                    <p className="builder-chat__quality-review-note">AI notes are advisory, not an electrical rules check or safety review.</p>
                  </>
                )}
                {proposalQualityReview.kind === 'idle' && (
                  <p>Review not started.</p>
                )}
              </div>
              <div className="builder-chat__proposal-actions">
                <button type="button" className="builder-chat__text-link is-muted" onClick={discardProposal} data-testid="button-discard-proposal-link">Discard</button>
                <button
                  type="button"
                  className="builder-chat__apply"
                  disabled={!proposalSvg || !!proposalValidation?.errors.length || proposalQualityReview.kind === 'loading'}
                  onClick={applyProposal}
                  data-testid="button-apply-proposal"
                >
                  <Check aria-hidden="true" /> {proposalQualityReview.kind === 'loading'
                    ? 'Reviewing…'
                    : isExternalCircuitFixProposal
                      ? 'Replace workbench with correction'
                      : 'Apply to workbench'}
                </button>
              </div>
              <p className="builder-chat__proposal-note">{isExternalCircuitFixProposal
                ? 'Applying replaces the current workbench drawing with this corrected CircuitSpec. No AI repair runs; after you apply it, CircuitStudio may save a short lesson from the before-and-after changes. '
                : proposalRepairLesson
                  ? 'Applying this repair saves a reusable lesson for similar circuit issues. '
                  : ''}Nothing changes before you choose. Structural and AI checks do not prove circuit behavior, component ratings, or safety.</p>
            </section>
          )}

          {repairLessonNotice && (
            <p
              className="builder-chat__repair-lesson-status"
              role="status"
              aria-live="polite"
              data-kind={repairLessonNotice.kind}
              data-testid="status-repair-lesson"
            >
              {repairLessonNotice.message}
            </p>
          )}
          <CircuitBuilderComposer
            key="circuit-builder-composer"
            ref={composerRef}
            draft={composerDraft}
            onDraftChange={setComposerDraft}
            mode={mode}
            isWorking={chatMutation.isPending || requestCycleActive}
            allowSendWhileWorking={false}
            briefEditing={briefEditing}
            hasProposal={!!proposal}
            hasUnappliedJsonEdits={hasUnappliedJsonEdits}
            activeKeyNumber={usageQuery.data?.activeKeyNumber}
            retryAttempt={retryAttempt}
            retryKind={retryKind}
            isHistoryLoading={!historyHydrated}
            onSubmitMessage={handleSubmitMessage}
            onStopWork={stopBuilderWork}
            isStoppingWork={isStoppingWork}
          />
        </div>

        <aside className="builder-chat__brief" aria-label="Design brief" data-testid="panel-builder-brief">
          <div className="builder-chat__brief-heading">
            <div><p className="builder-chat__eyebrow">Working notes</p><h3>Design brief</h3></div>
            {briefEditing
              ? <button className="builder-chat__text-link" type="button" onClick={() => setBriefEditing(false)} data-testid="button-cancel-edit-brief">Cancel</button>
              : <button className="builder-chat__text-link" type="button" onClick={editBrief} data-testid="button-edit-brief">{hasBrief ? 'Edit' : 'Add notes'}</button>}
          </div>
          <div className="builder-chat__brief-scroll" data-testid="scroll-builder-brief">
            <p className="builder-chat__brief-help">This is the circuit’s running brief: its goal, requirements, assumptions, and unanswered questions. The AI uses it to stay on track; saved edits are preserved while it adds new details.</p>
            {briefEditing ? (
              <div className="builder-chat__brief-editor">
                <label htmlFor="builder-brief-goal">Goal</label>
                <textarea id="builder-brief-goal" value={briefGoalDraft} maxLength={1000} rows={3} onChange={(event) => setBriefGoalDraft(event.target.value)} data-testid="input-builder-brief-goal" placeholder="What should the circuit do?" />
                <label htmlFor="builder-brief-requirements">Requirements <span>one per line</span></label>
                <textarea id="builder-brief-requirements" value={briefRequirementsDraft} maxLength={3600} rows={3} onChange={(event) => setBriefRequirementsDraft(event.target.value)} data-testid="input-builder-brief-requirements" placeholder="Supply, parts, constraints…" />
                <label htmlFor="builder-brief-assumptions">Assumptions <span>one per line</span></label>
                <textarea id="builder-brief-assumptions" value={briefAssumptionsDraft} maxLength={3600} rows={3} onChange={(event) => setBriefAssumptionsDraft(event.target.value)} data-testid="input-builder-brief-assumptions" placeholder="Choices the AI is treating as tentative…" />
                <label htmlFor="builder-brief-open-questions">Open questions <span>one per line</span></label>
                <textarea id="builder-brief-open-questions" value={briefOpenQuestionsDraft} maxLength={3600} rows={3} onChange={(event) => setBriefOpenQuestionsDraft(event.target.value)} data-testid="input-builder-brief-open-questions" placeholder="Details still to decide…" />
                <button className="builder-chat__brief-save" type="button" onClick={saveBrief} data-testid="button-save-brief">Save notes</button>
              </div>
            ) : hasBrief ? (
              <div className="builder-chat__brief-content" data-testid="status-builder-brief">
                {saved.brief.goal && <div className="builder-chat__brief-block"><span>Goal</span><p>{saved.brief.goal}</p></div>}
                {saved.brief.requirements.length > 0 && <BriefList title="Requirements" items={saved.brief.requirements} />}
                {saved.brief.assumptions.length > 0 && <BriefList title="Assumptions" items={saved.brief.assumptions} />}
                {saved.brief.openQuestions.length > 0 && <BriefList title="Open questions" items={saved.brief.openQuestions} />}
              </div>
            ) : (
              <div className="builder-chat__brief-empty" data-testid="status-builder-brief-empty">
                <button type="button" className="builder-chat__text-link" onClick={editBrief} data-testid="button-add-brief">Add a starting note</button>
              </div>
            )}
          </div>
          <div className="builder-chat__brief-footer">
            <p>{!historyHydrated
              ? 'Loading your account history…'
              : historySaveError
                ? 'Only this device is up to date until sync succeeds.'
                : historySyncMutation.isPending
                  ? 'Saving to your account…'
                  : 'Available on any device you sign in to'}</p>
          </div>
        </aside>
      </div>
      <ComponentLibraryDialog
        open={componentLibraryOpen}
        onOpenChange={setComponentLibraryOpen}
        onSelect={prepareComponentPrompt}
      />
      <Dialog
        open={!!historyDeleteTarget}
        onOpenChange={(open) => {
          if (!open && !historyDeleteMutation.isPending) {
            setHistoryDeleteTarget(null);
            setHistoryDeleteError('');
          }
        }}
      >
        <DialogContent className="builder-chat__clear-dialog">
          <DialogHeader>
            <DialogTitle className="builder-chat__clear-title">Delete saved conversation?</DialogTitle>
            <DialogDescription className="builder-chat__clear-description">
              {historySyncMutation.isPending && 'Wait for the account sync to finish. '}
              {historyDeleteTarget?.id === activeSessionId
                ? 'Deletes this chat and its notes. Your schematic stays unchanged.'
                : 'Deletes this chat and its notes. Your current work stays unchanged.'}
            </DialogDescription>
          </DialogHeader>
          {historyDeleteError && <p className="builder-chat__history-error" role="alert" data-testid="status-delete-builder-history-error">{historyDeleteError}</p>}
          <DialogFooter className="builder-chat__clear-footer">
            <button
              type="button"
              className="builder-chat__clear-cancel"
              onClick={() => { setHistoryDeleteTarget(null); setHistoryDeleteError(''); }}
              disabled={historyDeleteMutation.isPending}
              data-testid="button-cancel-delete-builder-history"
            >
              Cancel
            </button>
            <button
              type="button"
              className="builder-chat__clear-confirm"
              onClick={() => void deleteHistorySession()}
              disabled={historyDeleteMutation.isPending || historySyncMutation.isPending || chatMutation.isPending || requestCycleActive}
              data-testid="button-confirm-delete-builder-history"
            >
              {historyDeleteMutation.isPending ? 'Deleting…' : 'Delete conversation'}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {rejectedProposalSpec && (
        <Dialog open={rejectedPreviewOpen} onOpenChange={setRejectedPreviewOpen}>
          <DialogContent
            id="dialog-rejected-proposal-preview"
            className="easyeda-sheet-dialog"
            data-testid="dialog-rejected-proposal-preview"
          >
            <DialogHeader className="easyeda-sheet-header">
              <DialogTitle className="easyeda-sheet-title">{rejectedProposalSpec.title}</DialogTitle>
              <DialogDescription className="easyeda-sheet-description">
                Failed checks. Preview only; not applied.
              </DialogDescription>
            </DialogHeader>
            <div
              className="easyeda-sheet-body builder-chat__rejected-preview-modal-body"
              role="region"
              aria-label="Rejected schematic preview"
              tabIndex={0}
            >
              {rejectedProposalSvg
                ? <div className="builder-chat__svg" dangerouslySetInnerHTML={{ __html: rejectedProposalSvg }} />
                : <p className="builder-chat__rejected-preview-empty">This schematic could not be rendered yet.</p>}
            </div>
            <div className="easyeda-sheet-footer builder-chat__rejected-preview-modal-footer">
              <span>Needs repair · preview only</span>
              <button type="button" className="quiet-button" onClick={() => setRejectedPreviewOpen(false)}>
                Close preview
              </button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <Dialog open={clearChatOpen} onOpenChange={setClearChatOpen}>
        <DialogContent className="builder-chat__clear-dialog">
          <DialogHeader>
            <DialogTitle className="builder-chat__clear-title">Clear this chat?</DialogTitle>
            <DialogDescription className="builder-chat__clear-description">
              Deletes chat messages and notes. Your schematic stays unchanged.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="builder-chat__clear-footer">
            <button type="button" className="builder-chat__clear-cancel" onClick={() => setClearChatOpen(false)} data-testid="button-cancel-clear-builder-chat">
              Cancel
            </button>
            <button type="button" className="builder-chat__clear-confirm" onClick={clearCurrentConversation} data-testid="button-confirm-clear-builder-chat">
              Clear chat
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {appliedProposalFeedback &&
        schematicFeedbackHost &&
        currentSpecSignature === appliedProposalFeedback.specSignature &&
        createPortal(
          <CircuitBuilderFeedback
            circuitTitle={appliedProposalFeedback.circuitTitle}
            requestSummary={appliedProposalFeedback.requestSummary}
            onSave={saveProposalFeedback}
            onRevise={(reason, details) => {
              void reviseProposalFromFeedback(reason, details);
            }}
          />,
          schematicFeedbackHost,
          String(appliedProposalFeedback.id),
        )}
    </section>
  );
}

function BriefList({ title, items }: { title: string; items: string[] }) {
  return (
    <div className="builder-chat__brief-block">
      <span>{title}</span>
      <ul>{items.map((item, index) => <li key={`${title}-${index}`} data-testid={`item-builder-brief-${title.toLowerCase().replace(/\s+/g, '-')}-${index}`}>{item}</li>)}</ul>
    </div>
  );
}

export default CircuitBuilderChat;

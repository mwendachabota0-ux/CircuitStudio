import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatWithCircuitBuilderMutationKey,
  getGetAiUsageQueryKey,
  getListCircuitBuilderHistoryQueryKey,
  getListDeletedCircuitBuilderHistoryQueryKey,
  getListCircuitBuilderMemoriesQueryKey,
  useChatWithCircuitBuilder,
  useGetAiUsage,
  useListCircuitBuilderHistory,
  useListDeletedCircuitBuilderHistory,
  useLearnFromCircuitBuilderHistory,
  useDeleteCircuitBuilderHistory,
  useReviewExternalCircuitFix,
  useSaveCircuitBuilderRepairLesson,
  useSyncCircuitBuilderHistory,
} from '@workspace/api-client-react';
import type {
  CircuitBuilderHistorySession as ApiBuilderHistoryEntry,
  CircuitBuilderHistoryExcerpt,
  CircuitBuilderSuggestedAction,
  CircuitBuildChatInput,
  CircuitBuildChatMessage,
  CircuitBuilderRepairLessonInput,
  CircuitDesignBrief,
  CircuitSpec,
  CircuitSymbolSearchItem,
} from '@workspace/api-client-react';
import type { CircuitComponentLibraryEntry } from '@workspace/circuit-geometry';
import {
  buildFreshRetryRequest,
  buildManualRetryRequest,
  buildOutputRepairRequest,
  buildRepairRequest,
  CircuitBuildAttemptError,
  classifyProposalValidation,
  getProtectedCircuitChanges,
  getProtectedCircuitSignature,
  getModeAfterFailedRequest,
  MAX_AUTO_RETRIES,
  normalizeCircuitBuildRequest,
  restoreProtectedNonWireElements,
  runCircuitBuildAttempts,
  shouldOfferFreshRetry,
  type BuildRetryKind,
  type RepairAttemptDiagnostic,
} from '../lib/circuit-build-retry';
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
  buildExternalCircuitFixPrompt,
  getExternalCircuitFixContextKey,
  inspectExternalCircuitFixCandidate,
  partitionExternalCircuitFixFindings,
  shouldShowExternalCircuitFixPaste,
  type ExternalCircuitFixContext,
} from '../lib/circuit-external-fix';
import { parseCircuitSpecJson } from '../lib/circuit-spec-editor.ts';
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
type SavedState = { brief: CircuitDesignBrief; aiBrief: CircuitDesignBrief; messages: ThreadMessage[] };
type BuilderHistoryEntry = BuilderHistorySession<SavedState, CircuitBuildChatInput['currentSpec']>;
type ValidationReport = { errors: string[]; warnings: string[] };
type RetryFeedback = {
  message: string;
  canRetryManually: boolean;
  validationFindings?: string[];
  validationWarnings?: string[];
};
type RejectedSpecCopyState = 'idle' | 'copied' | 'error';
type ExternalCircuitFixFeedback =
  | { kind: 'local-rejected'; reasons: string[] }
  | { kind: 'review'; approved: boolean; summary: string; concerns: string[] }
  | { kind: 'error'; message: string };
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
  return `Repair stopped after ${repairAttemptCount} attempt${repairAttemptCount === 1 ? '' : 's'}.`;
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
  onJsonRepairRequestHandled,
  onProposalStateChange,
  onApplySpec,
  onTaskComplete,
}: CircuitBuilderChatProps) {
  const storageKey = `circuit-studio-builder-chat-v1:${userId}`;
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
  const historySyncMutation = useSyncCircuitBuilderHistory();
  const historyDeleteMutation = useDeleteCircuitBuilderHistory();
  const chatMutation = useChatWithCircuitBuilder({
    mutation: { mutationKey: getChatWithCircuitBuilderMutationKey() },
  });
  const externalFixReviewMutation = useReviewExternalCircuitFix();
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
  const [proposal, setProposal] = useState<{ summary: string; spec: CircuitBuildChatInput['currentSpec'] } | null>(null);
  const [proposalSvg, setProposalSvg] = useState('');
  const [proposalValidation, setProposalValidation] = useState<ValidationReport | null>(null);
  const [proposalError, setProposalError] = useState('');
  const [proposalRepairLesson, setProposalRepairLesson] =
    useState<ProposalRepairLesson | null>(null);
  const [repairLessonNotice, setRepairLessonNotice] =
    useState<RepairLessonNotice | null>(null);
  const [rejectedProposalSpec, setRejectedProposalSpec] = useState<CircuitBuildChatInput['currentSpec'] | null>(null);
  const [rejectedProposalSvg, setRejectedProposalSvg] = useState('');
  const [rejectedPreviewOpen, setRejectedPreviewOpen] = useState(false);
  const [rejectedSpecCopyState, setRejectedSpecCopyState] = useState<RejectedSpecCopyState>('idle');
  const [externalFixCopiedContextKey, setExternalFixCopiedContextKey] = useState<string | null>(null);
  const [externalFixCopyState, setExternalFixCopyState] = useState<RejectedSpecCopyState>('idle');
  const [externalFixDraft, setExternalFixDraft] = useState('');
  const [externalFixFeedback, setExternalFixFeedback] = useState<ExternalCircuitFixFeedback | null>(null);
  const [componentLibraryOpen, setComponentLibraryOpen] = useState(false);
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefGoalDraft, setBriefGoalDraft] = useState('');
  const [briefRequirementsDraft, setBriefRequirementsDraft] = useState('');
  const [briefAssumptionsDraft, setBriefAssumptionsDraft] = useState('');
  const [briefOpenQuestionsDraft, setBriefOpenQuestionsDraft] = useState('');
  const [lastRequest, setLastRequest] = useState<CircuitBuildChatInput | null>(null);
  const [lastProtectedElementsBaseSpec, setLastProtectedElementsBaseSpec] =
    useState<NonNullable<CircuitBuildChatInput['currentSpec']> | null>(null);
  const [requestCycleActive, setRequestCycleActive] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [retryKind, setRetryKind] = useState<BuildRetryKind | null>(null);
  const [retryFeedback, setRetryFeedback] = useState<RetryFeedback | null>(null);
  const [repairDiagnostics, setRepairDiagnostics] = useState<RepairAttemptDiagnostic[]>([]);
  const composerRef = useRef<CircuitBuilderComposerHandle>(null);
  const externalFixContextKeyRef = useRef('');
  const externalFixCopiedContextKeyRef = useRef<string | null>(null);
  const handledJsonRepairRequestRef = useRef<number | null>(null);
  const observedWorkbenchRepairRef = useRef<{
    sessionId: string;
    spec: CircuitSpec;
    findings: string[];
  } | null>(null);
  const applyingProposalSpecRef = useRef<string | null>(null);
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
  const lastHistorySaveSignatureRef = useRef('');
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
    setRepairLessonNotice({ kind: 'saving', message: 'Saving what went wrong, how it was fixed, and how to avoid it next time…' });
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
                ? 'Saved a repair lesson. I’ll use it when a similar circuit issue comes up.'
                : 'This repair lesson is already saved.',
            }
          : {
              kind: 'none',
              message: 'Circuit applied. This correction did not produce a reusable lesson.',
            },
      );
    } catch (error) {
      setRepairLessonNotice({
        kind: 'error',
        message: `Circuit applied, but its repair lesson could not be saved${error instanceof Error ? `: ${error.message}` : '.'}`,
      });
    }
  }, [queryClient, repairLessonMutation.mutateAsync]);

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
          saved: { brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] },
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
      now: Date.now(),
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
    if (lastHistorySaveSignatureRef.current === signature) return;
    lastHistorySaveSignatureRef.current = signature;

    void syncHistorySessions([activeSession])
      .then(() => setHistorySaveError(''))
      .catch(() => {
        lastHistorySaveSignatureRef.current = '';
        setHistorySaveError('Could not sync conversation history to your account. This device still has its local copy.');
      });
  }, [
    activeSession,
    currentSpec,
    historyHydrated,
    historyQuery.isSuccess,
    syncHistorySessions,
  ]);

  const visibleMessages = saved.messages;
  const aiUnavailable = usageQuery.data ? !usageQuery.data.canUseAi : false;

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
      history: saved.messages.slice(-8).map(({ role, content }) => ({
        role,
        content: content.slice(0, 3000),
      })),
    };
  }, [rejectedProposalSpec, retryFeedback, lastRequest, saved.brief, saved.messages]);
  const externalFixContextKey = externalFixContext
    ? getExternalCircuitFixContextKey(externalFixContext)
    : '';
  const showExternalFixPaste = shouldShowExternalCircuitFixPaste(
    externalFixCopiedContextKey,
    externalFixContextKey,
  );
  externalFixContextKeyRef.current = externalFixContextKey;
  externalFixCopiedContextKeyRef.current = externalFixCopiedContextKey;

  useEffect(() => {
    setExternalFixCopiedContextKey(null);
    setExternalFixCopyState('idle');
    setExternalFixDraft('');
    setExternalFixFeedback(null);
  }, [externalFixContextKey]);

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
      setExternalFixFeedback(null);
      externalFixReviewMutation.reset();
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
      proposal ||
      requestCycleActive ||
      externalFixReviewMutation.isPending
    ) return;

    const submittedContextKey = externalFixContextKey;
    setExternalFixFeedback(null);
    const parsed = parseCircuitSpecJson(externalFixDraft);
    if (!parsed.ok) {
      setExternalFixFeedback({ kind: 'local-rejected', reasons: [parsed.error] });
      return;
    }
    if (!window.CircuitDraw) {
      setExternalFixFeedback({
        kind: 'local-rejected',
        reasons: ['The schematic validator is not ready. Reload the page and try again.'],
      });
      return;
    }

    let validation: ValidationReport;
    let svg: string;
    try {
      validation = window.CircuitDraw.validate(parsed.spec);
      const localCheck = inspectExternalCircuitFixCandidate(
        externalFixContext.rejectedSpec,
        parsed.spec,
        validation,
      );
      if (!localCheck.accepted) {
        setExternalFixFeedback({ kind: 'local-rejected', reasons: localCheck.reasons });
        return;
      }
      svg = window.CircuitDraw.render(parsed.spec);
      if (!svg) throw new Error('The schematic renderer did not produce a preview.');
    } catch (error) {
      setExternalFixFeedback({
        kind: 'local-rejected',
        reasons: [error instanceof Error ? error.message : 'The pasted CircuitSpec could not be checked.'],
      });
      return;
    }

    if (
      externalFixContextKeyRef.current !== submittedContextKey ||
      externalFixCopiedContextKeyRef.current !== submittedContextKey
    ) {
      setExternalFixFeedback({
        kind: 'error',
        message: 'The rejected proposal changed. Copy its prompt again before submitting a fix.',
      });
      return;
    }

    try {
      const result = await externalFixReviewMutation.mutateAsync({
        data: {
          rejectedSpec: externalFixContext.rejectedSpec,
          candidateSpec: parsed.spec,
          reportedProblems: externalFixContext.reportedProblems.slice(0, 30).map((item) => item.slice(0, 1000)),
          advisoryWarnings: externalFixContext.advisoryWarnings.slice(0, 30).map((item) => item.slice(0, 1000)),
          originalRequest: externalFixContext.originalRequest.slice(0, 6000),
          designBrief: externalFixContext.designBrief,
          history: externalFixContext.history,
        },
      });
      void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
      if (
        externalFixContextKeyRef.current !== submittedContextKey ||
        externalFixCopiedContextKeyRef.current !== submittedContextKey
      ) return;

      setExternalFixFeedback({
        kind: 'review',
        approved: result.approved,
        summary: result.summary,
        concerns: result.concerns,
      });
      if (!result.approved) return;

      setProposal({
        summary: `External fix reviewed by Studio AI: ${result.summary}`.slice(0, 500),
        spec: parsed.spec,
      });
      setProposalSvg(svg);
      setProposalValidation(validation);
      setProposalError('Studio AI review is not an electrical simulation or safety check.');
    } catch (error) {
      if (
        externalFixContextKeyRef.current !== submittedContextKey ||
        externalFixCopiedContextKeyRef.current !== submittedContextKey
      ) return;
      setExternalFixFeedback({
        kind: 'error',
        message: error instanceof Error
          ? error.message
          : 'Studio AI could not review this fix. Your pasted text is still here; try again shortly.',
      });
    }
  };

  const runRequest = async (
    request: CircuitBuildChatInput,
    draftRevisionAtStart: number,
    protectedElementsBaseSpec?: NonNullable<CircuitBuildChatInput['currentSpec']>,
    preserveRejectedProposal = false,
    rememberForRetry = true,
    repairLessonSeed?: RepairLessonEvidence,
  ) => {
    const safeRequest = normalizeCircuitBuildRequest(request);
    if (rememberForRetry) setLastRequest(safeRequest);
    setLastProtectedElementsBaseSpec(protectedElementsBaseSpec ?? null);
    setRetryFeedback(null);
    setRepairDiagnostics([]);
    setProposalRepairLesson(null);
    setRepairLessonNotice(null);
    if (!preserveRejectedProposal) {
      setRejectedProposalSpec(null);
      setRejectedProposalSvg('');
    }
    setRejectedSpecCopyState('idle');
    setRetryAttempt(0);
    setRetryKind(null);
    setRequestCycleActive(true);
    chatMutation.reset();
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
        send: (workingRequest) => chatMutation.mutateAsync({ data: workingRequest }),
        getProposal: (result) => result.proposal?.spec ?? null,
        inspectProposal,
        prepareResponse: (result) => {
          if (!result.proposal?.spec || !window.CircuitDraw) return result;
          const autoFixed = window.CircuitDraw.autoFix(result.proposal.spec);
          return autoFixed.changes.length
            ? { ...result, proposal: { ...result.proposal, spec: autoFixed.spec } }
            : result;
        },
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
        },
      });
        const nextMode = response.nextMode ?? completedRequest.mode;
        const nextBrief = response.brief ?? latestBrief;
        latestBrief = nextBrief;

        setMode(nextMode);
        setSaved((current) => ({
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
        setRejectedProposalSpec(null);
        setRejectedProposalSvg('');
        setRepairDiagnostics(completedRepairDiagnostics);
        if (nextMode === 'build' && response.proposal && proposalInspection) {
          setProposal(response.proposal);
          setProposalError('');
          setProposalValidation(proposalInspection.validation);
          setProposalSvg(proposalInspection.svg);
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
      setSaved((current) => ({
        ...current,
        brief: mergeBriefPreservingManualEdits(current.aiBrief, current.brief, latestBrief),
        aiBrief: latestBrief,
      }));
      setMode((currentMode) => getModeAfterFailedRequest(currentMode, safeRequest.mode));
      if (error instanceof CircuitBuildAttemptError) {
        const rejectedSpec = asCircuitSpec(error.rejectedProposal) ??
          (preserveRejectedProposal ? rejectedProposalSpec : null);
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
    } finally {
      composerRef.current?.clearDraftIfUnchanged(draftRevisionAtStart, safeRequest.message);
      setRequestCycleActive(false);
      setRetryAttempt(0);
      setRetryKind(null);
    }
  };

  const handleSubmitMessage = async (content: string, draftRevisionAtStart: number) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || chatMutation.isPending || requestCycleActive || briefEditing || hasUnappliedJsonEdits) return;
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

  const startFreshRetry = async () => {
    if (!lastRequest || chatMutation.isPending || requestCycleActive) return;
    const findings = retryFeedback?.validationFindings ?? [];
    const rejectedSpec = asCircuitSpec(rejectedProposalSpec);
    const repairLessonSeed = rejectedSpec && findings.length
      ? {
          beforeSpec: rejectedSpec,
          findings,
          context: `A fresh retry was started after ${MAX_AUTO_RETRIES} automatic repairs did not clear the blocking errors.`,
        }
      : undefined;

    await runRequest(
      buildFreshRetryRequest(lastRequest, saved.brief),
      composerRef.current?.getDraftRevision() ?? 0,
      undefined,
      false,
      true,
      repairLessonSeed,
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
    setLastRequest(null);
    setLastProtectedElementsBaseSpec(null);
    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
    setProposalError('');
    setRejectedProposalSpec(null);
    setRejectedProposalSvg('');
    setRejectedSpecCopyState('idle');
    setExternalFixCopiedContextKey(null);
    setExternalFixCopyState('idle');
    setExternalFixDraft('');
    setExternalFixFeedback(null);
    externalFixReviewMutation.reset();
    setRetryFeedback(null);
    setRepairDiagnostics([]);
    setRetryAttempt(0);
    setRetryKind(null);
    setBriefEditing(false);
    composerRef.current?.setDraft('');
  };

  const clearCurrentConversation = () => {
    if (chatMutation.isPending || requestCycleActive) return;
    setSaved({ brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] });
    setMode('chat');
    clearTransientConversationState();
    setHistoryOpen(false);
    setClearChatOpen(false);
  };

  const startNewConversation = () => {
    if (chatMutation.isPending || requestCycleActive) return;
    const now = Date.now();
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
      saved: { brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] },
      currentSpec,
      mode: 'chat',
      now,
    });
    setSessions((current) => upsertBuilderHistorySession(
      upsertBuilderHistorySession(current, currentSession),
      nextSession,
    ));
    setActiveSessionId(nextSession.id);
    setSaved(nextSession.saved);
    setMode('chat');
    clearTransientConversationState();
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
    const now = Date.now();
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
    setActiveSessionId(session.id);
    setSaved(session.saved);
    setMode(session.mode);
    onApplySpec(session.currentSpec, 'history');
    clearTransientConversationState();
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
          saved: { brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] },
          currentSpec,
          mode: 'chat',
        });
        nextSessions.unshift(nextSession);
        pendingRestoreRef.current = null;
        setActiveSessionId(nextSession.id);
        setSaved(nextSession.saved);
        setMode('chat');
        clearTransientConversationState();
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
      const description = entry.description || entry.keywords;
      composerRef.current?.setDraft(
        `Use this exact KiCad symbol ID: ${entry.id}. Add ${entry.name} to my current schematic using its real library pin names and positions.${description ? ` Symbol details: ${description}.` : ''}`,
      );
      return;
    }
    composerRef.current?.setDraft(
      entry.category === 'Drawing'
        ? `Add a ${entry.displayName} (${entry.type}) drawing annotation to my current schematic. Do not treat it as an electrical component.`
        : `Use a ${entry.displayName} (${entry.type}) in my current design. Use its supported pin model and ask me for any missing ratings or verified pinout before assuming them.`,
    );
  };

  const prepareSuggestedAction = (
    action: CircuitBuilderSuggestedAction,
    isReplyToQuestion: boolean,
  ) => {
    if (!isReplyToQuestion && isExplicitBuildRequest(action.prompt)) setMode('build');
    composerRef.current?.setDraft(action.prompt);
  };

  const applyProposal = () => {
    if (!proposal || !proposalSvg || !proposalValidation || proposalValidation.errors.length) return;
    onApplySpec(proposal.spec);
    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
    setRetryFeedback(null);
    setRejectedProposalSpec(null);
    setRejectedProposalSvg('');
    setExternalFixCopiedContextKey(null);
    setExternalFixCopyState('idle');
    setExternalFixDraft('');
    setExternalFixFeedback(null);
  };

  const errorMessage = retryFeedback?.message ?? (
    chatMutation.error instanceof Error
      ? chatMutation.error.message
      : 'The request did not go through. Your message is still here.'
  );
  const canStartFreshRetry = shouldOfferFreshRetry(
    repairDiagnostics,
    retryFeedback?.validationFindings ?? [],
  );
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
              <strong>Recent conversations</strong>
              <span>
                Saved to your account, including chats in progress
                {sessions.length > 4 ? ' · scroll for older' : ''}
              </span>
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
      {canRepairCurrentDraft && validationFindings.length > 0 && (
        <div className="builder-chat__repair-notice" data-testid="panel-repair-current-draft">
          <div>
            <strong>{validationFindings.length} structural issue{validationFindings.length === 1 ? '' : 's'} found</strong>
            <p>Ask Studio to repair the wiring. It will check the proposal; your drawing stays unchanged until you apply it.</p>
          </div>
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
                    ? `Repairing proposal · retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                    : `Automatic retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                  : mode === 'build' ? 'Working through a draft' : 'Thinking it through'}</small>
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
                  {canStartFreshRetry && (
                    <button
                      type="button"
                      className="builder-chat__fresh-retry"
                      onClick={() => void startFreshRetry()}
                      disabled={!lastRequest || hasUnappliedJsonEdits}
                      data-testid="button-start-fresh-retry"
                    >
                      Start fresh
                    </button>
                  )}
                </div>
              </div>
              {canStartFreshRetry && (
                <p className="builder-chat__fresh-retry-note" role="note">
                  Three automatic repairs still left blocking errors. Start again from your original request, or continue repairing this proposal. Your workbench drawing stays unchanged.
                </p>
              )}
              {!!retryFeedback.validationFindings?.length && (
                <section className="builder-chat__validation-findings" aria-label="Blocking validation errors" data-testid="list-builder-validation-findings">
                  <strong>{retryFeedback.validationFindings.length} blocking validation error{retryFeedback.validationFindings.length === 1 ? '' : 's'}</strong>
                  <ol>{retryFeedback.validationFindings.map((finding, index) => <li key={`failure-${index}`}>{finding}</li>)}</ol>
                </section>
              )}
              {!!retryFeedback.validationWarnings?.length && (
                <section className="builder-chat__validation-findings is-warning" aria-label="Advisory validation warnings" data-testid="list-builder-validation-warnings">
                  <strong>{retryFeedback.validationWarnings.length} advisory warning{retryFeedback.validationWarnings.length === 1 ? '' : 's'} (not blocking)</strong>
                  <ol>{retryFeedback.validationWarnings.map((warning, index) => <li key={`warning-${index}`}>{warning}</li>)}</ol>
                </section>
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
                      disabled={!externalFixContext || externalFixReviewMutation.isPending}
                      data-testid="button-copy-rejected-spec-ai-prompt"
                    >
                      {externalFixCopyState === 'copied' ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                      {externalFixCopyState === 'copied' ? 'Prompt copied' : 'Copy CircuitSpec + AI prompt'}
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
                  <h3>Paste the external fix here</h3>
                  <p>Paste the AI’s complete plain-JSON CircuitSpec. Studio checks its structure and asks Studio AI to review it before staging.</p>
                  <label htmlFor="external-circuit-fix-json">Corrected CircuitSpec JSON</label>
                  <textarea
                    id="external-circuit-fix-json"
                    value={externalFixDraft}
                    onChange={(event) => setExternalFixDraft(event.target.value)}
                    disabled={externalFixReviewMutation.isPending}
                    spellCheck={false}
                    rows={8}
                    data-testid="input-external-circuit-fix"
                  />
                  <button
                    type="button"
                    className="builder-chat__external-fix-submit"
                    onClick={submitExternalCircuitFix}
                    disabled={!externalFixDraft.trim() || externalFixReviewMutation.isPending || !!proposal}
                    data-testid="button-submit-external-circuit-fix"
                  >
                    {externalFixReviewMutation.isPending ? 'Reviewing fix…' : 'Submit fix for review'}
                  </button>
                  {externalFixFeedback?.kind === 'local-rejected' && (
                    <div className="builder-chat__external-fix-feedback is-error" role="alert" data-testid="status-external-circuit-fix-local-error">
                      <strong>This fix needs changes before Studio AI review.</strong>
                      <ul>{externalFixFeedback.reasons.map((reason, index) => <li key={`external-local-${index}`}>{reason}</li>)}</ul>
                    </div>
                  )}
                  {externalFixFeedback?.kind === 'error' && (
                    <p className="builder-chat__external-fix-feedback is-error" role="alert" data-testid="status-external-circuit-fix-error">
                      {externalFixFeedback.message}
                    </p>
                  )}
                  {externalFixFeedback?.kind === 'review' && (
                    <div
                      className={`builder-chat__external-fix-feedback ${externalFixFeedback.approved ? 'is-approved' : 'is-error'}`}
                      role={externalFixFeedback.approved ? 'status' : 'alert'}
                      data-testid="status-external-circuit-fix-review"
                    >
                      <strong>{externalFixFeedback.approved ? 'Studio AI approved this fix for staging.' : 'Studio AI did not approve this fix.'}</strong>
                      <p>{externalFixFeedback.summary}</p>
                      {!!externalFixFeedback.concerns.length && (
                        <ul>{externalFixFeedback.concerns.map((concern, index) => <li key={`external-concern-${index}`}>{concern}</li>)}</ul>
                      )}
                      {externalFixFeedback.approved && <p>The staged proposal is shown below. It has not been applied to your workbench.</p>}
                    </div>
                  )}
                  <p className="builder-chat__external-fix-note">Structural checks and AI review are not electrical simulation or safety verification. Your current workbench draft stays unchanged until you choose Apply.</p>
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
                <button type="button" className="builder-chat__icon-link" aria-label="Discard proposal" onClick={() => { setProposal(null); setProposalSvg(''); setProposalValidation(null); }} data-testid="button-discard-proposal">
                  <X aria-hidden="true" />
                </button>
              </div>
              <div className="builder-chat__preview" data-testid="preview-builder-proposal">
                {proposalSvg
                  ? <div className="builder-chat__svg" dangerouslySetInnerHTML={{ __html: proposalSvg }} />
                  : <div className="builder-chat__preview-empty" data-testid="status-builder-preview-error">Preview unavailable until the proposal is valid.</div>}
              </div>
              <div className={`builder-chat__validation${proposalValidation?.errors.length ? ' has-errors' : proposalValidation?.warnings.length ? ' has-warnings' : ' is-valid'}`} data-testid="status-builder-validation">
                {proposalValidation?.errors.length
                  ? <strong>{proposalValidation.errors.length} issue{proposalValidation.errors.length === 1 ? '' : 's'} need attention</strong>
                  : proposalValidation?.warnings.length
                    ? <strong>Preview checked · {proposalValidation.warnings.length} warning{proposalValidation.warnings.length === 1 ? '' : 's'}</strong>
                    : <><CheckCircle2 aria-hidden="true" /><strong>Preview checked · no structural issues</strong></>}
                {!!proposalValidation?.errors.length && <ul>{proposalValidation.errors.map((item, index) => <li className="is-error" key={`e-${index}`}>{item}</li>)}</ul>}
                {!!proposalValidation?.warnings.length && <ul>{proposalValidation.warnings.map((item, index) => <li key={`w-${index}`}>{item}</li>)}</ul>}
                {proposalError && <p>{proposalError}</p>}
              </div>
              <div className="builder-chat__proposal-actions">
                <button type="button" className="builder-chat__text-link is-muted" onClick={() => { setProposal(null); setProposalSvg(''); setProposalValidation(null); }} data-testid="button-discard-proposal-link">Discard</button>
                <button type="button" className="builder-chat__apply" disabled={!proposalSvg || !!proposalValidation?.errors.length} onClick={applyProposal} data-testid="button-apply-proposal">
                  <Check aria-hidden="true" /> Apply to workbench
                </button>
              </div>
              <p className="builder-chat__proposal-note">Applying sends this spec to your workbench. Nothing changes before you choose.</p>
            </section>
          )}

          <CircuitBuilderComposer
            key="circuit-builder-composer"
            ref={composerRef}
            mode={mode}
            isWorking={chatMutation.isPending || requestCycleActive || externalFixReviewMutation.isPending}
            briefEditing={briefEditing}
            hasProposal={!!proposal}
            hasUnappliedJsonEdits={hasUnappliedJsonEdits}
            activeKeyNumber={usageQuery.data?.activeKeyNumber}
            retryAttempt={retryAttempt}
            retryKind={retryKind}
            isHistoryLoading={!historyHydrated}
            onSubmitMessage={handleSubmitMessage}
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
                <Plus aria-hidden="true" />
                <p>The AI uses these notes to keep important details in view. Add your own, or let the conversation fill them in.</p>
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
                ? 'This removes this conversation and its saved notes from your account and this device. A fresh chat will start with your current schematic, which will stay unchanged.'
                : 'This removes this conversation and its saved notes from your account and this device. Your current conversation and schematic will stay unchanged.'}
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
                This draft did not pass structural checks. Preview only; it has not been applied to your workbench.
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
              This removes its saved messages and design notes from History. Your current schematic will stay unchanged.
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

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatWithCircuitBuilderMutationKey,
  getGetAiUsageQueryKey,
  useChatWithCircuitBuilder,
  useGetAiUsage,
} from '@workspace/api-client-react';
import type {
  CircuitBuilderSuggestedAction,
  CircuitBuildChatInput,
  CircuitBuildChatMessage,
  CircuitDesignBrief,
} from '@workspace/api-client-react';
import {
  buildOutputRepairRequest,
  buildRepairRequest,
  CircuitBuildAttemptError,
  getProtectedCircuitChanges,
  getProtectedCircuitSignature,
  getModeAfterFailedRequest,
  MAX_AUTO_RETRIES,
  restoreProtectedNonWireElements,
  runCircuitBuildAttempts,
  type BuildRetryKind,
  type RepairAttemptDiagnostic,
} from '../lib/circuit-build-retry';
import { getLocalBuilderModeIntent } from '../lib/circuit-build-intent';
import {
  Check,
  CheckCircle2,
  Copy,
  Library,
  MessageCircle,
  Plus,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import './circuit-builder-chat.css';
import { ComponentLibraryDialog } from './component-library-dialog';
import CircuitBuilderComposer, {
  type CircuitBuilderComposerHandle,
} from './circuit-builder-composer';

type ChatMode = 'chat' | 'build';
type ThreadMessage = CircuitBuildChatMessage & {
  id: string;
  createdAt: number;
  suggestedActions?: CircuitBuilderSuggestedAction[];
};
type SavedState = { brief: CircuitDesignBrief; aiBrief: CircuitDesignBrief; messages: ThreadMessage[] };
type ValidationReport = { errors: string[]; warnings: string[] };
type RetryFeedback = {
  message: string;
  canRetryManually: boolean;
  validationFindings?: string[];
  validationWarnings?: string[];
};
type RejectedSpecCopyState = 'idle' | 'copied' | 'error';

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
    const validation = window.CircuitDraw.validate(spec);
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

function formatValidationFailure(errors: string[], repairAttemptCount: number): string {
  return `The proposal still has ${errors.length} blocking validation error${errors.length === 1 ? '' : 's'} after ${repairAttemptCount} repair attempt${repairAttemptCount === 1 ? '' : 's'}. The full list and rejected draft are shown below.`;
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

function readSavedState(key: string): SavedState {
  const fallback = { brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
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
  } catch {
    return fallback;
  }
}

function newMessage(
  role: CircuitBuildChatMessage['role'],
  content: string,
  suggestedActions?: CircuitBuilderSuggestedAction[],
): ThreadMessage {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    role,
    content,
    createdAt: Date.now(),
    ...(suggestedActions?.length ? { suggestedActions: suggestedActions.slice(0, 2) } : {}),
  };
}

function isSuggestedAction(value: unknown): value is CircuitBuilderSuggestedAction {
  if (!value || typeof value !== 'object') return false;
  const action = value as Record<string, unknown>;
  return typeof action.label === 'string' && typeof action.prompt === 'string';
}

export type CircuitBuilderChatProps = {
  userId: string;
  currentSpec: CircuitBuildChatInput['currentSpec'];
  validationFindings: string[];
  canRepairCurrentDraft: boolean;
  onApplySpec: (spec: CircuitBuildChatInput['currentSpec']) => void;
  onTaskComplete: (mode: 'chat' | 'build') => void;
};

export function CircuitBuilderChat({
  userId,
  currentSpec,
  validationFindings,
  canRepairCurrentDraft,
  onApplySpec,
  onTaskComplete,
}: CircuitBuilderChatProps) {
  const storageKey = `circuit-studio-builder-chat-v1:${userId}`;
  const queryClient = useQueryClient();
  const chatMutation = useChatWithCircuitBuilder({
    mutation: { mutationKey: getChatWithCircuitBuilderMutationKey() },
  });
  const usageQuery = useGetAiUsage({
    query: { queryKey: getGetAiUsageQueryKey(), retry: 1 },
  });
  const [saved, setSaved] = useState<SavedState>(() => readSavedState(storageKey));
  const [mode, setMode] = useState<ChatMode>('chat');
  const [proposal, setProposal] = useState<{ summary: string; spec: CircuitBuildChatInput['currentSpec'] } | null>(null);
  const [proposalSvg, setProposalSvg] = useState('');
  const [proposalValidation, setProposalValidation] = useState<ValidationReport | null>(null);
  const [proposalError, setProposalError] = useState('');
  const [rejectedProposalSpec, setRejectedProposalSpec] = useState<CircuitBuildChatInput['currentSpec'] | null>(null);
  const [rejectedSpecCopyState, setRejectedSpecCopyState] = useState<RejectedSpecCopyState>('idle');
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

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Storage can be unavailable in private browsing; the session remains usable.
    }
  }, [saved, storageKey]);

  const visibleMessages = saved.messages;
  const aiUnavailable = usageQuery.data ? !usageQuery.data.canUseAi : false;

  const localProposalState = useMemo(() => {
    if (!proposal) return null;
    return proposalValidation;
  }, [proposal, proposalValidation]);

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

  const runRequest = async (
    request: CircuitBuildChatInput,
    draftRevisionAtStart: number,
    protectedElementsBaseSpec?: NonNullable<CircuitBuildChatInput['currentSpec']>,
  ) => {
    setLastRequest(request);
    setLastProtectedElementsBaseSpec(protectedElementsBaseSpec ?? null);
    setRetryFeedback(null);
    setRepairDiagnostics([]);
    setRejectedProposalSpec(null);
    setRejectedSpecCopyState('idle');
    setRetryAttempt(0);
    setRetryKind(null);
    setRequestCycleActive(true);
    chatMutation.reset();
    let latestBrief = request.brief ?? emptyBrief();
    try {
      const {
        response,
        proposalInspection,
        request: completedRequest,
        repairDiagnostics: completedRepairDiagnostics,
      } = await runCircuitBuildAttempts({
        initialRequest: request,
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
          request,
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
            newMessage('assistant', response.answer, response.suggestedActions),
          ].slice(-60),
        }));
        setRejectedProposalSpec(null);
        setRepairDiagnostics(completedRepairDiagnostics);
        if (nextMode === 'build' && response.proposal && proposalInspection) {
          setProposal(response.proposal);
          setProposalError('');
          setProposalValidation(proposalInspection.validation);
          setProposalSvg(proposalInspection.svg);
        }
        void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
        onTaskComplete(nextMode);
    } catch (error) {
      setMode((currentMode) => getModeAfterFailedRequest(currentMode, request.mode));
      if (error instanceof CircuitBuildAttemptError) {
        setRejectedProposalSpec(asCircuitSpec(error.rejectedProposal));
        setRepairDiagnostics(error.repairDiagnostics);
        const causeMessage = error.cause instanceof Error
          ? error.cause.message
          : 'The request did not go through. Your message is still here.';
        let message: string;
        if (error.failureKind === 'validation') {
          message = error.validationFindings.length
            ? formatValidationFailure(error.validationFindings, error.repairAttemptCount)
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
        setRetryFeedback({
          message,
          canRetryManually: error.canRetryManually,
          ...(error.failureKind === 'validation'
            ? {
                validationFindings: error.validationFindings,
                validationWarnings: error.validationWarnings,
              }
            : {}),
        });
      } else {
        setRepairDiagnostics([]);
        setRetryFeedback({
          message: error instanceof Error ? error.message : 'The request did not go through. Your message is still here.',
          canRetryManually: false,
        });
      }
    } finally {
      composerRef.current?.clearDraftIfUnchanged(draftRevisionAtStart, request.message);
      setRequestCycleActive(false);
      setRetryAttempt(0);
      setRetryKind(null);
    }
  };

  const handleSubmitMessage = async (content: string, draftRevisionAtStart: number) => {
    const normalizedContent = content.trim();
    if (!normalizedContent || chatMutation.isPending || requestCycleActive || briefEditing) return;
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

    const requestMode: ChatMode = intent === 'build' ? 'build' : mode;
    // Reflect an explicit build request immediately and keep that mode if
    // generation or validation fails, so repair/retry stays in build mode.
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
    await runRequest(
      lastRequest,
      composerRef.current?.getDraftRevision() ?? 0,
      lastProtectedElementsBaseSpec ?? undefined,
    );
  };

  const repairCurrentDraft = () => {
    if (
      !canRepairCurrentDraft ||
      !validationFindings.length ||
      !currentSpec ||
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

  const clearConversation = () => {
    setSaved({ brief: emptyBrief(), aiBrief: emptyBrief(), messages: [initialMessage] });
    setLastRequest(null);
  };

  const prepareComponentPrompt = (entry: { type: string; displayName: string; category: string }) => {
    setMode('build');
    composerRef.current?.setDraft(
      entry.category === 'Drawing'
        ? `Add a ${entry.displayName} (${entry.type}) drawing annotation to my current schematic. Do not treat it as an electrical component.`
        : `Use a ${entry.displayName} (${entry.type}) in my current design. Use its supported pin model and ask me for any missing ratings or verified pinout before assuming them.`,
    );
  };

  const prepareSuggestedAction = (action: CircuitBuilderSuggestedAction) => {
    setMode('build');
    composerRef.current?.setDraft(action.prompt);
  };

  const applyProposal = () => {
    if (!proposal || !proposalSvg || !proposalValidation || proposalValidation.errors.length) return;
    onApplySpec(proposal.spec);
    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
  };

  const errorMessage = retryFeedback?.message ?? (
    chatMutation.error instanceof Error
      ? chatMutation.error.message
      : 'The request did not go through. Your message is still here.'
  );
  const hasBrief = Boolean(saved.brief.goal || saved.brief.requirements.length || saved.brief.assumptions.length || saved.brief.openQuestions.length);

  return (
    <section className="builder-chat" aria-label="Conversational circuit builder" data-testid="panel-circuit-builder-chat">
      <header className="builder-chat__header">
        <div className="builder-chat__identity">
          <div>
            <h2>Build through conversation</h2>
          </div>
        </div>
        <div className="builder-chat__header-tools">
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
          <button className="builder-chat__icon-link" type="button" onClick={clearConversation} aria-label="Clear conversation and brief" title="Clear conversation" data-testid="button-clear-builder-chat">
            <Trash2 aria-hidden="true" />
          </button>
        </div>
      </header>

      <div className="builder-chat__mode-row">
        <div className="builder-chat__mode-tabs" role="tablist" aria-label="Conversation mode" data-testid="group-builder-modes">
          <button type="button" role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'is-active' : ''} onClick={() => setMode('chat')} data-testid="button-builder-mode-chat">
            <MessageCircle aria-hidden="true" /> Chat
          </button>
          <button type="button" role="tab" aria-selected={mode === 'build'} className={mode === 'build' ? 'is-active' : ''} onClick={() => setMode('build')} data-testid="button-builder-mode-build">
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
            {visibleMessages.map((message, index) => (
              <article className={`builder-chat__message is-${message.role}`} key={message.id} data-testid={`message-builder-${message.role}-${index}`}>
                <span className="builder-chat__message-label">{message.role === 'assistant' ? 'Studio' : 'You'}</span>
                <p>{message.content}</p>
                {message.role === 'assistant' && Array.isArray(message.suggestedActions) && message.suggestedActions.some(isSuggestedAction) && (
                  <div className="builder-chat__suggested-actions" data-testid={`list-builder-suggested-actions-${index}`}>
                    <span>Suggested next steps · review before sending</span>
                    <div>
                      {message.suggestedActions.filter(isSuggestedAction).slice(0, 2).map((action, actionIndex) => (
                        <button
                          key={`${message.id}-action-${actionIndex}`}
                          type="button"
                          onClick={() => prepareSuggestedAction(action)}
                          data-testid={`button-builder-suggested-action-${index}-${actionIndex}`}
                        >
                          {action.label}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </article>
            ))}
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
                {retryFeedback.canRetryManually && (
                  <button type="button" className="builder-chat__text-link" onClick={retryRequest} disabled={!lastRequest} data-testid="button-retry-builder-chat">Retry</button>
                )}
              </div>
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
                  </div>
                  <pre>{JSON.stringify(rejectedProposalSpec, null, 2)}</pre>
                </details>
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
            isWorking={chatMutation.isPending || requestCycleActive}
            briefEditing={briefEditing}
            hasProposal={!!proposal}
            retryAttempt={retryAttempt}
            retryKind={retryKind}
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
          <div className="builder-chat__brief-footer">
            <p>Saved in this browser for your account</p>
          </div>
        </aside>
      </div>
      <ComponentLibraryDialog
        open={componentLibraryOpen}
        onOpenChange={setComponentLibraryOpen}
        onSelect={prepareComponentPrompt}
      />
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

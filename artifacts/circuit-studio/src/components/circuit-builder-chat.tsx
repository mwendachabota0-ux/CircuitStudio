import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getChatWithCircuitBuilderMutationKey,
  getGetAiUsageQueryKey,
  useChatWithCircuitBuilder,
  useGetAiUsage,
} from '@workspace/api-client-react';
import type {
  CircuitBuildChatInput,
  CircuitBuildChatMessage,
  CircuitDesignBrief,
} from '@workspace/api-client-react';
import {
  Check,
  CheckCircle2,
  LoaderCircle,
  MessageCircle,
  Plus,
  Send,
  Sparkles,
  Trash2,
  Wrench,
  X,
} from 'lucide-react';
import './circuit-builder-chat.css';

type ChatMode = 'chat' | 'build';
type ThreadMessage = CircuitBuildChatMessage & { id: string; createdAt: number };
type SavedState = { brief: CircuitDesignBrief; aiBrief: CircuitDesignBrief; messages: ThreadMessage[] };
type ValidationReport = { errors: string[]; warnings: string[] };
type RetryFeedback = { message: string; canRetryManually: boolean };

const MAX_AUTO_RETRIES = 2;

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

function getErrorHeader(error: unknown, name: string): string | null {
  if (!error || typeof error !== 'object' || !('headers' in error)) return null;
  const headers = (error as { headers?: unknown }).headers;
  if (!headers || typeof headers !== 'object') return null;
  const get = (headers as { get?: unknown }).get;
  return typeof get === 'function'
    ? (get as (headerName: string) => string | null).call(headers, name)
    : null;
}

function getRetryAfterMs(error: unknown): number | undefined {
  const value = getErrorHeader(error, 'retry-after');
  if (!value) return undefined;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
  const retryAt = Date.parse(value);
  return Number.isFinite(retryAt) ? Math.max(0, retryAt - Date.now()) : undefined;
}

function getBuildRetryPolicy(error: unknown): { retryable: boolean; delayMs?: number } {
  const explicitRetryability = getErrorHeader(error, 'x-circuit-ai-retryable');
  const delayMs = getRetryAfterMs(error);
  if (explicitRetryability === 'false') return { retryable: false };
  if (explicitRetryability === 'true') return { retryable: true, delayMs };

  if (error && typeof error === 'object' && 'status' in error) {
    const status = Number((error as { status?: unknown }).status);
    if (status === 429) return { retryable: false };
    if (status === 408 || status === 425 || (status >= 500 && status <= 599 && status !== 501 && status !== 505)) {
      return { retryable: true, delayMs };
    }
  }

  if (error instanceof TypeError) return { retryable: true };
  if (error instanceof Error && /failed to fetch|network|connection reset|connection lost|socket hang up|timed? ?out|econnreset|etimedout/i.test(error.message)) {
    return { retryable: true };
  }
  return { retryable: false };
}

function waitBeforeRetry(attempt: number, providerDelayMs?: number): Promise<void> {
  const delayMs = providerDelayMs ?? Math.min(4_000, 600 * (2 ** (attempt - 1)));
  return new Promise((resolve) => window.setTimeout(resolve, delayMs));
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

function buildRepairMessage(errors: string[]): string {
  const preamble = 'Repair the previous proposal for the original circuit request. Fix every structural validator finding and return a complete corrected CircuitSpec. Validator findings:';
  const footer = 'Preserve the requested behavior and avoid unrelated changes.';
  const findings: string[] = [];
  let length = preamble.length + footer.length + 2;
  for (const error of errors) {
    const line = `- ${error.slice(0, 180)}`;
    if (length + line.length + 1 > 2_850) {
      findings.push(`- ${errors.length - findings.length} additional validation finding(s) were omitted; repair all remaining structural issues.`);
      break;
    }
    findings.push(line);
    length += line.length + 1;
  }
  return `${preamble}\n${findings.join('\n')}\n${footer}`.slice(0, 3_000);
}

function formatValidationFailure(errors: string[]): string {
  const firstIssues = errors.slice(0, 3).join(' ');
  const remainder = errors.length > 3 ? ` And ${errors.length - 3} more.` : '';
  return `The proposal still has ${errors.length} structural issue${errors.length === 1 ? '' : 's'} after ${MAX_AUTO_RETRIES} automatic repair retries. ${firstIssues}${remainder}`;
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
        ).slice(-60)
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

function localModeIntent(text: string): ChatMode | null {
  const normalized = text.toLowerCase().replace(/[.!?]/g, '').trim();
  if (/^(please )?(turn|switch|change|go)( me )?( to )?(the )?build( mode)?$/.test(normalized)
    || normalized === 'build mode' || normalized === 'switch to build') return 'build';
  if (/^(please )?(turn|switch|change|go)( me )?( to )?(the )?chat( mode)?$/.test(normalized)
    || normalized === 'chat mode' || normalized === 'switch to chat') return 'chat';
  return null;
}

function newMessage(role: CircuitBuildChatMessage['role'], content: string): ThreadMessage {
  return { id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`, role, content, createdAt: Date.now() };
}

export type CircuitBuilderChatProps = {
  userId: string;
  currentSpec: CircuitBuildChatInput['currentSpec'];
  onApplySpec: (spec: CircuitBuildChatInput['currentSpec']) => void;
  onTaskComplete: (mode: 'chat' | 'build') => void;
};

export function CircuitBuilderChat({
  userId,
  currentSpec,
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
  const [draft, setDraft] = useState('');
  const [proposal, setProposal] = useState<{ summary: string; spec: CircuitBuildChatInput['currentSpec'] } | null>(null);
  const [proposalSvg, setProposalSvg] = useState('');
  const [proposalValidation, setProposalValidation] = useState<ValidationReport | null>(null);
  const [proposalError, setProposalError] = useState('');
  const [briefEditing, setBriefEditing] = useState(false);
  const [briefGoalDraft, setBriefGoalDraft] = useState('');
  const [briefRequirementsDraft, setBriefRequirementsDraft] = useState('');
  const [briefAssumptionsDraft, setBriefAssumptionsDraft] = useState('');
  const [briefOpenQuestionsDraft, setBriefOpenQuestionsDraft] = useState('');
  const [lastRequest, setLastRequest] = useState<CircuitBuildChatInput | null>(null);
  const [requestCycleActive, setRequestCycleActive] = useState(false);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const [retryFeedback, setRetryFeedback] = useState<RetryFeedback | null>(null);
  const draftRevisionRef = useRef(0);
  const threadEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(saved));
    } catch {
      // Storage can be unavailable in private browsing; the session remains usable.
    }
  }, [saved, storageKey]);

  useEffect(() => {
    threadEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }, [saved.messages, chatMutation.isPending, requestCycleActive, retryAttempt]);

  const visibleMessages = saved.messages;
  const aiUnavailable = usageQuery.data ? !usageQuery.data.canUseAi : false;
  const canSend = draft.trim().length > 0 && !chatMutation.isPending && !requestCycleActive && !proposal && !briefEditing;

  const localProposalState = useMemo(() => {
    if (!proposal) return null;
    return proposalValidation;
  }, [proposal, proposalValidation]);

  const addMessage = (message: ThreadMessage) => {
    setSaved((current) => ({ ...current, messages: [...current.messages, message].slice(-60) }));
  };

  const runRequest = async (request: CircuitBuildChatInput) => {
    const draftRevisionAtStart = draftRevisionRef.current;
    setLastRequest(request);
    setRetryFeedback(null);
    setRetryAttempt(0);
    setRequestCycleActive(true);
    chatMutation.reset();
    let retryCount = 0;
    let workingRequest = request;
    let latestBrief = request.brief ?? emptyBrief();
    try {
      while (true) {
        let response: Awaited<ReturnType<typeof chatMutation.mutateAsync>>;
        try {
          response = await chatMutation.mutateAsync({ data: workingRequest });
        } catch (error) {
          const retryPolicy = getBuildRetryPolicy(error);
          if (retryPolicy.retryable && retryCount < MAX_AUTO_RETRIES) {
            retryCount += 1;
            setRetryAttempt(retryCount);
            await waitBeforeRetry(retryCount, retryPolicy.delayMs);
            continue;
          }
          const failureMessage = error instanceof Error
            ? error.message
            : 'The request did not go through. Your message is still here.';
          setRetryFeedback({
            message: retryPolicy.retryable
              ? `The request failed after ${MAX_AUTO_RETRIES} automatic retries. ${failureMessage}`
              : failureMessage,
            canRetryManually: retryPolicy.retryable,
          });
          return;
        }

        const nextMode = response.nextMode ?? workingRequest.mode;
        const nextBrief = response.brief ?? latestBrief;
        latestBrief = nextBrief;
        let inspectedProposal: ReturnType<typeof inspectProposal> | null = null;

        if (nextMode === 'build' && response.proposal) {
          inspectedProposal = inspectProposal(response.proposal.spec);
          if (inspectedProposal.validation.errors.length) {
            if (!inspectedProposal.canRepair) {
              setRetryFeedback({
                message: inspectedProposal.validation.errors[0] ?? 'The proposal could not be checked.',
                canRetryManually: false,
              });
              return;
            }
            if (retryCount >= MAX_AUTO_RETRIES) {
              setRetryFeedback({
                message: formatValidationFailure(inspectedProposal.validation.errors),
                canRetryManually: true,
              });
              return;
            }
            retryCount += 1;
            setRetryAttempt(retryCount);
            await waitBeforeRetry(retryCount);
            workingRequest = {
              ...request,
              mode: 'build',
              brief: nextBrief,
              message: buildRepairMessage(inspectedProposal.validation.errors),
            };
            continue;
          }
        }

        setMode(nextMode);
        setSaved((current) => ({
          brief: mergeBriefPreservingManualEdits(current.aiBrief, current.brief, nextBrief),
          aiBrief: nextBrief,
          messages: [...current.messages, newMessage('assistant', response.answer)].slice(-60),
        }));
        setDraft((current) =>
          draftRevisionRef.current === draftRevisionAtStart &&
          current.trim() === request.message
            ? ''
            : current,
        );
        if (nextMode === 'build' && response.proposal && inspectedProposal) {
          setProposal(response.proposal);
          setProposalError('');
          setProposalValidation(inspectedProposal.validation);
          setProposalSvg(inspectedProposal.svg);
        }
        void queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
        onTaskComplete(nextMode);
        return;
      }
    } finally {
      setRequestCycleActive(false);
      setRetryAttempt(0);
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || chatMutation.isPending || requestCycleActive || briefEditing) return;
    const intent = localModeIntent(content);
    if (proposal && intent !== 'chat') return;
    if (intent === 'chat') {
      const userMessage = newMessage('user', content);
      const assistantMessage = newMessage('assistant', 'Chat mode is on. We can clarify the idea without changing the schematic.');
      setDraft((current) => current.trim() === content ? '' : current);
      setMode('chat');
      setSaved((current) => ({
        ...current,
        messages: [...current.messages, userMessage, assistantMessage].slice(-60),
      }));
      return;
    }

    const requestMode: ChatMode = intent === 'build' ? 'build' : mode;
    const userMessage = newMessage('user', content);
    setSaved((current) => ({
      ...current,
      messages: [...current.messages, userMessage].slice(-60),
    }));
    const history = [...saved.messages, { role: 'user' as const, content }]
      .slice(-8)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    await runRequest({
      message: content,
      mode: requestMode,
      currentSpec,
      history,
      brief: saved.brief,
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && canSend) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const retryRequest = async () => {
    if (!lastRequest || chatMutation.isPending || requestCycleActive) return;
    await runRequest(lastRequest);
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

      <div className="builder-chat__body">
        <div className="builder-chat__conversation">
          <div className="builder-chat__thread" role="log" aria-live="polite" aria-label="Conversation" data-testid="list-builder-messages">
            {visibleMessages.map((message, index) => (
              <article className={`builder-chat__message is-${message.role}`} key={message.id} data-testid={`message-builder-${message.role}-${index}`}>
                <span className="builder-chat__message-label">{message.role === 'assistant' ? 'Studio' : 'You'}</span>
                <p>{message.content}</p>
              </article>
            ))}
            {(chatMutation.isPending || requestCycleActive) && (
              <div className="builder-chat__thinking" role="status" data-testid="status-builder-loading">
                <span className="builder-chat__thinking-mark"><Sparkles aria-hidden="true" /></span>
                <span><i /><i /><i /></span>
                <small>{retryAttempt > 0
                  ? `Automatic retry ${retryAttempt} of ${MAX_AUTO_RETRIES}`
                  : mode === 'build' ? 'Working through a draft' : 'Thinking it through'}</small>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>
          {retryFeedback && !requestCycleActive && (
            <div className="builder-chat__error" role="alert" data-testid="status-builder-error">
              <span>{errorMessage}</span>
              {retryFeedback.canRetryManually && (
                <button type="button" className="builder-chat__text-link" onClick={retryRequest} disabled={!lastRequest} data-testid="button-retry-builder-chat">Retry</button>
              )}
            </div>
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

          <form className="builder-chat__composer" onSubmit={handleSubmit} data-testid="form-builder-message">
            <label className="builder-chat__sr-only" htmlFor="builder-chat-input">Message the circuit builder</label>
            <textarea
              id="builder-chat-input"
              ref={textareaRef}
              value={draft}
              onChange={(event) => {
                draftRevisionRef.current += 1;
                setDraft(event.target.value.slice(0, 3000));
              }}
              onKeyDown={handleComposerKeyDown}
              placeholder={mode === 'chat' ? 'Describe what you are trying to make…' : 'What should we add or change?'}
              rows={2}
              maxLength={3000}
              data-testid="input-builder-message"
            />
            <div className="builder-chat__composer-foot">
              <span>{requestCycleActive ? 'You can draft a follow-up while the AI works' : briefEditing ? 'Save or cancel your notes before sending' : proposal ? 'Apply or discard the staged proposal before sending another request' : mode === 'chat' ? 'Enter to send · Shift + Enter for a new line' : 'A proposal is staged for your review, never applied automatically'}</span>
              <button type="submit" disabled={!canSend} aria-label="Send message" data-testid="button-send-builder-message">
                {(chatMutation.isPending || requestCycleActive) ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Send aria-hidden="true" />}
                <span>{requestCycleActive ? (retryAttempt > 0 ? 'Retrying' : 'Thinking') : 'Send'}</span>
              </button>
            </div>
          </form>
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
            <span className="builder-chat__brief-led" />
            <p>Saved in this browser for your account</p>
          </div>
        </aside>
      </div>
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

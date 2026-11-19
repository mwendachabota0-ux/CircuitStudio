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
  AlertCircle,
  Check,
  CheckCircle2,
  CircleHelp,
  CircuitBoard,
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
type SavedState = { brief: CircuitDesignBrief; messages: ThreadMessage[] };
type ValidationReport = { errors: string[]; warnings: string[] };

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

function readSavedState(key: string): SavedState {
  const fallback = { brief: emptyBrief(), messages: [initialMessage] };
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw) as Partial<SavedState>;
    const brief = parsed.brief;
    const messages = Array.isArray(parsed.messages)
      ? parsed.messages.filter((message): message is ThreadMessage =>
          !!message &&
          (message.role === 'user' || message.role === 'assistant') &&
          typeof message.content === 'string' &&
          typeof message.id === 'string' &&
          typeof message.createdAt === 'number',
        ).slice(-60)
      : [];
    return {
      brief: {
        goal: typeof brief?.goal === 'string' ? brief.goal : '',
        requirements: isStringList(brief?.requirements) ? brief.requirements.slice(0, 12) : [],
        assumptions: isStringList(brief?.assumptions) ? brief.assumptions.slice(0, 12) : [],
        openQuestions: isStringList(brief?.openQuestions) ? brief.openQuestions.slice(0, 12) : [],
      },
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
  const [lastRequest, setLastRequest] = useState<CircuitBuildChatInput | null>(null);
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
  }, [saved.messages, chatMutation.isPending]);

  const visibleMessages = saved.messages;
  const remaining = usageQuery.data?.tokensRemaining;
  const allowanceBlocked = usageQuery.data ? !usageQuery.data.canUseAi || remaining === 0 : false;
  const canSend = draft.trim().length > 0 && !chatMutation.isPending && !allowanceBlocked;

  const localProposalState = useMemo(() => {
    if (!proposal) return null;
    return proposalValidation;
  }, [proposal, proposalValidation]);

  const addMessage = (message: ThreadMessage) => {
    setSaved((current) => ({ ...current, messages: [...current.messages, message].slice(-60) }));
  };

  const runRequest = async (request: CircuitBuildChatInput) => {
    setLastRequest(request);
    try {
      const response = await chatMutation.mutateAsync({ data: request });
      const nextBrief = response.brief ?? emptyBrief();
      setSaved((current) => ({
        brief: nextBrief,
        messages: [...current.messages, newMessage('assistant', response.answer)].slice(-60),
      }));
      if (request.mode === 'build' && response.proposal) {
        setProposal(response.proposal);
        setProposalError('');
        if (!window.CircuitDraw) {
          setProposalSvg('');
          setProposalValidation({ errors: ['The schematic preview library is not ready.'], warnings: [] });
        } else {
          try {
            const validation = window.CircuitDraw.validate(response.proposal.spec);
            setProposalValidation(validation);
            setProposalSvg(validation.errors.length ? '' : window.CircuitDraw.render(response.proposal.spec));
          } catch (error) {
            setProposalValidation({
              errors: [error instanceof Error ? error.message : 'This proposal could not be rendered.'],
              warnings: [],
            });
            setProposalSvg('');
          }
        }
      }
      await queryClient.invalidateQueries({ queryKey: getGetAiUsageQueryKey() });
      onTaskComplete(request.mode);
    } catch {
      // The mutation's error state is rendered below; keep the user's message and retry context.
    }
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const content = draft.trim();
    if (!content || chatMutation.isPending || allowanceBlocked) return;
    setDraft('');
    const intent = localModeIntent(content);
    addMessage(newMessage('user', content));
    if (intent) {
      setMode(intent);
      setProposal(null);
      setProposalSvg('');
      setProposalValidation(null);
      setSaved((current) => ({
        ...current,
        messages: [...current.messages, newMessage('assistant', intent === 'build'
          ? 'Build mode is on. I will prepare a draft for review; your working schematic stays unchanged until you apply it.'
          : 'Chat mode is on. We can clarify the idea without changing the schematic.')].slice(-60),
      }));
      return;
    }

    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
    const history = [...saved.messages, { role: 'user' as const, content }]
      .slice(-8)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }));
    await runRequest({
      message: content,
      mode,
      currentSpec,
      history,
      brief: saved.brief,
    });
  };

  const handleComposerKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const retryRequest = async () => {
    if (!lastRequest || chatMutation.isPending || allowanceBlocked) return;
    await runRequest(lastRequest);
  };

  const editBrief = () => {
    setBriefGoalDraft(saved.brief.goal);
    setBriefRequirementsDraft(saved.brief.requirements.join('\n'));
    setBriefEditing(true);
  };

  const saveBrief = () => {
    const requirements = briefRequirementsDraft.split('\n').map((line) => line.trim()).filter(Boolean).slice(0, 12);
    setSaved((current) => ({
      ...current,
      brief: { ...current.brief, goal: briefGoalDraft.trim().slice(0, 1000), requirements },
    }));
    setBriefEditing(false);
  };

  const clearConversation = () => {
    setSaved({ brief: emptyBrief(), messages: [initialMessage] });
    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
    setLastRequest(null);
  };

  const applyProposal = () => {
    if (!proposal || !proposalSvg || !proposalValidation || proposalValidation.errors.length) return;
    onApplySpec(proposal.spec);
    setProposal(null);
    setProposalSvg('');
    setProposalValidation(null);
  };

  const errorMessage = chatMutation.error instanceof Error
    ? chatMutation.error.message
    : 'The request did not go through. Your message is still here.';
  const hasBrief = Boolean(saved.brief.goal || saved.brief.requirements.length || saved.brief.assumptions.length || saved.brief.openQuestions.length);

  return (
    <section className="builder-chat" aria-label="Conversational circuit builder" data-testid="panel-circuit-builder-chat">
      <header className="builder-chat__header">
        <div className="builder-chat__identity">
          <span className="builder-chat__mark"><CircuitBoard aria-hidden="true" /></span>
          <div>
            <p className="builder-chat__eyebrow">Circuit Studio / collaborator</p>
            <h2>Build through conversation</h2>
          </div>
        </div>
        <div className="builder-chat__header-tools">
          <span className="builder-chat__usage" data-testid="status-builder-allowance">
            {usageQuery.isPending
              ? <><span className="builder-chat__skeleton" aria-hidden="true" /> Checking allowance</>
              : usageQuery.isError
                ? <button className="builder-chat__text-link" type="button" onClick={() => usageQuery.refetch()} data-testid="button-retry-usage">Usage unavailable · retry</button>
                : <><span className={`builder-chat__availability${allowanceBlocked ? ' is-blocked' : ''}`} />{allowanceBlocked ? 'AI allowance unavailable' : `${remaining?.toLocaleString() ?? '—'} tokens available`}</>}
          </span>
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
        <p data-testid="status-builder-mode">{mode === 'chat' ? 'Clarify the idea, no edits proposed' : 'Shape an editable draft for review'}</p>
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
            {chatMutation.isPending && (
              <div className="builder-chat__thinking" role="status" data-testid="status-builder-loading">
                <span className="builder-chat__thinking-mark"><Sparkles aria-hidden="true" /></span>
                <span><i /><i /><i /></span>
                <small>{mode === 'build' ? 'Working through a draft' : 'Thinking it through'}</small>
              </div>
            )}
            <div ref={threadEndRef} />
          </div>
          {chatMutation.isError && (
            <div className="builder-chat__error" role="alert" data-testid="status-builder-error">
              <AlertCircle aria-hidden="true" />
              <span>{errorMessage}</span>
              <button type="button" className="builder-chat__text-link" onClick={retryRequest} disabled={!lastRequest || allowanceBlocked} data-testid="button-retry-builder-chat">Retry</button>
            </div>
          )}
          {allowanceBlocked && (
            <div className="builder-chat__allowance" role="status" data-testid="status-builder-quota">
              <CircleHelp aria-hidden="true" />
              <span><strong>AI allowance is unavailable.</strong> You can keep your brief and conversation here, but sending is paused.</span>
            </div>
          )}
          {usageQuery.isError && (
            <div className="builder-chat__usage-error" role="status" data-testid="status-builder-usage-error">
              Allowance could not be checked. <button className="builder-chat__text-link" type="button" onClick={() => usageQuery.refetch()} data-testid="button-retry-usage-inline">Try again</button>
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
                  : <div className="builder-chat__preview-empty" data-testid="status-builder-preview-error"><AlertCircle aria-hidden="true" />Preview unavailable until the proposal is valid.</div>}
              </div>
              <div className={`builder-chat__validation${proposalValidation?.errors.length ? ' has-errors' : proposalValidation?.warnings.length ? ' has-warnings' : ' is-valid'}`} data-testid="status-builder-validation">
                {proposalValidation?.errors.length
                  ? <><AlertCircle aria-hidden="true" /><strong>{proposalValidation.errors.length} issue{proposalValidation.errors.length === 1 ? '' : 's'} need attention</strong></>
                  : proposalValidation?.warnings.length
                    ? <><AlertCircle aria-hidden="true" /><strong>Preview checked · {proposalValidation.warnings.length} warning{proposalValidation.warnings.length === 1 ? '' : 's'}</strong></>
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
              onChange={(event) => setDraft(event.target.value.slice(0, 3000))}
              onKeyDown={handleComposerKeyDown}
              placeholder={mode === 'chat' ? 'Describe what you are trying to make…' : 'What should we add or change?'}
              rows={2}
              maxLength={3000}
              disabled={chatMutation.isPending}
              data-testid="input-builder-message"
            />
            <div className="builder-chat__composer-foot">
              <span>{mode === 'chat' ? 'Enter to send · Shift + Enter for a new line' : 'A proposal is staged for your review, never applied automatically'}</span>
              <button type="submit" disabled={!canSend} aria-label="Send message" data-testid="button-send-builder-message">
                {chatMutation.isPending ? <LoaderCircle className="is-spinning" aria-hidden="true" /> : <Send aria-hidden="true" />}
                <span>{chatMutation.isPending ? 'Thinking' : 'Send'}</span>
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
          {briefEditing ? (
            <div className="builder-chat__brief-editor">
              <label htmlFor="builder-brief-goal">Goal</label>
              <textarea id="builder-brief-goal" value={briefGoalDraft} maxLength={1000} rows={3} onChange={(event) => setBriefGoalDraft(event.target.value)} data-testid="input-builder-brief-goal" placeholder="What should the circuit do?" />
              <label htmlFor="builder-brief-requirements">Requirements <span>one per line</span></label>
              <textarea id="builder-brief-requirements" value={briefRequirementsDraft} rows={4} onChange={(event) => setBriefRequirementsDraft(event.target.value)} data-testid="input-builder-brief-requirements" placeholder="Supply, parts, constraints…" />
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
              <p>A short brief keeps the important constraints close as the conversation evolves.</p>
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

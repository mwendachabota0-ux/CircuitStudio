import {
  forwardRef,
  useImperativeHandle,
  useRef,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { LoaderCircle, Send, Square } from 'lucide-react';
import type { BuildRetryKind } from '../lib/circuit-build-retry';
import { shouldClearSubmittedDraft } from '../lib/circuit-build-retry';

type ChatMode = 'chat' | 'build';

export type CircuitBuilderComposerHandle = {
  getDraftRevision: () => number;
  setDraft: (value: string) => void;
  clearDraftIfUnchanged: (revisionAtStart: number, submittedText: string) => void;
};

type CircuitBuilderComposerProps = {
  draft: string;
  onDraftChange: (value: string) => void;
  mode: ChatMode;
  isWorking: boolean;
  allowSendWhileWorking?: boolean;
  briefEditing: boolean;
  hasProposal: boolean;
  hasUnappliedJsonEdits: boolean;
  activeKeyNumber?: number;
  retryAttempt: number;
  retryKind: BuildRetryKind | null;
  isHistoryLoading: boolean;
  onSubmitMessage: (content: string, draftRevisionAtStart: number) => void | Promise<void>;
  onStopWork: () => void;
  isStoppingWork: boolean;
};

const CircuitBuilderComposer = forwardRef<
  CircuitBuilderComposerHandle,
  CircuitBuilderComposerProps
>(function CircuitBuilderComposer({
  draft,
  onDraftChange,
  mode,
  isWorking,
  allowSendWhileWorking = false,
  briefEditing,
  hasProposal,
  hasUnappliedJsonEdits,
  activeKeyNumber,
  retryAttempt,
  retryKind,
  isHistoryLoading,
  onSubmitMessage,
  onStopWork,
  isStoppingWork,
}, ref) {
  const draftRevisionRef = useRef(0);
  const canSend = draft.trim().length > 0 &&
    (!isWorking || allowSendWhileWorking) &&
    !isHistoryLoading &&
    !hasProposal &&
    !briefEditing &&
    !hasUnappliedJsonEdits;

  useImperativeHandle(ref, () => ({
    getDraftRevision: () => draftRevisionRef.current,
    setDraft: (value) => {
      draftRevisionRef.current += 1;
      onDraftChange(value);
    },
    clearDraftIfUnchanged: (revisionAtStart, submittedText) => {
      if (shouldClearSubmittedDraft(
          revisionAtStart,
          draftRevisionRef.current,
          draft,
          submittedText,
        )) onDraftChange('');
    },
  }), [draft, onDraftChange]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    event.stopPropagation();
    const content = draft.trim();
    if (!content || !canSend) return;
    await onSubmitMessage(content, draftRevisionRef.current);
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    event.stopPropagation();
    if (event.key === 'Enter' && !event.shiftKey && canSend) {
      event.preventDefault();
      event.currentTarget.form?.requestSubmit();
    }
  };

  const composerHint = isHistoryLoading
    ? 'Loading history…'
    : isWorking
    ? allowSendWhileWorking
      ? 'Chat while the repair runs'
      : 'Draft a follow-up while Studio works'
    : briefEditing
      ? 'Save or cancel notes first'
      : hasProposal
        ? 'Review or discard the proposal first'
        : hasUnappliedJsonEdits
          ? 'Apply your JSON edit first'
        : mode === 'chat'
          ? 'Enter to send · Shift+Enter for newline'
          : 'Review the proposal; it won’t apply itself.';

  const sendLabel = isHistoryLoading
    ? 'Loading'
    : isWorking
    ? allowSendWhileWorking
      ? 'Send chat'
      : retryAttempt > 0
      ? retryKind === 'repair' ? 'Repairing' : 'Retrying'
      : 'Thinking'
    : 'Send';

  return (
    <form className="builder-chat__composer" onSubmit={handleSubmit} data-testid="form-builder-message">
      <label className="builder-chat__sr-only" htmlFor="builder-chat-input">Message the circuit builder</label>
      <textarea
        id="builder-chat-input"
        value={draft}
        maxLength={10000}
        onChange={(event) => {
          draftRevisionRef.current += 1;
          onDraftChange(event.target.value);
        }}
        onKeyDown={handleKeyDown}
        placeholder={mode === 'chat' ? 'Describe what you are trying to make…' : 'What should we add or change?'}
        rows={2}
        autoComplete="off"
        data-testid="input-builder-message"
      />
      <div className="builder-chat__composer-foot">
        <span>{composerHint}</span>
        <div className="builder-chat__composer-controls">
          {activeKeyNumber !== undefined && (
            <span
              className="builder-chat__active-key"
              aria-label={`Current AI key number ${activeKeyNumber}`}
              title="Currently selected AI key number"
              data-testid="badge-active-ai-key"
            >
              Key #{activeKeyNumber}
            </span>
          )}
          {isWorking && (
            <button
              type="button"
              className="builder-chat__stop-button"
              onClick={onStopWork}
              disabled={isStoppingWork}
              aria-label="Stop AI work"
              title="Stops chat or drawing work without stopping the separate review."
              data-testid="button-stop-builder-work"
            >
              <Square aria-hidden="true" />
              <span>{isStoppingWork ? 'Stopping…' : 'Stop'}</span>
            </button>
          )}
          <button type="submit" disabled={!canSend} aria-label="Send message" data-testid="button-send-builder-message">
            {isWorking && !allowSendWhileWorking
              ? <LoaderCircle className="is-spinning" aria-hidden="true" />
              : <Send aria-hidden="true" />}
            <span>{sendLabel}</span>
          </button>
        </div>
      </div>
    </form>
  );
});

CircuitBuilderComposer.displayName = 'CircuitBuilderComposer';

export default CircuitBuilderComposer;

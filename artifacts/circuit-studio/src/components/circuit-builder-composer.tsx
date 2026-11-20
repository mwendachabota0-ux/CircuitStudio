import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
  type FormEvent,
  type KeyboardEvent,
} from 'react';
import { LoaderCircle, Send } from 'lucide-react';
import type { BuildRetryKind } from '../lib/circuit-build-retry';
import { shouldClearSubmittedDraft } from '../lib/circuit-build-retry';

type ChatMode = 'chat' | 'build';

export type CircuitBuilderComposerHandle = {
  getDraftRevision: () => number;
  setDraft: (value: string) => void;
  clearDraftIfUnchanged: (revisionAtStart: number, submittedText: string) => void;
};

type CircuitBuilderComposerProps = {
  mode: ChatMode;
  isWorking: boolean;
  briefEditing: boolean;
  hasProposal: boolean;
  hasUnappliedJsonEdits: boolean;
  activeKeyNumber?: number;
  retryAttempt: number;
  retryKind: BuildRetryKind | null;
  onSubmitMessage: (content: string, draftRevisionAtStart: number) => void | Promise<void>;
};

const CircuitBuilderComposer = forwardRef<
  CircuitBuilderComposerHandle,
  CircuitBuilderComposerProps
>(function CircuitBuilderComposer({
  mode,
  isWorking,
  briefEditing,
  hasProposal,
  hasUnappliedJsonEdits,
  activeKeyNumber,
  retryAttempt,
  retryKind,
  onSubmitMessage,
}, ref) {
  const [draft, setDraft] = useState('');
  const draftRevisionRef = useRef(0);
  const canSend = draft.trim().length > 0 && !isWorking && !hasProposal && !briefEditing && !hasUnappliedJsonEdits;

  useImperativeHandle(ref, () => ({
    getDraftRevision: () => draftRevisionRef.current,
    setDraft: (value) => {
      draftRevisionRef.current += 1;
      setDraft(value.slice(0, 3000));
    },
    clearDraftIfUnchanged: (revisionAtStart, submittedText) => {
      setDraft((current) =>
        shouldClearSubmittedDraft(
          revisionAtStart,
          draftRevisionRef.current,
          current,
          submittedText,
        )
          ? ''
          : current,
      );
    },
  }), []);

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

  const composerHint = isWorking
    ? 'You can draft a follow-up while the AI works'
    : briefEditing
      ? 'Save or cancel your notes before sending'
      : hasProposal
        ? 'Apply or discard the staged proposal before sending another request'
        : hasUnappliedJsonEdits
          ? 'Apply your JSON edit before sending it to Studio AI'
        : mode === 'chat'
          ? 'Enter to send · Shift + Enter for a new line'
          : 'A proposal is staged for your review, never applied automatically';

  const sendLabel = isWorking
    ? retryAttempt > 0
      ? retryKind === 'repair' ? 'Repairing' : 'Retrying'
      : 'Thinking'
    : 'Send';

  return (
    <form className="builder-chat__composer" onSubmit={handleSubmit} data-testid="form-builder-message">
      <label className="builder-chat__sr-only" htmlFor="builder-chat-input">Message the circuit builder</label>
      <textarea
        id="builder-chat-input"
        value={draft}
        onChange={(event) => {
          draftRevisionRef.current += 1;
          setDraft(event.target.value.slice(0, 3000));
        }}
        onKeyDown={handleKeyDown}
        placeholder={mode === 'chat' ? 'Describe what you are trying to make…' : 'What should we add or change?'}
        rows={2}
        maxLength={3000}
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
          <button type="submit" disabled={!canSend} aria-label="Send message" data-testid="button-send-builder-message">
            {isWorking
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

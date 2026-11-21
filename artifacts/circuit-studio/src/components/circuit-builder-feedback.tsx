import { useState, type FormEvent } from 'react';
import { LoaderCircle, ThumbsDown, ThumbsUp } from 'lucide-react';
import type { CircuitBuilderFeedbackInput } from '@workspace/api-client-react';

type NegativeReason = Exclude<CircuitBuilderFeedbackInput['reason'], 'overall'>;
type ProposalFeedbackProps = {
  circuitTitle: string;
  requestSummary: string;
  onSave: (input: CircuitBuilderFeedbackInput) => Promise<void>;
  onRevise: (reason: NegativeReason, details: string) => void;
};

const negativeReasons: Array<{ value: NegativeReason; label: string }> = [
  { value: 'incorrect-wiring', label: 'Incorrect wiring' },
  { value: 'wrong-parts-or-values', label: 'Wrong parts or values' },
  { value: 'poor-readability', label: 'Hard to read' },
  { value: 'missed-request', label: 'Missed the request' },
  { value: 'other', label: 'Other' },
];

export function CircuitBuilderFeedback({
  circuitTitle,
  requestSummary,
  onSave,
  onRevise,
}: ProposalFeedbackProps) {
  const [downvoteOpen, setDownvoteOpen] = useState(false);
  const [reason, setReason] = useState<NegativeReason | ''>('');
  const [details, setDetails] = useState('');
  const [savedVote, setSavedVote] = useState<'up' | 'down' | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const saveFeedback = async (
    vote: 'up' | 'down',
    selectedReason: CircuitBuilderFeedbackInput['reason'],
    note: string,
  ) => {
    setSaving(true);
    setError('');
    try {
      await onSave({
        vote,
        reason: selectedReason,
        circuitTitle: circuitTitle.trim().slice(0, 120) || 'Proposed circuit',
        ...(requestSummary.trim()
          ? { requestSummary: requestSummary.trim().slice(0, 600) }
          : {}),
        ...(note.trim() ? { details: note.trim().slice(0, 500) } : {}),
      });
      setSavedVote(vote);
      setDownvoteOpen(false);
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : 'Feedback could not be saved. Try again.',
      );
    } finally {
      setSaving(false);
    }
  };

  const handleDownvoteSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!reason || saving) return;
    void saveFeedback('down', reason, details);
  };

  return (
    <section className="builder-chat__rating" aria-label="Rate this circuit proposal">
      <div className="builder-chat__rating-heading">
        <strong>Was this proposal useful?</strong>
        <span>Feedback can guide similar requests on your account.</span>
      </div>
      <div className="builder-chat__rating-votes">
        <button
          type="button"
          className={savedVote === 'up' ? 'is-selected' : ''}
          aria-label="I like this proposal"
          aria-pressed={savedVote === 'up'}
          disabled={saving || savedVote !== null}
          onClick={() => void saveFeedback('up', 'overall', '')}
          data-testid="button-proposal-like"
        >
          {saving && savedVote === null
            ? <LoaderCircle className="is-spinning" aria-hidden="true" />
            : <ThumbsUp aria-hidden="true" />}
          <span>Like</span>
        </button>
        <button
          type="button"
          className={savedVote === 'down' ? 'is-selected' : ''}
          aria-label="I dislike this proposal"
          aria-pressed={savedVote === 'down'}
          disabled={saving || savedVote !== null}
          onClick={() => {
            setDownvoteOpen((open) => !open);
            setError('');
          }}
          data-testid="button-proposal-dislike"
        >
          <ThumbsDown aria-hidden="true" />
          <span>Dislike</span>
        </button>
      </div>

      {downvoteOpen && savedVote === null && (
        <form className="builder-chat__rating-form" onSubmit={handleDownvoteSubmit}>
          <fieldset>
            <legend>What should Studio change?</legend>
            {negativeReasons.map((option) => (
              <label key={option.value}>
                <input
                  type="radio"
                  name="proposal-feedback-reason"
                  value={option.value}
                  checked={reason === option.value}
                  onChange={() => setReason(option.value)}
                />
                <span>{option.label}</span>
              </label>
            ))}
          </fieldset>
          <label className="builder-chat__rating-note">
            <span>More detail (optional)</span>
            <textarea
              value={details}
              maxLength={500}
              rows={2}
              onChange={(event) => setDetails(event.target.value)}
              placeholder="Describe what was wrong or hard to read…"
              data-testid="input-proposal-feedback-details"
            />
          </label>
          <button
            type="submit"
            className="builder-chat__rating-submit"
            disabled={!reason || saving}
            data-testid="button-save-proposal-feedback"
          >
            {saving && <LoaderCircle className="is-spinning" aria-hidden="true" />}
            Save feedback
          </button>
        </form>
      )}

      {savedVote && (
        <div className="builder-chat__rating-saved" role="status">
          <span>Saved to your account. You can review or remove it in Saved memories.</span>
          {savedVote === 'down' && reason && (
            <button
              type="button"
              className="builder-chat__text-link"
              onClick={() => onRevise(reason, details)}
              data-testid="button-revise-from-feedback"
            >
              Revise using this feedback
            </button>
          )}
        </div>
      )}
      {error && <p className="builder-chat__rating-error" role="alert">{error}</p>}
    </section>
  );
}

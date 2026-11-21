import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  getListCircuitBuilderMemoriesQueryKey,
  useClearCircuitBuilderMemories,
  useDeleteCircuitBuilderMemory,
  useListCircuitBuilderMemories,
  useUpdateCircuitBuilderMemory,
} from '@workspace/api-client-react';
import type { CircuitBuilderMemory } from '@workspace/api-client-react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CircleHelp } from 'lucide-react';

const categoryLabels: Record<CircuitBuilderMemory['category'], string> = {
  'work-style': 'How you like to work',
  'design-decision': 'Circuit decision',
  'past-context': 'Project context',
  'repair-lesson': 'Repair lesson',
};

export type CircuitBuilderMemoryImportStatus = {
  kind: 'idle' | 'loading' | 'done' | 'error';
  learnedCount?: number;
  conversationCount?: number;
};

type CircuitBuilderMemoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  historyImportStatus: CircuitBuilderMemoryImportStatus;
  onRetryHistoryImport: () => void;
};

export function CircuitBuilderMemoryDialog({
  open,
  onOpenChange,
  historyImportStatus,
  onRetryHistoryImport,
}: CircuitBuilderMemoryDialogProps) {
  const queryClient = useQueryClient();
  const memoriesQuery = useListCircuitBuilderMemories({
    query: {
      queryKey: getListCircuitBuilderMemoriesQueryKey(),
      enabled: open,
    },
  });
  const updateMutation = useUpdateCircuitBuilderMemory();
  const deleteMutation = useDeleteCircuitBuilderMemory();
  const clearMutation = useClearCircuitBuilderMemories();
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [confirmClear, setConfirmClear] = useState(false);
  const [actionError, setActionError] = useState('');
  const [helpOpen, setHelpOpen] = useState(false);
  const helpTriggerRef = useRef<HTMLButtonElement>(null);
  const helpContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!helpOpen) return;

    const closeHelpWhenClickingOutside = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        helpContentRef.current?.contains(target) ||
        helpTriggerRef.current?.contains(target)
      ) {
        return;
      }

      setHelpOpen(false);
    };

    document.addEventListener('pointerdown', closeHelpWhenClickingOutside);
    return () =>
      document.removeEventListener('pointerdown', closeHelpWhenClickingOutside);
  }, [helpOpen]);

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) setHelpOpen(false);
    onOpenChange(nextOpen);
  };

  const refreshMemories = async () => {
    await queryClient.invalidateQueries({
      queryKey: getListCircuitBuilderMemoriesQueryKey(),
    });
  };

  const saveMemory = async (memory: CircuitBuilderMemory) => {
    const content = (drafts[memory.id] ?? memory.content).trim();
    if (!content) return;
    setActionError('');
    try {
      await updateMutation.mutateAsync({ id: memory.id, data: { content } });
      setDrafts((current) => {
        const next = { ...current };
        delete next[memory.id];
        return next;
      });
      await refreshMemories();
    } catch {
      setActionError('Could not save memory. Try again.');
    }
  };

  const removeMemory = async (id: number) => {
    setActionError('');
    try {
      await deleteMutation.mutateAsync({ id });
      setDrafts((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
      await refreshMemories();
    } catch {
      setActionError('Could not remove memory. Try again.');
    }
  };

  const removeAllMemories = async () => {
    setActionError('');
    try {
      await clearMutation.mutateAsync();
      setDrafts({});
      setConfirmClear(false);
      await refreshMemories();
    } catch {
      setActionError('Could not clear memories. Try again.');
    }
  };

  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    clearMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="builder-memory-dialog">
        <DialogHeader>
          <div className="builder-memory-dialog__title-row">
            <DialogTitle>What I remember</DialogTitle>
            <button
              type="button"
              className="builder-memory-dialog__help-trigger"
              ref={helpTriggerRef}
              aria-label="About saved memories"
              aria-expanded={helpOpen}
              aria-controls="builder-memory-help"
              onClick={() => setHelpOpen((isOpen) => !isOpen)}
              data-testid="button-memory-help"
            >
              <CircleHelp aria-hidden="true" />
            </button>
          </div>
          {helpOpen && (
            <div
              id="builder-memory-help"
              className="builder-memory-dialog__help-content"
              ref={helpContentRef}
              role="note"
              aria-label="Saved memory details"
              data-testid="memory-help"
            >
              <p>Memories are saved to your account, not as chat transcripts.</p>
              <p>Applying a checked repair can save a lesson.</p>
              <p>
                On first import, short excerpts from up to 12 recent sessions are
                sent to Gemini to find reusable assumptions. Only assumptions are
                saved, not chats; they do not train Gemini.
              </p>
              <p>Relevant memories can shape future chats. Edit or remove them here.</p>
            </div>
          )}
        </DialogHeader>

        {historyImportStatus.kind === 'loading' && (
          <p className="builder-memory-dialog__empty" role="status">
            Updating memories…
          </p>
        )}
        {historyImportStatus.kind === 'done' && (
          <p className="builder-memory-dialog__empty" role="status">
            {historyImportStatus.learnedCount === undefined
              ? 'Memories are up to date.'
              : historyImportStatus.learnedCount === 0
                ? 'No new memories.'
                : `Added ${historyImportStatus.learnedCount} memor${historyImportStatus.learnedCount === 1 ? 'y' : 'ies'}.`}
          </p>
        )}
        {historyImportStatus.kind === 'error' && (
          <p className="builder-memory-dialog__error" role="alert">
            Could not update memories. Your saved memories are unchanged.{' '}
            <button
              type="button"
              onClick={onRetryHistoryImport}
            >
              Try again
            </button>
          </p>
        )}

        {actionError && <p className="builder-memory-dialog__error" role="alert">{actionError}</p>}
        {memoriesQuery.isLoading && (
          <p className="builder-memory-dialog__empty" role="status">Loading memories…</p>
        )}
        {memoriesQuery.isError && (
          <p className="builder-memory-dialog__error" role="alert">
            Could not load memories. Reopen to try again.
          </p>
        )}
        {memoriesQuery.data?.length === 0 && !memoriesQuery.isLoading && (
          <p className="builder-memory-dialog__empty">
            No saved memories yet.
          </p>
        )}

        {!!memoriesQuery.data?.length && (
          <div className="builder-memory-dialog__list">
            {memoriesQuery.data.map((memory) => {
              const draft = drafts[memory.id] ?? memory.content;
              const changed = draft.trim() !== memory.content;
              return (
                <article className="builder-memory-dialog__item" key={memory.id}>
                  <div className="builder-memory-dialog__item-heading">
                    <span>{memory.category === 'repair-lesson' ? 'Repair lesson' : 'Memory'}</span>
                    <span>{categoryLabels[memory.category]}</span>
                  </div>
                  <label className="builder-memory-dialog__label" htmlFor={`builder-memory-${memory.id}`}>
                    Edit memory
                  </label>
                  <textarea
                    id={`builder-memory-${memory.id}`}
                    value={draft}
                    maxLength={300}
                    rows={3}
                    onChange={(event) => setDrafts((current) => ({
                      ...current,
                      [memory.id]: event.target.value,
                    }))}
                    disabled={busy}
                  />
                  <div className="builder-memory-dialog__item-actions">
                    <button
                      type="button"
                      onClick={() => void saveMemory(memory)}
                      disabled={busy || !changed || !draft.trim()}
                    >
                      Save
                    </button>
                    <button
                      type="button"
                      className="is-danger"
                      onClick={() => void removeMemory(memory.id)}
                      disabled={busy}
                    >
                      Remove
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        )}

        <DialogFooter className="builder-memory-dialog__footer">
          {memoriesQuery.data && memoriesQuery.data.length > 0 && (
            confirmClear ? (
              <div className="builder-memory-dialog__clear-confirm" role="alert">
                <span>Delete all saved memories?</span>
                <button type="button" className="is-danger" onClick={() => void removeAllMemories()} disabled={busy}>
                  Delete all
                </button>
                <button type="button" onClick={() => setConfirmClear(false)} disabled={busy}>
                  Cancel
                </button>
              </div>
            ) : (
              <button
                type="button"
                className="builder-memory-dialog__clear"
                onClick={() => setConfirmClear(true)}
                disabled={busy}
              >
                Clear all memories
              </button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

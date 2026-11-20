import { useState } from 'react';
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
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

const categoryLabels: Record<CircuitBuilderMemory['category'], string> = {
  'work-style': 'How you like to work',
  'design-decision': 'Circuit decision',
  'past-context': 'Project context',
};

type CircuitBuilderMemoryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

export function CircuitBuilderMemoryDialog({
  open,
  onOpenChange,
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
      setActionError('Could not save that assumption. Please try again.');
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
      setActionError('Could not remove that assumption. Please try again.');
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
      setActionError('Could not clear saved assumptions. Please try again.');
    }
  };

  const busy =
    updateMutation.isPending ||
    deleteMutation.isPending ||
    clearMutation.isPending;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="builder-memory-dialog">
        <DialogHeader>
          <DialogTitle>What I remember</DialogTitle>
          <DialogDescription>
            These are short assumptions, not saved chat transcripts. New chats
            use only relevant items, and treat them as tentative. Correct them
            in chat or edit them here.
          </DialogDescription>
        </DialogHeader>

        {actionError && <p className="builder-memory-dialog__error" role="alert">{actionError}</p>}
        {memoriesQuery.isLoading && (
          <p className="builder-memory-dialog__empty" role="status">Loading saved assumptions…</p>
        )}
        {memoriesQuery.isError && (
          <p className="builder-memory-dialog__error" role="alert">
            Saved assumptions could not be loaded. Please try closing and reopening this panel.
          </p>
        )}
        {memoriesQuery.data?.length === 0 && !memoriesQuery.isLoading && (
          <p className="builder-memory-dialog__empty">
            No assumptions saved yet. As you chat, Circuit Studio will keep only
            useful, reusable context—not every old conversation.
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
                    <span>Assumption</span>
                    <span>{categoryLabels[memory.category]}</span>
                  </div>
                  <label className="builder-memory-dialog__label" htmlFor={`builder-memory-${memory.id}`}>
                    Edit this assumption
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
                <span>This removes every saved assumption.</span>
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
                Clear all assumptions
              </button>
            )
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

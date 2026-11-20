import { useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { CIRCUIT_COMPONENT_LIBRARY } from '@workspace/circuit-geometry';
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import './component-library-dialog.css';

type CircuitComponentLibraryEntry = (typeof CIRCUIT_COMPONENT_LIBRARY)[number];

export type ComponentLibraryDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (entry: CircuitComponentLibraryEntry) => void;
};

const categories = Array.from(
  new Set(CIRCUIT_COMPONENT_LIBRARY.map((entry) => entry.category)),
).sort((a, b) => a.localeCompare(b));

export function ComponentLibraryDialog({
  open,
  onOpenChange,
  onSelect,
}: ComponentLibraryDialogProps) {
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');

  const filteredEntries = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();

    return CIRCUIT_COMPONENT_LIBRARY.filter((entry) => {
      const matchesCategory = category === 'all' || entry.category === category;
      const searchableText = [
        entry.displayName,
        entry.type,
        entry.category,
        entry.description,
      ]
        .join(' ')
        .toLocaleLowerCase();

      return matchesCategory && searchableText.includes(normalizedQuery);
    });
  }, [category, query]);

  const handleSelect = (entry: CircuitComponentLibraryEntry) => {
    onSelect(entry);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="component-library-dialog"
        data-testid="component-library-dialog"
      >
        <DialogHeader className="component-library-dialog__header">
          <div className="component-library-dialog__heading">
            <span className="component-library-dialog__eyebrow">
              Circuit Studio / Reference
            </span>
            <DialogTitle className="component-library-dialog__title">
              Component library
            </DialogTitle>
            <DialogDescription className="component-library-dialog__description">
              Choose a symbol to add to your builder request.
            </DialogDescription>
          </div>
          <DialogClose
            className="component-library-dialog__close"
            aria-label="Close component library"
            data-testid="component-library-close"
          >
            <span aria-hidden="true">×</span>
          </DialogClose>
        </DialogHeader>

        <div className="component-library-dialog__tools">
          <label className="component-library-dialog__search">
            <span className="component-library-dialog__sr-only">
              Search component library
            </span>
            <Search aria-hidden="true" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.currentTarget.value)}
              placeholder="Search name, type, or description"
              autoComplete="off"
              data-testid="component-library-search"
            />
          </label>

          <label className="component-library-dialog__category">
            <span>Category</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
              data-testid="component-library-category-filter"
            >
              <option value="all">All categories</option>
              {categories.map((item) => (
                <option key={item} value={item}>
                  {item}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div
          className="component-library-dialog__results-heading"
          role="status"
          aria-live="polite"
          data-testid="component-library-result-count"
        >
          <span>
            <strong>{filteredEntries.length}</strong>{' '}
            {filteredEntries.length === 1 ? 'symbol' : 'symbols'}
          </span>
          {category !== 'all' && (
            <span
              className="component-library-dialog__active-filter"
              data-testid="component-library-active-filter"
            >
              {category}
            </span>
          )}
        </div>

        <div className="component-library-dialog__list">
          {filteredEntries.length > 0 ? (
            <ul className="component-library-dialog__grid">
              {filteredEntries.map((entry) => {
                const isAnnotation = entry.category === 'Drawing';
                const pinSummary =
                  entry.pinCount === null
                    ? 'Variable pins'
                    : `${entry.pinCount} ${entry.pinCount === 1 ? 'pin' : 'pins'}`;

                return (
                  <li
                    className="component-library-dialog__item"
                    key={entry.type}
                    data-testid={`component-library-entry-${entry.type}`}
                  >
                    <div className="component-library-dialog__item-top">
                      <span
                        className={`component-library-dialog__mark${isAnnotation ? ' is-annotation' : ''}`}
                        aria-hidden="true"
                      >
                        {isAnnotation ? '—' : '⌁'}
                      </span>
                      <div className="component-library-dialog__item-title">
                        <h3 data-testid={`component-library-name-${entry.type}`}>
                          {entry.displayName}
                        </h3>
                        {isAnnotation && (
                          <span
                            className="component-library-dialog__annotation-tag"
                            data-testid={`component-library-annotation-${entry.type}`}
                          >
                            Drawing annotation
                          </span>
                        )}
                      </div>
                      <span className="component-library-dialog__type">
                        {entry.type}
                      </span>
                    </div>

                    <p
                      className="component-library-dialog__item-description"
                      data-testid={`component-library-description-${entry.type}`}
                    >
                      {entry.description}
                    </p>

                    <div className="component-library-dialog__item-meta">
                      <span data-testid={`component-library-entry-category-${entry.type}`}>
                        {entry.category}
                      </span>
                      <span aria-hidden="true">/</span>
                      <span data-testid={`component-library-pins-${entry.type}`}>
                        {pinSummary}
                        {entry.pinCount !== null && ` · ${entry.pinNames}`}
                      </span>
                    </div>

                    <button
                      className="component-library-dialog__select"
                      type="button"
                      onClick={() => handleSelect(entry)}
                      data-testid={`component-library-select-${entry.type}`}
                    >
                      Use this symbol
                      <ArrowUpRight aria-hidden="true" />
                    </button>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div
              className="component-library-dialog__empty"
              data-testid="component-library-empty-state"
            >
              <span className="component-library-dialog__empty-mark" aria-hidden="true">
                / / /
              </span>
              <h3>No matching symbols</h3>
              <p>Try a different term or reset the category filter.</p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                }}
                data-testid="component-library-reset"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        <p
          className="component-library-dialog__note"
          data-testid="component-library-scope-note"
        >
          This catalog provides schematic symbols and structural pin checks,
          not simulation, safety verification, or certification.
        </p>
      </DialogContent>
    </Dialog>
  );
}

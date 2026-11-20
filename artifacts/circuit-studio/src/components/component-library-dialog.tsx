import { useEffect, useMemo, useState } from 'react';
import { ArrowUpRight, Search } from 'lucide-react';
import { CIRCUIT_COMPONENT_LIBRARY } from '@workspace/circuit-geometry';
import {
  getSearchCircuitSymbolsQueryKey,
  useSearchCircuitSymbols,
} from '@workspace/api-client-react';
import type { CircuitSymbolSearchItem } from '@workspace/api-client-react';
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
  onSelect: (entry: CircuitComponentLibraryEntry | CircuitSymbolSearchItem) => void;
};

const categories = Array.from(
  new Set(CIRCUIT_COMPONENT_LIBRARY.map((entry) => entry.category)),
).sort((a, b) => a.localeCompare(b));

export function ComponentLibraryDialog({
  open,
  onOpenChange,
  onSelect,
}: ComponentLibraryDialogProps) {
  const [source, setSource] = useState<'studio' | 'kicad'>('studio');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  const searchParams = {
    ...(debouncedQuery ? { q: debouncedQuery } : {}),
    ...(category !== 'all' ? { library: category } : {}),
    limit: 40,
  };

  const kicadSearch = useSearchCircuitSymbols(
    searchParams,
    {
      query: {
        queryKey: getSearchCircuitSymbolsQueryKey(searchParams),
        enabled: open && source === 'kicad',
        staleTime: 5 * 60 * 1000,
        retry: 1,
      },
    },
  );

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

  const handleSelect = (
    entry: CircuitComponentLibraryEntry | CircuitSymbolSearchItem,
  ) => {
    onSelect(entry);
    onOpenChange(false);
  };

  const kicadEntries = kicadSearch.data?.results ?? [];
  const kicadLibraries = kicadSearch.data?.libraries ?? [];

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
              {source === 'kicad'
                ? 'Search 22,911 official KiCad schematic symbols across 223 libraries.'
                : 'Choose a symbol to add to your builder request.'}
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

        <div
          className="component-library-dialog__sources"
          role="tablist"
          aria-label="Symbol catalog source"
          data-testid="component-library-sources"
        >
          <button
            type="button"
            role="tab"
            aria-selected={source === 'studio'}
            className={source === 'studio' ? 'is-active' : ''}
            onClick={() => {
              setSource('studio');
              setCategory('all');
            }}
            data-testid="component-library-source-studio"
          >
            Studio symbols
            <span>{CIRCUIT_COMPONENT_LIBRARY.length}</span>
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={source === 'kicad'}
            className={source === 'kicad' ? 'is-active' : ''}
            onClick={() => {
              setSource('kicad');
              setCategory('all');
            }}
            data-testid="component-library-source-kicad"
          >
            Official KiCad library
            <span>22,911</span>
          </button>
        </div>

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
              placeholder={source === 'kicad' ? 'Search 22,911 library symbols' : 'Search name, type, or description'}
              autoComplete="off"
              data-testid="component-library-search"
            />
          </label>

          <label className="component-library-dialog__category">
            <span>{source === 'kicad' ? 'Library' : 'Category'}</span>
            <select
              value={category}
              onChange={(event) => setCategory(event.currentTarget.value)}
              data-testid="component-library-category-filter"
            >
              <option value="all">{source === 'kicad' ? 'All libraries' : 'All categories'}</option>
              {(source === 'kicad' ? kicadLibraries : categories).map((item) => (
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
            {source === 'kicad' ? (
              <>
                <strong>{kicadEntries.length}</strong>
                {kicadSearch.data?.hasMore ? ` shown of ${kicadSearch.data.total}` : ' symbols'}
              </>
            ) : (
              <>
                <strong>{filteredEntries.length}</strong>{' '}
                {filteredEntries.length === 1 ? 'symbol' : 'symbols'}
              </>
            )}
          </span>
          {source === 'kicad' && kicadSearch.data ? (
            <span
              className="component-library-dialog__active-filter"
              data-testid="component-library-source-version"
            >
              KiCad {kicadSearch.data.sourceVersion}
            </span>
          ) : category !== 'all' && (
            <span
              className="component-library-dialog__active-filter"
              data-testid="component-library-active-filter"
            >
              {category}
            </span>
          )}
        </div>

        <div className="component-library-dialog__list">
          {source === 'kicad' && kicadSearch.isLoading ? (
            <div className="component-library-dialog__empty" role="status" data-testid="component-library-loading">
              <h3>Loading KiCad symbols</h3>
              <p>Searching the indexed catalog of 22,911 schematic symbols.</p>
            </div>
          ) : source === 'kicad' && kicadSearch.isError ? (
            <div className="component-library-dialog__empty" role="alert" data-testid="component-library-error">
              <h3>Symbol search is unavailable</h3>
              <p>{kicadSearch.error instanceof Error ? kicadSearch.error.message : 'Try again in a moment.'}</p>
              <button type="button" onClick={() => void kicadSearch.refetch()}>
                Try again
              </button>
            </div>
          ) : (source === 'kicad' ? kicadEntries.length > 0 : filteredEntries.length > 0) ? (
            <ul className="component-library-dialog__grid">
              {(source === 'kicad' ? kicadEntries : filteredEntries).map((entry) => {
                const isKicadEntry = 'id' in entry;
                const isAnnotation = !isKicadEntry && entry.category === 'Drawing';
                const entryId = isKicadEntry ? entry.id : entry.type;
                const entryName = isKicadEntry ? entry.name : entry.displayName;
                const entryType = isKicadEntry ? entry.id : entry.type;
                const entryDescription = isKicadEntry
                  ? entry.description || entry.keywords || 'KiCad schematic symbol'
                  : entry.description;
                const entryCategory = isKicadEntry ? entry.library : entry.category;
                const pinSummary =
                  entry.pinCount === null
                    ? 'Variable pins'
                    : `${entry.pinCount} ${entry.pinCount === 1 ? 'pin' : 'pins'}`;

                return (
                  <li
                    className="component-library-dialog__item"
                    key={entryId}
                    data-testid={`component-library-entry-${entryId}`}
                  >
                    <div className="component-library-dialog__item-top">
                      <span
                        className={`component-library-dialog__mark${isAnnotation ? ' is-annotation' : ''}${isKicadEntry ? ' is-kicad' : ''}`}
                        aria-hidden="true"
                      >
                        {isAnnotation ? '—' : isKicadEntry ? 'K' : '⌁'}
                      </span>
                      <div className="component-library-dialog__item-title">
                        <h3 data-testid={`component-library-name-${entryId}`}>
                          {entryName}
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
                        {entryType}
                      </span>
                    </div>

                    <p
                      className="component-library-dialog__item-description"
                      data-testid={`component-library-description-${entryId}`}
                    >
                      {entryDescription}
                    </p>

                    <div className="component-library-dialog__item-meta">
                      <span data-testid={`component-library-entry-category-${entryId}`}>
                        {entryCategory}
                      </span>
                      <span aria-hidden="true">/</span>
                      <span data-testid={`component-library-pins-${entryId}`}>
                        {pinSummary}
                        {!isKicadEntry && entry.pinCount !== null && ` · ${entry.pinNames}`}
                      </span>
                    </div>

                    <button
                      className="component-library-dialog__select"
                      type="button"
                      onClick={() => handleSelect(entry)}
                      data-testid={`component-library-select-${entryId}`}
                    >
                      {isKicadEntry ? 'Use exact library symbol' : 'Use this symbol'}
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
              <h3>{source === 'kicad' ? 'No matching KiCad symbols' : 'No matching symbols'}</h3>
              <p>Try a different term or reset the {source === 'kicad' ? 'library' : 'category'} filter.</p>
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
          {source === 'kicad'
            ? 'KiCad symbol data is loaded when you build a proposal. The draft is for schematic planning, not simulation, safety verification, or certification.'
            : 'This catalog provides schematic symbols and structural pin checks, not simulation, safety verification, or certification.'}
        </p>
      </DialogContent>
    </Dialog>
  );
}

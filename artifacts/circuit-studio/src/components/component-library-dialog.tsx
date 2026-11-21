import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import { ArrowUpRight, CircuitBoard, LoaderCircle, Search, X } from 'lucide-react';
import { CIRCUIT_COMPONENT_LIBRARY } from '@workspace/circuit-geometry';
import {
  getGetCircuitSymbolDataQueryKey,
  getSearchCircuitSymbolsQueryKey,
  useGetCircuitSymbolData,
  useSearchCircuitSymbols,
} from '@workspace/api-client-react';
import type {
  CircuitSpec,
  CircuitSymbolSearchItem,
} from '@workspace/api-client-react';
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

const previewOptions = {
  allowStructuralErrors: true,
  padding: 14,
  stroke: '#285947',
  text: '#285947',
  muted: '#6f8177',
  background: null,
  font: 'Arial, Helvetica, sans-serif',
  lineWidth: 2,
  dotRadius: 2.5,
};

type LibraryEntry = CircuitComponentLibraryEntry | CircuitSymbolSearchItem;

function createBuiltinPreviewSpec(
  entry: CircuitComponentLibraryEntry,
): CircuitSpec {
  const required = new Set(entry.requiredProperties);
  const element: Record<string, unknown> = { type: entry.type };

  if (required.has('from')) {
    element.from = [35, 100];
    element.to = [165, 100];
  }
  if (required.has('at')) element.at = [100, 100];
  if (required.has('x')) {
    element.x = 50;
    element.y = 62;
    element.w = 100;
    element.h = 76;
  }
  if (required.has('text')) element.text = 'NET';
  if (required.has('points')) {
    element.points = [[40, 100], [160, 100]];
    element.open = true;
  }
  if (required.has('pins')) {
    element.pins = [
      { name: 'IN', side: 'left' },
      { name: 'OUT', side: 'right' },
    ];
  }

  return {
    title: `${entry.displayName} preview`,
    elements: [element],
  } as CircuitSpec;
}

function getPreviewSvg(spec: CircuitSpec): string {
  if (!window.CircuitDraw) return '';
  try {
    return window.CircuitDraw.render(spec, previewOptions);
  } catch {
    return '';
  }
}

function CircuitSymbolPreview({
  entry,
}: {
  entry: CircuitComponentLibraryEntry;
}) {
  const svg = useMemo(
    () => getPreviewSvg(createBuiltinPreviewSpec(entry)),
    [entry],
  );

  return svg ? (
    <div
      className="component-library-dialog__symbol-svg"
      aria-hidden="true"
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  ) : (
    <CircuitBoard className="component-library-dialog__symbol-fallback" aria-hidden="true" />
  );
}

function KicadSymbolPreview({
  symbolId,
  name,
  listRef,
}: {
  symbolId: string;
  name: string;
  listRef: RefObject<HTMLDivElement | null>;
}) {
  const previewRef = useRef<HTMLDivElement>(null);
  const [nearViewport, setNearViewport] = useState(false);

  useEffect(() => {
    const node = previewRef.current;
    if (!node) return;

    if (typeof IntersectionObserver === 'undefined') {
      setNearViewport(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (!entry.isIntersecting) return;
        setNearViewport(true);
        observer.disconnect();
      },
      { root: listRef.current, rootMargin: '220px' },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [listRef]);

  const queryParams = { symbolId };
  const symbolQuery = useGetCircuitSymbolData(queryParams, {
    query: {
      queryKey: getGetCircuitSymbolDataQueryKey(queryParams),
      enabled: nearViewport,
      staleTime: 30 * 60 * 1000,
      retry: 1,
    },
  });

  const svg = useMemo(() => {
    const data = symbolQuery.data;
    if (!data?.units.length) return '';
    const unit =
      data.units.find((candidate) => candidate.unit === 1 && candidate.bodyStyle === 1) ??
      data.units[0];

    return getPreviewSvg({
      title: `${name} preview`,
      elements: [{
        type: 'kicad',
        symbolId,
        symbolData: data,
        at: [100, 100],
        unit: unit.unit,
        bodyStyle: unit.bodyStyle,
      }],
    } as CircuitSpec);
  }, [name, symbolId, symbolQuery.data]);

  return (
    <div
      ref={previewRef}
      className="component-library-dialog__symbol-content"
      aria-busy={nearViewport && symbolQuery.isLoading}
    >
      {svg ? (
        <div
          className="component-library-dialog__symbol-svg"
          aria-hidden="true"
          dangerouslySetInnerHTML={{ __html: svg }}
        />
      ) : symbolQuery.isError ? (
        <CircuitBoard className="component-library-dialog__symbol-fallback" aria-hidden="true" />
      ) : (
        <LoaderCircle
          className="component-library-dialog__symbol-loading"
          aria-hidden="true"
        />
      )}
    </div>
  );
}

function ComponentLibraryCard({
  entry,
  onSelect,
  listRef,
}: {
  entry: LibraryEntry;
  onSelect: (entry: LibraryEntry) => void;
  listRef: RefObject<HTMLDivElement | null>;
}) {
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
      data-testid={`component-library-entry-${entryId}`}
    >
      <div className="component-library-dialog__item-content">
        <div className="component-library-dialog__item-top">
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
          <span
            className={`component-library-dialog__type${isKicadEntry ? ' is-kicad' : ''}`}
            title={entryType}
          >
            {isKicadEntry ? 'KiCad' : entryType}
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
          <span aria-hidden="true">·</span>
          <span data-testid={`component-library-pins-${entryId}`}>
            {pinSummary}
            {!isKicadEntry && entry.pinCount !== null && ` · ${entry.pinNames}`}
          </span>
        </div>

        <button
          className="component-library-dialog__select"
          type="button"
          onClick={() => onSelect(entry)}
          data-testid={`component-library-select-${entryId}`}
        >
          Use symbol
          <ArrowUpRight aria-hidden="true" />
        </button>
      </div>

      <div
        className={`component-library-dialog__symbol${isAnnotation ? ' is-annotation' : ''}`}
        role="img"
        aria-label={`${entryName} schematic symbol`}
        data-testid={`component-library-symbol-${entryId}`}
      >
        {isKicadEntry ? (
          <KicadSymbolPreview
            symbolId={entry.id}
            name={entryName}
            listRef={listRef}
          />
        ) : (
          <CircuitSymbolPreview entry={entry} />
        )}
      </div>
    </li>
  );
}

export function ComponentLibraryDialog({
  open,
  onOpenChange,
  onSelect,
}: ComponentLibraryDialogProps) {
  const [source, setSource] = useState<'studio' | 'kicad'>('studio');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

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
              <CircuitBoard aria-hidden="true" />
              Symbol catalog
            </span>
            <DialogTitle className="component-library-dialog__title">
              Component library
            </DialogTitle>
            <DialogDescription className="component-library-dialog__description">
              Search and add schematic symbols to your design.
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

        <div className="component-library-dialog__catalog-bar">
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
              <span className="component-library-dialog__source-name">Studio</span>
              <span className="component-library-dialog__source-count">
                {CIRCUIT_COMPONENT_LIBRARY.length}
              </span>
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
              <span className="component-library-dialog__source-name">KiCad</span>
              <span className="component-library-dialog__source-count">22,911</span>
            </button>
          </div>
          <span className="component-library-dialog__catalog-hint">
            {source === 'studio' ? 'Built-in symbols' : 'Official symbol library'}
          </span>
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
              placeholder="Search by name, type, or description"
              autoComplete="off"
              data-testid="component-library-search"
            />
            {query && (
              <button
                className="component-library-dialog__clear-search"
                type="button"
                onClick={() => setQuery('')}
                aria-label="Clear search"
                data-testid="component-library-clear-search"
              >
                <X aria-hidden="true" />
              </button>
            )}
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

        <div className="component-library-dialog__list" ref={listRef}>
          {source === 'kicad' && kicadSearch.isLoading ? (
            <div className="component-library-dialog__empty" role="status" data-testid="component-library-loading">
              <h3>Loading KiCad symbols</h3>
              <p>Searching symbols…</p>
            </div>
          ) : source === 'kicad' && kicadSearch.isError ? (
            <div className="component-library-dialog__empty" role="alert" data-testid="component-library-error">
              <h3>Could not load symbols</h3>
              <button type="button" onClick={() => void kicadSearch.refetch()}>
                Retry
              </button>
            </div>
          ) : (source === 'kicad' ? kicadEntries.length > 0 : filteredEntries.length > 0) ? (
            <ul className="component-library-dialog__grid">
              {(source === 'kicad' ? kicadEntries : filteredEntries).map((entry) => (
                <ComponentLibraryCard
                  key={'id' in entry ? entry.id : entry.type}
                  entry={entry}
                  onSelect={handleSelect}
                  listRef={listRef}
                />
              ))}
            </ul>
          ) : (
            <div
              className="component-library-dialog__empty"
              data-testid="component-library-empty-state"
            >
              <h3>{source === 'kicad' ? 'No matching KiCad symbols' : 'No matching symbols'}</h3>
              <p>Try another search or reset filters.</p>
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
          Schematic planning only—not simulation, safety verification, or certification.
        </p>
      </DialogContent>
    </Dialog>
  );
}

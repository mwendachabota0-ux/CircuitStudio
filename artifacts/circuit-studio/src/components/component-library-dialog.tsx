import { useEffect, useMemo, useRef, useState, type RefObject } from 'react';
import {
  ArrowUpRight,
  ChevronLeft,
  ChevronRight,
  CircuitBoard,
  Info,
  LoaderCircle,
  Search,
  X,
} from 'lucide-react';
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
  SearchCircuitSymbolsFamily,
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

const commonSymbolUses: Record<string, string> = {
  resistor:
    'Limits current, sets voltage dividers, and provides bias or pull-up/down paths.',
  'Device:R':
    'Limits current, sets voltage dividers, and provides bias or pull-up/down paths.',
  capacitor:
    'Stores charge and is commonly used for filtering, decoupling, signal coupling, and timing.',
  'Device:C':
    'Stores charge and is commonly used for filtering, decoupling, signal coupling, and timing.',
  'Device:C_Polarized':
    'Stores charge for filtering and supply smoothing; its positive and negative leads must be oriented correctly.',
  diode:
    'Allows current mainly in one direction for rectification, reverse-polarity protection, and signal clamping.',
  'Device:D':
    'Allows current mainly in one direction for rectification, reverse-polarity protection, and signal clamping.',
  led:
    'Converts forward current to light; use a series resistor to limit its current.',
  'Device:LED':
    'Converts forward current to light; use a series resistor to limit its current.',
  npn:
    'Uses a small base current to control a larger collector-emitter current, often as a switch or amplifier.',
  'Transistor_BJT:Q_NPN_BCE':
    'Uses a small base current to control a larger collector-emitter current, often as a switch or amplifier.',
  pnp:
    'Provides a controllable high-side switch or amplifier; verify the emitter, base, and collector connections.',
  'Transistor_BJT:Q_PNP_BCE':
    'Provides a controllable high-side switch or amplifier; verify the emitter, base, and collector connections.',
  nmos:
    'Uses gate voltage to control current between drain and source, commonly as a low-side switch.',
  'Transistor_FET:Q_NMOS_GDS':
    'Uses gate voltage to control current between drain and source, commonly as a low-side switch.',
  pmos:
    'Uses gate voltage to control current between source and drain, commonly as a high-side switch.',
  'Transistor_FET:Q_PMOS_GDS':
    'Uses gate voltage to control current between source and drain, commonly as a high-side switch.',
  'power:GND':
    'Marks the shared ground/reference net so connected points use the same circuit reference.',
  'Device:Battery':
    'Represents a battery supplying direct-current energy to the circuit.',
  'Device:Fuse':
    'Opens the circuit when current exceeds its specified limit, helping protect downstream wiring and parts.',
};

type LibraryEntry = CircuitComponentLibraryEntry | CircuitSymbolSearchItem;
const KICAD_PAGE_SIZE = 100;

function getUsagePanelId(entryId: string): string {
  return `component-library-use-${entryId.replace(/[^a-z0-9_-]/gi, '-')}`;
}

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
  usageOpen,
  onToggleUsage,
}: {
  entry: LibraryEntry;
  onSelect: (entry: LibraryEntry) => void;
  listRef: RefObject<HTMLDivElement | null>;
  usageOpen: boolean;
  onToggleUsage: (entryId: string) => void;
}) {
  const isKicadEntry = 'id' in entry;
  const isAnnotation = !isKicadEntry && entry.category === 'Drawing';
  const entryId = isKicadEntry ? entry.id : entry.type;
  const entryName = isKicadEntry ? entry.name : entry.displayName;
  const entryType = isKicadEntry ? entry.id : entry.type;
  const entryDescription = isKicadEntry
    ? entry.description.trim() ||
      entry.keywords.trim() ||
      `${entryName} schematic symbol from the ${entry.library} library.`
    : entry.description;
  const entryUsage = commonSymbolUses[entryId] ?? entryDescription;
  const entryKeywords = isKicadEntry ? entry.keywords.trim() : '';
  const entryCategory = isKicadEntry ? entry.library : entry.category;
  const usagePanelId = getUsagePanelId(entryId);
  const pinSummary =
    entry.pinCount === null
      ? 'Variable pins'
      : `${entry.pinCount} ${entry.pinCount === 1 ? 'pin' : 'pins'}`;

  return (
    <li
      className="component-library-dialog__item"
      data-testid={`component-library-entry-${entryId}`}
    >
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
        <button
          className="component-library-dialog__usage-toggle"
          type="button"
          aria-label={`Read the function and use of ${entryName}`}
          aria-expanded={usageOpen}
          aria-controls={usagePanelId}
          title={entryUsage}
          onClick={() => onToggleUsage(entryId)}
          data-testid={`component-library-use-details-toggle-${entryId}`}
        >
          <Info aria-hidden="true" />
        </button>
        <span
          className={`component-library-dialog__type${isKicadEntry ? ' is-kicad' : ''}`}
          title={entryType}
        >
          {isKicadEntry ? 'KiCad' : entryType}
        </span>
      </div>

      <div className="component-library-dialog__item-content">
        <button
          className="component-library-dialog__item-description"
          type="button"
          title={entryUsage}
          aria-label={`Read the function and use of ${entryName}`}
          aria-expanded={usageOpen}
          aria-controls={usagePanelId}
          onClick={() => onToggleUsage(entryId)}
          data-testid={`component-library-description-${entryId}`}
        >
          {entryDescription}
        </button>

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
      <div
        id={usagePanelId}
        className={`component-library-dialog__usage-panel${usageOpen ? ' is-open' : ''}`}
        role="tooltip"
        data-testid={`component-library-use-details-${entryId}`}
      >
        <strong>Function and use</strong>
        <p>{entryUsage}</p>
        {isKicadEntry && entryDescription !== entryUsage && (
          <p className="component-library-dialog__usage-source">
            KiCad description: {entryDescription}
          </p>
        )}
        {entryKeywords && entryKeywords !== entryDescription && (
          <p className="component-library-dialog__usage-keywords">
            Related terms: {entryKeywords}
          </p>
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
  const [source, setSource] = useState<'studio' | 'kicad'>('kicad');
  const [query, setQuery] = useState('');
  const [category, setCategory] = useState('all');
  const [kicadFamily, setKicadFamily] = useState<SearchCircuitSymbolsFamily | 'all'>('all');
  const [debouncedQuery, setDebouncedQuery] = useState('');
  const [kicadPageIndex, setKicadPageIndex] = useState(-1);
  const [openUsageId, setOpenUsageId] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: 0 });
    setOpenUsageId(null);
  }, [open, source, category, kicadFamily, debouncedQuery, kicadPageIndex]);

  const featuredPage =
    kicadPageIndex === -1 && !debouncedQuery && kicadFamily === 'all';
  const searchParams = {
    ...(debouncedQuery ? { q: debouncedQuery } : {}),
    ...(kicadFamily !== 'all' ? { family: kicadFamily } : {}),
    ...(featuredPage ? { featured: true } : {}),
    limit: KICAD_PAGE_SIZE,
    offset: Math.max(0, kicadPageIndex) * KICAD_PAGE_SIZE,
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
  const kicadFamilies = kicadSearch.data?.families ?? [];
  const kicadTotal = kicadSearch.data?.total ?? 0;
  const kicadTotalPages = Math.max(1, Math.ceil(kicadTotal / KICAD_PAGE_SIZE));
  const fullCatalogCount =
    !debouncedQuery && kicadFamily === 'all' && kicadSearch.data
      ? kicadSearch.data.catalogTotal
      : null;
  const kicadResultStart = kicadEntries.length
    ? Math.max(0, kicadPageIndex) * KICAD_PAGE_SIZE + 1
    : 0;
  const kicadResultEnd =
    Math.max(0, kicadPageIndex) * KICAD_PAGE_SIZE + kicadEntries.length;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="component-library-dialog"
        data-testid="component-library-dialog"
      >
        <DialogHeader className="component-library-dialog__header">
          <div className="component-library-dialog__heading">
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
                setKicadFamily('all');
                setKicadPageIndex(0);
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
                setKicadFamily('all');
                setKicadPageIndex(-1);
              }}
              data-testid="component-library-source-kicad"
            >
              <span className="component-library-dialog__source-name">KiCad</span>
              {fullCatalogCount !== null && (
                <span
                  className="component-library-dialog__source-count"
                  data-testid="component-library-kicad-total"
                >
                  {fullCatalogCount.toLocaleString()}
                </span>
              )}
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
              onChange={(event) => {
                const nextQuery = event.currentTarget.value;
                setQuery(nextQuery);
                setKicadPageIndex(
                  nextQuery.trim() || kicadFamily !== 'all' ? 0 : -1,
                );
              }}
              placeholder="Search part numbers, names, functions, or aliases"
              autoComplete="off"
              data-testid="component-library-search"
            />
            {query && (
              <button
                className="component-library-dialog__clear-search"
                type="button"
                onClick={() => {
                  setQuery('');
                  setKicadPageIndex(kicadFamily === 'all' ? -1 : 0);
                }}
                aria-label="Clear search"
                data-testid="component-library-clear-search"
              >
                <X aria-hidden="true" />
              </button>
            )}
          </label>

          <label className="component-library-dialog__category">
            <span>{source === 'kicad' ? 'Family' : 'Category'}</span>
            <select
              value={source === 'kicad' ? kicadFamily : category}
              onChange={(event) => {
                const nextValue = event.currentTarget.value;
                if (source === 'kicad') {
                  const nextFamily = nextValue as SearchCircuitSymbolsFamily | 'all';
                  setKicadFamily(nextFamily);
                  setKicadPageIndex(
                    nextFamily === 'all' && !query.trim() ? -1 : 0,
                  );
                } else {
                  setCategory(nextValue);
                  setKicadPageIndex(0);
                }
              }}
              data-testid="component-library-family-filter"
            >
              <option value="all">{source === 'kicad' ? 'All families' : 'All categories'}</option>
              {(source === 'kicad' ? kicadFamilies : categories).map((item) => (
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
              kicadSearch.isLoading ? (
                <strong>Loading KiCad symbols…</strong>
              ) : (
                <>
                  {featuredPage ? (
                    <>
                      <strong>{kicadEntries.length.toLocaleString()}</strong>{' '}
                      common symbols
                    </>
                  ) : (
                    <>
                      <strong>
                        {kicadResultStart > 0
                          ? `${kicadResultStart.toLocaleString()}–${kicadResultEnd.toLocaleString()}`
                          : '0'}
                      </strong>{' '}
                      of {kicadTotal.toLocaleString()} symbols
                    </>
                  )}
                </>
              )
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
              {kicadFamily !== 'all' && ` · ${kicadFamily}`}
            </span>
          ) : source === 'studio' && category !== 'all' && (
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
                  usageOpen={openUsageId === ('id' in entry ? entry.id : entry.type)}
                  onToggleUsage={(entryId) =>
                    setOpenUsageId((current) => current === entryId ? null : entryId)
                  }
                />
              ))}
            </ul>
          ) : (
            <div
              className="component-library-dialog__empty"
              data-testid="component-library-empty-state"
            >
              <h3>{source === 'kicad' ? 'No matching KiCad symbols' : 'No matching symbols'}</h3>
              <p>
                Try a part number, common name, or function. Aliases and small typos are supported.
              </p>
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setCategory('all');
                  setKicadFamily('all');
                  setKicadPageIndex(-1);
                }}
                data-testid="component-library-reset"
              >
                Reset filters
              </button>
            </div>
          )}
        </div>

        {source === 'kicad' && kicadSearch.data && (
          <nav
            className="component-library-dialog__pagination"
            aria-label="KiCad symbol result pages"
            data-testid="component-library-pagination"
          >
            <button
              type="button"
              onClick={() =>
                setKicadPageIndex((page) =>
                  Math.max(
                    !debouncedQuery && kicadFamily === 'all' ? -1 : 0,
                    page - 1,
                  ),
                )
              }
              disabled={
                featuredPage ||
                (kicadPageIndex <= 0 &&
                  (Boolean(debouncedQuery) || kicadFamily !== 'all')) ||
                kicadSearch.isLoading
              }
              aria-label="Previous page"
              data-testid="component-library-previous-page"
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </button>
            <span data-testid="component-library-page-count">
              {featuredPage
                ? 'Page 0 · Common symbols'
                : `Page ${(Math.max(0, kicadPageIndex) + 1).toLocaleString()} of ${kicadTotalPages.toLocaleString()}`}
            </span>
            <button
              type="button"
              onClick={() => setKicadPageIndex((page) => page + 1)}
              disabled={
                (!featuredPage && !kicadSearch.data.hasMore) ||
                kicadSearch.isLoading
              }
              aria-label="Next page"
              data-testid="component-library-next-page"
            >
              Next
              <ChevronRight aria-hidden="true" />
            </button>
          </nav>
        )}

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

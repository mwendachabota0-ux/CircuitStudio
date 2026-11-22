export type KicadSymbolIndexEntry = {
  id: string;
  library: string;
  name: string;
  description: string;
  keywords: string;
  pinCount: number | null;
  extends?: string;
};

export type KicadSymbolSearchResult = {
  sourceVersion: string;
  total: number;
  hasMore: boolean;
  libraries: string[];
  results: KicadSymbolIndexEntry[];
};

export const KICAD_SYMBOL_SOURCE_VERSION = "10.0.8";

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function get74SeriesSuffix(name: string): string | undefined {
  const digits = name.match(/(\d{2,5})[a-z]*$/i)?.[1];
  if (!digits) return undefined;
  return digits.startsWith("74") && digits.length > 2
    ? digits.slice(2)
    : digits;
}

function fallbackLibraryDescription(library: string): string {
  const knownDescriptions: Record<string, string> = {
    "74xx_IEEE": "74-series logic function",
    "4xxx_IEEE": "4000-series CMOS logic function",
    FPGA_Xilinx: "Xilinx FPGA logic device",
    Video: "Video signal-processing component",
    Transformer: "Transformer",
    Memory_RAM: "RAM device",
    Memory_ROM: "ROM device",
    MCU_NXP_ColdFire: "NXP ColdFire microcontroller",
    MCU_Texas: "Texas Instruments controller",
    Valve: "Vacuum tube",
  };
  return knownDescriptions[library] ??
    `${library.replace(/[_-]+/g, " ").replace(/\bIEEE\b/g, "").replace(/\s+/g, " ").trim()} symbol`;
}

export function enrichKicadSymbolIndex(
  entries: KicadSymbolIndexEntry[],
): KicadSymbolIndexEntry[] {
  const byId = new Map(entries.map((entry) => [entry.id, entry]));
  const byName = new Map<string, KicadSymbolIndexEntry[]>();
  const descriptionsBy74SeriesSuffix = new Map<string, KicadSymbolIndexEntry>();

  for (const entry of entries) {
    const sameNameEntries = byName.get(entry.name) ?? [];
    sameNameEntries.push(entry);
    byName.set(entry.name, sameNameEntries);

    if (entry.library === "74xx" && entry.description.trim()) {
      const suffix = get74SeriesSuffix(entry.name);
      const current = suffix ? descriptionsBy74SeriesSuffix.get(suffix) : undefined;
      if (suffix && (!current || entry.name.length < current.name.length)) {
        descriptionsBy74SeriesSuffix.set(suffix, entry);
      }
    }
  }

  return entries.map((entry) => {
    if (entry.description.trim()) return entry;

    const parent = entry.extends
      ? byId.get(`${entry.library}:${entry.extends}`) ??
        byName.get(entry.extends)?.find((candidate) => candidate.description.trim())
      : undefined;
    const sibling = byName
      .get(entry.name)
      ?.find((candidate) => candidate.id !== entry.id && candidate.description.trim());
    const seriesMatch = entry.library === "74xx_IEEE"
      ? descriptionsBy74SeriesSuffix.get(get74SeriesSuffix(entry.name) ?? "")
      : undefined;
    const description =
      parent?.description.trim() ||
      sibling?.description.trim() ||
      seriesMatch?.description.trim() ||
      entry.keywords.trim() ||
      fallbackLibraryDescription(entry.library);
    return { ...entry, description };
  });
}

export function searchKicadSymbolIndex(
  index: KicadSymbolIndexEntry[],
  query: string,
  library: string,
  requestedLimit: number,
  requestedOffset = 0,
): KicadSymbolSearchResult {
  const libraries = [...new Set(index.map((entry) => entry.library))]
    .sort((left, right) => left.localeCompare(right));
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit) || 40));
  const offset = Math.max(0, Math.floor(requestedOffset) || 0);
  const normalizedQuery = normalized(query);
  const normalizedLibrary = normalized(library);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const matches = index.filter((entry) => {
    if (
      normalizedLibrary &&
      !normalized(entry.library).includes(normalizedLibrary)
    ) return false;
    if (!queryTokens.length) return true;
    const searchable = normalized(
      `${entry.id} ${entry.name} ${entry.description} ${entry.keywords}`,
    );
    return queryTokens.every((token) => searchable.includes(token));
  });

  if (normalizedQuery) {
    matches.sort((left, right) => {
      const score = (entry: KicadSymbolIndexEntry) => {
        const id = normalized(entry.id);
        const name = normalized(entry.name);
        if (id === normalizedQuery || name === normalizedQuery) return 0;
        if (name.startsWith(normalizedQuery)) return 1;
        if (id.startsWith(normalizedQuery)) return 2;
        if (name.includes(normalizedQuery)) return 3;
        return 4;
      };
      return score(left) - score(right) || left.id.localeCompare(right.id);
    });
  } else {
    matches.sort((left, right) => left.name.localeCompare(right.name));
  }

  return {
    sourceVersion: KICAD_SYMBOL_SOURCE_VERSION,
    total: matches.length,
    hasMore: offset + limit < matches.length,
    libraries,
    results: matches.slice(offset, offset + limit),
  };
}

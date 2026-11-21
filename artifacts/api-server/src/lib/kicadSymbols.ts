import { readFile } from "node:fs/promises";
import { gunzipSync } from "node:zlib";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type {
  KicadSymbolData,
  KicadSymbolUnit,
} from "@workspace/circuit-geometry";
import {
  mergeInheritedKicadUnits,
  parseKicadSymbolSource,
} from "./kicadSymbolParser";

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

const SOURCE_VERSION = "10.0.8";
const RAW_LIBRARY_BASE =
  `https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/${SOURCE_VERSION}/`;
const INDEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data/kicad-symbol-index.json.gz",
);
const MAX_SOURCE_BYTES = 1_500_000;
const MAX_CACHED_SYMBOLS = 500;

let indexPromise: Promise<KicadSymbolIndexEntry[]> | undefined;
const symbolCache = new Map<string, KicadSymbolData>();

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

async function getIndex(): Promise<KicadSymbolIndexEntry[]> {
  indexPromise ??= readFile(INDEX_PATH).then((buffer) => {
    const parsed = JSON.parse(gunzipSync(buffer).toString("utf8")) as unknown;
    if (!Array.isArray(parsed)) throw new Error("The KiCad symbol index is invalid.");
    const entries = parsed.filter((entry): entry is KicadSymbolIndexEntry =>
      !!entry &&
      typeof entry === "object" &&
      typeof (entry as KicadSymbolIndexEntry).id === "string" &&
      typeof (entry as KicadSymbolIndexEntry).library === "string" &&
      typeof (entry as KicadSymbolIndexEntry).name === "string",
    );
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
  }).catch((error) => {
    indexPromise = undefined;
    throw error;
  });
  return indexPromise;
}

export async function getKicadSymbolIndexEntry(
  id: string,
): Promise<KicadSymbolIndexEntry | undefined> {
  return (await getIndex()).find((entry) => entry.id === id);
}

export async function searchKicadSymbols(
  query: string,
  library: string,
  requestedLimit: number,
  requestedOffset = 0,
): Promise<KicadSymbolSearchResult> {
  const index = await getIndex();
  const libraries = [...new Set(index.map((entry) => entry.library))]
    .sort((left, right) => left.localeCompare(right));
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit) || 40));
  const offset = Math.max(0, Math.floor(requestedOffset) || 0);
  const normalizedQuery = normalized(query);
  const normalizedLibrary = normalized(library);

  const libraryMatches = (entry: KicadSymbolIndexEntry) =>
    !normalizedLibrary ||
    normalized(entry.library).includes(normalizedLibrary);
  const queryTokens = normalizedQuery.split(" ").filter(Boolean);
  const matches = index.filter((entry) => {
    if (!libraryMatches(entry)) return false;
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
    sourceVersion: SOURCE_VERSION,
    total: matches.length,
    hasMore: offset + limit < matches.length,
    libraries,
    results: matches.slice(offset, offset + limit),
  };
}

function addCacheEntry(id: string, data: KicadSymbolData): void {
  symbolCache.delete(id);
  symbolCache.set(id, data);
  if (symbolCache.size > MAX_CACHED_SYMBOLS) {
    const oldest = symbolCache.keys().next().value;
    if (oldest) symbolCache.delete(oldest);
  }
}

async function fetchSource(entry: KicadSymbolIndexEntry): Promise<string> {
  const url = new URL(
    `${encodeURIComponent(entry.library)}.kicad_symdir/${encodeURIComponent(entry.name)}.kicad_sym`,
    RAW_LIBRARY_BASE,
  );
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { "User-Agent": "CircuitStudio/1.0 (KiCad symbol library reader)" },
  });
  if (!response.ok) {
    throw new Error(`KiCad source returned HTTP ${response.status}.`);
  }
  const declaredLength = Number(response.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_SOURCE_BYTES) {
    throw new Error("KiCad symbol source exceeds the supported size.");
  }
  const buffer = Buffer.from(await response.arrayBuffer());
  if (buffer.byteLength > MAX_SOURCE_BYTES) {
    throw new Error("KiCad symbol source exceeds the supported size.");
  }
  return buffer.toString("utf8");
}

async function fetchSymbolData(
  id: string,
  visited: Set<string>,
): Promise<KicadSymbolData> {
  const cached = symbolCache.get(id);
  if (cached) {
    symbolCache.delete(id);
    symbolCache.set(id, cached);
    return cached;
  }
  if (visited.has(id) || visited.size >= 8) {
    throw new Error("KiCad symbol inheritance is cyclic or too deep.");
  }
  visited.add(id);

  const index = await getIndex();
  const entry = index.find((candidate) => candidate.id === id);
  if (!entry) throw new Error("The requested symbol is not in the KiCad index.");
  const source = await fetchSource(entry);
  const parsed = parseKicadSymbolSource(source);
  let units: KicadSymbolUnit[] = parsed.units;

  if (parsed.extendsName) {
    const parentId = `${entry.library}:${parsed.extendsName}`;
    const parentEntry = index.find((candidate) => candidate.id === parentId)
      ?? index.find((candidate) => candidate.name === parsed.extendsName);
    if (!parentEntry) {
      throw new Error(`Base symbol ${parsed.extendsName} is missing from the KiCad index.`);
    }
    const parentData = await fetchSymbolData(parentEntry.id, visited);
    units = mergeInheritedKicadUnits(parentData.units, units);
  }

  if (!units.length) {
    throw new Error("The KiCad symbol did not contain usable drawing units.");
  }
  const data = { id, units };
  addCacheEntry(id, data);
  return data;
}

export async function getKicadSymbolData(id: string): Promise<KicadSymbolData> {
  return fetchSymbolData(id, new Set());
}

export function formatKicadSymbolPinGuide(
  entry: KicadSymbolIndexEntry,
  symbolData: KicadSymbolData,
): string {
  const unitText = symbolData.units.slice(0, 8).map((unit) => {
    const pins = unit.pins.slice(0, 80).map((pin) => {
      const name = pin.name ? ` ${JSON.stringify(pin.name)}` : "";
      return `pin ${JSON.stringify(pin.number)}${name} at offset (${pin.point[0]}, ${pin.point[1]})`;
    });
    const omitted = unit.pins.length - pins.length;
    return `unit ${unit.unit}, body style ${unit.bodyStyle}: ${pins.join("; ") || "no visible pins"}${omitted > 0 ? `; ${omitted} additional pins omitted` : ""}`;
  });
  if (symbolData.units.length > unitText.length) {
    unitText.push(`${symbolData.units.length - unitText.length} additional units omitted`);
  }
  return [
    `${entry.id} — ${entry.description || entry.keywords || "KiCad library symbol"}`,
    ...unitText,
  ].join("\n");
}

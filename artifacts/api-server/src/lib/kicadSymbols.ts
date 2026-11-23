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
} from "./kicadSymbolParser.ts";

export type KicadSymbolIndexEntry = {
  id: string;
  library: string;
  name: string;
  description: string;
  shortDescription: string;
  longDescription: string;
  keywords: string;
  researchStatus: "catalog_reference" | "corrected" | "needs_review";
  pinCount: number | null;
  extends?: string;
};

type KicadLibraryResourceEntry = {
  catalogId: string;
  shortDescription: string;
  longDescription: string;
  keywords: string[];
  researchStatus: KicadSymbolIndexEntry["researchStatus"];
  correctionNote: string;
};

export type KicadSymbolSearchResult = {
  sourceVersion: string;
  catalogTotal: number;
  total: number;
  hasMore: boolean;
  libraries: string[];
  families: string[];
  results: KicadSymbolIndexEntry[];
};

export const KICAD_SYMBOL_FAMILIES = [
  "Passives",
  "Semiconductors",
  "Power & protection",
  "Connectors",
  "Analog & signal",
  "Digital & processors",
  "Sensors",
  "Control & timing",
  "Audio & display",
  "Communications & RF",
  "Other",
] as const;

const SOURCE_VERSION = "10.0.8";
const RAW_LIBRARY_BASE =
  `https://gitlab.com/kicad/libraries/kicad-symbols/-/raw/${SOURCE_VERSION}/`;
const INDEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data/kicad-symbol-index.json.gz",
);
const SOURCE_INDEX_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/kicad-symbol-index.json.gz",
);
const LIBRARY_RESOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "data/circuit-studio-library-resource.json.gz",
);
const SOURCE_LIBRARY_RESOURCE_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../data/circuit-studio-library-resource.json.gz",
);
const MAX_SOURCE_BYTES = 1_500_000;
const MAX_CACHED_SYMBOLS = 500;

let indexPromise: Promise<KicadSymbolIndexEntry[]> | undefined;
let libraryResourcePromise:
  | Promise<Map<string, KicadLibraryResourceEntry>>
  | undefined;
const symbolCache = new Map<string, KicadSymbolData>();

function normalized(value: string): string {
  return value.toLocaleLowerCase().replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function normalizedSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function compactSearchText(value: string): string {
  return normalizedSearchText(value).replace(/\s/g, "");
}

function getKicadSymbolFamily(entry: KicadSymbolIndexEntry): string {
  const library = entry.library.toLocaleLowerCase();
  const identity = normalizedSearchText(
    `${entry.name} ${entry.description} ${entry.keywords}`,
  );

  if (
    /^(?:battery|power|regulator|converter|transformer)/.test(library) ||
    library === "power"
  ) {
    return "Power & protection";
  }
  if (/^potentiometer_digital/.test(library)) return "Digital & processors";
  if (/^(?:connector|jumper|mechanical)/.test(library)) return "Connectors";
  if (/^(?:transistor|diode|led|triac|isolator|valve)/.test(library)) {
    return "Semiconductors";
  }
  if (/^sensor/.test(library) || /\bsensor\b/.test(identity)) return "Sensors";
  if (/^(?:amplifier|analog|comparator|filter|reference_current|reference_voltage)/.test(library)) {
    return "Analog & signal";
  }
  if (/^(?:mcu|cpu|dsp|cpld|fpga|logic|memory|gpu|buffer)/.test(library)) {
    return "Digital & processors";
  }
  if (/^(?:switch|relay|motor|timer|oscillator)/.test(library)) {
    return "Control & timing";
  }
  if (/^(?:audio|video|display)/.test(library)) return "Audio & display";
  if (/^(?:rf|interface|fiber)/.test(library)) return "Communications & RF";

  if (
    /\b(?:resistor|capacitor|inductor|fuse|potentiometer|thermistor|varistor)\b/.test(identity)
  ) {
    return "Passives";
  }
  if (/\b(?:diode|transistor|mosfet|led)\b/.test(identity)) return "Semiconductors";
  if (/\b(?:connector|plug|socket)\b/.test(identity)) return "Connectors";
  if (/\b(?:battery|regulator|power supply|power symbol)\b/.test(identity)) {
    return "Power & protection";
  }
  return "Other";
}

const SEARCH_SYNONYMS: Record<string, string[]> = {
  resistor: ["res", "resistance"],
  resistors: ["resistor", "res", "resistance"],
  res: ["resistor", "resistance"],
  capacitor: ["cap", "capacitance", "condenser"],
  capacitors: ["capacitor", "cap", "capacitance"],
  cap: ["capacitor", "capacitance"],
  inductor: ["coil", "choke"],
  diode: ["rectifier"],
  led: ["light emitting diode"],
  "light emitting diode": ["led"],
  transistor: ["bjt", "fet"],
  mosfet: ["fet", "field effect transistor"],
  "op amp": ["opamp", "operational amplifier"],
  opamp: ["op amp", "operational amplifier"],
  "operational amplifier": ["opamp", "op amp"],
  connector: ["plug", "socket"],
  microcontroller: ["mcu"],
  mcu: ["microcontroller"],
  ground: ["gnd"],
  gnd: ["ground"],
  battery: ["cell"],
  cell: ["battery"],
  "negative voltage": ["-10v", "power symbol"],
  "power symbol": ["power", "vcc", "vdd"],
  "light sensor": [
    "ambient light sensor",
    "photoresistor",
    "photodiode",
    "phototransistor",
  ],
  darkness: ["light sensor", "photoresistor", "light dependent resistor", "photocell"],
  photocell: ["photoresistor", "photodiode"],
  preamp: ["preamplifier", "microphone amplifier", "audio amplifier"],
  "microphone preamp": ["microphone preamplifier", "audio preamplifier"],
  alarm: ["buzzer", "speaker", "piezo", "oscillator"],
  siren: ["buzzer", "speaker", "oscillator"],
  flashlight: ["led", "battery", "switch", "lamp"],
  "fan control": ["fan controller", "motor", "mosfet", "pwm"],
  "fan controller": ["fan", "motor", "mosfet", "pwm"],
  fan: ["motor", "fan controller"],
  "water level": ["float switch", "level sensor"],
  "motion detector": ["pir sensor", "infrared sensor", "motion sensor"],
  "distance sensor": ["ultrasonic sensor", "range sensor", "proximity sensor"],
  wireless: ["bluetooth", "wifi", "rf transceiver", "radio"],
  "can bus": ["can transceiver", "controller area network"],
};

const SYMBOL_DISCOVERY_STOP_WORDS = new Set([
  "about",
  "also",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "build",
  "can",
  "circuit",
  "circuits",
  "choose",
  "could",
  "create",
  "design",
  "draw",
  "for",
  "from",
  "give",
  "help",
  "how",
  "i",
  "in",
  "into",
  "is",
  "it",
  "make",
  "me",
  "my",
  "of",
  "on",
  "or",
  "please",
  "schematic",
  "should",
  "show",
  "some",
  "symbol",
  "symbols",
  "that",
  "the",
  "this",
  "to",
  "use",
  "using",
  "want",
  "what",
  "when",
  "with",
  "would",
]);
const SEARCH_CORRECTION_WORDS = [
  "resistor",
  "capacitor",
  "inductor",
  "diode",
  "transistor",
  "mosfet",
  "connector",
  "microcontroller",
  "operational",
  "amplifier",
  "battery",
  "ground",
  "switch",
  "regulator",
  "oscillator",
];

const FEATURED_SYMBOL_IDS = [
  "Device:R",
  "Device:R_Small",
  "Device:C",
  "Device:C_Small",
  "Device:C_Polarized",
  "Device:L",
  "Device:L_Small",
  "Device:D",
  "Device:D_Small",
  "Device:D_Zener",
  "Device:D_Schottky",
  "Device:LED",
  "Device:LED_Small",
  "Device:Fuse",
  "Device:Battery",
  "Device:Speaker",
  "Device:Buzzer",
  "Transistor_BJT:Q_NPN_BCE",
  "Transistor_BJT:Q_PNP_BCE",
  "Transistor_BJT:2N3904",
  "Transistor_BJT:BC547",
  "Transistor_FET:Q_NMOS_GDS",
  "Transistor_FET:Q_PMOS_GDS",
  "power:GND",
  "power:+5V",
  "power:+3V3",
  "power:+12V",
  "power:VCC",
  "Switch:SW_SPST",
  "Switch:SW_Push",
  "Switch:SW_SPDT",
  "Timer:NE555P",
  "Amplifier_Operational:LM358",
  "Amplifier_Operational:LM741",
  "Regulator_Linear:LM7805_TO220",
  "Regulator_Linear:AMS1117-3.3",
  "Connector_Generic:Conn_01x01",
  "Connector_Generic:Conn_01x02",
  "Connector_Generic:Conn_01x03",
  "Connector_Generic:Conn_01x04",
  "Connector_Generic:Conn_01x05",
  "Connector_Generic:Conn_01x06",
  "Connector_Generic:Conn_01x08",
  "Connector_Generic:Conn_01x10",
];

function editDistanceWithin(left: string, right: string, maximum: number): boolean {
  if (Math.abs(left.length - right.length) > maximum) return false;
  let previous = Array.from({ length: right.length + 1 }, (_, index) => index);

  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    let rowMinimum = leftIndex;
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const cost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      const value = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + cost,
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return false;
    previous = current;
  }
  return previous[right.length] <= maximum;
}

type PreparedSearchQuery = {
  searchQuery: string;
  compactQuery: string;
  correctedQuery: string;
  compactCorrectedQuery: string;
  queryTokens: string[];
  phraseAlternatives: string[];
};

function prepareSearchQuery(query: string): PreparedSearchQuery {
  const searchQuery = normalizedSearchText(query);
  const compactQuery = compactSearchText(query);
  const queryTokens = searchQuery
    .split(" ")
    .filter((token) => token && !["a", "an", "and", "for", "in", "of", "the", "to", "with"].includes(token))
    .map((token) => {
      if (token.length < 4) return token;
      return SEARCH_CORRECTION_WORDS.find((candidate) =>
        editDistanceWithin(token, candidate, token.length >= 8 ? 2 : 1)
      ) ?? token;
    });
  const correctedQuery = queryTokens.join(" ");
  return {
    searchQuery,
    compactQuery,
    correctedQuery,
    compactCorrectedQuery: compactSearchText(correctedQuery),
    queryTokens,
    phraseAlternatives: SEARCH_SYNONYMS[searchQuery] ?? [],
  };
}

function getSearchScore(
  entry: KicadSymbolIndexEntry,
  query: PreparedSearchQuery,
  allowFuzzy = false,
): number {
  const {
    searchQuery,
    compactQuery,
    correctedQuery,
    compactCorrectedQuery,
    queryTokens,
    phraseAlternatives,
  } = query;
  if (!searchQuery) return 0;

  const fields = [
    entry.id,
    entry.name,
    entry.library,
    entry.description,
    entry.shortDescription,
    entry.longDescription,
    entry.keywords,
  ].map(normalizedSearchText);
  const searchableText = fields.join(" ");
  const compactId = compactSearchText(entry.id);
  const compactName = compactSearchText(entry.name);
  let score = 0;

  if (compactQuery && compactName === compactQuery) score += 10_000;
  if (compactQuery && compactId === compactQuery) score += 11_000;
  if (compactCorrectedQuery && compactName === compactCorrectedQuery) score += 8_000;
  if (compactCorrectedQuery && compactId === compactCorrectedQuery) score += 9_000;
  if (searchableText.includes(searchQuery) || searchableText.includes(correctedQuery)) {
    score += 2_000;
  }
  if (fields[1].startsWith(correctedQuery)) score += 1_500;
  if (fields[0].startsWith(correctedQuery)) score += 1_250;
  if (correctedQuery && fields[6].includes(correctedQuery)) score += 1_000;

  if (phraseAlternatives.some((alias) => searchableText.includes(normalizedSearchText(alias)))) {
    score += 1_000;
  }
  const searchableWords = searchableText.split(" ").filter(Boolean);
  const nameWords = fields.slice(0, 2).join(" ").split(" ").filter(Boolean);
  const keywordWords = fields[6].split(" ").filter(Boolean);
  const descriptionWords = fields.slice(3, 6).join(" ").split(" ").filter(Boolean);
  let matchedTokens = 0;
  for (const token of queryTokens) {
    const alternatives = [token, ...(SEARCH_SYNONYMS[token] ?? [])]
      .map(normalizedSearchText)
      .filter(Boolean);
    const matchesWord = (word: string, alternative: string) =>
      alternative.length <= 2
        ? word === alternative
        : word.length <= 2
        ? word === alternative
        : word.includes(alternative) || alternative.includes(word);
    const nameMatch = nameWords.some((word) =>
      alternatives.some((alternative) => matchesWord(word, alternative))
    );
    const keywordMatch = keywordWords.some((word) =>
      alternatives.some((alternative) => matchesWord(word, alternative))
    );
    const descriptionMatch = descriptionWords.some((word) =>
      alternatives.some((alternative) => matchesWord(word, alternative))
    );
    if (nameMatch || keywordMatch || descriptionMatch) {
      matchedTokens += 1;
      score += nameMatch ? 400 : keywordMatch ? 250 : 100;
      continue;
    }

    if (allowFuzzy && token.length >= 4) {
      const maximumDistance = token.length >= 8 ? 2 : 1;
      if (nameWords.some((word) => editDistanceWithin(token, word, maximumDistance))) {
        matchedTokens += 1;
        score += 180;
        continue;
      }
      if (keywordWords.some((word) => editDistanceWithin(token, word, maximumDistance))) {
        matchedTokens += 1;
        score += 140;
        continue;
      }
      if (descriptionWords.some((word) => editDistanceWithin(token, word, maximumDistance))) {
        matchedTokens += 1;
        score += 80;
        continue;
      }
      if (searchableWords.some((word) => editDistanceWithin(token, word, maximumDistance))) {
        matchedTokens += 1;
        score += 35;
      }
    }
  }

  if (queryTokens.length > 0 && matchedTokens === queryTokens.length) {
    score += 500 + matchedTokens * 120;
  } else {
    score += matchedTokens * 25;
  }
  if (score > 0) {
    const featuredPriority = FEATURED_SYMBOL_IDS.indexOf(entry.id);
    if (featuredPriority >= 0) score += 500 - featuredPriority;
  }
  return score;
}

function getFeaturedSymbols(
  index: KicadSymbolIndexEntry[],
  limit: number,
): KicadSymbolIndexEntry[] {
  const byId = new Map(index.map((entry) => [entry.id, entry]));
  const results: KicadSymbolIndexEntry[] = [];
  const included = new Set<string>();
  const add = (entry: KicadSymbolIndexEntry) => {
    if (included.has(entry.id) || results.length >= limit) return;
    included.add(entry.id);
    results.push(entry);
  };

  for (const id of FEATURED_SYMBOL_IDS) {
    const entry = byId.get(id);
    if (entry) add(entry);
  }

  const familyTargets = [
    ["Passives", 18],
    ["Semiconductors", 18],
    ["Power & protection", 12],
    ["Connectors", 16],
    ["Control & timing", 10],
    ["Analog & signal", 10],
    ["Digital & processors", 8],
    ["Sensors", 4],
    ["Audio & display", 2],
    ["Communications & RF", 2],
  ] as const;
  for (const [family, target] of familyTargets) {
    const currentCount = results.filter(
      (entry) => getKicadSymbolFamily(entry) === family,
    ).length;
    const remaining = index
      .filter(
        (entry) =>
          !included.has(entry.id) && getKicadSymbolFamily(entry) === family,
      )
      .sort((left, right) =>
        left.name.localeCompare(right.name) || left.id.localeCompare(right.id)
      );
    for (const entry of remaining.slice(0, Math.max(0, target - currentCount))) {
      add(entry);
      if (results.length >= limit) break;
    }
    if (results.length >= limit) break;
  }

  if (results.length < limit) {
    const remaining = index
      .filter((entry) => !included.has(entry.id))
      .sort((left, right) => left.name.localeCompare(right.name) || left.id.localeCompare(right.id));
    for (const entry of remaining) {
      add(entry);
      if (results.length >= limit) break;
    }
  }
  return results;
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

async function getLibraryResource(): Promise<
  Map<string, KicadLibraryResourceEntry>
> {
  libraryResourcePromise ??= readFile(LIBRARY_RESOURCE_PATH)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code !== "ENOENT") throw error;
      return readFile(SOURCE_LIBRARY_RESOURCE_PATH);
    })
    .then((buffer) => {
      const bundle = JSON.parse(gunzipSync(buffer).toString("utf8")) as {
        schemaVersion?: unknown;
        sourceVersion?: unknown;
        entries?: unknown;
      };
      if (
        bundle.schemaVersion !== 1 ||
        bundle.sourceVersion !== `KiCad ${SOURCE_VERSION}` ||
        !Array.isArray(bundle.entries)
      ) {
        throw new Error("The Circuit Studio library resource is invalid.");
      }

      const entries = bundle.entries as KicadLibraryResourceEntry[];
      const byId = new Map<string, KicadLibraryResourceEntry>();
      for (const entry of entries) {
        if (
          !entry ||
          typeof entry.catalogId !== "string" ||
          !entry.catalogId.includes(":") ||
          typeof entry.shortDescription !== "string" ||
          !entry.shortDescription.trim() ||
          typeof entry.longDescription !== "string" ||
          !entry.longDescription.trim() ||
          !Array.isArray(entry.keywords) ||
          entry.keywords.some((keyword) => typeof keyword !== "string") ||
          !["catalog_reference", "corrected", "needs_review"].includes(
            entry.researchStatus,
          ) ||
          byId.has(entry.catalogId)
        ) {
          throw new Error("The Circuit Studio library resource contains an invalid entry.");
        }
        byId.set(entry.catalogId, entry);
      }
      if (byId.size !== 22_911) {
        throw new Error("The Circuit Studio library resource is incomplete.");
      }
      return byId;
    })
    .catch((error) => {
      libraryResourcePromise = undefined;
      throw error;
    });
  return libraryResourcePromise;
}

async function getIndex(): Promise<KicadSymbolIndexEntry[]> {
  indexPromise ??= readFile(INDEX_PATH).catch((error: NodeJS.ErrnoException) => {
    if (error.code !== "ENOENT") throw error;
    return readFile(SOURCE_INDEX_PATH);
  }).then(async (buffer) => {
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

    const describedEntries = entries.map((entry) => {
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
    const resourceById = await getLibraryResource();
    if (describedEntries.length !== resourceById.size) {
      throw new Error("The symbol index and its descriptions have different catalog sizes.");
    }
    return describedEntries.map((entry) => {
      const resource = resourceById.get(entry.id);
      if (!resource) {
        throw new Error(`The library resource is missing ${entry.id}.`);
      }
      return {
        ...entry,
        shortDescription: resource.shortDescription,
        longDescription: resource.longDescription,
        keywords: resource.keywords.join(", "),
        researchStatus: resource.researchStatus,
      };
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

export async function findMentionedKicadSymbolIds(
  text: string,
  maxResults = 6,
): Promise<string[]> {
  const tokens = [...new Set(
    text.match(/\b(?=[a-z0-9._/-]*[a-z])(?=[a-z0-9._/-]*\d)[a-z0-9]+(?:[._/-][a-z0-9]+)*\b/gi) ?? [],
  )].filter((token) => token.length >= 3);
  if (!tokens.length) return [];

  const index = await getIndex();
  const ids = new Set<string>();
  for (const token of tokens) {
    const searchToken = normalized(token);
    const match = index.find((entry) =>
      normalized(entry.name) === searchToken ||
      normalized(entry.id.slice(entry.id.indexOf(":") + 1)) === searchToken
    );
    if (match) ids.add(match.id);
    if (ids.size >= Math.max(1, maxResults)) break;
  }
  return [...ids];
}

export async function searchKicadSymbols(
  query: string,
  library: string,
  requestedLimit: number,
  requestedOffset = 0,
  family = "",
  featured = false,
): Promise<KicadSymbolSearchResult> {
  const index = await getIndex();
  const libraries = [...new Set(index.map((entry) => entry.library))]
    .sort((left, right) => left.localeCompare(right));
  const limit = Math.max(1, Math.min(100, Math.floor(requestedLimit) || 100));
  const offset = Math.max(0, Math.floor(requestedOffset) || 0);
  const searchQuery = prepareSearchQuery(query);
  const normalizedQuery = searchQuery.searchQuery;
  const normalizedLibrary = normalized(library);
  const availableFamilies = [...KICAD_SYMBOL_FAMILIES];

  const libraryMatches = (entry: KicadSymbolIndexEntry) =>
    !normalizedLibrary ||
    normalized(entry.library).includes(normalizedLibrary);
  const familyMatches = (entry: KicadSymbolIndexEntry) =>
    !family || getKicadSymbolFamily(entry) === family;
  const candidates = (featured ? getFeaturedSymbols(index, 100) : index).filter(
    (entry) => libraryMatches(entry) && familyMatches(entry),
  );
  let matches = candidates
    .map((entry) => ({ entry, score: getSearchScore(entry, searchQuery) }))
    .filter(({ score }) => !normalizedQuery || score > 0);
  if (normalizedQuery && matches.length === 0) {
    matches = candidates
      .map((entry) => ({ entry, score: getSearchScore(entry, searchQuery, true) }))
      .filter(({ score }) => score > 0);
  }

  if (normalizedQuery) {
    matches.sort((left, right) =>
      right.score - left.score || left.entry.id.localeCompare(right.entry.id)
    );
  } else if (!featured) {
    matches.sort((left, right) => {
      if (family) {
        const leftIndex = FEATURED_SYMBOL_IDS.indexOf(left.entry.id);
        const rightIndex = FEATURED_SYMBOL_IDS.indexOf(right.entry.id);
        const leftRank = leftIndex < 0 ? Number.MAX_SAFE_INTEGER : leftIndex;
        const rightRank = rightIndex < 0 ? Number.MAX_SAFE_INTEGER : rightIndex;
        if (leftRank !== rightRank) return leftRank - rightRank;
      }
      return left.entry.name.localeCompare(right.entry.name) ||
        left.entry.id.localeCompare(right.entry.id);
    });
  }
  const matchedEntries = matches.map(({ entry }) => entry);

  return {
    sourceVersion: SOURCE_VERSION,
    catalogTotal: index.length,
    total: matchedEntries.length,
    hasMore: offset + limit < matchedEntries.length,
    libraries,
    families: availableFamilies,
    results: matchedEntries.slice(offset, offset + limit),
  };
}

function prepareSymbolDiscoveryQueries(
  queryTexts: string[],
): Array<{ query: PreparedSearchQuery; weight: number }> {
  const prepared: Array<{ query: PreparedSearchQuery; weight: number }> = [];
  const seen = new Set<string>();

  for (const [textIndex, text] of queryTexts.slice(0, 8).entries()) {
    const normalizedText = normalizedSearchText(text);
    const phraseQueries = Object.keys(SEARCH_SYNONYMS).filter(
      (phrase) => phrase.includes(" ") && normalizedText.includes(phrase),
    );
    const tokens = [...new Set(
      normalizedText
        .split(" ")
        .filter((token) =>
          token.length > 1 && !SYMBOL_DISCOVERY_STOP_WORDS.has(token)
        ),
    )].slice(0, 18);
    if (!tokens.length && !phraseQueries.length) continue;

    const candidates = [
      ...phraseQueries,
      ...(tokens.length ? [tokens.join(" ")] : []),
      ...Array.from({ length: Math.min(tokens.length - 1, 4) }, (_, index) =>
        tokens.slice(index, index + 2).join(" ")
      ),
      ...tokens.filter((token) => token.length >= 3),
    ];
    const sourceWeight = textIndex === 0 ? 1.6 : textIndex === 1 ? 1.3 : 1;
    for (const candidate of candidates) {
      if (seen.has(candidate)) continue;
      seen.add(candidate);
      const query = prepareSearchQuery(candidate);
      if (query.queryTokens.length) prepared.push({ query, weight: sourceWeight });
      if (prepared.length >= 16) return prepared;
    }
  }
  return prepared;
}

/**
 * Finds candidates against the complete KiCad index, using each piece of the
 * current request separately so a long conversation does not become an
 * all-words-must-match search.
 */
export async function findRelevantKicadSymbols(
  queryTexts: string[],
  requestedLimit = 12,
): Promise<KicadSymbolIndexEntry[]> {
  const queries = prepareSymbolDiscoveryQueries(queryTexts);
  if (!queries.length) return [];

  const index = await getIndex();
  const limit = Math.max(1, Math.min(20, Math.floor(requestedLimit) || 12));
  const ranked: Array<{ entry: KicadSymbolIndexEntry; score: number }> = [];

  for (const entry of index) {
    let bestScore = 0;
    let supportingQueries = 0;
    for (const { query, weight } of queries) {
      const score = getSearchScore(entry, query);
      if (score <= 0) continue;
      const weightedScore = score * weight;
      bestScore = Math.max(bestScore, weightedScore);
      supportingQueries += 1;
    }
    if (bestScore > 0) {
      ranked.push({
        entry,
        score: bestScore + Math.max(0, supportingQueries - 1) * 35,
      });
    }
  }

  const sorted = ranked
    .sort((left, right) =>
      right.score - left.score || left.entry.id.localeCompare(right.entry.id)
    );
  const selected: KicadSymbolIndexEntry[] = [];
  const deferred: KicadSymbolIndexEntry[] = [];
  const countsByLibrary = new Map<string, number>();
  for (const { entry } of sorted) {
    const libraryCount = countsByLibrary.get(entry.library) ?? 0;
    if (libraryCount >= 2) {
      deferred.push(entry);
      continue;
    }
    selected.push(entry);
    countsByLibrary.set(entry.library, libraryCount + 1);
    if (selected.length >= limit) break;
  }
  if (selected.length < limit) {
    selected.push(...deferred.slice(0, limit - selected.length));
  }
  return selected;
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
    `Catalog detail: ${entry.longDescription}`,
    entry.researchStatus === "needs_review"
      ? "Description status: needs review; do not treat the proposed purpose as verified."
      : "Description status: KiCad catalog reference; it is not a datasheet or electrical validation.",
    ...unitText,
  ].join("\n");
}

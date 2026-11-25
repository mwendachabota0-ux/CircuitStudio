import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const workspaceRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);
const catalogPath = path.join(
  workspaceRoot,
  "generated-artifacts/circuit-studio-symbol-catalog-for-research.txt",
);
const reportPath = path.join(
  workspaceRoot,
  "docs/libraryResources/circuit-studio-symbol-enrichment.jsonl",
);
const outputPath = path.join(
  workspaceRoot,
  "artifacts/api-server/data/circuit-studio-library-resource.json.gz",
);
const studioJavaScriptPath = path.join(
  workspaceRoot,
  "lib/circuit-geometry/src/generatedStudioLibraryResource.js",
);
const studioDeclarationPath = path.join(
  workspaceRoot,
  "lib/circuit-geometry/src/generatedStudioLibraryResource.d.ts",
);
const expectedCounts = {
  studio: 50,
  "studio-engine": 1,
  kicad: 22_911,
  total: 22_962,
};
// Prevent the legacy research snapshot from restoring bridge-specific copy.
const studioResourceOverrides = {
  crossing: {
    shortDescription: "Marks crossing wires that remain electrically separate.",
    longDescription:
      "Circuit Studio built-in non-connecting wire-crossing annotation (0-pin) from the Drawing category. It records an intersection without changing connectivity. The wires render as uninterrupted strokes with no bridge or dot; only an explicit junction connects them. The app does not simulate electrical behavior or validate circuit correctness.",
    keywords: ["wire crossing", "crossing", "separate wires", "no connection"],
  },
};

function parseCatalog(text) {
  const startMarker = "CATALOG_TSV_BEGIN\n";
  const endMarker = "\nCATALOG_TSV_END";
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start);
  if (start < 0 || end < 0) throw new Error("Catalog table markers are missing.");

  const [headerLine, ...lines] = text
    .slice(start + startMarker.length, end)
    .split("\n");
  const headers = headerLine.split("\t");
  const rows = new Map();
  for (const [rowIndex, line] of lines.entries()) {
    const cells = line.split("\t");
    if (cells.length !== headers.length) {
      throw new Error(`Catalog row ${rowIndex + 1} has an invalid column count.`);
    }
    const record = Object.fromEntries(
      headers.map((header, index) => [header, JSON.parse(cells[index])]),
    );
    const key = `${record.source}\u0000${record.catalog_id}`;
    if (rows.has(key)) throw new Error(`Duplicate catalog key: ${record.source}:${record.catalog_id}`);
    rows.set(key, record);
  }
  return rows;
}

function uniqueWords(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const word = typeof value === "string" ? value.trim() : "";
    if (!word) continue;
    const key = word.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(word);
  }
  return result;
}

function sourceKeywordTokens(value) {
  return typeof value === "string"
    ? value.split(/[\s,;|]+/).map((token) => token.trim()).filter(Boolean)
    : [];
}

function cleanShortDescription(item, catalogRow, stats) {
  const recommendation = item.recommendedShortDescription;
  const original = catalogRow.current_short_description;
  if (typeof recommendation !== "string" || !recommendation.trim()) {
    throw new Error(`Short description is missing for ${item.source}:${item.catalogId}.`);
  }
  if (recommendation === original) return recommendation;

  const wasNotReportedAsChanged =
    !Array.isArray(item.changedFields) ||
    !item.changedFields.includes("short_description");
  const isEscapingCorruption =
    recommendation.includes("\\") &&
    typeof original === "string" &&
    !original.includes("\\");
  if (wasNotReportedAsChanged && isEscapingCorruption) {
    stats.restoredShortDescriptions += 1;
    return original;
  }

  throw new Error(
    `Unexpected short-description change for ${item.source}:${item.catalogId}; review it before building the resource.`,
  );
}

function cleanLongDescription(item, catalogRow, stats) {
  const recommendation = item.recommendedLongDescription;
  if (typeof recommendation !== "string" || !recommendation.trim()) {
    throw new Error(`Long description is missing for ${item.source}:${item.catalogId}.`);
  }
  if (!recommendation.includes("None-pin")) return recommendation;
  if (catalogRow.pin_count !== null) {
    throw new Error(`A known pin count was labeled None-pin for ${item.catalogId}.`);
  }

  stats.fixedUnknownPinDescriptions += 1;
  const replacement = item.source === "studio"
    ? "variable-pin symbol block"
    : "symbol whose pin count is not recorded in the compact catalog index";
  return recommendation.replaceAll("None-pin symbol drawing", replacement);
}

function researchStatus(status) {
  if (status === "needs_review") return "needs_review";
  if (status === "corrected") return "corrected";
  if (status === "verified") return "catalog_reference";
  throw new Error(`Unsupported research status: ${status}`);
}

function parseReport(text, catalogRows) {
  const stats = {
    rows: 0,
    bySource: {},
    byStatus: {},
    restoredShortDescriptions: 0,
    fixedKeywordRows: 0,
    removedSingleCharacterFragments: 0,
    fixedUnknownPinDescriptions: 0,
  };
  const kicadEntries = [];
  const studioEntries = {};
  const seen = new Set();

  for (const [lineIndex, line] of text.split(/\r?\n/).entries()) {
    if (!line.trim()) continue;
    let item;
    try {
      item = JSON.parse(line);
    } catch {
      throw new Error(`Research JSONL line ${lineIndex + 1} is invalid JSON.`);
    }

    const key = `${item.source}\u0000${item.catalogId}`;
    const catalogRow = catalogRows.get(key);
    if (!catalogRow) throw new Error(`Research row has no matching catalog entry: ${key}`);
    if (seen.has(key)) throw new Error(`Duplicate research row: ${key}`);
    seen.add(key);
    stats.rows += 1;
    stats.bySource[item.source] = (stats.bySource[item.source] ?? 0) + 1;
    stats.byStatus[item.status] = (stats.byStatus[item.status] ?? 0) + 1;

    if (item.source === "studio-engine") continue;
    const shortDescription = cleanShortDescription(item, catalogRow, stats);
    const longDescription = cleanLongDescription(item, catalogRow, stats);
    if (!Array.isArray(item.recommendedKeywords)) {
      throw new Error(`Keywords are not an array for ${item.source}:${item.catalogId}.`);
    }

    const oneCharacterFragments = item.recommendedKeywords.filter(
      (word) => typeof word === "string" && word.trim().length === 1,
    );
    if (oneCharacterFragments.length) {
      stats.removedSingleCharacterFragments += oneCharacterFragments.length;
    }
    const keywordList = uniqueWords([
      ...sourceKeywordTokens(catalogRow.keywords),
      ...item.recommendedKeywords.filter(
        (word) => typeof word === "string" && word.trim().length > 1,
      ),
      catalogRow.symbol_name,
    ]);
    if (oneCharacterFragments.length) stats.fixedKeywordRows += 1;
    if (!keywordList.length) {
      throw new Error(`No usable keywords or symbol name for ${item.source}:${item.catalogId}.`);
    }

    const cleaned = {
      shortDescription,
      longDescription,
      keywords: keywordList,
      researchStatus: researchStatus(item.status),
      correctionNote: typeof item.correctionNote === "string"
        ? item.correctionNote
        : "",
      ...(item.source === "studio"
        ? studioResourceOverrides[item.catalogId] ?? {}
        : {}),
    };

    if (item.source === "studio") {
      if (Object.hasOwn(studioEntries, item.catalogId)) {
        throw new Error(`Duplicate Studio resource key: ${item.catalogId}`);
      }
      const { correctionNote: _correctionNote, ...studioEntry } = cleaned;
      studioEntries[item.catalogId] = studioEntry;
    } else if (item.source === "kicad") {
      kicadEntries.push({ catalogId: item.catalogId, ...cleaned });
    } else {
      throw new Error(`Unexpected resource source: ${item.source}`);
    }
  }

  if (seen.size !== expectedCounts.total) {
    throw new Error(`Expected ${expectedCounts.total} report rows, found ${seen.size}.`);
  }
  for (const [source, count] of Object.entries(expectedCounts)) {
    if (source === "total") continue;
    if (stats.bySource[source] !== count) {
      throw new Error(`Expected ${count} ${source} rows, found ${stats.bySource[source] ?? 0}.`);
    }
  }
  if (stats.byStatus.needs_review !== 332) {
    throw new Error(`Expected 332 needs_review rows; found ${stats.byStatus.needs_review ?? 0}.`);
  }
  if (stats.restoredShortDescriptions !== 421) {
    throw new Error(`Expected to restore 421 escaped short descriptions; restored ${stats.restoredShortDescriptions}.`);
  }

  return { kicadEntries, studioEntries, stats };
}

const [catalogText, reportText] = await Promise.all([
  readFile(catalogPath, "utf8"),
  readFile(reportPath, "utf8"),
]);
const catalogRows = parseCatalog(catalogText);
const { kicadEntries, studioEntries, stats } = parseReport(reportText, catalogRows);

const bundle = {
  schemaVersion: 1,
  sourceVersion: "KiCad 10.0.8",
  attribution: "KiCad Libraries Team, KiCad symbol libraries v10.0.8, CC BY-SA 4.0 with KiCad schematic-design exception.",
  entries: kicadEntries,
};
const compressed = gzipSync(Buffer.from(JSON.stringify(bundle)), { level: 9 });
await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(outputPath, compressed);

const studioJavaScript = [
  "/* Generated by pnpm --filter @workspace/scripts run build:library-resource. */",
  `export const STUDIO_LIBRARY_RESEARCH = ${JSON.stringify(studioEntries, null, 2)};`,
  "",
].join("\n");
const studioDeclaration = [
  "export type StudioLibraryResearchStatus = 'catalog_reference' | 'needs_review' | 'corrected';",
  "export type StudioLibraryResearchEntry = {",
  "  shortDescription: string;",
  "  longDescription: string;",
  "  keywords: string[];",
  "  researchStatus: StudioLibraryResearchStatus;",
  "};",
  "export const STUDIO_LIBRARY_RESEARCH: Record<string, StudioLibraryResearchEntry>;",
  "",
].join("\n");
await Promise.all([
  writeFile(studioJavaScriptPath, studioJavaScript, "utf8"),
  writeFile(studioDeclarationPath, studioDeclaration, "utf8"),
]);

const missingPinDescriptions = kicadEntries.filter((entry) =>
  entry.longDescription.includes("None-pin"),
).length;
if (missingPinDescriptions) {
  throw new Error(`${missingPinDescriptions} KiCad descriptions still say None-pin.`);
}

console.log(JSON.stringify({
  ...stats,
  builtKicadRows: kicadEntries.length,
  builtStudioRows: Object.keys(studioEntries).length,
  compressedBytes: compressed.byteLength,
  outputPath: path.relative(workspaceRoot, outputPath),
  studioJavaScriptPath: path.relative(workspaceRoot, studioJavaScriptPath),
  studioDeclarationPath: path.relative(workspaceRoot, studioDeclarationPath),
}, null, 2));

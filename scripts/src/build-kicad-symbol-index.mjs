import { gzipSync } from "node:zlib";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourceArg = process.argv.at(-1);
if (!sourceArg) {
  throw new Error(
    "Usage: pnpm --filter @workspace/scripts run build:kicad-symbol-index -- <unpacked-kicad-symbols-directory>",
  );
}

const sourceRoot = path.resolve(sourceArg);
const workspaceRoot = path.resolve(import.meta.dirname, "../..");
const destinations = [
  path.join(workspaceRoot, "artifacts/api-server/data/kicad-symbol-index.json.gz"),
  path.join(workspaceRoot, "artifacts/circuit-studio/public/kicad-symbol-index.json.gz"),
];

const stringPattern = String.raw`"((?:\\.|[^"\\])*)"`;
const symbolPattern = new RegExp(String.raw`\(symbol\s+${stringPattern}`, "s");
const descriptionPattern = new RegExp(
  String.raw`\(property\s+"Description"\s+${stringPattern}`,
  "s",
);
const keywordsPattern = new RegExp(
  String.raw`\(property\s+"ki_keywords"\s+${stringPattern}`,
  "s",
);
const extendsPattern = new RegExp(String.raw`\(extends\s+${stringPattern}`, "s");
const pinNumberPattern = new RegExp(
  String.raw`\(number\s+${stringPattern}`,
  "gs",
);

function unescapeString(value) {
  return value
    .replace(/\\n/g, "\n")
    .replace(/\\r/g, "\r")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"')
    .replace(/\\\\/g, "\\");
}

function capture(pattern, text) {
  const match = pattern.exec(text);
  pattern.lastIndex = 0;
  return match ? unescapeString(match[1]) : undefined;
}

async function walk(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return walk(fullPath);
      return entry.isFile() && entry.name.endsWith(".kicad_sym")
        ? [fullPath]
        : [];
    }),
  );
  return nested.flat();
}

const files = await walk(sourceRoot);
const symbols = [];

for (const filePath of files) {
  const text = await readFile(filePath, "utf8");
  const name = capture(symbolPattern, text);
  if (!name) continue;

  const library = path.basename(path.dirname(filePath)).replace(/\.kicad_symdir$/, "");
  const numbers = new Set(
    Array.from(text.matchAll(pinNumberPattern), (match) => unescapeString(match[1])),
  );
  const extendsName = capture(extendsPattern, text);
  const entry = {
    id: `${library}:${name}`,
    library,
    name,
    description: capture(descriptionPattern, text) ?? "",
    keywords: capture(keywordsPattern, text) ?? "",
    pinCount: extendsName ? null : numbers.size,
  };
  if (extendsName) entry.extends = extendsName;
  symbols.push(entry);
}

symbols.sort((left, right) => left.id.localeCompare(right.id));
const compressed = gzipSync(Buffer.from(JSON.stringify(symbols)), { level: 9 });

for (const destination of destinations) {
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, compressed);
}

console.info(
  `Indexed ${symbols.length} KiCad symbols (${compressed.byteLength} compressed bytes).`,
);

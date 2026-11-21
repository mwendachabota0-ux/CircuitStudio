const CONTEXTUAL_KICAD_SYMBOLS: Array<{
  pattern: RegExp;
  ids: string[];
}> = [
  { pattern: /\bNE555P?\b/i, ids: ["Timer:NE555P"] },
  { pattern: /\bLM555(?:xN)?\b/i, ids: ["Timer:LM555xN"] },
  { pattern: /\bTLC555(?:xP)?\b/i, ids: ["Timer:TLC555xP"] },
  { pattern: /\bLM358\b/i, ids: ["Amplifier_Operational:LM358"] },
  {
    pattern: /\b(?:LM7805|L7805|uA7805|7805)\b/i,
    ids: ["Regulator_Linear:LM7805_TO220"],
  },
  {
    pattern: /\b(?:5\s?volts?|5\s?v)\b/i,
    ids: ["power:+5V"],
  },
  {
    pattern: /\b(?:3\.?3\s?volts?|3v3)\b/i,
    ids: ["power:+3V3"],
  },
];

export function getDefaultKicadSymbolIds(context: string): string[] {
  const ids = new Set<string>();

  for (const rule of CONTEXTUAL_KICAD_SYMBOLS) {
    if (!rule.pattern.test(context)) continue;
    for (const id of rule.ids) ids.add(id);
  }

  return [...ids].slice(0, 12);
}

const EXACT_PART_IDENTIFIER =
  /\b(?:[a-z]{2,8}[-/]?\d{2,6}[a-z0-9-]*|\d{2,3}[a-z]{2,4}\d{1,4}[a-z0-9-]*)\b/i;
const GENERIC_555_REQUEST = /\b(?:ne\s?555|555\s+(?:timer|ic))\b/i;

export function shouldSearchKicadLibrary(input: {
  context: string;
  hasStudioMatch: boolean;
  hasExplicitKicadId?: boolean;
  hasExistingKicadSymbol?: boolean;
}): boolean {
  if (
    !input.hasStudioMatch ||
    input.hasExplicitKicadId ||
    input.hasExistingKicadSymbol ||
    getDefaultKicadSymbolIds(input.context).length > 0
  ) {
    return true;
  }

  return (
    EXACT_PART_IDENTIFIER.test(input.context) ||
    GENERIC_555_REQUEST.test(input.context)
  );
}

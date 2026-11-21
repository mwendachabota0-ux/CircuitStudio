const BASE_KICAD_SYMBOLS = [
  "Device:R",
  "Device:C",
  "Device:LED",
  "power:GND",
];

const CONTEXTUAL_KICAD_SYMBOLS: Array<{
  pattern: RegExp;
  ids: string[];
}> = [
  { pattern: /\b(?:diode|rectifier|schottky|zener)\b/i, ids: ["Device:D"] },
  {
    pattern: /\b(?:electrolytic|polarized|polarised)\b/i,
    ids: ["Device:C_Polarized"],
  },
  {
    pattern: /\b(?:transistor|npn|bjt|astable|multivibrator|flasher)\b/i,
    ids: ["Transistor_BJT:Q_NPN_BCE"],
  },
  { pattern: /\bpnp\b/i, ids: ["Transistor_BJT:Q_PNP_BCE"] },
  {
    pattern: /\b(?:mosfet|nmos|n-channel)\b/i,
    ids: ["Transistor_FET:Q_NMOS_GDS"],
  },
  {
    pattern: /\b(?:pmos|p-channel)\b/i,
    ids: ["Transistor_FET:Q_PMOS_GDS"],
  },
  { pattern: /\b(?:battery|cell)\b/i, ids: ["Device:Battery"] },
  { pattern: /\bNE555P?\b/i, ids: ["Timer:NE555P"] },
  { pattern: /\bLM555(?:xN)?\b/i, ids: ["Timer:LM555xN"] },
  { pattern: /\bTLC555(?:xP)?\b/i, ids: ["Timer:TLC555xP"] },
  { pattern: /\bLM358\b/i, ids: ["Amplifier_Operational:LM358"] },
  {
    pattern: /\b(?:LM7805|L7805|uA7805|7805)\b/i,
    ids: ["Regulator_Linear:LM7805_TO220"],
  },
  { pattern: /\bfuse\b/i, ids: ["Device:Fuse"] },
  { pattern: /\bpush.?button\b/i, ids: ["Switch:SW_Push"] },
  { pattern: /\b(?:switch|spst)\b/i, ids: ["Switch:SW_SPST"] },
  {
    pattern: /\b(?:connector|plug|socket)\b/i,
    ids: ["Connector_Generic:Conn_01x02"],
  },
  { pattern: /\bspeaker\b/i, ids: ["Device:Speaker"] },
  { pattern: /\bbuzzer\b/i, ids: ["Device:Buzzer"] },
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
  const ids = new Set(BASE_KICAD_SYMBOLS);

  for (const rule of CONTEXTUAL_KICAD_SYMBOLS) {
    if (!rule.pattern.test(context)) continue;
    for (const id of rule.ids) ids.add(id);
  }

  return [...ids].slice(0, 12);
}

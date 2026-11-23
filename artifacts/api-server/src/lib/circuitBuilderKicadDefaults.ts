const CONTEXTUAL_KICAD_SYMBOLS: Array<{
  pattern: RegExp;
  ids: string[];
}> = [
  { pattern: /\bNE555P?\b/i, ids: ["Timer:NE555P"] },
  { pattern: /\bLM555(?:xN)?\b/i, ids: ["Timer:LM555xN"] },
  { pattern: /\bTLC555(?:xP)?\b/i, ids: ["Timer:TLC555xP"] },
  { pattern: /\bLM358\b/i, ids: ["Amplifier_Operational:LM358"] },
  { pattern: /\b2N3904\b/i, ids: ["Transistor_BJT:2N3904"] },
  { pattern: /\bBC547\b/i, ids: ["Transistor_BJT:BC547"] },
  {
    pattern: /\b(?:electrolytic|polarized)\s+(?:capacitor|cap)\b|\b(?:capacitor|cap)\s+(?:electrolytic|polarized)\b/i,
    ids: ["Device:C_Polarized"],
  },
  { pattern: /\b(?:trim(?:mer)?\s+)?potentiometer\b|\bvariable resistor\b/i, ids: ["Device:R_Potentiometer"] },
  { pattern: /\btrimmer\b|\btrim potentiometer\b/i, ids: ["Device:R_Potentiometer_Trim"] },
  { pattern: /\b(?:resistor|resistors)\b/i, ids: ["Device:R"] },
  { pattern: /\b(?:capacitor|capacitors|cap)\b/i, ids: ["Device:C"] },
  { pattern: /\b(?:inductor|inductors|coil)\b/i, ids: ["Device:L"] },
  { pattern: /\bcrystal\b/i, ids: ["Device:Crystal"] },
  { pattern: /\bzener\b/i, ids: ["Device:D_Zener"] },
  { pattern: /\bschottky\b/i, ids: ["Device:D_Schottky"] },
  { pattern: /\bphotoresistor\b|\blight[- ]dependent resistor\b|\bldr\b/i, ids: ["Device:R_Photo"] },
  { pattern: /\bphotodiode\b/i, ids: ["Device:D_Photo"] },
  { pattern: /\bdiode(?:s)?\b/i, ids: ["Device:D"] },
  { pattern: /\b(?:led|light emitting diode)\b/i, ids: ["Device:LED"] },
  { pattern: /\bnpn\b/i, ids: ["Transistor_BJT:Q_NPN_BCE"] },
  { pattern: /\bpnp\b/i, ids: ["Transistor_BJT:Q_PNP_BCE"] },
  {
    pattern: /\b(?:nmosfet|nmos|n-channel|n channel)\s*(?:mosfet|fet)?\b/i,
    ids: ["Transistor_FET:Q_NMOS_GDS"],
  },
  {
    pattern: /\b(?:pmosfet|pmos|p-channel|p channel)\s*(?:mosfet|fet)?\b/i,
    ids: ["Transistor_FET:Q_PMOS_GDS"],
  },
  { pattern: /\bfuse(?:s)?\b/i, ids: ["Device:Fuse"] },
  { pattern: /\bbatter(?:y|ies)\b/i, ids: ["Device:Battery"] },
  { pattern: /\bcondenser microphone\b/i, ids: ["Device:Microphone_Condenser"] },
  { pattern: /\bmicrophones?\b/i, ids: ["Device:Microphone"] },
  { pattern: /\bspeaker(?:s)?\b/i, ids: ["Device:Speaker"] },
  { pattern: /\bbuzzer(?:s)?\b/i, ids: ["Device:Buzzer"] },
  { pattern: /\bdc motor\b|\bmotor dc\b/i, ids: ["Motor:Motor_DC"] },
  { pattern: /\bac motor\b|\bmotor ac\b/i, ids: ["Motor:Motor_AC"] },
  { pattern: /\bantenna\b/i, ids: ["Device:Antenna"] },
  { pattern: /\b(?:push|tactile)\s+button\b/i, ids: ["Switch:SW_Push"] },
  { pattern: /\bspdt\b/i, ids: ["Switch:SW_SPDT"] },
  { pattern: /\b(?:spst|on\/off switch|switch(?:es)?)\b/i, ids: ["Switch:SW_SPST"] },
  { pattern: /\bground\b|\bgnd\b/i, ids: ["power:GND"] },
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

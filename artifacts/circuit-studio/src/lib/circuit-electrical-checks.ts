export type NetlistPart = {
  designator: string;
  type: string;
  value?: string;
};

export type NetlistNet = {
  name: string;
  pins: string[];
};

export type NetlistResult = {
  parts: NetlistPart[];
  nets: NetlistNet[];
};

export type IntentNet = string[];

export type ElectricalFinding = {
  code: string;
  severity: 'error' | 'warning';
  message: string;
};

type CanonicalNets = {
  groups: Map<string, string[]>;
  pinToNet: Map<string, NetlistNet>;
};

const canonicalizeNets = (
  nets: NetlistNet[],
  designators: Set<string>,
): CanonicalNets => {
  const groups = new Map<string, string[]>();
  const pinToNet = new Map<string, NetlistNet>();

  for (const net of nets) {
    const pins = [...new Set(net.pins.filter((pin) => {
      const separator = pin.lastIndexOf('.');
      return separator > 0 && designators.has(pin.slice(0, separator));
    }))].sort();
    for (const pin of pins) pinToNet.set(pin, net);
    if (pins.length < 2) continue;
    groups.set(pins.join('|'), pins);
  }

  return { groups, pinToNet };
};

const splitPin = (pin: string): { designator: string; pinName: string } | null => {
  const separator = pin.lastIndexOf('.');
  if (separator <= 0 || separator === pin.length - 1) return null;
  return {
    designator: pin.slice(0, separator),
    pinName: pin.slice(separator + 1),
  };
};

export function checkIntent(
  netlist: NetlistResult,
  intent: IntentNet[],
): ElectricalFinding[] {
  const designators = new Set(netlist.parts.map((part) => part.designator));
  const actual = canonicalizeNets(netlist.nets, designators);
  const intended = new Map<string, string[]>();
  const findings: ElectricalFinding[] = [];

  for (const group of intent) {
    const knownPins: string[] = [];
    for (const pin of group) {
      const parsed = splitPin(pin);
      if (!parsed) {
        findings.push({
          code: 'INTENT_INVALID_PIN',
          severity: 'error',
          message: `Intent pin "${pin}" is not a DESIGNATOR.PIN reference. Use the exact reference designator and pin name.`,
        });
        continue;
      }
      if (!designators.has(parsed.designator)) {
        findings.push({
          code: 'INTENT_UNKNOWN_PART',
          severity: 'error',
          message: `Intent mentions ${parsed.designator}, but no part ${parsed.designator} is drawn. Add that part or correct the intended connection.`,
        });
        continue;
      }
      knownPins.push(pin);
    }

    const pins = [...new Set(knownPins)].sort();
    if (pins.length >= 2) intended.set(pins.join('|'), pins);
  }

  const missingGroups = [...intended.entries()]
    .filter(([key]) => !actual.groups.has(key))
    .map(([, pins]) => pins);
  const extraGroups = [...actual.groups.entries()]
    .filter(([key]) => !intended.has(key))
    .map(([, pins]) => pins);

  for (const pins of missingGroups) {
    const actualByNet = new Map<string, { name: string; pins: string[] }>();
    for (const pin of pins) {
      const net = actual.pinToNet.get(pin);
      const pinGroup = actualByNet.get(net?.name ?? 'unconnected') ?? {
        name: net?.name ?? 'unconnected',
        pins: [],
      };
      pinGroup.pins.push(pin);
      actualByNet.set(net?.name ?? 'unconnected', pinGroup);
    }
    const actualDescription = [...actualByNet.values()]
      .map((group) => group.name === 'unconnected'
        ? `${group.pins.join(' + ')} is not connected to a drawn net`
        : `the drawing connects ${group.pins.join(' + ')} on net ${group.name}`)
      .join('; ');
    findings.push({
      code: 'INTENT_CONNECTION_MISSING',
      severity: 'error',
      message: `Intended connection ${pins.join(' + ')} is missing: ${actualDescription}. Connect these exact pins together and keep unrelated pins separate.`,
    });
  }

  for (const pins of extraGroups) {
    const net = actual.pinToNet.get(pins[0]);
    findings.push({
      code: 'INTENT_UNEXPECTED_CONNECTION',
      severity: 'error',
      message: `Drawing connects ${pins.join(' + ')}${net ? ` on net ${net.name}` : ''}, but the intended design does not. Separate this pin group or add it to the stated intent if that connection is deliberate.`,
    });
  }

  return findings.slice(0, 12);
}

function hasType(part: NetlistPart, ...needles: string[]): boolean {
  const type = part.type.toLowerCase();
  return needles.some((needle) => type.includes(needle));
}

function getTwoTerminalPins(part: NetlistPart): [string, string] | null {
  if (hasType(part, 'led', 'diode', 'zener')) return ['A', 'K'];
  if (hasType(part, 'battery', 'electrolytic')) return ['+', '-'];
  if (hasType(
    part,
    'resistor',
    'capacitor',
    'inductor',
    'photoresistor',
    'switch',
    'lamp',
    'speaker',
    'microphone',
    'crystal',
  )) return ['1', '2'];
  return null;
}

function findNet(netlist: NetlistResult, pin: string): NetlistNet | undefined {
  return netlist.nets.find((net) => net.pins.includes(pin));
}

function isDefiniteRail(net: NetlistNet | undefined): boolean {
  return net?.name === 'GND' || net?.name === 'VCC';
}

export function checkElectricalRules(netlist: NetlistResult): ElectricalFinding[] {
  const findings: ElectricalFinding[] = [];
  const partsByDesignator = new Map(netlist.parts.map((part) => [part.designator, part]));
  const partCount = netlist.parts.length;

  for (const net of netlist.nets) {
    const pinsByPart = new Map<string, string[]>();
    for (const pin of net.pins) {
      const parsed = splitPin(pin);
      if (!parsed) continue;
      const pins = pinsByPart.get(parsed.designator) ?? [];
      pins.push(parsed.pinName);
      pinsByPart.set(parsed.designator, pins);
    }

    for (const [designator, pins] of pinsByPart) {
      const part = partsByDesignator.get(designator);
      if (!part) continue;
      const uniquePins = [...new Set(pins)];
      if (uniquePins.length < 2) continue;

      if (hasType(part, 'npn', 'pnp')) {
        const transistorPins = uniquePins.filter((pin) =>
          pin === 'B' || pin === 'C' || pin === 'E',
        );
        if (transistorPins.length >= 2) {
          findings.push({
            code: 'BJT_PINS_SHORTED',
            severity: 'error',
            message: `${designator}: pins ${transistorPins.join(' and ')} are on the same net (${net.name}). Separate the transistor pins and route each to its intended connection.`,
          });
        }
        continue;
      }

      const terminals = getTwoTerminalPins(part);
      if (terminals && terminals.every((pin) => uniquePins.includes(pin))) {
        findings.push({
          code: 'PART_SHORTED',
          severity: 'error',
          message: `${designator}: both terminals (${terminals.join(' and ')}) are on net ${net.name}, so the part is bypassed. Separate its terminals and connect them through the part.`,
        });
      }
    }
  }

  for (const part of netlist.parts) {
    if (hasType(part, 'npn', 'pnp')) {
      const basePin = `${part.designator}.B`;
      const baseNet = findNet(netlist, basePin);
      if (baseNet?.name === 'GND' || baseNet?.name === 'VCC') {
        findings.push({
          code: 'BJT_BASE_ON_RAIL',
          severity: 'error',
          message: `${part.designator}: base (B) is directly on net ${baseNet.name}. Route the base through a base resistor or divider so it is not hard-wired to that rail.`,
        });
      }
      if (baseNet?.pins.length === 1) {
        findings.push({
          code: 'FLOATING_BJT_BASE',
          severity: 'warning',
          message: `${part.designator}: base (B) is alone on net ${baseNet.name}. Connect it to the intended control or bias network, usually through a resistor.`,
        });
      }
    }

    if (hasType(part, 'led')) {
      const anodeNet = findNet(netlist, `${part.designator}.A`);
      const cathodeNet = findNet(netlist, `${part.designator}.K`);
      const hasSeriesResistor = [anodeNet, cathodeNet].some((net) =>
        !!net &&
        !isDefiniteRail(net) &&
        net.pins.some((pin) => {
          const parsed = splitPin(pin);
          const connectedPart = parsed
            ? partsByDesignator.get(parsed.designator)
            : undefined;
          return !!connectedPart &&
            hasType(connectedPart, 'resistor') &&
            !hasType(connectedPart, 'photoresistor');
        }),
      );
      if (!hasSeriesResistor) {
        findings.push({
          code: 'LED_NO_SERIES_RESISTOR',
          severity: 'warning',
          message: `${part.designator}: no series resistor pin is on either non-rail LED net. Add a current-limiting resistor in series with the LED and check its value for the stated supply.`,
        });
      }
    }

    if (hasType(part, 'op-amp', 'opamp')) {
      for (const pinName of ['INV', 'NONINV']) {
        const inputNet = findNet(netlist, `${part.designator}.${pinName}`);
        if (inputNet?.pins.length === 1) {
          findings.push({
            code: 'OPAMP_INPUT_FLOATING',
            severity: 'warning',
            message: `${part.designator}: input ${pinName} is alone on net ${inputNet.name}. Connect it to the intended signal or feedback network.`,
          });
        }
      }
    }
  }

  if (partCount > 0 && !netlist.nets.some((net) => net.name === 'GND')) {
    findings.push({
      code: 'NO_GROUND',
      severity: 'warning',
      message: 'No net is named GND. Add or label the circuit return as GND if that is the intended reference.',
    });
  }

  return findings;
}

export function runElectricalChecks(
  netlist: NetlistResult,
  intent?: IntentNet[],
): {
  errors: string[];
  warnings: string[];
  findings: ElectricalFinding[];
} {
  const hasCheckableIntent = intent?.some((net) => new Set(net).size >= 2) === true;
  const findings = [
    ...(hasCheckableIntent && intent ? checkIntent(netlist, intent) : []),
    ...checkElectricalRules(netlist),
  ];
  const uniqueFindings = findings.filter((finding, index) =>
    findings.findIndex((other) =>
      other.code === finding.code && other.message === finding.message,
    ) === index,
  );
  return {
    errors: uniqueFindings
      .filter((finding) => finding.severity === 'error')
      .map((finding) => finding.message),
    warnings: uniqueFindings
      .filter((finding) => finding.severity === 'warning')
      .map((finding) => finding.message),
    findings: uniqueFindings,
  };
}

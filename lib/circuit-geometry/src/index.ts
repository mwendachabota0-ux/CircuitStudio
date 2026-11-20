export type CircuitPoint = [number, number];
export type CircuitPin = { name: string; point: CircuitPoint };
export type CircuitElementGeometry = {
  type?: unknown;
  from?: unknown;
  to?: unknown;
  at?: unknown;
  flip?: unknown;
  swap?: unknown;
};

const TWO_TERMINAL_PIN_NAMES = {
  resistor: ['1', '2'],
  capacitor: ['1', '2'],
  electrolytic: ['+', '-'],
  inductor: ['1', '2'],
  diode: ['A', 'K'],
  zener: ['A', 'K'],
  led: ['A', 'K'],
  battery: ['+', '-'],
  switch: ['1', '2'],
  mic: ['1', '2'],
  speaker: ['1', '2'],
  lamp: ['1', '2'],
  acsource: ['1', '2'],
  crystal: ['1', '2'],
} as const satisfies Record<string, readonly [string, string]>;

const TRANSISTOR_PIN_OFFSETS = {
  npn: {
    B: [-25, 0],
    C: [25, -44],
    E: [25, 44],
  },
  pnp: {
    B: [-25, 0],
    E: [25, -44],
    C: [25, 44],
  },
} as const;

const SINGLE_PIN_TYPES = new Set(['ground', 'antenna', 'terminal']);

export type CircuitComponentReferenceEntry = {
  type: string;
  requiredProperties: readonly string[];
  optionalProperties: readonly string[];
  pinCount: number | null;
  pinNames: string;
  pinPositions: string;
  connectionRules: string;
  validation: string;
  autoFix: string;
  minimumTerminalDistance?: number;
};

const COMMON_PART_OPTIONAL_PROPERTIES = [
  'id',
  'label',
  'value',
  'labelPos',
  'labelNudge',
  'labelAt',
  'labelAnchor',
] as const;

/**
 * The compatibility contract shared by CircuitDraw, AI prompts, and server
 * input validation. Keep this list aligned with the renderer's actual symbols.
 */
export const CIRCUIT_COMPONENT_REFERENCE = [
  { type: 'resistor', requiredProperties: ['from', 'to'], optionalProperties: [...COMMON_PART_OPTIONAL_PROPERTIES, 'style'], pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 50 },
  { type: 'capacitor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 12 },
  { type: 'electrolytic', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 12 },
  { type: 'inductor', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 64 },
  { type: 'diode', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'zener', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'led', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: 'A, K', pinPositions: 'A (anode) is exactly at from; K (cathode) is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated; electrical behavior is not simulated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 20 },
  { type: 'battery', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '+, -', pinPositions: '+ is exactly at from; - is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; polarity follows endpoint order.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 10 },
  { type: 'switch', requiredProperties: ['from', 'to'], optionalProperties: [...COMMON_PART_OPTIONAL_PROPERTIES, 'closed'], pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to; closed controls the drawn blade only.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 36 },
  { type: 'mic', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 36 },
  { type: 'speaker', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 24 },
  { type: 'lamp', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 28 },
  { type: 'acsource', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 32 },
  { type: 'crystal', requiredProperties: ['from', 'to'], optionalProperties: COMMON_PART_OPTIONAL_PROPERTIES, pinCount: 2, pinNames: '1, 2', pinPositions: 'Pin 1 is exactly at from; pin 2 is exactly at to.', connectionRules: 'Connect wire endpoints exactly to from/to.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.', minimumTerminalDistance: 18 },
  { type: 'npn', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'circle', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'B, C, E', pinPositions: 'B=(x-25,y), C=(x+25,y-44), E=(x+25,y+44); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated pin coordinates.', validation: 'Rendered and structurally validated; no general transistor electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'pnp', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'flip', 'circle', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'B, E, C', pinPositions: 'B=(x-25,y), E=(x+25,y-44), C=(x+25,y+44); flip:true mirrors x offsets.', connectionRules: 'Wire endpoints must land on the calculated pin coordinates.', validation: 'Rendered and structurally validated; no general transistor electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'opamp', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'swap', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 3, pinNames: 'INV, NONINV, OUT', pinPositions: 'INV=(x-40,y-20), NONINV=(x-40,y+20), OUT=(x+40,y); swap:true exchanges input y offsets.', connectionRules: 'Generic three-pin symbol only; no IC supply pins are modeled.', validation: 'Rendered and structurally validated; no amplifier electrical simulation.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'ground', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'antenna', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'height', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at; height changes the drawn mast, not the pin.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'terminal', requiredProperties: ['at'], optionalProperties: ['id', 'label', 'value', 'labelPos', 'labelNudge', 'labelAt', 'labelAnchor'], pinCount: 1, pinNames: 'at', pinPositions: 'The only pin is exactly at at.', connectionRules: 'Connect a wire endpoint or a wire segment to at.', validation: 'Rendered and structurally validated.', autoFix: 'May snap a unique wire endpoint within 8 px; may trim an eligible dangling power/ground rail tail.' },
  { type: 'wire', requiredProperties: ['points'], optionalProperties: ['id', 'label', 'open'], pinCount: null, pinNames: 'Not a component; endpoints are points[0] and points[last].', pinPositions: 'Every points entry is a route coordinate.', connectionRules: 'Use two or more points; route orthogonally; endpoints connect exactly. Crossings alone do not connect; use a junction for an explicit crossing connection. Set open:true only for an intentionally open wire.', validation: 'Rendered and structurally validated; disconnected endpoints and component overlaps are blocking errors.', autoFix: 'Only unique endpoint snaps within 8 px and limited eligible rail-tail trimming.' },
  { type: 'junction', requiredProperties: ['x', 'y'], optionalProperties: ['id', 'label'], pinCount: 1, pinNames: 'junction', pinPositions: 'The junction is at (x,y).', connectionRules: 'Place exactly on the wire intersection or wire endpoint that should connect.', validation: 'Rendered and structurally validated.', autoFix: 'No junction relocation or topology repair.' },
  { type: 'label', requiredProperties: ['at', 'text'], optionalProperties: ['id', 'anchor', 'size', 'bold', 'muted'], pinCount: 0, pinNames: 'None.', pinPositions: 'Not an electrical connection.', connectionRules: 'Text annotation only; it does not connect nets.', validation: 'Rendered and structurally validated.', autoFix: 'No label repair.' },
  { type: 'box', requiredProperties: ['x', 'y', 'w', 'h'], optionalProperties: ['id', 'label', 'value'], pinCount: 0, pinNames: 'None.', pinPositions: 'Not an electrical connection.', connectionRules: 'Drawing annotation only; it does not connect nets.', validation: 'Rendered and structurally validated.', autoFix: 'No box repair.' },
] as const satisfies readonly CircuitComponentReferenceEntry[];

export type SupportedCircuitElementType =
  (typeof CIRCUIT_COMPONENT_REFERENCE)[number]['type'];

export const CIRCUIT_SUPPORTED_ELEMENT_TYPES = CIRCUIT_COMPONENT_REFERENCE.map(
  ({ type }) => type,
) as SupportedCircuitElementType[];

export function getCircuitComponentReference(
  type: unknown,
): (typeof CIRCUIT_COMPONENT_REFERENCE)[number] | undefined {
  if (typeof type !== 'string') return undefined;
  return CIRCUIT_COMPONENT_REFERENCE.find((entry) => entry.type === type);
}

export function getCircuitElementSchemaError(element: unknown): string | null {
  if (!element || typeof element !== 'object' || Array.isArray(element)) {
    return 'Circuit element must be an object.';
  }
  const record = element as Record<string, unknown>;
  const reference = getCircuitComponentReference(record.type);
  if (!reference) {
    return `Unsupported circuit element type: ${String(record.type)}`;
  }
  const missingProperties = reference.requiredProperties.filter(
    (property) => !Object.hasOwn(record, property),
  );
  if (missingProperties.length > 0) {
    return `${reference.type} element is missing required properties: ${missingProperties.join(', ')}.`;
  }
  return null;
}

export function isSupportedCircuitElementType(
  value: unknown,
): value is SupportedCircuitElementType {
  return typeof value === 'string' &&
    CIRCUIT_SUPPORTED_ELEMENT_TYPES.includes(value as SupportedCircuitElementType);
}

function isPoint(value: unknown): value is CircuitPoint {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

function copyPoint(point: CircuitPoint): CircuitPoint {
  return [point[0], point[1]];
}

function coordinateOffset(value: number, axis: 'x' | 'y'): string {
  if (value === 0) return axis;
  return `${axis}${value > 0 ? '+' : '−'}${Math.abs(value)}`;
}

function formatOffset([x, y]: readonly [number, number]): string {
  return `(${coordinateOffset(x, 'x')}, ${coordinateOffset(y, 'y')})`;
}

export function getCircuitPins(element: CircuitElementGeometry): CircuitPin[] {
  const type = typeof element.type === 'string' ? element.type : '';
  const twoTerminalNames =
    TWO_TERMINAL_PIN_NAMES[type as keyof typeof TWO_TERMINAL_PIN_NAMES];

  if (twoTerminalNames && isPoint(element.from) && isPoint(element.to)) {
    return [
      { name: twoTerminalNames[0], point: copyPoint(element.from) },
      { name: twoTerminalNames[1], point: copyPoint(element.to) },
    ];
  }

  if ((type === 'npn' || type === 'pnp') && isPoint(element.at)) {
    const [x, y] = element.at;
    const mirrored = element.flip === true ? -1 : 1;
    return Object.entries(TRANSISTOR_PIN_OFFSETS[type]).map(([name, [dx, dy]]) => ({
      name,
      point: [x + dx * mirrored, y + dy],
    }));
  }

  if (type === 'opamp' && isPoint(element.at)) {
    const [x, y] = element.at;
    const inputTop = element.swap === true ? 20 : -20;
    const inputBottom = -inputTop;
    return [
      { name: 'INV', point: [x - 40, y + inputTop] },
      { name: 'NONINV', point: [x - 40, y + inputBottom] },
      { name: 'OUT', point: [x + 40, y] },
    ];
  }

  if (SINGLE_PIN_TYPES.has(type) && isPoint(element.at)) {
    return [{ name: 'at', point: copyPoint(element.at) }];
  }

  return [];
}

export function formatCircuitPinGuide(): string {
  const lines = [
    'Two-terminal pin locations:',
    ...Object.entries(TWO_TERMINAL_PIN_NAMES).map(
      ([type, [first, second]]) =>
        `${type}: ${first} is exactly at from; ${second} is exactly at to.`,
    ),
  ];

  for (const type of ['npn', 'pnp'] as const) {
    const offsets = TRANSISTOR_PIN_OFFSETS[type];
    const pins = Object.entries(offsets)
      .map(([name, offset]) => `${name}=${formatOffset(offset)}`)
      .join(', ');
    lines.push(
      `${type.toUpperCase()}: ${pins}; flip:true mirrors all x offsets.`,
    );
  }

  lines.push(
    `opamp: INV=${formatOffset([-40, -20])}, NONINV=${formatOffset([-40, 20])}, OUT=${formatOffset([40, 0])}; swap:true exchanges the two input y offsets.`,
    'ground, antenna, terminal: the pin is exactly at the element at coordinate.',
  );

  return lines.join('\n');
}

export function formatCircuitComponentGuide(): string {
  const componentLines = CIRCUIT_COMPONENT_REFERENCE.map((entry) => {
    const optional =
      entry.optionalProperties.length > 0
        ? entry.optionalProperties.join(', ')
        : 'none';
    const pinCount =
      entry.pinCount === null ? 'n/a' : String(entry.pinCount);
    const minimumDistance =
      'minimumTerminalDistance' in entry
        ? ` Minimum endpoint distance: ${entry.minimumTerminalDistance} px.`
        : '';
    return `- ${entry.type}: required ${entry.requiredProperties.join(', ')}; optional ${optional}; pin count ${pinCount}; pins ${entry.pinNames}; positions ${entry.pinPositions} Connection rule: ${entry.connectionRules} ${entry.validation} Auto-fix: ${entry.autoFix}${minimumDistance}`;
  });

  return [
    'Use only these exact CircuitDraw element type identifiers and schemas:',
    ...componentLines,
    'General pin offsets:',
    formatCircuitPinGuide(),
  ].join('\n');
}

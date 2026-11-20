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

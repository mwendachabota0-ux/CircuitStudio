import {
  getCircuitPins,
  transformKicadPoint,
  type CircuitElementGeometry,
  type CircuitPoint,
  type KicadSymbolData,
  type KicadSymbolGraphic,
  type KicadSymbolPin,
  type KicadSymbolUnit,
} from './index.ts';

export type CircuitGeometryBounds = {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
};

export type CircuitGeometryPinIdentity = {
  id: string;
  name: string;
  number?: string;
  unit?: number;
  bodyStyle?: number;
  occurrence?: number;
  electricalType?: string;
};

export type ResolvedCircuitPin = CircuitGeometryPinIdentity & {
  point: CircuitPoint;
  bodyPoint?: CircuitPoint;
};

export type CircuitGeometryTextBound = {
  role: 'reference' | 'value' | 'pin-name' | 'pin-number' | 'symbol-text';
  text: string;
  bounds: CircuitGeometryBounds;
  confidence: 'render-aligned' | 'conservative-estimate';
};

/**
 * Keys that must not be independently overridden from placement.properties.
 * Their authority is either the component's catalog/source data or the
 * placement's explicit transform/legacyGeometry fields.
 */
export const CIRCUIT_GEOMETRY_COMPATIBILITY_PROPERTY_KEYS = [
  'from',
  'to',
  'at',
  'rotation',
  'flip',
  'symbolId',
  'symbolData',
  'unit',
  'bodyStyle',
  'pins',
  'swap',
  'height',
  'circle',
] as const;

export type CircuitGeometryResolution =
  | {
      status: 'resolved';
      source: 'catalog' | 'kicad-source';
      pins: ResolvedCircuitPin[];
      bodyBounds: CircuitGeometryBounds;
      textBounds: CircuitGeometryTextBound[];
      transform: {
        origin?: CircuitPoint;
        rotation: number;
        flipX: boolean;
      };
    }
  | {
      status: 'unsupported';
      code:
        | 'component-type-unsupported'
        | 'pin-geometry-unavailable'
        | 'body-geometry-unavailable'
        | 'text-geometry-unavailable';
      message: string;
    };

type GeometryElement = CircuitElementGeometry & {
  label?: unknown;
  value?: unknown;
  labelAt?: unknown;
  labelPos?: unknown;
  labelNudge?: unknown;
  labelAnchor?: unknown;
  circle?: unknown;
  height?: unknown;
  pins?: unknown;
};

const TWO_TERMINAL_BODY_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  resistor: [-25, -10, 25, 10],
  capacitor: [-6, -14, 6, 14],
  electrolytic: [-16, -14, 9, 14],
  inductor: [-32, -8, 32, 8],
  diode: [-10, -10, 10, 10],
  zener: [-10, -14, 14, 14],
  led: [-10, -24, 15, 10],
  battery: [-15, -14, 5, 14],
  switch: [-18, -16, 18, 3],
  mic: [-18, -18, 18, 18],
  speaker: [-8, -18, 16, 18],
  lamp: [-14, -14, 14, 14],
  acsource: [-16, -16, 16, 16],
  crystal: [-9, -13, 9, 13],
  fuse: [-18, -9, 18, 9],
  thermistor: [-25, -15, 25, 15],
  photoresistor: [-31, -27, 25, 20],
  varistor: [-25, -17, 25, 17],
  photodiode: [-24, -29, 10, 10],
  schottky: [-10, -10, 15, 10],
  dcsource: [-21, -21, 21, 21],
  currentsource: [-21, -21, 21, 21],
  motor: [-22, -22, 22, 22],
  buzzer: [-33, -22, 33, 22],
  solarcell: [-24, -27, 22, 15],
};

const MULTI_BODY_BOUNDS: Record<string, readonly [number, number, number, number]> = {
  npn: [-44, -44, 44, 44],
  pnp: [-44, -44, 44, 44],
  opamp: [-40, -40, 40, 40],
  comparator: [-40, -40, 40, 40],
  potentiometer: [-20, -52, 20, 10],
  nmos: [-20, -40, 20, 40],
  pmos: [-20, -40, 20, 40],
  mosfet: [-20, -40, 20, 40],
  njfet: [-20, -40, 20, 40],
  pjfet: [-20, -40, 20, 40],
  regulator: [-28, -22, 28, 22],
  transformer: [-31, -43, 31, 43],
  relay: [-36, -30, 55, 30],
  bridge: [-30, -30, 30, 30],
  opto: [-34, -30, 34, 30],
};

const failure = (
  code: Extract<CircuitGeometryResolution, { status: 'unsupported' }>['code'],
  message: string,
): CircuitGeometryResolution => ({ status: 'unsupported', code, message });

function isPoint(value: unknown): value is CircuitPoint {
  return Array.isArray(value) &&
    value.length === 2 &&
    typeof value[0] === 'number' &&
    Number.isFinite(value[0]) &&
    typeof value[1] === 'number' &&
    Number.isFinite(value[1]);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function copyPoint(point: CircuitPoint): CircuitPoint {
  return [point[0], point[1]];
}

function boundsFromPoints(
  points: readonly CircuitPoint[],
  padding = 0,
): CircuitGeometryBounds | null {
  const finitePoints = points.filter(isPoint);
  if (finitePoints.length === 0) return null;
  return {
    x0: Math.min(...finitePoints.map(([x]) => x)) - padding,
    y0: Math.min(...finitePoints.map(([, y]) => y)) - padding,
    x1: Math.max(...finitePoints.map(([x]) => x)) + padding,
    y1: Math.max(...finitePoints.map(([, y]) => y)) + padding,
  };
}

function boundsCorners(bounds: CircuitGeometryBounds): CircuitPoint[] {
  return [
    [bounds.x0, bounds.y0],
    [bounds.x0, bounds.y1],
    [bounds.x1, bounds.y0],
    [bounds.x1, bounds.y1],
  ];
}

function unionBounds(
  first: CircuitGeometryBounds,
  second: CircuitGeometryBounds,
): CircuitGeometryBounds {
  return {
    x0: Math.min(first.x0, second.x0),
    y0: Math.min(first.y0, second.y0),
    x1: Math.max(first.x1, second.x1),
    y1: Math.max(first.y1, second.y1),
  };
}

function selectedKicadUnit(element: GeometryElement): KicadSymbolUnit | null {
  const symbolData = element.symbolData as KicadSymbolData | undefined;
  const unitNumber = Number.isInteger(element.unit) ? element.unit as number : 1;
  const bodyStyle = Number.isInteger(element.bodyStyle) ? element.bodyStyle as number : 1;
  return symbolData?.units.find(
    (unit) => unit.unit === unitNumber && unit.bodyStyle === bodyStyle,
  ) ?? null;
}

export function getCircuitPinIdentities(
  input: CircuitElementGeometry,
): CircuitGeometryPinIdentity[] | null {
  const element = input as GeometryElement;
  const pins = getCircuitPins(element);
  if (pins.length === 0) return null;
  if (element.type !== 'kicad') {
    return pins.map((pin) => ({ id: pin.name, name: pin.name }));
  }

  const unit = selectedKicadUnit(element);
  if (!unit || unit.pins.length !== pins.length) return null;
  const occurrences = new Map<string, number>();
  return unit.pins.map((pin, index) => {
    const identity = `${pin.number}\u0000${pin.name}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const token = (value: string) => encodeURIComponent(value || '_');
    return {
      id: `kicad:u${unit.unit}:b${unit.bodyStyle}:${token(pin.number)}:${token(pin.name)}:${occurrence}`,
      name: pins[index].name,
      number: pin.number,
      unit: unit.unit,
      bodyStyle: unit.bodyStyle,
      occurrence,
      electricalType: pin.electricalType,
    };
  });
}

function transformBounds(
  localBounds: CircuitGeometryBounds,
  element: GeometryElement,
): CircuitPoint[] | null {
  if (!isPoint(element.at)) return null;
  const origin = element.at;
  return boundsCorners(localBounds).map(([x, y]) => [
    origin[0] + x * (element.flip === true ? -1 : 1),
    origin[1] + y,
  ]);
}

function twoTerminalBodyBounds(
  type: string,
  pins: ResolvedCircuitPin[],
): CircuitGeometryBounds | null {
  const local = TWO_TERMINAL_BODY_BOUNDS[type];
  if (!local || pins.length < 2) return null;
  const [a, b] = [pins[0].point, pins[1].point];
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const angle = Math.atan2(dy, dx);
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const midpointDistance = Math.sqrt(dx * dx + dy * dy) / 2;
  const localCorners: CircuitPoint[] = [
    [local[0], local[1]],
    [local[0], local[3]],
    [local[2], local[1]],
    [local[2], local[3]],
  ];
  return boundsFromPoints(localCorners.map(([x, y]) => {
    const localX = midpointDistance + x;
    return [
      a[0] + localX * cos - y * sin,
      a[1] + localX * sin + y * cos,
    ];
  }));
}

function builtInBodyBounds(
  element: GeometryElement,
  type: string,
): CircuitGeometryBounds | null {
  if (!isPoint(element.at)) return null;
  let local: readonly [number, number, number, number] | undefined =
    MULTI_BODY_BOUNDS[type];
  if (type === 'ground') local = [-12, 0, 12, 20];
  if (type === 'antenna') {
    const height = typeof element.height === 'number' && Number.isFinite(element.height)
      ? element.height
      : 55;
    local = [-12, Math.min(-height, 0), 12, Math.max(-height, 0)];
  }
  if (type === 'terminal') local = [-4, -4, 4, 4];
  if ((type === 'npn' || type === 'pnp') && element.circle === false) {
    local = [-25, -30, 25, 30];
  }

  if (local) {
    return boundsFromPoints(transformBounds({
      x0: local[0],
      y0: local[1],
      x1: local[2],
      y1: local[3],
    }, element) ?? []);
  }

  if (type === 'ic' || type === 'connector') {
    if (!Array.isArray(element.pins)) return null;
    const leftCount = element.pins.filter(
      (pin) => isRecord(pin) && pin.side === 'left',
    ).length;
    const rightCount = element.pins.filter(
      (pin) => isRecord(pin) && pin.side === 'right',
    ).length;
    const height = Math.max(48, Math.max(leftCount, rightCount) * 24 + 16);
    return {
      x0: element.at[0] - 44,
      y0: element.at[1] - height / 2,
      x1: element.at[0] + 44,
      y1: element.at[1] + height / 2,
    };
  }

  return null;
}

function circumcircleBounds(points: readonly CircuitPoint[]): CircuitGeometryBounds | null {
  if (points.length < 3) return null;
  const [a, b, c] = points;
  const determinant = 2 * (
    a[0] * (b[1] - c[1]) +
    b[0] * (c[1] - a[1]) +
    c[0] * (a[1] - b[1])
  );
  if (Math.abs(determinant) < 0.000001) return null;
  const a2 = a[0] * a[0] + a[1] * a[1];
  const b2 = b[0] * b[0] + b[1] * b[1];
  const c2 = c[0] * c[0] + c[1] * c[1];
  const centerX = (
    a2 * (b[1] - c[1]) +
    b2 * (c[1] - a[1]) +
    c2 * (a[1] - b[1])
  ) / determinant;
  const centerY = (
    a2 * (c[0] - b[0]) +
    b2 * (a[0] - c[0]) +
    c2 * (b[0] - a[0])
  ) / determinant;
  const radius = Math.hypot(a[0] - centerX, a[1] - centerY);
  if (![centerX, centerY, radius].every(Number.isFinite)) return null;
  return {
    x0: centerX - radius,
    y0: centerY - radius,
    x1: centerX + radius,
    y1: centerY + radius,
  };
}

function rectangleForText(
  text: string,
  point: CircuitPoint,
  anchor: 'start' | 'middle' | 'end',
  size: number,
  bold = false,
): CircuitGeometryBounds {
  const width = text.length * size * (bold ? 0.62 : 0.56);
  const x0 = anchor === 'middle'
    ? point[0] - width / 2
    : anchor === 'end'
      ? point[0] - width
      : point[0];
  return { x0, y0: point[1] - size, x1: x0 + width, y1: point[1] + 4 };
}

function transformLocalBounds(
  bounds: CircuitGeometryBounds,
  origin: CircuitPoint,
  rotation: number,
  flipX: boolean,
): CircuitGeometryBounds | null {
  const points = boundsCorners(bounds).map((point) =>
    transformKicadPoint(point, origin, rotation, flipX)
  );
  return boundsFromPoints(points);
}

function kicadBodyBounds(
  element: GeometryElement,
  unit: KicadSymbolUnit,
): CircuitGeometryBounds | null {
  if (!isPoint(element.at)) return null;
  const rotation = typeof element.rotation === 'number' ? element.rotation : 0;
  const flip = element.flip === true;
  const points: CircuitPoint[] = [];
  let padding = 4;
  for (const graphic of unit.graphics ?? []) {
    const sourcePoints = (graphic.points ?? []).filter(isPoint);
    if (typeof graphic.strokeWidth === 'number' && Number.isFinite(graphic.strokeWidth)) {
      padding = Math.max(padding, Math.abs(graphic.strokeWidth) / 2 + 1);
    }
    if (graphic.type === 'circle' && sourcePoints.length > 0 &&
      typeof graphic.radius === 'number' && Number.isFinite(graphic.radius)) {
      const center = sourcePoints[0];
      const radius = Math.abs(graphic.radius);
      points.push(
        [center[0] - radius, center[1] - radius],
        [center[0] + radius, center[1] + radius],
      );
      continue;
    }
    if (graphic.type === 'arc') {
      const circle = circumcircleBounds(sourcePoints);
      if (circle) points.push(...boundsCorners(circle));
      else points.push(...sourcePoints);
      continue;
    }
    // Bézier control points contain the curve in their convex hull. Polyline
    // and rectangle points directly bound their drawn paths.
    points.push(...sourcePoints);
  }

  if (points.length === 0) {
    unit.pins.forEach((pin) => {
      if (isPoint(pin.bodyPoint)) points.push(copyPoint(pin.bodyPoint));
    });
  }
  const localBounds = boundsFromPoints(points, padding);
  return localBounds
    ? transformLocalBounds(localBounds, element.at, rotation, flip)
    : null;
}

function kicadTextBounds(
  element: GeometryElement,
  unit: KicadSymbolUnit,
): CircuitGeometryTextBound[] | null {
  if (!isPoint(element.at)) return null;
  const rotation = typeof element.rotation === 'number' ? element.rotation : 0;
  const flip = element.flip === true;
  const result: CircuitGeometryTextBound[] = [];
  for (const graphic of unit.graphics ?? []) {
    if (graphic.type !== 'text' || typeof graphic.text !== 'string') continue;
    const point = graphic.points?.[0];
    if (!isPoint(point)) return null;
    const size = typeof graphic.fontSize === 'number' &&
      Number.isFinite(graphic.fontSize) && graphic.fontSize > 0
      ? graphic.fontSize
      : 12;
    const local = rectangleForText(graphic.text, [0, 0], 'middle', size);
    const centered: CircuitGeometryBounds = {
      ...local,
      x0: local.x0 + point[0],
      x1: local.x1 + point[0],
      y0: local.y0 + point[1],
      y1: local.y1 + point[1],
    };
    const bounds = transformLocalBounds(centered, element.at, rotation, flip);
    if (!bounds) return null;
    result.push({
      role: 'symbol-text',
      text: graphic.text,
      bounds,
      confidence: 'conservative-estimate',
    });
  }

  const textPins: Array<{
    pin: KicadSymbolPin;
    role: 'pin-name' | 'pin-number';
    text: string;
    point: CircuitPoint;
    anchor: 'start' | 'middle' | 'end';
    size: number;
  }> = [];
  for (const pin of unit.pins) {
    if (!isPoint(pin.point)) continue;
    if ((pin.showName || pin.showNumber) && !isPoint(pin.bodyPoint)) return null;
    if (!isPoint(pin.bodyPoint)) continue;
    const worldPoint = transformKicadPoint(pin.point, element.at, rotation, flip);
    const worldBodyPoint = transformKicadPoint(pin.bodyPoint, element.at, rotation, flip);
    const dx = worldPoint[0] - worldBodyPoint[0];
    const dy = worldPoint[1] - worldBodyPoint[1];
    const length = Math.hypot(dx, dy) || 1;
    const ux = dx / length;
    const uy = dy / length;
    if (pin.showNumber && pin.number) {
      textPins.push({
        pin,
        role: 'pin-number',
        text: pin.number,
        point: [worldPoint[0] - ux * 8, worldPoint[1] - uy * 8],
        anchor: 'middle',
        size: 8,
      });
    }
    if (pin.showName && pin.name) {
      textPins.push({
        pin,
        role: 'pin-name',
        text: pin.name,
        point: [worldBodyPoint[0] + ux * 5, worldBodyPoint[1] + uy * 5],
        anchor: ux < -0.15 ? 'end' : 'start',
        size: 8,
      });
    }
  }
  textPins.forEach(({ role, text, point, anchor, size }) => {
    result.push({
      role,
      text,
      bounds: rectangleForText(text, point, anchor, size),
      confidence: 'conservative-estimate',
    });
  });
  return result;
}

function componentTextBounds(
  element: GeometryElement,
  bodyBounds: CircuitGeometryBounds,
  type: string,
): CircuitGeometryTextBound[] | null {
  const lines = [
    ...(typeof element.label === 'string' && element.label
      ? [{ role: 'reference' as const, text: element.label, size: 14, bold: true }]
      : []),
    ...(typeof element.value === 'string' && element.value
      ? [{ role: 'value' as const, text: element.value, size: 12, bold: false }]
      : []),
  ];
  if (lines.length === 0) return [];
  if (element.labelAt !== undefined && !isPoint(element.labelAt)) return null;
  const nudge = element.labelNudge === undefined
    ? [0, 0] as CircuitPoint
    : isPoint(element.labelNudge)
      ? element.labelNudge
      : null;
  if (!nudge) return null;
  const anchor = element.labelAnchor === 'middle' || element.labelAnchor === 'end'
    ? element.labelAnchor
    : 'start';
  let position = typeof element.labelPos === 'string' ? element.labelPos : 'above';
  if (!['above', 'below', 'left', 'right'].includes(position)) position = 'above';
  if (
    position === 'above' &&
    Object.hasOwn(TWO_TERMINAL_BODY_BOUNDS, type) &&
    isPoint(element.from) &&
    isPoint(element.to) &&
    Math.abs(element.to[1] - element.from[1]) > Math.abs(element.to[0] - element.from[0])
  ) {
    position = 'right';
  }

  const center: CircuitPoint = [
    (bodyBounds.x0 + bodyBounds.x1) / 2,
    (bodyBounds.y0 + bodyBounds.y1) / 2,
  ];
  const labelPoint: CircuitPoint = isPoint(element.labelAt)
    ? element.labelAt
    : position === 'above'
      ? [center[0], bodyBounds.y0 - 8]
      : position === 'below'
        ? [center[0], bodyBounds.y1 + 20]
        : position === 'left'
          ? [bodyBounds.x0 - 8, center[1] + 4]
          : [bodyBounds.x1 + 8, center[1] + 4];
  const labelAnchor = isPoint(element.labelAt)
    ? anchor
    : position === 'left'
      ? 'end'
      : position === 'right'
        ? 'start'
        : 'middle';

  return lines.map((line, index) => ({
    role: line.role,
    text: line.text,
    bounds: rectangleForText(
      line.text,
      [
        labelPoint[0] + nudge[0],
        labelPoint[1] + nudge[1] + (isPoint(element.labelAt) ? index * 16 : index * 16),
      ],
      labelAnchor,
      line.size,
      line.bold,
    ),
    confidence: isPoint(element.labelAt)
      ? 'render-aligned'
      : 'conservative-estimate',
  }));
}

/**
 * Resolves stable pin identities/anchors plus conservative body and text
 * extents without mutating the supplied drawing element.
 */
export function resolveCircuitComponentGeometry(
  input: CircuitElementGeometry,
): CircuitGeometryResolution {
  const element = input as GeometryElement;
  const type = typeof element.type === 'string' ? element.type : '';
  if (!type) {
    return failure('component-type-unsupported', 'A supported component type is required.');
  }

  const source = type === 'kicad' ? 'kicad-source' : 'catalog';
  const rawPins = getCircuitPins(element);
  const identities = getCircuitPinIdentities(element);
  if (!identities || rawPins.length !== identities.length) {
    return failure(
      'pin-geometry-unavailable',
      `Stable pin identities or transformed pin anchors are unavailable for ${type}.`,
    );
  }
  const unit = type === 'kicad' ? selectedKicadUnit(element) : null;
  const pins: ResolvedCircuitPin[] = rawPins.map((pin, index) => ({
    ...identities[index],
    point: copyPoint(pin.point),
    ...(unit && isPoint(unit.pins[index]?.bodyPoint)
      ? {
          bodyPoint: transformKicadPoint(
            unit.pins[index].bodyPoint,
            element.at as CircuitPoint,
            typeof element.rotation === 'number' ? element.rotation : 0,
            element.flip === true,
          ),
        }
      : {}),
  }));

  let bodyBounds = Object.hasOwn(TWO_TERMINAL_BODY_BOUNDS, type)
    ? twoTerminalBodyBounds(type, pins)
    : type === 'kicad' && unit
      ? kicadBodyBounds(element, unit)
      : builtInBodyBounds(element, type);
  if (!bodyBounds) {
    return failure(
      'body-geometry-unavailable',
      `A conservative body bound could not be resolved for ${type}.`,
    );
  }

  let textBounds: CircuitGeometryTextBound[] = [];
  if (unit) {
    const symbolText = kicadTextBounds(element, unit);
    if (!symbolText) {
      return failure(
        'text-geometry-unavailable',
        `Visible KiCad text or pin-label geometry could not be resolved for ${type}.`,
      );
    }
    textBounds = symbolText;
    const embeddedText = symbolText
      .filter((bound) => bound.role === 'symbol-text')
      .reduce<CircuitGeometryBounds | null>(
        (bounds, entry) => bounds ? unionBounds(bounds, entry.bounds) : entry.bounds,
        null,
      );
    if (embeddedText) bodyBounds = unionBounds(bodyBounds, embeddedText);
  }

  const labels = componentTextBounds(element, bodyBounds, type);
  if (!labels) {
    return failure(
      'text-geometry-unavailable',
      `Reference/value text geometry could not be resolved for ${type}.`,
    );
  }
  textBounds.push(...labels);

  return {
    status: 'resolved',
    source,
    pins,
    bodyBounds,
    textBounds,
    transform: {
      ...(isPoint(element.at) ? { origin: copyPoint(element.at) } : {}),
      rotation: typeof element.rotation === 'number' && Number.isFinite(element.rotation)
        ? element.rotation
        : 0,
      flipX: element.flip === true,
    },
  };
}

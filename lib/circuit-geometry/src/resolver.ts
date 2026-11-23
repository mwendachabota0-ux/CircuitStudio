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
        unit?: number;
        bodyStyle?: number;
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
    const height = typeof element.height === 'number' &&
      Number.isFinite(element.height) &&
      element.height !== 0
      ? element.height
      : 55;
    local = [-12, Math.min(-height, 0), 12, Math.max(-height, 0)];
  }
  if (type === 'terminal') local = [-4, -4, 4, 4];
  if ((type === 'npn' || type === 'pnp') && element.circle === false) {
    local = [-25, -44, 25, 44];
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
      if (circle) {
        points.push(...boundsCorners(circle));
      } else if (sourcePoints.length >= 3) {
        const [start, middle, end] = sourcePoints;
        const control: CircuitPoint = [
          2 * middle[0] - (start[0] + end[0]) / 2,
          2 * middle[1] - (start[1] + end[1]) / 2,
        ];
        points.push(start, middle, end, control);
      } else {
        points.push(...sourcePoints);
      }
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
    const textAnchor: 'start' | 'middle' | 'end' = ux > 0.25
      ? 'start'
      : ux < -0.25
        ? 'end'
        : 'middle';
    if (pin.showNumber && pin.number) {
      textPins.push({
        pin,
        role: 'pin-number',
        text: pin.number,
        point: [worldPoint[0] - ux * 8, worldPoint[1] - uy * 8],
        anchor: textAnchor === 'start'
          ? 'end'
          : textAnchor === 'end'
            ? 'start'
            : 'middle',
        size: 8,
      });
    }
    if (pin.showName && pin.name) {
      textPins.push({
        pin,
        role: 'pin-name',
        text: pin.name,
        point: [worldBodyPoint[0] + ux * 5, worldBodyPoint[1] + uy * 5],
        anchor: textAnchor,
        size: 9,
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
  const result: CircuitGeometryTextBound[] = builtInEmbeddedTextBounds(element, type);
  if (type === 'ic' || type === 'connector') {
    const at = isPoint(element.at) ? element.at : null;
    if (!at || !Array.isArray(element.pins)) return null;
    const leftCount = element.pins.filter(
      (pin) => isRecord(pin) && pin.side === 'left',
    ).length;
    const rightCount = element.pins.filter(
      (pin) => isRecord(pin) && pin.side === 'right',
    ).length;
    const height = Math.max(48, Math.max(leftCount, rightCount) * 24 + 16);
    if (typeof element.value === 'string' && element.value) {
      result.push({
        role: 'value',
        text: element.value,
        bounds: rectangleForText(element.value, [at[0], at[1] + 4], 'middle', 11, true),
        confidence: 'render-aligned',
      });
    }
    if (typeof element.label === 'string' && element.label) {
      result.push({
        role: 'reference',
        text: element.label,
        bounds: rectangleForText(
          element.label,
          [at[0], at[1] + height / 2 + 17],
          'middle',
          11,
          true,
        ),
        confidence: 'render-aligned',
      });
    }
    const anchors = getCircuitPins(element);
    element.pins.forEach((pin, index) => {
      if (!isRecord(pin) || typeof pin.name !== 'string' || !isPoint(anchors[index]?.point)) return;
      const side = pin.side === 'left' ? 'left' : pin.side === 'right' ? 'right' : null;
      if (!side) return;
      const anchor = anchors[index].point;
      result.push({
        role: 'pin-name',
        text: pin.name,
        bounds: rectangleForText(
          pin.name,
          [anchor[0] + (side === 'left' ? 16 : -16), anchor[1] + 3],
          side === 'left' ? 'end' : 'start',
          9,
        ),
        confidence: 'render-aligned',
      });
    });
    return result;
  }

  const lines = [
    ...(typeof element.label === 'string' && element.label
      ? [{ role: 'reference' as const, text: element.label, size: 14, bold: true }]
      : []),
    ...(typeof element.value === 'string' && element.value
      ? [{ role: 'value' as const, text: element.value, size: 12, bold: false }]
      : []),
  ];
  if (lines.length === 0) return result;
  const labelAt = isPoint(element.labelAt) ? element.labelAt : null;
  if (element.labelAt !== undefined && !labelAt) return null;
  const labelAnchor = element.labelAnchor === 'middle' || element.labelAnchor === 'end'
    ? element.labelAnchor
    : 'start';
  if (labelAt) {
    lines.forEach((line, index) => {
      result.push({
        role: line.role,
        text: line.text,
        bounds: rectangleForText(
          line.text,
          [labelAt[0], labelAt[1] + index * 16],
          labelAnchor,
          line.size,
          line.bold,
        ),
        confidence: 'render-aligned',
      });
    });
    return result;
  }

  const nudge = element.labelNudge === undefined
    ? [0, 0] as CircuitPoint
    : isPoint(element.labelNudge)
      ? element.labelNudge
      : null;
  if (!nudge) return null;
  const allowedPositions = new Set(['above', 'below', 'left', 'right']);
  if (element.labelPos !== undefined && !allowedPositions.has(String(element.labelPos))) return null;

  const at = isPoint(element.at) ? element.at : null;
  if ((type === 'npn' || type === 'pnp') && at) {
    const anchor: 'start' | 'end' = element.flip === true ? 'start' : 'end';
    lines.forEach((line, index) => {
      result.push({
        role: line.role,
        text: line.text,
        bounds: rectangleForText(
          line.text,
          [
            at[0] + 10 * (element.flip === true ? -1 : 1) + nudge[0],
            at[1] + 62 + index * 16 + nudge[1],
          ],
          anchor,
          line.size,
          line.bold,
        ),
        confidence: 'render-aligned',
      });
    });
    return result;
  }

  const labelLayout = componentLabelLayout(element, type, bodyBounds);
  if (!labelLayout) return null;
  if (labelLayout.terminalAlternatives) {
    lines.forEach((line, index) => {
      const candidates = labelLayout.terminalAlternatives!.map((alternative) =>
        placeLabelLine(
          line,
          index,
          lines.length,
          alternative.point,
          alternative.position,
          alternative.distance,
          nudge,
        ),
      );
      const bounds = candidates.reduce<CircuitGeometryBounds | null>(
        (current, candidate) => current ? unionBounds(current, candidate) : candidate,
        null,
      );
      if (bounds) {
        result.push({
          role: line.role,
          text: line.text,
          bounds,
          confidence: 'conservative-estimate',
        });
      }
    });
    return result;
  }

  lines.forEach((line, index) => {
    result.push({
      role: line.role,
      text: line.text,
      bounds: placeLabelLine(
        line,
        index,
        lines.length,
        labelLayout.point,
        labelLayout.position,
        labelLayout.distance,
        nudge,
      ),
      confidence: 'render-aligned',
    });
  });
  return result;
}

type ComponentLabelLayout = {
  point: CircuitPoint;
  position: 'above' | 'below' | 'left' | 'right';
  distance: number;
  terminalAlternatives?: Array<{
    point: CircuitPoint;
    position: 'above' | 'below' | 'left' | 'right';
    distance: number;
  }>;
};

function componentLabelLayout(
  element: GeometryElement,
  type: string,
  bodyBounds: CircuitGeometryBounds,
): ComponentLabelLayout | null {
  const explicit = element.labelPos as ComponentLabelLayout['position'] | undefined;
  if (Object.hasOwn(TWO_TERMINAL_BODY_BOUNDS, type)) {
    if (!isPoint(element.from) || !isPoint(element.to)) return null;
    const dx = element.to[0] - element.from[0];
    const dy = element.to[1] - element.from[1];
    const bounds = TWO_TERMINAL_BODY_BOUNDS[type];
    return {
      point: [
        (element.from[0] + element.to[0]) / 2,
        (element.from[1] + element.to[1]) / 2,
      ],
      position: explicit ?? (Math.abs(dx) >= Math.abs(dy) ? 'above' : 'right'),
      distance: Math.max(Math.abs(bounds[1]), Math.abs(bounds[3])) + 8,
    };
  }
  if (!isPoint(element.at)) return null;
  const [x, y] = element.at;
  switch (type) {
    case 'opamp':
    case 'comparator':
      return { point: [x - 5, y - 40], position: explicit ?? 'above', distance: 6 };
    case 'potentiometer':
      return { point: [x, y - 10], position: explicit ?? 'above', distance: 18 };
    case 'nmos':
    case 'pmos':
    case 'mosfet':
    case 'njfet':
    case 'pjfet':
      return { point: [x, y + 48], position: explicit ?? 'below', distance: 8 };
    case 'regulator':
      return { point: [x, y - 22], position: explicit ?? 'above', distance: 5 };
    case 'transformer':
      return { point: [x, y + 52], position: explicit ?? 'below', distance: 8 };
    case 'relay':
      return { point: [x, y - 32], position: explicit ?? 'above', distance: 7 };
    case 'bridge':
      return { point: [x, y - 34], position: explicit ?? 'above', distance: 7 };
    case 'opto':
      return { point: [x, y - 34], position: explicit ?? 'above', distance: 8 };
    case 'kicad':
      return { point: [x, y], position: explicit ?? 'above', distance: 8 };
    case 'ground':
      return { point: [x, y + 20], position: explicit ?? 'below', distance: 4 };
    case 'antenna': {
      const height = typeof element.height === 'number' && Number.isFinite(element.height) && element.height
        ? element.height
        : 55;
      return { point: [x, y - height], position: explicit ?? 'above', distance: 8 };
    }
    case 'terminal': {
      const point: CircuitPoint = [x, y];
      if (explicit) {
        return {
          point,
          position: explicit,
          distance: 10,
          terminalAlternatives: [
            { point, position: explicit, distance: 4 },
            { point, position: explicit, distance: 10 },
          ],
        };
      }
      return {
        point,
        position: 'right',
        distance: 10,
        terminalAlternatives: [
          { point, position: 'right', distance: 10 },
          { point, position: 'left', distance: 10 },
          { point, position: 'above', distance: 10 },
          { point, position: 'below', distance: 4 },
        ],
      };
    }
    default:
      return {
        point: [(bodyBounds.x0 + bodyBounds.x1) / 2, bodyBounds.y0],
        position: explicit ?? 'above',
        distance: 8,
      };
  }
}

function placeLabelLine(
  line: { text: string; size: number; bold: boolean },
  index: number,
  count: number,
  point: CircuitPoint,
  position: 'above' | 'below' | 'left' | 'right',
  distance: number,
  nudge: CircuitPoint,
): CircuitGeometryBounds {
  let x = point[0];
  let y = point[1];
  let anchor: 'start' | 'middle' | 'end' = 'middle';
  if (position === 'above') {
    y = point[1] - distance - (count - 1 - index) * 16;
  } else if (position === 'below') {
    y = point[1] + distance + 12 + index * 16;
  } else {
    y = point[1] + (index - (count - 1) / 2) * 16 + 4;
    if (position === 'left') {
      x = point[0] - distance;
      anchor = 'end';
    } else {
      x = point[0] + distance;
      anchor = 'start';
    }
  }
  return rectangleForText(
    line.text,
    [x + nudge[0], y + nudge[1]],
    anchor,
    line.size,
    line.bold,
  );
}

function builtInEmbeddedTextBounds(
  element: GeometryElement,
  type: string,
): CircuitGeometryTextBound[] {
  const makeBound = (
    text: string,
    point: CircuitPoint,
    anchor: 'start' | 'middle' | 'end',
    size: number,
    bold = false,
  ): CircuitGeometryTextBound => ({
    role: 'symbol-text',
    text,
    bounds: rectangleForText(text, point, anchor, size, bold),
    confidence: 'render-aligned',
  });
  if (Object.hasOwn(TWO_TERMINAL_BODY_BOUNDS, type)) {
    const from = isPoint(element.from) ? element.from : null;
    const to = isPoint(element.to) ? element.to : null;
    if (!from || !to) return [];
    const dx = to[0] - from[0];
    const dy = to[1] - from[1];
    const length = Math.hypot(dx, dy);
    const angle = Math.atan2(dy, dx);
    const center = length / 2;
    const textByType: Record<string, Array<{
      offset: CircuitPoint;
      text: string;
      anchor: 'start' | 'middle' | 'end';
      size: number;
    }>> = {
      electrolytic: [{ offset: [center - 16, -9], text: '+', anchor: 'middle', size: 13 }],
      battery: [{ offset: [center - 15, -10], text: '+', anchor: 'middle', size: 13 }],
      mic: [{ offset: [center, 4], text: 'MIC', anchor: 'middle', size: 11 }],
      motor: [{ offset: [center, 4], text: 'M', anchor: 'middle', size: 15 }],
      thermistor: [{ offset: [center + 23, -13], text: 'T', anchor: 'start', size: 9 }],
    };
    return (textByType[type] ?? []).map(({ offset, text, anchor, size }) =>
      makeBound(text, [
        from[0] + offset[0] * Math.cos(angle) - offset[1] * Math.sin(angle),
        from[1] + offset[0] * Math.sin(angle) + offset[1] * Math.cos(angle),
      ], anchor, size),
    );
  }

  if (!isPoint(element.at)) return [];
  const pins = getCircuitPins(element);
  if (type === 'opamp' || type === 'comparator') {
    const inv = pins.find((pin) => pin.name === 'INV');
    const noninv = pins.find((pin) => pin.name === 'NONINV');
    return [
      ...(inv ? [makeBound('−', [inv.point[0] + 7, inv.point[1] + 4], 'start', 14)] : []),
      ...(noninv ? [makeBound('+', [noninv.point[0] + 7, noninv.point[1] + 4], 'start', 14)] : []),
    ];
  }
  if (type === 'regulator') {
    return [makeBound('REG', [element.at[0], element.at[1] + 4], 'middle', 10, true)];
  }
  return [];
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

  const twoTerminal = isPoint(element.from) && isPoint(element.to) &&
    Object.hasOwn(TWO_TERMINAL_BODY_BOUNDS, type);
  const rotation = type === 'kicad'
    ? typeof element.rotation === 'number' && Number.isFinite(element.rotation)
      ? element.rotation
      : 0
    : twoTerminal
      ? Math.atan2(
          (element.to as CircuitPoint)[1] - (element.from as CircuitPoint)[1],
          (element.to as CircuitPoint)[0] - (element.from as CircuitPoint)[0],
        ) * 180 / Math.PI
      : 0;
  const usesHorizontalFlip = type === 'kicad' ||
    type === 'npn' ||
    type === 'pnp' ||
    ['nmos', 'pmos', 'mosfet', 'njfet', 'pjfet'].includes(type);
  const unitNumber = type === 'kicad' && Number.isInteger(element.unit)
    ? element.unit as number
    : undefined;
  const bodyStyle = type === 'kicad' && Number.isInteger(element.bodyStyle)
    ? element.bodyStyle as number
    : undefined;
  return {
    status: 'resolved',
    source,
    pins,
    bodyBounds,
    textBounds,
    transform: {
      ...(twoTerminal
        ? { origin: copyPoint(element.from as CircuitPoint) }
        : isPoint(element.at)
          ? { origin: copyPoint(element.at) }
          : {}),
      rotation,
      flipX: usesHorizontalFlip && element.flip === true,
      ...(unitNumber !== undefined ? { unit: unitNumber } : {}),
      ...(bodyStyle !== undefined ? { bodyStyle } : {}),
    },
  };
}

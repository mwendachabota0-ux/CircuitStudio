import type {
  CircuitPoint,
  KicadSymbolGraphic,
  KicadSymbolPin,
  KicadSymbolUnit,
} from "@workspace/circuit-geometry";

type SExpr = string | SExpr[];
type SExprList = SExpr[];

const PIXELS_PER_MILLIMETER = 10;

function tokenize(input: string): string[] {
  const tokens: string[] = [];
  let index = 0;

  while (index < input.length) {
    const character = input[index];
    if (/\s/.test(character)) {
      index += 1;
      continue;
    }
    if (character === ";") {
      while (index < input.length && input[index] !== "\n") index += 1;
      continue;
    }
    if (character === "(" || character === ")") {
      tokens.push(character);
      index += 1;
      continue;
    }
    if (character === '"') {
      index += 1;
      let value = "";
      while (index < input.length) {
        const next = input[index];
        if (next === "\\") {
          const escaped = input[index + 1];
          if (escaped === undefined) throw new Error("Incomplete escape in KiCad symbol.");
          value += escaped === "n" ? "\n" : escaped === "r" ? "\r" : escaped === "t" ? "\t" : escaped;
          index += 2;
          continue;
        }
        if (next === '"') {
          index += 1;
          break;
        }
        value += next;
        index += 1;
      }
      if (input[index - 1] !== '"') {
        throw new Error("Unterminated quoted string in KiCad symbol.");
      }
      tokens.push(value);
      continue;
    }

    const start = index;
    while (
      index < input.length &&
      !/\s/.test(input[index]) &&
      input[index] !== "(" &&
      input[index] !== ")"
    ) {
      index += 1;
    }
    tokens.push(input.slice(start, index));
  }

  return tokens;
}

function parseTokens(tokens: string[]): SExpr[] {
  let index = 0;
  const parseValue = (): SExpr => {
    const token = tokens[index++];
    if (token === undefined) throw new Error("Unexpected end of KiCad symbol data.");
    if (token === ")") throw new Error("Unexpected closing parenthesis in KiCad symbol data.");
    if (token !== "(") return token;

    const list: SExprList = [];
    while (tokens[index] !== ")") {
      if (tokens[index] === undefined) {
        throw new Error("Unclosed list in KiCad symbol data.");
      }
      list.push(parseValue());
    }
    index += 1;
    return list;
  };

  const expressions: SExpr[] = [];
  while (index < tokens.length) expressions.push(parseValue());
  return expressions;
}

function isList(value: SExpr | undefined): value is SExprList {
  return Array.isArray(value);
}

function head(value: SExpr | undefined): string | undefined {
  return isList(value) && typeof value[0] === "string" ? value[0] : undefined;
}

function children(value: SExpr | undefined, key: string): SExprList[] {
  if (!isList(value)) return [];
  return value.filter((child): child is SExprList => isList(child) && child[0] === key);
}

function child(value: SExpr | undefined, key: string): SExprList | undefined {
  return children(value, key)[0];
}

function text(value: SExpr | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function number(value: SExpr | undefined): number | undefined {
  if (typeof value !== "string" || !value.trim()) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function childNumber(value: SExpr | undefined, key: string): number | undefined {
  return number(child(value, key)?.[1]);
}

function point(value: SExpr | undefined, key: string): [number, number] | undefined {
  const definition = child(value, key);
  const x = number(definition?.[1]);
  const y = number(definition?.[2]);
  return x === undefined || y === undefined ? undefined : [x, y];
}

function toCanvasPoint([x, y]: readonly [number, number]): CircuitPoint {
  const pixelX = x * PIXELS_PER_MILLIMETER;
  const pixelY = -y * PIXELS_PER_MILLIMETER;
  return [pixelX === 0 ? 0 : pixelX, pixelY === 0 ? 0 : pixelY];
}

function hasHiddenFlag(value: SExpr | undefined): boolean {
  if (!isList(value)) return false;
  if (value[0] === "hide" && value[1] === "yes") return true;
  return value.some((entry) => hasHiddenFlag(entry));
}

function strokeWidth(value: SExprList): number {
  const sourceWidth = childNumber(child(value, "stroke"), "width") ?? 0.254;
  return Math.max(0.5, sourceWidth * PIXELS_PER_MILLIMETER);
}

function fillType(value: SExprList): KicadSymbolGraphic["fillType"] {
  const fill = text(child(child(value, "fill"), "type")?.[1]);
  if (fill === "background") return "background";
  if (fill === "outline") return "outline";
  return "none";
}

function pointList(value: SExpr | undefined): [number, number][] {
  const points = child(value, "pts");
  if (!points) return [];
  return children(points, "xy").flatMap((xy) => {
    const x = number(xy[1]);
    const y = number(xy[2]);
    return x === undefined || y === undefined ? [] : [[x, y]];
  });
}

function parseGraphic(value: SExprList): KicadSymbolGraphic | undefined {
  const type = head(value);
  const width = strokeWidth(value);
  const fill = fillType(value);

  if (type === "polyline" || type === "bezier") {
    const points = pointList(value).map(toCanvasPoint);
    if (points.length < 2) return undefined;
    const first = points[0];
    const last = points[points.length - 1];
    const closed =
      points.length > 2 &&
      Math.abs(first[0] - last[0]) < 0.01 &&
      Math.abs(first[1] - last[1]) < 0.01;
    return { type, points, strokeWidth: width, fillType: fill, closed };
  }

  if (type === "rectangle") {
    const start = point(value, "start");
    const end = point(value, "end");
    if (!start || !end) return undefined;
    return {
      type: "rectangle",
      points: [toCanvasPoint(start), toCanvasPoint(end)],
      strokeWidth: width,
      fillType: fill,
    };
  }

  if (type === "circle") {
    const center = point(value, "center");
    const radius = childNumber(value, "radius");
    const edge = point(value, "end");
    if (!center || (radius === undefined && !edge)) return undefined;
    return {
      type: "circle",
      points: [toCanvasPoint(center)],
      radius: radius === undefined
        ? Math.hypot(edge![0] - center[0], edge![1] - center[1]) *
          PIXELS_PER_MILLIMETER
        : Math.abs(radius) * PIXELS_PER_MILLIMETER,
      strokeWidth: width,
      fillType: fill,
    };
  }

  if (type === "arc") {
    const start = point(value, "start");
    const middle = point(value, "mid");
    const end = point(value, "end");
    if (!start || !middle || !end) return undefined;
    return {
      type: "arc",
      points: [toCanvasPoint(start), toCanvasPoint(middle), toCanvasPoint(end)],
      strokeWidth: width,
      fillType: fill,
    };
  }

  if (type === "text") {
    const content = text(value[1]);
    const position = point(value, "at");
    if (content === undefined || !position) return undefined;
    const fontSize = point(child(child(value, "effects"), "font"), "size")?.[1];
    return {
      type: "text",
      points: [toCanvasPoint(position)],
      text: content,
      fontSize: Math.max(7, (fontSize ?? 1.27) * PIXELS_PER_MILLIMETER),
      strokeWidth: width,
      fillType: "outline",
    };
  }

  return undefined;
}

function parsePin(value: SExprList): KicadSymbolPin | undefined {
  const pinAt = child(value, "at");
  const x = number(pinAt?.[1]);
  const y = number(pinAt?.[2]);
  const angle = number(pinAt?.[3]) ?? 0;
  const length = childNumber(value, "length") ?? 0;
  const nameNode = child(value, "name");
  const numberNode = child(value, "number");
  const pinName = text(nameNode?.[1]) ?? "";
  const pinNumber = text(numberNode?.[1]) ?? "";
  if (x === undefined || y === undefined) return undefined;

  const radians = angle * Math.PI / 180;
  const innerX = x + Math.cos(radians) * length;
  const innerY = y + Math.sin(radians) * length;
  return {
    number: pinNumber,
    name: pinName,
    electricalType: text(value[1]) ?? "unspecified",
    shape: text(value[2]) ?? "line",
    point: toCanvasPoint([x, y]),
    bodyPoint: toCanvasPoint([innerX, innerY]),
    showName: !!pinName && !hasHiddenFlag(nameNode),
    showNumber: !!pinNumber && !hasHiddenFlag(numberNode),
  };
}

function mergePins(...groups: KicadSymbolPin[][]): KicadSymbolPin[] {
  const pins = new Map<string, KicadSymbolPin>();
  for (const group of groups) {
    for (const pin of group) {
      const key = `${pin.number}|${pin.name}|${pin.point.join(",")}`;
      pins.set(key, pin);
    }
  }
  return [...pins.values()];
}

export type ParsedKicadSymbol = {
  extendsName?: string;
  commonUnits?: Array<Pick<KicadSymbolUnit, "bodyStyle" | "pins" | "graphics">>;
  units: KicadSymbolUnit[];
};

export function parseKicadSymbolSource(source: string): ParsedKicadSymbol {
  const root = parseTokens(tokenize(source))[0];
  const symbolRoot = children(root, "symbol")[0];
  if (!symbolRoot) throw new Error("KiCad symbol file has no symbol definition.");

  const extendsName = text(child(symbolRoot, "extends")?.[1]);
  const commonByStyle = new Map<number, { pins: KicadSymbolPin[]; graphics: KicadSymbolGraphic[] }>();
  const unitsByKey = new Map<string, KicadSymbolUnit>();

  for (const definition of children(symbolRoot, "symbol")) {
    const childName = text(definition[1]) ?? "";
    const suffix = childName.match(/_(\d+)_(\d+)$/);
    if (!suffix) continue;
    const unitNumber = Number(suffix[1]);
    const bodyStyle = Number(suffix[2]);
    if (!Number.isInteger(unitNumber) || !Number.isInteger(bodyStyle)) continue;

    const graphics = definition.flatMap((entry) => {
      if (!isList(entry)) return [];
      const graphic = parseGraphic(entry);
      return graphic ? [graphic] : [];
    });
    const pins = children(definition, "pin").flatMap((entry) => {
      const pin = parsePin(entry);
      return pin ? [pin] : [];
    });

    if (unitNumber === 0) {
      commonByStyle.set(bodyStyle, { pins, graphics });
      continue;
    }

    const key = `${unitNumber}:${bodyStyle}`;
    const existing = unitsByKey.get(key);
    if (existing) {
      existing.pins = mergePins(existing.pins, pins);
      existing.graphics.push(...graphics);
    } else {
      unitsByKey.set(key, {
        unit: unitNumber,
        bodyStyle,
        pins,
        graphics,
      });
    }
  }

  const commonUnits = [...commonByStyle.entries()].map(
    ([bodyStyle, common]) => ({ bodyStyle, ...common }),
  );
  const parsedUnits = [...unitsByKey.values()];
  let units: KicadSymbolUnit[];

  if (extendsName) {
    // Keep shared child geometry separate so it can be merged into every
    // inherited unit, including parent units that the child does not repeat.
    units = parsedUnits;
  } else if (parsedUnits.length) {
    units = parsedUnits.map((unit) => {
      const common = commonByStyle.get(unit.bodyStyle);
      if (!common) return unit;
      return {
        ...unit,
        pins: mergePins(common.pins, unit.pins),
        graphics: [...common.graphics, ...unit.graphics],
      };
    });
  } else {
    // KiCad also uses unit 0 for symbols with no numbered unit, such as
    // generic switches and graphics-only annotation symbols.
    units = commonUnits.map((common) => ({ unit: 1, ...common }));
  }

  return {
    ...(extendsName ? { extendsName } : {}),
    ...(extendsName && commonUnits.length ? { commonUnits } : {}),
    units,
  };
}

export function mergeInheritedKicadUnits(
  inherited: KicadSymbolUnit[],
  own: KicadSymbolUnit[],
  commonUnits: Array<Pick<KicadSymbolUnit, "bodyStyle" | "pins" | "graphics">> = [],
): KicadSymbolUnit[] {
  const commonByStyle = new Map(
    commonUnits.map((unit) => [unit.bodyStyle, unit]),
  );
  const byKey = new Map(inherited.map((unit) => {
    const common = commonByStyle.get(unit.bodyStyle);
    const merged = common
      ? {
        ...unit,
        pins: mergePins(common.pins, unit.pins),
        graphics: [...common.graphics, ...unit.graphics],
      }
      : unit;
    return [`${unit.unit}:${unit.bodyStyle}`, merged];
  }));
  for (const unit of own) {
    const key = `${unit.unit}:${unit.bodyStyle}`;
    const parent = byKey.get(key);
    const common = commonByStyle.get(unit.bodyStyle);
    byKey.set(key, {
      ...unit,
      pins: mergePins(parent?.pins ?? common?.pins ?? [], unit.pins),
      graphics: [
        ...(parent?.graphics ?? common?.graphics ?? []),
        ...unit.graphics,
      ],
    });
  }
  return [...byKey.values()].sort(
    (left, right) => left.unit - right.unit || left.bodyStyle - right.bodyStyle,
  );
}

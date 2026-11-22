import {
  CIRCUIT_SUPPORTED_ELEMENT_TYPES,
  getCircuitElementSchemaError,
  getCircuitPins,
  type CircuitElementGeometry,
  type KicadSymbolData,
} from "@workspace/circuit-geometry";
import { z } from "zod";

export const CIRCUIT_DOCUMENT_SCHEMA_VERSION = 2 as const;
export const CIRCUIT_DOCUMENT_DRAWING_TYPES = [
  "wire",
  "junction",
  "crossing",
  "label",
  "box",
] as const;

export type CircuitDocumentDrawingType =
  (typeof CIRCUIT_DOCUMENT_DRAWING_TYPES)[number];

export type CircuitDocumentComponentType = Exclude<
  (typeof CIRCUIT_SUPPORTED_ELEMENT_TYPES)[number],
  CircuitDocumentDrawingType
>;

export type CircuitPoint = [number, number];

export type CircuitPinDefinition = {
  id: string;
  name: string;
  number?: string;
  unit?: number;
  bodyStyle?: number;
  occurrence?: number;
  electricalType?: string;
};

export type CircuitPinReference = {
  componentId: string;
  pinId: string;
};

export type CircuitDocumentDiagnostic = {
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
};

const finitePointSchema = z.tuple([z.number().finite(), z.number().finite()]);
const pinReferenceSchema = z.object({
  componentId: z.string().min(1),
  pinId: z.string().min(1),
}).strict();
const propertiesSchema = z.record(z.string(), z.unknown());
const pinDefinitionSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  number: z.string().optional(),
  unit: z.number().int().positive().optional(),
  bodyStyle: z.number().int().positive().optional(),
  occurrence: z.number().int().nonnegative().optional(),
  electricalType: z.string().optional(),
}).strict();

const supportedComponentTypeSchema = z.custom<CircuitDocumentComponentType>(
  (value) =>
    typeof value === "string" &&
    CIRCUIT_SUPPORTED_ELEMENT_TYPES.includes(
      value as (typeof CIRCUIT_SUPPORTED_ELEMENT_TYPES)[number],
    ) &&
    !(CIRCUIT_DOCUMENT_DRAWING_TYPES as readonly string[]).includes(value),
  { message: "Unsupported electrical component type." },
);

const componentSchema = z.object({
  id: z.string().min(1),
  type: supportedComponentTypeSchema,
  reference: z.string().optional(),
  value: z.string().optional(),
  properties: propertiesSchema,
  pins: z.array(pinDefinitionSchema),
}).strict();

const netSchema = z.object({
  id: z.string().min(1),
  name: z.string().optional(),
  attributes: propertiesSchema.optional(),
  members: z.array(pinReferenceSchema),
}).strict();

const placementSchema = z.object({
  componentId: z.string().min(1),
  position: finitePointSchema,
  rotation: z.number().finite(),
  flip: z.boolean(),
  legacyGeometry: z.object({
    from: finitePointSchema.optional(),
    to: finitePointSchema.optional(),
    at: finitePointSchema.optional(),
  }).strict().optional(),
  properties: propertiesSchema,
}).strict();

const routeSchema = z.object({
  id: z.string().min(1),
  netId: z.string().min(1),
  points: z.array(finitePointSchema).min(2),
  open: z.boolean().optional(),
  properties: propertiesSchema,
}).strict();

const junctionSchema = z.object({
  id: z.string().min(1),
  at: finitePointSchema,
  routeIds: z.array(z.string().min(1)),
  properties: propertiesSchema,
}).strict();

const crossingSchema = z.object({
  id: z.string().min(1),
  at: finitePointSchema,
  orientation: z.enum(["horizontal", "vertical"]).optional(),
  routeIds: z.array(z.string().min(1)),
  properties: propertiesSchema,
}).strict();

const annotationSchema = z.discriminatedUnion("type", [
  z.object({
    id: z.string().min(1),
    type: z.literal("label"),
    at: finitePointSchema,
    text: z.string(),
    properties: propertiesSchema,
  }).strict(),
  z.object({
    id: z.string().min(1),
    type: z.literal("box"),
    x: z.number().finite(),
    y: z.number().finite(),
    w: z.number().finite(),
    h: z.number().finite(),
    properties: propertiesSchema,
  }).strict(),
]);

export const CircuitDocumentV2Schema = z.object({
  schemaVersion: z.literal(CIRCUIT_DOCUMENT_SCHEMA_VERSION),
  id: z.string().min(1),
  title: z.string().optional(),
  electrical: z.object({
    components: z.array(componentSchema),
    nets: z.array(netSchema),
    noConnects: z.array(pinReferenceSchema),
    unassignedPins: z.array(pinReferenceSchema),
  }).strict(),
  drawing: z.object({
    units: z.literal("px"),
    canvas: z.object({
      width: z.number().finite().positive().optional(),
      height: z.number().finite().positive().optional(),
    }).strict(),
    placements: z.array(placementSchema),
    routes: z.array(routeSchema),
    junctions: z.array(junctionSchema),
    crossings: z.array(crossingSchema),
    annotations: z.array(annotationSchema),
  }).strict(),
  legacyImport: z.object({
    sourceFormat: z.literal("CircuitSpec"),
    groundSemantics: z.literal("global-ground"),
    terminalLabelSemantics: z.literal("local-labels-do-not-merge"),
    sourceMetadata: propertiesSchema,
  }).strict().optional(),
  metadata: propertiesSchema.optional(),
}).strict();

export type CircuitDocumentV2 = z.infer<typeof CircuitDocumentV2Schema>;
export type CircuitComponentV2 = CircuitDocumentV2["electrical"]["components"][number];
export type CircuitNetV2 = CircuitDocumentV2["electrical"]["nets"][number];

const drawingTypeSet = new Set<string>(CIRCUIT_DOCUMENT_DRAWING_TYPES);

export function isCircuitDocumentComponentType(
  value: unknown,
): value is CircuitDocumentComponentType {
  return typeof value === "string" &&
    !drawingTypeSet.has(value) &&
    CIRCUIT_SUPPORTED_ELEMENT_TYPES.includes(
      value as (typeof CIRCUIT_SUPPORTED_ELEMENT_TYPES)[number],
    );
}

/**
 * Returns pin IDs derived from the shared geometry catalog or the exact
 * selected KiCad symbol unit. No pin identities are invented for unresolved
 * symbols.
 */
export function getCircuitPinDefinitions(
  type: unknown,
  properties: Record<string, unknown> = {},
): CircuitPinDefinition[] | null {
  if (!isCircuitDocumentComponentType(type)) return null;

  const geometry: CircuitElementGeometry = {
    ...properties,
    type,
    from: [0, 0],
    to: [100, 0],
    at: [0, 0],
  };
  const schemaError = getCircuitElementSchemaError(geometry);
  if (schemaError) return null;

  const namesFromCatalog = getCircuitPins(geometry).map((pin) => pin.name);
  if (namesFromCatalog.length === 0) return null;

  if (type !== "kicad") {
    return namesFromCatalog.map((name) => ({ id: name, name }));
  }

  const symbolData = properties.symbolData as KicadSymbolData | undefined;
  const unit = Number.isInteger(properties.unit) ? properties.unit as number : 1;
  const bodyStyle = Number.isInteger(properties.bodyStyle)
    ? properties.bodyStyle as number
    : 1;
  const unitData = symbolData?.units.find(
    (entry) => entry.unit === unit && entry.bodyStyle === bodyStyle,
  );
  if (!unitData || unitData.pins.length !== namesFromCatalog.length) return null;

  const occurrences = new Map<string, number>();
  return unitData.pins.map((pin, index) => {
    const identity = `${pin.number}\u0000${pin.name}`;
    const occurrence = occurrences.get(identity) ?? 0;
    occurrences.set(identity, occurrence + 1);
    const stableToken = (value: string) => encodeURIComponent(value || "_");
    return {
      id: `kicad:u${unit}:b${bodyStyle}:${stableToken(pin.number)}:${stableToken(pin.name)}:${occurrence}`,
      name: namesFromCatalog[index],
      number: pin.number,
      unit,
      bodyStyle,
      occurrence,
      electricalType: pin.electricalType,
    };
  });
}

export function createCircuitComponent(
  input: Omit<CircuitComponentV2, "pins"> & { pins?: CircuitPinDefinition[] },
): CircuitComponentV2 {
  const pins = input.pins ?? getCircuitPinDefinitions(input.type, input.properties);
  if (!pins) {
    throw new Error(`Pin identities are unavailable for component type "${input.type}".`);
  }
  return CircuitDocumentV2Schema.shape.electrical.shape.components.element.parse({
    ...input,
    pins,
  });
}

export function parseCircuitDocumentV2(value: unknown): CircuitDocumentV2 {
  return CircuitDocumentV2Schema.parse(
    typeof value === "string" ? JSON.parse(value) : value,
  );
}

export function serializeCircuitDocumentV2(value: unknown): string {
  return JSON.stringify(parseCircuitDocumentV2(value));
}

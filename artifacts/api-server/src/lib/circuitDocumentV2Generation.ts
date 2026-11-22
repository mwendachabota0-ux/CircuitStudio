import { randomUUID } from "node:crypto";
import {
  CIRCUIT_DOCUMENT_DRAWING_TYPES,
  CircuitDocumentV2Schema,
  getCircuitPinDefinitions,
  isCircuitDocumentComponentType,
  validateCircuitDocumentV2,
  type CircuitDocumentDiagnostic,
  type CircuitDocumentV2,
} from "@workspace/circuit-document";
import {
  CIRCUIT_COMPONENT_REFERENCE,
  formatRelevantCircuitComponentResearchContext,
} from "@workspace/circuit-geometry";

const MODEL_NAME = "gemini-2.5-flash";
const MAX_COMPONENTS = 300;
const MAX_NETS = 600;
const MAX_MEMBERS_PER_NET = 512;
const MAX_NOTE_COUNT = 24;
const MAX_NOTE_LENGTH = 1_200;
const FORBIDDEN_PROPERTY_KEYS = new Set([
  "at",
  "bounds",
  "coordinates",
  "coords",
  "crossings",
  "from",
  "geometry",
  "height",
  "junctions",
  "path",
  "paths",
  "points",
  "position",
  "positions",
  "rotation",
  "routes",
  "svg",
  "symbolbounds",
  "symboldata",
  "to",
  "w",
  "width",
  "wire",
  "wires",
  "x",
  "y",
]);
const DRAWING_ONLY_TYPES = new Set<string>(CIRCUIT_DOCUMENT_DRAWING_TYPES);

export type CircuitDocumentV2GenerationDiagnostic = {
  category:
    | "schema"
    | "electrical"
    | "drawing"
    | "drawing-warning"
    | "consistency-warning";
  code: string;
  severity: "error" | "warning";
  path: string;
  message: string;
};

export type CircuitDocumentV2ElectricalGenerationResult = {
  status: "proposed";
  document: CircuitDocumentV2;
  design: {
    summary: string;
    assumptions: string[];
    uncertainties: string[];
    questions: string[];
  };
  validation: {
    scope: "document-structure-only";
    isValid: true;
    diagnostics: CircuitDocumentV2GenerationDiagnostic[];
  };
};

export type CircuitDocumentV2GenerationFailureDiagnostic = {
  code: string;
  path: string;
  message: string;
};

export class CircuitDocumentV2GenerationError extends Error {
  readonly code: string;
  readonly diagnostics: CircuitDocumentV2GenerationFailureDiagnostic[];

  constructor(
    code: string,
    message: string,
    diagnostics: CircuitDocumentV2GenerationFailureDiagnostic[] = [],
  ) {
    super(message);
    this.code = code;
    this.diagnostics = diagnostics;
    this.name = "CircuitDocumentV2GenerationError";
  }
}

export type CircuitDocumentV2ModelResponse = {
  text: string;
  metadata?: Record<string, number | string>;
};

export type CircuitDocumentV2ModelRequest = {
  userId: string;
  prompt: string;
  systemInstruction: string;
  onKeyFallback?: (failedKeyNumber: number, nextKeyNumber: number) => void;
};

export type GenerateCircuitDocumentV2Model = (
  request: CircuitDocumentV2ModelRequest,
) => Promise<CircuitDocumentV2ModelResponse>;

type ModelComponent = {
  id: string;
  type: string;
  reference?: string;
  value?: string;
  properties: Record<string, unknown>;
};

type ModelPinReference = {
  componentId: string;
  pinName: string;
};

type ModelProposal = {
  title: string;
  summary: string;
  components: ModelComponent[];
  nets: Array<{
    id: string;
    name?: string;
    members: ModelPinReference[];
  }>;
  noConnects: ModelPinReference[];
  unassignedPins: ModelPinReference[];
  assumptions: string[];
  uncertainties: string[];
  questions: string[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function fail(
  code: string,
  message: string,
  path: string,
): never {
  throw new CircuitDocumentV2GenerationError(code, message, [
    { code, path, message },
  ]);
}

function assertOnlyKeys(
  record: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const allowedKeys = new Set(allowed);
  const unexpected = Object.keys(record).find((key) => !allowedKeys.has(key));
  if (unexpected) {
    fail(
      "unexpected-field",
      `Unexpected field "${unexpected}".`,
      path ? `${path}.${unexpected}` : unexpected,
    );
  }
}

function requiredString(
  value: unknown,
  path: string,
  maximumLength: number,
): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > maximumLength
  ) {
    fail("invalid-response", "A required text value is missing or invalid.", path);
  }
  return value.trim();
}

function parseNotes(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.length > MAX_NOTE_COUNT) {
    fail("invalid-response", "Expected a bounded list of text notes.", path);
  }
  return value.map((entry, index) =>
    requiredString(entry, `${path}.${index}`, MAX_NOTE_LENGTH)
  );
}

function assertNoDrawingProperties(value: unknown, path: string): void {
  if (Array.isArray(value)) {
    value.forEach((entry, index) =>
      assertNoDrawingProperties(entry, `${path}.${index}`)
    );
    return;
  }
  if (!isRecord(value)) return;

  for (const [key, entry] of Object.entries(value)) {
    const normalized = key.toLocaleLowerCase().replace(/[_-]/g, "");
    if (FORBIDDEN_PROPERTY_KEYS.has(normalized)) {
      fail(
        "drawing-data-not-allowed",
        "Generation output may describe electrical data only; drawing geometry is created by deterministic application code.",
        `${path}.${key}`,
      );
    }
    assertNoDrawingProperties(entry, `${path}.${key}`);
  }
}

function parsePinReference(value: unknown, path: string): ModelPinReference {
  if (!isRecord(value)) {
    fail("invalid-pin-reference", "Expected a component ID and exact pin name.", path);
  }
  assertOnlyKeys(value, ["componentId", "pinName"], path);
  return {
    componentId: requiredString(value.componentId, `${path}.componentId`, 128),
    pinName: requiredString(value.pinName, `${path}.pinName`, 128),
  };
}

function parseProposal(value: unknown): ModelProposal {
  if (!isRecord(value)) {
    fail("invalid-response", "Gemini must return one JSON object.", "");
  }
  assertOnlyKeys(
    value,
    [
      "title",
      "summary",
      "components",
      "nets",
      "noConnects",
      "unassignedPins",
      "assumptions",
      "uncertainties",
      "questions",
    ],
    "",
  );

  if (!Array.isArray(value.components) || value.components.length === 0 ||
    value.components.length > MAX_COMPONENTS) {
    fail(
      "invalid-response",
      `Expected between 1 and ${MAX_COMPONENTS} components.`,
      "components",
    );
  }
  if (!Array.isArray(value.nets) || value.nets.length > MAX_NETS) {
    fail("invalid-response", `Expected at most ${MAX_NETS} nets.`, "nets");
  }
  if (!Array.isArray(value.noConnects)) {
    fail("invalid-response", "Expected an explicit no-connect pin list.", "noConnects");
  }
  if (!Array.isArray(value.unassignedPins)) {
    fail("invalid-response", "Expected an explicit unassigned pin list.", "unassignedPins");
  }

  const components = value.components.map((entry, index): ModelComponent => {
    const path = `components.${index}`;
    if (!isRecord(entry)) {
      fail("invalid-component", "Expected a component object.", path);
    }
    assertOnlyKeys(entry, ["id", "type", "reference", "value", "properties"], path);
    const id = requiredString(entry.id, `${path}.id`, 128);
    const type = requiredString(entry.type, `${path}.type`, 64);
    if (
      !isCircuitDocumentComponentType(type) ||
      DRAWING_ONLY_TYPES.has(type) ||
      type === "kicad"
    ) {
      fail(
        "unsupported-component-type",
        `Component type "${type}" is not supported by this offline V2 generation path.`,
        `${path}.type`,
      );
    }
    const properties = entry.properties === undefined ? {} : entry.properties;
    if (!isRecord(properties)) {
      fail("invalid-component-properties", "Component properties must be an object.", `${path}.properties`);
    }
    assertNoDrawingProperties(properties, `${path}.properties`);
    return {
      id,
      type,
      ...(entry.reference === undefined
        ? {}
        : { reference: requiredString(entry.reference, `${path}.reference`, 128) }),
      ...(entry.value === undefined
        ? {}
        : { value: requiredString(entry.value, `${path}.value`, 256) }),
      properties,
    };
  });

  const nets = value.nets.map((entry, index) => {
    const path = `nets.${index}`;
    if (!isRecord(entry)) {
      fail("invalid-net", "Expected a net object.", path);
    }
    assertOnlyKeys(entry, ["id", "name", "members"], path);
    if (!Array.isArray(entry.members) || entry.members.length === 0 ||
      entry.members.length > MAX_MEMBERS_PER_NET) {
      fail("invalid-net", "A net must have a bounded, non-empty membership list.", `${path}.members`);
    }
    return {
      id: requiredString(entry.id, `${path}.id`, 128),
      ...(entry.name === undefined
        ? {}
        : { name: requiredString(entry.name, `${path}.name`, 128) }),
      members: entry.members.map((member, memberIndex) =>
        parsePinReference(member, `${path}.members.${memberIndex}`)
      ),
    };
  });

  return {
    title: requiredString(value.title, "title", 200),
    summary: requiredString(value.summary, "summary", 2_000),
    components,
    nets,
    noConnects: value.noConnects.map((pin, index) =>
      parsePinReference(pin, `noConnects.${index}`)
    ),
    unassignedPins: value.unassignedPins.map((pin, index) =>
      parsePinReference(pin, `unassignedPins.${index}`)
    ),
    assumptions: parseNotes(value.assumptions, "assumptions"),
    uncertainties: parseNotes(value.uncertainties, "uncertainties"),
    questions: parseNotes(value.questions, "questions"),
  };
}

function componentPinGuide(): string {
  return CIRCUIT_COMPONENT_REFERENCE
    .filter(({ type }) =>
      !DRAWING_ONLY_TYPES.has(type) && type !== "kicad"
    )
    .map((entry) => {
      const dynamic = entry.type === "ic" || entry.type === "connector";
      const properties = dynamic
        ? { pins: [{ name: "IN", side: "left" }, { name: "OUT", side: "right" }] }
        : {};
      const pins = getCircuitPinDefinitions(entry.type, properties)
        ?.map((pin) => pin.name)
        .join(", ");
      const pinText = dynamic
        ? "properties.pins must contain the exact, user-provided pin names and sides; do not infer a device pinout"
        : `canonical pin names: ${pins ?? entry.pinNames}`;
      return `- ${entry.type}: ${pinText}; catalog notes: ${entry.connectionRules}`;
    })
    .join("\n");
}

export function buildCircuitDocumentV2GenerationPrompt(prompt: string): string {
  const componentResearch = formatRelevantCircuitComponentResearchContext([prompt]);
  return [
    "Generate an electrical-only proposal for Circuit Studio's CircuitDocumentV2.",
    "Return exactly one JSON object, without Markdown, with these keys:",
    '{"title":"...","summary":"...","components":[{"id":"R1","type":"resistor","reference":"R1","value":"10 kohm","properties":{}}],"nets":[{"id":"stable-net-id","name":"optional display name","members":[{"componentId":"R1","pinName":"1"}]}],"noConnects":[{"componentId":"U1","pinName":"NC"}],"unassignedPins":[{"componentId":"U1","pinName":"VDD"}],"assumptions":[],"uncertainties":[],"questions":[]}',
    "Use only the exact built-in types and pin names below. The model's pin references use pinName; application code derives pin IDs from the shared catalog.",
    "Treat dcsource and battery as distinct component types. Net IDs define connectivity; equal display names never join nets, including ground nets.",
    "Every canonical pin must appear exactly once in a net, noConnects, or unassignedPins. Use noConnects only for an intentional open pin; use unassignedPins when its connectivity is unresolved. Never omit, rename, invent, or silently connect a pin.",
    "For ICs and connectors, include properties.pins only when the exact names and left/right sides were supplied or verified by the user. If a real part's pinout is unknown, do not guess it; state a question or uncertainty instead.",
    "Component properties may contain electrical/component metadata only. Do not include coordinates, positions, symbol bounds, wire paths, routes, junctions, crossings, placements, SVG, or any drawing data. Do not return schemaVersion, document ID, pin definitions, or drawing fields; deterministic application code supplies those.",
    "Use concise, stable, unique component and net IDs. Preserve ambiguity in uncertainties/questions instead of silently resolving it.",
    "This is a staged design proposal. Structural document validation is not electrical correctness, ERC, simulation, ratings review, safety assessment, or certification.",
    "",
    "Supported built-in component types and pin constraints:",
    componentPinGuide(),
    componentResearch,
    `User circuit description:\n${prompt}`,
  ].filter(Boolean).join("\n\n");
}

function diagnostic(
  category: CircuitDocumentV2GenerationDiagnostic["category"],
  item: CircuitDocumentDiagnostic,
): CircuitDocumentV2GenerationDiagnostic {
  return { category, ...item };
}

function buildCircuitDocument(
  proposal: ModelProposal,
  id: string,
): CircuitDocumentV2 {
  const componentIds = new Set<string>();
  const componentById = new Map<string, ModelComponent>();
  const canonicalPinsByComponent = new Map<
    string,
    Map<string, { id: string; name: string }>
  >();
  const components = proposal.components.map((component, index) => {
    if (componentIds.has(component.id)) {
      fail("duplicate-component-id", `Duplicate component ID "${component.id}".`, `components.${index}.id`);
    }
    componentIds.add(component.id);
    componentById.set(component.id, component);

    const definitions = getCircuitPinDefinitions(component.type, component.properties);
    if (!definitions?.length) {
      fail(
        "canonical-pins-unavailable",
        `Canonical pins could not be derived for ${component.id} (${component.type}).`,
        `components.${index}.properties`,
      );
    }
    const pinsByName = new Map<string, { id: string; name: string }>();
    for (const pin of definitions) {
      if (pinsByName.has(pin.name)) {
        fail(
          "ambiguous-canonical-pin",
          `Catalog pin name "${pin.name}" is ambiguous for ${component.id}.`,
          `components.${index}.properties`,
        );
      }
      pinsByName.set(pin.name, { id: pin.id, name: pin.name });
    }
    canonicalPinsByComponent.set(component.id, pinsByName);
    return {
      id: component.id,
      type: component.type,
      ...(component.reference === undefined ? {} : { reference: component.reference }),
      ...(component.value === undefined ? {} : { value: component.value }),
      properties: component.properties,
      pins: definitions,
    };
  });

  const netIds = new Set<string>();
  const assignedPins = new Map<string, string>();
  const canonicalReference = (
    reference: ModelPinReference,
    category: string,
    path: string,
  ) => {
    const pins = canonicalPinsByComponent.get(reference.componentId);
    if (!componentById.has(reference.componentId) || !pins) {
      fail(
        "unknown-component-reference",
        `Pin reference points to unknown component "${reference.componentId}".`,
        `${path}.componentId`,
      );
    }
    const pin = pins.get(reference.pinName);
    if (!pin) {
      fail(
        "unknown-pin-name",
        `Component ${reference.componentId} has no canonical pin named "${reference.pinName}".`,
        `${path}.pinName`,
      );
    }
    const key = `${reference.componentId}\u0000${pin.id}`;
    const previous = assignedPins.get(key);
    if (previous) {
      fail(
        "duplicate-pin-membership",
        `Pin ${reference.componentId}.${pin.name} appears in both ${previous} and ${category}.`,
        path,
      );
    }
    assignedPins.set(key, category);
    return { componentId: reference.componentId, pinId: pin.id };
  };

  const nets = proposal.nets.map((net, netIndex) => {
    if (netIds.has(net.id)) {
      fail("duplicate-net-id", `Duplicate net ID "${net.id}".`, `nets.${netIndex}.id`);
    }
    netIds.add(net.id);
    return {
      id: net.id,
      ...(net.name === undefined ? {} : { name: net.name }),
      members: net.members.map((member, memberIndex) =>
        canonicalReference(
          member,
          `net "${net.id}"`,
          `nets.${netIndex}.members.${memberIndex}`,
        )
      ),
    };
  });
  const noConnects = proposal.noConnects.map((member, index) =>
    canonicalReference(member, "no-connect", `noConnects.${index}`)
  );
  const unassignedPins = proposal.unassignedPins.map((member, index) =>
    canonicalReference(member, "unassigned", `unassignedPins.${index}`)
  );

  for (const component of components) {
    for (const pin of component.pins) {
      const key = `${component.id}\u0000${pin.id}`;
      if (!assignedPins.has(key)) {
        fail(
          "pin-state-missing",
          `Pin ${component.id}.${pin.name} must be assigned to a net, marked no-connect, or explicitly left unassigned.`,
          `components.${component.id}.pins.${pin.id}`,
        );
      }
    }
  }

  const candidate = {
    schemaVersion: 2,
    id,
    title: proposal.title,
    electrical: { components, nets, noConnects, unassignedPins },
    drawing: {
      units: "px",
      canvas: {},
      placements: [],
      routes: [],
      junctions: [],
      crossings: [],
      annotations: [],
    },
  };
  const parsed = CircuitDocumentV2Schema.safeParse(candidate);
  if (!parsed.success) {
    fail(
      "generated-document-schema-invalid",
      "The generated V2 document did not match the document schema.",
      parsed.error.issues[0]?.path.map(String).join(".") ?? "document",
    );
  }

  const validation = validateCircuitDocumentV2(parsed.data);
  if (!validation.isValid) {
    const diagnostics = [
      ...validation.schemaErrors,
      ...validation.electricalErrors,
      ...validation.drawingErrors,
    ].map(({ code, path, message }) => ({ code, path, message }));
    throw new CircuitDocumentV2GenerationError(
      "generated-document-invalid",
      "The generated V2 document failed structural validation.",
      diagnostics,
    );
  }
  return parsed.data;
}

export async function generateCircuitDocumentV2ElectricalProposal(
  input: {
    userId: string;
    prompt: string;
    generateModel: GenerateCircuitDocumentV2Model;
    createDocumentId?: () => string;
  },
): Promise<CircuitDocumentV2ElectricalGenerationResult> {
  const systemInstruction = buildCircuitDocumentV2GenerationPrompt(input.prompt);
  const modelResponse = await input.generateModel({
    userId: input.userId,
    prompt: input.prompt,
    systemInstruction,
  });
  if (typeof modelResponse.text !== "string" || !modelResponse.text.trim()) {
    fail("empty-model-response", "Gemini returned an empty electrical proposal.", "response");
  }

  let decoded: unknown;
  try {
    decoded = JSON.parse(modelResponse.text);
  } catch {
    fail("malformed-model-json", "Gemini returned malformed JSON.", "response");
  }
  const proposal = parseProposal(decoded);
  const document = buildCircuitDocument(
    proposal,
    input.createDocumentId?.() ?? randomUUID(),
  );
  const validation = validateCircuitDocumentV2(document);
  const diagnostics = [
    ...validation.schemaErrors.map((item) => diagnostic("schema", item)),
    ...validation.electricalErrors.map((item) => diagnostic("electrical", item)),
    ...validation.drawingErrors.map((item) => diagnostic("drawing", item)),
    ...validation.drawingWarnings.map((item) => diagnostic("drawing-warning", item)),
    ...validation.consistencyWarnings.map((item) =>
      diagnostic("consistency-warning", item)
    ),
  ];
  return {
    status: "proposed",
    document,
    design: {
      summary: proposal.summary,
      assumptions: proposal.assumptions,
      uncertainties: proposal.uncertainties,
      questions: proposal.questions,
    },
    validation: {
      scope: "document-structure-only",
      isValid: true,
      diagnostics,
    },
  };
}

export const CIRCUIT_DOCUMENT_V2_GENERATION_MODEL = MODEL_NAME;

import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CircuitDocumentV2GenerationError,
  CircuitDocumentV2PreparationInvariantError,
  buildCircuitDocumentV2GenerationPrompt,
  generateCircuitDocumentV2ElectricalProposal,
} from "./circuitDocumentV2Generation.ts";
import {
  CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
  prepareCircuitDocumentDrawing,
} from "../../../../lib/circuit-document/src/index.ts";
import { GenerateCircuitResponse } from "../../../../lib/api-zod/src/generated/api.ts";

const pin = (componentId, pinName) => ({ componentId, pinName });

function rawProposal({
  components,
  nets,
  noConnects = [],
  unassignedPins = [],
  title = "Test circuit",
  summary = "A structurally explicit electrical proposal.",
  assumptions = [],
  uncertainties = [],
  questions = [],
}) {
  return {
    title,
    summary,
    components,
    nets,
    noConnects,
    unassignedPins,
    assumptions,
    uncertainties,
    questions,
  };
}

async function generate(raw, {
  id = "document-v2-test",
  text,
  prepareDrawing,
  generateModel,
} = {}) {
  return generateCircuitDocumentV2ElectricalProposal({
    userId: "user-test",
    prompt: "Create a low-voltage test circuit.",
    createDocumentId: () => id,
    ...(prepareDrawing ? { prepareDrawing } : {}),
    generateModel: generateModel ?? (async () => ({
      text: text ?? JSON.stringify(raw),
      metadata: { finishReason: "STOP" },
    })),
  });
}

function seriesLedProposal() {
  return rawProposal({
    components: [
      { id: "V1", type: "battery", reference: "B1", value: "9 V", properties: {} },
      { id: "R1", type: "resistor", reference: "R1", value: "330 ohm", properties: {} },
      { id: "D1", type: "led", reference: "D1", value: "red", properties: {} },
    ],
    nets: [
      { id: "positive", name: "VCC", members: [pin("V1", "+"), pin("R1", "1")] },
      { id: "led-feed", name: "LED", members: [pin("R1", "2"), pin("D1", "A")] },
      { id: "return", name: "GND", members: [pin("D1", "K"), pin("V1", "-")] },
    ],
  });
}

function singleTransistorProposal() {
  return rawProposal({
    title: "Single transistor switch",
    components: [
      { id: "V1", type: "dcsource", value: "9V", properties: {} },
      { id: "Q1", type: "npn", value: "2N3904", properties: {} },
      { id: "R_INPUT", type: "resistor", value: "10 kohm", properties: {} },
      { id: "R_PULLDOWN", type: "resistor", value: "100 kohm", properties: {} },
      { id: "GND1", type: "ground", properties: {} },
    ],
    nets: [
      {
        id: "control",
        name: "CONTROL",
        members: [pin("R_INPUT", "2"), pin("Q1", "B"), pin("R_PULLDOWN", "1")],
      },
      {
        id: "return",
        name: "GND",
        members: [
          pin("Q1", "E"),
          pin("R_PULLDOWN", "2"),
          pin("GND1", "at"),
          pin("V1", "-"),
        ],
      },
      { id: "supply", name: "VCC", members: [pin("V1", "+")] },
    ],
    unassignedPins: [pin("Q1", "C"), pin("R_INPUT", "1")],
  });
}

test("prepares a series LED proposal and reports its blocked return route", async () => {
  let electricalBeforePreparation;
  const result = await generate(seriesLedProposal(), {
    prepareDrawing: (request) => {
      electricalBeforePreparation = structuredClone(request.document.electrical);
      return prepareCircuitDocumentDrawing(request);
    },
  });

  assert.equal(result.status, "proposed");
  assert.equal(result.document.id, "document-v2-test");
  assert.equal(result.drawingPreparation.status, "partial");
  assert.equal(result.drawingPreparation.pipelineStatus, "partial");
  assert.deepEqual(result.drawingPreparation.stages, {
    placement: "complete",
    routing: "incomplete",
  });
  assert.equal(result.document.drawing.placements.length, 3);
  assert.equal(result.document.drawing.routes.length, 2);
  assert.deepEqual(result.drawingPreparation.blockedNetIds, ["return"]);
  assert.ok(result.drawingPreparation.diagnostics.some((entry) =>
    entry.code === "route-net-touch-ambiguous"
  ));
  assert.deepEqual(result.document.electrical, electricalBeforePreparation);
  assert.deepEqual(
    result.document.electrical.components.map(({ id, pins }) => [
      id,
      pins.map(({ id: pinId, name }) => [pinId, name]),
    ]),
    [
      ["V1", [["+", "+"], ["-", "-"]]],
      ["R1", [["1", "1"], ["2", "2"]]],
      ["D1", [["A", "A"], ["K", "K"]]],
    ],
  );
  assert.equal(result.validation.scope, "document-structure-only");
  assert.equal(result.validation.isValid, true);
});

test("returns partial drawing status and blocked net details without losing the electrical proposal", async () => {
  const result = await generate(singleTransistorProposal());

  assert.equal(result.drawingPreparation.status, "partial");
  assert.equal(result.drawingPreparation.pipelineStatus, "partial");
  assert.deepEqual(result.drawingPreparation.stages, {
    placement: "complete",
    routing: "incomplete",
  });
  assert.deepEqual(result.drawingPreparation.blockedNetIds, ["return"]);
  assert.ok(result.drawingPreparation.diagnostics.some((entry) =>
    entry.code === "route-collinear-overlap"
  ));
  assert.deepEqual(
    result.document.electrical.components.map(({ id, type }) => [id, type]),
    [
      ["V1", "dcsource"],
      ["Q1", "npn"],
      ["R_INPUT", "resistor"],
      ["R_PULLDOWN", "resistor"],
      ["GND1", "ground"],
    ],
  );
});

test("reports blocked preparation while preserving the valid electrical proposal", async () => {
  let electricalBeforePreparation;
  const result = await generate(seriesLedProposal(), {
    prepareDrawing: ({ document }) => {
      electricalBeforePreparation = structuredClone(document.electrical);
      return {
        status: "invalid-input",
        diagnostics: [{
          code: "drawing-preparation-version-unsupported",
          severity: "error",
          path: "algorithmVersion",
          message: "The pipeline version is unsupported.",
        }],
        stages: { placement: "not-run", routing: "not-run" },
        routedNetIds: [],
        skippedNetIds: [],
        blockedNetIds: [],
        algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
      };
    },
  });

  assert.equal(result.status, "proposed");
  assert.equal(result.drawingPreparation.status, "blocked");
  assert.equal(result.drawingPreparation.pipelineStatus, "invalid-input");
  assert.deepEqual(result.document.drawing.placements, []);
  assert.deepEqual(result.document.drawing.routes, []);
  assert.deepEqual(result.document.electrical, electricalBeforePreparation);
  assert.equal(
    result.drawingPreparation.diagnostics[0].code,
    "drawing-preparation-version-unsupported",
  );
});

test("rejects a prepared result if drawing preparation changes the electrical model", async () => {
  await assert.rejects(
    generate(seriesLedProposal(), {
      prepareDrawing: (request) => {
        const prepared = prepareCircuitDocumentDrawing(request);
        prepared.document.electrical.nets[0].name = "unexpectedly changed";
        return prepared;
      },
    }),
    (error) => error instanceof CircuitDocumentV2PreparationInvariantError &&
      error.code === "prepared-electrical-model-changed" &&
      error.diagnostics[0].path === "document.electrical",
  );
});

test("placement and routing blockers stay blocked and preserve the electrical proposal", async () => {
  const cases = [
    {
      status: "placement-blocked",
      stages: { placement: "blocked", routing: "not-run" },
      diagnosticCode: "placement-no-feasible-layout",
      blockedNetIds: [],
    },
    {
      status: "routing-blocked",
      stages: { placement: "complete", routing: "blocked" },
      diagnosticCode: "route-no-feasible-path",
      blockedNetIds: ["return"],
    },
  ];

  for (const preparationCase of cases) {
    let electricalBeforePreparation;
    const result = await generate(seriesLedProposal(), {
      prepareDrawing: ({ document }) => {
        electricalBeforePreparation = structuredClone(document.electrical);
        return {
          ...preparationCase,
          document,
          diagnostics: [{
            code: preparationCase.diagnosticCode,
            severity: "error",
            path: "drawing",
            message: "Deterministic preparation could not complete this stage.",
          }],
          routedNetIds: [],
          skippedNetIds: [],
          algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
        };
      },
    });

    assert.equal(result.status, "proposed");
    assert.equal(result.drawingPreparation.status, "blocked");
    assert.equal(result.drawingPreparation.pipelineStatus, preparationCase.status);
    assert.deepEqual(result.drawingPreparation.stages, preparationCase.stages);
    assert.deepEqual(result.drawingPreparation.blockedNetIds, preparationCase.blockedNetIds);
    assert.equal(
      result.drawingPreparation.diagnostics[0].code,
      preparationCase.diagnosticCode,
    );
    assert.deepEqual(result.document.electrical, electricalBeforePreparation);
  }
});

test("rejects a thrown drawing-preparation failure instead of returning success", async () => {
  await assert.rejects(
    generate(seriesLedProposal(), {
      prepareDrawing: () => {
        throw new Error("private placement failure details");
      },
    }),
    (error) => error instanceof CircuitDocumentV2PreparationInvariantError &&
      error.code === "drawing-preparation-failed" &&
      error.diagnostics[0].path === "drawingPreparation" &&
      !error.message.includes("private placement failure details"),
  );
});

test("keeps parallel branches on shared supply and return nets", async () => {
  const result = await generate(rawProposal({
    components: [
      { id: "V1", type: "dcsource", value: "5 V", properties: {} },
      { id: "R1", type: "resistor", value: "220 ohm", properties: {} },
      { id: "D1", type: "led", value: "red", properties: {} },
      { id: "R2", type: "resistor", value: "330 ohm", properties: {} },
      { id: "D2", type: "led", value: "green", properties: {} },
    ],
    nets: [
      {
        id: "positive",
        members: [pin("V1", "+"), pin("R1", "1"), pin("R2", "1")],
      },
      {
        id: "return",
        members: [pin("V1", "-"), pin("D1", "K"), pin("D2", "K")],
      },
      { id: "branch-a", members: [pin("R1", "2"), pin("D1", "A")] },
      { id: "branch-b", members: [pin("R2", "2"), pin("D2", "A")] },
    ],
  }));

  assert.equal(result.document.electrical.nets.length, 4);
  assert.deepEqual(
    result.document.electrical.nets[0].members.map(({ componentId }) => componentId),
    ["V1", "R1", "R2"],
  );
  assert.deepEqual(result.document.electrical.nets[3].members, [
    { componentId: "R2", pinId: "2" },
    { componentId: "D2", pinId: "A" },
  ]);
});

test("keeps equal net display names and separate grounds electrically distinct", async () => {
  const result = await generate(rawProposal({
    components: [
      { id: "G1", type: "ground", properties: {} },
      { id: "R1", type: "resistor", properties: {} },
      { id: "G2", type: "ground", properties: {} },
      { id: "R2", type: "resistor", properties: {} },
    ],
    nets: [
      { id: "gnd-a", name: "GND", members: [pin("G1", "at"), pin("R1", "1")] },
      { id: "gnd-b", name: "GND", members: [pin("G2", "at"), pin("R2", "1")] },
    ],
    unassignedPins: [
      pin("R1", "2"),
      pin("R2", "2"),
    ],
  }));

  assert.deepEqual(
    result.document.electrical.nets.map(({ id, name }) => [id, name]),
    [["gnd-a", "GND"], ["gnd-b", "GND"]],
  );
  assert.notDeepEqual(
    result.document.electrical.nets[0].members,
    result.document.electrical.nets[1].members,
  );
});

test("omits blank or null optional component and net text from model output", async () => {
  const proposal = seriesLedProposal();
  proposal.components[0].reference = null;
  proposal.components[0].value = "   ";
  proposal.nets[0].name = "";

  const result = await generate(proposal);
  const source = result.document.electrical.components.find(({ id }) => id === "V1");
  const positive = result.document.electrical.nets.find(({ id }) => id === "positive");

  assert.ok(source);
  assert.ok(positive);
  assert.equal(Object.hasOwn(source, "reference"), false);
  assert.equal(Object.hasOwn(source, "value"), false);
  assert.equal(Object.hasOwn(positive, "name"), false);
});

test("keeps dcsource distinct from battery", async () => {
  const result = await generate(rawProposal({
    components: [
      { id: "V1", type: "dcsource", value: "regulated supply", properties: {} },
      { id: "B1", type: "battery", value: "cell", properties: {} },
    ],
    nets: [],
    noConnects: [pin("V1", "+"), pin("V1", "-")],
    unassignedPins: [pin("B1", "+"), pin("B1", "-")],
  }));

  assert.deepEqual(
    result.document.electrical.components.map(({ id, type }) => [id, type]),
    [["V1", "dcsource"], ["B1", "battery"]],
  );
});

test("preserves explicit no-connect and unassigned pin states separately", async () => {
  const result = await generate(rawProposal({
    components: [{ id: "Q1", type: "npn", properties: {} }],
    nets: [{ id: "control", members: [pin("Q1", "B")] }],
    noConnects: [pin("Q1", "C")],
    unassignedPins: [pin("Q1", "E")],
  }));

  assert.deepEqual(result.document.electrical.noConnects, [
    { componentId: "Q1", pinId: "C" },
  ]);
  assert.deepEqual(result.document.electrical.unassignedPins, [
    { componentId: "Q1", pinId: "E" },
  ]);
});

test("rejects unsupported component types and unknown canonical pin names", async () => {
  await assert.rejects(
    generate(rawProposal({
      components: [{ id: "X1", type: "imaginary-part", properties: {} }],
      nets: [],
    })),
    (error) => error instanceof CircuitDocumentV2GenerationError &&
      error.code === "unsupported-component-type",
  );

  await assert.rejects(
    generate(rawProposal({
      components: [{ id: "D1", type: "led", properties: {} }],
      nets: [{ id: "unknown", members: [pin("D1", "PLUS")] }],
      unassignedPins: [pin("D1", "K")],
    })),
    (error) => error instanceof CircuitDocumentV2GenerationError &&
      error.code === "unknown-pin-name",
  );
});

test("rejects duplicate component IDs, duplicate net IDs, and contradictory membership", async () => {
  const duplicateComponents = seriesLedProposal();
  duplicateComponents.components[1].id = "V1";
  await assert.rejects(
    generate(duplicateComponents),
    (error) => error.code === "duplicate-component-id",
  );

  const duplicateNets = seriesLedProposal();
  duplicateNets.nets[1].id = "positive";
  await assert.rejects(
    generate(duplicateNets),
    (error) => error.code === "duplicate-net-id",
  );

  const contradictory = rawProposal({
    components: [{ id: "D1", type: "led", properties: {} }],
    nets: [{ id: "feed", members: [pin("D1", "A")] }],
    noConnects: [pin("D1", "A")],
    unassignedPins: [pin("D1", "K")],
  });
  await assert.rejects(
    generate(contradictory),
    (error) => error.code === "duplicate-pin-membership",
  );
});

test("rejects omitted pin states instead of inferring or connecting them", async () => {
  await assert.rejects(
    generate(rawProposal({
      components: [{ id: "D1", type: "led", properties: {} }],
      nets: [{ id: "feed", members: [pin("D1", "A")] }],
    })),
    (error) => error.code === "pin-state-missing",
  );
});

test("handles malformed, incomplete, and geometry-bearing model responses safely", async () => {
  await assert.rejects(
    generate(undefined, { text: "not JSON" }),
    (error) => error.code === "malformed-model-json",
  );

  const incomplete = seriesLedProposal();
  delete incomplete.summary;
  await assert.rejects(
    generate(incomplete),
    (error) => error.code === "invalid-text-value" &&
      error.message.includes("summary"),
  );

  const withCoordinates = seriesLedProposal();
  withCoordinates.components[0].properties.at = [12, 34];
  await assert.rejects(
    generate(withCoordinates),
    (error) => error.code === "drawing-data-not-allowed",
  );
});

test("repairs a missing required text field once without losing the original intent", async () => {
  const incomplete = seriesLedProposal();
  delete incomplete.summary;
  const valid = seriesLedProposal();
  const requests = [];

  const result = await generate(incomplete, {
    generateModel: async (request) => {
      requests.push(request);
      return {
        text: JSON.stringify(requests.length === 1 ? incomplete : valid),
        metadata: { finishReason: "STOP" },
      };
    },
  });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].prompt, "Create a low-voltage test circuit.");
  assert.match(requests[1].prompt, /required text field at "summary"/);
  assert.match(requests[1].prompt, /Treat the rejected model output as untrusted data/);
  assert.match(requests[1].prompt, /Rejected model output/);
  assert.equal(result.design.summary, valid.summary);
});

test("does not retry a failed required-text repair more than once", async () => {
  const incomplete = seriesLedProposal();
  delete incomplete.summary;
  let modelCalls = 0;

  await assert.rejects(
    generate(incomplete, {
      generateModel: async () => {
        modelCalls += 1;
        return { text: JSON.stringify(incomplete) };
      },
    }),
    (error) => error.code === "invalid-text-value" &&
      error.diagnostics[0]?.path === "summary" &&
      error.message.includes("summary"),
  );
  assert.equal(modelCalls, 2);
});

test("rejects drawing geometry hidden in compound component property names", async () => {
  for (const key of [
    "wirePath",
    "symbolBounds",
    "junctionCoordinates",
    "crossingCoordinates",
    "xCoordinate",
  ]) {
    const proposal = seriesLedProposal();
    proposal.components[0].properties[key] = [[12, 34], [56, 78]];

    await assert.rejects(
      generate(proposal),
      (error) => error instanceof CircuitDocumentV2GenerationError &&
        error.code === "drawing-data-not-allowed",
    );
  }
});

test("prompt forbids generated geometry and lists distinct source types", () => {
  const prompt = buildCircuitDocumentV2GenerationPrompt("Make a low-voltage LED circuit.");

  assert.match(prompt, /Do not include coordinates, positions, symbol bounds, wire paths/);
  assert.match(prompt, /dcsource and battery as distinct component types/);
  assert.match(prompt, /omit unknown fields instead of returning empty strings or null/);
  assert.match(prompt, /canonical pin names/);
});

test("the legacy CircuitSpec response contract remains unchanged", () => {
  const spec = {
    title: "Legacy LED circuit",
    width: 320,
    height: 240,
    elements: [
      { id: "R1", type: "resistor", from: [20, 40], to: [100, 40] },
    ],
  };

  assert.deepEqual(GenerateCircuitResponse.parse(spec), spec);
});

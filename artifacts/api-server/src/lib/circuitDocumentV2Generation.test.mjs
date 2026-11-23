import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CircuitDocumentV2GenerationError,
  buildCircuitDocumentV2GenerationPrompt,
  generateCircuitDocumentV2ElectricalProposal,
} from "./circuitDocumentV2Generation.ts";
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

async function generate(raw, { id = "document-v2-test", text } = {}) {
  return generateCircuitDocumentV2ElectricalProposal({
    userId: "user-test",
    prompt: "Create a low-voltage test circuit.",
    createDocumentId: () => id,
    generateModel: async () => ({
      text: text ?? JSON.stringify(raw),
      metadata: { finishReason: "STOP" },
    }),
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

test("builds a catalog-pinned series LED proposal with an empty drawing", async () => {
  const result = await generate(seriesLedProposal());

  assert.equal(result.status, "proposed");
  assert.equal(result.document.id, "document-v2-test");
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
  assert.deepEqual(result.document.drawing, {
    units: "px",
    canvas: {},
    placements: [],
    routes: [],
    junctions: [],
    crossings: [],
    annotations: [],
  });
  assert.equal(result.validation.scope, "document-structure-only");
  assert.equal(result.validation.isValid, true);
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
    (error) => error.code === "invalid-response",
  );

  const withCoordinates = seriesLedProposal();
  withCoordinates.components[0].properties.at = [12, 34];
  await assert.rejects(
    generate(withCoordinates),
    (error) => error.code === "drawing-data-not-allowed",
  );
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

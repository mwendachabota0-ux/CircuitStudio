import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { test } from "node:test";
import { createCircuitDocumentV2GenerationRouter } from "./circuitDocumentV2Generation.ts";
import {
  CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
  prepareCircuitDocumentDrawing,
} from "../../../../lib/circuit-document/src/index.ts";

const modelText = JSON.stringify({
  title: "Unconnected DC source study",
  summary: "A source with one intentional no-connect and one unresolved pin.",
  components: [
    { id: "V1", type: "dcsource", value: "5 V", properties: {} },
  ],
  nets: [],
  noConnects: [{ componentId: "V1", pinName: "+" }],
  unassignedPins: [{ componentId: "V1", pinName: "-" }],
  assumptions: [],
  uncertainties: ["The return connection is not specified."],
  questions: ["What should connect to the negative terminal?"],
});

const seriesModelText = JSON.stringify({
  title: "Series LED",
  summary: "A battery powers one LED through a current-limiting resistor.",
  components: [
    { id: "V1", type: "battery", reference: "B1", value: "9 V", properties: {} },
    { id: "R1", type: "resistor", reference: "R1", value: "330 ohm", properties: {} },
    { id: "D1", type: "led", reference: "D1", value: "red", properties: {} },
  ],
  nets: [
    { id: "positive", name: "VCC", members: [{ componentId: "V1", pinName: "+" }, { componentId: "R1", pinName: "1" }] },
    { id: "led-feed", name: "LED", members: [{ componentId: "R1", pinName: "2" }, { componentId: "D1", pinName: "A" }] },
    { id: "return", name: "GND", members: [{ componentId: "D1", pinName: "K" }, { componentId: "V1", pinName: "-" }] },
  ],
  noConnects: [],
  unassignedPins: [],
  assumptions: [],
  uncertainties: [],
  questions: [],
});

const singleNetModelText = JSON.stringify({
  title: "Source-to-resistor study",
  summary: "One source connection is routed and remaining pins are left explicit.",
  components: [
    { id: "V1", type: "battery", value: "9 V", properties: {} },
    { id: "R1", type: "resistor", value: "330 ohm", properties: {} },
  ],
  nets: [{
    id: "supply",
    name: "VCC",
    members: [
      { componentId: "V1", pinName: "+" },
      { componentId: "R1", pinName: "1" },
    ],
  }],
  noConnects: [],
  unassignedPins: [
    { componentId: "V1", pinName: "-" },
    { componentId: "R1", pinName: "2" },
  ],
  assumptions: [],
  uncertainties: [],
  questions: [],
});

const partialTransistorModelText = JSON.stringify({
  title: "Single transistor switch",
  summary: "A transistor controls a load with a resistor input and return.",
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
      members: [
        { componentId: "R_INPUT", pinName: "2" },
        { componentId: "Q1", pinName: "B" },
        { componentId: "R_PULLDOWN", pinName: "1" },
      ],
    },
    {
      id: "return",
      name: "GND",
      members: [
        { componentId: "Q1", pinName: "E" },
        { componentId: "R_PULLDOWN", pinName: "2" },
        { componentId: "GND1", pinName: "at" },
        { componentId: "V1", pinName: "-" },
      ],
    },
    { id: "supply", name: "VCC", members: [{ componentId: "V1", pinName: "+" }] },
  ],
  noConnects: [],
  unassignedPins: [
    { componentId: "Q1", pinName: "C" },
    { componentId: "R_INPUT", pinName: "1" },
  ],
  assumptions: [],
  uncertainties: [],
  questions: [],
});

async function withApi(run, options = {}) {
  let modelCalls = 0;
  const app = express();
  app.use(express.json());
  app.use((request, _response, next) => {
    request.log = {
      info() {},
      warn() {},
      error() {},
    };
    next();
  });
  app.use(
    "/api",
    createCircuitDocumentV2GenerationRouter({
      resolveUserId: (request) => request.header("x-test-user"),
      createDocumentId: () => "staged-document-id",
      ...(options.prepareDrawing ? { prepareDrawing: options.prepareDrawing } : {}),
      ...(options.generateWithAccountUsage
        ? { generateWithAccountUsage: options.generateWithAccountUsage }
        : {
          generateModel: async (input) => {
            modelCalls += 1;
            if (options.generateModel) return options.generateModel(input);
            return { text: modelText, metadata: { responseCharacters: modelText.length } };
          },
        }),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const url = `http://127.0.0.1:${address.port}/api/circuit-documents/v2/generate`;
  try {
    await run({ url, get modelCalls() { return modelCalls; } });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function request(url, body, userId) {
  const headers = { "content-type": "application/json" };
  if (userId) headers["x-test-user"] = userId;
  return fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

test("requires a signed-in user before calling Gemini", async () => {
  await withApi(async (api) => {
    const response = await request(
      api.url,
      { prompt: "Create a small LED circuit." },
    );

    assert.equal(response.status, 401);
    assert.equal(api.modelCalls, 0);
  });
});

test("validates prompt input and blocks unsafe mains-side charger requests", async () => {
  await withApi(async ({ url, modelCalls }) => {
    const invalid = await request(url, { prompt: "short" }, "user-a");
    assert.equal(invalid.status, 400);
    assert.equal(modelCalls, 0);

    const blocked = await request(
      url,
      { prompt: "Design a phone charger directly from 220-240V AC mains." },
      "user-a",
    );
    assert.equal(blocked.status, 422);
    assert.match((await blocked.json()).error, /low-voltage-only/i);
    assert.equal(modelCalls, 0);
  });
});

test("returns a staged proposal with its simple component placed", async () => {
  await withApi(async (api) => {
    const response = await request(
      api.url,
      { prompt: "Create a small LED circuit." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(api.modelCalls, 1);
    assert.equal(result.status, "proposed");
    assert.equal(result.document.id, "staged-document-id");
    assert.equal(result.drawingPreparation.status, "ready");
    assert.equal(result.drawingPreparation.pipelineStatus, "complete");
    assert.equal(result.document.drawing.placements.length, 1);
    assert.deepEqual(result.document.drawing.routes, []);
    assert.deepEqual(result.document.electrical.unassignedPins, [
      { componentId: "V1", pinId: "-" },
    ]);
    assert.deepEqual(result.design.questions, [
      "What should connect to the negative terminal?",
    ]);
    assert.equal(result.validation.scope, "document-structure-only");
  });
});

test("generates and returns a fully placed and routed single-net proposal", async () => {
  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a low-voltage source-to-resistor connection." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.status, "proposed");
    assert.equal(result.drawingPreparation.status, "ready");
    assert.equal(result.drawingPreparation.pipelineStatus, "complete");
    assert.deepEqual(result.drawingPreparation.stages, {
      placement: "complete",
      routing: "complete",
    });
    assert.equal(result.document.drawing.placements.length, 2);
    assert.equal(result.document.drawing.routes.length, 1);
    assert.deepEqual(result.drawingPreparation.routedNetIds, ["supply"]);
    assert.deepEqual(result.drawingPreparation.blockedNetIds, []);
  }, { generateModel: async () => ({ text: singleNetModelText }) });
});

test("returns an accurately partial routed series LED proposal without changing its electrical model", async () => {
  let electricalBeforePreparation;
  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a simple low-voltage series LED circuit." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.status, "proposed");
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
  }, {
    generateModel: async () => ({ text: seriesModelText }),
    prepareDrawing: (request) => {
      electricalBeforePreparation = structuredClone(request.document.electrical);
      return prepareCircuitDocumentDrawing(request);
    },
  });
});

test("returns partial routing status and identifies blocked nets", async () => {
  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a low-voltage transistor switch." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
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
    assert.deepEqual(result.document.electrical.unassignedPins, [
      { componentId: "Q1", pinId: "C" },
      { componentId: "R_INPUT", pinId: "1" },
    ]);
  }, { generateModel: async () => ({ text: partialTransistorModelText }) });
});

test("returns a blocked preparation with diagnostics and retains the electrical proposal", async () => {
  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a small LED circuit." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.status, "proposed");
    assert.equal(result.drawingPreparation.status, "blocked");
    assert.equal(result.drawingPreparation.pipelineStatus, "invalid-input");
    assert.deepEqual(result.document.drawing.placements, []);
    assert.deepEqual(result.document.electrical.unassignedPins, [
      { componentId: "V1", pinId: "-" },
    ]);
    assert.equal(
      result.drawingPreparation.diagnostics[0].code,
      "drawing-preparation-version-unsupported",
    );
  }, {
    prepareDrawing: () => ({
      status: "invalid-input",
      diagnostics: [{
        code: "drawing-preparation-version-unsupported",
        severity: "error",
        path: "algorithmVersion",
        message: "Drawing preparation could not start.",
      }],
      stages: { placement: "not-run", routing: "not-run" },
      routedNetIds: [],
      skippedNetIds: [],
      blockedNetIds: [],
      algorithmVersion: CIRCUIT_DRAWING_PREPARATION_ALGORITHM_VERSION,
    }),
  });
});

test("returns an internal diagnostic instead of accepting changed electrical data", async () => {
  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a simple low-voltage series LED circuit." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 500);
    assert.equal(result.code, "prepared-electrical-model-changed");
    assert.equal(result.diagnostics[0].path, "document.electrical");
  }, {
    generateModel: async () => ({ text: seriesModelText }),
    prepareDrawing: (request) => {
      const result = prepareCircuitDocumentDrawing(request);
      result.document.electrical.nets[0].name = "unexpectedly changed";
      return result;
    },
  });
});

test("continues truncated JSON with the partial response and resumes after its Gemini key", async () => {
  const partialOutput = modelText.slice(0, 64);
  const responses = [
    {
      text: partialOutput,
      candidates: [{ finishReason: "MAX_TOKENS" }],
    },
    {
      text: modelText,
      candidates: [{ finishReason: "STOP" }],
      usageMetadata: { totalTokenCount: 80 },
    },
  ];
  const accountCalls = [];
  const modelRequests = [];
  const generateWithAccountUsage = async (userId, usageOptions, generate) => {
    const attempt = accountCalls.length;
    accountCalls.push({ userId, ...usageOptions });
    usageOptions.onKeyUsed?.(attempt === 0 ? 4 : 5);

    const response = responses[attempt];
    assert.ok(response, "expected one model response per generation attempt");
    return generate({
      models: {
        generateContent: async (request) => {
          modelRequests.push(request);
          return response;
        },
      },
    });
  };

  await withApi(async ({ url }) => {
    const response = await request(
      url,
      { prompt: "Create a small LED circuit." },
      "user-a",
    );
    const result = await response.json();

    assert.equal(response.status, 200);
    assert.equal(result.status, "proposed");
    assert.equal(accountCalls.length, 2);
    assert.equal(accountCalls[0].userId, "user-a");
    assert.equal(accountCalls[0].afterKeyNumber, undefined);
    assert.equal(accountCalls[1].afterKeyNumber, 4);
    assert.equal(modelRequests.length, 2);
    assert.equal(modelRequests[0].contents, "Create a small LED circuit.");
    assert.ok(modelRequests[1].contents.includes(partialOutput));
    assert.match(modelRequests[1].contents, /electrical-only schema/);
    assert.equal(modelRequests[0].config.thinkingConfig.thinkingBudget, 1024);
    assert.equal(modelRequests[1].config.thinkingConfig.thinkingBudget, 512);
  }, { generateWithAccountUsage });
});

test("returns a structured safe failure when Gemini generation fails", async () => {
  await withApi(
    async (api) => {
      const response = await request(
        api.url,
        { prompt: "Create a small LED circuit." },
        "user-a",
      );
      const result = await response.json();

      assert.equal(response.status, 502);
      assert.equal(api.modelCalls, 1);
      assert.equal(result.code, "generation-failed");
      assert.deepEqual(result.diagnostics, []);
      assert.doesNotMatch(JSON.stringify(result), /private provider failure/);
    },
    {
      generateModel: async () => {
        throw new Error("private provider failure detail");
      },
    },
  );
});

test("returns model-format diagnostics without echoing the raw response", async () => {
  await withApi(
    async ({ url }) => {
      const response = await request(
        url,
        { prompt: "Create a small LED circuit." },
        "user-a",
      );
      const result = await response.json();

      assert.equal(response.status, 502);
      assert.equal(result.code, "malformed-model-json");
      assert.equal(result.diagnostics[0].path, "response");
    },
    { generateModel: async () => ({ text: "secret user content is not echoed" }) },
  );
});

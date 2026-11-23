import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { test } from "node:test";
import { createCircuitDocumentV2GenerationRouter } from "./circuitDocumentV2Generation.ts";

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

test("returns a staged proposal without saving or drawing the circuit", async () => {
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
    assert.deepEqual(result.document.drawing.placements, []);
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

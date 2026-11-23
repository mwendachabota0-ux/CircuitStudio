import assert from "node:assert/strict";
import express from "express";
import { once } from "node:events";
import { test } from "node:test";
import { createCircuitDocumentV2Draft } from "@workspace/circuit-document";
import { createCircuitDocumentV2DraftPersistence } from "../lib/circuitDocumentDraftService.ts";
import { createCircuitDocumentV2DraftRouter } from "./circuitDocumentDrafts.ts";
import { circuitDocumentFixtures } from "../../../../lib/circuit-document/test/fixtures/v2-fixtures.mjs";

const fixture = (name) => {
  const value = circuitDocumentFixtures.find((entry) => entry.name === name);
  assert.ok(value, `Expected fixture "${name}" to exist.`);
  return value.document;
};

class MemoryDraftRepository {
  records = new Map();
  failNextRead = false;
  failNextWrite = false;

  key(userId, sessionId) {
    return `${userId}\u0000${sessionId}`;
  }

  async createIfAbsent(record) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("private storage failure detail");
    }
    const key = this.key(record.userId, record.sessionId);
    if (this.records.has(key)) return null;
    this.records.set(key, structuredClone(record));
    return structuredClone(record);
  }

  async updateIfRevision(record, expectedRevision) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("private storage failure detail");
    }
    const key = this.key(record.userId, record.sessionId);
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) return null;
    const updated = { ...record, revision: current.revision + 1 };
    this.records.set(key, structuredClone(updated));
    return structuredClone(updated);
  }

  async getOwned(userId, sessionId) {
    if (this.failNextRead) {
      this.failNextRead = false;
      throw new Error("private storage failure detail");
    }
    return structuredClone(this.records.get(this.key(userId, sessionId)) ?? null);
  }
}

async function withApi(run) {
  const repository = new MemoryDraftRepository();
  const persistence = createCircuitDocumentV2DraftPersistence(
    repository,
    () => new Date("2026-11-22T12:00:00.000Z"),
  );
  const app = express();
  app.use(express.json());
  app.use(
    "/api",
    createCircuitDocumentV2DraftRouter({
      persistence,
      resolveUserId: (request) => request.header("x-test-user"),
    }),
  );
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  const baseUrl = `http://127.0.0.1:${address.port}/api`;

  try {
    await run({ baseUrl, repository });
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function request(baseUrl, method, sessionId, userId, body) {
  const headers = {};
  if (userId) headers["x-test-user"] = userId;
  if (body !== undefined) headers["content-type"] = "application/json";
  return fetch(
    `${baseUrl}/circuit-documents/v2/sessions/${encodeURIComponent(sessionId)}`,
    {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    },
  );
}

test("unauthenticated requests cannot read or write V2 documents", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    const read = await request(baseUrl, "GET", "session-a");
    const write = await request(
      baseUrl,
      "PUT",
      "session-a",
      undefined,
      { expectedRevision: 0, draft: createCircuitDocumentV2Draft(fixture("series LED")) },
    );

    assert.equal(read.status, 401);
    assert.equal((await read.json()).code, "authentication-required");
    assert.equal(write.status, 401);
    assert.equal((await write.json()).code, "authentication-required");
    assert.equal(repository.records.size, 0);
  });
});

test("an empty V2 read is distinct and does not inspect legacy history", async () => {
  await withApi(async ({ baseUrl }) => {
    const response = await request(baseUrl, "GET", "legacy-session", "user-a");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { status: "empty" });
  });
});

test("users cannot read or overwrite another user's same-session document", async () => {
  await withApi(async ({ baseUrl }) => {
    const original = createCircuitDocumentV2Draft(fixture("series LED"));
    const changed = createCircuitDocumentV2Draft(fixture("parallel branches"));
    const created = await request(baseUrl, "PUT", "shared-session", "user-a", {
      expectedRevision: 0,
      draft: original,
    });
    assert.equal(created.status, 200);

    const otherUserRead = await request(
      baseUrl,
      "GET",
      "shared-session",
      "user-b",
    );
    assert.deepEqual(await otherUserRead.json(), { status: "empty" });

    const otherUserUpdate = await request(
      baseUrl,
      "PUT",
      "shared-session",
      "user-b",
      { expectedRevision: 1, draft: changed },
    );
    assert.equal(otherUserUpdate.status, 409);
    assert.equal((await otherUserUpdate.json()).code, "revision-conflict");

    const ownerRead = await request(
      baseUrl,
      "GET",
      "shared-session",
      "user-a",
    );
    assert.deepEqual((await ownerRead.json()).draft, original);
  });
});

test("caller-supplied userId is rejected and never controls ownership", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    const response = await request(
      baseUrl,
      "PUT",
      "session-a",
      "user-a",
      {
        userId: "user-b",
        expectedRevision: 0,
        draft: createCircuitDocumentV2Draft(fixture("series LED")),
      },
    );
    const error = await response.json();

    assert.equal(response.status, 400);
    assert.equal(error.code, "invalid-request");
    assert.deepEqual(error.diagnostics, [
      { path: "userId", message: "Unexpected request field." },
    ]);
    assert.equal(repository.records.size, 0);
  });
});

test("a valid V2 document round-trips electrical and drawing details", async () => {
  await withApi(async ({ baseUrl }) => {
    const original = createCircuitDocumentV2Draft(
      fixture("separate crossing nets"),
    );
    const saved = await request(baseUrl, "PUT", "crossing-session", "user-a", {
      expectedRevision: 0,
      draft: original,
    });
    const savedBody = await saved.json();

    assert.equal(saved.status, 200);
    assert.equal(savedBody.status, "saved");
    assert.equal(savedBody.representation, "circuit-document-v2");
    assert.equal(savedBody.schemaVersion, 2);
    assert.equal(savedBody.revision, 1);
    assert.equal(savedBody.updatedAt, "2026-11-22T12:00:00.000Z");
    assert.deepEqual(savedBody.draft, original);

    const loaded = await request(
      baseUrl,
      "GET",
      "crossing-session",
      "user-a",
    );
    const loadedBody = await loaded.json();
    assert.equal(loaded.status, 200);
    assert.equal(loadedBody.revision, 1);
    assert.deepEqual(loadedBody.draft.document.electrical, original.document.electrical);
    assert.deepEqual(loadedBody.draft.document.drawing, original.document.drawing);
  });
});

test("malformed, mixed, and future envelopes are rejected without partial writes", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    const valid = createCircuitDocumentV2Draft(fixture("series LED"));
    const initial = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 0,
      draft: valid,
    });
    assert.equal(initial.status, 200);

    const mixed = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 1,
      draft: { ...valid, currentSpec: { title: "legacy", elements: [] } },
    });
    assert.equal(mixed.status, 400);
    assert.equal((await mixed.json()).code, "mixed-representations");

    const malformed = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 1,
      draft: { ...valid, document: { ...valid.document, unknownField: true } },
    });
    assert.equal(malformed.status, 400);
    assert.equal((await malformed.json()).code, "invalid-document");

    const future = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 1,
      draft: {
        ...valid,
        document: { ...valid.document, schemaVersion: 3 },
      },
    });
    assert.equal(future.status, 400);

    const stored = await request(baseUrl, "GET", "session-a", "user-a");
    assert.deepEqual((await stored.json()).draft, valid);
    assert.equal(repository.records.size, 1);
  });
});

test("stale and concurrent writes return conflicts without losing an update", async () => {
  await withApi(async ({ baseUrl }) => {
    const original = createCircuitDocumentV2Draft(fixture("series LED"));
    const firstUpdate = createCircuitDocumentV2Draft(
      fixture("parallel branches"),
    );
    const secondUpdate = createCircuitDocumentV2Draft(
      fixture("single-transistor switch"),
    );
    await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 0,
      draft: original,
    });

    const results = await Promise.all([
      request(baseUrl, "PUT", "session-a", "user-a", {
        expectedRevision: 1,
        draft: firstUpdate,
      }),
      request(baseUrl, "PUT", "session-a", "user-a", {
        expectedRevision: 1,
        draft: secondUpdate,
      }),
    ]);
    assert.deepEqual(results.map((result) => result.status).sort(), [200, 409]);

    const staleReplay = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 1,
      draft: original,
    });
    assert.equal(staleReplay.status, 409);
    const latest = await request(baseUrl, "GET", "session-a", "user-a");
    const latestBody = await latest.json();
    assert.equal(latestBody.revision, 2);
    assert.ok(
      JSON.stringify(latestBody.draft) === JSON.stringify(firstUpdate) ||
        JSON.stringify(latestBody.draft) === JSON.stringify(secondUpdate),
    );
  });
});

test("storage failures return safe typed errors instead of false success", async () => {
  await withApi(async ({ baseUrl, repository }) => {
    repository.failNextWrite = true;
    const write = await request(baseUrl, "PUT", "session-a", "user-a", {
      expectedRevision: 0,
      draft: createCircuitDocumentV2Draft(fixture("series LED")),
    });
    const writeError = await write.json();

    assert.equal(write.status, 503);
    assert.equal(writeError.code, "storage-failed");
    assert.doesNotMatch(JSON.stringify(writeError), /private storage failure detail/);

    repository.failNextRead = true;
    const read = await request(baseUrl, "GET", "session-a", "user-a");
    const readError = await read.json();
    assert.equal(read.status, 503);
    assert.equal(readError.code, "storage-failed");
    assert.doesNotMatch(JSON.stringify(readError), /private storage failure detail/);
  });
});

import assert from "node:assert/strict";
import { test } from "node:test";
import { createCircuitDocumentV2Draft } from "@workspace/circuit-document";
import { createCircuitDocumentV2DraftPersistence } from "./circuitDocumentDraftService.ts";
import { circuitDocumentFixtures } from "../../../../lib/circuit-document/test/fixtures/v2-fixtures.mjs";

const fixture = (name) => {
  const value = circuitDocumentFixtures.find((entry) => entry.name === name);
  assert.ok(value, `Expected fixture "${name}" to exist.`);
  return value.document;
};

class MemoryDraftRepository {
  records = new Map();
  failNextWrite = false;

  key(userId, sessionId) {
    return `${userId}\u0000${sessionId}`;
  }

  async createIfAbsent(record) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated transaction failure");
    }
    const key = this.key(record.userId, record.sessionId);
    if (this.records.has(key)) return null;
    this.records.set(key, structuredClone(record));
    return structuredClone(record);
  }

  async updateIfRevision(record, expectedRevision) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated transaction failure");
    }
    const key = this.key(record.userId, record.sessionId);
    const current = this.records.get(key);
    if (!current || current.revision !== expectedRevision) return null;
    const updated = { ...record, revision: current.revision + 1 };
    this.records.set(
      key,
      structuredClone(updated),
    );
    return structuredClone(updated);
  }

  async seedOwned(record) {
    this.records.set(
      this.key(record.userId, record.sessionId),
      structuredClone(record),
    );
  }

  async getOwned(userId, sessionId) {
    return structuredClone(
      this.records.get(this.key(userId, sessionId)) ?? null,
    );
  }
}

function persistenceFor(repository) {
  return createCircuitDocumentV2DraftPersistence(
    repository,
    () => new Date("2026-11-22T12:00:00.000Z"),
  );
}

test("server persistence round-trips a complete v2 draft without legacy projection", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const original = fixture("unassigned pin");
  const saved = await persistence.save(
    "user-a",
    "session-a",
    0,
    createCircuitDocumentV2Draft(original),
  );
  const loaded = await persistence.load("user-a", "session-a");

  assert.equal(saved.status, "saved");
  assert.equal(saved.revision, 1);
  assert.equal(loaded.status, "loaded");
  assert.equal(loaded.revision, 1);
  assert.deepEqual(loaded.draft.document, original);
  assert.deepEqual(
    loaded.draft.document.electrical.unassignedPins,
    original.electrical.unassignedPins,
  );
});

test("same-name nets, separate grounds, crossings, branches, and pin states survive server reload", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const names = [
    "duplicate display names",
    "separate ground nets",
    "intentional no-connect",
    "unassigned pin",
    "separate crossing nets",
    "shared branch net",
  ];

  for (const [index, name] of names.entries()) {
    const original = fixture(name);
    const saved = await persistence.save(
      "user-a",
      `session-${index}`,
      0,
      createCircuitDocumentV2Draft(original),
    );
    const loaded = await persistence.load("user-a", `session-${index}`);

    assert.equal(saved.status, "saved", name);
    assert.equal(loaded.status, "loaded", name);
    assert.deepEqual(
      loaded.draft.document.electrical,
      original.electrical,
      name,
    );
    assert.deepEqual(
      loaded.draft.document.drawing.routes,
      original.drawing.routes,
      name,
    );
    assert.deepEqual(
      loaded.draft.document.drawing.crossings,
      original.drawing.crossings,
      name,
    );
  }
});

test("session IDs are scoped to the signed-in user for reads and writes", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const original = fixture("series LED");
  const other = { ...fixture("parallel branches"), id: original.id };

  assert.equal(
    (
      await persistence.save(
        "user-a",
        "shared-session",
        0,
        createCircuitDocumentV2Draft(original),
      )
    ).status,
    "saved",
  );
  assert.equal(
    (await persistence.load("user-b", "shared-session")).status,
    "empty",
  );
  assert.equal(
    (
      await persistence.save(
        "user-b",
        "shared-session",
        0,
        createCircuitDocumentV2Draft(other),
      )
    ).status,
    "saved",
  );
  assert.deepEqual(
    (await persistence.load("user-a", "shared-session")).draft.document,
    original,
  );
  assert.deepEqual(
    (await persistence.load("user-b", "shared-session")).draft.document,
    other,
  );
});

test("malformed, mixed, and unsupported future documents do not overwrite valid data", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const existing = createCircuitDocumentV2Draft(fixture("series LED"));
  await persistence.save("user-a", "session-a", 0, existing);
  const malformed = await persistence.save(
    "user-a",
    "session-a",
    1,
    {
      format: "circuit-studio-draft",
      envelopeVersion: 1,
      representation: "circuit-document-v2",
      document: { schemaVersion: 2, electrical: {} },
    },
  );
  const mixed = await persistence.save("user-a", "session-a", 1, {
    ...existing,
    currentSpec: { title: "stale", elements: [] },
  });
  const future = await persistence.save("user-a", "session-a", 1, {
    ...existing,
    document: { ...existing.document, schemaVersion: 3 },
  });

  assert.equal(malformed.status, "rejected");
  assert.equal(malformed.code, "invalid-document");
  assert.equal(mixed.status, "rejected");
  assert.equal(mixed.code, "mixed-representations");
  assert.equal(future.status, "rejected");
  assert.equal(future.code, "unsupported-schema-version");
  assert.deepEqual(
    (await persistence.load("user-a", "session-a")).draft,
    existing,
  );
});

test("unknown stored schema versions are quarantined without changing the stored value", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const future = {
    ...createCircuitDocumentV2Draft(fixture("series LED")),
    document: { ...fixture("series LED"), schemaVersion: 4 },
  };
  await repository.seedOwned({
    userId: "user-a",
    sessionId: "future-session",
    representation: "circuit-document-v2",
    schemaVersion: 4,
    revision: 1,
    draft: future,
    updatedAt: new Date("2026-11-22T12:00:00.000Z"),
  });

  const loaded = await persistence.load("user-a", "future-session");

  assert.equal(loaded.status, "quarantined");
  assert.equal(loaded.code, "unsupported-schema-version");
  assert.deepEqual(loaded.rawDraft, future);
  assert.equal(
    (await repository.getOwned("user-a", "future-session")).schemaVersion,
    4,
  );
});

test("a failed save leaves the last complete document and metadata intact", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const previous = createCircuitDocumentV2Draft(fixture("series LED"));
  await persistence.save("user-a", "session-a", 0, previous);
  const previousRecord = await repository.getOwned("user-a", "session-a");

  repository.failNextWrite = true;
  const result = await persistence.save(
    "user-a",
    "session-a",
    1,
    createCircuitDocumentV2Draft(fixture("parallel branches")),
  );

  assert.equal(result.status, "failed");
  assert.equal(result.code, "storage-failed");
  assert.deepEqual(
    await repository.getOwned("user-a", "session-a"),
    previousRecord,
  );
});

test("legacy specs and invalid user/session scopes are not accepted as v2 writes", async () => {
  const persistence = persistenceFor(new MemoryDraftRepository());
  const legacy = await persistence.save("user-a", "session-a", 0, {
    title: "Old session",
    elements: [{ type: "ground", at: [20, 20] }],
  });
  const invalidScope = await persistence.save(
    "user-a",
    "",
    0,
    createCircuitDocumentV2Draft(fixture("series LED")),
  );

  assert.equal(legacy.status, "rejected");
  assert.equal(legacy.code, "wrong-representation");
  assert.equal(invalidScope.status, "rejected");
  assert.equal(invalidScope.code, "invalid-scope");
});

test("a legacy session with no separate v2 record stays outside v2 restoration", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);

  assert.deepEqual(await persistence.load("user-a", "legacy-session"), {
    status: "empty",
  });
  assert.equal(repository.records.size, 0);
});

test("stale revisions conflict and preserve the newer saved document", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const original = createCircuitDocumentV2Draft(fixture("series LED"));
  const newer = createCircuitDocumentV2Draft(fixture("parallel branches"));
  const first = await persistence.save("user-a", "session-a", 0, original);
  const update = await persistence.save("user-a", "session-a", 1, newer);
  const stale = await persistence.save("user-a", "session-a", 1, original);

  assert.equal(first.status, "saved");
  assert.equal(update.status, "saved");
  assert.equal(update.revision, 2);
  assert.deepEqual(stale, { status: "conflict" });
  assert.deepEqual(
    (await persistence.load("user-a", "session-a")).draft,
    newer,
  );
});

test("concurrent updates against one revision allow only one write", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const first = createCircuitDocumentV2Draft(fixture("series LED"));
  const second = createCircuitDocumentV2Draft(fixture("parallel branches"));
  await persistence.save("user-a", "session-a", 0, first);

  const results = await Promise.all([
    persistence.save("user-a", "session-a", 1, first),
    persistence.save("user-a", "session-a", 1, second),
  ]);

  assert.equal(results.filter((result) => result.status === "saved").length, 1);
  assert.equal(results.filter((result) => result.status === "conflict").length, 1);
  assert.equal((await persistence.load("user-a", "session-a")).revision, 2);
});

test("creation cannot replace an existing record and replays conflict", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const original = createCircuitDocumentV2Draft(fixture("series LED"));
  const replacement = createCircuitDocumentV2Draft(fixture("parallel branches"));
  const first = await persistence.save("user-a", "session-a", 0, original);
  const repeatedCreate = await persistence.save(
    "user-a",
    "session-a",
    0,
    replacement,
  );
  const repeatedUpdate = await persistence.save(
    "user-a",
    "session-a",
    first.revision,
    replacement,
  );
  const replayedUpdate = await persistence.save(
    "user-a",
    "session-a",
    first.revision,
    replacement,
  );

  assert.deepEqual(repeatedCreate, { status: "conflict" });
  assert.equal(repeatedUpdate.status, "saved");
  assert.deepEqual(replayedUpdate, { status: "conflict" });
});

test("invalid expected revisions are rejected before storage", async () => {
  const repository = new MemoryDraftRepository();
  const persistence = persistenceFor(repository);
  const result = await persistence.save(
    "user-a",
    "session-a",
    Number.NaN,
    createCircuitDocumentV2Draft(fixture("series LED")),
  );

  assert.equal(result.status, "rejected");
  assert.equal(result.code, "invalid-revision");
  assert.equal(repository.records.size, 0);
});

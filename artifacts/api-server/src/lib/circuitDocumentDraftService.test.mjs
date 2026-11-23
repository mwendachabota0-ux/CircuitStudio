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

  async upsertOwned(record) {
    if (this.failNextWrite) {
      this.failNextWrite = false;
      throw new Error("simulated transaction failure");
    }
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
    createCircuitDocumentV2Draft(original),
  );
  const loaded = await persistence.load("user-a", "session-a");

  assert.equal(saved.status, "saved");
  assert.equal(loaded.status, "loaded");
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
  await persistence.save("user-a", "session-a", existing);
  const malformed = await persistence.save("user-a", "session-a", {
    format: "circuit-studio-draft",
    envelopeVersion: 1,
    representation: "circuit-document-v2",
    document: { schemaVersion: 2, electrical: {} },
  });
  const mixed = await persistence.save("user-a", "session-a", {
    ...existing,
    currentSpec: { title: "stale", elements: [] },
  });
  const future = await persistence.save("user-a", "session-a", {
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
  await repository.upsertOwned({
    userId: "user-a",
    sessionId: "future-session",
    representation: "circuit-document-v2",
    schemaVersion: 4,
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
  await persistence.save("user-a", "session-a", previous);
  const previousRecord = await repository.getOwned("user-a", "session-a");

  repository.failNextWrite = true;
  const result = await persistence.save(
    "user-a",
    "session-a",
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
  const legacy = await persistence.save("user-a", "session-a", {
    title: "Old session",
    elements: [{ type: "ground", at: [20, 20] }],
  });
  const invalidScope = await persistence.save(
    "user-a",
    "",
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

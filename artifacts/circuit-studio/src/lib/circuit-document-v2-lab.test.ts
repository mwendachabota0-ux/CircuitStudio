import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCircuitDocumentV2Copy,
  canAccessCircuitDocumentV2Lab,
  getCircuitDocumentV2DocumentSessionId,
  getCircuitDocumentV2SessionStorageKey,
  isCircuitDocumentV2RevisionConflict,
  loadCircuitDocumentV2LocalDraft,
  resolveCircuitDocumentV2FeatureFlags,
  saveCircuitDocumentV2LocalFirst,
} from "./circuit-document-v2-lab.ts";
import {
  getCircuitDocumentV2DraftStorageKey,
  validateCircuitDocumentV2,
} from "@workspace/circuit-document";
import {
  ambiguousLegacyFixture,
  circuitDocumentFixtures,
} from "../../../../lib/circuit-document/test/fixtures/v2-fixtures.mjs";
import {
  legacyCircuitTools,
  readLegacyFixture,
} from "../../../../lib/circuit-document/test/support.mjs";

class MemoryStorage {
  values = new Map<string, string>();
  failWrites = false;

  getItem(key: string) {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string) {
    if (this.failWrites) throw new Error("storage quota exceeded");
    this.values.set(key, value);
  }
}

test("V2 lab is disabled by default and sync cannot bypass database readiness", () => {
  const defaults = resolveCircuitDocumentV2FeatureFlags(undefined, undefined);
  const optedInButUnverified = resolveCircuitDocumentV2FeatureFlags(
    "true",
    "true",
  );
  const ready = resolveCircuitDocumentV2FeatureFlags("true", "true", true);

  assert.equal(defaults.labEnabled, false);
  assert.equal(defaults.serverSyncEnabled, false);
  assert.equal(optedInButUnverified.serverSyncEnabled, false);
  assert.equal(optedInButUnverified.serverSyncBlockedByDatabase, true);
  assert.equal(ready.serverSyncEnabled, true);
});

test("V2 lab access requires the same signed-in user context", () => {
  const flags = resolveCircuitDocumentV2FeatureFlags("true", undefined);
  assert.equal(flags.labEnabled, true);
  assert.equal(canAccessCircuitDocumentV2Lab(flags.labEnabled, false, "user-a"), false);
  assert.equal(canAccessCircuitDocumentV2Lab(flags.labEnabled, true, null), false);
  assert.equal(canAccessCircuitDocumentV2Lab(flags.labEnabled, true, "user-a"), true);
});

test("trusted legacy copy preserves the source and has separate stable identities", () => {
  const source = readLegacyFixture("series-led.json");
  const before = structuredClone(source);
  let id = 0;
  const result = createCircuitDocumentV2Copy(
    source,
    legacyCircuitTools,
    () => `id-${++id}`,
  );

  assert.equal(result.status, "created");
  if (result.status !== "created") return;
  assert.deepEqual(source, before);
  assert.equal(result.document.id, "v2-document-id-1");
  assert.equal(result.sessionId, "v2-session-id-2");
  assert.notEqual(result.document.id, result.sessionId);
  assert.equal(getCircuitDocumentV2DocumentSessionId(result.document), result.sessionId);
  assert.equal(validateCircuitDocumentV2(result.document).isValid, true);
});

test("untrusted import is blocked and does not write a V2 draft", async () => {
  const storage = new MemoryStorage();
  const before = structuredClone(ambiguousLegacyFixture.spec);
  const result = createCircuitDocumentV2Copy(
    ambiguousLegacyFixture.spec,
    legacyCircuitTools,
    () => "unused",
  );

  assert.equal(result.status, "blocked");
  assert.ok(result.diagnostics.length > 0);
  assert.deepEqual(ambiguousLegacyFixture.spec, before);
  assert.equal(
    storage.getItem(getCircuitDocumentV2DraftStorageKey("user-a")),
    null,
  );
});

test("V2 restore never imports a legacy-only draft automatically", () => {
  const storage = new MemoryStorage();
  const legacy = readLegacyFixture("series-led.json");
  const legacyKey = "circuit-studio-draft-v1:user-a";
  storage.setItem(legacyKey, JSON.stringify(legacy));

  const restored = loadCircuitDocumentV2LocalDraft(storage, "user-a");

  assert.deepEqual(restored, { status: "empty" });
  assert.equal(storage.getItem(legacyKey), JSON.stringify(legacy));
  assert.equal(
    storage.getItem(getCircuitDocumentV2DraftStorageKey("user-a")),
    null,
  );
});

test("V2 local save preserves complete identity, nets, and drawing detail", async () => {
  const storage = new MemoryStorage();
  const included = [
    "duplicate display names",
    "separate ground nets",
    "separate crossing nets",
    "shared branch net",
    "intentional no-connect",
    "unassigned pin",
  ];
  const selected = circuitDocumentFixtures.filter(({ name }) =>
    included.includes(name)
  );
  assert.equal(selected.length, included.length);

  for (const fixture of selected) {
    const saved = await saveCircuitDocumentV2LocalFirst({
      storage,
      userId: "user-a",
      document: fixture.document,
      sessionId: `session-${fixture.document.id}`,
      serverSyncEnabled: false,
      expectedRevision: 0,
    });
    assert.equal(saved.status, "local-only");
    const restored = loadCircuitDocumentV2LocalDraft(storage, "user-a");
    assert.equal(restored.status, "v2");
    if (restored.status === "v2") {
      assert.deepEqual(restored.draft.document, fixture.document);
    }
  }
});

test("session pointers are user-scoped and validate their session identifier", async () => {
  const storage = new MemoryStorage();
  const document = createCircuitDocumentV2Copy(
    readLegacyFixture("series-led.json"),
    legacyCircuitTools,
    () => "same",
  );
  assert.equal(document.status, "created");
  if (document.status !== "created") return;

  await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user/a",
    document: document.document,
    sessionId: document.sessionId,
    serverSyncEnabled: false,
    expectedRevision: 0,
  });

  assert.notEqual(
    getCircuitDocumentV2SessionStorageKey("user/a"),
    getCircuitDocumentV2SessionStorageKey("user-b"),
  );
  assert.equal(
    storage.getItem(getCircuitDocumentV2SessionStorageKey("user/a")),
    document.sessionId,
  );
  assert.equal(
    storage.getItem(getCircuitDocumentV2SessionStorageKey("user-b")),
    null,
  );
});

test("disabled sync makes no V2 API write and keeps the local copy", async () => {
  const storage = new MemoryStorage();
  const document = circuitDocumentFixtures[0]!.document;
  let calls = 0;
  const result = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document,
    sessionId: "session-a",
    serverSyncEnabled: false,
    expectedRevision: 0,
    saveRemote: async () => {
      calls += 1;
      return { revision: 1 };
    },
  });

  assert.equal(result.status, "local-only");
  assert.equal(calls, 0);
  assert.equal(loadCircuitDocumentV2LocalDraft(storage, "user-a").status, "v2");
});

test("a remote failure leaves the locally saved V2 draft intact", async () => {
  const storage = new MemoryStorage();
  const document = circuitDocumentFixtures[1]!.document;
  const result = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document,
    sessionId: "session-a",
    serverSyncEnabled: true,
    expectedRevision: 4,
    saveRemote: async () => {
      throw new Error("service unavailable");
    },
  });

  assert.equal(result.status, "server-unavailable");
  assert.equal(loadCircuitDocumentV2LocalDraft(storage, "user-a").status, "v2");
});

test("revision conflicts are surfaced without retrying writes", async () => {
  const storage = new MemoryStorage();
  const document = circuitDocumentFixtures[2]!.document;
  const attemptedRevisions: number[] = [];
  const result = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document,
    sessionId: "session-a",
    serverSyncEnabled: true,
    expectedRevision: 7,
    saveRemote: async ({ expectedRevision }) => {
      attemptedRevisions.push(expectedRevision);
      throw Object.assign(new Error("stale"), { status: 409 });
    },
  });

  assert.equal(result.status, "revision-conflict");
  assert.deepEqual(attemptedRevisions, [7]);
  assert.equal(isCircuitDocumentV2RevisionConflict({ status: 409 }), true);
  assert.equal(
    loadCircuitDocumentV2LocalDraft(storage, "user-a").status,
    "v2",
  );
});

test("storage failure is not reported as a successful local save", async () => {
  const storage = new MemoryStorage();
  storage.failWrites = true;
  const result = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: circuitDocumentFixtures[0]!.document,
    sessionId: "session-a",
    serverSyncEnabled: false,
    expectedRevision: 0,
  });
  assert.equal(result.status, "local-save-failed");
});

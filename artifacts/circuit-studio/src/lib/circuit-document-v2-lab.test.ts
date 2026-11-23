import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createCircuitDocumentV2Copy,
  canAccessCircuitDocumentV2Lab,
  getCircuitDocumentV2DocumentSessionId,
  getCircuitDocumentV2SessionStorageKey,
  getCircuitDocumentV2ProposalApprovalBlockReason,
  isCircuitDocumentV2RevisionConflict,
  loadCircuitDocumentV2LocalDraft,
  prepareCircuitDocumentV2ProposalForApproval,
  resolveCircuitDocumentV2FeatureFlags,
  resolveCircuitDocumentV2ProposalDecision,
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
  const defaults = resolveCircuitDocumentV2FeatureFlags(undefined, undefined);
  const flags = resolveCircuitDocumentV2FeatureFlags("true", undefined);
  assert.equal(flags.labEnabled, true);
  assert.equal(canAccessCircuitDocumentV2Lab(defaults.labEnabled, true, "user-a"), false);
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

test("saving a V2 copy leaves the legacy workbench key unchanged", async () => {
  const storage = new MemoryStorage();
  const legacy = readLegacyFixture("series-led.json");
  const legacyKey = "circuit-studio-draft-v1:user-a";
  const legacyValue = JSON.stringify(legacy);
  storage.setItem(legacyKey, legacyValue);
  const created = createCircuitDocumentV2Copy(
    legacy,
    legacyCircuitTools,
    () => "separate-session",
  );
  assert.equal(created.status, "created");
  if (created.status !== "created") return;

  const saved = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: created.document,
    sessionId: created.sessionId,
    serverSyncEnabled: false,
    expectedRevision: 0,
  });

  assert.equal(saved.status, "local-only");
  assert.equal(storage.getItem(legacyKey), legacyValue);
  assert.equal(
    loadCircuitDocumentV2LocalDraft(storage, "user-a").status,
    "v2",
  );
  assert.notEqual(
    getCircuitDocumentV2DraftStorageKey("user-a"),
    legacyKey,
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

test("proposal approval is allowed only for valid, non-blocked drawings without errors", () => {
  assert.equal(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "ready",
      isValid: true,
      diagnostics: [],
    }),
    null,
  );
  assert.equal(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "partial",
      isValid: true,
      diagnostics: [{ severity: "warning" }],
    }),
    null,
  );
  assert.match(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "blocked",
      isValid: true,
      diagnostics: [],
    }) ?? "",
    /blocked/i,
  );
  assert.match(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "partial",
      isValid: false,
      diagnostics: [],
    }) ?? "",
    /validation/i,
  );
  assert.match(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "partial",
      isValid: true,
      diagnostics: [{ severity: "error" }],
    }) ?? "",
    /error-level/i,
  );
  assert.match(
    getCircuitDocumentV2ProposalApprovalBlockReason({
      status: "ready",
      isValid: true,
      diagnostics: [],
      currentDraftQuarantined: true,
    }) ?? "",
    /quarantined/i,
  );
});

test("rejecting a proposal leaves the current saved V2 draft unchanged", async () => {
  const currentDraft = circuitDocumentFixtures[0]!.document;
  const proposalDocument = circuitDocumentFixtures[1]!.document;
  const storage = new MemoryStorage();
  await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: currentDraft,
    sessionId: "active-session",
    serverSyncEnabled: false,
    expectedRevision: 0,
  });
  const savedBeforeReject = storage.getItem(
    getCircuitDocumentV2DraftStorageKey("user-a"),
  );

  const rejected = resolveCircuitDocumentV2ProposalDecision(
    currentDraft,
    proposalDocument,
    "reject",
  );
  assert.strictEqual(rejected.currentDocument, currentDraft);
  assert.equal(rejected.proposedDocument, null);
  assert.equal(
    storage.getItem(getCircuitDocumentV2DraftStorageKey("user-a")),
    savedBeforeReject,
  );

  const approved = resolveCircuitDocumentV2ProposalDecision(
    currentDraft,
    proposalDocument,
    "approve",
  );
  assert.strictEqual(approved.currentDocument, proposalDocument);
  assert.equal(approved.proposedDocument, null);
});

test("proposal approval keeps the active session or creates one without mutating the proposal", () => {
  const proposalDocument = circuitDocumentFixtures[0]!.document;
  const before = structuredClone(proposalDocument);

  const activeSession = prepareCircuitDocumentV2ProposalForApproval(
    proposalDocument,
    "active-session",
    () => "unused",
  );
  assert.equal(activeSession.sessionId, "active-session");
  assert.equal(
    getCircuitDocumentV2DocumentSessionId(activeSession.document),
    "active-session",
  );

  const newSession = prepareCircuitDocumentV2ProposalForApproval(
    proposalDocument,
    null,
    () => "new-session",
  );
  assert.equal(newSession.sessionId, "v2-session-new-session");
  assert.equal(
    getCircuitDocumentV2DocumentSessionId(newSession.document),
    "v2-session-new-session",
  );
  assert.deepEqual(proposalDocument, before);
});

test("approved proposals use local V2 persistence and keep the existing draft on save failure", async () => {
  const storage = new MemoryStorage();
  const currentDraft = circuitDocumentFixtures[0]!.document;
  const proposalDocument = circuitDocumentFixtures[1]!.document;
  const existingSave = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: currentDraft,
    sessionId: "active-session",
    serverSyncEnabled: false,
    expectedRevision: 0,
  });
  assert.equal(existingSave.status, "local-only");

  const approved = prepareCircuitDocumentV2ProposalForApproval(
    proposalDocument,
    "active-session",
    () => "unused",
  );
  let remoteCalls = 0;
  const saved = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: approved.document,
    sessionId: approved.sessionId,
    serverSyncEnabled: false,
    expectedRevision: 0,
    saveRemote: async () => {
      remoteCalls += 1;
      return { revision: 1 };
    },
  });
  assert.equal(saved.status, "local-only");
  assert.equal(remoteCalls, 0);
  const restored = loadCircuitDocumentV2LocalDraft(storage, "user-a");
  assert.equal(restored.status, "v2");
  if (restored.status === "v2") {
    assert.deepEqual(restored.draft.document, approved.document);
    assert.equal(
      getCircuitDocumentV2DocumentSessionId(restored.draft.document),
      "active-session",
    );
  }
  const afterApproval = storage.getItem(
    getCircuitDocumentV2DraftStorageKey("user-a"),
  );
  assert.ok(afterApproval);

  storage.failWrites = true;
  const failedProposal = prepareCircuitDocumentV2ProposalForApproval(
    circuitDocumentFixtures[2]!.document,
    "active-session",
    () => "unused",
  );
  const failed = await saveCircuitDocumentV2LocalFirst({
    storage,
    userId: "user-a",
    document: failedProposal.document,
    sessionId: failedProposal.sessionId,
    serverSyncEnabled: false,
    expectedRevision: 0,
  });
  assert.equal(failed.status, "local-save-failed");
  assert.equal(
    storage.getItem(getCircuitDocumentV2DraftStorageKey("user-a")),
    afterApproval,
  );
});

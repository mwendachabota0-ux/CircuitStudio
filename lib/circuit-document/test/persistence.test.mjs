import assert from "node:assert/strict";
import { test } from "node:test";
import {
  CIRCUIT_DRAFT_ENVELOPE_VERSION,
  CIRCUIT_DRAFT_FORMAT,
  createCircuitDocumentV2Draft,
  createLegacyCircuitDraft,
  getCircuitDocumentV2DraftStorageKey,
  loadCircuitDocumentV2Draft,
  parsePersistedCircuitDraft,
  reconcileCircuitDraftCopies,
  saveCircuitDocumentV2Draft,
  serializeCircuitDocumentV2,
} from "../src/index.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const getFixture = (name) => {
  const fixture = circuitDocumentFixtures.find((entry) => entry.name === name);
  assert.ok(fixture, `Expected fixture "${name}" to exist.`);
  return fixture.document;
};

function canonicalElectricalState(document) {
  const references = (items) =>
    items.map(({ componentId, pinId }) => `${componentId}:${pinId}`).sort();
  return {
    components: document.electrical.components
      .map(({ id, type, pins }) => ({
        id,
        type,
        pins: pins.map((pin) => pin.id).sort(),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    nets: document.electrical.nets
      .map(({ id, name, members }) => ({
        id,
        name,
        members: references(members),
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
    noConnects: references(document.electrical.noConnects),
    unassignedPins: references(document.electrical.unassignedPins),
  };
}

class MemoryStorage {
  values = new Map();
  failWrites = false;

  getItem(key) {
    return this.values.has(key) ? this.values.get(key) : null;
  }

  setItem(key, value) {
    if (this.failWrites) throw new Error("quota exceeded");
    this.values.set(key, String(value));
  }
}

test("v2 envelope preserves the complete document, schema version, and stable IDs", () => {
  const original = getFixture("single-transistor switch");
  const draft = createCircuitDocumentV2Draft(original);
  const parsed = parsePersistedCircuitDraft(JSON.parse(JSON.stringify(draft)));

  assert.equal(parsed.status, "v2");
  assert.equal(parsed.document.schemaVersion, 2);
  assert.equal(parsed.document.id, original.id);
  assert.deepEqual(parsed.document, original);
  assert.equal(
    serializeCircuitDocumentV2(parsed.document),
    serializeCircuitDocumentV2(original),
  );
});

test("every valid Phase 1A fixture survives a persistence round-trip", () => {
  const supportedFixtures = circuitDocumentFixtures.filter(
    (fixture) => fixture.expectedValid !== false,
  );

  for (const { name, document } of supportedFixtures) {
    const parsed = parsePersistedCircuitDraft(
      JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(document))),
    );
    assert.equal(parsed.status, "v2", name);
    assert.deepEqual(parsed.document, document, name);
  }
});

test("legacy CircuitSpec values remain raw legacy drafts without conversion", () => {
  const legacy = {
    title: "Existing legacy draft",
    elements: [{ type: "ground", id: "GND1", at: [20, 30] }],
    customMetadata: { keep: true },
  };
  const parsed = parsePersistedCircuitDraft(legacy);
  const enveloped = parsePersistedCircuitDraft(
    createLegacyCircuitDraft(legacy),
  );

  assert.equal(parsed.status, "legacy");
  assert.equal(enveloped.status, "legacy");
  assert.strictEqual(parsed.document, legacy);
  assert.deepEqual(enveloped.document, legacy);
  assert.equal("electrical" in parsed.document, false);
});

test("same-name nets retain separate IDs and memberships after save and load", () => {
  const original = getFixture("duplicate display names");
  const parsed = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(original))),
  );

  assert.equal(parsed.status, "v2");
  assert.deepEqual(
    canonicalElectricalState(parsed.document),
    canonicalElectricalState(original),
  );
  assert.deepEqual(
    parsed.document.electrical.nets.map(({ id, name }) => ({ id, name })),
    [
      { id: "signal-a", name: "SIGNAL" },
      { id: "signal-b", name: "SIGNAL" },
    ],
  );
});

test("distinct ground nets remain distinct through persistence", () => {
  const original = getFixture("separate ground nets");
  const parsed = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(original))),
  );

  assert.equal(parsed.status, "v2");
  assert.deepEqual(
    canonicalElectricalState(parsed.document),
    canonicalElectricalState(original),
  );
  assert.deepEqual(parsed.document.electrical.nets.map(({ id }) => id).sort(), [
    "analog-ground",
    "digital-ground",
  ]);
});

test("no-connect markers and unassigned pins remain different states", () => {
  const noConnect = getFixture("intentional no-connect");
  const unassigned = getFixture("unassigned pin");
  const noConnectResult = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(noConnect))),
  );
  const unassignedResult = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(unassigned))),
  );

  assert.equal(noConnectResult.status, "v2");
  assert.equal(unassignedResult.status, "v2");
  assert.deepEqual(
    noConnectResult.document.electrical.noConnects,
    noConnect.electrical.noConnects,
  );
  assert.deepEqual(
    noConnectResult.document.electrical.unassignedPins,
    noConnect.electrical.unassignedPins,
  );
  assert.deepEqual(unassignedResult.document.electrical.noConnects, []);
  assert.deepEqual(
    unassignedResult.document.electrical.unassignedPins,
    unassigned.electrical.unassignedPins,
  );
});

test("crossings and same-net branches preserve their explicit topology", () => {
  const crossing = getFixture("separate crossing nets");
  const branch = getFixture("shared branch net");
  const crossingResult = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(crossing))),
  );
  const branchResult = parsePersistedCircuitDraft(
    JSON.parse(JSON.stringify(createCircuitDocumentV2Draft(branch))),
  );

  assert.equal(crossingResult.status, "v2");
  assert.deepEqual(
    crossingResult.document.drawing.crossings,
    crossing.drawing.crossings,
  );
  assert.deepEqual(
    crossingResult.document.drawing.routes.map(({ id, netId }) => ({
      id,
      netId,
    })),
    crossing.drawing.routes.map(({ id, netId }) => ({ id, netId })),
  );
  assert.equal(branchResult.status, "v2");
  assert.deepEqual(
    canonicalElectricalState(branchResult.document),
    canonicalElectricalState(branch),
  );
  assert.equal(branchResult.document.electrical.nets[0].members.length, 3);
});

test("user-scoped browser storage saves and restores v2 separately from legacy cache", () => {
  const storage = new MemoryStorage();
  const legacyKey = "circuit-studio-draft-v1:user-a";
  const legacy = {
    title: "Legacy remains",
    elements: [{ type: "ground", at: [1, 2] }],
  };
  storage.setItem(legacyKey, JSON.stringify(legacy));
  const document = getFixture("series LED");

  const saved = saveCircuitDocumentV2Draft(storage, "user/a", document);
  const loaded = loadCircuitDocumentV2Draft(storage, "user/a");

  assert.equal(saved.ok, true);
  assert.equal(loaded.status, "v2");
  assert.deepEqual(loaded.draft.document, document);
  assert.equal(storage.getItem(legacyKey), JSON.stringify(legacy));
  assert.notEqual(
    getCircuitDocumentV2DraftStorageKey("user/a"),
    getCircuitDocumentV2DraftStorageKey("user-b"),
  );
});

test("mixed legacy and v2 content in one envelope is quarantined", () => {
  const mixed = {
    ...createCircuitDocumentV2Draft(getFixture("series LED")),
    currentSpec: { title: "Stale", elements: [] },
  };
  const parsed = parsePersistedCircuitDraft(mixed);

  assert.equal(parsed.status, "quarantined");
  assert.equal(parsed.code, "mixed-representations");
  assert.strictEqual(parsed.rawValue, mixed);
});

test("identical local and server copies reconcile, while divergent copies are quarantined", () => {
  const document = getFixture("series LED");
  const local = createCircuitDocumentV2Draft(document);
  const server = JSON.parse(JSON.stringify(local));
  const resolved = reconcileCircuitDraftCopies(local, server);
  const diverged = reconcileCircuitDraftCopies(local, {
    ...createCircuitDocumentV2Draft(getFixture("parallel branches")),
    document: {
      ...getFixture("parallel branches"),
      id: document.id,
    },
  });

  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.source, "server");
  assert.deepEqual(resolved.document, document);
  assert.equal(diverged.status, "quarantined");
  assert.equal(diverged.code, "conflicting-copies");
  assert.equal(diverged.authoritativeRepresentation, "circuit-document-v2");
});

test("a v2 server copy cannot be silently merged with a legacy local draft", () => {
  const local = {
    title: "Old browser draft",
    elements: [{ type: "ground", at: [10, 10] }],
  };
  const server = createCircuitDocumentV2Draft(getFixture("series LED"));
  const result = reconcileCircuitDraftCopies(local, server);

  assert.equal(result.status, "quarantined");
  assert.equal(result.code, "mixed-representations");
  assert.equal(result.authoritativeRepresentation, "circuit-document-v2");
});

test("unknown document schema versions are preserved and quarantined", () => {
  const futureDocument = {
    ...getFixture("series LED"),
    schemaVersion: 7,
  };
  const rawValue = JSON.stringify({
    format: CIRCUIT_DRAFT_FORMAT,
    envelopeVersion: CIRCUIT_DRAFT_ENVELOPE_VERSION,
    representation: "circuit-document-v2",
    document: futureDocument,
  });
  const storage = new MemoryStorage();
  storage.setItem(getCircuitDocumentV2DraftStorageKey("user-a"), rawValue);
  const loaded = loadCircuitDocumentV2Draft(storage, "user-a");

  assert.equal(loaded.status, "quarantined");
  assert.equal(loaded.code, "unsupported-schema-version");
  assert.equal(loaded.rawValue, rawValue);
  assert.equal(
    storage.getItem(getCircuitDocumentV2DraftStorageKey("user-a")),
    rawValue,
  );
});

test("malformed JSON remains recoverable and does not crash local restore", () => {
  const storage = new MemoryStorage();
  const key = getCircuitDocumentV2DraftStorageKey("user-a");
  const rawValue = '{"broken":';
  storage.setItem(key, rawValue);

  const loaded = loadCircuitDocumentV2Draft(storage, "user-a");

  assert.equal(loaded.status, "quarantined");
  assert.equal(loaded.code, "malformed-envelope");
  assert.equal(loaded.rawValue, rawValue);
  assert.equal(storage.getItem(key), rawValue);
});

test("invalid v2 saves and failed storage writes do not replace the last valid draft", () => {
  const storage = new MemoryStorage();
  const original = getFixture("series LED");
  const key = getCircuitDocumentV2DraftStorageKey("user-a");
  const first = saveCircuitDocumentV2Draft(storage, "user-a", original);
  assert.equal(first.ok, true);
  const lastValid = storage.getItem(key);

  const invalid = saveCircuitDocumentV2Draft(storage, "user-a", {
    ...original,
    electrical: {
      ...original.electrical,
      nets: [
        { id: "duplicate", members: [] },
        { id: "duplicate", members: [] },
      ],
    },
  });
  assert.equal(invalid.ok, false);
  assert.equal(storage.getItem(key), lastValid);

  storage.failWrites = true;
  const failed = saveCircuitDocumentV2Draft(
    storage,
    "user-a",
    getFixture("parallel branches"),
  );
  assert.equal(failed.ok, false);
  assert.equal(failed.code, "storage-unavailable");
  assert.equal(storage.getItem(key), lastValid);
});

test("a legacy value in the v2 cache slot is quarantined instead of upgraded", () => {
  const storage = new MemoryStorage();
  const key = getCircuitDocumentV2DraftStorageKey("user-a");
  const rawValue = JSON.stringify({ title: "Legacy", elements: [] });
  storage.setItem(key, rawValue);

  const loaded = loadCircuitDocumentV2Draft(storage, "user-a");

  assert.equal(loaded.status, "quarantined");
  assert.equal(loaded.code, "wrong-representation");
  assert.equal(storage.getItem(key), rawValue);
});

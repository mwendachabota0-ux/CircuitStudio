import assert from "node:assert/strict";
import { test } from "node:test";
import {
  arePinsElectricallyConnected,
  checkCircuitDrawingConsistency,
  getCircuitPinDefinitions,
  parseCircuitDocumentV2,
  serializeCircuitDocumentV2,
} from "../src/index.ts";
import { validateCircuitDocumentV2 } from "../src/validation.ts";
import { circuitDocumentFixtures } from "./fixtures/v2-fixtures.mjs";

const ref = (componentId, pinId) => ({ componentId, pinId });
const fixture = (name) => circuitDocumentFixtures.find((entry) => entry.name === name);
const codes = (diagnostics) => diagnostics.map((entry) => entry.code);

for (const entry of circuitDocumentFixtures) {
  test(`v2 fixture: ${entry.name} — ${entry.purpose}`, () => {
    const serialized = serializeCircuitDocumentV2(entry.document);
    assert.equal(
      serializeCircuitDocumentV2(parseCircuitDocumentV2(serialized)),
      serialized,
    );

    const result = validateCircuitDocumentV2(entry.document);
    if (entry.expectedValid === false) {
      assert.equal(result.isValid, false);
      assert.ok(
        result.drawingErrors.some((diagnostic) => diagnostic.code === "junction-crosses-nets"),
      );
    } else {
      assert.equal(result.isValid, true);
      assert.deepEqual(result.schemaErrors, []);
      assert.deepEqual(result.electricalErrors, []);
      assert.deepEqual(result.drawingErrors, []);
    }
  });
}

test("same-net pins remain connected even when their coordinates are far apart", () => {
  const document = fixture("far-apart same-net pins").document;

  assert.equal(
    arePinsElectricallyConnected(document, ref("D1", "A"), ref("D2", "A")),
    true,
  );
  assert.ok(
    checkCircuitDrawingConsistency(document).some(
      (diagnostic) => diagnostic.code === "net-not-visibly-connected",
    ),
  );
});

test("moving routes without editing membership cannot change electrical connectivity", () => {
  const original = fixture("series LED").document;
  const moved = structuredClone(original);
  moved.drawing.routes[0].points = [[800, 900], [900, 900]];

  assert.equal(
    arePinsElectricallyConnected(original, ref("B1", "+"), ref("SW1", "1")),
    true,
  );
  assert.equal(
    arePinsElectricallyConnected(moved, ref("B1", "+"), ref("SW1", "1")),
    true,
  );
});

test("changing membership changes connectivity while all drawing coordinates stay fixed", () => {
  const original = fixture("duplicate display names").document;
  const reassigned = structuredClone(original);
  const beforeGeometry = structuredClone(reassigned.drawing);
  reassigned.electrical.nets[0].members = [];
  reassigned.electrical.nets[1].members.push(ref("D1", "A"));

  assert.equal(
    arePinsElectricallyConnected(original, ref("D1", "A"), ref("D2", "A")),
    false,
  );
  assert.equal(
    arePinsElectricallyConnected(reassigned, ref("D1", "A"), ref("D2", "A")),
    true,
  );
  assert.deepEqual(reassigned.drawing, beforeGeometry);
});

test("matching display names do not merge nets, while one shared net ID does", () => {
  const separate = fixture("duplicate display names").document;
  const shared = fixture("shared ground net").document;

  assert.equal(separate.electrical.nets[0].name, separate.electrical.nets[1].name);
  assert.notEqual(separate.electrical.nets[0].id, separate.electrical.nets[1].id);
  assert.equal(
    arePinsElectricallyConnected(separate, ref("D1", "A"), ref("D2", "A")),
    false,
  );
  assert.equal(
    arePinsElectricallyConnected(shared, ref("GND_A", "at"), ref("GND_D", "at")),
    true,
  );
});

test("different ground net IDs remain separate, and shared ground requires one ID", () => {
  const separate = fixture("separate ground nets").document;
  const shared = fixture("shared ground net").document;

  assert.equal(
    arePinsElectricallyConnected(separate, ref("GND_A", "at"), ref("GND_D", "at")),
    false,
  );
  assert.equal(
    arePinsElectricallyConnected(shared, ref("GND_A", "at"), ref("GND_D", "at")),
    true,
  );
});

test("explicit no-connects remain distinct from unknown pins", () => {
  const document = fixture("intentional no-connect").document;
  const result = validateCircuitDocumentV2(document);

  assert.deepEqual(document.electrical.noConnects, [ref("D1", "A")]);
  assert.ok(result.unassignedPins.some((entry) => entry.componentId === "D1" && entry.pinId === "K"));
  assert.ok(!result.unassignedPins.some((entry) => entry.componentId === "D1" && entry.pinId === "A"));
});

test("a pin cannot be assigned to more than one net", () => {
  const document = structuredClone(fixture("duplicate display names").document);
  document.electrical.nets[1].members.push(ref("D1", "A"));
  const result = validateCircuitDocumentV2(document);

  assert.ok(codes(result.electricalErrors).includes("duplicate-pin-reference"));
  assert.ok(codes(result.electricalErrors).includes("pin-assigned-more-than-once"));
});

test("missing components, invalid pin IDs, and missing route nets produce diagnostics", () => {
  const document = structuredClone(fixture("dcsource").document);
  document.electrical.nets.push({
    id: "bad-references",
    name: "BAD",
    members: [
      ref("MISSING", "1"),
      ref("V1", "not-a-pin"),
    ],
  });
  document.drawing.routes.push({
    id: "W_BAD",
    netId: "MISSING_NET",
    points: [[0, 0], [10, 0]],
    properties: {},
  });
  const result = validateCircuitDocumentV2(document);

  assert.ok(codes(result.electricalErrors).includes("component-reference-missing"));
  assert.ok(codes(result.electricalErrors).includes("pin-reference-invalid"));
  assert.ok(codes(result.drawingErrors).includes("route-net-missing"));
});

test("duplicate component and net IDs are detected", () => {
  const document = structuredClone(fixture("series LED").document);
  document.electrical.components.push(structuredClone(document.electrical.components[0]));
  document.electrical.nets.push(structuredClone(document.electrical.nets[0]));
  const result = validateCircuitDocumentV2(document);

  assert.ok(codes(result.electricalErrors).filter((code) => code === "duplicate-id").length >= 2);
});

test("diagnostics keep schema, electrical, drawing, and consistency findings separate", () => {
  const schemaInvalid = structuredClone(fixture("dcsource").document);
  schemaInvalid.schemaVersion = 7;
  const schemaResult = validateCircuitDocumentV2(schemaInvalid);
  assert.ok(schemaResult.schemaErrors.length > 0);

  const electricalInvalid = structuredClone(fixture("dcsource").document);
  electricalInvalid.electrical.nets[0].members.push(ref("V1", "missing"));
  const electricalResult = validateCircuitDocumentV2(electricalInvalid);
  assert.ok(electricalResult.electricalErrors.length > 0);

  const drawingInvalid = structuredClone(fixture("series LED").document);
  drawingInvalid.drawing.routes[0].netId = "missing";
  const drawingResult = validateCircuitDocumentV2(drawingInvalid);
  assert.ok(drawingResult.drawingErrors.length > 0);

  const incompleteDrawing = fixture("far-apart same-net pins").document;
  assert.ok(checkCircuitDrawingConsistency(incompleteDrawing).length > 0);
  assert.equal(validateCircuitDocumentV2(incompleteDrawing).isValid, true);
});

test("dcsource remains distinct and exposes its canonical polarity pins", () => {
  const document = fixture("dcsource").document;
  const source = document.electrical.components.find((component) => component.id === "V1");

  assert.equal(source.type, "dcsource");
  assert.deepEqual(source.pins.map((pin) => pin.id), ["+", "-"]);
});

test("KiCad pin identities preserve unit, body style, number, name, and duplicate occurrence", () => {
  const document = fixture("KiCad duplicate pins").document;
  const symbol = document.electrical.components.find((component) => component.id === "U1");

  assert.deepEqual(
    symbol.pins.map((pin) => pin.id),
    [
      "kicad:u1:b1:1:GND:0",
      "kicad:u1:b1:1:GND:1",
      "kicad:u1:b1:3:OUT:0",
    ],
  );
  assert.equal(getCircuitPinDefinitions("kicad", {
    symbolId: "Unknown:Part",
    at: [0, 0],
  }), null);
});

test("unmarked crossing geometry is advisory and never merges distinct nets", () => {
  const document = structuredClone(fixture("separate crossing nets").document);
  document.drawing.crossings = [];
  const result = validateCircuitDocumentV2(document);

  assert.equal(
    arePinsElectricallyConnected(document, ref("B_HL", "+"), ref("B_VT", "+")),
    false,
  );
  assert.ok(result.consistencyWarnings.some(
    (diagnostic) => diagnostic.code === "unmarked-route-crossing",
  ));
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCircuitSpecJson } from './circuit-spec-editor.ts';

test('parses a CircuitSpec while leaving structural checks to the drawing validator', () => {
  const result = parseCircuitSpecJson(JSON.stringify({
    title: 'Incomplete but repairable',
    elements: [{ type: 'resistor', id: 'R1', from: [100, 100], to: [160, 100] }],
  }));

  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.spec.title, 'Incomplete but repairable');
});

test('reports malformed JSON without losing the attempted text', () => {
  const result = parseCircuitSpecJson('{"title":"unfinished"');

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /incomplete or malformed/);
});

test('rejects an invalid CircuitSpec envelope', () => {
  const result = parseCircuitSpecJson(JSON.stringify({ title: 12, elements: [] }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /string title and an elements array/);
});

test('rejects elements without a type while accepting structurally incomplete elements', () => {
  const result = parseCircuitSpecJson(JSON.stringify({
    title: 'Bad element',
    elements: [{ id: 'R1' }],
  }));

  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.error, /Element 1/);
});

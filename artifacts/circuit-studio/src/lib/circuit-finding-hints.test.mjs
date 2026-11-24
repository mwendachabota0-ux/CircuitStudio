import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { enrichFindings } from './circuit-build-retry.ts';

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

test('dangling rail findings suggest trimming to the last connected pin on that line', () => {
  const spec = fixture('failed-flasher-bases-shorted.json');
  const finding = 'wire #3 endpoint at (580,50) is not connected.';
  const [enriched] = enrichFindings(spec, [finding]);

  assert.match(enriched, /Shorten wire #3 so it ends at \(530,50\)/);
  assert.match(enriched, /R2\.1 on this rail/);
  assert.equal(spec.elements[2].points[1][0], 580);
});

test('unrelated or ambiguous findings remain unchanged', () => {
  const spec = fixture('failed-flasher-bases-shorted.json');
  const findings = [
    'wire "W1": segment (0,0)->(20,20) is diagonal.',
    'wire #999 endpoint at (580,50) is not connected.',
  ];

  assert.deepEqual(enrichFindings(spec, findings), findings);
});

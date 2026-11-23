import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildExternalCircuitFixProposal,
  buildExternalCircuitFixPrompt,
  getExternalCircuitFixContextKey,
  parseExternalCircuitFixSpec,
  partitionExternalCircuitFixFindings,
  shouldShowExternalCircuitFixPaste,
  summarizeExternalCircuitFix,
} from './circuit-external-fix.ts';

const rejectedSpec = {
  title: 'Rejected LED indicator',
  width: 680,
  height: 480,
  elements: [
    { type: 'led', id: 'D1', from: [100, 100], to: [140, 100], value: 'LED' },
    { type: 'wire', id: 'W1', points: [[100, 100], [80, 100]] },
  ],
};

const context = {
  rejectedSpec,
  reportedProblems: ['Wire W1 at (80,100) is disconnected.'],
  advisoryWarnings: ['A wire segment is diagonal; this is a layout note.'],
  originalRequest: 'Build a low-voltage LED indicator.',
  designBrief: {
    goal: 'Show when the supply is on.',
    requirements: ['Keep the circuit low voltage.'],
    assumptions: [],
    openQuestions: [],
  },
};

test('external-help context stays concise while including the exact circuit and blockers', () => {
  const prompt = buildExternalCircuitFixPrompt(context);

  assert.match(prompt, /Wire W1 at \(80,100\) is disconnected/);
  assert.match(prompt, /A wire segment is diagonal; this is a layout note/);
  assert.match(prompt, /Build a low-voltage LED indicator/);
  assert.match(prompt, /Return one complete CircuitSpec as JSON only/);
  assert.doesNotMatch(prompt, /Recent conversation context|supported components and repair constraints/i);
  assert.ok(prompt.includes(JSON.stringify(rejectedSpec)));
});

test('paste section is visible only for the exact context successfully copied', () => {
  const key = getExternalCircuitFixContextKey(context);
  assert.equal(shouldShowExternalCircuitFixPaste(null, key), false);
  assert.equal(shouldShowExternalCircuitFixPaste('older-copy', key), false);
  assert.equal(shouldShowExternalCircuitFixPaste(key, key), true);
});

test('visual notes are kept advisory rather than presented as blocking errors', () => {
  assert.deepEqual(
    partitionExternalCircuitFixFindings(
      ['Drawing-quality issue: wire W1 is diagonal.'],
      ['The parts are visually close.'],
      'The proposal failed.',
    ),
    {
      reportedProblems: [
        'No CircuitDraw structural blocker remains; the previous attempts were rejected for visual routing notes only.',
      ],
      advisoryWarnings: [
        'The parts are visually close.',
        'wire W1 is diagonal.',
      ],
    },
  );
});

test('pasted complete CircuitSpec accepts plain or fenced JSON only', () => {
  assert.deepEqual(
    parseExternalCircuitFixSpec(JSON.stringify(rejectedSpec)),
    rejectedSpec,
  );
  assert.deepEqual(
    parseExternalCircuitFixSpec(`\`\`\`json\n${JSON.stringify(rejectedSpec)}\n\`\`\``),
    rejectedSpec,
  );
  assert.throws(
    () => parseExternalCircuitFixSpec('Here is the fix: ' + JSON.stringify(rejectedSpec)),
    /complete CircuitSpec as JSON/,
  );
  assert.throws(
    () => parseExternalCircuitFixSpec('{"elements": []}'),
    /title and elements array/,
  );
});

test('external correction summary reports meaningful additions and wire changes', () => {
  const after = {
    ...rejectedSpec,
    elements: [
      { type: 'led', id: 'D1', from: [100, 100], to: [140, 100], value: 'LED' },
      { type: 'wire', id: 'W1', points: [[100, 100], [100, 180]] },
      { type: 'wire', id: 'W2', points: [[100, 180], [80, 180]] },
    ],
  };
  const diff = summarizeExternalCircuitFix(rejectedSpec, after);

  assert.equal(diff.hasChanges, true);
  assert.equal(diff.changeCount, 2);
  assert.match(diff.summary, /1 added; 1 wire updated/);
  assert.ok(diff.details.some((line) => line.includes('Updated wire W1 (points)')));
  assert.ok(diff.details.some((line) => line.includes('Added wire W2')));
});

test('external correction proposal preserves the pasted CircuitSpec without rewriting it', () => {
  const correctedSpec = {
    ...rejectedSpec,
    elements: [
      rejectedSpec.elements[0],
      { type: 'wire', id: 'W1', points: [[100, 100], [140, 100]] },
    ],
  };
  const candidate = buildExternalCircuitFixProposal(
    rejectedSpec,
    JSON.stringify(correctedSpec),
  );

  assert.deepEqual(candidate.spec, correctedSpec);
  assert.match(candidate.summary, /External correction/);
  assert.throws(
    () => buildExternalCircuitFixProposal(rejectedSpec, JSON.stringify(rejectedSpec)),
    /No drawing changes/,
  );
});

test('external correction comparison ignores object key order and symbol geometry', () => {
  const before = {
    title: 'Same',
    elements: [{ type: 'symbol', id: 'U1', properties: { value: 'IC', ref: 'U1' }, symbolData: { svg: 'old' } }],
  };
  const after = {
    title: 'Same',
    elements: [{ symbolData: { svg: 'new' }, id: 'U1', properties: { ref: 'U1', value: 'IC' }, type: 'symbol' }],
  };
  const diff = summarizeExternalCircuitFix(before, after);
  assert.equal(diff.hasChanges, false);
  assert.equal(diff.summary, 'No drawing changes detected.');
});

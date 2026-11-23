import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildExternalCircuitFixPrompt,
  buildStudioExternalCircuitFixMessage,
  getExternalCircuitFixContextKey,
  partitionExternalCircuitFixFindings,
  shouldShowExternalCircuitFixPaste,
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
  history: [{ role: 'user' as const, content: 'Build a low-voltage LED indicator.' }],
};

test('external repair prompt includes the exact rejected spec, blockers, context, and JSON-only output rule', () => {
  const prompt = buildExternalCircuitFixPrompt(context);

  assert.match(prompt, /Wire W1 at \(80,100\) is disconnected/);
  assert.match(prompt, /A wire segment is diagonal; this is a layout note/);
  assert.match(prompt, /Build a low-voltage LED indicator/);
  assert.match(prompt, /Return one complete CircuitSpec as plain JSON only/);
  assert.match(prompt, /CircuitDraw element type identifiers and schemas/);
  assert.ok(prompt.includes(JSON.stringify(rejectedSpec, null, 2)));
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

test('Studio sends pasted repair guidance to its builder without pre-rejecting it', () => {
  const pastedReference = JSON.stringify({
    title: 'External repair',
    elements: [{ type: 'wire', id: 'W2', points: [[100, 100], [180, 100]] }],
  });
  const message = buildStudioExternalCircuitFixMessage(context, pastedReference);

  assert.match(message, /Repair the existing rejected circuit in place/);
  assert.match(message, /Do not start over/);
  assert.match(message, /do not stop before attempting repair/);
  assert.match(message, /Wire W1 at \(80,100\) is disconnected/);
  assert.match(message, /External repair reference supplied by the user/);
  assert.ok(message.includes(pastedReference));
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  isBuildApprovalDeclined,
  isExplicitBuildApproval,
  isExplicitBuildRequest,
} from './circuit-build-authorization.ts';

test('only direct build instructions count as build approval', () => {
  for (const message of [
    'Build it.',
    'Please draw a 24V motor schematic.',
    'Can you create a circuit for the motor?',
    'Looks good, build it.',
    "Let's draft the schematic.",
  ]) {
    assert.equal(isExplicitBuildRequest(message), true, message);
  }

  for (const message of [
    'I need a 24V motor to turn on and off.',
    'That sounds right for my project.',
    'How do I build a motor circuit?',
    'Explain how to create a schematic.',
    "Don't build it yet.",
  ]) {
    assert.equal(isExplicitBuildRequest(message), false, message);
  }
});

test('only an affirmative reply to a pending approval grants permission', () => {
  assert.equal(isExplicitBuildApproval('Yes', true), true);
  assert.equal(isExplicitBuildApproval('Sounds good, build it.', true), true);
  assert.equal(isExplicitBuildApproval('Yes, but not yet.', true), false);
  assert.equal(isExplicitBuildApproval('Yes', false), false);
});

test('identifies a clear decline without treating it as approval', () => {
  assert.equal(isBuildApprovalDeclined('Not yet, keep discussing.'), true);
  assert.equal(isBuildApprovalDeclined("Don't create it yet."), true);
  assert.equal(isBuildApprovalDeclined('Yes, prepare the draft.'), false);
});

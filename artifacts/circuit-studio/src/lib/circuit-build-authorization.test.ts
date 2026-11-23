import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enforceBuilderResponseMode,
  isBuildApprovalDeclined,
  isExplicitBuildApproval,
  isExplicitBuildRequest,
} from './circuit-build-authorization.ts';

const proposal = { summary: 'Test proposal', spec: { title: 'Test', elements: [] } };

test('only direct build instructions count as build approval', () => {
  for (const message of [
    'Build it.',
    'Please draw a 24V motor schematic.',
    'Can you create a circuit for the motor?',
    'Looks good, build it.',
    "Let's draft the schematic.",
    'Add a protection fuse to my motor circuit.',
    'Please move the diode so it does not overlap the motor.',
    'Adjust the fuse rating.',
  ]) {
    assert.equal(isExplicitBuildRequest(message), true, message);
  }

  for (const message of [
    'I need a 24V motor to turn on and off.',
    'That sounds right for my project.',
    'How do I build a motor circuit?',
    'Explain how to create a schematic.',
    'Explain why the diode is there.',
    'Can you tell me how to add a fuse?',
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

test('a Chat response cannot switch to Build or stage a proposal', () => {
  const response = {
    nextMode: 'build' as const,
    answer: 'Here is the draft.',
    proposal,
  };
  const guarded = enforceBuilderResponseMode(response, 'chat');

  assert.equal(guarded.nextMode, 'chat');
  assert.equal(guarded.proposal, undefined);
  assert.equal(guarded.answer, response.answer);
});

test('an explicitly authorized Build response is preserved', () => {
  const response = { nextMode: 'build' as const, answer: 'Draft ready.', proposal };
  assert.equal(enforceBuilderResponseMode(response, 'build'), response);
});

test('identifies a clear decline without treating it as approval', () => {
  assert.equal(isBuildApprovalDeclined('Not yet, keep discussing.'), true);
  assert.equal(isBuildApprovalDeclined("Don't create it yet."), true);
  assert.equal(isBuildApprovalDeclined('Yes, prepare the draft.'), false);
});

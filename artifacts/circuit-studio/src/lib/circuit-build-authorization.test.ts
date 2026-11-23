import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  enforceBuilderResponseMode,
  isBuildApprovalDeclined,
} from './circuit-build-authorization.ts';

const proposal = { summary: 'Test proposal', spec: { title: 'Test', elements: [] } };

test('a Chat response cannot switch to Build or stage a proposal', () => {
  const response = {
    nextMode: 'chat' as const,
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

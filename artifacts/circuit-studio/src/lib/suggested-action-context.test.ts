import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getContextualSuggestedActions,
  getFinalAssistantQuestion,
} from './suggested-action-context.ts';

test('finds the final focused question in an assistant answer', () => {
  assert.equal(
    getFinalAssistantQuestion('I can help with that. What is the motor current?'),
    'What is the motor current?',
  );
});

test('shows only suggestions linked to the question being answered', () => {
  const actions = [
    { label: 'Use a transistor', prompt: 'Use a transistor instead.' },
    {
      label: "I'll check the label",
      prompt: "I don't know yet; I'll check the label.",
      replyTo: ' What is the motor   current? ',
    },
  ];

  assert.deepEqual(
    getContextualSuggestedActions('What is the motor current?', actions),
    [actions[1]],
  );
});

test('keeps ordinary next steps when the assistant did not ask a question', () => {
  const actions = [
    { label: 'Draft it', prompt: 'Draft the current circuit.' },
    { label: 'Unverified', prompt: 'Another step.', replyTo: 'Old question?' },
  ];

  assert.deepEqual(
    getContextualSuggestedActions('I can draft the circuit when you are ready.', actions),
    [actions[0]],
  );
});

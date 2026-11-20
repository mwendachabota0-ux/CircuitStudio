import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBuilderHistorySession,
  getBuilderHistoryPreview,
  getBuilderHistoryTitle,
  upsertBuilderHistorySession,
} from './circuit-builder-history.ts';

test('history title comes from the first user message and stays readable', () => {
  assert.equal(
    getBuilderHistoryTitle([
      { role: 'assistant', content: 'Welcome.' },
      { role: 'user', content: '  Make   a  24V motor driver  ' },
      { role: 'user', content: 'Add a fuse.' },
    ]),
    'Make a 24V motor driver',
  );
  assert.equal(getBuilderHistoryTitle([{ role: 'assistant', content: 'Welcome.' }]), 'New conversation');

  const longTitle = getBuilderHistoryTitle([
    { role: 'user', content: 'A very long circuit request '.repeat(5) },
  ]);
  assert.equal(longTitle.length, 62);
  assert.ok(longTitle.endsWith('…'));
});

test('history preview uses the latest message and truncates long text', () => {
  assert.equal(
    getBuilderHistoryPreview([
      { role: 'user', content: 'Build a circuit.' },
      { role: 'assistant', content: 'The latest answer.' },
    ]),
    'The latest answer.',
  );
  assert.equal(getBuilderHistoryPreview([]), 'No messages yet');
  assert.equal(getBuilderHistoryPreview([{ role: 'user', content: 'word '.repeat(30) }]).length, 98);
});

test('history sessions preserve circuit snapshots and upsert newest first without mutating', () => {
  const messages = [{ role: 'user', content: 'Build a motor driver.' }];
  const first = createBuilderHistorySession({
    id: 'first',
    saved: { messages },
    currentSpec: { title: 'Motor driver', elements: [] },
    mode: 'build',
    now: 100,
  });
  const second = createBuilderHistorySession({
    id: 'second',
    saved: { messages: [] },
    currentSpec: { title: 'Example', elements: [] },
    mode: 'chat',
    now: 200,
  });
  const original = [first, second];

  const updated = createBuilderHistorySession({
    id: 'first',
    saved: { messages: [{ role: 'user', content: 'Build a 24V motor driver.' }] },
    currentSpec: { title: '24V motor driver', elements: [] },
    mode: 'build',
    now: 300,
    createdAt: first.createdAt,
  });
  const result = upsertBuilderHistorySession(original, updated);

  assert.deepEqual(result.map((session) => session.id), ['first', 'second']);
  assert.equal(result[0].currentSpec.title, '24V motor driver');
  assert.equal(result[0].title, 'Build a 24V motor driver.');
  assert.deepEqual(original.map((session) => session.id), ['first', 'second']);
});

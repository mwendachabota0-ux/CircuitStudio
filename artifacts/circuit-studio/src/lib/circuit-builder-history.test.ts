import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  createBuilderHistorySession,
  filterDeletedBuilderHistorySessions,
  getBuilderHistoryMemoryExcerpts,
  getBuilderHistoryPreview,
  getBuilderHistoryTitle,
  getBuilderHistorySyncCandidates,
  mergeBuilderHistorySessions,
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

test('unfinished chat-mode conversations are valid history sessions before Build', () => {
  const saved = {
    messages: [
      { role: 'user', content: 'I want a flasher, but need help choosing the timing.' },
      { role: 'assistant', content: 'What blink interval should it use?' },
    ],
  };
  const session = createBuilderHistorySession({
    id: 'unfinished-chat',
    saved,
    currentSpec: { title: 'Example', elements: [] },
    mode: 'chat',
    now: 400,
  });

  const history = upsertBuilderHistorySession([], session);
  assert.equal(history[0].mode, 'chat');
  assert.equal(history[0].title, 'I want a flasher, but need help choosing the timing.');
  assert.equal(history[0].saved.messages.length, 2);
  assert.equal(history[0].currentSpec.title, 'Example');
});

test('account history wins over stale local sessions and newer local sessions sync', () => {
  const local = [
    createBuilderHistorySession({
      id: 'same-session',
      saved: { messages: [{ role: 'user', content: 'Older device copy.' }] },
      currentSpec: { title: 'Local older', elements: [] },
      mode: 'chat',
      now: 100,
      createdAt: 50,
    }),
    createBuilderHistorySession({
      id: 'local-only',
      saved: { messages: [{ role: 'user', content: 'Only on this device.' }] },
      currentSpec: { title: 'Local only', elements: [] },
      mode: 'chat',
      now: 200,
      createdAt: 200,
    }),
  ];
  const account = [
    createBuilderHistorySession({
      id: 'same-session',
      saved: { messages: [{ role: 'user', content: 'Newer account copy.' }] },
      currentSpec: { title: 'Account newer', elements: [] },
      mode: 'build',
      now: 300,
      createdAt: 50,
    }),
  ];

  const merged = mergeBuilderHistorySessions(local, account);
  const candidates = getBuilderHistorySyncCandidates(local, account);

  assert.deepEqual(merged.map((session) => session.id), ['same-session', 'local-only']);
  assert.equal(merged[0].saved.messages[0].content, 'Newer account copy.');
  assert.deepEqual(candidates.map((session) => session.id), ['local-only']);
});

test('account deletion markers filter stale local history before it can sync again', () => {
  const sessions = [
    { id: 'keep-this', title: 'Current conversation' },
    { id: 'deleted-session', title: 'Old device copy' },
  ];

  assert.deepEqual(
    filterDeletedBuilderHistorySessions(sessions, new Set(['deleted-session'])),
    [{ id: 'keep-this', title: 'Current conversation' }],
  );
});

test('memory import uses bounded user statements and brief details, not empty chats', () => {
  const sessions = [
    createBuilderHistorySession({
      id: 'old-chat',
      saved: {
        brief: {
          goal: 'Build a greenhouse controller.',
          requirements: ['Run from a 12V battery.'],
          assumptions: ['Use a simple relay output.'],
          openQuestions: ['What sensor should be used?'],
        },
        messages: [
          { role: 'assistant', content: 'Welcome to Circuit Studio.' },
          { role: 'user', content: 'I prefer one focused question at a time.' },
        ],
      },
      currentSpec: {
        title: 'Greenhouse controller',
        elements: [
          { type: 'resistor', label: 'R1', value: '10k' },
          { type: 'wire', id: 'W1' },
        ],
      },
      mode: 'chat',
      now: 100,
    }),
    createBuilderHistorySession({
      id: 'empty-chat',
      saved: { messages: [{ role: 'assistant', content: 'Welcome.' }] },
      currentSpec: { title: 'Example', elements: [] },
      mode: 'chat',
      now: 200,
    }),
  ];

  const excerpts = getBuilderHistoryMemoryExcerpts(sessions);

  assert.equal(excerpts.length, 1);
  assert.equal(excerpts[0].title, 'I prefer one focused question at a time.');
  assert.match(excerpts[0].context, /Goal: Build a greenhouse controller/);
  assert.match(excerpts[0].context, /12V battery/);
  assert.match(excerpts[0].context, /Circuit: Greenhouse controller/);
  assert.match(excerpts[0].context, /resistor R1 10k/);
  assert.doesNotMatch(excerpts[0].context, /W1/);
  assert.match(excerpts[0].context, /Recent user statements: I prefer one focused question/);
  assert.ok(excerpts[0].context.length <= 3000);
  assert.doesNotMatch(excerpts[0].context, /Welcome to Circuit Studio/);
});

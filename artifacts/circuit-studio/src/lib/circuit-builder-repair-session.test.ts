import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  clearAppliedRepairRecovery,
  discardStagedRepairProposal,
  getBuilderHistoryStorageKey,
  getNextBuilderHistoryTimestamp,
  normalizeRepairRecoveryState,
  updateRepairRecoveryState,
} from './circuit-builder-repair-session.ts';

const spec = { title: 'Timer circuit', elements: [] };
const request = {
  message: 'Repair the rejected timer proposal.',
  mode: 'build',
  currentSpec: spec,
};

const isCircuitSpec = (value: unknown): value is typeof spec =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { title?: unknown }).title === 'string' &&
  Array.isArray((value as { elements?: unknown }).elements);

const isCircuitBuildRequest = (value: unknown): value is typeof request =>
  !!value &&
  typeof value === 'object' &&
  typeof (value as { message?: unknown }).message === 'string' &&
  ((value as { mode?: unknown }).mode === 'chat' ||
    (value as { mode?: unknown }).mode === 'build') &&
  isCircuitSpec((value as { currentSpec?: unknown }).currentSpec);

test('refresh restores staged and rejected repair context, including drafts and findings', () => {
  const saved = normalizeRepairRecoveryState(
    {
      version: 1,
      status: 'running',
      proposal: { summary: 'Updated timer', spec },
      proposalValidation: { errors: [], warnings: ['Check the component rating.'] },
      rejectedProposalSpec: spec,
      retryFeedback: {
        message: 'The latest repair needs another check.',
        canRetryManually: true,
        validationFindings: ['A connection is missing.'],
      },
      repairDiagnostics: [{
        attempt: 3,
        outcome: 'exhausted',
        nonWireElementsModified: false,
        metadataModified: false,
        validationErrors: ['A connection is missing.'],
        validationWarnings: [],
      }],
      retryAttempt: 3,
      retryKind: 'repair',
      lastRequest: request,
      lastProtectedElementsBaseSpec: spec,
      proposalRepairLesson: {
        beforeSpec: spec,
        afterSpec: spec,
        findings: ['A connection is missing.'],
        context: 'Repair the saved circuit.',
        content: null,
      },
      externalFixDraft: '{"title":"External correction"}',
      composerDraft: 'Keep the existing components.',
    },
    isCircuitSpec,
    isCircuitBuildRequest,
  );

  assert.equal(saved.status, 'staged');
  assert.equal(saved.proposal?.summary, 'Updated timer');
  assert.deepEqual(saved.proposalValidation?.warnings, ['Check the component rating.']);
  assert.deepEqual(saved.rejectedProposalSpec, spec);
  assert.deepEqual(saved.retryFeedback?.validationFindings, ['A connection is missing.']);
  assert.equal(saved.repairDiagnostics[0]?.attempt, 3);
  assert.equal(saved.retryKind, 'repair');
  assert.deepEqual(saved.lastRequest, request);
  assert.equal(saved.externalFixDraft, '{"title":"External correction"}');
  assert.equal(saved.composerDraft, 'Keep the existing components.');

  const interrupted = normalizeRepairRecoveryState(
    { ...saved, proposal: undefined, status: 'running' },
    isCircuitSpec,
    isCircuitBuildRequest,
  );
  assert.equal(interrupted.status, 'rejected');
  assert.match(interrupted.retryFeedback?.message ?? '', /interrupted by a page refresh/);
  assert.equal(interrupted.retryFeedback?.canRetryManually, true);
  assert.equal(interrupted.repairDiagnostics[0]?.attempt, 3);
});

test('discarding or applying a staged repair removes it from the saved state', () => {
  const staged = normalizeRepairRecoveryState(
    {
      version: 1,
      status: 'staged',
      proposal: { summary: 'Updated timer', spec },
      proposalValidation: { errors: [], warnings: [] },
      repairDiagnostics: [],
      retryAttempt: 0,
      externalFixDraft: 'external correction',
      composerDraft: '',
    },
    isCircuitSpec,
    isCircuitBuildRequest,
  );

  const discarded = discardStagedRepairProposal(staged);
  assert.equal(discarded.status, 'idle');
  assert.equal(discarded.proposal, undefined);
  assert.equal(discarded.proposalValidation, undefined);
  assert.equal(discarded.proposalRepairLesson, undefined);
  assert.equal(JSON.stringify(discarded).includes('"proposal"'), false);

  const applied = clearAppliedRepairRecovery({
    ...staged,
    composerDraft: 'Keep this follow-up.',
  });
  assert.equal(applied.status, 'idle');
  assert.equal(applied.proposal, undefined);
  assert.equal(applied.rejectedProposalSpec, undefined);
  assert.equal(applied.externalFixDraft, '');
  assert.equal(applied.composerDraft, 'Keep this follow-up.');
});

test('staging an external correction preserves the rejected comparison baseline', () => {
  const rejectedSpec = {
    title: 'Rejected timer',
    elements: [{ type: 'wire', id: 'W1', points: [[0, 0], [20, 0]] }],
  };
  const correctedSpec = {
    title: 'Corrected timer',
    elements: [{ type: 'wire', id: 'W1', points: [[0, 0], [20, 20]] }],
  };
  const rejected = normalizeRepairRecoveryState(
    {
      version: 1,
      status: 'rejected',
      rejectedProposalSpec: rejectedSpec,
      repairDiagnostics: [],
      retryAttempt: 0,
      externalFixDraft: JSON.stringify(correctedSpec),
      composerDraft: '',
    },
    isCircuitSpec,
    isCircuitBuildRequest,
  );

  const staged = updateRepairRecoveryState(rejected, {
    status: 'staged',
    proposal: { summary: 'External correction: 1 wire updated.', spec: correctedSpec },
    proposalValidation: { errors: [], warnings: [] },
  });

  assert.deepEqual(staged.rejectedProposalSpec, rejectedSpec);
  assert.deepEqual(staged.proposal?.spec, correctedSpec);
  assert.equal(staged.status, 'staged');
});

test('repair history uses separate local storage keys for each signed-in user', () => {
  const aliceKey = getBuilderHistoryStorageKey('user_alice');
  const bobKey = getBuilderHistoryStorageKey('user_bob');
  assert.notEqual(aliceKey, bobKey);
  assert.match(aliceKey, /user_alice$/);
});

test('sessions saved before repair recovery migrate to an empty repair snapshot', () => {
  const migrated = normalizeRepairRecoveryState(undefined, isCircuitSpec, isCircuitBuildRequest);
  assert.equal(migrated.version, 1);
  assert.equal(migrated.status, 'idle');
  assert.equal(migrated.proposal, undefined);
  assert.deepEqual(migrated.repairDiagnostics, []);
  assert.equal(migrated.composerDraft, '');
});

test('session updates get a strictly newer timestamp, even within one millisecond', () => {
  assert.equal(getNextBuilderHistoryTimestamp(500, 400), 501);
  assert.equal(getNextBuilderHistoryTimestamp(500, 501), 501);
  assert.equal(getNextBuilderHistoryTimestamp(undefined, 500), 500);
});

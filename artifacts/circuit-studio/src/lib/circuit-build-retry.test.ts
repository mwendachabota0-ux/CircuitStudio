import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CircuitBuildChatInput,
  CircuitDesignBrief,
} from '@workspace/api-client-react';
import {
  buildRepairRequest,
  CircuitBuildAttemptError,
  getBuildRetryPolicy,
  MAX_AUTO_RETRIES,
  runCircuitBuildAttempts,
  shouldClearSubmittedDraft,
} from './circuit-build-retry.ts';

const brief: CircuitDesignBrief = {
  goal: 'Build an LED indicator',
  requirements: [],
  assumptions: [],
  openQuestions: [],
};

const baseRequest: CircuitBuildChatInput = {
  message: 'Build a simple LED indicator.',
  mode: 'build',
  currentSpec: { title: 'Draft', elements: [] },
  history: [{ role: 'assistant', content: 'What should the circuit do?' }],
  brief,
};

const noProposal = { answer: 'Ready.', nextMode: 'chat' as const };

test('retries transient generation failures at most twice, then recovers', async () => {
  let sends = 0;
  const progress: Array<[number, string]> = [];
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => {
      sends += 1;
      if (sends < 3) throw Object.assign(new Error('temporary provider error'), { status: 503 });
      return noProposal;
    },
    getProposal: () => null,
    inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
    makeRepairRequest: (request) => request,
    onRetry: (attempt, kind) => progress.push([attempt, kind]),
    wait: async () => {},
  });

  assert.equal(sends, MAX_AUTO_RETRIES + 1);
  assert.deepEqual(progress, [[1, 'generation'], [2, 'generation']]);
  assert.equal(result.response, noProposal);
});

test('exposes manual retry after exactly three transient failures', async () => {
  let sends = 0;
  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        throw Object.assign(new Error('temporary provider error'), { status: 503 });
      },
      getProposal: () => null,
      inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
      makeRepairRequest: (request) => request,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.retryCount, MAX_AUTO_RETRIES);
      assert.equal(error.canRetryManually, true);
      assert.equal(error.failureKind, 'generation');
      return true;
    },
  );
  assert.equal(sends, MAX_AUTO_RETRIES + 1);
});

test('repairs disconnected-wire warnings and spacing errors using exact findings', async () => {
  const badProposal = { answer: 'Draft ready.', nextMode: 'build' as const, proposal: { spec: { title: 'Draft', elements: [] } } };
  const findings = [
    'R1: terminals are only 30 px apart; resistor needs at least 50 px.',
    'Wire W1 at (120,80) is not connected to anything.',
  ];
  const requests: CircuitBuildChatInput[] = [];
  const progress: Array<[number, string]> = [];

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async (request) => {
      requests.push(request);
      return requests.length === 1 ? badProposal : noProposal;
    },
    getProposal: (response) => 'proposal' in response ? response.proposal.spec : null,
    inspectProposal: () => ({
      validation: requests.length === 1
        ? { errors: [findings[0]], warnings: [findings[1]] }
        : { errors: [], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: (_response, issues) => buildRepairRequest(baseRequest, brief, issues),
    onRetry: (attempt, kind) => progress.push([attempt, kind]),
    wait: async () => {},
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(progress, [[1, 'repair']]);
  assert.match(requests[1].message, /R1: terminals are only 30 px apart/);
  assert.match(requests[1].message, /Wire W1 .*not connected/);
  assert.deepEqual(requests[1].history, [
    ...baseRequest.history!,
    { role: 'user', content: baseRequest.message },
  ]);
  assert.equal(requests[1].history?.filter((item) => item.content === baseRequest.message).length, 1);
  assert.equal(result.response, noProposal);
});

test('stops after two repair retries and exposes a manual retry', async () => {
  const invalidProposal = { answer: 'Draft ready.', nextMode: 'build' as const, proposal: { spec: { title: 'Draft', elements: [] } } };
  let sends = 0;
  let repairRequests = 0;
  const findings = ['Wire W1 at (120,80) is not connected to anything.'];

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        return invalidProposal;
      },
      getProposal: (response) => response.proposal.spec,
      inspectProposal: () => ({
        validation: { errors: [], warnings: findings },
        canRepair: true,
      }),
      makeRepairRequest: () => {
        repairRequests += 1;
        return baseRequest;
      },
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.retryCount, MAX_AUTO_RETRIES);
      assert.equal(error.canRetryManually, true);
      assert.deepEqual(error.validationFindings, findings);
      return true;
    },
  );

  assert.equal(sends, MAX_AUTO_RETRIES + 1);
  assert.equal(repairRequests, MAX_AUTO_RETRIES);
});

test('does not automatically retry permanent request errors', async () => {
  let sends = 0;
  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        throw Object.assign(new Error('Sign in to use the circuit builder.'), { status: 401 });
      },
      getProposal: () => null,
      inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
      makeRepairRequest: (request) => request,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.retryCount, 0);
      assert.equal(error.canRetryManually, false);
      return true;
    },
  );
  assert.equal(sends, 1);
});

test('retries a rate limit only when Retry-After guidance is present', () => {
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('rate limited'), { status: 429 })),
    { retryable: false, delayMs: undefined },
  );
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('rate limited'), {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    })),
    { retryable: true, delayMs: 2_000 },
  );
});

test('retries malformed model output when the API marks it retryable', () => {
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('The assistant returned invalid output.'), {
      status: 502,
      headers: new Headers({ 'x-circuit-ai-retryable': 'true' }),
    })),
    { retryable: true, delayMs: undefined },
  );
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('Gemini is not configured.'), {
      status: 503,
      headers: new Headers({ 'x-circuit-ai-retryable': 'false' }),
    })),
    { retryable: false },
  );
});

test('keeps newly typed draft text and does not clear it after a request', () => {
  assert.equal(shouldClearSubmittedDraft(3, 3, 'Build a simple LED indicator.', baseRequest.message), true);
  assert.equal(shouldClearSubmittedDraft(3, 4, 'What about a buzzer too?', baseRequest.message), false);
  assert.equal(shouldClearSubmittedDraft(3, 4, '', baseRequest.message), false);
});

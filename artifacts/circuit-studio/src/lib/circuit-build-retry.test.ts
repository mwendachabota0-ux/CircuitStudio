import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CircuitBuildChatInput,
  CircuitDesignBrief,
} from '@workspace/api-client-react';
import {
  buildOutputRepairRequest,
  buildRepairRequest,
  CircuitBuildAttemptError,
  getNonWireElementSignature,
  getBuildRetryPolicy,
  getModeAfterFailedRequest,
  isInvalidModelOutput,
  MAX_AUTO_RETRIES,
  restoreProtectedNonWireElements,
  runCircuitBuildAttempts,
  shouldClearSubmittedDraft,
} from './circuit-build-retry.ts';
import { getLocalBuilderModeIntent } from './circuit-build-intent.ts';

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

test('uses local mode shortcuts only for explicit mode changes', () => {
  assert.equal(getLocalBuilderModeIntent('Please switch to build mode'), 'build');
  assert.equal(getLocalBuilderModeIntent('build mode'), 'build');
  assert.equal(getLocalBuilderModeIntent('Please switch to chat mode'), 'chat');
  assert.equal(getLocalBuilderModeIntent('chat mode'), 'chat');

  for (const message of [
    'Build a simple LED circuit.',
    'Can you build the circuit now?',
    'I need an alternating LED flasher.',
    'The two lights should blink one after the other.',
    'How do I build a simple LED circuit?',
    "Don't build it yet.",
  ]) {
    assert.equal(getLocalBuilderModeIntent(message), null, message);
  }
});

test('keeps Build mode when a build request fails', () => {
  assert.equal(getModeAfterFailedRequest('chat', 'build'), 'build');
  assert.equal(getModeAfterFailedRequest('build', 'build'), 'build');
});

test('does not treat questions or requests to wait as build commands', () => {
  for (const message of [
    'How do I build a simple LED circuit?',
    "Don't build it yet.",
    'What if we build a different circuit?',
  ]) {
    assert.equal(getLocalBuilderModeIntent(message), null, message);
  }
});

test('retries transient generation failures at most three times, then recovers', async () => {
  assert.equal(MAX_AUTO_RETRIES, 3);
  let sends = 0;
  const progress: Array<[number, string]> = [];
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => {
      sends += 1;
      if (sends <= MAX_AUTO_RETRIES) throw Object.assign(new Error('temporary provider error'), { status: 503 });
      return noProposal;
    },
    getProposal: () => null,
    inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
    makeRepairRequest: (request) => request,
    onRetry: (attempt, kind) => progress.push([attempt, kind]),
    wait: async () => {},
  });

  assert.equal(sends, MAX_AUTO_RETRIES + 1);
  assert.deepEqual(progress, [[1, 'generation'], [2, 'generation'], [3, 'generation']]);
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

test('repairs blocking wire faults without sending layout warnings as errors', async () => {
  const failingSpec = { title: 'Rejected AI proposal', elements: [] };
  const badProposal = { answer: 'Draft ready.', nextMode: 'build' as const, proposal: { spec: failingSpec } };
  const blockingFinding = 'Wire W1 at (120,80) is not connected to anything.';
  const advisoryWarning = 'W1 has a diagonal segment; use horizontal and vertical wires.';
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
        ? { errors: [blockingFinding], warnings: [advisoryWarning] }
        : { errors: [], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: (response, issues) => buildRepairRequest(
      baseRequest,
      brief,
      issues,
      response.proposal?.spec,
    ),
    onRetry: (attempt, kind) => progress.push([attempt, kind]),
    wait: async () => {},
  });

  assert.equal(requests.length, 2);
  assert.deepEqual(progress, [[1, 'repair']]);
  assert.match(requests[1].message, /Wire W1 .*not connected/);
  assert.doesNotMatch(requests[1].message, /diagonal segment/);
  assert.deepEqual(requests[1].history, [
    ...baseRequest.history!,
    { role: 'user', content: baseRequest.message },
  ]);
  assert.deepEqual(requests[1].currentSpec, failingSpec);
  assert.notDeepEqual(requests[1].currentSpec, baseRequest.currentSpec);
  assert.equal(requests[1].history?.filter((item) => item.content === baseRequest.message).length, 1);
  assert.equal(result.response, noProposal);
});

test('accepts a valid proposal with advisory warnings without retrying', async () => {
  const proposal = { title: 'Accepted layout', elements: [] };
  let repairRequests = 0;
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => ({ answer: 'Ready.', nextMode: 'build' as const, proposal: { spec: proposal } }),
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: { errors: [], warnings: ['A wire segment is diagonal; this is a layout note.'] },
      canRepair: true,
    }),
    makeRepairRequest: () => {
      repairRequests += 1;
      return baseRequest;
    },
  });
  assert.equal(result.response.proposal.spec, proposal);
  assert.deepEqual(result.proposalInspection?.validation.warnings, ['A wire segment is diagonal; this is a layout note.']);
  assert.equal(repairRequests, 0);
});

test('each repair request uses the latest failing proposal, not the workbench draft', async () => {
  const firstFailingSpec = { title: 'First rejected proposal', elements: [] };
  const secondFailingSpec = { title: 'Latest rejected proposal', elements: [] };
  const proposals = [
    { answer: 'First draft.', nextMode: 'build' as const, proposal: { spec: firstFailingSpec } },
    { answer: 'Updated draft.', nextMode: 'build' as const, proposal: { spec: secondFailingSpec } },
    noProposal,
  ];
  const requests: CircuitBuildChatInput[] = [];

  await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async (request) => {
      requests.push(request);
      return proposals.shift()!;
    },
    getProposal: (response) => 'proposal' in response ? response.proposal.spec : null,
    inspectProposal: () => ({
      validation: { errors: ['Wire W1 endpoint is disconnected.'], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: (response, findings) => buildRepairRequest(
      baseRequest,
      brief,
      findings,
      response.proposal?.spec,
    ),
    wait: async () => {},
  });

  assert.deepEqual(requests[1].currentSpec, firstFailingSpec);
  assert.deepEqual(requests[2].currentSpec, secondFailingSpec);
  assert.deepEqual(baseRequest.currentSpec, { title: 'Draft', elements: [] });
});

test('allows wire-only repairs while preserving every component position', async () => {
  const firstSpec = {
    title: 'Draft',
    elements: [
      { type: 'npn', id: 'Q1', at: [100, 100] },
      { type: 'wire', id: 'W1', points: [[50, 50], [60, 50]] },
    ],
  };
  const repairedSpec = {
    ...firstSpec,
    elements: [
      firstSpec.elements[0],
      { type: 'wire', id: 'W1', points: [[50, 50], [75, 100]] },
    ],
  };
  const proposals = [firstSpec, repairedSpec];
  let inspected = 0;
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => {
      const spec = proposals.shift()!;
      return { answer: 'Draft.', nextMode: 'build' as const, proposal: { spec } };
    },
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: inspected++ === 0
        ? { errors: ['Wire W1 endpoint is disconnected.'], warnings: [] }
        : { errors: [], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: (response) => ({
      ...baseRequest,
      currentSpec: response.proposal.spec,
    }),
    getProtectedElementsSignature: (spec) =>
      getNonWireElementSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
    wait: async () => {},
  });

  assert.equal(result.response.proposal.spec, repairedSpec);
  assert.equal(inspected, 2);
});

test('rejects a repair before applying it if a component moves', async () => {
  const initialSpec = {
    title: 'Draft',
    elements: [{ type: 'npn', id: 'Q1', at: [100, 100] }],
  };
  const movedSpec = {
    title: 'Draft',
    elements: [{ type: 'npn', id: 'Q1', at: [120, 100] }],
  };
  let sends = 0;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        return {
          answer: 'Draft.',
          nextMode: 'build' as const,
          proposal: { spec: sends === 1 ? initialSpec : movedSpec },
        };
      },
      getProposal: (response) => response.proposal.spec,
      inspectProposal: () => ({
        validation: { errors: ['Wire W1 endpoint is disconnected.'], warnings: [] },
        canRepair: true,
      }),
      makeRepairRequest: () => baseRequest,
      getProtectedElementsSignature: (spec) =>
        getNonWireElementSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.failureKind, 'validation');
      assert.match(error.validationFindings[0], /changed a non-wire element/);
      assert.equal(error.rejectedProposal, movedSpec);
      return true;
    },
  );
  assert.equal(sends, 2);
});

test('restores original components when a repair response redesigns the circuit', async () => {
  const currentSpec = {
    title: 'User draft',
    width: 680,
    height: 490,
    elements: [
      { type: 'npn', id: 'Q1', at: [100, 100], value: '2N3904' },
      { type: 'ground', id: 'GND', at: [100, 300] },
      { type: 'wire', id: 'W1', points: [[50, 50], [60, 50]] },
    ],
  };
  const changedProposal = {
    title: 'Redesigned flasher',
    width: 900,
    height: 700,
    elements: [
      { type: 'npn', id: 'Q1', at: [120, 100], value: 'BC547' },
      { type: 'resistor', id: 'R9', from: [200, 100], to: [260, 100], value: '47kΩ' },
      { type: 'wire', id: 'W1', points: [[50, 50], [75, 100]] },
    ],
  };

  const restored = restoreProtectedNonWireElements(currentSpec, changedProposal);
  assert.equal(restored.title, currentSpec.title);
  assert.equal(restored.width, currentSpec.width);
  assert.equal(restored.height, currentSpec.height);
  assert.deepEqual(
    restored.elements.filter((element) => element.type !== 'wire'),
    currentSpec.elements.filter((element) => element.type !== 'wire'),
  );
  assert.deepEqual(
    restored.elements.filter((element) => element.type === 'wire'),
    changedProposal.elements.filter((element) => element.type === 'wire'),
  );

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => ({
      answer: 'Repair staged.',
      nextMode: 'build' as const,
      proposal: { spec: changedProposal },
    }),
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: { errors: [], warnings: [] },
      canRepair: true,
    }),
    prepareResponse: (response) => ({
      ...response,
      proposal: {
        ...response.proposal,
        spec: restoreProtectedNonWireElements(currentSpec, response.proposal.spec),
      },
    }),
    initialProtectedElementsSignature: getNonWireElementSignature(currentSpec),
    getProtectedElementsSignature: (spec) =>
      getNonWireElementSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
    makeRepairRequest: () => baseRequest,
  });
  assert.deepEqual(result.response.proposal.spec, restored);
});

test('stops after three repair retries and exposes a manual retry', async () => {
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
        validation: { errors: findings, warnings: [] },
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

test('builds a format repair request without changing the original mode or circuit', () => {
  const request: CircuitBuildChatInput = {
    ...baseRequest,
    mode: 'chat',
    message: 'Can you explain the power supply?',
  };
  const repaired = buildOutputRepairRequest(request);

  assert.equal(repaired.mode, 'chat');
  assert.equal(repaired.currentSpec, request.currentSpec);
  assert.deepEqual(repaired.brief, request.brief);
  assert.deepEqual(repaired.history, [
    ...request.history!,
    { role: 'user', content: request.message },
  ]);
  assert.match(repaired.message, /required response format/);
});

test('retries invalid model output once with a format repair request', async () => {
  const invalidOutput = Object.assign(new Error('Invalid model output.'), {
    status: 502,
    headers: new Headers({ 'x-circuit-ai-output-invalid': 'true' }),
  });
  const requests: CircuitBuildChatInput[] = [];
  const progress: Array<[number, string]> = [];

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async (request) => {
      requests.push(request);
      if (requests.length === 1) throw invalidOutput;
      return noProposal;
    },
    getProposal: () => null,
    inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
    makeRepairRequest: (request) => request,
    makeOutputRepairRequest: buildOutputRepairRequest,
    onRetry: (attempt, kind) => progress.push([attempt, kind]),
    wait: async () => {},
  });

  assert.equal(isInvalidModelOutput(invalidOutput), true);
  assert.equal(requests.length, 2);
  assert.notEqual(requests[1].message, baseRequest.message);
  assert.equal(requests[1].mode, baseRequest.mode);
  assert.equal(requests[1].history?.at(-1)?.content, baseRequest.message);
  assert.deepEqual(progress, [[1, 'format']]);
  assert.equal(result.response, noProposal);
});

test('stops after one failed format repair and offers a manual retry', async () => {
  const invalidOutput = Object.assign(new Error('Invalid model output.'), {
    status: 502,
    headers: new Headers({ 'x-circuit-ai-output-invalid': 'true' }),
  });
  let sends = 0;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        throw invalidOutput;
      },
      getProposal: () => null,
      inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
      makeRepairRequest: (request) => request,
      makeOutputRepairRequest: buildOutputRepairRequest,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.retryCount, 1);
      assert.equal(error.canRetryManually, true);
      assert.equal(error.failureKind, 'output');
      return true;
    },
  );

  assert.equal(sends, 2);
});

test('keeps newly typed draft text and does not clear it after a request', () => {
  assert.equal(shouldClearSubmittedDraft(3, 3, 'Build a simple LED indicator.', baseRequest.message), true);
  assert.equal(shouldClearSubmittedDraft(3, 4, 'What about a buzzer too?', baseRequest.message), false);
  assert.equal(shouldClearSubmittedDraft(3, 4, '', baseRequest.message), false);
});

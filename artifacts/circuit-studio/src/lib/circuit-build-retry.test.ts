import assert from 'node:assert/strict';
import { test } from 'node:test';
import type {
  CircuitBuildChatInput,
  CircuitDesignBrief,
} from '@workspace/api-client-react';
import {
  buildLayoutRepairRequest,
  buildManualRetryRequest,
  buildOutputRepairRequest,
  buildRepairRequest,
  buildWireRebuildRequest,
  buildWireRebuildMessage,
  buildWholeCircuitRetryRequest,
  classifyProposalValidation,
  CircuitBuildAttemptError,
  EXTERNAL_REPAIR_REFERENCE_MARKER,
  getRetryRecoveryKind,
  getNonWireElementSignature,
  getLayoutInvariantChanges,
  getLayoutInvariantSignature,
  getCircuitNetlistSignature,
  getPinToNetSignature,
  hasStablePinConnectivitySignature,
  formatRepairAttemptSummary,
  getBuildRetryPolicy,
  getModeAfterFailedRequest,
  getProtectedCircuitChanges,
  getProtectedCircuitSignature,
  isInvalidModelOutput,
  MAX_AUTO_RETRIES,
  normalizeCircuitBuildRequest,
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

test('requires AI proposals to route wires orthogonally and around symbols', () => {
  const result = classifyProposalValidation({
    errors: ['Required pin is not connected.'],
    warnings: [
      'wire "W1": segment (0,0)->(20,20) is diagonal; add an orthogonal corner point.',
      'wire "W2": has a zero-length segment at (10,10); remove the duplicate point.',
      'Visual layout issue: wire "W3" crosses the symbol body for resistor "R1"; reroute the wire outside the symbol.',
      'relay "RL1".NC is intentionally unused.',
      'dcsource "V1": terminals are very close (50 px).',
    ],
  });

  assert.deepEqual(result.errors, [
    'Required pin is not connected.',
    'Drawing-quality issue: wire "W1": segment (0,0)->(20,20) is diagonal; add an orthogonal corner point.',
    'Drawing-quality issue: wire "W2": has a zero-length segment at (10,10); remove the duplicate point.',
    'Drawing-quality issue: Visual layout issue: wire "W3" crosses the symbol body for resistor "R1"; reroute the wire outside the symbol.',
  ]);
  assert.deepEqual(result.warnings, [
    'relay "RL1".NC is intentionally unused.',
    'dcsource "V1": terminals are very close (50 px).',
  ]);
});

test('compacts oversized history before retrying and repairs the rejected proposal in place', () => {
  const oversizedHistory = Array.from({ length: 10 }, (_, index) => ({
    role: index % 2 === 0 ? 'assistant' as const : 'user' as const,
    content: `start-${index}${'x'.repeat(3_200)}end-${index}`,
  }));
  const request = normalizeCircuitBuildRequest({ ...baseRequest, history: oversizedHistory });

  assert.equal(request.history?.length, 8);
  assert.ok(request.history?.every((item) => item.content.length <= 3_000));
  assert.match(request.history?.[0].content ?? '', /start-2/);
  assert.match(request.history?.[0].content ?? '', /end-2/);
  assert.match(request.history?.[0].content ?? '', /shortened for retry/);

  const rejectedProposal = { title: 'Partially wired flasher', elements: [] };
  const findings = ['The LED return wire is disconnected.'];
  const retry = buildManualRetryRequest(
    { ...baseRequest, history: oversizedHistory },
    brief,
    rejectedProposal,
    findings,
  );

  assert.equal(retry.mode, 'build');
  assert.deepEqual(retry.currentSpec, rejectedProposal);
  assert.match(retry.message, /last failing AI proposal/);
  assert.match(retry.message, /The LED return wire is disconnected/);
  assert.ok(retry.history?.every((item) => item.content.length <= 3_000));
});

test('whole-circuit rebuild uses the original request and updated brief', () => {
  const originalSpec = {
    title: 'Workbench draft',
    elements: [{ type: 'resistor', id: 'R1', value: '1k' }],
  };
  const rejectedProposal = {
    title: 'Incorrect generated draft',
    elements: [{ type: 'unsupported', id: 'X1' }],
  };
  const request = {
    ...baseRequest,
    currentSpec: originalSpec,
    history: [{ role: 'user' as const, content: 'Keep the existing resistor.' }],
  };
  const updatedBrief = { ...brief, goal: 'Build an LED indicator with the existing resistor.' };
  const fresh = buildWholeCircuitRetryRequest(request, updatedBrief);

  assert.equal(fresh.mode, 'build');
  assert.deepEqual(fresh.currentSpec, originalSpec);
  assert.notDeepEqual(fresh.currentSpec, rejectedProposal);
  assert.equal(fresh.message, request.message);
  assert.deepEqual(fresh.history, request.history);
  assert.deepEqual(fresh.brief, updatedBrief);
  assert.equal(fresh.responseFormatRetry, false);
});

test('layout repair authorizes visual movement while preserving the complete CircuitSpec as source', () => {
  const spec = {
    title: 'Indicator',
    width: 640,
    height: 360,
    elements: [
      { type: 'resistor', id: 'R1', label: 'R1', value: '1k', from: [80, 120], to: [140, 120] },
      { type: 'led', id: 'D1', label: 'D1', value: 'red', from: [200, 120], to: [240, 120] },
      { type: 'wire', id: 'W1', points: [[140, 120], [200, 120]] },
    ],
  };
  const repair = buildLayoutRepairRequest(baseRequest, brief, spec, [
    'Visual layout issue: text for resistor R1 overlaps text for led D1.',
  ]);

  assert.equal(repair.mode, 'build');
  assert.deepEqual(repair.currentSpec, spec);
  assert.match(repair.message, /explicitly authorized layout-only change/);
  assert.match(repair.message, /pin-to-pin netlist must remain exactly the same/);
  assert.match(repair.message, /Visual layout issue/);
  assert.equal(repair.history?.at(-1)?.content, baseRequest.message);
});

test('layout invariant signature allows position and routing changes but protects part details', () => {
  const before = {
    title: 'Indicator',
    width: 640,
    height: 360,
    elements: [
      { type: 'resistor', id: 'R1', label: 'R1', value: '1k', from: [80, 120], to: [140, 120] },
      { type: 'label', id: 'L1', text: 'VCC', at: [80, 60] },
      { type: 'wire', id: 'W1', points: [[140, 120], [200, 120]] },
    ],
  };
  const moved = {
    ...before,
    width: 800,
    height: 500,
    elements: [
      { type: 'resistor', id: 'R1', label: 'R1', value: '1k', from: [100, 200], to: [100, 260], rotation: 90 },
      { type: 'label', id: 'L1', text: 'VCC', at: [130, 200] },
      { type: 'wire', id: 'W2', points: [[100, 260], [180, 260], [180, 300]] },
    ],
  };
  const changedValue = {
    ...moved,
    elements: moved.elements.map((element) =>
      element.id === 'R1' ? { ...element, value: '2k' } : element,
    ),
  };

  assert.equal(getLayoutInvariantSignature(before), getLayoutInvariantSignature(moved));
  assert.notEqual(getLayoutInvariantSignature(before), getLayoutInvariantSignature(changedValue));
});

test('canonical netlist signature ignores auto-generated net names but preserves pin connectivity', () => {
  const first = {
    parts: [
      { designator: 'R1', type: 'resistor', value: '1k' },
      { designator: 'D1', type: 'led', value: 'red' },
    ],
    nets: [
      { name: 'N1', pins: ['R1.2', 'D1.A'] },
      { name: 'GND', pins: ['R1.1'] },
      { name: 'N2', pins: ['D1.K'] },
    ],
  };
  const sameWithDifferentGeneratedNames = {
    parts: [...first.parts].reverse(),
    nets: [
      { name: 'N9', pins: ['D1.A', 'R1.2'] },
      { name: 'GND', pins: ['R1.1'] },
      { name: 'N10', pins: ['D1.K'] },
    ],
  };
  const changedConnections = {
    ...sameWithDifferentGeneratedNames,
    nets: [
      { name: 'N9', pins: ['D1.A', 'R1.1'] },
      { name: 'GND', pins: ['R1.2'] },
      { name: 'N10', pins: ['D1.K'] },
    ],
  };

  assert.equal(
    getCircuitNetlistSignature(first),
    getCircuitNetlistSignature(sameWithDifferentGeneratedNames),
  );
  assert.notEqual(
    getCircuitNetlistSignature(first),
    getCircuitNetlistSignature(changedConnections),
  );
});

test('pin-to-net signatures ignore generated names but preserve net membership and named nets', () => {
  const first = {
    parts: [],
    nets: [
      { name: 'N1', pins: ['Q1.B', 'R1.2'] },
      { name: 'GND', pins: ['Q1.E'] },
    ],
  };
  const sameMembership = {
    parts: [],
    nets: [
      { name: 'N8', pins: ['R1.2', 'Q1.B'] },
      { name: 'GND', pins: ['Q1.E'] },
    ],
  };
  const changedMembership = {
    parts: [],
    nets: [
      { name: 'N8', pins: ['R1.2', 'Q1.E'] },
      { name: 'GND', pins: ['Q1.B'] },
    ],
  };

  assert.equal(getPinToNetSignature(first), getPinToNetSignature(sameMembership));
  assert.notEqual(getPinToNetSignature(first), getPinToNetSignature(changedMembership));
  assert.equal(hasStablePinConnectivitySignature('same', 'same'), true);
  assert.equal(hasStablePinConnectivitySignature('same', 'changed'), false);
  assert.equal(hasStablePinConnectivitySignature(null, null), false);
});

test('repair attempt summaries report zero, one, multiple, and maximum attempts accurately', () => {
  assert.equal(formatRepairAttemptSummary(0), 'No repair attempt could be made.');
  assert.equal(formatRepairAttemptSummary(1), 'Repair stopped after 1 AI repair attempt.');
  assert.equal(formatRepairAttemptSummary(2), 'Repair stopped after 2 AI repair attempts.');
  assert.equal(
    formatRepairAttemptSummary(MAX_AUTO_RETRIES),
    `Repair stopped after ${MAX_AUTO_RETRIES} AI repair attempts.`,
  );
});

test('automatic repair retries keep a user-supplied external reference attached', () => {
  const externalReference = `${EXTERNAL_REPAIR_REFERENCE_MARKER}\n{"title":"Reference","elements":[]}`;
  const originalRequest = {
    ...baseRequest,
    message: `Repair the current circuit.\n\n${externalReference}`,
  };
  const repairRequest = buildRepairRequest(
    originalRequest,
    brief,
    ['A required pin is disconnected.'],
  );

  assert.match(repairRequest.message, /A required pin is disconnected/);
  assert.ok(repairRequest.message.includes(externalReference));
});

test('rewiring starts without old routing elements and preserves the component set', () => {
  const rejectedProposal = {
    title: 'LED indicator',
    width: 900,
    height: 600,
    elements: [
      { type: 'resistor', id: 'R1', label: 'R1', value: '1k', x: 100, y: 100 },
      { type: 'led', id: 'D1', label: 'D1', value: 'red', x: 220, y: 100 },
      { type: 'wire', id: 'W1', points: [[100, 100], [220, 100]] },
      { type: 'junction', id: 'J1', at: [160, 100] },
      { type: 'crossing', id: 'X1', at: [180, 120] },
      { type: 'label', id: 'N1', text: 'VCC', at: [100, 40] },
    ],
  };
  const findings = ['Wire W1 endpoint at (220,100) is not connected.'];
  const updatedBrief = { ...brief, goal: 'Build a red LED indicator.' };
  const request = buildWireRebuildRequest(baseRequest, updatedBrief, rejectedProposal, findings);

  assert.deepEqual(request.currentSpec?.elements.map((element) => element.type), [
    'resistor',
    'led',
    'label',
  ]);
  assert.equal(request.currentSpec?.width, 900);
  assert.equal(request.currentSpec?.height, 600);
  assert.match(request.message, /Start its wiring over/);
  assert.match(request.message, /Preserve every component, value, label, ID, orientation, position/);
  assert.match(request.message, /Wire W1 endpoint at \(220,100\) is not connected/);
  assert.equal(request.history?.at(-1)?.content, baseRequest.message);
  assert.deepEqual(request.brief, updatedBrief);
});

test('wire-rebuild prompt is explicit about rebuilding connections only', () => {
  const message = buildWireRebuildMessage(['A required pin is not connected.']);
  assert.match(message, /all previous wires and wire-routing markers as discarded/);
  assert.match(message, /Do not add, remove, or redesign circuit parts/);
});

test('chooses recovery only for exhausted repairs and matching blocker types', () => {
  const exhausted = [{
    attempt: 3,
    outcome: 'exhausted' as const,
    nonWireElementsModified: false,
    metadataModified: false,
    validationErrors: ['A required pin is not connected.'],
    validationWarnings: [],
  }];
  const rejectedProposal = {
    title: 'LED indicator',
    elements: [{ type: 'resistor', id: 'R1' }, { type: 'wire', id: 'W1' }],
  };
  const wireFindings = ['A required pin is not connected.'];

  assert.equal(getRetryRecoveryKind([], wireFindings, rejectedProposal), null);
  assert.equal(getRetryRecoveryKind(exhausted, [], rejectedProposal), null);
  assert.equal(getRetryRecoveryKind(
    [{ ...exhausted[0], outcome: 'rejected' }],
    wireFindings,
    rejectedProposal,
  ), null);
  assert.equal(getRetryRecoveryKind(
    [{ ...exhausted[0], attempt: 1, outcome: 'stopped' }],
    wireFindings,
    rejectedProposal,
  ), null);
  assert.equal(getRetryRecoveryKind(
    [{ ...exhausted[0], outcome: 'stopped' }],
    wireFindings,
    rejectedProposal,
  ), 'rewire');
  assert.equal(getRetryRecoveryKind(exhausted, wireFindings, rejectedProposal), 'rewire');
  assert.equal(getRetryRecoveryKind(
    exhausted,
    [...wireFindings, 'Element U1: unsupported CircuitDraw type "chip".'],
    rejectedProposal,
  ), 'rebuild');
  assert.equal(getRetryRecoveryKind(
    exhausted,
    ['A new warning without a known repair path.'],
    rejectedProposal,
  ), null);
});

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

test('stops a transient retry loop when the user aborts during its wait', async () => {
  const controller = new AbortController();
  let sends = 0;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      signal: controller.signal,
      send: async () => {
        sends += 1;
        throw Object.assign(new Error('temporary provider error'), { status: 503 });
      },
      getProposal: () => null,
      inspectProposal: () => ({ validation: { errors: [], warnings: [] }, canRepair: true }),
      makeRepairRequest: (request) => request,
      wait: async () => {
        controller.abort(new DOMException('Stopped by the user.', 'AbortError'));
      },
    }),
    (error: unknown) => error instanceof Error && error.name === 'AbortError',
  );

  assert.equal(sends, 1);
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
  const repairedProposal = {
    answer: 'The disconnected wire is fixed.',
    nextMode: 'build' as const,
    proposal: { spec: { title: 'Repaired AI proposal', elements: [] } },
  };
  const blockingFinding = 'Wire W1 at (120,80) is not connected to anything.';
  const advisoryWarning = 'W1 has a diagonal segment; use horizontal and vertical wires.';
  const requests: CircuitBuildChatInput[] = [];
  const progress: Array<[number, string]> = [];

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async (request) => {
      requests.push(request);
      return requests.length === 1 ? badProposal : repairedProposal;
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
  assert.equal(result.response, repairedProposal);
  assert.equal(result.repairAttemptCount, 1);
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
  assert.equal(result.repairAttemptCount, 0);
});

test('retries an AI proposal when layout analysis finds a wire through a component body', async () => {
  const firstProposal = { title: 'Crossing wire', elements: [] };
  const correctedProposal = { title: 'Rerouted wire', elements: [] };
  const warning = 'Visual layout issue: wire "W1" crosses the symbol body for resistor "R1"; reroute the wire outside the symbol.';
  const requests: CircuitBuildChatInput[] = [];
  let sendCount = 0;

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async (request) => {
      requests.push(request);
      sendCount += 1;
      return {
        answer: 'Proposal ready.',
        proposal: { spec: sendCount === 1 ? firstProposal : correctedProposal },
      };
    },
    getProposal: (response) => response.proposal.spec,
    inspectProposal: (proposal) => ({
      validation: classifyProposalValidation({
        errors: [],
        warnings: proposal === firstProposal ? [warning] : [],
      }),
      canRepair: true,
    }),
    makeRepairRequest: (response, findings) => ({
      ...baseRequest,
      message: `${baseRequest.message}\n${findings.join('\n')}`,
      currentSpec: response.proposal.spec,
    }),
    wait: async () => {},
  });

  assert.equal(requests.length, 2);
  assert.match(requests[1].message, /crosses the symbol body for resistor "R1"/);
  assert.equal(requests[1].currentSpec, firstProposal);
  assert.equal(result.response.proposal.spec, correctedProposal);
  assert.deepEqual(result.proposalInspection?.validation.errors, []);
});

test('failure after one or two repair calls reports the actual number of AI attempts', async () => {
  for (const failedAfter of [1, 2]) {
    let sends = 0;
    let caught: unknown;
    await assert.rejects(
      runCircuitBuildAttempts({
        initialRequest: baseRequest,
        send: async () => {
          sends += 1;
          return { proposal: { spec: { id: sends } } };
        },
        getProposal: (response) => response.proposal.spec,
        inspectProposal: () => ({
          validation: { errors: ['A required wire is disconnected.'], warnings: [] },
          canRepair: sends - 1 < failedAfter,
        }),
        makeRepairRequest: () => baseRequest,
        wait: async () => {},
      }),
      (error: unknown) => {
        caught = error;
        return error instanceof CircuitBuildAttemptError;
      },
    );

    assert.ok(caught instanceof CircuitBuildAttemptError);
    assert.equal(caught.repairAttemptCount, failedAfter);
    assert.equal(sends, failedAfter + 1);
  }
});

test('an untrustworthy legacy baseline still sends incremental AI repair attempts', async () => {
  let sends = 0;
  let repairRequest: typeof baseRequest | undefined;
  const baseline = { title: 'Ambiguous legacy drawing', elements: [] };
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: baseline,
    getConnectivitySignature: (proposal) =>
      proposal.title === baseline.title ? null : 'repaired-pin-map',
    send: async () => {
      sends += 1;
      return {
        proposal: {
          spec: {
            title: sends === 1 ? 'First repair attempt' : 'Validated repair',
            elements: [],
          },
        },
      };
    },
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: {
        errors: sends === 1 ? ['An endpoint is disconnected.'] : [],
        warnings: [],
      },
      canRepair: true,
    }),
    makeRepairRequest: (_response, findings) => {
      repairRequest = { ...baseRequest, message: findings.join('\n') };
      return repairRequest;
    },
    wait: async () => {},
  });

  assert.equal(result.repairAttemptCount, 2);
  assert.equal(sends, 2);
  assert.equal(repairRequest?.message, 'An endpoint is disconnected.');
});

test('route repair retries a candidate that changes trusted pin-to-net membership', async () => {
  let sends = 0;
  const findings = ['A known astable feedback connection is invalid.'];

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    send: async () => {
      sends += 1;
      return {
        proposal: {
          spec: {
            id: sends,
            pinSignature: sends === 2
              ? 'Q1.B|N1;Q2.B|N1'
              : 'Q1.B|N1;Q2.B|N2',
          },
        },
      };
    },
    getProposal: (response) => response.proposal.spec,
    getConnectivitySignature: (proposal) => proposal.pinSignature,
    inspectProposal: () => ({
      validation: {
        errors: sends === 1 ? findings : [],
        warnings: [],
      },
      canRepair: true,
    }),
    makeRepairRequest: () => baseRequest,
    wait: async () => {},
  });

  assert.equal(result.repairAttemptCount, 2);
  assert.equal(result.response.proposal.spec.pinSignature, 'Q1.B|N1;Q2.B|N2');
  assert.equal(sends, 3);
});

test('route repair retries a candidate whose connectivity cannot be established', async () => {
  const baseline = { pinSignature: 'Q1.B|N1;Q2.B|N2' };
  let sends = 0;
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: baseline,
    getConnectivitySignature: (proposal) => proposal.pinSignature,
    send: async () => {
      sends += 1;
      return {
        proposal: {
          spec: {
            pinSignature: sends === 1 ? null : baseline.pinSignature,
          },
        },
      };
    },
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: { errors: [], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: () => baseRequest,
    wait: async () => {},
  });

  assert.equal(result.repairAttemptCount, 2);
  assert.equal(result.response.proposal.spec.pinSignature, baseline.pinSignature);
  assert.equal(sends, 2);
});

test('layout repair allows a different route when pin-to-net membership is unchanged', async () => {
  const baseline = { route: 'original', pinSignature: 'Q1.B|N1;Q2.B|N2' };
  const candidate = { route: 'rerouted', pinSignature: 'Q1.B|N1;Q2.B|N2' };
  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: baseline,
    getConnectivitySignature: (proposal) => proposal.pinSignature,
    send: async () => ({ proposal: { spec: candidate } }),
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: { errors: [], warnings: [] },
      canRepair: true,
    }),
    makeRepairRequest: () => baseRequest,
  });

  assert.equal(result.response.proposal.spec.route, 'rerouted');
  assert.equal(result.repairAttemptCount, 1);
});

test('each repair request uses the latest failing proposal, not the workbench draft', async () => {
  const firstFailingSpec = { title: 'First rejected proposal', elements: [] };
  const secondFailingSpec = { title: 'Latest rejected proposal', elements: [] };
  const repairedProposal = {
    answer: 'The latest wiring issue is fixed.',
    nextMode: 'build' as const,
    proposal: { spec: { title: 'Repaired proposal', elements: [] } },
  };
  const proposals = [
    { answer: 'First draft.', nextMode: 'build' as const, proposal: { spec: firstFailingSpec } },
    { answer: 'Updated draft.', nextMode: 'build' as const, proposal: { spec: secondFailingSpec } },
    repairedProposal,
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
      validation: {
        errors: requests.length < 3 ? ['Wire W1 endpoint is disconnected.'] : [],
        warnings: [],
      },
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

test('restores the original component before validating a repair that moves it', async () => {
  const initialSpec = {
    title: 'Draft',
    elements: [{ type: 'npn', id: 'Q1', at: [100, 100] }],
  };
  const movedSpec = {
    title: 'Draft',
    elements: [
      { type: 'npn', id: 'Q1', at: [120, 100] },
      { type: 'wire', id: 'W1', points: [[50, 50], [60, 50]] },
    ],
  };
  let sends = 0;
  let inspections = 0;

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: initialSpec,
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
      validation: {
        errors: inspections++ === 0 ? ['Wire W1 endpoint is disconnected.'] : [],
        warnings: [],
      },
      canRepair: true,
    }),
    getProtectedCircuitSignature: (spec) =>
      getProtectedCircuitSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
    getProtectedCircuitChanges: (protectedSpec, proposal) =>
      getProtectedCircuitChanges(
        protectedSpec as NonNullable<CircuitBuildChatInput['currentSpec']>,
        proposal as NonNullable<CircuitBuildChatInput['currentSpec']>,
      ),
    restoreProtectedSpec: (response, protectedSpec) => ({
      ...response,
      proposal: {
        ...response.proposal,
        spec: restoreProtectedNonWireElements(
          protectedSpec as NonNullable<CircuitBuildChatInput['currentSpec']>,
          response.proposal.spec as NonNullable<CircuitBuildChatInput['currentSpec']>,
        ),
      },
    }),
    makeRepairRequest: () => baseRequest,
    wait: async () => {},
  });

  assert.equal(sends, 2);
  assert.deepEqual(result.response.proposal.spec.elements[0].at, [100, 100]);
  assert.deepEqual(result.response.proposal.spec.elements[1].points, [[50, 50], [60, 50]]);
  assert.equal(result.repairDiagnostics[1].nonWireElementsModified, true);
});

test('every retry restores non-wire data from an immutable original snapshot', async () => {
  const baseline = {
    title: 'Baseline design',
    width: 640,
    height: 480,
    elements: [
      { type: 'npn', id: 'Q1', value: '2N3904', at: [100, 100] },
      { type: 'label', id: 'LABEL1', text: 'Keep this note', at: [40, 40] },
      { type: 'wire', id: 'W_OLD', points: [[70, 100], [75, 100]] },
    ],
  };
  const originalBaseline = structuredClone(baseline);
  const repairRequests: Array<NonNullable<CircuitBuildChatInput['currentSpec']>> = [];
  let sends = 0;

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: baseline,
    send: async () => {
      sends += 1;
      return {
        proposal: {
          spec: {
            title: `AI title ${sends}`,
            width: 10,
            height: 20,
            elements: [
              { type: 'npn', id: `Q${sends + 1}`, value: `changed-${sends}`, at: [200, 200] },
              { type: 'wire', id: `W_RETRY_${sends}`, points: [[50, 50], [60 + sends, 50]] },
            ],
          },
        },
      };
    },
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: {
        errors: sends < 3 ? ['A wire endpoint remains disconnected.'] : [],
        warnings: [],
      },
      canRepair: true,
    }),
    getProtectedCircuitSignature: (proposal) =>
      getProtectedCircuitSignature(proposal as NonNullable<CircuitBuildChatInput['currentSpec']>),
    getProtectedCircuitChanges: (protectedSpec, proposal) =>
      getProtectedCircuitChanges(
        protectedSpec as NonNullable<CircuitBuildChatInput['currentSpec']>,
        proposal as NonNullable<CircuitBuildChatInput['currentSpec']>,
      ),
    restoreProtectedSpec: (response, protectedSpec) => {
      assert.ok(Object.isFrozen(protectedSpec));
      assert.ok(Object.isFrozen(protectedSpec.elements[0].at));
      return {
        ...response,
        proposal: {
          ...response.proposal,
          spec: restoreProtectedNonWireElements(
            protectedSpec as NonNullable<CircuitBuildChatInput['currentSpec']>,
            response.proposal.spec as NonNullable<CircuitBuildChatInput['currentSpec']>,
          ),
        },
      };
    },
    makeRepairRequest: (response) => {
      repairRequests.push(response.proposal.spec);
      return { ...baseRequest, currentSpec: response.proposal.spec };
    },
    wait: async () => {},
  });

  assert.equal(sends, 3);
  assert.equal(result.repairAttemptCount, 3);
  assert.deepEqual(baseline, originalBaseline);
  assert.equal(result.response.proposal.spec.title, 'Baseline design');
  assert.equal(result.response.proposal.spec.width, 640);
  assert.equal(result.response.proposal.spec.elements[0].id, 'Q1');
  assert.equal(result.response.proposal.spec.elements[0].value, '2N3904');
  assert.equal(result.response.proposal.spec.elements[1].text, 'Keep this note');
  assert.equal(repairRequests.length, 2);
  for (const retrySpec of repairRequests) {
    assert.equal(retrySpec.title, 'Baseline design');
    assert.equal(retrySpec.elements[0].id, 'Q1');
    assert.equal(retrySpec.elements[0].value, '2N3904');
    assert.equal(retrySpec.elements[1].text, 'Keep this note');
  }
});

test('layout-only repair keeps authorized component movement across automatic retries', async () => {
  const initialSpec = {
    title: 'Draft',
    width: 300,
    height: 240,
    elements: [
      { type: 'resistor', id: 'R1', value: '1k', from: [100, 100], to: [180, 100] },
    ],
  };
  const movedSpec = {
    title: 'Draft',
    width: 360,
    height: 280,
    elements: [
      { type: 'resistor', id: 'R1', value: '1k', from: [140, 120], to: [220, 120] },
      { type: 'wire', id: 'W1', points: [[100, 120], [140, 120]] },
    ],
  };
  let sends = 0;

  const result = await runCircuitBuildAttempts({
    initialRequest: baseRequest,
    initialProtectedSpec: initialSpec,
    send: async () => ({
      answer: 'Adjusted the layout.',
      nextMode: 'build' as const,
      proposal: { spec: sends++ === 0 ? initialSpec : movedSpec },
    }),
    getProposal: (response) => response.proposal.spec,
    inspectProposal: () => ({
      validation: {
        errors: sends === 1 ? ['Drawing-quality issue: symbols are too close.'] : [],
        warnings: [],
      },
      canRepair: true,
    }),
    getProtectedCircuitSignature: (spec) =>
      getLayoutInvariantSignature(spec as NonNullable<CircuitBuildChatInput['currentSpec']>),
    getProtectedCircuitChanges: (protectedSpec, proposal) =>
      getLayoutInvariantChanges(
        protectedSpec as NonNullable<CircuitBuildChatInput['currentSpec']>,
        proposal as NonNullable<CircuitBuildChatInput['currentSpec']>,
      ),
    makeRepairRequest: () => baseRequest,
    wait: async () => {},
  });

  assert.equal(sends, 2);
  assert.deepEqual(result.response.proposal.spec.elements[0].from, [140, 120]);
  assert.deepEqual(result.response.proposal.spec.elements[0].to, [220, 120]);
  assert.equal(result.response.proposal.spec.width, 360);
  assert.equal(result.repairDiagnostics[1].nonWireElementsModified, false);
});

test('protects components while accepting rebuilt wires and routing markers', () => {
  const baseline = {
    title: 'LED indicator',
    elements: [
      { type: 'resistor', id: 'R1', value: '1k', x: 100, y: 100 },
      { type: 'wire', id: 'OLD_WIRE', points: [[100, 100], [200, 100]] },
      { type: 'junction', id: 'OLD_JUNCTION', at: [150, 100] },
    ],
  };
  const routedProposal = {
    title: 'LED indicator',
    elements: [
      { type: 'resistor', id: 'R1', value: '1k', x: 100, y: 100 },
      { type: 'wire', id: 'NEW_WIRE', points: [[100, 100], [100, 200]] },
      { type: 'junction', id: 'NEW_JUNCTION', at: [100, 150] },
      { type: 'crossing', id: 'NEW_CROSSING', at: [120, 150] },
    ],
  };
  const alteredProposal = {
    ...routedProposal,
    title: 'Changed by AI',
    elements: [
      { type: 'resistor', id: 'R1', value: '10k', x: 250, y: 100 },
      ...routedProposal.elements.slice(1),
    ],
  };
  const restored = restoreProtectedNonWireElements(baseline, alteredProposal);

  assert.equal(getProtectedCircuitSignature(baseline), getProtectedCircuitSignature(routedProposal));
  assert.deepEqual(restored.elements, [
    baseline.elements[0],
    alteredProposal.elements[1],
    alteredProposal.elements[2],
    alteredProposal.elements[3],
  ]);
  assert.equal(restored.title, baseline.title);
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
      assert.equal(error.repairAttemptCount, MAX_AUTO_RETRIES);
      assert.equal(error.canRetryManually, true);
      assert.deepEqual(error.validationFindings, findings);
      return true;
    },
  );

  assert.equal(sends, MAX_AUTO_RETRIES + 1);
  assert.equal(repairRequests, MAX_AUTO_RETRIES);
});

test('stops after the current repair attempt when requested and preserves its latest proposal', async () => {
  const firstProposal = {
    answer: 'Draft ready.',
    nextMode: 'build' as const,
    proposal: { spec: { title: 'First draft', elements: [] } },
  };
  const latestProposal = {
    answer: 'Repair update.',
    nextMode: 'build' as const,
    proposal: { spec: { title: 'Latest repair', elements: [] } },
  };
  const findings = ['Wire W1 is not connected to anything.'];
  let sends = 0;
  let stopRequested = false;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        if (sends === 2) stopRequested = true;
        return sends === 1 ? firstProposal : latestProposal;
      },
      getProposal: (response) => response.proposal.spec,
      inspectProposal: () => ({
        validation: { errors: findings, warnings: [] },
        canRepair: true,
      }),
      makeRepairRequest: () => baseRequest,
      shouldStopRepair: () => stopRequested,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.stoppedByUser, true);
      assert.equal(error.canRetryManually, true);
      assert.deepEqual(error.rejectedProposal, latestProposal.proposal.spec);
      assert.deepEqual(error.validationFindings, findings);
      assert.equal(error.repairDiagnostics.at(-1)?.outcome, 'stopped');
      return true;
    },
  );

  assert.equal(sends, 2);
});

test('keeps the rejected proposal and validation findings when a repair request fails', async () => {
  const rejectedProposal = { title: 'Partially wired flasher', elements: [] };
  const initialResponse = {
    answer: 'Here is the first draft.',
    nextMode: 'build' as const,
    proposal: { spec: rejectedProposal },
  };
  const findings = ['The LED return wire is disconnected.'];
  let sends = 0;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        if (sends === 1) return initialResponse;
        throw Object.assign(new Error('History entry exceeds 3000 characters.'), { status: 400 });
      },
      getProposal: (response) => response.proposal?.spec ?? null,
      inspectProposal: () => ({
        validation: { errors: findings, warnings: ['One unused relay contact.'] },
        canRepair: true,
      }),
      makeRepairRequest: () => baseRequest,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.failureKind, 'generation');
      assert.deepEqual(error.validationFindings, findings);
      assert.deepEqual(error.validationWarnings, ['One unused relay contact.']);
      assert.deepEqual(error.rejectedProposal, rejectedProposal);
      return true;
    },
  );
});

test('preserves the last invalid proposal when a repair response omits its schematic', async () => {
  const rejectedProposal = { title: 'Partially wired flasher', elements: [] };
  const initialResponse = {
    answer: 'Here is the first draft.',
    nextMode: 'build' as const,
    proposal: { spec: rejectedProposal },
  };
  const findings = ['The LED return wire is disconnected.'];
  let sends = 0;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        return sends === 1 ? initialResponse : noProposal;
      },
      getProposal: (response) => response.proposal?.spec ?? null,
      inspectProposal: () => ({ validation: { errors: findings, warnings: [] }, canRepair: true }),
      makeRepairRequest: () => baseRequest,
      wait: async () => {},
    }),
    (error: unknown) => {
      assert.ok(error instanceof CircuitBuildAttemptError);
      assert.equal(error.failureKind, 'output');
      assert.deepEqual(error.validationFindings, findings);
      assert.deepEqual(error.rejectedProposal, rejectedProposal);
      return true;
    },
  );
});

test('does not automatically retry permanent request errors but allows manual retry', async () => {
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
      assert.equal(error.canRetryManually, true);
      return true;
    },
  );
  assert.equal(sends, 1);
});

test('retries rate limits with backoff even when Retry-After guidance is absent', () => {
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('rate limited'), { status: 429 })),
    { retryable: true, delayMs: undefined },
  );
  assert.deepEqual(
    getBuildRetryPolicy(Object.assign(new Error('rate limited'), {
      status: 429,
      headers: new Headers({ 'retry-after': '2' }),
    })),
    { retryable: true, delayMs: 2_000 },
  );
});

test('automatically retries a retryable 502 and exposes manual retry after exhaustion', async () => {
  const gatewayFailure = Object.assign(new Error('provider rate limit'), {
    status: 502,
    headers: new Headers({ 'x-circuit-ai-retryable': 'true' }),
  });
  let sends = 0;
  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: baseRequest,
      send: async () => {
        sends += 1;
        throw gatewayFailure;
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

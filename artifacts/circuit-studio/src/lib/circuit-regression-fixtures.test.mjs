import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as CircuitGeometry from '../../../../lib/circuit-geometry/src/index.ts';
import {
  CircuitBuildAttemptError,
  getPinToNetSignature,
  runCircuitBuildAttempts,
} from './circuit-build-retry.ts';

const moduleStub = { exports: {} };
const circuitDrawSource = readFileSync(new URL('../../public/circuit-draw.js', import.meta.url), 'utf8');
runInNewContext(circuitDrawSource, { module: moduleStub, CircuitGeometry });
const CircuitDraw = moduleStub.exports;

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

function netSignatureForPin(spec, pin) {
  const net = CircuitDraw.netlist(spec).nets.find((item) => item.pins.includes(pin));
  return net ? JSON.stringify(Array.from(net.pins).sort()) : null;
}

function assertSameNet(spec, pins) {
  const firstNet = netSignatureForPin(spec, pins[0]);
  assert.ok(firstNet, `${pins[0]} should belong to a net`);
  for (const pin of pins.slice(1)) {
    assert.equal(netSignatureForPin(spec, pin), firstNet, `${pin} should share ${pins[0]}'s net`);
  }
}

function connectivitySignature(spec) {
  try {
    return getPinToNetSignature(CircuitDraw.netlist(spec));
  } catch {
    return null;
  }
}

test('series LED fixture has the expected source-to-return pin path', () => {
  const spec = fixture('series-led.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  assertSameNet(spec, ['B1.+', 'SW1.1']);
  assertSameNet(spec, ['SW1.2', 'R1.1']);
  assertSameNet(spec, ['R1.2', 'D1.A']);
  assertSameNet(spec, ['D1.K', 'B1.-']);
});

test('single-transistor switch keeps its base resistor and pull-down on the intended nets', () => {
  const spec = fixture('single-transistor-switch.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  assertSameNet(spec, ['R_INPUT.2', 'Q1.B', 'R_PULLDOWN.1']);
  assertSameNet(spec, ['V1.-', 'Q1.E', 'R_PULLDOWN.2']);
  assert.deepEqual(
    Array.from(CircuitDraw.netlist(spec).nets.find((net) => net.name === 'GND')?.pins ?? []).sort(),
    ['Q1.E', 'R_PULLDOWN.2', 'V1.-'],
  );
  assert.notEqual(netSignatureForPin(spec, 'Q1.B'), netSignatureForPin(spec, 'Q1.C'));
});

test('parallel branches share supply and return through explicit junctions', () => {
  const spec = fixture('parallel-led-branches.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  assertSameNet(spec, ['B1.+', 'R1.1', 'R2.1']);
  assertSameNet(spec, ['B1.-', 'D1.K', 'D2.K']);
  assert.notEqual(netSignatureForPin(spec, 'R1.1'), netSignatureForPin(spec, 'R2.2'));
});

test('a shared-base switch circuit is not classified as an astable', () => {
  const spec = fixture('shared-base-switches.json');
  const titledLikeAnAstable = CircuitDraw.validate({
    ...structuredClone(spec),
    title: 'Astable title on a shared-base switch test',
  });
  const report = CircuitDraw.validate(spec);

  assert.deepEqual(Array.from(report.errors), []);
  assertSameNet(spec, ['R1.2', 'Q1.B', 'Q2.B', 'R_PULLDOWN.1']);
  assert.equal(
    report.topologyErrors.some((finding) => finding.includes('Q1.B and Q2.B share one net')),
    false,
  );
  assert.deepEqual(Array.from(titledLikeAnAstable.errors), []);
  assert.equal(
    titledLikeAnAstable.topologyErrors.some((finding) => finding.includes('Q1.B and Q2.B share one net')),
    false,
  );
});

test('valid astable fixture remains clear after the local rail-tail cleanup', () => {
  const original = fixture('astable-flasher.json');
  const spec = CircuitDraw.autoFix(original).spec;
  const report = CircuitDraw.validate(spec);
  const pinMembership = (candidate) => CircuitDraw.netlist(candidate, true).nets
    .map((net) => Array.from(net.pins).sort())
    .sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));

  assert.deepEqual(Array.from(report.errors), []);
  assert.notEqual(netSignatureForPin(spec, 'Q1.B'), netSignatureForPin(spec, 'Q2.B'));
  assert.deepEqual(pinMembership(spec), pinMembership(original));
});

test('astable base-short validation is identical under descriptive and neutral titles', () => {
  const valid = CircuitDraw.autoFix(fixture('astable-flasher.json')).spec;
  const baseShort = structuredClone(valid);
  baseShort.elements.push({
    type: 'wire',
    id: 'W_BASE_TO_BASE_SHORT',
    points: [[150, 250], [150, 330], [530, 330], [530, 250]],
  });
  const titles = [
    'Two-Transistor Astable Multivibrator',
    'Alternating LED indicator',
    'Unrelated display title',
  ];
  const findingsByTitle = titles.map((title) => {
    const report = CircuitDraw.validate({ ...structuredClone(baseShort), title });
    const relevant = report.topologyErrors.filter((finding) =>
      finding.includes('Q1.B and Q2.B share one net'),
    );
    assert.equal(relevant.length, 1, `Expected the base short to be reported for "${title}"`);
    return relevant[0];
  });

  assert.equal(findingsByTitle[0], findingsByTitle[1]);
  assert.equal(findingsByTitle[1], findingsByTitle[2]);
  assertSameNet(baseShort, ['Q1.B', 'Q2.B']);
});

test('wire crossing bridge preserves two separate pin groups without a junction', () => {
  const spec = fixture('non-connecting-crossing.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  assertSameNet(spec, ['B_HL.+', 'B_HR.+']);
  assertSameNet(spec, ['B_VT.+', 'B_VB.+']);
  assert.notEqual(netSignatureForPin(spec, 'B_HL.+'), netSignatureForPin(spec, 'B_VT.+'));
});

test('layout repair accepts a different route with the same pin-to-net membership', async () => {
  const baseline = fixture('parallel-led-branches.json');
  const rerouted = structuredClone(baseline);
  rerouted.elements.find((element) => element.id === 'W_R1_D1').points = [
    [180, 210],
    [220, 210],
    [220, 250],
    [180, 250],
  ];
  const result = await runCircuitBuildAttempts({
    initialRequest: {},
    initialProtectedSpec: baseline,
    getConnectivitySignature: connectivitySignature,
    send: async () => ({ spec: rerouted }),
    getProposal: (response) => response.spec,
    inspectProposal: (spec) => {
      const report = CircuitDraw.validate(spec);
      return {
        validation: {
          errors: Array.from(report.errors),
          warnings: Array.from(report.warnings),
        },
        canRepair: true,
      };
    },
    makeRepairRequest: () => ({}),
  });

  assert.deepEqual(Array.from(CircuitDraw.validate(rerouted).errors), []);
  assert.equal(result.response.spec, rerouted);
  assert.equal(connectivitySignature(baseline), connectivitySignature(rerouted));
});

test('layout repair rejects a junction that merges two previously separate crossing nets', async () => {
  const baseline = fixture('non-connecting-crossing.json');
  const merged = structuredClone(baseline);
  merged.elements = merged.elements.filter((element) => element.type !== 'crossing');
  merged.elements.push({ type: 'junction', id: 'J_MERGE', x: 50, y: 50 });
  let caught;

  await assert.rejects(
    runCircuitBuildAttempts({
      initialRequest: {},
      initialProtectedSpec: baseline,
      getConnectivitySignature: connectivitySignature,
      send: async () => ({ spec: merged }),
      getProposal: (response) => response.spec,
      inspectProposal: (spec) => {
        const report = CircuitDraw.validate(spec);
        return {
          validation: {
            errors: Array.from(report.errors),
            warnings: Array.from(report.warnings),
          },
          canRepair: true,
        };
      },
      makeRepairRequest: () => ({}),
    }),
    (error) => {
      caught = error;
      return error instanceof CircuitBuildAttemptError &&
        error.failureKind === 'repair-blocked';
    },
  );

  assert.ok(caught instanceof CircuitBuildAttemptError);
  assert.equal(caught.repairAttemptCount, 1);
  assert.equal(connectivitySignature(baseline) === connectivitySignature(merged), false);
  assertSameNet(baseline, ['B_HL.+', 'B_HR.+']);
  assert.notEqual(netSignatureForPin(baseline, 'B_HL.+'), netSignatureForPin(baseline, 'B_VT.+'));
});

test('legacy FM fixture keeps the supported dcsource type and return net', () => {
  const spec = fixture('legacy-fm-transmitter-dcsource.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(spec).errors), []);
  const source = CircuitDraw.netlist(spec).parts.find((part) => part.designator === 'V1');
  assert.equal(source?.designator, 'V1');
  assert.equal(source?.type, 'DC voltage source');
  assert.equal(source?.value, '9V');
  assertSameNet(spec, ['V1.-', 'MK1.2', 'R2.2']);

  const terminalBased = fixture('fm-transmitter-compatible.json');
  assert.deepEqual(Array.from(CircuitDraw.validate(terminalBased).errors), []);
});

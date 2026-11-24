import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { test } from 'node:test';
import * as CircuitGeometry from '../../../../lib/circuit-geometry/src/index.ts';
import {
  checkIntent,
  checkElectricalRules,
  runElectricalChecks,
} from './circuit-electrical-checks.ts';

const moduleStub = { exports: {} };
const circuitDrawSource = readFileSync(new URL('../../public/circuit-draw.js', import.meta.url), 'utf8');
runInNewContext(circuitDrawSource, { module: moduleStub, CircuitGeometry });
const CircuitDraw = moduleStub.exports;

function fixture(name) {
  return JSON.parse(readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8'));
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function electricalFindings(spec, intent) {
  return runElectricalChecks(CircuitDraw.netlist(spec, true), intent).findings;
}

test('dark-activated LED fixture matches its own netlist without electrical findings', () => {
  const spec = fixture('dark-activated-led.json');
  const netlist = CircuitDraw.netlist(spec);
  const report = runElectricalChecks(netlist, netlist.nets.map((net) => net.pins));

  assert.deepEqual(report.errors, []);
  assert.deepEqual(report.warnings, []);
});

test('an LED connected directly to the supply is reported without a series resistor', () => {
  const spec = clone(fixture('dark-activated-led.json'));
  spec.elements = spec.elements.filter((element) => element.id !== 'R2');
  const led = spec.elements.find((element) => element.id === 'LED1');
  led.from = [355, 50];

  assert.ok(electricalFindings(spec).some((finding) =>
    finding.code === 'LED_NO_SERIES_RESISTOR' && finding.message.includes('LED1'),
  ));
});

test('reversing the LED makes its intended anode connection fail', () => {
  const spec = fixture('dark-activated-led.json');
  const netlist = CircuitDraw.netlist(spec);
  const led = spec.elements.find((element) => element.id === 'LED1');
  [led.from, led.to] = [led.to, led.from];
  const findings = checkIntent(
    CircuitDraw.netlist(spec),
    netlist.nets.map((net) => net.pins),
  );

  assert.ok(findings.some((finding) =>
    finding.code === 'INTENT_CONNECTION_MISSING' &&
    finding.message.includes('LED1.A'),
  ));
});

test('shorting the transistor base to ground detects both the BJT and photoresistor shorts', () => {
  const spec = clone(fixture('dark-activated-led.json'));
  spec.elements.push({ type: 'wire', points: [[305, 250], [305, 440]] });
  const findings = electricalFindings(spec);

  assert.ok(findings.some((finding) =>
    finding.code === 'BJT_PINS_SHORTED' && finding.message.includes('Q1'),
  ));
  assert.ok(findings.some((finding) =>
    finding.code === 'PART_SHORTED' && finding.message.includes('LDR1'),
  ));
});

test('replacing the base resistor with a wire reports the base on the supply rail', () => {
  const spec = clone(fixture('dark-activated-led.json'));
  spec.elements = spec.elements.filter((element) => element.id !== 'R1');
  spec.elements.push({ type: 'wire', points: [[180, 50], [180, 140]] });

  assert.ok(electricalFindings(spec).some((finding) =>
    finding.code === 'BJT_BASE_ON_RAIL' && finding.message.includes('Q1'),
  ));
});

test('the failed flasher reports both base-emitter shorts independently of its title', () => {
  const spec = fixture('failed-flasher-bases-shorted.json');
  for (const title of [spec.title, 'Untitled']) {
    const titledSpec = { ...clone(spec), title };
    const findings = electricalFindings(titledSpec);
    for (const designator of ['Q1', 'Q2']) {
      assert.ok(findings.some((finding) =>
        finding.code === 'BJT_PINS_SHORTED' && finding.message.includes(designator),
      ), `${designator} should be reported for title "${title}"`);
    }
  }
});

test('existing good regression fixtures have no errors from generic electrical rules', () => {
  for (const name of [
    'series-led.json',
    'single-transistor-switch.json',
    'astable-flasher.json',
    'shared-base-switches.json',
    'parallel-led-branches.json',
  ]) {
    assert.deepEqual(
      checkElectricalRules(CircuitDraw.netlist(fixture(name), true))
        .filter((finding) => finding.severity === 'error'),
      [],
      `${name} should not trigger a new blocking electrical rule`,
    );
  }
});

test('intent reports missing designators and does not compare net names', () => {
  const netlist = {
    parts: [
      { designator: 'R1', type: 'Resistor' },
      { designator: 'LED1', type: 'LED' },
    ],
    nets: [
      { name: 'N1', pins: ['R1.2', 'LED1.A'] },
    ],
  };
  const findings = checkIntent(netlist, [
    ['LED1.A', 'R1.2'],
    ['Q3.B', 'R1.1'],
  ]);

  assert.ok(findings.some((finding) =>
    finding.code === 'INTENT_UNKNOWN_PART' && finding.message.includes('Q3'),
  ));
  assert.equal(findings.some((finding) =>
    finding.code === 'INTENT_CONNECTION_MISSING',
  ), false);
});

test('empty and single-pin intent groups skip intent checking', () => {
  const netlist = { parts: [], nets: [] };

  assert.deepEqual(runElectricalChecks(netlist, []).findings, []);
  assert.deepEqual(runElectricalChecks(netlist, [['Q3.B']]).findings, []);
});

test('a photoresistor alone does not satisfy the LED series-resistor rule', () => {
  const findings = checkElectricalRules({
    parts: [
      { designator: 'LED1', type: 'LED' },
      { designator: 'LDR1', type: 'Photoresistor' },
    ],
    nets: [
      { name: 'VCC', pins: ['LED1.A'] },
      { name: 'N1', pins: ['LED1.K', 'LDR1.1'] },
      { name: 'GND', pins: ['LDR1.2'] },
    ],
  });

  assert.ok(findings.some((finding) =>
    finding.code === 'LED_NO_SERIES_RESISTOR' && finding.message.includes('LED1'),
  ));
});

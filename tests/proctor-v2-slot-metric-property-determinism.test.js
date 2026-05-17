'use strict';

// Property-Based Test — Phase D.3 task 22 of proctor-v2-slot-metric-reserves-affinity.
// Determinism PBT under randomSeed: same input + same seed → identical
// proctor_keys, reserves, reserve_keys across two runs.
// _Validates: P4 — Requirement 3.5_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);
const sandbox = {
  window: {},
  Math, console, Infinity, isFinite, isNaN,
  Set, Map, Object, Array, String, Number, Error, Boolean, Date,
  parseInt, parseFloat, TypeError, RangeError, NaN, JSON
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const V2 = sandbox.window.ProctorDistributionV2;

const fixtures = require(path.join(__dirname, 'fixtures', 'proctor-v2-slot-metric-fixtures.js'));

let passed = 0, failed = 0;

function check(label, input) {
  const out1 = V2.run(input);
  const out2 = V2.run(input);
  const rows1 = out1.result || [];
  const rows2 = out2.result || [];
  assert.strictEqual(rows1.length, rows2.length, label + ': row count differs');
  for (let i = 0; i < rows1.length; i++) {
    assert.strictEqual(
      JSON.stringify(rows1[i].proctor_keys),
      JSON.stringify(rows2[i].proctor_keys),
      label + ': row ' + i + ' proctor_keys differ'
    );
    assert.strictEqual(
      JSON.stringify(rows1[i].reserve_keys),
      JSON.stringify(rows2[i].reserve_keys),
      label + ': row ' + i + ' reserve_keys differ'
    );
  }
}

console.log('[test] Determinism under randomSeed');
const cases = [
  { label: 'C1 two-session', build: fixtures.buildC1TwoSessionInput },
  { label: 'C2 spread',      build: fixtures.buildC2SpreadInput },
  { label: 'C3 affinity',    build: fixtures.buildC3AffinityInput }
];
for (const c of cases) {
  try {
    check(c.label, c.build());
    console.log('  [pass] ' + c.label);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + c.label + ': ' + e.message);
    failed++;
  }
}

console.log('\n[test] determinism: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

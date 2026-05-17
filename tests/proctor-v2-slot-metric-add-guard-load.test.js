'use strict';

// Unit tests — Phase D.2 of proctor-v2-slot-metric-reserves-affinity.
// Validates Phase A (addGuardLoad slot-counting).
// _Validates: C1, P1, P4 — Requirements 2.1, 2.2, 3.10_

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
  parseInt, parseFloat, TypeError, RangeError, NaN
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);

const internals = sandbox.window.ProctorDistributionV2._internals;
const addGuardLoad = internals.addGuardLoad;
const createLoadState = internals.createLoadState;

let passed = 0;
let failed = 0;

function runTest(name, fn) {
  try {
    fn();
    console.log('  [pass] ' + name);
    passed++;
  } catch (e) {
    console.log('  [FAIL] ' + name + ': ' + e.message);
    failed++;
  }
}

console.log('[test] addGuardLoad slot-counting (Phase A)');

runTest('same (key, halfdayKey) called 3 times → guardCount=3, halfdays.size=1, morningCount=3', function () {
  const ls = createLoadState();
  const hk = '2026-04-10|صباحا';
  assert.strictEqual(addGuardLoad(ls, 'P001', hk, 'أ'), true);
  assert.strictEqual(addGuardLoad(ls, 'P001', hk, 'أ'), true);
  assert.strictEqual(addGuardLoad(ls, 'P001', hk, 'أ'), true);
  assert.strictEqual(ls['P001'].guardCount, 3, 'guardCount must be slot-based = 3');
  assert.strictEqual(ls['P001'].guardHalfdays.size, 1, 'guardHalfdays Set still dedups by key');
  assert.strictEqual(ls['P001'].morningCount, 3, 'morningCount slot-based = 3');
  assert.strictEqual(ls['P001'].afternoonCount, 0);
});

runTest('afternoon halfday → afternoonCount slot-counted, morning untouched', function () {
  const ls = createLoadState();
  const hk = '2026-04-10|مساء';
  addGuardLoad(ls, 'P002', hk, 'ب');
  addGuardLoad(ls, 'P002', hk, 'ب');
  assert.strictEqual(ls['P002'].guardCount, 2);
  assert.strictEqual(ls['P002'].morningCount, 0);
  assert.strictEqual(ls['P002'].afternoonCount, 2);
});

runTest('different halfdays → guardCount cumulative, halfdays.size grows', function () {
  const ls = createLoadState();
  addGuardLoad(ls, 'P003', '2026-04-10|صباحا', 'ج');
  addGuardLoad(ls, 'P003', '2026-04-10|مساء', 'ج');
  addGuardLoad(ls, 'P003', '2026-04-11|صباحا', 'ج');
  assert.strictEqual(ls['P003'].guardCount, 3);
  assert.strictEqual(ls['P003'].guardHalfdays.size, 3);
  assert.strictEqual(ls['P003'].morningCount, 2);
  assert.strictEqual(ls['P003'].afternoonCount, 1);
});

runTest('empty halfdayKey → returns false, no mutation (regression guard)', function () {
  const ls = createLoadState();
  assert.strictEqual(addGuardLoad(ls, 'P004', '', 'د'), false);
  assert.strictEqual(addGuardLoad(ls, 'P004', null, 'د'), false);
  assert.strictEqual(addGuardLoad(ls, 'P004', undefined, 'د'), false);
  // Either no entry, or entry exists but with zero counters (createLoadState does not pre-populate).
  if (ls['P004']) {
    assert.strictEqual(ls['P004'].guardCount || 0, 0);
    assert.strictEqual((ls['P004'].guardHalfdays && ls['P004'].guardHalfdays.size) || 0, 0);
  }
});

runTest('empty proctorKey → returns false', function () {
  const ls = createLoadState();
  assert.strictEqual(addGuardLoad(ls, '', '2026-04-10|صباحا', ''), false);
  assert.strictEqual(addGuardLoad(ls, null, '2026-04-10|صباحا', ''), false);
});

runTest('teacherName captured on first call only (existing semantic preserved)', function () {
  const ls = createLoadState();
  const hk = '2026-04-10|صباحا';
  addGuardLoad(ls, 'P005', hk, 'الأول');
  addGuardLoad(ls, 'P005', hk, 'الثاني'); // should not overwrite
  assert.strictEqual(ls['P005'].teacherName, 'الأول');
});

console.log('\n[test] addGuardLoad: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
  process.exit(1);
}

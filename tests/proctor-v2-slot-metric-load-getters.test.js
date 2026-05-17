'use strict';

// Unit tests — Phase D.2 of proctor-v2-slot-metric-reserves-affinity.
// Validates Phase A (getPrimaryLoad / getFinalLoad slot semantics).
// _Validates: P1 — Requirement 2.3_

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
const {
  addGuardLoad, addReserveLoad, addDutyLoad,
  getPrimaryLoad, getFinalLoad, createLoadState
} = internals;

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

console.log('[test] getPrimaryLoad / getFinalLoad slot semantics');

runTest('primaryLoad = guardSlotCount + dutyCount (slot-based)', function () {
  const ls = createLoadState();
  // Proctor T placed in 3 slots across 2 halfdays (slot-based: count = 3).
  addGuardLoad(ls, 'T', '2026-04-10|صباحا', 'T');
  addGuardLoad(ls, 'T', '2026-04-10|صباحا', 'T'); // same halfday, second slot
  addGuardLoad(ls, 'T', '2026-04-11|صباحا', 'T');
  addDutyLoad(ls, 'T', '2026-04-12|صباحا', 'T');
  assert.strictEqual(getPrimaryLoad(ls, 'T'), 4, 'primaryLoad = 3 slot guards + 1 duty');
});

runTest('finalLoad = guardSlotCount + reserveCount + dutyCount (slot-based)', function () {
  const ls = createLoadState();
  addGuardLoad(ls, 'T', '2026-04-10|صباحا', 'T');
  addGuardLoad(ls, 'T', '2026-04-10|صباحا', 'T');
  addReserveLoad(ls, 'T', '2026-04-11|صباحا', 'T');
  addDutyLoad(ls, 'T', '2026-04-12|صباحا', 'T');
  assert.strictEqual(getFinalLoad(ls, 'T'), 4, 'finalLoad = 2 guard slots + 1 reserve + 1 duty');
});

runTest('agreement with slot-count derived from proctor_keys aggregation', function () {
  // Build a synthetic row set, then call addGuardLoad once per slot;
  // assert getPrimaryLoad equals Σ |{ i : R.proctor_keys[i] = T.key }|.
  const rows = [
    { halfday_key: '2026-04-10|صباحا', proctor_keys: ['T', 'X'] },
    { halfday_key: '2026-04-10|صباحا', proctor_keys: ['T', 'Y'] },
    { halfday_key: '2026-04-10|مساء',  proctor_keys: ['T', 'Z'] },
    { halfday_key: '2026-04-11|صباحا', proctor_keys: ['X', 'Y'] }
  ];
  const ls = createLoadState();
  for (const r of rows) {
    for (const k of r.proctor_keys) {
      if (k) addGuardLoad(ls, k, r.halfday_key, k);
    }
  }
  // Slot count for T = 3 (rows 0,1,2)
  let slotsForT = 0;
  for (const r of rows) for (const k of r.proctor_keys) if (k === 'T') slotsForT++;
  assert.strictEqual(slotsForT, 3);
  assert.strictEqual(getPrimaryLoad(ls, 'T'), 3, 'getPrimaryLoad must equal Σ |proctor_keys| for T (no duty)');
  assert.strictEqual(getFinalLoad(ls, 'T'), 3);
});

console.log('\n[test] load getters: ' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) process.exit(1);

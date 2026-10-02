'use strict';

// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 2.3 — P_resolver_correctness: `getProctorKey` stability test.
//
// Goal: encode the existing behavior of `getProctorKey` so that the bugfix
// preserves it. For every proctor in the production fixture
// `tests/fixtures/45454.json`, assert that `getProctorKey(proc, idx)`:
//
//   1. is deterministic — same `(proc, idx)` produces the same key on every
//      invocation (no drift across runs).
//   2. matches the documented shape: `proc.cin` when truthy, otherwise
//      `'__idx_' + idx`. (See v2.js ≈line 649 — "MUST match v1's
//      getProctorKey format for meAssignments compatibility.")
//
// And specifically for the production fixture (147 proctors with empty
// `cin` → all synthetic keys):
//
//   3. all 147 keys are exactly `__idx_0` … `__idx_146`.
//   4. there are zero duplicate keys across the proctor list.
//   5. the same fixture replayed three times produces identical key arrays
//      (no drift, no PRNG influence — the function is pure).
//
// EXPECTED OUTCOME: PASSES on UNFIXED code (encodes baseline behavior to
// preserve). Re-run after the fix to confirm key stability is unchanged.
//
// _Validates: Requirements 3.9_
// _Preservation: design.md Property 2 → `getProctorKey` synthetic-key
//   encoding for empty-`cin` proctors._

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (mirrors
//    tests/inv-a-instrument-roundtrip.test.js and scripts/verify-fixture.js).
var src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
var sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
var V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals && typeof V2._internals.getProctorKey === 'function',
  'V2._internals.getProctorKey is not exposed — preservation contract broken');

var getProctorKey = V2._internals.getProctorKey;

// 2) Load the production fixture.
var input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));

var proctorsList = input.proctorsList || [];
assert.strictEqual(proctorsList.length, 147,
  'fixture should have 147 proctors (got ' + proctorsList.length + ')');

// Sanity-check: every proctor in this fixture has empty cin (per the bug
// report). The test still validates the cin-truthy branch via a synthetic
// case below, in case the fixture changes shape in the future.
var emptyCin = proctorsList.filter(function (p) {
  return !p.cin || String(p.cin).trim() === '';
}).length;
assert.strictEqual(emptyCin, 147,
  'fixture should have 147 proctors with empty cin (got ' + emptyCin + ')');

// 3) Per-proctor shape assertions — getProctorKey(proc, idx) matches
//    `proc.cin || '__idx_' + idx` and is deterministic across 3 runs.
var keysRun1 = [];
var keysRun2 = [];
var keysRun3 = [];

for (var i = 0; i < proctorsList.length; i++) {
  var proc = proctorsList[i];
  var k1 = getProctorKey(proc, i);
  var k2 = getProctorKey(proc, i);
  var k3 = getProctorKey(proc, i);

  // (a) Determinism per call.
  assert.strictEqual(k1, k2,
    'getProctorKey is non-deterministic at idx=' + i +
      ' (k1=' + k1 + ', k2=' + k2 + ')');
  assert.strictEqual(k2, k3,
    'getProctorKey is non-deterministic at idx=' + i +
      ' (k2=' + k2 + ', k3=' + k3 + ')');

  // (b) Shape: cin || '__idx_' + idx.
  if (proc.cin && String(proc.cin).trim() !== '') {
    assert.strictEqual(k1, proc.cin,
      'getProctorKey at idx=' + i + ' should equal proc.cin=' +
        JSON.stringify(proc.cin) + ' but was ' + JSON.stringify(k1));
  } else {
    assert.strictEqual(k1, '__idx_' + i,
      'getProctorKey at idx=' + i + ' should equal "__idx_' + i +
        '" (cin is empty) but was ' + JSON.stringify(k1));
  }

  keysRun1.push(k1);
  keysRun2.push(k2);
  keysRun3.push(k3);
}

// 4) Cross-run determinism — three full passes produce identical arrays.
assert.deepStrictEqual(keysRun1, keysRun2,
  'getProctorKey drifted between full-pass runs 1 and 2');
assert.deepStrictEqual(keysRun2, keysRun3,
  'getProctorKey drifted between full-pass runs 2 and 3');

// 5) Production-fixture-specific: all 147 keys are __idx_0 … __idx_146.
var expectedKeys = [];
for (var j = 0; j < 147; j++) expectedKeys.push('__idx_' + j);
assert.deepStrictEqual(keysRun1, expectedKeys,
  'fixture 45454.json should produce keys __idx_0 … __idx_146 in order; ' +
    'got ' + JSON.stringify(keysRun1.slice(0, 5)) + ' … ' +
    JSON.stringify(keysRun1.slice(-3)));

// 6) Zero duplicates across the 147-proctor list.
var seen = Object.create(null);
var dupes = [];
for (var d = 0; d < keysRun1.length; d++) {
  var key = keysRun1[d];
  if (seen[key] !== undefined) {
    dupes.push({ key: key, indices: [seen[key], d] });
  } else {
    seen[key] = d;
  }
}
assert.deepStrictEqual(dupes, [],
  'getProctorKey produced duplicate keys on the 147-proctor fixture: ' +
    JSON.stringify(dupes));

// 7) Synthetic cin-truthy edge cases — guard against fixture drift hiding
//    the cin branch. These assert the documented shape directly.
assert.strictEqual(
  getProctorKey({ cin: 'AB123', teacher_name: 'فاطمة' }, 0),
  'AB123',
  'getProctorKey should return proc.cin when truthy'
);
assert.strictEqual(
  getProctorKey({ cin: '2367005', teacher_name: 'ياسين' }, 18),
  '2367005',
  'getProctorKey should return proc.cin (numeric-string) when truthy, ' +
    'ignoring idx'
);
assert.strictEqual(
  getProctorKey({ cin: '', teacher_name: 'محماد' }, 0),
  '__idx_0',
  'getProctorKey should fall back to __idx_<idx> when cin is empty string'
);
assert.strictEqual(
  getProctorKey({ teacher_name: 'محماد' }, 5),
  '__idx_5',
  'getProctorKey should fall back to __idx_<idx> when cin is undefined'
);
assert.strictEqual(
  getProctorKey({ cin: null, teacher_name: 'محماد' }, 42),
  '__idx_42',
  'getProctorKey should fall back to __idx_<idx> when cin is null'
);

// 8) Diagnostic output.
console.log('[proctor-key-stability] fixture 45454.json:');
console.log('  proctors=' + proctorsList.length +
  ' (empty cin=' + emptyCin + ')');
console.log('  getProctorKey produced ' + keysRun1.length +
  ' keys: __idx_0 … __idx_' + (keysRun1.length - 1));
console.log('  3 successive full passes produced byte-identical key arrays');
console.log('  zero duplicates, shape matches `cin || "__idx_" + idx`');
console.log('[proctor-key-stability] PASS');

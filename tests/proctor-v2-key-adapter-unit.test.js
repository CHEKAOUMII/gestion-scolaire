'use strict';

// @unit test for buildKeyAdapter / toCanonicalKey — Task 2.1 stub, Task 3 populated.
//
// Spec: .kiro/specs/proctor-v2-key-shape-unification/
// Task 3 — Six concrete adapter cases populated below per design.md
// §"Testing Strategy" → "Unit Tests" and §"Boundary Adapter Design".
// On F (unfixed code) the existence assertions below throw before reaching
// the six cases; on F' (post-Task 4) the existence assertions pass and the
// six cases lock in the boundary adapter contract.
//
// Project test convention: bare `assert` + `node tests/X.test.js` (NOT Jest).
// Pattern mirrors `tests/inv-a-instrument-roundtrip.test.js`,
// `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`,
// `tests/proctor-v2-key-shape-bug-exploration.test.js`.
//
// ----------------------------------------------------------------------------
// Baseline preservation reference (Task 2.3):
//   tests-on-F (43 files in scope: tests/proctor-v2-*.test.js,
//               tests/inv-h5-*.test.js, tests/preservation-config-roundtrip.pbt.test.js):
//     PASS=39, FAIL by-design=4
//   FAIL by-design (expected — must remain failing):
//     - tests/proctor-v2-key-adapter-unit.test.js    (THIS FILE — Task 2.1 stub)
//     - tests/proctor-v2-key-shape-bug-exploration.test.js (Task 1 pre-fix)
//     - tests/proctor-v2-strict-bug-c1-soft-penalty.test.js (closed prior spec)
//     - tests/proctor-v2-strict-bug-c2-uncovered.test.js (closed prior spec)
//   lint-on-F: 0 errors, 6 warnings (all pre-existing, unrelated to this spec)
//   date: 2026-05-16
// ----------------------------------------------------------------------------
//
// Stage status:
//   - On F (unfixed code, helpers don't exist): EXPECTED to FAIL at the
//     existence assertion below. The failure mode is "helpers not yet
//     implemented" — `V2._internals.buildKeyAdapter` is `undefined` because
//     Task 4 has not yet inserted them. This confirms the test file is
//     wired correctly to the production module. The six adapter cases below
//     are syntactically correct but never reach.
//   - On F' (post-Task 4, helpers exist): existence assertion PASSES;
//     the six adapter cases below run via `runCase` (each isolated in a
//     try/catch so all failures surface in the summary), and a final
//     pass/fail table is printed before the process exit code is set.
//   - On F' (post-Task 9): test fully passes; treated as a permanent
//     regression lock for the boundary adapter contract.
//
// _Validates: Requirements 2.3, 2.4, 2.10, 2.12_
// _Phase: D (Boundary Adapters), E (Test Plan)_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1) Load the production v2 module via VM sandbox.
// ---------------------------------------------------------------------------
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
assert.ok(V2._internals && typeof V2._internals === 'object',
  'V2._internals is not exposed by the production module');

// ---------------------------------------------------------------------------
// 2) Existence assertions — these are the gating assertions for Task 2.1.
//
//    On F (unfixed code) they FAIL: the helpers have not been added yet
//    (Task 4 inserts them after `getProctorExemptionKey` at ≈line 666 and
//    exposes them on `_internals`). The failure proves the test file is
//    wired to the right module and surface area, and dead-codes the six
//    adapter cases below behind a hard assertion failure.
//
//    On F' (post-Task 4) they PASS: the helpers exist with the documented
//    signature and the six `runCase(...)` blocks below assert each row of
//    the boundary-adapter contract.
// ---------------------------------------------------------------------------
assert.strictEqual(
  typeof V2._internals.buildKeyAdapter,
  'function',
  'EXPECTED on F: helper not yet implemented. ' +
    'V2._internals.buildKeyAdapter is ' + typeof V2._internals.buildKeyAdapter +
    '; Task 4 will insert `buildKeyAdapter(proctorsList)` after ' +
    '`getProctorExemptionKey` (≈line 666 in js/algorithms/proctor-distribution-v2.js) ' +
    'and expose it on `_internals` per design.md §"Boundary Adapter Design".'
);

assert.strictEqual(
  typeof V2._internals.toCanonicalKey,
  'function',
  'EXPECTED on F: helper not yet implemented. ' +
    'V2._internals.toCanonicalKey is ' + typeof V2._internals.toCanonicalKey +
    '; Task 4 will insert `toCanonicalKey(keyAdapter, externalKey)` directly ' +
    'after `buildKeyAdapter` and expose it on `_internals` per design.md ' +
    '§"Boundary Adapter Design".'
);

// ---------------------------------------------------------------------------
// 3) runCase helper + outcomes table — mirrors the pattern from
//    `tests/proctor-v2-fairness-undercovered-collect-unit.test.js`. Each
//    case runs inside try/catch so all failures surface in the summary
//    instead of short-circuiting at the first throw. We only reach this
//    section on F' (the existence assertions above gate it on F).
// ---------------------------------------------------------------------------

var buildKeyAdapter = V2._internals.buildKeyAdapter;
var toCanonicalKey  = V2._internals.toCanonicalKey;

var outcomes = [];

function runCase(num, label, fn) {
  try {
    fn();
    outcomes.push({ num: num, label: label, status: 'PASS', error: null });
  } catch (e) {
    outcomes.push({ num: num, label: label, status: 'FAIL', error: e.message });
  }
}

// ---------------------------------------------------------------------------
// 4) Six adapter cases — populated by Task 3 per design.md §"Testing Strategy"
//    → "Unit Tests" and §"Boundary Adapter Design" → `buildKeyAdapter`.
//
//    Each case asserts one row of the contract Task 4 will satisfy when it
//    inserts `buildKeyAdapter` and `toCanonicalKey` after `getProctorExemptionKey`
//    (≈line 666 in `js/algorithms/proctor-distribution-v2.js`).
//
//    All six cases are dead-code on F (the existence assertions above throw
//    before this section runs). On F' (post-Task 4) they all PASS.
// ---------------------------------------------------------------------------

// ============================================================
// Case 1: cin-only proctor — identity only, NO entry for `som`
// ============================================================
//   Input:  [{ cin: 'C1', som: 'S1' }] at idx 0
//   Algo:   canonical = 'C1' (cin non-empty); exempt = 'C1' (cin non-empty);
//           the `som` branch in buildKeyAdapter is gated by `!proc.cin` so
//           the `S1` entry is intentionally NOT registered for cin-bearing
//           proctors. The cin branch is also a no-op because cin === canonical.
//   Expect: map = { 'C1': 'C1' } — exactly one entry (no `S1`).
runCase(1, 'cin-only proctor {cin:"C1",som:"S1"} at idx 0 → single identity entry', function () {
  var map = buildKeyAdapter([{ cin: 'C1', som: 'S1' }]);
  assert.strictEqual(map['C1'], 'C1',
    'Case 1: keyAdapter["C1"] should be "C1" (identity, since cin===canonical)');
  assert.strictEqual(map['S1'], undefined,
    'Case 1: keyAdapter["S1"] should be undefined — the `som` branch is gated ' +
    'by `!proc.cin`, so cin-bearing proctors do NOT register their som.');
  assert.strictEqual(Object.keys(map).length, 1,
    'Case 1: keyAdapter should have exactly 1 entry (identity for "C1"), got ' +
    Object.keys(map).length + ' (keys: ' + JSON.stringify(Object.keys(map)) + ').');
});

// ============================================================
// Case 2: som-only proctor — production case (the bug case)
// ============================================================
//   Input:  [{ cin: '', som: 'S1' }] at idx 0
//   Algo:   canonical = '__idx_0' (cin empty); exempt = 'S1' (cin empty,
//           som non-empty); cin branch no-op (cin empty); som branch
//           registers map['S1'] = '__idx_0'.
//   Expect: map['__idx_0'] === '__idx_0' (identity)
//           map['S1']      === '__idx_0' (cross-shape translation;
//                                          this is the production fix).
//           Total: 2 entries.
runCase(2, 'som-only proctor {cin:"",som:"S1"} at idx 0 → identity + cross-shape', function () {
  var map = buildKeyAdapter([{ cin: '', som: 'S1' }]);
  assert.strictEqual(map['__idx_0'], '__idx_0',
    'Case 2: keyAdapter["__idx_0"] should be "__idx_0" (canonical identity)');
  assert.strictEqual(map['S1'], '__idx_0',
    'Case 2: keyAdapter["S1"] should be "__idx_0" — cross-shape translation ' +
    'from exemption-shape `som` to canonical algo-shape `__idx_N`. This is ' +
    'the entry that closes the production fixture leak.');
  assert.strictEqual(Object.keys(map).length, 2,
    'Case 2: keyAdapter should have exactly 2 entries (identity + cross-shape), got ' +
    Object.keys(map).length + ' (keys: ' + JSON.stringify(Object.keys(map)) + ').');
});

// ============================================================
// Case 3: synthetic-only proctor — `idx_N` vs `__idx_N` divergence
// ============================================================
//   Input:  [{ cin: '', som: '' }] at idx 0
//   Algo:   canonical = '__idx_0' (cin empty);
//           exempt = 'idx_0' (cin empty AND som empty → falls through to
//           the synthetic 'idx_' + idx form); cin/som branches no-op.
//   Expect: map['__idx_0'] === '__idx_0' (identity)
//           map['idx_0']   === '__idx_0' (cross-shape; note the missing
//                                          leading underscores in `idx_N`
//                                          vs canonical `__idx_N`).
//           Total: 2 entries.
runCase(3, 'synthetic-only proctor {cin:"",som:""} at idx 0 → idx_0 vs __idx_0 bridge', function () {
  var map = buildKeyAdapter([{ cin: '', som: '' }]);
  assert.strictEqual(map['__idx_0'], '__idx_0',
    'Case 3: keyAdapter["__idx_0"] should be "__idx_0" (canonical identity)');
  assert.strictEqual(map['idx_0'], '__idx_0',
    'Case 3: keyAdapter["idx_0"] should be "__idx_0" — exemption-shape ' +
    'synthetic `idx_N` (no leading underscores) maps to canonical algo-shape ' +
    '`__idx_N` (two leading underscores) per design.md "Boundary Adapter Design".');
  assert.strictEqual(Object.keys(map).length, 2,
    'Case 3: keyAdapter should have exactly 2 entries (canonical + synthetic-exempt bridge), got ' +
    Object.keys(map).length + ' (keys: ' + JSON.stringify(Object.keys(map)) + ').');
});

// ============================================================
// Case 4: empty proctorsList → empty adapter
// ============================================================
//   Input:  []
//   Algo:   The for-loop runs zero iterations.
//   Expect: returned map is `Object.create(null)` with zero enumerable keys.
runCase(4, 'empty proctorsList → Object.create(null) with zero keys', function () {
  var map = buildKeyAdapter([]);
  assert.strictEqual(typeof map, 'object',
    'Case 4: buildKeyAdapter([]) should return an object');
  assert.notStrictEqual(map, null,
    'Case 4: buildKeyAdapter([]) should not return null');
  assert.strictEqual(Object.keys(map).length, 0,
    'Case 4: buildKeyAdapter([]) should have zero enumerable keys, got ' +
    Object.keys(map).length + ' (keys: ' + JSON.stringify(Object.keys(map)) + ')');
  // Object.create(null) has no prototype — verify the adapter follows that
  // convention so future hasOwnProperty-style lookups don't accidentally hit
  // Object.prototype keys ('constructor', 'toString', etc.).
  assert.strictEqual(Object.getPrototypeOf(map), null,
    'Case 4: buildKeyAdapter([]) should return an Object.create(null) map ' +
    '(prototype === null) per design.md pseudocode.');
});

// ============================================================
// Case 5: shared-som collision — last-write-wins per R5
// ============================================================
//   Input:  [{ cin: '', som: 'S1' }, { cin: '', som: 'S1' }]
//   Algo:   i=0 → map['__idx_0']='__idx_0', map['S1']='__idx_0'
//           i=1 → map['__idx_1']='__idx_1', map['S1']='__idx_1' (overwrites)
//   Expect: map['S1'] === '__idx_1' (last write wins per design.md R5;
//           matches v1 `Object.keys` iteration order). Both identity
//           entries `__idx_0` and `__idx_1` co-exist intact.
runCase(5, 'shared-som collision → last-write-wins per design.md R5', function () {
  var map = buildKeyAdapter([
    { cin: '', som: 'S1' },
    { cin: '', som: 'S1' }
  ]);
  assert.strictEqual(map['S1'], '__idx_1',
    'Case 5: keyAdapter["S1"] should be "__idx_1" (last write wins) per ' +
    'design.md R5. F\'s v1 `Object.keys` iteration semantics are preserved.');
  assert.strictEqual(map['__idx_0'], '__idx_0',
    'Case 5: keyAdapter["__idx_0"] should still be "__idx_0" (identity for ' +
    'the first proctor; collisions only affect the shared `som` slot)');
  assert.strictEqual(map['__idx_1'], '__idx_1',
    'Case 5: keyAdapter["__idx_1"] should still be "__idx_1" (identity for ' +
    'the second proctor)');
});

// ============================================================
// Case 6: toCanonicalKey on unknown / empty / null + positive case
// ============================================================
//   Input:  buildKeyAdapter([{ cin: 'C1', som: 'S1' }]); then call
//           toCanonicalKey on registered, unknown, empty, and null keys.
//   Algo:   `if (!externalKey) return null;` short-circuits empty/null;
//           otherwise `keyAdapter[externalKey] || null`.
//   Expect: returns null for any external key not registered, for empty,
//           for null; returns the canonical for the positive case.
runCase(6, 'toCanonicalKey on unknown/empty/null → null; on registered → canonical', function () {
  var map = buildKeyAdapter([{ cin: 'C1', som: 'S1' }]);
  assert.strictEqual(toCanonicalKey(map, 'unknown'), null,
    'Case 6: toCanonicalKey(adapter, "unknown") should be null — ' +
    'orphan keys (not registered in the adapter) return null so callers ' +
    'can count and skip them via diagnostics.orphanDutyKeys / orphanMeAssignments.');
  assert.strictEqual(toCanonicalKey(map, ''), null,
    'Case 6: toCanonicalKey(adapter, "") should be null — empty external ' +
    'key short-circuits via `if (!externalKey) return null;`.');
  assert.strictEqual(toCanonicalKey(map, null), null,
    'Case 6: toCanonicalKey(adapter, null) should be null — null external ' +
    'key short-circuits via `if (!externalKey) return null;`.');
  assert.strictEqual(toCanonicalKey(map, 'C1'), 'C1',
    'Case 6: toCanonicalKey(adapter, "C1") should be "C1" — positive case, ' +
    'registered identity entry returns canonical.');
});

// ---------------------------------------------------------------------------
// 5) Summary table + exit-code logic.
//    On F': all six cases must PASS (exit 0). Any failure → exit 1.
//    (On F we never reach this section because the existence assertions
//    above throw and abort the process before runCase fires.)
// ---------------------------------------------------------------------------

console.log('\n[adapter-unit] Case-by-case status:');

var failedNums = [];
for (var i = 0; i < outcomes.length; i++) {
  var o = outcomes[i];
  var line = 'Case ' + o.num + ': ' + o.status;
  if (o.status === 'FAIL') {
    failedNums.push(o.num);
    line += '\n         label: ' + o.label;
    line += '\n         error: ' + (o.error || '(no message)');
  } else {
    line += ' — ' + o.label;
  }
  console.log(line);
}

console.log('\n[adapter-unit] Total failures: ' + failedNums.length +
  ' / ' + outcomes.length);
console.log('[adapter-unit] Failed case numbers: [' + failedNums.join(', ') + ']');

if (failedNums.length === 0) {
  console.log('\n[adapter-unit] PASS — all 6 cases passed (F\' state).');
  process.exit(0);
} else {
  console.error('\n[adapter-unit] FAIL — ' + failedNums.length +
    ' case(s) failed: [' + failedNums.join(', ') + ']. On F\' all 6 should pass; ' +
    'on F we never reach this section (existence assertions throw first).');
  process.exit(1);
}

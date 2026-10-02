'use strict';

// @unit test for collectUncovered. Cases 1, 3, 4, 5, 6, 7 pass on F. Cases 2, 8 FAIL on F (expected — bug + degenerate boundary).
//
// Spec: .kiro/specs/proctor-v2-fairness-undercovered-fix/
// Task 3 — Direct unit tests for `collectUncovered`. Each case below covers
// one row of design.md "Edge Cases Handled" (8 rows total). Each case is
// wrapped in try/catch so we can collect ALL failures and report the
// case-by-case status at the end.
//
// On unfixed code (F):
//   - Cases 1, 3, 4, 5, 6, 7 → PASS (preservation cells)
//   - Case 2                  → FAIL (the bug: `0 < load < classLowerBound` missed by `=== 0`)
//   - Case 8                  → FAIL (degenerate boundary `classLowerBound == 0`;
//                                     F's `=== 0` matches load==0, the new `< 0`
//                                     does not — design.md row 8 documents this
//                                     as INTENTIONAL behaviour change)
//
// Expected exit codes:
//   - All 8 cases pass                                    → exit 0 (F' state)
//   - Exactly cases 2 and 8 fail (rest pass)              → exit 0 (F-expected state)
//   - Any other failure pattern                           → exit 1 (deeper issue)
//
// _Validates: Requirements 1.1, 2.1, 3.1, 3.2_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (mirrors the boilerplate
//    used by tasks 1 + 2).
const src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
const sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals && typeof V2._internals.collectUncovered === 'function',
  'V2._internals.collectUncovered is not exported from the production module');
assert.ok(typeof V2._internals.createLoadState === 'function',
  'V2._internals.createLoadState is not exported');
assert.ok(typeof V2._internals.addGuardLoad === 'function',
  'V2._internals.addGuardLoad is not exported');

// Cross-realm helper: arrays returned by `collectUncovered` carry the
// sandbox's Array.prototype, not the host's. Comparing with
// `assert.deepStrictEqual([], result)` fails on prototype identity even
// when both are empty. Project to host-realm POJOs via JSON before
// comparing — same pattern as task 2's preservation test.
function normalize(result) {
  return JSON.parse(JSON.stringify(
    result.map(function (r) { return { key: r.key, idx: r.idx }; })
  ));
}

// Track each case's outcome. We DO NOT throw inline — we collect into this
// table and produce a summary + exit code at the end.
var outcomes = [];

function runCase(num, label, fn) {
  try {
    fn();
    outcomes.push({ num: num, label: label, status: 'PASS', error: null });
  } catch (e) {
    outcomes.push({ num: num, label: label, status: 'FAIL', error: e.message });
  }
}

// ============================================================
// Case 1: load == 0, classLowerBound > 0 → INCLUDED
// ============================================================
// Status on F:  PASS (existing `=== 0` predicate matches)
// Status on F': PASS (new `< classLowerBound` also matches)
runCase(1, 'load == 0, classLowerBound > 0 → INCLUDED', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  var classBoundsByProctorKey = {
    P0: { classLowerBound: 2, classUpperBound: 3 }
  };
  var loadState = V2._internals.createLoadState();
  // No addGuardLoad → load stays at 0.

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.strictEqual(result.length, 1,
    'Case 1: expected result to contain exactly 1 entry, got ' + result.length);
  var normalized = normalize(result);
  assert.deepStrictEqual(normalized, [{ key: 'P0', idx: 0 }],
    'Case 1: normalised result mismatch — got ' + JSON.stringify(normalized));
  // Verify proc identity (cross-realm: compare cin, not reference).
  assert.strictEqual(result[0].proc.cin, 'P0',
    'Case 1: result[0].proc.cin should be "P0"');
});

// ============================================================
// Case 2: 0 < load < classLowerBound → INCLUDED (bug-fix case)
// ============================================================
// Status on F:  FAIL (existing `=== 0` predicate misses load-1 proctors)
// Status on F': PASS
runCase(2, '0 < load < classLowerBound → INCLUDED (bug-fix case)', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  var classBoundsByProctorKey = {
    P0: { classLowerBound: 2, classUpperBound: 3 }
  };
  var loadState = V2._internals.createLoadState();
  // ONE guard slot → load == 1, which is between 0 and classLowerBound (2).
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-10|p0', 'Teacher_P0');

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.strictEqual(result.length, 1,
    'Case 2: expected result to contain exactly 1 entry (the load-1 proctor ' +
    'below classLowerBound=2), got ' + result.length +
    '. This is the bug: F\'s `=== 0` predicate misses proctors with ' +
    '0 < load < classLowerBound.');
  var normalized = normalize(result);
  assert.deepStrictEqual(normalized, [{ key: 'P0', idx: 0 }],
    'Case 2: normalised result mismatch — got ' + JSON.stringify(normalized));
  assert.strictEqual(result[0].proc.cin, 'P0',
    'Case 2: result[0].proc.cin should be "P0"');
});

// ============================================================
// Case 3: load == classLowerBound → NOT INCLUDED
// ============================================================
// Status on F: PASS, F': PASS
runCase(3, 'load == classLowerBound → NOT INCLUDED', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  var classBoundsByProctorKey = {
    P0: { classLowerBound: 2, classUpperBound: 3 }
  };
  var loadState = V2._internals.createLoadState();
  // 2 guard slots on distinct halfdays → load == 2 == classLowerBound.
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-10|p0', 'Teacher_P0');
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-11|p0', 'Teacher_P0');

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.deepStrictEqual(normalize(result), [],
    'Case 3: expected empty result (load == classLowerBound), got ' +
    JSON.stringify(normalize(result)));
});

// ============================================================
// Case 4: load > classLowerBound → NOT INCLUDED
// ============================================================
// Status on F: PASS, F': PASS
runCase(4, 'load > classLowerBound → NOT INCLUDED', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  var classBoundsByProctorKey = {
    P0: { classLowerBound: 1, classUpperBound: 3 }
  };
  var loadState = V2._internals.createLoadState();
  // 3 guard slots on distinct halfdays → load == 3 > classLowerBound (1).
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-10|p0', 'Teacher_P0');
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-11|p0', 'Teacher_P0');
  V2._internals.addGuardLoad(loadState, 'P0', '2026-03-12|p0', 'Teacher_P0');

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.deepStrictEqual(normalize(result), [],
    'Case 4: expected empty result (load > classLowerBound), got ' +
    JSON.stringify(normalize(result)));
});

// ============================================================
// Case 5: classBoundsByProctorKey[key] === undefined → NOT INCLUDED
// ============================================================
// Status on F: PASS, F': PASS
runCase(5, 'classBoundsByProctorKey[key] === undefined → NOT INCLUDED', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  // Bounds map exists but does NOT contain 'P0' — bounds-undefined branch.
  var classBoundsByProctorKey = {};
  var loadState = V2._internals.createLoadState();
  // No guard slots → load == 0; nonetheless the bounds-undefined guard
  // must skip this proctor on both F and F'.

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.deepStrictEqual(normalize(result), [],
    'Case 5: expected empty result (no bounds for key), got ' +
    JSON.stringify(normalize(result)));
});

// ============================================================
// Case 6: proctorsList === null → empty result
// ============================================================
runCase(6, 'proctorsList === null → empty result', function () {
  var loadState = V2._internals.createLoadState();
  var result = V2._internals.collectUncovered(
    null, { P0: { classLowerBound: 2, classUpperBound: 3 } }, loadState
  );
  assert.deepStrictEqual(normalize(result), [],
    'Case 6: expected empty result on null proctorsList, got ' +
    JSON.stringify(normalize(result)));
});

// ============================================================
// Case 7: proctorsList === [] → empty result
// ============================================================
runCase(7, 'proctorsList === [] → empty result', function () {
  var loadState = V2._internals.createLoadState();
  var result = V2._internals.collectUncovered(
    [], { P0: { classLowerBound: 2, classUpperBound: 3 } }, loadState
  );
  assert.deepStrictEqual(normalize(result), [],
    'Case 7: expected empty result on empty proctorsList, got ' +
    JSON.stringify(normalize(result)));
});

// ============================================================
// Case 8: classLowerBound == 0 (degenerate boundary) → NOT INCLUDED on F'
// ============================================================
// Status on F:  FAIL (F's `=== 0` matches load==0; F includes the proctor)
// Status on F': PASS (`< 0` never true)
// This documents the INTENTIONAL behaviour change at the degenerate boundary
// (design.md "Edge Cases Handled" row 8). When classLowerBound == 0 there
// is no fairness obligation, so emitting an empty work list is correct.
runCase(8, 'classLowerBound == 0 (degenerate boundary) → NOT INCLUDED on F\'', function () {
  var p0 = { cin: 'P0', teacher_name: 'Teacher_P0' };
  var proctorsList = [p0];
  var classBoundsByProctorKey = {
    P0: { classLowerBound: 0, classUpperBound: 2 }
  };
  var loadState = V2._internals.createLoadState();
  // No guard slots → load == 0; on F the `=== 0` predicate matches and the
  // proctor is wrongly included; on F' the `< 0` predicate never matches.

  var result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );

  assert.deepStrictEqual(normalize(result), [],
    'Case 8: expected empty result on degenerate boundary ' +
    '(classLowerBound == 0, load == 0). On F this fails because F\'s ' +
    '`=== 0` predicate matches; on F\' the `< 0` predicate never matches. ' +
    'got ' + JSON.stringify(normalize(result)));
});

// ============================================================
// Summary + exit-code logic
// ============================================================

console.log('\n[undercovered-collect-unit] Case-by-case status:');

var failedNums = [];
for (var i = 0; i < outcomes.length; i++) {
  var o = outcomes[i];
  var line = 'Case ' + o.num + ': ' + o.status;
  if (o.status === 'FAIL') {
    failedNums.push(o.num);
    if (o.num === 2) {
      line += ' (expected on F: bug-condition; would PASS on F\')';
    } else if (o.num === 8) {
      line += ' (expected on F: degenerate-boundary; would PASS on F\')';
    }
    line += '\n         label: ' + o.label;
    line += '\n         error: ' + (o.error || '(no message)');
  } else {
    line += ' — ' + o.label;
  }
  console.log(line);
}

console.log('\n[undercovered-collect-unit] Total failures: ' + failedNums.length +
  ' / ' + outcomes.length);
console.log('[undercovered-collect-unit] Failed case numbers: [' +
  failedNums.join(', ') + ']');

// Decide exit code per task spec.
//   - 0 failures              → exit 0 (F' / fixed state — every case passes)
//   - exactly [2, 8] failed   → exit 0 (F / unfixed state — expected pattern)
//   - anything else           → exit 1 (deeper issue)
var allPassed = failedNums.length === 0;
var fExpected =
  failedNums.length === 2 &&
  failedNums.indexOf(2) !== -1 &&
  failedNums.indexOf(8) !== -1;

if (allPassed) {
  console.log('\n[undercovered-collect-unit] PASS — every case passed (F\' state).');
  process.exit(0);
} else if (fExpected) {
  console.log('\n[undercovered-collect-unit] PASS — F-expected pattern observed ' +
    '(cases 2 and 8 failed; cases 1, 3, 4, 5, 6, 7 passed). ' +
    'After the fix lands (task 4.1), all 8 cases should pass.');
  process.exit(0);
} else {
  console.error('\n[undercovered-collect-unit] FAIL — unexpected failure pattern. ' +
    'On F we expect exactly cases [2, 8] to fail; on F\' all 8 should pass. ' +
    'Got failed cases: [' + failedNums.join(', ') + '].');
  process.exit(1);
}

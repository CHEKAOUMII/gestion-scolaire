'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on F.
//
// Spec: .kiro/specs/proctor-v2-fairness-undercovered-fix/
// Task 1 — Bug Condition C(X) (system-level C2): on the real-centre fixture
// `phase2_75CoverageRepair` reports zero swaps and zero unresolved while a
// fairness violation persists.
//
// DO NOT attempt to "fix" this test if it fails. It is supposed to fail on
// the unfixed `collectUncovered` predicate (which uses `=== 0` and misses
// proctors whose primaryLoad is between 0 and classLowerBound).
//
// Pre-fix counterexample (deterministic; observed on F by running
// `node scripts/verify-real-centre.js` against
// tests/fixtures/proctor-v2-real-centre-data.json):
//
//   Diagnostics:
//     lowerBound:                2
//     upperBound:                3
//     eligibilityClassCount:     1
//     coverageRepairSwaps:       0     ← bug
//     coverageRepairUnresolved:  0     ← bug
//     coverageRepairWarnings:    []
//     maxPrimaryLoadGapWithinClass: 2  (must be ≤ 1)
//
//   Load distribution (147 proctors, 368 expected slots):
//     load=0 →   1 proctor
//     load=1 →  24 proctors      ← below classLowerBound but missed by F
//     load=2 →  32 proctors
//     load=3 →  90 proctors
//
//   min = 0,  max = 3,  max − min = 3,  filledSlots = 358 / 368 (10 unfilled)
//
//   P1 (max-min ≤ 1):     FAIL (gap = 3)
//   P3 (min ≥ lowerBound): FAIL (min = 0)
//   coverageRepair did nothing: FAIL (swaps=0 AND unresolved=0)
//
// _Validates: Requirements 1.1, 1.2, 1.3 (Bug Condition C, Property P1, P3)_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (mirrors lines 12-22 of
//    scripts/verify-real-centre.js).
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

// 2) Load the real-centre fixture.
const input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/proctor-v2-real-centre-data.json'),
  'utf8'
));

// 3) Run with the production module's default RNG (no seed override).
const out = V2.run(input);
assert.ok(out && out.result && out.diagnostics,
  'V2.run produced no result/diagnostics on real-centre fixture');

const d = out.diagnostics;

// 4) Reconstruct slot loads using __idx_N keys (mirrors lines 70-80 of
//    scripts/verify-real-centre.js).
const slotCount = Object.create(null);
for (let i = 0; i < out.result.length; i++) {
  const keys = out.result[i].proctor_keys || [];
  for (let j = 0; j < keys.length; j++) {
    const k = keys[j];
    if (k) slotCount[k] = (slotCount[k] || 0) + 1;
  }
}

const totalProctors = input.proctorsList.length;
const loads = [];
for (let i = 0; i < totalProctors; i++) {
  const k = '__idx_' + i;
  const load = slotCount[k] || 0;
  loads.push({ idx: i, name: input.proctorsList[i].teacher_name, load: load });
}

const guardCounts = loads.map(function (l) { return l.load; });
const min = Math.min.apply(null, guardCounts);
const max = Math.max.apply(null, guardCounts);

const lowerBound = d.lowerBound;
const upperBound = d.upperBound;

// 5) Build the histogram and the load-0/load-1 proctor list — these surface
//    the counterexample in the failure message.
const hist = Object.create(null);
guardCounts.forEach(function (c) { hist[c] = (hist[c] || 0) + 1; });

const histLines = Object.keys(hist)
  .sort(function (a, b) { return (+a) - (+b); })
  .map(function (k) { return '  load=' + k + ' → ' + hist[k] + ' proctor(s)'; })
  .join('\n');

const underBound = loads.filter(function (l) { return l.load < lowerBound; });
const underBoundList = underBound
  .map(function (l) {
    return '  idx=' + l.idx + ' load=' + l.load + ' | ' + l.name;
  })
  .join('\n');

console.log('[undercovered-exploration] real-centre fixture:');
console.log('  proctors=' + totalProctors +
  ' | sessions=' + (input.scheduleEntries || []).length +
  ' | resultRows=' + out.result.length);
console.log('  lowerBound=' + lowerBound + ' upperBound=' + upperBound +
  ' eligibilityClassCount=' + d.eligibilityClassCount);
console.log('  coverageRepairSwaps=' + d.coverageRepairSwaps +
  ' coverageRepairUnresolved=' + d.coverageRepairUnresolved +
  ' coverageRepairWarnings=' + JSON.stringify(d.coverageRepairWarnings || []));
console.log('  maxPrimaryLoadGapWithinClass=' + d.maxPrimaryLoadGapWithinClass);
console.log('  min=' + min + ' max=' + max + ' diff=' + (max - min));
console.log('Histogram:\n' + histLines);
console.log('Proctors below lowerBound (' + lowerBound + ') — ' +
  underBound.length + ' total:\n' + underBoundList);

// 6) Three assertions — each surfaces a clear counterexample on F.

// P3 — `min ≥ lowerBound`. Encodes the fairness lower-bound invariant.
assert.ok(
  min >= lowerBound,
  'P3 violated on real-centre fixture: min(primaryLoad) = ' + min +
    ' but lowerBound = ' + lowerBound + '. ' +
    underBound.length + ' proctor(s) sit below the bound. ' +
    'Counterexample histogram: ' + JSON.stringify(hist) + '. ' +
    'coverageRepairSwaps=' + d.coverageRepairSwaps +
    ', coverageRepairUnresolved=' + d.coverageRepairUnresolved +
    ' — the repair pass did nothing while the violation persisted, ' +
    'confirming `collectUncovered` missed proctors with 0 < load < classLowerBound.'
);

// P1 — `max − min ≤ 1`. Encodes the within-class fairness gap invariant.
assert.ok(
  max - min <= 1,
  'P1 violated on real-centre fixture: max(primaryLoad)=' + max +
    ', min(primaryLoad)=' + min + ', gap=' + (max - min) +
    ' (must be ≤ 1). ' +
    'Counterexample histogram: ' + JSON.stringify(hist) + '. ' +
    'lowerBound=' + lowerBound + ', upperBound=' + upperBound + '. ' +
    'maxPrimaryLoadGapWithinClass=' + d.maxPrimaryLoadGapWithinClass + '.'
);

// Repair pass must do something on this fixture — either swap proctors up
// (`coverageRepairSwaps > 0`) or emit at least one diagnostic warning
// (`coverageRepairUnresolved > 0`). Both being zero in the presence of a
// fairness violation is the signature of the bug.
assert.ok(
  d.coverageRepairSwaps > 0 || d.coverageRepairUnresolved > 0,
  'phase2_75CoverageRepair was a no-op on real-centre fixture: ' +
    'coverageRepairSwaps=' + d.coverageRepairSwaps +
    ', coverageRepairUnresolved=' + d.coverageRepairUnresolved +
    ', coverageRepairWarnings=' + JSON.stringify(d.coverageRepairWarnings || []) +
    '. With ' + underBound.length + ' proctor(s) below lowerBound (' +
    lowerBound + '), the repair pass MUST either lift them ' +
    '(swaps > 0) or record a diagnostic warning (unresolved > 0). ' +
    'Both being zero indicates `collectUncovered` returned an empty/undersized ' +
    'work list — the function-level Bug Condition C1.'
);

console.log('[undercovered-exploration] (unexpected) all three properties ' +
  'hold on F — the bug may not be reproduced on this fixture.');

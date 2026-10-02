'use strict';

// @preservation test — Property 2. MUST PASS on F and on F'.
//
// Spec: .kiro/specs/proctor-v2-fairness-undercovered-fix/
// Task 2 — Preservation: For every input where the bug condition does NOT
// hold (every proctor with bounds already meets `classLowerBound`), the
// fixed `collectUncovered` SHALL produce the same result as F (the empty
// list).
//
// The two sections below cover both "synthetic" and "fixture-derived"
// shapes of `¬C(X)`:
//
//   Section A — Randomised synthetic preservation property (50 iterations,
//               seeded `mulberry32(0xC0FFEE)`). Each generated input
//               satisfies `¬C(X)` by construction: every keyed proctor's
//               primary load is brought to at-or-above its
//               `classLowerBound` via the v2 module's `addGuardLoad`
//               helper, and a random subset of proctors is skipped from
//               `classBoundsByProctorKey` (no-bounds branch). The asserted
//               output is `[]`.
//
//   Section B — Baseline observation suite. A small set of `build*Input()`
//               factories from the bug fixtures and the strict-fairness
//               fixtures is exercised through `phase1PrePass` +
//               `phase2Build`, and the post-phase-2 `loadState` /
//               `classBoundsByProctorKey` are inspected. When the
//               precondition `¬C(X)` holds at that post-phase-2 state, the
//               test asserts `collectUncovered` returns `[]`. When the
//               precondition does NOT hold (bug territory), the case is
//               logged and skipped — preservation makes no claim there;
//               the bug-condition exploration test (task 1) and the unit
//               test (task 3) cover those branches.
//
// Why "skip with a log" instead of capturing a hard-coded snapshot for
// Section B: F's `collectUncovered` predicate is `=== 0`, so when bug
// condition C(X) holds at post-phase-2 state, F returns a strictly
// smaller list than F'. Capturing F's output as a snapshot would lock
// the test into F's incorrect behaviour and would FAIL on F' (the very
// regression we are trying to allow). The "skip when ¬C(X) fails"
// strategy keeps the assertion tight where preservation actually
// applies (the bulk of the random property + every fixture case where
// every keyed proctor is at-or-above the bound) and silent where
// preservation is not the right notion.
//
// _Validates: Requirements 3.1, 3.2 (Property 2 — Preservation)_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (mirrors the boilerplate
//    used by tests/proctor-v2-fairness-undercovered-exploration.test.js).
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

// 2) Inline mulberry32 PRNG so the random property is deterministic and
//    reproducible without an external dependency.
function mulberry32(seed) {
  var s = seed >>> 0;
  return function next() {
    s = (s + 0x6D2B79F5) >>> 0;
    var t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rngInt(rng, lo, hi) {
  // Inclusive bounds.
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ============================================================
// SECTION A — Random synthetic preservation property
// ============================================================

const NUM_ITERATIONS = 50;
const rng = mulberry32(0xC0FFEE);

let aPassed = 0;
let aGenerated = 0;
const aFailures = [];

for (let it = 0; it < NUM_ITERATIONS; it++) {
  // 2.a) Generate a synthetic proctorsList of size 1..30.
  const N = rngInt(rng, 1, 30);
  const proctorsList = [];
  for (let i = 0; i < N; i++) {
    proctorsList.push({
      // Synthetic CIN-like keys ('P_' + i) so getProctorKey(proc, i) === proc.cin.
      cin: 'P_' + it + '_' + i,
      teacher_name: 'Synthetic_' + it + '_' + i
    });
  }

  // 2.b) For each proctor, randomly assign class bounds:
  //        classLowerBound: 1..3   (see NOTE below)
  //        classUpperBound: classLowerBound..classLowerBound+2
  //      Then randomly skip a subset of proctors entirely (no-bounds branch).
  //
  // NOTE on the lower-bound floor at 1 (not 0):
  //   The design.md "Edge Cases Handled" table, last row, explicitly
  //   documents `classLowerBound == 0` as an INTENTIONAL behaviour change
  //   between F and F': F includes load-0 proctors when classLowerBound==0
  //   (because its predicate is `=== 0`), F' does NOT (because `< 0` is
  //   never true). That is the one cell where F ≠ F' even though the
  //   bug condition C(X) does not hold (`0 < load < classLowerBound`
  //   is unsatisfiable when classLowerBound==0). Preservation as
  //   stated in bugfix.md §3.1 ("SHALL CONTINUE TO return an empty
  //   array") therefore applies in the strict-positive-bound region
  //   only — exactly what the random generator below explores. The
  //   degenerate-boundary case is exercised separately by the unit
  //   test (task 3, case 8).
  const classBoundsByProctorKey = Object.create(null);
  for (let i = 0; i < N; i++) {
    if (rng() < 0.2) {
      // ~20% of proctors have NO bounds (no-bounds branch — `classBoundsByProctorKey[key] === undefined`).
      continue;
    }
    const lower = rngInt(rng, 1, 3);
    const upper = rngInt(rng, lower, lower + 2);
    classBoundsByProctorKey[proctorsList[i].cin] = {
      classLowerBound: lower,
      classUpperBound: upper
    };
  }

  // 2.c) Build a loadState via the v2 module's addGuardLoad helper so
  //      `getPrimaryLoad(key) >= classLowerBound` for every KEYED proctor
  //      (`¬C(X)` by construction). Synthetic halfday keys, one new per call.
  const loadState = V2._internals.createLoadState();
  for (let i = 0; i < N; i++) {
    const key = proctorsList[i].cin;
    const bounds = classBoundsByProctorKey[key];
    if (!bounds) continue;
    // Add a small random surplus (0..2 above the lower bound) to widen
    // coverage — exercises both "load == classLowerBound" and
    // "load > classLowerBound" preservation rows from design.md.
    const targetLoad = bounds.classLowerBound + rngInt(rng, 0, 2);
    for (let g = 0; g < targetLoad; g++) {
      const halfdayKey = '2026-03-' + (10 + it) + '|p' + g + '_' + i;
      V2._internals.addGuardLoad(loadState, key, halfdayKey, proctorsList[i].teacher_name);
    }
  }

  // 2.d) Sanity-check the precondition `¬C(X)` actually holds on the
  //      generated input. If construction above ever drifts, fail loudly
  //      with the seed offset rather than silently.
  for (let i = 0; i < N; i++) {
    const key = proctorsList[i].cin;
    const bounds = classBoundsByProctorKey[key];
    if (!bounds) continue;
    const load = V2._internals.getPrimaryLoad(loadState, key);
    if (load < bounds.classLowerBound) {
      throw new Error(
        '[generator-bug] iteration=' + it +
        ' key=' + key +
        ' load=' + load +
        ' classLowerBound=' + bounds.classLowerBound +
        ' — synthetic input failed to satisfy `¬C(X)` precondition.'
      );
    }
  }

  // 2.e) Call collectUncovered. The result MUST be empty: every keyed
  //      proctor is at-or-above its classLowerBound (`¬C(X)`), and every
  //      keyless proctor is skipped by the function's bounds-defined guard.
  //
  //      Cross-realm note: the v2 module runs inside a `vm` sandbox, so
  //      arrays returned by `collectUncovered` carry the sandbox's
  //      `Array.prototype`, not the host's. `assert.deepStrictEqual([], result)`
  //      fails on prototype identity even when both are empty. We compare
  //      length + a normalised JSON projection instead — preserves the
  //      "F and F' produce the same output" guarantee while staying robust
  //      across realms.
  const result = V2._internals.collectUncovered(
    proctorsList, classBoundsByProctorKey, loadState
  );
  aGenerated++;

  try {
    const normalized = JSON.parse(JSON.stringify(
      result.map(function (r) { return { key: r.key, idx: r.idx }; })
    ));
    assert.strictEqual(
      result.length, 0,
      'Preservation violated on iteration ' + it +
      ': collectUncovered returned ' + result.length +
      ' entries on a `¬C(X)` input (expected 0). ' +
      'N=' + N + ', keysWithBounds=' + Object.keys(classBoundsByProctorKey).length +
      ', returned=' + JSON.stringify(normalized)
    );
    assert.deepStrictEqual(normalized, [],
      'Preservation violated on iteration ' + it +
      ': collectUncovered returned non-empty entries on a `¬C(X)` input. ' +
      'returned=' + JSON.stringify(normalized));
    aPassed++;
  } catch (e) {
    aFailures.push({ iteration: it, message: e.message });
  }
}

console.log('[undercovered-preservation] Section A — random property:');
console.log('  iterations generated: ' + aGenerated + ' / ' + NUM_ITERATIONS);
console.log('  iterations passed:    ' + aPassed);
if (aFailures.length > 0) {
  console.log('  failures (' + aFailures.length + '):');
  for (let i = 0; i < aFailures.length; i++) {
    console.log('    - it=' + aFailures[i].iteration + ': ' + aFailures[i].message);
  }
}

assert.strictEqual(aFailures.length, 0,
  'Section A: ' + aFailures.length + ' / ' + NUM_ITERATIONS +
  ' randomised iterations failed the preservation property. ' +
  'See log above for counterexamples.');

// ============================================================
// SECTION B — Baseline observation suite (existing fixtures)
// ============================================================
//
// Run a handful of `build*Input()` factories through phase1PrePass +
// phase2Build to obtain the post-phase-2 `loadState` and
// `classBoundsByProctorKey`. For each fixture, check the precondition
// `¬C(X)` at that state. When it holds, assert `collectUncovered` returns
// `[]`. When it does not, log and skip — preservation is not the right
// notion in bug territory.

const BugFixtures = require(path.join(ROOT, 'tests/fixtures/proctor-v2-bug-fixtures.js'));
const StrictFixtures = require(path.join(ROOT, 'tests/fixtures/proctor-v2-strict-fairness-fixtures.js'));

const fixtures = [
  // Pure synthetic inputs that exercise the v2 algorithm end-to-end.
  // Selected to cover a range of shapes (single-class fairness, duty-aware,
  // duty-already-covered) without overlapping the bug-condition exploration
  // territory (147-proctor real-centre fixture).
  //
  // Per Section B's precondition check below, fixtures that land in either
  // "bug territory" (some proctor at 0 < load < classLowerBound) or the
  // "degenerate boundary" (load == 0 AND classLowerBound == 0; design.md
  // row 8) are skipped — preservation makes no F=F' claim there. Including
  // a mix of fixtures lets us assert preservation on at least the cases
  // where it does apply, and surface the others as observed (logged)
  // behaviour for the record.
  { name: 'buildC1Input',                   build: BugFixtures.buildC1Input },
  { name: 'buildC2Input',                   build: BugFixtures.buildC2Input },
  { name: 'buildC3FixedInput',              build: BugFixtures.buildC3FixedInput },
  { name: 'buildC3PercentInput',            build: BugFixtures.buildC3PercentInput },
  { name: 'buildC2DutyAlreadyCoveredInput', build: StrictFixtures.buildC2DutyAlreadyCoveredInput },
  { name: 'buildC1SoftPenaltyWinsInput',    build: StrictFixtures.buildC1SoftPenaltyWinsInput }
];

let bAsserted = 0;
let bSkipped = 0;
const bFailures = [];

for (let f = 0; f < fixtures.length; f++) {
  const fx = fixtures[f];
  const input = fx.build();
  const seed = (typeof input.randomSeed === 'number') ? input.randomSeed : 42;

  let phase1Result, phase2Result;
  try {
    const fxRng = V2._internals.buildSeededPRNG(seed);
    phase1Result = V2._internals.phase1PrePass(input);
    phase2Result = V2._internals.phase2Build(phase1Result, input, fxRng);
  } catch (e) {
    bFailures.push({
      fixture: fx.name,
      message: 'phase1/phase2 raised: ' + e.message
    });
    continue;
  }

  const loadState = phase2Result.loadState || {};
  const cbpk = phase2Result.classBoundsByProctorKey || {};
  const list = input.proctorsList || [];

  // Precondition check: is the input in PRESERVATION TERRITORY at the
  // post-phase-2 state? Two conditions must hold for every keyed proctor:
  //   (a) NOT (0 < load < classLowerBound)               — `¬C(X)` itself
  //   (b) NOT (load == 0 AND classLowerBound == 0)       — degenerate
  //                                                        boundary (design.md
  //                                                        Edge Cases row 8)
  // (b) is the ONE cell where F ≠ F' even though `¬C(X)` holds: F's `=== 0`
  // predicate matches load==0 when classLowerBound==0, F's `< classLowerBound`
  // predicate does not. Per design.md this is an INTENTIONAL change; see
  // bugfix.md §3.1 ("SHALL CONTINUE TO return an empty array") which is
  // satisfied by F' but not by F at that boundary. The unit test (task 3,
  // case 8) covers the degenerate case directly.
  let preconditionHolds = true;
  const violations = [];
  for (let i = 0; i < list.length; i++) {
    const key = V2._internals.getProctorKey(list[i], i);
    const bounds = cbpk[key];
    if (!bounds) continue;
    const load = V2._internals.getPrimaryLoad(loadState, key);
    if (load < bounds.classLowerBound) {
      preconditionHolds = false;
      violations.push({
        key: key,
        load: load,
        classLowerBound: bounds.classLowerBound,
        reason: 'bug-condition (load < classLowerBound)'
      });
    } else if (load === 0 && bounds.classLowerBound === 0) {
      preconditionHolds = false;
      violations.push({
        key: key,
        load: load,
        classLowerBound: bounds.classLowerBound,
        reason: 'degenerate-boundary (classLowerBound==0; design.md row 8)'
      });
    }
  }

  if (!preconditionHolds) {
    console.log('[undercovered-preservation] Section B — ' + fx.name +
      ': preservation precondition does NOT hold (' + violations.length +
      ' proctor(s) flagged). Out of preservation territory — F may differ ' +
      'from F\' here per design.md; skipping. ' +
      'Examples: ' + JSON.stringify(violations.slice(0, 3)));
    bSkipped++;
    continue;
  }

  // Precondition holds: F and F' must agree on `[]`.
  //
  // Same cross-realm caveat as Section A: compare length + a normalised
  // JSON projection instead of using `deepStrictEqual([], result)` directly.
  const result = V2._internals.collectUncovered(list, cbpk, loadState);
  try {
    const normalized = JSON.parse(JSON.stringify(
      result.map(function (r) { return { key: r.key, idx: r.idx }; })
    ));
    assert.strictEqual(
      result.length, 0,
      'Section B / ' + fx.name + ': preservation precondition holds yet ' +
      'collectUncovered returned ' + result.length + ' entries (expected 0). ' +
      'returned=' + JSON.stringify(normalized)
    );
    assert.deepStrictEqual(normalized, [],
      'Section B / ' + fx.name + ': normalised result is non-empty. ' +
      'returned=' + JSON.stringify(normalized));
    bAsserted++;
    console.log('[undercovered-preservation] Section B — ' + fx.name +
      ': preservation precondition holds, collectUncovered === [] ✓');
  } catch (e) {
    bFailures.push({ fixture: fx.name, message: e.message });
  }
}

console.log('[undercovered-preservation] Section B — fixture observation:');
console.log('  fixtures asserted: ' + bAsserted);
console.log('  fixtures skipped (bug territory, no preservation claim): ' + bSkipped);
if (bFailures.length > 0) {
  console.log('  failures (' + bFailures.length + '):');
  for (let i = 0; i < bFailures.length; i++) {
    console.log('    - ' + bFailures[i].fixture + ': ' + bFailures[i].message);
  }
}

assert.strictEqual(bFailures.length, 0,
  'Section B: ' + bFailures.length + ' / ' + fixtures.length +
  ' fixture observations failed the preservation property.');

// ============================================================
// FINAL REPORT
// ============================================================

console.log('\n[undercovered-preservation] PASS');
console.log('  Section A (random property): ' + aPassed + '/' + NUM_ITERATIONS + ' iterations');
console.log('  Section B (fixtures):        ' + bAsserted + ' asserted, ' +
  bSkipped + ' skipped, ' + bFailures.length + ' failed');

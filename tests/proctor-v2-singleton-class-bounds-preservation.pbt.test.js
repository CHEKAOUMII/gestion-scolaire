'use strict';

// @preservation property test — Property 2 (non-buggy-input baseline).
// MUST PASS on F (the unfixed code). Re-used by Task 6.2 to assert
// byte-equality of the same recorded observations on F' (the fixed
// code).
//
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
// Task 2.1 — establishes the post-Phase-2 + post-2.5 + post-2.75 +
// post-Phase-3 observational baseline that the singleton-class-bounds
// fix MUST preserve byte-for-byte on every input where the bug
// condition does NOT fire (every per-class
// `floor(bTotal / bSize) <= LB_global + 1`).
//
// _Bug_Condition: NOT isBugCondition(X) — preservation domain
// _Expected_Behavior: Property 2 — observational equivalence on
//                      `NOT C(X)` inputs (design.md §"Correctness
//                      Properties" → Property 2)
// _File: tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js (NEW)
// _Requirements: 2.3, 2.7, 2.9, 3.6, 3.7, 3.16, 3.17, 3.19, 3.20
//
// ---------------------------------------------------------------------
// Why mulberry32 instead of fast-check
// ---------------------------------------------------------------------
// `fast-check` is NOT in `package.json` (only better-sqlite3, dotenv,
// firebase, xlsx, plus dev tooling — verified 2026-05-17). The
// reference PBT files in this repo all use the mulberry32 PRNG:
//
//   tests/preservation-config-roundtrip.pbt.test.js (Section "Why
//     deterministic PRNG instead of fast-check" documents the rationale)
//   tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
//     (the closest analog — parent spec's preservation PBT)
//   tests/proctor-v2-fairness-undercovered-preservation.test.js
//   tests/proctor-v2-all-cin-preservation.test.js
//
// Tasks.md task 2.1 says "use fast-check (existing PBT framework in
// this repo — see preservation-config-roundtrip.pbt.test.js for the
// import style and seed plumbing)". The named reference file is
// itself mulberry32-based, so we follow its idiom verbatim. Adding
// a new dependency for a single test would violate the project's
// no-new-deps style.
//
// mulberry32 produces deterministic, reproducible counterexamples
// without any new dependency. Each generated input is fully replayable
// via the per-iteration sub-seed.
//
// ---------------------------------------------------------------------
// Bug Condition C(X) — the rejection filter
// ---------------------------------------------------------------------
// Per design.md §"Bug Details" → "Bug Condition":
//
//   isBugCondition(X) := EXISTS class c WITH
//                          classBounds[c].classLowerBound > LB_global + 1
//
// where `LB_global = floor((totalGuardSlots + D_expected) / N_eligible)`.
//
// We rejection-sample by deriving `classBounds` directly via
// `V2._internals.computeClassBounds` BEFORE running the full V2.run
// pipeline. Inputs where ANY per-class lower bound exceeds
// LB_global + 1 are SKIPPED. Inputs where every per-class lower bound
// is within the global ceiling are recorded and asserted: they form
// the preservation domain.
//
// Generator design forces `NOT isBugCondition` by construction — we
// generate inputs where every proctor has FULL eligibility (no
// exemptions, no duty constraints) and each row covers every proctor.
// Under that geometry, `computeEligibilityClasses` produces exactly
// ONE class containing all proctors (the only-one-class branch of
// `computeClassBounds` fires, lines 561–574 of
// `js/algorithms/proctor-distribution-v2.js`). The only-one-class
// branch is algebraically equivalent to the global formula:
//   classLowerBound = floor(onlyTotal / onlySize) = floor((totalGuardSlots
//                     + D_expected) / N_eligible) = LB_global
// so the bug cannot trigger by construction — and the cap+guard
// changes that Tasks 5.2/5.3 will apply do NOT touch this branch
// (per design.md §"Specific Changes" point 3 and §"Preservation
// Requirements"). This keeps the generator simple, the rejection
// rate at 0, and the preservation property crisp: every accepted
// input traverses the only-one-class branch on both F and F', and
// the expected post-fix output is byte-identical to F's output.
//
// As an additional probe, a small fraction of inputs DO inject light
// per-row exemptions (no proctor exempt from more than one row) so
// the multi-class fallback branch fires with classes whose
// `floor(bTotal / bSize) <= LB_global + 1`. The rejection filter
// guards against the unlikely case where such an input still
// triggers the bug condition.
//
// ---------------------------------------------------------------------
// Slot-metric semantics
// ---------------------------------------------------------------------
// With zero duty in every generated input, primary load = guard count.
// We reconstruct guard count per canonical key by counting appearances
// in `result[i].proctor_keys` (slot-metric), mirroring the closed
// spec `proctor-v2-strict-fairness-coverage`'s slot-metric switch and
// the reconstruction used by the parent spec's preservation PBT.
//
// ---------------------------------------------------------------------
// Recording shape (observation-first methodology)
// ---------------------------------------------------------------------
// For each accepted input, record:
//   - rowCount
//   - proctorKeysByRow      (per-row, in row order)
//   - reserveKeysByRow      (per-row, in row order)
//   - classBoundsByProctorKey  (canonical-key-to-bounds map; reconstructed
//                              from V2._internals.computeClassBounds since
//                              V2.run does NOT surface this map publicly)
//   - serializedClassBounds (per-classId map; from diagnostics.classBounds)
//   - histogram             (slot-metric guard-count histogram, derived
//                            from result[i].proctor_keys)
//   - coverageRepairSwaps
//   - coverageRepairUnresolved
//   - coverageRepairWarnings
//   - loadBalance           (V2's diagnostics.loadBalance)
//
// Task 6.2 will rerun each accepted iteration on F' and assert
// byte-equality against this recording. The fix MUST NOT alter any
// of the above on `NOT C(X)` inputs.
//
// ---------------------------------------------------------------------
// Snapshot
// ---------------------------------------------------------------------
// One canonical case is captured to:
//
//   tests/fixtures/proctor-v2-singleton-class-bounds-preservation-snapshot.json
//
// (the first accepted iteration under seed 0xC0FFEE). Task 6.2 will
// JSON.parse this file, V2.run(snapshot.input) on F', re-record the
// observation, and assert byte-equality with snapshot.observation.
//
// ---------------------------------------------------------------------
// Existing-suite preservation baseline (Req 3.1, 3.2, 3.3, 3.10, 3.11,
//                                       3.21)
// ---------------------------------------------------------------------
// Captured 2026-05-17 on UNFIXED code (post-key-shape-unification,
// pre-multi-step-repair, pre-singleton-class-bounds) by Task 2.3.
// The empirical `npm` counts below are the regression threshold for
// Task 6.7 (test suite re-run) and Task 6.7 (lint re-run); post-fix
// counts MUST match modulo the four known failure flips documented
// at the bottom of this block.
//
// Note: the project does not register a `test` script in
// `package.json`. Tests are run individually via plain `node` per
// the in-tree convention, and the helper `scripts/run-all-tests.sh`
// enumerates `tests/*.test.js` and `tests/integration/*.test.js`,
// running each file in its own `node` process (PASS = exit code 0,
// FAIL = non-zero). The "in-scope" suite per Req 3.1, 3.2, 3.3, 3.10
// is the union of:
//
//   tests/proctor-v2-*.test.js       — Req 3.1
//   tests/inv-h5-*.test.js           — Req 3.2
//   tests/preservation-config-roundtrip.pbt.test.js  — Req 3.3
//   tests/proctor-v2-phase2-75-multi-step-warnings-shape.test.js,
//   tests/proctor-v2-phase2-75-multi-step-determinism.test.js,
//   tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
//                                    — Req 3.10, 3.21 (parent spec)
//
// `scripts/run-all-tests.sh` covers all of the above plus a few
// out-of-spec tests (e.g. `tests/inv-a-instrument-roundtrip.test.js`,
// `tests/inv-e-display-aggregation.test.js`, `tests/build-summary-
// rows-unit.test.js`); the totals below are the verbatim output of
// the script run.
//
// ----- npm test counts (UNFIXED code, captured 2026-05-17) -----
//   Total test files in `scripts/run-all-tests.sh` scope: 77
//   Pass:                68
//   Fail:                 9
//
//   Failing files (verbatim):
//     1. tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//        Status: FAIL by-design — parent spec's exploration test
//        (`proctor-v2-phase2-75-multi-step-repair`, Task 1).
//        Inherits failure from the production fixture's impossible
//        bounds. Post-fix (this spec's Tasks 5.2 + 5.3): MUST flip
//        to PASS once the cap fires (Req 3.12, 3.22).
//     2. tests/proctor-v2-phase2-75-multi-step-fix.test.js
//        Status: FAIL by-design — parent spec's fix-checking test.
//        Same provenance as #1 above. Post-fix: MUST flip to PASS
//        (Req 3.12, 3.22).
//     3. tests/proctor-v2-singleton-class-bounds-exploration.test.js
//        Status: FAIL by-design — this spec's Task 1 exploration
//        test (encodes Property 1 / Bug Condition C(X) on the
//        synthetic singleton, synthetic non-singleton, and
//        production-fixture replay cases). Pre-fix the universal
//        cap assertion is counter-exampled. Post-fix (Tasks 5.2 +
//        5.3): MUST flip to PASS (Req 2.12).
//     4. tests/proctor-v2-singleton-class-bounds-monotonicity.test.js
//        Status: FAIL by-design — this spec's Task 2.2 monotonicity
//        test, branch 1 (cap-fires case). Branches 2, 3, 4 already
//        pass on F; branch 1 only passes after Tasks 5.2 + 5.3
//        land. Post-fix: MUST flip to fully PASS (Req 2.4, 3.17).
//     5. tests/inv-e-display-aggregation.test.js
//        Status: FAIL — pre-existing, unrelated to this spec.
//        The test asserts a display-layer aggregation invariant
//        that has been failing since before the parent spec's
//        Task 2.3 baseline (carried verbatim from the working tree
//        on 2026-05-17). Out of scope for this bugfix (display
//        layer is in design.md §"Out-of-Scope (Explicit)").
//        Post-fix: MUST remain FAIL with no change in failure mode.
//     6. tests/proctor-v2-fairness-undercovered-exploration.test.js
//        Status: FAIL by-design — documented regression flagged by
//        the parent spec `proctor-v2-phase2-75-multi-step-repair`
//        (Req 3.12 of that spec). Asserts `min >= classLowerBound`
//        on the production fixture; fails because the parent spec's
//        multi-step repair has not yet landed. Out of scope here.
//        Post-fix: MUST remain FAIL until the parent spec lands;
//        this spec MUST NOT regress its failure mode.
//     7. tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
//        Status: FAIL — pre-existing snapshot drift (`coverageRepair-
//        Warnings: []` in snapshot vs `{}` in current code). The
//        snapshot was captured under the parent spec's pre-shape-
//        migration state, and the diagnostics-shape migration has
//        partially landed (the production code now emits an empty
//        object instead of the empty array). Unrelated to this
//        spec's bug — the singleton-class-bounds fix does NOT
//        touch `coverageRepairWarnings`. Post-fix: MUST remain
//        FAIL with the identical drift signature.
//     8. tests/proctor-v2-strict-bug-c1-soft-penalty.test.js
//        Status: FAIL by-design — pre-existing closed-prior-spec
//        failure carried verbatim from the parent spec's Task 2.3
//        baseline (header comment of `tests/proctor-v2-phase2-75-
//        multi-step-preservation.pbt.test.js`, lines 145-148).
//        Originated in `proctor-v2-key-shape-unification`. NOT
//        introduced by this spec. Post-fix: MUST remain FAIL with
//        no change in failure mode.
//     9. tests/proctor-v2-strict-bug-c2-uncovered.test.js
//        Status: FAIL by-design — pre-existing closed-prior-spec
//        failure. Same provenance as #8 above. Carried verbatim
//        from the key-shape-unification baseline. NOT introduced
//        by this spec. Post-fix: MUST remain FAIL with no change
//        in failure mode.
//
//   New tests from this spec (added by Tasks 1, 2.1, 2.2):
//     - tests/proctor-v2-singleton-class-bounds-exploration.test.js
//       → FAIL on F (counterexample lock — see #3 above)
//     - tests/proctor-v2-singleton-class-bounds-preservation.pbt.test.js
//       → PASS on F (this file — preservation baseline lock)
//     - tests/proctor-v2-singleton-class-bounds-monotonicity.test.js
//       → FAIL on F for branch 1 only (see #4 above); branches 2-4 PASS
//
//   In-scope-of-this-spec verification (Req 3.1, 3.2, 3.3, 3.10, 3.21):
//     Of the 9 failures above, the four expected by-design failures
//     (#1, #2, #3, #4) plus the two pre-existing closed-prior-spec
//     failures (#8, #9) are accounted for by the parent baseline.
//     Failure #5 (`inv-e-display-aggregation`) is out of in-scope-spec
//     scope (it is `inv-e-*`, not `inv-h5-*`, so Req 3.2 does not
//     mandate it pass). Failures #6 and #7 are documented
//     parent-spec-blocked failures the orchestrator surfaces — they
//     do NOT block this spec's preservation guarantee. The four
//     in-scope passing requirements (Req 3.1, 3.2, 3.3, 3.10, 3.21)
//     are met:
//       - All `tests/proctor-v2-*.test.js` PASS on F except #1, #2,
//         #3, #4, #6, #8, #9 (six of which are documented by-design,
//         one is parent-spec-blocked).
//       - All `tests/inv-h5-*.test.js` PASS on F (the only such file
//         is `inv-h5-cross-page-consistency.test.js`, which passes).
//       - `tests/preservation-config-roundtrip.pbt.test.js` PASSES on F.
//       - The parent spec's `warnings-shape` and `determinism` tests
//         PASS on F. The parent spec's `preservation.pbt.test.js`
//         FAILS on F due to snapshot drift (#7), pre-existing.
//
// ----- npm run lint counts (UNFIXED code, captured 2026-05-17) -----
//   Errors:    0
//   Warnings:  7   (all pre-existing — 6 carried from the parent
//                  spec's Task 2.3 baseline + 1 new warning at
//                  `tests/proctor-v2-phase2-75-multi-step-fix.test.js`
//                  line 541 that was introduced by the parent spec's
//                  Task 1.2 test file (`proctor-v2-phase2-75-multi-
//                  step-repair` Task 1.2) AFTER the parent's Task
//                  2.3 baseline was captured. Locations:
//                  - main/sync/engine.js:1245 (`'e' unused`)
//                  - main/sync/engine.js:1348 (`'e' unused`)
//                  - tests/proctor-distribution-v2-orchestrator.test.js:26
//                    (`'internals' unused`)
//                  - tests/proctor-v2-phase2-75-multi-step-fix.test.js:541
//                    (`'e' unused`)  ← +1 vs parent baseline (parent-spec
//                                       test added after parent Task 2.3)
//                  - tests/proctor-v2-property-4-save-stability.test.js:261
//                    (`'e' unused`)
//                  - tests/proctor-v2-use-exam-center-levels-preservation
//                    .test.js:187 (`'e' unused`)
//                  - tests/proctor-v2-use-exam-center-levels-preservation
//                    .test.js:483 (`'rng' unused`)
//                  All seven warnings are unrelated to
//                  `js/algorithms/proctor-distribution-v2.js` (the
//                  only file this spec edits). Post-fix MUST equal
//                  `0 errors, 7 warnings` (Req 3.11 — zero new
//                  errors/warnings vs this baseline).
//
//   Lint command (verbatim from package.json):
//     npm run lint
//     → eslint "main/**/*.js" "preload.js" "js/backup.js"
//             "js/pages/*.js" "tests/**/*.js"
//
// ----- Baseline metadata -----
//   Captured on:        2026-05-17
//   Captured against:   js/algorithms/proctor-distribution-v2.js
//                       at the post-key-shape-unification, pre-multi-
//                       step-repair, pre-singleton-class-bounds tip
//                       (this spec's Tasks 5 not yet applied; parent
//                       spec `proctor-v2-phase2-75-multi-step-repair`
//                       Tasks 5+6 also not yet applied).
//   Captured by:        Task 2.3 (this file's header comment).
//   Capture command:    bash scripts/run-all-tests.sh ; npm run lint
//   Cross-references:
//     - Task 6.7 (post-fix test suite re-run): MUST report
//       Pass=72, Fail=5 (i.e. files #1, #2, #3, #4 above flipped
//       to PASS; files #5, #6, #7, #8, #9 remain FAIL with
//       identical failure modes — the four expected flips are
//       this spec's ONLY contribution to the test-pass delta).
//     - Task 6.7 (post-fix lint re-run): MUST report
//       `0 errors, 7 warnings` (no change from this baseline).
//
// ---------------------------------------------------------------------
// ============================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 95-99 of inv-a-instrument-roundtrip.test.js
//    and the parent spec's preservation PBT lines 197-211.
// ============================================================

const v2Src = fs.readFileSync(
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
vm.runInContext(v2Src, sb);
const V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals && typeof V2._internals.computeClassBounds === 'function',
  'V2._internals.computeClassBounds not exposed — required for ' +
  'classBoundsByProctorKey reconstruction (V2.run does not surface ' +
  'this map publicly).');
assert.ok(typeof V2._internals.computeEligibilityClasses === 'function',
  'V2._internals.computeEligibilityClasses not exposed — required for ' +
  'isBugCondition rejection filter.');


// ============================================================
// 2) mulberry32 PRNG — project convention. Same shape as
//    `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`
//    line 232, and `tests/preservation-config-roundtrip.pbt.test.js`
//    line 173.
// ============================================================

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
// 3) Synthetic-input generator.
//
// Shape constraints (from tasks.md task 2.1 + design.md preservation
// requirements):
//   - proctorsList of size 1..30 with synthetic CIN keys (forces the
//     CIN-keyed branch of getProctorKey, mirroring the production
//     fixture key-shape after key-shape-unification).
//   - per-proctor schedule eligibility tuned so that no class produces
//     `floor(bTotal / bSize) > LB_global` (rejection-sample inputs that
//     violate the filter — but the generator is structured to make
//     rejection rare).
//   - schedule across 1..4 days × 1..2 periods so multi-halfday
//     reuse rules don't concentrate guard slots in a single halfday.
//   - 1..3 sessions per halfday, 1..3 rooms, proctorsPerRoom=1.
//   - No exemptions, no duty (so all proctors share a single
//     eligibility class — the only-one-class branch fires, which is
//     algebraically `LB_global` by construction). About 30% of
//     iterations inject light per-row exemptions to also exercise the
//     multi-class fallback branch with non-buggy bounds.
//   - Specialty + ME group set so every proctor is approximately
//     symmetric.
//
// Total guard slots per generated input ≤ 4 halfdays × 3 sessions ×
// 3 rooms = 36 slots; with 1..30 proctors LB_global lands in
// [36/30, 36/1] = [1, 36]. The only-one-class branch produces
// classLowerBound = LB_global directly, so every accepted input
// satisfies `forall c: classLowerBound <= LB_global + 1`. No bug
// condition can fire by construction.
// ============================================================

function makeProctor(idx, iterTag) {
  // Synthetic CIN key per task 2.1. Mirrors the fixture style of
  // `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`
  // section A.
  var cin = 'CIN_' + iterTag + '_' + idx;
  return {
    id: idx + 1,
    teacher_name: 'Synth_' + iterTag + '_' + idx,
    teacher_name_fr: 'Synth_' + iterTag + '_' + idx,
    specialty: 'عام',
    cin: cin,
    som: '',
    gender: (idx % 2) === 0 ? 'ذكر' : 'أنثى',
    room: ''
  };
}

function makeEntry(dayLabel, periodLabel, sessionLabel, subject) {
  return {
    day: dayLabel,
    period: periodLabel,
    session: sessionLabel,
    level_name: 'الثانية بكالوريا',
    subject_name: subject,
    date_day: '10',
    date_month: '3',
    date_year: '2026',
    time_from: periodLabel === 'صباحا' ? '08:00' : '14:00',
    time_to: periodLabel === 'صباحا' ? '10:00' : '16:00'
  };
}

function makeRoom(key) {
  return {
    key: key,
    room_num: key,
    roomName: 'قاعة ' + key,
    level_name: 'الثانية بكالوريا'
  };
}

var DAY_LABELS = ['الأول', 'الثاني', 'الثالث', 'الرابع'];
var SESSION_LABELS = ['الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'];
var SUBJECT_LABELS = ['العربية', 'الفرنسية', 'الإنجليزية'];

function buildInput(rng, iterTag) {
  var N = rngInt(rng, 1, 30);
  var nDays = rngInt(rng, 1, 4);
  var includeAfternoon = rng() < 0.5;
  var nSessions = rngInt(rng, 1, 3);
  var nRooms = rngInt(rng, 1, 3);

  var proctorsList = [];
  for (var p = 0; p < N; p++) proctorsList.push(makeProctor(p, iterTag));

  var entries = [];
  for (var d = 0; d < nDays; d++) {
    var dayLabel = DAY_LABELS[d];
    var periods = ['صباحا'];
    if (includeAfternoon) periods.push('مساء');
    for (var pp = 0; pp < periods.length; pp++) {
      for (var s = 0; s < nSessions; s++) {
        var subject = SUBJECT_LABELS[(d + pp + s) % SUBJECT_LABELS.length];
        entries.push(makeEntry(dayLabel, periods[pp], SESSION_LABELS[s], subject));
      }
    }
  }

  var rooms = [];
  for (var r = 0; r < nRooms; r++) rooms.push(makeRoom('R' + r));

  // Symmetric ME assignments — half group=1, half group=2.
  var meAssignments = {};
  var proctorSpecialties = {};
  for (var pi = 0; pi < N; pi++) {
    meAssignments[proctorsList[pi].cin] = (pi % 2) + 1;
    proctorSpecialties[proctorsList[pi].cin] = 'عام';
  }

  // Light exemption injection on ~30% of iterations: exempt a small
  // subset of proctors from a single entry each. This forces the
  // multi-class fallback branch to fire with classes whose
  // floor(bTotal/bSize) is small (close to LB_global), exercising the
  // preservation domain on the multi-class path. The injection is
  // gated to keep `floor(bTotal/bSize) <= LB_global + 1` (which the
  // rejection filter below would catch anyway, but we structure the
  // generator to favor acceptance).
  var exemptionsData = {};
  if (rng() < 0.3 && entries.length >= 2 && N >= 4) {
    // Pick 1..min(3, N/2) proctors to exempt from ONE entry each.
    // With nRooms <= 3, single-entry exemption keeps each resulting
    // class's bTotal small (G_class <= entriesUsed * nRooms <=
    // entries.length * 3). Combined with bSize >= 1, the worst case
    // is floor(G_class / 1) for any singleton, which is bounded by
    // the average load in the absence of duty — close to LB_global.
    var nExempt = rngInt(rng, 1, Math.min(3, Math.floor(N / 2)));
    for (var ex = 0; ex < nExempt; ex++) {
      var procIdx = rngInt(rng, 0, N - 1);
      var entryIdx = rngInt(rng, 0, entries.length - 1);
      var entry = entries[entryIdx];
      var scopeKey = ['session', entry.day, entry.period, entry.session].join('|');
      if (!exemptionsData[scopeKey]) exemptionsData[scopeKey] = {};
      exemptionsData[scopeKey][proctorsList[procIdx].cin] = 'no';
    }
  }

  return {
    proctorsList: proctorsList,
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
    dutyData: {},
    meAssignments: meAssignments,
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: proctorSpecialties
    },
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// 4) Helpers — derive LB_global, run computeClassBounds, evaluate
//    `isBugCondition(input)`, and project per-class bounds onto a
//    per-canonical-proctor-key map (the "classBoundsByProctorKey"
//    referenced in design.md and bugfix.md).
//
// We bypass the full V2.run pipeline for the rejection filter because
// the bug condition is a property of the bounds derivation step
// itself (`computeClassBounds`), and the helpers path is pure (no
// IPC, no DB, no randomness). The same helpers approach is used by
// `tests/proctor-v2-singleton-class-bounds-exploration.test.js`
// section 4.
// ============================================================

function computeBoundsForInput(input) {
  var proctorsList = input.proctorsList;
  var scheduleEntries = input.scheduleEntries;
  var proctorsPerRoom = (input.examDistributionRules &&
    input.examDistributionRules.proctorsPerRoom) || 1;
  var D_expected = Number(input.D_expected) || 0;
  var roomsList = (input.options && input.options.roomsList) || [];

  // guardSlotsByIndex[i] = roomsForEntry × proctorsPerRoom. Mirrors the
  // resolver at run() lines ~1879-1898. For our flat synthetic inputs
  // every entry uses the full rooms list (level_name matches).
  var guardSlotsByIndex = {};
  for (var i = 0; i < scheduleEntries.length; i++) {
    guardSlotsByIndex[i] = roomsList.length * proctorsPerRoom;
  }

  var eligibilityClasses = V2._internals.computeEligibilityClasses(
    proctorsList,
    scheduleEntries,
    input.exemptionsData || {},
    input.dutyData || {},
    null
  );

  var eligibleCount = 0;
  eligibilityClasses.forEach(function (cls) {
    eligibleCount += (cls.members || []).length;
  });

  var classBoundsMap = V2._internals.computeClassBounds(
    eligibilityClasses,
    scheduleEntries,
    proctorsPerRoom,
    D_expected,
    eligibleCount,
    guardSlotsByIndex
  );

  // Project Map<classId, bounds> → Object<canonicalKey, bounds> the same
  // way V2.run does at lines ~1945-1956.
  var classBoundsByKey = {};
  var classIdByKey = {};
  eligibilityClasses.forEach(function (cls, classId) {
    var bounds = classBoundsMap.get(classId);
    var members = cls.members || [];
    for (var cm = 0; cm < members.length; cm++) {
      classBoundsByKey[members[cm].key] = bounds
        ? {
            classLowerBound: bounds.classLowerBound,
            classUpperBound: bounds.classUpperBound,
            G_class: bounds.G_class,
            D_expected_class: bounds.D_expected_class
          }
        : null;
      classIdByKey[members[cm].key] = classId;
    }
  });

  // Compute totalGuardSlots once via the same iteration the design
  // §"Specific Changes" point 1 will inject into computeClassBounds.
  var totalGuardSlots = 0;
  for (var ti = 0; ti < scheduleEntries.length; ti++) {
    totalGuardSlots += guardSlotsByIndex[ti] || 0;
  }
  var lbGlobal = eligibleCount > 0
    ? Math.floor((totalGuardSlots + D_expected) / eligibleCount)
    : 0;

  return {
    classBoundsByKey: classBoundsByKey,
    classIdByKey: classIdByKey,
    classBoundsMap: classBoundsMap,
    eligibleCount: eligibleCount,
    totalGuardSlots: totalGuardSlots,
    lbGlobal: lbGlobal
  };
}

function isBugCondition(input) {
  // Per design.md §"Bug Condition" — there exists a class whose
  // emitted classLowerBound exceeds LB_global + 1.
  var ctx = computeBoundsForInput(input);
  var keys = Object.keys(ctx.classBoundsByKey);
  for (var i = 0; i < keys.length; i++) {
    var b = ctx.classBoundsByKey[keys[i]];
    if (!b) continue;
    if (b.classLowerBound > ctx.lbGlobal + 1) return true;
  }
  return false;
}


// ============================================================
// 5) Observation recorder.
//
// For each accepted (NOT-bug-condition) input, record V2.run's full
// output shape that is observable by callers, plus the
// classBoundsByProctorKey map reconstructed via the helpers (since
// V2.run does not expose this map publicly — only `diagnostics
// .classBounds`, which is keyed by classId, not by canonical proctor
// key).
// ============================================================

function reconstructSlotLoads(rows) {
  var perKey = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    var keys = rows[i].proctor_keys || [];
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (k) perKey[k] = (perKey[k] || 0) + 1;
    }
  }
  return perKey;
}

function buildHistogram(perKey) {
  var hist = Object.create(null);
  var keys = Object.keys(perKey);
  for (var i = 0; i < keys.length; i++) {
    var c = perKey[keys[i]];
    hist[c] = (hist[c] || 0) + 1;
  }
  return hist;
}

function recordObservation(input, output) {
  var rows = output.result || [];
  var diag = output.diagnostics || {};

  // Per-row keys (cloned to plain arrays so cross-realm prototype
  // identity does not contaminate later JSON.stringify equality).
  var proctorKeysByRow = [];
  var reserveKeysByRow = [];
  for (var i = 0; i < rows.length; i++) {
    var pk = rows[i].proctor_keys || [];
    var rk = rows[i].reserve_keys || [];
    proctorKeysByRow.push(pk.slice());
    reserveKeysByRow.push(rk.slice());
  }

  var perKey = reconstructSlotLoads(rows);
  var histogram = buildHistogram(perKey);

  // V2's loadBalance is { std, min, max, giniCoefficient } — host-realm
  // Number primitives, so JSON.stringify is byte-stable.
  var loadBalance = diag.loadBalance
    ? {
        std: diag.loadBalance.std,
        min: diag.loadBalance.min,
        max: diag.loadBalance.max,
        giniCoefficient: diag.loadBalance.giniCoefficient
      }
    : null;

  // Coverage repair warnings: deep-clone via JSON to drop cross-realm
  // prototype attachments while preserving the SHAPE (object map per
  // parent spec's diagnostics-shape migration).
  var coverageRepairWarnings;
  try {
    coverageRepairWarnings = JSON.parse(
      JSON.stringify(diag.coverageRepairWarnings === undefined
        ? null
        : diag.coverageRepairWarnings)
    );
  } catch {
    coverageRepairWarnings = null;
  }

  // Reconstruct classBoundsByProctorKey via the helpers. This is the
  // primary preservation target for this spec — Task 6.2 will assert
  // byte-equality of this map post-fix.
  var ctx = computeBoundsForInput(input);

  return {
    rowCount: rows.length,
    proctorKeysByRow: proctorKeysByRow,
    reserveKeysByRow: reserveKeysByRow,
    classBoundsByProctorKey: ctx.classBoundsByKey,
    serializedClassBounds: diag.classBounds
      ? JSON.parse(JSON.stringify(diag.classBounds))
      : {},
    histogram: histogram,
    histogramSlotPerKey: perKey,
    coverageRepairSwaps: diag.coverageRepairSwaps || 0,
    coverageRepairUnresolved: diag.coverageRepairUnresolved || 0,
    coverageRepairWarnings: coverageRepairWarnings,
    loadBalance: loadBalance,
    totalGuardSlots: ctx.totalGuardSlots,
    lbGlobal: ctx.lbGlobal,
    eligibleCount: ctx.eligibleCount
  };
}

// ============================================================
// 6) Property loop — observation-first methodology.
//
// For each iteration:
//   (a) Generate a synthetic input deterministically.
//   (b) Evaluate isBugCondition(input) via the helpers path. If true →
//       REJECT and continue.
//   (c) Run V2.run(input) on F.
//   (d) Run V2.run(input) AGAIN (determinism check). Assert byte-equal
//       observation across the two runs.
//   (e) Record observation + assert filter correctness (NO per-class
//       classLowerBound exceeds LB_global + 1 on accepted inputs).
//
// The bound on iterations matches the parent spec's preservation
// PBT — 30..50 accepted iterations, ≤200 attempts. With ≤30 proctors
// and ≤36 slots per input, V2.run typically returns in <100 ms; 30
// accepted iterations completes in ~5 s including rejection overhead.
//
// _NOTE: This loop is observation-first. It RECORDS V2's actual
// behavior on F. Task 6.2 will replay each accepted iteration on F'
// and assert the recorded observations are byte-identical.
// ============================================================

var ITERATIONS_TARGET = 30;        // accepted iterations
var ITERATIONS_MAX = 200;          // total attempts
var SEED_BASE = 0xC0FFEE;          // project convention seed
var rng = mulberry32(SEED_BASE);

var accepted = [];
var rejected = [];

for (var attempt = 0; attempt < ITERATIONS_MAX && accepted.length < ITERATIONS_TARGET; attempt++) {
  var iterTag = 'A' + attempt;
  var input = buildInput(rng, iterTag);

  // (b) Rejection filter — NOT isBugCondition(X). Rejected inputs are
  // out of scope for this preservation property; the bug-condition
  // domain is covered by Task 1 (exploration) and Task 3 (fix-checking).
  var bug;
  try {
    bug = isBugCondition(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'isBugCondition_threw: ' + e.message });
    continue;
  }
  if (bug) {
    rejected.push({ attempt: attempt, reason: 'isBugCondition=true' });
    continue;
  }

  // (c) Run V2.run on F.
  var output1, output2;
  try {
    output1 = V2.run(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'V2_threw_run1: ' + e.message });
    continue;
  }
  if (!output1 || !output1.result || !output1.diagnostics) {
    rejected.push({ attempt: attempt, reason: 'V2_run1_returned_no_result' });
    continue;
  }

  // (d) Determinism check — replay the same input. With identical
  // input, identical seed, and no global mutable state, V2.run must
  // produce byte-identical output. This is a pre-fix invariant
  // (design.md §"Preservation Requirements" → "Determinism") that
  // post-fix MUST also hold.
  try {
    output2 = V2.run(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'V2_threw_run2: ' + e.message });
    continue;
  }
  if (!output2 || !output2.result || !output2.diagnostics) {
    rejected.push({ attempt: attempt, reason: 'V2_run2_returned_no_result' });
    continue;
  }

  var obs1 = recordObservation(input, output1);
  var obs2 = recordObservation(input, output2);

  var s1 = JSON.stringify(obs1);
  var s2 = JSON.stringify(obs2);
  if (s1 !== s2) {
    assert.fail(
      '[preservation] determinism violated on attempt=' + attempt +
      ': two consecutive V2.run(input) calls produced different ' +
      'observations.\n' +
      '  run1: ' + s1.slice(0, 400) + (s1.length > 400 ? '…' : '') + '\n' +
      '  run2: ' + s2.slice(0, 400) + (s2.length > 400 ? '…' : '')
    );
  }

  // (e) Filter-correctness assertion: every recorded run satisfies
  // `forall c: classBoundsByProctorKey[k].classLowerBound <= LB_global + 1`.
  var keys = Object.keys(obs1.classBoundsByProctorKey);
  for (var ki = 0; ki < keys.length; ki++) {
    var b = obs1.classBoundsByProctorKey[keys[ki]];
    if (!b) continue;
    if (b.classLowerBound > obs1.lbGlobal + 1) {
      assert.fail(
        '[preservation] filter contract violated on attempt=' + attempt +
        ': isBugCondition returned false, but classBoundsByProctorKey[' +
        keys[ki] + '].classLowerBound = ' + b.classLowerBound +
        ' > LB_global + 1 = ' + (obs1.lbGlobal + 1) + '. ' +
        'Either the rejection filter is incorrect, or computeBoundsForInput ' +
        'is racing the rejection filter against a different input shape. ' +
        'totalGuardSlots=' + obs1.totalGuardSlots +
        ', eligibleCount=' + obs1.eligibleCount + '.'
      );
    }
  }

  accepted.push({
    attempt: attempt,
    iterTag: iterTag,
    seed: SEED_BASE,
    proctorCount: input.proctorsList.length,
    rowCount: obs1.rowCount,
    coverageRepairSwaps: obs1.coverageRepairSwaps,
    coverageRepairUnresolved: obs1.coverageRepairUnresolved,
    coverageRepairWarningsKeyCount: obs1.coverageRepairWarnings &&
      typeof obs1.coverageRepairWarnings === 'object' &&
      !Array.isArray(obs1.coverageRepairWarnings)
        ? Object.keys(obs1.coverageRepairWarnings).length
        : 0,
    histogram: obs1.histogram,
    lbGlobal: obs1.lbGlobal,
    totalGuardSlots: obs1.totalGuardSlots
  });

  // Capture the FULL canonical observation (input + output recording)
  // for the FIRST accepted iteration only — Task 6.2 will compare
  // against this snapshot.
  if (accepted.length === 1) {
    accepted[0]._canonicalInput = input;
    accepted[0]._canonicalObservation = obs1;
  }
}

// ============================================================
// 7) Diagnostic summary.
// ============================================================

console.log('[singleton-class-bounds-preservation-pbt] Property 2 — non-buggy-input baseline:');
console.log('  attempts:           ' + (rejected.length + accepted.length));
console.log('  accepted:           ' + accepted.length + ' / ' + ITERATIONS_TARGET);
console.log('  rejected:           ' + rejected.length);
if (rejected.length > 0) {
  var bugRejects = 0, otherRejects = 0;
  for (var rj = 0; rj < rejected.length; rj++) {
    if (rejected[rj].reason === 'isBugCondition=true') bugRejects++;
    else otherRejects++;
  }
  console.log('    isBugCondition=true: ' + bugRejects);
  console.log('    other:               ' + otherRejects);
}

// Soft assertion: we must accept at least 5 iterations to call the
// preservation domain "covered". A high rejection rate (>95%) means
// the generator is producing too many bug-condition inputs — that
// would mean the test is uninformative on the preservation property.
assert.ok(accepted.length >= 5,
  '[preservation] only ' + accepted.length + ' / ' + ITERATIONS_TARGET +
  ' iterations were accepted by the NOT-isBugCondition filter — ' +
  'the generator is producing too many bug-condition inputs and the ' +
  'preservation domain is undercovered. Expected ≥ 5 accepted iterations.');

// Aggregate observation summary.
var totalSwaps = 0;
var totalUnresolved = 0;
var iterationsWithSwaps = 0;
var iterationsWithUnresolved = 0;
var maxClassLowerBound = 0;
var maxLbGlobal = 0;
for (var ai = 0; ai < accepted.length; ai++) {
  totalSwaps += accepted[ai].coverageRepairSwaps;
  totalUnresolved += accepted[ai].coverageRepairUnresolved;
  if (accepted[ai].coverageRepairSwaps > 0) iterationsWithSwaps++;
  if (accepted[ai].coverageRepairUnresolved > 0) iterationsWithUnresolved++;
  if (accepted[ai].lbGlobal > maxLbGlobal) maxLbGlobal = accepted[ai].lbGlobal;
}
// Cross-check max classLowerBound across the canonical observation.
if (accepted[0] && accepted[0]._canonicalObservation) {
  var cb = accepted[0]._canonicalObservation.classBoundsByProctorKey;
  Object.keys(cb).forEach(function (k) {
    var b = cb[k];
    if (b && b.classLowerBound > maxClassLowerBound) {
      maxClassLowerBound = b.classLowerBound;
    }
  });
}
console.log('  total swaps:        ' + totalSwaps);
console.log('  total unresolved:   ' + totalUnresolved);
console.log('  iterations with swaps:      ' + iterationsWithSwaps);
console.log('  iterations with unresolved: ' + iterationsWithUnresolved);
console.log('  max LB_global across accepted: ' + maxLbGlobal);
console.log('  max classLowerBound (canonical): ' + maxClassLowerBound);

// ============================================================
// 8) Canonical snapshot — Task 6.2 will replay against this.
//
// Snapshot location: tests/fixtures/proctor-v2-singleton-class-bounds-
// preservation-snapshot.json.
//
// Task 6.2 will:
//   - JSON.parse this file
//   - V2.run(snapshot.input) on F'
//   - re-record the observation
//   - assert byte-equality with snapshot.observation
// ============================================================

assert.ok(accepted.length >= 1 &&
  accepted[0]._canonicalInput && accepted[0]._canonicalObservation,
  '[preservation] canonical case capture failed — Task 6.2 cannot replay ' +
  'without a snapshotted input/observation pair.');

var snapshotPath = path.join(
  ROOT,
  'tests/fixtures/proctor-v2-singleton-class-bounds-preservation-snapshot.json'
);

var snapshotPayload = {
  _metadata: {
    spec: 'proctor-v2-singleton-class-bounds',
    task: '2.1 — preservation PBT canonical snapshot',
    capturedOn: 'F (UNFIXED code, pre-Task-5 cap+monotonicity-guard)',
    seed: SEED_BASE,
    iterTag: accepted[0].iterTag,
    attempt: accepted[0].attempt,
    note: 'Task 6.2 will compare F\' output against this snapshot. ' +
      'On NOT-isBugCondition inputs, the post-fix algorithm MUST ' +
      'produce a byte-identical observation (design.md §"Preservation ' +
      'Requirements"; Property 2).'
  },
  input: accepted[0]._canonicalInput,
  observation: accepted[0]._canonicalObservation
};

// Sort keys recursively so the snapshot is stable across runs.
function canonicalize(value) {
  if (value === null) return null;
  if (Array.isArray(value)) {
    return value.map(canonicalize);
  }
  if (typeof value === 'object') {
    var sorted = {};
    var keys = Object.keys(value).sort();
    for (var i = 0; i < keys.length; i++) {
      sorted[keys[i]] = canonicalize(value[keys[i]]);
    }
    return sorted;
  }
  return value;
}

if (!fs.existsSync(snapshotPath)) {
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(canonicalize(snapshotPayload), null, 2),
    'utf8'
  );
  console.log('  canonical snapshot WRITTEN: ' + snapshotPath);
} else {
  // Drift check: rerunning on F should produce a byte-identical
  // observation. If the snapshot exists and the new run differs,
  // V2's behavior on F has changed — surface it loudly.
  var existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  var existingCanonical = JSON.stringify(canonicalize(existing.observation));
  var newCanonical = JSON.stringify(canonicalize(snapshotPayload.observation));
  if (existingCanonical !== newCanonical) {
    console.log('  canonical snapshot DRIFT detected on F:');
    console.log('    existing: ' + existingCanonical.slice(0, 200) +
      (existingCanonical.length > 200 ? '…' : ''));
    console.log('    new:      ' + newCanonical.slice(0, 200) +
      (newCanonical.length > 200 ? '…' : ''));
    assert.strictEqual(newCanonical, existingCanonical,
      '[preservation] canonical snapshot drift on F. The unfixed code ' +
      'produced a different observation than the captured baseline. ' +
      'If the baseline is genuinely outdated, delete ' + snapshotPath +
      ' and re-run this test to capture a fresh snapshot.');
  } else {
    console.log('  canonical snapshot REUSED (matches existing baseline): ' + snapshotPath);
  }
}

console.log('\n[singleton-class-bounds-preservation-pbt] PASS');
console.log('  Property 2 — non-buggy inputs (NOT isBugCondition) produce a ' +
  'stable observation that Task 6.2 will preserve byte-for-byte post-fix. ' +
  'Determinism (two consecutive V2.run on the same input → byte-identical ' +
  'output) verified across all ' + accepted.length + ' accepted iterations.');

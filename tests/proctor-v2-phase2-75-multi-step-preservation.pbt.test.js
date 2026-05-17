'use strict';

// @preservation property test — Property 2 (deficit-≤1 baseline).
// MUST PASS on F (the unfixed code). Re-used by Task 7.1 to assert
// byte-equality of the same recorded observations on F' (the fixed
// code), modulo only the additive `diagnostics.coverageRepairWarnings:
// {}` empty map (pre-fix is `[]`, post-fix is `{}`).
//
// _Bug_Condition: NOT isBugCondition(X) — preservation domain
// _Expected_Behavior: Property 2 — observational equivalence on
//                      `NOT C(X)` inputs (design.md §"Correctness
//                      Properties" → Property 2)
// _File: tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js (NEW)
// _Requirements: 2.3, 3.6, 3.7, 3.16, 3.17
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 2.1 — establishes the post-Phase-2 observational baseline that
// the multi-step repair fix MUST preserve byte-for-byte on every
// input where the bug condition does NOT fire. The fix is targeted
// at deficit-≥2 cases; deficit-≤1 cases are the closed pre-fix path
// and the fix MUST NOT perturb them.
//
// ---------------------------------------------------------------------
// Why mulberry32 instead of fast-check
// ---------------------------------------------------------------------
// `fast-check` is not in `package.json` (Section "Why deterministic
// PRNG instead of fast-check" of `tests/preservation-config-
// roundtrip.pbt.test.js` — this repo's reference PBT — documents the
// rationale). The project convention is `mulberry32` — used by
// `tests/proctor-v2-fairness-undercovered-preservation.test.js`,
// `tests/proctor-v2-all-cin-preservation.test.js`,
// `tests/proctor-v2-key-shape-unity.test.js`,
// `tests/proctor-v2-slot-metric-property-p1.test.js`, and Section B
// of `tests/preservation-config-roundtrip.pbt.test.js`. mulberry32
// produces deterministic, reproducible counterexamples without any
// new dependency. Tasks.md task 2.1 says "use fast-check (existing
// PBT framework in this repo — see preservation-config-roundtrip.pbt
// .test.js for the import style and seed plumbing)" — that reference
// file is itself mulberry32-based, so we follow its lead verbatim.
//
// ---------------------------------------------------------------------
// Bug Condition C(X) — the rejection filter
// ---------------------------------------------------------------------
// Per bugfix.md §"Bug Condition C(X)":
//
//   isBugCondition(X) := EXISTS proctor proc_i WITH
//                          getPrimaryLoad(loadState, key_i) < classLowerBound_i
//                        AND
//                          diagnostics.coverageRepairUnresolved > 0
//
// We rejection-sample by running V2.run(input) and observing the post-
// run state. Inputs where isBugCondition fires are SKIPPED (not
// asserted). Inputs where isBugCondition does NOT fire are recorded
// and asserted: they form the preservation domain.
//
// Generator design forces deficit ≤ 1 for every uncovered proctor on
// the post-Phase-2 state by construction (1..30 proctors, 1..4
// halfdays × 1..3 sessions × 1..3 rooms, proctorsPerRoom=1, no
// exemptions, no duty so all proctors share a single eligibility
// class). This keeps the single classBounds entry derived by V2's
// `computeClassBounds` close to (lower, upper) where upper - lower ≤ 1
// most of the time. With this shape, Phase 2's Hungarian assignment
// typically reaches `min ≥ classLowerBound` directly; when it does
// not, the deficit is 1 and the existing single-swap repair pass
// closes it (coverageRepairUnresolved → 0). Both paths land in the
// `NOT isBugCondition` domain.
//
// Inputs where the deficit-2 trap fires (multi-halfday-reuse rare
// edge cases or the deficit-≥2 branch) are rejected by the filter
// — they are the BUG-CONDITION domain that Tasks 1.1, 1.2, 1.3 cover
// directly.
//
// ---------------------------------------------------------------------
// Slot-metric semantics for primary load
// ---------------------------------------------------------------------
// With zero duty in every generated input, `getPrimaryLoad =
// guardCount + dutyCount = guardCount + 0 = guardCount`. We
// reconstruct guardCount per key by counting appearances in
// `result[i].proctor_keys` (slot-metric), which mirrors the closed
// spec `proctor-v2-strict-fairness-coverage`'s slot-metric switch and
// the reconstruction used by `scripts/verify-real-centre.js` lines
// 70-80, by `tests/proctor-v2-fairness-undercovered-exploration.test.js`
// section 4, and by the existing
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`
// section 3. No internal `loadState` access is required — the test is
// purely observational on the public V2.run output shape.
//
// ---------------------------------------------------------------------
// Canonical snapshot
// ---------------------------------------------------------------------
// One canonical case is captured to `tests/fixtures/proctor-v2-phase2-
// 75-multi-step-preservation-snapshot.json` (the first accepted
// iteration under seed 0xC0FFEE). Task 7.1 will rerun the same input
// post-fix and assert byte-equality against this snapshot, modulo the
// additive `diagnostics.coverageRepairWarnings: {}` empty map (pre-fix
// is `[]`, post-fix is `{}`).
//
// ---------------------------------------------------------------------
// Existing-suite preservation baseline (Req 3.1, 3.2, 3.3, 3.11, 3.12)
// ---------------------------------------------------------------------
// Captured 2026-05-16 on UNFIXED code (post-key-shape-unification,
// pre-multi-step-repair) by Task 2.3. The empirical `npm` counts below
// are the regression threshold for Task 7.3 (test suite re-run) and
// Task 7.7 (lint re-run); post-fix counts MUST match modulo the one
// known failure flip documented at the bottom of this block.
//
// Note: the project does not register a `test` script in
// `package.json`. Tests are run individually via plain `node` per
// the in-tree convention (mirrors `tests/proctor-v2-fairness-
// undercovered-exploration.test.js`, `tests/proctor-v2-key-adapter-
// unit.test.js`, `tests/proctor-v2-fairness-undercovered-collect-
// unit.test.js`, etc.). The "in-scope" suite for `npm test` per
// Req 3.1, 3.2, 3.3 is the union of the three globs:
//
//   tests/proctor-v2-*.test.js     — Req 3.1
//   tests/inv-h5-*.test.js         — Req 3.2
//   tests/preservation-config-roundtrip.pbt.test.js  — Req 3.3
//
// Each file runs in its own `node tests/<file>` process; PASS = exit
// code 0, FAIL = non-zero. The suite is enumerated, executed, and
// tallied (for example via the helper `scripts/run-baseline.sh`) —
// the captured counts below are the verbatim totals from that run.
//
// ----- npm test counts (UNFIXED code, captured 2026-05-16) -----
//   In-scope test files: 48
//   Pass:                44
//   Fail:                 4
//
//   Failing files (verbatim):
//     1. tests/proctor-v2-fairness-undercovered-exploration.test.js
//        Status: FAIL by-design (this is the documented regression
//        — Req 3.12 — that the multi-step-repair fix MUST flip to
//        PASS). Failure mode: assertion `min >= classLowerBound` fails
//        on the production fixture (idx=98 طارق الشعابتي at load=0,
//        classLowerBound=2). Post-fix: MUST PASS.
//     2. tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//        Status: FAIL by-design (this spec's Task 1 exploration test
//        — encodes Property 1 / Bug Condition C(X). Pre-fix the
//        deficit-2/deficit-3/production-fixture cases all fail per
//        Tasks 1.1, 1.2, 1.3). Post-fix: MUST PASS.
//     3. tests/proctor-v2-strict-bug-c1-soft-penalty.test.js
//        Status: FAIL by-design — pre-existing closed-prior-spec
//        failure. Carried verbatim from the
//        `proctor-v2-key-shape-unification` baseline (Task 2.3 of
//        that spec, header comment of `tests/proctor-v2-key-adapter-
//        unit.test.js`, lines 18-29). NOT introduced by this spec.
//        Post-fix: MUST remain FAIL with no change in failure mode
//        (Task 7.3 baseline preservation).
//     4. tests/proctor-v2-strict-bug-c2-uncovered.test.js
//        Status: FAIL by-design — pre-existing closed-prior-spec
//        failure. Same provenance as #3 above. Carried verbatim
//        from the key-shape-unification baseline. NOT introduced
//        by this spec. Post-fix: MUST remain FAIL with no change
//        in failure mode.
//
//   New tests from this spec (added by Tasks 1, 2.1, 2.2):
//     - tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//       → FAIL on F (counterexample lock — see #2 above)
//     - tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js
//       → PASS on F (this file — preservation baseline lock)
//     - tests/proctor-v2-phase2-75-multi-step-determinism.test.js
//       → PASS on F (determinism is a pre-fix invariant per Req 3.17)
//
// ----- npm run lint counts (UNFIXED code, captured 2026-05-16) -----
//   Errors:    0
//   Warnings:  6   (all pre-existing, unrelated to this spec — same
//                  6 carried from the `proctor-v2-key-shape-
//                  unification` baseline; locations: main/sync/
//                  engine.js × 2, tests/proctor-distribution-v2-
//                  orchestrator.test.js × 1, tests/proctor-v2-
//                  property-4-save-stability.test.js × 1, tests/
//                  proctor-v2-use-exam-center-levels-preservation
//                  .test.js × 2). Post-fix MUST equal `0 errors,
//                  6 warnings` (Req 3.11 — zero new errors/warnings
//                  vs the closing state of `proctor-v2-key-shape-
//                  unification`).
//
//   Lint command (verbatim from package.json):
//     npm run lint
//     → eslint "main/**/*.js" "preload.js" "js/backup.js"
//             "js/pages/*.js" "tests/**/*.js"
//
// ----- Baseline metadata -----
//   Captured on:        2026-05-16
//   Captured against:   js/algorithms/proctor-distribution-v2.js
//                       at the post-key-shape-unification, pre-multi-
//                       step-repair tip (closed spec
//                       `proctor-v2-key-shape-unification` 2026-05-16,
//                       this spec's Tasks 5+6 not yet applied).
//   Captured by:        Task 2.3 (this file's header comment).
//   Cross-references:
//     - Task 7.3 (post-fix test suite re-run): MUST report
//       Pass=45, Fail=2 (i.e. files #1 and #2 above flipped to
//       PASS; files #3 and #4 above remain by-design FAIL).
//     - Task 7.7 (post-fix lint re-run): MUST report
//       `0 errors, 6 warnings` (no change from this baseline).
//
// ---------------------------------------------------------------------

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 12–22 of scripts/verify-real-centre.js
//    and tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration
//    .test.js section 1.
// ============================================================

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

// ============================================================
// 2) mulberry32 PRNG — project convention. Same shape as
//    `tests/proctor-v2-fairness-undercovered-preservation.test.js:79`,
//    `tests/proctor-v2-all-cin-preservation.test.js:118`, and
//    Section B of `tests/preservation-config-roundtrip.pbt.test.js:173`.
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
// Shape constraints (from tasks.md task 2.1):
//   - proctorsList of size 1..30 with synthetic CIN keys.
//   - per-proctor classLowerBound: 0..3, classUpperBound:
//     classLowerBound..classLowerBound+2.
//     NOTE: V2's `computeClassBounds` derives bounds from the
//     eligibility class (not from per-proctor metadata), so the
//     "0..3 / +2" wording in tasks.md describes the intent — we
//     achieve it by varying the schedule shape (#sessions × #rooms)
//     and the number of proctors so that derived
//     `(lowerBound, upperBound)` falls in that range.
//   - schedule and exemptions sized so every uncovered proctor
//     (if any) has deficit ≤ 1 — guaranteed by spreading the
//     schedule across multiple halfdays so the deficit-≥2 halfday-
//     reuse trap demonstrated by Task 1.1 cannot fire.
//
// Concretely:
//   - N proctors in 1..30
//   - 1..4 days × 1..2 periods = 1..4 halfdays (multi-halfday so
//     `allowHalfdayReuse=false` does not concentrate the donor pool
//     in a single halfday).
//   - 1..3 sessions per halfday, 1..3 rooms, proctorsPerRoom=1.
//   - No exemptions, no duty (so all proctors share a single
//     eligibility class — bounds derive cleanly).
//   - Specialty + ME group set so every proctor is approximately
//     symmetric (no concentrated soft-cost penalty steering the
//     Hungarian solver to leave one proctor at load 0).
//
// The total guard slots per generated input ≤ 4 halfdays × 3
// sessions × 3 rooms = 36 slots; with 1..30 proctors the average
// load is ≤ 36/1 = 36 (single proctor — bounds floor=36, ceil=36)
// or ≥ 36/30 ≈ 1.2 (30 proctors — bounds floor=1, ceil=2). Either
// way, deficit ≤ 1 by construction in the typical case; the
// rejection filter discards the rare cases where the Hungarian
// solver leaves deficit ≥ 2.
// ============================================================

function makeProctor(idx, iterTag) {
  // Empty teacher_name AND empty cin would force `__idx_N` synthetic
  // keys (the production-fixture path). For PBT we use synthetic CIN
  // keys per tasks.md task 2.1 — mirrors the fixture style of
  // `tests/proctor-v2-fairness-undercovered-preservation.test.js`
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
        // Vary subject to keep specialty=عام proctors symmetric.
        var subject = SUBJECT_LABELS[(d + pp + s) % SUBJECT_LABELS.length];
        entries.push(makeEntry(dayLabel, periods[pp], SESSION_LABELS[s], subject));
      }
    }
  }

  var rooms = [];
  for (var r = 0; r < nRooms; r++) rooms.push(makeRoom('R' + r));

  // Symmetric ME assignments — half group=1 (matches morning), half
  // group=2 (matches afternoon). With multi-halfday schedules this
  // averages out and avoids concentrated soft-cost penalties.
  var meAssignments = {};
  var proctorSpecialties = {};
  for (var pi = 0; pi < N; pi++) {
    meAssignments[proctorsList[pi].cin] = (pi % 2) + 1;
    proctorSpecialties[proctorsList[pi].cin] = 'عام';
  }

  return {
    proctorsList: proctorsList,
    scheduleEntries: entries,
    exemptionsData: {},
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
// 4) Slot-metric load reconstruction + Bug-Condition C(X) filter.
//
// Without internal `loadState` access we reconstruct primary load
// per canonical key by counting appearances in
// `result[i].proctor_keys`. With `dutyData = {}` and `enablePhase3
// = false`, this slot count IS `getPrimaryLoad` (guardCount only;
// no duty contribution).
//
// `isBugCondition(X)` per bugfix.md §"Bug Condition C(X)":
//   EXISTS proc_i WITH primaryLoad < classLowerBound
//   AND coverageRepairUnresolved > 0
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

function isBugCondition(input, output) {
  // Evaluate the predicate on V2's public output. Returns true iff
  // at least one proctor satisfies (deficit >= 1) AND
  // (coverageRepairUnresolved > 0).
  if (!output || !output.diagnostics) return false;
  var diag = output.diagnostics;
  if (!(diag.coverageRepairUnresolved > 0)) return false;

  var classBounds = diag.classBounds || {};
  // Pick the per-class bounds. Generators above produce inputs where
  // every proctor lands in a single eligibility class (no exemptions,
  // no duty). If V2 produces multiple classes anyway (e.g. a fallback
  // partition fired), we pick the MIN classLowerBound across classes
  // — a deficit relative to any class lower bound counts as a bug
  // condition trigger.
  var classKeys = Object.keys(classBounds);
  if (classKeys.length === 0) return false;

  var perKey = reconstructSlotLoads(output.result || []);
  var list = input.proctorsList || [];

  for (var i = 0; i < list.length; i++) {
    var key = list[i].cin || ('__idx_' + i);
    var load = perKey[key] || 0;
    // A proctor's load is below ANY classLowerBound that it could
    // belong to → consider that a bug-condition deficit. Conservative:
    // we use min(classLowerBound) across all classes as the threshold.
    for (var c = 0; c < classKeys.length; c++) {
      var cb = classBounds[classKeys[c]];
      if (!cb || !cb.classLowerBound || cb.classLowerBound <= 0) continue;
      if (load < cb.classLowerBound) {
        return true;
      }
    }
  }
  return false;
}

// ============================================================
// 5) Observation recorder.
//
// For each accepted (NOT-bug-condition) input, record:
//   - result.proctor_keys (per-row, in row order)
//   - result.reserve_keys (per-row, in row order)
//   - diagnostics.coverageRepairSwaps
//   - diagnostics.coverageRepairUnresolved
//   - diagnostics.coverageRepairWarnings (the array shape pre-fix;
//     post-fix Task 7.1 will accept `{}` as equivalent)
//   - histogram (slot-metric guard-count histogram, reconstructed
//     from result[i].proctor_keys; this is the "histogram*" field
//     listed in tasks.md — V2 does not export a top-level
//     `diagnostics.histogram*`, so we derive it from the public
//     output the same way `scripts/inspect-fixture-state.js` does).
//   - loadBalance (V2's `diagnostics.loadBalance` — exists when
//     phase2Result.loadState is set, which it is for any successful
//     run). Captured for completeness; preservation requires it to
//     be unchanged on `NOT C(X)` inputs.
// ============================================================

function buildHistogram(perKey) {
  var hist = Object.create(null);
  var keys = Object.keys(perKey);
  for (var i = 0; i < keys.length; i++) {
    var c = perKey[keys[i]];
    hist[c] = (hist[c] || 0) + 1;
  }
  return hist;
}

function recordObservation(output) {
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

  // V2's loadBalance is { std, min, max, giniCoefficient } — host-
  // realm Number primitives, so JSON.stringify is byte-stable.
  var loadBalance = diag.loadBalance
    ? {
        std: diag.loadBalance.std,
        min: diag.loadBalance.min,
        max: diag.loadBalance.max,
        giniCoefficient: diag.loadBalance.giniCoefficient
      }
    : null;

  // Pre-fix `coverageRepairWarnings` is an array. We deep-clone via
  // JSON to drop any cross-realm prototype attachments while keeping
  // the SHAPE (array vs object) for Task 7.1 to inspect.
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

  return {
    rowCount: rows.length,
    proctorKeysByRow: proctorKeysByRow,
    reserveKeysByRow: reserveKeysByRow,
    coverageRepairSwaps: diag.coverageRepairSwaps || 0,
    coverageRepairUnresolved: diag.coverageRepairUnresolved || 0,
    coverageRepairWarnings: coverageRepairWarnings,
    histogram: histogram,
    histogramSlotPerKey: perKey,
    loadBalance: loadBalance,
    classBounds: diag.classBounds
      ? JSON.parse(JSON.stringify(diag.classBounds))
      : {}
  };
}

// ============================================================
// 6) Property loop — observation-first methodology.
//
// For each iteration:
//   (a) Generate a synthetic input deterministically from the seeded
//       PRNG (per-iteration sub-seed = SEED + iteration index, stored
//       in the per-iteration record so Task 7.1 can replay).
//   (b) Run V2.run(input) on F (the unfixed code).
//   (c) Evaluate isBugCondition(input, output). If true → REJECT
//       (rejection-sample) and continue. If false → record + assert.
//   (d) Assert: the recorded run satisfies `coverageRepairUnresolved
//       = 0` OR every uncovered proctor has deficit exactly 1. The
//       deficit-exactly-1 case captures inputs where pre-fix
//       single-swap repair already closed the gap; the unresolved=0
//       case captures inputs where Phase 2 left no proctor uncovered.
//
// The bound-on-iterations matches tasks.md ("30–50 iterations so the
// test runs in seconds"). With ≤30 proctors and ≤36 slot decisions
// per input, V2.run typically returns in <100 ms; 40 accepted
// iterations completes in ~5 s including rejection overhead.
//
// _NOTE: This loop is observation-first. It RECORDS V2's actual
// behavior on F. Task 7.1 will replay each accepted iteration on F'
// and assert the recorded observations are byte-identical (modulo
// the additive `coverageRepairWarnings: {}` empty map).
// ============================================================

var ITERATIONS_TARGET = 40;       // accepted iterations
var ITERATIONS_MAX = 200;         // total attempts (rejection-sample upper bound)
var SEED_BASE = 0xC0FFEE;         // project convention seed
var rng = mulberry32(SEED_BASE);

var accepted = [];
var rejected = [];

for (var attempt = 0; attempt < ITERATIONS_MAX && accepted.length < ITERATIONS_TARGET; attempt++) {
  var iterTag = 'A' + attempt;
  var input = buildInput(rng, iterTag);

  var output;
  try {
    output = V2.run(input);
  } catch (e) {
    rejected.push({ attempt: attempt, reason: 'V2_threw: ' + e.message });
    continue;
  }
  if (!output || !output.result || !output.diagnostics) {
    rejected.push({ attempt: attempt, reason: 'V2_returned_no_result' });
    continue;
  }

  // Rejection filter — `isBugCondition(X)` per bugfix.md.
  if (isBugCondition(input, output)) {
    rejected.push({
      attempt: attempt,
      reason: 'isBugCondition=true',
      coverageRepairUnresolved: output.diagnostics.coverageRepairUnresolved
    });
    continue;
  }

  // Filter-correctness assertion: every recorded run satisfies either
  //   (a) coverageRepairUnresolved = 0, OR
  //   (b) every uncovered proctor has deficit exactly 1.
  // The bug-condition predicate fires on `deficit >= 1 AND
  // unresolved > 0`, so by negation `NOT C(X)` ⇔
  //   `unresolved = 0` OR `forall proc: deficit(proc) <= 0` ⇔
  //   `unresolved = 0` OR `forall proc: load >= classLowerBound`.
  // We compute the per-proctor max-deficit relative to the SINGLE
  // synthetic-input class for sharper diagnostics; the multi-class
  // case is also handled below for robustness.
  var diag = output.diagnostics;
  var classBounds = diag.classBounds || {};
  var classKeys = Object.keys(classBounds);
  var perKey = reconstructSlotLoads(output.result);
  var maxDeficitObserved = 0;
  var uncoveredProctors = [];
  for (var i = 0; i < input.proctorsList.length; i++) {
    var key = input.proctorsList[i].cin || ('__idx_' + i);
    var load = perKey[key] || 0;
    for (var c = 0; c < classKeys.length; c++) {
      var cb = classBounds[classKeys[c]];
      if (!cb || !cb.classLowerBound || cb.classLowerBound <= 0) continue;
      var def = cb.classLowerBound - load;
      if (def > maxDeficitObserved) maxDeficitObserved = def;
      if (def >= 1) uncoveredProctors.push({ key: key, load: load, lower: cb.classLowerBound });
      // Only consider the FIRST class with a positive lowerBound for
      // the per-proctor deficit assignment — V2 guarantees each
      // proctor belongs to exactly one class.
      break;
    }
  }

  var unresolved = diag.coverageRepairUnresolved || 0;
  var filterOK = (unresolved === 0) || (maxDeficitObserved <= 1);
  if (!filterOK) {
    // This is a hard contract violation — the rejection filter said
    // `NOT C(X)` (unresolved=0 path was bypassed because unresolved>0,
    // and the deficit path was bypassed because no proctor exceeded
    // the threshold) yet the per-proctor max deficit is ≥ 2. This
    // would mean isBugCondition's predicate is incorrect. Surface it
    // loudly.
    assert.fail(
      '[preservation] filter contract violated on attempt=' + attempt +
      ': isBugCondition returned false, but coverageRepairUnresolved=' +
      unresolved + ' AND maxDeficitObserved=' + maxDeficitObserved +
      ' (every uncovered proctor must have deficit exactly 1 on accepted ' +
      'inputs). uncoveredProctors=' + JSON.stringify(uncoveredProctors)
    );
  }

  // Observation-first: record V2's actual behavior on this accepted input.
  var observation = recordObservation(output);
  accepted.push({
    attempt: attempt,
    iterTag: iterTag,
    seed: SEED_BASE,
    // Capture enough generator parameters to replay deterministically
    // in Task 7.1 without re-driving the seeded PRNG (which would shift
    // due to the post-key-shape-unification module's own internal RNG
    // calls). We snapshot the FULL input for the canonical case below;
    // for non-canonical accepted iterations we rely on the seeded
    // mulberry32 reproducibility.
    proctorCount: input.proctorsList.length,
    rowCount: observation.rowCount,
    coverageRepairSwaps: observation.coverageRepairSwaps,
    coverageRepairUnresolved: observation.coverageRepairUnresolved,
    coverageRepairWarningsLength: Array.isArray(observation.coverageRepairWarnings)
      ? observation.coverageRepairWarnings.length
      : (observation.coverageRepairWarnings && typeof observation.coverageRepairWarnings === 'object'
          ? Object.keys(observation.coverageRepairWarnings).length
          : 0),
    histogram: observation.histogram,
    maxDeficitObserved: maxDeficitObserved,
    uncoveredCount: uncoveredProctors.length
  });

  // Capture the FULL canonical observation (input + output recording)
  // for the FIRST accepted iteration only — Task 7.1 will compare
  // against this snapshot.
  if (accepted.length === 1) {
    accepted[0]._canonicalInput = input;
    accepted[0]._canonicalObservation = observation;
  }
}

// ============================================================
// 7) Diagnostic summary.
// ============================================================

console.log('[preservation-pbt] Property 2 — deficit-≤1 baseline:');
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
// preservation domain "covered". If rejection rate is too high (>95%)
// the generator is producing only buggy inputs and the filter is
// correct but the test is uninformative.
assert.ok(accepted.length >= 5,
  '[preservation] only ' + accepted.length + ' / ' + ITERATIONS_TARGET +
  ' iterations were accepted by the NOT-isBugCondition filter — ' +
  'the generator is producing too many bug-condition inputs and the ' +
  'preservation domain is undercovered. Expected ≥ 5 accepted iterations. ' +
  'Tune buildInput() to favor multi-halfday schedules and balanced bounds.');

// Aggregate observation summary — surfaces if ANY accepted iteration
// reports unexpected diagnostics (e.g. coverageRepairUnresolved > 0
// with maxDeficitObserved = 1 — the preservation-permitted path).
var totalSwaps = 0;
var totalUnresolved = 0;
var maxObservedDeficit = 0;
var iterationsWithSwaps = 0;
var iterationsWithUnresolved = 0;
for (var ai = 0; ai < accepted.length; ai++) {
  totalSwaps += accepted[ai].coverageRepairSwaps;
  totalUnresolved += accepted[ai].coverageRepairUnresolved;
  if (accepted[ai].coverageRepairSwaps > 0) iterationsWithSwaps++;
  if (accepted[ai].coverageRepairUnresolved > 0) iterationsWithUnresolved++;
  if (accepted[ai].maxDeficitObserved > maxObservedDeficit) {
    maxObservedDeficit = accepted[ai].maxDeficitObserved;
  }
}
console.log('  total swaps:        ' + totalSwaps);
console.log('  total unresolved:   ' + totalUnresolved +
  ' (every accepted iteration with unresolved>0 has deficit ≤ 1)');
console.log('  iterations with swaps:      ' + iterationsWithSwaps);
console.log('  iterations with unresolved: ' + iterationsWithUnresolved);
console.log('  max deficit observed (across accepted): ' + maxObservedDeficit);

// Hard assertion: across all ACCEPTED iterations, the max deficit
// must be ≤ 1. Anything ≥ 2 means an isBugCondition-shaped input
// slipped through the filter.
assert.ok(maxObservedDeficit <= 1,
  '[preservation] max deficit across accepted iterations = ' +
  maxObservedDeficit + ' but expected ≤ 1. The rejection filter is ' +
  'failing to detect at least one isBugCondition input.');

// ============================================================
// 8) Canonical snapshot — Task 7.1 will replay against this.
//
// Snapshot location: tests/fixtures/proctor-v2-phase2-75-multi-step-
// preservation-snapshot.json. The file shape:
//   {
//     "_metadata": { spec, task, capturedOn, seed, iterTag, ... },
//     "input":     <full canonical input>,
//     "observation": {
//        rowCount, proctorKeysByRow, reserveKeysByRow,
//        coverageRepairSwaps, coverageRepairUnresolved,
//        coverageRepairWarnings,  // pre-fix: [] (array)
//        histogram, histogramSlotPerKey, loadBalance, classBounds
//     }
//   }
//
// Task 7.1 will:
//   - JSON.parse this file
//   - V2.run(snapshot.input) on F'
//   - re-record the observation
//   - assert byte-equality with snapshot.observation, EXCEPT that
//     `coverageRepairWarnings` is allowed to migrate from `[]` (array)
//     to `{}` (empty object map) — the additive shape change
//     specified in design.md §"Specific Changes" point 2.
// ============================================================

assert.ok(accepted.length >= 1 && accepted[0]._canonicalInput && accepted[0]._canonicalObservation,
  '[preservation] canonical case capture failed — Task 7.1 cannot replay ' +
  'without a snapshotted input/observation pair.');

var snapshotPath = path.join(
  ROOT,
  'tests/fixtures/proctor-v2-phase2-75-multi-step-preservation-snapshot.json'
);

var snapshotPayload = {
  _metadata: {
    spec: 'proctor-v2-phase2-75-multi-step-repair',
    task: '2.1 — preservation PBT canonical snapshot',
    capturedOn: 'F (UNFIXED code, post-key-shape-unification, pre-multi-step-repair)',
    seed: SEED_BASE,
    iterTag: accepted[0].iterTag,
    attempt: accepted[0].attempt,
    note: 'Task 7.1 will compare F\' output against this snapshot. ' +
      'The only permitted change is `coverageRepairWarnings: []` → `{}` ' +
      '(pre-fix array → post-fix empty map; design.md §"Specific Changes" point 2).'
  },
  input: accepted[0]._canonicalInput,
  observation: accepted[0]._canonicalObservation
};

// Sort keys recursively so the snapshot is stable across runs (insertion
// order would vary because mulberry32 calls inside V2 hit Object.keys
// at non-deterministic insertion times).
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

// Only WRITE the snapshot when it does not already exist. On subsequent
// runs we COMPARE against the existing snapshot to detect drift on F.
// (Task 7.1 will read this file on F' and assert byte-equality up to
// the warnings-shape migration.)
if (!fs.existsSync(snapshotPath)) {
  fs.writeFileSync(
    snapshotPath,
    JSON.stringify(canonicalize(snapshotPayload), null, 2),
    'utf8'
  );
  console.log('  canonical snapshot WRITTEN: ' + snapshotPath);
} else {
  // Drift check: re-running on F should produce a byte-identical
  // observation. If the snapshot already exists and the new run
  // differs, V2's behavior on F has changed — surface it loudly.
  var existing = JSON.parse(fs.readFileSync(snapshotPath, 'utf8'));
  var existingCanonical = JSON.stringify(canonicalize(existing.observation));
  var newCanonical = JSON.stringify(canonicalize(snapshotPayload.observation));
  if (existingCanonical !== newCanonical) {
    // Print a small diff context for human review.
    console.log('  canonical snapshot DRIFT detected on F:');
    console.log('    existing: ' + existingCanonical.slice(0, 200) +
      (existingCanonical.length > 200 ? '…' : ''));
    console.log('    new:      ' + newCanonical.slice(0, 200) +
      (newCanonical.length > 200 ? '…' : ''));
    assert.strictEqual(newCanonical, existingCanonical,
      '[preservation] canonical snapshot drift on F. The unfixed ' +
      'code produced a different observation than the captured baseline. ' +
      'If the baseline is genuinely outdated, delete ' + snapshotPath +
      ' and re-run this test to capture a fresh snapshot.');
  } else {
    console.log('  canonical snapshot REUSED (matches existing baseline): ' + snapshotPath);
  }
}

console.log('\n[preservation-pbt] PASS');
console.log('  Property 2 — deficit-≤1 inputs produce a stable observation that ' +
  'Task 7.1 will preserve byte-for-byte post-fix (modulo the additive ' +
  '`coverageRepairWarnings: {}` empty map).');

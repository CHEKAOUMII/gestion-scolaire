'use strict';

// ============================================================
// Task 1.4 — Pre-fix diagnostic snapshot baseline
// ============================================================
// Date: 2026-05-17 (re-captured for this spec)
// Source command: `node scripts/inspect-fixture-state.js`
// Fixture: tests/fixtures/45454.json
// Code state: UNFIXED (pre-Task 5 edits to computeClassBounds)
//
// Captured stdout:
//   histogram: {"2":56,"3":90}
//   min: 2 max: 3 distinct: 146
//   coverageRepairSwaps: 17 coverageRepairUnresolved: 6
//   lowerBound: 2 upperBound: 3
//   zero-load proctors: 1
//     idx=98 طارق الشعابتي (som=2270221, dutyCount=1)
//   proctors at load=1 count: 0
//
// Notes on the captured numbers (per design.md and agent-notes):
//   - histogram `{2:56, 3:90}` matches the second documented variant in
//     `tasks.md` Task 1.4 (the "regressed further" path) — 146 proctors
//     receive at least one assignment, all at load 2 or 3.
//   - `min: 2` is computed from `Object.values(perKey)` and only counts
//     proctors that appear in `result[].proctor_keys`. The 1 zero-load
//     proctor (idx=98 طارق, the canonical singleton-class member) is not
//     counted in that histogram, so the script reports `min: 2` while the
//     true minimum primary-load across the 147 eligible proctors is 0.
//     Per `docs/agent-notes/proctor-v2-singleton-class-bounds.md`, this
//     is the expected "regressed-further" behavior.
//   - `coverageRepairSwaps: 17` and `coverageRepairUnresolved: 6` match
//     the documented baseline; 6 unresolved warnings correspond exactly
//     to the six canonical-key impossible bounds.
//
// Witness — `diagnostics.classBounds` (verified against the V2 instance
// loaded by inspect-fixture-state.js's vm sandbox; class IDs are the
// sorted member-index strings from `eligibilityClasses`):
//   classLowerBound = 352  (G_class=352, D_expected_class=0) — 2 entries
//   classLowerBound = 342  (G_class=342, D_expected_class=0) — 2 entries
//   classLowerBound = 318  (G_class=318, D_expected_class=0) — 1 entry
//   classLowerBound = 294  (G_class=294, D_expected_class=0) — 1 entry
//   classLowerBound = 2,   classUpperBound = 3
//                          (G_class=382, D_expected_class=13) — 1 entry
//                          (the "everyone-else" big class)
//
// Derived values (from the big-class diagnostics row above):
//   totalGuardSlots = 382  (G_class for the everyone-else big class)
//   D_expected      = 13
//   N_eligible      = 147
//   LB_global       = floor((382 + 13) / 147) = floor(395/147) = 2
//
// The six small-class lower bounds (352, 352, 342, 342, 318, 294) all
// exceed `LB_global + 1 = 3` by 291x to 349x — these are the
// "impossible" per-class lower bounds that downstream consumers
// (`collectUncovered`, `phase2_75CoverageRepair`,
// `violatesHardConstraints`) treat as a fairness floor and that this
// bugfix's Option C cap (Tasks 5.2 + 5.3) eliminates.
//
// Task 6.6 will re-run `node scripts/inspect-fixture-state.js` against
// the FIXED code and compare the post-fix snapshot to this baseline:
//   Expected post-fix values:
//     - histogram includes only entries with key ≤ LB_global + 1 = 3
//     - min ≥ 2 (and the zero-load proctor at idx=98 is now covered)
//     - coverageRepairUnresolved ≤ 1
//     - All seven classBounds rows have classLowerBound ≤ 3
// ============================================================

// @pre-fix exploratory test — EXPECTED to FAIL on F.
//
// ============================================================
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
// Task 1.1 — Bug Condition C(X) (synthetic singleton-with-G=10 case).
//
// `computeClassBounds` (≈ js/algorithms/proctor-distribution-v2.js
// lines 542-615) computes per-eligibility-class
// `{classLowerBound, classUpperBound, G_class, D_expected_class}`. In the
// multi-class fallback branch (`classIds.length > 1`, ≈ lines 591-614),
// for a singleton class (`members.length === 1`) the algebraic identity
// `bSize = max(1, 1) = 1` makes `classLowerBound = floor(bTotal / 1) =
// bTotal = G_c + D_c` — the entire reachable guard count for that single
// proctor's eligibility set, NOT a fairness floor. When G_c exceeds the
// global fairness floor `LB_global = floor((totalGuardSlots + D_expected)
// / N_eligible)`, downstream consumers (`collectUncovered`,
// `phase2_75CoverageRepair`, `violatesHardConstraints`) treat the
// impossible number as a fairness floor and produce false-positive
// uncovered warnings.
//
// This test reproduces the bug deterministically with a hand-crafted
// 5-proctor / 3-class / 25-slot synthetic input and asserts the
// post-fix universal property `classLowerBound <= LB_global + 1`.
// Pre-fix the singleton's classLowerBound = 10 > LB_global + 1 = 6,
// counter-exampling the property — that failure is the bug witness.
//
// DO NOT attempt to "fix" this test if it fails — the failure IS the
// counterexample that confirms the bug exists. The synthetic input
// isolates the bug to `computeClassBounds`'s multi-class fallback branch
// (refuting alternative root causes — the parent spec's inner repair
// loop, Phase 3 SA, the diagnostics-shape migration — by checking the
// bound BEFORE any of those layers run on its output).
//
// _Bug_Condition: isBugCondition(X) per design.md §"Bug Condition" —
//                 synthetic singleton case
// _Expected_Behavior: Property 1 — P-1, P-2 (cap by LB_global)
// _Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.2, 2.12
// ============================================================
//
// NOTE on class-size pattern: the task description specifies
// "4 eligibility classes of sizes {2, 2, 2, 1}" (sum = 7) AND
// "5 proctors total" with `LB_global = floor(25/5) = 5`. The two
// statements are arithmetically inconsistent. We follow the load-side
// numbers (5 proctors, totalGuardSlots = 25, LB_global = 5) which give
// the documented bug witness, and use 3 classes of sizes {2, 2, 1}.
// The bug demonstration is independent of the exact number of
// multi-member classes — only the singleton's G_class > LB_global + 1
// is needed to trigger the cap rule. Tasks 1.2 and 1.3 will append
// the non-singleton and production-fixture cases to this same file.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 6-13 of scripts/inspect-fixture-state.js
//    and tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//    lines 70-87.
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
// 2) Synthetic helpers (mirror tests/fixtures/proctor-v2-bug-fixtures.js
//    `makeProctor` / `makeEntry` / `makeRoom` shape).
// ============================================================

function makeProctor(name, cin, specialty, gender) {
  return {
    id: parseInt(cin.replace(/\D/g, ''), 10) || 0,
    teacher_name: name,
    teacher_name_fr: name,
    specialty: specialty || 'عام',
    cin: cin,
    som: '',
    gender: gender || 'ذكر',
    room: ''
  };
}

function makeEntry(day, period, session, dateDay) {
  return {
    day: day,
    period: period,
    session: session,
    level_name: 'الثانية بكالوريا',
    subject_name: 'الرياضيات',
    date_day: String(dateDay),
    date_month: '3',
    date_year: '2026',
    time_from: '08:00',
    time_to: '10:00'
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

// ============================================================
// 3) Synthetic singleton-with-G=10 input builder.
//
// Layout:
//   - 5 proctors: P1, P2, P3, P4, P5.
//   - 5 schedule entries (different day/period combos so each entry has
//     a unique session-scope exemption key). Each entry uses the same
//     5-room roster with proctorsPerRoom=1, so guardSlotsByIndex[i] = 5
//     for every i ∈ {0..4}. totalGuardSlots = 5 × 5 = 25.
//   - Eligibility (engineered via session-scope exemptions):
//       P1, P2 → eligible for entries {0, 2, 3}        (class A, size 2)
//       P3, P4 → eligible for entries {1, 2, 4}        (class B, size 2)
//       P5      → eligible for entries {0, 1}           (singleton, G=10)
//
// Derived quantities the algorithm computes:
//   N_eligible        = 5
//   D_expected        = 0
//   totalGuardSlots   = 25
//   LB_global         = floor(25 / 5) = 5
//   LB_global + 1     = 6
//
//   class A bounds: bTotal = 5 + 5 + 5 = 15, bSize = 2
//                   pre-fix classLowerBound = floor(15/2) = 7  (> LB_global!)
//   class B bounds: bTotal = 5 + 5 + 5 = 15, bSize = 2
//                   pre-fix classLowerBound = floor(15/2) = 7  (> LB_global!)
//   singleton:      bTotal = 5 + 5 = 10,    bSize = 1
//                   pre-fix classLowerBound = 10                (>> LB_global!)
//
// CRITICAL: the multi-member classes ALSO have classLowerBound = 7 > 6
// because they each retain G=15 over only 2 members. To match the task
// description's "multi-member class entries have classLowerBound = 5
// each (already <= LB_global)", we must reduce class A and B's G to
// keep their per-member share at or below LB_global=5. We do this by
// reducing the rooms per entry for entries 2, 3, 4 (which contribute
// to the multi-member classes only) so each multi-member class's
// bTotal = 10 → classLowerBound = floor(10/2) = 5. The singleton's
// G stays at 10 by routing it through entries 0 and 1, which keep
// 5 rooms each. Final geometry:
//
//   entry 0: 5 rooms (used by P1, P2 [A], and P5 [singleton])
//   entry 1: 5 rooms (used by P3, P4 [B], and P5 [singleton])
//   entry 2: 5 rooms (used by class A and class B)  -- but split G/2 per class
//   entry 3: 0 rooms (drop entry 3)
//   entry 4: 0 rooms (drop entry 4)
//
// Simpler redesign: 3 schedule entries with rooms-per-entry = 5, 5, 5,
// total 15 slots. Hmm — that breaks totalGuardSlots = 25.
//
// CORRECT redesign: keep totalGuardSlots = 25, give the singleton a
// 2-entry eligibility (G=10), and give each multi-member class an
// eligibility set whose G over its 2 members yields classLowerBound = 5.
// One way: 5 entries with rooms-per-entry [5, 5, 5, 5, 5].
//   - singleton P5 eligible for entries {0, 1}    → G_5 = 10
//   - class A (P1, P2) eligible for entries {2, 3} → G_A = 10, share = 10/2 = 5
//   - class B (P3, P4) eligible for entries {2, 4} → G_B = 10, share = 10/2 = 5
// Wait — class A and class B both include entry 2, so eligibility sets
// {2,3} and {2,4} differ → distinct classIds. P1's classId = "2,3|0",
// P3's classId = "2,4|0", P5's classId = "0,1|0". 3 classes ✓.
//
// Total slots reachable by SOME proctor = 5+5+5+5+5 = 25 ✓.
// (Note: every entry must be reachable by at least one proctor for the
// algorithm to count it. Entry 4 is reachable only by class B, which is
// fine — the algorithm doesn't require every entry to be in every
// proctor's eligibility set.)
//
// Per-class bounds derived by the algorithm:
//   singleton (P5):         bTotal = 10, bSize = 1, pre-fix LB = 10
//   class A (P1, P2):       bTotal = 10, bSize = 2, pre-fix LB = 5
//   class B (P3, P4):       bTotal = 10, bSize = 2, pre-fix LB = 5
//
// LB_global = floor(25/5) = 5. Singleton's pre-fix LB = 10 > LB_global+1 = 6 → BUG.
// Class A and B's pre-fix LB = 5 = LB_global → unchanged post-fix.
// ============================================================

function buildSyntheticSingletonG10Input() {
  // 5 proctors, all generalists. CINs are unique strings used as both
  // the canonical proctor key (via getProctorKey) and the exemption
  // lookup key (via getProctorExemptionKey).
  var P1 = makeProctor('proctor_1', 'CIN_S001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_2', 'CIN_S002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_3', 'CIN_S003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_4', 'CIN_S004', 'عام', 'ذكر');
  var P5 = makeProctor('proctor_5', 'CIN_S005', 'عام', 'ذكر');

  // 5 entries with distinct (day, period, session) tuples so each entry
  // has a unique session-scope exemption key. Spread across 5 different
  // days to also make halfday keys distinct (avoids any
  // halfday-reuse interference with the bounds derivation).
  var entries = [
    makeEntry('الأول',   'صباحا', 'الحصة الأولى', 10), // index 0
    makeEntry('الثاني',  'صباحا', 'الحصة الأولى', 11), // index 1
    makeEntry('الثالث',  'صباحا', 'الحصة الأولى', 12), // index 2
    makeEntry('الرابع',  'صباحا', 'الحصة الأولى', 13), // index 3
    makeEntry('الخامس',  'صباحا', 'الحصة الأولى', 14)  // index 4
  ];

  // 5 rooms used by every entry (rooms have the same level_name as
  // every entry, so getRoomsForEntry returns all 5 for every entry).
  var rooms = [
    makeRoom('R1'), makeRoom('R2'), makeRoom('R3'),
    makeRoom('R4'), makeRoom('R5')
  ];

  // Engineer eligibility by session-scope exemptions. For each entry,
  // the exemption scope key is `session|<day>|<period>|<session_name>`,
  // and the per-proctor lookup key is the proctor's CIN with value 'no'.
  //
  //   Eligibility goal:
  //     P1, P2 → eligible for {0, 2, 3}, exempt for {1, 4}
  //     P3, P4 → eligible for {2, 4},    exempt for {0, 1, 3}
  //     P5     → eligible for {0, 1},    exempt for {2, 3, 4}
  //
  // NOTE: we must adjust class A's eligibility set to {2, 3} only (not
  // {0, 2, 3}) so its bTotal = 10 (not 15). Otherwise class A's
  // pre-fix classLowerBound = floor(15/2) = 7 > LB_global = 5,
  // contradicting the task's "multi-member class entries have
  // classLowerBound = 5 each" expectation.
  //
  // Final eligibility:
  //   P1, P2 → eligible for {2, 3}   (exempt for {0, 1, 4})
  //   P3, P4 → eligible for {2, 4}   (exempt for {0, 1, 3})
  //   P5     → eligible for {0, 1}   (exempt for {2, 3, 4})

  function sessionScopeKey(entry) {
    return ['session', entry.day, entry.period, entry.session].join('|');
  }
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1, P2 exempt for entries {0, 1, 4}
  [0, 1, 4].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_S001'] = 'no';
    exemptionsData[k]['CIN_S002'] = 'no';
  });
  // P3, P4 exempt for entries {0, 1, 3}
  [0, 1, 3].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_S003'] = 'no';
    exemptionsData[k]['CIN_S004'] = 'no';
  });
  // P5 exempt for entries {2, 3, 4}
  [2, 3, 4].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_S005'] = 'no';
  });

  return {
    proctorsList: [P1, P2, P3, P4, P5],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// 4) Run the bounds derivation directly via the exposed
//    `V2.computeEligibilityClasses` and `V2.computeClassBounds`
//    helpers, then project the resulting Map<classId, bounds> onto
//    a per-canonical-proctor-key map (mirrors lines 1945-1956 of
//    `js/algorithms/proctor-distribution-v2.js` `run`). We bypass
//    the full V2.run pipeline because the public return shape is
//    only `{ result, diagnostics }` — `classBoundsByProctorKey` is
//    an internal phase2Result field. The bounds-derivation step is
//    pure (no IPC, no DB, no randomness), so calling the helpers
//    directly is observationally equivalent to the algorithm's own
//    invocation at lines 1937-1956.
// ============================================================

const input = buildSyntheticSingletonG10Input();
const proctorsList = input.proctorsList;
const scheduleEntries = input.scheduleEntries;
const proctorsPerRoom = input.examDistributionRules.proctorsPerRoom;
const D_expected = Number(input.D_expected) || 0;

// Mirror the run() helper at line 1921: guardSlotsByIndex[i] =
// roomsForEntry × proctorsPerRoom. With our 5 rooms × 1 proctor/room
// configuration, every entry resolves to 5 slots.
const guardSlotsByIndex = {};
for (var gsi = 0; gsi < scheduleEntries.length; gsi++) {
  guardSlotsByIndex[gsi] = input.options.roomsList.length * proctorsPerRoom;
}

// Empty loadState (no pre-existing duty halfdays). computeEligibilityClasses
// only consults loadState for `isOnDutyDuringHalfday` / `getLoadSetSize`
// queries; with `dutyData = {}` and no prior assignments, the empty
// loadState is correct. The exposed helper accepts `null` here (it falls
// through `getLoadSetSize`'s null-guard).
const loadState = null;

const eligibilityClasses = V2._internals.computeEligibilityClasses(
  proctorsList,
  scheduleEntries,
  input.exemptionsData || {},
  input.dutyData || {},
  loadState
);

let eligibleCountForBounds = 0;
eligibilityClasses.forEach(function (cls) {
  eligibleCountForBounds += (cls.members || []).length;
});

const classBoundsMap = V2._internals.computeClassBounds(
  eligibilityClasses,
  scheduleEntries,
  proctorsPerRoom,
  D_expected,
  eligibleCountForBounds,
  guardSlotsByIndex
);

// Project Map<classId, bounds> → Object<canonicalKey, bounds>.
const classBoundsByKey = {};
const classIdByKey = {};
eligibilityClasses.forEach(function (cls, classId) {
  var bounds = classBoundsMap.get(classId);
  var members = cls.members || [];
  for (var cm = 0; cm < members.length; cm++) {
    classBoundsByKey[members[cm].key] = bounds;
    classIdByKey[members[cm].key] = classId;
  }
});

// Reconstruct LB_global from the same inputs computeClassBounds uses:
//   LB_global = floor((totalGuardSlots + D_expected) / N_eligible)
// totalGuardSlots = sum over scheduleEntries of guardSlotsByIndex[i]
// where guardSlotsByIndex[i] = rooms-for-entry × proctorsPerRoom = 5 × 1 = 5.
const N_PROCTORS = input.proctorsList.length;        // 5
const N_ENTRIES = input.scheduleEntries.length;      // 5
const SLOTS_PER_ENTRY = 5;                            // 5 rooms × 1 proctor/room
const TOTAL_GUARD_SLOTS = N_ENTRIES * SLOTS_PER_ENTRY; // 25
const D_EXPECTED = 0;
const N_ELIGIBLE = N_PROCTORS;                        // every proctor has at least one eligible entry
const LB_GLOBAL = Math.floor((TOTAL_GUARD_SLOTS + D_EXPECTED) / N_ELIGIBLE); // 5

// ============================================================
// 5) Diagnostic snapshot — printed for human review and to lock the
//    counterexample in CI logs when the universal assertion fails.
// ============================================================

console.log('[singleton-G10-exploration] synthetic input diagnostics:');
console.log('  proctors=' + N_PROCTORS + ' | entries=' + N_ENTRIES +
  ' | totalGuardSlots=' + TOTAL_GUARD_SLOTS +
  ' | D_expected=' + D_EXPECTED +
  ' | N_eligible=' + N_ELIGIBLE);
console.log('  LB_global = floor(' + TOTAL_GUARD_SLOTS + '/' + N_ELIGIBLE + ') = ' +
  LB_GLOBAL + ', LB_global+1 = ' + (LB_GLOBAL + 1));

// POST-FIX TRANSITION (Task 6.1): the (A) sanity-check assertions
// originally locked the *pre-fix raw* per-class lower bounds (singleton
// at 10, class A/B at 5). After Task 5's cap landed in `computeClassBounds`,
// the singleton is capped DOWN to LB_global = 5; class A and class B are
// unaffected (their raw LB = 5 was already <= LB_global). The sanity
// checks below now lock the *post-fix capped* values so the geometry-
// verification half of the test continues to validate input setup, while
// the (B) universal post-fix property below remains the bug-condition
// closure assertion. The pre-fix raw value (10) is preserved in the
// `_originalRawPreFixLower` field for documentation; it is no longer
// observable on FIXED code.
const expectedBoundsByCin = {
  'CIN_S001': { role: 'class A (size 2)',   expectedLower: 5, _originalRawPreFixLower: 5  },
  'CIN_S002': { role: 'class A (size 2)',   expectedLower: 5, _originalRawPreFixLower: 5  },
  'CIN_S003': { role: 'class B (size 2)',   expectedLower: 5, _originalRawPreFixLower: 5  },
  'CIN_S004': { role: 'class B (size 2)',   expectedLower: 5, _originalRawPreFixLower: 5  },
  'CIN_S005': { role: 'singleton (size 1)', expectedLower: 5, _originalRawPreFixLower: 10 }
};

Object.keys(expectedBoundsByCin).forEach(function (cin) {
  var b = classBoundsByKey[cin];
  console.log('  ' + cin + ' (' + expectedBoundsByCin[cin].role + '): ' +
    (b
      ? 'classLowerBound=' + b.classLowerBound +
        ' classUpperBound=' + b.classUpperBound +
        ' G_class=' + b.G_class +
        ' D_expected_class=' + b.D_expected_class
      : '<no bounds>'));
});

// ============================================================
// 6) Assertions.
//
// (A) Pre-fix expected per-class bounds (sanity check — confirms the
//     synthetic input geometry matches the task description). If these
//     fail, the input geometry is wrong and the universal assertion
//     below would be meaningless. We use deferred-failure pattern so
//     all assertion outcomes are visible in the CI log even when one
//     fails.
//
// (B) Universal post-fix property — every per-class classLowerBound <=
//     LB_global + 1. Pre-fix this FAILS for the singleton (CIN_S005)
//     at classLowerBound = 10 > 6. That failure IS the bug witness.
//     Post-fix the property holds.
// ============================================================

var failures = [];

// (A) Sanity checks on per-class bounds (geometry verification).
//     Post-fix locks: the cap clamps the singleton from raw 10 to
//     LB_global = 5; class A and class B raw LB = 5 are unaffected.
Object.keys(expectedBoundsByCin).forEach(function (cin) {
  var spec = expectedBoundsByCin[cin];
  var b = classBoundsByKey[cin];
  if (!b) {
    failures.push('[setup] expected classBoundsByProctorKey[' + cin +
      '] to be set (' + spec.role + '), got <undefined>. ' +
      'Synthetic input geometry is wrong — every proctor must end up in ' +
      'an eligibility class.');
    return;
  }
  if (b.classLowerBound !== spec.expectedLower) {
    failures.push('[setup] expected post-fix ' + cin + ' classLowerBound=' +
      spec.expectedLower + ' (' + spec.role +
      '; pre-fix raw was ' + spec._originalRawPreFixLower + '), got ' +
      b.classLowerBound + '. Synthetic input geometry mismatch — adjust ' +
      'the eligibility/exemption layout.');
  }
});

// (B) Universal post-fix property (the bug-condition assertion).
//
// Pre-fix expected counterexample: CIN_S005 (singleton) at
// classLowerBound = 10 > LB_global + 1 = 6.
Object.keys(classBoundsByKey).forEach(function (key) {
  var b = classBoundsByKey[key];
  if (!b) return;
  if (!(b.classLowerBound <= LB_GLOBAL + 1)) {
    failures.push(
      'Bug Condition C(X) reproduced on synthetic singleton-G=10 input: ' +
      'classBoundsByProctorKey[' + key + '].classLowerBound = ' +
      b.classLowerBound + ' > LB_global + 1 = ' + (LB_GLOBAL + 1) + '. ' +
      'Geometry: totalGuardSlots=' + TOTAL_GUARD_SLOTS +
      ', D_expected=' + D_EXPECTED +
      ', N_eligible=' + N_ELIGIBLE +
      ', LB_global=' + LB_GLOBAL + '. ' +
      'Per-class bounds: G_class=' + b.G_class +
      ', D_expected_class=' + b.D_expected_class +
      ', classUpperBound=' + b.classUpperBound + '. ' +
      'For a singleton class (members.length === 1), bSize=1 forces ' +
      'classLowerBound = floor(bTotal/1) = bTotal = G_class + D_class — ' +
      'an absolute reachability metric, not a fairness floor. Downstream ' +
      'consumers (collectUncovered, phase2_75CoverageRepair, ' +
      'violatesHardConstraints) treat this impossible value as a ' +
      'fairness floor, producing false-positive uncovered warnings. The ' +
      'fix (Option C — global-fairness floor) introduces ' +
      'LB_global = floor((totalGuardSlots + D_expected) / N_eligible) ' +
      'and caps every per-class classLowerBound at LB_global, with a ' +
      'monotonicity guard that retains bTotal when bTotal <= LB_global. ' +
      'See .kiro/specs/proctor-v2-singleton-class-bounds/design.md ' +
      '§"Fix Strategy: Option C".'
    );
  }
});

// ============================================================
// ============================================================
// Task 1.2 — Bug Condition C(X) (synthetic NON-singleton case with
//           bTotal/bSize > LB_global).
//
// Refutes the alternative root-cause hypothesis "the bug is specific
// to singleton classes (bSize === 1)". Constructs a 4-proctor input
// with two size-2 eligibility classes whose bTotal/bSize ratios
// straddle LB_global. Class A is wide (G=30, bSize=2 → raw LB=15),
// class B is narrow (G=10, bSize=2 → raw LB=5). Total guard slots = 40,
// LB_global = floor(40/4) = 10, LB_global+1 = 11. Class A's pre-fix
// classLowerBound = 15 > 11 → Bug Condition C(X) reproduces on a
// non-singleton. Class B's pre-fix classLowerBound = 5 ≤ LB_global →
// cap is a no-op (preservation of small classes).
//
// Pre-fix expected counterexample: class A members (CIN_NS001 and
// CIN_NS002) at classLowerBound = 15 > LB_global + 1 = 11. Class B
// members (CIN_NS003 and CIN_NS004) at classLowerBound = 5 ≤ 11 (no
// cap needed). Post-fix: class A capped at 10, class B unchanged at 5.
//
// _Bug_Condition: isBugCondition(X) — synthetic non-singleton case
// _Expected_Behavior: Property 1 — cap rule applies uniformly to all
//                     classes (not just singletons)
// _Validates: Requirements 1.1, 1.2, 2.1, 2.4
// ============================================================

function buildSyntheticNonSingletonInput() {
  // 4 proctors split into two pairs.
  var P1 = makeProctor('proctor_ns_1', 'CIN_NS001', 'عام', 'ذكر');
  var P2 = makeProctor('proctor_ns_2', 'CIN_NS002', 'عام', 'ذكر');
  var P3 = makeProctor('proctor_ns_3', 'CIN_NS003', 'عام', 'ذكر');
  var P4 = makeProctor('proctor_ns_4', 'CIN_NS004', 'عام', 'ذكر');

  // 8 entries × 5 rooms × 1 proctor/room = 40 slots total.
  // - Entries 0..5 (6 entries) reachable by P1, P2 only → class A G=30.
  // - Entries 6, 7 (2 entries) reachable by P3, P4 only → class B G=10.
  // Distinct (day, period) tuples per entry so each entry has a unique
  // session-scope exemption key. Spread across distinct days to prevent
  // any halfday-key collision.
  var entries = [
    makeEntry('NS_d1', 'صباحا', 'الحصة الأولى', 1),
    makeEntry('NS_d2', 'صباحا', 'الحصة الأولى', 2),
    makeEntry('NS_d3', 'صباحا', 'الحصة الأولى', 3),
    makeEntry('NS_d4', 'صباحا', 'الحصة الأولى', 4),
    makeEntry('NS_d5', 'صباحا', 'الحصة الأولى', 5),
    makeEntry('NS_d6', 'صباحا', 'الحصة الأولى', 6),
    makeEntry('NS_d7', 'صباحا', 'الحصة الأولى', 7),
    makeEntry('NS_d8', 'صباحا', 'الحصة الأولى', 8)
  ];
  var rooms = [
    makeRoom('NSR1'), makeRoom('NSR2'), makeRoom('NSR3'),
    makeRoom('NSR4'), makeRoom('NSR5')
  ];

  // Engineer eligibility via session-scope exemptions:
  //   P1, P2 → eligible for {0..5}, exempt for {6, 7} (class A, G=30, bSize=2)
  //   P3, P4 → eligible for {6, 7}, exempt for {0..5} (class B, G=10, bSize=2)
  function sessionScopeKey(entry) {
    return ['session', entry.day, entry.period, entry.session].join('|');
  }
  var exemptionsData = {};
  for (var ei = 0; ei < entries.length; ei++) {
    exemptionsData[sessionScopeKey(entries[ei])] = {};
  }
  // P1, P2 exempt for entries 6, 7.
  [6, 7].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_NS001'] = 'no';
    exemptionsData[k]['CIN_NS002'] = 'no';
  });
  // P3, P4 exempt for entries 0..5.
  [0, 1, 2, 3, 4, 5].forEach(function (ei) {
    var k = sessionScopeKey(entries[ei]);
    exemptionsData[k]['CIN_NS003'] = 'no';
    exemptionsData[k]['CIN_NS004'] = 'no';
  });

  return {
    proctorsList: [P1, P2, P3, P4],
    scheduleEntries: entries,
    exemptionsData: exemptionsData,
    dutyData: {},
    meAssignments: {},
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: rooms,
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: false,
      respectMorningEvening: false,
      preferMixedGenderPair: false
    },
    enablePhase3: false,
    D_expected: 0
  };
}

const inputNS = buildSyntheticNonSingletonInput();
const proctorsListNS = inputNS.proctorsList;
const scheduleEntriesNS = inputNS.scheduleEntries;
const proctorsPerRoomNS = inputNS.examDistributionRules.proctorsPerRoom;
const D_expectedNS = Number(inputNS.D_expected) || 0;

const guardSlotsByIndexNS = {};
for (var gsiNS = 0; gsiNS < scheduleEntriesNS.length; gsiNS++) {
  guardSlotsByIndexNS[gsiNS] = inputNS.options.roomsList.length * proctorsPerRoomNS;
}

const eligibilityClassesNS = V2._internals.computeEligibilityClasses(
  proctorsListNS,
  scheduleEntriesNS,
  inputNS.exemptionsData || {},
  inputNS.dutyData || {},
  null
);

let eligibleCountForBoundsNS = 0;
eligibilityClassesNS.forEach(function (cls) {
  eligibleCountForBoundsNS += (cls.members || []).length;
});

const classBoundsMapNS = V2._internals.computeClassBounds(
  eligibilityClassesNS,
  scheduleEntriesNS,
  proctorsPerRoomNS,
  D_expectedNS,
  eligibleCountForBoundsNS,
  guardSlotsByIndexNS
);

const classBoundsByKeyNS = {};
eligibilityClassesNS.forEach(function (cls, classId) {
  var bounds = classBoundsMapNS.get(classId);
  var members = cls.members || [];
  for (var cm = 0; cm < members.length; cm++) {
    classBoundsByKeyNS[members[cm].key] = bounds;
  }
});

const N_PROCTORS_NS = inputNS.proctorsList.length;          // 4
const N_ENTRIES_NS = inputNS.scheduleEntries.length;        // 8
const SLOTS_PER_ENTRY_NS = 5;                                // 5 rooms × 1 proctor/room
const TOTAL_GUARD_SLOTS_NS = N_ENTRIES_NS * SLOTS_PER_ENTRY_NS; // 40
const D_EXPECTED_NS = 0;
const N_ELIGIBLE_NS = N_PROCTORS_NS;                         // 4
const LB_GLOBAL_NS = Math.floor((TOTAL_GUARD_SLOTS_NS + D_EXPECTED_NS) / N_ELIGIBLE_NS); // 10

console.log('[non-singleton-exploration] synthetic input diagnostics:');
console.log('  proctors=' + N_PROCTORS_NS + ' | entries=' + N_ENTRIES_NS +
  ' | totalGuardSlots=' + TOTAL_GUARD_SLOTS_NS +
  ' | D_expected=' + D_EXPECTED_NS +
  ' | N_eligible=' + N_ELIGIBLE_NS);
console.log('  LB_global = floor(' + TOTAL_GUARD_SLOTS_NS + '/' + N_ELIGIBLE_NS + ') = ' +
  LB_GLOBAL_NS + ', LB_global+1 = ' + (LB_GLOBAL_NS + 1));

// POST-FIX TRANSITION (Task 6.1): originally locked pre-fix raw bounds
// (class A at 15, class B at 5). Post-fix, class A is capped DOWN to
// LB_global = 10; class B (raw LB = 5 <= LB_global) is unaffected.
const expectedBoundsByCinNS = {
  'CIN_NS001': { role: 'class A (size 2, wide)',   expectedLower: 10, _originalRawPreFixLower: 15 },
  'CIN_NS002': { role: 'class A (size 2, wide)',   expectedLower: 10, _originalRawPreFixLower: 15 },
  'CIN_NS003': { role: 'class B (size 2, narrow)', expectedLower: 5,  _originalRawPreFixLower: 5  },
  'CIN_NS004': { role: 'class B (size 2, narrow)', expectedLower: 5,  _originalRawPreFixLower: 5  }
};

Object.keys(expectedBoundsByCinNS).forEach(function (cin) {
  var b = classBoundsByKeyNS[cin];
  console.log('  ' + cin + ' (' + expectedBoundsByCinNS[cin].role + '): ' +
    (b
      ? 'classLowerBound=' + b.classLowerBound +
        ' classUpperBound=' + b.classUpperBound +
        ' G_class=' + b.G_class +
        ' D_expected_class=' + b.D_expected_class
      : '<no bounds>'));
});

// (A) Sanity checks — geometry verification.
//     Post-fix locks: the cap clamps class A from raw 15 to
//     LB_global = 10; class B raw LB = 5 is unaffected.
Object.keys(expectedBoundsByCinNS).forEach(function (cin) {
  var spec = expectedBoundsByCinNS[cin];
  var b = classBoundsByKeyNS[cin];
  if (!b) {
    failures.push('[non-singleton setup] expected classBoundsByProctorKey[' + cin +
      '] to be set (' + spec.role + '), got <undefined>. ' +
      'Synthetic input geometry is wrong — every proctor must end up in ' +
      'an eligibility class.');
    return;
  }
  if (b.classLowerBound !== spec.expectedLower) {
    failures.push('[non-singleton setup] expected post-fix ' + cin +
      ' classLowerBound=' + spec.expectedLower + ' (' + spec.role +
      '; pre-fix raw was ' + spec._originalRawPreFixLower + '), got ' +
      b.classLowerBound + '. Synthetic input geometry mismatch — adjust ' +
      'the eligibility/exemption layout.');
  }
});

// (B) Universal post-fix property — every per-class classLowerBound
//     <= LB_global + 1. Pre-fix this FAILS for class A members
//     (CIN_NS001, CIN_NS002) at classLowerBound = 15 > 11. Post-fix
//     class A is capped at 10 ≤ 11, class B unchanged at 5 ≤ 11.
Object.keys(classBoundsByKeyNS).forEach(function (key) {
  var b = classBoundsByKeyNS[key];
  if (!b) return;
  if (!(b.classLowerBound <= LB_GLOBAL_NS + 1)) {
    failures.push(
      'Bug Condition C(X) reproduced on synthetic NON-singleton input: ' +
      'classBoundsByProctorKey[' + key + '].classLowerBound = ' +
      b.classLowerBound + ' > LB_global + 1 = ' + (LB_GLOBAL_NS + 1) + '. ' +
      'Geometry: totalGuardSlots=' + TOTAL_GUARD_SLOTS_NS +
      ', D_expected=' + D_EXPECTED_NS +
      ', N_eligible=' + N_ELIGIBLE_NS +
      ', LB_global=' + LB_GLOBAL_NS + '. ' +
      'Per-class bounds: G_class=' + b.G_class +
      ', D_expected_class=' + b.D_expected_class +
      ', classUpperBound=' + b.classUpperBound + '. ' +
      'This member belongs to a SIZE-2 class (NOT a singleton), refuting ' +
      'the alternative root-cause hypothesis "the bug is specific to ' +
      'singleton classes". The bug fires whenever ' +
      'floor(bTotal / bSize) > LB_global + 1, regardless of bSize. The ' +
      'fix (Option C) caps every per-class classLowerBound at LB_global ' +
      'uniformly. See .kiro/specs/proctor-v2-singleton-class-bounds/design.md ' +
      '§"Examples" — synthetic non-singleton case.'
    );
  }
});

// ============================================================
// ============================================================
// Task 1.3 — Bug Condition C(X) (production-fixture replay).
//
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
//
// Replay tests/fixtures/45454.json — the post-key-shape-unification
// production fixture that motivated this entire spec. After the duty
// pre-pass populates `loadState.dutyHalfdays` (mirroring the run()
// orchestrator's lines ~1837-1869 — `addDutyLoad` for every duty
// entry), `computeEligibilityClasses` partitions the 147 proctors
// into 7 classes: one large multi-member class for the proctors with
// no duty constraints and SIX singletons whose duty halfdays carve
// them out of the main class. Each singleton has wide row eligibility
// (G_class in 294–352), and the multi-class fallback branch of
// `computeClassBounds` produces classLowerBound = floor(bTotal/1) =
// bTotal — the impossible per-class bounds documented in
// `docs/agent-notes/proctor-v2-singleton-class-bounds.md` §"Witness on
// tests/fixtures/45454.json".
//
// Pre-fix expected witness values (per the witness table):
//
//   canonical key | classLowerBound
//   --------------+-----------------
//   __idx_98      | 352
//   __idx_62      | 342
//   __idx_28      | 342
//   __idx_133     | 318
//   __idx_109     | 294
//   __idx_21      | 352
//
// Derived from fixture totals:
//   totalGuardSlots = 382      (sum over 30 schedule entries of
//                                getRoomsForEntry × proctorsPerRoom=2)
//   D_expected      = 13       (from fixture's D_expected field)
//   N_eligible      = 147      (every proctor has at least one
//                                eligible row after duty pre-pass)
//   LB_global       = floor((382 + 13) / 147) = 2
//   LB_global + 1   = 3        (the post-fix universal cap)
//
// We use the helpers approach (computeEligibilityClasses +
// computeClassBounds directly via V2._internals) rather than the full
// V2.run() because the public V2.run return shape is `{result,
// diagnostics}` — `classBoundsByProctorKey` is a phase2Result-only
// field and is not surfaced on the orchestrator return. The helpers
// path requires reproducing the duty pre-load that run() does before
// invoking computeEligibilityClasses; otherwise the production
// fixture's 7 classes collapse into 1 (every duty halfday becomes
// transparent) and the witness signature is lost. The duty pre-load
// is mechanical (`addDutyLoad` for every truthy duty entry, after
// translating external keys to canonical via `toCanonicalKey`) and
// is the only piece of run() we need to mirror.
//
// CIN STATS — every proctor in fixture 45454.json has cin="" (empty
// string). `getProctorKey(proc, idx)` resolves empty-string to falsy
// and returns `'__idx_' + idx` for ALL 147 proctors. The witness keys
// (__idx_98, etc.) are derived directly from this — they're not
// arbitrary IDs.
//
// _Bug_Condition: isBugCondition(X) — production fixture (six
//                 singleton classes with impossible bounds)
// _Expected_Behavior: Property 1 — P-3 (production-fixture pinpoint)
// _Validates: Requirements 1.5, 1.6, 1.8, 1.9, 2.6, 3.4
// ============================================================

const PROD_FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/45454.json');
const prodInput = JSON.parse(fs.readFileSync(PROD_FIXTURE_PATH, 'utf8'));

// Sanity guard: verify the fixture still has the documented shape.
// If a future fixture regeneration changes its shape (proctor count,
// D_expected, etc.), the witness assertions below lose meaning — fail
// loudly here so the regression-lock is never silently weakened.
(function guardProdFixture() {
  if (!Array.isArray(prodInput.proctorsList) ||
      prodInput.proctorsList.length !== 147) {
    failures.push('[prod-setup] expected fixture 45454.json to contain ' +
      '147 proctors; got ' +
      ((prodInput.proctorsList && prodInput.proctorsList.length) || 0) +
      '. Witness has drifted from ' +
      'docs/agent-notes/proctor-v2-singleton-class-bounds.md §"Witness ' +
      'on tests/fixtures/45454.json".');
  }
  if (Number(prodInput.D_expected) !== 13) {
    failures.push('[prod-setup] expected fixture 45454.json D_expected=13; got ' +
      prodInput.D_expected + '. Witness has drifted.');
  }
})();

// ============================================================
// Build guardSlotsByIndex via the same per-level rooms lookup that
// run() uses (lines ~1879-1898). The fixture's options.roomsList is
// a per-level map (Object<level_name, Array<room>>), not a flat
// array, so we mirror the algorithm's resolver verbatim.
// ============================================================

const prodRoomsList = (prodInput.options && prodInput.options.roomsList) || [];
const prodProctorsPerRoom = (prodInput.examDistributionRules &&
  prodInput.examDistributionRules.proctorsPerRoom) || 1;

function getRoomsForProdEntry(entry) {
  var levelName = entry.level_name || '';
  if (prodRoomsList && typeof prodRoomsList === 'object' &&
      !Array.isArray(prodRoomsList)) {
    var levelRooms = prodRoomsList[levelName];
    if (Array.isArray(levelRooms) && levelRooms.length > 0) return levelRooms;
    return [];
  }
  if (Array.isArray(prodRoomsList) && prodRoomsList.length > 0) {
    var filtered = prodRoomsList.filter(function (r) {
      return (r.level_name || '') === levelName;
    });
    return filtered.length > 0 ? filtered : prodRoomsList;
  }
  return [];
}

const prodGuardSlotsByIndex = {};
let prodTotalGuardSlots = 0;
for (var psi = 0; psi < prodInput.scheduleEntries.length; psi++) {
  var prodSlots = getRoomsForProdEntry(prodInput.scheduleEntries[psi]).length *
    prodProctorsPerRoom;
  prodGuardSlotsByIndex[psi] = prodSlots;
  prodTotalGuardSlots += prodSlots;
}

// ============================================================
// Duty pre-load — mirrors run() lines ~1837-1869 verbatim.
// Translates external duty keys via the boundary adapter and writes
// duty halfdays into loadState. Without this, the 6 singleton classes
// collapse into the main class because every proctor sees every
// halfday as eligible (no on-duty filtering).
// ============================================================

const prodLoadState = V2._internals.createLoadState();
const prodKeyAdapter = V2._internals.buildKeyAdapter(prodInput.proctorsList);
const prodDutyData = prodInput.dutyData || {};
const prodDutyDataKeys = Object.keys(prodDutyData);
for (var pdi = 0; pdi < prodDutyDataKeys.length; pdi++) {
  var prodDutyEntry = prodDutyData[prodDutyDataKeys[pdi]];
  if (prodDutyEntry && typeof prodDutyEntry === 'object') {
    var prodDutyProctorKeys = Object.keys(prodDutyEntry);
    for (var pdpi = 0; pdpi < prodDutyProctorKeys.length; pdpi++) {
      if (prodDutyEntry[prodDutyProctorKeys[pdpi]]) {
        var prodDutyParts = prodDutyDataKeys[pdi].split('|');
        var prodDutyHdKey = '';
        if (prodDutyParts.length >= 3) {
          prodDutyHdKey = prodDutyParts[0] + '|' +
            (prodDutyParts[2] || 'صباحا');
        }
        if (prodDutyHdKey) {
          var prodCanonicalDutyKey = V2._internals.toCanonicalKey(
            prodKeyAdapter, prodDutyProctorKeys[pdpi]
          );
          if (prodCanonicalDutyKey) {
            V2._internals.addDutyLoad(
              prodLoadState, prodCanonicalDutyKey, prodDutyHdKey, ''
            );
          }
        }
      }
    }
  }
}

// ============================================================
// Eligibility classes + per-class bounds (post-duty-pre-load).
// ============================================================

const prodEligibilityClasses = V2._internals.computeEligibilityClasses(
  prodInput.proctorsList,
  prodInput.scheduleEntries,
  prodInput.exemptionsData || {},
  prodInput.dutyData || {},
  prodLoadState
);

let prodEligibleCount = 0;
prodEligibilityClasses.forEach(function (cls) {
  prodEligibleCount += (cls.members || []).length;
});

const prodClassBoundsMap = V2._internals.computeClassBounds(
  prodEligibilityClasses,
  prodInput.scheduleEntries,
  prodProctorsPerRoom,
  Number(prodInput.D_expected) || 0,
  prodEligibleCount,
  prodGuardSlotsByIndex
);

const prodClassBoundsByKey = {};
prodEligibilityClasses.forEach(function (cls, classId) {
  var bounds = prodClassBoundsMap.get(classId);
  var members = cls.members || [];
  for (var pcm = 0; pcm < members.length; pcm++) {
    prodClassBoundsByKey[members[pcm].key] = bounds;
  }
});

const PROD_D_EXPECTED = Number(prodInput.D_expected) || 0;             // 13
const PROD_N_ELIGIBLE = prodEligibleCount;                              // 147
const PROD_LB_GLOBAL = PROD_N_ELIGIBLE > 0
  ? Math.floor((prodTotalGuardSlots + PROD_D_EXPECTED) / PROD_N_ELIGIBLE)
  : 0;                                                                  // 2

// ============================================================
// Diagnostic snapshot — prints the witness so CI logs lock the
// counterexample alongside the deferred failures.
// ============================================================

console.log('[prod-fixture-exploration] tests/fixtures/45454.json diagnostics:');
console.log('  proctors=' + prodInput.proctorsList.length +
  ' | entries=' + prodInput.scheduleEntries.length +
  ' | totalGuardSlots=' + prodTotalGuardSlots +
  ' | D_expected=' + PROD_D_EXPECTED +
  ' | N_eligible=' + PROD_N_ELIGIBLE);
console.log('  eligibilityClasses.size=' + prodEligibilityClasses.size);
console.log('  LB_global = floor((' + prodTotalGuardSlots + ' + ' +
  PROD_D_EXPECTED + ') / ' + PROD_N_ELIGIBLE + ') = ' + PROD_LB_GLOBAL +
  ', LB_global+1 = ' + (PROD_LB_GLOBAL + 1));

// Witness table — the six known canonical-key bounds documented in
// docs/agent-notes/proctor-v2-singleton-class-bounds.md.
// POST-FIX TRANSITION (Task 6.1): the original witness values
// (294-352) are the *pre-fix raw* singleton lower bounds — the
// counterexamples that motivated this spec. Post-fix Option C caps
// every per-class lower bound at LB_global = 2 with classUpperBound
// at most LB_global+1 = 3. The post-fix expected value for each
// witness is therefore `LB_global = 2`. We retain the original raw
// witness values in `_originalRawPreFixLower` for documentation —
// they are no longer observable on FIXED code.
const prodWitnessTable = {
  '__idx_98':  { expectedLower: 2, _originalRawPreFixLower: 352 },
  '__idx_62':  { expectedLower: 2, _originalRawPreFixLower: 342 },
  '__idx_28':  { expectedLower: 2, _originalRawPreFixLower: 342 },
  '__idx_133': { expectedLower: 2, _originalRawPreFixLower: 318 },
  '__idx_109': { expectedLower: 2, _originalRawPreFixLower: 294 },
  '__idx_21':  { expectedLower: 2, _originalRawPreFixLower: 352 }
};

Object.keys(prodWitnessTable).forEach(function (witnessKey) {
  var b = prodClassBoundsByKey[witnessKey];
  console.log('  ' + witnessKey + ' (post-fix expected LB=' +
    prodWitnessTable[witnessKey].expectedLower +
    ', pre-fix raw was ' +
    prodWitnessTable[witnessKey]._originalRawPreFixLower + '): ' +
    (b
      ? 'classLowerBound=' + b.classLowerBound +
        ' classUpperBound=' + b.classUpperBound +
        ' G_class=' + b.G_class +
        ' D_expected_class=' + b.D_expected_class
      : '<no bounds>'));
});

// ============================================================
// (A) Witness sanity — confirm the six known canonical keys are
//     present on the production fixture and resolve to the *post-fix
//     capped* lower bound (LB_global = 2). Pre-fix raw values
//     (294-352) are no longer observable on FIXED code; the witness
//     table preserves them for documentation. If a witness key is
//     missing or its post-fix bound differs from LB_global, the
//     fixture or the algorithm has drifted and the regression-lock
//     loses meaning — surface the change loudly via the deferred-
//     failure accumulator.
// ============================================================

Object.keys(prodWitnessTable).forEach(function (witnessKey) {
  var spec = prodWitnessTable[witnessKey];
  var b = prodClassBoundsByKey[witnessKey];
  if (!b) {
    failures.push('[prod-witness setup] expected classBoundsByProctorKey[' +
      witnessKey + '] to be set on the production fixture (witness ' +
      'documented in docs/agent-notes/proctor-v2-singleton-class-bounds.md ' +
      '§"Witness on tests/fixtures/45454.json"), got <undefined>. The ' +
      'duty pre-load may have failed to carve out this proctor\'s ' +
      'singleton class — verify dutyData translation via toCanonicalKey.');
    return;
  }
  if (b.classLowerBound !== spec.expectedLower) {
    failures.push('[prod-witness setup] expected post-fix ' + witnessKey +
      ' classLowerBound=' + spec.expectedLower +
      ' (LB_global cap; pre-fix raw was ' + spec._originalRawPreFixLower +
      ' per witness table in docs/agent-notes/proctor-v2-singleton-class' +
      '-bounds.md), got ' + b.classLowerBound + '. The fixture or the ' +
      'algorithm has drifted from the documented post-fix snapshot — ' +
      'verify against the witness table before treating this as a ' +
      'regression.');
  }
});

// ============================================================
// (B) Universal post-fix property — every per-class classLowerBound
//     <= LB_global + 1 = 3 on the production fixture. Pre-fix this
//     FAILS for the six singleton-class entries (294, 318, 342, 342,
//     352, 352). Post-fix Option C caps every per-class lower bound
//     at LB_global = 2 (with classUpperBound at most LB_global+1 = 3).
//
//     We assert the property for ALL 147 canonical keys, not just the
//     six witnesses — the universal property is what the fix locks,
//     and any future singleton with G_class > LB_global+1 must also
//     fall under the cap.
// ============================================================

Object.keys(prodClassBoundsByKey).forEach(function (key) {
  var b = prodClassBoundsByKey[key];
  if (!b) return;
  if (!(b.classLowerBound <= PROD_LB_GLOBAL + 1)) {
    failures.push(
      'Bug Condition C(X) reproduced on production fixture ' +
      'tests/fixtures/45454.json: ' +
      'classBoundsByProctorKey[' + key + '].classLowerBound = ' +
      b.classLowerBound + ' > LB_global + 1 = ' + (PROD_LB_GLOBAL + 1) + '. ' +
      'Geometry: totalGuardSlots=' + prodTotalGuardSlots +
      ', D_expected=' + PROD_D_EXPECTED +
      ', N_eligible=' + PROD_N_ELIGIBLE +
      ', LB_global=' + PROD_LB_GLOBAL + '. ' +
      'Per-class bounds: G_class=' + b.G_class +
      ', D_expected_class=' + b.D_expected_class +
      ', classUpperBound=' + b.classUpperBound + '. ' +
      'This is one of the six documented singleton-class witnesses on ' +
      'the production fixture (see ' +
      'docs/agent-notes/proctor-v2-singleton-class-bounds.md §"Witness ' +
      'on tests/fixtures/45454.json"). Pre-fix, downstream consumers ' +
      '(collectUncovered, phase2_75CoverageRepair, ' +
      'violatesHardConstraints) treat ' + b.classLowerBound +
      ' as a fairness floor — but no proctor can be assigned ' +
      b.classLowerBound + ' slots when the entire fixture only contains ' +
      prodTotalGuardSlots + ' slots. The fix (Option C — global-fairness ' +
      'floor) caps every per-class classLowerBound at LB_global = ' +
      PROD_LB_GLOBAL + ', eliminating the false-positive ' +
      'coverageRepairWarnings entries (__idx_98, __idx_62, __idx_28, ' +
      '__idx_133, __idx_109, __idx_21) and letting the inner repair loop ' +
      'close طارق\'s genuine deficit. See ' +
      '.kiro/specs/proctor-v2-singleton-class-bounds/design.md ' +
      '§"Fix Strategy: Option C".'
    );
  }
});

// ============================================================
// 7) Deferred failure surface.
//
// Mirrors the deferred-failure pattern from
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`.
// All collected counterexamples (across the singleton-G=10, the
// non-singleton, and the production-fixture-replay cases) are
// surfaced in a single aggregated `assert.fail` so CI logs show every
// failure in one shot.
// ============================================================

if (failures.length) {
  assert.fail('\n  - ' + failures.join('\n  - ') + '\n');
}

console.log('[singleton-class-bounds-exploration] all assertions passed — ' +
  'the bug condition did NOT reproduce. The fix may have already ' +
  'landed, or the synthetic input geometry no longer triggers the bug.');

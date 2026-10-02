'use strict';

// @pre-fix structural test — EXPECTED to FAIL on F until change site #2 lands
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 3 — diagnostics-shape contract for `coverageRepairWarnings`.
//
// This test is INDEPENDENT — it specifies the post-fix shape that
// change site #2 (Task 5/6) must satisfy. Pre-fix `coverageRepairWarnings`
// is an `Array<{proctorKey, reason}>`; post-fix it is an
// `Object<proctorKey, {reason, initialLoad, finalLoad, classLowerBound,
// attemptedSwaps}>` per design.md §"Specific Changes" point 2.
//
// The six structural cases enumerated in design.md §"New Test Files"
// → file 5 are covered below:
//
//   1) Empty warnings on no-uncovered input        → `{}` (post-fix)
//   2) `no_eligible_donor` reason (deficit-2 blocked donors) + payload
//   3) `no_swappable_peer` reason preserved when attemptedSwaps = 0
//   4) `__pass__` synthetic key on pass-throws (catch handler)
//   5) `coverageRepairUnresolved` identity post-fix
//   6) Map shape vs array shape (object, not array)
//
// All six cases run on UNFIXED code; failures are accumulated into a
// shared `failures[]` array and surfaced by a single aggregated
// `assert.fail` at end-of-script (mirrors the deferred-failure pattern
// from `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`).
//
// _Bug_Condition: isBugCondition(X) — diagnostics-shape contract
// _Expected_Behavior: design.md §"Specific Changes" point 2
//                     (diagnostics shape migration)
// _Change site: #2 (diagnostics shape migration),
//               #3 (`coverageRepairUnresolved` re-derivation)
// _Requirements: 2.2, 2.6, 2.7, 2.10, 2.13

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors the exploration test file at lines 70-86.
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
assert.ok(V2._internals &&
  typeof V2._internals.phase2_75CoverageRepair === 'function',
  'V2._internals.phase2_75CoverageRepair missing — test relies on direct ' +
  'invocation of the repair pass for cases 2-4.');

const phase2_75CoverageRepair = V2._internals.phase2_75CoverageRepair;

// ============================================================
// 2) Shared synthetic-input builders
//
// Mirrors the synthetic builders in
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`
// (lines 134-178). Reused for case 1 (V2.run path) only; cases 2-4
// drive `phase2_75CoverageRepair` directly with hand-crafted state to
// avoid Phase-2 eligibility-class confounds.
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

function makeEntry(session) {
  return {
    day: 'الأول',
    period: 'صباحا',
    session: session,
    level_name: 'الثانية بكالوريا',
    subject_name: 'الرياضيات',
    date_day: '10',
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
// 3) Test orchestration helpers
// ============================================================

var failures = [];

function isPlainObjectMap(value) {
  return value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value);
}

function pushFailure(caseLabel, message) {
  failures.push('[' + caseLabel + '] ' + message);
}

// ============================================================
// 4) Case 1 — Empty warnings on no-uncovered input.
//
// Build an input where every proctor reaches classLowerBound after
// Phase 2 — the repair pass enters its main loop, the uncovered set
// is empty, no swaps are attempted, no warnings are emitted.
//
// Layout: 3 proctors (no asymmetric soft-cost stack), 3 sessions × 1
// room × 1 proctor/room = 3 guard slots. Bounds:
//   classLowerBound = floor(3/3) = 1
//   classUpperBound = ceil(3/3)  = 1
// Each proctor receives exactly 1 slot; all reach classLowerBound=1.
//
// Pre-fix: `coverageRepairWarnings = []` (empty array literal).
// Post-fix: `coverageRepairWarnings = {}` (empty object map).
// The structural assertion below FAILS pre-fix because `[]` IS
// `Array.isArray(...) === true` while we require non-array object.
// ============================================================

function buildNoUncoveredInput() {
  var p1 = makeProctor('peer_1', 'CIN_001', 'عام', 'ذكر');
  var p2 = makeProctor('peer_2', 'CIN_002', 'عام', 'ذكر');
  var p3 = makeProctor('peer_3', 'CIN_003', 'عام', 'أنثى');
  return {
    proctorsList: [p1, p2, p3],
    scheduleEntries: [
      makeEntry('الحصة الأولى'),
      makeEntry('الحصة الثانية'),
      makeEntry('الحصة الثالثة')
    ],
    exemptionsData: {},
    dutyData: {},
    meAssignments: { 'CIN_001': 1, 'CIN_002': 1, 'CIN_003': 1 },
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: [makeRoom('R1')],
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: { 'CIN_001': 'عام', 'CIN_002': 'عام', 'CIN_003': 'عام' }
    },
    enablePhase3: false,
    D_expected: 0
  };
}

(function case1_emptyWarningsOnNoUncoveredInput() {
  var input = buildNoUncoveredInput();
  var out = V2.run(input);
  if (!out || !out.diagnostics) {
    pushFailure('case-1', 'V2.run produced no diagnostics on no-uncovered ' +
      'input.');
    return;
  }
  var warnings = out.diagnostics.coverageRepairWarnings;

  console.log('[case-1] no-uncovered input diagnostics:');
  console.log('  coverageRepairSwaps=' + out.diagnostics.coverageRepairSwaps +
    ' coverageRepairUnresolved=' + out.diagnostics.coverageRepairUnresolved);
  console.log('  coverageRepairWarnings type=' + typeof warnings +
    ' isArray=' + Array.isArray(warnings) +
    ' value=' + JSON.stringify(warnings));

  if (!isPlainObjectMap(warnings)) {
    pushFailure('case-1', 'expected coverageRepairWarnings to be a plain ' +
      'object map (post-fix shape per design.md §"Specific Changes" ' +
      'point 2), got ' +
      (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + '). Pre-fix the field is ' +
      'initialized to `[]` on line 3079; post-fix it must be `{}`.');
    return;
  }
  var keys = Object.keys(warnings);
  if (keys.length !== 0) {
    pushFailure('case-1', 'expected coverageRepairWarnings to be empty on ' +
      'no-uncovered input, got ' + keys.length + ' entries: ' +
      JSON.stringify(warnings) + '. The repair pass should not emit any ' +
      'warning when collectUncovered returns an empty list.');
  }
})();

// ============================================================
// 5) Direct-invocation harness for cases 2 / 3 / 4
//
// Cases 2-4 drive `phase2_75CoverageRepair` directly with hand-crafted
// `phase2Result`, `classBoundsByProctorKey`, and `input` — avoiding the
// complexity of engineering specific Phase-2 outputs. The harness is
// deterministic: same input + same rng → same output (no randomness in
// the current pre-fix implementation when no swap candidates exist).
//
// Required `phase2Result` shape (read by the pass):
//   - `assignments`: array of row objects with {proctor_keys, proctors,
//     halfday_key, schedule_entry, ...} fields.
//   - `loadState`: object keyed by proctorKey, each value is a TeacherLoad
//     entry (guardCount, dutyCount, guardHalfdays Set, ...) — the pass
//     reads `getPrimaryLoad(loadState, key) = guardCount + dutyCount`.
//   - `classIdByProctorKey`: object keyed by proctorKey → classId string.
//
// Required `classBoundsByProctorKey` shape:
//   - object keyed by proctorKey → {classLowerBound, classUpperBound, ...}
//
// Required `input` shape (read by the pass body and its callees):
//   - `proctorsList`, `exemptionsData`, `options` (allowHalfdayReuse,
//     allowDayReuse), and the rest is irrelevant for the pass.
// ============================================================

function makeTeacherLoadEntry(guardCount, dutyCount, guardHalfdays) {
  return {
    teacherName: '',
    guardCount: guardCount || 0,
    reserveCount: 0,
    dutyCount: dutyCount || 0,
    guardHalfdays: new Set(guardHalfdays || []),
    reserveHalfdays: new Set(),
    dutyHalfdays: new Set(),
    morningCount: 0,
    afternoonCount: 0
  };
}

function makeRow(halfdayKey, proctorKeys, proctorNames) {
  return {
    halfday_key: halfdayKey,
    proctor_keys: proctorKeys.slice(),
    proctors: (proctorNames || proctorKeys).slice(),
    schedule_entry: {
      day: halfdayKey.split('|')[0],
      period: halfdayKey.split('|')[1] || 'صباحا',
      session: halfdayKey.split('|')[2] || 'الحصة الأولى',
      level_name: 'الثانية بكالوريا',
      subject_name: 'الرياضيات'
    }
  };
}

// ============================================================
// 6) Case 2 — `no_eligible_donor` reason on synthetic deficit-2 with
//    blocked donors.
//
// Construct an input where the deficit-2 proctor (P_uncov) is exempt
// from EVERY row that contains an over-loaded peer. The pass's first
// candidate-build (threshold = upperBound + 1) returns empty because no
// peers exist at that load. The second build (threshold = upperBound)
// returns peers, but `swapPreservesHardConstraints` rejects every
// candidate because of the exemption check on T_uncov against
// `row.schedule_entry`. Result pre-Option-A: `no_swappable_peer` with
// `attemptedSwaps = 0`. Post-Option-A: still `no_swappable_peer` (the
// inner WHILE loop never runs a successful swap, attemptedSwaps = 0).
//
// IMPORTANT: design.md §"Specific Changes" point 2 specifies that
// `no_swappable_peer` is "preserved when attemptedSwaps = 0 for
// backwards-recognizable diagnostics", and `no_eligible_donor` is the
// new reason "when attemptedSwaps > 0 but the inner loop could not
// close the deficit". For case 2, we want to demonstrate the
// `no_eligible_donor` path, which requires at least ONE successful
// swap before the donor pool is exhausted. We engineer that as
// follows: P_uncov has TWO halfdays of access; the first halfday
// allows one swap (one peer at upper bound, one slot eligible); the
// second halfday's only over-loaded peer is in a row from which
// P_uncov is exempt. Result: attemptedSwaps >= 2, finalLoad <= 1
// (rises by 1 from the first swap), reason 'no_eligible_donor'.
//
// Pre-fix this case FAILS because: (a) warnings is still an array, so
// `warnings[key]` lookup returns `undefined`; (b) even when extracted
// via the array shape, the payload fields {initialLoad, finalLoad,
// classLowerBound, attemptedSwaps} do not exist.
// ============================================================

function buildCase2State() {
  var P_KEY = 'P_uncov';
  var DONOR_A = 'donor_A'; // over-loaded in halfday H1, P_uncov can swap in
  var DONOR_B = 'donor_B'; // over-loaded in halfday H2, P_uncov is exempt

  var H1 = 'الأول|صباحا|H1';
  var H2 = 'الثاني|صباحا|H2';

  // Row layout: 2 rows in each halfday. Both peers occupy both rows in
  // their respective halfdays (load=2 each). P_uncov has classLowerBound=2,
  // current guardCount=0 (deficit=2). DONOR_A is at upperBound=2 in H1;
  // DONOR_B is at upperBound=2 in H2. Both peers are eligible donors.
  //
  // P_uncov is NOT exempt from H1 entries → first inner-loop iteration
  // produces a candidate against DONOR_A; the swap succeeds.
  // P_uncov IS exempt from H2 entries (session-scoped exemption) →
  // candidate-build for the second inner-loop iteration finds DONOR_B
  // at upperBound but `swapPreservesHardConstraints` rejects every slot
  // via `isProctorExemptForEntry` → empty candidates → break with
  // `attemptedSwaps >= 2`, `finalLoad = 1`.
  //
  // ASSUMPTION: post-Option-A code's inner WHILE loop counts
  // `attemptedSwaps` per loop iteration (whether or not it produces a
  // candidate). This matches design.md §"Specific Changes" point 1
  // pseudocode line `attemptedSwaps += 1` BEFORE the candidate-build,
  // and the WHILE body itself runs once for the empty-candidate case.

  var rows = [
    makeRow(H1, [DONOR_A], ['donor_A_name']),
    makeRow(H1, [DONOR_A], ['donor_A_name']),
    makeRow(H2, [DONOR_B], ['donor_B_name']),
    makeRow(H2, [DONOR_B], ['donor_B_name'])
  ];

  // loadState — peers at upperBound=2; P_uncov at 0 (deficit=2).
  var loadState = {};
  loadState[DONOR_A] = makeTeacherLoadEntry(2, 0, [H1]);
  loadState[P_KEY]   = makeTeacherLoadEntry(0, 0, []);
  loadState[DONOR_B] = makeTeacherLoadEntry(2, 0, [H2]);

  // All three proctors share a single eligibility class so candidate-
  // build's `classIdByProctorKey[overKey] !== classId` filter passes.
  var classIds = {};
  classIds[DONOR_A] = 'C0';
  classIds[P_KEY]   = 'C0';
  classIds[DONOR_B] = 'C0';

  // classBounds: lowerBound=2, upperBound=2 → P_uncov has deficit=2.
  // upperBound=2 means donors at load=2 are eligible for the second
  // candidate-build threshold (== upperBound, not >upperBound).
  var classBounds = {};
  classBounds[P_KEY]   = { classLowerBound: 2, classUpperBound: 2 };
  classBounds[DONOR_A] = { classLowerBound: 2, classUpperBound: 2 };
  classBounds[DONOR_B] = { classLowerBound: 2, classUpperBound: 2 };

  // proctorsList — `collectUncovered` iterates this. P_uncov first so
  // it's picked up immediately.
  var proctorsList = [
    { teacher_name: 'P_uncov_name', cin: P_KEY, som: '', specialty: 'عام', gender: 'ذكر' },
    { teacher_name: 'donor_A_name', cin: DONOR_A, som: '', specialty: 'عام', gender: 'ذكر' },
    { teacher_name: 'donor_B_name', cin: DONOR_B, som: '', specialty: 'عام', gender: 'ذكر' }
  ];

  // Exemptions — P_uncov is exempt from EVERY session in H2.
  // Format: exemptionsData[scopeKey][exemptionKey] = 'no'.
  // exemptionKey = cin || som || ('idx_' + index). For our P_uncov,
  // cin='P_uncov' so exemptionKey='P_uncov'.
  // scopeKey = ['period', day, period].join('|') for period scope.
  var exemptionsData = {};
  exemptionsData['period|الثاني|صباحا'] = {};
  exemptionsData['period|الثاني|صباحا'][P_KEY] = 'no';

  return {
    phase2Result: {
      assignments: rows,
      loadState: loadState,
      classIdByProctorKey: classIds
    },
    classBounds: classBounds,
    input: {
      proctorsList: proctorsList,
      exemptionsData: exemptionsData,
      dutyData: {},
      options: {
        allowHalfdayReuse: false,
        allowDayReuse: true,
        roomsList: [makeRoom('R1')]
      }
    },
    P_KEY: P_KEY
  };
}

(function case2_noEligibleDonorReason() {
  var s = buildCase2State();
  var rng = function () { return 0.5; };
  var diags;
  try {
    diags = phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
      s.input, rng);
  } catch (err) {
    pushFailure('case-2', 'phase2_75CoverageRepair threw unexpectedly: ' +
      (err && err.message || err));
    return;
  }
  var warnings = diags && diags.warnings;

  console.log('[case-2] deficit-2 blocked-donor diagnostics:');
  console.log('  swaps=' + (diags && diags.swaps) +
    ' unresolved=' + (diags && diags.unresolved));
  console.log('  warnings type=' + typeof warnings +
    ' isArray=' + Array.isArray(warnings) +
    ' value=' + JSON.stringify(warnings));

  if (!isPlainObjectMap(warnings)) {
    pushFailure('case-2', 'expected warnings to be a plain object map ' +
      '(post-fix per design.md §"Specific Changes" point 2). Pre-fix it ' +
      'is `[]` initialized on line 3079, then `Array.push(...)` of ' +
      '{proctorKey, reason} objects. Post-fix it must be `{}` keyed by ' +
      'proctorKey. Got: ' +
      (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + ').');
    return;
  }

  var entry = warnings[s.P_KEY];
  if (!entry || typeof entry !== 'object') {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY + '"] to be a ' +
      'structured payload object, got ' + JSON.stringify(entry) +
      '. The post-fix shape requires per-proctor lookup by canonical key.');
    return;
  }

  // The post-fix contract permits BOTH 'no_eligible_donor' (when
  // attemptedSwaps > 0 but the inner loop could not close the deficit)
  // AND 'no_swappable_peer' (when attemptedSwaps = 0). Per task
  // instructions for case 2, we expect 'no_eligible_donor' specifically.
  // If the implementation chooses 'no_swappable_peer' for the
  // attemptedSwaps > 0 case, that's a contract violation per design.md.
  if (entry.reason !== 'no_eligible_donor') {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY +
      '"].reason = "no_eligible_donor" (deficit-2 with blocked donors, ' +
      'attemptedSwaps > 0); got "' + entry.reason + '". design.md ' +
      '§"Specific Changes" point 2 specifies "no_eligible_donor" is the ' +
      'new reason "when attemptedSwaps > 0 but the inner loop could not ' +
      'close the deficit".');
  }
  if (entry.initialLoad !== 0) {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY +
      '"].initialLoad = 0 (P_uncov enters pass at guardCount=0); got ' +
      JSON.stringify(entry.initialLoad) + '.');
  }
  if (typeof entry.finalLoad !== 'number' || entry.finalLoad > 1) {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY +
      '"].finalLoad <= 1 (one successful swap in H1, second blocked by ' +
      'exemption in H2); got ' + JSON.stringify(entry.finalLoad) + '.');
  }
  if (entry.classLowerBound !== 2) {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY +
      '"].classLowerBound = 2; got ' +
      JSON.stringify(entry.classLowerBound) + '.');
  }
  if (typeof entry.attemptedSwaps !== 'number' || entry.attemptedSwaps < 0) {
    pushFailure('case-2', 'expected warnings["' + s.P_KEY +
      '"].attemptedSwaps >= 0; got ' +
      JSON.stringify(entry.attemptedSwaps) + '.');
  }
})();

// ============================================================
// 7) Case 3 — `no_swappable_peer` reason preserved when attemptedSwaps = 0.
//
// Build a minimal deficit-1 input where the proctor cannot find any
// peer at all on the very first candidate-build. Pre-Option-A: warning
// `no_swappable_peer` recorded. Post-Option-A: same — the inner WHILE
// loop runs ONCE (attemptedSwaps = 1) but candidates is empty so it
// breaks immediately... actually wait. The pseudocode at design.md
// §"Specific Changes" point 1 increments `attemptedSwaps` BEFORE the
// candidate-build, then breaks if candidates.length === 0. So a
// genuinely no-peer input has attemptedSwaps = 1, not 0, in the
// post-fix code.
//
// The task description specifies "no_swappable_peer reason preserved
// when attemptedSwaps = 0". This is an EDGE case of the post-fix
// pseudocode: attemptedSwaps = 0 when the WHILE body never executes,
// which only happens when `getPrimaryLoad >= classLowerBound` already
// holds when the proctor enters the loop. But that contradicts the
// `pending` collection (which only adds proctors with
// getPrimaryLoad < classLowerBound).
//
// The cleanest interpretation is:
//   - "no_swappable_peer" is the reason emitted for a deficit-D proctor
//     whose FIRST candidate-build (and threshold-relaxed retry) returns
//     empty — i.e., attemptedSwaps = 1 in the post-fix counting, OR
//     attemptedSwaps = 0 in the strict pre-fix counting.
//   - Per design.md §"Specific Changes" point 2, the boundary is
//     `attemptedSwaps = 0 ? 'no_swappable_peer' : 'no_eligible_donor'`,
//     which means the post-fix counter increments ONLY on a successful
//     swap (or only when a candidate is actually attempted). The "0"
//     condition fires when the WHILE body's candidate-build returned
//     empty on the FIRST iteration — i.e., no swap was ever attempted.
//
// Build: P_uncov at deficit=1, single halfday with no peers at upperBound
// (every other proctor is at lowerBound). Both candidate-builds return
// empty → no_swappable_peer with attemptedSwaps = 0.
// ============================================================

function buildCase3State() {
  var P_KEY = 'P_only';
  var QUIET_PEER = 'quiet_peer';
  var H1 = 'الأول|صباحا|H1';

  // Single row in H1, occupied by QUIET_PEER. classLowerBound=1,
  // classUpperBound=1. QUIET_PEER is at load=1 (= classUpperBound),
  // so the first candidate-build (threshold = upperBound + 1 = 2)
  // returns empty (no peer at >=2). The second build (threshold =
  // upperBound = 1) returns QUIET_PEER, but
  // swapPreservesHardConstraints rejects because QUIET_PEER is at
  // EXACTLY classLowerBound — donating would drop them below.
  //
  // WAIT: swapPreservesHardConstraints does NOT check donor lower
  // bound — that's `violatesHardConstraints` (called from Phase 3 SA,
  // not from the repair pass). The repair pass's predicate only
  // checks T_uncov-side constraints. So QUIET_PEER WOULD be a valid
  // candidate at threshold=upperBound=1. To force "no candidate", we
  // need to make P_uncov fail T_uncov-side checks: exempt P_only from
  // every halfday in the input.
  //
  // Simplest construction: P_only exempt from H1 entirely. Result: no
  // candidate ever returned. attemptedSwaps = 0 (post-fix), reason
  // 'no_swappable_peer'.

  var rows = [makeRow(H1, [QUIET_PEER], ['quiet_peer_name'])];

  var loadState = {};
  loadState[QUIET_PEER] = makeTeacherLoadEntry(1, 0, [H1]);
  loadState[P_KEY]      = makeTeacherLoadEntry(0, 0, []);

  var classIds = { };
  classIds[QUIET_PEER] = 'C0';
  classIds[P_KEY]      = 'C0';

  var classBounds = {};
  classBounds[P_KEY]      = { classLowerBound: 1, classUpperBound: 1 };
  classBounds[QUIET_PEER] = { classLowerBound: 1, classUpperBound: 1 };

  var proctorsList = [
    { teacher_name: 'P_only_name', cin: P_KEY, som: '', specialty: 'عام', gender: 'ذكر' },
    { teacher_name: 'quiet_peer_name', cin: QUIET_PEER, som: '', specialty: 'عام', gender: 'ذكر' }
  ];

  // Exempt P_only from H1 → swapPreservesHardConstraints rejects every
  // candidate at T_uncov-side check. Note: scopeKey for period scope is
  // `period|<day>|<period>`, with day from row.schedule_entry.day,
  // period from row.schedule_entry.period.
  var exemptionsData = {};
  exemptionsData['period|الأول|صباحا'] = {};
  exemptionsData['period|الأول|صباحا'][P_KEY] = 'no';

  return {
    phase2Result: {
      assignments: rows,
      loadState: loadState,
      classIdByProctorKey: classIds
    },
    classBounds: classBounds,
    input: {
      proctorsList: proctorsList,
      exemptionsData: exemptionsData,
      dutyData: {},
      options: {
        allowHalfdayReuse: false,
        allowDayReuse: true,
        roomsList: [makeRoom('R1')]
      }
    },
    P_KEY: P_KEY
  };
}

(function case3_noSwappablePeerWhenAttemptedSwapsZero() {
  var s = buildCase3State();
  var rng = function () { return 0.5; };
  var diags;
  try {
    diags = phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
      s.input, rng);
  } catch (err) {
    pushFailure('case-3', 'phase2_75CoverageRepair threw unexpectedly: ' +
      (err && err.message || err));
    return;
  }
  var warnings = diags && diags.warnings;

  console.log('[case-3] deficit-1 no-peer diagnostics:');
  console.log('  swaps=' + (diags && diags.swaps) +
    ' unresolved=' + (diags && diags.unresolved));
  console.log('  warnings type=' + typeof warnings +
    ' isArray=' + Array.isArray(warnings) +
    ' value=' + JSON.stringify(warnings));

  if (!isPlainObjectMap(warnings)) {
    pushFailure('case-3', 'expected warnings to be a plain object map ' +
      'post-fix; got ' +
      (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + ').');
    return;
  }

  var entry = warnings[s.P_KEY];
  if (!entry || typeof entry !== 'object') {
    pushFailure('case-3', 'expected warnings["' + s.P_KEY + '"] to be a ' +
      'structured payload object, got ' + JSON.stringify(entry) + '.');
    return;
  }
  if (entry.reason !== 'no_swappable_peer') {
    pushFailure('case-3', 'expected warnings["' + s.P_KEY +
      '"].reason = "no_swappable_peer" (no candidate ever returned, ' +
      'attemptedSwaps = 0); got "' + entry.reason + '".');
  }
  if (entry.attemptedSwaps !== 0) {
    pushFailure('case-3', 'expected warnings["' + s.P_KEY +
      '"].attemptedSwaps = 0 (no-peer case — the inner loop break ' +
      'fires before any candidate build is attempted); got ' +
      JSON.stringify(entry.attemptedSwaps) + '.');
  }
})();

// ============================================================
// 8) Case 4 — `__pass__` synthetic key on pass-throws.
//
// Per design.md §"Specific Changes" point 2 line:
//   "The error-path return on line 3148 ... becomes ...
//    return { ... warnings: { '__pass__': { reason: 'pass_threw',
//    error: ... } } }"
//
// Trigger the pass's top-level try/catch by injecting an `rng` that
// throws. The pre-fix body calls `rng()` inside the `pending.sort`
// tiebreak callback (line 3089-3091), which is INSIDE the try block.
// `pending.sort` throws → the catch handler executes → returns the
// error-path object.
//
// Pre-fix (still array shape): the catch returns
//   `{ swaps: 0, unresolved: 0, durationMs: 0, warnings: [{ reason: 'pass_threw', error: '...' }] }`
// Post-fix (object map shape with synthetic key): the catch returns
//   `{ swaps: 0, unresolved: 0, durationMs: 0, warnings: { '__pass__': { reason: 'pass_threw', error: '...' } } }`
//
// We need a state with at least one uncovered proctor so `pending.sort`
// is reached. Reuse case 2's state for this — it has P_uncov uncovered.
// ============================================================

(function case4_passThrewSyntheticKey() {
  var s = buildCase2State();
  var throwingRng = function () {
    throw new Error('synthetic rng failure for case-4 test');
  };
  var diags;
  try {
    diags = phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
      s.input, throwingRng);
  } catch (err) {
    pushFailure('case-4', 'phase2_75CoverageRepair did not catch the ' +
      'synthetic rng error — it propagated up. The function MUST have ' +
      'a top-level try/catch per line 3142-3149 of the production ' +
      'module. Got: ' + (err && err.message || err));
    return;
  }
  var warnings = diags && diags.warnings;

  console.log('[case-4] pass-threw catch-handler diagnostics:');
  console.log('  swaps=' + (diags && diags.swaps) +
    ' unresolved=' + (diags && diags.unresolved));
  console.log('  warnings type=' + typeof warnings +
    ' isArray=' + Array.isArray(warnings) +
    ' value=' + JSON.stringify(warnings));

  if (!isPlainObjectMap(warnings)) {
    pushFailure('case-4', 'expected catch-path warnings to be a plain ' +
      'object map containing the "__pass__" synthetic key (per design.md ' +
      '§"Specific Changes" point 2). Pre-fix line 3148 returns ' +
      '`warnings: [{ reason: "pass_threw", ... }]` (Array). Post-fix it ' +
      'must be `warnings: { "__pass__": { reason: "pass_threw", ... } }`. ' +
      'Got: ' + (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + ').');
    return;
  }
  var passEntry = warnings['__pass__'];
  if (!passEntry || typeof passEntry !== 'object') {
    pushFailure('case-4', 'expected warnings["__pass__"] to be the ' +
      'synthetic catch-path payload { reason: "pass_threw", error: ... }. ' +
      'Got: ' + JSON.stringify(passEntry) + '. The "__pass__" synthetic ' +
      'key (per design.md §"Glossary") distinguishes "the pass threw" ' +
      'from "a specific proctor failed".');
    return;
  }
  if (passEntry.reason !== 'pass_threw') {
    pushFailure('case-4', 'expected warnings["__pass__"].reason = ' +
      '"pass_threw"; got "' + passEntry.reason + '".');
  }
  // The error field must be present (string-coerced or Error-like).
  if (typeof passEntry.error === 'undefined') {
    pushFailure('case-4', 'expected warnings["__pass__"].error to be ' +
      'present (carrying the caught error). Got undefined.');
  }
})();

// ============================================================
// 9) Cases 5 + 6 — identity / shape assertions across all four states.
//
// Case 5: assert
//   diagnostics.unresolved === Object.keys(warnings)
//                                .filter(k => k !== '__pass__').length
// Case 6: assert
//   typeof warnings === 'object' AND !Array.isArray(warnings)
//
// We re-run the pass on cases 1-4's states and apply the assertions
// to each output. Pre-fix EVERY case fails on case 6 (warnings is
// always an array); cases 5 fails wherever the pre-fix array shape
// breaks the lookup.
// ============================================================

function runAndCollect(label, runner) {
  try {
    var diags = runner();
    return { label: label, diags: diags };
  } catch (err) {
    return { label: label, diags: null, err: err };
  }
}

var allRuns = [];

// Case 1's run: V2.run shape — diagnostics.coverageRepairWarnings.
(function () {
  var input = buildNoUncoveredInput();
  var out = V2.run(input);
  var diags = out && out.diagnostics;
  // Adapt to a uniform shape (the pass-internal key is `warnings`,
  // the orchestrator-exported key is `coverageRepairWarnings`; map
  // both to a common `warnings` field for the cross-case assertions).
  if (diags) {
    diags = {
      swaps: diags.coverageRepairSwaps,
      unresolved: diags.coverageRepairUnresolved,
      warnings: diags.coverageRepairWarnings
    };
  }
  allRuns.push({ label: 'run1-V2.run-no-uncovered', diags: diags });
})();

// Case 2's run: direct invocation, deficit-2 with blocked donors.
(function () {
  var s = buildCase2State();
  var rng = function () { return 0.5; };
  allRuns.push(runAndCollect('run2-direct-deficit-2-blocked',
    function () {
      return phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
        s.input, rng);
    }));
})();

// Case 3's run: direct invocation, deficit-1 no-peer.
(function () {
  var s = buildCase3State();
  var rng = function () { return 0.5; };
  allRuns.push(runAndCollect('run3-direct-deficit-1-no-peer',
    function () {
      return phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
        s.input, rng);
    }));
})();

// Case 4's run: direct invocation, throwing rng → catch handler.
(function () {
  var s = buildCase2State();
  var throwingRng = function () {
    throw new Error('synthetic rng failure for case-5/6 cross-check');
  };
  allRuns.push(runAndCollect('run4-direct-pass-threw',
    function () {
      return phase2_75CoverageRepair(s.phase2Result, {}, s.classBounds,
        s.input, throwingRng);
    }));
})();

// ----- Case 6 — Map shape (object, not array) across all four runs.
allRuns.forEach(function (r) {
  if (r.err) {
    pushFailure('case-6', '[' + r.label + '] run threw: ' +
      (r.err && r.err.message || r.err));
    return;
  }
  if (!r.diags) {
    pushFailure('case-6', '[' + r.label + '] no diagnostics returned.');
    return;
  }
  var w = r.diags.warnings;
  if (typeof w !== 'object' || w === null) {
    pushFailure('case-6', '[' + r.label + '] expected typeof warnings ' +
      '=== "object" (post-fix); got ' + (w === null ? 'null' : typeof w) +
      ' (value=' + JSON.stringify(w) + ').');
    return;
  }
  if (Array.isArray(w)) {
    pushFailure('case-6', '[' + r.label + '] expected ' +
      '!Array.isArray(warnings) (post-fix shape per design.md ' +
      '§"Specific Changes" point 2). Pre-fix it IS an array — this is ' +
      'the structural marker that change site #2 has not yet landed. ' +
      'Got Array of length ' + w.length + ': ' + JSON.stringify(w) + '.');
  }
});

// ----- Case 5 — `unresolved` identity across all four runs.
//
// Identity (post-fix per design.md §"Specific Changes" point 3):
//   diagnostics.unresolved === Object.keys(warnings)
//                                .filter(k => k !== '__pass__').length
//
// Applied universally (no array-shape gate) so the assertion fires on F
// too. Pre-fix breakdown:
//   - run1 (no-uncovered):    unresolved=0, []      → 0===0 (coincidental ✓)
//   - run2 (deficit-2):       unresolved=1, ['0']   → 1===1 (coincidental ✓)
//   - run3 (deficit-1):       unresolved=1, ['0']   → 1===1 (coincidental ✓)
//   - run4 (catch path):      unresolved=0, ['0']   → 0!==1 (FAILS pre-fix)
// At least run4's catch path violates the identity pre-fix — the
// per-attempt array-push semantics of the pre-fix code emit a synthetic
// pass_threw entry without bumping the `unresolved` counter, so
// |array| !== unresolved. Post-fix the catch path becomes
// `{ '__pass__': {...} }` whose filtered key count is 0 = unresolved ✓.
allRuns.forEach(function (r) {
  if (r.err || !r.diags) return; // already reported by case-6
  var w = r.diags.warnings;
  if (typeof w !== 'object' || w === null) return;
  // Object.keys works on both arrays (returns numeric-string indices)
  // and plain objects (returns property names). Either way, the
  // filtered length is the structural quantity we want.
  var nonPassKeys = Object.keys(w).filter(function (k) {
    return k !== '__pass__';
  });
  if (r.diags.unresolved !== nonPassKeys.length) {
    pushFailure('case-5', '[' + r.label + '] expected ' +
      'diagnostics.unresolved === Object.keys(warnings).filter(k => ' +
      'k !== "__pass__").length. Got unresolved=' + r.diags.unresolved +
      ' but |non-__pass__ keys|=' + nonPassKeys.length +
      ' (keys=' + JSON.stringify(Object.keys(w)) +
      ', warnings=' + JSON.stringify(w) + '). design.md ' +
      '§"Specific Changes" point 3 specifies this identity. Pre-fix the ' +
      'catch handler at line 3148 returns `warnings: [{reason:"pass_threw"}]` ' +
      'without bumping `unresolved`, so identity 0 !== 1 fires. Post-fix ' +
      'the catch handler returns `warnings: { "__pass__": {...} }` and ' +
      'the filter on "__pass__" recovers the 0 === 0 identity.');
  }
});

// ============================================================
// 10) End-of-script: surface collected counterexamples.
// ============================================================

console.log('');
console.log('[warnings-shape-test] failures collected: ' + failures.length);

if (failures.length > 0) {
  assert.fail('phase2_75CoverageRepair coverageRepairWarnings shape ' +
    'contract — ' + failures.length + ' counterexample(s):\n\n' +
    failures.map(function (m, i) { return '(' + (i + 1) + ') ' + m; })
      .join('\n\n'));
}

console.log('[warnings-shape-test] all 6 structural cases passed — ' +
  'shape contract is locked.');

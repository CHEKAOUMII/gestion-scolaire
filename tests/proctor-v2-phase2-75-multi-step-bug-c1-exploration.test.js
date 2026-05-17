'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on F.
//
// ============================================================
// Task 1.4 baseline — captured 2026-05-16 on UNFIXED code.
//
// Verbatim output of `node scripts/inspect-fixture-state.js`
// against tests/fixtures/45454.json on the post-key-shape-
// unification, pre-multi-step-repair codebase:
//
//   histogram: {"2":56,"3":90}
//   min: 2 max: 3 distinct: 146
//   coverageRepairSwaps: 17 coverageRepairUnresolved: 6
//   lowerBound: 2 upperBound: 3
//   zero-load proctors: 1
//     idx=98 طارق الشعابتي (som=2270221, dutyCount=1)
//   proctors at load=1 count: 0
//
// Cross-reference: bugfix.md §"Bug Condition C(X)" →
// "Diagnostic readings on the same fixture" quotes `min: 0`.
// The two values describe DIFFERENT domains:
//   - script's `min: 2`  = min over LOADED proctors (146/147 — the
//     147th does not appear in `perKey`, so `Object.values(perKey)`
//     does not see his load=0 entry).
//   - bugfix.md `min: 0` = min over ALL 147 proctors (the conceptual
//     primaryLoad minimum, which DOES include طارق الشعابتي at 0).
// Both readings are consistent and pinpoint the same witness:
// `zero-load proctors: 1` — idx=98 طارق الشعابتي (som=2270221,
// dutyCount=1). Every other field matches the documented snapshot
// EXACTLY: histogram {2:56, 3:90}, distinct 146, swaps 17,
// unresolved 6, bounds 2/3, deficit-1 closure complete (0 at load=1).
//
// Post-fix expectation (Task 7.5 will compare): `zero-load
// proctors: 0`, `coverageRepairUnresolved: 0`, histogram tightens
// from {2:56, 3:90} (146) to a 147-distinct distribution where
// every entry is >= classLowerBound=2.
// ============================================================
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 1.1 — Bug Condition C(X) (synthetic deficit-2 unit case).
//
// `phase2_75CoverageRepair` performs at most ONE swap per round per pending
// uncovered proctor. When a proctor's deficit is 2 (load=0,
// classLowerBound=2), round 1 fires one swap (load → 1). Round 2 cannot
// swap further because every donor row sits in the same halfday where
// round 1 placed the proctor — `swapPreservesHardConstraints` rejects
// every candidate via `!allowHalfdayReuse + isKeyUsedInHalfday`. The pass
// records `no_swappable_peer` for the proctor, sets `seenUnresolvedKeys`,
// `roundSwaps=0` triggers the outer-loop break, and the proctor exits at
// load=1, strictly below classLowerBound=2.
//
// DO NOT attempt to "fix" this test if it fails — the failure IS the
// counterexample that confirms the bug exists. The single-swap-per-round
// structural limit fired exactly once, refuting alternative root causes
// (donor-eligibility, exemption interaction, duty interaction).
//
// _Validates: Bug Condition isBugCondition(X) — synthetic deficit-2 case
// _Validates: Property 1 — P-1, P-2 (multi-step closure)
// _Validates: Requirements 1.1, 1.2, 1.3, 2.1, 2.4, 2.12

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 12–22 of scripts/verify-real-centre.js
//    and tests/proctor-v2-fairness-undercovered-exploration.test.js.
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
// 2) Synthetic deficit-2 input builder.
//
// 4 proctors, 1 halfday (الأول|صباحا), 3 sessions × 3 rooms × 1
// proctor/room = 9 guard slots. Class bounds derived by the algorithm:
//   classLowerBound = floor(9/4) = 2
//   classUpperBound = ceil(9/4)  = 3
//
// Phase 2 yields one proctor at primaryLoad=0 and three peers at
// primaryLoad=3 (=classUpperBound). The asymmetry is engineered with two
// soft-cost stacks on the deficit-2 candidate:
//
//   - specialty = subject of every entry          → avoidSpecialty +2
//   - meAssignments group = 2 (mismatches morning) → groupMismatch +5
//
// Total per-task soft penalty for P_uncov = +7, decisively above peers'
// +0.5 freshness penalty (peers' specialty='عام', ME group=1).
//
// Sessions within the same halfday are SEQUENTIAL (per V2's
// `filterAvailableProctors` comment block), so the same peer may be
// assigned across all three sessions despite `allowHalfdayReuse=false`
// — the no-reuse rule binds across halfdays only. P_uncov is therefore
// never the cheapest pick: peers fill all 9 slots, P_uncov ends Phase 2
// at guardCount=0, dutyCount=0, primaryLoad=0.
//
// Repair pass on UNFIXED code:
//   Round 1: collectUncovered → [P_uncov] (load=0 < 2).
//            candidates(threshold=4) → empty (peers at 3, not 4+).
//            candidates(threshold=3) → 9 (row, slot) pairs (every peer
//            slot is eligible — P_uncov is not yet placed in H1).
//            applyCoverageSwap on row 0 slot 0 (peer A → P_uncov).
//            P_uncov now in H1 at guardCount=1; A drops to 2.
//            roundSwaps=1.
//   Round 2: collectUncovered → [P_uncov] (load=1 < 2).
//            candidates(threshold=4) → empty.
//            candidates(threshold=3) → peers B and C still at load=3
//            (and peer A still surfacing at load=3 because the per-slot
//            decrement in `removeGuardLoad` only fires when the donor
//            leaves the halfday entirely — A still sits in row 3 and 6).
//            For every candidate row, `swapPreservesHardConstraints`
//            calls `isKeyUsedInHalfday(rows, H1, P_uncov, row, slot)`.
//            P_uncov is in row 0 slot 0 of H1 → returned true for every
//            other row in H1 → ALL 8 candidate slots REJECTED.
//            (The 9th candidate is row 0 slot 0 itself, now occupied by
//            P_uncov — its `overKey` resolves to P_uncov, fails the
//            `getPrimaryLoad >= 3` peer check, and is filtered out.)
//            no_swappable_peer → seenUnresolvedKeys[P_uncov]=true.
//            unresolved++. roundSwaps=0.
//   Outer loop: roundSwaps===0 → break.
//
// Final pre-fix output: coverageRepairSwaps=1, coverageRepairUnresolved=1,
// P_uncov.guardCount=1. The universal assertion below — getPrimaryLoad
// >= classLowerBound — FAILS. That failure is the counterexample.
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

function buildSyntheticDeficit2Input() {
  // Three peers — generalists (specialty='عام'), ME group=1 (matches morning).
  var peerA = makeProctor('peer_A', 'CIN_A001', 'عام', 'ذكر');
  var peerB = makeProctor('peer_B', 'CIN_B002', 'عام', 'ذكر');
  var peerC = makeProctor('peer_C', 'CIN_C003', 'عام', 'ذكر');

  // The deficit-2 candidate. specialty matches subject (+2 avoidSpecialty)
  // AND ME group = 2 mismatches morning halfday (+5 groupMismatch).
  // Total soft cost +7, well above peers' +0.5 freshness penalty.
  var pUncov = makeProctor('p_uncov', 'CIN_P099', 'الرياضيات', 'أنثى');

  // Three sessions in the SAME halfday (الأول|صباحا). Sessions inside a
  // halfday are sequential, so the same peer may appear in all three.
  var entries = [
    makeEntry('الحصة الأولى'),
    makeEntry('الحصة الثانية'),
    makeEntry('الحصة الثالثة')
  ];

  // Three rooms — every entry yields 3 (entry, room) tasks.
  // proctorsPerRoom=1 → 3 sessions × 3 rooms × 1 = 9 guard slots.
  var rooms = [makeRoom('R1'), makeRoom('R2'), makeRoom('R3')];

  var proctorSpecialties = {
    'CIN_A001': 'عام',
    'CIN_B002': 'عام',
    'CIN_C003': 'عام',
    'CIN_P099': 'الرياضيات'
  };

  var meAssignments = {
    'CIN_A001': 1, 'CIN_B002': 1, 'CIN_C003': 1,
    'CIN_P099': 2
  };

  return {
    proctorsList: [peerA, peerB, peerC, pUncov],
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
      // CRITICAL: allowHalfdayReuse=false is what traps round 2's swap.
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: proctorSpecialties
    },
    enablePhase3: false, // Phase 3 is irrelevant — bug is in Phase 2.75.
    D_expected: 0
  };
}

// ============================================================
// 3) Run the algorithm.
// ============================================================

const input = buildSyntheticDeficit2Input();
const out = V2.run(input);
assert.ok(out && out.result && out.diagnostics,
  'V2.run produced no result/diagnostics on synthetic deficit-2 input');

const d = out.diagnostics;
const classBounds = d.classBounds || {};
const P_KEY = 'CIN_P099';

// `diagnostics.classBounds` is keyed by classId (e.g. "0,1,2|0"), not
// proctorKey. Our synthetic input has all 4 proctors in a single
// eligibility class (no exemptions, no duty, identical schedule access),
// so the only entry in classBounds carries P_uncov's bounds. Pick it.
const classBoundsKeys = Object.keys(classBounds);
const pBounds = classBoundsKeys.length === 1
  ? classBounds[classBoundsKeys[0]]
  : null;

// Reconstruct slot loads from the assignments graph (slot-metric
// semantics — count each appearance, mirrors lines 70–80 of
// scripts/verify-real-centre.js).
var slotCount = Object.create(null);
for (var i = 0; i < out.result.length; i++) {
  var keys = out.result[i].proctor_keys || [];
  for (var j = 0; j < keys.length; j++) {
    var k = keys[j];
    if (k) slotCount[k] = (slotCount[k] || 0) + 1;
  }
}

const loadA = slotCount['CIN_A001'] || 0;
const loadB = slotCount['CIN_B002'] || 0;
const loadC = slotCount['CIN_C003'] || 0;
const loadP = slotCount['CIN_P099'] || 0;

// ============================================================
// 4) Diagnostic snapshot — printed for human review and to lock the
//    counterexample in CI logs when the universal assertion fails.
// ============================================================

console.log('[deficit-2-exploration] synthetic input diagnostics:');
console.log('  proctors=4 | sessions=3 | rooms=3 | rows=' + out.result.length);
console.log('  classLowerBound=' + (pBounds && pBounds.classLowerBound) +
  ' classUpperBound=' + (pBounds && pBounds.classUpperBound));
console.log('  coverageRepairSwaps=' + d.coverageRepairSwaps +
  ' coverageRepairUnresolved=' + d.coverageRepairUnresolved +
  ' coverageRepairWarnings=' +
  JSON.stringify(d.coverageRepairWarnings || []));
console.log('  loads (slot-metric):  A=' + loadA + '  B=' + loadB +
  '  C=' + loadC + '  P_uncov=' + loadP);

// ============================================================
// 5) Universal Bug-Condition Assertion (THE COUNTEREXAMPLE).
//
// Property: every proctor whose classLowerBound ≥ 1 SHALL satisfy
//   getPrimaryLoad(loadState, key) >= classLowerBound
// after `phase2_75CoverageRepair` returns.
//
// Pre-fix (unfixed code), this property FAILS for P_uncov: load=1 < 2.
// The failure message records the exact counterexample.
//
// Post-fix (Option A inner loop + structured warnings), this property
// PASSES — either P_uncov reaches load >= 2 OR the pass records a
// structured `no_eligible_donor` warning under
// coverageRepairWarnings[P_uncov]. Task 4's fix-checking test asserts
// the structured warning explicitly.
// ============================================================

// Deferred-failure pattern: collect failures from BOTH the deficit-2 and
// the appended deficit-3 case (Task 1.2), then throw at end-of-script.
// This ensures the deficit-3 case actually runs on UNFIXED code so its
// counterexample surfaces empirically — without it, the deficit-2 throw
// would halt execution and Task 1.2's "structural cap is independent of
// D" demonstration would be analytical-only. The deficit-2 case's input
// construction, V2.run invocation, and diagnostics computation above are
// unchanged; only the THROW is deferred via the failures[] accumulator.
var failures = [];

(function assertDeficit2() {
  if (!pBounds) {
    failures.push('[setup-d2] expected diagnostics.classBounds[' + P_KEY +
      '] to be set (classBounds=' + JSON.stringify(classBounds) + '). ' +
      'If this fails, Phase 2 did not assign P_uncov a class — the ' +
      'synthetic input no longer triggers the bug.');
    return;
  }
  if (!(loadP >= pBounds.classLowerBound)) {
    failures.push(
      'Bug Condition C(X) reproduced on synthetic deficit-2 input: ' +
      'P_uncov ended phase2_75CoverageRepair at primaryLoad=' + loadP +
      ' but classLowerBound=' + pBounds.classLowerBound + '. ' +
      'Diagnostics: coverageRepairSwaps=' + d.coverageRepairSwaps +
      ', coverageRepairUnresolved=' + d.coverageRepairUnresolved +
      ', coverageRepairWarnings=' +
      JSON.stringify(d.coverageRepairWarnings || []) +
      '. Peer loads after pass: A=' + loadA + ' B=' + loadB + ' C=' + loadC +
      '. The single-swap-per-round structural limit fired exactly once ' +
      '(round 1 placed P_uncov in halfday الأول|صباحا at load=1); ' +
      'round 2 was blocked by allowHalfdayReuse=false because every donor ' +
      'row sits in the same halfday as P_uncov\'s round-1 placement, so ' +
      '`isKeyUsedInHalfday` rejected all candidates → no_swappable_peer → ' +
      'seenUnresolvedKeys[P_uncov]=true → outer loop broke at roundSwaps=0. ' +
      'This isolates the bug to the per-pending-proctor single-swap budget ' +
      '(Option A: inner repair loop), and refutes alternative root causes: ' +
      '(a) donor-eligibility — donors are abundant (3 peers at upperBound); ' +
      '(b) exemption interaction — no exemptions in input; ' +
      '(c) duty interaction — no duty in input.'
    );
  } else {
    console.log('[deficit-2-exploration] (unexpected) bug condition did ' +
      'not reproduce — P_uncov reached classLowerBound. The multi-step ' +
      'fix may have already landed.');
  }
})();

// ============================================================
// 6) Deficit-3 case (Task 1.2) — synthetic single-halfday trap.
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 1.2 — Bug Condition C(X) (synthetic deficit-3 unit case).
//
// Goal: scale the deficit-2 demonstration to D=3 and confirm the
// single-swap-per-pending-proctor structural cap is INDEPENDENT of D.
// Pre-fix the cap fires once at round 1 and is held across subsequent
// rounds by the halfday-reuse rejection — exactly as in Task 1.1, but
// now with a wider gap (load=1 vs classLowerBound=3 instead of
// load=1 vs classLowerBound=2). The same isolation logic refutes
// donor-eligibility / exemption / duty as alternative root causes.
//
// Layout: 5 proctors, 4 sessions × 4 rooms × 1 proctor/room = 16 guard
// slots, all in the SAME halfday (الأول|صباحا). Class bounds derived
// by the algorithm:
//   classLowerBound = floor(16 / 5) = 3
//   classUpperBound = ceil(16 / 5)  = 4
//
// Phase 2 yields one proctor (P_uncov_d3) at primaryLoad=0 and four
// peers at primaryLoad ∈ {3, 4}. The over-loaded peers (load=4) serve
// as donors. The asymmetry that keeps P_uncov_d3 at load=0 is the
// same soft-cost stack as in Task 1.1:
//   - specialty = subject of every entry          → avoidSpecialty +2
//   - meAssignments group = 2 (mismatches morning) → groupMismatch +5
// Total per-task soft penalty for P_uncov_d3 = +7, decisively above
// peers' +0.5 freshness penalty.
//
// On the user's "DISTINCT halfdays" wording: a multi-halfday distinct-
// donor layout would NOT reproduce the bug, because pre-fix's outer
// round loop iterates 3 rounds and closes the deficit (the only
// dedupe trigger fires on round-N FAILURE, never on success). The
// structural single-swap cap is most reliably demonstrated by the
// single-halfday halfday-reuse trap — which scales cleanly from D=2
// (Task 1.1) to D=3 here.
//
// Repair pass on UNFIXED code:
//   Round 1: pending=[P_uncov_d3]. candidates(threshold=5) → empty
//            (peers at 4, not 5+). candidates(threshold=4) → 16
//            (row, slot) pairs. applyCoverageSwap on (row 0, slot 0).
//            P_uncov_d3 placed in H1 at load=1; peer dropped to 3.
//            roundSwaps=1.
//   Round 2: pending=[P_uncov_d3] (load=1 < 3). For every candidate
//            row, swapPreservesHardConstraints calls
//            isKeyUsedInHalfday(rows, H1, P_uncov_d3, row, slot).
//            P_uncov_d3 is in row 0 slot 0 of H1 → returned true for
//            every other row in H1 → ALL 15 candidate slots REJECTED.
//            (Row 0 slot 0 itself fails the peer-eligibility filter
//            because P_uncov_d3 sits there now and is not over-loaded.)
//            no_swappable_peer → seenUnresolvedKeys[P_uncov_d3]=true.
//            unresolved++. roundSwaps=0.
//   Outer loop: roundSwaps===0 → break.
//
// Final pre-fix output: coverageRepairSwaps=1, coverageRepairUnresolved=1,
// P_uncov_d3.guardCount=1. Universal assertion getPrimaryLoad >=
// classLowerBound=3 FAILS — same shape as Task 1.1's failure but with
// gap=2 instead of gap=1, confirming the cap is independent of D.
//
// _Validates: Bug Condition isBugCondition(X) — synthetic deficit-3 case
//             (theoretical max — design.md §"Examples")
// _Validates: Property 1 — P-1, P-2 (multi-step closure)
// _Validates: Requirements 1.1, 1.2, 2.1, 2.4
// ============================================================

function buildSyntheticDeficit3Input() {
  // Four peers — generalists (specialty='عام'), ME group=1 (matches morning).
  var d3_peerA = makeProctor('peer_A_d3', 'CIN_DA01', 'عام', 'ذكر');
  var d3_peerB = makeProctor('peer_B_d3', 'CIN_DB02', 'عام', 'ذكر');
  var d3_peerC = makeProctor('peer_C_d3', 'CIN_DC03', 'عام', 'ذكر');
  var d3_peerD = makeProctor('peer_D_d3', 'CIN_DD04', 'عام', 'ذكر');

  // The deficit-3 candidate. Same +7 soft-cost stack as Task 1.1's
  // P_uncov: specialty matches subject (+2 avoidSpecialty) AND ME group
  // = 2 mismatches morning halfday (+5 groupMismatch).
  var d3_pUncov = makeProctor('p_uncov_d3', 'CIN_PD99', 'الرياضيات', 'أنثى');

  // Four sessions in the SAME halfday (الأول|صباحا). Sessions inside a
  // halfday are sequential, so the same peer may appear in all four.
  var d3_entries = [
    makeEntry('الحصة الأولى'),
    makeEntry('الحصة الثانية'),
    makeEntry('الحصة الثالثة'),
    makeEntry('الحصة الرابعة')
  ];

  // Four rooms — every entry yields 4 (entry, room) tasks.
  // proctorsPerRoom=1 → 4 sessions × 4 rooms × 1 = 16 guard slots.
  var d3_rooms = [
    makeRoom('R1'), makeRoom('R2'), makeRoom('R3'), makeRoom('R4')
  ];

  var d3_proctorSpecialties = {
    'CIN_DA01': 'عام',
    'CIN_DB02': 'عام',
    'CIN_DC03': 'عام',
    'CIN_DD04': 'عام',
    'CIN_PD99': 'الرياضيات'
  };

  var d3_meAssignments = {
    'CIN_DA01': 1, 'CIN_DB02': 1, 'CIN_DC03': 1, 'CIN_DD04': 1,
    'CIN_PD99': 2
  };

  return {
    proctorsList: [d3_peerA, d3_peerB, d3_peerC, d3_peerD, d3_pUncov],
    scheduleEntries: d3_entries,
    exemptionsData: {},
    dutyData: {},
    meAssignments: d3_meAssignments,
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: d3_rooms,
      // CRITICAL: allowHalfdayReuse=false is what traps round 2's swap.
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: d3_proctorSpecialties
    },
    enablePhase3: false,
    D_expected: 0
  };
}

// ============================================================
// 7) Run the deficit-3 algorithm.
// ============================================================

const inputD3 = buildSyntheticDeficit3Input();
const outD3 = V2.run(inputD3);
assert.ok(outD3 && outD3.result && outD3.diagnostics,
  'V2.run produced no result/diagnostics on synthetic deficit-3 input');

const dD3 = outD3.diagnostics;
const classBoundsD3 = dD3.classBounds || {};
const P_KEY_D3 = 'CIN_PD99';

// Like the deficit-2 case: all 5 proctors share a single eligibility
// class (no exemptions, no duty, identical access), so classBounds
// has exactly one entry that carries P_uncov_d3's bounds.
const classBoundsKeysD3 = Object.keys(classBoundsD3);
const pBoundsD3 = classBoundsKeysD3.length === 1
  ? classBoundsD3[classBoundsKeysD3[0]]
  : null;

// Reconstruct slot loads from the assignments graph (slot-metric
// semantics, mirrors §3 above).
var slotCountD3 = Object.create(null);
for (var iD3 = 0; iD3 < outD3.result.length; iD3++) {
  var keysD3 = outD3.result[iD3].proctor_keys || [];
  for (var jD3 = 0; jD3 < keysD3.length; jD3++) {
    var kD3 = keysD3[jD3];
    if (kD3) slotCountD3[kD3] = (slotCountD3[kD3] || 0) + 1;
  }
}

const loadA_d3 = slotCountD3['CIN_DA01'] || 0;
const loadB_d3 = slotCountD3['CIN_DB02'] || 0;
const loadC_d3 = slotCountD3['CIN_DC03'] || 0;
const loadD_d3 = slotCountD3['CIN_DD04'] || 0;
const loadP_d3 = slotCountD3['CIN_PD99'] || 0;

// ============================================================
// 8) Diagnostic snapshot (deficit-3).
// ============================================================

console.log('[deficit-3-exploration] synthetic input diagnostics:');
console.log('  proctors=5 | sessions=4 | rooms=4 | rows=' + outD3.result.length);
console.log('  classLowerBound=' + (pBoundsD3 && pBoundsD3.classLowerBound) +
  ' classUpperBound=' + (pBoundsD3 && pBoundsD3.classUpperBound));
console.log('  coverageRepairSwaps=' + dD3.coverageRepairSwaps +
  ' coverageRepairUnresolved=' + dD3.coverageRepairUnresolved +
  ' coverageRepairWarnings=' +
  JSON.stringify(dD3.coverageRepairWarnings || []));
console.log('  loads (slot-metric):  A=' + loadA_d3 + '  B=' + loadB_d3 +
  '  C=' + loadC_d3 + '  D=' + loadD_d3 + '  P_uncov_d3=' + loadP_d3);

// ============================================================
// 9) Universal Bug-Condition Assertion (DEFICIT-3 COUNTEREXAMPLE).
//
// Property: every proctor whose classLowerBound ≥ 1 SHALL satisfy
//   getPrimaryLoad(loadState, key) >= classLowerBound
// after `phase2_75CoverageRepair` returns.
//
// Pre-fix this property FAILS for P_uncov_d3 at load=1, gap=2 below
// classLowerBound=3. The single-swap-per-pending-proctor cap is
// confirmed to fire EXACTLY ONCE regardless of deficit — the gap
// between final load (1) and classLowerBound (3) is wider than the
// deficit-2 case (1 vs 2) but the swap count is identical (1).
// This is the structural-cap-is-independent-of-D demonstration.
// ============================================================

(function assertDeficit3() {
  if (!pBoundsD3) {
    failures.push('[setup-d3] expected diagnostics.classBounds[' +
      P_KEY_D3 + '] to be set (classBounds=' +
      JSON.stringify(classBoundsD3) + '). ' +
      'If this fails, Phase 2 did not assign P_uncov_d3 a class — the ' +
      'synthetic input no longer triggers the bug.');
    return;
  }
  if (!(loadP_d3 >= pBoundsD3.classLowerBound)) {
    failures.push(
      'Bug Condition C(X) reproduced on synthetic deficit-3 input: ' +
      'P_uncov_d3 ended phase2_75CoverageRepair at primaryLoad=' + loadP_d3 +
      ' but classLowerBound=' + pBoundsD3.classLowerBound + '. ' +
      'Diagnostics: coverageRepairSwaps=' + dD3.coverageRepairSwaps +
      ', coverageRepairUnresolved=' + dD3.coverageRepairUnresolved +
      ', coverageRepairWarnings=' +
      JSON.stringify(dD3.coverageRepairWarnings || []) +
      '. Peer loads after pass: A=' + loadA_d3 + ' B=' + loadB_d3 +
      ' C=' + loadC_d3 + ' D=' + loadD_d3 +
      '. The single-swap-per-pending-proctor structural cap fired ' +
      'EXACTLY ONCE for P_uncov_d3 (round 1: P_uncov_d3 placed in ' +
      'halfday الأول|صباحا at load=1); round 2 was blocked by ' +
      'allowHalfdayReuse=false because every donor row sits in the same ' +
      'halfday as P_uncov_d3\'s round-1 placement, so ' +
      '`isKeyUsedInHalfday` rejected all candidates → no_swappable_peer → ' +
      'seenUnresolvedKeys[P_uncov_d3]=true → outer loop broke at ' +
      'roundSwaps=0. Compared with the deficit-2 case (Task 1.1, gap=1): ' +
      'the swap count is IDENTICAL (1) but the gap is DOUBLED (2 vs 1) — ' +
      'this confirms the structural cap is INDEPENDENT of D and refutes ' +
      'any "the bug only manifests at deficit-2 due to bound arithmetic" ' +
      'hypothesis. The same alternative-cause refutations as Task 1.1 ' +
      'apply: (a) donor-eligibility — donors are abundant (4 peers); ' +
      '(b) exemption interaction — no exemptions in input; ' +
      '(c) duty interaction — no duty in input.'
    );
  } else {
    console.log('[deficit-3-exploration] (unexpected) bug condition did ' +
      'not reproduce — P_uncov_d3 reached classLowerBound. The ' +
      'multi-step fix may have already landed.');
  }
})();

// ============================================================
// 10) Production-fixture replay case (Task 1.3) — طارق الشعابتي at load=0
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 1.3 — Bug Condition C(X) (production fixture replay).
//
// Replay tests/fixtures/45454.json — the post-key-shape-unification
// production fixture that motivated this entire spec. After all three
// closed specs landed (`proctor-v2-fairness-undercovered-fix`,
// `proctor-distribution-db-memory-mismatch`,
// `proctor-v2-key-shape-unification`), exactly one proctor — idx=98
// طارق الشعابتي, som=2270221, dutyCount=1 — ends Phase 2 at
// guardCount=0. Phase 2 honestly excludes him from his duty halfday
// (الأول|صباحا|الحصة الأولى|الفيزياء والكيمياء) per the unified
// key-shape contract. The remaining halfdays do not yield enough
// cost-cheap eligible assignments for the Hungarian solver to place
// him at load>=2. The repair pass then confronts a genuine deficit-2
// case and fails per the same single-swap-per-round structural cap
// demonstrated in the synthetic cases above.
//
// Pre-fix diagnostic snapshot (captured 2026-05-16 via
// `node scripts/inspect-fixture-state.js`):
//   histogram (over LOADED proctors): {"2": 56, "3": 90}
//   distinct (loaded):                146  (out of 147)
//   min(loadState over all 147):      0    ← طارق at load=0
//   max:                               3
//   coverageRepairSwaps:              17   ← 17 deficit-1 cases close
//   coverageRepairUnresolved:          6
//   classLowerBound:                   2
//   classUpperBound:                   3
//   zero-load proctors:                1
//     idx=98 طارق الشعابتي (som=2270221, dutyCount=1)
//
// CIN STATS — every proctor in fixture 45454.json has cin="" (empty
// string). `getProctorKey(proc, idx)` resolves empty-string to falsy
// and returns `'__idx_' + idx` for ALL 147 proctors. Slot loads below
// are reconstructed using `__idx_N` keys, mirroring lines 70–80 of
// scripts/verify-real-centre.js and section 4 of
// tests/proctor-v2-fairness-undercovered-exploration.test.js.
//
// The pre-fix universal assertion FAILS at idx=98 (load=0 < 2) and
// at coverageRepairUnresolved (6 ≠ 0); failures push to the shared
// `failures[]` accumulator that section 14 below aggregates. Post-fix
// the inner repair loop closes طارق's deficit-2 to load>=2 and the
// assertions pass.
//
// _Validates: Bug Condition isBugCondition(X) — production fixture
//             (idx=98 طارق الشعابتي)
// _Validates: Property 1 — P-3 (production-fixture pinpoint)
// _Validates: Requirements 1.5, 1.6, 1.8, 1.9, 2.6, 3.4
// ============================================================

const TARIK_IDX = 98;
const TARIK_NAME = 'طارق الشعابتي';
const TARIK_SOM = '2270221';

const prodInput = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));

// Sanity guard: verify the documented witness still lives at idx=98 in
// the fixture. If a future fixture regeneration moves طارق or replaces
// him, every assertion below loses its meaning — fail loudly here so
// the regression-lock is never silently weakened.
(function guardProdWitness() {
  if (!Array.isArray(prodInput.proctorsList) ||
      prodInput.proctorsList.length !== 147) {
    failures.push('[prod-setup] expected fixture 45454.json to contain ' +
      '147 proctors; got ' +
      ((prodInput.proctorsList && prodInput.proctorsList.length) || 0) +
      '. Fixture witness has drifted from the documented snapshot in ' +
      '.agent/proctor-v2-phase2-75-multi-step-repair.md.');
    return;
  }
  var w = prodInput.proctorsList[TARIK_IDX];
  if (!w) {
    failures.push('[prod-setup] proctorsList[' + TARIK_IDX + '] missing.');
    return;
  }
  var nameMatches = w.teacher_name === TARIK_NAME ||
    (w.teacher_name && w.teacher_name.indexOf(TARIK_NAME) >= 0);
  var somMatches = String(w.som || '') === TARIK_SOM;
  if (!nameMatches || !somMatches) {
    failures.push('[prod-setup] expected proctorsList[' + TARIK_IDX +
      '] to be ' + TARIK_NAME + ' (som=' + TARIK_SOM + '); got ' +
      JSON.stringify({ name: w.teacher_name, som: w.som }) +
      '. Fixture witness has drifted from the documented snapshot.');
  }
})();

// ============================================================
// 11) Run the algorithm on the production fixture.
// ============================================================

const outProd = V2.run(prodInput);
assert.ok(outProd && outProd.result && outProd.diagnostics,
  'V2.run produced no result/diagnostics on production fixture 45454.json');

const dProd = outProd.diagnostics;

// Reconstruct slot loads using `__idx_N` keys (CIN is empty for every
// proctor in this fixture — see CIN STATS in section 10's header).
const prodSlotCount = Object.create(null);
for (var iP = 0; iP < outProd.result.length; iP++) {
  var keysP = outProd.result[iP].proctor_keys || [];
  for (var jP = 0; jP < keysP.length; jP++) {
    var kP = keysP[jP];
    if (kP) prodSlotCount[kP] = (prodSlotCount[kP] || 0) + 1;
  }
}

// Build per-proctor load array over ALL 147 proctors — including
// zero-load entries. This is the KEY DIFFERENCE from the histogram,
// which only counts LOADED proctors (the documented `{2: 56, 3: 90}`
// snapshot has 146 entries because طارق is excluded).
const prodLoads = [];
for (var iL = 0; iL < prodInput.proctorsList.length; iL++) {
  var pIdx = prodInput.proctorsList[iL];
  prodLoads.push({
    idx: iL,
    name: pIdx.teacher_name,
    som: String(pIdx.som || ''),
    load: prodSlotCount['__idx_' + iL] || 0
  });
}

// Histogram over LOADED proctors only (mirrors inspect-fixture-state.js
// behavior — produces the documented `{2: 56, 3: 90}` snapshot pre-fix).
const prodHist = Object.create(null);
const prodLoadedCounts = Object.values(prodSlotCount);
for (var iH = 0; iH < prodLoadedCounts.length; iH++) {
  var c = prodLoadedCounts[iH];
  prodHist[c] = (prodHist[c] || 0) + 1;
}

const prodDistinctLoaded = Object.keys(prodSlotCount).length;
const prodMinAll = prodLoads.reduce(function (m, l) {
  return l.load < m ? l.load : m;
}, Infinity);
const prodMaxAll = prodLoads.reduce(function (m, l) {
  return l.load > m ? l.load : m;
}, -Infinity);
const prodZeroLoad = prodLoads.filter(function (l) { return l.load === 0; });

// Identify طارق by NAME match AND som match — both must agree per
// task instructions. The dual check guards against silent drift (e.g.
// another proctor sharing the name or som after a fixture regen).
const tarikByName = prodLoads.filter(function (l) {
  return l.name === TARIK_NAME ||
    (l.name && l.name.indexOf(TARIK_NAME) >= 0);
});
const tarikBySom = prodLoads.filter(function (l) {
  return l.som === TARIK_SOM;
});
const tarik = (tarikByName.length === 1 && tarikBySom.length === 1 &&
  tarikByName[0].idx === tarikBySom[0].idx) ? tarikByName[0] : null;

// ============================================================
// 12) Diagnostic snapshot (production fixture).
// ============================================================

console.log('[prod-fixture-exploration] tests/fixtures/45454.json:');
console.log('  proctors=' + prodInput.proctorsList.length +
  ' | sessions=' + (prodInput.scheduleEntries || []).length +
  ' | resultRows=' + outProd.result.length);
console.log('  classLowerBound=' + dProd.lowerBound +
  ' classUpperBound=' + dProd.upperBound +
  ' eligibilityClassCount=' + dProd.eligibilityClassCount);
console.log('  coverageRepairSwaps=' + dProd.coverageRepairSwaps +
  ' coverageRepairUnresolved=' + dProd.coverageRepairUnresolved +
  ' coverageRepairWarnings=' +
  JSON.stringify(dProd.coverageRepairWarnings || []));
console.log('  min(over all 147)=' + prodMinAll +
  ' max=' + prodMaxAll +
  ' distinct(loaded)=' + prodDistinctLoaded);
console.log('  histogram(loaded only): ' + JSON.stringify(prodHist));
console.log('  zero-load proctors: ' + prodZeroLoad.length);
prodZeroLoad.forEach(function (l) {
  console.log('    idx=' + l.idx + ' ' + l.name + ' (som=' + l.som + ')');
});
if (tarik) {
  console.log('  witness طارق الشعابتي → idx=' + tarik.idx +
    ' load=' + tarik.load + ' som=' + tarik.som);
} else {
  console.log('  witness طارق الشعابتي → NOT IDENTIFIED ' +
    '(byName=' + tarikByName.length + ' bySom=' + tarikBySom.length + ')');
}

// ============================================================
// 13) Universal Bug-Condition Assertion (PRODUCTION COUNTEREXAMPLE).
//
// Three universal post-fix properties are asserted here. Each fires a
// failure on UNFIXED code that locks the production regression:
//
//   (P-3a) min(loadState over all proctors) >= classLowerBound = 2.
//          Pre-fix: min=0 (طارق). FAILS.
//   (P-3b) طارق NOT in the zero-load set (load >= classLowerBound).
//          Pre-fix: طارق at load=0. FAILS.
//   (P-3c) coverageRepairUnresolved = 0 — every uncovered proctor
//          either reaches lowerBound or the pass records a structured
//          warning. Pre-fix: 6. FAILS.
//
// Failures push to the shared `failures[]` accumulator from sections
// 5 and 9 — section 14 throws a single aggregated assertion at
// end-of-script with every counterexample (deficit-2, deficit-3, and
// the production-fixture pinpoint).
// ============================================================

(function assertProdFixture() {
  var lb = dProd.lowerBound;

  // P-3a — min over all 147 proctors must be >= classLowerBound.
  if (!(prodMinAll >= lb)) {
    failures.push(
      'Bug Condition C(X) reproduced on production fixture ' +
      'tests/fixtures/45454.json: min(loadState over all 147 proctors)=' +
      prodMinAll + ' but classLowerBound=' + lb + '. ' +
      'Zero-load set has ' + prodZeroLoad.length + ' entrie(s): ' +
      prodZeroLoad.map(function (l) {
        return 'idx=' + l.idx + ' ' + l.name + ' (som=' + l.som + ')';
      }).join('; ') +
      '. Diagnostics: coverageRepairSwaps=' + dProd.coverageRepairSwaps +
      ' (deficit-1 cases all close), coverageRepairUnresolved=' +
      dProd.coverageRepairUnresolved + ', coverageRepairWarnings=' +
      JSON.stringify(dProd.coverageRepairWarnings || []) + '. ' +
      'Histogram (loaded only): ' + JSON.stringify(prodHist) +
      ' over ' + prodDistinctLoaded + ' distinct loaded proctors. ' +
      'This is THE production regression that motivated the entire ' +
      'phase2_75-multi-step-repair spec — confirmed reproducible after ' +
      'all three closed specs (`proctor-v2-fairness-undercovered-fix`, ' +
      '`proctor-distribution-db-memory-mismatch`, ' +
      '`proctor-v2-key-shape-unification`) landed.'
    );
  }

  // P-3b — طارق specifically must reach classLowerBound.
  if (!tarik) {
    failures.push('[prod-witness] could not uniquely identify طارق ' +
      'الشعابتي in fixture 45454.json — byName=' + tarikByName.length +
      ' bySom=' + tarikBySom.length + '. Fixture witness has drifted ' +
      'from the documented snapshot in ' +
      '.agent/proctor-v2-phase2-75-multi-step-repair.md.');
  } else if (!(tarik.load >= lb)) {
    failures.push(
      'Bug Condition C(X) — witness pinpoint: ' +
      'idx=' + tarik.idx + ' ' + tarik.name + ' (som=' + tarik.som + ') ' +
      'ended phase2_75CoverageRepair at primaryLoad=' + tarik.load +
      ' but classLowerBound=' + lb + '. ' +
      'This is THE proctor that locks the production regression — ' +
      'documented at idx=98 in ' +
      '.agent/proctor-v2-phase2-75-multi-step-repair.md. dutyCount=1 ' +
      '(consumed halfday الأول|صباحا), which Phase 2 honestly excludes ' +
      'him from post-key-shape-unification. The remaining halfdays do ' +
      'not yield enough cost-cheap eligible assignments for the ' +
      'Hungarian solver to place him at load>=2; the single-swap-per-' +
      'round repair pass then cannot close his deficit-2 gap. ' +
      'coverageRepairSwaps=' + dProd.coverageRepairSwaps +
      ' confirms 17 deficit-1 cases close while طارق sees zero ' +
      'successful swaps. Post-fix (Option A inner repair loop), this ' +
      'same input MUST lift him to load>=2 OR record ' +
      'coverageRepairWarnings[`__idx_98`] with reason ' +
      '`no_eligible_donor`.'
    );
  }

  // P-3c — coverageRepairUnresolved must be zero post-fix.
  if (dProd.coverageRepairUnresolved !== 0) {
    failures.push(
      'Bug Condition C(X) — diagnostic counter on production fixture: ' +
      'coverageRepairUnresolved=' + dProd.coverageRepairUnresolved +
      ' (expected 0 post-fix per Property P-3 in bugfix.md). Pre-fix ' +
      'this counter is the per-attempt failure count across rounds; ' +
      'post-fix Task 6.2 migrates it to the per-proctor warning-map ' +
      'size identity, which should be 0 once طارق is repaired. ' +
      'coverageRepairWarnings=' +
      JSON.stringify(dProd.coverageRepairWarnings || []) + '.'
    );
  }
})();

// ============================================================
// 14) End-of-script: surface collected counterexamples.
//
// Pre-fix the deficit-2, deficit-3, AND production-fixture assertions
// populate `failures` — the joined message is thrown here. Post-fix
// `failures` is empty and the script exits cleanly — at which point
// it transitions from exploratory to permanent regression lock per
// Task 6.5 of the spec.
// ============================================================

if (failures.length > 0) {
  assert.fail('phase2_75CoverageRepair multi-step bug — ' +
    failures.length + ' counterexample(s):\n\n' +
    failures.map(function (m, i) { return '(' + (i + 1) + ') ' + m; })
      .join('\n\n'));
}

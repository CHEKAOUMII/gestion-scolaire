'use strict';

// @pre-fix property test — EXPECTED to FAIL on F until change site #1 lands
//
// Spec: .kiro/specs/proctor-v2-phase2-75-multi-step-repair/
// Task 4 — fix-checking universal property test.
//
// This test specifies the post-fix universal property for Property 1
// (Bug Condition) per design.md §"Fix Checking" pseudocode:
//
//   FOR ALL input WHERE isBugCondition(input) DO
//     R_mem' := V2'.run(input)
//     FOR EACH proc, idx IN input.proctorsList DO
//       key    := getProctorKey(proc, idx)
//       bounds := classBounds[key]
//       IF bounds = NULL OR bounds.classLowerBound = 0 THEN CONTINUE
//
//       final := getPrimaryLoad(loadState', key)
//       IF final < bounds.classLowerBound THEN
//         ASSERT key IN R_mem'.diagnostics.coverageRepairWarnings
//         ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].reason
//                IN { 'no_eligible_donor', 'no_swappable_peer',
//                     'no_class_bounds', 'time_budget' }
//         ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].initialLoad
//                = initialLoad_key
//         ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].finalLoad
//                = final
//         ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].classLowerBound
//                = bounds.classLowerBound
//         ASSERT R_mem'.diagnostics.coverageRepairWarnings[key].attemptedSwaps
//                >= 0
//       END IF
//     END FOR
//
//     ASSERT R_mem'.diagnostics.coverageRepairUnresolved
//            = COUNT keys IN coverageRepairWarnings
//                          EXCLUDING the synthetic '__pass__' key
//
//     // Production fixture pinpoint
//     IF input = load('tests/fixtures/45454.json') THEN
//       ASSERT min(histogramByCanonicalKey(R_mem')) >= 2
//       ASSERT 'طارق الشعابتي' NOT IN zeroLoadProctors(R_mem')
//       ASSERT R_mem'.diagnostics.coverageRepairUnresolved = 0
//     END IF
//   END FOR
//
// The test runs on UNFIXED code F. Pre-fix the FOR ALL universal
// property FAILS — counter-exampled by the deficit-≥2 branch (the
// production fixture and the synthetic deficit-2/deficit-3 cases all
// fall into it). Post-fix change site #1 (Task 5 — inner repair loop)
// closes those branches and the property holds. Post-fix change site
// #2 (Task 6.1 — diagnostics shape migration) makes the structured-
// payload lookups well-defined.
//
// Failures accumulate into the shared `failures[]` accumulator and
// surface via a single aggregated `assert.fail` at end-of-script
// (mirrors the deferred-failure pattern from
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`).
//
// _Bug_Condition: isBugCondition(X) — fix-checking universal property
// _Expected_Behavior: Property 1 — P-1, P-2, P-3 (multi-step closure
//                      + production pinpoint)
// _File: tests/proctor-v2-phase2-75-multi-step-fix.test.js (NEW)
// _Change site: #1 (inner repair loop)
// _Requirements: 2.1, 2.2, 2.4, 2.6, 2.7, 2.9, 2.10, 2.13

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Idiom mirrors lines 12–22 of scripts/verify-real-centre.js
//    and section 1 of the exploration / preservation / determinism
//    test files in this same family.
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

// Shared deferred-failure accumulator. Every assertion in this file
// pushes a descriptive message here on violation, then end-of-script
// surfaces them all in a single aggregated assert.fail. This ensures
// every counterexample on F (production fixture + synthetic deficit-
// 2 + synthetic deficit-3 + every PBT-generated buggy input) is
// visible in one CI failure message.
var failures = [];

// ============================================================
// 2) Slot-metric load reconstruction + Bug-Condition C(X) filter.
//
// Without internal `loadState` access we reconstruct primary load
// per canonical key by counting appearances in `result[i].proctor_keys`.
// With `dutyData = {}` and `enablePhase3 = false` (the synthetic
// generator's defaults), this slot count IS `getPrimaryLoad`
// (guardCount only; no duty contribution). Mirrors lines 70–80 of
// `scripts/verify-real-centre.js`, section 4 of
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`,
// and section 4 of
// `tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js`.
//
// `isBugCondition(X)` per bugfix.md §"Bug Condition C(X)":
//   EXISTS proc_i WITH primaryLoad < classLowerBound
//   AND coverageRepairUnresolved > 0
// We accept a buggy input on the FIRST hit of either signal.
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
  if (!output || !output.diagnostics) return false;
  var diag = output.diagnostics;
  if (!(diag.coverageRepairUnresolved > 0)) return false;

  var classBounds = diag.classBounds || {};
  var classKeys = Object.keys(classBounds);
  if (classKeys.length === 0) return false;

  var perKey = reconstructSlotLoads(output.result || []);
  var list = input.proctorsList || [];

  for (var i = 0; i < list.length; i++) {
    var key = list[i].cin || ('__idx_' + i);
    var load = perKey[key] || 0;
    for (var c = 0; c < classKeys.length; c++) {
      var cb = classBounds[classKeys[c]];
      if (!cb || !cb.classLowerBound || cb.classLowerBound <= 0) continue;
      if (load < cb.classLowerBound) return true;
    }
  }
  return false;
}

// ============================================================
// 3) Universal-property assertions on a single (input, output) pair.
//
// Encodes the FOR ALL pseudocode from design.md §"Fix Checking" (lines
// 280–310). For every proctor with classLowerBound > 0:
//   - EITHER finalLoad >= classLowerBound (deficit closed)
//   - OR     coverageRepairWarnings[key] is a structured payload
//            with { reason, initialLoad, finalLoad, classLowerBound,
//            attemptedSwaps }
//   - When deficit is closed: (final - initial) >= 1 AND final >=
//     classLowerBound (Property P-2; pseudocode (P-2) clause in
//     bugfix.md §"Property P (Fix Checking)").
// Plus the global identity:
//   coverageRepairUnresolved = Object.keys(warnings)
//                                .filter(k => k !== '__pass__').length
//
// Pre-fix this assertion FAILS on every buggy input because:
//   (a) coverageRepairWarnings is an Array<{proctorKey, reason}>,
//       so `warnings[key]` for a string key is undefined —
//       structured-payload lookup misses entirely;
//   (b) The deficit-≥2 proctor's finalLoad < classLowerBound, with
//       no structured payload → universal property counter-exampled;
//   (c) Even if we relaxed (a), the {initialLoad, finalLoad,
//       classLowerBound, attemptedSwaps} fields are absent pre-fix.
// ============================================================

function assertUniversalProperty(label, input, output, initialLoadsByKey) {
  if (!output || !output.diagnostics) {
    failures.push('[' + label + '] V2.run produced no diagnostics — ' +
      'cannot evaluate fix-checking universal property.');
    return;
  }
  var diag = output.diagnostics;
  var classBounds = diag.classBounds || {};
  var warnings = diag.coverageRepairWarnings;
  var unresolved = diag.coverageRepairUnresolved || 0;
  var perKey = reconstructSlotLoads(output.result || []);
  var list = input.proctorsList || [];

  // Global shape gate: post-fix the warnings field must be a plain
  // object map (not an array). Pre-fix it is an Array — record one
  // shape-failure per assertUniversalProperty call so the deferred
  // failure list pinpoints which input shape-failed.
  var warningsIsMap = warnings !== null && typeof warnings === 'object' &&
    !Array.isArray(warnings);
  if (!warningsIsMap) {
    failures.push('[' + label + '] coverageRepairWarnings is ' +
      (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + '); post-fix per design.md ' +
      '§"Specific Changes" point 2 it MUST be a plain object map keyed by ' +
      'proctorKey. Pre-fix this is `[]` or an Array of {proctorKey, reason} ' +
      'objects, which makes structured-payload lookup `warnings[key]` ' +
      'undefined for every string key.');
  }

  // Per-proctor universal assertion (the FOR EACH body of the
  // fix-checking pseudocode).
  for (var i = 0; i < list.length; i++) {
    var key = list[i].cin || ('__idx_' + i);
    // Determine the proctor's class bounds. With the synthetic-input
    // generator producing single-class inputs (no exemptions, no duty,
    // identical schedule access), classBounds typically has exactly
    // one entry. For multi-class fallbacks, scan all classes and use
    // the FIRST positive lowerBound that applies to this proctor.
    var bounds = null;
    var classKeys = Object.keys(classBounds);
    for (var ck = 0; ck < classKeys.length; ck++) {
      var cb = classBounds[classKeys[ck]];
      if (cb && cb.classLowerBound > 0) {
        bounds = cb;
        break;
      }
    }
    if (!bounds || !bounds.classLowerBound || bounds.classLowerBound <= 0) {
      // Degenerate-boundary skip — design.md §"Preservation Requirements"
      // notes "classLowerBound = 0 excludes the proctor".
      continue;
    }

    var finalLoad = perKey[key] || 0;
    var initialLoad = (initialLoadsByKey && key in initialLoadsByKey)
      ? initialLoadsByKey[key]
      : null;

    if (finalLoad < bounds.classLowerBound) {
      // Below classLowerBound → MUST have a structured warning entry.
      var entry = warningsIsMap ? warnings[key] : undefined;
      if (!entry || typeof entry !== 'object') {
        failures.push('[' + label + '] proctor key="' + key + '" ended ' +
          'phase2_75CoverageRepair at finalLoad=' + finalLoad +
          ' < classLowerBound=' + bounds.classLowerBound +
          ', but coverageRepairWarnings["' + key + '"] is ' +
          JSON.stringify(entry) + '. Per design.md §"Fix Checking" ' +
          'pseudocode lines 295–298, when finalLoad < classLowerBound the ' +
          'pass MUST record a structured payload under the proctor key. ' +
          'Pre-fix the warnings field is an Array, so warnings["' + key +
          '"] is undefined — counter-exampling the universal property.');
        continue;
      }
      // Reason must be one of the four known terminating reasons.
      var ok = entry.reason === 'no_eligible_donor' ||
               entry.reason === 'no_swappable_peer' ||
               entry.reason === 'no_class_bounds' ||
               entry.reason === 'time_budget';
      if (!ok) {
        failures.push('[' + label + '] proctor key="' + key + '" warning ' +
          'reason="' + entry.reason + '" not in the documented set ' +
          '{ no_eligible_donor, no_swappable_peer, no_class_bounds, ' +
          'time_budget }.');
      }
      // Structured payload field checks — initialLoad, finalLoad,
      // classLowerBound, attemptedSwaps MUST be present and consistent.
      if (typeof entry.finalLoad !== 'number' ||
          entry.finalLoad !== finalLoad) {
        failures.push('[' + label + '] proctor key="' + key + '" ' +
          'warnings["' + key + '"].finalLoad=' +
          JSON.stringify(entry.finalLoad) + ' does not match observed ' +
          'finalLoad=' + finalLoad + '. design.md §"Fix Checking" ' +
          'pseudocode line 301: ASSERT ...finalLoad = final.');
      }
      if (entry.classLowerBound !== bounds.classLowerBound) {
        failures.push('[' + label + '] proctor key="' + key + '" ' +
          'warnings["' + key + '"].classLowerBound=' +
          JSON.stringify(entry.classLowerBound) + ' does not match ' +
          'bounds.classLowerBound=' + bounds.classLowerBound +
          '. design.md §"Fix Checking" pseudocode line 302–303.');
      }
      if (typeof entry.attemptedSwaps !== 'number' ||
          entry.attemptedSwaps < 0) {
        failures.push('[' + label + '] proctor key="' + key + '" ' +
          'warnings["' + key + '"].attemptedSwaps=' +
          JSON.stringify(entry.attemptedSwaps) + ' missing or negative; ' +
          'design.md §"Fix Checking" pseudocode line 304: ASSERT ' +
          '...attemptedSwaps >= 0.');
      }
      if (initialLoad !== null && entry.initialLoad !== initialLoad) {
        failures.push('[' + label + '] proctor key="' + key + '" ' +
          'warnings["' + key + '"].initialLoad=' +
          JSON.stringify(entry.initialLoad) + ' does not match observed ' +
          'pre-pass initialLoad=' + initialLoad + '. design.md ' +
          '§"Fix Checking" pseudocode line 300.');
      }
    } else {
      // Property P-2: when the deficit IS closed, (final - initial) >= 1
      // AND final >= classLowerBound. The second clause is the IF
      // branch we're in; the first clause requires a non-trivial
      // initial — only assert when initialLoad < classLowerBound (i.e.
      // the proctor ENTERED the pass uncovered).
      if (initialLoad !== null && initialLoad < bounds.classLowerBound) {
        if (!((finalLoad - initialLoad) >= 1)) {
          failures.push('[' + label + '] proctor key="' + key + '" ' +
            'closed deficit (final=' + finalLoad + ' >= classLowerBound=' +
            bounds.classLowerBound + ') but (final - initial)=' +
            (finalLoad - initialLoad) + ' < 1. bugfix.md §"Property P (P-2)" ' +
            'requires (final - initial) >= 1 when the repair pass ' +
            'successfully closes a deficit.');
        }
      }
    }
  }

  // Global identity: coverageRepairUnresolved = | warnings keys | excl __pass__
  // Pre-fix this MAY accidentally pass on inputs where the array
  // length matches `unresolved`. Post-fix it MUST hold by construction
  // (Task 6.2 re-derives the counter from the per-proctor map).
  if (warningsIsMap) {
    var keysExclPass = Object.keys(warnings).filter(function (k) {
      return k !== '__pass__';
    });
    if (unresolved !== keysExclPass.length) {
      failures.push('[' + label + '] coverageRepairUnresolved=' +
        unresolved + ' does not equal Object.keys(coverageRepairWarnings).' +
        'filter(k => k !== "__pass__").length=' + keysExclPass.length +
        '. design.md §"Fix Checking" pseudocode lines 309–311 require this ' +
        'identity post-fix; Task 6.2 (Change Site #3) re-derives the ' +
        'counter from the per-proctor map.');
    }
  }
}

// ============================================================
// 4) Initial-load capture (best-effort).
//
// Property P-2 and the structured-payload `initialLoad` field need
// the proctor's primary load *at the moment the inner repair loop
// targets the proctor* — i.e. immediately after Phase 2 / Phase 2.5
// and immediately BEFORE the multi-swap inner loop executes.
//
// The repair pass does not currently surface a snapshot of pre-pass
// loads on V2's public diagnostics. We approximate it by re-running
// V2.run with the same input twice: once with `enablePhase3 = false`
// to capture the post-Phase-2.75 result, and inferring initial load
// from the captured `coverageRepairWarnings[key].initialLoad` where
// available. For PBT-generated inputs we treat unavailable
// initialLoad as `null` and skip the equality assertion (the other
// payload fields and the global identity still gate).
//
// For the hard-coded synthetic deficit-2 / deficit-3 cases AND the
// production fixture, the documented initial load is unambiguous (0
// for the bug witness in each case) — see the Task 1.1 / 1.2 / 1.3
// header comments in
// `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`.
// ============================================================

// ============================================================
// 5) mulberry32 PRNG — project convention. Same shape as the
//    preservation PBT (section 2 of
//    tests/proctor-v2-phase2-75-multi-step-preservation.pbt.test.js).
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
  return lo + Math.floor(rng() * (hi - lo + 1));
}

// ============================================================
// 6) Synthetic-input generator — mirrors Task 2.1 generator shape
//    (section 3 of preservation PBT) so the rejection-sample on
//    isBugCondition fires on a comparable input distribution.
//
// The generator produces: 1..30 proctors × 1..4 days × 1..2 periods ×
// 1..3 sessions × 1..3 rooms × proctorsPerRoom=1, no exemptions, no
// duty, balanced ME assignments. Most inputs land in the
// `NOT isBugCondition` domain (preservation-domain) — Task 2.1's
// run reported ~10/50 isBugCondition=true (≈20% rate), enough to
// produce a handful of buggy PBT inputs in 50–100 attempts.
// ============================================================

function makeProctor(idx, iterTag) {
  var cin = 'CIN_FIX_' + iterTag + '_' + idx;
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
// 7) PBT loop — rejection-sample on `isBugCondition(input) = true`.
//
// We INVERT the preservation PBT's filter: accept inputs where the
// bug condition fires, reject inputs where it does not. With the
// preservation PBT's empirical ~20% bug-condition hit rate, ~50
// accepted iterations require ~250 attempts — bounded and runs in a
// few seconds.
//
// For each accepted buggy input, run the universal-property
// assertions from section 3. Pre-fix EVERY accepted iteration counter-
// examples the universal property because:
//   (a) the warnings field is still an Array, so the structured-
//       payload lookup `warnings[key]` is undefined for every key;
//   (b) the deficit-≥2 proctor's finalLoad < classLowerBound, with
//       no structured payload → universal property fails for at
//       least one key per accepted iteration.
//
// Initial-load capture: for PBT inputs we cannot easily pre-snapshot
// the post-Phase-2 load (V2 doesn't expose `loadStateSnapshot` on the
// public diagnostics). We pass `null` for `initialLoadsByKey`, which
// disables the `entry.initialLoad === initialLoad` equality check
// while still asserting the other structured-payload fields and the
// global identity.
// ============================================================

var ITERATIONS_TARGET = 8;
var ITERATIONS_MAX = 200;
var SEED_BASE = 0xF1C0DE;
var rng = mulberry32(SEED_BASE);

var acceptedCount = 0;
var attempts = 0;

while (attempts < ITERATIONS_MAX && acceptedCount < ITERATIONS_TARGET) {
  attempts++;
  var iterTag = 'F' + attempts;
  var input = buildInput(rng, iterTag);
  var output;
  try {
    output = V2.run(input);
  } catch (e) {
    continue;
  }
  if (!output || !output.result || !output.diagnostics) continue;

  // INVERTED filter — accept when isBugCondition(X) = true.
  if (!isBugCondition(input, output)) continue;
  acceptedCount++;

  assertUniversalProperty('pbt-iter-' + attempts, input, output, null);
}

console.log('[fix-pbt] attempts=' + attempts +
  ' accepted (bug-condition=true)=' + acceptedCount +
  ' / target=' + ITERATIONS_TARGET);
if (acceptedCount === 0) {
  // Soft warning — if zero buggy inputs were generated, the universal
  // PBT branch is uninformative. The hard-coded deficit-2/deficit-3/
  // production-fixture cases below still gate. Surface it for review.
  console.log('  WARNING: zero buggy inputs generated by rejection-sample. ' +
    'PBT branch is uninformative for this run; the hard-coded synthetic ' +
    'and production-fixture cases still gate the universal property.');
}

// ============================================================
// 8) Hard-coded synthetic deficit-2 case (mirror Task 1.1's input).
//
// Per the task instructions: "assert `applyCoverageSwap` fires exactly
// twice for the deficit-2 proctor". Pre-fix `coverageRepairSwaps = 1`
// (only one swap fires for P_uncov, then halfday-reuse traps round 2);
// post-fix `coverageRepairSwaps = 2` (the inner repair loop closes the
// deficit on the second iteration).
//
// The deficit-2 input has only ONE deficit-≥1 proctor (P_uncov at
// load=0, classLowerBound=2). The other 3 peers are at upperBound=3.
// So the pre-fix delta from baseline-zero-deficit-1-cases is `1`
// (the single doomed swap), and the post-fix expected delta is `2`
// (two successful swaps closing P_uncov to load=2).
//
// Post-fix expected: coverageRepairSwaps === 2 (one proctor × two
// swaps each = exactly 2 successful swaps). The synthetic input
// contains no deficit-1 proctors mixed in — every other proctor is
// at upperBound — so `coverageRepairSwaps` post-fix is exactly 2,
// not "2 plus baseline".
// ============================================================

function makeProctorSynthetic(name, cin, specialty, gender) {
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

function makeEntrySynthetic(session) {
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

function buildSyntheticDeficit2Input() {
  // Verbatim from `tests/proctor-v2-phase2-75-multi-step-bug-c1-
  // exploration.test.js` section 2 (Task 1.1 builder), duplicated for
  // self-containment per the same pattern as Task 2.2's determinism
  // test file.
  var peerA = makeProctorSynthetic('peer_A', 'CIN_A001', 'عام', 'ذكر');
  var peerB = makeProctorSynthetic('peer_B', 'CIN_B002', 'عام', 'ذكر');
  var peerC = makeProctorSynthetic('peer_C', 'CIN_C003', 'عام', 'ذكر');
  var pUncov = makeProctorSynthetic('p_uncov', 'CIN_P099', 'الرياضيات', 'أنثى');
  return {
    proctorsList: [peerA, peerB, peerC, pUncov],
    scheduleEntries: [
      makeEntrySynthetic('الحصة الأولى'),
      makeEntrySynthetic('الحصة الثانية'),
      makeEntrySynthetic('الحصة الثالثة')
    ],
    exemptionsData: {},
    dutyData: {},
    meAssignments: {
      'CIN_A001': 1, 'CIN_B002': 1, 'CIN_C003': 1, 'CIN_P099': 2
    },
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: [makeRoom('R1'), makeRoom('R2'), makeRoom('R3')],
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: {
        'CIN_A001': 'عام',
        'CIN_B002': 'عام',
        'CIN_C003': 'عام',
        'CIN_P099': 'الرياضيات'
      }
    },
    enablePhase3: false,
    D_expected: 0
  };
}

(function deficit2HardcodedAssertion() {
  var input = buildSyntheticDeficit2Input();
  var out = V2.run(input);
  if (!out || !out.diagnostics) {
    failures.push('[deficit-2-fix] V2.run produced no diagnostics on ' +
      'synthetic deficit-2 input.');
    return;
  }
  var diag = out.diagnostics;
  var perKey = reconstructSlotLoads(out.result || []);
  var loadP = perKey['CIN_P099'] || 0;
  var classBoundsKeys = Object.keys(diag.classBounds || {});
  var pBounds = classBoundsKeys.length === 1
    ? diag.classBounds[classBoundsKeys[0]]
    : null;

  console.log('[deficit-2-fix] synthetic deficit-2 input diagnostics:');
  console.log('  classLowerBound=' + (pBounds && pBounds.classLowerBound) +
    ' classUpperBound=' + (pBounds && pBounds.classUpperBound));
  console.log('  coverageRepairSwaps=' + diag.coverageRepairSwaps +
    ' coverageRepairUnresolved=' + diag.coverageRepairUnresolved);
  console.log('  loadP_uncov (slot-metric)=' + loadP);

  // Property P-1: P_uncov reaches classLowerBound.
  if (!pBounds) {
    failures.push('[deficit-2-fix] expected diagnostics.classBounds to ' +
      'have a single entry for the synthetic input; got ' +
      JSON.stringify(diag.classBounds || {}) + '.');
  } else if (loadP < pBounds.classLowerBound) {
    failures.push('[deficit-2-fix] P_uncov ended at primaryLoad=' + loadP +
      ' < classLowerBound=' + pBounds.classLowerBound + '. design.md ' +
      '§"Fix Strategy: Option A — Inner Repair Loop" requires the ' +
      'multi-swap inner loop to close P_uncov to load >= classLowerBound. ' +
      'Pre-fix (Change Site #1 not yet applied) the single-swap-per-round ' +
      'structural cap leaves P_uncov at load=1.');
  }

  // Swap-count assertion: exactly 2 successful swaps fire for the
  // deficit-2 proctor (no deficit-1 proctors in this input, so the
  // baseline is 0). Pre-fix: coverageRepairSwaps=1 (single doomed
  // swap, then halfday-reuse traps round 2). Post-fix: 2.
  if (diag.coverageRepairSwaps !== 2) {
    failures.push('[deficit-2-fix] coverageRepairSwaps=' +
      diag.coverageRepairSwaps + ' (expected 2 — exactly D=2 successful ' +
      'swaps for the single deficit-2 proctor in this input; the input ' +
      'contains no deficit-1 proctors so the baseline is 0). Pre-fix ' +
      'this counter is 1 (one swap fires in round 1, then halfday-reuse ' +
      'rejects every donor row in round 2 because P_uncov\'s round-1 ' +
      'placement occupies the only halfday). Post-fix the inner repair ' +
      'loop applies a second swap from the candidate at threshold=' +
      'upperBound; Property P-2 requires (final - initial) >= 1 AND ' +
      'final >= classLowerBound, which is satisfied with exactly 2 ' +
      'swaps.');
  }

  // Production-fixture assertions are bundled into the universal
  // property check on the same output. initialLoad for P_uncov is
  // documented as 0 in Task 1.1's header.
  var initialLoads = { 'CIN_P099': 0 };
  assertUniversalProperty('deficit-2-fix', input, out, initialLoads);
})();

// ============================================================
// 9) Hard-coded synthetic deficit-3 case (mirror Task 1.2's input).
//
// Per task instructions: "assert exactly three successful swaps for
// the deficit-3 proctor". Same logic as the deficit-2 case scaled to
// D=3: 5 proctors, single halfday × 4 sessions × 4 rooms = 16 guard
// slots, classLowerBound=3, classUpperBound=4. P_uncov_d3 enters the
// repair pass at load=0; the four peers are at upperBound=4. The
// input contains no deficit-1 proctors, so baseline is 0 and post-fix
// `coverageRepairSwaps === 3`.
// ============================================================

function makeRoomD3(key) { return makeRoom(key); }

function makeEntryD3(session) {
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

function buildSyntheticDeficit3Input() {
  // Verbatim from `tests/proctor-v2-phase2-75-multi-step-bug-c1-
  // exploration.test.js` section 6 (Task 1.2 builder), duplicated for
  // self-containment.
  var peerA = makeProctorSynthetic('peer_A_d3', 'CIN_DA01', 'عام', 'ذكر');
  var peerB = makeProctorSynthetic('peer_B_d3', 'CIN_DB02', 'عام', 'ذكر');
  var peerC = makeProctorSynthetic('peer_C_d3', 'CIN_DC03', 'عام', 'ذكر');
  var peerD = makeProctorSynthetic('peer_D_d3', 'CIN_DD04', 'عام', 'ذكر');
  var pUncov = makeProctorSynthetic('p_uncov_d3', 'CIN_PD99', 'الرياضيات', 'أنثى');
  return {
    proctorsList: [peerA, peerB, peerC, peerD, pUncov],
    scheduleEntries: [
      makeEntryD3('الحصة الأولى'),
      makeEntryD3('الحصة الثانية'),
      makeEntryD3('الحصة الثالثة'),
      makeEntryD3('الحصة الرابعة')
    ],
    exemptionsData: {},
    dutyData: {},
    meAssignments: {
      'CIN_DA01': 1, 'CIN_DB02': 1, 'CIN_DC03': 1, 'CIN_DD04': 1,
      'CIN_PD99': 2
    },
    examDistributionRules: { proctorsPerRoom: 1, reservesPerSession: 0 },
    randomSeed: 42,
    weightsPreset: 'توازن',
    customWeights: null,
    options: {
      roomsList: [
        makeRoomD3('R1'), makeRoomD3('R2'),
        makeRoomD3('R3'), makeRoomD3('R4')
      ],
      allowHalfdayReuse: false,
      allowDayReuse: true,
      noRoomRepeat: false,
      avoidSpecialty: true,
      respectMorningEvening: true,
      preferMixedGenderPair: false,
      proctorSpecialties: {
        'CIN_DA01': 'عام',
        'CIN_DB02': 'عام',
        'CIN_DC03': 'عام',
        'CIN_DD04': 'عام',
        'CIN_PD99': 'الرياضيات'
      }
    },
    enablePhase3: false,
    D_expected: 0
  };
}

(function deficit3HardcodedAssertion() {
  var input = buildSyntheticDeficit3Input();
  var out = V2.run(input);
  if (!out || !out.diagnostics) {
    failures.push('[deficit-3-fix] V2.run produced no diagnostics on ' +
      'synthetic deficit-3 input.');
    return;
  }
  var diag = out.diagnostics;
  var perKey = reconstructSlotLoads(out.result || []);
  var loadP = perKey['CIN_PD99'] || 0;
  var classBoundsKeys = Object.keys(diag.classBounds || {});
  var pBounds = classBoundsKeys.length === 1
    ? diag.classBounds[classBoundsKeys[0]]
    : null;

  console.log('[deficit-3-fix] synthetic deficit-3 input diagnostics:');
  console.log('  classLowerBound=' + (pBounds && pBounds.classLowerBound) +
    ' classUpperBound=' + (pBounds && pBounds.classUpperBound));
  console.log('  coverageRepairSwaps=' + diag.coverageRepairSwaps +
    ' coverageRepairUnresolved=' + diag.coverageRepairUnresolved);
  console.log('  loadP_uncov_d3 (slot-metric)=' + loadP);

  if (!pBounds) {
    failures.push('[deficit-3-fix] expected diagnostics.classBounds to ' +
      'have a single entry; got ' + JSON.stringify(diag.classBounds || {}) +
      '.');
  } else if (loadP < pBounds.classLowerBound) {
    failures.push('[deficit-3-fix] P_uncov_d3 ended at primaryLoad=' +
      loadP + ' < classLowerBound=' + pBounds.classLowerBound +
      '. The structural cap is independent of D — pre-fix the same ' +
      'single-swap-per-pending-proctor cap fires for D=3 just as for ' +
      'D=2 (gap is 2 vs 1 but swap count is identical at 1). Post-fix ' +
      'the inner repair loop closes the deficit in exactly D=3 swaps.');
  }

  if (diag.coverageRepairSwaps !== 3) {
    failures.push('[deficit-3-fix] coverageRepairSwaps=' +
      diag.coverageRepairSwaps + ' (expected 3 — exactly D=3 successful ' +
      'swaps for the single deficit-3 proctor in this input; the input ' +
      'contains no deficit-1 proctors so the baseline is 0). Pre-fix ' +
      'this counter is 1 (single-swap-per-pending-proctor cap is ' +
      'independent of D). Post-fix the inner repair loop fires three ' +
      'times against three distinct donors, each donor at upperBound=4 ' +
      'before the swap and 3 after — Property P-2 satisfied with exactly ' +
      '3 swaps closing P_uncov_d3 from load=0 to load=3.');
  }

  var initialLoads = { 'CIN_PD99': 0 };
  assertUniversalProperty('deficit-3-fix', input, out, initialLoads);
})();

// ============================================================
// 10) Hard-coded production-fixture pinpoint case (mirror Task 1.3).
//
// Replay `tests/fixtures/45454.json`. Pre-fix:
//   min(loadState over all 147 proctors) = 0 (طارق at load=0)
//   coverageRepairSwaps = 17 (deficit-1 cases close)
//   coverageRepairUnresolved = 6
// Post-fix per Property P-3 (bugfix.md §"Property P (P-3)"):
//   min(loadState over all 147 proctors) >= 2
//   طارق NOT in zero-load set
//   coverageRepairUnresolved = 0
//
// طارق is identified by NAME match AND som match (both must agree)
// — same dual-check as Task 1.3 to guard against silent fixture drift.
// CIN is empty for every proctor in fixture 45454.json, so the
// canonical key shape is `__idx_<N>` (per `getProctorKey` semantics
// at lines 649–652 of the production module). Slot loads below are
// reconstructed using `__idx_<N>` keys.
// ============================================================

const TARIK_IDX = 98;
const TARIK_NAME = 'طارق الشعابتي';
const TARIK_SOM = '2270221';

(function productionFixturePinpoint() {
  var fixturePath = path.join(ROOT, 'tests/fixtures/45454.json');
  var prodInput;
  try {
    prodInput = JSON.parse(fs.readFileSync(fixturePath, 'utf8'));
  } catch (e) {
    failures.push('[prod-fix] failed to read tests/fixtures/45454.json: ' +
      e.message);
    return;
  }

  // Sanity guard: verify طارق still lives at idx=98 and matches the
  // documented witness. Both name AND som must agree (mirrors Task
  // 1.3's logic).
  if (!Array.isArray(prodInput.proctorsList) ||
      prodInput.proctorsList.length !== 147) {
    failures.push('[prod-fix-setup] expected fixture 45454.json to ' +
      'contain 147 proctors; got ' +
      ((prodInput.proctorsList && prodInput.proctorsList.length) || 0) +
      '. Fixture witness has drifted.');
    return;
  }
  var w = prodInput.proctorsList[TARIK_IDX];
  if (!w) {
    failures.push('[prod-fix-setup] proctorsList[' + TARIK_IDX + '] missing.');
    return;
  }
  var nameMatches = w.teacher_name === TARIK_NAME ||
    (w.teacher_name && w.teacher_name.indexOf(TARIK_NAME) >= 0);
  var somMatches = String(w.som || '') === TARIK_SOM;
  if (!nameMatches || !somMatches) {
    failures.push('[prod-fix-setup] expected proctorsList[' + TARIK_IDX +
      '] to be ' + TARIK_NAME + ' (som=' + TARIK_SOM + '); got ' +
      JSON.stringify({ name: w.teacher_name, som: w.som }) + '.');
    return;
  }

  var out;
  try {
    out = V2.run(prodInput);
  } catch (e) {
    failures.push('[prod-fix] V2.run threw on production fixture: ' +
      e.message);
    return;
  }
  if (!out || !out.result || !out.diagnostics) {
    failures.push('[prod-fix] V2.run produced no result/diagnostics on ' +
      'production fixture 45454.json.');
    return;
  }

  var diag = out.diagnostics;
  var lb = diag.lowerBound;

  // Reconstruct slot loads using `__idx_<N>` keys (CIN empty in this
  // fixture for every proctor).
  var prodSlotCount = Object.create(null);
  for (var iP = 0; iP < out.result.length; iP++) {
    var keysP = out.result[iP].proctor_keys || [];
    for (var jP = 0; jP < keysP.length; jP++) {
      var kP = keysP[jP];
      if (kP) prodSlotCount[kP] = (prodSlotCount[kP] || 0) + 1;
    }
  }

  // Per-proctor load array over ALL 147 proctors (includes zero-load
  // entries). This is the KEY DIFFERENCE from the histogram (which
  // only counts LOADED proctors).
  var prodLoads = [];
  for (var iL = 0; iL < prodInput.proctorsList.length; iL++) {
    var pIdx = prodInput.proctorsList[iL];
    prodLoads.push({
      idx: iL,
      name: pIdx.teacher_name,
      som: String(pIdx.som || ''),
      load: prodSlotCount['__idx_' + iL] || 0
    });
  }

  var prodMinAll = prodLoads.reduce(function (m, l) {
    return l.load < m ? l.load : m;
  }, Infinity);
  var prodZeroLoad = prodLoads.filter(function (l) { return l.load === 0; });

  // Identify طارق by NAME match AND som match — both must agree.
  var tarikByName = prodLoads.filter(function (l) {
    return l.name === TARIK_NAME ||
      (l.name && l.name.indexOf(TARIK_NAME) >= 0);
  });
  var tarikBySom = prodLoads.filter(function (l) {
    return l.som === TARIK_SOM;
  });
  var tarik = (tarikByName.length === 1 && tarikBySom.length === 1 &&
    tarikByName[0].idx === tarikBySom[0].idx) ? tarikByName[0] : null;

  console.log('[prod-fix] tests/fixtures/45454.json post-fix expectations:');
  console.log('  classLowerBound=' + lb +
    ' classUpperBound=' + diag.upperBound);
  console.log('  coverageRepairSwaps=' + diag.coverageRepairSwaps +
    ' coverageRepairUnresolved=' + diag.coverageRepairUnresolved);
  console.log('  min(over all 147)=' + prodMinAll +
    ' zero-load proctors=' + prodZeroLoad.length);
  if (tarik) {
    console.log('  witness طارق → idx=' + tarik.idx +
      ' load=' + tarik.load);
  }

  // P-3a: min over all 147 proctors >= classLowerBound.
  if (!(prodMinAll >= lb)) {
    failures.push('[prod-fix] Property P-3a violated: min(loadState over ' +
      'all 147 proctors)=' + prodMinAll + ' < classLowerBound=' + lb +
      '. Zero-load set has ' + prodZeroLoad.length + ' entrie(s): ' +
      prodZeroLoad.map(function (l) {
        return 'idx=' + l.idx + ' ' + l.name + ' (som=' + l.som + ')';
      }).join('; ') +
      '. Pre-fix this fails with min=0 (طارق at load=0). Post-fix the ' +
      'inner repair loop closes طارق\'s deficit-2 gap.');
  }

  // P-3b: طارق NOT in zero-load set (his load >= classLowerBound).
  if (!tarik) {
    failures.push('[prod-fix] could not uniquely identify طارق الشعابتي ' +
      'in fixture 45454.json — byName=' + tarikByName.length +
      ' bySom=' + tarikBySom.length + '.');
  } else if (!(tarik.load >= lb)) {
    failures.push('[prod-fix] Property P-3b violated: witness ' +
      'idx=' + tarik.idx + ' ' + tarik.name + ' (som=' + tarik.som + ') ' +
      'ended phase2_75CoverageRepair at primaryLoad=' + tarik.load +
      ' < classLowerBound=' + lb + '. This is THE proctor that locks the ' +
      'production regression. Post-fix Property P-3 requires ' +
      'load >= classLowerBound OR a structured warning under ' +
      'coverageRepairWarnings["__idx_98"] with reason "no_eligible_donor".');
  }

  // P-3c: coverageRepairUnresolved = 0 on the production fixture.
  if (diag.coverageRepairUnresolved !== 0) {
    failures.push('[prod-fix] Property P-3c violated: ' +
      'coverageRepairUnresolved=' + diag.coverageRepairUnresolved +
      ' (expected 0 post-fix per bugfix.md §"Property P (P-3)" line ' +
      '"ASSERT R_mem.diagnostics.coverageRepairUnresolved = 0"). Pre-fix ' +
      'this counter is 6 (per-attempt failure count across rounds; the ' +
      'multi-step closure leaves زero unresolved warnings post-fix).');
  }

  // Also run the per-proctor universal property assertion against the
  // production fixture output. Initial-load capture is unavailable for
  // the fixture path (we cannot snapshot mid-pass), so pass null.
  // The structured-payload field assertions still gate every proctor
  // whose finalLoad < classLowerBound.
  assertUniversalProperty('prod-fix', prodInput, out, null);
})();

// ============================================================
// 11) End-of-script: surface collected counterexamples in one
// aggregated assert.fail.
//
// Pre-fix the universal property is counter-exampled by the
// deficit-≥2 branch on EVERY accepted PBT iteration, the synthetic
// deficit-2 case (coverageRepairSwaps=1 ≠ 2; warnings is Array; etc.),
// the synthetic deficit-3 case (coverageRepairSwaps=1 ≠ 3; same shape
// failures), and the production fixture (min=0; طارق at load=0;
// coverageRepairUnresolved=6). Post-fix `failures` is empty and the
// script exits cleanly — at which point Task 6.6 marks the test as a
// permanent regression lock.
// ============================================================

if (failures.length > 0) {
  assert.fail('phase2_75CoverageRepair multi-step fix-checking — ' +
    failures.length + ' counterexample(s):\n\n' +
    failures.map(function (m, i) { return '(' + (i + 1) + ') ' + m; })
      .join('\n\n'));
}

console.log('[fix-pbt] PASS — every input where isBugCondition(X) ' +
  'fires also satisfies the post-fix universal property: deficit closed ' +
  'OR structured warning recorded; coverageRepairUnresolved = ' +
  '|warnings keys excl __pass__|; production fixture min >= ' +
  'classLowerBound and طارق loaded; synthetic deficit-2 closes in 2 ' +
  'swaps; synthetic deficit-3 closes in 3 swaps.');

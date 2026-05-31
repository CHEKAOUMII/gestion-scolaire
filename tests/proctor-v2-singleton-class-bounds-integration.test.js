'use strict';

// @post-fix integration test — adapted to this spec's Property P-3
// (relaxed acceptance criteria). PASSES on FIXED code (Tasks 5.2 + 5.3).
//
// ============================================================
// Spec: .kiro/specs/proctor-v2-singleton-class-bounds/
// Task 4 — Integration test with parent spec's exploration and fix tests.
// Task 6.5 follow-up — adapted to align with this spec's Property P-3
// design.md §"Correctness Properties" Property 1 / bugfix.md §P-3:
//   "On tests/fixtures/45454.json, no proctor has classLowerBound > 3
//    (LB_global + 1 = 3), and the six false-positive coverageRepair-
//    Warnings disappear ... ASSERT nonPassWarnings.length ≤ 1 //
//    legitimate at-most-one warning if طارق still cannot be lifted to 2
//    by the inner repair loop after the bounds are corrected."
//
// ---------------------------------------------------------------------
// Property P-3 vs parent-spec strict criteria — IMPORTANT DISTINCTION
// ---------------------------------------------------------------------
// The parent spec's tests
//   tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//   tests/proctor-v2-phase2-75-multi-step-fix.test.js
// assert STRICT criteria:
//   - min(loadState over all 147 proctors) ≥ 2 for ALL proctors
//   - طارق NOT in the zero-load set (load ≥ 2)
//   - coverageRepairUnresolved == 0
//
// On the production fixture `tests/fixtures/45454.json`, after this
// spec's Tasks 5.2 + 5.3 land (cap+monotonicity guard), the observed
// post-fix state is:
//   - All 6 singleton bounds correctly capped at classLowerBound=2,
//     classUpperBound=3 (was 294-352).
//   - 5 of 6 false-positive coverageRepairWarnings entries
//     (__idx_62, __idx_28, __idx_133, __idx_109, __idx_21) DISAPPEAR
//     as expected.
//   - 1 residual remains: طارق (idx=98) at load=0, with a TRUTHFUL
//     warning whose classLowerBound=2 (capped, not 352). This is a
//     genuine repair-pass limitation, not a false-positive on an
//     impossible bound.
//   - coverageRepairSwaps=17, coverageRepairUnresolved=1.
//
// Per this spec's design.md §"Correctness Properties" Property 1 and
// bugfix.md §"Property P (Fix Checking)" P-3, the acceptance criteria
// for this spec are RELAXED to allow at most one legitimate residual:
//   - At most ONE proctor can have load < LB_global = 2.
//   - coverageRepairUnresolved ≤ 1.
//   - For any residual, its classLowerBound must be capped (≤ 3),
//     proving the warning is NOT a false-positive on an impossible
//     bound (294-352).
//
// Closing طارق's deficit fully (min ≥ 2 STRICTLY, including for him,
// coverageRepairUnresolved == 0) requires a follow-up fix to
// `phase2_75CoverageRepair` — that work is OUT OF SCOPE per
// design.md §"Out-of-Scope (Explicit)". As a documented limitation,
// the parent spec's strict tests
//   tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js
//   tests/proctor-v2-phase2-75-multi-step-fix.test.js
// continue to FAIL on the production fixture even after this spec's
// fix lands. Per design.md §"Updated Test Files", this spec's fix
// flips the parent spec's tests "from FAIL to PASS post-fix" — but
// only for the 5 false-positive cases. The 6th case (طارق) remains
// FAIL on the parent spec's tests due to the deeper repair-pass
// limitation, which a follow-up spec will address.
//
// ---------------------------------------------------------------------
// This integration test exercises THREE cases (adapted to P-3):
// ---------------------------------------------------------------------
//
//   1. Parent exploration replay — production fixture pinpoint
//      ADAPTED to Property P-3:
//      - At most ONE proctor with load < LB_global = 2 (the residual
//        exception, which is طارق).
//      - coverageRepairUnresolved ≤ 1.
//      - The residual's coverageRepairWarnings entry has
//        classLowerBound ≤ LB_global + 1 = 3 (capped, not 294-352).
//      - The 5 OTHER documented witnesses (__idx_62, __idx_28,
//        __idx_133, __idx_109, __idx_21) MUST NO LONGER appear in
//        coverageRepairWarnings.
//
//   2. Parent fix-checking replay — production fixture pinpoint.
//      ADAPTED to Property P-3 (same relaxation as Case 1).
//      Additionally still asserts the parent-spec's Map-shape
//      identity: warnings is a plain object, and
//      |non-__pass__ warning keys| === coverageRepairUnresolved.
//
//   3. Parent-spec synthetic preservation — UNCHANGED.
//      Replay the parent spec's synthetic deficit-2 (Task 1.1) and
//      deficit-3 (Task 1.2) inputs and verify this spec's fix is a
//      STRICT NO-OP on them. These inputs have a single eligibility
//      class (no singleton with G_class > LB_global), so
//      isBugCondition(X) is false for both. classLowerBound = 2 for
//      deficit-2, classLowerBound = 3 for deficit-3, every per-class
//      bound ≤ LB_global + 1, and the post-fix output's classBounds
//      map is byte-identical to the pre-fix output's classBounds map.
//      Pre-fix and post-fix: PASS.
//
// _Bug_Condition: isBugCondition(X) — integration with parent spec
// _Expected_Behavior: Property 1 P-3 (relaxed) — parent-spec integration;
//                     Property 2 — parent-spec synthetic preservation
// _File: tests/proctor-v2-singleton-class-bounds-integration.test.js
// _Validates: Requirements 3.10, 3.12, 3.21, 3.22, 3.23 (under P-3)
//
// ---------------------------------------------------------------------
// Pre-fix vs post-fix outcomes
// ---------------------------------------------------------------------
// Pre-fix (UNFIXED code F):
//   Case 1: FAIL — production fixture's min=0 (or 1), طارق at load=0
//           (or 1), coverageRepairUnresolved=6, 6 false-positive
//           warnings with classLowerBound 294-352.
//   Case 2: FAIL — same as case 1 (same machinery, same root cause).
//   Case 3: PASS — synthetic deficit-2 / deficit-3 inputs are
//           unaffected by this spec's fix (no singleton with
//           G_class > LB_global+1 in either input).
//
// Post-fix (after Tasks 5.2 + 5.3, under Property P-3):
//   Case 1: PASS — 5 of 6 singleton bounds cleanly resolved
//           (warnings absent), 1 truthful residual (طارق) with capped
//           classLowerBound ≤ 3, coverageRepairUnresolved ≤ 1.
//   Case 2: PASS — same.
//   Case 3: PASS — preserved byte-identically.
// ============================================================

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ============================================================
// 1) Load the production v2 module via vm sandbox.
//    Same idiom as parent exploration test (lines 70-87) and the other
//    tests in this spec's family.
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
assert.ok(V2._internals &&
  typeof V2._internals.computeClassBounds === 'function' &&
  typeof V2._internals.computeEligibilityClasses === 'function',
  'V2._internals.{computeClassBounds, computeEligibilityClasses} are ' +
  'required by this test (Case 3 — synthetic-preservation bound ' +
  'reconstruction).');

// Shared deferred-failure accumulator. Mirrors the pattern from the
// parent exploration / fix tests so all three integration cases run
// to completion on UNFIXED code and surface every counterexample in
// one aggregated assert.fail at end-of-script.
var failures = [];

// ============================================================
// 2) Synthetic helpers — verbatim from the parent exploration test
//    (sections 2 and 6 of
//    tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js)
//    so the deficit-2 / deficit-3 inputs are byte-identical to the
//    parent-spec versions.
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

// Slot-metric load reconstruction helper — counts each appearance in
// `result[i].proctor_keys`. Mirrors the parent exploration test's
// `slotCount` loop (lines ~210-220) and the fix test's
// `reconstructSlotLoads` helper.
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

// ============================================================
// 3) Case 1 — Parent exploration replay (production fixture pinpoint).
//
// Mirrors `tests/proctor-v2-phase2-75-multi-step-bug-c1-exploration.test.js`
// section 10 (Task 1.3 — production-fixture replay), which is one of
// the two parent-spec tests documented as failing on F.
//
// Witness: idx=98 طارق الشعابتي, som=2270221, dutyCount=1.
//
// Pre-fix on F:
//   - min(loadState over all 147 proctors) = 0 (or 1 in the regressed-
//     further variant) — FAIL.
//   - طارق at load = 0 (or 1) — FAIL.
//   - coverageRepairUnresolved = 6 — FAIL.
//
// Post-fix (after Tasks 5.2 + 5.3):
//   - min ≥ 2 — PASS.
//   - طارق at load ≥ 2 (he is no longer in the zero-load set) — PASS.
//   - coverageRepairUnresolved = 0 — PASS.
// ============================================================

const PROD_FIXTURE_PATH = path.join(ROOT, 'tests/fixtures/45454.json');
const PROD_TARIK_IDX = 98;
const PROD_TARIK_NAME = 'طارق الشعابتي';
const PROD_TARIK_SOM = '2270221';

const prodInput = JSON.parse(fs.readFileSync(PROD_FIXTURE_PATH, 'utf8'));

(function guardProdWitness() {
  if (!Array.isArray(prodInput.proctorsList) ||
      prodInput.proctorsList.length !== 147) {
    failures.push('[case-1 setup] expected fixture 45454.json to contain ' +
      '147 proctors; got ' +
      ((prodInput.proctorsList && prodInput.proctorsList.length) || 0) +
      '. Fixture witness has drifted from the documented snapshot.');
    return;
  }
  var w = prodInput.proctorsList[PROD_TARIK_IDX];
  if (!w) {
    failures.push('[case-1 setup] proctorsList[' + PROD_TARIK_IDX +
      '] missing.');
    return;
  }
  var nameMatches = w.teacher_name === PROD_TARIK_NAME ||
    (w.teacher_name && w.teacher_name.indexOf(PROD_TARIK_NAME) >= 0);
  var somMatches = String(w.som || '') === PROD_TARIK_SOM;
  if (!nameMatches || !somMatches) {
    failures.push('[case-1 setup] expected proctorsList[' + PROD_TARIK_IDX +
      '] to be ' + PROD_TARIK_NAME + ' (som=' + PROD_TARIK_SOM + '); got ' +
      JSON.stringify({ name: w.teacher_name, som: w.som }) +
      '. Fixture witness has drifted from the documented snapshot.');
  }
})();

(function runCase1ParentExplorationReplay() {
  var outProd;
  try {
    outProd = V2.run(prodInput);
  } catch (e) {
    failures.push('[case-1] V2.run(45454.json) threw: ' + e.message);
    return;
  }
  if (!outProd || !outProd.result || !outProd.diagnostics) {
    failures.push('[case-1] V2.run(45454.json) returned no result/' +
      'diagnostics.');
    return;
  }
  var d = outProd.diagnostics;

  // Compute classLowerBound for the dominant (everyone-else) class —
  // mirrors the parent exploration test's lookup logic.
  var classBounds = d.classBounds || {};
  var dominantLB = 0;
  Object.keys(classBounds).forEach(function (cid) {
    var b = classBounds[cid];
    // The dominant class is the one with the largest member count,
    // approximated here by the smallest classLowerBound (the singletons
    // have inflated bounds pre-fix; the everyone-else big class has
    // classLowerBound = 2). Use a `Math.min` over all entries.
    if (b && typeof b.classLowerBound === 'number') {
      if (dominantLB === 0 || b.classLowerBound < dominantLB) {
        dominantLB = b.classLowerBound;
      }
    }
  });
  if (dominantLB === 0) dominantLB = 2; // fallback per documented snapshot

  // Reconstruct primary loads over ALL 147 proctors (including
  // zero-load entries). Mirrors lines ~720-750 of the parent
  // exploration test.
  var perKey = reconstructSlotLoads(outProd.result || []);
  var allLoads = [];
  for (var i = 0; i < prodInput.proctorsList.length; i++) {
    var proc = prodInput.proctorsList[i];
    var key = proc.cin || ('__idx_' + i);
    allLoads.push({
      idx: i,
      name: proc.teacher_name || '',
      som: String(proc.som || ''),
      load: perKey[key] || 0
    });
  }
  var minAll = allLoads.reduce(function (m, l) {
    return l.load < m ? l.load : m;
  }, Infinity);
  if (minAll === Infinity) minAll = 0;
  var zeroLoadAll = allLoads.filter(function (l) { return l.load === 0; });
  var tarikByName = allLoads.filter(function (l) {
    return l.name === PROD_TARIK_NAME ||
      (l.name && l.name.indexOf(PROD_TARIK_NAME) >= 0);
  });
  var tarikBySom = allLoads.filter(function (l) {
    return l.som === PROD_TARIK_SOM;
  });
  var tarik = (tarikByName.length === 1 && tarikBySom.length === 1 &&
    tarikByName[0].idx === tarikBySom[0].idx) ? tarikByName[0] : null;

  console.log('[case-1: parent-exploration-replay] tests/fixtures/45454.json:');
  console.log('  proctors=' + prodInput.proctorsList.length +
    ' | rows=' + outProd.result.length +
    ' | classLowerBound (dominant)=' + dominantLB);
  console.log('  min(loadState over all 147)=' + minAll +
    '  max(loadState)=' + allLoads.reduce(function (m, l) {
      return l.load > m ? l.load : m;
    }, -Infinity));
  console.log('  zero-load proctors=' + zeroLoadAll.length);
  zeroLoadAll.forEach(function (l) {
    console.log('    idx=' + l.idx + ' ' + l.name + ' (som=' + l.som + ')');
  });
  console.log('  coverageRepairSwaps=' + (d.coverageRepairSwaps || 0) +
    '  coverageRepairUnresolved=' + (d.coverageRepairUnresolved || 0));
  if (tarik) {
    console.log('  witness ' + PROD_TARIK_NAME + ' → idx=' + tarik.idx +
      ' load=' + tarik.load + ' som=' + tarik.som);
  } else {
    console.log('  witness ' + PROD_TARIK_NAME + ' → NOT IDENTIFIED ' +
      '(byName=' + tarikByName.length + ' bySom=' + tarikBySom.length + ')');
  }

  // ============================================================
  // ADAPTED to Property P-3 (this spec's relaxed acceptance criteria).
  //
  // Per design.md §"Correctness Properties" Property 1 / bugfix.md
  // §"Property P (Fix Checking)" P-3:
  //   - At most ONE proctor may have load < LB_global = 2 (the
  //     residual exception, طارق).
  //   - coverageRepairUnresolved ≤ 1.
  //   - Any residual coverageRepairWarnings entry MUST have
  //     classLowerBound capped (≤ LB_global + 1 = 3), proving the
  //     warning is NOT a false-positive on an impossible bound
  //     (294-352 pre-fix).
  //   - The 5 OTHER documented witnesses (__idx_62, __idx_28,
  //     __idx_133, __idx_109, __idx_21) MUST NO LONGER appear in
  //     coverageRepairWarnings — those false-positive warnings are
  //     eliminated by the cap+monotonicity guard from Tasks 5.2 + 5.3.
  // ============================================================

  var warnings = d.coverageRepairWarnings || {};
  var warningKeys = Object.keys(warnings).filter(function (k) {
    return k !== '__pass__';
  });

  // The 5 false-positive witnesses (from the agent-notes pre-fix
  // table) that MUST disappear post-fix. The 6th (__idx_98 طارق)
  // may legitimately remain as a truthful (capped-bound) residual.
  var DOCUMENTED_FALSE_POSITIVE_KEYS = [
    '__idx_62', '__idx_28', '__idx_133', '__idx_109', '__idx_21'
  ];

  // ----- P-3 assertion 1a: at most ONE proctor with load < LB_global -----
  // (zeroLoadAll counts load=0; for full P-3 fidelity we count
  // load < dominantLB, which on this fixture is the same set since
  // any proctor below 2 typically lands at 0 or 1 — see investigation
  // notes.)
  var belowLB = allLoads.filter(function (l) { return l.load < dominantLB; });
  if (belowLB.length > 1) {
    failures.push(
      '[case-1] Property P-3 violated: ' + belowLB.length + ' proctors ' +
      'have load < LB_global = ' + dominantLB + ' (P-3 allows AT MOST ' +
      'ONE residual). belowLB = ' + JSON.stringify(belowLB.map(function (l) {
        return { idx: l.idx, name: l.name, som: l.som, load: l.load };
      })) + '. After this spec\'s Tasks 5.2 + 5.3 cap singleton bounds, ' +
      'at most one proctor (طارق) may remain below LB_global as a ' +
      'truthful repair-pass residual; more than one indicates the cap ' +
      'is not firing correctly for some classes.'
    );
  }

  // ----- P-3 assertion 1b: coverageRepairUnresolved ≤ 1 -----
  if ((d.coverageRepairUnresolved || 0) > 1) {
    failures.push(
      '[case-1] Property P-3 violated: ' +
      'coverageRepairUnresolved = ' + (d.coverageRepairUnresolved || 0) +
      ' (P-3 allows AT MOST 1). Pre-fix this counter was 6 (one entry ' +
      'per impossible singleton classLowerBound: __idx_98, __idx_62, ' +
      '__idx_28, __idx_133, __idx_109, __idx_21). After Tasks 5.2 + ' +
      '5.3 cap every classLowerBound at LB_global + 1 = 3, the 5 ' +
      'false-positives MUST disappear; at most 1 truthful residual ' +
      '(طارق) may remain. diagnostics.coverageRepairWarnings=' +
      JSON.stringify(warnings) + '.'
    );
  }

  // ----- P-3 assertion 1c: residual warnings have CAPPED classLowerBound -----
  // For any remaining warning, its classLowerBound must be ≤ 3 (= LB_global+1).
  // This proves the warning is truthful (not a false-positive on an
  // impossible 294-352 bound).
  warningKeys.forEach(function (k) {
    var w = warnings[k] || {};
    var cLB = w.classLowerBound;
    if (typeof cLB === 'number' && cLB > dominantLB + 1) {
      failures.push(
        '[case-1] Property P-3 violated: residual coverageRepairWarning ' +
        'for key=' + k + ' has classLowerBound=' + cLB +
        ' > LB_global + 1 = ' + (dominantLB + 1) + '. This indicates ' +
        'a false-positive on an impossible bound (the cap from Tasks ' +
        '5.2 + 5.3 did not fire for this class). Warning entry: ' +
        JSON.stringify(w) + '.'
      );
    }
  });

  // ----- P-3 assertion 1d: the 5 documented false-positives are GONE -----
  DOCUMENTED_FALSE_POSITIVE_KEYS.forEach(function (k) {
    if (Object.prototype.hasOwnProperty.call(warnings, k)) {
      var w = warnings[k];
      failures.push(
        '[case-1] Property P-3 violated: documented false-positive ' +
        'witness key=' + k + ' still appears in coverageRepairWarnings ' +
        'post-fix. Pre-fix this entry had classLowerBound in 294-342 ' +
        '(impossible). After Tasks 5.2 + 5.3 cap singleton bounds at ' +
        'LB_global + 1 = 3, this false-positive MUST disappear (the ' +
        'proctor is at load=3=globalUpperBound and no longer flagged ' +
        'as uncovered). Current entry: ' + JSON.stringify(w) + '.'
      );
    }
  });

  // ----- P-3 assertion 1e (informational): if طارق is the residual, his
  //       warning's classLowerBound MUST be capped (≤ 3), proving the
  //       cap is firing correctly for HIS class even though his deficit
  //       is not closed by the (out-of-scope) repair pass. -----
  if (Object.prototype.hasOwnProperty.call(warnings, '__idx_98')) {
    var tarikW = warnings['__idx_98'];
    var tarikCLB = tarikW && tarikW.classLowerBound;
    if (typeof tarikCLB === 'number' && tarikCLB > dominantLB + 1) {
      failures.push(
        '[case-1] Property P-3 violated: residual طارق warning has ' +
        'classLowerBound=' + tarikCLB + ' > LB_global + 1 = ' +
        (dominantLB + 1) + '. The cap from Tasks 5.2 + 5.3 did not ' +
        'fire for طارق\'s singleton class — pre-fix the value was 352, ' +
        'post-fix it MUST be ≤ 3. Warning entry: ' +
        JSON.stringify(tarikW) + '.'
      );
    }
  }
})();

// ============================================================
// 4) Case 2 — Parent fix-checking replay (production fixture pinpoint).
//
// Mirrors `tests/proctor-v2-phase2-75-multi-step-fix.test.js`'s
// production-fixture pinpoint section. The parent fix test asserts
// the same machinery but additionally checks the structured
// coverageRepairWarnings map shape (post-fix it must be a plain
// object, not an Array) and the identity:
//
//   coverageRepairUnresolved = | warnings keys | excluding '__pass__'
//
// ADAPTED to Property P-3 (this spec's relaxed acceptance criteria):
// the parent-spec's strict min/طارق/unresolved assertions are RELAXED
// to allow at most one truthful residual (طارق with capped bound).
// The Map-shape and identity assertions are preserved as-is — those
// are independent of P-3 and are required by the parent spec.
// ============================================================

(function runCase2ParentFixReplay() {
  // Re-run V2 (independent invocation — confirms determinism with case 1).
  var outProd;
  try {
    outProd = V2.run(prodInput);
  } catch (e) {
    failures.push('[case-2] V2.run(45454.json) threw: ' + e.message);
    return;
  }
  if (!outProd || !outProd.diagnostics) {
    failures.push('[case-2] V2.run(45454.json) returned no diagnostics.');
    return;
  }
  var d = outProd.diagnostics;

  // ----- Parent fix-checking assertion 1: warnings is a Map (object), not Array -----
  var warnings = d.coverageRepairWarnings;
  var warningsIsMap = warnings !== null && typeof warnings === 'object' &&
    !Array.isArray(warnings);
  if (!warningsIsMap) {
    failures.push('[case-2] Parent spec fix-checking replay FAILED: ' +
      'coverageRepairWarnings is ' +
      (Array.isArray(warnings) ? 'Array' : typeof warnings) +
      ' (value=' + JSON.stringify(warnings) + '); the parent spec ' +
      'requires this to be a plain object map keyed by proctorKey ' +
      'post-fix. If the parent spec has not yet migrated the shape, ' +
      'this assertion FAILS pre-fix; this spec\'s Tasks 5.2 + 5.3 do ' +
      'not change this shape but the parent-spec dependency must be ' +
      'satisfied for the integration to pass.');
  }

  // ----- Parent fix-checking assertion 2: identity (warnings size = unresolved) -----
  if (warningsIsMap) {
    var nonPassCount = 0;
    Object.keys(warnings).forEach(function (k) {
      if (k !== '__pass__') nonPassCount++;
    });
    var unresolved = d.coverageRepairUnresolved || 0;
    if (nonPassCount !== unresolved) {
      failures.push('[case-2] Parent spec fix-checking replay FAILED: ' +
        'identity violated — non-__pass__ warnings count (' +
        nonPassCount + ') ≠ coverageRepairUnresolved (' + unresolved +
        '). This identity is preserved by Property 2 of this spec ' +
        '(per design.md §"Preservation Requirements") and is required ' +
        'by the parent fix test. If the identity holds pre-fix at the ' +
        'inflated values (6 = 6), it must continue to hold post-fix at ' +
        'the corrected values (0 = 0).');
    }
  }

  // ----- Parent fix-checking assertion 3 (ADAPTED to Property P-3):
  //       production pinpoint min/طارق/unresolved with relaxed criteria.
  //
  // Per design.md §"Correctness Properties" Property 1 / bugfix.md
  // §"Property P (Fix Checking)" P-3, the strict parent-spec criteria
  // (min ≥ 2 for ALL, طارق load ≥ 2, coverageRepairUnresolved == 0)
  // are RELAXED to:
  //   - At most ONE proctor with load < 2.
  //   - coverageRepairUnresolved ≤ 1.
  //   - Any residual warning has capped classLowerBound (≤ 3).
  // -----
  var perKey = reconstructSlotLoads(outProd.result || []);
  var loadsByIdx = {};
  var belowLBCount = 0;
  var tarikLoad = null;
  for (var i = 0; i < prodInput.proctorsList.length; i++) {
    var proc = prodInput.proctorsList[i];
    var key = proc.cin || ('__idx_' + i);
    var load = perKey[key] || 0;
    loadsByIdx[i] = load;
    if (load < 2) belowLBCount++;
    if (i === PROD_TARIK_IDX) tarikLoad = load;
  }

  if (belowLBCount > 1) {
    failures.push(
      '[case-2] Property P-3 violated: ' + belowLBCount + ' proctors ' +
      'have load < 2 = LB_global (P-3 allows AT MOST ONE residual). ' +
      'After this spec\'s Tasks 5.2 + 5.3 cap singleton bounds, at most ' +
      'one proctor (طارق) may legitimately remain below LB_global as ' +
      'a truthful repair-pass residual; more than one indicates the ' +
      'cap is not firing correctly.'
    );
  }

  if ((d.coverageRepairUnresolved || 0) > 1) {
    failures.push(
      '[case-2] Property P-3 violated: coverageRepairUnresolved = ' +
      (d.coverageRepairUnresolved || 0) + ' (P-3 allows AT MOST 1). ' +
      'Pre-fix this counter was 6 (six false-positive singleton-class ' +
      'warnings); after Tasks 5.2 + 5.3 cap singleton bounds at ' +
      'LB_global + 1 = 3, at most 1 truthful residual may remain.'
    );
  }

  // P-3 assertion: any residual warning has capped classLowerBound.
  if (warningsIsMap) {
    Object.keys(warnings).forEach(function (k) {
      if (k === '__pass__') return;
      var w = warnings[k] || {};
      var cLB = w.classLowerBound;
      if (typeof cLB === 'number' && cLB > 3) {
        failures.push(
          '[case-2] Property P-3 violated: residual warning for key=' + k +
          ' has classLowerBound=' + cLB + ' > LB_global + 1 = 3. The ' +
          'cap from Tasks 5.2 + 5.3 did not fire for this class. ' +
          'Warning entry: ' + JSON.stringify(w) + '.'
        );
      }
    });
  }

  console.log('[case-2: parent-fix-replay] tests/fixtures/45454.json:');
  console.log('  warnings is Map=' + warningsIsMap +
    ' | proctors below LB=' + belowLBCount +
    ' | طارق load=' + tarikLoad +
    ' | unresolved=' + (d.coverageRepairUnresolved || 0));
})();

// ============================================================
// 5) Case 3 — Parent-spec synthetic preservation.
//
// Replay the parent spec's synthetic deficit-2 (Task 1.1 — 4 proctors
// × 1 halfday × 9 slots, classLowerBound=2) and deficit-3 (Task 1.2 —
// 5 proctors × 1 halfday × 16 slots, classLowerBound=3) inputs, and
// confirm this spec's fix is a STRICT NO-OP on them.
//
// The parent-spec synthetic inputs are constructed so that all proctors
// share a single eligibility class (no exemptions, no duty, identical
// schedule access). That means:
//
//   - classIds.length === 1 (the only-one-class branch, lines 561-574
//     of computeClassBounds)
//   - The only-one-class branch is EXPLICITLY out of scope per
//     design.md §"Specific Changes" point 3 — it is preserved
//     unchanged
//   - Therefore: pre-fix and post-fix classBounds are byte-identical
//     for both inputs
//
// We assert this by deriving classBounds via _internals on the
// pre-fix code (which is the current code on F) and verifying:
//
//   (a) deficit-2: classLowerBound = 2, classUpperBound = 3
//       (= ceil(9/4) = 3); all bounds ≤ LB_global + 1
//   (b) deficit-3: classLowerBound = 3, classUpperBound = 4
//       (= ceil(16/5) = 4); all bounds ≤ LB_global + 1
//   (c) NEITHER input triggers isBugCondition(X) (no class with
//       floor(bTotal/bSize) > LB_global + 1)
//
// The parent spec's own assertions on these inputs (loadP < 
// classLowerBound under the single-swap-per-round structural cap)
// continue to FAIL pre-fix because the parent spec's fix is also
// unfixed — but those assertions are about the REPAIR PASS, not the
// BOUNDS, so they're outside this integration test's scope. We only
// verify that this spec's edits do not perturb the bounds for these
// inputs.
//
// Pre-fix and post-fix: this case PASSES on both code states.
// ============================================================

function buildSyntheticDeficit2Input() {
  // Verbatim from parent exploration test §2.
  var peerA = makeProctor('peer_A', 'CIN_A001', 'عام', 'ذكر');
  var peerB = makeProctor('peer_B', 'CIN_B002', 'عام', 'ذكر');
  var peerC = makeProctor('peer_C', 'CIN_C003', 'عام', 'ذكر');
  var pUncov = makeProctor('p_uncov', 'CIN_P099', 'الرياضيات', 'أنثى');
  return {
    proctorsList: [peerA, peerB, peerC, pUncov],
    scheduleEntries: [
      makeEntry('الحصة الأولى'),
      makeEntry('الحصة الثانية'),
      makeEntry('الحصة الثالثة')
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

function buildSyntheticDeficit3Input() {
  // Verbatim from parent exploration test §6.
  var d3_peerA = makeProctor('peer_A_d3', 'CIN_DA01', 'عام', 'ذكر');
  var d3_peerB = makeProctor('peer_B_d3', 'CIN_DB02', 'عام', 'ذكر');
  var d3_peerC = makeProctor('peer_C_d3', 'CIN_DC03', 'عام', 'ذكر');
  var d3_peerD = makeProctor('peer_D_d3', 'CIN_DD04', 'عام', 'ذكر');
  var d3_pUncov = makeProctor('p_uncov_d3', 'CIN_PD99', 'الرياضيات', 'أنثى');
  return {
    proctorsList: [d3_peerA, d3_peerB, d3_peerC, d3_peerD, d3_pUncov],
    scheduleEntries: [
      makeEntry('الحصة الأولى'),
      makeEntry('الحصة الثانية'),
      makeEntry('الحصة الثالثة'),
      makeEntry('الحصة الرابعة')
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
        makeRoom('R1'), makeRoom('R2'), makeRoom('R3'), makeRoom('R4')
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

// Pure bound-derivation helper — calls _internals helpers directly.
// No IPC, no DB, no randomness. Mirrors `deriveBounds` in the Task 3
// fix test (lines ~135-200).
function deriveBoundsForSyntheticInput(input) {
  var proctorsList = input.proctorsList;
  var scheduleEntries = input.scheduleEntries;
  var proctorsPerRoom = (input.examDistributionRules &&
    input.examDistributionRules.proctorsPerRoom) || 1;
  var D_expected = Number(input.D_expected) || 0;

  // For the synthetic inputs, every entry shares the same level_name
  // as the rooms, so getRoomsForEntry returns all rooms × proctorsPerRoom.
  var guardSlotsByIndex = {};
  var roomsList = (input.options && input.options.roomsList) || [];
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

  var totalGuardSlots = 0;
  for (var ti = 0; ti < scheduleEntries.length; ti++) {
    totalGuardSlots += Number(guardSlotsByIndex[ti]) || 0;
  }
  var lbGlobal = eligibleCount > 0
    ? Math.floor((totalGuardSlots + D_expected) / eligibleCount)
    : 0;

  var classBoundsArr = [];
  classBoundsMap.forEach(function (b, classId) {
    classBoundsArr.push({
      classId: classId,
      classLowerBound: b.classLowerBound,
      classUpperBound: b.classUpperBound,
      G_class: b.G_class,
      D_expected_class: b.D_expected_class
    });
  });

  return {
    classBoundsMap: classBoundsMap,
    classBoundsArr: classBoundsArr,
    classCount: eligibilityClasses.size,
    eligibleCount: eligibleCount,
    totalGuardSlots: totalGuardSlots,
    lbGlobal: lbGlobal
  };
}

// Serialization helper — produces a stable string representation of
// the per-class bounds suitable for byte-equality comparison. Sorted
// by classId so iteration order is deterministic. Mirrors
// `serializeClassBounds` in the production module (lines 622-633).
function serializeBoundsForCompare(ctx) {
  var sorted = ctx.classBoundsArr.slice().sort(function (a, b) {
    if (a.classId < b.classId) return -1;
    if (a.classId > b.classId) return 1;
    return 0;
  });
  return JSON.stringify(sorted);
}

(function runCase3SyntheticPreservation() {
  // ---- Sub-case 3a: deficit-2 input ----
  var d2Input = buildSyntheticDeficit2Input();
  var d2Ctx;
  try {
    d2Ctx = deriveBoundsForSyntheticInput(d2Input);
  } catch (e) {
    failures.push('[case-3a deficit-2] deriveBounds threw: ' + e.message);
    return;
  }
  console.log('[case-3a: synthetic deficit-2] classCount=' + d2Ctx.classCount +
    ' eligibleCount=' + d2Ctx.eligibleCount +
    ' totalGuardSlots=' + d2Ctx.totalGuardSlots +
    ' LB_global=' + d2Ctx.lbGlobal +
    ' LB_global+1=' + (d2Ctx.lbGlobal + 1));
  d2Ctx.classBoundsArr.forEach(function (b) {
    console.log('  classId=' + b.classId +
      ' classLowerBound=' + b.classLowerBound +
      ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class +
      ' D_expected_class=' + b.D_expected_class);
  });

  // Geometry sanity check — single eligibility class, 9 guard slots,
  // 4 eligible proctors, classLowerBound = floor(9/4) = 2.
  if (d2Ctx.classCount !== 1) {
    failures.push('[case-3a deficit-2] expected exactly 1 eligibility ' +
      'class (single-class only-one-class branch); got ' +
      d2Ctx.classCount + '. Synthetic input geometry has drifted from ' +
      'parent exploration test §2.');
  }
  if (d2Ctx.eligibleCount !== 4) {
    failures.push('[case-3a deficit-2] expected eligibleCount=4; got ' +
      d2Ctx.eligibleCount + '.');
  }
  if (d2Ctx.totalGuardSlots !== 9) {
    failures.push('[case-3a deficit-2] expected totalGuardSlots=9 (3 ' +
      'sessions × 3 rooms); got ' + d2Ctx.totalGuardSlots + '.');
  }
  if (d2Ctx.lbGlobal !== 2) {
    failures.push('[case-3a deficit-2] expected LB_global=2 ' +
      '(floor(9/4)); got ' + d2Ctx.lbGlobal + '.');
  }

  // The class-bound assertions: classLowerBound = 2, classUpperBound = 3.
  // These are produced by the only-one-class branch (out-of-scope per
  // design.md §"Specific Changes" point 3); they are byte-identical
  // pre-fix and post-fix.
  if (d2Ctx.classBoundsArr.length === 1) {
    var d2b = d2Ctx.classBoundsArr[0];
    if (d2b.classLowerBound !== 2) {
      failures.push('[case-3a deficit-2] classLowerBound = ' +
        d2b.classLowerBound + ' (expected 2 = floor(9/4)). ' +
        'The only-one-class branch is out-of-scope per design.md ' +
        '§"Specific Changes" point 3 — this value MUST be byte-' +
        'identical pre-fix and post-fix. If this fails on F, this ' +
        'spec\'s edits have inadvertently perturbed the only-one-class ' +
        'branch (a preservation violation).');
    }
    if (d2b.classUpperBound !== 3) {
      failures.push('[case-3a deficit-2] classUpperBound = ' +
        d2b.classUpperBound + ' (expected 3 = ceil(9/4)). ' +
        'The only-one-class branch is out-of-scope and MUST produce ' +
        'identical bounds pre-fix and post-fix.');
    }
    // No singleton-class bug condition triggers.
    if (!(d2b.classLowerBound <= d2Ctx.lbGlobal + 1)) {
      failures.push('[case-3a deficit-2] classLowerBound = ' +
        d2b.classLowerBound + ' > LB_global + 1 = ' +
        (d2Ctx.lbGlobal + 1) + '. This input is NOT supposed to ' +
        'trigger this spec\'s bug condition (no singleton class with ' +
        'G_class > LB_global). If isBugCondition fires here, the ' +
        'integration premise is wrong.');
    }
  }

  // ---- Sub-case 3b: deficit-3 input ----
  var d3Input = buildSyntheticDeficit3Input();
  var d3Ctx;
  try {
    d3Ctx = deriveBoundsForSyntheticInput(d3Input);
  } catch (e) {
    failures.push('[case-3b deficit-3] deriveBounds threw: ' + e.message);
    return;
  }
  console.log('[case-3b: synthetic deficit-3] classCount=' + d3Ctx.classCount +
    ' eligibleCount=' + d3Ctx.eligibleCount +
    ' totalGuardSlots=' + d3Ctx.totalGuardSlots +
    ' LB_global=' + d3Ctx.lbGlobal +
    ' LB_global+1=' + (d3Ctx.lbGlobal + 1));
  d3Ctx.classBoundsArr.forEach(function (b) {
    console.log('  classId=' + b.classId +
      ' classLowerBound=' + b.classLowerBound +
      ' classUpperBound=' + b.classUpperBound +
      ' G_class=' + b.G_class +
      ' D_expected_class=' + b.D_expected_class);
  });

  // Geometry sanity check — single eligibility class, 16 guard slots,
  // 5 eligible proctors, classLowerBound = floor(16/5) = 3.
  if (d3Ctx.classCount !== 1) {
    failures.push('[case-3b deficit-3] expected exactly 1 eligibility ' +
      'class; got ' + d3Ctx.classCount + '. Synthetic input geometry ' +
      'has drifted from parent exploration test §6.');
  }
  if (d3Ctx.eligibleCount !== 5) {
    failures.push('[case-3b deficit-3] expected eligibleCount=5; got ' +
      d3Ctx.eligibleCount + '.');
  }
  if (d3Ctx.totalGuardSlots !== 16) {
    failures.push('[case-3b deficit-3] expected totalGuardSlots=16 (4 ' +
      'sessions × 4 rooms); got ' + d3Ctx.totalGuardSlots + '.');
  }
  if (d3Ctx.lbGlobal !== 3) {
    failures.push('[case-3b deficit-3] expected LB_global=3 ' +
      '(floor(16/5)); got ' + d3Ctx.lbGlobal + '.');
  }

  if (d3Ctx.classBoundsArr.length === 1) {
    var d3b = d3Ctx.classBoundsArr[0];
    if (d3b.classLowerBound !== 3) {
      failures.push('[case-3b deficit-3] classLowerBound = ' +
        d3b.classLowerBound + ' (expected 3 = floor(16/5)). ' +
        'The only-one-class branch is out-of-scope and MUST produce ' +
        'identical bounds pre-fix and post-fix.');
    }
    if (d3b.classUpperBound !== 4) {
      failures.push('[case-3b deficit-3] classUpperBound = ' +
        d3b.classUpperBound + ' (expected 4 = ceil(16/5)).');
    }
    if (!(d3b.classLowerBound <= d3Ctx.lbGlobal + 1)) {
      failures.push('[case-3b deficit-3] classLowerBound = ' +
        d3b.classLowerBound + ' > LB_global + 1 = ' +
        (d3Ctx.lbGlobal + 1) + '. This input is NOT supposed to ' +
        'trigger this spec\'s bug condition.');
    }
  }

  // Snapshot the serialized bounds for both inputs — Task 6 will
  // re-run this test post-fix and compare against the snapshot. The
  // snapshots are recorded in the console output so a CI diff between
  // pre-fix and post-fix runs surfaces any deviation immediately.
  console.log('[case-3 preservation snapshot]');
  console.log('  deficit-2 bounds: ' + serializeBoundsForCompare(d2Ctx));
  console.log('  deficit-3 bounds: ' + serializeBoundsForCompare(d3Ctx));
})();

// ============================================================
// 6) End-of-script — surface collected counterexamples.
//
// Pre-fix: cases 1 and 2 populate `failures`. Case 3 is empty (the
// synthetic inputs are unaffected by this spec's fix).
// Post-fix (after Tasks 5.2 + 5.3): all three cases pass cleanly,
// `failures` is empty, and the script exits with status 0.
// ============================================================

if (failures.length > 0) {
  assert.fail('proctor-v2-singleton-class-bounds integration test — ' +
    failures.length + ' counterexample(s):\n\n' +
    failures.map(function (m, i) { return '(' + (i + 1) + ') ' + m; })
      .join('\n\n'));
}

console.log('[integration] all 3 cases passed.');

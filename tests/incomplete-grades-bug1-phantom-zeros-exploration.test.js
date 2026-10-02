'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on UNFIXED code.
//
// Spec: .kiro/specs/incomplete-grades-averages-risk/
// Task 1 — Bug Condition (design `isBugCondition` C1, Correctness Property 1):
//   A grade record whose RAW value is "not-entered" (null, undefined, '',
//   whitespace-only, or a non-numeric placeholder) is coerced by Number() to a
//   finite 0, survives the Number.isFinite filter, and is averaged in / fed to
//   the lowest-mark KPI as if it were a genuine, deliberately-recorded 0.
//
// This test encodes the EXPECTED (fixed) behavior, so it MUST FAIL on the
// unfixed code. DO NOT attempt to "fix" this test or the production code when
// it fails — the failure is the proof that the bug exists. The very same test
// is re-run after the fix (tasks 4.1/4.2/4.4) and is expected to PASS then.
//
// Validates: Requirements 1.1, 1.2, 1.3, 1.4
//
// Pure layers under test (Node-runnable, no Electron/DOM):
//   - computeSubjectAverage      (js/cc-rules.js)
//   - computeTermAverage         (js/student-averages.js)
//   - computeStudentAverages     (js/student-averages.js)
//   - isGradeEntered             (js/student-averages.js)  ← added by the fix
//   - the load-mapping / lowest-mark-KPI path replicated from
//     js/pages/student-profile.js (the fix routes it through isGradeEntered)
//
// Concrete pinned cases (synthetic; demonstrate the SAME mechanics the real
// dataset showed as 9.38 / 1.61 / 5.01 / 0.0):
//   1. Subject phantom-zero : التربية البدنية T1 [20,18.75,17.5], T2 [null,null,null]
//                             → expected 18.75   (unfixed shows 9.375)
//   2. Empty-term average   : a term whose raw values are all not-entered
//                             → expected null    (unfixed shows 0)
//   3. General average      : T1 = 8.42, T2 not-entered
//                             → expected 8.42    (unfixed shows 4.21)
//   4. Lowest-mark KPI      : real marks {8,12,15} + not-entered placeholders
//                             → expected 8       (unfixed shows 0)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fc = require('fast-check');

const ROOT = path.join(__dirname, '..');
const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// Load the pure layers into a shared VM sandbox.
//
// cc-rules.js is a sloppy-mode script: its top-level `function` declarations
// (computeSubjectAverage, computeWeightedGeneralAverage, ccBaseSubject, …)
// attach to the sandbox global. student-averages.js then resolves those via
// its `_root` (= globalThis = sandbox) lookups, so computeTermAverage /
// computeStudentAverages exercise the REAL math, not their internal fallbacks.
// ---------------------------------------------------------------------------

function loadPureLayers() {
  const sandbox = {
    console: console, Math: Math, Number: Number, Object: Object, Array: Array,
    String: String, Boolean: Boolean, Set: Set, Map: Map, JSON: JSON,
    isFinite: isFinite, isNaN: isNaN, Infinity: Infinity, NaN: NaN,
    parseInt: parseInt, parseFloat: parseFloat, Error: Error,
    module: { exports: {} }
  };
  sandbox.window = {};
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/cc-rules.js'), 'utf8'), sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/student-averages.js'), 'utf8'), sandbox);

  const SA = sandbox.module.exports || (sandbox.window.GS2 && sandbox.window.GS2.StudentAverages);
  assert.ok(SA && typeof SA.computeTermAverage === 'function',
    'Failed to load StudentAverages API from js/student-averages.js');
  assert.ok(typeof sandbox.computeSubjectAverage === 'function',
    'Failed to load computeSubjectAverage from js/cc-rules.js');

  return {
    computeSubjectAverage: sandbox.computeSubjectAverage,
    computeTermAverage: SA.computeTermAverage,
    computeStudentAverages: SA.computeStudentAverages,
    isGradeEntered: SA.isGradeEntered // undefined until the fix adds it
  };
}

const L = loadPureLayers();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NOT_ENTERED_VALUES = [null, undefined, '', '  ', '\t', '\n', 'x', 'abc', '—'];

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
}

// Lowest-mark KPI as the FIXED js/pages/student-profile.js computes it:
// keep only entered records (via the new discriminator), coerce, then reduce.
// On unfixed code isGradeEntered is undefined and this throws — a clean failure
// that documents the missing entered/not-entered discriminator.
function lowestEnteredMark(rawGrades) {
  const entered = (rawGrades || []).filter((g) => L.isGradeEntered(g.grade));
  return entered
    .map((g) => Number(g.grade))
    .reduce((m, v) => (v < m ? v : m), Infinity);
}

// What the UNFIXED load mapping produces (for documenting the counterexample):
function lowestUnfixed(rawGrades) {
  return (rawGrades || [])
    .map((g) => ({ grade: Number(g.grade) }))
    .filter((g) => Number.isFinite(g.grade))
    .reduce((m, g) => (g.grade < m ? g.grade : m), Infinity);
}

// ---------------------------------------------------------------------------
// Arbitraries for the scoped PBT.
// ---------------------------------------------------------------------------

// A real, entered mark — includes a genuine 0 to confirm it is NOT treated as
// not-entered (it must stay in the average).
const realMarkArb = fc.oneof(
  { weight: 6, arbitrary: fc.double({ min: 1, max: 20, noNaN: true, noDefaultInfinity: true }) },
  { weight: 1, arbitrary: fc.constant(0) } // genuine zero (exam absence/cheating)
);

const notEnteredArb = fc.constantFrom.apply(fc, NOT_ENTERED_VALUES);

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

console.log('[exploration] incomplete-grades Bug 1 — phantom zeros (EXPECTED TO FAIL on unfixed code)');

try {
  // =========================================================================
  // Pinned case 1 — subject phantom-zero.
  // =========================================================================
  (function subjectPhantomZero() {
    const subject = 'التربية البدنية';
    const records = [
      { subject: subject, grade: 20, semester: 1 },
      { subject: subject, grade: 18.75, semester: 1 },
      { subject: subject, grade: 17.5, semester: 1 },
      { subject: subject, grade: null, semester: 2 },
      { subject: subject, grade: null, semester: 2 },
      { subject: subject, grade: null, semester: 2 }
    ];
    const avg = L.computeSubjectAverage(subject, records);
    assert.ok(
      approx(avg, 18.75, 1e-6),
      'Subject phantom-zero: computeSubjectAverage("' + subject + '") = ' + avg +
        ' but expected ≈ 18.75. The three not-entered Term-2 records (raw null) were ' +
        'coerced to genuine 0 and averaged in → (20+18.75+17.5+0+0+0)/6 = 9.375. ' +
        'Counterexample: raw null treated as a real 0.'
    );
  })();

  // =========================================================================
  // Pinned case 2 — empty-term average must be null, not a phantom number.
  // =========================================================================
  (function emptyTermAverage() {
    const term2Grades = [
      { subject: 'الرياضيات', grade: null, semester: 2 },
      { subject: 'الفيزياء والكيمياء', grade: '', semester: 2 },
      { subject: 'اللغة العربية', grade: '  ', semester: 2 }
    ];
    const term2 = L.computeTermAverage(term2Grades, null);
    assert.strictEqual(
      term2, null,
      'Empty-term average: computeTermAverage(all-not-entered) = ' + term2 +
        ' but expected null ("قيد الإنجاز"/"—"). The not-entered raw values were ' +
        'coerced to 0, producing a phantom numeric term average. Counterexample: ' +
        JSON.stringify(term2Grades.map((g) => g.grade)) + ' → ' + term2 + ' (expected null).'
    );
  })();

  // =========================================================================
  // Pinned case 3 — general average ignores a not-entered term.
  // =========================================================================
  (function generalAverage() {
    const grades = [
      { subject: 'الرياضيات', grade: 8.42, semester: 1 }, // الرياضيات → 100% exam
      { subject: 'الرياضيات', grade: null, semester: 2 }
    ];
    const res = L.computeStudentAverages(grades, null);
    assert.strictEqual(
      res.term2, null,
      'General average / term2: expected term2 = null (not-entered), got ' + res.term2 +
        '. Not-entered Term-2 was coerced to a phantom 0.'
    );
    assert.ok(
      res.general != null && approx(res.general, 8.42, 1e-6),
      'General average: expected general = 8.42 (Term-1 only, Term-2 not entered), got ' +
        res.general + '. The phantom Term-2 zero pulled the general down to ' +
        '(8.42 + 0)/2 = 4.21. Counterexample: T1=8.42, T2=not-entered → general ' +
        res.general + ' (expected 8.42).'
    );
  })();

  // =========================================================================
  // Pinned case 4 — lowest-mark KPI ignores not-entered placeholders.
  // =========================================================================
  (function lowestMarkKpi() {
    const rawGrades = [
      { subject: 'الرياضيات', grade: 8, semester: 1 },
      { subject: 'الفيزياء والكيمياء', grade: 12, semester: 1 },
      { subject: 'اللغة العربية', grade: 15, semester: 1 },
      { subject: 'الفلسفة', grade: null, semester: 2 },
      { subject: 'الإنجليزية', grade: '', semester: 2 },
      { subject: 'التربية البدنية', grade: '  ', semester: 2 }
    ];
    const unfixed = lowestUnfixed(rawGrades);
    const min = lowestEnteredMark(rawGrades); // throws on unfixed (isGradeEntered missing)
    assert.strictEqual(
      min, 8,
      'Lowest-mark KPI: expected 8 (lowest real entered mark), got ' + min +
        '. The unfixed load mapping (Number(raw) + Number.isFinite filter) coerces ' +
        'not-entered placeholders to a phantom 0 → KPI shows ' + unfixed + '.'
    );
  })();

  // =========================================================================
  // Scoped PBT — adding any number of not-entered records must NOT change the
  // subject average (Property 1). Genuine zeros stay; not-entered are excluded.
  // =========================================================================
  fc.assert(
    fc.property(
      fc.array(realMarkArb, { minLength: 1, maxLength: 8 }),
      fc.array(notEnteredArb, { minLength: 1, maxLength: 6 }),
      fc.constantFrom('الرياضيات', 'التربية البدنية', 'اللغة العربية', 'الفيزياء والكيمياء'),
      (realMarks, placeholders, subject) => {
        const realRecords = realMarks.map((m) => ({ subject: subject, grade: m }));
        const mixed = realRecords.concat(
          placeholders.map((p) => ({ subject: subject, grade: p }))
        );

        const baseline = L.computeSubjectAverage(subject, realRecords);
        const withPlaceholders = L.computeSubjectAverage(subject, mixed);

        assert.ok(
          approx(withPlaceholders, baseline, 1e-9),
          'Not-entered records changed the subject average for "' + subject + '": ' +
            'real-only avg = ' + baseline + ', with not-entered placeholders = ' +
            withPlaceholders + '. Placeholders ' + JSON.stringify(placeholders) +
            ' were coerced to genuine 0 and averaged in (real marks ' +
            JSON.stringify(realMarks) + ').'
        );
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  // Reaching here means the bug did NOT reproduce — unexpected for unfixed code.
  console.log('[exploration] (UNEXPECTED) all assertions passed — the phantom-zero ' +
    'bug did not reproduce. The code may already be fixed, or the root-cause/test ' +
    'logic needs review.');
  process.exit(0);
} catch (err) {
  console.error('FAIL (EXPECTED on unfixed code): Property 1 — not-entered marks ' +
    'are being treated as genuine zeros.');
  console.error(err && err.message ? err.message : err);
  if (err && err.counterexample) {
    console.error('Counterexample: ' + JSON.stringify(err.counterexample));
  }
  process.exit(1);
}

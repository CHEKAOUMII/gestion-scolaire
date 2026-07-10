'use strict';

// Preservation property test — EXPECTED to PASS on UNFIXED code.
//
// Spec: .kiro/specs/incomplete-grades-averages-risk/
// Task 3 — Preservation (Correctness Property 2 & Property 4):
//   For every input where the bug condition does NOT hold (all grade values are
//   genuinely entered finite numbers — including a deliberate 0 — and risk
//   results where the final level already agrees with the composite zone), the
//   code must behave EXACTLY as it does today. This locks the baseline before
//   the Bug 1 / Bug 2 fix lands so any later regression is caught.
//
// Observation-first methodology: the concrete expected numbers below were
// RECORDED by running these exact pure layers on the current (UNFIXED) code,
// then asserted here. This test is re-run after the fix (task 4.6) and must
// still PASS — proving genuine zeros, complete-data averages, the worst-wins
// rule, the weighted composite formula, and agreeing gauges are all unchanged.
//
// **Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6**
//
// Pure layers under test (Node-runnable, no Electron/DOM):
//   - computeSubjectAverage      (js/cc-rules.js)        — genuine-zero math
//   - computeTermAverage         (js/student-averages.js)
//   - computeStudentAverages     (js/student-averages.js)
//   - computeStudentRisk         (js/student-risk.js)    — engine, UNCHANGED
//   - renderStudentRiskTab()     (js/pages/student-profile.js) — agreeing gauge

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fc = require('fast-check');

const ROOT = path.join(__dirname, '..');
const MIN_CASES = 100;

const SOLID = ['var(--color-success-solid)', 'var(--color-warning-solid)', 'var(--color-danger-solid)'];

function approx(a, b, eps) {
  return Math.abs(a - b) <= (eps == null ? 1e-9 : eps);
}
function round2(x) {
  return Math.round(x * 100) / 100;
}

// ---------------------------------------------------------------------------
// Sandbox 1 — pure averaging layers (cc-rules.js + student-averages.js).
// Mirrors the loader in the Bug 1 exploration test: cc-rules.js declares the
// math helpers on the sandbox global, student-averages.js resolves them via
// its _root lookups so the REAL weighted math runs (not the simple-mean
// fallback).
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

  const SA = sandbox.module.exports;
  assert.ok(SA && typeof SA.computeTermAverage === 'function',
    'Failed to load StudentAverages API from js/student-averages.js');
  assert.ok(typeof sandbox.computeSubjectAverage === 'function',
    'Failed to load computeSubjectAverage from js/cc-rules.js');

  return {
    computeSubjectAverage: sandbox.computeSubjectAverage,
    computeTermAverage: SA.computeTermAverage,
    computeStudentAverages: SA.computeStudentAverages
  };
}

// ---------------------------------------------------------------------------
// Sandbox 2 — pure risk engine + the REAL renderStudentRiskTab() slice.
// Mirrors the loader in the Bug 2 exploration test.
// ---------------------------------------------------------------------------

function makeEl(id) {
  return {
    id: id, style: {}, dataset: {}, children: [], textContent: '', innerHTML: '',
    insertAdjacentHTML(_pos, html) { this.innerHTML += String(html); },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {}, addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    parentNode: null
  };
}
function makeDoc() {
  const reg = new Map();
  return {
    _reg: reg,
    body: makeEl('body'),
    getElementById(id) { if (!reg.has(id)) reg.set(id, makeEl(id)); return reg.get(id); },
    createElement() { return makeEl(null); }
  };
}

function buildRiskSandbox() {
  const sandbox = {
    console: console, Math: Math, Number: Number, Object: Object, Array: Array,
    String: String, Boolean: Boolean, JSON: JSON, Set: Set, Map: Map,
    isFinite: isFinite, isNaN: isNaN, Infinity: Infinity, NaN: NaN,
    parseInt: parseInt, parseFloat: parseFloat, Error: Error,
    setTimeout: setTimeout, clearTimeout: clearTimeout,
    module: { exports: {} }
  };
  sandbox.window = {};
  sandbox.globalThis = sandbox;
  sandbox.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  };
  sandbox.collectEconomicData = function () { return {}; };
  sandbox.collectSocialData = function () { return {}; };
  sandbox.collectHealthData = function () { return {}; };
  sandbox._bmScoreState = { economic: null, social: null, health: null, followup: null };
  sandbox._currentStudentCode = null;
  sandbox._currentStudentId = null;
  sandbox.SCHOOL_YEAR = '2025/2026';
  sandbox._riskState = { generalAverage: null, subjectAverages: [], justifiedHours: 0, unjustifiedHours: 0 };

  vm.createContext(sandbox);

  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/student-risk.js'), 'utf8'), sandbox);
  assert.strictEqual(typeof sandbox.window.computeStudentRisk, 'function',
    'Failed to load computeStudentRisk from js/student-risk.js');

  const src = fs.readFileSync(path.join(ROOT, 'js/pages/student-profile.js'), 'utf8');
  const startMarker = 'const _RISK_LEVEL_SOLID = [';
  const endMarker = '// Expose for the inline bmUpdateRisk() wrapper and event handlers.';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  assert.ok(start >= 0 && end > start,
    'Failed to locate renderStudentRiskTab slice markers in js/pages/student-profile.js');
  vm.runInContext(src.slice(start, end), sandbox);
  assert.strictEqual(typeof sandbox.renderStudentRiskTab, 'function',
    'Failed to load renderStudentRiskTab from js/pages/student-profile.js');

  return sandbox;
}

const L = loadPureLayers();
const SBX = buildRiskSandbox();

function renderRisk(state) {
  SBX._riskState = state;
  SBX.document = makeDoc();
  const result = SBX.window.computeStudentRisk({
    generalAverage: state.generalAverage,
    subjectAverages: state.subjectAverages,
    justifiedHours: state.justifiedHours,
    unjustifiedHours: state.unjustifiedHours
  });
  SBX.renderStudentRiskTab();
  return { doc: SBX.document, result: result };
}

console.log('[preservation] incomplete-grades — genuine zeros, complete data, ' +
  'worst-wins rule, composite formula, agreeing gauges (EXPECTED TO PASS on unfixed code)');

try {
  // =========================================================================
  // Property 2 — Pinned: genuine zeros are real values, complete data unchanged.
  // Numbers recorded by running these pure layers on the UNFIXED code.
  // =========================================================================

  // Req 3.1 — a deliberate 0 lowers the average (it is a real value, math = mean).
  assert.strictEqual(
    L.computeSubjectAverage('الرياضيات', [
      { subject: 'الرياضيات', grade: 0 },
      { subject: 'الرياضيات', grade: 10 }
    ]),
    5,
    'Genuine zero must be averaged in: mean(0, 10) = 5.'
  );

  // Req 3.1 — genuine 0 in a 75/25 exam+activity subject (observed = 9).
  assert.strictEqual(
    L.computeSubjectAverage('اللغة العربية', [
      { subject: 'اللغة العربية', grade: 0 },
      { subject: 'اللغة العربية', grade: 16 },
      { subject: 'اللغة العربية (الأنشطة المندمجة)', grade: 12 }
    ]),
    9,
    'Genuine zero preserved in weighted subject: examAvg=(0+16)/2=8, act=12 → 8*0.75+12*0.25=9.'
  );

  // Req 3.2 / 3.3 — complete-data student (observed term1=11.5, term2=10.5, general=11).
  (function completeDataStudent() {
    const grades = [
      { subject: 'الرياضيات', grade: 12, semester: 1 },
      { subject: 'الرياضيات', grade: 14, semester: 1 },
      { subject: 'اللغة العربية', grade: 9, semester: 1 },
      { subject: 'الرياضيات', grade: 10, semester: 2 },
      { subject: 'اللغة العربية', grade: 11, semester: 2 }
    ];
    const res = L.computeStudentAverages(grades, null);
    assert.ok(
      res.term1 === 11.5 && res.term2 === 10.5 && res.general === 11,
      'Complete-data averages must be unchanged: expected {term1:11.5,term2:10.5,general:11}, got ' +
        JSON.stringify(res)
    );
  })();

  // Req 3.1 / 3.3 — a genuine-zero record is included; a truly empty term is null.
  (function genuineZeroStudent() {
    const grades = [
      { subject: 'الرياضيات', grade: 0, semester: 1 },
      { subject: 'اللغة العربية', grade: 20, semester: 1 }
    ];
    const res = L.computeStudentAverages(grades, null);
    assert.ok(
      res.term1 === 10 && res.term2 === null && res.general === 10,
      'Genuine-zero student: expected term1=(0+20)/2=10, term2 absent=null, general=10. Got ' +
        JSON.stringify(res)
    );
  })();

  // =========================================================================
  // Property 2 — PBT: for ALL fully-entered grade sets (incl. genuine 0), the
  // math-subject average equals the arithmetic mean computed the original way
  // (الرياضيات = 100% exam weight → pure mean). No not-entered records present,
  // so the bug condition does NOT hold and the value must be preserved.
  // =========================================================================

  const enteredMarkArb = fc.oneof(
    { weight: 6, arbitrary: fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }) },
    { weight: 1, arbitrary: fc.constant(0) } // genuine zero
  );

  fc.assert(
    fc.property(
      fc.array(enteredMarkArb, { minLength: 1, maxLength: 10 }),
      (marks) => {
        const records = marks.map((m) => ({ subject: 'الرياضيات', grade: m }));
        const live = L.computeSubjectAverage('الرياضيات', records);
        const reference = marks.reduce((s, v) => s + v, 0) / marks.length;
        assert.ok(
          approx(live, reference, 1e-9),
          'computeSubjectAverage(الرياضيات) = ' + live + ' but original-way mean = ' +
            reference + ' for entered marks ' + JSON.stringify(marks) +
            '. Genuine zeros must stay in; complete-data averages must not drift.'
        );
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  // PBT — full computeStudentAverages over fully-entered math marks in each term.
  // Distinct exam-suffix subjects avoid the subject||semester dedup so every
  // entered mark contributes; base subject الرياضيات → term average = round2(mean).
  fc.assert(
    fc.property(
      fc.array(enteredMarkArb, { minLength: 0, maxLength: 6 }),
      fc.array(enteredMarkArb, { minLength: 0, maxLength: 6 }),
      (t1Marks, t2Marks) => {
        const grades = []
          .concat(t1Marks.map((m, i) => ({ subject: 'الرياضيات (فرض ' + (i + 1) + ')', grade: m, semester: 1 })))
          .concat(t2Marks.map((m, i) => ({ subject: 'الرياضيات (فرض ' + (i + 1) + ')', grade: m, semester: 2 })));

        const refTerm = (marks) =>
          marks.length ? round2(marks.reduce((s, v) => s + v, 0) / marks.length) : null;
        const t1 = refTerm(t1Marks);
        const t2 = refTerm(t2Marks);
        let general;
        if (t1 != null && t2 != null) general = round2((t1 + t2) / 2);
        else if (t1 != null) general = round2(t1);
        else if (t2 != null) general = round2(t2);
        else general = null;

        const res = L.computeStudentAverages(grades, null);
        assert.ok(
          (res.term1 == null ? t1 == null : approx(res.term1, t1, 1e-9)) &&
          (res.term2 == null ? t2 == null : approx(res.term2, t2, 1e-9)) &&
          (res.general == null ? general == null : approx(res.general, general, 1e-9)),
          'computeStudentAverages drifted from the original-way reference. live=' +
            JSON.stringify(res) + ' reference=' + JSON.stringify({ term1: t1, term2: t2, general: general }) +
            ' marks T1=' + JSON.stringify(t1Marks) + ' T2=' + JSON.stringify(t2Marks)
        );
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  // =========================================================================
  // Property 4 — PBT: the risk ENGINE is unchanged. For ANY risk input the
  // final level is the worst-wins max of the two layers, the composite is the
  // intended weighted formula, and final.score === composite (Req 3.4, 3.5).
  // =========================================================================

  const EXPECTED_WEIGHTS = { A: 0.30, B: 0.30, C: 0.15, D: 0.15, E: 0.10 };

  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
      fc.array(fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }), { minLength: 0, maxLength: 8 }),
      fc.double({ min: 0, max: 60, noNaN: true, noDefaultInfinity: true }),
      (avg, subjects, unjustified) => {
        const r = SBX.window.computeStudentRisk({
          generalAverage: avg,
          subjectAverages: subjects,
          justifiedHours: 0,
          unjustifiedHours: unjustified
        });

        // Worst-wins rule (Req 3.4).
        assert.strictEqual(
          r.final.level, Math.max(r.layer1.level, r.layer2.level),
          'Worst-wins broken: final.level=' + r.final.level + ' != max(layer1=' +
            r.layer1.level + ', layer2=' + r.layer2.level + ').'
        );
        assert.strictEqual(r.final.score, r.layer2.composite,
          'final.score must equal the composite index.');

        // Weighted composite formula weights (Req 3.5).
        Object.keys(EXPECTED_WEIGHTS).forEach((k) => {
          assert.strictEqual(
            r.layer2.axes[k].weight, EXPECTED_WEIGHTS[k],
            'Composite weight for axis ' + k + ' changed: got ' + r.layer2.axes[k].weight +
              ', expected ' + EXPECTED_WEIGHTS[k] + '.'
          );
        });

        // Composite reproduced from the per-axis scores and weights.
        const recomputed = round2(
          EXPECTED_WEIGHTS.A * r.layer2.axes.A.score +
          EXPECTED_WEIGHTS.B * r.layer2.axes.B.score +
          EXPECTED_WEIGHTS.C * r.layer2.axes.C.score +
          EXPECTED_WEIGHTS.D * r.layer2.axes.D.score +
          EXPECTED_WEIGHTS.E * r.layer2.axes.E.score
        );
        assert.ok(
          approx(r.layer2.composite, recomputed, 0.5),
          'Composite formula drifted: composite=' + r.layer2.composite +
            ' vs weighted axis recompute=' + recomputed + '.'
        );

        assert.ok(r.layer2.composite >= 0 && r.layer2.composite <= 100,
          'Composite out of [0,100]: ' + r.layer2.composite);
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  // =========================================================================
  // Property 4 — PBT: for ALL inputs where the final level already AGREES with
  // the composite zone (final.level === layer2.level — bug condition C2 does
  // NOT hold), the rendered gauge keeps the same level and color as today
  // (Req 3.6). At least one agreeing case must be exercised.
  // =========================================================================

  let agreeingSeen = 0;
  // Pinned deterministic agreeing case (normal/normal) so Req 3.6 is always
  // exercised even if the random search never lands on an agreeing input.
  (function pinnedAgreeingGauge() {
    const { doc, result } = renderRisk({
      generalAverage: 15, subjectAverages: [15, 16], justifiedHours: 0, unjustifiedHours: 0
    });
    assert.strictEqual(result.final.level, result.layer2.level,
      'Pinned agreeing case precondition: final.level must equal layer2.level.');
    agreeingSeen += 1;
    const bar = doc.getElementById('bm-risk-bar');
    const lbl = doc.getElementById('bm-risk-main-lbl');
    assert.strictEqual(bar.style.background, SOLID[result.final.level],
      'Pinned agreeing gauge color must be SOLID[final.level].');
    assert.ok(lbl.textContent.indexOf(result.final.label) === 0,
      'Pinned agreeing gauge label must start with the final label.');
  })();

  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }),
      fc.array(fc.double({ min: 0, max: 20, noNaN: true, noDefaultInfinity: true }), { minLength: 0, maxLength: 6 }),
      fc.double({ min: 0, max: 60, noNaN: true, noDefaultInfinity: true }),
      (avg, subjects, unjustified) => {
        const { doc, result } = renderRisk({
          generalAverage: avg,
          subjectAverages: subjects,
          justifiedHours: 0,
          unjustifiedHours: unjustified
        });
        if (result.final.level !== result.layer2.level) return; // bug condition — skip
        agreeingSeen += 1;

        const bar = doc.getElementById('bm-risk-bar');
        const lbl = doc.getElementById('bm-risk-main-lbl');

        // Gauge color is the FINAL level's solid color (consistent, unchanged).
        assert.strictEqual(
          bar.style.background, SOLID[result.final.level],
          'Agreeing gauge color changed: got "' + bar.style.background + '", expected "' +
            SOLID[result.final.level] + '" for final.level=' + result.final.level + '.'
        );
        // Main label reflects the final level label.
        assert.ok(
          lbl.textContent.indexOf(result.final.label) === 0,
          'Agreeing gauge label must start with "' + result.final.label + '", got "' +
            lbl.textContent + '".'
        );
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  assert.ok(agreeingSeen > 0,
    'No agreeing-gauge (final.level === layer2.level) case was exercised — ' +
    'the Req 3.6 preservation property was never checked.');

  console.log('[preservation] OK — genuine zeros, complete-data averages, the ' +
    'worst-wins rule, the weighted composite formula and agreeing gauges are all ' +
    'preserved on the current code (' + agreeingSeen + ' agreeing-gauge cases checked).');
  process.exit(0);
} catch (err) {
  console.error('FAIL (UNEXPECTED on unfixed code): a preservation property did not ' +
    'hold — the baseline behavior to preserve is not what was assumed.');
  console.error(err && err.message ? err.message : err);
  if (err && err.counterexample) {
    console.error('Counterexample: ' + JSON.stringify(err.counterexample));
  }
  process.exit(1);
}

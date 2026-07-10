'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on UNFIXED code.
//
// Spec: .kiro/specs/incomplete-grades-averages-risk/
// Task 2 — Bug Condition (design `isBugCondition` C2, Correctness Property 3):
//   The dropout-risk gauge is colored/positioned by the weighted COMPOSITE
//   index while the worst-wins FINAL level differs, and the axis that triggered
//   the escalation is not surfaced as a prominent fact. The result reads as a
//   self-contradiction: a "حرج" label sitting over a bar that fills only to the
//   composite percentage (e.g. ~24%), which lands in the عادي legend band.
//
// This test encodes the EXPECTED (fixed) DISPLAY behavior, so it MUST FAIL on
// the unfixed code. DO NOT attempt to "fix" this test or the production code
// when it fails — the failure is the proof that the bug exists. The very same
// test is re-run after the fix (task 4.5) and is expected to PASS then.
//
// Validates: Requirements 1.5, 1.6, 1.7
//
// Engine under test is PURE and UNCHANGED (js/student-risk.js): the worst-wins
// rule `final.level = max(layer1.level, layer2.level)` and the weighted
// composite (A 30% + B 30% + C 15% + D 15% + E 10%) stay byte-for-byte. The bug
// is DISPLAY-only, so this test drives the engine to the concrete failing case
// and then runs the REAL `renderStudentRiskTab()` (extracted verbatim from
// js/pages/student-profile.js) against a recording DOM stub, inspecting exactly
// what the renderer paints.
//
// Concrete pinned case (synthetic; demonstrates the SAME mechanics the real
// dataset showed as final حرج / composite 24.39%):
//   Axis A (النتائج الدراسية) forces حرج (general avg < 5 AND >70% of subjects
//   below 10/20) while the weighted composite stays in the عادي band (~24%).
//     → final.level = حرج (2), layer2.level = عادي (0)  →  final ≠ composite zone
//
// Expected (fixed) paint, asserted below — ALL fail on the unfixed renderer:
//   1. Gauge colored by FINAL level (red/danger), not the composite zone.
//   2. The composite index ("المؤشر المركّب = X%") and the highest axis
//      ("أعلى محور = حرج") rendered as SEPARATE, non-contradictory facts —
//      not conflated into the main "حرج — 24%" label.
//   3. A PROMINENT triggering-axis badge ("…بسبب محور: النتائج الدراسية"),
//      promoted OUT of the recommendation paragraph.
//   4. A preliminary marker ("أولي / قيد الإنجاز") when the data is incomplete
//      (in-progress year — surfaced via `_riskState.dataIncomplete`).

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const fc = require('fast-check');

const ROOT = path.join(__dirname, '..');
const MIN_CASES = 50;

const DANGER_SOLID = 'var(--color-danger-solid)'; // _RISK_LEVEL_SOLID[2] (حرج)

// ---------------------------------------------------------------------------
// Recording DOM stub.
//
// getElementById auto-vivifies an element for ANY id so the renderer can paint
// into whatever container it queries (the unfixed AND the fixed versions). Every
// painted textContent / innerHTML is retained so the assertions can scan the
// whole rendered surface for the expected facts/badges regardless of which
// element id the fix chooses to use.
// ---------------------------------------------------------------------------

function makeEl(id) {
  return {
    id: id,
    style: {},
    dataset: {},
    children: [],
    textContent: '',
    innerHTML: '',
    insertAdjacentHTML(_pos, html) { this.innerHTML += String(html); },
    appendChild(child) { this.children.push(child); return child; },
    setAttribute() {},
    addEventListener() {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    parentNode: null
  };
}

function makeDoc() {
  const reg = new Map();
  return {
    _reg: reg,
    body: makeEl('body'),
    getElementById(id) {
      if (!reg.has(id)) reg.set(id, makeEl(id));
      return reg.get(id);
    },
    createElement() { return makeEl(null); }
  };
}

// Is `needle` painted into ANY element whose id is not in `excludeIds`?
function hasTextOutside(doc, needle, excludeIds) {
  const ex = excludeIds || [];
  let found = false;
  doc._reg.forEach((el, id) => {
    if (ex.indexOf(id) !== -1) return;
    const t = (el.textContent || '') + ' ' + (el.innerHTML || '');
    if (t.indexOf(needle) >= 0) found = true;
  });
  return found;
}

// Does ANY element (id not excluded) contain ALL of `needles`?
function hasAllOutside(doc, needles, excludeIds) {
  const ex = excludeIds || [];
  let found = false;
  doc._reg.forEach((el, id) => {
    if (ex.indexOf(id) !== -1) return;
    const t = (el.textContent || '') + ' ' + (el.innerHTML || '');
    if (needles.every((n) => t.indexOf(n) >= 0)) found = true;
  });
  return found;
}

// ---------------------------------------------------------------------------
// Load the PURE risk engine and the REAL renderStudentRiskTab() into one VM.
//
// student-risk.js is loaded first (sets window.computeStudentRisk +
// window.GS2.StudentRisk). The renderer slice is then extracted verbatim from
// js/pages/student-profile.js — from `const _RISK_LEVEL_SOLID` through (but not
// including) the `// Expose …` line — so the test always exercises the CURRENT
// production renderer, and will pick up the fix automatically.
// ---------------------------------------------------------------------------

function buildSandbox() {
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

  // Free variables referenced by the extracted slice (resolved at call time).
  sandbox.escapeHtml = function (s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])
    );
  };
  sandbox.collectEconomicData = function () { return {}; };
  sandbox.collectSocialData = function () { return {}; };
  sandbox.collectHealthData = function () { return {}; };
  sandbox._bmScoreState = { economic: null, social: null, health: null, followup: null };
  sandbox._currentStudentCode = null; // → persistRiskSnapshot returns early (no IPC)
  sandbox._currentStudentId = null;
  sandbox.SCHOOL_YEAR = '2025/2026';
  sandbox._riskState = { generalAverage: null, subjectAverages: [], justifiedHours: 0, unjustifiedHours: 0 };

  vm.createContext(sandbox);

  // 1) Pure engine.
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'js/student-risk.js'), 'utf8'), sandbox);
  assert.strictEqual(typeof sandbox.window.computeStudentRisk, 'function',
    'Failed to load computeStudentRisk from js/student-risk.js');

  // 2) Real renderer slice (verbatim).
  const src = fs.readFileSync(path.join(ROOT, 'js/pages/student-profile.js'), 'utf8');
  const startMarker = 'const _RISK_LEVEL_SOLID = [';
  const endMarker = '// Expose for the inline bmUpdateRisk() wrapper and event handlers.';
  const start = src.indexOf(startMarker);
  const end = src.indexOf(endMarker);
  assert.ok(start >= 0 && end > start,
    'Failed to locate renderStudentRiskTab slice markers in js/pages/student-profile.js');
  const slice = src.slice(start, end);
  vm.runInContext(slice, sandbox);
  assert.strictEqual(typeof sandbox.renderStudentRiskTab, 'function',
    'Failed to load renderStudentRiskTab from js/pages/student-profile.js');

  return sandbox;
}

const SBX = buildSandbox();

// Drive the engine to a given risk state and paint with the REAL renderer.
// Returns { doc, result } so assertions can inspect both inputs and paint.
function render(riskState) {
  SBX._riskState = riskState;
  SBX.document = makeDoc();
  const result = SBX.window.computeStudentRisk({
    generalAverage: riskState.generalAverage,
    subjectAverages: riskState.subjectAverages,
    justifiedHours: riskState.justifiedHours,
    unjustifiedHours: riskState.unjustifiedHours
  });
  SBX.renderStudentRiskTab();
  return { doc: SBX.document, result: result };
}

// The four expected-behavior assertions (Property 3). They hold for the FIXED
// renderer and fail on the unfixed one. `result` is the engine output, `doc` is
// the recording DOM.
function assertExpectedDisplay(doc, result, label) {
  const bar = doc.getElementById('bm-risk-bar');
  const lbl = doc.getElementById('bm-risk-main-lbl');
  const tag = label ? ('[' + label + '] ') : '';

  // Precondition: this case actually triggers the bug (final ≠ composite zone).
  assert.strictEqual(result.final.level, 2, tag + 'expected final level حرج (2)');
  assert.notStrictEqual(result.final.level, result.layer2.level,
    tag + 'precondition: final.level must differ from layer2 (composite) level');
  assert.ok(result.layer2.composite < 31,
    tag + 'precondition: composite must land in the عادي band (<31), got ' + result.layer2.composite);

  // 1. Gauge colored by the FINAL level (danger/red), never the composite zone.
  assert.strictEqual(bar.style.background, DANGER_SOLID,
    tag + 'gauge must be colored by final.level (' + DANGER_SOLID + '), got "' + bar.style.background + '"');

  // 2. Composite index and highest axis shown as SEPARATE, non-contradictory
  //    facts — present in elements OTHER than the conflated main label and the
  //    recommendation paragraph.
  const separated = ['bm-risk-main-lbl', 'bm-recommendation'];
  assert.ok(hasTextOutside(doc, 'المؤشر المركّب', separated),
    tag + 'composite index must be shown as a SEPARATE labeled fact ("المؤشر المركّب = ' +
      result.layer2.composite + '%"), not conflated into the main "' + lbl.textContent + '" label.');
  assert.ok(hasTextOutside(doc, 'أعلى محور', separated),
    tag + 'highest axis must be shown as a SEPARATE labeled fact ("أعلى محور = ' +
      result.layer1.label + '").');

  // 3. Prominent triggering-axis badge, promoted OUT of the recommendation.
  assert.ok(hasAllOutside(doc, ['بسبب محور', 'النتائج الدراسية'], ['bm-recommendation']),
    tag + 'a prominent badge naming the triggering axis ("…بسبب محور: النتائج الدراسية") ' +
      'must be rendered OUTSIDE the recommendation paragraph.');

  // 4. Preliminary marker when data is incomplete (in-progress year).
  assert.ok(hasTextOutside(doc, 'أولي', []) || hasTextOutside(doc, 'قيد الإنجاز', []),
    tag + 'a preliminary marker ("أولي / قيد الإنجاز") must be shown when the underlying ' +
      'risk data is incomplete (_riskState.dataIncomplete = true).');
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

console.log('[exploration] incomplete-grades Bug 2 — contradictory risk gauge (EXPECTED TO FAIL on unfixed code)');

try {
  // =========================================================================
  // Pinned case — Axis A forces حرج over a ~24% composite (عادي band).
  //   generalAverage 4 (<5 → حرج) and three subjects all below 10/20 (pct 100%)
  //   → A.score = mean(60, 100) = 80 → composite = 0.30·80 = 24.0%
  //   → final.level = حرج (2), layer2.level = عادي (0).
  // =========================================================================
  const pinned = {
    generalAverage: 4,
    subjectAverages: [4, 6, 8],
    justifiedHours: 0,
    unjustifiedHours: 0,
    dataIncomplete: true // in-progress year: Term-2 not entered yet
  };
  const { doc, result } = render(pinned);

  // Document what the UNFIXED renderer actually painted (the counterexample).
  const bar = doc.getElementById('bm-risk-bar');
  const lbl = doc.getElementById('bm-risk-main-lbl');
  const rec = doc.getElementById('bm-recommendation');
  console.log('  engine: final=' + result.final.label + ' (' + result.final.level + '), ' +
    'composite=' + result.layer2.composite + '% (zone level ' + result.layer2.level + ')');
  console.log('  painted gauge width   : ' + bar.style.width + '  (keyed to the composite index)');
  console.log('  painted gauge color   : ' + bar.style.background);
  console.log('  painted main label    : "' + lbl.textContent + '"');
  console.log('  painted recommendation: "' + (rec.textContent || '').slice(0, 160) + '"');

  assertExpectedDisplay(doc, result, 'pinned');

  // =========================================================================
  // Scoped property — for ANY in-progress student whose academic axis forces
  // حرج over a composite in the عادي band, the rendered gauge must satisfy the
  // same four expected-display facts.
  // =========================================================================
  fc.assert(
    fc.property(
      fc.double({ min: 0, max: 4.9, noNaN: true, noDefaultInfinity: true }), // avg < 5 → حرج
      fc.array(fc.double({ min: 0, max: 9.9, noNaN: true, noDefaultInfinity: true }), { minLength: 0, maxLength: 5 }),
      (avg, subjects) => {
        const state = {
          generalAverage: avg,
          subjectAverages: subjects, // all below 10/20 (or empty) → keeps composite low
          justifiedHours: 0,
          unjustifiedHours: 0,
          dataIncomplete: true
        };
        const r = render(state);
        assertExpectedDisplay(r.doc, r.result, 'pbt');
      }
    ),
    { numRuns: MIN_CASES, verbose: true }
  );

  // Reaching here means the bug did NOT reproduce — unexpected for unfixed code.
  console.log('[exploration] (UNEXPECTED) all assertions passed — the contradictory ' +
    'risk-gauge bug did not reproduce. The renderer may already be fixed, or the ' +
    'root-cause/test logic needs review.');
  process.exit(0);
} catch (err) {
  console.error('FAIL (EXPECTED on unfixed code): Property 3 — the risk gauge is ' +
    'colored/positioned by the composite index while the worst-wins final level differs, ' +
    'with no prominent axis attribution and no preliminary marker.');
  console.error(err && err.message ? err.message : err);
  if (err && err.counterexample) {
    console.error('Counterexample: ' + JSON.stringify(err.counterexample));
  }
  process.exit(1);
}

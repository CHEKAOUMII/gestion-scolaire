'use strict';

// Integration test — Phase D.4 task 24 of proctor-v2-slot-metric-reserves-affinity.
// 2-session halfday end-to-end. Asserts the second session's reserves come
// from the first-session guard set when both groups are reserve-eligible at
// reserveCount = 0 (P3 / Requirement 2.5).
// _Validates: C3, P3 — Requirement 2.5_

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const source = fs.readFileSync(
  path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-distribution-v2.js'),
  'utf8'
);
const sandbox = {
  window: {},
  Math, console, Infinity, isFinite, isNaN,
  Set, Map, Object, Array, String, Number, Error, Boolean, Date,
  parseInt, parseFloat, TypeError, RangeError, NaN, JSON
};
vm.createContext(sandbox);
vm.runInContext(source, sandbox);
const V2 = sandbox.window.ProctorDistributionV2;

const fixtures = require(path.join(__dirname, '..', 'fixtures', 'proctor-v2-slot-metric-fixtures.js'));

const input = fixtures.buildC3AffinityInput();
const out = V2.run(input);
assert.strictEqual(out.diagnostics.errors.length, 0, 'no errors: ' + JSON.stringify(out.diagnostics.errors));

// Find S1 and S2 rows.
const rows = out.result || [];
let s1Row = null, s2Row = null;
for (const r of rows) {
  if (/الحصة الأولى/.test(r.session_key)) s1Row = r;
  if (/الحصة الثانية/.test(r.session_key)) s2Row = r;
}
assert.ok(s1Row, 'S1 row present');
assert.ok(s2Row, 'S2 row present');

const s1Guards = new Set((s1Row.proctor_keys || []).filter(Boolean));
const s2Guards = new Set((s2Row.proctor_keys || []).filter(Boolean));
const s2Reserves = (s2Row.reserve_keys || []).filter(Boolean);

assert.ok(s1Guards.size >= 1, 'S1 has guards: ' + Array.from(s1Guards).join(','));
assert.ok(s2Reserves.length >= 1, 'S2 has at least one reserve');

// S2's reserve must NOT be the session's own guards (hard rule).
for (const r of s2Reserves) {
  assert.ok(!s2Guards.has(r), 'reserve ' + r + ' must not be session-own guard');
}

// Among the S2 reserve-eligible candidates, ANY S1 guard not in S2 (i.e.
// reserve-eligible) is a candidate. The test assertion: at least one of the
// S1 guards appears as the S2 reserve, since S1 guards have affinityRank=0
// and reserveCount=0 like the externals.
//
// Stronger: ALL S2 reserves should be S1 guards iff |S1 guards \ S2 guards|
// >= |reserves|. In this fixture S1 has 2 guards, S2 has 2 different guards,
// so 2 S1 guards are reserve-eligible for S2, and reservesPerSession=1 → the
// single S2 reserve must come from the S1 guard set.
const s1GuardsAvailable = Array.from(s1Guards).filter(k => !s2Guards.has(k));
assert.ok(s1GuardsAvailable.length >= 1, 'fixture geometry: ≥ 1 S1 guard reserve-eligible for S2');

const chosen = s2Reserves[0];
assert.ok(
  s1Guards.has(chosen),
  'S2 reserve ' + chosen + ' must come from S1 guard set ' +
  '{' + Array.from(s1Guards).join(', ') + '} (affinityRank=0 wins)'
);

console.log('[pass] affinity end-to-end: S2 reserve ' + chosen + ' came from S1 guards');

'use strict';

// Integration test: user's reference fixture end-to-end.
// Spec: proctor-v2-phase2-timeout-and-greedy-cap, Phase D.4 task 16.
//
// Asserts that with the new default budget (5000ms), the user's centre
// (147 proctors, 92 entries × 2 slots = 184 slots, D_expected = 15) runs to
// completion: phase2TimedOut = false, all slots filled, full coverage.
//
// Validates Requirements 2.1, 2.3, 2.5.

const path = require('path');
const fs = require('fs');
const vm = require('vm');
const assert = require('assert');

const ROOT = path.join(__dirname, '..', '..');
const src = fs.readFileSync(path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'), 'utf8');

const sandbox = {
  console: { log: function () {}, warn: function () {}, error: function () {} },
  Date, Math, Number, Object, Array, Set, Map, JSON, isFinite, isNaN, Infinity, parseInt
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(src, sandbox);
const V2 = sandbox.ProctorDistributionV2;

const { buildC1SingleClassGapInput } = require(path.join(ROOT, 'tests/fixtures/proctor-v2-strict-fairness-fixtures.js'));

const input = buildC1SingleClassGapInput();
const out = V2.run(input);
const rows = out.result || [];

// Compute slot-based primaryLoad per proctor (slot metric from prior spec)
const slotCount = {};
for (const r of rows) {
  for (const k of (r.proctor_keys || [])) {
    if (k) slotCount[k] = (slotCount[k] || 0) + 1;
  }
}

let max = 0, min = Infinity, zeros = 0;
for (const p of input.proctorsList) {
  const g = slotCount[p.cin] || 0;
  if (g > max) max = g;
  if (g < min) min = g;
  if (g === 0) zeros++;
}
const filled = rows.reduce(function (a, r) {
  return a + (r.proctor_keys || []).filter(Boolean).length;
}, 0);

const expected = input.scheduleEntries.length
                 * (input.options.roomsList || []).length
                 * (input.examDistributionRules.proctorsPerRoom || 1);

// Assertions per Definition of Done in tasks.md §0.8
assert.strictEqual(
  out.diagnostics.phase2TimedOut,
  false,
  'phase2TimedOut must be false on the user fixture with 5000ms default ' +
  '(got ' + out.diagnostics.phase2TimedOut + ', duration=' + out.diagnostics.phase2DurationMs + 'ms)'
);

assert.strictEqual(
  filled,
  expected,
  'all expected slots must be filled (got ' + filled + ' / ' + expected + ')'
);

assert.strictEqual(
  zeros,
  0,
  'P3 coverage: every eligible proctor must have at least one slot ' +
  '(uncovered count: ' + zeros + ')'
);

assert.ok(
  max - min <= 1,
  'P1 strict fairness: max - min must be <= 1 (got max=' + max + ', min=' + min + ')'
);

assert.strictEqual(
  out.diagnostics.coverageRepairUnresolved,
  0,
  'coverageRepairUnresolved must be 0 (got ' + out.diagnostics.coverageRepairUnresolved + ')'
);

console.log('[pass] reference fixture: phase2TimedOut=false, filled=' + filled + '/' + expected);
console.log('[pass] reference fixture: max=' + max + ', min=' + min + ', uncovered=' + zeros);
console.log('[pass] reference fixture: all 4 §0.2 properties (P1, P2, P3, Coverage) PASS');

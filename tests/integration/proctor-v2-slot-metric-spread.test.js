'use strict';

// Integration test — Phase D.4 task 25 of proctor-v2-slot-metric-reserves-affinity.
// Asserts max(reserveCount) − min(reserveCount) ≤ 1 across the eligible
// frontier in a 5-session run with reservesPerSession = 2 and 11 proctors.
// _Validates: C2, P2 — Requirements 2.4, 2.6_

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

const input = fixtures.buildC2SpreadInput();
const out = V2.run(input);
assert.strictEqual(out.diagnostics.errors.length, 0, 'no errors: ' + JSON.stringify(out.diagnostics.errors));

const rows = out.result || [];
const reserveCounts = {};
// Per-proctor reserveCount = number of distinct sessions they appear in as a
// reserve. Build a Set per proctor of session keys they reserved for. The
// reserves arrays are shared by reference across rows of the same session, so
// we must dedupe by (proctorKey, sessionKey) to avoid double-counting.
const sessionsReservedBy = {};
for (const r of rows) {
  const sk = r.session_key;
  for (const k of (r.reserve_keys || [])) {
    if (!k) continue;
    if (!sessionsReservedBy[k]) sessionsReservedBy[k] = new Set();
    sessionsReservedBy[k].add(sk);
  }
}
for (const k of Object.keys(sessionsReservedBy)) {
  reserveCounts[k] = sessionsReservedBy[k].size;
}

// Eligible proctors are everyone in proctorsList. Compute reserveCount, defaulting to 0.
const allCounts = input.proctorsList.map(p => reserveCounts[p.cin] || 0);
const max = Math.max.apply(null, allCounts);
const min = Math.min.apply(null, allCounts);

// 5 sessions × 2 reserves = 10 total reserves across 11 proctors. Some
// proctor will be a guard so reserve-eligible pool is 10 → exactly 1 reserve
// each ideally → max=1, min≤1, gap ≤ 1.
console.log('reserveCounts (5 sessions × 2 reserves = 10 placements, N=' +
  input.proctorsList.length + '): max=' + max + ' min=' + min);

// Spread invariant: max−min ≤ 1 within the first ring.
assert.ok(max - min <= 1, 'spread invariant: max(' + max + ') − min(' + min + ') > 1');
// Also: nobody at reserveCount > 1 while someone is at 0 (P2).
const someoneAtZero = allCounts.some(c => c === 0);
const someoneAboveOne = allCounts.some(c => c >= 2);
if (someoneAboveOne) {
  assert.ok(!someoneAtZero, 'someone reached reserveCount ≥ 2 while another sat at 0');
}

console.log('[pass] spread end-to-end: max−min gap = ' + (max - min));

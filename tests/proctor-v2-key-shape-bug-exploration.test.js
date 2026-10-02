'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on F (unfixed code).
// @bugfix-spec: .kiro/specs/proctor-v2-key-shape-unification/
// Task 1 — Bug Condition C(X): on the production fixture
// `tests/fixtures/45454.json` (147 proctors with empty `cin`, all with
// non-empty `som`) the algorithm `js/algorithms/proctor-distribution-v2.js`
// produces a result `R_mem` in which 6 physical proctors are simultaneously
// represented under two distinct identity strings:
//   K1 = getProctorKey(proc, idx)            ← '__idx_N' (algo shape)
//   K2 = getProctorExemptionKey(proc, idx)   ← proc.som  (exemption shape)
// Both K1 and K2 appear in `R_mem.proctor_keys ∪ R_mem.reserve_keys` for the
// same physical proctor, splitting that proctor's true assigned slot count
// across two buckets.
//
// DO NOT attempt to "fix" this test if it fails. Failure is the SUCCESS case
// for this exploratory test — it confirms `isBugCondition(X)` fires on the
// production fixture.
//
// ----------------------------------------------------------------------------
// Encoded property — `isBugCondition(X)` from design.md §"Bug Details"
// ----------------------------------------------------------------------------
// FOR EACH (proc, idx) IN proctorsList DO
//   K1 ← getProctorKey(proc, idx)
//   K2 ← getProctorExemptionKey(proc, idx)
//   IF K1 = K2 THEN CONTINUE                       // not a candidate
//   n1 ← occurrencesIn(R_mem.proctor_keys, K1)
//       + occurrencesIn(R_mem.reserve_keys, K1)
//   n2 ← occurrencesIn(R_mem.proctor_keys, K2)
//       + occurrencesIn(R_mem.reserve_keys, K2)
//   ASSERT NOT (n1 > 0 AND n2 > 0)                 // never both present
// END FOR
//
// ----------------------------------------------------------------------------
// Pre-fix counterexamples (deterministic; 6 known proctors)
// ----------------------------------------------------------------------------
// | idx | teacher_name        | som     |
// |-----|---------------------|---------|
// | 43  | ايت حدو فؤاد        | 1909564 |
// | 47  | وردية بوعادي        | 1177902 |
// | 50  | المكاني محمد        | 1545317 |
// | 66  | تيكوردي إشراق       | 1910812 |
// | 78  | السعدوي عمر         | 2367149 |
// | 92  | ايمان تنون          | 2158781 |
//
// On F: each affected proctor has K1='__idx_N' count=3 AND K2=som count=1,
// totalling true load = 4 against algorithm-reported max = 3.
//
// _Validates: Requirements 1.1, 1.2, 1.4, 1.5, 1.6, 1.8_
// _Phase: E (Test Plan)_
// _Hypothesis: Points 3, 4, 5 in design.md §"Hypothesized Root Cause"_
//   - 3: duty pre-pass leaks at the boundary (≈line 1762)
//   - 4: phase2_5PopulateReserves propagates the leak (≈line 2643)
//   - 5: applyReserveSwap promotes the leak into output (≈line 3636)

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ---------------------------------------------------------------------------
// 1) Load the production v2 module via VM sandbox (mirrors the harness used
//    by tests/inv-a-instrument-roundtrip.test.js).
// ---------------------------------------------------------------------------
var src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
var sb = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sb.window = sb;
sb.globalThis = sb;
vm.createContext(sb);
vm.runInContext(src, sb);
var V2 = sb.ProctorDistributionV2 || sb.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');
assert.ok(V2._internals && typeof V2._internals.getProctorKey === 'function',
  'Failed to access _internals.getProctorKey');

var getProctorKey = V2._internals.getProctorKey;

// `getProctorExemptionKey` is not exposed on `_internals` in F (the fix in
// Task 4 will not change that either — the canonical shape is algo shape and
// exemption shape stays an internal boundary helper). Mirror it byte-for-byte
// from v2.js (≈line 662–665):
//
//   function getProctorExemptionKey(proctor, index) {
//     return proctor.cin || proctor.som || ('idx_' + index);
//   }
function getProctorExemptionKey(proctor, index) {
  return proctor.cin || proctor.som || ('idx_' + index);
}

// ---------------------------------------------------------------------------
// 2) Load the production fixture.
// ---------------------------------------------------------------------------
var input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));

assert.strictEqual(input.proctorsList.length, 147,
  'fixture should have 147 proctors (got ' + input.proctorsList.length + ')');

// Sanity: confirm the bug-triggering structural condition holds on the
// fixture (147 proctors with empty cin AND non-empty som).
var emptyCinNonEmptySom = input.proctorsList.filter(function (p) {
  var cinEmpty = !p.cin || String(p.cin).trim() === '';
  var somNonEmpty = !!(p.som && String(p.som).trim() !== '');
  return cinEmpty && somNonEmpty;
}).length;
assert.strictEqual(emptyCinNonEmptySom, 147,
  'fixture should have 147 proctors with empty cin AND non-empty som ' +
  '(got ' + emptyCinNonEmptySom + ')');

// ---------------------------------------------------------------------------
// 3) Run the algorithm with the production module's default RNG (no seed).
// ---------------------------------------------------------------------------
var out = V2.run(input);
assert.ok(out && out.result, 'V2.run produced no result');

var R_mem = out.result;

// ---------------------------------------------------------------------------
// 4) Build occurrence counters over `proctor_keys ∪ reserve_keys`.
// ---------------------------------------------------------------------------
function buildOccurrenceCounter(rows) {
  var counts = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    var pk = rows[i].proctor_keys || [];
    var rk = rows[i].reserve_keys || [];
    for (var j = 0; j < pk.length; j++) {
      var k1 = pk[j];
      if (k1 != null) counts[k1] = (counts[k1] || 0) + 1;
    }
    for (var r = 0; r < rk.length; r++) {
      var k2 = rk[r];
      if (k2 != null) counts[k2] = (counts[k2] || 0) + 1;
    }
  }
  return counts;
}

var occ = buildOccurrenceCounter(R_mem);

// ---------------------------------------------------------------------------
// 5) Encode `isBugCondition(X)` — collect every dual-identity proctor.
// ---------------------------------------------------------------------------
var dualIdentityProctors = [];

for (var idx = 0; idx < input.proctorsList.length; idx++) {
  var proc = input.proctorsList[idx];
  var K1 = getProctorKey(proc, idx);
  var K2 = getProctorExemptionKey(proc, idx);
  if (K1 === K2) continue;             // not a candidate

  var n1 = occ[K1] || 0;
  var n2 = occ[K2] || 0;

  if (n1 > 0 && n2 > 0) {
    dualIdentityProctors.push({
      idx: idx,
      teacher_name: proc.teacher_name || proc.teacher_name_fr || '',
      cin: proc.cin || '',
      som: proc.som || '',
      K1: K1,
      K2: K2,
      K1_count: n1,
      K2_count: n2,
      true_total: n1 + n2
    });
  }
}

// ---------------------------------------------------------------------------
// 6) Diagnostic output BEFORE the assertion — names every dual-identity
//    proctor with K1 count and K2 count so the failure message documents
//    the 6 known counterexamples.
// ---------------------------------------------------------------------------
console.log('[proctor-v2-key-shape-bug-exploration] fixture 45454.json:');
console.log('  proctors=' + input.proctorsList.length +
  ' (empty cin AND non-empty som=' + emptyCinNonEmptySom + ')' +
  ' | result rows=' + R_mem.length);
console.log('');
console.log('  isBugCondition(X) candidates: ' + dualIdentityProctors.length +
  ' proctor(s) with K1 ≠ K2 AND both keys present in proctor_keys ∪ reserve_keys');
console.log('');

if (dualIdentityProctors.length > 0) {
  console.log('  | idx | teacher_name           | som      | K1 (algo)         |' +
    ' K1 cnt | K2 (exempt)  | K2 cnt | true total |');
  console.log('  |-----|------------------------|----------|-------------------|' +
    '--------|--------------|--------|------------|');
  dualIdentityProctors.forEach(function (d) {
    var nm = (d.teacher_name + '                        ').slice(0, 22);
    var som = (d.som + '         ').slice(0, 8);
    var k1s = (d.K1 + '                  ').slice(0, 17);
    var k2s = (d.K2 + '            ').slice(0, 12);
    console.log('  | ' + String(d.idx).padStart(3, ' ') +
      ' | ' + nm +
      ' | ' + som +
      ' | ' + k1s +
      ' | ' + String(d.K1_count).padStart(6, ' ') +
      ' | ' + k2s +
      ' | ' + String(d.K2_count).padStart(6, ' ') +
      ' | ' + String(d.true_total).padStart(10, ' ') +
      ' |');
  });
}
console.log('');

// ---------------------------------------------------------------------------
// 7) The assertion that surfaces the bug condition.
// ---------------------------------------------------------------------------
assert.strictEqual(
  dualIdentityProctors.length,
  0,
  'BUG CONDITION CONFIRMED: ' + dualIdentityProctors.length +
    ' proctor(s) carry dual identity in R_mem ' +
    '(see diagnostic table above). For each listed proctor, ' +
    'getProctorKey(proc, idx) AND getProctorExemptionKey(proc, idx) ' +
    'BOTH appear in proctor_keys ∪ reserve_keys, splitting the proctor\'s ' +
    'true total slot count across two buckets. Per design.md §"Hypothesized ' +
    'Root Cause": leak sites are (3) duty pre-pass at ≈line 1762, ' +
    '(4) phase2_5PopulateReserves at ≈line 2643, and (5) applyReserveSwap ' +
    'swap-promotion at ≈line 3636.'
);

// If we reach here on F, the bug condition is unexpectedly NOT realized —
// re-investigate.
console.log('[proctor-v2-key-shape-bug-exploration] (unexpected) no ' +
  'dual-identity proctors found on F — bug condition isBugCondition(X) ' +
  'did not fire on the production fixture. Expected 6 counterexamples. ' +
  'Re-investigate.');

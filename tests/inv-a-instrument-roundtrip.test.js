'use strict';

// @pre-fix exploratory test — EXPECTED to FAIL on F.
// @permanent-counterexample-document — STILL FAILS on F' (post-fix) BY DESIGN.
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 1 — Bug Condition C(X): on the production fixture
// `tests/fixtures/45454.json` (147 proctors with empty `cin`, 191 rows,
// 382 slots) the per-proctor histogram diverges between aggregation by
// proctor_keys (the algorithm's identity function) and aggregation by
// teacher_name (the display layer's identity function used by
// `buildSummaryRows()` in `exams-rooms.html`).
//
// DO NOT attempt to "fix" this test if it fails. Failure is the SUCCESS
// case for this exploratory test — it confirms the bug condition.
//
// ----------------------------------------------------------------------------
// IMPORTANT — POST-FIX READING (Task 7.1)
// ----------------------------------------------------------------------------
// This test WILL CONTINUE TO FAIL post-fix. That outcome is correct and
// intentional. Reading it as a regression is a misinterpretation. The reasons:
//
//   1. The bug condition is **structural in the fixture**: `tests/fixtures/
//      45454.json` contains 147 proctors with empty `cin`; among those, 7
//      `teacher_name` strings are shared by 2+ distinct proctor identities.
//      That property of the input data is immutable.
//
//   2. The algorithm (`js/algorithms/proctor-distribution-v2.js`) correctly
//      produces distinct per-key counts for those 7 collision pairs. `R_mem`
//      therefore has 154 distinct `proctor_keys` and 147 distinct
//      `teacher_name` values regardless of fix state. Per Requirement 2.9
//      (and confirmed by the investigation phases A→E), v2.js is NOT modified
//      by this bugfix.
//
//   3. The H5 fix was applied to the **display layer** only — specifically
//      `buildSummaryRows()` in `exams-rooms.html` (Task 6.H5.2) and the
//      script-include in `exams-proctors.html` (Task 6.H5.3) — so the
//      renderer aggregates by `proctor_keys` instead of `teacher_name`.
//      The fix does NOT alter `R_mem` or the relationship between
//      `histogramByProctorKey(R_mem)` and `histogramByName(R_mem)`.
//
//   4. Consequently, on F' (post-fix code), `R_mem` is byte-identical to
//      what it was on F, and the assertion
//      `histogramByProctorKey(R_mem) === histogramByName(R_mem)` is still
//      false. This file's three assertions therefore still throw — that is
//      the expected and correct behavior.
//
// What this test now serves as:
//   - A permanent counterexample document. The diagnostic output (printed
//     before the throw) names the 7 collisions, the slot-conservation
//     totals, and the by-key vs by-name histograms — useful evidence for
//     anyone re-reading the bugfix audit trail.
//   - A regression sentinel for the **input fixture**: if `tests/fixtures/
//     45454.json` ever changes such that name collisions disappear, this
//     test would unexpectedly PASS, signalling that the fixture is no longer
//     exercising the H5 case (re-add a colliding name or pick a fresh
//     fixture).
//
// Where the H5 fix is actually verified post-fix:
//   - `tests/inv-h5-cross-page-consistency.test.js` (Task 6.H5.4) — proves
//     `exams-rooms.html buildSummaryRows()` and the `exams-proctors.html`
//     summary helpers produce IDENTICAL per-key histograms on the same
//     `R_mem` (`{1:7, 2:66, 3:81}` on both sides).
//   - `tests/build-summary-rows-unit.test.js` (Task 3.1) — collision-case
//     unit test now PASSES (was FAIL pre-fix).
//   - `tests/resolve-proctor-display-name-unit.test.js` (Task 3.2) — helper
//     contract verified.
//   - Manual Electron verification (Task 9) — end-to-end through the
//     production IPC + SQLite roundtrip.
//
// Therefore the Task 7.1 deliverable is documentation, not a code change.
// `tests/inv-notes.md` § "Task 7.1" records this rationale.
//
// ----------------------------------------------------------------------------
// Why a Node-only Option B test (no IPC, no DB)
// ----------------------------------------------------------------------------
// The full production round-trip requires the Electron renderer because the
// save path goes through `window.api.examConfig.save` (contextBridge → IPC →
// SQLite). That path is unavailable in a Node test environment.
//
// However, the design.md hypothesis H5 states the divergence is introduced by
// the renderer's display aggregation in `buildSummaryRows()`, which keys by
// `teacher_name` instead of by `proctor_keys`. The hypothesis is provable
// without IPC or DB by computing both histograms directly from `R_mem`:
//
//   - histogramByProctorKey(R_mem) — the algorithm's per-key counts
//   - histogramByName(R_mem)       — the display layer's per-name counts
//
// If `histogramByProctorKey(R_mem) ≠ histogramByName(R_mem)`, the divergence
// is structurally guaranteed to surface in the DB-rendered summary regardless
// of any save/load behavior, because the JSON+IPC+DB layers all preserve
// `proctor_keys` and `teacher_name` byte-for-byte (verified in subsequent
// investigation phases B/C/D).
//
// This is exactly the H5 discriminator described in design.md → Hypothesized
// Root Cause § 5: "in Node, take R_mem from the fixture, compute (a)
// histogramByProctorKey(R_mem) and (b) histogramByName(R_mem). If
// histogramByName(R_mem) ≠ histogramByProctorKey(R_mem), H5 is confirmed
// regardless of any IPC/DB behavior."
//
// ----------------------------------------------------------------------------
// Pre-fix counterexample (deterministic; observed by running this test on F)
// ----------------------------------------------------------------------------
// Production fixture: tests/fixtures/45454.json
//   147 proctors (all with empty `cin` → keyed `__idx_0` … `__idx_146`)
//   191 result rows
//   382 total guard slots
//
// Memory histogram (R_mem aggregated by proctor_keys):
//   {1:7, 2:66, 3:81}   max=3   distinct keys=154   total=382  ← algorithm
//
// Display histogram (R_mem aggregated by teacher_name from row.proctors):
//   {2:65, 3:76, 4:6}   max=4   distinct names=147  total=382  ← bug surface
//
// 7 teacher_name strings are shared across multiple proctor keys:
//   "ياسين بوهديد"               → __idx_18, 2367005   (3+1=4 in name agg)
//   "ابراهيم السباعي"            → __idx_12, 2227866   (3+1=4 in name agg)
//   "أيوب بوحصار"                → __idx_15, 2367154   (3+1=4 in name agg)
//   "فاطمة الزهراء بنزيد"        → 2367141, __idx_105  (1+3=4 in name agg)
//   "المهدي مومتي"              → __idx_63, 2319348   (2+1=3 in name agg)
//   "سلمى الأزهري"              → __idx_110, 2270254  (3+1=4 in name agg)
//   "خولة نصرالدين"             → __idx_76, 2366908   (3+1=4 in name agg)
//
// Conservation arithmetic (matches design.md Bug Details → Examples):
//   - 154 distinct keys − 7 collisions = 147 distinct names ✓
//   - Both histograms sum to 382 slots ✓
//   - 6 collisions land in load=4 bucket (max=4 visible to user) ✓
//
// _Validates: Requirements 1.1, 1.2, 1.3, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3_
// _Phase: A (instrument both layers — discriminator for H5 vs the rest)_
// _Hypothesis: H5 — `buildSummaryRows()` aggregates by name, not by key._

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// 1) Load the production v2 module via VM sandbox (mirrors lines 12-22 of
//    scripts/verify-fixture.js and tests/proctor-v2-fairness-undercovered-
//    exploration.test.js).
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

// 2) Load the production fixture.
var input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));

assert.strictEqual(input.proctorsList.length, 147,
  'fixture should have 147 proctors (got ' + input.proctorsList.length + ')');
var emptyCin = input.proctorsList.filter(function (p) {
  return !p.cin || String(p.cin).trim() === '';
}).length;
assert.strictEqual(emptyCin, 147,
  'fixture should have 147 proctors with empty cin (got ' + emptyCin + ')');

// 3) Run with the production module's default RNG (no seed override).
var out = V2.run(input);
assert.ok(out && out.result, 'V2.run produced no result');

var R_mem = out.result;
assert.strictEqual(R_mem.length, 191,
  'fixture should produce 191 result rows (got ' + R_mem.length + ')');

// 4) Compute histogramByProctorKey — the algorithm's identity function.
//    `proctor_keys[i]` holds `proc.cin || ('__idx_' + idx)` per getProctorKey
//    in v2.js (≈line 649). This is the canonical proctor identity in memory.
function histogramByProctorKey(rows) {
  var perKey = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    var keys = rows[i].proctor_keys || [];
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      if (k) perKey[k] = (perKey[k] || 0) + 1;
    }
  }
  var hist = Object.create(null);
  Object.keys(perKey).forEach(function (k) {
    var c = perKey[k];
    hist[c] = (hist[c] || 0) + 1;
  });
  return { hist: hist, perKey: perKey, distinct: Object.keys(perKey).length };
}

// 5) Compute histogramByName — the display layer's identity function.
//    `buildSummaryRows()` in `exams-rooms.html` (≈line 821) calls
//    `getTeacher(teacherMap, name)` for each entry in `row.proctors`. Two
//    proctors with empty `cin` and identical `teacher_name` collide into a
//    single bucket. This function replicates that aggregation faithfully.
function histogramByName(rows) {
  var perName = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    var names = rows[i].proctors || [];
    for (var j = 0; j < names.length; j++) {
      var n = names[j];
      if (n) perName[n] = (perName[n] || 0) + 1;
    }
  }
  var hist = Object.create(null);
  Object.keys(perName).forEach(function (n) {
    var c = perName[n];
    hist[c] = (hist[c] || 0) + 1;
  });
  return { hist: hist, perName: perName, distinct: Object.keys(perName).length };
}

var byKey = histogramByProctorKey(R_mem);
var byName = histogramByName(R_mem);

var totalSlotsByKey = Object.keys(byKey.perKey).reduce(function (a, k) {
  return a + byKey.perKey[k];
}, 0);
var totalSlotsByName = Object.keys(byName.perName).reduce(function (a, n) {
  return a + byName.perName[n];
}, 0);

var maxByKey = Object.keys(byKey.perKey).reduce(function (m, k) {
  return Math.max(m, byKey.perKey[k]);
}, 0);
var maxByName = Object.keys(byName.perName).reduce(function (m, n) {
  return Math.max(m, byName.perName[n]);
}, 0);

// 6) Surface the colliding names (multiple proctor_keys → same teacher_name)
//    so the failure message names the exact 7 counterexamples.
function findNameCollisions(rows) {
  var keysByName = Object.create(null);
  for (var i = 0; i < rows.length; i++) {
    var keys = rows[i].proctor_keys || [];
    var names = rows[i].proctors || [];
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      var n = names[j];
      if (!k || !n) continue;
      if (!keysByName[n]) keysByName[n] = Object.create(null);
      keysByName[n][k] = true;
    }
  }
  var colliding = [];
  Object.keys(keysByName).forEach(function (n) {
    var keys = Object.keys(keysByName[n]);
    if (keys.length > 1) colliding.push({ name: n, keys: keys });
  });
  return colliding;
}

var collisions = findNameCollisions(R_mem);

// 7) Diagnostic output (visible whether the test passes or fails).
console.log('[inv-a-instrument-roundtrip] fixture 45454.json:');
console.log('  proctors=' + input.proctorsList.length +
  ' (empty cin=' + emptyCin + ') | result rows=' + R_mem.length);
console.log('');
console.log('  histogramByProctorKey(R_mem) = ' + JSON.stringify(byKey.hist));
console.log('    distinct keys=' + byKey.distinct +
  ' | max=' + maxByKey + ' | total slots=' + totalSlotsByKey);
console.log('');
console.log('  histogramByName(R_mem)       = ' + JSON.stringify(byName.hist));
console.log('    distinct names=' + byName.distinct +
  ' | max=' + maxByName + ' | total slots=' + totalSlotsByName);
console.log('');
console.log('  name collisions (' + collisions.length + ' name(s) shared by ' +
  '≥2 proctor keys — root of H5):');
collisions.forEach(function (c) {
  var keyStr = c.keys.map(function (k) {
    return k + ':' + byKey.perKey[k];
  }).join(', ');
  console.log('    "' + c.name + '" → ' + keyStr);
});

// 8) Three primary assertions — each surfaces the H5 counterexample.

// 8.a) The bug condition C(X) in its display-layer form:
//      `histogramByProctorKey(R_mem) ≠ histogramByName(R_mem)`.
//      This is the structural divergence between the algorithm's identity
//      function (proctor_keys) and the display layer's identity function
//      (teacher_name). The full production round-trip surfaces this delta
//      as `histogramByProctorKey(R_mem) ≠ histogramByProctorKey(R_db)` once
//      `buildSummaryRows()` has bucketed by name.
assert.deepStrictEqual(
  byKey.hist,
  byName.hist,
  'BUG CONDITION CONFIRMED: histogramByProctorKey(R_mem) ≠ histogramByName(R_mem). ' +
    'algorithm-keyed=' + JSON.stringify(byKey.hist) +
    ' (max=' + maxByKey + ', distinct=' + byKey.distinct + ') vs ' +
    'name-keyed=' + JSON.stringify(byName.hist) +
    ' (max=' + maxByName + ', distinct=' + byName.distinct + '). ' +
    collisions.length + ' teacher_name(s) shared by multiple proctor keys ' +
    '(see diagnostic output above). The display layer (`buildSummaryRows()`) ' +
    'merges these into single buckets, producing the user-visible max=' +
    maxByName + ' even though the algorithm produced max=' + maxByKey + '. ' +
    'This is the H5 hypothesis surfaced directly without going through IPC+DB.'
);

// 8.b) Distinct-count delta: `distinct keys − distinct names = collisions`.
//      This is the conservation law that constrains the root cause to a
//      bucket-merging transformation rather than truncation or data loss.
assert.strictEqual(
  byKey.distinct,
  byName.distinct,
  'BUG CONDITION CONFIRMED: distinct proctor keys (' + byKey.distinct +
    ') ≠ distinct teacher names (' + byName.distinct +
    '), delta=' + (byKey.distinct - byName.distinct) + ' = number of name ' +
    'collisions. Conservation law: 154 keys − 7 collisions = 147 names ' +
    '(observed). Pre-fix DB-rendered max-load is inflated because each ' +
    'collision merges two keys (each at load=2 or 3) into a single name ' +
    'bucket whose total reaches load=4.'
);

// 8.c) Max-load delta: `maxByKey < maxByName` whenever any collision lifts a
//      name bucket above 3. This is the user-visible symptom in the bug
//      report (memory shows max=3, DB shows max=4).
assert.strictEqual(
  maxByKey,
  maxByName,
  'BUG CONDITION CONFIRMED: maxLoad by proctor_keys (' + maxByKey +
    ') ≠ maxLoad by teacher_name (' + maxByName + '). Algorithm in memory ' +
    'reports max=' + maxByKey + ' (the fairness contract delivered by ' +
    'proctor-v2-fairness-undercovered-fix). The display layer reports max=' +
    maxByName + ' to the user, undermining the contract. Each colliding ' +
    'teacher_name accumulates the loads of its multiple proctor keys.'
);

// If we reach here on F, H5 is refuted — escalate.
console.log('[inv-a-instrument-roundtrip] (unexpected) histograms agree on F ' +
  '— H5 may not be reproduced on this fixture. Expected the test to FAIL ' +
  'with a histogram divergence. Re-investigate.');

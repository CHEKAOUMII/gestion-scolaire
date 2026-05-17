'use strict';

// @phase-E investigation test — confirms H5 in isolation. EXPECTED to FAIL on F
//                               (the assertion that aggregation === per-key histogram).
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 4.E — Phase E — Display aggregation isolation test (no save trigger).
//
// _Validates: Requirements 1.7, 2.6, 2.8_
// _Phase: E_
// _Hypothesis: H5 — `buildSummaryRows()` aggregates by name, not by key._
// _Edit site: row 1 (`exams-rooms.html` `buildSummaryRows()`) — read-only inspection
//             during phase, edit only in Task 6.H5._
//
// ─────────────────────────────────────────────────────────────────────────
// Goal
// ─────────────────────────────────────────────────────────────────────────
// Phase A (Task 1) proved the bug condition C(X) at the memory layer: on
// `tests/fixtures/45454.json`, `histogramByProctorKey(R_mem)` ≠
// `histogramByName(R_mem)`. The inv-notes Phase A section formally argued
// that the JSON+IPC+DB layers are byte-preserving on `proctor_keys` and
// `proctors`, so the divergence cannot originate downstream.
//
// This test formalizes the H5 confirmation at the **renderer** layer: it
// replicates the production `buildSummaryRows()` aggregation logic from
// `exams-rooms.html` (≈lines 821–877) verbatim and applies it to `R_mem`
// directly (no save, no IPC, no DB). The replicated aggregator iterates
// `(row.proctors || []).forEach(name => ...)` exactly like the production
// code — collapsing keys that share `teacher_name` into a single bucket.
//
// We then derive `histogramFromTeacherMap(rendered)` from the aggregation
// output and assert two cross-checks:
//
//   (a) `histogramByProctorKey(R_mem)` deep-equals
//       `histogramFromTeacherMap(rendered)` — MUST FAIL on F. The
//       production aggregation does NOT preserve per-key counts because
//       it merges by name.
//
//   (b) `histogramByName(R_mem)` deep-equals
//       `histogramFromTeacherMap(rendered)` — MUST PASS on F. The
//       replicated aggregator and the by-name histogram are two views of
//       the same name-bucket partition, so they agree exactly.
//
// Together (a) + (b) prove that `buildSummaryRows()` aggregates by name
// (the H5 hypothesis), bisecting the bug to the display layer alone.
//
// ─────────────────────────────────────────────────────────────────────────
// Failure-message contract
// ─────────────────────────────────────────────────────────────────────────
// On F, assertion (a) MUST fail. Per task 4.E the failure message must
// name the 7 colliding teachers and show max=3 vs max=4 explicitly. To
// guarantee diagnostic output is printed even when the assertion throws,
// we collect and log all evidence BEFORE running the assertion block,
// using a try/catch wrapper so further (passing) assertions continue
// after assertion (a) throws — and the final re-throw exits non-zero.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// 1) Load the production v2 module via VM sandbox (mirrors
//    `tests/inv-a-instrument-roundtrip.test.js` lines 86–104).
// ─────────────────────────────────────────────────────────────────────────
const v2Src = fs.readFileSync(
  path.join(ROOT, 'js/algorithms/proctor-distribution-v2.js'),
  'utf8'
);
const sandbox = {
  console: console, Date: Date, Math: Math, Number: Number, Object: Object,
  Array: Array, Set: Set, Map: Map, JSON: JSON, isFinite: isFinite,
  isNaN: isNaN, Infinity: Infinity, parseInt: parseInt
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(v2Src, sandbox);
const V2 = sandbox.ProctorDistributionV2 || sandbox.window.ProctorDistributionV2;

assert.ok(V2 && typeof V2.run === 'function',
  'Failed to load ProctorDistributionV2 from production module');

// ─────────────────────────────────────────────────────────────────────────
// 2) Load the production fixture and run V2.
// ─────────────────────────────────────────────────────────────────────────
const input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));

assert.strictEqual(input.proctorsList.length, 147,
  'fixture should have 147 proctors (got ' + input.proctorsList.length + ')');

const out = V2.run(input);
assert.ok(out && out.result, 'V2.run produced no result');
const R_mem = out.result;
assert.strictEqual(R_mem.length, 191,
  'fixture should produce 191 result rows (got ' + R_mem.length + ')');

// ─────────────────────────────────────────────────────────────────────────
// 3) Replicate the production `buildSummaryRows()` aggregation verbatim.
//
//    Source: `exams-rooms.html` ≈lines 821–877, function buildSummaryRows.
//    The IPC-backed lines that read distribution and durationMap are not
//    relevant here — we already have R_mem in hand. The portion under
//    test is the per-row `(row.proctors || []).forEach(name => ...)`
//    aggregation that builds the teacherMap (lines 836–844, 846–855,
//    857–866), plus the helper functions `getTeacher` and
//    `createTeacherRow` (lines 786–808).
//
//    These helpers are reproduced verbatim with NO changes — the
//    behavioral equivalence to production is the whole point.
// ─────────────────────────────────────────────────────────────────────────

// Verbatim from `exams-rooms.html` ≈lines 786–800.
function createTeacherRow(name) {
  return {
    name: name,
    guard: [],
    reserve: [],
    duty: [],
    guardCount: 0,
    reserveCount: 0,
    dutyCount: 0,
    guardHours: 0,
    totalTasks: 0
  };
}

// Verbatim from `exams-rooms.html` ≈lines 802–808.
function getTeacher(map, name) {
  const clean = String(name || '').trim();
  if (!clean) return null;
  if (!map.has(clean)) map.set(clean, createTeacherRow(clean));
  return map.get(clean);
}

// Replicates the body of `buildSummaryRows()` ≈lines 829–866, minus the
// IPC-backed `await window.api.examConfig.get(...)` (we already have
// `distribution = R_mem`) and minus the duration map (irrelevant for
// histogram aggregation; we set duration=0 so guardHours stays 0).
//
// Crucially, the inner loops are identical in shape and identity
// function: each one iterates a names array (`row.proctors`,
// `row.reserves`, `row.duty_teachers`) and calls `getTeacher(map, name)`.
// Two proctors with the same `teacher_name` collide into one bucket —
// that is the H5 mechanism, expressed in the production aggregator.
function buildSummaryRowsReplica(distribution) {
  const teacherMap = new Map();
  const reserveSeen = new Set();
  const dutySeen = new Set();

  // NOTE: production calls `getAllProctorNames()` to pre-seed the map
  // with every known teacher (creating an empty row even for teachers
  // who got 0 guards). We DON'T pre-seed here because the histogram is
  // computed only over *non-empty* buckets — a pre-seeded zero-load
  // teacher would not change `histogramFromTeacherMap` (we filter
  // `count > 0` below). This preserves behavioral equivalence for the
  // assertion under test.

  distribution.forEach(function (row) {
    const sessionKey = row.session_key || row.session_label || '';
    const subject = row.subject_name || '';
    const duration = 0; // irrelevant for histogram

    (row.proctors || []).forEach(function (name) {
      const teacher = getTeacher(teacherMap, name);
      if (!teacher) return;
      teacher.guardCount += 1;
      teacher.guardHours += duration;
      teacher.guard.push([row.session_label, subject, row.room_number || row.room_name].filter(Boolean).join(' - '));
    });

    (row.reserves || []).forEach(function (name) {
      const reserveKey = [sessionKey, name].join('|');
      if (reserveSeen.has(reserveKey)) return;
      reserveSeen.add(reserveKey);
      const teacher = getTeacher(teacherMap, name);
      if (!teacher) return;
      teacher.reserveCount += 1;
      teacher.reserve.push(row.session_label || subject || 'احتياط');
    });

    (row.duty_teachers || []).forEach(function (name) {
      const dutyKey = [sessionKey, subject, name].join('|');
      if (dutySeen.has(dutyKey)) return;
      dutySeen.add(dutyKey);
      const teacher = getTeacher(teacherMap, name);
      if (!teacher) return;
      teacher.dutyCount += 1;
      teacher.duty.push([row.session_label, subject].filter(Boolean).join(' - '));
    });
  });

  return Array.from(teacherMap.values())
    .map(function (row) {
      return Object.assign(row, {
        guardHours: Math.round(row.guardHours * 100) / 100,
        totalTasks: row.guardCount + row.reserveCount + row.dutyCount
      });
    });
}

// ─────────────────────────────────────────────────────────────────────────
// 4) Compute the histogram of the rendered teacher map's `guardCount`.
//    This is the metric users actually see in the summary table — one
//    bucket per teacher, count = number of guard slots assigned.
// ─────────────────────────────────────────────────────────────────────────
function histogramFromTeacherMap(rendered) {
  const hist = Object.create(null);
  rendered.forEach(function (row) {
    if (!row || row.guardCount === 0) return; // ignore pre-seeded empty rows
    const c = row.guardCount;
    hist[c] = (hist[c] || 0) + 1;
  });
  return hist;
}

// ─────────────────────────────────────────────────────────────────────────
// 5) Reference histograms (algorithm vs display identity functions).
// ─────────────────────────────────────────────────────────────────────────
function histogramByProctorKey(rows) {
  const perKey = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].proctor_keys || [];
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      if (k) perKey[k] = (perKey[k] || 0) + 1;
    }
  }
  const hist = Object.create(null);
  Object.keys(perKey).forEach(function (k) {
    const c = perKey[k];
    hist[c] = (hist[c] || 0) + 1;
  });
  return { hist: hist, perKey: perKey, distinct: Object.keys(perKey).length };
}

function histogramByName(rows) {
  const perName = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const names = rows[i].proctors || [];
    for (let j = 0; j < names.length; j++) {
      const n = names[j];
      if (n) perName[n] = (perName[n] || 0) + 1;
    }
  }
  const hist = Object.create(null);
  Object.keys(perName).forEach(function (n) {
    const c = perName[n];
    hist[c] = (hist[c] || 0) + 1;
  });
  return { hist: hist, perName: perName, distinct: Object.keys(perName).length };
}

function findNameCollisions(rows) {
  const keysByName = Object.create(null);
  for (let i = 0; i < rows.length; i++) {
    const keys = rows[i].proctor_keys || [];
    const names = rows[i].proctors || [];
    for (let j = 0; j < keys.length; j++) {
      const k = keys[j];
      const n = names[j];
      if (!k || !n) continue;
      if (!keysByName[n]) keysByName[n] = Object.create(null);
      keysByName[n][k] = true;
    }
  }
  const colliding = [];
  Object.keys(keysByName).forEach(function (n) {
    const keys = Object.keys(keysByName[n]);
    if (keys.length > 1) colliding.push({ name: n, keys: keys });
  });
  return colliding;
}

// ─────────────────────────────────────────────────────────────────────────
// 6) Apply the replicated aggregator to R_mem and compute its histogram.
// ─────────────────────────────────────────────────────────────────────────
const rendered = buildSummaryRowsReplica(R_mem);
const histRendered = histogramFromTeacherMap(rendered);
const renderedNonEmpty = rendered.filter(function (r) { return r.guardCount > 0; });
const maxRendered = renderedNonEmpty.reduce(function (m, r) {
  return Math.max(m, r.guardCount);
}, 0);

const byKey = histogramByProctorKey(R_mem);
const byName = histogramByName(R_mem);
const maxByKey = Object.keys(byKey.perKey).reduce(function (m, k) {
  return Math.max(m, byKey.perKey[k]);
}, 0);
const maxByName = Object.keys(byName.perName).reduce(function (m, n) {
  return Math.max(m, byName.perName[n]);
}, 0);
const collisions = findNameCollisions(R_mem);

// ─────────────────────────────────────────────────────────────────────────
// 7) Print full diagnostic BEFORE running the assertions, so the failure
//    message of assertion (a) is preceded by every piece of evidence the
//    spec requires (max=3 vs max=4, the 7 collision lines, both
//    histograms).
// ─────────────────────────────────────────────────────────────────────────
console.log('[inv-e-display-aggregation] fixture 45454.json:');
console.log('  proctors=' + input.proctorsList.length +
  ' | result rows=' + R_mem.length +
  ' | rendered teachers (guardCount>0)=' + renderedNonEmpty.length);
console.log('');
console.log('  histogramByProctorKey(R_mem)         = ' + JSON.stringify(byKey.hist) +
  '   (max=' + maxByKey + ', distinct keys=' + byKey.distinct + ')');
console.log('  histogramByName(R_mem)               = ' + JSON.stringify(byName.hist) +
  '   (max=' + maxByName + ', distinct names=' + byName.distinct + ')');
console.log('  histogramFromTeacherMap(rendered)    = ' + JSON.stringify(histRendered) +
  '   (max=' + maxRendered + ', distinct teachers=' + renderedNonEmpty.length + ')');
console.log('');
console.log('  divergence summary (H5):');
console.log('    algorithm max load (per proctor_key) = ' + maxByKey);
console.log('    rendered max load  (per teacher_name) = ' + maxRendered);
console.log('    delta              = +' + (maxRendered - maxByKey) +
  '   (collision-merged buckets inflate the displayed max)');
console.log('');
console.log('  name collisions (' + collisions.length + ' name(s) shared by ' +
  '≥2 proctor keys — root of H5):');
collisions.forEach(function (c) {
  const keyStr = c.keys.map(function (k) {
    return k + ':' + byKey.perKey[k];
  }).join(', ');
  console.log('    "' + c.name + '" → ' + keyStr);
});
console.log('');

// ─────────────────────────────────────────────────────────────────────────
// 8) Three primary assertions.
//
//    Assertion (a) is EXPECTED to FAIL on F — that failure is the SUCCESS
//    case for this exploratory test, confirming H5 in isolation.
//
//    Assertion (b) is EXPECTED to PASS on F — confirms the replicated
//    aggregator behaves identically to a pure name-bucketing of R_mem.
//
//    Assertion (c) is EXPECTED to PASS on F — sanity check that the
//    fixture actually exhibits a name-collision (otherwise the test
//    isn't exercising the bug).
//
//    To ensure the failure message of (a) doesn't suppress later
//    diagnostics, we capture (a)'s error and re-throw at the end after
//    (b), (c), and the summary log line have run.
// ─────────────────────────────────────────────────────────────────────────

let firstFailure = null;

// (a) The replicated aggregator does NOT preserve per-key counts. This is
//     the H5 root cause: production aggregates by name, collapsing
//     distinct proctor_keys into a single bucket whenever two proctors
//     share `teacher_name`.
try {
  assert.deepStrictEqual(
    histRendered,
    byKey.hist,
    'H5 CONFIRMED IN ISOLATION: histogramFromTeacherMap(rendered) ≠ ' +
      'histogramByProctorKey(R_mem). The production buildSummaryRows() ' +
      'aggregator (replicated verbatim from exams-rooms.html ≈lines 821–877) ' +
      'produces ' + JSON.stringify(histRendered) + ' (max=' + maxRendered +
      '), while the algorithm-keyed reference produces ' +
      JSON.stringify(byKey.hist) + ' (max=' + maxByKey + '). ' +
      'Delta: max ' + maxByKey + ' → ' + maxRendered + ' (+' +
      (maxRendered - maxByKey) + '). ' + collisions.length + ' name ' +
      'collisions identified (see diagnostic output above). The bug is ' +
      'isolated to the display aggregation — NOT in the algorithm, NOT in ' +
      'JSON encoding, NOT in IPC, NOT in SQLite. Fix track: 6.H5 ' +
      '(aggregate by proctor_keys instead of by teacher_name).'
  );
  console.log('[inv-e-display-aggregation] (unexpected) assertion (a) PASSED ' +
    'on F — H5 may not be reproduced on this fixture. Re-investigate.');
} catch (err) {
  firstFailure = err;
  console.log('[inv-e-display-aggregation] assertion (a) FAILED as expected ' +
    'on F (this is the SUCCESS case — confirms H5).');
}

// (b) The replicated aggregator IS equivalent to a pure name-bucketing
//     of R_mem. Both views compute the same partition (one bucket per
//     distinct teacher_name across all `row.proctors[i]` entries) and
//     therefore must produce the same histogram.
assert.deepStrictEqual(
  histRendered,
  byName.hist,
  'H5 CROSS-CHECK FAILED: histogramFromTeacherMap(rendered) ≠ ' +
    'histogramByName(R_mem). These should be identical because both are ' +
    'name-bucket partitions of the same `row.proctors[i]` slot universe. ' +
    'replicated=' + JSON.stringify(histRendered) +
    ' vs by-name=' + JSON.stringify(byName.hist) + '. ' +
    'If this fails the replicator has drifted from the production aggregator.'
);
console.log('[inv-e-display-aggregation] assertion (b) PASSED — replicated ' +
  'aggregator matches histogramByName exactly.');

// (c) Sanity check: the fixture must actually exhibit a name collision,
//     otherwise the test is vacuously "passing" on a no-collision case.
//     This pre-condition guards against silent regression.
assert.ok(collisions.length >= 1,
  'Phase E pre-condition failed: fixture has zero name collisions, ' +
    'so the test cannot exercise H5. This indicates the fixture was ' +
    'replaced or de-duplicated incorrectly. Expected ≥1 collisions on ' +
    'tests/fixtures/45454.json.');
console.log('[inv-e-display-aggregation] assertion (c) PASSED — fixture ' +
  'has ' + collisions.length + ' name collisions (≥1 required).');

// Final summary, then re-throw the deferred (a) failure so the process
// exits non-zero on F and confirms the bug condition.
console.log('');
if (firstFailure) {
  console.log('[inv-e-display-aggregation] Phase E result: H5 confirmed in ' +
    'isolation. Aggregation is lossy on the production fixture: per-key ' +
    'max=' + maxByKey + ' → rendered max=' + maxRendered + '. ' +
    'Re-throwing assertion (a) so the test exits non-zero.');
  throw firstFailure;
} else {
  console.log('[inv-e-display-aggregation] Phase E result: assertion (a) ' +
    'PASSED on F — H5 not reproduced. This is unexpected; the design tree ' +
    'must be revisited.');
}

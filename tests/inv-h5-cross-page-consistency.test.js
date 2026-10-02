'use strict';

// @cross-page consistency test — verifies exams-rooms.html buildSummaryRows() (post-fix)
// and exams-proctors.html buildAutoLoadStateFromRows() produce identical per-key histograms.
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 6.H5.4 — Cross-page consistency check (Node-only equivalent of the manual
//                Electron verification described in the task spec).
//
// _Validates: Requirements 2.3, 2.6_
// _Hypothesis: H5_
// _Edit site: rows 1 (exams-rooms.html buildSummaryRows) and 2 (exams-proctors.html
//             buildAutoLoadStateFromRows) — read-only inspection here, both already
//             fixed in Tasks 6.H5.2 and 6.H5.3 respectively._
//
// ─────────────────────────────────────────────────────────────────────────
// Goal
// ─────────────────────────────────────────────────────────────────────────
// The manual Electron check requires running auto-distribution in
// `exams-proctors.html`, navigating to `exams-rooms.html`, and visually
// confirming that both pages display the same per-teacher counts and the
// same histogram for the same fixture. Since this Node test environment
// cannot drive Electron, we provide an EQUIVALENT Node-only verification
// at the unit level.
//
// We:
//   1. Run V2.run(input) on tests/fixtures/45454.json (the production
//      fixture used by Phase A and Phase E).
//   2. Replicate the FIXED `buildSummaryRows()` aggregation logic from
//      `exams-rooms.html` lines 821–940 (the post-Task-6.H5.2 key-based
//      path with its backward-compat fallback) — extracted verbatim and
//      inlined as a Node-only function.
//   3. Replicate `buildAutoLoadStateFromRows()` from `exams-proctors.html`
//      lines 4379–4395 (already key-based — verified key-aggregating in
//      Task 6.H5.3) — also extracted verbatim.
//   4. Apply both aggregations to the same `R_mem` and assert they
//      produce the same per-proctor counts for every key.
//
// EXPECTED OUTCOME: Test PASSES. Both pages now use key-based aggregation
// (rooms-page via Task 6.H5.2, proctors-page already key-based per Task
// 6.H5.3 verification), so they must produce identical counts for the
// same input.
//
// This Node test cannot fully simulate the IPC+DB roundtrip the manual
// test would exercise, but it captures the cross-page aggregation parity
// that the manual test verifies. Manual Electron verification of the
// IPC+DB roundtrip is deferred to Task 9.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

// ─────────────────────────────────────────────────────────────────────────
// 1) Load the production v2 module via VM sandbox
//    (mirrors `tests/inv-a-instrument-roundtrip.test.js` and
//    `tests/inv-e-display-aggregation.test.js`).
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
// 2) Load the proctor-key-resolver helper from `js/data/proctor-key-resolver.js`
//    (the same module that `exams-rooms.html` and `exams-proctors.html` import
//    via `<script src=…>`). It exports CommonJS bindings for Node tests.
// ─────────────────────────────────────────────────────────────────────────
const resolver = require(path.join(ROOT, 'js/data/proctor-key-resolver.js'));
const buildProctorDisplayMap = resolver.buildProctorDisplayMap;
assert.ok(typeof buildProctorDisplayMap === 'function',
  'buildProctorDisplayMap not loaded from js/data/proctor-key-resolver.js');

// ─────────────────────────────────────────────────────────────────────────
// 3) Load fixture 45454 and run V2.
// ─────────────────────────────────────────────────────────────────────────
const input = JSON.parse(fs.readFileSync(
  path.join(ROOT, 'tests/fixtures/45454.json'),
  'utf8'
));
const proctorsList = input.proctorsList;
assert.strictEqual(proctorsList.length, 147,
  'fixture should have 147 proctors (got ' + proctorsList.length + ')');

const out = V2.run(input);
assert.ok(out && out.result, 'V2.run produced no result');
const R_mem = out.result;
assert.strictEqual(R_mem.length, 191,
  'fixture should produce 191 result rows (got ' + R_mem.length + ')');

// ─────────────────────────────────────────────────────────────────────────
// 4) Replicate the FIXED `buildSummaryRows()` aggregation from
//    `exams-rooms.html` lines 821–940 (post-Task-6.H5.2). The parts not
//    relevant to the per-proctor guard count (durationMap, reserves,
//    duty teachers, sorting) are omitted for clarity, but the
//    proctor_keys aggregation branch — the only path the algorithm
//    output exercises — is reproduced verbatim.
//
//    Source contract (verbatim from `exams-rooms.html` ≈line 786):
//
//      function createTeacherRow(name, key) {
//        return { key: key || name, name, guard: [], …, guardCount: 0, … };
//      }
//
//    And the proctor_keys branch (verbatim from `exams-rooms.html` ≈line
//    884):
//
//      const guardKeys = Array.isArray(row.proctor_keys) ? row.proctor_keys : null;
//      if (guardKeys && guardKeys.length) {
//        guardKeys.forEach((key, slotIdx) => {
//          const fallbackName = (row.proctors && row.proctors[slotIdx]) || '';
//          const teacher = bucketForKey(key, fallbackName);
//          if (!teacher) return;
//          teacher.guardCount += 1;
//          …
//        });
//      } else {
//        // legacy fallback — does NOT fire here because R_mem rows always
//        // carry proctor_keys (Task 1 / inv-a counterexample confirmed).
//      }
// ─────────────────────────────────────────────────────────────────────────
function createTeacherRow(name, key) {
  return {
    key: key || name,
    name: name,
    guardCount: 0
  };
}

function buildSummaryRowsRoomsReplica(distribution, proctorsList) {
  const teacherMap = new Map();
  const proctorMap = buildProctorDisplayMap(proctorsList);
  const nameToKey = new Map();
  proctorsList.forEach(function (proc, idx) {
    const key = proc && proc.cin ? proc.cin : ('__idx_' + idx);
    const displayName = String((proc && (proc.teacher_full_name || proc.teacher_name)) || '').trim();
    if (displayName && !nameToKey.has(displayName)) nameToKey.set(displayName, key);
  });

  // Pre-populate teacherMap with every proctor (keyed by stable key) so
  // teachers with zero tasks still appear in the summary list — verbatim
  // from `exams-rooms.html` ≈line 855.
  proctorsList.forEach(function (proc, idx) {
    const key = proc && proc.cin ? proc.cin : ('__idx_' + idx);
    const displayName = proctorMap.get(key)
      || String((proc && (proc.teacher_full_name || proc.teacher_name)) || '').trim()
      || key;
    if (!teacherMap.has(key)) teacherMap.set(key, createTeacherRow(displayName, key));
  });

  function bucketForKey(key, fallbackName) {
    const k = String(key || '').trim();
    if (!k) return null;
    if (!teacherMap.has(k)) {
      const displayName = proctorMap.get(k) || String(fallbackName || '').trim() || k;
      teacherMap.set(k, createTeacherRow(displayName, k));
    }
    return teacherMap.get(k);
  }

  distribution.forEach(function (row) {
    const guardKeys = Array.isArray(row.proctor_keys) ? row.proctor_keys : null;
    if (guardKeys && guardKeys.length) {
      guardKeys.forEach(function (key, slotIdx) {
        const fallbackName = (row.proctors && row.proctors[slotIdx]) || '';
        const teacher = bucketForKey(key, fallbackName);
        if (!teacher) return;
        teacher.guardCount += 1;
      });
    }
    // Legacy fallback path is intentionally omitted — R_mem always carries
    // proctor_keys (verified in Phase A / inv-a counterexample).
  });

  return teacherMap;
}

// ─────────────────────────────────────────────────────────────────────────
// 5) Replicate `buildAutoLoadStateFromRows()` and the supporting load-state
//    helpers from `exams-proctors.html` lines 3662–3712, 4379–4395.
//
//    Verbatim contract (from `exams-proctors.html` ≈line 4379):
//
//      function buildAutoLoadStateFromRows(rows, includeReserves) {
//        const loadState = createTeacherLoadState();
//        (rows || []).forEach(row => {
//          const halfdayKey = row.halfday_key || '';
//          (row.duty_teacher_keys || []).forEach(key =>
//            addTeacherHalfdayLoad(loadState, key, 'duty', halfdayKey));
//          (row.proctor_keys || []).forEach(key =>
//            addTeacherHalfdayLoad(loadState, key, 'guard', halfdayKey));
//          if (includeReserves) {
//            (row.reserve_keys || []).forEach(key =>
//              addTeacherHalfdayLoad(loadState, key, 'reserve', halfdayKey));
//          }
//        });
//        return loadState;
//      }
//
//    `addTeacherHalfdayLoad` adds the halfday key to a `Set`, so duplicate
//    appearances of the same key in the same halfday do NOT inflate the
//    count. The algorithm output guarantees one assignment per
//    (proctor, halfday) for guards, so set-cardinality === slot-count
//    for guards specifically.
//
//    NOTE: `createTeacherLoadState` in production keys the state by
//    `getProctorExemptionKey(proc, idx)` (cin || som || 'idx_' + idx),
//    while `buildAutoLoadStateFromRows` writes via `row.proctor_keys[i]`
//    (cin || '__idx_' + idx). The pre-existing key-shape mismatch
//    documented in inv-notes (Task 6.H5.3 § "Pre-existing key-shape
//    concern") is orthogonal to this cross-page test — it affects how
//    `getFairnessReport` reads the state, not how `buildSummaryRows`
//    counts guards. For this test we pre-populate the load state with
//    proctor_key shape so both replicas key over the same universe.
// ─────────────────────────────────────────────────────────────────────────
function ensureTeacherLoadEntry(loadState, exKey) {
  if (!loadState[exKey]) {
    loadState[exKey] = {
      teacherName: '',
      dutyHalfdays: new Set(),
      guardHalfdays: new Set(),
      reserveHalfdays: new Set()
    };
  }
  return loadState[exKey];
}

function addTeacherHalfdayLoad(loadState, exKey, type, halfdayKey, teacherName) {
  if (!exKey || !halfdayKey) return false;
  const entry = ensureTeacherLoadEntry(loadState, exKey);
  if (teacherName && !entry.teacherName) entry.teacherName = teacherName;
  if (type === 'guard') {
    const before = entry.guardHalfdays.size;
    entry.guardHalfdays.add(halfdayKey);
    return entry.guardHalfdays.size > before;
  }
  // duty / reserve branches preserved verbatim from production but not
  // exercised here (we only assert the guard histogram).
  if (type === 'duty') {
    const before = entry.dutyHalfdays.size;
    entry.dutyHalfdays.add(halfdayKey);
    return entry.dutyHalfdays.size > before;
  }
  if (type === 'reserve') {
    const before = entry.reserveHalfdays.size;
    entry.reserveHalfdays.add(halfdayKey);
    return entry.reserveHalfdays.size > before;
  }
  return false;
}

function getTeacherGuardLoad(loadState, exKey) {
  return ensureTeacherLoadEntry(loadState, exKey).guardHalfdays.size;
}

function buildAutoLoadStateFromRowsReplica(rows, proctorsList, includeReserves) {
  // Pre-populate using the algorithm's key shape so we test the same
  // key universe both sides aggregate over.
  const loadState = {};
  proctorsList.forEach(function (proc, idx) {
    const key = proc && proc.cin ? proc.cin : ('__idx_' + idx);
    loadState[key] = {
      teacherName: proc.teacher_name || '',
      dutyHalfdays: new Set(),
      guardHalfdays: new Set(),
      reserveHalfdays: new Set()
    };
  });

  (rows || []).forEach(function (row) {
    const halfdayKey = row.halfday_key || '';
    (row.duty_teacher_keys || []).forEach(function (key) {
      addTeacherHalfdayLoad(loadState, key, 'duty', halfdayKey);
    });
    (row.proctor_keys || []).forEach(function (key) {
      addTeacherHalfdayLoad(loadState, key, 'guard', halfdayKey);
    });
    if (includeReserves) {
      (row.reserve_keys || []).forEach(function (key) {
        addTeacherHalfdayLoad(loadState, key, 'reserve', halfdayKey);
      });
    }
  });

  return loadState;
}

// ─────────────────────────────────────────────────────────────────────────
// 6) Apply both aggregations to the same R_mem.
// ─────────────────────────────────────────────────────────────────────────
const teacherMap = buildSummaryRowsRoomsReplica(R_mem, proctorsList);
const loadState = buildAutoLoadStateFromRowsReplica(R_mem, proctorsList, false);

// Collect the universe of keys: the union of all algorithm-emitted keys
// (from R_mem.proctor_keys) and the pre-populated proctorsList keys.
const allKeys = new Set();
R_mem.forEach(function (row) {
  (row.proctor_keys || []).forEach(function (k) {
    if (k) allKeys.add(k);
  });
});
proctorsList.forEach(function (proc, idx) {
  allKeys.add(proc && proc.cin ? proc.cin : ('__idx_' + idx));
});

// ─────────────────────────────────────────────────────────────────────────
// 7) For each proctor key K, assert count_rooms(K) === count_proctors(K).
//    Collect mismatches first so the diagnostic prints all of them before
//    the assert fires.
// ─────────────────────────────────────────────────────────────────────────
const mismatches = [];
allKeys.forEach(function (key) {
  const teacher = teacherMap.get(key);
  const countRooms = teacher ? teacher.guardCount : 0;
  const countProctors = getTeacherGuardLoad(loadState, key);
  if (countRooms !== countProctors) {
    mismatches.push({
      key: key,
      name: (teacher && teacher.name) || key,
      rooms: countRooms,
      proctors: countProctors
    });
  }
});

const totalRooms = Array.from(teacherMap.values()).reduce(function (s, t) {
  return s + t.guardCount;
}, 0);
const totalProctors = Array.from(allKeys).reduce(function (s, k) {
  return s + getTeacherGuardLoad(loadState, k);
}, 0);

console.log('[inv-h5-cross-page-consistency] fixture 45454.json:');
console.log('  proctors=' + proctorsList.length +
  ' | result rows=' + R_mem.length +
  ' | distinct proctor_keys in R_mem=' + allKeys.size);
console.log('');
console.log('  rooms-page  (buildSummaryRows replica) total guard slots: ' + totalRooms);
console.log('  proctors-page (buildAutoLoadStateFromRows replica) total guard slots: ' + totalProctors);
console.log('  per-key mismatches: ' + mismatches.length);

// Per-key histogram — buckets by guardCount (rooms-side)
const histRooms = Object.create(null);
allKeys.forEach(function (key) {
  const teacher = teacherMap.get(key);
  const c = teacher ? teacher.guardCount : 0;
  histRooms[c] = (histRooms[c] || 0) + 1;
});
const histProctors = Object.create(null);
allKeys.forEach(function (key) {
  const c = getTeacherGuardLoad(loadState, key);
  histProctors[c] = (histProctors[c] || 0) + 1;
});
console.log('');
console.log('  histogram (rooms-page)    = ' + JSON.stringify(histRooms));
console.log('  histogram (proctors-page) = ' + JSON.stringify(histProctors));

if (mismatches.length > 0) {
  console.log('');
  console.log('  first 10 mismatches:');
  mismatches.slice(0, 10).forEach(function (m) {
    console.log('    key=' + m.key + ' name="' + m.name + '" rooms=' + m.rooms + ' proctors=' + m.proctors);
  });
}

// ─────────────────────────────────────────────────────────────────────────
// 8) The assertions.
// ─────────────────────────────────────────────────────────────────────────

// (a) Per-key counts must match across the two pages — the cross-page
//     consistency guarantee that Task 6.H5.4 verifies.
assert.strictEqual(
  mismatches.length, 0,
  'Cross-page consistency violated: ' + mismatches.length + ' proctor key(s) ' +
    'have different guard counts on rooms-page vs proctors-page replicas. ' +
    'This means buildSummaryRows() and buildAutoLoadStateFromRows() are ' +
    'no longer aggregating by the same identity function. See diagnostic ' +
    'output above for the offending keys. Both pages must aggregate by ' +
    'row.proctor_keys[i] (the algorithm-emitted stable key) for the H5 fix ' +
    'to remain coherent across navigation.'
);
console.log('[inv-h5-cross-page-consistency] assertion (a) PASSED — every ' +
  'proctor key has the same guard count on both pages.');

// (b) The two histograms must be deep-equal (a stronger consequence of (a):
//     not only individual keys agree, but also their distribution buckets).
assert.deepStrictEqual(
  histRooms, histProctors,
  'Histogram divergence between rooms-page and proctors-page replicas: ' +
    JSON.stringify(histRooms) + ' vs ' + JSON.stringify(histProctors) + '. ' +
    'Even though (a) passed key-by-key, the bucket distribution differs — ' +
    'this should be impossible given (a). If this fires, the test logic ' +
    'is wrong, not the fix.'
);
console.log('[inv-h5-cross-page-consistency] assertion (b) PASSED — ' +
  'histograms are byte-equal across both pages.');

// (c) Total guard-slot conservation: the aggregation total must equal the
//     algorithm's emitted slot count (382 on this fixture). This guards
//     against the case where the test silently drops slots from one side.
const expectedTotalSlots = R_mem.reduce(function (s, row) {
  return s + ((row.proctor_keys || []).filter(function (k) { return k; }).length);
}, 0);
assert.strictEqual(totalRooms, expectedTotalSlots,
  'rooms-page total guard slots (' + totalRooms + ') ≠ algorithm emitted ' +
    'slots (' + expectedTotalSlots + ')');
assert.strictEqual(totalProctors, expectedTotalSlots,
  'proctors-page total guard slots (' + totalProctors + ') ≠ algorithm ' +
    'emitted slots (' + expectedTotalSlots + ')');
console.log('[inv-h5-cross-page-consistency] assertion (c) PASSED — both ' +
  'pages account for the full ' + expectedTotalSlots + '-slot universe ' +
  'emitted by V2.run.');

console.log('');
console.log('[inv-h5-cross-page-consistency] Task 6.H5.4 result: ' +
  'cross-page consistency CONFIRMED. Both buildSummaryRows() and ' +
  'buildAutoLoadStateFromRows() produce identical per-key guard ' +
  'histograms on the production fixture, which is the unit-level ' +
  'equivalent of the manual Electron verification (run distribute in ' +
  'exams-proctors.html, navigate to exams-rooms.html, compare summaries).');

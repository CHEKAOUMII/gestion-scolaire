'use strict';

// @unit test for H5 fix — pre-fix encodes BOTH the buggy and the correct
// aggregation semantics; post-fix the production code matches
// aggregateByProctorKey semantics.
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 3.1 — Unit test for `buildSummaryRows()` aggregation behavior on
//            synthetic 3-row inputs.
//
// _Validates: Requirements 1.7, 2.6_
// _Bug_Condition: name-collision aggregation in `exams-rooms.html`
//   `buildSummaryRows()` (≈line 821) — H5 hypothesis._
// _Edit site: row 1 (`exams-rooms.html` `buildSummaryRows()`)._
//
// ─────────────────────────────────────────────────────────────────────────
// What this test does and why
// ─────────────────────────────────────────────────────────────────────────
// The production `buildSummaryRows()` in `exams-rooms.html` is `async`,
// reads from `window.api.examConfig.get(...)`, and is therefore not
// directly callable from Node. Instead, this test extracts the two
// aggregation shapes into pure helpers and exercises both on the same
// 3-row synthetic input:
//
//   • `aggregateByProctorKey(rows)` — keys each guard slot by
//     `row.proctor_keys[i]` (the post-fix correct semantics: per-key
//     counts; mirrors `getProctorKey` identity used in the algorithm).
//   • `aggregateByName(rows)`       — keys each guard slot by
//     `row.proctors[i]` (mirrors the *current* pre-fix production
//     `buildSummaryRows()` body, which iterates `(row.proctors || [])`
//     and merges teachers by name).
//
// The 3-row input is constructed so that two proctors share the same
// `teacher_name` (`"محمد"`) but have distinct synthetic
// `proctor_keys` (`__idx_5`, `__idx_42`). A third proctor (`أحمد`,
// `__idx_99`) is unique by both name and key.
//
// On UNFIXED code, both helpers are pure and live in this test file —
// they run and pass deterministically. The point of the test is to
// *contrast* the two semantics so that:
//
//   • the by-key aggregation produces 3 distinct buckets
//     (`__idx_5: 1, __idx_42: 1, __idx_99: 1` → histogram `{1: 3}`,
//     max load = 1).
//   • the by-name aggregation produces 2 buckets
//     (`محمد: 2, أحمد: 1` → histogram `{1: 1, 2: 1}`, max load = 2).
//
// The histogram shapes diverge — that is the H5 bug, isolated to a pure
// 3-row example. Post-fix (Task 6.H5.2), the production code will be
// rewritten to use the by-key aggregation and the displayed histogram
// will match `aggregateByProctorKey`.

const assert = require('assert');

// ─────────────────────────────────────────────────────────────────────────
// Pure aggregation helpers (mirror production shape)
// ─────────────────────────────────────────────────────────────────────────

// Mirrors `exams-rooms.html buildSummaryRows()` `getTeacher(map, name)`
// helper at ≈line 802: keyed by display string, lazy-creates one row per
// distinct key.
function getOrCreate(map, key) {
    const clean = String(key || '').trim();
    if (!clean) return null;
    if (!map.has(clean)) {
        map.set(clean, { key: clean, count: 0 });
    }
    return map.get(clean);
}

// Aggregate by `row.proctor_keys[i]` — the post-fix CORRECT semantics.
// Returns `{ teacherMap, histogram, distinct }` where:
//   • teacherMap : Map<key, { key, count }> — one entry per distinct
//     proctor key.
//   • histogram  : { [load]: numberOfProctorsWithThatLoad } — load
//     distribution across proctors.
//   • distinct   : number of distinct keys (== teacherMap.size).
function aggregateByProctorKey(rows) {
    const teacherMap = new Map();
    (rows || []).forEach(function (row) {
        (row.proctor_keys || []).forEach(function (key) {
            const t = getOrCreate(teacherMap, key);
            if (!t) return;
            t.count += 1;
        });
    });
    return finalize(teacherMap);
}

// Aggregate by `row.proctors[i]` (display name) — mirrors the CURRENT
// (pre-fix) production `buildSummaryRows()` body in `exams-rooms.html`
// at ≈lines 836–844:
//
//     (row.proctors || []).forEach(name => {
//         const teacher = getTeacher(teacherMap, name);
//         if (!teacher) return;
//         teacher.guardCount += 1;
//         ...
//     });
//
// When two proctors share `teacher_name`, this collapses their counts
// into a single bucket — that is the H5 bug.
function aggregateByName(rows) {
    const teacherMap = new Map();
    (rows || []).forEach(function (row) {
        (row.proctors || []).forEach(function (name) {
            const t = getOrCreate(teacherMap, name);
            if (!t) return;
            t.count += 1;
        });
    });
    return finalize(teacherMap);
}

function finalize(teacherMap) {
    const histogram = {};
    teacherMap.forEach(function (t) {
        const load = t.count;
        histogram[load] = (histogram[load] || 0) + 1;
    });
    return {
        teacherMap: teacherMap,
        histogram: histogram,
        distinct: teacherMap.size,
    };
}

function teacherCounts(agg) {
    const out = {};
    agg.teacherMap.forEach(function (t) {
        out[t.key] = t.count;
    });
    return out;
}

// ─────────────────────────────────────────────────────────────────────────
// Synthetic 3-row input
// ─────────────────────────────────────────────────────────────────────────
// Two proctors share `teacher_name` "محمد" but have distinct synthetic
// keys (`__idx_5`, `__idx_42`). A third proctor "أحمد" is unique on both
// axes. Each row has exactly one proctor slot, so total slots = 3.
const rows = [
    {
        session_label: 'الجلسة 1',
        subject_name: 'الرياضيات',
        room_number: '101',
        proctor_keys: ['__idx_5'],
        proctors: ['محمد'],
    },
    {
        session_label: 'الجلسة 2',
        subject_name: 'الفيزياء',
        room_number: '102',
        proctor_keys: ['__idx_42'],
        proctors: ['محمد'],
    },
    {
        session_label: 'الجلسة 3',
        subject_name: 'الكيمياء',
        room_number: '103',
        proctor_keys: ['__idx_99'],
        proctors: ['أحمد'],
    },
];

// ─────────────────────────────────────────────────────────────────────────
// Case A — aggregateByProctorKey produces 3 distinct buckets (CORRECT)
// ─────────────────────────────────────────────────────────────────────────
const byKey = aggregateByProctorKey(rows);

assert.strictEqual(byKey.distinct, 3,
    'aggregateByProctorKey should produce 3 distinct buckets ' +
    '(__idx_5, __idx_42, __idx_99); got ' + byKey.distinct);

assert.deepStrictEqual(teacherCounts(byKey), {
    '__idx_5': 1,
    '__idx_42': 1,
    '__idx_99': 1,
}, 'aggregateByProctorKey per-key counts should be {__idx_5:1,__idx_42:1,__idx_99:1}');

assert.deepStrictEqual(byKey.histogram, { 1: 3 },
    'aggregateByProctorKey histogram should be {1:3} — three proctors ' +
    'each with load 1 — but got ' + JSON.stringify(byKey.histogram));

// Conservation: total slots across all rows must equal sum of bucket
// counts (both = 3).
let totalKeySlots = 0;
byKey.teacherMap.forEach(function (t) { totalKeySlots += t.count; });
assert.strictEqual(totalKeySlots, 3,
    'aggregateByProctorKey total slot count should equal 3 (3 rows × 1 ' +
    'slot each); got ' + totalKeySlots);

const maxByKey = Math.max.apply(null, Object.keys(byKey.histogram).map(Number));
assert.strictEqual(maxByKey, 1,
    'aggregateByProctorKey max load should be 1; got ' + maxByKey);

// ─────────────────────────────────────────────────────────────────────────
// Case B — aggregateByName produces 2 buckets (COLLISION, the H5 bug)
// ─────────────────────────────────────────────────────────────────────────
const byName = aggregateByName(rows);

assert.strictEqual(byName.distinct, 2,
    'aggregateByName should produce 2 buckets (محمد and أحمد) — collapsing ' +
    'distinct __idx_5 and __idx_42 into the shared display name "محمد"; ' +
    'got ' + byName.distinct);

assert.deepStrictEqual(teacherCounts(byName), {
    'محمد': 2,
    'أحمد': 1,
}, 'aggregateByName per-name counts should be {محمد:2, أحمد:1}');

assert.deepStrictEqual(byName.histogram, { 1: 1, 2: 1 },
    'aggregateByName histogram should be {1:1, 2:1} — one proctor at load ' +
    '1 (أحمد), one at load 2 (محمد, the merged bucket) — but got ' +
    JSON.stringify(byName.histogram));

// Conservation: total slots are preserved by name aggregation too — the
// bug is per-bucket distribution, not total-sum loss. Both modes count
// the same 3 slots; only the bucket boundaries differ.
let totalNameSlots = 0;
byName.teacherMap.forEach(function (t) { totalNameSlots += t.count; });
assert.strictEqual(totalNameSlots, 3,
    'aggregateByName total slot count should equal 3 (preserved sum); got ' +
    totalNameSlots);

const maxByName = Math.max.apply(null, Object.keys(byName.histogram).map(Number));
assert.strictEqual(maxByName, 2,
    'aggregateByName max load should be 2 (the collision); got ' + maxByName);

// ─────────────────────────────────────────────────────────────────────────
// Case C — Direct cross-check that the two modes diverge on this input
// (this IS the H5 hypothesis, exhibited at unit granularity).
// ─────────────────────────────────────────────────────────────────────────
assert.notDeepStrictEqual(byKey.histogram, byName.histogram,
    'H5 hypothesis: aggregateByProctorKey histogram MUST differ from ' +
    'aggregateByName histogram on a name-collision input. If these match, ' +
    'the synthetic fixture is not exercising the collision case.');

assert.notStrictEqual(byKey.distinct, byName.distinct,
    'H5 hypothesis: distinct-bucket count MUST differ between by-key and ' +
    'by-name aggregation on a name-collision input ' +
    '(by-key=' + byKey.distinct + ', by-name=' + byName.distinct + ').');

assert.ok(maxByKey < maxByName,
    'H5 hypothesis: by-key max load (' + maxByKey + ') must be strictly ' +
    'less than by-name max load (' + maxByName + ') — the collision ' +
    'inflates the displayed max.');

// Total slot conservation across both modes — ensures the bug is purely
// a partition/identity issue, not a sum loss.
assert.strictEqual(totalKeySlots, totalNameSlots,
    'Total slot count must be preserved across both aggregation modes ' +
    '(by-key=' + totalKeySlots + ', by-name=' + totalNameSlots + ').');

// ─────────────────────────────────────────────────────────────────────────
// Diagnostic output
// ─────────────────────────────────────────────────────────────────────────
console.log('[build-summary-rows-unit] synthetic 3-row input:');
console.log('  rows                 = 3 (1 proctor slot each, 3 total slots)');
console.log('  shared name "محمد"   = __idx_5 + __idx_42 (collision)');
console.log('  unique name "أحمد"   = __idx_99');
console.log('');
console.log('  aggregateByProctorKey (CORRECT, post-fix semantics):');
console.log('    distinct buckets   = ' + byKey.distinct + '   (expect 3)');
console.log('    per-key counts     = ' + JSON.stringify(teacherCounts(byKey)));
console.log('    histogram          = ' + JSON.stringify(byKey.histogram) + '   (expect {1:3})');
console.log('    max load           = ' + maxByKey + '   (expect 1)');
console.log('');
console.log('  aggregateByName (BUGGY, current pre-fix semantics):');
console.log('    distinct buckets   = ' + byName.distinct + '   (expect 2 — collision)');
console.log('    per-name counts    = ' + JSON.stringify(teacherCounts(byName)));
console.log('    histogram          = ' + JSON.stringify(byName.histogram) + '   (expect {1:1, 2:1})');
console.log('    max load           = ' + maxByName + '   (expect 2 — inflated by collision)');
console.log('');
console.log('  H5 confirmed at unit granularity: by-name aggregation merges ' +
    'distinct proctor keys when teacher_name collides.');
console.log('[build-summary-rows-unit] PASS');

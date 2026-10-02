'use strict';

// @unit test for H5 resolver — defines contract for js/data/proctor-key-resolver.js (created in Task 6.H5.1)
//
// Spec: .kiro/specs/proctor-distribution-db-memory-mismatch/
// Task 3.2 — Unit test for `resolveProctorDisplayName` edge cases.
//
// _Validates: Requirements 2.6, 3.9_
// _Hypothesis: H5_
// _Edge cases addressed: design.md Edge Cases 1, 2, 7, 8._
// _Edit site: row 1 (resolver helper consumed by `buildSummaryRows`)._
//
// ─────────────────────────────────────────────────────────────────────────
// What this test does and why
// ─────────────────────────────────────────────────────────────────────────
// This test PINS the contract for the helper module
// `js/data/proctor-key-resolver.js`, which does NOT yet exist on the
// pre-fix tree and will be created in Task 6.H5.1. The contract follows
// the pseudocode in design.md → "Key→name resolution helper (H5 fix)":
//
//     FUNCTION resolveProctorDisplayName(key, proctorsList)
//       IF key matches /^__idx_(\d+)$/ THEN
//         idx := parse integer
//         RETURN proctorsList[idx]?.teacher_full_name
//                OR proctorsList[idx]?.teacher_name
//                OR key
//       ELSE
//         // CIN-keyed
//         proc := proctorsList.find(p => p.cin === key)
//         RETURN proc?.teacher_full_name OR proc?.teacher_name OR key
//       END
//     END FUNCTION
//
// Per Task 6.H5.1 the resolver module is loaded via `<script>` in the
// renderer (vanilla-renderer-script convention), but for Node test
// runs it must also be `require`-able. The helper is therefore expected
// to use a dual-export pattern (`module.exports = { ... }` plus an
// optional attach-to-`window.GS2` branch when `typeof window !==
// 'undefined'`) — same shape as other `js/data/*` modules.
//
// EXPECTED OUTCOME:
//   • Pre-fix: `js/data/proctor-key-resolver.js` does not exist; this
//     test FAILS with a clear "Helper not yet implemented (expected
//     pre-fix). Will pass after Task 6.H5.1." message. The failure
//     confirms the helper is missing — the encoded-as-failing contract.
//   • Post-fix: the helper module exists and exposes
//     `resolveProctorDisplayName`; every table-driven assertion below
//     passes.

const assert = require('assert');
const path = require('path');

// ─────────────────────────────────────────────────────────────────────────
// Try to load the helper. If it is missing (pre-fix), surface a clear
// error message that names the implementing task. Do NOT swallow the
// failure — we want the test runner to report it.
// ─────────────────────────────────────────────────────────────────────────
const HELPER_REL_PATH = '../js/data/proctor-key-resolver.js';
const HELPER_ABS_PATH = path.resolve(__dirname, HELPER_REL_PATH);

let resolveProctorDisplayName;
let buildProctorDisplayMap;
let loadError = null;

try {
    const mod = require(HELPER_REL_PATH);
    resolveProctorDisplayName = mod && mod.resolveProctorDisplayName;
    buildProctorDisplayMap = mod && mod.buildProctorDisplayMap;
} catch (err) {
    loadError = err;
}

if (loadError) {
    // Re-throw with a message that makes the cause unambiguous in the
    // test runner output. Pre-fix this is the EXPECTED outcome.
    throw new Error(
        'Helper not yet implemented (expected pre-fix). Will pass after ' +
        'Task 6.H5.1.\n' +
        '  Expected module: ' + HELPER_ABS_PATH + '\n' +
        '  Underlying error: ' + (loadError && loadError.message ? loadError.message : String(loadError))
    );
}

assert.strictEqual(typeof resolveProctorDisplayName, 'function',
    'js/data/proctor-key-resolver.js must export a function ' +
    '`resolveProctorDisplayName`. Helper not yet implemented (expected ' +
    'pre-fix). Will pass after Task 6.H5.1.');

// ─────────────────────────────────────────────────────────────────────────
// Table-driven cases
// ─────────────────────────────────────────────────────────────────────────
//
// Each case names the edge it exercises and the expected return.
// `proctorsList` is shaped like the rows returned by
// `window.api.examProctors.getAll(...)` — at minimum the helper should
// only need `{ cin, teacher_name, teacher_full_name }` per entry.
const cases = [
    {
        name: 'CIN-keyed: cin matches an entry → return teacher_name',
        key: 'AB123',
        proctorsList: [
            { cin: 'XX000', teacher_name: 'علي', teacher_full_name: '' },
            { cin: 'AB123', teacher_name: 'فاطمة', teacher_full_name: '' },
            { cin: 'CD456', teacher_name: 'حسن', teacher_full_name: '' },
        ],
        expected: 'فاطمة',
    },

    {
        name: '__idx_N-keyed: idx 5 resolves to proctorsList[5].teacher_name',
        key: '__idx_5',
        proctorsList: [
            { cin: '', teacher_name: 'A0', teacher_full_name: '' },
            { cin: '', teacher_name: 'A1', teacher_full_name: '' },
            { cin: '', teacher_name: 'A2', teacher_full_name: '' },
            { cin: '', teacher_name: 'A3', teacher_full_name: '' },
            { cin: '', teacher_name: 'A4', teacher_full_name: '' },
            { cin: '', teacher_name: 'سعيد', teacher_full_name: '' },
            { cin: '', teacher_name: 'A6', teacher_full_name: '' },
        ],
        expected: 'سعيد',
    },

    {
        name: 'Missing proctor (idx out of range) → fall back to raw key',
        key: '__idx_999',
        proctorsList: Array.from({ length: 10 }, function (_, i) {
            return { cin: '', teacher_name: 'P' + i, teacher_full_name: '' };
        }),
        expected: '__idx_999',
    },

    {
        name: 'CIN match but teacher_name empty → fall back to key',
        key: 'AB456',
        proctorsList: [
            { cin: 'AB456', teacher_name: '', teacher_full_name: '' },
        ],
        expected: 'AB456',
    },

    {
        name: 'CIN-keyed but key not found in list → fall back to key',
        key: 'NOT_IN_LIST',
        proctorsList: [
            { cin: 'AA111', teacher_name: 'X', teacher_full_name: '' },
            { cin: 'AA222', teacher_name: 'Y', teacher_full_name: '' },
        ],
        expected: 'NOT_IN_LIST',
    },

    {
        name: 'null proctorsList → do not crash, return key',
        key: 'AB789',
        proctorsList: null,
        expected: 'AB789',
    },

    {
        name: 'undefined proctorsList → do not crash, return key',
        key: '__idx_3',
        proctorsList: undefined,
        expected: '__idx_3',
    },

    {
        name: 'teacher_full_name preferred over teacher_name (CIN-keyed)',
        key: 'AB789',
        proctorsList: [
            { cin: 'AB789', teacher_name: 'الاسم القصير', teacher_full_name: 'الاسم الكامل' },
        ],
        expected: 'الاسم الكامل',
    },

    {
        name: 'teacher_full_name preferred over teacher_name (__idx_N-keyed)',
        key: '__idx_2',
        proctorsList: [
            { cin: '', teacher_name: 'n0', teacher_full_name: '' },
            { cin: '', teacher_name: 'n1', teacher_full_name: '' },
            { cin: '', teacher_name: 'short-name', teacher_full_name: 'preferred-full-name' },
        ],
        expected: 'preferred-full-name',
    },
];

// ─────────────────────────────────────────────────────────────────────────
// Run every case; collect failures and report them all at once so a
// single broken row does not mask the rest.
// ─────────────────────────────────────────────────────────────────────────
const failures = [];
cases.forEach(function (c) {
    let actual;
    let threw = null;
    try {
        actual = resolveProctorDisplayName(c.key, c.proctorsList);
    } catch (err) {
        threw = err;
    }
    if (threw) {
        failures.push({
            name: c.name,
            key: c.key,
            expected: c.expected,
            actual: '<threw: ' + (threw && threw.message ? threw.message : String(threw)) + '>',
        });
        return;
    }
    if (actual !== c.expected) {
        failures.push({
            name: c.name,
            key: c.key,
            expected: c.expected,
            actual: actual,
        });
    }
});

if (failures.length) {
    const detail = failures.map(function (f) {
        return '  ✗ ' + f.name + '\n' +
            '      key=' + JSON.stringify(f.key) + '\n' +
            '      expected=' + JSON.stringify(f.expected) + '\n' +
            '      actual  =' + JSON.stringify(f.actual);
    }).join('\n');
    throw new Error(
        failures.length + ' resolveProctorDisplayName case(s) failed:\n' + detail
    );
}

// ─────────────────────────────────────────────────────────────────────────
// Optional companion: buildProctorDisplayMap (precomputed Map<key, name>)
// — Task 6.H5.1 asks for a builder helper for performance. If it is
// exposed, sanity-check that it produces the same names for a small
// proctorsList. If it is not exposed, skip silently — the main contract
// is `resolveProctorDisplayName`.
// ─────────────────────────────────────────────────────────────────────────
if (typeof buildProctorDisplayMap === 'function') {
    const proctors = [
        { cin: 'AA111', teacher_name: 'م-1', teacher_full_name: '' },
        { cin: '', teacher_name: 'م-2', teacher_full_name: '' },                 // idx 1 — synthetic
        { cin: 'CC333', teacher_name: 'short', teacher_full_name: 'preferred' }, // full-name preference
    ];
    const map = buildProctorDisplayMap(proctors);
    assert.ok(map && typeof map.get === 'function',
        'buildProctorDisplayMap should return a Map-like with `.get(key)`.');
    assert.strictEqual(map.get('AA111'), 'م-1',
        'buildProctorDisplayMap: cin-keyed lookup should match resolveProctorDisplayName.');
    assert.strictEqual(map.get('__idx_1'), 'م-2',
        'buildProctorDisplayMap: synthetic-key lookup should match resolveProctorDisplayName.');
    assert.strictEqual(map.get('CC333'), 'preferred',
        'buildProctorDisplayMap: teacher_full_name should be preferred over teacher_name.');
}

// ─────────────────────────────────────────────────────────────────────────
// Diagnostic output
// ─────────────────────────────────────────────────────────────────────────
console.log('[resolve-proctor-display-name-unit] ' + cases.length + ' case(s) passed.');
cases.forEach(function (c) {
    console.log('  ✓ ' + c.name);
});
console.log('[resolve-proctor-display-name-unit] PASS');

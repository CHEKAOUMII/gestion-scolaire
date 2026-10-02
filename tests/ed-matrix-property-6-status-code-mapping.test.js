'use strict';

// Feature: exemptions-duty-matrix-grid, Property 6: Status code is a one-to-one mapping
//
// Validates: Requirements 3.1
//
// Property 6 (design.md): For any Proctor_Status, the Status_Cell displays
// exactly one Status_Code equal to the fixed mapping
// (guard→ك, exempt→معفى, duty→م, reserve→إح), and the mapping is injective so
// no two statuses share a code.
//
// This is a standalone Node test script (run-all.js discovers top-level
// tests/*.test.js). It exits non-zero on any failure.
//
//   node tests/ed-matrix-property-6-status-code-mapping.test.js

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');

const { STATUS, STATUS_CODE } = M;

// ---------------------------------------------------------------------------
// Fixed expected mapping — the single source of truth this property pins down.
// ---------------------------------------------------------------------------

const EXPECTED_CODE = {
    guard: 'ك',
    exempt: 'معفى',
    duty: 'م',
    reserve: 'إح'
};

const STATUS_VALUES = [STATUS.GUARD, STATUS.EXEMPT, STATUS.DUTY, STATUS.RESERVE];

// ---------------------------------------------------------------------------
// Static assertions on the constant mapping (independent of generated input).
// ---------------------------------------------------------------------------

// (1) Each status maps to EXACTLY the fixed code.
assert.strictEqual(STATUS_CODE[STATUS.GUARD], 'ك', 'guard must map to ك');
assert.strictEqual(STATUS_CODE[STATUS.EXEMPT], 'معفى', 'exempt must map to معفى');
assert.strictEqual(STATUS_CODE[STATUS.DUTY], 'م', 'duty must map to م');
assert.strictEqual(STATUS_CODE[STATUS.RESERVE], 'إح', 'reserve must map to إح');

// (2) Injectivity: the four codes form a set of size 4 — no two statuses share a code.
const allCodes = STATUS_VALUES.map((s) => STATUS_CODE[s]);
assert.strictEqual(
    new Set(allCodes).size,
    4,
    'status→code mapping must be injective: the four codes must be pairwise distinct'
);

// ---------------------------------------------------------------------------
// The property: over the four STATUS values, each maps to exactly one defined,
// non-empty code equal to the fixed mapping, and distinct statuses never share
// a code.
// ---------------------------------------------------------------------------

const statusArb = fc.constantFrom.apply(fc, STATUS_VALUES);

function checkProperty6(status) {
    const code = STATUS_CODE[status];

    // Defined and non-empty (never undefined / null / '').
    assert.ok(
        code !== undefined && code !== null && code !== '',
        'status "' + status + '" must map to a defined, non-empty code'
    );

    // Exactly the fixed code for this status.
    assert.strictEqual(
        code,
        EXPECTED_CODE[status],
        'status "' + status + '" must map to "' + EXPECTED_CODE[status] + '", got "' + code + '"'
    );

    // Injective: no OTHER status shares this code.
    for (const other of STATUS_VALUES) {
        if (other !== status) {
            assert.notStrictEqual(
                STATUS_CODE[other],
                code,
                'codes must be unique: "' + other + '" and "' + status + '" both map to "' + code + '"'
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 6: status code is a one-to-one mapping');

try {
    fc.assert(
        fc.property(statusArb, (status) => {
            checkProperty6(status);
        }),
        { numRuns: 100 }
    );
    console.log('PASS: Property 6 holds across 100 generated status values');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 6 violated');
    console.error(err && err.message ? err.message : err);
    process.exit(1);
}

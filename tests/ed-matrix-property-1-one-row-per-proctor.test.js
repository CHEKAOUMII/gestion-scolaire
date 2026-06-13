'use strict';

// Feature: exemptions-duty-matrix-grid, Property 1: One row per identity-bearing proctor
//
// Validates: Requirements 1.1, 2.3
//
// Property 1 (design.md): For any proctors list and schedule, the matrix model
// contains exactly one Proctor_Row for each proctor that has at least one
// non-empty Identity_Column field, and none for proctors whose data identity
// fields are all empty/null.
//
// The implementation (buildProctorRows / buildMatrixModel) tests emptiness over
// the four DATA identity fields — teacher_name (الاسم), som (رقم التأجير),
// workplace (المؤسسة), specialty (مادة التخصص). ترتيب is a derived display
// index, not a data field, so it does not enter the omission test. A field is
// "empty" when it is null/undefined or, after trimming, the empty string
// (whitespace-only counts as empty), matching normalizeIdentityField.
//
// This is a standalone Node test script run at the top level:
//   node tests/ed-matrix-property-1-one-row-per-proctor.test.js
// It exits non-zero on any failure.
//
// Generators produce proctor records whose four identity fields are each
// sometimes empty ('' / null / whitespace) and sometimes non-empty, plus an
// occasional cin (which influences proctorKey but NOT row inclusion). The
// schedule generator drives buildSessionColumns so cells are resolved against
// real session columns. The store is left empty (every cell resolves to guard);
// row inclusion does not depend on the store, so an empty store is sufficient.

const assert = require('assert');
const fc = require('fast-check');

const M = require('../js/exams/ed-matrix-logic.js');
const { buildMatrixModel, buildSessionColumns } = M;

const MIN_CASES = 100;

// ---------------------------------------------------------------------------
// Emptiness helper — mirrors normalizeIdentityField in the module.
// ---------------------------------------------------------------------------

function isEmptyField(value) {
    if (value == null) {
        return true;
    }
    return String(value).trim() === '';
}

// A proctor is identity-bearing iff at least one of its four DATA identity
// fields is non-empty.
function hasAnyIdentity(proc) {
    if (!proc) {
        return false;
    }
    return !isEmptyField(proc.teacher_name) ||
        !isEmptyField(proc.som) ||
        !isEmptyField(proc.workplace) ||
        !isEmptyField(proc.specialty);
}

// ---------------------------------------------------------------------------
// Arbitraries.
// ---------------------------------------------------------------------------

// An identity field value that is sometimes empty (''/null/undefined/
// whitespace) and sometimes a real non-empty string.
const identityFieldArb = fc.oneof(
    { weight: 2, arbitrary: fc.constantFrom('', '   ', '\t', '\n', null, undefined) },
    { weight: 3, arbitrary: fc.constantFrom('أحمد', 'سعيد', 'ليلى', 'فاطمة', 'X-9', '12345', 'رياضيات', 'الثانوية') }
);

// cin is sometimes set (affecting the proctorKey) and sometimes empty. It is
// NOT one of the four identity fields, so it must never affect row inclusion.
const cinArb = fc.oneof(
    { weight: 1, arbitrary: fc.constantFrom('', null, undefined) },
    { weight: 1, arbitrary: fc.constantFrom('CIN1', 'CIN2', 'CIN3') }
);

const proctorArb = fc.record({
    cin: cinArb,
    teacher_name: identityFieldArb,
    som: identityFieldArb,
    workplace: identityFieldArb,
    specialty: identityFieldArb
});

const scheduleEntryArb = fc.record({
    date_year: fc.constantFrom(2025, 2026),
    date_month: fc.integer({ min: 1, max: 12 }),
    date_day: fc.integer({ min: 1, max: 28 }),
    day: fc.constantFrom('الأول', 'الثاني', 'الثالث'),
    period: fc.constantFrom('صباحا', 'زوالا'),
    session: fc.constantFrom('الحصة الأولى', 'الحصة الثانية', 'الحصة الثالثة'),
    subject_name: fc.constantFrom('الرياضيات', 'الفيزياء', 'العربية', ''),
    order: fc.integer({ min: 1, max: 20 })
});

// ---------------------------------------------------------------------------
// Property assertion for one generated (proctors, schedule) pair.
// ---------------------------------------------------------------------------

function checkProperty(proctors, schedule) {
    const sessions = buildSessionColumns(schedule);
    const store = {}; // empty store — every cell resolves to guard.
    const model = buildMatrixModel(proctors, sessions, store);

    // Expected kept proctors = those with >=1 non-empty data identity field.
    const expectedKept = proctors.filter(hasAnyIdentity);

    // EXACTLY one row per identity-bearing proctor.
    assert.strictEqual(
        model.rows.length,
        expectedKept.length,
        'row count ' + model.rows.length + ' != identity-bearing proctor count ' + expectedKept.length
    );

    // Every emitted row corresponds to an identity-bearing proctor, and the row
    // carries the original proctor object reference.
    const keptRefs = new Set();
    for (const row of model.rows) {
        assert.ok(
            hasAnyIdentity(row.proctor),
            'emitted a row for a proctor with all-empty identity fields'
        );
        assert.strictEqual(row.hasAnyIdentity, true, 'kept row must report hasAnyIdentity === true');
        keptRefs.add(row.proctor);
    }

    // Every all-empty-identity proctor is ABSENT (never appears as a row).
    for (const proc of proctors) {
        if (!hasAnyIdentity(proc)) {
            assert.ok(
                !keptRefs.has(proc),
                'an all-empty-identity proctor appeared in the matrix rows'
            );
        }
    }

    // Reference-level coverage: each identity-bearing proctor instance appears
    // exactly once (counts match by reference, accounting for duplicate refs is
    // unnecessary since fast-check generates fresh object instances per slot).
    const expectedRefCount = expectedKept.length;
    assert.strictEqual(keptRefs.size, expectedRefCount,
        'distinct kept row references ' + keptRefs.size + ' != identity-bearing count ' + expectedRefCount);
}

// ---------------------------------------------------------------------------
// Runner.
// ---------------------------------------------------------------------------

console.log('[test] exemptions-duty-matrix-grid — Property 1: one row per identity-bearing proctor');

try {
    fc.assert(
        fc.property(
            fc.array(proctorArb, { minLength: 0, maxLength: 12 }),
            fc.array(scheduleEntryArb, { minLength: 0, maxLength: 8 }),
            (proctors, schedule) => {
                checkProperty(proctors, schedule);
            }
        ),
        { numRuns: MIN_CASES, verbose: true }
    );

    // --- Edge case: an all-empty proctor is omitted even when it has a cin. ---
    // cin sets the proctorKey but is not an identity field, so the row is still
    // omitted (Requirement 2.3).
    (function cinDoesNotRescueAllEmpty() {
        const proctors = [
            { cin: 'CIN_X', teacher_name: '', som: null, workplace: '   ', specialty: undefined },
            { cin: '', teacher_name: 'ظاهر', som: '', workplace: '', specialty: '' }
        ];
        const model = buildMatrixModel(proctors, buildSessionColumns([]), {});
        assert.strictEqual(model.rows.length, 1,
            'only the identity-bearing proctor should be kept, regardless of cin');
        assert.strictEqual(model.rows[0].proctor, proctors[1],
            'the kept row must be the proctor with a non-empty identity field');
    })();

    // --- Edge case: every single field alone is sufficient to keep a row. -----
    (function eachFieldAloneKeepsRow() {
        const fields = ['teacher_name', 'som', 'workplace', 'specialty'];
        for (const f of fields) {
            const proc = { cin: '', teacher_name: '', som: '', workplace: '', specialty: '' };
            proc[f] = 'قيمة';
            const model = buildMatrixModel([proc], buildSessionColumns([]), {});
            assert.strictEqual(model.rows.length, 1,
                'a proctor with only ' + f + ' set must be kept');
        }
    })();

    console.log('PASS ed-matrix Property 1: One row per identity-bearing proctor (' + MIN_CASES + '+ generated cases + edge cases)');
    process.exit(0);
} catch (err) {
    console.error('FAIL: Property 1 violated');
    console.error(err && err.message ? err.message : err);
    if (err && err.counterexample) {
        console.error('Counterexample: ' + JSON.stringify(err.counterexample));
    }
    process.exit(1);
}

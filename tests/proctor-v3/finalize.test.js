/**
 * Unit + property tests for js/algorithms/proctor-v3/phases/10-finalize.js
 *
 * Validates:
 *   - Requirement 6.9  (softViolations tagging)
 *   - Requirement 6.10 (softViolations advisory only, proctor_keys preserved)
 *   - Requirement 9.1  (state has rows + diagnostics; algorithmVersion='v3')
 *   - Requirement 9.8  (diagnostics is JSON round-trip safe)
 *   - Requirement 10.1 (output is JSON-serializable)
 *   - Requirement 10.2 (no shared array references across rows)
 *   - Requirement 13.1 (V2-shape field set per row)
 *   - Requirement 13.2 (proctors aligned with proctor_keys)
 *   - Requirement 13.3 (reserves aligned with reserve_keys)
 *   - Requirement 13.4 (softViolations ⊆ closed token set)
 *   - Requirement 13.5 (field types match V2)
 *
 * The property tests pipe random inputs through Phases 0–4 → 9 → 10 to
 * exercise the finalize phase on realistic states. The full-pipeline
 * orchestration test is deferred to Task 23.
 *
 * Run directly:   node tests/proctor-v3/finalize.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const V3_ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');

const { createPRNG } = require(path.join(V3_ROOT, 'utils', 'prng.js'));
const { validateInput } = require(path.join(V3_ROOT, 'phases', '00-validate.js'));
const { normalizeKeys } = require(path.join(V3_ROOT, 'phases', '01-normalize-keys.js'));
const { buildRoomsAndRows } = require(path.join(V3_ROOT, 'phases', '01b-build-rooms-and-rows.js'));
const { deriveEligibilityClasses } = require(path.join(V3_ROOT, 'phases', '02-eligibility-classes.js'));
const { computeBounds } = require(path.join(V3_ROOT, 'phases', '03-bounds.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const { placeReserves } = require(path.join(V3_ROOT, 'phases', '09-place-reserves.js'));
const {
    finalize,
    _internals: finalizeInternals,
} = require(path.join(V3_ROOT, 'phases', '10-finalize.js'));
const {
    createLoadState,
    addDutyLoad,
} = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { arbitraryInput } = require(path.join(__dirname, 'pbt-helpers.js'));

let passed = 0;
let failed = 0;

function test(name, fn) {
    try {
        fn();
        passed += 1;
        console.log(`  ok  ${name}`);
    } catch (err) {
        failed += 1;
        console.error(`  FAIL  ${name}`);
        console.error(err && err.stack ? err.stack : err);
    }
}

const ALLOWED_SOFT_TOKENS = ['sameRoomRepeat', 'subjectConflict', 'amPmImbalance', 'genderImbalance'];
const REQUIRED_ROW_FIELDS = [
    'session_key', 'halfday_key', 'day_key', 'room_key', 'room_name',
    'proctors', 'proctor_keys', 'reserves', 'reserve_keys',
    'duty_teachers', 'softViolations', 'notes',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Build a finalized state by running Phases 1–4 → 9 → 10. Returns the
 * post-Phase-10 state.
 */
function runUpToFinalize(input, options) {
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error('validateInput failed: ' + JSON.stringify(validation.errors));
    }
    let state = { input, options: options || {} };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const canonicalKeys = [];
    if (Array.isArray(input.proctorsList)) {
        for (let i = 0; i < input.proctorsList.length; i += 1) {
            canonicalKeys.push(canonicalKeyOf(input.proctorsList[i], i));
        }
    }
    const ls = createLoadState(canonicalKeys);
    if (state.normalizedDutyData) {
        const halfdays = Object.keys(state.normalizedDutyData);
        for (let h = 0; h < halfdays.length; h += 1) {
            const inner = state.normalizedDutyData[halfdays[h]];
            if (!inner || typeof inner !== 'object') continue;
            const procKeys = Object.keys(inner);
            for (let p = 0; p < procKeys.length; p += 1) {
                addDutyLoad(ls, procKeys[p], halfdays[h]);
            }
        }
    }
    state.loadState = ls;
    state = placeGuards(state);
    state = placeReserves(state);
    state = finalize(state);
    return state;
}

/**
 * Build a small synthetic state for direct unit testing of Phase 10
 * without running upstream phases.
 */
function makeMinimalFinalizableState() {
    const proctorsList = [
        { cin: '1000001', teacher_full_name: 'Alice', subject: 'Math', gender: 'F' },
        { cin: '1000002', teacher_full_name: 'Bob', subject: 'Phys', gender: 'M' },
        { cin: '1000003', teacher_full_name: 'Carol', subject: 'Math', gender: 'F' },
        { cin: '1000004', teacher_full_name: 'Dave', subject: 'Hist', gender: 'M' },
    ];

    // Two rows: one for "Math" (subject), shared room "R1". Bob does both
    // → sameRoomRepeat. Alice in row 0 → subjectConflict (row.subject Math).
    const rows = [
        {
            session_key: '2026-06-01|صباحا|L1|Math',
            halfday_key: '2026-06-01|صباحا',
            day_key: '2026-06-01',
            room_key: 'R1',
            room_name: 'Salle 1',
            level: 'L1',
            subject: 'Math',
            proctor_keys: ['1000001', '1000002'], // Alice (Math conflict), Bob
            proctors: [],
            reserve_keys: ['1000003'],
            reserves: [],
            duty_teachers: [],
            softViolations: [],
        },
        {
            session_key: '2026-06-02|صباحا|L1|Hist',
            halfday_key: '2026-06-02|صباحا',
            day_key: '2026-06-02',
            room_key: 'R1', // Same room → sameRoomRepeat for Bob
            room_name: 'Salle 1',
            level: 'L1',
            subject: 'Hist',
            proctor_keys: ['1000002', '1000004'], // Bob (repeat), Dave (Hist conflict)
            proctors: [],
            reserve_keys: [],
            reserves: [],
            duty_teachers: [],
            softViolations: [],
        },
    ];

    return {
        input: { proctorsList, randomSeed: 42 },
        rng: { seed: 42 },
        rows,
        loadState: {
            proctors: {
                '1000001': { guardCount: 1, reserveCount: 0, dutyCount: 0,
                    amCount: 1, pmCount: 0,
                    guardHalfdays: new Set(), guardDays: new Set(), guardSessions: new Set(),
                    reserveHalfdays: new Set(), reserveDays: new Set(), reserveSessions: new Set() },
                '1000002': { guardCount: 2, reserveCount: 0, dutyCount: 0,
                    amCount: 2, pmCount: 0,
                    guardHalfdays: new Set(), guardDays: new Set(), guardSessions: new Set(),
                    reserveHalfdays: new Set(), reserveDays: new Set(), reserveSessions: new Set() },
                '1000003': { guardCount: 0, reserveCount: 1, dutyCount: 0,
                    amCount: 0, pmCount: 0,
                    guardHalfdays: new Set(), guardDays: new Set(), guardSessions: new Set(),
                    reserveHalfdays: new Set(), reserveDays: new Set(), reserveSessions: new Set() },
                '1000004': { guardCount: 1, reserveCount: 0, dutyCount: 0,
                    amCount: 1, pmCount: 0,
                    guardHalfdays: new Set(), guardDays: new Set(), guardSessions: new Set(),
                    reserveHalfdays: new Set(), reserveDays: new Set(), reserveSessions: new Set() },
            },
        },
        classByProctorKey: {
            '1000001': 'c1', '1000002': 'c1', '1000003': 'c1', '1000004': 'c1',
        },
        classBoundsByProctorKey: {
            '1000001': { classId: 'c1', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            '1000002': { classId: 'c1', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            '1000003': { classId: 'c1', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            '1000004': { classId: 'c1', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
        },
        globalLowerBound: 1,
        globalUpperBound: 2,
        diagnostics: {
            warnings: [],
            errors: [],
            unresolvedSlots: [],
            coverageWarnings: [],
            coverageRepairSwaps: 0,
            coverageRepairUnresolved: 0,
            amPmImbalanceByProctorKey: {
                '1000001': 1,
                '1000002': 2, // ≥ threshold → amPmImbalance tag
                '1000003': 0,
                '1000004': 1,
            },
        },
    };
}

// ---------------------------------------------------------------------------
// Unit tests — direct API
// ---------------------------------------------------------------------------

test('finalize: throws on null/undefined/non-object state', () => {
    assert.throws(() => finalize(null), TypeError);
    assert.throws(() => finalize(undefined), TypeError);
    assert.throws(() => finalize({ input: null }), TypeError);
    assert.throws(() => finalize({}), TypeError);
});

test('finalize: minimal empty state runs without crashing', () => {
    const state = finalize({ input: { proctorsList: [] }, rows: [], loadState: { proctors: {} } });
    assert.ok(Array.isArray(state.rows), 'rows must be an array');
    assert.strictEqual(state.rows.length, 0);
    assert.ok(state.diagnostics, 'diagnostics must be present');
    assert.strictEqual(state.diagnostics.algorithmVersion, 'v3');
});

test('finalize: returns state with `result` alias === `rows`', () => {
    const state = finalize(makeMinimalFinalizableState());
    assert.ok(Array.isArray(state.result), 'result must be array');
    assert.strictEqual(state.result, state.rows, 'state.result and state.rows must alias');
});

// ---------------------------------------------------------------------------
// AC 13.1 / 13.5 — V2 row shape
// ---------------------------------------------------------------------------

test('AC 13.1: every row has the V2-compatible field set', () => {
    const state = finalize(makeMinimalFinalizableState());
    for (let i = 0; i < state.rows.length; i += 1) {
        const r = state.rows[i];
        for (const f of REQUIRED_ROW_FIELDS) {
            assert.ok(
                Object.prototype.hasOwnProperty.call(r, f),
                'row ' + i + ': missing field ' + f
            );
        }
    }
});

test('AC 13.5: row field types match V2 (strings + arrays)', () => {
    const state = finalize(makeMinimalFinalizableState());
    for (let i = 0; i < state.rows.length; i += 1) {
        const r = state.rows[i];
        assert.strictEqual(typeof r.session_key, 'string');
        assert.strictEqual(typeof r.halfday_key, 'string');
        assert.strictEqual(typeof r.day_key, 'string');
        assert.strictEqual(typeof r.room_key, 'string');
        assert.strictEqual(typeof r.room_name, 'string');
        assert.strictEqual(typeof r.notes, 'string');
        assert.ok(Array.isArray(r.proctors));
        assert.ok(Array.isArray(r.proctor_keys));
        assert.ok(Array.isArray(r.reserves));
        assert.ok(Array.isArray(r.reserve_keys));
        assert.ok(Array.isArray(r.duty_teachers));
        assert.ok(Array.isArray(r.softViolations));
    }
});

// ---------------------------------------------------------------------------
// AC 13.2 / 13.3 — display-name alignment
// ---------------------------------------------------------------------------

test('AC 13.2: proctors[] aligned with proctor_keys[]', () => {
    const state = finalize(makeMinimalFinalizableState());
    for (let i = 0; i < state.rows.length; i += 1) {
        const r = state.rows[i];
        assert.strictEqual(r.proctors.length, r.proctor_keys.length,
            'row ' + i + ': proctors length must match proctor_keys length');
    }
    // Specific names: Alice for 1000001 (row 0, idx 0), Bob for 1000002 (row 0 idx 1, row 1 idx 0).
    assert.strictEqual(state.rows[0].proctors[0], 'Alice');
    assert.strictEqual(state.rows[0].proctors[1], 'Bob');
    assert.strictEqual(state.rows[1].proctors[0], 'Bob');
    assert.strictEqual(state.rows[1].proctors[1], 'Dave');
});

test('AC 13.3: reserves[] aligned with reserve_keys[]', () => {
    const state = finalize(makeMinimalFinalizableState());
    for (let i = 0; i < state.rows.length; i += 1) {
        const r = state.rows[i];
        assert.strictEqual(r.reserves.length, r.reserve_keys.length,
            'row ' + i + ': reserves length must match reserve_keys length');
    }
    // Carol (1000003) is the reserve in row 0.
    assert.strictEqual(state.rows[0].reserves[0], 'Carol');
});

test('AC 13.2: null guard slot maps to empty-string display name', () => {
    const state = makeMinimalFinalizableState();
    state.rows[0].proctor_keys = ['1000001', null]; // Bob slot becomes null
    const finalized = finalize(state);
    assert.strictEqual(finalized.rows[0].proctors.length, 2);
    assert.strictEqual(finalized.rows[0].proctors[0], 'Alice');
    assert.strictEqual(finalized.rows[0].proctors[1], '');
});

// ---------------------------------------------------------------------------
// AC 6.9 / 13.4 — softViolations tagging
// ---------------------------------------------------------------------------

test('AC 6.9: detects subjectConflict when guard.subject matches row.subject', () => {
    const state = finalize(makeMinimalFinalizableState());
    // Row 0: Math row, Alice teaches Math → subjectConflict expected.
    assert.ok(state.rows[0].softViolations.indexOf('subjectConflict') >= 0,
        'expected subjectConflict on row 0');
});

test('AC 6.9: detects sameRoomRepeat when proctor reuses a room', () => {
    const state = finalize(makeMinimalFinalizableState());
    // Bob is in R1 in BOTH rows → sameRoomRepeat for both rows.
    assert.ok(state.rows[0].softViolations.indexOf('sameRoomRepeat') >= 0,
        'expected sameRoomRepeat on row 0 (Bob in R1)');
    assert.ok(state.rows[1].softViolations.indexOf('sameRoomRepeat') >= 0,
        'expected sameRoomRepeat on row 1 (Bob revisits R1)');
});

test('AC 6.9: detects amPmImbalance when guard imbalance ≥ 2', () => {
    const state = finalize(makeMinimalFinalizableState());
    // Bob has imbalance = 2 → amPmImbalance expected wherever Bob is.
    assert.ok(state.rows[0].softViolations.indexOf('amPmImbalance') >= 0,
        'expected amPmImbalance on row 0');
    assert.ok(state.rows[1].softViolations.indexOf('amPmImbalance') >= 0,
        'expected amPmImbalance on row 1');
});

test('AC 6.9: detects genderImbalance when 2+ guards share gender', () => {
    // Build a row with two same-gender guards.
    const state = makeMinimalFinalizableState();
    state.rows[0].proctor_keys = ['1000001', '1000003']; // Alice + Carol (both F)
    const finalized = finalize(state);
    assert.ok(finalized.rows[0].softViolations.indexOf('genderImbalance') >= 0,
        'expected genderImbalance on a row of 2 F guards');
});

test('AC 13.4: softViolations contain only allowed tokens', () => {
    const state = finalize(makeMinimalFinalizableState());
    for (let i = 0; i < state.rows.length; i += 1) {
        const tokens = state.rows[i].softViolations;
        for (const t of tokens) {
            assert.ok(ALLOWED_SOFT_TOKENS.indexOf(t) >= 0,
                'row ' + i + ': token ' + JSON.stringify(t) + ' not in allowed set');
        }
    }
});

test('AC 6.10: softViolations are advisory — proctor_keys remain non-null', () => {
    const state = finalize(makeMinimalFinalizableState());
    // None of the slots in our fixture were unresolved, so no nulls.
    for (let i = 0; i < state.rows.length; i += 1) {
        const r = state.rows[i];
        for (let j = 0; j < r.proctor_keys.length; j += 1) {
            // The presence of softViolations must NOT have nulled out keys.
            assert.notStrictEqual(r.proctor_keys[j], null,
                'row ' + i + ' slot ' + j + ': softViolations must not null out proctor_keys');
        }
    }
});

// ---------------------------------------------------------------------------
// AC 10.1 — JSON serializability of output
// ---------------------------------------------------------------------------

test('AC 10.1: output is JSON-serializable (no errors on stringify+parse)', () => {
    const state = finalize(makeMinimalFinalizableState());
    const out = { result: state.rows, diagnostics: state.diagnostics, algorithmVersion: 'v3' };
    let s, p;
    assert.doesNotThrow(() => { s = JSON.stringify(out); }, 'JSON.stringify must not throw');
    assert.doesNotThrow(() => { p = JSON.parse(s); }, 'JSON.parse must not throw');
    assert.deepStrictEqual(p.result.length, state.rows.length);
});

test('AC 10.1: byte-identical JSON round-trip', () => {
    const state = finalize(makeMinimalFinalizableState());
    const out = { result: state.rows, diagnostics: state.diagnostics, algorithmVersion: 'v3' };
    const s1 = JSON.stringify(out);
    const s2 = JSON.stringify(JSON.parse(s1));
    assert.strictEqual(s1, s2, 'byte-identical JSON round-trip required');
});

// ---------------------------------------------------------------------------
// AC 10.2 — fresh array references
// ---------------------------------------------------------------------------

test('AC 10.2: no two rows share the same array reference', () => {
    const state = finalize(makeMinimalFinalizableState());
    const fields = ['proctors', 'proctor_keys', 'reserves', 'reserve_keys',
                    'duty_teachers', 'softViolations'];
    for (const field of fields) {
        const seen = new Set();
        for (let i = 0; i < state.rows.length; i += 1) {
            const arr = state.rows[i][field];
            if (Array.isArray(arr)) {
                assert.ok(!seen.has(arr),
                    'rows[' + i + '].' + field + ' shares reference with another row');
                seen.add(arr);
            }
        }
    }
});

test('AC 10.2: finalize REPLACES shared arrays from upstream with fresh copies', () => {
    const state = makeMinimalFinalizableState();
    // Force a shared reference upstream (simulate a Phase 9 bug).
    const sharedReserveKeys = ['1000003'];
    state.rows[0].reserve_keys = sharedReserveKeys;
    state.rows[1].reserve_keys = sharedReserveKeys;
    const finalized = finalize(state);
    assert.notStrictEqual(finalized.rows[0].reserve_keys, finalized.rows[1].reserve_keys,
        'finalize must break upstream shared array refs');
});

test('AC 10.2: input rows are NOT mutated (purity)', () => {
    const state = makeMinimalFinalizableState();
    const beforeRows = state.rows;
    const beforeRow0 = state.rows[0];
    const beforeKeys = state.rows[0].proctor_keys;
    finalize(state);
    assert.strictEqual(state.rows, beforeRows, 'state.rows must not be replaced on input');
    assert.strictEqual(state.rows[0], beforeRow0, 'rows[0] must not be replaced on input');
    assert.strictEqual(state.rows[0].proctor_keys, beforeKeys,
        'rows[0].proctor_keys must not be replaced on input');
});

// ---------------------------------------------------------------------------
// AC 9.1 / 9.8 — diagnostics envelope
// ---------------------------------------------------------------------------

test('AC 9.1: diagnostics has algorithmVersion="v3"', () => {
    const state = finalize(makeMinimalFinalizableState());
    assert.strictEqual(state.diagnostics.algorithmVersion, 'v3');
});

test('AC 9.8: diagnostics passes JSON round-trip safety', () => {
    const state = finalize(makeMinimalFinalizableState());
    const s = JSON.stringify(state.diagnostics);
    const p = JSON.parse(s);
    const s2 = JSON.stringify(p);
    assert.strictEqual(s, s2, 'diagnostics must be byte-identical after round-trip');
});

test('AC 9.8: histogramByGuardCount reflects FINAL row state', () => {
    const state = finalize(makeMinimalFinalizableState());
    // Bob (1000002) appears 2x; Alice/Dave 1x each → {1:2, 2:1}.
    assert.deepStrictEqual(state.diagnostics.histogramByGuardCount, { '1': 2, '2': 1 });
});

// ---------------------------------------------------------------------------
// Internal helpers — direct unit checks
// ---------------------------------------------------------------------------

test('_internals.computeRowSoftViolations: empty proctor_keys → []', () => {
    const tokens = finalizeInternals.computeRowSoftViolations(
        { proctor_keys: [], room_key: 'R1', subject: 'Math' },
        { proctorByKey: {}, amPmImbalanceMap: {}, proctorRoomCounts: {} }
    );
    assert.deepStrictEqual(tokens, []);
});

test('_internals.verifyFreshRowArrays: detects shared reference', () => {
    const shared = [1, 2];
    const r = finalizeInternals.verifyFreshRowArrays([
        { proctor_keys: shared },
        { proctor_keys: shared },
    ]);
    assert.ok(r !== null);
    assert.strictEqual(r.field, 'proctor_keys');
    assert.strictEqual(r.rowIndex, 1);
    assert.strictEqual(r.otherRowIndex, 0);
});

test('_internals.verifyFreshRowArrays: returns null when all fresh', () => {
    const r = finalizeInternals.verifyFreshRowArrays([
        { proctor_keys: [], reserve_keys: [] },
        { proctor_keys: [], reserve_keys: [] },
    ]);
    assert.strictEqual(r, null);
});

test('_internals.buildProctorRoomCounts: counts (proctor, room) pairs across rows', () => {
    const counts = finalizeInternals.buildProctorRoomCounts([
        { room_key: 'R1', proctor_keys: ['A', 'B'] },
        { room_key: 'R1', proctor_keys: ['B', 'C'] },
        { room_key: 'R2', proctor_keys: ['A'] },
    ]);
    assert.strictEqual(counts.A.R1, 1);
    assert.strictEqual(counts.A.R2, 1);
    assert.strictEqual(counts.B.R1, 2);
    assert.strictEqual(counts.C.R1, 1);
});

test('_internals.resolveDisplayNames: aligns null/empty entries to ""', () => {
    const proctorsList = [
        { cin: 'A', teacher_full_name: 'Alice' },
        { cin: 'B', teacher_full_name: 'Bob' },
    ];
    const names = finalizeInternals.resolveDisplayNames(['A', null, 'B', '', 'A'], proctorsList);
    assert.deepStrictEqual(names, ['Alice', '', 'Bob', '', 'Alice']);
});

// ---------------------------------------------------------------------------
// Property tests — random inputs through the pipeline
// ---------------------------------------------------------------------------

test('property: AC 10.1 + 10.2 + 13.4 hold for 30 random inputs', () => {
    const N = 30;
    for (let s = 0; s < N; s += 1) {
        const seed = (s + 1) * 1009 + 23;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        let state;
        try {
            state = runUpToFinalize(input, {
                phase4TimeBudgetMs: 200,
                phase9TimeBudgetMs: 300,
            });
        } catch (err) {
            err.message = 'seed=' + seed + ' (pipeline): ' + err.message;
            throw err;
        }

        // AC 13.4 — every soft-violation token is in the allowed set.
        for (let ri = 0; ri < state.rows.length; ri += 1) {
            const tokens = state.rows[ri].softViolations;
            assert.ok(Array.isArray(tokens),
                'seed=' + seed + ' row ' + ri + ': softViolations must be array');
            for (const t of tokens) {
                assert.ok(ALLOWED_SOFT_TOKENS.indexOf(t) >= 0,
                    'seed=' + seed + ' row ' + ri + ': token ' + JSON.stringify(t) +
                    ' not in allowed set');
            }
        }

        // AC 10.2 — no shared array references across rows.
        const fields = ['proctors', 'proctor_keys', 'reserves', 'reserve_keys',
                        'duty_teachers', 'softViolations'];
        for (const field of fields) {
            const seen = new Set();
            for (let ri = 0; ri < state.rows.length; ri += 1) {
                const arr = state.rows[ri][field];
                if (Array.isArray(arr)) {
                    assert.ok(!seen.has(arr),
                        'seed=' + seed + ' rows[' + ri + '].' + field + ' shares ref');
                    seen.add(arr);
                }
            }
        }

        // AC 10.1 — output is JSON round-trip safe.
        const out = {
            result: state.rows,
            diagnostics: state.diagnostics,
            algorithmVersion: 'v3',
        };
        let s1, s2;
        try {
            s1 = JSON.stringify(out);
            s2 = JSON.stringify(JSON.parse(s1));
        } catch (err) {
            err.message = 'seed=' + seed + ' (JSON): ' + err.message;
            throw err;
        }
        assert.strictEqual(s1, s2, 'seed=' + seed + ': byte-identical JSON round-trip required');

        // AC 13.1 — V2 shape.
        for (let ri = 0; ri < state.rows.length; ri += 1) {
            const r = state.rows[ri];
            for (const f of REQUIRED_ROW_FIELDS) {
                assert.ok(Object.prototype.hasOwnProperty.call(r, f),
                    'seed=' + seed + ' row ' + ri + ': missing field ' + f);
            }
            // AC 13.2 / 13.3 — display arrays length-aligned with key arrays.
            assert.strictEqual(r.proctors.length, r.proctor_keys.length,
                'seed=' + seed + ' row ' + ri + ': proctors/proctor_keys length mismatch');
            assert.strictEqual(r.reserves.length, r.reserve_keys.length,
                'seed=' + seed + ' row ' + ri + ': reserves/reserve_keys length mismatch');
        }
    }
});

test('property: AC 9.1 (algorithmVersion="v3") for 30 random inputs', () => {
    for (let s = 0; s < 30; s += 1) {
        const seed = (s + 7) * 1013;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        const state = runUpToFinalize(input, {
            phase4TimeBudgetMs: 200,
            phase9TimeBudgetMs: 300,
        });
        assert.strictEqual(state.diagnostics.algorithmVersion, 'v3',
            'seed=' + seed + ': diagnostics.algorithmVersion must be "v3"');
    }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}

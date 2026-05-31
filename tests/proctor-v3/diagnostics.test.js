/**
 * Unit tests for js/algorithms/proctor-v3/diagnostics.js
 *
 * Validates: Requirements 5.10, 6.6, 7.8, 9.1, 9.2, 9.3, 9.3a, 9.3b, 9.4,
 *            9.6, 9.7, 9.8
 *
 * Run directly:   node tests/proctor-v3/diagnostics.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const {
    buildDiagnostics,
    computeHistogramByGuardCount,
    computeHistogramByPrimaryLoad,
    countDistinctProctors,
    computeZeroLoadProctors,
    computeReserveImbalances,
    computeAmPmImbalances,
    verifyJsonSerializable,
} = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'diagnostics.js'
));

const {
    createLoadState,
    addGuardLoad,
    addDutyLoad,
    addReserveLoad,
} = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'utils',
    'load-state.js'
));

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRow(sessionKey, proctorKeys, reserveKeys, dutyTeachers) {
    return {
        session_key: sessionKey,
        halfday_key: sessionKey + '|hd',
        day_key: sessionKey + '|d',
        room_key: sessionKey + '|r',
        room_name: 'Salle X',
        proctor_keys: proctorKeys || [],
        proctors: [],
        reserve_keys: reserveKeys || [],
        reserves: [],
        duty_teachers: dutyTeachers || [],
        softViolations: [],
    };
}

// ---------------------------------------------------------------------------
// computeHistogramByGuardCount
// ---------------------------------------------------------------------------

test('computeHistogramByGuardCount: empty rows → empty object', () => {
    assert.deepStrictEqual(computeHistogramByGuardCount([]), {});
    assert.deepStrictEqual(computeHistogramByGuardCount(null), {});
    assert.deepStrictEqual(computeHistogramByGuardCount(undefined), {});
});

test('computeHistogramByGuardCount: 1 proctor with 2 slots → {2:1}', () => {
    const rows = [
        makeRow('s1', ['A', 'B']),
        makeRow('s2', ['A', 'C']),
    ];
    // A appears 2 times, B once, C once → {1:2, 2:1}
    assert.deepStrictEqual(
        computeHistogramByGuardCount(rows),
        { '1': 2, '2': 1 }
    );
});

test('computeHistogramByGuardCount: nulls skipped (slot-based on present keys)', () => {
    const rows = [
        makeRow('s1', ['A', null]),
        makeRow('s2', [null, 'A']),
    ];
    // A=2, no other entries → {2:1}
    assert.deepStrictEqual(computeHistogramByGuardCount(rows), { '2': 1 });
});

test('computeHistogramByGuardCount: ignores reserve_keys and duty_teachers (AC 9.3)', () => {
    const rows = [
        makeRow('s1', ['A'], ['X', 'Y'], ['Z']),
        makeRow('s2', ['A'], ['X'], ['Z']),
    ];
    // Only A counts (twice). X, Y, Z are NOT counted.
    assert.deepStrictEqual(computeHistogramByGuardCount(rows), { '2': 1 });
});

// ---------------------------------------------------------------------------
// computeHistogramByPrimaryLoad
// ---------------------------------------------------------------------------

test('computeHistogramByPrimaryLoad: returns empty when loadState absent', () => {
    assert.deepStrictEqual(computeHistogramByPrimaryLoad(null), {});
    assert.deepStrictEqual(computeHistogramByPrimaryLoad({}), {});
});

test('computeHistogramByPrimaryLoad: counts Primary_Load = guard + duty', () => {
    const ls = createLoadState(['A', 'B', 'C']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A', 'h2', 'd1', 's2', 'مساء');
    addDutyLoad(ls, 'A', 'h3'); // Primary_Load(A) = 3

    addGuardLoad(ls, 'B', 'h1', 'd1', 's1', 'صباحا');
    addDutyLoad(ls, 'B', 'h3'); // Primary_Load(B) = 2

    addGuardLoad(ls, 'C', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'C', 'h2', 'd1', 's2', 'مساء'); // Primary_Load(C) = 2

    const hist = computeHistogramByPrimaryLoad(ls);
    assert.deepStrictEqual(hist, { '2': 2, '3': 1 });
});

test('computeHistogramByPrimaryLoad: reserveCount NOT included (AC 9.3a)', () => {
    const ls = createLoadState(['A']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1');
    // Primary_Load = 1 (guard only, reserves excluded)
    assert.deepStrictEqual(computeHistogramByPrimaryLoad(ls), { '1': 1 });
});

test('computeHistogramByPrimaryLoad: filters by classByProctorKey when provided', () => {
    const ls = createLoadState(['A', 'B', 'C']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'B', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'C', 'h1', 'd1', 's1', 'صباحا');

    const cbpk = { A: 'class_000', B: 'class_001' }; // C is excluded
    assert.deepStrictEqual(
        computeHistogramByPrimaryLoad(ls, cbpk),
        { '1': 2 } // only A and B counted
    );
});

test('computeHistogramByPrimaryLoad: zero-load proctors counted at 0', () => {
    const ls = createLoadState(['A', 'B']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    // B has Primary_Load = 0
    assert.deepStrictEqual(
        computeHistogramByPrimaryLoad(ls),
        { '0': 1, '1': 1 }
    );
});

// ---------------------------------------------------------------------------
// countDistinctProctors
// ---------------------------------------------------------------------------

test('countDistinctProctors: empty rows → 0', () => {
    assert.strictEqual(countDistinctProctors([]), 0);
    assert.strictEqual(countDistinctProctors(null), 0);
});

test('countDistinctProctors: counts union of proctor_keys, reserve_keys, duty_teachers', () => {
    const rows = [
        makeRow('s1', ['A', 'B'], ['C'], ['D']),
        makeRow('s2', ['A', 'E'], ['B'], []),
    ];
    // Union: { A, B, C, D, E } → 5
    assert.strictEqual(countDistinctProctors(rows), 5);
});

test('countDistinctProctors: nulls and empty strings ignored', () => {
    const rows = [
        makeRow('s1', ['A', null, ''], [null], []),
    ];
    assert.strictEqual(countDistinctProctors(rows), 1);
});

// ---------------------------------------------------------------------------
// computeZeroLoadProctors (AC 5.10)
// ---------------------------------------------------------------------------

test('computeZeroLoadProctors: empty when loadState/classByProctorKey absent', () => {
    assert.deepStrictEqual(computeZeroLoadProctors(null, {}), []);
    assert.deepStrictEqual(computeZeroLoadProctors({}, null), []);
});

test('computeZeroLoadProctors: returns eligible proctors with Primary_Load = 0', () => {
    const ls = createLoadState(['A', 'B', 'C']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    // B and C have Primary_Load = 0
    const cbpk = { A: 'class_000', B: 'class_001', C: 'class_001' };
    const result = computeZeroLoadProctors(ls, cbpk);
    assert.strictEqual(result.length, 2);
    assert.deepStrictEqual(
        result.map((r) => r.canonicalKey).sort(),
        ['B', 'C']
    );
    assert.strictEqual(result[0].classId, 'class_001');
});

test('computeZeroLoadProctors: defaults reason to insufficient_total_work', () => {
    const ls = createLoadState(['A']);
    const cbpk = { A: 'class_000' };
    const result = computeZeroLoadProctors(ls, cbpk);
    assert.strictEqual(result.length, 1);
    assert.strictEqual(result[0].reason, 'insufficient_total_work');
});

test('computeZeroLoadProctors: infers eligibility_constraints from class.eligibleSessions', () => {
    const ls = createLoadState(['A']);
    const cbpk = { A: 'class_000' };
    const classes = [
        { classId: 'class_000', eligibleSessions: [], dutyHalfdays: [], meGroup: null, size: 1 },
    ];
    const result = computeZeroLoadProctors(ls, cbpk, { classes: classes });
    assert.strictEqual(result[0].reason, 'eligibility_constraints');
});

test('computeZeroLoadProctors: respects reasonByKey override', () => {
    const ls = createLoadState(['A']);
    const cbpk = { A: 'class_000' };
    const result = computeZeroLoadProctors(ls, cbpk, {
        reasonByKey: { A: 'custom_reason' },
    });
    assert.strictEqual(result[0].reason, 'custom_reason');
});

test('computeZeroLoadProctors: deterministic order (sorted by canonicalKey)', () => {
    const ls = createLoadState(['Z', 'A', 'M']);
    const cbpk = { Z: 'c1', A: 'c1', M: 'c1' };
    const result = computeZeroLoadProctors(ls, cbpk);
    assert.deepStrictEqual(result.map((r) => r.canonicalKey), ['A', 'M', 'Z']);
});

// ---------------------------------------------------------------------------
// computeReserveImbalances (AC 7.8)
// ---------------------------------------------------------------------------

test('computeReserveImbalances: returns [] when no class info', () => {
    assert.deepStrictEqual(computeReserveImbalances(null, {}), []);
    assert.deepStrictEqual(computeReserveImbalances({}, null), []);
});

test('computeReserveImbalances: no entries when delta ≤ 1', () => {
    const ls = createLoadState(['A', 'B']);
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1'); // 2
    addReserveLoad(ls, 'B', 'h1', 'd1'); // 1; delta = 1, NOT reported
    const cbpk = { A: 'c1', B: 'c1' };
    assert.deepStrictEqual(computeReserveImbalances(ls, cbpk), []);
});

test('computeReserveImbalances: reports pairs where delta > 1, within same class', () => {
    const ls = createLoadState(['A', 'B', 'C']);
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1');
    addReserveLoad(ls, 'A', 'h3', 'd1'); // A=3
    // B=0
    addReserveLoad(ls, 'C', 'h1', 'd1'); // C=1, delta(A,C)=2

    const cbpk = { A: 'c1', B: 'c1', C: 'c1' };
    const out = computeReserveImbalances(ls, cbpk);
    // Pairs with delta > 1: (A,B)=3, (A,C)=2
    assert.strictEqual(out.length, 2);
    const pairKeys = out.map((p) => p.overloadedKey + '|' + p.underloadedKey);
    assert.deepStrictEqual(pairKeys, ['A|B', 'A|C']);
    assert.strictEqual(out[0].deltaCount, 3);
    assert.strictEqual(out[1].deltaCount, 2);
});

test('computeReserveImbalances: does NOT compare across classes', () => {
    const ls = createLoadState(['A', 'B']);
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1');
    addReserveLoad(ls, 'A', 'h3', 'd1'); // A=3, class_a
    // B=0, class_b
    const cbpk = { A: 'class_a', B: 'class_b' };
    assert.deepStrictEqual(computeReserveImbalances(ls, cbpk), []);
});

test('computeReserveImbalances: respects blockingReasonByPair', () => {
    const ls = createLoadState(['A', 'B']);
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1');
    addReserveLoad(ls, 'A', 'h3', 'd1');

    const cbpk = { A: 'c1', B: 'c1' };
    const out = computeReserveImbalances(ls, cbpk, {
        blockingReasonByPair: { 'A|B': 'B is exempt from all sessions' },
    });
    assert.strictEqual(out[0].blockingReason, 'B is exempt from all sessions');
});

test('computeReserveImbalances: defaults blockingReason to "unknown"', () => {
    const ls = createLoadState(['A', 'B']);
    addReserveLoad(ls, 'A', 'h1', 'd1');
    addReserveLoad(ls, 'A', 'h2', 'd1');
    addReserveLoad(ls, 'A', 'h3', 'd1');
    const cbpk = { A: 'c1', B: 'c1' };
    const out = computeReserveImbalances(ls, cbpk);
    assert.strictEqual(out[0].blockingReason, 'unknown');
});

// ---------------------------------------------------------------------------
// computeAmPmImbalances (AC 6.6)
// ---------------------------------------------------------------------------

test('computeAmPmImbalances: returns {} for empty/missing loadState', () => {
    assert.deepStrictEqual(computeAmPmImbalances(null), {});
    assert.deepStrictEqual(computeAmPmImbalances({}), {});
});

test('computeAmPmImbalances: returns |amCount - pmCount| per proctor', () => {
    const ls = createLoadState(['A', 'B', 'C']);
    // A: 3 AM, 1 PM → 2
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A', 'h2', 'd2', 's2', 'صباحا');
    addGuardLoad(ls, 'A', 'h3', 'd3', 's3', 'صباحا');
    addGuardLoad(ls, 'A', 'h4', 'd4', 's4', 'مساء');

    // B: balanced 2/2 → 0
    addGuardLoad(ls, 'B', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'B', 'h2', 'd2', 's2', 'صباحا');
    addGuardLoad(ls, 'B', 'h3', 'd3', 's3', 'مساء');
    addGuardLoad(ls, 'B', 'h4', 'd4', 's4', 'مساء');

    // C: 0/0 → 0
    const out = computeAmPmImbalances(ls);
    assert.strictEqual(out.A, 2);
    assert.strictEqual(out.B, 0);
    assert.strictEqual(out.C, 0);
});

// ---------------------------------------------------------------------------
// verifyJsonSerializable (AC 9.8)
// ---------------------------------------------------------------------------

test('verifyJsonSerializable: succeeds on plain JSON-safe objects', () => {
    const v = { a: 1, b: 'x', c: [1, 2, { d: true }] };
    const r = verifyJsonSerializable(v);
    assert.strictEqual(r.ok, true);
});

test('verifyJsonSerializable: detects circular references', () => {
    const v = { a: 1 };
    v.self = v;
    const r = verifyJsonSerializable(v);
    assert.strictEqual(r.ok, false);
    assert.ok(typeof r.error === 'string' && r.error.length > 0);
});

test('verifyJsonSerializable: tolerates undefined/function fields (they get dropped)', () => {
    // JSON.stringify drops these silently and the round-trip still matches.
    const v = { a: undefined, b: function () {}, c: 1 };
    const r = verifyJsonSerializable(v);
    assert.strictEqual(r.ok, true);
});

// ---------------------------------------------------------------------------
// buildDiagnostics — top-level integration
// ---------------------------------------------------------------------------

function makeFinalizedState() {
    const rows = [
        makeRow('s1', ['A', 'B'], ['C'], []),
        makeRow('s2', ['A', 'D'], ['B'], []),
    ];
    const ls = createLoadState(['A', 'B', 'C', 'D']);
    addGuardLoad(ls, 'A', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'B', 'h1', 'd1', 's1', 'صباحا');
    addGuardLoad(ls, 'A', 'h2', 'd1', 's2', 'مساء');
    addGuardLoad(ls, 'D', 'h2', 'd1', 's2', 'مساء');
    addReserveLoad(ls, 'C', 'h1', 'd1');
    addReserveLoad(ls, 'B', 'h2', 'd1');

    return {
        input: { randomSeed: 42 },
        rng: { seed: 42 },
        startTime: Date.now() - 1000,
        phaseDurations: { phase4: 100, phase5: 50 },
        rows: rows,
        loadState: ls,
        classByProctorKey: {
            A: 'class_000',
            B: 'class_000',
            C: 'class_000',
            D: 'class_000',
        },
        classes: [
            { classId: 'class_000', eligibleSessions: ['s1', 's2'], dutyHalfdays: [], meGroup: null, size: 4 },
        ],
        globalLowerBound: 1,
        globalUpperBound: 2,
        classBoundsByProctorKey: {
            A: { classId: 'class_000', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            B: { classId: 'class_000', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            C: { classId: 'class_000', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
            D: { classId: 'class_000', classLowerBound: 1, classUpperBound: 2, classSize: 4 },
        },
        orphanInputKeys: [{ source: 'dutyData', externalKey: 'GHOST' }],
        diagnostics: {
            warnings: [{ type: 'synthetic_rooms', level: 'L1', addedCount: 2 }],
            errors: [],
            unresolvedSlots: [],
            coverageWarnings: [],
            coverageRepairSwaps: 3,
            coverageRepairUnresolved: 0,
        },
    };
}

test('buildDiagnostics: returns object with all AC 9.2 fields', () => {
    const state = makeFinalizedState();
    const diag = buildDiagnostics(state);

    const required = [
        'algorithmVersion', 'seedUsed', 'totalDurationMs', 'phaseDurations',
        'histogramByGuardCount', 'histogramByPrimaryLoad',
        'min', 'max', 'distinctCount',
        'globalLowerBound', 'globalUpperBound', 'classBoundsByProctorKey',
        'unresolvedSlots', 'coverageWarnings',
        'coverageRepairSwaps', 'coverageRepairUnresolved',
        'orphanInputKeys', 'amPmImbalanceByProctorKey',
        'zeroLoadProctors', 'reserveImbalances',
        'warnings', 'errors',
    ];
    for (const f of required) {
        assert.ok(
            Object.prototype.hasOwnProperty.call(diag, f),
            `Required field missing: ${f}`
        );
    }
});

test('buildDiagnostics: algorithmVersion === "v3"', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    assert.strictEqual(diag.algorithmVersion, 'v3');
});

test('buildDiagnostics: seedUsed sourced from state.rng.seed when present', () => {
    const state = makeFinalizedState();
    state.rng.seed = 1234;
    const diag = buildDiagnostics(state);
    assert.strictEqual(diag.seedUsed, 1234);
});

test('buildDiagnostics: seedUsed falls back to input.randomSeed', () => {
    const state = makeFinalizedState();
    state.rng = null;
    state.input.randomSeed = 99;
    const diag = buildDiagnostics(state);
    assert.strictEqual(diag.seedUsed, 99);
});

test('buildDiagnostics: histogramByGuardCount only counts proctor_keys', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    // A=2, B=1, D=1 → {1:2, 2:1}
    assert.deepStrictEqual(diag.histogramByGuardCount, { '1': 2, '2': 1 });
});

test('buildDiagnostics: histogramByPrimaryLoad uses Primary_Load = guard + duty', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    // A=2 guards, B=1 guard, C=0 guards, D=1 guard → {0:1, 1:2, 2:1}
    assert.deepStrictEqual(
        diag.histogramByPrimaryLoad,
        { '0': 1, '1': 2, '2': 1 }
    );
});

test('buildDiagnostics: min/max derived from histogramByPrimaryLoad', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    assert.strictEqual(diag.min, 0);
    assert.strictEqual(diag.max, 2);
});

test('buildDiagnostics: distinctCount counts proctor_keys ∪ reserve_keys ∪ duty_teachers', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    // proctor_keys: A,B,A,D | reserve_keys: C,B → {A,B,C,D} = 4
    assert.strictEqual(diag.distinctCount, 4);
});

test('buildDiagnostics: warnings + errors carried through', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    assert.strictEqual(diag.warnings.length, 1);
    assert.strictEqual(diag.warnings[0].type, 'synthetic_rooms');
    assert.deepStrictEqual(diag.errors, []);
});

test('buildDiagnostics: orphanInputKeys forwarded from state', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    assert.deepStrictEqual(
        diag.orphanInputKeys,
        [{ source: 'dutyData', externalKey: 'GHOST' }]
    );
});

test('buildDiagnostics: amPmImbalanceByProctorKey computed', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    // A: 1 AM, 1 PM → 0; B: 1 AM → 1; D: 1 PM → 1; C: 0/0 → 0
    assert.strictEqual(diag.amPmImbalanceByProctorKey.A, 0);
    assert.strictEqual(diag.amPmImbalanceByProctorKey.B, 1);
    assert.strictEqual(diag.amPmImbalanceByProctorKey.D, 1);
});

test('buildDiagnostics: zeroLoadProctors records proctors at Primary_Load = 0', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    // C has 0 guards, 0 duty → zero-load
    assert.strictEqual(diag.zeroLoadProctors.length, 1);
    assert.strictEqual(diag.zeroLoadProctors[0].canonicalKey, 'C');
});

test('buildDiagnostics: coverageRepairSwaps and Unresolved forwarded', () => {
    const diag = buildDiagnostics(makeFinalizedState());
    assert.strictEqual(diag.coverageRepairSwaps, 3);
    assert.strictEqual(diag.coverageRepairUnresolved, 0);
});

test('buildDiagnostics: classBoundsByProctorKey copied (not aliased)', () => {
    const state = makeFinalizedState();
    const diag = buildDiagnostics(state);
    assert.notStrictEqual(diag.classBoundsByProctorKey, state.classBoundsByProctorKey);
    assert.deepStrictEqual(diag.classBoundsByProctorKey, state.classBoundsByProctorKey);
});

test('buildDiagnostics: arrays are fresh copies (not aliased to input)', () => {
    const state = makeFinalizedState();
    const diag = buildDiagnostics(state);
    assert.notStrictEqual(diag.warnings, state.diagnostics.warnings);
    assert.notStrictEqual(diag.errors, state.diagnostics.errors);
    assert.notStrictEqual(diag.unresolvedSlots, state.diagnostics.unresolvedSlots);
    assert.notStrictEqual(diag.orphanInputKeys, state.orphanInputKeys);
});

test('buildDiagnostics: result is JSON round-trip safe (AC 9.8)', () => {
    const state = makeFinalizedState();
    const diag = buildDiagnostics(state);
    const r = verifyJsonSerializable(diag);
    assert.strictEqual(r.ok, true, r.error);
    // No serialization-failure error should have been added.
    const hasSerErr = diag.errors.some(
        (e) => e && e.type === 'diagnostics_serialization_failure'
    );
    assert.strictEqual(hasSerErr, false);
});

test('buildDiagnostics: handles minimal state with no rows / loadState', () => {
    const diag = buildDiagnostics({ input: {} });
    assert.strictEqual(diag.algorithmVersion, 'v3');
    assert.deepStrictEqual(diag.histogramByGuardCount, {});
    assert.deepStrictEqual(diag.histogramByPrimaryLoad, {});
    assert.strictEqual(diag.min, 0);
    assert.strictEqual(diag.max, 0);
    assert.strictEqual(diag.distinctCount, 0);
    assert.deepStrictEqual(diag.zeroLoadProctors, []);
    assert.deepStrictEqual(diag.reserveImbalances, []);
});

test('buildDiagnostics: throws TypeError when state is null/undefined/non-object', () => {
    assert.throws(() => buildDiagnostics(null), TypeError);
    assert.throws(() => buildDiagnostics(undefined), TypeError);
    assert.throws(() => buildDiagnostics(42), TypeError);
    assert.throws(() => buildDiagnostics([]), TypeError);
});

test('buildDiagnostics: forwards preCheck fields when present', () => {
    const state = makeFinalizedState();
    state.diagnostics.preCheckRequired = true;
    state.diagnostics.preCheckUnresolvedCount = 5;
    state.diagnostics.preCheckRelaxedUnresolvedCount = 0;
    const diag = buildDiagnostics(state);
    assert.strictEqual(diag.preCheckRequired, true);
    assert.strictEqual(diag.preCheckUnresolvedCount, 5);
    assert.strictEqual(diag.preCheckRelaxedUnresolvedCount, 0);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}

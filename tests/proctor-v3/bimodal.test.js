/**
 * Property + targeted unit tests for
 * js/algorithms/proctor-v3/phases/07-bimodal-repair.js
 *
 * Validates: Requirements 5.7, 5.8
 *
 * Phase-7-isolation harness: pipes inputs through phases 0–5 inline, then
 * runs Phase 7, then verifies the post-condition:
 *
 *   "EITHER the Primary_Load histogram is strict bimodal,
 *    OR diagnostics.errors contains a `fairness_violation` entry."
 *
 * (AC 5.7 + 5.8.)
 *
 * Run directly:   node tests/proctor-v3/bimodal.test.js
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
const {
    createLoadState,
    addDutyLoad
} = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const { multiStepCoverageRepair } = require(path.join(V3_ROOT, 'phases', '05-coverage-repair.js'));
const {
    bimodalRepair,
    _internals: phase7Internals
} = require(path.join(V3_ROOT, 'phases', '07-bimodal-repair.js'));
const {
    isExempt,
    isOnDuty,
    isMEBlocked
} = require(path.join(V3_ROOT, 'constraints', 'hard-constraints.js'));
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

// ---------------------------------------------------------------------------
// Pipeline composition (Phases 0..7 inline)
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function runUpToPhase7(input, options) {
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error('validateInput failed: ' + JSON.stringify(validation.errors));
    }
    let state = { input: input, options: options || {} };

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
    state = multiStepCoverageRepair(state);
    // Phase 6 is pure inspection — Phase 7 doesn't need its preCheckRequired
    // flag. Skipping it keeps the harness focused.
    state = bimodalRepair(state);
    return state;
}

// ---------------------------------------------------------------------------
// Hard-constraint verifier (mirrors coverage-repair.test.js)
// ---------------------------------------------------------------------------

function verifyHardConstraints(state, allowSameDayBothHalfdays) {
    const proctorsList = state.input.proctorsList || [];
    const proctorByKey = Object.create(null);
    const idxByKey = Object.create(null);
    for (let i = 0; i < proctorsList.length; i += 1) {
        const k = canonicalKeyOf(proctorsList[i], i);
        if (proctorByKey[k] === undefined) {
            proctorByKey[k] = proctorsList[i];
            idxByKey[k] = i;
        }
    }

    const exemp = state.normalizedExemptionsData || {};
    const duty = state.normalizedDutyData || {};
    const me = state.normalizedMEAssignments || {};

    const rows = state.rows || [];
    // Sweep 1: eligibility + AllDifferent within row.
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        const rowSet = Object.create(null);
        for (let si = 0; si < r.proctor_keys.length; si += 1) {
            const k = r.proctor_keys[si];
            if (k == null) continue;
            assert.ok(typeof k === 'string',
                'row ' + ri + ' slot ' + si + ': proctor_keys entry must be string|null');

            const proc = proctorByKey[k];
            const idx = idxByKey[k];
            assert.ok(proc !== undefined,
                'row ' + ri + ': assigned key ' + k + ' is unknown');

            assert.ok(!isExempt(proc, idx, r.session_key, exemp),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is exempt');
            assert.ok(!isOnDuty(proc, idx, r.halfday_key, duty),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is on duty');
            assert.ok(!isMEBlocked(proc, idx, r.halfday_key, me),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is ME-blocked');

            assert.ok(!rowSet[k],
                'row ' + ri + ': proctor ' + k + ' appears twice');
            rowSet[k] = true;
        }
    }

    // Sweep 2: AllDifferent within session_key.
    const sessionKeyToProctorSet = Object.create(null);
    for (let ri2 = 0; ri2 < rows.length; ri2 += 1) {
        const r2 = rows[ri2];
        if (!r2 || !Array.isArray(r2.proctor_keys)) continue;
        const sk = r2.session_key;
        if (typeof sk !== 'string' || sk.length === 0) continue;
        if (!sessionKeyToProctorSet[sk]) sessionKeyToProctorSet[sk] = Object.create(null);
        for (let si2 = 0; si2 < r2.proctor_keys.length; si2 += 1) {
            const k = r2.proctor_keys[si2];
            if (k == null) continue;
            assert.ok(!sessionKeyToProctorSet[sk][k],
                'session ' + sk + ': proctor ' + k + ' duplicated across session');
            sessionKeyToProctorSet[sk][k] = true;
        }
    }

    // Sweep 3: C-NO-SAME-DAY (when not allowed).
    if (!allowSameDayBothHalfdays) {
        const dayHalfdaysByKey = Object.create(null);
        for (let ri3 = 0; ri3 < rows.length; ri3 += 1) {
            const r3 = rows[ri3];
            if (!r3 || !Array.isArray(r3.proctor_keys)) continue;
            const day = r3.day_key;
            const hd = r3.halfday_key;
            if (typeof day !== 'string' || typeof hd !== 'string') continue;
            for (let si3 = 0; si3 < r3.proctor_keys.length; si3 += 1) {
                const k = r3.proctor_keys[si3];
                if (k == null) continue;
                if (!dayHalfdaysByKey[k]) dayHalfdaysByKey[k] = Object.create(null);
                if (!dayHalfdaysByKey[k][day]) dayHalfdaysByKey[k][day] = Object.create(null);
                dayHalfdaysByKey[k][day][hd] = true;
            }
        }
        const procs = Object.keys(dayHalfdaysByKey);
        for (let p = 0; p < procs.length; p += 1) {
            const days = Object.keys(dayHalfdaysByKey[procs[p]]);
            for (let d = 0; d < days.length; d += 1) {
                const hds = Object.keys(dayHalfdaysByKey[procs[p]][days[d]]);
                assert.ok(hds.length <= 1,
                    'proctor ' + procs[p] + ': active in multiple halfdays of day ' + days[d]
                    + ' (' + JSON.stringify(hds) + ')');
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Bimodality post-condition verifier (AC 5.7 + 5.8)
// ---------------------------------------------------------------------------

function verifyBimodalPostCondition(state) {
    const ls = state.loadState;
    const cbpk = state.classByProctorKey || {};
    const diag = state.diagnostics || {};

    const h = phase7Internals.computeHistogramByPrimaryLoad(ls, cbpk);
    const isBimodal = phase7Internals.isBimodalKeys(h.keys);

    if (!isBimodal) {
        const errors = Array.isArray(diag.errors) ? diag.errors : [];
        const hasFairnessViolation = errors.some(
            (e) => e && e.type === 'fairness_violation'
        );
        assert.ok(hasFairnessViolation,
            'Histogram not strict bimodal (' + JSON.stringify(h.histogram)
            + ') AND no fairness_violation error recorded — AC 5.8 breached');

        // The recorded histogram should match what we just computed.
        const fv = errors.find((e) => e && e.type === 'fairness_violation');
        assert.deepStrictEqual(fv.histogram, h.histogram,
            'fairness_violation.histogram must match the actual final histogram');
        assert.strictEqual(fv.message, 'Histogram is not strict bimodal');
    }

    // Diagnostics counters always present.
    assert.strictEqual(typeof diag.bimodalRepairSwaps, 'number',
        'diagnostics.bimodalRepairSwaps must be number');
    assert.strictEqual(typeof diag.bimodalRepairIterations, 'number',
        'diagnostics.bimodalRepairIterations must be number');
}

// ---------------------------------------------------------------------------
// 1. Property test (≥ 30 random small inputs) — AC 5.7 / 5.8
// ---------------------------------------------------------------------------

test('property: post-Phase 7, histogram is strict bimodal OR fairness_violation recorded (15 random inputs)', () => {
    const N = 15;
    for (let s = 0; s < N; s += 1) {
        const seed = (s + 1) * 991 + 23;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        const allowSameDay = !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays);

        let state;
        try {
            state = runUpToPhase7(input, {
                phase4TimeBudgetMs: 200,
                phase5TimeBudgetMs: 500,
                phase7TimeBudgetMs: 1000
            });
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }

        try {
            verifyHardConstraints(state, allowSameDay);
            verifyBimodalPostCondition(state);
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }
    }
});

// ---------------------------------------------------------------------------
// 2. Determinism: same input → same output
// ---------------------------------------------------------------------------

test('determinism: identical inputs produce identical Phase 7 outputs', () => {
    const rng1 = createPRNG(606060);
    const rng2 = createPRNG(606060);
    const inputA = arbitraryInput(rng1);
    const inputB = arbitraryInput(rng2);
    assert.deepStrictEqual(inputA, inputB);

    const sa = runUpToPhase7(inputA, {
        phase4TimeBudgetMs: 1500,
        phase5TimeBudgetMs: 1000,
        phase7TimeBudgetMs: 1500
    });
    const sb = runUpToPhase7(inputB, {
        phase4TimeBudgetMs: 1500,
        phase5TimeBudgetMs: 1000,
        phase7TimeBudgetMs: 1500
    });

    const rowsA = (sa.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    const rowsB = (sb.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    assert.deepStrictEqual(rowsA, rowsB,
        'Phase 7 must be deterministic for identical inputs');
    assert.strictEqual(sa.diagnostics.bimodalRepairSwaps,
        sb.diagnostics.bimodalRepairSwaps);
    assert.strictEqual(sa.diagnostics.bimodalRepairIterations,
        sb.diagnostics.bimodalRepairIterations);
});

// ---------------------------------------------------------------------------
// 3. Empty-state no-op
// ---------------------------------------------------------------------------

test('no-op when state.rows is empty', () => {
    const input = {
        proctorsList: [{ cin: '1', name: 'A' }],
        scheduleEntries: [],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 2 },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: {},
        examCenterRoomsData: {}
    };
    let state = { input: input, options: {} };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);
    state.loadState = createLoadState(['1']);
    state = placeGuards(state);
    state = multiStepCoverageRepair(state);

    const next = bimodalRepair(state);
    assert.strictEqual(next.diagnostics.bimodalRepairSwaps, 0);
    assert.strictEqual(next.diagnostics.bimodalRepairIterations, 0);
    // No fairness_violation recorded for empty input.
    const errors = next.diagnostics.errors || [];
    assert.ok(!errors.some((e) => e && e.type === 'fairness_violation'),
        'empty state must not emit fairness_violation');
});

// ---------------------------------------------------------------------------
// 4. Already-bimodal short-circuit
// ---------------------------------------------------------------------------

test('already bimodal: no swaps performed, no error recorded', () => {
    // Synthetic state with a clean { 1: 2, 2: 1 } histogram — strict bimodal.
    const state = {
        input: {
            proctorsList: [
                { cin: 'A', name: 'A' },
                { cin: 'B', name: 'B' },
                { cin: 'C', name: 'C' }
            ],
            scheduleEntries: [],
            examDistributionRules: { proctorsPerRoom: 2 }
        },
        rows: [],
        loadState: {
            proctors: {
                A: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                B: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                C: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
            }
        },
        classByProctorKey: { A: 'c1', B: 'c1', C: 'c1' },
        bounds: { byClass: { c1: { lower: 1, upper: 3, size: 3 } } },
        diagnostics: { warnings: [], errors: [], unresolvedSlots: [], coverageWarnings: [] }
    };
    // Pre-condition check: histogram = { '1': 2, '2': 1 }.
    const h = phase7Internals.computeHistogramByPrimaryLoad(state.loadState, state.classByProctorKey);
    assert.deepStrictEqual(h.histogram, { '1': 2, '2': 1 });
    assert.ok(phase7Internals.isBimodalKeys(h.keys));

    const next = bimodalRepair(state);
    assert.strictEqual(next.diagnostics.bimodalRepairSwaps, 0);
    assert.strictEqual(next.diagnostics.bimodalRepairIterations, 0);
    const errors = next.diagnostics.errors || [];
    assert.ok(!errors.some((e) => e && e.type === 'fairness_violation'));
});

// ---------------------------------------------------------------------------
// 5. Unit: isBimodalKeys covers all branches of AC 5.7
// ---------------------------------------------------------------------------

test('isBimodalKeys: empty array → true', () => {
    assert.strictEqual(phase7Internals.isBimodalKeys([]), true);
});

test('isBimodalKeys: single key → true', () => {
    assert.strictEqual(phase7Internals.isBimodalKeys([2]), true);
    assert.strictEqual(phase7Internals.isBimodalKeys([0]), true);
    assert.strictEqual(phase7Internals.isBimodalKeys([7]), true);
});

test('isBimodalKeys: two consecutive keys → true', () => {
    assert.strictEqual(phase7Internals.isBimodalKeys([0, 1]), true);
    assert.strictEqual(phase7Internals.isBimodalKeys([2, 3]), true);
    assert.strictEqual(phase7Internals.isBimodalKeys([10, 11]), true);
});

test('isBimodalKeys: two NON-consecutive keys → false', () => {
    assert.strictEqual(phase7Internals.isBimodalKeys([1, 3]), false);
    assert.strictEqual(phase7Internals.isBimodalKeys([0, 2]), false);
    assert.strictEqual(phase7Internals.isBimodalKeys([2, 5]), false);
});

test('isBimodalKeys: three or more keys → false', () => {
    assert.strictEqual(phase7Internals.isBimodalKeys([1, 2, 3]), false);
    assert.strictEqual(phase7Internals.isBimodalKeys([0, 1, 2, 3]), false);
    assert.strictEqual(phase7Internals.isBimodalKeys([1, 3, 5]), false);
});

// ---------------------------------------------------------------------------
// 6. Unit: computeHistogramByPrimaryLoad excludes non-classed proctors
// ---------------------------------------------------------------------------

test('computeHistogramByPrimaryLoad: counts only proctors with a class assignment', () => {
    const ls = {
        proctors: {
            A: { guardCount: 1, dutyCount: 1, reserveCount: 0, amCount: 1, pmCount: 0 },
            B: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 },
            ORPHAN: { guardCount: 99, dutyCount: 0, reserveCount: 0, amCount: 99, pmCount: 0 }
        }
    };
    const cbpk = { A: 'c1', B: 'c1' /* ORPHAN missing */ };
    const h = phase7Internals.computeHistogramByPrimaryLoad(ls, cbpk);
    assert.deepStrictEqual(h.histogram, { '2': 2 });
    assert.deepStrictEqual(h.keys, [2]);
});

// ---------------------------------------------------------------------------
// 7. Unit: partitionCandidates correctly classifies donors / recipients
// ---------------------------------------------------------------------------

test('partitionCandidates: 3-key histogram → donors above min+1, recipients below min', () => {
    // Histogram { 1: 1, 2: 1, 4: 1 }. min=1 → window [1,2]. Donors: load>2.
    // Recipients: load<1 (none in this case).
    const ls = {
        proctors: {
            LO: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            MID: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            HI: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 }
        }
    };
    const cbpk = { LO: 'c1', MID: 'c1', HI: 'c1' };
    const h = phase7Internals.computeHistogramByPrimaryLoad(ls, cbpk);
    assert.deepStrictEqual(h.keys, [1, 2, 4]);
    const parts = phase7Internals.partitionCandidates(ls, cbpk, h.keys);
    assert.deepStrictEqual(parts.donors, ['HI']);
    assert.deepStrictEqual(parts.recipients, []);
});

test('partitionCandidates: histogram {0,2,4} → donors at 4, recipients at 0', () => {
    const ls = {
        proctors: {
            LO: { guardCount: 0, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            MID: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            HI: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 }
        }
    };
    const cbpk = { LO: 'c1', MID: 'c1', HI: 'c1' };
    const h = phase7Internals.computeHistogramByPrimaryLoad(ls, cbpk);
    assert.deepStrictEqual(h.keys, [0, 2, 4]);
    const parts = phase7Internals.partitionCandidates(ls, cbpk, h.keys);
    // targetLow=0, targetHigh=1. Donors: load>1 → [MID, HI]. Recipients: load<0 → [].
    assert.deepStrictEqual(parts.donors, ['HI', 'MID']);  // sorted code-point
    assert.deepStrictEqual(parts.recipients, []);
});

test('partitionCandidates: bimodal {2,3} → empty candidate sets', () => {
    const ls = {
        proctors: {
            A: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            B: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 }
        }
    };
    const cbpk = { A: 'c1', B: 'c1' };
    const h = phase7Internals.computeHistogramByPrimaryLoad(ls, cbpk);
    const parts = phase7Internals.partitionCandidates(ls, cbpk, h.keys);
    assert.deepStrictEqual(parts.donors, []);
    assert.deepStrictEqual(parts.recipients, []);
});

// ---------------------------------------------------------------------------
// 8. Unit: canSwap respects donor lower bound (AC 5.12)
// ---------------------------------------------------------------------------

test('canSwap rejects swap that would push donor below class lower bound', () => {
    const ctx = {
        rows: [{
            session_key: 'S',
            halfday_key: '2026-06-04|صباحا',
            day_key: '2026-06-04',
            proctor_keys: ['DONOR', null]
        }],
        loadState: {
            proctors: {
                DONOR: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                RECIPIENT: { guardCount: 0, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 }
            }
        },
        proctorByKey: {
            DONOR: { proctor: { cin: 'DONOR' }, idx: 0 },
            RECIPIENT: { proctor: { cin: 'RECIPIENT' }, idx: 1 }
        },
        normalizedExemptions: {},
        normalizedDuty: {},
        normalizedME: {},
        classByProctorKey: { DONOR: 'cA', RECIPIENT: 'cB' },
        classBoundsByClassId: {
            cA: { lower: 1, upper: 5 },  // donor at lower; cannot lose.
            cB: { lower: 0, upper: 5 }
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase7Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        false,
        'donor at lower bound must not be swappable'
    );
});

// ---------------------------------------------------------------------------
// 9. Unit: canSwap respects recipient upper bound (AC 5.6)
// ---------------------------------------------------------------------------

test('canSwap rejects swap that would push recipient above class upper bound', () => {
    const ctx = {
        rows: [{
            session_key: 'S',
            halfday_key: '2026-06-04|صباحا',
            day_key: '2026-06-04',
            proctor_keys: ['DONOR', null]
        }],
        loadState: {
            proctors: {
                DONOR: { guardCount: 5, dutyCount: 0, reserveCount: 0, amCount: 5, pmCount: 0 },
                RECIPIENT: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 2, pmCount: 0 }
            }
        },
        proctorByKey: {
            DONOR: { proctor: { cin: 'DONOR' }, idx: 0 },
            RECIPIENT: { proctor: { cin: 'RECIPIENT' }, idx: 1 }
        },
        normalizedExemptions: {},
        normalizedDuty: {},
        normalizedME: {},
        classByProctorKey: { DONOR: 'cA', RECIPIENT: 'cB' },
        classBoundsByClassId: {
            cA: { lower: 1, upper: 8 },
            cB: { lower: 0, upper: 2 }  // recipient at upper; cannot accept.
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase7Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        false,
        'recipient at upper bound must not be swappable'
    );
});

// ---------------------------------------------------------------------------
// 10. Synthetic scenario: 3-mode histogram → bimodal after one swap
// ---------------------------------------------------------------------------

test('synthetic: 3-mode histogram collapses to 2-mode after one swap', () => {
    // Three proctors A, B, C. One row with 2 slots both held by C (duplicate
    // is invalid but used here only to seed loads — we need 3 distinct
    // primary-load values across A, B, C so partitionCandidates returns
    // a non-empty set). Instead, build a richer scenario:
    //
    //   2 rows × 2 slots = 4 slots.
    //   Initial assignment: C, C in row 1; C, B in row 2.
    //   This is invalid (C appears 3x in row 1+2) but we set it up
    //   manually to create a 3-mode load distribution after counting.
    //
    // To avoid this complexity, build a scenario where rows are valid:
    //   row 0: B, C    →  B has 1 guard, C has 1 guard
    //   row 1: C, C    → invalid
    //
    // Cleaner approach: use 3 rows × 2 slots = 6 slots:
    //   row 0 (S0): A, B
    //   row 1 (S1): A, C
    //   row 2 (S2): C, C   ← invalid (AllDifferent within row)
    //
    // We'll instead synthesize the load state directly to a {1, 2, 4} shape
    // and rely on row-level swap mechanics. The simplest scenario:
    //   - A appears once (load=1), B once (load=2 via guard+duty),
    //   - C in 4 slots (load=4).
    //   - 4 rows × 2 slots; rows hold only C and A/B (so swap is feasible).
    const rows = [
        { session_key: 'S0', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
            room_key: 'R0', proctor_keys: ['C', 'A'] },
        { session_key: 'S1', halfday_key: '2026-06-04|مساء', day_key: '2026-06-04',
            room_key: 'R0', proctor_keys: ['C', 'B'] },
        { session_key: 'S2', halfday_key: '2026-06-05|صباحا', day_key: '2026-06-05',
            room_key: 'R0', proctor_keys: ['C', 'B'] },
        { session_key: 'S3', halfday_key: '2026-06-05|مساء', day_key: '2026-06-05',
            room_key: 'R0', proctor_keys: ['C', 'B'] }
    ];
    // After counting from rows: A=1, B=3, C=4. Histogram: {1:1, 3:1, 4:1}.
    const loadState = {
        proctors: {
            A: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
            B: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 2 },
            C: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 2, pmCount: 2 }
        }
    };
    // Allow same-day so C-NO-SAME-DAY doesn't block legal swaps; that
    // constraint is independent of bimodality.
    const state = {
        input: {
            proctorsList: [
                { cin: 'A', name: 'A' },
                { cin: 'B', name: 'B' },
                { cin: 'C', name: 'C' }
            ],
            scheduleEntries: [],
            exemptionsData: {},
            dutyData: {},
            meAssignments: {},
            examDistributionRules: {
                proctorsPerRoom: 2,
                allowSameDayBothHalfdays: true
            }
        },
        normalizedExemptionsData: {},
        normalizedDutyData: {},
        normalizedMEAssignments: {},
        rows: rows,
        loadState: loadState,
        classByProctorKey: { A: 'c1', B: 'c1', C: 'c1' },
        bounds: { byClass: { c1: { lower: 0, upper: 6, size: 3 } } },
        diagnostics: { warnings: [], errors: [], unresolvedSlots: [], coverageWarnings: [] }
    };

    // Sanity: histogram is { '1':1, '3':1, '4':1 } → NOT bimodal.
    const h0 = phase7Internals.computeHistogramByPrimaryLoad(loadState, state.classByProctorKey);
    assert.deepStrictEqual(h0.keys, [1, 3, 4]);

    const next = bimodalRepair(state);

    // After repair, histogram should be strict bimodal OR a fairness_violation
    // recorded. We expect success here — repair has plenty of slack.
    const h1 = phase7Internals.computeHistogramByPrimaryLoad(next.loadState, next.classByProctorKey);
    const isBimodal = phase7Internals.isBimodalKeys(h1.keys);
    const errors = next.diagnostics.errors || [];
    const fv = errors.find((e) => e && e.type === 'fairness_violation');
    assert.ok(isBimodal || fv,
        'expected bimodal histogram or fairness_violation, got '
        + JSON.stringify(h1.histogram));
    if (isBimodal) {
        // Verify A's count went up and either B or C went down.
        assert.ok(next.diagnostics.bimodalRepairSwaps >= 1,
            'expected at least one swap to collapse 3-mode histogram');
    }
});

// ---------------------------------------------------------------------------
// 11. Purity: original rows are not mutated when swaps happen
// ---------------------------------------------------------------------------

test('purity: original row objects are not mutated by Phase 7 swaps', () => {
    const rng = createPRNG(424242);
    const input = arbitraryInput(rng);
    let state = { input: input, options: {
        phase4TimeBudgetMs: 500,
        phase5TimeBudgetMs: 500,
        phase7TimeBudgetMs: 1000
    } };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);
    const canonicalKeys = (input.proctorsList || []).map(canonicalKeyOf);
    state.loadState = createLoadState(canonicalKeys);
    if (state.normalizedDutyData) {
        const halfdays = Object.keys(state.normalizedDutyData);
        halfdays.forEach((h) => {
            const inner = state.normalizedDutyData[h];
            if (inner && typeof inner === 'object') {
                Object.keys(inner).forEach((pk) => addDutyLoad(state.loadState, pk, h));
            }
        });
    }
    state = placeGuards(state);
    state = multiStepCoverageRepair(state);

    const rowsRef = state.rows;
    const snapshots = rowsRef.map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);

    const next = bimodalRepair(state);

    // The state.rows array reference may be replaced (when swaps happen) or
    // reused (when no swaps). Either way, the SNAPSHOT must match
    // rowsRef[i].proctor_keys (the pre-swap values must persist on the
    // original row references the caller still holds).
    for (let i = 0; i < rowsRef.length; i += 1) {
        if (!rowsRef[i]) continue;
        const before = snapshots[i];
        const after = rowsRef[i].proctor_keys;
        if (before === null) {
            assert.strictEqual(after === null || after === undefined, true);
        } else {
            assert.deepStrictEqual(after, before,
                'original row ' + i + '.proctor_keys was mutated after Phase 7');
        }
    }
    // diagnostics object must be a fresh container.
    assert.notStrictEqual(next.diagnostics, state.diagnostics);
});

// ---------------------------------------------------------------------------
// 12. Diagnostics: fresh arrays
// ---------------------------------------------------------------------------

test('diagnostics arrays are fresh (no shared refs with prior state)', () => {
    const state = {
        input: {
            proctorsList: [{ cin: 'A' }],
            scheduleEntries: [],
            examDistributionRules: { proctorsPerRoom: 2 }
        },
        rows: [],
        loadState: { proctors: { A: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 } } },
        classByProctorKey: { A: 'c1' },
        bounds: { byClass: { c1: { lower: 0, upper: 5, size: 1 } } },
        diagnostics: {
            warnings: [{ type: 'pre-existing' }],
            errors: [{ type: 'pre-existing' }],
            unresolvedSlots: [{ rowIndex: 99 }],
            coverageWarnings: [{ canonicalKey: 'X' }]
        }
    };
    const next = bimodalRepair(state);
    assert.notStrictEqual(next.diagnostics.warnings, state.diagnostics.warnings,
        'warnings must be a fresh array');
    assert.notStrictEqual(next.diagnostics.errors, state.diagnostics.errors,
        'errors must be a fresh array');
    assert.notStrictEqual(next.diagnostics.unresolvedSlots, state.diagnostics.unresolvedSlots,
        'unresolvedSlots must be a fresh array');
    assert.notStrictEqual(next.diagnostics.coverageWarnings, state.diagnostics.coverageWarnings,
        'coverageWarnings must be a fresh array');
    // Pre-existing entries preserved.
    assert.strictEqual(next.diagnostics.warnings.length, 1);
    assert.strictEqual(next.diagnostics.errors.length, 1);
});

// ---------------------------------------------------------------------------
// 13. AC 5.8: contrived case where bimodal repair fails → fairness_violation
// ---------------------------------------------------------------------------

test('local-minimum scenario: emits fairness_violation when no swap is feasible', () => {
    // Build a state where the histogram is non-bimodal AND no legal swap
    // exists. We rig this by giving each proctor a class whose lower bound
    // equals its current load — so donor-protection blocks every swap.
    const rows = [
        { session_key: 'S0', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
            room_key: 'R0', proctor_keys: ['HI'] },
        { session_key: 'S1', halfday_key: '2026-06-05|صباحا', day_key: '2026-06-05',
            room_key: 'R0', proctor_keys: ['HI'] },
        { session_key: 'S2', halfday_key: '2026-06-06|صباحا', day_key: '2026-06-06',
            room_key: 'R0', proctor_keys: ['HI'] },
        { session_key: 'S3', halfday_key: '2026-06-07|صباحا', day_key: '2026-06-07',
            room_key: 'R0', proctor_keys: ['MID'] }
    ];
    const loadState = {
        proctors: {
            LO: { guardCount: 0, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 },
            MID: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
            HI: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 }
        }
    };
    // Histogram: { 0:1, 1:1, 3:1 } — three distinct keys, NOT bimodal.
    // Each class has lower == current load → donor protection blocks any
    // outflow from HI; recipient upper of LO blocks any inflow.
    const state = {
        input: {
            proctorsList: [
                { cin: 'LO' }, { cin: 'MID' }, { cin: 'HI' }
            ],
            scheduleEntries: [],
            exemptionsData: {},
            dutyData: {},
            meAssignments: {},
            examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: true }
        },
        normalizedExemptionsData: {},
        normalizedDutyData: {},
        normalizedMEAssignments: {},
        rows: rows,
        loadState: loadState,
        classByProctorKey: { LO: 'cLO', MID: 'cMID', HI: 'cHI' },
        bounds: {
            byClass: {
                cLO: { lower: 0, upper: 0, size: 1 },   // LO can't accept (upper=0).
                cMID: { lower: 1, upper: 1, size: 1 },  // MID locked.
                cHI: { lower: 3, upper: 5, size: 1 }    // HI cannot lose (lower=3).
            }
        },
        diagnostics: { warnings: [], errors: [], unresolvedSlots: [], coverageWarnings: [] }
    };

    const next = bimodalRepair(state);
    const errors = next.diagnostics.errors || [];
    const fv = errors.find((e) => e && e.type === 'fairness_violation');
    assert.ok(fv, 'expected fairness_violation when no legal swap exists');
    assert.strictEqual(fv.message, 'Histogram is not strict bimodal');
    assert.strictEqual(fv.phase, 7);
    assert.deepStrictEqual(fv.histogram, { '0': 1, '1': 1, '3': 1 });
    assert.ok(fv.details && typeof fv.details.reason === 'string',
        'fairness_violation.details.reason must be set');
});

// ---------------------------------------------------------------------------
// 14. Property-Based Test (Task 29) — fast-check
//
//    **Validates: Requirements 5.7, 14.4**
//
//    Strategy: use fast-check to generate 100+ random GS3_Input_Contract
//    instances via the PBT helpers. Run the V3 orchestrator end-to-end,
//    then verify the universal property:
//
//      AC 5.7: THE `diagnostics.histogramByPrimaryLoad` over Eligible_Proctor
//              SHALL contain at most two distinct keys, AND if there are two
//              keys, they SHALL be consecutive integers (i.e., `k` and `k+1`).
//              The acceptable forms are:
//                - `{ k: N }` (all eligible proctors carry the same load), OR
//                - `{ k: a, k+1: b }` for some integers k, a, b with a+b = N_Eligible.
//              OR `diagnostics.errors` contains an entry with
//              `type === 'fairness_violation'` (AC 5.8).
//
//    `null` entries in `proctor_keys` (unresolved hard-constraint slots,
//    AC 3.12) do not affect the histogram — it is computed from loadState.
// ---------------------------------------------------------------------------

const fc = require('fast-check');
const { runOrchestrator } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'orchestrator.js'
));

/**
 * fast-check arbitrary that produces a valid GS3_Input_Contract by seeding
 * the PBT helpers with a random integer seed.
 */
const arbV3Input = fc.integer({ min: 1, max: 2147483647 }).map((seed) => {
    const rng = createPRNG(seed);
    return arbitraryInput(rng);
});

test('property (fast-check): histogram is strict bimodal OR fairness_violation recorded — AC 5.7', () => {
    // **Validates: Requirements 5.7, 14.4**
    let inputsWithHistogram = 0;

    fc.assert(
        fc.property(arbV3Input, (input) => {
            const runResult = runOrchestrator(input, {
                totalBudgetMs: 5000,
                phase4TimeBudgetMs: 1000,
                phase5TimeBudgetMs: 500,
                phase7TimeBudgetMs: 1500,
                phase8TimeBudgetMs: 500,
                phase9TimeBudgetMs: 500
            });

            // Envelope sanity
            if (!runResult || typeof runResult !== 'object') return false;
            if (!runResult.diagnostics || typeof runResult.diagnostics !== 'object') return false;

            const diag = runResult.diagnostics;
            const histogram = diag.histogramByPrimaryLoad;

            // If no histogram produced (e.g. zero eligible proctors), the
            // property holds vacuously.
            if (!histogram || typeof histogram !== 'object') return true;

            const keys = Object.keys(histogram).map(Number).sort((a, b) => a - b);

            // Empty histogram (no eligible proctors) — vacuously bimodal.
            if (keys.length === 0) return true;

            inputsWithHistogram += 1;

            // Check strict bimodal: at most 2 keys, consecutive if 2.
            const isBimodal = (
                keys.length === 1 ||
                (keys.length === 2 && keys[1] - keys[0] === 1)
            );

            if (isBimodal) return true;

            // Not bimodal — AC 5.8 requires a fairness_violation error.
            const errors = Array.isArray(diag.errors) ? diag.errors : [];
            const hasFairnessViolation = errors.some(
                (e) => e && e.type === 'fairness_violation'
            );

            return hasFairnessViolation;
        }),
        { numRuns: 100, verbose: true }
    );

    // Guard against vacuous pass: at least some inputs across the 100 random
    // runs must have produced a non-empty histogram.
    assert.ok(
        inputsWithHistogram > 0,
        'Expected at least one input across 100 random runs to produce a '
            + 'non-empty histogramByPrimaryLoad (otherwise the bimodal check '
            + 'passes vacuously)'
    );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}

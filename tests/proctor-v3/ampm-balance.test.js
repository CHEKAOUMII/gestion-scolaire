/**
 * Property + targeted unit tests for
 * js/algorithms/proctor-v3/phases/08-ampm-balance.js
 *
 * Validates: Requirements 6.4, 6.5, 6.6
 *
 * Post-condition (AC 6.5 — best-effort): post-Phase 8, the AVERAGE
 * AM_PM_Imbalance across eligible proctors should be LESS THAN OR EQUAL
 * to the pre-Phase 8 average. (Phase 8 is local-search; we never WORSEN
 * balance.)
 *
 * Run directly:   node tests/proctor-v3/ampm-balance.test.js
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
    addDutyLoad,
    amCount,
    pmCount
} = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const { multiStepCoverageRepair } = require(path.join(V3_ROOT, 'phases', '05-coverage-repair.js'));
const { bimodalRepair } = require(path.join(V3_ROOT, 'phases', '07-bimodal-repair.js'));
const {
    ampmBalance,
    _internals: phase8Internals
} = require(path.join(V3_ROOT, 'phases', '08-ampm-balance.js'));
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
// Pipeline composition (Phases 0..7, then Phase 8)
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
    state = bimodalRepair(state);
    return state;
}

// ---------------------------------------------------------------------------
// Verifiers
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

function averageImbalance(loadState, classByProctorKey) {
    if (!loadState || !loadState.proctors) return 0;
    const cbpk = classByProctorKey || {};
    const keys = Object.keys(loadState.proctors).sort();
    let total = 0;
    let n = 0;
    for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const classId = cbpk[k];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        total += Math.abs(amCount(loadState, k) - pmCount(loadState, k));
        n += 1;
    }
    return n === 0 ? 0 : total / n;
}

function totalGuardSlotsByKey(rows) {
    const counts = Object.create(null);
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        for (let si = 0; si < r.proctor_keys.length; si += 1) {
            const k = r.proctor_keys[si];
            if (typeof k !== 'string' || k.length === 0) continue;
            counts[k] = (counts[k] || 0) + 1;
        }
    }
    return counts;
}

// ---------------------------------------------------------------------------
// 1. Property test: average imbalance does not increase
// ---------------------------------------------------------------------------

test('property: post-Phase 8, average AM/PM imbalance ≤ pre-Phase 8 average (30 random inputs)', () => {
    const N = 30;
    for (let s = 0; s < N; s += 1) {
        const seed = (s + 1) * 3001 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        const allowSameDay = !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays);

        let preState;
        try {
            preState = runUpToPhase7(input, {
                phase4TimeBudgetMs: 200,
                phase5TimeBudgetMs: 500,
                phase7TimeBudgetMs: 500
            });
        } catch (err) {
            err.message = 'seed=' + seed + ' (pre): ' + err.message;
            throw err;
        }

        const preAvg = averageImbalance(preState.loadState, preState.classByProctorKey);
        const preGuardCounts = totalGuardSlotsByKey(preState.rows || []);

        const postState = ampmBalance(Object.assign({}, preState, {
            options: { phase8TimeBudgetMs: 1000 }
        }));

        const postAvg = averageImbalance(postState.loadState, postState.classByProctorKey);

        try {
            // AC 6.5 best-effort: average MUST NOT increase.
            assert.ok(postAvg <= preAvg + 1e-9,
                'average imbalance grew: pre=' + preAvg + ' post=' + postAvg);

            // AC 3.x: hard constraints still satisfied after Phase 8.
            verifyHardConstraints(postState, allowSameDay);

            // Primary_Load preservation: each proctor's total guard slot
            // count is unchanged (Phase 8 must not alter Primary_Load).
            const postGuardCounts = totalGuardSlotsByKey(postState.rows || []);
            const allKeys = new Set();
            Object.keys(preGuardCounts).forEach((k) => allKeys.add(k));
            Object.keys(postGuardCounts).forEach((k) => allKeys.add(k));
            allKeys.forEach((k) => {
                assert.strictEqual(preGuardCounts[k] || 0, postGuardCounts[k] || 0,
                    'guard count for ' + k + ' changed: pre=' + (preGuardCounts[k] || 0)
                    + ' post=' + (postGuardCounts[k] || 0));
            });

            // AC 6.6: amPmImbalanceByProctorKey diagnostic populated.
            const diag = postState.diagnostics || {};
            assert.ok(diag.amPmImbalanceByProctorKey && typeof diag.amPmImbalanceByProctorKey === 'object',
                'diagnostics.amPmImbalanceByProctorKey must be a plain object');
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }
    }
});

// ---------------------------------------------------------------------------
// 2. Determinism: same input → same output
// ---------------------------------------------------------------------------

test('determinism: identical inputs produce identical Phase 8 outputs', () => {
    const rng1 = createPRNG(808080);
    const rng2 = createPRNG(808080);
    const inputA = arbitraryInput(rng1);
    const inputB = arbitraryInput(rng2);
    assert.deepStrictEqual(inputA, inputB);

    const sa = runUpToPhase7(inputA, {
        phase4TimeBudgetMs: 800,
        phase5TimeBudgetMs: 500,
        phase7TimeBudgetMs: 500
    });
    const sb = runUpToPhase7(inputB, {
        phase4TimeBudgetMs: 800,
        phase5TimeBudgetMs: 500,
        phase7TimeBudgetMs: 500
    });

    const ra = ampmBalance(Object.assign({}, sa, { options: { phase8TimeBudgetMs: 1000 } }));
    const rb = ampmBalance(Object.assign({}, sb, { options: { phase8TimeBudgetMs: 1000 } }));

    const rowsA = (ra.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    const rowsB = (rb.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    assert.deepStrictEqual(rowsA, rowsB,
        'Phase 8 must be deterministic for identical inputs');
    assert.strictEqual(ra.diagnostics.ampmBalanceExchanges,
        rb.diagnostics.ampmBalanceExchanges);
    assert.strictEqual(ra.diagnostics.ampmBalanceIterations,
        rb.diagnostics.ampmBalanceIterations);
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

    const next = ampmBalance(state);
    assert.strictEqual(next.diagnostics.ampmBalanceExchanges, 0);
    assert.strictEqual(next.diagnostics.ampmBalanceIterations, 0);
    assert.deepStrictEqual(next.diagnostics.amPmImbalanceByProctorKey, { '1': 0 });
});

// ---------------------------------------------------------------------------
// 4. Already-balanced short-circuit
// ---------------------------------------------------------------------------

test('already balanced: no exchanges performed', () => {
    const state = {
        input: {
            proctorsList: [
                { cin: 'A', name: 'A' },
                { cin: 'B', name: 'B' }
            ],
            scheduleEntries: [],
            examDistributionRules: { proctorsPerRoom: 2 }
        },
        rows: [
            { session_key: 'S0', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
                room_key: 'R0', proctor_keys: ['A', 'B'] },
            { session_key: 'S1', halfday_key: '2026-06-04|مساء', day_key: '2026-06-04',
                room_key: 'R0', proctor_keys: ['A', 'B'] }
        ],
        loadState: {
            proctors: {
                A: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 },
                B: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
            }
        },
        normalizedExemptionsData: {},
        normalizedDutyData: {},
        normalizedMEAssignments: {},
        classByProctorKey: { A: 'c1', B: 'c1' },
        bounds: { byClass: { c1: { lower: 2, upper: 2, size: 2 } } },
        diagnostics: { warnings: [], errors: [], unresolvedSlots: [], coverageWarnings: [] }
    };
    const next = ampmBalance(state);
    assert.strictEqual(next.diagnostics.ampmBalanceExchanges, 0);
    assert.strictEqual(next.diagnostics.ampmBalanceIterations, 0);
    assert.deepStrictEqual(next.diagnostics.amPmImbalanceByProctorKey, { A: 0, B: 0 });
});

// ---------------------------------------------------------------------------
// 5. Synthetic exchange: 2-proctor swap reduces imbalance
// ---------------------------------------------------------------------------

test('synthetic: AM-heavy X swaps with PM-heavy Y across complementary rows', () => {
    // Setup: 2 proctors A, B. 2 rows, both with 2 slots. A holds both
    // morning slots → AM=2, PM=0 → imbalance 2. B holds both afternoon
    // slots → AM=0, PM=2 → imbalance 2. After exchange: each holds one
    // AM and one PM → imbalance 0.
    //
    // Wait — both rows have 2 slots, and we need each row to hold both A
    // and B (since AllDifferent within row). So initial setup must be
    // A,B in row1 (AM) and A,B in row2 (PM) — but then both already have
    // amCount=1, pmCount=1, no imbalance.
    //
    // To create an imbalance we need DIFFERENT proctors in rows. Let's
    // use 4 proctors:
    //   row 1 (AM): A, X
    //   row 2 (AM): A, Y
    //   row 3 (PM): B, X
    //   row 4 (PM): B, Y
    //
    // Counts: A=2 AM, B=2 PM, X=1 AM + 1 PM, Y=1 AM + 1 PM.
    // → A imbalance 2, B imbalance 2, X & Y balanced.
    //
    // Exchange A in row 1 with B in row 3 (or any AM row of A with any PM row of B).
    //
    // First attempt (rejected): both rows in the same session would
    // duplicate A across rooms of S1, violating AC 3.6. Use 4 distinct
    // sessions across two days instead — see `rows2` below.
    const rows2 = [
        // AM halfday — two sessions (different days to be safe), each one room.
        { session_key: 'S1', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
            room_key: 'R1', proctor_keys: ['A', 'X'] },
        { session_key: 'S2', halfday_key: '2026-06-05|صباحا', day_key: '2026-06-05',
            room_key: 'R1', proctor_keys: ['A', 'Y'] },
        // PM halfday — same days, afternoon session.
        { session_key: 'S3', halfday_key: '2026-06-04|مساء', day_key: '2026-06-04',
            room_key: 'R1', proctor_keys: ['B', 'X'] },
        { session_key: 'S4', halfday_key: '2026-06-05|مساء', day_key: '2026-06-05',
            room_key: 'R1', proctor_keys: ['B', 'Y'] }
    ];

    // With allowSameDayBothHalfdays = true, X and Y can hold AM+PM of same day.
    const state = {
        input: {
            proctorsList: [
                { cin: 'A', name: 'A' },
                { cin: 'B', name: 'B' },
                { cin: 'X', name: 'X' },
                { cin: 'Y', name: 'Y' }
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
        rows: rows2,
        loadState: {
            proctors: {
                A: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 2, pmCount: 0 },
                B: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 2 },
                X: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 },
                Y: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
            }
        },
        classByProctorKey: { A: 'c1', B: 'c1', X: 'c1', Y: 'c1' },
        bounds: { byClass: { c1: { lower: 2, upper: 2, size: 4 } } },
        diagnostics: { warnings: [], errors: [], unresolvedSlots: [], coverageWarnings: [] }
    };

    const before = phase8Internals.computeAmPmImbalanceMap(state.loadState);
    assert.deepStrictEqual(before, { A: 2, B: 2, X: 0, Y: 0 });

    const next = ampmBalance(state);

    const after = next.diagnostics.amPmImbalanceByProctorKey;
    // Expect at least one exchange to have happened.
    assert.ok(next.diagnostics.ampmBalanceExchanges >= 1,
        'expected at least one exchange, got ' + next.diagnostics.ampmBalanceExchanges);
    // After one exchange: one of A's AM slots becomes PM, and one of B's
    // PM slots becomes AM. → A: 1 AM, 1 PM (imbalance 0); B: 1 AM, 1 PM
    // (imbalance 0). Total imbalance drops from 4 to 0.
    assert.strictEqual(after.A, 0, 'A should be balanced');
    assert.strictEqual(after.B, 0, 'B should be balanced');

    // Guard counts unchanged.
    assert.strictEqual(next.loadState.proctors.A.guardCount, 2);
    assert.strictEqual(next.loadState.proctors.B.guardCount, 2);
});

// ---------------------------------------------------------------------------
// 6. Unit: imbalanceOf / imbalanceSignOf
// ---------------------------------------------------------------------------

test('imbalanceOf: AM > PM returns positive magnitude', () => {
    const ls = { proctors: { K: { guardCount: 5, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 } } };
    assert.strictEqual(phase8Internals.imbalanceOf(ls, 'K'), 3);
});

test('imbalanceOf: missing entry returns 0', () => {
    const ls = { proctors: {} };
    assert.strictEqual(phase8Internals.imbalanceOf(ls, 'NOPE'), 0);
});

test('imbalanceSignOf: returns +1 for AM-heavy, -1 for PM-heavy, 0 for balanced', () => {
    const ls = {
        proctors: {
            AM: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 },
            PM: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 3 },
            BAL: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
        }
    };
    assert.strictEqual(phase8Internals.imbalanceSignOf(ls, 'AM'), 1);
    assert.strictEqual(phase8Internals.imbalanceSignOf(ls, 'PM'), -1);
    assert.strictEqual(phase8Internals.imbalanceSignOf(ls, 'BAL'), 0);
});

// ---------------------------------------------------------------------------
// 7. Unit: exchangeDelta sign
// ---------------------------------------------------------------------------

test('exchangeDelta: AM-heavy X exchanges with PM-heavy Y → negative delta', () => {
    const ctx = {
        loadState: {
            proctors: {
                X: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 4, pmCount: 0 },
                Y: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 4 }
            }
        }
    };
    const delta = phase8Internals.exchangeDelta(ctx, 'X', 'Y', 'صباحا', 'مساء');
    // Pre: |4-0| + |0-4| = 8. Post (X loses AM, gains PM; Y loses PM, gains AM):
    // X: AM=3, PM=1, imbalance 2. Y: AM=1, PM=3, imbalance 2. Total 4.
    // Delta = 4 - 8 = -4.
    assert.strictEqual(delta, -4);
});

test('exchangeDelta: both already balanced → 0 or positive (no improvement)', () => {
    const ctx = {
        loadState: {
            proctors: {
                X: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 },
                Y: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
            }
        }
    };
    const delta = phase8Internals.exchangeDelta(ctx, 'X', 'Y', 'صباحا', 'مساء');
    // Pre: 0 + 0 = 0. Post: X: AM=0, PM=2, imbalance 2. Y: AM=2, PM=0, imbalance 2. Total 4.
    // Delta = +4. Phase 8 must reject this exchange.
    assert.strictEqual(delta, 4);
});

// ---------------------------------------------------------------------------
// 8. Unit: canExchange respects eligibility
// ---------------------------------------------------------------------------

test('canExchange: rejects when target row exempts incoming proctor', () => {
    const ctx = {
        rows: [
            { session_key: 'S1', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
                proctor_keys: ['A', 'X'] },
            { session_key: 'S2', halfday_key: '2026-06-04|مساء', day_key: '2026-06-04',
                proctor_keys: ['B', 'Y'] }
        ],
        loadState: {
            proctors: {
                A: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                B: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 1 },
                X: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                Y: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 1 }
            }
        },
        proctorByKey: {
            A: { proctor: { cin: 'A' }, idx: 0 },
            B: { proctor: { cin: 'B' }, idx: 1 },
            X: { proctor: { cin: 'X' }, idx: 2 },
            Y: { proctor: { cin: 'Y' }, idx: 3 }
        },
        normalizedExemptions: { S2: { A: 'no' } },  // A exempt from S2.
        normalizedDuty: {},
        normalizedME: {}
    };
    // Try: A in row 0 ↔ B in row 1. A is exempt from S2 → reject.
    assert.strictEqual(
        phase8Internals.canExchange(ctx, 0, 0, 'A', 1, 0, 'B'),
        false
    );
});

test('canExchange: accepts a clean cross-period exchange', () => {
    const ctx = {
        rows: [
            { session_key: 'S1', halfday_key: '2026-06-04|صباحا', day_key: '2026-06-04',
                proctor_keys: ['A', 'X'] },
            { session_key: 'S2', halfday_key: '2026-06-05|مساء', day_key: '2026-06-05',
                proctor_keys: ['B', 'Y'] }
        ],
        loadState: {
            proctors: {
                A: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                B: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 1 },
                X: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 },
                Y: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 1 }
            }
        },
        proctorByKey: {
            A: { proctor: { cin: 'A' }, idx: 0 },
            B: { proctor: { cin: 'B' }, idx: 1 },
            X: { proctor: { cin: 'X' }, idx: 2 },
            Y: { proctor: { cin: 'Y' }, idx: 3 }
        },
        normalizedExemptions: {},
        normalizedDuty: {},
        normalizedME: {}
    };
    assert.strictEqual(
        phase8Internals.canExchange(ctx, 0, 0, 'A', 1, 0, 'B'),
        true
    );
});

// ---------------------------------------------------------------------------
// 9. Unit: computeAmPmImbalanceMap returns sorted plain object
// ---------------------------------------------------------------------------

test('computeAmPmImbalanceMap: produces { canonicalKey: imbalance } for every entry', () => {
    const ls = {
        proctors: {
            Z: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 2, pmCount: 1 },
            A: { guardCount: 4, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 4 },
            M: { guardCount: 2, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 1 }
        }
    };
    const out = phase8Internals.computeAmPmImbalanceMap(ls);
    assert.deepStrictEqual(out, { A: 4, M: 0, Z: 1 });
});

// ---------------------------------------------------------------------------
// 10. Purity: original rows are not mutated when exchanges happen
// ---------------------------------------------------------------------------

test('purity: original row objects are not mutated by Phase 8 exchanges', () => {
    const rng = createPRNG(909090);
    const input = arbitraryInput(rng);
    const state = runUpToPhase7(input, {
        phase4TimeBudgetMs: 500,
        phase5TimeBudgetMs: 500,
        phase7TimeBudgetMs: 500
    });

    const rowsRef = state.rows;
    const snapshots = rowsRef.map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);

    const next = ampmBalance(Object.assign({}, state, {
        options: { phase8TimeBudgetMs: 500 }
    }));

    // The state.rows array reference may be replaced (when exchanges
    // happen) or reused (when no exchanges). Either way, the SNAPSHOT
    // must match rowsRef[i].proctor_keys.
    for (let i = 0; i < rowsRef.length; i += 1) {
        if (!rowsRef[i]) continue;
        const before = snapshots[i];
        const after = rowsRef[i].proctor_keys;
        if (before === null) {
            assert.strictEqual(after === null || after === undefined, true);
        } else {
            assert.deepStrictEqual(after, before,
                'original row ' + i + '.proctor_keys was mutated');
        }
    }

    // And next.rows holds the (possibly updated) keys without sharing
    // references with rowsRef when an exchange happened.
    if (next.diagnostics.ampmBalanceExchanges > 0) {
        // At least one row's array reference must differ.
        let anyDiff = false;
        for (let i = 0; i < rowsRef.length; i += 1) {
            if (rowsRef[i] && next.rows[i]
                && rowsRef[i].proctor_keys !== next.rows[i].proctor_keys) {
                anyDiff = true;
                break;
            }
        }
        assert.ok(anyDiff, 'at least one row.proctor_keys must be a fresh array after exchanges');
    }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n----');
console.log(`passed: ${passed}, failed: ${failed}`);
if (failed > 0) {
    process.exit(1);
}

/**
 * Property-based + targeted unit tests for
 * js/algorithms/proctor-v3/phases/05-coverage-repair.js
 *
 * Validates: Requirements 5.10, 5.11, 5.12, 5.13
 *
 * Phase-5-isolation harness: pipes inputs through phases 0–4 inline, then
 * runs Phase 5, then verifies the post-condition:
 *   "for every uncovered proctor, either Primary_Load now ≥
 *    Class_Lower_Bound, OR an entry exists in
 *    diagnostics.coverageWarnings recording the unresolved case."
 *
 * Run directly:   node tests/proctor-v3/coverage-repair.test.js
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
    primaryLoad
} = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const {
    multiStepCoverageRepair,
    _internals: phase5Internals
} = require(path.join(V3_ROOT, 'phases', '05-coverage-repair.js'));
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
// Pipeline composition (Phases 0..5 inline)
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function runUpToPhase5(input, options) {
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
    return state;
}

// ---------------------------------------------------------------------------
// Hard-constraint verifier (reused shape from place-guards.test.js)
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
// Post-condition verifier specific to Phase 5
// ---------------------------------------------------------------------------

/**
 * For every proctor, verify that EITHER
 *   - Primary_Load(T) ≥ classLowerBound(T), OR
 *   - state.diagnostics.coverageWarnings contains an entry for T.
 *
 * Also verifies AC 5.12: every entry in coverageWarnings has finalLoad
 * < classLowerBound (otherwise it should not be there).
 */
function verifyCoveragePostCondition(state) {
    const ls = state.loadState;
    const cbpk = state.classByProctorKey || {};
    const byClass = (state.bounds && state.bounds.byClass) || {};
    const diag = state.diagnostics || {};
    const coverageWarnings = Array.isArray(diag.coverageWarnings) ? diag.coverageWarnings : [];

    const warningKeys = Object.create(null);
    for (let i = 0; i < coverageWarnings.length; i += 1) {
        const w = coverageWarnings[i];
        assert.ok(w && typeof w === 'object', 'coverageWarnings[i] must be object');
        assert.strictEqual(typeof w.canonicalKey, 'string',
            'coverageWarning.canonicalKey must be string');
        assert.strictEqual(typeof w.classLowerBound, 'number',
            'coverageWarning.classLowerBound must be number');
        assert.strictEqual(typeof w.initialLoad, 'number',
            'coverageWarning.initialLoad must be number');
        assert.strictEqual(typeof w.finalLoad, 'number',
            'coverageWarning.finalLoad must be number');
        assert.strictEqual(typeof w.attemptedSwaps, 'number',
            'coverageWarning.attemptedSwaps must be number');
        assert.ok(['no_eligible_donor', 'time_budget'].indexOf(w.reason) !== -1,
            'coverageWarning.reason must be no_eligible_donor|time_budget; got ' + w.reason);
        // The warning must reflect a genuinely unresolved case.
        assert.ok(w.finalLoad < w.classLowerBound,
            'coverageWarning recorded but finalLoad ≥ classLowerBound: ' + JSON.stringify(w));
        warningKeys[w.canonicalKey] = true;
    }

    // For every proctor in the load state, check the coverage post-condition.
    if (!ls || !ls.proctors) return;
    const allKeys = Object.keys(ls.proctors);
    for (let k = 0; k < allKeys.length; k += 1) {
        const key = allKeys[k];
        const classId = cbpk[key];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        const b = byClass[classId];
        if (!b || typeof b.lower !== 'number') continue;
        const lower = b.lower;
        const pl = primaryLoad(ls, key);
        if (pl < lower) {
            assert.ok(warningKeys[key],
                'proctor ' + key + ': Primary_Load=' + pl + ' < ' + lower
                + ' (lower) but no coverageWarning entry exists');
        }
    }

    // Also verify the count diagnostic matches.
    assert.strictEqual(typeof diag.coverageRepairSwaps, 'number',
        'diagnostics.coverageRepairSwaps must be number');
    assert.strictEqual(typeof diag.coverageRepairUnresolved, 'number',
        'diagnostics.coverageRepairUnresolved must be number');
    assert.strictEqual(diag.coverageRepairUnresolved, coverageWarnings.length,
        'coverageRepairUnresolved must equal coverageWarnings.length');
}

// ---------------------------------------------------------------------------
// 1. Property test (≥ 30 random small inputs)
// ---------------------------------------------------------------------------

test('property: post-Phase 5, every proctor reaches lower bound OR is in coverageWarnings (30 random inputs)', () => {
    const N = 30;
    for (let s = 0; s < N; s += 1) {
        const seed = (s + 1) * 1009 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        const allowSameDay = !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays);

        let state;
        try {
            state = runUpToPhase5(input, {
                phase4TimeBudgetMs: 200,
                phase5TimeBudgetMs: 1000
            });
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }

        try {
            verifyHardConstraints(state, allowSameDay);
            verifyCoveragePostCondition(state);
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }
    }
});

// ---------------------------------------------------------------------------
// 2. Determinism: same input → same output
// ---------------------------------------------------------------------------

test('determinism: identical inputs produce identical Phase 5 outputs', () => {
    const rng1 = createPRNG(909090);
    const rng2 = createPRNG(909090);
    const inputA = arbitraryInput(rng1);
    const inputB = arbitraryInput(rng2);
    assert.deepStrictEqual(inputA, inputB);

    const sa = runUpToPhase5(inputA, {
        phase4TimeBudgetMs: 1500,
        phase5TimeBudgetMs: 1500
    });
    const sb = runUpToPhase5(inputB, {
        phase4TimeBudgetMs: 1500,
        phase5TimeBudgetMs: 1500
    });

    const rowsA = (sa.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    const rowsB = (sb.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    assert.deepStrictEqual(rowsA, rowsB,
        'Phase 5 must be deterministic for identical inputs');
    assert.strictEqual(sa.diagnostics.coverageRepairSwaps,
        sb.diagnostics.coverageRepairSwaps);
    assert.strictEqual(sa.diagnostics.coverageRepairUnresolved,
        sb.diagnostics.coverageRepairUnresolved);
});

// ---------------------------------------------------------------------------
// 3. Donor protection (AC 5.12)
// ---------------------------------------------------------------------------

test('donor protection (AC 5.12): no swap leaves donor below class lower bound', () => {
    // Build a small input where Phase 5 is likely to be invoked, then
    // verify that for every proctor, post-Phase-5 Primary_Load is either
    // ≥ classLowerBound OR an unresolved warning was emitted.
    // (i.e. donors are never demoted past their own lower bound.)
    const rng = createPRNG(31415);
    const input = arbitraryInput(rng);
    const state = runUpToPhase5(input, {
        phase4TimeBudgetMs: 500,
        phase5TimeBudgetMs: 1000
    });

    const ls = state.loadState;
    const cbpk = state.classByProctorKey || {};
    const byClass = (state.bounds && state.bounds.byClass) || {};
    const diag = state.diagnostics || {};
    const warningKeys = Object.create(null);
    (diag.coverageWarnings || []).forEach((w) => { warningKeys[w.canonicalKey] = true; });

    const keys = Object.keys(ls.proctors || {});
    for (let i = 0; i < keys.length; i += 1) {
        const k = keys[i];
        const classId = cbpk[k];
        if (typeof classId !== 'string' || classId.length === 0) continue;
        const b = byClass[classId];
        if (!b || typeof b.lower !== 'number') continue;
        const pl = primaryLoad(ls, k);
        // For every proctor: pl ≥ lower OR explicitly unresolved.
        assert.ok(pl >= b.lower || warningKeys[k],
            'donor protection violated: ' + k + ' has Primary_Load=' + pl
            + ' < lower=' + b.lower + ' yet no coverage warning was recorded');
    }
});

// ---------------------------------------------------------------------------
// 4. Empty-state no-op
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

    const before = JSON.parse(JSON.stringify({
        coverageRepairSwaps: state.diagnostics.coverageRepairSwaps,
        coverageRepairUnresolved: state.diagnostics.coverageRepairUnresolved
    }));
    const next = multiStepCoverageRepair(state);
    assert.strictEqual(next.diagnostics.coverageRepairSwaps, 0);
    assert.strictEqual(next.diagnostics.coverageRepairUnresolved, 0);
    assert.deepStrictEqual(next.rows, state.rows,
        'rows must be unchanged when there is no work');
    assert.notStrictEqual(typeof before, 'undefined');
});

// ---------------------------------------------------------------------------
// 5. Purity: original rows are not mutated when swaps happen
// ---------------------------------------------------------------------------

test('purity: original row objects are not mutated by Phase 5 swaps', () => {
    const rng = createPRNG(271828);
    const input = arbitraryInput(rng);
    let state = { input: input, options: { phase4TimeBudgetMs: 500, phase5TimeBudgetMs: 1000 } };
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

    // Snapshot proctor_keys arrays of EVERY row after Phase 4.
    const rowsRef = state.rows;
    const snapshots = rowsRef.map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);

    const next = multiStepCoverageRepair(state);

    // The state.rows array reference should have been REPLACED.
    assert.notStrictEqual(next.rows, rowsRef,
        'state.rows array reference must be replaced');
    // Original rows array must still hold the pre-swap proctor_keys.
    for (let i = 0; i < rowsRef.length; i += 1) {
        if (!rowsRef[i]) continue;
        const before = snapshots[i];
        const after = rowsRef[i].proctor_keys;
        if (before === null) {
            assert.strictEqual(after === null || after === undefined, true);
        } else {
            assert.deepStrictEqual(after, before,
                'original row ' + i + '.proctor_keys was mutated after Phase 5');
        }
    }
});

// ---------------------------------------------------------------------------
// 6. Internal canSwap — donor protection white-box check
// ---------------------------------------------------------------------------

test('canSwap rejects swap that would push donor below lower bound', () => {
    // Construct a tiny synthetic ctx in which donor's primaryLoad equals
    // donor's class lower bound — any swap-out should be rejected.
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
            cA: { lower: 1, upper: 2 },  // Donor at lower bound; cannot lose work.
            cB: { lower: 0, upper: 5 }
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase5Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        false,
        'donor at lower bound must not be swappable'
    );
});

test('canSwap accepts swap when donor has slack above lower bound', () => {
    const ctx = {
        rows: [{
            session_key: 'S',
            halfday_key: '2026-06-04|صباحا',
            day_key: '2026-06-04',
            proctor_keys: ['DONOR', null]
        }],
        loadState: {
            proctors: {
                DONOR: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 },
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
            cA: { lower: 1, upper: 5 },  // Donor has slack: 3 > 1.
            cB: { lower: 1, upper: 5 }
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase5Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        true,
        'donor with slack above lower bound must be swappable'
    );
});

test('canSwap rejects when recipient already in row', () => {
    const ctx = {
        rows: [{
            session_key: 'S',
            halfday_key: '2026-06-04|صباحا',
            day_key: '2026-06-04',
            proctor_keys: ['DONOR', 'RECIPIENT']
        }],
        loadState: {
            proctors: {
                DONOR: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 },
                RECIPIENT: { guardCount: 1, dutyCount: 0, reserveCount: 0, amCount: 1, pmCount: 0 }
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
            cA: { lower: 1, upper: 5 },
            cB: { lower: 1, upper: 5 }
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase5Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        false,
        'recipient already present in same row must block the swap'
    );
});

test('canSwap rejects when recipient is exempt for the session', () => {
    const ctx = {
        rows: [{
            session_key: 'S1',
            halfday_key: '2026-06-04|صباحا',
            day_key: '2026-06-04',
            proctor_keys: ['DONOR', null]
        }],
        loadState: {
            proctors: {
                DONOR: { guardCount: 3, dutyCount: 0, reserveCount: 0, amCount: 3, pmCount: 0 },
                RECIPIENT: { guardCount: 0, dutyCount: 0, reserveCount: 0, amCount: 0, pmCount: 0 }
            }
        },
        proctorByKey: {
            DONOR: { proctor: { cin: 'DONOR' }, idx: 0 },
            RECIPIENT: { proctor: { cin: 'RECIPIENT' }, idx: 1 }
        },
        normalizedExemptions: { S1: { RECIPIENT: 'no' } },
        normalizedDuty: {},
        normalizedME: {},
        classByProctorKey: { DONOR: 'cA', RECIPIENT: 'cB' },
        classBoundsByClassId: {
            cA: { lower: 1, upper: 5 },
            cB: { lower: 1, upper: 5 }
        },
        allowSameDay: false
    };
    assert.strictEqual(
        phase5Internals.canSwap(ctx, 0, 0, 'DONOR', 'RECIPIENT'),
        false,
        'exempt recipient must block the swap'
    );
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}

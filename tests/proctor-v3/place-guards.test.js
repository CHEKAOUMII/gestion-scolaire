/**
 * Property-based + targeted unit tests for
 * js/algorithms/proctor-v3/phases/04-place-guards.js
 *
 * Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.10, 5.6,
 *            5.9, 6.1, 6.4, 6.7, 6.8
 *
 * This is a Phase-4-isolation test: it composes the upstream phases
 * (validate → normalizeKeys → buildRoomsAndRows → deriveEligibilityClasses
 *  → computeBounds → createLoadState) inline rather than going through an
 * orchestrator (which does not yet exist).
 *
 * Run directly:   node tests/proctor-v3/place-guards.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { createPRNG } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'utils', 'prng.js'
));
const { validateInput } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '00-validate.js'
));
const { normalizeKeys } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '01-normalize-keys.js'
));
const { buildRoomsAndRows } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '01b-build-rooms-and-rows.js'
));
const { deriveEligibilityClasses } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '02-eligibility-classes.js'
));
const { computeBounds } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '03-bounds.js'
));
const { createLoadState, addDutyLoad } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'utils', 'load-state.js'
));
const { placeGuards } = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'phases', '04-place-guards.js'
));
const {
    isExempt,
    isOnDuty,
    isMEBlocked
} = require(path.join(
    __dirname, '..', '..', 'js', 'algorithms', 'proctor-v3', 'constraints', 'hard-constraints.js'
));
const {
    arbitraryInput
} = require(path.join(__dirname, 'pbt-helpers.js'));

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
// Pipeline composition (Phase 4 isolation harness)
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

/**
 * Run phases 0..4 inline against `input` and return the final state.
 * Throws if Phase 0 validation fails (the PBT generator is supposed to
 * produce valid inputs, so a failure here indicates a generator bug).
 */
function runUpToPhase4(input, options) {
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error('validateInput failed: ' + JSON.stringify(validation.errors));
    }
    let state = { input: input, options: options || {} };

    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    // Initialize load state with all canonical proctor keys, then seed
    // duty counts from normalizedDutyData so Phase 4's upper-bound
    // propagator sees Primary_Load = guard + duty correctly.
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

    return placeGuards(state);
}

// ---------------------------------------------------------------------------
// Hard-constraint verifier
// ---------------------------------------------------------------------------

/**
 * Verify all post-Phase-4 hard constraints on `state`. Throws on first
 * violation. Returns silently on full success.
 */
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

    // Sweep 1: every assigned key satisfies eligibility predicates AND
    // AllDifferent within row.
    const rows = state.rows || [];
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r || !Array.isArray(r.proctor_keys)) continue;
        const rowSet = Object.create(null);
        for (let si = 0; si < r.proctor_keys.length; si += 1) {
            const k = r.proctor_keys[si];
            if (k == null) continue;
            assert.ok(typeof k === 'string',
                'row ' + ri + ' slot ' + si + ': proctor_keys entry must be string|null, got ' + (typeof k));

            const proc = proctorByKey[k];
            const idx = idxByKey[k];
            assert.ok(proc !== undefined,
                'row ' + ri + ': assigned key ' + k + ' is not a known canonical proctor key');

            assert.ok(!isExempt(proc, idx, r.session_key, exemp),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is exempt for session ' + r.session_key);
            assert.ok(!isOnDuty(proc, idx, r.halfday_key, duty),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is on duty for halfday ' + r.halfday_key);
            assert.ok(!isMEBlocked(proc, idx, r.halfday_key, me),
                'row ' + ri + ' slot ' + si + ': proctor ' + k + ' is ME-blocked for halfday ' + r.halfday_key);

            assert.ok(!rowSet[k],
                'row ' + ri + ': proctor ' + k + ' appears more than once in proctor_keys');
            rowSet[k] = true;
        }
    }

    // Sweep 2: AllDifferent within session_key (across rows).
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
                'session ' + sk + ': proctor ' + k + ' appears in more than one slot across the session');
            sessionKeyToProctorSet[sk][k] = true;
        }
    }

    // Sweep 3: C-NO-SAME-DAY (when not allowed).
    if (!allowSameDayBothHalfdays) {
        // For each canonical key, collect (dayKey, halfdayKey) pairs across
        // assigned slots; flag if same day with different halfdays.
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
                    + ' (' + JSON.stringify(hds) + ') with allowSameDayBothHalfdays=false');
            }
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Property test: hard constraints on ≥ 30 random small inputs
// ---------------------------------------------------------------------------

test('property: post-Phase 4 every assigned key satisfies all hard constraints (30 random inputs)', () => {
    const N = 30;
    let casesWithAtLeastOneAssignment = 0;
    for (let s = 0; s < N; s += 1) {
        const rng = createPRNG((s + 1) * 1009 + 17);
        const input = arbitraryInput(rng);
        const allowSameDay = !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays);

        const state = runUpToPhase4(input, { phase4TimeBudgetMs: 200 });

        // Verify hard constraints. We use try/catch so a single failure
        // gets reported with seed context for reproduction.
        try {
            verifyHardConstraints(state, allowSameDay);
        } catch (err) {
            err.message = 'seed=' + (s + 1) * 1009 + 17 + ': ' + err.message;
            throw err;
        }

        // Track that at least one input produced at least one filled slot
        // (to ensure the harness isn't trivially passing with all-null).
        const rows = state.rows || [];
        for (let r = 0; r < rows.length; r += 1) {
            if (rows[r] && Array.isArray(rows[r].proctor_keys)) {
                for (let i = 0; i < rows[r].proctor_keys.length; i += 1) {
                    if (rows[r].proctor_keys[i] != null) {
                        casesWithAtLeastOneAssignment += 1;
                        r = rows.length;
                        break;
                    }
                }
            }
        }
    }
    assert.ok(casesWithAtLeastOneAssignment > 0,
        'Expected at least one of ' + N + ' random inputs to produce at least one guard assignment');
});

// ---------------------------------------------------------------------------
// 2. Determinism unit test
// ---------------------------------------------------------------------------

test('determinism: same input → identical proctor_keys assignments', () => {
    const rng1 = createPRNG(424242);
    const rng2 = createPRNG(424242);
    const inputA = arbitraryInput(rng1);
    const inputB = arbitraryInput(rng2);
    assert.deepStrictEqual(inputA, inputB, 'arbitraryInput is deterministic');

    const sa = runUpToPhase4(inputA, { phase4TimeBudgetMs: 1000 });
    const sb = runUpToPhase4(inputB, { phase4TimeBudgetMs: 1000 });

    const rowsA = (sa.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    const rowsB = (sb.rows || []).map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    assert.deepStrictEqual(rowsA, rowsB,
        'identical inputs must produce identical proctor_keys assignments');
});

// ---------------------------------------------------------------------------
// 3. Unresolved slots populated when feasibility is impossible
// ---------------------------------------------------------------------------

test('unresolvedSlots populated when slots far exceed eligible proctors', () => {
    // Construct a tiny, deliberately infeasible input: 2 proctors, many slots.
    const input = {
        proctorsList: [
            { cin: '1000001', name: 'A', subject: 'Math', gender: 'M' },
            { cin: '1000002', name: 'B', subject: 'Physique', gender: 'F' }
        ],
        scheduleEntries: [
            // 4 sessions on the SAME halfday so AllDifferent + same-day
            // pressures combine: 2 proctors cannot cover 4 sessions × 2 slots = 8 slots.
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math', session: 'الحصة الأولى' },
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Physique', session: 'الحصة الثانية' },
            { date: '2026-06-04', period: 'مساء', level: 'L1', subject: 'Math', session: 'الحصة الأولى' },
            { date: '2026-06-04', period: 'مساء', level: 'L1', subject: 'Physique', session: 'الحصة الثانية' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 2, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 2, sessions: 4 } },
        examCenterRoomsData: {
            L1: [
                { key: 'L1_R1', room_num: '1', roomName: 'Salle 1' },
                { key: 'L1_R2', room_num: '2', roomName: 'Salle 2' }
            ]
        }
    };

    const state = runUpToPhase4(input, { phase4TimeBudgetMs: 3000 });
    const unresolved = state.diagnostics && Array.isArray(state.diagnostics.unresolvedSlots)
        ? state.diagnostics.unresolvedSlots
        : null;
    assert.ok(unresolved !== null,
        'state.diagnostics.unresolvedSlots must be an array');
    assert.ok(unresolved.length > 0,
        'Expected unresolvedSlots to be non-empty for an infeasible input; got ' + unresolved.length);

    // Hard constraints must STILL hold for any non-null assignments that
    // were committed (the solver returns its best partial).
    verifyHardConstraints(state, false);
});

// ---------------------------------------------------------------------------
// 4. Smallest sanity check: a feasible 1-proctor 1-room 1-session input
// ---------------------------------------------------------------------------

test('feasible single-slot input: assignment fills proctor_keys[0]', () => {
    const input = {
        proctorsList: [{ cin: '9999999', name: 'Solo', subject: 'X', gender: 'M' }],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: { L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }] }
    };
    const state = runUpToPhase4(input, { phase4TimeBudgetMs: 2000 });
    assert.ok(Array.isArray(state.rows) && state.rows.length === 1);
    assert.deepStrictEqual(state.rows[0].proctor_keys, ['9999999']);
    verifyHardConstraints(state, false);
});

// ---------------------------------------------------------------------------
// 5. State purity: original state.rows is not mutated
// ---------------------------------------------------------------------------

test('purity: original rows array references are not mutated', () => {
    const rng = createPRNG(13);
    const input = arbitraryInput(rng);
    let state = { input: input, options: { phase4TimeBudgetMs: 2000 } };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const ls = createLoadState((input.proctorsList || []).map(canonicalKeyOf));
    state.loadState = ls;

    const originalRowsRef = state.rows;
    const snapshots = originalRowsRef.map((r) =>
        r && Array.isArray(r.proctor_keys) ? r.proctor_keys.slice() : null
    );

    const next = placeGuards(state);
    assert.notStrictEqual(next.rows, originalRowsRef,
        'placeGuards must replace state.rows with a new array');
    for (let i = 0; i < originalRowsRef.length; i += 1) {
        const before = snapshots[i];
        const now = originalRowsRef[i] && Array.isArray(originalRowsRef[i].proctor_keys)
            ? originalRowsRef[i].proctor_keys
            : null;
        if (before === null) {
            assert.strictEqual(now, null);
        } else {
            assert.deepStrictEqual(now, before,
                'original row ' + i + '.proctor_keys must be unchanged');
        }
    }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
    process.exit(1);
}

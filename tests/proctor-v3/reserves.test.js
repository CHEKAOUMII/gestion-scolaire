/**
 * Property-based + targeted unit tests for
 * js/algorithms/proctor-v3/phases/09-place-reserves.js
 *
 * Validates: Requirements 7.1, 7.2, 7.3, 7.4, 7.4a, 7.5, 7.6, 7.7, 7.8,
 *            7.9, 3.6, 3.7a, 10.2 (no shared array references).
 *
 * Phase-9-isolation harness: pipes inputs through phases 0–4 (skipping
 * phases 5/6/7/8 which are not strictly required for reserves placement
 * — Phase 4 already establishes guard slots, which is the only
 * pre-requisite for Phase 9). The full-orchestrator integration test is
 * deferred to Task 23.
 *
 * Run directly:   node tests/proctor-v3/reserves.test.js
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
const {
    placeReserves,
    _internals: phase9Internals
} = require(path.join(V3_ROOT, 'phases', '09-place-reserves.js'));
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
// Pipeline composition
// ---------------------------------------------------------------------------

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

function dayKeyFromHalfdayKey(halfdayKey) {
    if (typeof halfdayKey !== 'string') return '';
    var idx = halfdayKey.indexOf('|');
    if (idx === -1) return halfdayKey;
    return halfdayKey.slice(0, idx);
}

function runUpToPhase9(input, options) {
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
    state = placeReserves(state);
    return state;
}

// ---------------------------------------------------------------------------
// Verifier helpers
// ---------------------------------------------------------------------------

/**
 * Verify all post-Phase-9 reserve invariants.
 * Throws on first violation.
 */
function verifyReserveInvariants(state, allowSameDay) {
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

    // 1. Every reserve_keys entry must be a known canonical key (AC 2.5).
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r || !Array.isArray(r.reserve_keys)) continue;
        for (let i = 0; i < r.reserve_keys.length; i += 1) {
            const k = r.reserve_keys[i];
            assert.ok(typeof k === 'string' && k.length > 0,
                'row ' + ri + ': reserve_keys entry must be a non-empty string');
            assert.ok(proctorByKey[k] !== undefined,
                'row ' + ri + ': reserve key ' + k + ' is not a known canonical proctor key');
        }
    }

    // 2. AC 3.5 — within a single row, no canonical key in
    //    `proctor_keys ∪ reserve_keys` appears more than once.
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r) continue;
        const seen = Object.create(null);
        const guardKeys = Array.isArray(r.proctor_keys) ? r.proctor_keys : [];
        for (let i = 0; i < guardKeys.length; i += 1) {
            const k = guardKeys[i];
            if (typeof k !== 'string' || k.length === 0) continue;
            assert.ok(!seen[k],
                'row ' + ri + ': proctor key ' + k + ' appears twice in proctor_keys');
            seen[k] = true;
        }
        const resKeys = Array.isArray(r.reserve_keys) ? r.reserve_keys : [];
        for (let j = 0; j < resKeys.length; j += 1) {
            const k = resKeys[j];
            assert.ok(!seen[k],
                'row ' + ri + ': reserve key ' + k + ' collides with a guard or appears twice');
            seen[k] = true;
        }
    }

    // 3. AC 7.4a — across all rows of the same session, each canonical
    //    key appears at most ONCE in the union of reserve_keys.
    //    AC 3.6     — across all rows of the same session, no canonical
    //                 key in `proctor_keys ∪ reserve_keys` appears more
    //                 than once.
    const bySession = Object.create(null);
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r) continue;
        const sk = r.session_key;
        if (typeof sk !== 'string' || sk.length === 0) continue;
        if (!bySession[sk]) bySession[sk] = { rows: [], rowIndices: [] };
        bySession[sk].rows.push(r);
        bySession[sk].rowIndices.push(ri);
    }
    const sessionKeys = Object.keys(bySession);
    for (let s = 0; s < sessionKeys.length; s += 1) {
        const grp = bySession[sessionKeys[s]];
        // AC 7.4a — at-most-once across the union of reserve_keys for
        // all rows of the session.
        const reserveSeen = Object.create(null);
        const sessionUnion = Object.create(null);
        for (let g = 0; g < grp.rows.length; g += 1) {
            const r = grp.rows[g];
            const guardKeys = Array.isArray(r.proctor_keys) ? r.proctor_keys : [];
            const resKeys = Array.isArray(r.reserve_keys) ? r.reserve_keys : [];
            for (let i = 0; i < resKeys.length; i += 1) {
                const k = resKeys[i];
                assert.ok(!reserveSeen[k],
                    'session ' + sessionKeys[s] + ': reserve ' + k +
                    ' appears in multiple rows (AC 7.4a violation)');
                reserveSeen[k] = true;
            }
            for (let i = 0; i < guardKeys.length; i += 1) {
                const k = guardKeys[i];
                if (typeof k !== 'string' || k.length === 0) continue;
                if (sessionUnion[k] === 'reserve') {
                    throw new Error('session ' + sessionKeys[s] + ': proctor ' + k +
                        ' is both a guard and a reserve in this session (AC 3.6 violation)');
                }
                sessionUnion[k] = 'guard';
            }
            for (let i = 0; i < resKeys.length; i += 1) {
                const k = resKeys[i];
                if (sessionUnion[k] === 'guard') {
                    throw new Error('session ' + sessionKeys[s] + ': proctor ' + k +
                        ' is both a guard and a reserve in this session (AC 3.6 violation)');
                }
                sessionUnion[k] = 'reserve';
            }
        }
    }

    // 4. AC 7.4 eligibility filters — each reserve must satisfy
    //    isExempt/isOnDuty/isMEBlocked against the assignment.
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r || !Array.isArray(r.reserve_keys)) continue;
        for (let i = 0; i < r.reserve_keys.length; i += 1) {
            const k = r.reserve_keys[i];
            const proc = proctorByKey[k];
            const idx = idxByKey[k];
            assert.ok(!isExempt(proc, idx, r.session_key, exemp),
                'row ' + ri + ': reserve ' + k + ' is exempt for session ' + r.session_key);
            assert.ok(!isOnDuty(proc, idx, r.halfday_key, duty),
                'row ' + ri + ': reserve ' + k + ' is on duty for halfday ' + r.halfday_key);
            assert.ok(!isMEBlocked(proc, idx, r.halfday_key, me),
                'row ' + ri + ': reserve ' + k + ' is ME-blocked for halfday ' + r.halfday_key);
        }
    }

    // 5. AC 3.7a — when allowSameDay === false, no canonical key in the
    //    UNION of (proctor_keys ∪ reserve_keys) appears in two halfdays
    //    of the same day.
    if (!allowSameDay) {
        const dayHalfdaysByKey = Object.create(null);
        for (let ri = 0; ri < rows.length; ri += 1) {
            const r = rows[ri];
            if (!r) continue;
            const dk = r.day_key || dayKeyFromHalfdayKey(r.halfday_key);
            const hd = r.halfday_key;
            if (typeof dk !== 'string' || typeof hd !== 'string') continue;
            const guardKeys = Array.isArray(r.proctor_keys) ? r.proctor_keys : [];
            const resKeys = Array.isArray(r.reserve_keys) ? r.reserve_keys : [];
            const allKeys = [];
            for (let i = 0; i < guardKeys.length; i += 1) {
                if (typeof guardKeys[i] === 'string' && guardKeys[i].length > 0) {
                    allKeys.push(guardKeys[i]);
                }
            }
            for (let i = 0; i < resKeys.length; i += 1) {
                allKeys.push(resKeys[i]);
            }
            for (let i = 0; i < allKeys.length; i += 1) {
                const k = allKeys[i];
                if (!dayHalfdaysByKey[k]) dayHalfdaysByKey[k] = Object.create(null);
                if (!dayHalfdaysByKey[k][dk]) dayHalfdaysByKey[k][dk] = Object.create(null);
                dayHalfdaysByKey[k][dk][hd] = true;
            }
        }
        const procs = Object.keys(dayHalfdaysByKey);
        for (let p = 0; p < procs.length; p += 1) {
            const days = Object.keys(dayHalfdaysByKey[procs[p]]);
            for (let d = 0; d < days.length; d += 1) {
                const hds = Object.keys(dayHalfdaysByKey[procs[p]][days[d]]);
                assert.ok(hds.length <= 1,
                    'proctor ' + procs[p] + ': active in multiple halfdays of day ' + days[d] +
                    ' (' + JSON.stringify(hds) + ') with allowSameDayBothHalfdays=false');
            }
        }
    }

    // 6. AC 10.2 — reserve_keys / reserves arrays are FRESH (no two rows
    //    share the same array reference).
    const seenArrayIdentities = new Set();
    for (let ri = 0; ri < rows.length; ri += 1) {
        const r = rows[ri];
        if (!r) continue;
        if (Array.isArray(r.reserve_keys)) {
            assert.ok(!seenArrayIdentities.has(r.reserve_keys),
                'row ' + ri + ': reserve_keys array is shared with another row (AC 10.2 violation)');
            seenArrayIdentities.add(r.reserve_keys);
        }
        if (Array.isArray(r.reserves)) {
            assert.ok(!seenArrayIdentities.has(r.reserves),
                'row ' + ri + ': reserves array is shared with another row (AC 10.2 violation)');
            seenArrayIdentities.add(r.reserves);
        }
    }
}

// ---------------------------------------------------------------------------
// 1. Property test: hard constraints + uniqueness on random inputs
// ---------------------------------------------------------------------------

test('property: post-Phase 9 reserves satisfy AC 7.4 / 7.4a / 3.6 / 3.7a / 10.2 (30 random inputs)', () => {
    const N = 30;
    let totalReservesPlaced = 0;
    for (let s = 0; s < N; s += 1) {
        const seed = (s + 1) * 1009 + 17;
        const rng = createPRNG(seed);
        const input = arbitraryInput(rng);
        // Force a non-trivial reserve target via reservesConfig so the
        // generator's input has reserves to place. We respect the
        // generator's allowSameDay flag.
        input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
        const allowSameDay = !!(input.examDistributionRules
            && input.examDistributionRules.allowSameDayBothHalfdays);

        const state = runUpToPhase9(input, {
            phase4TimeBudgetMs: 200,
            phase9TimeBudgetMs: 500
        });

        try {
            verifyReserveInvariants(state, allowSameDay);
        } catch (err) {
            err.message = 'seed=' + seed + ': ' + err.message;
            throw err;
        }

        const rows = state.rows || [];
        for (let r = 0; r < rows.length; r += 1) {
            if (rows[r] && Array.isArray(rows[r].reserve_keys)) {
                totalReservesPlaced += rows[r].reserve_keys.length;
            }
        }
    }
    assert.ok(totalReservesPlaced > 0,
        'Expected at least one of ' + N + ' random inputs to produce at least one reserve assignment');
});

// ---------------------------------------------------------------------------
// 2. Determinism unit test
// ---------------------------------------------------------------------------

test('determinism: same input produces identical reserve assignments', () => {
    const rng1 = createPRNG(424242);
    const rng2 = createPRNG(424242);
    const inputA = arbitraryInput(rng1);
    const inputB = arbitraryInput(rng2);
    inputA.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
    inputB.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };
    assert.deepStrictEqual(inputA, inputB, 'arbitraryInput is deterministic');

    const sa = runUpToPhase9(inputA, { phase4TimeBudgetMs: 1000, phase9TimeBudgetMs: 1000 });
    const sb = runUpToPhase9(inputB, { phase4TimeBudgetMs: 1000, phase9TimeBudgetMs: 1000 });

    const reservesA = (sa.rows || []).map((r) => r && Array.isArray(r.reserve_keys)
        ? r.reserve_keys.slice() : null);
    const reservesB = (sb.rows || []).map((r) => r && Array.isArray(r.reserve_keys)
        ? r.reserve_keys.slice() : null);
    assert.deepStrictEqual(reservesA, reservesB,
        'identical inputs must produce identical reserve_keys assignments');
});

// ---------------------------------------------------------------------------
// 3. AC 7.1 — Reserves_Config sourcing precedence
// ---------------------------------------------------------------------------

test('AC 7.1: reservesConfig (explicit) takes precedence over examCenterConfig.max_reserves_*', () => {
    const cfg = phase9Internals.resolveReservesConfig({
        reservesConfig: { mode: 'fixed', fixed: 3, percent: 0 },
        examCenterConfig: { max_reserves_mode: 'fixed', max_reserves: 99 },
        examDistributionRules: { reservesPerSession: 7 }
    });
    assert.deepStrictEqual(cfg, { mode: 'fixed', fixed: 3, percent: 0 });
});

test('AC 7.1: examCenterConfig.max_reserves_* used when reservesConfig is absent', () => {
    const cfg = phase9Internals.resolveReservesConfig({
        examCenterConfig: { max_reserves_mode: 'percent', max_reserves: 0, max_reserves_percent: 50 },
        examDistributionRules: { reservesPerSession: 7 }
    });
    assert.deepStrictEqual(cfg, { mode: 'percent', fixed: 0, percent: 50 });
});

test('AC 7.1: legacy reservesPerSession used when both new fields absent', () => {
    const cfg = phase9Internals.resolveReservesConfig({
        examDistributionRules: { reservesPerSession: 4 }
    });
    assert.deepStrictEqual(cfg, { mode: 'fixed', fixed: 4, percent: 0 });
});

test('AC 7.1: defaults to no reserves when no config sources present', () => {
    const cfg = phase9Internals.resolveReservesConfig({});
    assert.deepStrictEqual(cfg, { mode: 'fixed', fixed: 0, percent: 0 });
});

// ---------------------------------------------------------------------------
// 4. AC 7.2 / 7.3 — target computation
// ---------------------------------------------------------------------------

test('AC 7.2: fixed mode returns cfg.fixed regardless of guardCount', () => {
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'fixed', fixed: 2, percent: 0 }, 5), 2);
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'fixed', fixed: 0, percent: 0 }, 5), 0);
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'fixed', fixed: 3, percent: 0 }, 0), 3);
});

test('AC 7.3: percent mode returns ceil(percent * guardCount / 100)', () => {
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'percent', fixed: 0, percent: 25 }, 8), 2);
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'percent', fixed: 0, percent: 30 }, 8), 3); // ceil(2.4) = 3
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'percent', fixed: 0, percent: 100 }, 4), 4);
    assert.strictEqual(phase9Internals.computeReserveTarget({ mode: 'percent', fixed: 0, percent: 0 }, 10), 0);
});

// ---------------------------------------------------------------------------
// 5. AC 7.5 — sort order on a tiny synthetic candidate pool
// ---------------------------------------------------------------------------

test('AC 7.5: candidate sort uses (reserveCount, affinityRank, finalLoad, canonicalKey)', () => {
    const input = {
        proctorsList: [
            { cin: '1', name: 'A', subject: '', gender: 'M' },
            { cin: '2', name: 'B', subject: '', gender: 'M' },
            { cin: '3', name: 'C', subject: '', gender: 'M' },
            { cin: '4', name: 'D', subject: '', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'M' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: { L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }] },
        reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 }
    };
    const state = runUpToPhase9(input, { phase4TimeBudgetMs: 500, phase9TimeBudgetMs: 500 });
    // 1 row, 1 guard slot, 2 reserves chosen.
    assert.strictEqual(state.rows.length, 1);
    const row = state.rows[0];
    assert.strictEqual(row.reserve_keys.length, 2,
        'expected 2 reserves, got ' + row.reserve_keys.length);
    // The guard takes one of the four; the remaining three have
    // reserveCount=0, affinityRank=1, finalLoad=0 (or 0/1 depending on
    // who got the guard slot). The picker should choose the two with the
    // smallest canonical keys among those NOT chosen as guard.
    const guard = row.proctor_keys[0];
    const expected = ['1', '2', '3', '4']
        .filter((k) => k !== guard)
        .slice(0, 2);
    assert.deepStrictEqual(row.reserve_keys, expected,
        'expected reserves ' + JSON.stringify(expected) + ' got ' + JSON.stringify(row.reserve_keys));
});

// ---------------------------------------------------------------------------
// 6. AC 7.6 / 7.7 — affinity rank for second-of-halfday sessions
// ---------------------------------------------------------------------------

test('AC 7.6: affinity favors a proctor who guarded the prior session in the same halfday', () => {
    // Tightly constructed scenario: 3 proctors (P1, P2, P3); two
    // sequential sessions in the same halfday. Session 1 has 1 room of
    // 1 guard slot and reservesConfig 0 (no reserves); we need the guard
    // to be P1 deterministically. Session 2 has reservesConfig fixed 1
    // and we expect the reserve pick to be P1 (affinityRank=0 vs P2/P3 at
    // affinityRank=1).
    //
    // To force P1 as the guard of session 1, we EXEMPT P2 and P3 from
    // session 1 only.
    const sk1 = '2026-06-04|صباحا|L1|Math|الحصة الأولى';
    const input = {
        proctorsList: [
            { cin: '1', name: 'P1', subject: '', gender: 'M' },
            { cin: '2', name: 'P2', subject: '', gender: 'M' },
            { cin: '3', name: 'P3', subject: '', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math', session: 'الحصة الأولى' },
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Physique', session: 'الحصة الثانية' }
        ],
        dutyData: {},
        exemptionsData: {
            [sk1]: { '2': 'no', '3': 'no' }
        },
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 2 } },
        examCenterRoomsData: { L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }] },
        reservesConfig: { mode: 'fixed', fixed: 1, percent: 0 }
    };
    const state = runUpToPhase9(input, { phase4TimeBudgetMs: 500, phase9TimeBudgetMs: 500 });
    // 2 rows expected.
    assert.strictEqual(state.rows.length, 2);
    const rowSession1 = state.rows.find((r) => /الحصة الأولى/.test(r.session_key));
    const rowSession2 = state.rows.find((r) => /الحصة الثانية/.test(r.session_key));
    assert.ok(rowSession1 && rowSession2);
    assert.strictEqual(rowSession1.proctor_keys[0], '1',
        'session 1 must be guarded by P1 (only eligible proctor)');
    // Session 2's reserve should be P1 (affinityRank=0).
    // The OTHER guard is one of P2/P3. The reserve pick is from {P1, the
    // un-chosen one of P2/P3}. P1 has affinity 0; the other has 1. So
    // P1 wins.
    assert.deepStrictEqual(rowSession2.reserve_keys, ['1'],
        'session 2 reserve must be P1 (affinity rank 0); got ' + JSON.stringify(rowSession2.reserve_keys));
});

test('AC 7.7: affinity inactive for first-of-halfday session — sort falls back to lex order', () => {
    // 3 proctors all eligible for the only session; reserve target = 2.
    // No previous session, so all candidates have affinityRank=1; the
    // reserveCount is 0 for everyone; finalLoad differs only for the
    // guard. The two reserves should be the two NOT chosen as guard, in
    // canonical-key ASC order.
    const input = {
        proctorsList: [
            { cin: '7', name: 'G', subject: '', gender: 'M' },
            { cin: '5', name: 'E', subject: '', gender: 'M' },
            { cin: '9', name: 'I', subject: '', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'M' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: { L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }] },
        reservesConfig: { mode: 'fixed', fixed: 2, percent: 0 }
    };
    const state = runUpToPhase9(input, { phase4TimeBudgetMs: 500, phase9TimeBudgetMs: 500 });
    const row = state.rows[0];
    // Guard is the lowest canonical key still eligible by class bounds:
    // determined by CP solver. We just assert the two reserves are the
    // two NOT chosen as guard, in lex order.
    const guard = row.proctor_keys[0];
    const expected = ['5', '7', '9']
        .filter((k) => k !== guard)
        .sort();
    assert.deepStrictEqual(row.reserve_keys, expected);
});

// ---------------------------------------------------------------------------
// 7. AC 3.6 / C-NO-DOUBLE — proctor cannot be reserve in a session they guard
// ---------------------------------------------------------------------------

test('AC 3.6: a guard of session S is never picked as a reserve of S', () => {
    // 2 proctors; reserveTarget=1; only one possible guard. The guard
    // must NOT be the reserve.
    const input = {
        proctorsList: [
            { cin: '1', name: 'P1', subject: '', gender: 'M' },
            { cin: '2', name: 'P2', subject: '', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'M' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: { L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }] },
        reservesConfig: { mode: 'fixed', fixed: 1, percent: 0 }
    };
    const state = runUpToPhase9(input, { phase4TimeBudgetMs: 500, phase9TimeBudgetMs: 500 });
    const row = state.rows[0];
    const guard = row.proctor_keys[0];
    assert.ok(row.reserve_keys.length <= 1);
    if (row.reserve_keys.length === 1) {
        assert.notStrictEqual(row.reserve_keys[0], guard,
            'reserve must not equal the guard of the same session');
    }
});

// ---------------------------------------------------------------------------
// 8. AC 7.4a — reserves shared across rooms are independent arrays
// ---------------------------------------------------------------------------

test('AC 7.4a + 10.2: chosen reserve appears in EXACTLY ONE row of the session, arrays are distinct refs', () => {
    // 3 proctors; 1 session × 2 rooms × 1 slot each; reserve target 1.
    const input = {
        proctorsList: [
            { cin: '1', name: 'P1', subject: '', gender: 'M' },
            { cin: '2', name: 'P2', subject: '', gender: 'M' },
            { cin: '3', name: 'P3', subject: '', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'M' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: { proctorsPerRoom: 1, allowSameDayBothHalfdays: false },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 2, sessions: 1 } },
        examCenterRoomsData: {
            L1: [
                { key: 'L1_R1', room_num: '1', roomName: 'Salle 1' },
                { key: 'L1_R2', room_num: '2', roomName: 'Salle 2' }
            ]
        },
        reservesConfig: { mode: 'fixed', fixed: 1, percent: 0 }
    };
    const state = runUpToPhase9(input, { phase4TimeBudgetMs: 500, phase9TimeBudgetMs: 500 });
    assert.strictEqual(state.rows.length, 2);
    const r0 = state.rows[0];
    const r1 = state.rows[1];
    // AC 7.4a — exactly ONE chosen reserve, appears in EXACTLY one row.
    const totalReserves = r0.reserve_keys.length + r1.reserve_keys.length;
    assert.strictEqual(totalReserves, 1,
        'expected exactly 1 reserve across the session, got ' + totalReserves);
    // AC 10.2 — distinct array references even when both empty / one is empty.
    assert.notStrictEqual(r0.reserve_keys, r1.reserve_keys,
        'rows of the same session must NOT share the same reserve_keys array reference (AC 10.2)');
    assert.notStrictEqual(r0.reserves, r1.reserves,
        'rows of the same session must NOT share the same reserves array reference (AC 10.2)');
    // The chosen proctor's reserveCount in the load state is 1.
    const reservedKey = (r0.reserve_keys[0] || r1.reserve_keys[0]);
    assert.ok(reservedKey === '1' || reservedKey === '2' || reservedKey === '3');
    assert.strictEqual(state.loadState.proctors[reservedKey].reserveCount, 1,
        'reserveCount must be incremented exactly once per session (AC 7.5)');
});

// ---------------------------------------------------------------------------
// 9. AC 7.9 — proctor_keys (guard slots) are not modified by Phase 9
// ---------------------------------------------------------------------------

test('AC 7.9: Phase 9 does not modify proctor_keys', () => {
    const rng = createPRNG(99);
    const input = arbitraryInput(rng);
    input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };

    let state = { input: input, options: { phase4TimeBudgetMs: 200 } };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const canonicalKeys = (input.proctorsList || []).map(canonicalKeyOf);
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

    const beforeGuards = state.rows.map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    const after = placeReserves(state);
    const afterGuards = after.rows.map((r) => r && Array.isArray(r.proctor_keys)
        ? r.proctor_keys.slice() : null);
    assert.deepStrictEqual(afterGuards, beforeGuards,
        'Phase 9 must leave proctor_keys unchanged');
});

// ---------------------------------------------------------------------------
// 10. Empty-input fast path
// ---------------------------------------------------------------------------

test('empty rows: returns state with empty rows and no errors', () => {
    const out = placeReserves({
        input: { proctorsList: [], scheduleEntries: [], examDistributionRules: { proctorsPerRoom: 1 } },
        rows: [],
        loadState: { proctors: Object.create(null) },
        diagnostics: { warnings: [], errors: [] }
    });
    assert.deepStrictEqual(out.rows, []);
    assert.deepStrictEqual(out.diagnostics.errors, []);
});

// ---------------------------------------------------------------------------
// 11. State purity — original state object not mutated
// ---------------------------------------------------------------------------

test('purity: original state.rows array reference is not mutated', () => {
    const rng = createPRNG(13);
    const input = arbitraryInput(rng);
    input.reservesConfig = { mode: 'fixed', fixed: 1, percent: 0 };

    let state = { input: input, options: { phase4TimeBudgetMs: 200 } };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const canonicalKeys = (input.proctorsList || []).map(canonicalKeyOf);
    const ls = createLoadState(canonicalKeys);
    state.loadState = ls;
    state = placeGuards(state);

    const originalRowsRef = state.rows;
    const snapshots = originalRowsRef.map((r) => r && Array.isArray(r.reserve_keys)
        ? r.reserve_keys.slice() : null);

    const next = placeReserves(state);
    assert.notStrictEqual(next.rows, originalRowsRef,
        'placeReserves must replace state.rows with a new array');
    for (let i = 0; i < originalRowsRef.length; i += 1) {
        const before = snapshots[i];
        const now = originalRowsRef[i] && Array.isArray(originalRowsRef[i].reserve_keys)
            ? originalRowsRef[i].reserve_keys
            : null;
        if (before === null) {
            assert.strictEqual(now, null);
        } else {
            assert.deepStrictEqual(now, before,
                'original row ' + i + '.reserve_keys must be unchanged');
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

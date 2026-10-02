/**
 * Integration tests for orchestrator-level same-day pre-check
 * (js/algorithms/proctor-v3/orchestrator.js#runSameDayPreCheck).
 *
 * Validates: Requirements 4.2, 4.2a, 4.2b, 4.6, 12.3
 *
 * These tests verify the orchestrator's conditional composition of
 * Phase 6 with the relaxed-mode pre-check pipeline. They do NOT test
 * Phase 6 in isolation — that's covered by same-day-detect.test.js.
 *
 * Strategy: build small synthetic inputs where the strict-mode pipeline
 * (Phases 0..5 with allowSameDayBothHalfdays = false) leaves at least
 * one unresolved slot, then call runSameDayPreCheck and assert that the
 * correct warning is emitted depending on whether the relaxed pipeline
 * achieves full coverage.
 *
 * Run directly:   node tests/proctor-v3/orchestrator-precheck.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const V3_ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');

const { validateInput } = require(path.join(V3_ROOT, 'phases', '00-validate.js'));
const { normalizeKeys } = require(path.join(V3_ROOT, 'phases', '01-normalize-keys.js'));
const { buildRoomsAndRows } = require(path.join(V3_ROOT, 'phases', '01b-build-rooms-and-rows.js'));
const { deriveEligibilityClasses } = require(path.join(V3_ROOT, 'phases', '02-eligibility-classes.js'));
const { computeBounds } = require(path.join(V3_ROOT, 'phases', '03-bounds.js'));
const { createLoadState, addDutyLoad } = require(path.join(V3_ROOT, 'utils', 'load-state.js'));
const { placeGuards } = require(path.join(V3_ROOT, 'phases', '04-place-guards.js'));
const { multiStepCoverageRepair } = require(path.join(V3_ROOT, 'phases', '05-coverage-repair.js'));
const { detectSameDayInfeasibility } = require(path.join(V3_ROOT, 'phases', '06-same-day-detect.js'));
const { runSameDayPreCheck, _internals: orchestratorInternals } = require(path.join(V3_ROOT, 'orchestrator.js'));

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

function canonicalKeyOf(proctor, idx) {
    var cin = proctor && proctor.cin != null ? String(proctor.cin).trim() : '';
    if (cin) return cin;
    return '__idx_' + idx;
}

// ---------------------------------------------------------------------------
// Strict pipeline runner (Phases 0..6)
// ---------------------------------------------------------------------------

function runStrictPipeline(input) {
    const validation = validateInput(input);
    if (!validation.valid) {
        throw new Error('validateInput failed: ' + JSON.stringify(validation.errors));
    }
    let state = { input: input, options: {} };
    state = normalizeKeys(state);
    state = buildRoomsAndRows(state);
    state = deriveEligibilityClasses(state);
    state = computeBounds(state);

    const canonicalKeys = [];
    for (let i = 0; i < input.proctorsList.length; i += 1) {
        canonicalKeys.push(canonicalKeyOf(input.proctorsList[i], i));
    }
    const ls = createLoadState(canonicalKeys);
    if (state.normalizedDutyData) {
        const hdKeys = Object.keys(state.normalizedDutyData);
        for (let h = 0; h < hdKeys.length; h += 1) {
            const inner = state.normalizedDutyData[hdKeys[h]];
            if (!inner || typeof inner !== 'object') continue;
            const procKeys = Object.keys(inner);
            for (let p = 0; p < procKeys.length; p += 1) {
                addDutyLoad(ls, procKeys[p], hdKeys[h]);
            }
        }
    }
    state.loadState = ls;

    state = placeGuards(state);
    state = multiStepCoverageRepair(state);
    state = detectSameDayInfeasibility(state);
    return state;
}

// ---------------------------------------------------------------------------
// Scenario builders
// ---------------------------------------------------------------------------

/**
 * Scenario A: strict same-day rule causes unresolved coverage but relaxed
 * mode succeeds. Two halfdays of the SAME day, one room each, two
 * proctors total. Strict mode forbids both proctors from working both
 * halfdays — but with two proctors per room and only two proctors
 * available, strict cannot fill both rooms of both halfdays without
 * placing the same proctor in both halfdays of the same day.
 *
 * Schedule:
 *   - Day 1 morning, level L1, subject Math, 1 room × 2 slots
 *   - Day 1 afternoon, level L1, subject French, 1 room × 2 slots
 * Proctors: P1 (cin=1001), P2 (cin=1002)
 *
 * Strict mode: 4 slots, 2 proctors, forbid same-day both halfdays
 *              → at most 2 slots can be filled (one halfday, both proctors).
 *              → 2 unresolved slots (the other halfday).
 * Relaxed mode: 4 slots, 2 proctors, no same-day rule
 *              → both proctors fill both halfdays = 4 slots, 0 unresolved.
 */
function buildSameDayInfeasibleInput() {
    return {
        proctorsList: [
            { cin: '1001', som: '', name: 'Prof_001', subject: 'X', gender: 'M' },
            { cin: '1002', som: '', name: 'Prof_002', subject: 'Y', gender: 'F' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math', session: 'الحصة الأولى' },
            { date: '2026-06-04', period: 'مساء', level: 'L1', subject: 'French', session: 'الحصة الأولى' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false
        },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: {
            L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }]
        },
        randomSeed: 1
    };
}

/**
 * Scenario B: even relaxed mode cannot achieve full coverage. One proctor,
 * two slots in a single session — Phase 4 cannot place the same proctor
 * twice in one row (C-NO-DOUBLE within row, AC 3.5), so one slot must
 * remain unresolved no matter what flag is set.
 *
 * Schedule:
 *   - Day 1 morning, level L1, subject Math, 1 room × 2 slots
 * Proctors: P1 (cin=1001) only
 *
 * Strict mode: 2 slots, 1 proctor, AllDifferent within row
 *              → 1 slot filled, 1 unresolved.
 * Relaxed mode: same outcome — 1 slot unresolved.
 *              → emits `coverage_infeasible_regardless`.
 */
function buildAlwaysInfeasibleInput() {
    return {
        proctorsList: [
            { cin: '1001', som: '', name: 'Prof_001', subject: 'X', gender: 'M' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math', session: 'الحصة الأولى' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false
        },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: {
            L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }]
        },
        randomSeed: 1
    };
}

/**
 * Scenario C: full coverage already achieved in strict mode. No pre-check
 * should ever fire.
 */
function buildFullyCoveredInput() {
    return {
        proctorsList: [
            { cin: '1001', som: '', name: 'P1', subject: 'X', gender: 'M' },
            { cin: '1002', som: '', name: 'P2', subject: 'Y', gender: 'F' },
            { cin: '1003', som: '', name: 'P3', subject: 'Z', gender: 'M' },
            { cin: '1004', som: '', name: 'P4', subject: 'W', gender: 'F' }
        ],
        scheduleEntries: [
            { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'Math', session: 'الحصة الأولى' },
            { date: '2026-06-04', period: 'مساء', level: 'L1', subject: 'French', session: 'الحصة الأولى' }
        ],
        dutyData: {},
        exemptionsData: {},
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false
        },
        examCenterConfig: { expected_duty_tasks: 0 },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: {
            L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle 1' }]
        },
        randomSeed: 1
    };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

test('AC 4.2: strict run leaves unresolved + relaxed run succeeds → same_day_relaxation_suggested', () => {
    const input = buildSameDayInfeasibleInput();
    const state = runStrictPipeline(input);

    // Sanity check: strict pipeline must actually leave unresolved slots
    // for this scenario to be meaningful.
    assert.ok(state.diagnostics.unresolvedSlots.length > 0,
        'expected strict pipeline to leave unresolved slots; got 0');
    assert.strictEqual(state.diagnostics.preCheckRequired, true,
        'expected Phase 6 to mark preCheckRequired');

    const result = runSameDayPreCheck(state, {
        phase4BudgetMs: 5000,
        phase5BudgetMs: 2000
    });

    const warnings = result.diagnostics.warnings || [];
    const matched = warnings.filter(w => w && w.type === 'same_day_relaxation_suggested');
    assert.strictEqual(matched.length, 1,
        'expected exactly one same_day_relaxation_suggested warning; got '
        + warnings.length + ' warnings: ' + JSON.stringify(warnings));

    const w = matched[0];
    assert.strictEqual(w.impactedSlotsCount, state.diagnostics.preCheckUnresolvedCount,
        'impactedSlotsCount must match preCheckUnresolvedCount');
    assert.ok(typeof w.message === 'string' && w.message.length > 0,
        'warning must include a non-empty message');

    assert.strictEqual(result.diagnostics.preCheckRelaxedUnresolvedCount, 0,
        'preCheckRelaxedUnresolvedCount must be 0 when relaxed run succeeded');

    // No coverage_infeasible_regardless emitted.
    const inf = warnings.filter(w => w && w.type === 'coverage_infeasible_regardless');
    assert.strictEqual(inf.length, 0,
        'must NOT emit coverage_infeasible_regardless when relaxed run succeeded');
});

test('AC 4.2a: both strict AND relaxed leave unresolved → coverage_infeasible_regardless', () => {
    const input = buildAlwaysInfeasibleInput();
    const state = runStrictPipeline(input);

    assert.ok(state.diagnostics.unresolvedSlots.length > 0,
        'expected strict pipeline to leave unresolved slots');
    assert.strictEqual(state.diagnostics.preCheckRequired, true);

    const result = runSameDayPreCheck(state, {
        phase4BudgetMs: 5000,
        phase5BudgetMs: 2000
    });

    const warnings = result.diagnostics.warnings || [];
    const matched = warnings.filter(w => w && w.type === 'coverage_infeasible_regardless');
    assert.strictEqual(matched.length, 1,
        'expected exactly one coverage_infeasible_regardless warning; got '
        + warnings.length + ' warnings: ' + JSON.stringify(warnings));

    const w = matched[0];
    assert.strictEqual(w.impactedSlotsCount, state.diagnostics.preCheckUnresolvedCount,
        'impactedSlotsCount must match preCheckUnresolvedCount');
    assert.ok(typeof w.message === 'string' && w.message.length > 0,
        'warning must include a non-empty message');

    assert.ok(result.diagnostics.preCheckRelaxedUnresolvedCount > 0,
        'preCheckRelaxedUnresolvedCount must be > 0 when relaxed run also failed');

    // No same_day_relaxation_suggested emitted.
    const sds = warnings.filter(w => w && w.type === 'same_day_relaxation_suggested');
    assert.strictEqual(sds.length, 0,
        'must NOT emit same_day_relaxation_suggested when relaxed run also failed');
});

test('AC 4.2b: full coverage in strict mode → preCheckRequired = false, no pre-check fires', () => {
    const input = buildFullyCoveredInput();
    const state = runStrictPipeline(input);

    assert.strictEqual(state.diagnostics.unresolvedSlots.length, 0,
        'expected strict pipeline to achieve full coverage');
    assert.strictEqual(state.diagnostics.preCheckRequired, false);

    const result = runSameDayPreCheck(state);

    const warnings = result.diagnostics.warnings || [];
    const sds = warnings.filter(w => w && w.type === 'same_day_relaxation_suggested');
    const inf = warnings.filter(w => w && w.type === 'coverage_infeasible_regardless');
    assert.strictEqual(sds.length, 0,
        'must NOT emit same_day_relaxation_suggested when no pre-check needed');
    assert.strictEqual(inf.length, 0,
        'must NOT emit coverage_infeasible_regardless when no pre-check needed');
});

// ---------------------------------------------------------------------------
// AC 4.2b — flag already enabled means Phase 6 sets preCheckRequired = false
// ---------------------------------------------------------------------------

test('AC 4.2b: when allowSameDayBothHalfdays is already true, no pre-check is fired', () => {
    const input = buildSameDayInfeasibleInput();
    input.examDistributionRules.allowSameDayBothHalfdays = true;
    const state = runStrictPipeline(input);

    assert.strictEqual(state.diagnostics.preCheckRequired, false,
        'Phase 6 must mark preCheckRequired = false when flag already enabled');

    const result = runSameDayPreCheck(state);
    const warnings = result.diagnostics.warnings || [];
    const sds = warnings.filter(w => w && w.type === 'same_day_relaxation_suggested');
    const inf = warnings.filter(w => w && w.type === 'coverage_infeasible_regardless');
    assert.strictEqual(sds.length, 0);
    assert.strictEqual(inf.length, 0);
});

// ---------------------------------------------------------------------------
// Purity — strict state is not mutated
// ---------------------------------------------------------------------------

test('purity: runSameDayPreCheck does not mutate the strict state diagnostics', () => {
    const input = buildSameDayInfeasibleInput();
    const state = runStrictPipeline(input);

    // Snapshot warnings/errors arrays by reference and length.
    const beforeWarnings = state.diagnostics.warnings.slice();
    const beforeErrors = state.diagnostics.errors.slice();
    const beforeUnresolved = state.diagnostics.unresolvedSlots.slice();
    const beforeWarningsRef = state.diagnostics.warnings;
    const beforeErrorsRef = state.diagnostics.errors;
    const beforeUnresolvedRef = state.diagnostics.unresolvedSlots;

    const result = runSameDayPreCheck(state);

    assert.strictEqual(state.diagnostics.warnings, beforeWarningsRef,
        'strict warnings array reference must not change');
    assert.strictEqual(state.diagnostics.errors, beforeErrorsRef,
        'strict errors array reference must not change');
    assert.strictEqual(state.diagnostics.unresolvedSlots, beforeUnresolvedRef,
        'strict unresolvedSlots array reference must not change');
    assert.deepStrictEqual(state.diagnostics.warnings, beforeWarnings,
        'strict warnings contents must not change');
    assert.deepStrictEqual(state.diagnostics.errors, beforeErrors,
        'strict errors contents must not change');
    assert.deepStrictEqual(state.diagnostics.unresolvedSlots, beforeUnresolved,
        'strict unresolvedSlots contents must not change');

    // Result has fresh arrays.
    assert.notStrictEqual(result.diagnostics, state.diagnostics,
        'returned diagnostics must be a fresh object');
    assert.notStrictEqual(result.diagnostics.warnings, state.diagnostics.warnings,
        'returned warnings array must be fresh');
});

// ---------------------------------------------------------------------------
// Defensive no-op when called with preCheckRequired = false
// ---------------------------------------------------------------------------

test('defensive no-op: runSameDayPreCheck when preCheckRequired = false returns clone with no warning', () => {
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { allowSameDayBothHalfdays: false }
        },
        diagnostics: {
            preCheckRequired: false,
            preCheckUnresolvedCount: 0,
            unresolvedSlots: [],
            warnings: [{ type: 'pre_existing' }],
            errors: []
        }
    };
    const result = runSameDayPreCheck(state);
    assert.strictEqual(result.diagnostics.preCheckRequired, false);
    assert.deepStrictEqual(result.diagnostics.warnings,
        [{ type: 'pre_existing' }],
        'pre-existing warnings must be preserved, no new warning added');
});

// ---------------------------------------------------------------------------
// Internal: buildRelaxedState produces a state with allowSameDayBothHalfdays=true
// ---------------------------------------------------------------------------

test('internal: buildRelaxedState forces allowSameDayBothHalfdays = true', () => {
    const input = buildSameDayInfeasibleInput();
    assert.strictEqual(input.examDistributionRules.allowSameDayBothHalfdays, false);
    const relaxed = orchestratorInternals.buildRelaxedState(input, {});
    assert.strictEqual(relaxed.input.examDistributionRules.allowSameDayBothHalfdays, true,
        'relaxed input must have allowSameDayBothHalfdays = true');
    // Original input must not be mutated.
    assert.strictEqual(input.examDistributionRules.allowSameDayBothHalfdays, false,
        'original input must not be mutated');
});

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

test('default budgets are within design constraints (≤ 7s combined)', () => {
    const total = orchestratorInternals.DEFAULT_PRECHECK_PHASE4_BUDGET_MS
        + orchestratorInternals.DEFAULT_PRECHECK_PHASE5_BUDGET_MS;
    assert.ok(total <= 7000,
        'combined default pre-check budget must not exceed 7000ms; got ' + total);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

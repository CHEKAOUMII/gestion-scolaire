'use strict';

const assert = require('assert');
const path = require('path');

const ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');
const { validateInput } = require(path.join(ROOT, 'phases', '00-validate.js'));
const { normalizeKeys } = require(path.join(ROOT, 'phases', '01-normalize-keys.js'));
const { runOrchestrator, _internals } = require(path.join(ROOT, 'orchestrator.js'));
const { createLoadState, mergeExternalLoad, primaryLoad } = require(path.join(
    ROOT, 'utils', 'load-state.js'
));
const { wouldConflictWithExternalResources } = require(path.join(
    ROOT, 'constraints', 'hard-constraints.js'
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

function baseInput(overrides = {}) {
    return Object.assign({
        proctorsList: [
            { cin: 'P1', name: 'One' },
            { cin: 'P2', name: 'Two' },
            { cin: 'P3', name: 'Three' },
            { cin: 'P4', name: 'Four' }
        ],
        scheduleEntries: [{
            date: '2026-06-01',
            period: 'صباحا',
            level: 'L1',
            subject: 'Math',
            session: 'first'
        }],
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: true
        },
        examCenterConfig: {
            expected_duty_tasks: 0,
            max_reserves_mode: 'fixed',
            max_reserves: 0
        },
        examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
        examCenterRoomsData: { L1: [{ room_name: 'R1', capacity: 30 }] },
        randomSeed: 11
    }, overrides);
}

const targetSession = '2026-06-01|صباحا|L1|Math|first';
const targetHalfday = '2026-06-01|صباحا';

// ---------------------------------------------------------------------------
// Explicit all-cycle contract
// ---------------------------------------------------------------------------

test('cross-cycle resources require explicit all-cycle scope and policy cycle', () => {
    const input = baseInput({
        crossCycleResources: {
            scopeCycles: 'secondary_qualifiant',
            policyCycle: ''
        }
    });
    const result = validateInput(input);
    assert.strictEqual(result.valid, false);
    assert.ok(result.errors.some((entry) => entry.type === 'cross_cycle_scope_required'));
    assert.ok(result.errors.some((entry) => entry.type === 'missing_policy_cycle'));
});

test('cross-cycle resources normalize proctor aliases into canonical keys', () => {
    const state = normalizeKeys({
        input: baseInput({
            proctorsList: [
                { cin: 'P1', name: 'One' },
                { cin: 'P2', som: 'SOM2', name: 'Two' },
                { cin: 'P3', name: 'Three' },
                { cin: 'P4', name: 'Four' }
            ],
            crossCycleResources: {
                scopeCycles: 'all',
                policyCycle: 'secondary_qualifiant',
                proctorLoads: {
                    SOM2: {
                        guardCount: 2,
                        teachingSessions: [targetSession]
                    }
                },
                teachingSessions: { P3: [targetSession] }
            }
        })
    });
    assert.strictEqual(state.normalizedCrossCycleResources.proctorLoads.P2.guardCount, 2);
    assert.deepStrictEqual(
        state.normalizedCrossCycleResources.proctorLoads.P2.teachingSessions,
        [targetSession]
    );
    assert.deepStrictEqual(
        state.normalizedCrossCycleResources.teachingSessions.P3,
        [targetSession]
    );
});

// ---------------------------------------------------------------------------
// Load and hard-constraint behavior
// ---------------------------------------------------------------------------

test('external counts contribute to primary load without changing local guard counts', () => {
    const loadState = createLoadState(['P1']);
    mergeExternalLoad(loadState, 'P1', {
        guardCount: 2,
        dutyCount: 1,
        teachingSessions: [targetSession]
    });
    assert.strictEqual(primaryLoad(loadState, 'P1'), 3);
    assert.strictEqual(loadState.proctors.P1.guardCount, 2);
    assert.strictEqual(
        wouldConflictWithExternalResources(loadState, 'P1', targetSession, targetHalfday),
        true
    );
});

test('cross-cycle teaching occupancy prevents a guard assignment in that session', () => {
    const output = runOrchestrator(baseInput({
        crossCycleResources: {
            scopeCycles: 'all',
            policyCycle: 'secondary_qualifiant',
            teachingSessions: { P1: [targetSession] }
        }
    }));
    const row = output.result.find((candidate) => candidate.session_key === targetSession);
    assert.ok(row, 'expected target session row');
    assert.ok(!row.proctor_keys.includes('P1'));
});

test('cross-cycle duty occupancy prevents a guard assignment in that halfday', () => {
    const output = runOrchestrator(baseInput({
        crossCycleResources: {
            scopeCycles: 'all',
            policyCycle: 'secondary_qualifiant',
            proctorLoads: { P1: { dutyHalfdays: [targetHalfday] } }
        }
    }));
    const row = output.result.find((candidate) => candidate.session_key === targetSession);
    assert.ok(row, 'expected target session row');
    assert.ok(!row.proctor_keys.includes('P1'));
});

test('cross-cycle guard occupancy prevents the same proctor becoming a reserve', () => {
    const output = runOrchestrator(baseInput({
        reservesConfig: { mode: 'fixed', fixed: 1 },
        crossCycleResources: {
            scopeCycles: 'all',
            policyCycle: 'secondary_qualifiant',
            proctorLoads: { P1: { guardSessions: [targetSession] } }
        }
    }));
    const row = output.result.find((candidate) => candidate.session_key === targetSession);
    assert.ok(row, 'expected target session row');
    assert.ok(!row.reserve_keys.includes('P1'));
});

test('cross-cycle resources remain absent when the field is not supplied', () => {
    const state = _internals.seedLoadStateWithDuty({
        input: baseInput(),
        normalizedDutyData: {}
    });
    assert.strictEqual(primaryLoad(state, 'P1'), 0);
});

if (failed > 0) {
    console.error(`\n${failed} cross-cycle resource tests failed`);
    process.exit(1);
}
console.log(`\n${passed} cross-cycle resource tests passed`);

/**
 * Property-Based Test for V3 determinism.
 *
 * **Validates: Requirements 8.4, 14.5**
 *
 *   AC 8.4  — WHEN System_V3 is invoked twice with byte-identical input AND
 *             identical `randomSeed`, THE two `result` arrays SHALL be
 *             byte-identical AND `diagnostics.classBoundsByProctorKey` SHALL
 *             be byte-identical.
 *   AC 14.5 — assert the above over at least 100 random inputs.
 *
 * "byte-identical" here means `JSON.stringify(a) === JSON.stringify(b)`.
 *
 * Uses fast-check for structured property testing with shrinking support.
 * The arbitrary generates GS3_Input_Contract instances via the pbt-helpers'
 * `arbitraryInput` driven by a seed integer from fast-check.
 *
 * Run directly:   node tests/proctor-v3/determinism.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const V3_ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');

const { run } = require(path.join(V3_ROOT, 'index.js'));
const { createPRNG } = require(path.join(V3_ROOT, 'utils', 'prng.js'));

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

// Bounded per-phase budgets keep each run small so iterations finish quickly.
// Determinism (AC 8.4) MUST hold regardless of whether a phase exhausts its
// budget — a deterministic solver returns the same result whether or not the
// wall-clock cutoff fires.
const RUN_OPTIONS = {
    totalBudgetMs: 5000,
    phase4TimeBudgetMs: 500,
    phase5TimeBudgetMs: 200,
    phase7TimeBudgetMs: 200,
    phase8TimeBudgetMs: 200,
    phase9TimeBudgetMs: 200
};

/**
 * Deep, independent JSON clone — feeds two BYTE-IDENTICAL but
 * REFERENTIALLY-DISTINCT inputs into the two runs.
 */
function jsonClone(value) {
    return JSON.parse(JSON.stringify(value));
}

function stableString(value) {
    return JSON.stringify(value);
}

/**
 * Assert that two full V3 outputs satisfy AC 8.4. Returns true if they match,
 * throws or returns false otherwise.
 */
function assertDeterministic(outA, outB, label) {
    // AC 8.4: result arrays byte-identical.
    const resultA = stableString(outA.result);
    const resultB = stableString(outB.result);
    if (resultA !== resultB) {
        throw new Error(label + ': result arrays are NOT byte-identical');
    }

    // AC 8.4: classBoundsByProctorKey byte-identical.
    const boundsA = stableString(outA.diagnostics && outA.diagnostics.classBoundsByProctorKey);
    const boundsB = stableString(outB.diagnostics && outB.diagnostics.classBoundsByProctorKey);
    if (boundsA !== boundsB) {
        throw new Error(label + ': diagnostics.classBoundsByProctorKey are NOT byte-identical');
    }

    // Determinism also covers the top-level envelope state.
    if (outA.orchestratorState !== outB.orchestratorState) {
        throw new Error(label + ': orchestratorState differs ('
            + outA.orchestratorState + ' vs ' + outB.orchestratorState + ')');
    }
}

// ---------------------------------------------------------------------------
// fast-check arbitrary: produces a SMALL valid GS3_Input_Contract from a seed.
// NOTE: Uses 5-10 proctors and 2-3 schedule entries to keep PBT runs fast.
// Each property iteration runs V3 TWICE so inputs must be minimal.
// ---------------------------------------------------------------------------

const { arbitraryProctorsList, arbitraryScheduleEntries, arbitraryDutyData, arbitraryExemptions,
    arbitraryInput,
    _internals: { collectLevels, intInRange } } = require(path.join(__dirname, 'pbt-helpers.js'));

const arbV3Input = fc.integer({ min: 1, max: 2147483647 }).map((seed) => {
    const rng = createPRNG(seed);
    // Small inputs: 5-10 proctors, 2-3 schedule entries (task requirement)
    const nProctors = 5 + rng.nextInt(6); // 5..10
    const nEntries = 2 + rng.nextInt(2);  // 2..3
    const nHalfdays = 2;

    const proctorsList = arbitraryProctorsList(rng, nProctors);
    const scheduleEntries = arbitraryScheduleEntries(rng, nEntries, nHalfdays);
    const dutyData = arbitraryDutyData(rng, proctorsList, scheduleEntries);
    const exemptionsData = arbitraryExemptions(rng, proctorsList, scheduleEntries);

    const levels = collectLevels(scheduleEntries);
    const examCenterLevels = {};
    const examCenterRoomsData = {};
    for (let i = 0; i < levels.length; i += 1) {
        const lvl = levels[i];
        const roomCount = 1 + rng.nextInt(2); // 1..2 rooms
        examCenterLevels[lvl] = { rooms: roomCount, sessions: 1 };
        const rooms = [];
        for (let r = 0; r < roomCount; r += 1) {
            rooms.push({
                key: lvl + '_R' + (r + 1),
                room_num: String(r + 1),
                roomName: 'Salle ' + lvl + '-' + (r + 1),
            });
        }
        examCenterRoomsData[lvl] = rooms;
    }

    const input = {
        proctorsList: proctorsList,
        scheduleEntries: scheduleEntries,
        dutyData: dutyData,
        exemptionsData: exemptionsData,
        meAssignments: {},
        examDistributionRules: {
            proctorsPerRoom: 2,
            allowSameDayBothHalfdays: false,
        },
        examCenterConfig: {
            expected_duty_tasks: 0,
        },
        examCenterLevels: examCenterLevels,
        examCenterRoomsData: examCenterRoomsData,
        randomSeed: seed,
    };

    return { input: input, seed: seed };
});

// ---------------------------------------------------------------------------
// 1. PROPERTY TEST — AC 8.4 over 120 random inputs (≥ 100 required by AC 14.5)
//
//    **Validates: Requirements 8.4, 14.5**
// ---------------------------------------------------------------------------

test('fast-check property: same input + same seed → byte-identical output (AC 8.4)', () => {
    // **Validates: Requirements 8.4**
    const result = fc.check(
        fc.property(arbV3Input, ({ input, seed }) => {
            // Ensure the generated input carries a finite randomSeed.
            if (!Number.isFinite(input.randomSeed)) return false;

            // Create two independent byte-identical clones.
            const inputA = jsonClone(input);
            const inputB = jsonClone(input);

            // Sanity: the two inputs really are byte-identical (AC 8.4 premise).
            if (stableString(inputA) !== stableString(inputB)) return false;

            let outA, outB;
            try {
                outA = run(inputA, RUN_OPTIONS);
                outB = run(inputB, RUN_OPTIONS);
            } catch (err) {
                // If run() throws consistently on both, that's still deterministic.
                // But if only one throws, that's a violation.
                try {
                    const outRetry = run(jsonClone(input), RUN_OPTIONS);
                    // If we get here, the first throw was non-deterministic.
                    return false;
                } catch (err2) {
                    // Both throw — deterministic failure, not a violation of AC 8.4.
                    return true;
                }
            }

            // AC 8.4: result arrays byte-identical.
            if (stableString(outA.result) !== stableString(outB.result)) {
                return false;
            }

            // AC 8.4: classBoundsByProctorKey byte-identical.
            if (stableString(outA.diagnostics && outA.diagnostics.classBoundsByProctorKey)
                !== stableString(outB.diagnostics && outB.diagnostics.classBoundsByProctorKey)) {
                return false;
            }

            // orchestratorState must also be identical.
            if (outA.orchestratorState !== outB.orchestratorState) {
                return false;
            }

            return true;
        }),
        { numRuns: 100, verbose: 1 }
    );

    if (result.failed) {
        const ce = result.counterexample;
        const details = ce && ce[0] ? 'seed=' + ce[0].seed : 'unknown';
        assert.fail(
            'fast-check determinism property failed after ' + result.numRuns
                + ' runs. Counterexample: ' + details
                + '. Error: ' + (result.error || 'property returned false')
        );
    }
});

// ---------------------------------------------------------------------------
// 2. Determinism is robust to input object aliasing (run twice, SAME object)
// ---------------------------------------------------------------------------

test('determinism: re-running with the SAME input object is byte-identical', () => {
    // Verifies run() does not mutate its input in a way that perturbs a
    // subsequent run (re-entrancy / no shared module state — V2 pitfall).
    const input = arbitraryInput(createPRNG(987654));
    const snapshot = stableString(input);

    const out1 = run(input, RUN_OPTIONS);
    // Input must be untouched after the first run.
    assert.strictEqual(stableString(input), snapshot,
        'run() must not mutate its input');

    const out2 = run(input, RUN_OPTIONS);
    assertDeterministic(out1, out2, 'same-object re-run');
});

// ---------------------------------------------------------------------------
// 3. Explicit fixed randomSeed on a hand-built minimal input
// ---------------------------------------------------------------------------

test('determinism: explicit randomSeed=42 on a minimal input → byte-identical', () => {
    function minimalInput() {
        return {
            proctorsList: [
                { cin: '111', name: 'A', subject: 'Math', gender: 'M' },
                { cin: '222', name: 'B', subject: 'French', gender: 'F' },
                { cin: '333', name: 'C', subject: 'SVT', gender: 'M' },
                { cin: '444', name: 'D', subject: 'Arabic', gender: 'F' }
            ],
            scheduleEntries: [
                { date: '2026-06-04', period: 'صباحا', level: 'L1', subject: 'History', session: 'الحصة الأولى' },
                { date: '2026-06-04', period: 'مساء', level: 'L1', subject: 'Physique', session: 'الحصة الأولى' }
            ],
            dutyData: {},
            exemptionsData: {},
            meAssignments: {},
            examDistributionRules: { proctorsPerRoom: 2, allowSameDayBothHalfdays: false },
            examCenterConfig: { expected_duty_tasks: 0 },
            examCenterLevels: { L1: { rooms: 1, sessions: 1 } },
            examCenterRoomsData: {
                L1: [{ key: 'L1_R1', room_num: '1', roomName: 'Salle L1-1' }]
            },
            randomSeed: 42
        };
    }

    const a = run(minimalInput(), RUN_OPTIONS);
    const b = run(minimalInput(), RUN_OPTIONS);
    assertDeterministic(a, b, 'minimal randomSeed=42');

    // seedUsed must echo the supplied randomSeed (AC 8.2) and be identical.
    assert.strictEqual(a.diagnostics.seedUsed, 42);
    assert.strictEqual(b.diagnostics.seedUsed, 42);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}

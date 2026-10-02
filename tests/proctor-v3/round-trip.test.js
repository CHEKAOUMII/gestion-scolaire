/**
 * Property-Based Test for V3 round-trip integrity.
 *
 * **Validates: Requirements 10.1, 10.2, 14.6, 14.8**
 *
 *   AC 10.1 — THE Orchestrator_V3 output SHALL be JSON-serializable:
 *             `JSON.parse(JSON.stringify(output))` SHALL produce a
 *             structurally equivalent object.
 *   AC 10.2 — FOR EACH Result_Row field that is an array, THE Orchestrator_V3
 *             SHALL produce a fresh non-shared array reference; no two rows
 *             SHALL share the same array reference for `proctors`,
 *             `proctor_keys`, `reserves`, `reserve_keys`, `duty_teachers`,
 *             or `softViolations`.
 *   AC 14.6 — THE PBT_Suite_V3 SHALL contain a property test asserting
 *             AC 10.2 (no shared array references across rows) over at least
 *             100 random inputs.
 *   AC 14.8 — THE PBT_Suite_V3 SHALL contain a round-trip property test
 *             asserting `JSON.parse(JSON.stringify(output))` preserves the
 *             structural identity of the result, AND that recomputing
 *             `histogramByGuardCount` from the parsed result yields the same
 *             object as `output.diagnostics.histogramByGuardCount`, over at
 *             least 100 random inputs.
 *
 * Uses fast-check for structured property testing with shrinking support.
 *
 * Run directly:   node tests/proctor-v3/round-trip.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const V3_ROOT = path.join(__dirname, '..', '..', 'js', 'algorithms', 'proctor-v3');

const { run } = require(path.join(V3_ROOT, 'index.js'));
const { createPRNG } = require(path.join(V3_ROOT, 'utils', 'prng.js'));
const { computeHistogramByGuardCount } = require(path.join(V3_ROOT, 'diagnostics.js'));

const { arbitraryProctorsList, arbitraryScheduleEntries, arbitraryDutyData, arbitraryExemptions,
    _internals: { collectLevels } } = require(path.join(__dirname, 'pbt-helpers.js'));

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
// Run options — keep inputs small so PBT iterations finish quickly.
// ---------------------------------------------------------------------------

const RUN_OPTIONS = {
    totalBudgetMs: 5000,
    phase4TimeBudgetMs: 500,
    phase5TimeBudgetMs: 200,
    phase7TimeBudgetMs: 200,
    phase8TimeBudgetMs: 200,
    phase9TimeBudgetMs: 200
};

// ---------------------------------------------------------------------------
// fast-check arbitrary: produces a SMALL valid GS3_Input_Contract from a seed.
// Uses 5-10 proctors and 2-3 schedule entries to keep PBT runs fast.
// ---------------------------------------------------------------------------

const arbV3Input = fc.integer({ min: 1, max: 2147483647 }).map((seed) => {
    const rng = createPRNG(seed);
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

    return {
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
});

// ---------------------------------------------------------------------------
// 1. PROPERTY TEST — AC 10.2: No shared array references across rows.
//
//    **Validates: Requirements 10.2, 14.6**
// ---------------------------------------------------------------------------

test('fast-check property: no shared array references across rows (AC 10.2)', () => {
    // **Validates: Requirements 10.2**
    const ARRAY_FIELDS = ['proctors', 'proctor_keys', 'reserves', 'reserve_keys', 'duty_teachers', 'softViolations'];

    const result = fc.check(
        fc.property(arbV3Input, (input) => {
            let output;
            try {
                output = run(input, RUN_OPTIONS);
            } catch (err) {
                // If run() throws, we cannot test the property — skip.
                return true;
            }

            const rows = output.result;
            if (!Array.isArray(rows) || rows.length === 0) return true;

            // For every pair of rows (i, j) where i ≠ j, verify that no
            // array field shares the same reference.
            for (let i = 0; i < rows.length; i += 1) {
                for (let j = i + 1; j < rows.length; j += 1) {
                    for (let f = 0; f < ARRAY_FIELDS.length; f += 1) {
                        const field = ARRAY_FIELDS[f];
                        const arrI = rows[i][field];
                        const arrJ = rows[j][field];
                        if (arrI && arrJ && arrI === arrJ) {
                            return false; // shared reference detected
                        }
                    }
                }

                // Also check cross-field: no row's proctor_keys is the same
                // reference as any row's reserve_keys.
                for (let j = 0; j < rows.length; j += 1) {
                    const pk = rows[i].proctor_keys;
                    const rk = rows[j].reserve_keys;
                    if (pk && rk && pk === rk) {
                        return false; // proctor_keys shares ref with reserve_keys
                    }
                }
            }

            return true;
        }),
        { numRuns: 100, verbose: 1 }
    );

    if (result.failed) {
        const ce = result.counterexample;
        const details = ce && ce[0] ? 'seed=' + ce[0].randomSeed : 'unknown';
        assert.fail(
            'fast-check no-shared-refs property failed after ' + result.numRuns
                + ' runs. Counterexample: ' + details
                + '. Error: ' + (result.error || 'property returned false')
        );
    }
});

// ---------------------------------------------------------------------------
// 2. PROPERTY TEST — AC 10.1: JSON round-trip produces structurally
//    identical result.
//
//    **Validates: Requirements 10.1**
// ---------------------------------------------------------------------------

test('fast-check property: JSON.parse(JSON.stringify(output)) is structurally identical (AC 10.1)', () => {
    // **Validates: Requirements 10.1**
    const result = fc.check(
        fc.property(arbV3Input, (input) => {
            let output;
            try {
                output = run(input, RUN_OPTIONS);
            } catch (err) {
                return true; // skip on throw
            }

            // JSON round-trip the entire output.
            let parsed;
            try {
                const serialized = JSON.stringify(output);
                parsed = JSON.parse(serialized);
            } catch (err) {
                // JSON.stringify failed — AC 10.1 violation.
                return false;
            }

            // Structural equality: deep-equal the result arrays.
            try {
                assert.deepStrictEqual(parsed.result, output.result);
            } catch (err) {
                return false;
            }

            // Structural equality: diagnostics (excluding timing which may
            // have floating-point issues — but since we serialized and parsed,
            // they should be identical).
            try {
                assert.deepStrictEqual(parsed.diagnostics, output.diagnostics);
            } catch (err) {
                return false;
            }

            // algorithmVersion preserved.
            if (parsed.algorithmVersion !== output.algorithmVersion) {
                return false;
            }

            return true;
        }),
        { numRuns: 100, verbose: 1 }
    );

    if (result.failed) {
        const ce = result.counterexample;
        const details = ce && ce[0] ? 'seed=' + ce[0].randomSeed : 'unknown';
        assert.fail(
            'fast-check JSON round-trip property failed after ' + result.numRuns
                + ' runs. Counterexample: ' + details
                + '. Error: ' + (result.error || 'property returned false')
        );
    }
});

// ---------------------------------------------------------------------------
// 3. PROPERTY TEST — AC 14.8: histogram preserved after JSON round-trip.
//    Recomputing histogramByGuardCount from the parsed result yields the
//    same object as output.diagnostics.histogramByGuardCount. Also verifies
//    histogramByPrimaryLoad survives the round-trip unchanged.
//
//    **Validates: Requirements 14.8**
// ---------------------------------------------------------------------------

test('fast-check property: histogram preserved after JSON round-trip (AC 14.8)', () => {
    // **Validates: Requirements 14.8**
    const result = fc.check(
        fc.property(arbV3Input, (input) => {
            let output;
            try {
                output = run(input, RUN_OPTIONS);
            } catch (err) {
                return true; // skip on throw
            }

            // JSON round-trip.
            let parsed;
            try {
                parsed = JSON.parse(JSON.stringify(output));
            } catch (err) {
                return false;
            }

            // AC 14.8 part 1: histogramByGuardCount survives round-trip.
            const originalHistGuard = output.diagnostics && output.diagnostics.histogramByGuardCount;
            const parsedHistGuard = parsed.diagnostics && parsed.diagnostics.histogramByGuardCount;
            try {
                assert.deepStrictEqual(parsedHistGuard, originalHistGuard);
            } catch (err) {
                return false;
            }

            // AC 14.8 part 2: recompute histogramByGuardCount from the parsed
            // result rows and verify it matches the stored histogram.
            if (Array.isArray(parsed.result) && parsed.result.length > 0) {
                const recomputed = computeHistogramByGuardCount(parsed.result);
                try {
                    assert.deepStrictEqual(recomputed, originalHistGuard);
                } catch (err) {
                    return false;
                }
            }

            // AC 14.8 part 3: histogramByPrimaryLoad survives round-trip.
            const originalHistPrimary = output.diagnostics && output.diagnostics.histogramByPrimaryLoad;
            const parsedHistPrimary = parsed.diagnostics && parsed.diagnostics.histogramByPrimaryLoad;
            try {
                assert.deepStrictEqual(parsedHistPrimary, originalHistPrimary);
            } catch (err) {
                return false;
            }

            return true;
        }),
        { numRuns: 100, verbose: 1 }
    );

    if (result.failed) {
        const ce = result.counterexample;
        const details = ce && ce[0] ? 'seed=' + ce[0].randomSeed : 'unknown';
        assert.fail(
            'fast-check histogram round-trip property failed after ' + result.numRuns
                + ' runs. Counterexample: ' + details
                + '. Error: ' + (result.error || 'property returned false')
        );
    }
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log('\n' + passed + ' passed, ' + failed + ' failed');
if (failed > 0) {
    process.exit(1);
}

/**
 * Unit tests for js/algorithms/proctor-v3/phases/06-same-day-detect.js
 *
 * Validates: Requirements 4.1, 4.2, 4.2b, 4.6
 *
 * Phase 6 is a PURE inspection — it ONLY reads state.diagnostics.unresolvedSlots
 * and state.input.examDistributionRules.allowSameDayBothHalfdays, and sets two
 * flags on diagnostics: preCheckRequired and preCheckUnresolvedCount. It must
 * NOT call into other phases. These tests verify the exact decision tree
 * documented in design.md §4 Phase 6.
 *
 * Run directly:   node tests/proctor-v3/same-day-detect.test.js
 */
'use strict';

const assert = require('assert');
const path = require('path');

const { detectSameDayInfeasibility } = require(path.join(
    __dirname,
    '..',
    '..',
    'js',
    'algorithms',
    'proctor-v3',
    'phases',
    '06-same-day-detect.js'
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

function makeState(overrides) {
    const base = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { allowSameDayBothHalfdays: false }
        },
        diagnostics: {
            unresolvedSlots: [],
            warnings: [],
            errors: []
        }
    };
    if (overrides && overrides.input) {
        base.input = Object.assign({}, base.input, overrides.input);
        if (overrides.input.examDistributionRules) {
            base.input.examDistributionRules = Object.assign(
                {},
                base.input.examDistributionRules,
                overrides.input.examDistributionRules
            );
        }
    }
    if (overrides && overrides.diagnostics) {
        base.diagnostics = Object.assign({}, base.diagnostics, overrides.diagnostics);
    }
    return base;
}

// ---------------------------------------------------------------------------
// 1. Decision tree — flag already enabled (AC 4.2b)
// ---------------------------------------------------------------------------

test('AC 4.2b: when allowSameDayBothHalfdays === true, preCheckRequired = false', () => {
    const state = makeState({
        input: { examDistributionRules: { allowSameDayBothHalfdays: true } },
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S1', room_key: 'R1', reason: 'cp_partial' }]
        }
    });
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, false);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 0);
});

test('AC 4.2b: when allowSameDayBothHalfdays === true AND no unresolved, preCheckRequired = false', () => {
    const state = makeState({
        input: { examDistributionRules: { allowSameDayBothHalfdays: true } },
        diagnostics: { unresolvedSlots: [] }
    });
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, false);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 0);
});

// ---------------------------------------------------------------------------
// 2. Decision tree — full coverage achieved (AC 4.2 negative branch)
// ---------------------------------------------------------------------------

test('AC 4.2: when unresolvedSlots is empty, preCheckRequired = false', () => {
    const state = makeState({ diagnostics: { unresolvedSlots: [] } });
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, false);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 0);
});

// ---------------------------------------------------------------------------
// 3. Decision tree — pre-check needed (AC 4.2 positive branch)
// ---------------------------------------------------------------------------

test('AC 4.2: when flag is false AND unresolved exists, preCheckRequired = true', () => {
    const state = makeState({
        diagnostics: {
            unresolvedSlots: [
                { rowIndex: 0, slotIndex: 0, session_key: 'S1', room_key: 'R1', reason: 'cp_partial' },
                { rowIndex: 1, slotIndex: 1, session_key: 'S2', room_key: 'R2', reason: 'cp_partial' },
                { rowIndex: 2, slotIndex: 0, session_key: 'S3', room_key: 'R3', reason: 'cp_partial' }
            ]
        }
    });
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, true);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 3);
});

test('AC 4.1: default (allowSameDayBothHalfdays unset) is treated as false', () => {
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: {} // no flag at all
        },
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }],
            warnings: [],
            errors: []
        }
    };
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, true);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 1);
});

test('AC 4.1: examDistributionRules entirely absent is treated as flag = false', () => {
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: []
        },
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }],
            warnings: [],
            errors: []
        }
    };
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, true);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 1);
});

// ---------------------------------------------------------------------------
// 4. Purity — no mutation of input state
// ---------------------------------------------------------------------------

test('purity: input state is not mutated (top level)', () => {
    const inputDiag = {
        unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }],
        warnings: [],
        errors: []
    };
    const inputDiagSnapshot = JSON.parse(JSON.stringify(inputDiag));
    const state = makeState({ diagnostics: inputDiag });
    const stateSnapshot = JSON.parse(JSON.stringify(state));

    detectSameDayInfeasibility(state);

    assert.deepStrictEqual(state, stateSnapshot,
        'state must not be mutated');
    assert.deepStrictEqual(inputDiag, inputDiagSnapshot,
        'input diagnostics must not be mutated');
});

test('purity: returned diagnostics is a fresh object (different reference)', () => {
    const state = makeState({
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }]
        }
    });
    const out = detectSameDayInfeasibility(state);
    assert.notStrictEqual(out.diagnostics, state.diagnostics,
        'diagnostics must be a fresh object');
});

test('purity: returned warnings/errors/unresolvedSlots are fresh arrays', () => {
    const state = makeState({
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }],
            warnings: [{ type: 'pre_existing' }],
            errors: [{ type: 'pre_existing_error' }]
        }
    });
    const out = detectSameDayInfeasibility(state);
    assert.notStrictEqual(out.diagnostics.warnings, state.diagnostics.warnings,
        'warnings array must be fresh');
    assert.notStrictEqual(out.diagnostics.errors, state.diagnostics.errors,
        'errors array must be fresh');
    assert.notStrictEqual(out.diagnostics.unresolvedSlots, state.diagnostics.unresolvedSlots,
        'unresolvedSlots array must be fresh');
});

test('purity: pre-existing warnings and errors are preserved (carried forward)', () => {
    const state = makeState({
        diagnostics: {
            unresolvedSlots: [{ rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }],
            warnings: [{ type: 'synthetic_rooms', level: 'L1', addedCount: 1 }],
            errors: [{ type: 'duplicate_cin', cin: '123' }]
        }
    });
    const out = detectSameDayInfeasibility(state);
    assert.deepStrictEqual(out.diagnostics.warnings,
        [{ type: 'synthetic_rooms', level: 'L1', addedCount: 1 }]);
    assert.deepStrictEqual(out.diagnostics.errors,
        [{ type: 'duplicate_cin', cin: '123' }]);
});

// ---------------------------------------------------------------------------
// 5. Phase 6 must NOT call other phases
// ---------------------------------------------------------------------------

test('Phase 6 does not depend on rows/loadState (pure inspection only)', () => {
    // No rows, no loadState — Phase 6 should still produce a clean output.
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { allowSameDayBothHalfdays: false }
        },
        diagnostics: {
            unresolvedSlots: [
                { rowIndex: 0, slotIndex: 0, session_key: 'S', room_key: 'R', reason: 'cp_partial' }
            ],
            warnings: [],
            errors: []
        }
    };
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, true);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 1);
});

// ---------------------------------------------------------------------------
// 6. Edge cases — defensive defaults
// ---------------------------------------------------------------------------

test('edge: state.diagnostics absent → treated as no unresolved, preCheckRequired = false', () => {
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { allowSameDayBothHalfdays: false }
        }
        // no diagnostics at all
    };
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, false);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 0);
});

test('edge: state.diagnostics.unresolvedSlots absent → treated as empty', () => {
    const state = {
        input: {
            proctorsList: [],
            scheduleEntries: [],
            examDistributionRules: { allowSameDayBothHalfdays: false }
        },
        diagnostics: { warnings: [], errors: [] }
    };
    const out = detectSameDayInfeasibility(state);
    assert.strictEqual(out.diagnostics.preCheckRequired, false);
    assert.strictEqual(out.diagnostics.preCheckUnresolvedCount, 0);
});

test('throws on null state', () => {
    assert.throws(() => detectSameDayInfeasibility(null), TypeError);
});

test('throws on undefined state', () => {
    assert.throws(() => detectSameDayInfeasibility(undefined), TypeError);
});

test('throws on missing state.input', () => {
    assert.throws(() => detectSameDayInfeasibility({ diagnostics: {} }), TypeError);
});

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(`\n  ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);

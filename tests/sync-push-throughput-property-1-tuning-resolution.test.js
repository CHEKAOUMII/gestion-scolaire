'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 1.2 — Property 1: Tuning resolution invariants
//
// **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.8, 9.2, 9.3**
//
// Exercises the REAL exported `resolvePushTuning` from main/sync/engine.js
// across the full input space (absent, non-numeric, non-integer, out-of-range,
// and valid values) and asserts the documented invariants hold for every input.
//
// Feature: sync-push-throughput-optimization, Property 1: For any sync_config
// (including absent, non-numeric, non-integer, out-of-range, or valid values),
// resolvePushTuning returns tuning such that 1 <= initialConcurrency <=
// maxConcurrency <= 50, with initialConcurrency = 10 when push_concurrency is
// invalid, maxConcurrency = 20 when push_concurrency_max is invalid,
// initialConcurrency clamped down to maxConcurrency when configured higher, and
// batchedFastPathEnabled = false when its key is absent or non-boolean.

const assert = require('assert');
const fc = require('fast-check');

const { resolvePushTuning } = require('../main/sync/engine');

const MIN_RUNS = 300;
const ABSOLUTE_CEILING = 50;
const DEFAULT_INITIAL = 10;
const DEFAULT_MAX = 20;

// ---------------------------------------------------------------------------
// Independent reference predicates mirroring the DOCUMENTED resolution rules
// (design.md "Config resolution" + Requirements 2.x / 7.8 / 9.3). These are
// derived from the spec, not copied from the implementation under test, so they
// can disagree with a buggy implementation.
// ---------------------------------------------------------------------------

// A documented-valid integer config value (used for push_concurrency / _max):
// must parse to an integer and be >= 1; otherwise the default applies.
function refParseInteger(v) {
    if (typeof v === 'number') return Number.isInteger(v) ? v : null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '' || !/^[+-]?\d+$/.test(t)) return null;
        const n = Number(t);
        return Number.isInteger(n) ? n : null;
    }
    return null;
}

function refValidInt(v) {
    const p = refParseInteger(v);
    return p != null && p >= 1;
}

// Documented truthy parse for push_batched_fast_path_enabled (SQLite-style).
function refParseBoolean(v) {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'number') return v === 1;
    if (typeof v === 'string') {
        const n = v.trim().toLowerCase();
        return n === '1' || n === 'true';
    }
    return false;
}

// ---------------------------------------------------------------------------
// Smart generators: each tuning key spans the full documented input space —
// absent, valid in-range, valid-but-over-ceiling, sub-1, non-integer floats,
// numeric strings, junk strings, booleans, null, NaN.
// ---------------------------------------------------------------------------

const intLikeValue = fc.oneof(
    fc.integer({ min: 1, max: 50 }), // valid in-range
    fc.integer({ min: 51, max: 200 }), // valid but above the ceiling
    fc.integer({ min: -50, max: 0 }), // < 1 -> invalid
    fc.integer({ min: -50, max: 200 }).map((n) => String(n)), // numeric strings
    fc.double({ min: -10, max: 80, noNaN: true }).filter((n) => !Number.isInteger(n)), // non-integer floats
    fc.constantFrom('abc', '', '   ', '1.5', '10px', 'true', null, NaN, true, false, undefined)
);

const boolLikeValue = fc.oneof(
    fc.constantFrom(true, false, 1, 0, '1', '0', 'true', 'false', 'TRUE', 'yes', 'no', '', null, undefined),
    fc.integer(),
    fc.string()
);

// Build a config where each key is independently present or absent.
function configArb() {
    return fc.record(
        {
            push_concurrency: fc.option(intLikeValue, { nil: undefined }),
            push_concurrency_max: fc.option(intLikeValue, { nil: undefined }),
            push_batch_size: fc.option(intLikeValue, { nil: undefined }),
            push_backlog_batch_size: fc.option(intLikeValue, { nil: undefined }),
            push_batched_fast_path_enabled: fc.option(boolLikeValue, { nil: undefined })
        },
        { requiredKeys: [] }
    );
}

console.log('[pbt] sync-push-throughput Property 1: tuning resolution invariants');

let checks = 0;

fc.assert(
    fc.property(configArb(), (cfg) => {
        const t = resolvePushTuning(cfg);

        // --- Universal invariants (Req 2.6, 2.7, 7.8, 9.2, 9.3) ---
        assert.ok(Number.isInteger(t.initialConcurrency), 'initialConcurrency must be an integer');
        assert.ok(Number.isInteger(t.maxConcurrency), 'maxConcurrency must be an integer');
        assert.ok(t.maxConcurrency >= 1, 'maxConcurrency must be >= 1');
        assert.ok(t.maxConcurrency <= ABSOLUTE_CEILING, 'maxConcurrency must be <= absolute ceiling 50');
        assert.ok(t.initialConcurrency >= 1, 'initialConcurrency must be >= 1');
        assert.ok(
            t.initialConcurrency <= t.maxConcurrency,
            'initialConcurrency must be clamped to <= maxConcurrency'
        );
        assert.strictEqual(
            typeof t.batchedFastPathEnabled,
            'boolean',
            'batchedFastPathEnabled must be a boolean'
        );

        // --- maxConcurrency resolution (Req 2.3, 2.4, 2.7) ---
        const expectedMax = refValidInt(cfg.push_concurrency_max)
            ? Math.min(refParseInteger(cfg.push_concurrency_max), ABSOLUTE_CEILING)
            : DEFAULT_MAX;
        assert.strictEqual(
            t.maxConcurrency,
            expectedMax,
            `maxConcurrency mismatch for ${JSON.stringify(cfg.push_concurrency_max)}`
        );

        // --- initialConcurrency resolution + clamp-down (Req 2.1, 2.2, 2.5, 2.6) ---
        const baseInitial = refValidInt(cfg.push_concurrency)
            ? refParseInteger(cfg.push_concurrency)
            : DEFAULT_INITIAL;
        const expectedInitial = Math.max(1, Math.min(baseInitial, expectedMax));
        assert.strictEqual(
            t.initialConcurrency,
            expectedInitial,
            `initialConcurrency mismatch for ${JSON.stringify(cfg.push_concurrency)} / max=${expectedMax}`
        );

        // --- batchedFastPathEnabled (Req 7.8, 9.3) ---
        const expectedBool = refParseBoolean(cfg.push_batched_fast_path_enabled);
        assert.strictEqual(
            t.batchedFastPathEnabled,
            expectedBool,
            `batchedFastPathEnabled mismatch for ${JSON.stringify(cfg.push_batched_fast_path_enabled)}`
        );

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// Targeted anchors for the two "default-on-invalid" clauses, independent of the
// random sub-domain hitting them (Req 2.2, 2.4).
{
    const tInvalid = resolvePushTuning({ push_concurrency: 'nope', push_concurrency_max: -3 });
    assert.strictEqual(tInvalid.maxConcurrency, DEFAULT_MAX, 'invalid push_concurrency_max -> default 20');
    assert.strictEqual(tInvalid.initialConcurrency, DEFAULT_INITIAL, 'invalid push_concurrency -> default 10');

    const tAbsent = resolvePushTuning({});
    assert.strictEqual(tAbsent.maxConcurrency, DEFAULT_MAX, 'absent push_concurrency_max -> default 20');
    assert.strictEqual(tAbsent.initialConcurrency, DEFAULT_INITIAL, 'absent push_concurrency -> default 10');
    assert.strictEqual(tAbsent.batchedFastPathEnabled, false, 'absent fast-path flag -> false');

    // initial configured above max clamps down (Req 2.5).
    const tClamp = resolvePushTuning({ push_concurrency: 40, push_concurrency_max: 12 });
    assert.strictEqual(tClamp.maxConcurrency, 12, 'max stays at configured 12');
    assert.strictEqual(tClamp.initialConcurrency, 12, 'initial clamps down to max 12');

    // configured max above ceiling clamps to 50 (Req 2.7).
    const tCeil = resolvePushTuning({ push_concurrency: 99, push_concurrency_max: 99 });
    assert.strictEqual(tCeil.maxConcurrency, ABSOLUTE_CEILING, 'max clamps to ceiling 50');
    assert.strictEqual(tCeil.initialConcurrency, ABSOLUTE_CEILING, 'initial clamps to ceiling 50');
}

console.log(`[pass] Property 1 held across ${checks} generated configs + 4 anchors`);

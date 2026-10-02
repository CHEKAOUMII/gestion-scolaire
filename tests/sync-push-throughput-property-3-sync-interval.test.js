'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 1.4 — Property 3: Sync interval clamp
//
// **Validates: Requirements 9.6**
//
// Exercises the REAL exported `resolveSyncIntervalMinutes` from
// main/sync/engine.js across the full input space.
//
// NOTE (per Req 9.6 / Property 3): the value defaults to 5 when it is absent OR
// out of the inclusive range [1, 30]. Out-of-range values resolve to 5 — they
// are NOT clamped to the nearest bound. In-range values pass through unchanged
// (including non-integer minutes). The assertions below follow that literal
// reading.
//
// Feature: sync-push-throughput-optimization, Property 3: For any
// sync_config.sync_interval_minutes value, the resolved background interval is
// the value clamped to the inclusive range [1, 30], defaulting to 5 when absent
// or out of range.

const assert = require('assert');
const fc = require('fast-check');

const { resolveSyncIntervalMinutes } = require('../main/sync/engine');

const MIN_RUNS = 300;
const MIN_INTERVAL = 1;
const MAX_INTERVAL = 30;
const DEFAULT_INTERVAL = 5;

// Independent reference parse (design.md "Background timer" + Req 9.6).
function refParseNumber(v) {
    if (typeof v === 'number') return Number.isFinite(v) ? v : null;
    if (typeof v === 'string') {
        const t = v.trim();
        if (t === '') return null;
        const n = Number(t);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}

// Smart generator: spans in-range integers, in-range floats, below-1,
// above-30, numeric strings, and junk / absent values.
const intervalLike = fc.oneof(
    fc.integer({ min: MIN_INTERVAL, max: MAX_INTERVAL }), // valid in-range
    fc.double({ min: 1, max: 30, noNaN: true }), // in-range floats (pass through)
    fc.double({ min: -100, max: 0.999, noNaN: true }), // below 1 -> default
    fc.double({ min: 30.0001, max: 1000, noNaN: true }), // above 30 -> default
    fc.integer({ min: -100, max: 1000 }).map((n) => String(n)), // numeric strings
    fc.constantFrom('abc', '', '   ', '5min', null, NaN, true, false, undefined)
);

function configArb() {
    return fc.record(
        { sync_interval_minutes: fc.option(intervalLike, { nil: undefined }) },
        { requiredKeys: [] }
    );
}

console.log('[pbt] sync-push-throughput Property 3: sync interval clamp');

let checks = 0;

fc.assert(
    fc.property(configArb(), (cfg) => {
        const result = resolveSyncIntervalMinutes(cfg);

        const parsed = refParseNumber(cfg.sync_interval_minutes);
        const inRange = parsed != null && parsed >= MIN_INTERVAL && parsed <= MAX_INTERVAL;
        const expected = inRange ? parsed : DEFAULT_INTERVAL;

        assert.strictEqual(
            result,
            expected,
            `interval mismatch for ${JSON.stringify(cfg.sync_interval_minutes)}`
        );

        // Universal invariant: result is always within [1, 30].
        assert.ok(result >= MIN_INTERVAL && result <= MAX_INTERVAL, 'result must be within [1, 30]');

        // Literal-reading invariant: out-of-range values resolve to exactly 5,
        // NOT to the nearest bound.
        if (parsed != null && (parsed < MIN_INTERVAL || parsed > MAX_INTERVAL)) {
            assert.strictEqual(result, DEFAULT_INTERVAL, 'out-of-range must resolve to 5, not the nearest bound');
        }

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// Targeted anchors (Req 9.6).
assert.strictEqual(resolveSyncIntervalMinutes({}), DEFAULT_INTERVAL, 'absent -> default 5');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: 0 }), DEFAULT_INTERVAL, '0 (below 1) -> 5, not 1');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: 31 }), DEFAULT_INTERVAL, '31 (above 30) -> 5, not 30');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: 1 }), 1, '1 (lower bound) passes through');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: 30 }), 30, '30 (upper bound) passes through');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: '15' }), 15, 'numeric string passes through');
assert.strictEqual(resolveSyncIntervalMinutes({ sync_interval_minutes: 'abc' }), DEFAULT_INTERVAL, 'junk -> default 5');

console.log(`[pass] Property 3 held across ${checks} generated values + anchors`);

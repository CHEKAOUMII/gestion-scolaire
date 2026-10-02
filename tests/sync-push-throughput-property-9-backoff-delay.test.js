'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 2.3 — Property 9: Back-off delay formula
//
// **Validates: Requirements 3.5**
//
// Exercises the REAL exported `createRateLimiter` from main/sync/engine.js and
// asserts the exponential back-off formula holds for every consecutive-throttle
// count n >= 1. The counter is advanced by driving real onThrottle() calls so
// the public surface (not an injected field) is what is validated.
//
// Feature: sync-push-throughput-optimization, Property 9: For any
// consecutive-throttle count n >= 1, the back-off delay equals
// min(1000 * 2^(n-1), 60000) milliseconds.

const assert = require('assert');
const fc = require('fast-check');

const { createRateLimiter } = require('../main/sync/engine');

const MIN_RUNS = 300;
const BASE_MS = 1000;
const MAX_MS = 60000;

// Documented reference formula (design.md + Req 3.5), derived from the spec.
function refBackoff(n) {
    return Math.min(BASE_MS * Math.pow(2, n - 1), MAX_MS);
}

// ---------------------------------------------------------------------------
// Smart generator: n spans 1..40 — well past the point where 1000 * 2^(n-1)
// saturates the 60000 ms cap (cap is hit at n = 7), so both the growing and the
// clamped regimes are exercised.
// ---------------------------------------------------------------------------
const throttleCountArb = fc.integer({ min: 1, max: 40 });

console.log('[pbt] sync-push-throughput Property 9: back-off delay formula');

let checks = 0;

fc.assert(
    fc.property(throttleCountArb, (n) => {
        const limiter = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });

        // Advance the consecutive-throttle counter to n via real transitions.
        for (let i = 0; i < n; i += 1) {
            limiter.onThrottle();
        }
        assert.strictEqual(limiter.consecutiveThrottles, n, 'counter must reflect n throttles');

        const expected = refBackoff(n);
        assert.strictEqual(
            limiter.backoffDelayMs(),
            expected,
            `backoffDelayMs() mismatch at n=${n}: expected ${expected}`
        );

        // Universal bounds (Req 3.5): delay is positive for n >= 1 and never
        // exceeds the 60000 ms cap.
        const d = limiter.backoffDelayMs();
        assert.ok(d >= BASE_MS, `delay must be >= ${BASE_MS} for n >= 1`);
        assert.ok(d <= MAX_MS, `delay must be capped at ${MAX_MS}`);

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors for the formula and the cap boundary.
// ---------------------------------------------------------------------------
{
    const l = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });

    // n = 0: no throttling yet -> no back-off.
    assert.strictEqual(l.backoffDelayMs(), 0, 'n=0 -> 0 ms (no back-off before any throttle)');

    l.onThrottle(); // n = 1
    assert.strictEqual(l.backoffDelayMs(), 1000, 'n=1 -> 1000 ms');
    l.onThrottle(); // n = 2
    assert.strictEqual(l.backoffDelayMs(), 2000, 'n=2 -> 2000 ms');
    l.onThrottle(); // n = 3
    assert.strictEqual(l.backoffDelayMs(), 4000, 'n=3 -> 4000 ms');
    l.onThrottle(); // n = 4
    assert.strictEqual(l.backoffDelayMs(), 8000, 'n=4 -> 8000 ms');
    l.onThrottle(); // n = 5
    assert.strictEqual(l.backoffDelayMs(), 16000, 'n=5 -> 16000 ms');
    l.onThrottle(); // n = 6
    assert.strictEqual(l.backoffDelayMs(), 32000, 'n=6 -> 32000 ms');
    l.onThrottle(); // n = 7 -> 64000 capped to 60000
    assert.strictEqual(l.backoffDelayMs(), 60000, 'n=7 -> 64000 capped to 60000 ms');
    l.onThrottle(); // n = 8 -> still capped
    assert.strictEqual(l.backoffDelayMs(), 60000, 'n=8 -> remains capped at 60000 ms');

    // Recovery resets the counter, so back-off returns to 0 (Req 3.6 interaction).
    l.onGroupSuccess();
    assert.strictEqual(l.backoffDelayMs(), 0, 'after recovery -> 0 ms');
}

console.log(`[pass] Property 9 held across ${checks} generated throttle counts + boundary anchors`);

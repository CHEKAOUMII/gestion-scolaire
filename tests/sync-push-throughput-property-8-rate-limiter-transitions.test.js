'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 2.2 — Property 8: Rate-limiter transitions and bounds
//
// **Validates: Requirements 2.6, 3.1, 3.2, 3.3, 3.4, 3.6**
//
// Exercises the REAL exported `createRateLimiter` from main/sync/engine.js by
// driving random sequences of onGroupSuccess()/onThrottle() events and asserting
// the documented transition semantics and bounds hold after EVERY event.
//
// Feature: sync-push-throughput-optimization, Property 8: For any sequence of
// group results (each either "clean" or "throttled") applied to a rate limiter,
// the active concurrency limit stays within [1, maxConcurrency] after every
// event; a clean group increases it by exactly 5 up to but never beyond the cap
// and resets the consecutive-throttle counter to zero; a throttled group sets it
// to max(1, floor(active/2)) and increments the consecutive-throttle counter.

const assert = require('assert');
const fc = require('fast-check');

const { createRateLimiter } = require('../main/sync/engine');

const MIN_RUNS = 300;
const RAMP_STEP = 5;

// ---------------------------------------------------------------------------
// Smart generators
// ---------------------------------------------------------------------------
// Tuning spans the full valid [1, 50] integer space for both initial and max,
// including the case initial > max (which must clamp down at construction).
// Event sequences mix clean/throttle arbitrarily and run long enough to drive
// the active limit to both the floor (1) and the cap repeatedly.

const tuningArb = fc.record({
    initialConcurrency: fc.integer({ min: 1, max: 50 }),
    maxConcurrency: fc.integer({ min: 1, max: 50 })
});

const eventArb = fc.constantFrom('clean', 'throttle');
const eventSeqArb = fc.array(eventArb, { minLength: 0, maxLength: 60 });

console.log('[pbt] sync-push-throughput Property 8: rate-limiter transitions and bounds');

let checks = 0;

fc.assert(
    fc.property(tuningArb, eventSeqArb, (tuning, events) => {
        const limiter = createRateLimiter(tuning);

        // Independent reference model derived from the DOCUMENTED rules
        // (design.md Rate_Limiter + Req 2.6, 3.1, 3.2, 3.3, 3.4, 3.6), not copied
        // from the implementation under test.
        const max = tuning.maxConcurrency;
        const clamp = (v) => Math.max(1, Math.min(v, max));
        let modelActive = clamp(tuning.initialConcurrency);
        let modelThrottles = 0;

        // --- Initial state (Req 3.1, 2.6) ---
        assert.strictEqual(limiter.max, max, 'limiter.max must equal configured maxConcurrency');
        assert.strictEqual(
            limiter.active,
            modelActive,
            'initial active must be the configured initial clamped into [1, max]'
        );
        assert.strictEqual(limiter.consecutiveThrottles, 0, 'initial consecutiveThrottles must be 0');
        assert.ok(limiter.active >= 1 && limiter.active <= max, 'initial active within [1, max]');

        for (const ev of events) {
            const prevActive = limiter.active;
            const prevThrottles = limiter.consecutiveThrottles;

            if (ev === 'clean') {
                limiter.onGroupSuccess();

                // Reference: ramp by exactly +5, never beyond the cap (Req 3.2, 3.3).
                modelActive = clamp(modelActive + RAMP_STEP);
                modelThrottles = 0;

                // Direct transition assertions (Req 3.2, 3.3, 3.6).
                assert.strictEqual(
                    limiter.active,
                    Math.min(prevActive + RAMP_STEP, max),
                    'clean group: active = min(prev + 5, max)'
                );
                assert.ok(limiter.active <= max, 'clean group never exceeds cap');
                assert.ok(
                    limiter.active >= prevActive && limiter.active <= prevActive + RAMP_STEP,
                    'clean group raises active by at most 5, never below the previous value (cap may truncate the final step)'
                );
                assert.strictEqual(
                    limiter.consecutiveThrottles,
                    0,
                    'clean group resets consecutiveThrottles to 0'
                );
            } else {
                limiter.onThrottle();

                // Reference: halve with a floor of 1, bump throttle counter (Req 3.4).
                modelActive = Math.max(1, Math.floor(modelActive / 2));
                modelThrottles += 1;

                // Direct transition assertions (Req 3.4).
                assert.strictEqual(
                    limiter.active,
                    Math.max(1, Math.floor(prevActive / 2)),
                    'throttled group: active = max(1, floor(prev / 2))'
                );
                assert.strictEqual(
                    limiter.consecutiveThrottles,
                    prevThrottles + 1,
                    'throttled group increments consecutiveThrottles by 1'
                );
            }

            // --- Universal bound after every event (Req 2.6) ---
            assert.ok(
                limiter.active >= 1 && limiter.active <= max,
                `active out of [1, ${max}] after ${ev}: ${limiter.active}`
            );

            // --- Lockstep with the independent model ---
            assert.strictEqual(limiter.active, modelActive, 'active diverged from reference model');
            assert.strictEqual(
                limiter.consecutiveThrottles,
                modelThrottles,
                'consecutiveThrottles diverged from reference model'
            );
        }

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors for the boundary transitions, independent of the random
// sub-domain hitting them.
// ---------------------------------------------------------------------------
{
    // Ramp holds at the cap, never beyond (Req 3.3).
    const l = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });
    assert.strictEqual(l.active, 10);
    l.onGroupSuccess();
    assert.strictEqual(l.active, 15, 'ramp 10 -> 15');
    l.onGroupSuccess();
    assert.strictEqual(l.active, 20, 'ramp 15 -> 20 (cap)');
    l.onGroupSuccess();
    assert.strictEqual(l.active, 20, 'ramp holds at cap 20');

    // Throttle halves with a floor of 1 and counts up (Req 3.4).
    l.onThrottle();
    assert.strictEqual(l.active, 10, 'throttle 20 -> 10');
    assert.strictEqual(l.consecutiveThrottles, 1);
    l.onThrottle();
    assert.strictEqual(l.active, 5, 'throttle 10 -> 5');
    l.onThrottle();
    assert.strictEqual(l.active, 2, 'throttle 5 -> floor(5/2)=2');
    l.onThrottle();
    assert.strictEqual(l.active, 1, 'throttle 2 -> 1');
    l.onThrottle();
    assert.strictEqual(l.active, 1, 'throttle 1 -> floor stays at 1');
    assert.strictEqual(l.consecutiveThrottles, 5);

    // Recovery resets the throttle counter (Req 3.6).
    l.onGroupSuccess();
    assert.strictEqual(l.consecutiveThrottles, 0, 'clean group resets throttle counter');
    assert.strictEqual(l.active, 6, 'recovery ramps 1 -> 6');

    // Initial > max clamps down at construction (Req 2.5, 2.6).
    const clamped = createRateLimiter({ initialConcurrency: 40, maxConcurrency: 12 });
    assert.strictEqual(clamped.active, 12, 'initial clamps down to max');
    assert.strictEqual(clamped.max, 12);
}

console.log(`[pass] Property 8 held across ${checks} generated event sequences + boundary anchors`);

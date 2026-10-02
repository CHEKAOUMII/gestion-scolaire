'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 7.3 — Property 22: Throughput metric computation
//
// **Validates: Requirements 8.2, 8.3**
//
// Exercises the REAL exported `computePushThroughput` from main/sync/engine.js
// across arbitrary sent counts and durations and asserts the documented formula
// holds, with an exact 0 (and no NaN/Infinity) at the duration-zero edge.
//
// Feature: sync-push-throughput-optimization, Property 22: For any cycle with
// sentCount documents and durationMs, the recorded throughput equals
// sentCount / (durationMs / 1000) when durationMs > 0 and equals 0 when
// durationMs == 0.

const assert = require('assert');
const fc = require('fast-check');

const { computePushThroughput } = require('../main/sync/engine');

const MIN_RUNS = 300;

// sent counts are non-negative integers (documents marked sent this cycle).
const sentArb = fc.integer({ min: 0, max: 100000 });

// durationMs spans zero, small, and large positive millisecond values.
const durationArb = fc.oneof(
    fc.constant(0),
    fc.integer({ min: 1, max: 10 }), // sub-10ms cycles (large throughput)
    fc.integer({ min: 11, max: 3600000 }) // up to an hour
);

console.log('[pbt] sync-push-throughput Property 22: throughput metric computation');

let checks = 0;

fc.assert(
    fc.property(sentArb, durationArb, (sent, durationMs) => {
        const actual = computePushThroughput(sent, durationMs);

        if (durationMs > 0) {
            // Independent reference: documents per second (design.md Property 22,
            // Req 8.2), not copied from the implementation.
            const expected = sent / (durationMs / 1000);
            assert.strictEqual(actual, expected, `throughput mismatch (sent=${sent}, durationMs=${durationMs})`);
            assert.ok(Number.isFinite(actual), 'throughput must be finite for durationMs > 0');
            assert.ok(actual >= 0, 'throughput must be non-negative');
        } else {
            // Duration-zero edge: exactly 0, never NaN/Infinity (Req 8.3).
            assert.strictEqual(actual, 0, `duration-zero throughput must be exactly 0 (sent=${sent})`);
        }

        // No path may ever yield NaN or Infinity.
        assert.ok(!Number.isNaN(actual), 'throughput must never be NaN');
        assert.ok(actual !== Infinity && actual !== -Infinity, 'throughput must never be Infinity');

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors (Req 8.2, 8.3), independent of the random sub-domain.
// ---------------------------------------------------------------------------
{
    // Exact documents-per-second values for durationMs > 0.
    assert.strictEqual(computePushThroughput(100, 1000), 100, '100 docs in 1s -> 100 docs/s');
    assert.strictEqual(computePushThroughput(50, 500), 100, '50 docs in 0.5s -> 100 docs/s');
    assert.strictEqual(computePushThroughput(0, 1000), 0, '0 docs in 1s -> 0 docs/s');

    // Duration-zero edge: exactly 0 regardless of sent count (Req 8.3) — no
    // division by zero, no NaN/Infinity.
    assert.strictEqual(computePushThroughput(0, 0), 0, '0 docs, 0ms -> 0');
    assert.strictEqual(computePushThroughput(100, 0), 0, '100 docs, 0ms -> 0 (duration-zero edge)');
    assert.strictEqual(computePushThroughput(99999, 0), 0, 'many docs, 0ms -> 0');

    // Negative or non-positive durations are treated as the zero edge.
    assert.strictEqual(computePushThroughput(100, -5), 0, 'negative duration -> 0');
}

console.log(`[pass] Property 22 held across ${checks} generated (sent, durationMs) pairs + anchors`);

'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 3.2 — Property 4: Concurrency never exceeds the active limit
//
// **Validates: Requirements 1.1**
//
// Exercises the REAL exported `runConcurrentGroup` from main/sync/engine.js with
// a worker that maintains a LIVE in-flight counter (increment on entry, await a
// randomized async tick, decrement on exit). The peak observed concurrency must
// never exceed the active limit, and every item must be processed exactly once.
//
// Feature: sync-push-throughput-optimization, Property 4: For any set of prepared
// items and any active limit L in [1, 50], the number of worker operations
// simultaneously in flight during runConcurrentGroup never exceeds L, and every
// item is processed exactly once.

const assert = require('assert');
const fc = require('fast-check');

const { runConcurrentGroup } = require('../main/sync/engine');

const MIN_RUNS = 150;

// ---------------------------------------------------------------------------
// Smart generators
// ---------------------------------------------------------------------------
// Items are opaque records carrying their own index id plus a small per-item
// async delay (0-4 ticks) so dispatch interleaving varies run to run and the
// sliding window is genuinely exercised (many items still in flight at once).
// Limits span the full documented active-limit space [1, 50], including limits
// far larger than the item count (where effective in-flight is capped by n).

const scenarioArb = fc
    .record({
        count: fc.integer({ min: 0, max: 40 }),
        limit: fc.integer({ min: 1, max: 50 })
    })
    .chain(({ count, limit }) =>
        fc.record({
            limit: fc.constant(limit),
            // One randomized delay (in macrotask ticks) per item.
            delays: fc.array(fc.integer({ min: 0, max: 4 }), { minLength: count, maxLength: count })
        })
    );

const tick = (n) => new Promise((resolve) => setTimeout(resolve, n));

console.log('[pbt] sync-push-throughput Property 4: concurrency never exceeds the active limit');

let checks = 0;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async ({ limit, delays }) => {
            const n = delays.length;
            const items = delays.map((d, i) => ({ id: i, delay: d }));

            // Live in-flight tracking + per-item invocation accounting.
            let inFlight = 0;
            let maxInFlight = 0;
            const invocationCount = new Array(n).fill(0);
            const seenIndices = [];

            const worker = async (item, index) => {
                // --- enter critical region ---
                inFlight += 1;
                if (inFlight > maxInFlight) maxInFlight = inFlight;
                invocationCount[index] += 1;
                seenIndices.push(index);

                // The worker is handed the item at its input position (Req 1.1
                // dispatch contract): index addresses the same record.
                assert.strictEqual(item, items[index], 'worker received item out of position');

                await tick(item.delay);

                inFlight -= 1;
                // --- exit critical region ---
                return { success: true, marker: item.id };
            };

            const { outcomes } = await runConcurrentGroup(items, limit, worker);

            // The active limit is L; effective in-flight can never exceed L, and
            // never exceeds the item count either (no point over-spawning).
            assert.ok(
                maxInFlight <= limit,
                `peak in-flight ${maxInFlight} exceeded active limit ${limit}`
            );
            assert.ok(
                maxInFlight <= Math.max(0, n),
                `peak in-flight ${maxInFlight} exceeded item count ${n}`
            );
            if (n > 0) {
                // With work to do and a positive limit, at least one runner ran.
                assert.ok(maxInFlight >= 1, 'expected at least one in-flight worker for non-empty input');
            }

            // Every item processed exactly once.
            for (let i = 0; i < n; i += 1) {
                assert.strictEqual(invocationCount[i], 1, `item ${i} processed ${invocationCount[i]} times (expected 1)`);
            }
            assert.strictEqual(seenIndices.length, n, 'total worker invocations must equal item count');

            // Outcomes returned in input order, one per item.
            assert.strictEqual(outcomes.length, n, 'one outcome per item');
            for (let i = 0; i < n; i += 1) {
                assert.ok(outcomes[i] && outcomes[i].success === true, `missing/failed outcome at ${i}`);
                assert.strictEqual(outcomes[i].marker, items[i].id, `outcome ${i} out of input order`);
            }

            // Counter must have fully unwound.
            assert.strictEqual(inFlight, 0, 'in-flight counter did not return to zero');

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors independent of the random domain.
    // -----------------------------------------------------------------------

    // limit 1 forces strictly serial execution: peak in-flight is exactly 1.
    {
        let inFlight = 0;
        let maxInFlight = 0;
        const items = Array.from({ length: 12 }, (_, i) => ({ id: i }));
        await runConcurrentGroup(items, 1, async (item) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await tick(1);
            inFlight -= 1;
            return { success: true, marker: item.id };
        });
        assert.strictEqual(maxInFlight, 1, 'limit=1 must serialize (peak in-flight 1)');
    }

    // limit far above item count: peak in-flight saturates at the item count,
    // never higher.
    {
        let inFlight = 0;
        let maxInFlight = 0;
        const items = Array.from({ length: 6 }, (_, i) => ({ id: i }));
        await runConcurrentGroup(items, 50, async (item) => {
            inFlight += 1;
            maxInFlight = Math.max(maxInFlight, inFlight);
            await tick(2);
            inFlight -= 1;
            return { success: true, marker: item.id };
        });
        assert.ok(maxInFlight <= 6, 'peak in-flight cannot exceed item count');
    }

    // empty input: no worker runs, no outcomes.
    {
        let calls = 0;
        const { outcomes } = await runConcurrentGroup([], 10, async () => {
            calls += 1;
            return { success: true };
        });
        assert.strictEqual(calls, 0, 'empty input must not invoke the worker');
        assert.strictEqual(outcomes.length, 0, 'empty input yields no outcomes');
    }

    console.log(`[pass] Property 4 held across ${checks} generated scenarios + boundary anchors`);
})().catch((err) => {
    console.error('[fail] Property 4', err && err.stack ? err.stack : err);
    process.exit(1);
});

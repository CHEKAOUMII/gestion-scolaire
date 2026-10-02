'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 3.3 — Property 6: Partial-failure isolation and full settlement
//
// **Validates: Requirements 1.4, 4.5**
//
// Exercises the REAL exported `runConcurrentGroup` from main/sync/engine.js with
// a worker whose per-item behavior is randomized: some items succeed, some reject
// (throw), some return a throttle outcome, and at most one signals access-denied.
// Every dispatched item must reach exactly one terminal outcome (full settlement,
// no item cancelled), outcomes must be returned in input order, and failures of
// some items must not prevent any other item from settling.
//
// Feature: sync-push-throughput-optimization, Property 6: For any group containing
// an arbitrary mix of successes, failures, throttles, and at most one
// access-denied, every dispatched item reaches exactly one terminal outcome (no
// item is cancelled), each failed item is retained for retry with its failure
// cause recorded, all non-failed items are unaffected by sibling failures, and any
// access-denied abort is acted on only after every item in the group has settled.

const assert = require('assert');
const fc = require('fast-check');

const { runConcurrentGroup } = require('../main/sync/engine');

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Smart generators
// ---------------------------------------------------------------------------
// Each item declares one behavior. "success" and "throttle" return outcome
// objects; "reject-generic" / "reject-throttle" / "reject-denied" throw to prove
// rejected workers are isolated into failure outcomes rather than aborting the
// group. A separate flag injects AT MOST ONE access-denied item (per the property
// statement) at a random position, regardless of the base behaviors.

const baseBehaviorArb = fc.constantFrom(
    'success',
    'throttle',
    'reject-generic',
    'reject-throttle'
);

const scenarioArb = fc
    .array(baseBehaviorArb, { minLength: 0, maxLength: 40 })
    .chain((behaviors) =>
        fc.record({
            behaviors: fc.constant(behaviors),
            // -1 means "no access-denied"; otherwise the index that becomes denied.
            deniedIndex:
                behaviors.length === 0
                    ? fc.constant(-1)
                    : fc.oneof(
                          fc.constant(-1),
                          fc.integer({ min: 0, max: behaviors.length - 1 })
                      ),
            // Randomized micro-delays so settlement ordering varies.
            delays: fc.array(fc.integer({ min: 0, max: 3 }), {
                minLength: behaviors.length,
                maxLength: behaviors.length
            })
        })
    );

const tick = (n) => new Promise((resolve) => setTimeout(resolve, n));

const THROTTLE_CODE = 'unavailable'; // recognized by isThrottleError
const DENIED_CODE = 'permission-denied';

console.log('[pbt] sync-push-throughput Property 6: partial-failure isolation and full settlement');

let checks = 0;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async ({ behaviors, deniedIndex, delays }) => {
            const n = behaviors.length;

            // Resolve the effective behavior per item (access-denied overrides base).
            const kinds = behaviors.map((b, i) => (i === deniedIndex ? 'reject-denied' : b));
            const items = kinds.map((kind, i) => ({ id: i, kind }));

            const invocationCount = new Array(n).fill(0);

            const worker = async (item, index) => {
                invocationCount[index] += 1;
                await tick(delays[index] || 0);

                switch (item.kind) {
                    case 'success':
                        return { success: true, marker: item.id };
                    case 'throttle':
                        // A returned (non-thrown) throttle outcome.
                        return { success: false, isThrottle: true, marker: item.id };
                    case 'reject-generic': {
                        const e = new Error(`generic-failure-${item.id}`);
                        e.code = 'internal';
                        throw e;
                    }
                    case 'reject-throttle': {
                        const e = new Error(`throttle-failure-${item.id}`);
                        e.code = THROTTLE_CODE;
                        throw e;
                    }
                    case 'reject-denied': {
                        const e = new Error(`denied-${item.id}`);
                        e.code = DENIED_CODE;
                        throw e;
                    }
                    default:
                        throw new Error(`unknown kind ${item.kind}`);
                }
            };

            const { outcomes, throttled } = await runConcurrentGroup(items, /* limit */ 8, worker);

            // --- Full settlement: every item invoked exactly once, one outcome each ---
            assert.strictEqual(outcomes.length, n, 'one outcome per item (full settlement)');
            for (let i = 0; i < n; i += 1) {
                assert.strictEqual(invocationCount[i], 1, `item ${i} not settled exactly once`);
                assert.ok(outcomes[i] !== undefined, `item ${i} produced no outcome (cancelled?)`);
            }

            // --- Per-item terminal classification + input-order correspondence ---
            let expectedThrottled = false;
            for (let i = 0; i < n; i += 1) {
                const o = outcomes[i];
                const kind = items[i].kind;

                switch (kind) {
                    case 'success':
                        assert.strictEqual(o.success, true, `item ${i} should be sent`);
                        assert.strictEqual(o.marker, items[i].id, `success outcome ${i} out of order`);
                        break;
                    case 'throttle':
                        assert.strictEqual(o.success, false, `throttle item ${i} must not be success`);
                        assert.strictEqual(o.isThrottle, true, `throttle item ${i} missing throttle flag`);
                        assert.strictEqual(o.marker, items[i].id, `throttle outcome ${i} out of order`);
                        expectedThrottled = true;
                        break;
                    case 'reject-generic':
                        // Rejected worker isolated into a failure outcome with a cause (Req 1.4).
                        assert.strictEqual(o.success, false, `rejected item ${i} must be a failure outcome`);
                        assert.ok(o.error && o.error.includes(`generic-failure-${i}`), `item ${i} missing failure cause`);
                        assert.notStrictEqual(o.isThrottle, true, `generic failure ${i} must not be a throttle`);
                        assert.notStrictEqual(o.isAccessDenied, true, `generic failure ${i} must not be access-denied`);
                        break;
                    case 'reject-throttle':
                        assert.strictEqual(o.success, false, `thrown-throttle item ${i} must be a failure outcome`);
                        assert.strictEqual(o.isThrottle, true, `thrown-throttle item ${i} must be flagged throttle`);
                        assert.ok(o.error && o.error.includes(`throttle-failure-${i}`), `item ${i} missing failure cause`);
                        expectedThrottled = true;
                        break;
                    case 'reject-denied':
                        assert.strictEqual(o.success, false, `denied item ${i} must be a failure outcome`);
                        assert.strictEqual(o.isAccessDenied, true, `denied item ${i} must be flagged access-denied`);
                        assert.ok(o.error && o.error.includes(`denied-${i}`), `item ${i} missing failure cause`);
                        break;
                    default:
                        throw new Error(`unhandled kind ${kind}`);
                }
            }

            // The aggregate throttle flag reflects whether any item observed throttling.
            assert.strictEqual(throttled, expectedThrottled, 'aggregate throttled flag mismatch');

            // --- Isolation: successes are unaffected by sibling failures ---
            // Every "success" item produced a sent outcome even when failures,
            // throttles, and an access-denied co-occur in the same group. The
            // access-denied item itself settled (was NOT cancelled), proving abort
            // is evaluated only after the whole group settles (Req 4.5).
            const sentCount = outcomes.filter((o) => o && o.success === true).length;
            const expectedSent = kinds.filter((k) => k === 'success').length;
            assert.strictEqual(sentCount, expectedSent, 'sibling failures suppressed a successful item');

            const deniedSettled = kinds
                .map((k, i) => (k === 'reject-denied' ? i : -1))
                .filter((i) => i >= 0)
                .every((i) => outcomes[i] && outcomes[i].isAccessDenied === true);
            assert.ok(deniedSettled, 'access-denied item must still settle (no mid-flight cancel)');

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors.
    // -----------------------------------------------------------------------

    // A single rejecting item in the middle does not stop its siblings settling.
    {
        const items = [
            { id: 0, kind: 'success' },
            { id: 1, kind: 'boom' },
            { id: 2, kind: 'success' }
        ];
        const { outcomes } = await runConcurrentGroup(items, 3, async (item) => {
            await tick(1);
            if (item.kind === 'boom') {
                const e = new Error('mid-boom');
                e.code = 'internal';
                throw e;
            }
            return { success: true, marker: item.id };
        });
        assert.strictEqual(outcomes.length, 3);
        assert.strictEqual(outcomes[0].success, true);
        assert.strictEqual(outcomes[1].success, false);
        assert.ok(outcomes[1].error.includes('mid-boom'));
        assert.strictEqual(outcomes[2].success, true, 'sibling after a failure still settled');
    }

    // All items reject: every one becomes an isolated failure outcome.
    {
        const items = Array.from({ length: 5 }, (_, i) => ({ id: i }));
        const { outcomes } = await runConcurrentGroup(items, 2, async (item) => {
            const e = new Error(`fail-${item.id}`);
            e.code = 'internal';
            throw e;
        });
        assert.strictEqual(outcomes.length, 5);
        for (let i = 0; i < 5; i += 1) {
            assert.strictEqual(outcomes[i].success, false, `item ${i} should be a failure outcome`);
            assert.ok(outcomes[i].error.includes(`fail-${i}`));
        }
    }

    console.log(`[pass] Property 6 held across ${checks} generated scenarios + boundary anchors`);
})().catch((err) => {
    console.error('[fail] Property 6', err && err.stack ? err.stack : err);
    process.exit(1);
});

'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 3.3 — Property 6: Partial-failure isolation and full settlement
//
// **Validates: Requirements 1.4, 4.5**
//
// Exercises the REAL exported `runConcurrentGroup` from main/sync/engine.js with
// a group containing an arbitrary mix of successes, plain failures (rejecting or
// throwing workers), throttles, and at most one access-denied. Asserts every
// dispatched item reaches exactly one terminal outcome in input order (nothing is
// cancelled), failures are isolated (a rejecting/throwing sibling never corrupts
// another item's outcome), successful siblings are unaffected, and the throttled
// flag reflects whether any throttle outcome was observed.
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
// Each item is assigned a "kind" describing how its worker behaves:
//   success       -> resolves { success: true }
//   fail-resolve  -> resolves a failure outcome (worker returns a failure object)
//   fail-throw    -> the worker THROWS (rejects) — must be isolated by the dispatcher
//   throttle      -> resolves { isThrottle: true } (or throws a throttle-coded error)
//   denied        -> access-denied; at most ONE per group
//
// We constrain to at most one access-denied to match the property statement.
// Random microtask delays interleave the runners so failures and successes race.

const kindArb = fc.constantFrom(
    'success',
    'fail-resolve',
    'fail-throw',
    'throttle-resolve',
    'throttle-throw'
);

const baseItemArb = fc.record({
    kind: kindArb,
    delay: fc.integer({ min: 0, max: 3 })
});

// Build a group of base items, then optionally inject a single access-denied at
// a random position (so "at most one access-denied" holds).
const groupArb = fc
    .array(baseItemArb, { minLength: 0, maxLength: 40 })
    .chain((items) =>
        fc.record({
            items: fc.constant(items),
            injectDenied: fc.boolean(),
            deniedAt: items.length > 0 ? fc.integer({ min: 0, max: items.length - 1 }) : fc.constant(-1),
            limit: fc.integer({ min: 1, max: 50 })
        })
    );

async function tick(times) {
    for (let i = 0; i < times; i += 1) {
        await Promise.resolve();
    }
}

function makeThrottleError() {
    const codes = ['resource-exhausted', 'unavailable', 'aborted'];
    const err = new Error('throttled by Firestore');
    err.code = codes[Math.floor(Math.random() * codes.length)];
    return err;
}

console.log('[pbt] sync-push-throughput Property 6: partial-failure isolation and full settlement');

let checks = 0;

async function main() {
await fc.assert(
    fc.asyncProperty(groupArb, async ({ items, injectDenied, deniedAt, limit }) => {
        // Resolve the final per-index kind, injecting a single access-denied if asked.
        const kinds = items.map((it) => it.kind);
        if (injectDenied && deniedAt >= 0) {
            kinds[deniedAt] = 'denied';
        }
        const count = kinds.length;

        // Per-item invocation accounting to prove "processed exactly once".
        const invoked = new Array(count).fill(0);

        const worker = async (item, index) => {
            invoked[index] += 1;
            await tick(items[index] ? items[index].delay : 0);

            switch (kinds[index]) {
                case 'success':
                    return { success: true, id: index };
                case 'fail-resolve':
                    return { success: false, error: `resolved-failure-${index}`, errorName: 'fail' };
                case 'fail-throw': {
                    // A genuinely thrown worker — the dispatcher must isolate it
                    // into a failure outcome (Req 1.4) without disturbing siblings.
                    const err = new Error(`thrown-failure-${index}`);
                    err.code = 'internal';
                    throw err;
                }
                case 'throttle-resolve':
                    return { success: false, isThrottle: true, error: `throttle-${index}` };
                case 'throttle-throw':
                    throw makeThrottleError();
                case 'denied': {
                    const err = new Error(`denied-${index}`);
                    err.code = 'permission-denied';
                    throw err;
                }
                default:
                    return { success: true, id: index };
            }
        };

        const { outcomes, throttled } = await runConcurrentGroup(items, limit, worker);

        // --- Full settlement: one outcome per item, in input order (Req 1.4) ---
        assert.strictEqual(outcomes.length, count, 'every dispatched item yields exactly one outcome');
        for (let i = 0; i < count; i += 1) {
            assert.ok(outcomes[i] !== undefined, `item ${i} produced an outcome (not cancelled)`);
            assert.strictEqual(invoked[i], 1, `item ${i} processed exactly once, got ${invoked[i]}`);
        }

        // --- Per-item terminal outcome matches its kind; failures are isolated ---
        let expectThrottle = false;
        for (let i = 0; i < count; i += 1) {
            const o = outcomes[i];
            switch (kinds[i]) {
                case 'success':
                    assert.strictEqual(o.success, true, `item ${i}: success preserved`);
                    assert.strictEqual(o.id, i, `item ${i}: success identity preserved (input order)`);
                    assert.ok(!o.isThrottle, `item ${i}: success not flagged throttle`);
                    assert.ok(!o.isAccessDenied, `item ${i}: success not flagged denied`);
                    break;
                case 'fail-resolve':
                    assert.strictEqual(o.success, false, `item ${i}: resolved failure recorded`);
                    assert.strictEqual(o.error, `resolved-failure-${i}`, `item ${i}: failure cause recorded`);
                    break;
                case 'fail-throw':
                    // Thrown worker captured into a failure outcome with its cause (Req 1.4).
                    assert.strictEqual(o.success, false, `item ${i}: thrown failure isolated as failure`);
                    assert.ok(
                        typeof o.error === 'string' && o.error.includes(`thrown-failure-${i}`),
                        `item ${i}: thrown failure cause captured`
                    );
                    assert.ok(!o.isThrottle, `item ${i}: 'internal' error is not a throttle`);
                    assert.ok(!o.isAccessDenied, `item ${i}: 'internal' error is not access-denied`);
                    break;
                case 'throttle-resolve':
                    assert.strictEqual(o.success, false, `item ${i}: throttle outcome not successful`);
                    assert.strictEqual(o.isThrottle, true, `item ${i}: resolved throttle flagged`);
                    expectThrottle = true;
                    break;
                case 'throttle-throw':
                    assert.strictEqual(o.success, false, `item ${i}: thrown throttle isolated as failure`);
                    assert.strictEqual(o.isThrottle, true, `item ${i}: thrown throttle-coded error flagged throttle`);
                    expectThrottle = true;
                    break;
                case 'denied':
                    assert.strictEqual(o.success, false, `item ${i}: access-denied not successful`);
                    assert.strictEqual(o.isAccessDenied, true, `item ${i}: access-denied flagged`);
                    break;
                default:
                    break;
            }
        }

        // --- Throttled aggregate reflects whether ANY outcome was a throttle ---
        assert.strictEqual(
            throttled,
            expectThrottle,
            'group throttled flag equals (any item observed a throttle)'
        );

        // --- Sibling isolation: the set of successful items is exactly the set
        // of success-kind items, regardless of how many siblings failed/threw.
        const successIdx = outcomes
            .map((o, i) => (o.success === true ? i : -1))
            .filter((i) => i >= 0);
        const expectedSuccessIdx = kinds
            .map((k, i) => (k === 'success' ? i : -1))
            .filter((i) => i >= 0);
        assert.deepStrictEqual(
            successIdx,
            expectedSuccessIdx,
            'successful siblings unaffected by failing/throwing/throttled/denied siblings'
        );

        // --- At most one access-denied present, as constrained by the property ---
        const deniedCount = outcomes.filter((o) => o && o.isAccessDenied).length;
        assert.ok(deniedCount <= 1, `at most one access-denied per group, saw ${deniedCount}`);

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);
}

// ---------------------------------------------------------------------------
// Targeted anchors.
// ---------------------------------------------------------------------------
main().then(async () => {
    // A single thrown worker amid successes is isolated; siblings all succeed.
    {
        const items = [{ id: 0 }, { id: 1 }, { id: 2 }, { id: 3 }];
        const worker = async (item, index) => {
            await tick(1);
            if (index === 2) {
                const e = new Error('boom');
                e.code = 'internal';
                throw e;
            }
            return { success: true, id: index };
        };
        const { outcomes, throttled } = await runConcurrentGroup(items, 2, worker);
        assert.strictEqual(outcomes.length, 4);
        assert.strictEqual(outcomes[0].success, true);
        assert.strictEqual(outcomes[1].success, true);
        assert.strictEqual(outcomes[2].success, false, 'thrown worker isolated');
        assert.ok(outcomes[2].error.includes('boom'), 'failure cause captured');
        assert.strictEqual(outcomes[3].success, true, 'sibling after the failure still settles');
        assert.strictEqual(throttled, false);
    }

    // A thrown throttle-coded error sets the aggregate throttled flag.
    {
        const items = [{ id: 0 }, { id: 1 }];
        const worker = async (item, index) => {
            if (index === 1) {
                const e = new Error('overloaded');
                e.code = 'resource-exhausted';
                throw e;
            }
            return { success: true, id: index };
        };
        const { outcomes, throttled } = await runConcurrentGroup(items, 2, worker);
        assert.strictEqual(outcomes[1].isThrottle, true, 'throttle-coded throw flagged');
        assert.strictEqual(throttled, true, 'aggregate throttled set by a thrown throttle');
    }

    // A single access-denied is flagged and does not cancel siblings; all settle.
    {
        const items = [{ id: 0 }, { id: 1 }, { id: 2 }];
        const worker = async (item, index) => {
            await tick(index);
            if (index === 0) {
                const e = new Error('nope');
                e.code = 'permission-denied';
                throw e;
            }
            return { success: true, id: index };
        };
        const { outcomes } = await runConcurrentGroup(items, 3, worker);
        assert.strictEqual(outcomes.length, 3, 'all items settle despite access-denied sibling');
        assert.strictEqual(outcomes[0].isAccessDenied, true, 'access-denied flagged');
        assert.strictEqual(outcomes[1].success, true, 'sibling unaffected by access-denied');
        assert.strictEqual(outcomes[2].success, true, 'sibling unaffected by access-denied');
    }

    console.log(`[pass] Property 6 held across ${checks} generated groups + boundary anchors`);
}).catch((err) => {
    console.error('[fail] Property 6', err && err.stack ? err.stack : err);
    process.exit(1);
});

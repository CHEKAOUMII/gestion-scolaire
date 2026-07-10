'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 7.2 — Property 21: Follow-up scheduling predicate
//
// **Validates: Requirements 6.3**
//
// Exercises the REAL exported `shouldScheduleFollowupPush` from
// main/sync/engine.js across the full integer input space (including zeros and
// negatives) and asserts the documented biconditional holds for every triple.
//
// Feature: sync-push-throughput-optimization, Property 21: For any cycle-end
// state (pendingCount, sentCount, failedCount), a follow-up push is scheduled
// via scheduleBacklogPush (within 5 seconds) if and only if pendingCount > 0 and
// sentCount > 0 and failedCount == 0.

const assert = require('assert');
const fc = require('fast-check');

const { shouldScheduleFollowupPush } = require('../main/sync/engine');

const MIN_RUNS = 300;

// Generator spans negatives, zero, and positives so the predicate is probed at
// and around every boundary of the three operands.
const countArb = fc.integer({ min: -5, max: 5000 });

console.log('[pbt] sync-push-throughput Property 21: follow-up scheduling predicate');

let checks = 0;

fc.assert(
    fc.property(countArb, countArb, countArb, (pending, sent, failed) => {
        const actual = shouldScheduleFollowupPush(pending, sent, failed);

        // Independent reference derived directly from the documented predicate
        // (design.md Property 21 + Req 6.3), not copied from the implementation.
        const expected = pending > 0 && sent > 0 && failed === 0;

        assert.strictEqual(
            actual,
            expected,
            `predicate mismatch for (pending=${pending}, sent=${sent}, failed=${failed})`
        );

        // The result is a strict boolean (used directly in an `if`).
        assert.strictEqual(typeof actual, 'boolean', 'predicate must return a boolean');

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted boundary anchors (Req 6.3), independent of the random sub-domain.
// ---------------------------------------------------------------------------
{
    // The one combination that schedules: pending>0, sent>0, failed==0.
    assert.strictEqual(shouldScheduleFollowupPush(1, 1, 0), true, 'pending>0, sent>0, failed==0 -> schedule');
    assert.strictEqual(shouldScheduleFollowupPush(5000, 100, 0), true, 'large backlog drained cleanly -> schedule');

    // Each single condition broken flips it to false.
    assert.strictEqual(shouldScheduleFollowupPush(0, 1, 0), false, 'no pending -> no schedule');
    assert.strictEqual(shouldScheduleFollowupPush(1, 0, 0), false, 'nothing sent -> no schedule');
    assert.strictEqual(shouldScheduleFollowupPush(1, 1, 1), false, 'a failure occurred -> no schedule');

    // Negatives never schedule.
    assert.strictEqual(shouldScheduleFollowupPush(-1, 1, 0), false, 'negative pending -> no schedule');
    assert.strictEqual(shouldScheduleFollowupPush(1, -1, 0), false, 'negative sent -> no schedule');
    assert.strictEqual(shouldScheduleFollowupPush(1, 1, -1), false, 'negative failed (!= 0) -> no schedule');
}

console.log(`[pass] Property 21 held across ${checks} generated triples + boundary anchors`);

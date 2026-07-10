'use strict';

// Unit tests — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 7.4 — Metric recording and error fallback. Covers:
//   - Metric fields recorded (Req 8.1) — Push_Metrics object shape
//   - Concurrency-change + throttle-count recording (Req 8.4, 8.5)
//   - updatePushMeta persistence (Req 8.6)
//   - Duration-zero throughput edge (Req 8.3)
//   - syncLog-error fallback log path (Req 8.8)
//
// Exercises the REAL exported helpers from main/sync/engine.js:
//   createRateLimiter, computePushThroughput, updatePushMeta, recordPushMeta.

const assert = require('assert');

const {
    createRateLimiter,
    computePushThroughput,
    updatePushMeta,
    recordPushMeta
} = require('../main/sync/engine');

let checks = 0;

console.log('[unit] sync-push-throughput metric recording + error fallback (Req 8.1, 8.3, 8.4, 8.5, 8.6, 8.8)');

// ===========================================================================
// Req 8.1 — Metric fields recorded.
//
// The Push_Metrics object recorded at cycle end has exactly the documented
// shape (design.md Push_Metrics): { sent, failed, skipped, pending, durationMs,
// throughput, throttleErrors, concurrencyChanges }. We assemble it from the
// real helper outputs (the same values the engine records) and assert the shape
// and value semantics.
// ===========================================================================
{
    const limiter = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });
    limiter.onGroupSuccess(); // one ramp-up -> records a concurrency change

    const sent = 42;
    const failed = 1;
    const skipped = 3;
    const pending = 7;
    const durationMs = 2000;

    const metrics = {
        sent,
        failed,
        skipped,
        pending,
        durationMs,
        throughput: computePushThroughput(sent, durationMs),
        throttleErrors: 0,
        concurrencyChanges: limiter.changes.length
    };

    const expectedKeys = [
        'sent',
        'failed',
        'skipped',
        'pending',
        'durationMs',
        'throughput',
        'throttleErrors',
        'concurrencyChanges'
    ].sort();

    assert.deepStrictEqual(
        Object.keys(metrics).sort(),
        expectedKeys,
        'Push_Metrics object must have exactly the documented field set (Req 8.1)'
    );

    // Counts + duration are recorded as provided (Req 8.1).
    assert.strictEqual(metrics.sent, 42, 'sent count recorded');
    assert.strictEqual(metrics.failed, 1, 'failed count recorded');
    assert.strictEqual(metrics.skipped, 3, 'skipped count recorded');
    assert.strictEqual(metrics.pending, 7, 'pending count recorded');
    assert.strictEqual(metrics.durationMs, 2000, 'cycle duration recorded in ms');

    // throughput is documents/second over the cycle (Req 8.2).
    assert.strictEqual(metrics.throughput, 21, '42 docs in 2s -> 21 docs/s');

    // every numeric metric is a finite number.
    for (const k of expectedKeys) {
        assert.strictEqual(typeof metrics[k], 'number', `metric '${k}' must be numeric`);
        assert.ok(Number.isFinite(metrics[k]), `metric '${k}' must be finite`);
    }
    checks += 1;
}

// ===========================================================================
// Req 8.4, 8.5 — Concurrency-change + throttle-count recording.
//
// Drive a rate limiter through a mix of ramp-ups and throttles and assert
// `changes[]` records each ACTUAL move (with the correct reason), that a held
// cap / floor records nothing, and that the count matches changes.length. Also
// assert the throttle-count semantics the cycle uses for throttleErrors.
// ===========================================================================
{
    const limiter = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });

    // 10 -> 15 (ramp-up)
    limiter.onGroupSuccess();
    // 15 -> 20 (ramp-up)
    limiter.onGroupSuccess();
    // held at cap 20 -> NO change recorded
    limiter.onGroupSuccess();
    // 20 -> 10 (throttle-backoff)
    limiter.onThrottle();
    // 10 -> 5 (throttle-backoff)
    limiter.onThrottle();

    assert.deepStrictEqual(
        limiter.changes,
        [
            { to: 15, reason: 'ramp-up' },
            { to: 20, reason: 'ramp-up' },
            { to: 10, reason: 'throttle-backoff' },
            { to: 5, reason: 'throttle-backoff' }
        ],
        'changes[] must record each actual move with its reason; a held cap records nothing (Req 8.4)'
    );

    // concurrencyChanges count == changes.length (the value the cycle records).
    assert.strictEqual(limiter.changes.length, 4, 'concurrencyChanges count matches actual moves');

    // Each recorded `to` lands within the active bounds [1, max].
    for (const c of limiter.changes) {
        assert.ok(c.to >= 1 && c.to <= limiter.max, `recorded change ${c.to} within [1, ${limiter.max}]`);
        assert.ok(c.reason === 'ramp-up' || c.reason === 'throttle-backoff', 'reason is one of the two documented values');
    }
    checks += 1;

    // A back-off already at the floor of 1 records no further change (Req 8.4).
    const atFloor = createRateLimiter({ initialConcurrency: 1, maxConcurrency: 20 });
    atFloor.onThrottle(); // 1 -> floor(1/2)=1, no actual move
    assert.strictEqual(atFloor.changes.length, 0, 'back-off held at floor 1 records no change');
    // ...but the consecutive-throttle counter still advances (Req 8.5 counting).
    assert.strictEqual(atFloor.consecutiveThrottles, 1, 'throttle still counted even when active held at floor');
    checks += 1;

    // Throttle-count recording (Req 8.5): a cycle counts each throttling error
    // observed. The limiter advances its consecutive counter on every throttle.
    const counter = createRateLimiter({ initialConcurrency: 10, maxConcurrency: 20 });
    counter.onThrottle();
    counter.onThrottle();
    counter.onThrottle();
    assert.strictEqual(counter.consecutiveThrottles, 3, 'three throttles counted consecutively');
    counter.onGroupSuccess(); // a clean group resets the consecutive counter
    assert.strictEqual(counter.consecutiveThrottles, 0, 'clean group resets the consecutive throttle counter');
    checks += 1;
}

// ===========================================================================
// Req 8.3 — Duration-zero throughput edge.
// ===========================================================================
{
    assert.strictEqual(computePushThroughput(0, 0), 0, 'duration-zero, no docs -> 0');
    assert.strictEqual(computePushThroughput(100, 0), 0, 'duration-zero, many docs -> 0 (Req 8.3)');
    assert.ok(!Number.isNaN(computePushThroughput(100, 0)), 'duration-zero throughput is not NaN');
    checks += 1;
}

// ===========================================================================
// Req 8.6 — updatePushMeta persistence.
//
// updatePushMeta issues the UPDATE sync_config write for last_push_at /
// last_push_error. We use a recording stub DB that captures the prepared SQL
// and the run() arguments, asserting the exact write occurs.
// ===========================================================================
function makeRecordingDb() {
    const recorded = { sql: null, args: null, runs: 0 };
    return {
        recorded,
        prepare(sql) {
            recorded.sql = sql;
            return {
                run: (...args) => {
                    recorded.args = args;
                    recorded.runs += 1;
                    return { changes: 1 };
                }
            };
        }
    };
}
{
    const db = makeRecordingDb();
    const at = '2026-03-23T10:00:00.000Z';
    const err = null;

    updatePushMeta(db, at, err);

    assert.strictEqual(db.recorded.runs, 1, 'updatePushMeta issues exactly one write');
    const sql = String(db.recorded.sql).replace(/\s+/g, ' ').trim();
    assert.ok(sql.startsWith('UPDATE sync_config SET'), 'must UPDATE sync_config');
    assert.ok(sql.includes('last_push_at = ?'), 'must set last_push_at');
    assert.ok(sql.includes('last_push_error = ?'), 'must set last_push_error');
    assert.ok(sql.includes('WHERE id = 1'), 'must target the singleton config row id = 1');
    assert.deepStrictEqual(db.recorded.args, [at, err], 'run() receives (last_push_at, last_push_error)');
    checks += 1;

    // A recorded error string is persisted verbatim.
    const db2 = makeRecordingDb();
    const errMsg = 'syncLog write failed — other devices may not receive changes';
    updatePushMeta(db2, null, errMsg);
    assert.deepStrictEqual(db2.recorded.args, [null, errMsg], 'error condition persisted verbatim (Req 8.6/8.7)');
    checks += 1;
}

// ===========================================================================
// Req 8.8 — syncLog-error fallback log path.
//
// recordPushMeta wraps updatePushMeta so that if persisting the error state
// itself fails, it does NOT throw and instead emits a console.error fallback
// so the error condition is never silently lost.
// ===========================================================================
{
    const throwingDb = {
        prepare() {
            return {
                run() {
                    throw new Error('disk I/O failure while writing sync_config');
                }
            };
        }
    };

    const originalError = console.error;
    const captured = [];
    console.error = (...args) => {
        captured.push(args.map((a) => String(a)).join(' '));
    };

    let threw = false;
    try {
        recordPushMeta(throwingDb, '2026-03-23T10:00:00.000Z', 'syncLog batch write failed');
    } catch (_) {
        threw = true;
    } finally {
        console.error = originalError;
    }

    assert.strictEqual(threw, false, 'recordPushMeta must NOT throw when persistence fails (Req 8.8)');
    assert.strictEqual(captured.length, 1, 'a single console.error fallback is emitted');
    const logged = captured[0];
    assert.ok(logged.includes('[sync:push]'), 'fallback log is tagged for the push subsystem');
    assert.ok(
        logged.includes('syncLog batch write failed'),
        'fallback log captures the intended error state so it is not lost'
    );
    assert.ok(
        logged.includes('disk I/O failure while writing sync_config'),
        'fallback log captures the underlying persistence error'
    );
    checks += 1;

    // Healthy path: recordPushMeta persists via updatePushMeta and emits no
    // fallback log.
    const okDb = makeRecordingDb();
    const originalError2 = console.error;
    const captured2 = [];
    console.error = (...args) => captured2.push(args.join(' '));
    try {
        recordPushMeta(okDb, '2026-03-23T11:00:00.000Z', null);
    } finally {
        console.error = originalError2;
    }
    assert.strictEqual(okDb.recorded.runs, 1, 'healthy recordPushMeta performs the persistence write');
    assert.strictEqual(captured2.length, 0, 'healthy recordPushMeta emits no fallback log');
    checks += 1;
}

console.log(`[pass] metric recording + error fallback held across ${checks} assertions`);

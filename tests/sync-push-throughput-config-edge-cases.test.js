'use strict';

// Unit tests — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 1.5 — Config edge cases:
//   - Reading a valid `push_concurrency` value (Req 2.1)
//   - Init-abort fail-safe when a documented default cannot be applied (Req 9.4)
//
// Exercises the REAL exported `resolvePushTuning` from main/sync/engine.js.

const assert = require('assert');

const { resolvePushTuning } = require('../main/sync/engine');

let checks = 0;

console.log('[unit] sync-push-throughput config edge cases (Req 2.1, 9.4)');

// ===========================================================================
// Req 2.1 — Reading a valid push_concurrency value.
//
// The engine reads the initial concurrency from sync_config.push_concurrency.
// A valid integer in range is used verbatim as the initial concurrency.
// ===========================================================================
{
    // Numeric value, comfortably below the cap.
    const t1 = resolvePushTuning({ push_concurrency: 15, push_concurrency_max: 30 });
    assert.strictEqual(t1.initialConcurrency, 15, 'valid numeric push_concurrency=15 should be read verbatim');
    assert.strictEqual(t1.maxConcurrency, 30, 'push_concurrency_max=30 should be read verbatim');
    checks += 1;

    // SQLite-style string integer is accepted.
    const t2 = resolvePushTuning({ push_concurrency: '7', push_concurrency_max: '25' });
    assert.strictEqual(t2.initialConcurrency, 7, "string '7' should parse to 7");
    assert.strictEqual(t2.maxConcurrency, 25, "string '25' should parse to 25");
    checks += 1;

    // Boundary value of 1 is valid.
    const t3 = resolvePushTuning({ push_concurrency: 1, push_concurrency_max: 20 });
    assert.strictEqual(t3.initialConcurrency, 1, 'push_concurrency=1 (lower bound) is valid');
    checks += 1;

    // A valid value equal to the cap is read as-is.
    const t4 = resolvePushTuning({ push_concurrency: 20, push_concurrency_max: 20 });
    assert.strictEqual(t4.initialConcurrency, 20, 'push_concurrency equal to cap is read verbatim');
    checks += 1;
}

// ===========================================================================
// Req 9.4 — Init-abort fail-safe.
//
// If a documented default cannot be applied due to an implementation error,
// initialization aborts BEFORE any push work begins, surfacing the failing key
// via an Error whose code is 'PUSH_TUNING_INIT_FAILED' and whose `failingKey`
// names the offending tuning key. We simulate an implementation error by
// making a config property getter throw while it is being read.
// ===========================================================================
function configThatThrowsOn(key) {
    const cfg = {};
    Object.defineProperty(cfg, key, {
        enumerable: true,
        get() {
            throw new Error(`injected read failure for ${key}`);
        }
    });
    return cfg;
}

function assertAborts(key) {
    assert.throws(
        () => resolvePushTuning(configThatThrowsOn(key)),
        (err) => {
            assert.ok(err instanceof Error, 'abort should throw an Error');
            assert.strictEqual(err.code, 'PUSH_TUNING_INIT_FAILED', 'abort error code should be PUSH_TUNING_INIT_FAILED');
            assert.strictEqual(err.failingKey, key, `abort should surface the failing key '${key}'`);
            return true;
        },
        `resolvePushTuning should abort when reading '${key}' fails`
    );
    checks += 1;
}

// The failing key is surfaced for whichever tuning key the implementation reads.
assertAborts('push_batch_size');
assertAborts('push_concurrency_max');
assertAborts('push_concurrency');
assertAborts('push_backlog_batch_size');
assertAborts('push_batched_fast_path_enabled');

// A healthy config must NOT abort and must yield documented defaults.
{
    const t = resolvePushTuning({});
    assert.strictEqual(t.initialConcurrency, 10, 'healthy/absent config -> default initial 10');
    assert.strictEqual(t.maxConcurrency, 20, 'healthy/absent config -> default max 20');
    assert.strictEqual(t.backlogBatchSize, 1000, 'healthy/absent config -> default backlog 1000');
    assert.strictEqual(t.batchedFastPathEnabled, false, 'healthy/absent config -> fast path disabled');
    checks += 1;
}

console.log(`[pass] config edge cases held across ${checks} assertions`);

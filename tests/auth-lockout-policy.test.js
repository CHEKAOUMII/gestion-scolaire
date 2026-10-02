'use strict';

const assert = require('assert');
const {
    MAX_ATTEMPTS_BEFORE_LOCK,
    LOCKOUT_SCHEDULE_MS,
    ATTEMPT_TTL_MS,
    nextLockoutDurationMs,
    evaluateLoginAttempt,
    buildFailedAttemptUpdate,
    isAttemptRecordExpired
} = require('../main/auth/lockout-policy');

function run() {
    assert.strictEqual(MAX_ATTEMPTS_BEFORE_LOCK, 5);
    assert.deepStrictEqual(LOCKOUT_SCHEDULE_MS, [5_000, 15_000, 30_000, 60_000, 120_000]);
    assert.strictEqual(ATTEMPT_TTL_MS, 30 * 60_000);

    assert.strictEqual(nextLockoutDurationMs(4), 0);
    assert.strictEqual(nextLockoutDurationMs(5), 5_000);
    assert.strictEqual(nextLockoutDurationMs(6), 15_000);
    assert.strictEqual(nextLockoutDurationMs(99), 120_000);

    const now = 10_000_000;
    assert.strictEqual(evaluateLoginAttempt(null, now).allowed, true);

    const locked = evaluateLoginAttempt({ count: 5, lockedUntil: now + 3000, lastAttempt: now }, now);
    assert.strictEqual(locked.allowed, false);
    assert.strictEqual(locked.retryAfterMs, 3000);

    const open = evaluateLoginAttempt({ count: 2, lockedUntil: 0, lastAttempt: now }, now);
    assert.strictEqual(open.allowed, true);

    const expired = isAttemptRecordExpired({ lastAttempt: now - ATTEMPT_TTL_MS - 1 }, now);
    assert.strictEqual(expired, true);

    const u1 = buildFailedAttemptUpdate(null, now);
    assert.strictEqual(u1.attempts, 1);
    assert.strictEqual(u1.locked_until, 0);

    const u5 = buildFailedAttemptUpdate({ attempts: 4, locked_until: 0 }, now);
    assert.strictEqual(u5.attempts, 5);
    assert.strictEqual(u5.locked_until, now + 5_000);

    console.log('auth-lockout-policy.test.js: OK');
}

run();

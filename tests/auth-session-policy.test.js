'use strict';

const assert = require('assert');
const { SESSION_TTL_MS, isSessionExpired, computeExpiresAt } = require('../main/auth/session-policy');

function run() {
    assert.strictEqual(SESSION_TTL_MS, 1000 * 60 * 60 * 12);

    const now = 2_000_000;
    assert.strictEqual(isSessionExpired(null, now), true);
    assert.strictEqual(isSessionExpired({}, now), true);
    assert.strictEqual(isSessionExpired({ expiresAt: now - 1 }, now), true);
    assert.strictEqual(isSessionExpired({ expiresAt: now + 1 }, now), false);

    assert.strictEqual(computeExpiresAt(now), now + SESSION_TTL_MS);

    console.log('auth-session-policy.test.js: OK');
}

run();

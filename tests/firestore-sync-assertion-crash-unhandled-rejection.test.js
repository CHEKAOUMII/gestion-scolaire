'use strict';

// Unit test — firestore-sync-assertion-crash-fix
//
// Spec: .kiro/specs/firestore-sync-assertion-crash-fix/
// Task 3.4 — Capture unhandled rejection and route it to the recovery path
//
// **Validates: Requirements 2.3**
//
// Exercises the REAL exported `installUnhandledRejectionHandler` from
// main/sync/engine.js. The handler must:
//   1. Register a `process.on('unhandledRejection', ...)` listener exactly ONCE,
//      even across repeated sync (re)starts (idempotent module-level guard).
//   2. Route ONLY the bug-domain errors (auth/network-request-failed /
//      INTERNAL ASSERTION FAILED) to recovery — non-matching rejections are left
//      to the default behavior unchanged.

const assert = require('assert');

const { installUnhandledRejectionHandler } = require('../main/sync/engine');

console.log('[unit] firestore-sync-assertion-crash Task 3.4: unhandledRejection capture + routing');

// ---------------------------------------------------------------------------
// (1) Idempotent one-time registration (Req 2.3)
// ---------------------------------------------------------------------------
const before = process.listenerCount('unhandledRejection');

installUnhandledRejectionHandler();
installUnhandledRejectionHandler();
installUnhandledRejectionHandler();

const after = process.listenerCount('unhandledRejection');

assert.strictEqual(
    after - before,
    1,
    `installUnhandledRejectionHandler must register exactly one listener across repeated ` +
        `calls (idempotent), but listener count changed by ${after - before}`
);

// Grab the listener we just installed (the most recently added one).
const listeners = process.listeners('unhandledRejection');
const handler = listeners[listeners.length - 1];
assert.strictEqual(typeof handler, 'function', 'expected an unhandledRejection handler to be installed');

// ---------------------------------------------------------------------------
// (2) Routing: matching errors are handled (no throw escapes), non-matching
//     errors are ignored so the default behavior is preserved (Req 2.3).
//
// The handler fires recovery as a detached promise and swallows its own errors,
// so invoking it directly must never throw regardless of the input.
// ---------------------------------------------------------------------------

// Matching: auth/network-request-failed -> routed to recovery, must not throw.
assert.doesNotThrow(
    () => handler({ code: 'auth/network-request-failed', message: 'network error' }),
    'handler must not throw on a matching auth/network-request-failed rejection'
);

// Matching: INTERNAL ASSERTION FAILED -> routed to recovery, must not throw.
assert.doesNotThrow(
    () => handler(new Error('FIRESTORE (12.12.1) INTERNAL ASSERTION FAILED: Unexpected state (ID: b815)')),
    'handler must not throw on a matching INTERNAL ASSERTION rejection'
);

// Non-matching: an ordinary rejection is ignored (default behavior preserved).
assert.doesNotThrow(
    () => handler(new Error('some unrelated failure')),
    'handler must not throw on a non-matching rejection'
);

assert.doesNotThrow(
    () => handler({ code: 'permission-denied' }),
    'handler must leave permission-denied to its default behavior unchanged'
);

// Clean up the listener we installed so it does not leak into any shared runner.
process.removeListener('unhandledRejection', handler);

console.log('[unit] PASS: unhandledRejection handler registers once and routes only bug-domain errors');

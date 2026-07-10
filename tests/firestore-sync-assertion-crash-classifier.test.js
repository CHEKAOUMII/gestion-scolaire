'use strict';

// Unit test — firestore-sync-assertion-crash-fix
//
// Spec: .kiro/specs/firestore-sync-assertion-crash-fix/
// Task 3.1 — Add the recoverable-error classification function
//
// **Validates: Requirements 1.1, 2.1**
//
// Exercises the REAL exported `isAssertionOrAuthNetworkError` from
// main/sync/engine.js. The classifier must return true ONLY for the bug-domain
// errors described in design.md (auth/network-request-failed, or an
// `INTERNAL ASSERTION FAILED: Unexpected state` message including ID: b815 /
// ID: 3c6b), and false for every existing/other error code so their current
// classification is left unchanged.

const assert = require('assert');

const { isAssertionOrAuthNetworkError } = require('../main/sync/engine');

console.log('[unit] firestore-sync-assertion-crash Task 3.1: recoverable-error classifier');

// ---------------------------------------------------------------------------
// Recoverable (bug-domain) errors -> true
// ---------------------------------------------------------------------------

// Auth network failure (the code that leaks into the transaction classifier).
assert.strictEqual(
    isAssertionOrAuthNetworkError({ code: 'auth/network-request-failed' }),
    true,
    'auth/network-request-failed must be recoverable'
);

// Auth network failure carrying an unrelated message still classifies by code.
assert.strictEqual(
    isAssertionOrAuthNetworkError({
        code: 'auth/network-request-failed',
        message: 'A network error (such as timeout, interrupted connection ...) occurred.'
    }),
    true,
    'auth/network-request-failed classifies by code regardless of message'
);

// Internal assertion leak — generic message.
assert.strictEqual(
    isAssertionOrAuthNetworkError({
        message: 'FIRESTORE (12.12.1) INTERNAL ASSERTION FAILED: Unexpected state'
    }),
    true,
    'INTERNAL ASSERTION FAILED: Unexpected state message must be recoverable'
);

// Internal assertion leak — specific ID variants from the crash reports.
assert.strictEqual(
    isAssertionOrAuthNetworkError({ message: 'Unexpected state (ID: b815)' }),
    true,
    'ID: b815 must be recoverable'
);
assert.strictEqual(
    isAssertionOrAuthNetworkError({ message: 'Unexpected state (ID: 3c6b)' }),
    true,
    'ID: 3c6b must be recoverable'
);

// Assertion signal may arrive via the error `context` rather than `message`.
assert.strictEqual(
    isAssertionOrAuthNetworkError({
        message: '',
        context: { code: 'auth/network-request-failed', detail: '(ID: b815)' }
    }),
    true,
    'assertion signal carried in context must be recoverable'
);

// ---------------------------------------------------------------------------
// Existing / other errors -> false (classification unchanged)
// ---------------------------------------------------------------------------

const NON_RECOVERABLE_CODES = [
    'unavailable',
    'aborted',
    'permission-denied',
    'VERSION_CONFLICT',
    'resource-exhausted',
    'not-found',
    'failed-precondition',
    'unauthenticated',
    'invalid-argument',
    'deadline-exceeded',
    'internal'
];

for (const code of NON_RECOVERABLE_CODES) {
    assert.strictEqual(
        isAssertionOrAuthNetworkError({ code }),
        false,
        `${code} must NOT be classified as recoverable`
    );
    // A benign message must not flip the decision for these codes.
    assert.strictEqual(
        isAssertionOrAuthNetworkError({ code, message: 'transient failure, please retry' }),
        false,
        `${code} with a benign message must NOT be recoverable`
    );
}

// VERSION_CONFLICT thrown as an Error with that message must still be false.
assert.strictEqual(
    isAssertionOrAuthNetworkError(new Error('VERSION_CONFLICT')),
    false,
    'VERSION_CONFLICT error message must NOT be recoverable'
);

// ---------------------------------------------------------------------------
// Malformed / absent errors -> false (never throws)
// ---------------------------------------------------------------------------

assert.strictEqual(isAssertionOrAuthNetworkError(null), false, 'null err is not recoverable');
assert.strictEqual(isAssertionOrAuthNetworkError(undefined), false, 'undefined err is not recoverable');
assert.strictEqual(isAssertionOrAuthNetworkError({}), false, 'err with no code/message is not recoverable');

// Always returns a boolean.
assert.strictEqual(
    typeof isAssertionOrAuthNetworkError({ code: 'auth/network-request-failed' }),
    'boolean',
    'must return a boolean'
);

console.log('[pass] Task 3.1 classifier: recoverable bug-domain errors detected, existing classifications unchanged');

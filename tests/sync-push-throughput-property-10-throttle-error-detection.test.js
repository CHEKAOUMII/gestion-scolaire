'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 2.5 — Property 10: Throttle-error detection
//
// **Validates: Requirements 3.8**
//
// Exercises the REAL exported `isThrottleError` from main/sync/engine.js by
// generating arbitrary error objects whose `code` is drawn from both the
// throttle set { resource-exhausted, unavailable, aborted } and a wide range of
// non-throttle codes (including `permission-denied`, which is handled as
// access-denied), plus malformed/absent errors (null, undefined, no code,
// non-string code). The classification must match the documented throttle set
// exactly.
//
// Feature: sync-push-throughput-optimization, Property 10: For any error whose
// code is resource-exhausted, unavailable, or aborted, the write result's
// throttle indicator is true; for any other error code (excluding
// permission-denied, which is handled as access-denied) it is false.

const assert = require('assert');
const fc = require('fast-check');

const { isThrottleError } = require('../main/sync/engine');

const MIN_RUNS = 100;

// The documented throttle set (design.md throttle detection, Req 3.4, 3.8).
const THROTTLE_CODES = ['resource-exhausted', 'unavailable', 'aborted'];

// A representative spread of non-throttle Firestore error codes. `permission-denied`
// is explicitly included because the spec calls it out as access-denied, NOT throttle.
const NON_THROTTLE_CODES = [
    'permission-denied',
    'not-found',
    'failed-precondition',
    'unknown',
    'already-exists',
    'invalid-argument',
    'deadline-exceeded',
    'cancelled',
    'data-loss',
    'unauthenticated',
    'internal',
    'out-of-range',
    'aborted ', // trailing space -> not an exact match, must be non-throttle
    'ABORTED', // wrong case -> not an exact match
    'resource_exhausted', // underscore variant -> not an exact match
    ''
];

console.log('[pbt] sync-push-throughput Property 10: throttle-error detection');

let checks = 0;

// ---------------------------------------------------------------------------
// Generator: an arbitrary error object, tagged with whether it SHOULD classify
// as a throttle error per the documented set. We build errors from:
//   - a throttle code (expected: true)
//   - a non-throttle code (expected: false)
//   - a random arbitrary string code (expected: membership in THROTTLE_CODES)
//   - a missing/non-string/absent error (expected: false)
// Extra noise properties (message, name, stack) must not affect the decision.
// ---------------------------------------------------------------------------

const noiseArb = fc.record(
    {
        message: fc.string(),
        name: fc.string(),
        stack: fc.string(),
        httpStatus: fc.integer()
    },
    { requiredKeys: [] }
);

const throttleErrArb = fc
    .tuple(fc.constantFrom(...THROTTLE_CODES), noiseArb)
    .map(([code, noise]) => ({ err: Object.assign({}, noise, { code }), expected: true }));

const nonThrottleErrArb = fc
    .tuple(fc.constantFrom(...NON_THROTTLE_CODES), noiseArb)
    .map(([code, noise]) => ({ err: Object.assign({}, noise, { code }), expected: false }));

// Arbitrary free-form string codes: expectation derived purely from set membership.
const arbitraryCodeErrArb = fc
    .tuple(fc.string(), noiseArb)
    .map(([code, noise]) => ({
        err: Object.assign({}, noise, { code }),
        expected: THROTTLE_CODES.includes(code)
    }));

// Malformed / absent errors: null, undefined, no code, non-string code.
const malformedErrArb = fc.oneof(
    fc.constant({ err: null, expected: false }),
    fc.constant({ err: undefined, expected: false }),
    fc.constant({ err: {}, expected: false }),
    noiseArb.map((noise) => ({ err: noise, expected: false })), // no `code` key
    fc.oneof(fc.integer(), fc.boolean(), fc.constant(null)).map((code) => ({
        err: { code },
        expected: THROTTLE_CODES.includes(code) // never true for non-strings
    }))
);

const caseArb = fc.oneof(
    throttleErrArb,
    nonThrottleErrArb,
    arbitraryCodeErrArb,
    malformedErrArb
);

fc.assert(
    fc.property(caseArb, ({ err, expected }) => {
        const result = isThrottleError(err);

        assert.strictEqual(typeof result, 'boolean', 'isThrottleError must return a boolean');
        assert.strictEqual(
            result,
            expected,
            `isThrottleError classification mismatch for code=${JSON.stringify(err && err.code)}: ` +
                `got ${result}, expected ${expected}`
        );

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors — the exact documented set and the access-denied carve-out,
// independent of whether the random domain happens to hit them.
// ---------------------------------------------------------------------------
{
    // Every throttle code classifies true.
    for (const code of THROTTLE_CODES) {
        assert.strictEqual(isThrottleError({ code }), true, `${code} must be throttle`);
    }

    // permission-denied is access-denied, NOT throttle (explicit spec carve-out).
    assert.strictEqual(isThrottleError({ code: 'permission-denied' }), false, 'permission-denied is not throttle');

    // Other common codes classify false.
    assert.strictEqual(isThrottleError({ code: 'not-found' }), false, 'not-found is not throttle');
    assert.strictEqual(isThrottleError({ code: 'failed-precondition' }), false, 'failed-precondition is not throttle');
    assert.strictEqual(isThrottleError({ code: 'unknown' }), false, 'unknown is not throttle');

    // Absent / malformed errors classify false.
    assert.strictEqual(isThrottleError(null), false, 'null err is not throttle');
    assert.strictEqual(isThrottleError(undefined), false, 'undefined err is not throttle');
    assert.strictEqual(isThrottleError({}), false, 'err with no code is not throttle');
    assert.strictEqual(isThrottleError({ code: 123 }), false, 'non-string code is not throttle');
}

console.log(`[pass] Property 10 held across ${checks} generated error objects + boundary anchors`);

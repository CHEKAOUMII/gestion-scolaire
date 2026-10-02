'use strict';

/**
 * Property-based test for the Direction Mapper (core/direction-mapper.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * orderer.property.test.js and scanner.property.test.js): plain Node built-in
 * `assert`, named test functions, and a `run()` driver that throws (non-zero
 * exit) on the first failed assertion. The only added dependency is
 * `fast-check` (a dev dependency, v4). Both `tokenize()` and `mapPhysical()`
 * are pure, so each generated `class` token string is fed straight through
 * `mapPhysical(tokenize(x)[0])`.
 *
 * Property 12: Physical→logical mapping is total and position-preserving.
 *
 * For any physical-direction utility token:
 *   - if it has a logical equivalent it is replaced by that equivalent with the
 *     value preserved (only the axis keyword changes), and variants and any
 *     leading negative sign are preserved (Req 8.1, 8.2, 8.3);
 *   - if it has no logical equivalent it is retained unchanged and recorded
 *     with a reason (Req 8.5);
 *   - `mapPhysical` is TOTAL: every input yields exactly one of the two
 *     decision shapes and never throws for valid ClassTokens.
 *
 * **Validates: Requirements 8.1, 8.2, 8.3, 8.5**
 *
 * Run directly:  node tools/tailwind-standardize/tests/direction-mapper.property.test.js
 */

// Feature: tailwind-css-standardization, Property 12: Physical→logical mapping is total and position-preserving

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { mapPhysical, PHYSICAL_TO_LOGICAL } = require(path.join(__dirname, '..', 'core', 'direction-mapper.js'));
const { REVIEW_REASON_CATEGORIES, ReviewReasonCategory } = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// The physical-direction prefixes that DO have a logical equivalent. Sourced
// directly from the implementation's single source of truth so the test tracks
// the table automatically.
const MAPPABLE_PREFIXES = Array.from(PHYSICAL_TO_LOGICAL.keys());

// Utilities WITHOUT an inline logical equivalent: block-axis physical utilities
// (direction-independent) plus a handful of plainly unmapped utilities. None of
// these start with any mappable physical prefix, so they must hit the retain
// branch. Kept as full prefixes that the value generator completes.
const UNMAPPED_PREFIXES = [
    // block-axis physical utilities (direction-independent-effect)
    'pt-', 'pb-', 'mt-', 'mb-', 'top-', 'bottom-',
    'border-t-', 'border-b-', 'rounded-t-', 'rounded-b-',
    'scroll-mt-', 'scroll-mb-', 'scroll-pt-', 'scroll-pb-',
    // plainly unmapped utilities (no-logical-equivalent)
    'bg-', 'text-', 'w-', 'h-', 'gap-', 'z-', 'opacity-',
];

// Value suffixes appended after a prefix: scale numbers, special keywords,
// fractions, and bracket-notation arbitrary values. All non-empty so the
// resulting body always carries its prefix.
const valueArb = fc.constantFrom(
    '0', '1', '2', '4', '8', '10', '0.5', '2.5',
    'px', 'full', 'auto', 'screen',
    '1/2', '1/3', '2/3', '3/4',
    '[16px]', '[3rem]', '[50%]', '[10px]', '[calc(100%-2rem)]'
);

// Variant prefixes (with trailing colon) and the bare case. Includes responsive,
// state, and combined responsive+state, plus an arbitrary variant for breadth.
const VARIANT_PREFIXES = ['', 'sm:', 'md:', 'lg:', 'xl:', '2xl:', 'hover:', 'focus:', 'md:hover:', 'lg:focus:', 'group-hover:'];
const variantArb = fc.constantFrom(...VARIANT_PREFIXES);

// Leading negative sign (Tailwind allows e.g. `-ml-4`, `-left-2`).
const negativeArb = fc.constantFrom('', '-');

/** Compute the variant array a tokenizer would derive from a variant prefix. */
function variantsOf(variantPrefix) {
    if (variantPrefix === '') {
        return [];
    }
    // strip trailing ':' then split — e.g. 'md:hover:' -> ['md','hover']
    return variantPrefix.slice(0, -1).split(':');
}

// A mappable token: variant prefix + optional negative + mappable physical
// prefix + value. Carries the structured parts alongside the raw string so the
// property can assert position preservation without re-deriving them.
const mappableArb = fc
    .tuple(variantArb, negativeArb, fc.constantFrom(...MAPPABLE_PREFIXES), valueArb)
    .map(([variantPrefix, negative, prefix, value]) => ({
        raw: `${variantPrefix}${negative}${prefix}${value}`,
        variantPrefix,
        negative,
        prefix,
        value,
    }));

// An unmapped token: variant prefix + optional negative + unmapped prefix + value.
const unmappedArb = fc
    .tuple(variantArb, negativeArb, fc.constantFrom(...UNMAPPED_PREFIXES), valueArb)
    .map(([variantPrefix, negative, prefix, value]) => ({
        raw: `${variantPrefix}${negative}${prefix}${value}`,
        prefix,
    }));

// ---------------------------------------------------------------------------
// Shape helpers
// ---------------------------------------------------------------------------

/** True iff a result is the value-preserving logical-swap shape. */
function isLogicalShape(result) {
    return result !== null
        && typeof result === 'object'
        && Object.prototype.hasOwnProperty.call(result, 'logical')
        && !Object.prototype.hasOwnProperty.call(result, 'retain');
}

/** True iff a result is the retain-with-reason shape. */
function isRetainShape(result) {
    return result !== null
        && typeof result === 'object'
        && result.retain === true
        && typeof result.reason === 'string';
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

function testMappablePhysicalUtilitiesAreSwappedValuePreserving() {
    fc.assert(
        fc.property(mappableArb, (spec) => {
            const token = tokenize(spec.raw)[0];
            const result = mapPhysical(token);

            // Mappable utilities take the logical-swap branch.
            assert.ok(isLogicalShape(result), `expected logical swap for "${spec.raw}"`);

            const logical = result.logical;
            assert.ok(logical && typeof logical.raw === 'string', 'logical result must be a ClassToken');

            // Only the axis keyword changes: the new base is the negative sign,
            // the mapped logical prefix, then the UNCHANGED value suffix (Req 8.1-8.3).
            const expectedLogicalPrefix = PHYSICAL_TO_LOGICAL.get(spec.prefix);
            const expectedBase = `${spec.negative}${expectedLogicalPrefix}${spec.value}`;
            assert.strictEqual(logical.base, expectedBase, `value/axis preservation failed for "${spec.raw}"`);

            // The value suffix is byte-for-byte unchanged.
            const suffix = logical.base.slice(spec.negative.length + expectedLogicalPrefix.length);
            assert.strictEqual(suffix, spec.value, 'value suffix must be preserved verbatim');

            // The negative sign is preserved exactly.
            assert.strictEqual(
                logical.base.startsWith('-'),
                spec.negative === '-',
                'leading negative sign must be preserved'
            );

            // Variants are preserved exactly (order included).
            assert.deepStrictEqual(
                Array.from(logical.variants),
                variantsOf(spec.variantPrefix),
                'variants must be preserved'
            );
        }),
        { numRuns: 200 }
    );

    console.log('[direction-mapper.property] mappable utilities swap axis keyword, preserve value + variants OK');
}

function testUnmappedPhysicalUtilitiesAreRetainedWithReason() {
    fc.assert(
        fc.property(unmappedArb, (spec) => {
            const token = tokenize(spec.raw)[0];
            const result = mapPhysical(token);

            // Utilities lacking a logical equivalent are retained with a reason (Req 8.5).
            assert.ok(isRetainShape(result), `expected retain for "${spec.raw}"`);
            assert.ok(
                REVIEW_REASON_CATEGORIES.includes(result.reason),
                `retain reason must be a known category, got "${result.reason}"`
            );
            assert.ok(
                result.reason === ReviewReasonCategory.DIRECTION_INDEPENDENT_EFFECT
                || result.reason === ReviewReasonCategory.NO_LOGICAL_EQUIVALENT,
                `retain reason must explain the lack of a logical equivalent, got "${result.reason}"`
            );

            // The original token's text is never rewritten on the retain branch.
            assert.strictEqual(token.raw, spec.raw, 'retained token raw text must be unchanged');
        }),
        { numRuns: 200 }
    );

    console.log('[direction-mapper.property] unmapped utilities are retained with an explanatory reason OK');
}

function testMapPhysicalIsTotal() {
    // Any token drawn from either pool yields exactly one of the two shapes and
    // never throws — totality over valid ClassTokens.
    const anyTokenArb = fc.oneof(
        mappableArb.map((s) => s.raw),
        unmappedArb.map((s) => s.raw)
    );

    fc.assert(
        fc.property(anyTokenArb, (raw) => {
            const token = tokenize(raw)[0];

            let result;
            assert.doesNotThrow(() => {
                result = mapPhysical(token);
            }, `mapPhysical must not throw for valid ClassToken "${raw}"`);

            const logical = isLogicalShape(result);
            const retain = isRetainShape(result);

            // Exactly one decision shape — total and unambiguous.
            assert.ok(logical || retain, `mapPhysical must return a decision for "${raw}"`);
            assert.ok(!(logical && retain), `mapPhysical decision must be unambiguous for "${raw}"`);
        }),
        { numRuns: 200 }
    );

    console.log('[direction-mapper.property] mapPhysical is total: one decision per token, never throws OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testMappablePhysicalUtilitiesAreSwappedValuePreserving();
    testUnmappedPhysicalUtilitiesAreRetainedWithReason();
    testMapPhysicalIsTotal();
    console.log('[direction-mapper.property] All direction-mapper property tests passed');
}

run();

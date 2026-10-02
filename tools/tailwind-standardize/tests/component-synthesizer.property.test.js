'use strict';

/**
 * Property-based test for the Component-Class Synthesizer
 * (core/component-synthesizer.js, `synthesizeComponentClass`).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * combination-detector.property.test.js and identifier-conventions.property.test.js):
 * plain Node built-in `assert`, named test functions, and a `run()` driver that
 * throws (non-zero exit) on the first failed assertion. The only added
 * dependency is `fast-check` (already a dev dependency, v4).
 * `synthesizeComponentClass()` is pure (no file system access), so each
 * generated utility set is fed directly.
 *
 * Property under test (design Property 11):
 *
 *   For any utility combination appearing at >= 2 locations whose component-class
 *   substitution preserves every affected element's computed declarations, the
 *   tool defines EXACTLY ONE component class — expressed with `@apply` /
 *   `var(--token)` references consistent with existing Component_Layer entries —
 *   and (conceptually) replaces each occurrence with it.
 *
 * Concretely, for any utility set of two or more (order-independent) utilities,
 * `synthesizeComponentClass`:
 *   1. returns a single `{ className, declaration }` (one class per combination);
 *   2. whose declaration is an `@apply <utilities>;` rule (consistency with the
 *      existing Component_Layer convention) containing EXACTLY the canonical
 *      (sorted, de-duplicated) utility set — i.e. an equivalent consolidation of
 *      the original utilities, nothing added or dropped; and
 *   3. is deterministic / order-independent: re-running with any shuffled (or
 *      duplicate-padded) permutation of the same utilities yields a byte-for-byte
 *      identical className AND declaration.
 *
 * **Validates: Requirements 4.1, 4.2**
 *
 * Run directly:  node tools/tailwind-standardize/tests/component-synthesizer.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { synthesizeComponentClass } = require(
    path.join(__dirname, '..', 'core', 'component-synthesizer.js')
);

// ---------------------------------------------------------------------------
// Deterministic helpers — seeded shuffle so input (declaration) order is varied
// without coupling the test to fast-check's internal sequencing.
// ---------------------------------------------------------------------------

/** Tiny seeded PRNG (mulberry32) for deterministic, reproducible shuffles. */
function mulberry32(seed) {
    let a = seed >>> 0;
    return function next() {
        a |= 0;
        a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/** Fisher–Yates shuffle into a new array using the supplied PRNG. */
function shuffle(arr, rng) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i -= 1) {
        const j = Math.floor(rng() * (i + 1));
        const tmp = out[i];
        out[i] = out[j];
        out[j] = tmp;
    }
    return out;
}

/** The canonical (sorted, de-duplicated) form of a utility list. */
function canonical(utilities) {
    return Array.from(new Set(utilities)).sort();
}

/**
 * Parse the single `@apply <utilities>;` body out of a synthesized declaration
 * of the shape `.<name> {\n    @apply a b c;\n}`. Returns the utility list (in
 * declaration order) or `null` when the declaration is not a single `@apply`.
 */
function parseApplyUtilities(declaration) {
    const matches = declaration.match(/@apply\s+([^;]+);/g);
    if (!matches || matches.length !== 1) {
        return null;
    }
    const inner = /@apply\s+([^;]+);/.exec(matches[0])[1];
    return inner.trim().split(/\s+/).filter((u) => u.length > 0);
}

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A bank of realistic, distinct utility tokens (bare + variant-prefixed). These
// are the order-independent members of a recurring combination candidate.
const UTILITY_BANK = [
    'flex', 'block', 'grid', 'hidden', 'relative', 'absolute',
    'border', 'rounded', 'shadow', 'transition',
    'bg-primary', 'bg-surface', 'text-white', 'text-main', 'text-sm',
    'items-center', 'justify-between', 'rounded-md', 'border-solid',
    'flex-col', 'flex-row', 'p-4', 'px-2', 'gap-2', 'mt-4',
    'hover:bg-primary', 'md:flex', 'md:hover:bg-surface', 'focus:ring-2',
];
const utilityArb = fc.constantFrom(...UTILITY_BANK);

// A recurring combination is an order-independent set of two or more utilities.
const utilitySetArb = fc.uniqueArray(utilityArb, { minLength: 2, maxLength: 8 });

// An optional existing Component_Layer index that establishes the kebab-case
// convention (names only, no declarations -> no collision possible against a
// utility-derived name). Each name has >= 2 segments so the convention is
// unambiguous.
const WORD_BANK = ['card', 'panel', 'btn', 'badge', 'list', 'item', 'modal', 'header', 'footer', 'tile'];
const layerIndexArb = fc.uniqueArray(
    fc.tuple(fc.constantFrom(...WORD_BANK), fc.constantFrom(...WORD_BANK)).map(([a, b]) => `${a}-${b}`),
    { minLength: 0, maxLength: 5 }
);

const scenarioArb = fc.record({
    utilitySet: utilitySetArb,
    layerIndex: layerIndexArb,
    // Number of duplicate members to splice in (order-independence + dedup check).
    duplicates: fc.integer({ min: 0, max: 4 }),
    seed: fc.integer({ min: 0, max: 0x7fffffff }),
    reseed: fc.integer({ min: 0, max: 0x7fffffff }),
});

// ---------------------------------------------------------------------------
// Property 11
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 11: Component-class consolidation is equivalent and convention-conforming
function testComponentClassConsolidation() {
    fc.assert(
        fc.property(scenarioArb, (s) => {
            const canonicalSet = canonical(s.utilitySet);
            const layerIndex = s.layerIndex.slice();

            // --- 1) Exactly one component class is defined for the combination. ---
            const result = synthesizeComponentClass(s.utilitySet, layerIndex);

            assert.ok(
                !result.collision,
                `unexpected collision synthesizing ${JSON.stringify(canonicalSet)} -> ${result.className}`
            );
            assert.strictEqual(
                typeof result.className,
                'string',
                'result must carry a single className string'
            );
            assert.ok(result.className.length > 0, 'className must be non-empty');
            assert.strictEqual(
                typeof result.declaration,
                'string',
                'result must carry a single declaration string'
            );

            // --- 2) Declaration is a single `@apply <utilities>;` rule
            //        (consistency with existing Component_Layer entries) ... ---
            const applied = parseApplyUtilities(result.declaration);
            assert.ok(
                applied !== null,
                `declaration must contain exactly one @apply rule, got: ${result.declaration}`
            );

            // ... and the selector wraps the returned class name.
            assert.ok(
                result.declaration.includes(`.${result.className}`),
                `declaration must define the class .${result.className}: ${result.declaration}`
            );

            // --- equivalent consolidation: the @apply list is EXACTLY the
            //     canonical (sorted, de-duplicated) utility set — nothing added,
            //     nothing dropped, no duplicates. ---
            assert.deepStrictEqual(
                applied,
                canonicalSet,
                'the @apply utility list must equal the canonical (sorted, de-duplicated) utility set'
            );
            assert.strictEqual(
                applied.length,
                new Set(applied).size,
                'the @apply utility list must contain no duplicates'
            );

            // --- 3) Deterministic / order-independent: a shuffled, duplicate-
            //        padded permutation of the same utilities yields an identical
            //        className AND declaration (one class per combination). ---
            const rng = mulberry32(s.seed);
            const padded = canonicalSet.slice();
            for (let i = 0; i < s.duplicates; i += 1) {
                // Re-insert an existing member so the multiset has duplicates.
                padded.push(canonicalSet[i % canonicalSet.length]);
            }
            const shuffled = shuffle(padded, mulberry32(s.reseed));

            const again = synthesizeComponentClass(shuffled, layerIndex);
            assert.ok(!again.collision, 'shuffled re-synthesis must not collide');
            assert.strictEqual(
                again.className,
                result.className,
                'className must be order-independent and duplicate-insensitive'
            );
            assert.strictEqual(
                again.declaration,
                result.declaration,
                'declaration must be order-independent and duplicate-insensitive (byte-for-byte identical)'
            );

            // A second shuffle (different seed) must also reproduce the same output.
            const thirdShuffle = shuffle(s.utilitySet, rng);
            const third = synthesizeComponentClass(thirdShuffle, layerIndex);
            assert.strictEqual(third.className, result.className, 'second shuffle className must match');
            assert.strictEqual(third.declaration, result.declaration, 'second shuffle declaration must match');
        }),
        { numRuns: 200 }
    );

    console.log('[component-synthesizer.property] Property 11: component-class consolidation OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testComponentClassConsolidation();
    console.log('[component-synthesizer.property] All component-synthesizer property tests passed');
}

run();

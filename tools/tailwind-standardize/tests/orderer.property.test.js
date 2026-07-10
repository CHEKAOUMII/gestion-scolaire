'use strict';

/**
 * Property-based test for the Utility Orderer (core/orderer.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * scanner.property.test.js and tokenizer.test.js): plain Node built-in `assert`,
 * named test functions, and a `run()` driver that throws (non-zero exit) on the
 * first failed assertion. The only added dependency is `fast-check` (a dev
 * dependency, v4). Both `tokenize()` and `order()` are pure, so each generated
 * `class` attribute string is fed straight through `order(tokenize(x))`.
 *
 * Property 7: Utility ordering is a stable, category-sequenced permutation.
 *
 * For any class attribute, `order(tokenize(x))`:
 *   - is a permutation of the original token multiset — no token added, removed,
 *     or duplicated, and every token's `raw` string is unchanged (Req 5.3);
 *   - is ordered by the category sequence layout -> spacing -> sizing -> colors
 *     -> effects -> transforms, with uncategorized utilities last (Req 5.1, 5.5);
 *   - places each variant-prefixed utility immediately after its non-prefixed
 *     counterpart, the Responsive_Variant ordered before the State_Variant
 *     (Req 5.2);
 *   - preserves the original left-to-right relative order within a category and
 *     among uncategorized utilities (Req 5.4, 5.5).
 *
 * **Validates: Requirements 5.1, 5.2, 5.3, 5.4, 5.5**
 *
 * Run directly:  node tools/tailwind-standardize/tests/orderer.property.test.js
 */

// Feature: tailwind-css-standardization, Property 7: Utility ordering is a stable, category-sequenced permutation

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { order, CATEGORY_SEQUENCE } = require(path.join(__dirname, '..', 'core', 'orderer.js'));

// ---------------------------------------------------------------------------
// Utility pool — base utilities spanning every category, plus uncategorized
// tokens and bracketed arbitrary values. Categories are derived solely by the
// tokenizer, so the generator never needs to know them up front.
// ---------------------------------------------------------------------------

const BASE_UTILITIES = [
    // layout
    'flex', 'grid', 'block', 'hidden', 'relative', 'absolute',
    'items-center', 'justify-between', 'z-10', 'top-0',
    // spacing
    'p-4', 'px-2', 'py-1', 'm-2', 'mt-2', 'gap-4',
    // sizing
    'w-4', 'h-full', 'min-w-0', 'max-w-lg', 'text-xl',
    // colors
    'bg-primary', 'text-red-500', 'fill-current', 'from-blue-500',
    // effects
    'shadow', 'rounded', 'opacity-50', 'border', 'shadow-lg', 'transition', 'ring-2',
    // transforms
    'scale-95', 'rotate-45', 'translate-x-2', 'skew-y-3',
    // uncategorized
    'sr-only', 'antialiased', 'appearance-none', 'cursor-pointer',
    // arbitrary values (bracket notation)
    'mt-[16px]', 'w-[33%]', 'bg-[#fff]',
];

// Variant prefixes: '' (non-prefixed counterpart), responsive (sm/md/lg),
// state (hover/focus), and combined responsive+state.
const VARIANT_PREFIXES = ['', 'sm:', 'md:', 'lg:', 'hover:', 'focus:', 'md:hover:', 'lg:focus:'];

const baseArb = fc.constantFrom(...BASE_UTILITIES);
const variantArb = fc.constantFrom(...VARIANT_PREFIXES);
const tokenArb = fc.tuple(variantArb, baseArb).map(([v, b]) => v + b);

// A class attribute string: 0..12 space-separated tokens (duplicates allowed).
const classAttrArb = fc
    .array(tokenArb, { minLength: 0, maxLength: 12 })
    .map((tokens) => tokens.join(' '));

// ---------------------------------------------------------------------------
// Verification helpers
// ---------------------------------------------------------------------------

/** Index of a token's category in the emission sequence (uncategorized last). */
function categoryIndex(token) {
    const idx = CATEGORY_SEQUENCE.indexOf(token.category);
    return idx === -1 ? CATEGORY_SEQUENCE.indexOf('uncategorized') : idx;
}

/** The grouping key tying a variant-prefixed utility to its bare counterpart. */
function groupKey(token) {
    return typeof token.base === 'string' ? token.base : token.raw;
}

/**
 * Within-base-group rank: 0 = no variant, 1 = responsive-bearing, 2 = state-only.
 * Responsive is ordered before state (Req 5.2).
 */
function variantRank(token) {
    const hasVariant = Array.isArray(token.variants) && token.variants.length > 0;
    if (!hasVariant) {
        return 0;
    }
    if (token.responsiveVariant !== null && token.responsiveVariant !== undefined) {
        return 1;
    }
    return 2;
}

/** Multiset of raw strings as a sorted array (for permutation comparison). */
function rawMultiset(tokens) {
    return tokens.map((t) => t.raw).slice().sort();
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

function testUtilityOrderingIsStableCategorySequencedPermutation() {
    fc.assert(
        fc.property(classAttrArb, (classAttr) => {
            const input = tokenize(classAttr);
            const output = order(input);

            // --- (1) Permutation invariant ----------------------------------
            // Same count, and the multiset of raw strings is byte-for-byte equal
            // (no token added, removed, duplicated, or rewritten). Req 5.3.
            assert.strictEqual(output.length, input.length, 'token count must be preserved');
            assert.deepStrictEqual(
                rawMultiset(output),
                rawMultiset(input),
                'output must be a permutation of the input raw-string multiset'
            );

            // order() reuses the SAME token object references, so identity maps
            // each output token unambiguously back to its original position
            // (robust even when raw strings are duplicated).
            const originalIndex = new Map();
            input.forEach((token, i) => {
                if (!originalIndex.has(token)) {
                    originalIndex.set(token, i);
                }
            });
            for (const token of output) {
                assert.ok(originalIndex.has(token), 'every output token must be an input token instance');
            }

            // --- (2) Category-sequence monotonicity --------------------------
            // Category indices are non-decreasing across the output, so the
            // emission order is layout -> spacing -> sizing -> colors -> effects
            // -> transforms, with uncategorized last. Req 5.1, 5.5.
            for (let i = 1; i < output.length; i += 1) {
                assert.ok(
                    categoryIndex(output[i]) >= categoryIndex(output[i - 1]),
                    'categories must be emitted in the fixed sequence (uncategorized last)'
                );
            }

            // --- (3) Base-group first-appearance order within a category -----
            // Within each category, the order of distinct bases by first
            // appearance in the output equals their first-appearance order in
            // the input. This preserves relative order within a category and
            // among uncategorized utilities. Req 5.4, 5.5.
            for (const category of CATEGORY_SEQUENCE) {
                const inputBases = [];
                const seenIn = new Set();
                for (const t of input) {
                    if (t.category === category && !seenIn.has(groupKey(t))) {
                        seenIn.add(groupKey(t));
                        inputBases.push(groupKey(t));
                    }
                }
                const outputBases = [];
                const seenOut = new Set();
                for (const t of output) {
                    if (t.category === category && !seenOut.has(groupKey(t))) {
                        seenOut.add(groupKey(t));
                        outputBases.push(groupKey(t));
                    }
                }
                assert.deepStrictEqual(
                    outputBases,
                    inputBases,
                    `base-group relative order must be preserved within category "${category}"`
                );
            }

            // --- (4) Variant adjacency, ranking, and equal-rank stability ----
            // Tokens sharing a (category, base) group are contiguous; within a
            // group the bare utility comes first, then responsive-bearing, then
            // state-only (Req 5.2), and equal-rank members keep their original
            // relative order (Req 5.4).
            const seenGroups = new Set();
            let prevGroup = null;
            let prevRank = -1;
            let prevOrigIndex = -1;
            for (const token of output) {
                const key = `${categoryIndex(token)}\u0000${groupKey(token)}`;
                if (key !== prevGroup) {
                    // Entering a new contiguous group: it must not have been
                    // emitted earlier (contiguity), and counters reset.
                    assert.ok(
                        !seenGroups.has(key),
                        'all tokens of one (category, base) group must be contiguous'
                    );
                    seenGroups.add(key);
                    prevGroup = key;
                    prevRank = -1;
                    prevOrigIndex = -1;
                }
                const rank = variantRank(token);
                const origIdx = originalIndex.get(token);
                assert.ok(
                    rank >= prevRank,
                    'within a group the bare utility precedes responsive, which precedes state'
                );
                if (rank === prevRank) {
                    assert.ok(
                        origIdx >= prevOrigIndex,
                        'equal-rank variants must keep their original relative order'
                    );
                }
                prevRank = rank;
                prevOrigIndex = origIdx;
            }
        }),
        { numRuns: 200 }
    );

    console.log('[orderer.property] utility ordering is a stable, category-sequenced permutation OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testUtilityOrderingIsStableCategorySequencedPermutation();
    console.log('[orderer.property] All orderer property tests passed');
}

run();

'use strict';

/**
 * Property-based test for the Variant Normalizer (core/variant-normalizer.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * direction-mapper.property.test.js and orderer.property.test.js): plain Node
 * built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (a dev dependency, v4).
 *
 * `normalizeVariants(occurrences)` is pure and returns `{ edits, manualReview }`:
 *   - edits:        `{ locator, category, before, after, added }` records, where
 *                   `added` is the list of hover utilities introduced.
 *   - manualReview: `ReviewItem`-shaped records (classification `manual-review`,
 *                   reason `arbitrary-breakpoint`) for elements retained verbatim.
 *
 * Property 14: Variant normalization stays within the configured system.
 *
 *   - Every introduced responsive prefix belongs to the configured set
 *     (`sm: md: lg: xl: 2xl:`) and no edit introduces a bracket-notation
 *     breakpoint (Req 9.1, 9.2).
 *   - Any element that carries a bracket-notation breakpoint (e.g. `min-[600px]:`
 *     / `max-[400px]:`) retains its original markup and is recorded as a
 *     manual-review item with reason `arbitrary-breakpoint`, receiving no
 *     automated edit (Req 9.2).
 *   - For any group of same-tag elements sharing the same non-variant utility
 *     set in which at least one element declares a `hover:` utility, that hover
 *     utility is present on every (non-flagged) element of the group after
 *     normalization (Req 9.3).
 *
 * **Validates: Requirements 9.1, 9.2, 9.3**
 *
 * Run directly:  node tools/tailwind-standardize/tests/variant-normalizer.property.test.js
 */

// Feature: tailwind-css-standardization, Property 14: Variant normalization stays within the configured system

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const { tokenize, RESPONSIVE_VARIANTS } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { normalizeVariants } = require(path.join(__dirname, '..', 'core', 'variant-normalizer.js'));
const {
    NormalizationCategory,
    ReviewClassification,
    ReviewReasonCategory,
    REVIEW_REASON_CATEGORIES,
} = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

const TAGS = ['button', 'a', 'div', 'span', 'input', 'label'];

// Non-variant utility classes (no variant prefix at all). These form the
// order-independent group key together with the element tag (Req 9.3).
const BASE_UTILS = [
    'px-4', 'py-2', 'rounded', 'bg-primary', 'text-white',
    'flex', 'border', 'gap-2', 'font-bold', 'shadow',
];

// Hover utilities that may be propagated. Includes plain hovers and combined
// responsive+hover variants whose responsive prefix is in the configured set,
// so propagation can introduce a configured responsive prefix (exercises 9.1).
const HOVER_UTILS = [
    'hover:bg-blue-600', 'hover:text-white', 'hover:underline',
    'hover:shadow-lg', 'hover:opacity-80',
    'md:hover:bg-red-500', 'lg:hover:underline', 'xl:hover:opacity-50',
];

// Plain hover utilities (no responsive prefix) for the arbitrary-breakpoint case.
const PLAIN_HOVER_UTILS = [
    'hover:bg-blue-600', 'hover:text-white', 'hover:underline', 'hover:shadow-lg',
];

// Bracket-notation breakpoint prefixes the tool must NEVER introduce (Req 9.2).
const ARBITRARY_BREAKPOINTS = ['min-[600px]:', 'max-[400px]:', 'min-[673px]:', 'max-[900px]:'];
const ARBITRARY_BASE = ['flex', 'hidden', 'block', 'grid'];

const FILE_PATH = 'src/pages/example.html';

/** Build a `class` attribute string from a base utility list + hover list. */
function classString(base, hovers) {
    return base.concat(hovers).join(' ');
}

/**
 * A hover-propagation group: a shared tag + non-variant base set, and a list of
 * per-member hover subsets drawn from a shared hover pool. At least one member
 * is guaranteed to declare a hover utility so the group's hover union is
 * non-empty (otherwise no propagation is expected).
 */
const groupArb = fc
    .tuple(
        fc.constantFrom(...TAGS),
        fc.uniqueArray(fc.constantFrom(...BASE_UTILS), { minLength: 1, maxLength: 4 }),
        fc.uniqueArray(fc.constantFrom(...HOVER_UTILS), { minLength: 1, maxLength: 3 })
    )
    .chain(([tag, base, hoverPool]) =>
        fc
            .array(fc.subarray(hoverPool), { minLength: 2, maxLength: 5 })
            .map((memberHovers) => {
                // Guarantee a non-empty hover union: force the first member to
                // declare a hover when every generated subset is empty.
                const hovers = memberHovers.map((h) => h.slice());
                if (hovers.every((h) => h.length === 0)) {
                    hovers[0] = [hoverPool[0]];
                }
                return { tag, base, hoverPool, memberHovers: hovers };
            })
    );

/**
 * An arbitrary-breakpoint scenario: a 2-member group (same tag + base) where
 * one member declares a plain hover utility and the OTHER carries a
 * bracket-notation breakpoint token (and no hover). The flagged member would
 * otherwise receive a propagated hover edit, so it doubles as the exclusion
 * check (flagged elements never receive an edit).
 */
const arbitraryArb = fc
    .tuple(
        fc.constantFrom(...TAGS),
        fc.uniqueArray(fc.constantFrom(...BASE_UTILS), { minLength: 1, maxLength: 3 }),
        fc.constantFrom(...PLAIN_HOVER_UTILS),
        fc.constantFrom(...ARBITRARY_BREAKPOINTS),
        fc.constantFrom(...ARBITRARY_BASE)
    )
    .map(([tag, base, hover, breakpoint, bpUtil]) => ({
        tag,
        base,
        hover,
        arbitraryToken: `${breakpoint}${bpUtil}`,
    }));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** The set of distinct hover utilities (by raw token text) across the group. */
function hoverUnionOf(memberHovers) {
    const union = new Set();
    for (const hovers of memberHovers) {
        for (const hover of hovers) {
            union.add(hover);
        }
    }
    return union;
}

/** Find the edit (if any) that targets a given line within FILE_PATH. */
function editForLine(edits, line, tag) {
    return edits.find((edit) => edit.locator.line === line && edit.locator.tag === tag);
}

// ---------------------------------------------------------------------------
// Properties
// ---------------------------------------------------------------------------

function testHoverPropagationCompletesEachGroup() {
    fc.assert(
        fc.property(groupArb, (group) => {
            const { tag, base, memberHovers } = group;

            // Build one occurrence per member. Reverse the base order on
            // odd-indexed members to confirm grouping is order-independent.
            const occurrences = memberHovers.map((hovers, index) => {
                const baseOrder = index % 2 === 0 ? base : base.slice().reverse();
                return {
                    value: classString(baseOrder, hovers),
                    locator: { filePath: FILE_PATH, line: index + 1, tag },
                };
            });

            const { edits, manualReview } = normalizeVariants(occurrences);

            // No arbitrary breakpoints here, so nothing is flagged.
            assert.strictEqual(manualReview.length, 0, 'no manual-review items expected without arbitrary breakpoints');

            const union = hoverUnionOf(memberHovers);

            // 9.3: every member ends up carrying the whole hover union.
            occurrences.forEach((occurrence, index) => {
                const edit = editForLine(edits, index + 1, tag);
                const finalValue = edit ? edit.after : occurrence.value;
                const finalSet = new Set(tokenize(finalValue).map((token) => token.raw));

                for (const hover of union) {
                    assert.ok(
                        finalSet.has(hover),
                        `member ${index} missing propagated hover "${hover}" (final: "${finalValue}")`
                    );
                }
            });

            // 9.1 / 9.2: edits only add hover utilities, never introduce an
            // arbitrary breakpoint, and any responsive prefix introduced is in
            // the configured set. `after` is exactly `before` + added tokens.
            for (const edit of edits) {
                assert.strictEqual(
                    edit.category,
                    NormalizationCategory.VARIANT_NORMALIZATION,
                    'edit category must be variant-normalization'
                );
                assert.ok(Array.isArray(edit.added) && edit.added.length > 0, 'an edit must add at least one utility');

                for (const addedRaw of edit.added) {
                    const addedTokens = tokenize(addedRaw);
                    for (const token of addedTokens) {
                        // Only hover utilities are ever propagated.
                        assert.strictEqual(token.stateVariant, 'hover', `added token "${addedRaw}" must be a hover utility`);

                        // No bracket-notation breakpoint is ever introduced.
                        for (const variant of token.variants) {
                            assert.ok(
                                !/^(?:min|max)-\[[^\]]*\]$/.test(variant),
                                `added token "${addedRaw}" must not introduce an arbitrary breakpoint`
                            );
                        }

                        // Any responsive prefix introduced is in the configured set.
                        if (token.responsiveVariant !== null) {
                            assert.ok(
                                RESPONSIVE_VARIANTS.has(token.responsiveVariant),
                                `introduced responsive prefix "${token.responsiveVariant}:" must be configured`
                            );
                        }
                    }
                }

                // `after` == `before` + the added tokens (no other change).
                assert.strictEqual(
                    edit.after,
                    `${edit.before} ${edit.added.join(' ')}`,
                    'after must equal before plus the added hover utilities'
                );
            }
        }),
        { numRuns: 200 }
    );

    console.log('[variant-normalizer.property] hover propagation completes each group within the configured system OK');
}

function testArbitraryBreakpointRetainedAsManualReview() {
    fc.assert(
        fc.property(arbitraryArb, (scenario) => {
            const { tag, base, hover, arbitraryToken } = scenario;

            // Member 1 declares a hover; member 2 carries the arbitrary
            // breakpoint and no hover (so it would otherwise be edited).
            const occurrences = [
                {
                    value: classString(base, [hover]),
                    locator: { filePath: FILE_PATH, line: 1, tag },
                },
                {
                    value: classString(base, [arbitraryToken]),
                    locator: { filePath: FILE_PATH, line: 2, tag },
                },
            ];

            const { edits, manualReview } = normalizeVariants(occurrences);

            // 9.2: the element carrying the arbitrary breakpoint is recorded as
            // a manual-review item with reason `arbitrary-breakpoint`.
            const flagged = manualReview.find((item) => item.locator.line === 2 && item.locator.tag === tag);
            assert.ok(flagged, `expected a manual-review item for the arbitrary-breakpoint element ("${arbitraryToken}")`);
            assert.strictEqual(
                flagged.classification,
                ReviewClassification.MANUAL_REVIEW,
                'arbitrary-breakpoint item must be classified manual-review'
            );
            assert.strictEqual(
                flagged.reasonCategory,
                ReviewReasonCategory.ARBITRARY_BREAKPOINT,
                'arbitrary-breakpoint item must use reason arbitrary-breakpoint'
            );
            assert.ok(
                REVIEW_REASON_CATEGORIES.includes(flagged.reasonCategory),
                'reason category must be a known category'
            );

            // The flagged element receives NO automated edit (markup retained).
            assert.strictEqual(
                editForLine(edits, 2, tag),
                undefined,
                'the arbitrary-breakpoint element must not receive an automated edit'
            );

            // Sanity: no edit anywhere introduces a bracket-notation breakpoint.
            for (const edit of edits) {
                assert.ok(
                    !/(?:min|max)-\[[^\]]*\]:/.test(edit.after),
                    `edit must not introduce an arbitrary breakpoint (after: "${edit.after}")`
                );
            }
        }),
        { numRuns: 200 }
    );

    console.log('[variant-normalizer.property] arbitrary breakpoints retained verbatim as manual-review items OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testHoverPropagationCompletesEachGroup();
    testArbitraryBreakpointRetainedAsManualReview();
    console.log('[variant-normalizer.property] All variant-normalizer property tests passed');
}

run();

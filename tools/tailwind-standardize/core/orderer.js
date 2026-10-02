'use strict';

/**
 * Utility Orderer for the Tailwind CSS Standardization tool.
 *
 * `order(tokens)` takes the `ClassToken[]` produced by `core/tokenizer.js`
 * `tokenize()` and returns a reordered `ClassToken[]` that:
 *
 *   - is a permutation of the input multiset — no token is added, removed, or
 *     duplicated, and no token's `raw` string is ever altered (Req 5.3);
 *   - is grouped by the Utility_Ordering_Convention category sequence
 *     layout → spacing → sizing → colors → effects → transforms, with
 *     uncategorized utilities placed last (Req 5.1, 5.4);
 *   - preserves the original left-to-right relative order of utilities that
 *     share a category, and of uncategorized utilities among themselves
 *     (Req 5.4, 5.5);
 *   - places each variant-prefixed utility immediately after its non-prefixed
 *     counterpart, with the responsive variant ordered before the state
 *     variant (Req 5.2).
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/tokenizer.js).
 *
 * _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5_
 */

const { Category } = require('./tokenizer');

// ---------------------------------------------------------------------------
// Category ordering
// ---------------------------------------------------------------------------

/**
 * The category emission order. Any category not listed here (which, in
 * practice, is only `uncategorized`) is emitted after every listed category,
 * satisfying "uncategorized last" (Req 5.1).
 */
const CATEGORY_SEQUENCE = Object.freeze([
    Category.LAYOUT,
    Category.SPACING,
    Category.SIZING,
    Category.COLORS,
    Category.EFFECTS,
    Category.TRANSFORMS,
    Category.UNCATEGORIZED,
]);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Compute the within-base-group ordering rank for a token. Lower ranks are
 * emitted first.
 *
 *   0 — non-prefixed counterpart (no variants at all)
 *   1 — carries a responsive variant (responsive ordered before state)
 *   2 — carries only a state / other variant
 *
 * Tokens that share a rank keep their original relative order (Req 5.2).
 * @param {object} token ClassToken
 * @returns {number}
 */
function variantRank(token) {
    const hasAnyVariant = Array.isArray(token.variants) && token.variants.length > 0;
    if (!hasAnyVariant) {
        return 0;
    }
    if (token.responsiveVariant !== null && token.responsiveVariant !== undefined) {
        return 1;
    }
    return 2;
}

/**
 * The grouping key that ties a variant-prefixed utility to its non-prefixed
 * counterpart: the utility's `base` (variants stripped). All of `bg-primary`,
 * `md:bg-primary`, and `hover:bg-primary` share the base `bg-primary`.
 * @param {object} token ClassToken
 * @returns {string}
 */
function groupKey(token) {
    return typeof token.base === 'string' ? token.base : token.raw;
}

/**
 * Resolve a token's ordering category, defaulting to `uncategorized` for any
 * token without a recognized category. Uncategorized tokens are emitted last
 * by virtue of `CATEGORY_SEQUENCE` ending with `Category.UNCATEGORIZED`.
 * @param {object} token ClassToken
 * @returns {string}
 */
function categoryOf(token) {
    return CATEGORY_SEQUENCE.includes(token.category)
        ? token.category
        : Category.UNCATEGORIZED;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Order a list of ClassToken records.
 *
 * The result is always a permutation of the input multiset; token `raw`
 * strings are emitted verbatim.
 * @param {object[]} tokens ClassToken[] as produced by tokenize()
 * @returns {object[]} ClassToken[] reordered
 */
function order(tokens) {
    if (!Array.isArray(tokens)) {
        throw new TypeError('[orderer] order expects an array of tokens');
    }
    if (tokens.length <= 1) {
        return tokens.slice();
    }

    // Decorate with original index so every comparison can fall back to a
    // stable tiebreak independent of the host engine's sort stability.
    const decorated = tokens.map((token, index) => ({ token, index }));

    const result = [];

    for (const category of CATEGORY_SEQUENCE) {
        // Members of this category, in original left-to-right order.
        const inCategory = decorated.filter((entry) => categoryOf(entry.token) === category);
        if (inCategory.length === 0) {
            continue;
        }

        // Partition into base groups, recording each group's first-appearance
        // order so base groups keep their original relative position (Req 5.4).
        const groupOrder = [];
        const groups = new Map();
        for (const entry of inCategory) {
            const key = groupKey(entry.token);
            let bucket = groups.get(key);
            if (bucket === undefined) {
                bucket = [];
                groups.set(key, bucket);
                groupOrder.push(key);
            }
            bucket.push(entry);
        }

        // Within each base group, place the non-prefixed counterpart first,
        // then responsive-bearing variants, then state/other variants, keeping
        // original relative order among equal ranks (Req 5.2).
        for (const key of groupOrder) {
            const members = groups.get(key).slice();
            members.sort((a, b) => {
                const rankDelta = variantRank(a.token) - variantRank(b.token);
                if (rankDelta !== 0) {
                    return rankDelta;
                }
                return a.index - b.index;
            });
            for (const entry of members) {
                result.push(entry.token);
            }
        }
    }

    return result;
}

module.exports = {
    order,
    CATEGORY_SEQUENCE,
};

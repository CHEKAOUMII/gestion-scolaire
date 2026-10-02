'use strict';

/**
 * Variant Normalizer for the Tailwind CSS Standardization tool.
 *
 * `normalizeVariants(occurrences)` enforces a consistent, *configured-only*
 * responsive/state-variant story across a set of class-bearing element
 * occurrences. It returns the edits it would apply plus the items it refuses to
 * touch and instead surfaces for manual review:
 *
 *   normalizeVariants(occurrences) -> { edits, manualReview }
 *
 * Two behaviours are implemented (Requirement 9):
 *
 *   - 9.1 / 9.2 Configured breakpoints only. The only breakpoint prefixes the
 *     tool ever uses are the configured set `sm: md: lg: xl: 2xl:`. The
 *     normalizer never introduces a bracket-notation (arbitrary) breakpoint
 *     such as `min-[673px]:` / `max-[400px]:`. When an occurrence already
 *     carries such a breakpoint - so any conforming responsive normalization
 *     would require reproducing it - the original markup is retained verbatim
 *     and a manual-review item is recorded with reason `arbitrary-breakpoint`.
 *     That element is excluded from any further automated variant edit so its
 *     markup stays unchanged.
 *
 *   - 9.3 Hover propagation. Elements are grouped by their *element type* (tag)
 *     together with their *non-variant utility set* (the order-independent set
 *     of utility classes that carry no variant prefix). Within a group of two
 *     or more such elements, if at least one element declares a `hover:`
 *     utility, that hover utility must be present on every element of the group
 *     after normalization. The normalizer emits an edit adding each missing
 *     hover utility to the elements that lack it.
 *
 * Each input occurrence carries the element's classes plus an `ElementLocator`.
 * Classes may be supplied either as a raw `class` attribute string (the shape
 * produced by the HTML Scanner, `{ value, locator }`) or as a pre-parsed
 * `ClassToken` list (`tokens`). Raw strings are parsed with the shared
 * tokenizer so the normalizer and the rest of the pipeline agree on what a
 * "utility", a "variant", and a "breakpoint" are.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/combination-detector.js).
 *
 * _Requirements: 9.1, 9.2, 9.3_
 */

const path = require('path');

const { tokenize, serialize } = require(path.join(__dirname, 'tokenizer.js'));
const {
    ElementLocator,
    ReviewItem,
    ReviewClassification,
    ReviewReasonCategory,
    NormalizationCategory,
} = require(path.join(__dirname, 'models.js'));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * A variant prefix expressed with bracket notation that pins a hard-coded
 * media query, e.g. `min-[673px]` or `max-[400px]`. These are the arbitrary
 * breakpoints the tool must never introduce (Req 9.2).
 */
const ARBITRARY_BREAKPOINT_RE = /^(?:min|max)-\[[^\]]*\]$/;

/**
 * Resolve a single occurrence into its `ClassToken` list.
 *
 * Accepts, in priority order:
 *   - `occurrence.tokens`    : a pre-parsed `ClassToken[]` (used as-is when every
 *                              entry already looks like a ClassToken; otherwise
 *                              its raw strings are re-tokenized)
 *   - a raw class string in `occurrence.value` / `occurrence.classValue` /
 *     `occurrence.class`, parsed via the shared tokenizer
 *
 * @param {object} occurrence
 * @returns {object[]} ClassToken[]
 */
function getTokens(occurrence) {
    if (Array.isArray(occurrence.tokens)) {
        const allClassTokens = occurrence.tokens.every(
            (entry) =>
                entry &&
                typeof entry === 'object' &&
                typeof entry.raw === 'string' &&
                Array.isArray(entry.variants)
        );
        if (allClassTokens) {
            return occurrence.tokens;
        }
        const raw = occurrence.tokens
            .map((entry) => (typeof entry === 'string' ? entry : (entry && entry.raw) || ''))
            .join(' ');
        return tokenize(raw);
    }

    const raw =
        typeof occurrence.value === 'string'
            ? occurrence.value
            : typeof occurrence.classValue === 'string'
              ? occurrence.classValue
              : typeof occurrence.class === 'string'
                ? occurrence.class
                : null;

    if (raw === null) {
        return [];
    }
    return tokenize(raw);
}

/**
 * True when a token carries a bracket-notation (arbitrary) breakpoint variant.
 * @param {object} token ClassToken
 * @returns {boolean}
 */
function hasArbitraryBreakpoint(token) {
    const variants = Array.isArray(token.variants) ? token.variants : [];
    return variants.some((variant) => ARBITRARY_BREAKPOINT_RE.test(variant));
}

/**
 * The order-independent set of "non-variant" utility classes on an element:
 * every token that carries no variant prefix at all, identified by its exact
 * token text and de-duplicated/sorted for a stable group key (Req 9.3).
 * @param {object[]} tokens ClassToken[]
 * @returns {string[]}
 */
function nonVariantUtilitySet(tokens) {
    const bare = tokens
        .filter((token) => Array.isArray(token.variants) && token.variants.length === 0)
        .map((token) => token.raw);
    return Array.from(new Set(bare)).sort();
}

/**
 * Every distinct `hover:` utility declared on an element, in declaration order.
 * @param {object[]} tokens ClassToken[]
 * @returns {string[]}
 */
function hoverUtilities(tokens) {
    const result = [];
    const seen = new Set();
    for (const token of tokens) {
        if (token.stateVariant === 'hover' && !seen.has(token.raw)) {
            seen.add(token.raw);
            result.push(token.raw);
        }
    }
    return result;
}

/**
 * Build a stable key for an element locator.
 * @param {{ filePath: string, line: number, tag: string }} locator
 * @returns {string}
 */
function locatorKey(locator) {
    return `${locator.filePath}\u0000${locator.line}\u0000${locator.tag}`;
}

/**
 * Build a stable key for a hover-propagation group: element type plus the
 * order-independent non-variant utility set.
 * @param {string} tag
 * @param {string[]} nonVariantSet sorted, de-duplicated utility list
 * @returns {string}
 */
function groupKey(tag, nonVariantSet) {
    return `${tag}\u0000${nonVariantSet.join('\n')}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Normalize responsive/state variants across a set of element occurrences.
 *
 * @param {Array<object>} occurrences
 *   Class-bearing element occurrences. Each must carry a `locator`
 *   (`{ filePath, line, tag }`) and either a raw class string (`value` /
 *   `classValue` / `class`) or a `ClassToken[]` (`tokens`).
 * @returns {{
 *   edits: Array<{
 *     locator: object,
 *     category: string,
 *     before: string,
 *     after: string,
 *     added: string[],
 *   }>,
 *   manualReview: Array<object>,
 * }}
 *   - edits:        the variant-normalization edits to apply. Each edit carries
 *                   the element locator, the `variant-normalization` category,
 *                   the `before`/`after` serialized class strings, and the list
 *                   of hover utilities `added`.
 *   - manualReview: `ReviewItem` records (classification `manual-review`,
 *                   reason `arbitrary-breakpoint`) for elements whose markup is
 *                   retained verbatim because a conforming responsive
 *                   normalization would require an arbitrary breakpoint.
 */
function normalizeVariants(occurrences) {
    if (!Array.isArray(occurrences)) {
        throw new TypeError('[variant-normalizer] normalizeVariants expects an array of occurrences');
    }

    // First pass: normalize each occurrence into a stable internal record and
    // flag any that carry an arbitrary (bracket-notation) breakpoint.
    const records = [];
    const flaggedLocatorKeys = new Set();
    const manualReview = [];

    for (const occurrence of occurrences) {
        if (occurrence === null || typeof occurrence !== 'object') {
            throw new TypeError('[variant-normalizer] each occurrence must be an object');
        }

        const locator = ElementLocator(occurrence.locator || {});
        const tokens = getTokens(occurrence);

        // 9.2: an existing arbitrary breakpoint means any conforming responsive
        // normalization would have to reproduce a bracket-notation breakpoint.
        // Retain the markup verbatim and record a manual-review item instead.
        const arbitraryTokens = tokens.filter(hasArbitraryBreakpoint);
        if (arbitraryTokens.length > 0) {
            flaggedLocatorKeys.add(locatorKey(locator));
            manualReview.push(
                ReviewItem({
                    classification: ReviewClassification.MANUAL_REVIEW,
                    reasonCategory: ReviewReasonCategory.ARBITRARY_BREAKPOINT,
                    locator,
                    detail: arbitraryTokens.map((token) => token.raw).join(' '),
                })
            );
        }

        records.push({
            locator,
            tokens,
            nonVariantSet: nonVariantUtilitySet(tokens),
            hover: hoverUtilities(tokens),
        });
    }

    // Second pass: group by (tag, non-variant utility set) and compute the union
    // of hover utilities declared anywhere in each group (Req 9.3).
    const groups = new Map();
    for (const record of records) {
        const key = groupKey(record.locator.tag, record.nonVariantSet);
        let group = groups.get(key);
        if (group === undefined) {
            group = { members: [], hoverUnion: [], hoverSeen: new Set() };
            groups.set(key, group);
        }
        group.members.push(record);
        for (const hover of record.hover) {
            if (!group.hoverSeen.has(hover)) {
                group.hoverSeen.add(hover);
                group.hoverUnion.push(hover);
            }
        }
    }

    // Third pass: for each group of two or more elements that declares at least
    // one hover utility, emit an edit adding every missing hover utility to the
    // elements that lack it. Elements flagged for arbitrary breakpoints are left
    // verbatim and never receive an edit.
    const edits = [];
    for (const group of groups.values()) {
        if (group.members.length < 2 || group.hoverUnion.length === 0) {
            continue;
        }

        for (const record of group.members) {
            if (flaggedLocatorKeys.has(locatorKey(record.locator))) {
                continue;
            }

            const present = new Set(record.tokens.map((token) => token.raw));
            const missing = group.hoverUnion.filter((hover) => !present.has(hover));
            if (missing.length === 0) {
                continue;
            }

            const before = serialize(record.tokens);
            const after = serialize(record.tokens.concat(tokenize(missing.join(' '))));
            edits.push({
                locator: record.locator,
                category: NormalizationCategory.VARIANT_NORMALIZATION,
                before,
                after,
                added: missing,
            });
        }
    }

    // Deterministic, input-order-independent output.
    const byLocator = (a, b) => {
        const ka = locatorKey(a.locator);
        const kb = locatorKey(b.locator);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    };
    edits.sort(byLocator);
    manualReview.sort(byLocator);

    return { edits, manualReview };
}

module.exports = {
    normalizeVariants,
};

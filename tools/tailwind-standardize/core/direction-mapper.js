'use strict';

/**
 * Direction Mapper for the Tailwind CSS Standardization tool.
 *
 * Maps a single Physical_Direction_Utility (a left/right, inline-axis utility
 * such as `pl-*`, `mr-*`, `left-*`, `border-l-*`, `rounded-tr-*`) to its
 * RTL-safe Logical_Property_Utility equivalent (`ps-*`, `me-*`, `start-*`,
 * `border-s-*`, `rounded-se-*`).
 *
 * `mapPhysical` is a TOTAL function: every input yields a decision.
 *   - A physical inline-axis utility with a logical equivalent is mapped,
 *     value-preserving — only the axis keyword changes, so the numeric/value
 *     suffix and every variant prefix (and a leading negative sign) are
 *     preserved. This keeps the inline-start, inline-end, top, and bottom
 *     computed positions identical in both RTL and LTR contexts (Req 8.1, 8.2,
 *     8.3).
 *   - Any physical utility WITHOUT a logical equivalent is retained verbatim and
 *     recorded with a reason (Req 8.5). Block-axis physical utilities
 *     (`top-*`, `bottom-*`, `pt-*`, `mt-*`, `border-t-*`, ...) are
 *     direction-independent and reported as such; anything else with no logical
 *     equivalent is reported as `no-logical-equivalent`.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions. It reuses the Class Tokenizer to build
 * the logical replacement ClassToken so the result is structurally identical to
 * a scanned token.
 *
 * _Requirements: 8.1, 8.2, 8.3, 8.5_
 */

const { tokenize } = require('./tokenizer');
const { ReviewReasonCategory } = require('./models');

// ---------------------------------------------------------------------------
// Physical -> logical prefix table
// ---------------------------------------------------------------------------

/**
 * Maps a physical-direction utility prefix to its logical (RTL-safe) equivalent
 * prefix. Only the leading axis keyword differs between the two; the numeric or
 * value suffix is left untouched by the mapping. Covers the common inline-axis
 * utilities: padding, margin, inset offsets, border width, scroll margin/padding
 * and the direction-dependent corner radii.
 *
 * Corner radii follow the Tailwind v4 logical naming (start/end of each axis):
 *   rounded-tl-* (top-left)     -> rounded-ss-* (start-start)
 *   rounded-tr-* (top-right)    -> rounded-se-* (start-end)
 *   rounded-bl-* (bottom-left)  -> rounded-es-* (end-start)
 *   rounded-br-* (bottom-right) -> rounded-ee-* (end-end)
 *
 * @type {Map<string, string>}
 */
const PHYSICAL_TO_LOGICAL = new Map([
    // padding (inline axis)
    ['pl-', 'ps-'],
    ['pr-', 'pe-'],
    // margin (inline axis)
    ['ml-', 'ms-'],
    ['mr-', 'me-'],
    // inset offsets (inline axis)
    ['left-', 'start-'],
    ['right-', 'end-'],
    // border width (inline axis)
    ['border-l-', 'border-s-'],
    ['border-r-', 'border-e-'],
    // border radius — single inline edge
    ['rounded-l-', 'rounded-s-'],
    ['rounded-r-', 'rounded-e-'],
    // border radius — corners
    ['rounded-tl-', 'rounded-ss-'],
    ['rounded-tr-', 'rounded-se-'],
    ['rounded-bl-', 'rounded-es-'],
    ['rounded-br-', 'rounded-ee-'],
    // scroll margin (inline axis)
    ['scroll-ml-', 'scroll-ms-'],
    ['scroll-mr-', 'scroll-me-'],
    // scroll padding (inline axis)
    ['scroll-pl-', 'scroll-ps-'],
    ['scroll-pr-', 'scroll-pe-'],
]);

/**
 * Physical utilities tied to the BLOCK axis (top/bottom). These are
 * direction-independent: their rendered position does not change between RTL and
 * LTR, so they have no inline logical equivalent and are retained as
 * `direction-independent-effect` items (Req 8.5).
 */
const BLOCK_AXIS_PREFIXES = Object.freeze([
    'border-t-',
    'border-b-',
    'rounded-t-',
    'rounded-b-',
    'scroll-mt-',
    'scroll-mb-',
    'scroll-pt-',
    'scroll-pb-',
    'pt-',
    'pb-',
    'mt-',
    'mb-',
    'top-',
    'bottom-',
]);

// Match longest prefixes first so specific utilities (e.g. `border-l-`,
// `rounded-tl-`) win over any shorter overlap.
const SORTED_PHYSICAL_PREFIXES = Array.from(PHYSICAL_TO_LOGICAL.keys()).sort(
    (a, b) => b.length - a.length
);

const SORTED_BLOCK_AXIS_PREFIXES = BLOCK_AXIS_PREFIXES.slice().sort(
    (a, b) => b.length - a.length
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split a base utility into its optional leading negative sign and the remainder
 * used for prefix matching. e.g. "-ml-4" -> { negative: '-', body: 'ml-4' }.
 * @param {string} base
 * @returns {{ negative: string, body: string }}
 */
function splitNegative(base) {
    if (base.startsWith('-')) {
        return { negative: '-', body: base.slice(1) };
    }
    return { negative: '', body: base };
}

/**
 * Build the logical replacement ClassToken from the original token, swapping the
 * physical prefix for the logical one while preserving variants, the negative
 * sign, and the value suffix. Reuses the tokenizer so the result matches a
 * scanned token's shape.
 * @param {object} originalToken ClassToken
 * @param {string} negative leading '-' or ''
 * @param {string} body base without the negative sign
 * @param {string} physicalPrefix
 * @param {string} logicalPrefix
 * @returns {object} ClassToken
 */
function buildLogical(originalToken, negative, body, physicalPrefix, logicalPrefix) {
    const suffix = body.slice(physicalPrefix.length);
    const newBase = `${negative}${logicalPrefix}${suffix}`;
    const variants = originalToken.variants || [];
    const raw = variants.length > 0 ? `${variants.join(':')}:${newBase}` : newBase;
    return tokenize(raw)[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Map a physical-direction utility token to its logical equivalent, or retain it
 * with a recorded reason when it has no logical equivalent.
 *
 * Total over its input: any token that is not a mappable inline-axis physical
 * utility is retained.
 *
 * @param {object} token ClassToken (see core/tokenizer.js)
 * @returns {{ logical: object } | { retain: true, reason: string }}
 */
function mapPhysical(token) {
    if (!token || typeof token !== 'object' || typeof token.base !== 'string') {
        throw new TypeError('[direction-mapper] mapPhysical expects a ClassToken with a string base');
    }

    const { negative, body } = splitNegative(token.base);

    // 1. Mappable inline-axis physical utility -> value-preserving logical swap.
    for (const physicalPrefix of SORTED_PHYSICAL_PREFIXES) {
        if (body.startsWith(physicalPrefix)) {
            const logicalPrefix = PHYSICAL_TO_LOGICAL.get(physicalPrefix);
            return { logical: buildLogical(token, negative, body, physicalPrefix, logicalPrefix) };
        }
    }

    // 2. Block-axis physical utility -> direction-independent, no inline logical
    //    equivalent (Req 8.5).
    for (const blockPrefix of SORTED_BLOCK_AXIS_PREFIXES) {
        if (body.startsWith(blockPrefix)) {
            return { retain: true, reason: ReviewReasonCategory.DIRECTION_INDEPENDENT_EFFECT };
        }
    }

    // 3. Anything else: no logical equivalent (Req 8.5).
    return { retain: true, reason: ReviewReasonCategory.NO_LOGICAL_EQUIVALENT };
}

module.exports = {
    PHYSICAL_TO_LOGICAL,
    mapPhysical,
};

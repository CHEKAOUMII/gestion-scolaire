'use strict';

/**
 * Class Tokenizer for the Tailwind CSS Standardization tool.
 *
 * Parses a `class` attribute string into a list of structured `ClassToken`
 * records and serializes them back. `serialize` is the exact inverse of
 * `tokenize` at the token level: `serialize(tokenize(x))` preserves every
 * token's `raw` string byte-for-byte, so downstream reorders/transforms can
 * rearrange tokens without ever altering a token's text (Req 5.3).
 *
 * Each token is decomposed into:
 *   - raw                : the original token text (e.g. "md:hover:bg-primary")
 *   - variants           : every variant prefix in order (e.g. ["md","hover"])
 *   - responsiveVariant  : the responsive prefix (sm/md/lg/xl/2xl) or null
 *   - stateVariant       : the state prefix (hover/focus/...) or null
 *   - base               : the utility without variants (e.g. "bg-primary")
 *   - property           : the resolved CSS property the utility sets, or null
 *   - category           : layout|spacing|sizing|colors|effects|transforms|uncategorized
 *   - isArbitrary        : true for bracket-notation literals (e.g. "mt-[16px]")
 *   - arbitraryValue     : the literal inside the brackets, or null
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/models.js).
 *
 * _Requirements: 5.3_
 */

// ---------------------------------------------------------------------------
// Variant classification
// ---------------------------------------------------------------------------

/**
 * The configured responsive breakpoint prefixes.
 * @see Requirement 9.1
 */
const RESPONSIVE_VARIANTS = Object.freeze(new Set(['sm', 'md', 'lg', 'xl', '2xl']));

/**
 * Known state/interaction variant prefixes. This list is intentionally broad
 * but conservative: an unrecognized variant is still preserved in `variants`,
 * it simply does not populate `stateVariant`.
 * @see Requirement 5.2
 */
const STATE_VARIANTS = Object.freeze(new Set([
    'hover',
    'focus',
    'focus-visible',
    'focus-within',
    'active',
    'visited',
    'target',
    'disabled',
    'enabled',
    'checked',
    'indeterminate',
    'default',
    'required',
    'valid',
    'invalid',
    'in-range',
    'out-of-range',
    'placeholder-shown',
    'autofill',
    'read-only',
    'first',
    'last',
    'only',
    'odd',
    'even',
    'first-of-type',
    'last-of-type',
    'only-of-type',
    'empty',
    'group-hover',
    'group-focus',
    'peer-hover',
    'peer-focus',
]));

// ---------------------------------------------------------------------------
// Category constants (the Utility_Ordering_Convention category set)
// ---------------------------------------------------------------------------

const Category = Object.freeze({
    LAYOUT: 'layout',
    SPACING: 'spacing',
    SIZING: 'sizing',
    COLORS: 'colors',
    EFFECTS: 'effects',
    TRANSFORMS: 'transforms',
    UNCATEGORIZED: 'uncategorized',
});

// ---------------------------------------------------------------------------
// Utility -> { property, category } resolution tables
// ---------------------------------------------------------------------------

/**
 * Exact-match utilities (no trailing value). Maps a full utility keyword to its
 * CSS property and ordering category.
 */
const EXACT_UTILITIES = Object.freeze(new Map([
    // display (layout)
    ['block', { property: 'display', category: Category.LAYOUT }],
    ['inline-block', { property: 'display', category: Category.LAYOUT }],
    ['inline', { property: 'display', category: Category.LAYOUT }],
    ['flex', { property: 'display', category: Category.LAYOUT }],
    ['inline-flex', { property: 'display', category: Category.LAYOUT }],
    ['table', { property: 'display', category: Category.LAYOUT }],
    ['inline-table', { property: 'display', category: Category.LAYOUT }],
    ['grid', { property: 'display', category: Category.LAYOUT }],
    ['inline-grid', { property: 'display', category: Category.LAYOUT }],
    ['contents', { property: 'display', category: Category.LAYOUT }],
    ['flow-root', { property: 'display', category: Category.LAYOUT }],
    ['list-item', { property: 'display', category: Category.LAYOUT }],
    ['hidden', { property: 'display', category: Category.LAYOUT }],
    // flex direction / wrap (layout)
    ['flex-row', { property: 'flex-direction', category: Category.LAYOUT }],
    ['flex-row-reverse', { property: 'flex-direction', category: Category.LAYOUT }],
    ['flex-col', { property: 'flex-direction', category: Category.LAYOUT }],
    ['flex-col-reverse', { property: 'flex-direction', category: Category.LAYOUT }],
    ['flex-wrap', { property: 'flex-wrap', category: Category.LAYOUT }],
    ['flex-wrap-reverse', { property: 'flex-wrap', category: Category.LAYOUT }],
    ['flex-nowrap', { property: 'flex-wrap', category: Category.LAYOUT }],
    // position (layout)
    ['static', { property: 'position', category: Category.LAYOUT }],
    ['fixed', { property: 'position', category: Category.LAYOUT }],
    ['absolute', { property: 'position', category: Category.LAYOUT }],
    ['relative', { property: 'position', category: Category.LAYOUT }],
    ['sticky', { property: 'position', category: Category.LAYOUT }],
    // box sizing / container (layout)
    ['box-border', { property: 'box-sizing', category: Category.LAYOUT }],
    ['box-content', { property: 'box-sizing', category: Category.LAYOUT }],
    ['container', { property: null, category: Category.LAYOUT }],
    // text alignment (layout)
    ['text-left', { property: 'text-align', category: Category.LAYOUT }],
    ['text-center', { property: 'text-align', category: Category.LAYOUT }],
    ['text-right', { property: 'text-align', category: Category.LAYOUT }],
    ['text-justify', { property: 'text-align', category: Category.LAYOUT }],
    ['text-start', { property: 'text-align', category: Category.LAYOUT }],
    ['text-end', { property: 'text-align', category: Category.LAYOUT }],
    // borders without value (effects)
    ['border', { property: 'border-width', category: Category.EFFECTS }],
    ['border-solid', { property: 'border-style', category: Category.EFFECTS }],
    ['border-dashed', { property: 'border-style', category: Category.EFFECTS }],
    ['border-dotted', { property: 'border-style', category: Category.EFFECTS }],
    ['border-double', { property: 'border-style', category: Category.EFFECTS }],
    ['border-none', { property: 'border-style', category: Category.EFFECTS }],
    ['rounded', { property: 'border-radius', category: Category.EFFECTS }],
    ['shadow', { property: 'box-shadow', category: Category.EFFECTS }],
    // transforms (transforms)
    ['transform', { property: 'transform', category: Category.TRANSFORMS }],
    ['transform-none', { property: 'transform', category: Category.TRANSFORMS }],
    ['transform-gpu', { property: 'transform', category: Category.TRANSFORMS }],
    // transitions / animation (effects)
    ['transition', { property: 'transition-property', category: Category.EFFECTS }],
    ['transition-none', { property: 'transition-property', category: Category.EFFECTS }],
]));

/**
 * Known font-size utilities (sizing). Kept separate because `text-` is
 * overloaded (color vs size vs alignment).
 */
const TEXT_SIZES = Object.freeze(new Set([
    'text-xs', 'text-sm', 'text-base', 'text-lg', 'text-xl',
    'text-2xl', 'text-3xl', 'text-4xl', 'text-5xl', 'text-6xl',
    'text-7xl', 'text-8xl', 'text-9xl',
]));

/**
 * Prefix-match utilities. Each entry maps a leading `prefix-` to a CSS property
 * and ordering category. Entries are matched longest-prefix-first so that, for
 * example, `min-w-` wins over `w-` and `mx-` is never shadowed by `m-`.
 */
const PREFIX_UTILITIES = [
    // --- spacing: padding ---
    ['px-', 'padding-inline', Category.SPACING],
    ['py-', 'padding-block', Category.SPACING],
    ['pt-', 'padding-top', Category.SPACING],
    ['pr-', 'padding-right', Category.SPACING],
    ['pb-', 'padding-bottom', Category.SPACING],
    ['pl-', 'padding-left', Category.SPACING],
    ['ps-', 'padding-inline-start', Category.SPACING],
    ['pe-', 'padding-inline-end', Category.SPACING],
    ['p-', 'padding', Category.SPACING],
    // --- spacing: margin ---
    ['mx-', 'margin-inline', Category.SPACING],
    ['my-', 'margin-block', Category.SPACING],
    ['mt-', 'margin-top', Category.SPACING],
    ['mr-', 'margin-right', Category.SPACING],
    ['mb-', 'margin-bottom', Category.SPACING],
    ['ml-', 'margin-left', Category.SPACING],
    ['ms-', 'margin-inline-start', Category.SPACING],
    ['me-', 'margin-inline-end', Category.SPACING],
    ['m-', 'margin', Category.SPACING],
    // --- spacing: gap / space ---
    ['gap-x-', 'column-gap', Category.SPACING],
    ['gap-y-', 'row-gap', Category.SPACING],
    ['gap-', 'gap', Category.SPACING],
    ['space-x-', 'margin-inline', Category.SPACING],
    ['space-y-', 'margin-block', Category.SPACING],
    // --- sizing: width ---
    ['min-w-', 'min-width', Category.SIZING],
    ['max-w-', 'max-width', Category.SIZING],
    ['w-', 'width', Category.SIZING],
    // --- sizing: height ---
    ['min-h-', 'min-height', Category.SIZING],
    ['max-h-', 'max-height', Category.SIZING],
    ['h-', 'height', Category.SIZING],
    ['size-', null, Category.SIZING],
    // --- layout: position offsets ---
    ['inset-x-', 'inset-inline', Category.LAYOUT],
    ['inset-y-', 'inset-block', Category.LAYOUT],
    ['inset-', 'inset', Category.LAYOUT],
    ['top-', 'top', Category.LAYOUT],
    ['right-', 'right', Category.LAYOUT],
    ['bottom-', 'bottom', Category.LAYOUT],
    ['left-', 'left', Category.LAYOUT],
    ['start-', 'inset-inline-start', Category.LAYOUT],
    ['end-', 'inset-inline-end', Category.LAYOUT],
    // --- layout: flex/grid alignment ---
    ['items-', 'align-items', Category.LAYOUT],
    ['justify-items-', 'justify-items', Category.LAYOUT],
    ['justify-self-', 'justify-self', Category.LAYOUT],
    ['justify-', 'justify-content', Category.LAYOUT],
    ['content-', 'align-content', Category.LAYOUT],
    ['self-', 'align-self', Category.LAYOUT],
    ['place-content-', 'place-content', Category.LAYOUT],
    ['place-items-', 'place-items', Category.LAYOUT],
    ['place-self-', 'place-self', Category.LAYOUT],
    ['order-', 'order', Category.LAYOUT],
    ['grid-cols-', 'grid-template-columns', Category.LAYOUT],
    ['grid-rows-', 'grid-template-rows', Category.LAYOUT],
    ['col-span-', 'grid-column', Category.LAYOUT],
    ['col-start-', 'grid-column-start', Category.LAYOUT],
    ['col-end-', 'grid-column-end', Category.LAYOUT],
    ['col-', 'grid-column', Category.LAYOUT],
    ['row-span-', 'grid-row', Category.LAYOUT],
    ['row-start-', 'grid-row-start', Category.LAYOUT],
    ['row-end-', 'grid-row-end', Category.LAYOUT],
    ['row-', 'grid-row', Category.LAYOUT],
    ['flex-', 'flex', Category.LAYOUT],
    ['grow-', 'flex-grow', Category.LAYOUT],
    ['shrink-', 'flex-shrink', Category.LAYOUT],
    ['basis-', 'flex-basis', Category.LAYOUT],
    // --- layout: misc box ---
    ['z-', 'z-index', Category.LAYOUT],
    ['float-', 'float', Category.LAYOUT],
    ['clear-', 'clear', Category.LAYOUT],
    ['overflow-x-', 'overflow-x', Category.LAYOUT],
    ['overflow-y-', 'overflow-y', Category.LAYOUT],
    ['overflow-', 'overflow', Category.LAYOUT],
    ['object-', 'object-fit', Category.LAYOUT],
    ['box-', 'box-sizing', Category.LAYOUT],
    // --- colors ---
    ['bg-', 'background-color', Category.COLORS],
    ['from-', '--tw-gradient-from', Category.COLORS],
    ['via-', '--tw-gradient-via', Category.COLORS],
    ['to-', '--tw-gradient-to', Category.COLORS],
    ['fill-', 'fill', Category.COLORS],
    ['stroke-', 'stroke', Category.COLORS],
    ['decoration-', 'text-decoration-color', Category.COLORS],
    ['placeholder-', 'color', Category.COLORS],
    ['caret-', 'caret-color', Category.COLORS],
    ['accent-', 'accent-color', Category.COLORS],
    ['divide-', 'border-color', Category.COLORS],
    // --- effects ---
    ['rounded-', 'border-radius', Category.EFFECTS],
    ['border-x-', 'border-inline-width', Category.EFFECTS],
    ['border-y-', 'border-block-width', Category.EFFECTS],
    ['border-t-', 'border-top-width', Category.EFFECTS],
    ['border-r-', 'border-right-width', Category.EFFECTS],
    ['border-b-', 'border-bottom-width', Category.EFFECTS],
    ['border-l-', 'border-left-width', Category.EFFECTS],
    ['border-s-', 'border-inline-start-width', Category.EFFECTS],
    ['border-e-', 'border-inline-end-width', Category.EFFECTS],
    ['border-', 'border-color', Category.EFFECTS],
    ['shadow-', 'box-shadow', Category.EFFECTS],
    ['ring-', 'box-shadow', Category.EFFECTS],
    ['opacity-', 'opacity', Category.EFFECTS],
    ['blur-', 'filter', Category.EFFECTS],
    ['brightness-', 'filter', Category.EFFECTS],
    ['contrast-', 'filter', Category.EFFECTS],
    ['grayscale-', 'filter', Category.EFFECTS],
    ['saturate-', 'filter', Category.EFFECTS],
    ['backdrop-', 'backdrop-filter', Category.EFFECTS],
    ['transition-', 'transition-property', Category.EFFECTS],
    ['duration-', 'transition-duration', Category.EFFECTS],
    ['delay-', 'transition-delay', Category.EFFECTS],
    ['ease-', 'transition-timing-function', Category.EFFECTS],
    ['animate-', 'animation', Category.EFFECTS],
    // --- transforms ---
    ['scale-x-', 'transform', Category.TRANSFORMS],
    ['scale-y-', 'transform', Category.TRANSFORMS],
    ['scale-', 'transform', Category.TRANSFORMS],
    ['rotate-', 'transform', Category.TRANSFORMS],
    ['translate-x-', 'transform', Category.TRANSFORMS],
    ['translate-y-', 'transform', Category.TRANSFORMS],
    ['skew-x-', 'transform', Category.TRANSFORMS],
    ['skew-y-', 'transform', Category.TRANSFORMS],
    ['origin-', 'transform-origin', Category.TRANSFORMS],
    // --- colors/typography: text (size handled separately, else color) ---
    ['text-', 'color', Category.COLORS],
    ['font-', 'font-weight', Category.COLORS],
];

// Match longest prefixes first so specific utilities win over shorthands.
const SORTED_PREFIX_UTILITIES = PREFIX_UTILITIES.slice().sort(
    (a, b) => b[0].length - a[0].length
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Split a single class token into segments on the variant separator ':',
 * ignoring any ':' that appears inside `[...]` or `(...)` (e.g. arbitrary
 * values/variants like `[&:hover]` or `bg-[url(a:b)]`).
 * @param {string} token
 * @returns {string[]} segments; the last segment is the base utility.
 */
function splitVariantSegments(token) {
    const segments = [];
    let depth = 0;
    let current = '';
    for (let i = 0; i < token.length; i += 1) {
        const ch = token[i];
        if (ch === '[' || ch === '(') {
            depth += 1;
            current += ch;
        } else if (ch === ']' || ch === ')') {
            if (depth > 0) {
                depth -= 1;
            }
            current += ch;
        } else if (ch === ':' && depth === 0) {
            segments.push(current);
            current = '';
        } else {
            current += ch;
        }
    }
    segments.push(current);
    return segments;
}

/**
 * Extract the arbitrary literal inside the first `[` and the matching last `]`.
 * @param {string} base
 * @returns {{ isArbitrary: boolean, arbitraryValue: string | null }}
 */
function extractArbitrary(base) {
    const open = base.indexOf('[');
    const close = base.lastIndexOf(']');
    if (open !== -1 && close !== -1 && close > open) {
        return { isArbitrary: true, arbitraryValue: base.slice(open + 1, close) };
    }
    return { isArbitrary: false, arbitraryValue: null };
}

/**
 * Resolve the CSS property and ordering category for a base utility.
 * @param {string} base
 * @param {boolean} isArbitrary
 * @returns {{ property: string | null, category: string }}
 */
function resolveUtility(base, isArbitrary) {
    // Build the lookup key: strip a leading negative sign and any bracketed
    // arbitrary segment so "mt-[16px]" and "-mt-4" both resolve via "mt-".
    let key = base;
    if (key.startsWith('-')) {
        key = key.slice(1);
    }
    if (isArbitrary) {
        const open = key.indexOf('[');
        if (open !== -1) {
            key = key.slice(0, open);
        }
    }

    // A token that is purely an arbitrary property (e.g. "[mask-type:luminance]")
    // has no resolvable prefix.
    if (key === '') {
        return { property: null, category: Category.UNCATEGORIZED };
    }

    if (TEXT_SIZES.has(key)) {
        return { property: 'font-size', category: Category.SIZING };
    }

    const exact = EXACT_UTILITIES.get(key);
    if (exact) {
        return { property: exact.property, category: exact.category };
    }

    for (const [prefix, property, category] of SORTED_PREFIX_UTILITIES) {
        if (key === prefix || key.startsWith(prefix)) {
            return { property, category };
        }
    }

    return { property: null, category: Category.UNCATEGORIZED };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a single class token (already whitespace-separated) into a ClassToken.
 * @param {string} raw
 * @returns {object} ClassToken
 */
function tokenizeOne(raw) {
    const segments = splitVariantSegments(raw);
    const variants = segments.slice(0, -1);
    const base = segments[segments.length - 1];

    let responsiveVariant = null;
    let stateVariant = null;
    for (const variant of variants) {
        if (responsiveVariant === null && RESPONSIVE_VARIANTS.has(variant)) {
            responsiveVariant = variant;
        } else if (stateVariant === null && STATE_VARIANTS.has(variant)) {
            stateVariant = variant;
        }
    }

    const { isArbitrary, arbitraryValue } = extractArbitrary(base);
    const { property, category } = resolveUtility(base, isArbitrary);

    return Object.freeze({
        raw,
        variants: Object.freeze(variants.slice()),
        responsiveVariant,
        stateVariant,
        base,
        property,
        category,
        isArbitrary,
        arbitraryValue,
    });
}

/**
 * Tokenize a `class` attribute string into an array of ClassToken records.
 * Empty/whitespace-only input yields an empty array.
 * @param {string} classAttr
 * @returns {object[]} ClassToken[]
 */
function tokenize(classAttr) {
    if (typeof classAttr !== 'string') {
        throw new TypeError('[tokenizer] tokenize expects a string');
    }
    const trimmed = classAttr.trim();
    if (trimmed === '') {
        return [];
    }
    return trimmed.split(/\s+/).map(tokenizeOne);
}

/**
 * Serialize ClassToken records back into a `class` attribute string. This is
 * the exact inverse of `tokenize` at the token level: each token's `raw`
 * string is emitted verbatim, joined by single spaces, so reorders never alter
 * token strings (Req 5.3).
 * @param {object[]} tokens
 * @returns {string}
 */
function serialize(tokens) {
    if (!Array.isArray(tokens)) {
        throw new TypeError('[tokenizer] serialize expects an array of tokens');
    }
    return tokens
        .map((token) => {
            if (!token || typeof token.raw !== 'string') {
                throw new TypeError('[tokenizer] each token must have a string "raw" field');
            }
            return token.raw;
        })
        .join(' ');
}

module.exports = {
    tokenize,
    serialize,
    Category,
    RESPONSIVE_VARIANTS,
    STATE_VARIANTS,
};

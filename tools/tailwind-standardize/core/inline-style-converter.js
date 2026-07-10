'use strict';

/**
 * Inline-Style Converter for the Tailwind CSS Standardization tool.
 *
 * `convertInlineStyle(occurrence, themeIndex)` decides, for a single inline-style
 * occurrence emitted by the HTML Scanner (`{ value, locator, dynamic }`), one of
 * two deterministic actions:
 *
 *   - 'convert' : the inline style is STATIC and every CSS declaration it
 *                 contains is expressible by an existing Tailwind utility or a
 *                 Design_Token / spacing-scale reference that produces the
 *                 IDENTICAL computed rendering. The style attribute is replaced
 *                 by the equivalent utility ClassToken[] (Req 7.1, 7.6).
 *   - 'exclude' : the style is either set dynamically by JavaScript at runtime
 *                 (the occurrence's `dynamic` flag is true or the value carries a
 *                 `${...}` template interpolation) or it is static but contains at
 *                 least one declaration that cannot be expressed with identical
 *                 rendering. The original style is retained and recorded as an
 *                 excluded item with a reason category (Req 7.2, 7.3, 7.5).
 *
 * Mapping is conservative and exact: a declaration is only converted when its
 * property maps to a known utility AND (for value-bearing properties) the
 * declaration's normalized computed value exactly matches an existing token or
 * spacing-scale entry in the `themeIndex` (built by
 * `core/arbitrary-resolver.js#buildThemeIndex`). If ANY declaration is not
 * expressible, the WHOLE occurrence is excluded as 'not-expressible' so a partial
 * conversion never silently drops styling (Req 7.3).
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions. It reuses the Class Tokenizer so the
 * produced utilities are structurally identical to scanned tokens, and the
 * Arbitrary-Value Resolver's computed-value normalization / theme index so value
 * matching is consistent with the rest of the pipeline.
 *
 * _Requirements: 7.1, 7.2, 7.3, 7.5, 7.6_
 */

const path = require('path');

const { tokenize } = require(path.join(__dirname, 'tokenizer.js'));
const {
    buildThemeIndex,
    normalizeComputedValue,
    Namespace,
} = require(path.join(__dirname, 'arbitrary-resolver.js'));

// ---------------------------------------------------------------------------
// Reason categories (subset of ReviewReasonCategory in core/models.js)
// ---------------------------------------------------------------------------

const Reason = Object.freeze({
    DYNAMIC: 'dynamic-inline-style',
    NOT_EXPRESSIBLE: 'not-expressible',
});

// ---------------------------------------------------------------------------
// Exact (value-keyword) declaration map: property -> (value -> utility)
//
// These are properties whose CSS values are a small closed set of keywords that
// each map to a single Tailwind utility. Values are matched case-insensitively
// after trimming.
// ---------------------------------------------------------------------------

const EXACT_DECLARATIONS = Object.freeze(new Map([
    ['display', new Map([
        ['block', 'block'],
        ['inline-block', 'inline-block'],
        ['inline', 'inline'],
        ['flex', 'flex'],
        ['inline-flex', 'inline-flex'],
        ['grid', 'grid'],
        ['inline-grid', 'inline-grid'],
        ['table', 'table'],
        ['inline-table', 'inline-table'],
        ['contents', 'contents'],
        ['flow-root', 'flow-root'],
        ['list-item', 'list-item'],
        ['none', 'hidden'],
    ])],
    ['position', new Map([
        ['static', 'static'],
        ['fixed', 'fixed'],
        ['absolute', 'absolute'],
        ['relative', 'relative'],
        ['sticky', 'sticky'],
    ])],
    ['text-align', new Map([
        ['left', 'text-left'],
        ['center', 'text-center'],
        ['right', 'text-right'],
        ['justify', 'text-justify'],
        ['start', 'text-start'],
        ['end', 'text-end'],
    ])],
    ['flex-direction', new Map([
        ['row', 'flex-row'],
        ['row-reverse', 'flex-row-reverse'],
        ['column', 'flex-col'],
        ['column-reverse', 'flex-col-reverse'],
    ])],
    ['flex-wrap', new Map([
        ['wrap', 'flex-wrap'],
        ['wrap-reverse', 'flex-wrap-reverse'],
        ['nowrap', 'flex-nowrap'],
    ])],
    ['justify-content', new Map([
        ['flex-start', 'justify-start'],
        ['start', 'justify-start'],
        ['center', 'justify-center'],
        ['flex-end', 'justify-end'],
        ['end', 'justify-end'],
        ['space-between', 'justify-between'],
        ['space-around', 'justify-around'],
        ['space-evenly', 'justify-evenly'],
    ])],
    ['align-items', new Map([
        ['flex-start', 'items-start'],
        ['start', 'items-start'],
        ['center', 'items-center'],
        ['flex-end', 'items-end'],
        ['end', 'items-end'],
        ['stretch', 'items-stretch'],
        ['baseline', 'items-baseline'],
    ])],
    ['box-sizing', new Map([
        ['border-box', 'box-border'],
        ['content-box', 'box-content'],
    ])],
    ['overflow', new Map([
        ['auto', 'overflow-auto'],
        ['hidden', 'overflow-hidden'],
        ['visible', 'overflow-visible'],
        ['scroll', 'overflow-scroll'],
        ['clip', 'overflow-clip'],
    ])],
    ['font-style', new Map([
        ['italic', 'italic'],
        ['normal', 'not-italic'],
    ])],
    ['font-weight', new Map([
        ['100', 'font-thin'],
        ['200', 'font-extralight'],
        ['300', 'font-light'],
        ['400', 'font-normal'],
        ['normal', 'font-normal'],
        ['500', 'font-medium'],
        ['600', 'font-semibold'],
        ['700', 'font-bold'],
        ['bold', 'font-bold'],
        ['800', 'font-extrabold'],
        ['900', 'font-black'],
    ])],
    ['visibility', new Map([
        ['visible', 'visible'],
        ['hidden', 'invisible'],
        ['collapse', 'collapse'],
    ])],
    ['text-transform', new Map([
        ['uppercase', 'uppercase'],
        ['lowercase', 'lowercase'],
        ['capitalize', 'capitalize'],
        ['none', 'normal-case'],
    ])],
]));

// ---------------------------------------------------------------------------
// Value-mapped declarations: property -> { prefix, namespaces }
//
// These properties take a computed value (length / color / radius) that is
// resolved against the theme index. The matching token/scale suffix is appended
// to the utility prefix (e.g. margin:0 -> "m-" + "0" -> "m-0";
// background-color:#3b6ac5 -> "bg-" + "primary" -> "bg-primary").
// ---------------------------------------------------------------------------

const SPACING = [Namespace.SPACING];
const COLOR = [Namespace.COLOR];
const RADIUS = [Namespace.RADIUS];

const VALUE_MAPPED_DECLARATIONS = Object.freeze(new Map([
    // margin
    ['margin', { prefix: 'm-', namespaces: SPACING }],
    ['margin-top', { prefix: 'mt-', namespaces: SPACING }],
    ['margin-right', { prefix: 'mr-', namespaces: SPACING }],
    ['margin-bottom', { prefix: 'mb-', namespaces: SPACING }],
    ['margin-left', { prefix: 'ml-', namespaces: SPACING }],
    ['margin-inline-start', { prefix: 'ms-', namespaces: SPACING }],
    ['margin-inline-end', { prefix: 'me-', namespaces: SPACING }],
    // padding
    ['padding', { prefix: 'p-', namespaces: SPACING }],
    ['padding-top', { prefix: 'pt-', namespaces: SPACING }],
    ['padding-right', { prefix: 'pr-', namespaces: SPACING }],
    ['padding-bottom', { prefix: 'pb-', namespaces: SPACING }],
    ['padding-left', { prefix: 'pl-', namespaces: SPACING }],
    ['padding-inline-start', { prefix: 'ps-', namespaces: SPACING }],
    ['padding-inline-end', { prefix: 'pe-', namespaces: SPACING }],
    // sizing
    ['width', { prefix: 'w-', namespaces: SPACING }],
    ['height', { prefix: 'h-', namespaces: SPACING }],
    ['min-width', { prefix: 'min-w-', namespaces: SPACING }],
    ['max-width', { prefix: 'max-w-', namespaces: SPACING }],
    ['min-height', { prefix: 'min-h-', namespaces: SPACING }],
    ['max-height', { prefix: 'max-h-', namespaces: SPACING }],
    // position offsets
    ['top', { prefix: 'top-', namespaces: SPACING }],
    ['right', { prefix: 'right-', namespaces: SPACING }],
    ['bottom', { prefix: 'bottom-', namespaces: SPACING }],
    ['left', { prefix: 'left-', namespaces: SPACING }],
    ['inset-inline-start', { prefix: 'start-', namespaces: SPACING }],
    ['inset-inline-end', { prefix: 'end-', namespaces: SPACING }],
    // gaps
    ['gap', { prefix: 'gap-', namespaces: SPACING }],
    ['column-gap', { prefix: 'gap-x-', namespaces: SPACING }],
    ['row-gap', { prefix: 'gap-y-', namespaces: SPACING }],
    // radius
    ['border-radius', { prefix: 'rounded-', namespaces: RADIUS }],
    // colors
    ['background-color', { prefix: 'bg-', namespaces: COLOR }],
    ['color', { prefix: 'text-', namespaces: COLOR }],
    ['border-color', { prefix: 'border-', namespaces: COLOR }],
]));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Parse a `style` attribute value into a list of `{ property, value }`
 * declarations. Declarations are split on ';' and each on its first ':'. A
 * trailing `!important` flag is stripped. Empty segments are ignored. Any
 * segment that lacks a ':' separator is reported via `malformed: true`.
 * @param {string} styleText
 * @returns {{ declarations: Array<{ property: string, value: string }>, malformed: boolean }}
 */
function parseDeclarations(styleText) {
    const declarations = [];
    let malformed = false;

    for (const segment of styleText.split(';')) {
        const trimmed = segment.trim();
        if (trimmed === '') {
            continue;
        }
        const colon = trimmed.indexOf(':');
        if (colon === -1) {
            malformed = true;
            continue;
        }
        const property = trimmed.slice(0, colon).trim().toLowerCase();
        let value = trimmed.slice(colon + 1).trim();
        // Strip a CSS `!important` priority flag; it has no utility equivalent
        // here and does not change which utility represents the value.
        value = value.replace(/\s*!\s*important\s*$/i, '').trim();

        if (property === '' || value === '') {
            malformed = true;
            continue;
        }
        declarations.push({ property, value });
    }

    return { declarations, malformed };
}

/**
 * Remove the regex-escaping backslashes that the spacing scale stores in its
 * suffixes (e.g. `0\.5` -> `0.5`) so the suffix can be used verbatim in a class.
 * @param {string} suffix
 * @returns {string}
 */
function rawSuffix(suffix) {
    return String(suffix).replace(/\\/g, '');
}

/**
 * Resolve a value-bearing declaration to a utility string using the theme index.
 * Returns null when no existing token / scale entry exactly matches the value.
 * @param {{ prefix: string, namespaces: string[] }} spec
 * @param {string} cssValue raw CSS value
 * @param {object} themeIndex from buildThemeIndex
 * @returns {string|null}
 */
function resolveValueUtility(spec, cssValue, themeIndex) {
    const normalized = normalizeComputedValue(cssValue);

    // 1. Existing Design_Token whose value matches in an allowed namespace.
    const candidates = themeIndex.byValue.get(normalized) || [];
    const tokenMatch = candidates.find((entry) => spec.namespaces.includes(entry.namespace));
    if (tokenMatch) {
        return `${spec.prefix}${rawSuffix(tokenMatch.suffix)}`;
    }

    // 2. Configured spacing/sizing scale (only for spacing-namespace utilities).
    if (spec.namespaces.includes(Namespace.SPACING)) {
        const scaleMatch = themeIndex.scaleByValue.get(normalized);
        if (scaleMatch) {
            return `${spec.prefix}${rawSuffix(scaleMatch.suffix)}`;
        }
    }

    return null;
}

/**
 * Resolve a single declaration to its equivalent utility string, or null when
 * the declaration is not expressible by a known utility / token.
 * @param {{ property: string, value: string }} declaration
 * @param {object} themeIndex
 * @returns {string|null}
 */
function resolveDeclaration(declaration, themeIndex) {
    const { property, value } = declaration;

    // Exact keyword-valued utilities (display, position, text-align, ...).
    const exact = EXACT_DECLARATIONS.get(property);
    if (exact) {
        const util = exact.get(value.toLowerCase());
        return util !== undefined ? util : null;
    }

    // Value-bearing utilities resolved against the theme index.
    const spec = VALUE_MAPPED_DECLARATIONS.get(property);
    if (spec) {
        return resolveValueUtility(spec, value, themeIndex);
    }

    return null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Convert (or exclude) a single inline-style occurrence.
 *
 * @param {{ value: string, locator?: object, dynamic?: boolean }} occurrence
 *        an inline-style occurrence from the HTML Scanner.
 * @param {object} [themeIndex] index built by `buildThemeIndex`; defaults to the
 *        project's default theme/scale index when omitted.
 * @returns {{
 *   action: 'convert' | 'exclude',
 *   utilities?: object[],   // ClassToken[] when action === 'convert'
 *   reason?: string,        // reason category when action === 'exclude'
 * }}
 */
function convertInlineStyle(occurrence, themeIndex) {
    if (!occurrence || typeof occurrence !== 'object' || typeof occurrence.value !== 'string') {
        throw new TypeError('[inline-style-converter] convertInlineStyle expects an occurrence with a string value');
    }

    const index = themeIndex || buildThemeIndex();
    const styleText = occurrence.value;

    // 1. Dynamic / JS-set styles are never converted (Req 7.2). The scanner sets
    //    `dynamic` for tags inside <script>/template regions; we also defend
    //    against template-literal interpolation surfacing in the value itself.
    if (occurrence.dynamic === true || styleText.indexOf('${') !== -1) {
        return { action: 'exclude', reason: Reason.DYNAMIC };
    }

    // 2. Parse declarations. A malformed declaration (no ':') makes the whole
    //    style not safely expressible (Req 7.3).
    const { declarations, malformed } = parseDeclarations(styleText);
    if (malformed || declarations.length === 0) {
        return { action: 'exclude', reason: Reason.NOT_EXPRESSIBLE };
    }

    // 3. Resolve every declaration. If ANY is not expressible, exclude the whole
    //    occurrence so styling is never partially dropped (Req 7.3).
    const utilities = [];
    for (const declaration of declarations) {
        const util = resolveDeclaration(declaration, index);
        if (util === null) {
            return { action: 'exclude', reason: Reason.NOT_EXPRESSIBLE };
        }
        utilities.push(util);
    }

    // 4. All declarations expressible: tokenize the utilities into ClassToken[]
    //    (Req 7.1, 7.6).
    return {
        action: 'convert',
        utilities: tokenize(utilities.join(' ')),
    };
}

module.exports = {
    convertInlineStyle,
    Reason,
};

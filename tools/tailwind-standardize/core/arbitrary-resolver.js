'use strict';

/**
 * Arbitrary-Value Resolver for the Tailwind CSS Standardization tool.
 *
 * Decides, for a single arbitrary-value (bracket-notation) utility token, one of
 * three deterministic actions:
 *
 *   - 'replace-existing' : the literal's normalized computed value exactly equals
 *                          an existing Design_Token or a configured spacing/sizing
 *                          scale entry, so the utility is rewritten to reference
 *                          that token/scale (Req 3.1, 3.4).
 *   - 'add-token'        : the value has no matching token but recurs in two or
 *                          more files, so a new Design_Token is proposed (named
 *                          per the Theme_Block convention) and the utility is
 *                          rewritten to reference it (Req 3.2, 3.3, 3.6).
 *   - 'retain'           : the value has no matching token and recurs in fewer
 *                          than two files, so the literal is kept verbatim for a
 *                          manual-review item (Req 3.5).
 *
 * The matching is performed by EXACT computed value: every arbitrary literal and
 * every token/scale value is run through the same canonicalization
 * (`normalizeComputedValue`) so that, for example, `mt-[16px]` and a
 * `--spacing-sm: 1rem` token compare equal (16px / 16 = 1rem), and
 * `bg-[#3B6AC5]` matches `--color-primary: #3b6ac5` regardless of hex casing or
 * shorthand.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions. It reuses the Class Tokenizer to build
 * the replacement ClassToken so replacement utilities are structurally identical
 * to scanned tokens.
 *
 * _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_
 */

const { tokenize, Category } = require('./tokenizer');

// ---------------------------------------------------------------------------
// Token namespaces
// ---------------------------------------------------------------------------

/**
 * The theme namespaces this resolver understands. A namespace is the leading
 * `--<word>-` segment of a Design_Token name and also selects which utilities a
 * token can back (a `--color-*` token backs `bg-`/`text-`/... , a `--spacing-*`
 * token backs `p-`/`m-`/`w-`/... , a `--radius-*` token backs `rounded-`).
 */
const Namespace = Object.freeze({
    COLOR: 'color',
    SPACING: 'spacing',
    RADIUS: 'radius',
});

// Assumed root font-size used to normalize px lengths into rem so they can be
// matched against the rem-based spacing/sizing scale (Req 3.4).
const ROOT_FONT_SIZE_PX = 16;

// ---------------------------------------------------------------------------
// Default theme data (mirrors css/tailwind-input.css @theme block)
// ---------------------------------------------------------------------------

/**
 * The concrete (non-alias) Design_Tokens whose values can be matched against
 * arbitrary literals. Tokens defined as `var(--other)` aliases are intentionally
 * excluded because they carry no literal computed value of their own.
 */
const DEFAULT_THEME_TOKENS = Object.freeze([
    // Colors — surfaces / text / brand
    { name: '--color-secondary', value: '#f2f3f0' },
    { name: '--color-surface', value: '#ffffff' },
    { name: '--color-surface-alt', value: '#e7e8e5' },
    { name: '--color-text-main', value: '#111111' },
    { name: '--color-text-muted', value: '#5c5c5c' },
    { name: '--color-text-light', value: '#888888' },
    { name: '--color-primary', value: '#3b6ac5' },
    { name: '--color-primary-dark', value: '#2f5499' },
    { name: '--color-primary-light', value: '#5b84d6' },
    { name: '--color-primary-mist', value: 'rgba(59, 106, 197, 0.08)' },
    // Colors — semantic status (solids only carry distinct literals)
    { name: '--color-success-solid', value: '#2ecc71' },
    { name: '--color-warning-solid', value: '#f0ad4e' },
    { name: '--color-danger-solid', value: '#e85d5d' },
    { name: '--color-info-solid', value: '#5b8fa8' },
    // Colors — grade / utility / gender
    { name: '--color-grade-excellent', value: '#4caf50' },
    { name: '--color-grade-good', value: '#8bc34a' },
    { name: '--color-grade-average', value: '#ff9800' },
    { name: '--color-grade-poor', value: '#f44336' },
    { name: '--color-export', value: '#217346' },
    { name: '--color-neutral', value: '#6c757d' },
    { name: '--color-accent', value: '#cbccc9' },
    { name: '--color-silver', value: '#b0b1ae' },
    { name: '--color-female', value: '#8665b5' },
    { name: '--color-male', value: '#ab65a1' },
    { name: '--color-total', value: '#3b6ac5' },
    // Border radius
    { name: '--radius-xs', value: '6px' },
    { name: '--radius-sm', value: '8px' },
    { name: '--radius-md', value: '16px' },
    { name: '--radius-lg', value: '24px' },
    { name: '--radius-xl', value: '32px' },
    { name: '--radius-full', value: '9999px' },
    // Spacing
    { name: '--spacing-xs', value: '0.5rem' },
    { name: '--spacing-sm', value: '1rem' },
    { name: '--spacing-md', value: '1.5rem' },
    { name: '--spacing-lg', value: '2rem' },
    { name: '--spacing-xl', value: '3rem' },
]);

/**
 * The default numeric spacing/sizing scale (Tailwind v4 `--spacing: 0.25rem`
 * base). Each entry maps a utility suffix to its computed rem value. Used for
 * magic-number-to-scale matching (Req 3.4) when no named token applies.
 */
const DEFAULT_SPACING_SCALE = Object.freeze(
    (() => {
        const steps = [
            0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 5, 6, 7, 8, 9, 10, 11, 12,
            14, 16, 20, 24, 28, 32, 36, 40, 44, 48, 52, 56, 60, 64, 72, 80, 96,
        ];
        return Object.freeze(
            steps.map((step) => ({
                suffix: String(step).replace('.', '\\.'),
                rawSuffix: String(step),
                value: `${step * 0.25}rem`,
            }))
        );
    })()
);

// ---------------------------------------------------------------------------
// Computed-value normalization
// ---------------------------------------------------------------------------

/**
 * Format a finite number into its shortest canonical decimal string (no
 * trailing zeros, no trailing dot). e.g. 1 -> "1", 0.5 -> "0.5", 0.8125 ->
 * "0.8125".
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
    if (!Number.isFinite(n)) {
        return String(n);
    }
    // toFixed(6) then strip trailing zeros to avoid float noise like 0.30000001.
    let s = n.toFixed(6);
    if (s.indexOf('.') !== -1) {
        s = s.replace(/0+$/, '').replace(/\.$/, '');
    }
    return s === '-0' ? '0' : s;
}

/**
 * Expand a shorthand hex color (#rgb / #rgba) to its full form (#rrggbb /
 * #rrggbbaa). Returns the lowercase 6/8-digit hex. Non-shorthand input is simply
 * lowercased.
 * @param {string} hex including leading '#'
 * @returns {string}
 */
function normalizeHex(hex) {
    const body = hex.slice(1).toLowerCase();
    if (body.length === 3 || body.length === 4) {
        return '#' + body.split('').map((ch) => ch + ch).join('');
    }
    return '#' + body;
}

/**
 * Normalize an arbitrary literal (or a token/scale value) to a canonical
 * computed value so that equal-rendering values compare string-equal.
 *
 * Rules applied:
 *   - underscores decode to spaces (Tailwind arbitrary-value space encoding);
 *   - surrounding whitespace trimmed and internal whitespace collapsed;
 *   - hex colors lowercased and shorthand expanded (#abc -> #aabbcc);
 *   - rgb()/rgba()/hsl()/hsla() lowercased with internal spaces removed;
 *   - pure lengths normalized: `0<unit>` -> `0`, `px` converted to `rem`
 *     (÷ root font-size), other units kept with a canonical number;
 *   - everything else lowercased.
 *
 * @param {string} literal
 * @returns {string} canonical computed value
 */
function normalizeComputedValue(literal) {
    if (typeof literal !== 'string') {
        throw new TypeError('[arbitrary-resolver] normalizeComputedValue expects a string');
    }

    let value = literal.replace(/_/g, ' ').trim().replace(/\s+/g, ' ');
    if (value === '') {
        return '';
    }

    // Hex color.
    if (/^#([0-9a-fA-F]{3,8})$/.test(value)) {
        return normalizeHex(value);
    }

    // Color / other functional notation: lowercase, drop internal spaces.
    if (/^[a-zA-Z-]+\(.*\)$/.test(value)) {
        return value.toLowerCase().replace(/\s+/g, '');
    }

    // Pure length / number with optional unit.
    const lengthMatch = /^(-?\d*\.?\d+)([a-zA-Z%]*)$/.exec(value);
    if (lengthMatch) {
        const amount = parseFloat(lengthMatch[1]);
        const unit = lengthMatch[2].toLowerCase();

        if (amount === 0) {
            return '0';
        }
        if (unit === 'px') {
            return `${formatNumber(amount / ROOT_FONT_SIZE_PX)}rem`;
        }
        if (unit === '') {
            return formatNumber(amount);
        }
        return `${formatNumber(amount)}${unit}`;
    }

    return value.toLowerCase();
}

// ---------------------------------------------------------------------------
// Theme / scale index
// ---------------------------------------------------------------------------

/**
 * Strip the leading `--<namespace>-` segment from a token name to obtain the
 * utility suffix. e.g. `--color-primary-light` -> `primary-light`,
 * `--spacing-xs` -> `xs`.
 * @param {string} tokenName
 * @returns {string}
 */
function tokenSuffix(tokenName) {
    return tokenName.replace(/^--[a-z0-9]+-/i, '');
}

/**
 * Derive the namespace from a token name. e.g. `--color-primary` -> 'color'.
 * @param {string} tokenName
 * @returns {string|null}
 */
function tokenNamespace(tokenName) {
    const match = /^--([a-z0-9]+)-/i.exec(tokenName);
    return match ? match[1].toLowerCase() : null;
}

/**
 * Build the theme/scale index the resolver consumes.
 *
 * Shape of the returned `themeIndex`:
 * ```
 * {
 *   byValue: Map<normalizedValue, Array<{ tokenName, suffix, namespace }>>,
 *   scaleByValue: Map<normalizedValue, { suffix, namespace }>,
 *   tokenNames: Set<string>,           // existing token names (collision check)
 *   tokenValues: Map<string, string>,  // tokenName -> normalized value
 *   recurrence: Map<normalizedValue, Set<string>>, // value -> files it appears in
 * }
 * ```
 *
 * @param {{
 *   tokens?: Array<{ name: string, value: string }>,
 *   spacingScale?: Array<{ suffix?: string, rawSuffix?: string, value: string }>,
 *   recurrence?: Map<string, Set<string>> | object
 * }} [options]
 * @returns {object} themeIndex
 */
function buildThemeIndex(options = {}) {
    const tokens = options.tokens || DEFAULT_THEME_TOKENS;
    const spacingScale = options.spacingScale || DEFAULT_SPACING_SCALE;

    const byValue = new Map();
    const tokenNames = new Set();
    const tokenValues = new Map();

    for (const token of tokens) {
        const namespace = tokenNamespace(token.name);
        const normalized = normalizeComputedValue(token.value);
        const entry = { tokenName: token.name, suffix: tokenSuffix(token.name), namespace };

        if (!byValue.has(normalized)) {
            byValue.set(normalized, []);
        }
        byValue.get(normalized).push(entry);
        tokenNames.add(token.name);
        tokenValues.set(token.name, normalized);
    }

    const scaleByValue = new Map();
    for (const step of spacingScale) {
        const normalized = normalizeComputedValue(step.value);
        // Named tokens win over the numeric scale; only register a scale entry
        // when no token already represents this value.
        if (!scaleByValue.has(normalized)) {
            scaleByValue.set(normalized, {
                suffix: step.suffix !== undefined ? step.suffix : String(step.rawSuffix),
                namespace: Namespace.SPACING,
            });
        }
    }

    return {
        byValue,
        scaleByValue,
        tokenNames,
        tokenValues,
        recurrence: normalizeRecurrence(options.recurrence),
    };
}

/**
 * Normalize a recurrence input (Map or plain object of value -> iterable of file
 * paths) into a `Map<normalizedValue, Set<string>>`. Keys are normalized so a
 * caller may key by either raw literal or already-normalized value.
 * @param {Map<string, Iterable<string>>|object|undefined} input
 * @returns {Map<string, Set<string>>}
 */
function normalizeRecurrence(input) {
    const out = new Map();
    if (!input) {
        return out;
    }
    const entries = input instanceof Map ? input.entries() : Object.entries(input);
    for (const [rawValue, files] of entries) {
        const key = normalizeComputedValue(rawValue);
        if (!out.has(key)) {
            out.set(key, new Set());
        }
        const set = out.get(key);
        for (const file of files || []) {
            set.add(file);
        }
    }
    return out;
}

/**
 * Build a recurrence index from a flat list of occurrences. Each occurrence
 * pairs an arbitrary literal with the file path it appears in. The result maps
 * the normalized computed value to the set of distinct files it appears in.
 * @param {Array<{ value: string, filePath: string }>} occurrences
 * @returns {Map<string, Set<string>>}
 */
function buildRecurrenceIndex(occurrences = []) {
    const out = new Map();
    for (const occ of occurrences) {
        if (!occ || typeof occ.value !== 'string' || typeof occ.filePath !== 'string') {
            continue;
        }
        const key = normalizeComputedValue(occ.value);
        if (!out.has(key)) {
            out.set(key, new Set());
        }
        out.get(key).add(occ.filePath);
    }
    return out;
}

// ---------------------------------------------------------------------------
// Namespace / naming helpers
// ---------------------------------------------------------------------------

/**
 * Determine which token namespace(s) a utility token could legitimately be
 * backed by, given its resolved category/property. The first matching namespace
 * is preferred.
 * @param {object} token ClassToken
 * @returns {string[]}
 */
function expectedNamespaces(token) {
    if (token.category === Category.COLORS) {
        return [Namespace.COLOR];
    }
    if (token.property === 'border-radius') {
        return [Namespace.RADIUS];
    }
    if (token.category === Category.SPACING || token.category === Category.SIZING) {
        return [Namespace.SPACING];
    }
    return [];
}

/**
 * Sanitize a computed value into a token-suffix fragment that conforms to the
 * Theme_Block naming convention (lowercase, hyphen delimiter, [a-z0-9-]).
 * @param {string} computedValue
 * @returns {string}
 */
function sanitizeSuffix(computedValue) {
    return computedValue
        .toLowerCase()
        .replace(/^#/, '')
        .replace(/\./g, '-')
        .replace(/[^a-z0-9-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

/**
 * Propose a new Design_Token name (and utility suffix) for a recurring value
 * that has no existing token, following the Theme_Block naming convention
 * (`--<namespace>-<descriptor>`, kebab-case, lowercase) (Req 3.6).
 * @param {string} computedValue
 * @param {string} namespace
 * @returns {{ tokenName: string, suffix: string }}
 */
function proposeToken(computedValue, namespace) {
    const fragment = sanitizeSuffix(computedValue);
    const suffix = namespace === Namespace.COLOR ? `custom-${fragment}` : fragment;
    return { tokenName: `--${namespace}-${suffix}`, suffix };
}

/**
 * Build the replacement ClassToken that references a token/scale suffix, reusing
 * the tokenizer so the result is structurally identical to a scanned token.
 * Preserves all variant prefixes and the negative sign of the original.
 * @param {object} originalToken ClassToken being replaced
 * @param {string} suffix utility suffix (e.g. 'primary', 'sm', '4')
 * @returns {object} ClassToken
 */
function buildReplacement(originalToken, suffix) {
    const base = originalToken.base;
    const open = base.indexOf('[');
    const prefix = open === -1 ? base : base.slice(0, open);
    const newBase = `${prefix}${suffix}`;
    const variants = originalToken.variants || [];
    const raw = variants.length > 0 ? `${variants.join(':')}:${newBase}` : newBase;
    return tokenize(raw)[0];
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve a single arbitrary-value utility token against the theme/scale index.
 *
 * @param {object} token ClassToken (see core/tokenizer.js)
 * @param {object} themeIndex built by `buildThemeIndex`
 * @returns {{
 *   action: 'replace-existing' | 'add-token' | 'retain',
 *   tokenName?: string,
 *   replacement?: object,
 *   computedValue: string
 * }}
 */
function resolveArbitrary(token, themeIndex) {
    if (!token || typeof token !== 'object') {
        throw new TypeError('[arbitrary-resolver] resolveArbitrary expects a ClassToken');
    }
    if (!themeIndex || !(themeIndex.byValue instanceof Map)) {
        throw new TypeError('[arbitrary-resolver] resolveArbitrary expects a themeIndex from buildThemeIndex');
    }

    // Non-arbitrary tokens have nothing to resolve.
    if (!token.isArbitrary || typeof token.arbitraryValue !== 'string') {
        return { action: 'retain', computedValue: '' };
    }

    const computedValue = normalizeComputedValue(token.arbitraryValue);
    const namespaces = expectedNamespaces(token);

    // 1. Exact match against an existing Design_Token (Req 3.1).
    const tokenCandidates = themeIndex.byValue.get(computedValue) || [];
    const tokenMatch = tokenCandidates.find(
        (entry) => namespaces.length === 0 || namespaces.includes(entry.namespace)
    );
    if (tokenMatch) {
        return {
            action: 'replace-existing',
            tokenName: tokenMatch.tokenName,
            replacement: buildReplacement(token, tokenMatch.suffix),
            computedValue,
        };
    }

    // 2. Exact match against the configured spacing/sizing scale (Req 3.4).
    if (namespaces.includes(Namespace.SPACING)) {
        const scaleMatch = themeIndex.scaleByValue.get(computedValue);
        if (scaleMatch) {
            return {
                action: 'replace-existing',
                replacement: buildReplacement(token, scaleMatch.suffix),
                computedValue,
            };
        }
    }

    // 3. No match: decide add-token vs retain by recurrence across files
    //    (Req 3.2, 3.3, 3.5). A value recurring in >= 2 distinct files earns a
    //    new token; otherwise it is retained for manual review.
    const files = themeIndex.recurrence.get(computedValue);
    const fileCount = files ? files.size : 0;
    const namespace = namespaces.length > 0 ? namespaces[0] : Namespace.SPACING;

    if (fileCount >= 2) {
        const proposed = proposeToken(computedValue, namespace);
        return {
            action: 'add-token',
            tokenName: proposed.tokenName,
            replacement: buildReplacement(token, proposed.suffix),
            computedValue,
        };
    }

    return { action: 'retain', computedValue };
}

module.exports = {
    resolveArbitrary,
    buildThemeIndex,
    buildRecurrenceIndex,
    normalizeComputedValue,
    proposeToken,
    Namespace,
    DEFAULT_THEME_TOKENS,
    DEFAULT_SPACING_SCALE,
};

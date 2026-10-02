'use strict';

/**
 * Output-Preservation Gate for the Tailwind CSS Standardization tool.
 *
 * This is the central safety mechanism of the Refactorer. Every candidate edit
 * (utility reorder, duplicate removal, conflict removal, arbitrary->token
 * substitution, physical->logical mapping, inline-style conversion, ...) MUST
 * be routed through `evaluateEdit` BEFORE it is written to disk. The gate
 * approves an edit ONLY when it can PROVE the edit is output-preserving; in
 * every other case it rejects, signalling that the original markup must be
 * retained verbatim and the element recorded for manual review / exclusion.
 *
 * ---------------------------------------------------------------------------
 * The declaration-set model
 * ---------------------------------------------------------------------------
 *
 * For a given rendering CONTEXT we model an element's observable styling as its
 * EFFECTIVE DECLARATION SET: a map from each CSS property to the SET of values
 * contributed by the utilities that apply in that context.
 *
 *   effectiveDeclarations(tokens, context) : Map<property, Set<value>>
 *
 * A CONTEXT is the triple:
 *
 *   { theme: 'light' | 'dark',
 *     breakpoint: 'base' | 'sm' | 'md' | 'lg' | 'xl' | '2xl',
 *     state: 'base' | 'hover' | 'focus' | ... }
 *
 * A utility token APPLIES to a context iff its responsive variant matches the
 * context breakpoint (a token with no responsive variant lives in the `base`
 * breakpoint bucket) AND its state variant matches the context state (a token
 * with no state variant lives in the `base` state bucket). Bucketing each
 * variant combination separately is SOUND for before/after equality: the real
 * cascade at any breakpoint/state is a deterministic function of the individual
 * buckets, so if every bucket is identical before and after, the rendered
 * result is identical in every breakpoint/state.
 *
 * A token's VALUE in a context is resolved as follows:
 *   - An arbitrary literal (e.g. `bg-[#3b6ac5]`, `mt-[16px]`) has a FIXED,
 *     theme-independent computed value (normalized via the arbitrary resolver).
 *   - A token reference (e.g. `bg-primary`, `rounded-md`) resolves through the
 *     theme index to the concrete value of its backing `var(--token)`. That
 *     value is THEME-DEPENDENT: in the `dark` context it resolves to the
 *     `[data-theme="dark"]` override when one is known. When no dark override
 *     data is available the dark value is represented by an opaque,
 *     theme-tagged symbol so that a literal<->token swap can never be proven
 *     equal in dark (the gate must never ASSUME dark equivalence).
 *   - An unresolved utility (no backing token in the index) is represented by
 *     an opaque, theme-independent symbol keyed on its base utility, so equal
 *     utilities compare equal and different ones compare different.
 *
 * Two declaration sets are PROVABLY IDENTICAL when, for every property, the set
 * of contributed values is identical. An edit is APPROVED iff the before/after
 * declaration sets are provably identical in EVERY checked context (both themes
 * across every configured breakpoint and interaction state). Otherwise it is
 * REJECTED. The gate is deliberately conservative: when a value cannot be
 * resolved precisely it is represented symbolically, which can only ever make
 * the gate reject (never wrongly approve).
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/tokenizer.js).
 *
 * _Requirements: 2.1, 2.3, 2.5, 4.4, 4.5, 6.5, 7.6, 9.4, 9.5_
 */

const { tokenize, Category, RESPONSIVE_VARIANTS } = require('./tokenizer');
const { buildThemeIndex, normalizeComputedValue, Namespace } = require('./arbitrary-resolver');
const { ReviewReasonCategory } = require('./models');

// ---------------------------------------------------------------------------
// Context configuration
// ---------------------------------------------------------------------------

/** The two theme contexts every edit is checked against (Req 2.3). */
const THEMES = Object.freeze(['light', 'dark']);

/**
 * The configured breakpoint buckets. `base` is the non-responsive bucket; the
 * remainder are the configured responsive prefixes (Req 9.1).
 */
const BREAKPOINTS = Object.freeze(['base', 'sm', 'md', 'lg', 'xl', '2xl']);

/** The default state bucket carried by utilities with no interaction variant. */
const BASE_STATE = 'base';

// ---------------------------------------------------------------------------
// Theme-token name helpers (mirror the arbitrary resolver's private helpers)
// ---------------------------------------------------------------------------

/**
 * Strip the leading `--<namespace>-` segment from a token name to obtain its
 * utility suffix. e.g. `--color-primary-light` -> `primary-light`.
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
 * Determine which token namespace a utility could legitimately be backed by,
 * given its resolved category/property. Mirrors the arbitrary resolver so the
 * gate resolves `var(--token)` references the same way the substitution does.
 * @param {object} token ClassToken
 * @returns {string|null}
 */
function namespaceForToken(token) {
    if (token.category === Category.COLORS) {
        return Namespace.COLOR;
    }
    if (token.property === 'border-radius') {
        return Namespace.RADIUS;
    }
    if (token.category === Category.SPACING || token.category === Category.SIZING) {
        return Namespace.SPACING;
    }
    return null;
}

// ---------------------------------------------------------------------------
// Value resolution
// ---------------------------------------------------------------------------

/**
 * Find the Design_Token (if any) that backs a non-arbitrary utility token by
 * matching the utility's base against the token suffixes in its namespace.
 * Prefers the LONGEST matching suffix so `bg-primary-dark` resolves to
 * `--color-primary-dark` rather than `--color-primary`.
 *
 * @param {object} token ClassToken
 * @param {object} themeIndex built by `buildThemeIndex`
 * @returns {{ name: string, lightValue: string }|null}
 */
function findBackingToken(token, themeIndex) {
    const namespace = namespaceForToken(token);
    if (!namespace) {
        return null;
    }

    let best = null;
    for (const [name, value] of themeIndex.tokenValues.entries()) {
        if (tokenNamespace(name) !== namespace) {
            continue;
        }
        const suffix = tokenSuffix(name);
        if (suffix === '') {
            continue;
        }
        // Match the suffix at a `-` boundary: `bg-primary` ends with `primary`
        // preceded by `-`. Guard against accidental substring matches.
        const boundaryIndex = token.base.length - suffix.length;
        if (boundaryIndex <= 0) {
            continue;
        }
        if (token.base.endsWith(suffix) && token.base[boundaryIndex - 1] === '-') {
            if (best === null || suffix.length > best.suffixLength) {
                best = { name, lightValue: value, suffixLength: suffix.length };
            }
        }
    }

    return best ? { name: best.name, lightValue: best.lightValue } : null;
}

/**
 * Resolve a single utility token to its computed value in a given theme.
 *
 *   - Arbitrary literals      -> fixed, theme-independent normalized value.
 *   - Backed token references -> concrete light value, or the dark override in
 *                                the dark theme when known; otherwise an opaque
 *                                theme-tagged symbol (never assume equivalence).
 *   - Unresolved utilities    -> opaque, theme-independent symbol on the base.
 *
 * @param {object} token ClassToken
 * @param {'light'|'dark'} theme
 * @param {object} themeIndex
 * @returns {string} canonical value token
 */
function resolveValue(token, theme, themeIndex) {
    if (token.isArbitrary && typeof token.arbitraryValue === 'string') {
        return `lit:${normalizeComputedValue(token.arbitraryValue)}`;
    }

    const backing = findBackingToken(token, themeIndex);
    if (backing) {
        if (theme === 'dark') {
            const darkValues = themeIndex.darkTokenValues;
            if (darkValues instanceof Map && darkValues.has(backing.name)) {
                return `lit:${darkValues.get(backing.name)}`;
            }
            // No dark-override data: represent symbolically and theme-tagged so a
            // literal<->token swap can never be proven equal in the dark context.
            return `dark-var:${backing.name}`;
        }
        return `lit:${backing.lightValue}`;
    }

    // Unresolved utility: opaque, theme-independent identity on the base. Equal
    // bases compare equal; different bases compare different.
    return `util:${token.base}`;
}

/**
 * The declaration "property" key for a token. Utilities whose CSS property is
 * unknown are keyed on their base so distinct unknown utilities never collapse
 * into one another.
 * @param {object} token ClassToken
 * @returns {string}
 */
function declarationProperty(token) {
    if (token.property === null || token.property === undefined) {
        return `__util__:${token.base}`;
    }
    return token.property;
}

// ---------------------------------------------------------------------------
// Declaration-set computation
// ---------------------------------------------------------------------------

/**
 * Does a token apply in the given context bucket?
 * @param {object} token ClassToken
 * @param {{ breakpoint: string, state: string }} context
 * @returns {boolean}
 */
function tokenApplies(token, context) {
    const tokenBreakpoint = token.responsiveVariant || 'base';
    const tokenState = token.stateVariant || BASE_STATE;
    return tokenBreakpoint === context.breakpoint && tokenState === context.state;
}

/**
 * Compute the effective declaration set of a token list in one context.
 *
 * @param {object[]} tokens ClassToken[]
 * @param {{ theme: string, breakpoint: string, state: string }} context
 * @param {object} themeIndex
 * @returns {Map<string, Set<string>>} property -> set of values
 */
function computeDeclarationSet(tokens, context, themeIndex) {
    const declarations = new Map();
    for (const token of tokens) {
        if (!tokenApplies(token, context)) {
            continue;
        }
        const property = declarationProperty(token);
        const value = resolveValue(token, context.theme, themeIndex);
        if (!declarations.has(property)) {
            declarations.set(property, new Set());
        }
        declarations.get(property).add(value);
    }
    return declarations;
}

/**
 * Compare two effective declaration sets for exact equality.
 * @param {Map<string, Set<string>>} a
 * @param {Map<string, Set<string>>} b
 * @returns {{ equal: boolean, property?: string, before?: string[], after?: string[] }}
 */
function diffDeclarationSets(a, b) {
    const properties = new Set([...a.keys(), ...b.keys()]);
    for (const property of properties) {
        const setA = a.get(property) || new Set();
        const setB = b.get(property) || new Set();
        if (setA.size !== setB.size || ![...setA].every((value) => setB.has(value))) {
            return {
                equal: false,
                property,
                before: [...setA].sort(),
                after: [...setB].sort(),
            };
        }
    }
    return { equal: true };
}

// ---------------------------------------------------------------------------
// Context enumeration
// ---------------------------------------------------------------------------

/**
 * Collect the interaction states present across the supplied tokens so the gate
 * checks every state bucket an edit could touch (in addition to `base`).
 * @param {object[]} tokens ClassToken[]
 * @returns {string[]} sorted unique states including 'base'
 */
function collectStates(tokens) {
    const states = new Set([BASE_STATE]);
    for (const token of tokens) {
        if (token.stateVariant) {
            states.add(token.stateVariant);
        }
    }
    return [...states];
}

/**
 * Build the default context grid: both themes, every configured breakpoint, and
 * every interaction state present in the edit (plus `base`). Buckets with no
 * applicable tokens on either side are harmless (they compare equal), so it is
 * always safe to check the full grid.
 * @param {object[]} tokens ClassToken[] (union of before + after)
 * @returns {Array<{ theme: string, breakpoint: string, state: string }>}
 */
function defaultContexts(tokens) {
    const states = collectStates(tokens);
    const contexts = [];
    for (const theme of THEMES) {
        for (const breakpoint of BREAKPOINTS) {
            for (const state of states) {
                contexts.push({ theme, breakpoint, state });
            }
        }
    }
    return contexts;
}

// ---------------------------------------------------------------------------
// Input normalization
// ---------------------------------------------------------------------------

/**
 * Normalize an edit side (a `class` attribute string or a ClassToken[]) into a
 * ClassToken[].
 * @param {string|object[]} input
 * @param {string} label
 * @returns {object[]} ClassToken[]
 */
function toTokens(input, label) {
    if (typeof input === 'string') {
        return tokenize(input);
    }
    if (Array.isArray(input)) {
        return input;
    }
    throw new TypeError(`[preservation-gate] ${label} must be a class string or a ClassToken array`);
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Evaluate whether a candidate edit is provably output-preserving.
 *
 * The Refactorer calls this with the element's class tokens (or class string)
 * BEFORE and AFTER the candidate edit. The gate approves ONLY when the
 * effective declaration sets are provably identical in every checked context;
 * otherwise it rejects and signals that the original markup must be retained
 * verbatim and the element recorded for manual review / exclusion.
 *
 * @param {{
 *   beforeTokens: string | object[],
 *   afterTokens: string | object[],
 *   themeIndex?: object,
 *   contexts?: Array<{ theme: string, breakpoint: string, state: string }>
 * }} args
 * @returns {{
 *   approved: boolean,
 *   reason?: string,
 *   reasonCategory?: string,
 *   retainOriginal?: boolean,
 *   context?: object,
 *   contextsChecked?: number
 * }}
 */
function evaluateEdit({ beforeTokens, afterTokens, themeIndex, contexts } = {}) {
    const before = toTokens(beforeTokens, 'beforeTokens');
    const after = toTokens(afterTokens, 'afterTokens');
    const index = themeIndex && themeIndex.tokenValues instanceof Map ? themeIndex : buildThemeIndex();

    const checkContexts = Array.isArray(contexts) && contexts.length > 0
        ? contexts
        : defaultContexts(before.concat(after));

    for (const context of checkContexts) {
        const beforeSet = computeDeclarationSet(before, context, index);
        const afterSet = computeDeclarationSet(after, context, index);
        const diff = diffDeclarationSets(beforeSet, afterSet);
        if (!diff.equal) {
            const where = `theme=${context.theme}, breakpoint=${context.breakpoint}, state=${context.state}`;
            const reason =
                `Edit would change the effective declaration set in context [${where}]: ` +
                `property '${diff.property}' resolves to {${diff.before.join(', ')}} before ` +
                `but {${diff.after.join(', ')}} after. Original markup must be retained verbatim.`;
            return {
                approved: false,
                reason,
                reasonCategory: ReviewReasonCategory.OUTPUT_WOULD_CHANGE,
                retainOriginal: true,
                context: Object.freeze({ ...context, property: diff.property }),
            };
        }
    }

    return { approved: true, contextsChecked: checkContexts.length };
}

module.exports = {
    evaluateEdit,
    // Exposed for targeted testing / reuse by the Refactorer.
    computeDeclarationSet,
    diffDeclarationSets,
    resolveValue,
    findBackingToken,
    defaultContexts,
    THEMES,
    BREAKPOINTS,
};

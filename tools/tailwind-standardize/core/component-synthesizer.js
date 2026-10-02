'use strict';

/**
 * Component-Class Synthesizer for the Tailwind CSS Standardization tool.
 *
 * `synthesizeComponentClass(utilitySet, componentLayerIndex)` turns a recurring
 * utility combination (the candidate produced by the Combination Detector) into
 * a single `@layer components` entry expressed with `@apply` (which in turn may
 * reference `var(--token)`s through the utilities it applies), consistent with
 * the existing Component_Layer entries.
 *
 * Behaviour (Req 4.2, 4.3):
 *   - The synthesized class **name** is derived deterministically from the
 *     order-independent utility set and conforms to the naming convention
 *     (casing, prefix, delimiter) inferred from the existing component class
 *     names in `componentLayerIndex`.
 *   - The **declaration** is a `@layer components` rule that `@apply`s the
 *     utilities in a canonical (sorted) order, so two runs over the same
 *     utility set always produce byte-for-byte identical output.
 *   - A **name collision** is *reported, never resolved by redefining*: if the
 *     proposed name already exists in `componentLayerIndex` with a **differing**
 *     definition, the function returns `{ collision: true, ... }` and leaves the
 *     existing entry untouched. If the existing entry's definition is
 *     **identical** to what would be generated, it is not a collision — the
 *     existing class is reused.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/models.js).
 *
 * _Requirements: 4.2, 4.3_
 */

// ---------------------------------------------------------------------------
// Utility-set extraction / canonicalization
// ---------------------------------------------------------------------------

/**
 * Extract the list of utility strings from the `utilitySet` argument. Accepts a
 * plain array of strings or an array of ClassToken-like objects (carrying a
 * `raw` field). Each utility keeps its exact token text (including any variant
 * prefixes such as `md:hover:`).
 *
 * @param {Array<string|{raw: string}>} utilitySet
 * @returns {string[]}
 */
function extractUtilities(utilitySet) {
    if (!Array.isArray(utilitySet)) {
        throw new TypeError('[component-synthesizer] utilitySet must be an array of utilities');
    }
    return utilitySet
        .map((entry) => {
            if (typeof entry === 'string') {
                return entry.trim();
            }
            if (entry && typeof entry.raw === 'string') {
                return entry.raw.trim();
            }
            return '';
        })
        .filter((token) => token.length > 0);
}

/**
 * Canonicalize a utility list into an order-independent, de-duplicated, sorted
 * set so any permutation of the same utilities yields identical output.
 *
 * @param {string[]} utilities
 * @returns {string[]}
 */
function canonicalizeSet(utilities) {
    return Array.from(new Set(utilities)).sort();
}

// ---------------------------------------------------------------------------
// Component-layer index normalization
// ---------------------------------------------------------------------------

/**
 * Normalize the `componentLayerIndex` argument into a `Map<name, declaration>`
 * where `name` is the bare class name (no leading `.`) and `declaration` is the
 * existing definition string (or `null` when only the name is known).
 *
 * Accepted shapes:
 *   - `Map<name, declaration>`
 *   - `Array<string>` (names only)
 *   - `Array<{ name|className, declaration|body? }>`
 *   - plain object `{ name: declaration }`
 *
 * @param {*} componentLayerIndex
 * @returns {Map<string, string|null>}
 */
function normalizeLayerIndex(componentLayerIndex) {
    const out = new Map();
    if (!componentLayerIndex) {
        return out;
    }

    const addEntry = (rawName, declaration) => {
        if (typeof rawName !== 'string' || rawName.trim().length === 0) {
            return;
        }
        const name = stripLeadingDot(rawName.trim());
        const decl = typeof declaration === 'string' ? declaration : null;
        // First definition wins; never let a later null clobber a known body.
        if (!out.has(name) || (out.get(name) === null && decl !== null)) {
            out.set(name, decl);
        }
    };

    if (componentLayerIndex instanceof Map) {
        for (const [name, declaration] of componentLayerIndex.entries()) {
            addEntry(name, declaration);
        }
        return out;
    }

    if (Array.isArray(componentLayerIndex)) {
        for (const entry of componentLayerIndex) {
            if (typeof entry === 'string') {
                addEntry(entry, null);
            } else if (entry && typeof entry === 'object') {
                const name = entry.name || entry.className || entry.selector;
                const declaration =
                    entry.declaration !== undefined ? entry.declaration : entry.body;
                addEntry(name, declaration);
            }
        }
        return out;
    }

    if (typeof componentLayerIndex === 'object') {
        for (const [name, declaration] of Object.entries(componentLayerIndex)) {
            addEntry(name, declaration);
        }
    }

    return out;
}

/**
 * Remove a single leading `.` from a CSS selector to obtain the bare name.
 * @param {string} name
 * @returns {string}
 */
function stripLeadingDot(name) {
    return name.startsWith('.') ? name.slice(1) : name;
}

// ---------------------------------------------------------------------------
// Naming-convention inference
// ---------------------------------------------------------------------------

const Casing = Object.freeze({
    KEBAB: 'kebab',
    SNAKE: 'snake',
    CAMEL: 'camel',
});

/**
 * Infer the naming convention (delimiter/casing + optional shared prefix) from
 * the existing component class names. Defaults to kebab-case with no prefix —
 * the convention used throughout the project's `@layer components` block.
 *
 * @param {string[]} names bare class names (no leading `.`)
 * @returns {{ casing: string, prefix: string }}
 */
function inferConventions(names) {
    if (!names || names.length === 0) {
        return { casing: Casing.KEBAB, prefix: '' };
    }

    let hyphen = 0;
    let underscore = 0;
    let camel = 0;
    for (const name of names) {
        if (name.includes('-')) {
            hyphen += 1;
        }
        if (name.includes('_')) {
            underscore += 1;
        }
        if (!name.includes('-') && !name.includes('_') && /[a-z][A-Z]/.test(name)) {
            camel += 1;
        }
    }

    let casing = Casing.KEBAB;
    if (camel > hyphen && camel > underscore) {
        casing = Casing.CAMEL;
    } else if (underscore > hyphen) {
        casing = Casing.SNAKE;
    }

    const prefix = inferPrefix(names, casing);
    return { casing, prefix };
}

/**
 * Infer a shared leading prefix segment if (and only if) every existing name
 * shares an identical first segment and there are at least two names to
 * generalize from. Returns the prefix segment (without delimiter) or `''`.
 *
 * @param {string[]} names
 * @param {string} casing
 * @returns {string}
 */
function inferPrefix(names, casing) {
    if (names.length < 2) {
        return '';
    }

    const firstSegments = names.map((name) => leadingSegment(name, casing));
    if (firstSegments.some((seg) => seg.length === 0)) {
        return '';
    }

    const candidate = firstSegments[0];
    const shared = firstSegments.every((seg) => seg === candidate);
    if (!shared) {
        return '';
    }

    // Only treat it as a prefix if it is a leading *segment* of a longer name
    // (i.e. the name has more after the prefix), so a set of single-word names
    // is not mistaken for a prefix convention.
    const isProperPrefix = names.every((name) => leadingSegment(name, casing) !== name);
    return isProperPrefix ? candidate : '';
}

/**
 * Return the first segment of a name under the given casing convention.
 * @param {string} name
 * @param {string} casing
 * @returns {string}
 */
function leadingSegment(name, casing) {
    if (casing === Casing.CAMEL) {
        const match = /^[a-z0-9]+/.exec(name);
        return match ? match[0] : '';
    }
    const delimiter = casing === Casing.SNAKE ? '_' : '-';
    return name.split(delimiter)[0];
}

// ---------------------------------------------------------------------------
// Name generation
// ---------------------------------------------------------------------------

/**
 * Break a utility set into an ordered list of lowercase alphanumeric word
 * segments suitable for assembling a class name. Variant separators and any
 * non-alphanumeric characters become segment boundaries, so `md:hover:bg-primary`
 * contributes `['md', 'hover', 'bg', 'primary']`.
 *
 * @param {string[]} canonicalSet sorted utility set
 * @returns {string[]}
 */
function utilitySegments(canonicalSet) {
    const segments = [];
    for (const utility of canonicalSet) {
        const parts = utility
            .toLowerCase()
            .split(/[^a-z0-9]+/)
            .filter((part) => part.length > 0);
        for (const part of parts) {
            segments.push(part);
        }
    }
    return segments;
}

/**
 * Assemble a class name from word segments according to the casing convention
 * and optional prefix.
 *
 * @param {string[]} segments
 * @param {{ casing: string, prefix: string }} conventions
 * @returns {string}
 */
function assembleName(segments, conventions) {
    const { casing, prefix } = conventions;
    const allSegments = prefix ? [prefix, ...segments] : segments.slice();

    if (allSegments.length === 0) {
        return '';
    }

    if (casing === Casing.CAMEL) {
        return allSegments
            .map((seg, index) => (index === 0 ? seg : seg.charAt(0).toUpperCase() + seg.slice(1)))
            .join('');
    }

    const delimiter = casing === Casing.SNAKE ? '_' : '-';
    return allSegments.join(delimiter);
}

// ---------------------------------------------------------------------------
// Declaration generation + signature comparison
// ---------------------------------------------------------------------------

/**
 * Build the `@layer components` rule declaration for a class. The utilities are
 * emitted in canonical (sorted) order inside a single `@apply` statement and
 * the body is indented with four spaces to match the project's CSS style.
 *
 * @param {string} className bare class name (no leading `.`)
 * @param {string[]} canonicalSet sorted utility set
 * @returns {string}
 */
function buildDeclaration(className, canonicalSet) {
    return `.${className} {\n    @apply ${canonicalSet.join(' ')};\n}`;
}

/**
 * Reduce a declaration string to an order-independent canonical signature so
 * two definitions can be compared for *equivalence* rather than exact text. The
 * selector wrapper is stripped, whitespace is collapsed, and the utility list of
 * any `@apply` statement is sorted. This makes `@apply flex items-center` and
 * `@apply items-center flex` compare equal while a full property block compares
 * distinct from an `@apply` block.
 *
 * @param {string|null} declaration
 * @returns {string|null} signature, or `null` when the declaration is unknown
 */
function declarationSignature(declaration) {
    if (typeof declaration !== 'string') {
        return null;
    }

    // Strip an optional `.selector { ... }` wrapper, keeping just the body.
    let body = declaration.trim();
    const wrapped = /^\.[^{]+\{([\s\S]*)\}\s*$/.exec(body);
    if (wrapped) {
        body = wrapped[1];
    }

    // Collapse all whitespace runs to a single space.
    body = body.replace(/\s+/g, ' ').trim();

    // Sort the utilities inside every `@apply ...;` statement.
    body = body.replace(/@apply\s+([^;]+);?/g, (whole, utilities) => {
        const sorted = utilities
            .trim()
            .split(/\s+/)
            .filter((token) => token.length > 0)
            .sort();
        return `@apply ${sorted.join(' ')};`;
    });

    return body;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Synthesize a single component class for a recurring utility combination.
 *
 * @param {Array<string|{raw: string}>} utilitySet
 *   The order-independent set of two or more utilities to consolidate.
 * @param {Map<string,string>|Array|object} [componentLayerIndex]
 *   The existing component class names + their declarations, used to infer the
 *   naming convention and to detect collisions.
 * @returns {
 *   { className: string, declaration: string, reused?: boolean }
 *   | { collision: true, className: string, proposedDeclaration: string,
 *       existingDeclaration: string|null, reason: string }
 * }
 */
function synthesizeComponentClass(utilitySet, componentLayerIndex) {
    const utilities = extractUtilities(utilitySet);
    const canonicalSet = canonicalizeSet(utilities);

    if (canonicalSet.length < 2) {
        throw new RangeError(
            '[component-synthesizer] a component class requires two or more distinct utilities'
        );
    }

    const layerIndex = normalizeLayerIndex(componentLayerIndex);
    const conventions = inferConventions(Array.from(layerIndex.keys()));

    const segments = utilitySegments(canonicalSet);
    const className = assembleName(segments, conventions);
    const declaration = buildDeclaration(className, canonicalSet);

    if (layerIndex.has(className)) {
        const existingDeclaration = layerIndex.get(className);
        const proposedSignature = declarationSignature(declaration);
        const existingSignature = declarationSignature(existingDeclaration);

        // Identical definition => not a collision; reuse the existing class.
        if (existingSignature !== null && existingSignature === proposedSignature) {
            return { className, declaration, reused: true };
        }

        // Name exists with a differing (or unknown) definition: report, never
        // redefine (Req 4.3, 10.8).
        return {
            collision: true,
            className,
            proposedDeclaration: declaration,
            existingDeclaration: existingDeclaration,
            reason:
                existingDeclaration === null
                    ? 'name already exists with an unknown definition'
                    : 'name already exists with a differing definition',
        };
    }

    return { className, declaration };
}

module.exports = {
    synthesizeComponentClass,
    // Exposed for unit/property tests of the internal helpers.
    inferConventions,
    declarationSignature,
    Casing,
};

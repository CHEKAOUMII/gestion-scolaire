'use strict';

/**
 * Conflict Resolver for the Tailwind CSS Standardization tool.
 *
 * `resolveConflicts(tokens)` takes a list of `ClassToken` records (as produced
 * by `core/tokenizer.js`) and removes conflicting, overridden, and exactly
 * duplicated utilities from a single `class` attribute, while never touching
 * utilities that live under different variant/breakpoint contexts.
 *
 * The resolution rules (Requirement 6):
 *   - 6.1: Within ONE variant+breakpoint context, when two utilities set the
 *          SAME CSS property such that one overrides the other, keep the
 *          winning (later, in source order) utility and remove the overridden
 *          one.
 *   - 6.2: Utilities that set the same CSS property but live under DIFFERENT
 *          variant/breakpoint contexts never override one another, so both are
 *          retained unchanged.
 *   - 6.3: When an exactly-identical utility appears two or more times, retain
 *          exactly one instance and remove the rest.
 *   - 6.4: If a deterministic winner cannot be identified (e.g. the property is
 *          one that COMPOSES from multiple utilities rather than being
 *          overridden — `transform`, `filter`, ...), both utilities are
 *          retained and recorded in `undecidable` for manual review.
 *
 * The operation is idempotent: feeding `kept` back into `resolveConflicts`
 * yields the same `kept` with empty `removed`/`undecidable` deltas, because all
 * surviving conflicts are exactly the undecidable ones, which are never removed.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/tokenizer.js).
 *
 * _Requirements: 6.1, 6.2, 6.3, 6.4_
 */

// ---------------------------------------------------------------------------
// Composable properties
// ---------------------------------------------------------------------------

/**
 * CSS properties whose utilities COMPOSE rather than override one another.
 *
 * In Tailwind these properties are assembled from several independent CSS
 * custom properties (e.g. `transform` is built from `--tw-scale-x`,
 * `--tw-rotate`, `--tw-translate-x`, ...; `filter` from `--tw-blur`,
 * `--tw-brightness`, ...). Two distinct utilities mapping to the same such
 * property therefore generally combine, and there is no deterministic
 * "winner". Such groups are retained verbatim and recorded as undecidable so a
 * human can review them (Req 6.4).
 */
const COMPOSABLE_PROPERTIES = Object.freeze(new Set([
    'transform',
    'filter',
    'backdrop-filter',
    'box-shadow',
]));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable context key for a token from its variant set. Two tokens
 * share a context iff they carry the same set of variant prefixes (order
 * independent), which encompasses the responsive and state variants. Utilities
 * in different contexts never resolve against one another (Req 6.2).
 * @param {object} token ClassToken
 * @returns {string}
 */
function contextKey(token) {
    const variants = Array.isArray(token.variants) ? token.variants.slice() : [];
    // Sort a de-duplicated copy so variant ordering does not split a context.
    const unique = Array.from(new Set(variants)).sort();
    return `r=${token.responsiveVariant || ''}|s=${token.stateVariant || ''}|v=${unique.join(',')}`;
}

/**
 * Group key combining context and CSS property. Tokens with no resolvable
 * property (property === null) are never grouped and so are always retained.
 * @param {object} token ClassToken
 * @returns {string}
 */
function groupKey(token) {
    return `${contextKey(token)}||${token.property}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolve conflicting, overridden, and duplicate utilities within a single
 * `class` attribute's token list.
 *
 * @param {object[]} tokens ClassToken[] from `core/tokenizer.js`.
 * @returns {{ kept: object[], removed: object[], undecidable: object[] }}
 *   - kept:        the tokens that remain (winners, non-conflicting utilities,
 *                  and retained undecidable utilities), in original order.
 *   - removed:     overridden utilities and surplus exact duplicates, in
 *                  original order.
 *   - undecidable: utilities involved in a non-deterministic (composable)
 *                  conflict; these are also present in `kept` (they are
 *                  retained) and are surfaced here for manual review.
 */
function resolveConflicts(tokens) {
    if (!Array.isArray(tokens)) {
        throw new TypeError('[conflict-resolver] resolveConflicts expects an array of tokens');
    }

    // Decorate with original index so we can determine source order ("later
    // wins") and emit results deterministically.
    const indexed = tokens.map((token, index) => ({ token, index }));

    const removedIdx = new Set();

    // --- Pass 1: de-duplicate EXACT duplicates by raw text (Req 6.3) ---------
    // Keep the first occurrence; mark every subsequent identical `raw` removed.
    const seenRaw = new Set();
    for (const entry of indexed) {
        const raw = entry.token.raw;
        if (seenRaw.has(raw)) {
            removedIdx.add(entry.index);
        } else {
            seenRaw.add(raw);
        }
    }

    // --- Pass 2: resolve same-context, same-property conflicts ---------------
    const undecidableIdx = new Set();
    const groups = new Map();

    for (const entry of indexed) {
        if (removedIdx.has(entry.index)) {
            continue; // already dropped as an exact duplicate
        }
        // Tokens with no resolvable property cannot conflict deterministically
        // and are always retained.
        if (entry.token.property === null || entry.token.property === undefined) {
            continue;
        }
        const key = groupKey(entry.token);
        if (!groups.has(key)) {
            groups.set(key, []);
        }
        groups.get(key).push(entry);
    }

    for (const [, members] of groups) {
        if (members.length < 2) {
            continue; // single utility for this property/context: no conflict
        }

        const property = members[0].token.property;
        if (COMPOSABLE_PROPERTIES.has(property)) {
            // No deterministic winner: utilities compose. Retain all, flag for
            // manual review (Req 6.4).
            for (const member of members) {
                undecidableIdx.add(member.index);
            }
            continue;
        }

        // Deterministic override: the later (highest original index) utility
        // wins; remove every earlier one (Req 6.1).
        let winner = members[0];
        for (const member of members) {
            if (member.index > winner.index) {
                winner = member;
            }
        }
        for (const member of members) {
            if (member.index !== winner.index) {
                removedIdx.add(member.index);
            }
        }
    }

    // --- Assemble results in original order ----------------------------------
    const kept = [];
    const removed = [];
    const undecidable = [];

    for (const entry of indexed) {
        if (removedIdx.has(entry.index)) {
            removed.push(entry.token);
        } else {
            kept.push(entry.token);
            if (undecidableIdx.has(entry.index)) {
                undecidable.push(entry.token);
            }
        }
    }

    return { kept, removed, undecidable };
}

module.exports = {
    resolveConflicts,
    COMPOSABLE_PROPERTIES,
};

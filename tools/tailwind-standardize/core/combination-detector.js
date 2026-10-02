'use strict';

/**
 * Combination Detector for the Tailwind CSS Standardization tool.
 *
 * `detectCombinations(occurrences)` scans a set of class-bearing element
 * occurrences and reports every utility combination that is shared across two
 * or more distinct element locations. Such recurring combinations are the
 * candidates the Component-Class Synthesizer later consolidates into a single
 * `@layer components` class (Req 4.1).
 *
 * Key behaviours:
 *   - Combinations are compared as **order-independent sets** of utilities: the
 *     declaration order of classes on an element is irrelevant, so
 *     `"flex items-center"` and `"items-center flex"` are the same combination.
 *   - Only combinations of **two or more** utilities are considered; a single
 *     utility is never a combination candidate.
 *   - A combination is a candidate only when it appears at **two or more
 *     distinct element locations** (`{ filePath, line, tag }`). Two occurrences
 *     that resolve to the very same locator count as a single location.
 *   - Detection is **deterministic**: utility sets are canonicalized by sorting,
 *     and the returned findings are emitted in a stable, input-independent order.
 *
 * Each input occurrence carries the element's classes plus an `ElementLocator`.
 * Classes may be supplied either as a raw `class` attribute string (the shape
 * produced by the HTML Scanner, `{ value, locator }`) or as a pre-parsed token
 * list. Raw strings are parsed with the shared tokenizer so the detector and
 * the rest of the pipeline agree on what a "utility" is.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see core/models.js).
 *
 * _Requirements: 1.6, 4.1_
 */

const path = require('path');

const { tokenize } = require(path.join(__dirname, 'tokenizer.js'));
const { ElementLocator } = require(path.join(__dirname, 'models.js'));

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Extract the list of utility strings carried by a single occurrence.
 *
 * Accepts, in priority order:
 *   - `occurrence.utilities` : an array of utility strings or ClassToken objects
 *   - `occurrence.tokens`    : an array of ClassToken objects or strings
 *   - a raw class string in `occurrence.value` / `occurrence.classValue` /
 *     `occurrence.class`, parsed via the shared tokenizer
 *
 * Each utility is identified by its exact token text (a token's `raw` field),
 * so variant-prefixed utilities (e.g. `md:hover:bg-primary`) remain distinct
 * from their bare counterparts.
 *
 * @param {object} occurrence
 * @returns {string[]} the utility token strings on the element (may be empty)
 */
function extractUtilities(occurrence) {
    const fromList = (list) =>
        list
            .map((entry) => {
                if (typeof entry === 'string') {
                    return entry;
                }
                if (entry && typeof entry.raw === 'string') {
                    return entry.raw;
                }
                return '';
            })
            .filter((token) => token.length > 0);

    if (Array.isArray(occurrence.utilities)) {
        return fromList(occurrence.utilities);
    }
    if (Array.isArray(occurrence.tokens)) {
        return fromList(occurrence.tokens);
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
    return tokenize(raw).map((token) => token.raw);
}

/**
 * Canonicalize a list of utility strings into an order-independent set: the
 * utilities are de-duplicated and sorted, so any permutation (or repetition) of
 * the same utilities yields an identical canonical form.
 *
 * @param {string[]} utilities
 * @returns {string[]} sorted, de-duplicated utility list
 */
function canonicalizeSet(utilities) {
    return Array.from(new Set(utilities)).sort();
}

/**
 * Build a stable string key for a canonical utility set. A newline separator is
 * used because it cannot appear inside a class token, so the key is unambiguous.
 *
 * @param {string[]} canonicalSet
 * @returns {string}
 */
function setKey(canonicalSet) {
    return canonicalSet.join('\n');
}

/**
 * Build a stable string key for an element locator so that occurrences sharing
 * the same `{ filePath, line, tag }` are treated as one location.
 *
 * @param {{ filePath: string, line: number, tag: string }} locator
 * @returns {string}
 */
function locatorKey(locator) {
    return `${locator.filePath}\u0000${locator.line}\u0000${locator.tag}`;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Detect utility combinations shared across two or more distinct element
 * locations.
 *
 * @param {Array<object>} occurrences
 *   Class-bearing element occurrences. Each must carry a `locator`
 *   (`{ filePath, line, tag }`) and either a raw class string (`value` /
 *   `classValue` / `class`) or a token/utility list (`tokens` / `utilities`).
 * @returns {Array<{ utilitySet: string[], locations: object[] }>}
 *   One `CombinationFinding` per recurring combination. `utilitySet` is the
 *   sorted (order-independent) set of two or more utilities; `locations` lists
 *   every distinct element locator where the combination occurs. The result is
 *   ordered deterministically by the canonical utility set.
 */
function detectCombinations(occurrences) {
    if (!Array.isArray(occurrences)) {
        throw new TypeError('[combination-detector] detectCombinations expects an array of occurrences');
    }

    // Map: canonical-set key -> { utilitySet, locations: Map<locatorKey, locator> }
    const groups = new Map();

    for (const occurrence of occurrences) {
        if (occurrence === null || typeof occurrence !== 'object') {
            throw new TypeError('[combination-detector] each occurrence must be an object');
        }

        const canonicalSet = canonicalizeSet(extractUtilities(occurrence));

        // A combination requires two or more distinct utilities (Req 1.6).
        if (canonicalSet.length < 2) {
            continue;
        }

        // Normalize/validate the locator so every location is well-formed.
        const locator = ElementLocator(occurrence.locator || {});

        const key = setKey(canonicalSet);
        let group = groups.get(key);
        if (group === undefined) {
            group = { utilitySet: canonicalSet, locations: new Map() };
            groups.set(key, group);
        }

        const locKey = locatorKey(locator);
        if (!group.locations.has(locKey)) {
            group.locations.set(locKey, locator);
        }
    }

    const findings = [];
    for (const group of groups.values()) {
        // A combination is only a candidate when it appears at two or more
        // distinct locations (Req 1.6, 4.1).
        if (group.locations.size < 2) {
            continue;
        }
        findings.push({
            utilitySet: group.utilitySet,
            locations: Array.from(group.locations.values()),
        });
    }

    // Deterministic, input-order-independent output: sort by the canonical set.
    findings.sort((a, b) => {
        const ka = setKey(a.utilitySet);
        const kb = setKey(b.utilitySet);
        return ka < kb ? -1 : ka > kb ? 1 : 0;
    });

    return findings;
}

module.exports = {
    detectCombinations,
};

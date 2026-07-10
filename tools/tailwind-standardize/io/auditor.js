'use strict';

/**
 * Auditor orchestration (I/O shell) for the Tailwind CSS Standardization tool.
 *
 * The Auditor is the read-only detection stage of the Standardization_Tool. It
 * is the I/O shell that drives the pure core: given a resolved scope (from
 * `io/scope-resolver.js` `resolveScope`) or an explicit list of file paths, it
 * reads each Root_HTML_Set file from disk exactly once, scans it with the pure
 * `core/scanner.js`, and records every non-conforming Tailwind usage as an
 * `AuditFinding` (via the `core/models.js` factories).
 *
 * Detected finding categories (Req 1.3-1.7):
 *   - arbitrary-value       : class tokens using bracket-notation literals
 *                             (`token.isArbitrary`).
 *   - physical-direction    : left/right inline-axis utilities mappable to a
 *                             logical equivalent (`core/direction-mapper.js`
 *                             `PHYSICAL_TO_LOGICAL` keys).
 *   - inline-style          : `style="..."` attributes / `<style>` blocks
 *                             surfaced by the scanner.
 *   - duplicate-combination : utility sets shared across >= 2 element locations
 *                             (`core/combination-detector.js`).
 *   - conflict-override     : two utilities setting the same CSS property under
 *                             the same variant+breakpoint context
 *                             (`core/conflict-resolver.js`); the finding detail
 *                             names the specific conflicting utilities (Req 1.7).
 *
 * Findings are grouped by directory with per-category counts; the count and
 * total aggregation is delegated to the `AuditRecord` factory, which derives
 * counts from the findings so the aggregation is sound by construction
 * (per-directory per-category counts sum to the totals - Req 1.8). Files that
 * cannot be read or parsed are recorded as skipped (with a reason) and the
 * audit continues over the remaining files (Req 1.2). When zero findings are
 * detected the resulting record's `noFindings` is `true` (Req 1.9).
 *
 * This module performs read-only file system access (it reads file text); it
 * never edits or writes anything. CommonJS + Node built-ins to match existing
 * project conventions.
 *
 * _Requirements: 1.1, 1.2, 1.7, 1.8, 1.9_
 */

const fs = require('fs');
const path = require('path');

const { scan } = require(path.join(__dirname, '..', 'core', 'scanner.js'));
const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { detectCombinations } = require(path.join(__dirname, '..', 'core', 'combination-detector.js'));
const { resolveConflicts } = require(path.join(__dirname, '..', 'core', 'conflict-resolver.js'));
const { PHYSICAL_TO_LOGICAL } = require(path.join(__dirname, '..', 'core', 'direction-mapper.js'));
const { FindingCategory, AuditRecord } = require(path.join(__dirname, '..', 'core', 'models.js'));

// Match the longest physical prefixes first so specific utilities (e.g.
// `border-l-`) win over any shorter overlap when classifying a token.
const SORTED_PHYSICAL_PREFIXES = Array.from(PHYSICAL_TO_LOGICAL.keys()).sort(
    (a, b) => b.length - a.length
);

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Normalize the audit input into a concrete list of file paths plus a base
 * directory used to compute stable, relative `byDirectory` keys.
 *
 * Accepts either:
 *   - a resolved scope object `{ rootHtmlSet, configSource, ... }`, or
 *   - an array of file path strings.
 *
 * @param {object|string[]} scopeOrPaths
 * @param {{ baseDir?: string }} [options]
 * @returns {{ filePaths: string[], baseDir: string }}
 */
function normalizeInput(scopeOrPaths, options) {
    let filePaths;
    let baseDir = options && typeof options.baseDir === 'string' ? options.baseDir : null;

    if (Array.isArray(scopeOrPaths)) {
        filePaths = scopeOrPaths.slice();
    } else if (scopeOrPaths && typeof scopeOrPaths === 'object' && Array.isArray(scopeOrPaths.rootHtmlSet)) {
        filePaths = scopeOrPaths.rootHtmlSet.slice();
        // Derive the workspace root from the Config_Source (root/css/<file>) so
        // root HTML files group under '.' relative to the workspace.
        if (baseDir === null && typeof scopeOrPaths.configSource === 'string') {
            baseDir = path.dirname(path.dirname(scopeOrPaths.configSource));
        }
    } else {
        throw new TypeError(
            '[auditor] audit expects a resolved scope (with rootHtmlSet) or an array of file paths'
        );
    }

    filePaths = filePaths.filter((p) => typeof p === 'string' && p.length > 0);

    if (baseDir === null) {
        // Fall back to the common parent directory of the inputs (or the single
        // file's directory) so directory keys remain meaningful.
        const dirs = filePaths.map((p) => path.dirname(path.resolve(p)));
        baseDir = dirs.length > 0 ? dirs[0] : process.cwd();
    }

    return { filePaths, baseDir };
}

/**
 * Visit each file path exactly once, preserving first-seen order (Req 1.1).
 * @param {string[]} filePaths
 * @returns {string[]}
 */
function uniqueInOrder(filePaths) {
    const seen = new Set();
    const out = [];
    for (const p of filePaths) {
        const resolved = path.resolve(p);
        if (!seen.has(resolved)) {
            seen.add(resolved);
            out.push(p);
        }
    }
    return out;
}

/**
 * Compute the stable, POSIX-separated relative directory key for a file.
 * Files directly under the base directory map to '.'.
 * @param {string} baseDir
 * @param {string} filePath
 * @returns {string}
 */
function directoryKey(baseDir, filePath) {
    const rel = path.relative(path.resolve(baseDir), path.dirname(path.resolve(filePath)));
    if (rel === '' ) {
        return '.';
    }
    return rel.split(path.sep).join('/');
}

/**
 * True when a class token is a left/right inline-axis Physical_Direction_Utility
 * that has a logical equivalent (so it is a normalization target). A leading
 * negative sign is ignored for the prefix check.
 * @param {object} token ClassToken
 * @returns {boolean}
 */
function isPhysicalDirectionToken(token) {
    if (!token || typeof token.base !== 'string') {
        return false;
    }
    const body = token.base.startsWith('-') ? token.base.slice(1) : token.base;
    for (const prefix of SORTED_PHYSICAL_PREFIXES) {
        if (body.startsWith(prefix)) {
            return true;
        }
    }
    return false;
}

/**
 * Build a stable variant-context key for a token so utilities under different
 * variant/breakpoint contexts are never treated as conflicting (mirrors the
 * conflict resolver's context rule - Req 6.2 / 1.7).
 * @param {object} token ClassToken
 * @returns {string}
 */
function contextKey(token) {
    const variants = Array.isArray(token.variants) ? token.variants.slice() : [];
    const unique = Array.from(new Set(variants)).sort();
    return `r=${token.responsiveVariant || ''}|s=${token.stateVariant || ''}|v=${unique.join(',')}`;
}

/**
 * Identify the concrete groups of conflicting/overriding utilities within a
 * single element's token list so the finding detail can name the specific
 * conflicting classes (Req 1.7).
 *
 * The conflict resolver decides *whether* a conflict exists (any removed or
 * undecidable token); here we reconstruct the full set of utilities involved in
 * each same-context, same-property group of two or more utilities so the audit
 * detail is precise.
 *
 * @param {object[]} tokens ClassToken[]
 * @returns {Array<{ property: string, utilities: string[] }>}
 */
function detectConflictGroups(tokens) {
    const { removed, undecidable } = resolveConflicts(tokens);
    if (removed.length === 0 && undecidable.length === 0) {
        return [];
    }

    // Reconstruct same-context + same-property groups of size >= 2.
    const groups = new Map();
    for (const token of tokens) {
        if (token.property === null || token.property === undefined) {
            continue;
        }
        const key = `${contextKey(token)}||${token.property}`;
        if (!groups.has(key)) {
            groups.set(key, { property: token.property, utilities: [] });
        }
        groups.get(key).utilities.push(token.raw);
    }

    const conflictGroups = [];
    for (const group of groups.values()) {
        if (group.utilities.length >= 2) {
            conflictGroups.push(group);
        }
    }
    return conflictGroups;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Audit the Root_HTML_Set (or an explicit file list) for non-conforming
 * Tailwind usage and return an `AuditRecord`.
 *
 * @param {object|string[]} scopeOrPaths
 *   A resolved scope (`{ rootHtmlSet, configSource, ... }`) or an array of file
 *   path strings.
 * @param {{ baseDir?: string }} [options]
 *   Optional base directory used to compute relative `byDirectory` keys. When
 *   omitted it is derived from the scope's `configSource` or the inputs.
 * @returns {object} a frozen `AuditRecord` (see core/models.js).
 * @see Requirements 1.1, 1.2, 1.7, 1.8, 1.9
 */
function audit(scopeOrPaths, options = {}) {
    const { filePaths, baseDir } = normalizeInput(scopeOrPaths, options);
    const files = uniqueInOrder(filePaths);

    // Findings accumulate per directory key; counts/totals are derived later by
    // the AuditRecord factory to keep aggregation sound (Req 1.8).
    const findingsByDir = new Map();
    const skippedFiles = [];

    const addFinding = (dirKey, finding) => {
        if (!findingsByDir.has(dirKey)) {
            findingsByDir.set(dirKey, []);
        }
        findingsByDir.get(dirKey).push(finding);
    };

    // Collected across ALL files so duplicate combinations spanning files are
    // detected once over the whole set (Req 1.6).
    const allClassOccurrences = [];

    for (const filePath of files) {
        const dirKey = directoryKey(baseDir, filePath);

        let fileText;
        try {
            fileText = fs.readFileSync(filePath, 'utf8');
        } catch (err) {
            skippedFiles.push({
                filePath,
                reason: `read failure: ${err.message}`,
            });
            continue; // Req 1.2: continue scanning the remaining files.
        }

        let scanResult;
        try {
            scanResult = scan(fileText, filePath);
        } catch (err) {
            skippedFiles.push({
                filePath,
                reason: `parse failure: ${err.message}`,
            });
            continue; // Req 1.2.
        }

        // --- class-bearing elements: arbitrary, physical, conflict + collect ---
        for (const occ of scanResult.classOccurrences) {
            let tokens;
            try {
                tokens = tokenize(occ.value);
            } catch (err) {
                // A class attribute we cannot tokenize is treated as a per-file
                // parse issue but should not abort the whole file's audit; record
                // the file as skipped and stop processing it.
                skippedFiles.push({
                    filePath,
                    reason: `class tokenization failure at line ${occ.locator.line}: ${err.message}`,
                });
                tokens = null;
            }
            if (tokens === null) {
                continue;
            }

            // Arbitrary-value findings (Req 1.3).
            for (const token of tokens) {
                if (token.isArbitrary) {
                    addFinding(dirKey, {
                        category: FindingCategory.ARBITRARY_VALUE,
                        locator: occ.locator,
                        detail: `${token.raw} (arbitrary value: ${token.arbitraryValue})`,
                    });
                }
            }

            // Physical-direction findings (Req 1.4).
            for (const token of tokens) {
                if (isPhysicalDirectionToken(token)) {
                    addFinding(dirKey, {
                        category: FindingCategory.PHYSICAL_DIRECTION,
                        locator: occ.locator,
                        detail: `${token.raw} (physical-direction utility)`,
                    });
                }
            }

            // Conflict/override findings (Req 1.7) - name the conflicting set.
            for (const group of detectConflictGroups(tokens)) {
                addFinding(dirKey, {
                    category: FindingCategory.CONFLICT_OVERRIDE,
                    locator: occ.locator,
                    detail: `conflicting utilities for '${group.property}': ${group.utilities.join(', ')}`,
                });
            }

            // Collect for cross-file duplicate-combination detection (Req 1.6).
            allClassOccurrences.push({ value: occ.value, locator: occ.locator });
        }

        // --- inline styles + <style> blocks (Req 1.5) ---
        for (const inline of scanResult.inlineStyles) {
            addFinding(dirKey, {
                category: FindingCategory.INLINE_STYLE,
                locator: inline.locator,
                detail: `style="${inline.value}"${inline.dynamic ? ' (dynamic)' : ''}`,
            });
        }
        for (const block of scanResult.styleBlocks) {
            addFinding(dirKey, {
                category: FindingCategory.INLINE_STYLE,
                locator: block.locator,
                detail: '<style> block',
            });
        }
    }

    // --- duplicate combinations across all scanned files (Req 1.6) ---
    // One finding is emitted per location of each recurring combination so the
    // finding can be attributed to the directory in which that location lives,
    // keeping per-directory aggregation sound (Req 1.8).
    for (const combination of detectCombinations(allClassOccurrences)) {
        const utilityList = combination.utilitySet.join(' ');
        const locationCount = combination.locations.length;
        for (const locator of combination.locations) {
            const dirKey = directoryKey(baseDir, locator.filePath);
            addFinding(dirKey, {
                category: FindingCategory.DUPLICATE_COMBINATION,
                locator,
                detail: `combination [${utilityList}] appears at ${locationCount} locations`,
            });
        }
    }

    // Build the byDirectory input for the AuditRecord factory; the factory
    // derives per-category counts and totals from the findings themselves.
    const byDirectory = {};
    for (const [dirKey, findings] of findingsByDir) {
        byDirectory[dirKey] = { findings };
    }

    // The factory sets noFindings = true when no findings exist (Req 1.9) and
    // validates that per-directory counts sum to the totals (Req 1.8).
    return AuditRecord({ byDirectory, skippedFiles });
}

module.exports = {
    audit,
};

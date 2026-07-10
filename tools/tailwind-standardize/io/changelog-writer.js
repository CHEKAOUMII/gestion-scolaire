'use strict';

/**
 * Changelog Writer (I/O shell) for the Tailwind CSS Standardization tool.
 *
 * Produces the single deliverable changelog that lets a reviewer trace every
 * normalization change. It is split into:
 *
 *   - `buildChangelog(input)` — a *pure* function that assembles a validated
 *     `Changelog` model from the accumulated refactor results. It guarantees
 *     every processed directory is present (with a count of 0 where nothing
 *     changed, Req 13.2), folds change records into per-directory/per-category
 *     counts drawn only from the predefined `NormalizationCategory` set
 *     (Req 13.3), and carries the new tokens (Req 13.4), new component classes
 *     (Req 13.5), manual-review/excluded items (Req 13.6), and the mirror
 *     exclusion file count (Req 12.3).
 *   - `renderChangelog(changelog)` — a *pure* function that renders the model
 *     to a deterministic Markdown document.
 *   - `writeChangelog(targetPath, changelog)` — the only side-effecting export.
 *     It renders and writes the document. On any write failure it leaves the
 *     refactored files untouched and returns a `changelog-not-generated` error
 *     result instead of throwing (Req 13.7).
 *
 * CommonJS + Node built-ins (fs, path) to match existing project conventions.
 *
 * _Requirements: 12.3, 13.1, 13.2, 13.3, 13.4, 13.5, 13.6, 13.7_
 */

const fs = require('fs');
const path = require('path');

const {
    Changelog,
    NORMALIZATION_CATEGORIES,
    NormalizationCategory,
} = require('../core/models');

/**
 * Error raised when the changelog cannot be produced/written. The Refactorer
 * uses this signal to retain all refactored files unchanged (Req 13.7).
 */
class ChangelogNotGeneratedError extends Error {
    constructor(message, cause) {
        super(message);
        this.name = 'ChangelogNotGeneratedError';
        this.code = 'CHANGELOG_NOT_GENERATED';
        this.cause = cause || null;
    }
}

/**
 * Derive a directory key for a change record. Prefers an explicit `directory`
 * field; otherwise falls back to the POSIX directory name of `filePath` so the
 * key is stable across platforms. The workspace root maps to '.'.
 * @param {{ directory?: string, filePath?: string }} record
 * @returns {string}
 */
function deriveDirectory(record) {
    if (typeof record.directory === 'string' && record.directory.length > 0) {
        return record.directory;
    }
    if (typeof record.filePath === 'string' && record.filePath.length > 0) {
        const normalized = record.filePath.replace(/\\/g, '/');
        const dir = path.posix.dirname(normalized);
        return dir === '' ? '.' : dir;
    }
    throw new TypeError('[changelog-writer] change record requires a directory or filePath');
}

/**
 * Assemble a validated `Changelog` from accumulated refactor results.
 *
 * Pure: performs no file system access. The returned value is the frozen
 * `Changelog` model, so callers get the model's validation guarantees for free
 * (categories restricted to the predefined set, non-negative counts, etc.).
 *
 * @param {{
 *   processedDirectories?: string[],   // every directory visited (incl. zero-change)
 *   changeRecords?: Array<{ directory?: string, filePath?: string, category: string }>,
 *   newTokens?: Array<{ name: string, value: string, origin: string }>,
 *   newComponentClasses?: Array<{ name: string, declaration: string, origin: string }>,
 *   reviewItems?: Array<object>,       // ReviewItem-shaped inputs
 *   mirrorExclusion?: { excludedFileCount: number }, // Req 12.3
 * }} [input]
 * @returns {object} frozen Changelog model
 * @see Requirements 12.3, 13.2, 13.3, 13.4, 13.5, 13.6
 */
function buildChangelog({
    processedDirectories = [],
    changeRecords = [],
    newTokens = [],
    newComponentClasses = [],
    reviewItems = [],
    mirrorExclusion = { excludedFileCount: 0 },
} = {}) {
    if (!Array.isArray(processedDirectories)) {
        throw new TypeError('[changelog-writer] processedDirectories must be an array');
    }
    if (!Array.isArray(changeRecords)) {
        throw new TypeError('[changelog-writer] changeRecords must be an array');
    }

    // Seed every processed directory so it appears with a count of 0 when
    // nothing changed there (Req 13.2). The model fills in any categories we
    // do not explicitly set with zeros.
    const byDirectory = {};
    for (const dir of processedDirectories) {
        if (typeof dir !== 'string' || dir.length === 0) {
            throw new TypeError('[changelog-writer] each processed directory must be a non-empty string');
        }
        if (!byDirectory[dir]) {
            byDirectory[dir] = { changeCounts: {} };
        }
    }

    // Fold each applied change into its directory's per-category tally. Counts
    // use only the predefined NormalizationCategory values (Req 13.3); the
    // Changelog model rejects any out-of-set category.
    for (const record of changeRecords) {
        if (!record || typeof record !== 'object') {
            throw new TypeError('[changelog-writer] each change record must be an object');
        }
        const dir = deriveDirectory(record);
        if (!byDirectory[dir]) {
            byDirectory[dir] = { changeCounts: {} };
        }
        const counts = byDirectory[dir].changeCounts;
        counts[record.category] = (counts[record.category] || 0) + 1;
    }

    // The Changelog factory validates tokens, classes, review items, and the
    // mirror-exclusion count, and freezes the result.
    return Changelog({
        byDirectory,
        newTokens,
        newComponentClasses,
        reviewItems,
        mirrorExclusion,
    });
}

/**
 * Render a `Changelog` model to a deterministic Markdown document.
 *
 * Pure: no file system access. Directory keys, tokens, classes, and review
 * items are emitted in a stable sorted order so repeated runs over the same
 * data produce byte-identical output.
 *
 * @param {object} changelog a Changelog model (frozen) or a Changelog-shaped object
 * @returns {string} the Markdown document
 * @see Requirements 12.3, 13.2, 13.3, 13.4, 13.5, 13.6
 */
function renderChangelog(changelog) {
    // Re-validate/normalize so renderChangelog is robust to raw input too.
    const model = Object.isFrozen(changelog) ? changelog : Changelog(changelog || {});

    const lines = [];
    lines.push('# Tailwind CSS Standardization Changelog');
    lines.push('');

    // --- Mirror exclusion (Req 12.3) ------------------------------------
    lines.push('## Mirror Subtree Exclusion');
    lines.push('');
    lines.push(
        `Excluded ${model.mirrorExclusion.excludedFileCount} file(s) under the mirror subtree from all refactoring.`
    );
    lines.push('');

    // --- Per-directory change counts (Req 13.2, 13.3) -------------------
    lines.push('## Changes by Directory');
    lines.push('');
    const dirKeys = Object.keys(model.byDirectory).sort();
    if (dirKeys.length === 0) {
        lines.push('_No directories were processed._');
        lines.push('');
    } else {
        for (const dir of dirKeys) {
            const counts = model.byDirectory[dir].changeCounts;
            const total = NORMALIZATION_CATEGORIES.reduce(
                (sum, category) => sum + (counts[category] || 0),
                0
            );
            lines.push(`### ${dir} (${total} change${total === 1 ? '' : 's'})`);
            if (total === 0) {
                // Directory recorded with a count of 0 rather than omitted (Req 13.2).
                lines.push('');
                lines.push('- No changes');
                lines.push('');
                continue;
            }
            lines.push('');
            for (const category of NORMALIZATION_CATEGORIES) {
                const count = counts[category] || 0;
                if (count > 0) {
                    lines.push(`- ${category}: ${count}`);
                }
            }
            lines.push('');
        }
    }

    // --- New design tokens (Req 13.4) -----------------------------------
    lines.push('## New Design Tokens');
    lines.push('');
    if (model.newTokens.length === 0) {
        lines.push('_None._');
        lines.push('');
    } else {
        const tokens = [...model.newTokens].sort((a, b) => a.name.localeCompare(b.name));
        for (const token of tokens) {
            lines.push(`- \`${token.name}\`: \`${token.value}\` (origin: ${token.origin})`);
        }
        lines.push('');
    }

    // --- New component classes (Req 13.5) -------------------------------
    lines.push('## New Component Classes');
    lines.push('');
    if (model.newComponentClasses.length === 0) {
        lines.push('_None._');
        lines.push('');
    } else {
        const classes = [...model.newComponentClasses].sort((a, b) => a.name.localeCompare(b.name));
        for (const cls of classes) {
            lines.push(`- \`${cls.name}\` (origin: ${cls.origin})`);
        }
        lines.push('');
    }

    // --- Manual-review / excluded items (Req 13.6) ----------------------
    lines.push('## Manual-Review and Excluded Items');
    lines.push('');
    if (model.reviewItems.length === 0) {
        lines.push('_None._');
        lines.push('');
    } else {
        const items = [...model.reviewItems].sort((a, b) => {
            const aKey = `${a.classification}|${a.reasonCategory}|${a.locator.filePath}|${a.locator.line}`;
            const bKey = `${b.classification}|${b.reasonCategory}|${b.locator.filePath}|${b.locator.line}`;
            return aKey.localeCompare(bKey);
        });
        for (const item of items) {
            const where = `${item.locator.filePath}:${item.locator.line} <${item.locator.tag}>`;
            const detail = item.detail ? ` — ${item.detail}` : '';
            lines.push(`- [${item.classification}] (${item.reasonCategory}) ${where}${detail}`);
        }
        lines.push('');
    }

    return lines.join('\n');
}

/**
 * Render and write the changelog to disk.
 *
 * On success returns `{ ok: true, path, content }`. On any write failure this
 * does NOT throw: it returns `{ ok: false, error }` carrying a
 * `ChangelogNotGeneratedError`, so the caller can retain all refactored files
 * unchanged and surface the changelog-not-generated condition (Req 13.7).
 *
 * @param {string} targetPath absolute path for the changelog file
 * @param {object} changelog a Changelog model (or Changelog-shaped object)
 * @returns {{ ok: true, path: string, content: string }
 *          | { ok: false, error: ChangelogNotGeneratedError }}
 * @see Requirement 13.7
 */
function writeChangelog(targetPath, changelog) {
    if (typeof targetPath !== 'string' || targetPath.length === 0) {
        return {
            ok: false,
            error: new ChangelogNotGeneratedError(
                '[changelog-writer] targetPath must be a non-empty string'
            ),
        };
    }

    let content;
    try {
        content = renderChangelog(changelog);
    } catch (err) {
        // A malformed changelog model means we cannot produce the document.
        return {
            ok: false,
            error: new ChangelogNotGeneratedError(
                `Changelog could not be rendered: ${err.message}`,
                err
            ),
        };
    }

    try {
        const dir = path.dirname(path.resolve(targetPath));
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, content, 'utf8');
    } catch (err) {
        // Write failure: retain refactored files unchanged and report that the
        // changelog was not generated (Req 13.7).
        return {
            ok: false,
            error: new ChangelogNotGeneratedError(
                `Changelog could not be written to '${targetPath}': ${err.message}`,
                err
            ),
        };
    }

    return { ok: true, path: path.resolve(targetPath), content };
}

module.exports = {
    buildChangelog,
    renderChangelog,
    writeChangelog,
    ChangelogNotGeneratedError,
    // Re-export for callers assembling change records.
    NormalizationCategory,
};

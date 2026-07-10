'use strict';

/**
 * Core data models for the Tailwind CSS Standardization tool.
 *
 * This module is the single source of truth for the tool's data shapes. It
 * exposes:
 *   - Frozen enums (FindingCategory, NormalizationCategory, ReviewClassification,
 *     ReviewReasonCategory) used across the Auditor, Refactorer, and Changelog.
 *   - Factory/validator functions that construct well-formed records and reject
 *     malformed input early, so downstream pure transforms can trust their input.
 *
 * The module is pure (no file system or process access) and uses CommonJS to
 * match the existing project conventions (see tests/smoke.js).
 *
 * _Requirements: 13.3_
 */

// ---------------------------------------------------------------------------
// Enums (frozen single sources of truth)
// ---------------------------------------------------------------------------

/**
 * Categories of non-conforming usage the Auditor can detect.
 * @see Requirements 1.3, 1.4, 1.5, 1.6, 1.7
 */
const FindingCategory = Object.freeze({
    ARBITRARY_VALUE: 'arbitrary-value',
    PHYSICAL_DIRECTION: 'physical-direction',
    INLINE_STYLE: 'inline-style',
    DUPLICATE_COMBINATION: 'duplicate-combination',
    CONFLICT_OVERRIDE: 'conflict-override',
});

/** Ordered, frozen list of valid finding category values. */
const FINDING_CATEGORIES = Object.freeze(Object.values(FindingCategory));

/**
 * The predefined set of normalization categories the changelog supports.
 * This is the single source of truth referenced by ChangeRecord and Changelog.
 * @see Requirement 13.3
 */
const NormalizationCategory = Object.freeze({
    ARBITRARY_TO_TOKEN: 'arbitrary-to-token',
    MAGIC_NUMBER_TO_SCALE: 'magic-number-to-scale',
    COMBINATION_TO_COMPONENT: 'combination-to-component',
    UTILITY_ORDERING: 'utility-ordering',
    CONFLICT_REMOVAL: 'conflict-removal',
    INLINE_STYLE_ELIMINATION: 'inline-style-elimination',
    PHYSICAL_TO_LOGICAL: 'physical-to-logical',
    VARIANT_NORMALIZATION: 'variant-normalization',
    CARRY_FORWARD_REEXPRESSION: 'carry-forward-reexpression',
});

/** Ordered, frozen list of valid normalization category values. */
const NORMALIZATION_CATEGORIES = Object.freeze(Object.values(NormalizationCategory));

/**
 * How a retained item is classified in the changelog.
 * @see Requirement 13.6
 */
const ReviewClassification = Object.freeze({
    MANUAL_REVIEW: 'manual-review',
    EXCLUDED: 'excluded',
});

/** Ordered, frozen list of valid review classification values. */
const REVIEW_CLASSIFICATIONS = Object.freeze(Object.values(ReviewClassification));

/**
 * The predefined set of reason categories for manual-review/excluded items.
 * This is the single source of truth referenced by ReviewItem and Changelog.
 * @see Requirement 13.6
 */
const ReviewReasonCategory = Object.freeze({
    NO_TOKEN_AND_RARE: 'no-token-and-rare',
    NAME_COLLISION: 'name-collision',
    OUTPUT_WOULD_CHANGE: 'output-would-change',
    DYNAMIC_INLINE_STYLE: 'dynamic-inline-style',
    NOT_EXPRESSIBLE: 'not-expressible',
    ARBITRARY_BREAKPOINT: 'arbitrary-breakpoint',
    DIRECTION_INDEPENDENT_EFFECT: 'direction-independent-effect',
    NO_LOGICAL_EQUIVALENT: 'no-logical-equivalent',
    UNDECIDABLE_CONFLICT: 'undecidable-conflict',
});

/** Ordered, frozen list of valid review reason category values. */
const REVIEW_REASON_CATEGORIES = Object.freeze(Object.values(ReviewReasonCategory));

// ---------------------------------------------------------------------------
// Internal validation helpers
// ---------------------------------------------------------------------------

function fail(message) {
    throw new TypeError(`[models] ${message}`);
}

function requireString(value, label) {
    if (typeof value !== 'string') {
        fail(`${label} must be a string, received ${typeof value}`);
    }
    return value;
}

function requireNonEmptyString(value, label) {
    requireString(value, label);
    if (value.length === 0) {
        fail(`${label} must be a non-empty string`);
    }
    return value;
}

function requireInteger(value, label) {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
        fail(`${label} must be an integer, received ${String(value)}`);
    }
    return value;
}

function requireOneOf(value, allowed, label) {
    if (!allowed.includes(value)) {
        fail(`${label} must be one of [${allowed.join(', ')}], received ${String(value)}`);
    }
    return value;
}

function requireArray(value, label) {
    if (!Array.isArray(value)) {
        fail(`${label} must be an array`);
    }
    return value;
}

function requireObject(value, label) {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) {
        fail(`${label} must be a plain object`);
    }
    return value;
}

// ---------------------------------------------------------------------------
// Factories / validators
// ---------------------------------------------------------------------------

/**
 * ElementLocator uniquely identifies where an occurrence appears.
 * @see Requirements 1.3-1.7
 * @param {{ filePath: string, line: number, tag: string }} input
 * @returns {{ filePath: string, line: number, tag: string }}
 */
function ElementLocator({ filePath, line, tag } = {}) {
    requireNonEmptyString(filePath, 'ElementLocator.filePath');
    requireInteger(line, 'ElementLocator.line');
    if (line < 1) {
        fail('ElementLocator.line must be >= 1');
    }
    requireNonEmptyString(tag, 'ElementLocator.tag');
    return Object.freeze({ filePath, line, tag });
}

/**
 * AuditFinding is a single detected non-conforming occurrence.
 * @param {{ category: string, locator: object, detail: string }} input
 */
function AuditFinding({ category, locator, detail } = {}) {
    requireOneOf(category, FINDING_CATEGORIES, 'AuditFinding.category');
    const normalizedLocator = ElementLocator(locator || {});
    requireString(detail, 'AuditFinding.detail');
    return Object.freeze({ category, locator: normalizedLocator, detail });
}

/**
 * SkippedFile records a file that could not be read or parsed.
 * @see Requirement 1.2
 * @param {{ filePath: string, reason: string }} input
 */
function SkippedFile({ filePath, reason } = {}) {
    requireNonEmptyString(filePath, 'SkippedFile.filePath');
    requireNonEmptyString(reason, 'SkippedFile.reason');
    return Object.freeze({ filePath, reason });
}

/**
 * Build a zero-initialized per-category count map for findings.
 * @returns {Record<string, number>}
 */
function emptyFindingCounts() {
    const counts = {};
    for (const category of FINDING_CATEGORIES) {
        counts[category] = 0;
    }
    return counts;
}

/**
 * AuditRecord groups all findings by directory with per-category counts.
 * @see Requirements 1.8, 1.9
 * @param {{
 *   byDirectory?: object,
 *   skippedFiles?: object[],
 *   totalFindings?: number,
 *   noFindings?: boolean
 * }} [input]
 */
function AuditRecord({ byDirectory = {}, skippedFiles = [], totalFindings, noFindings } = {}) {
    requireObject(byDirectory, 'AuditRecord.byDirectory');
    requireArray(skippedFiles, 'AuditRecord.skippedFiles');

    const normalizedByDirectory = {};
    let computedTotal = 0;

    for (const [dirRelPath, group] of Object.entries(byDirectory)) {
        requireObject(group, `AuditRecord.byDirectory['${dirRelPath}']`);
        const findings = requireArray(group.findings || [], `byDirectory['${dirRelPath}'].findings`).map(
            (finding) => AuditFinding(finding)
        );

        // Derive counts from findings to keep aggregation sound (Req 1.8).
        const counts = emptyFindingCounts();
        for (const finding of findings) {
            counts[finding.category] += 1;
            computedTotal += 1;
        }

        normalizedByDirectory[dirRelPath] = Object.freeze({
            findings: Object.freeze(findings),
            counts: Object.freeze(counts),
        });
    }

    const normalizedSkipped = skippedFiles.map((file) => SkippedFile(file));

    const resolvedTotal = totalFindings === undefined ? computedTotal : requireInteger(totalFindings, 'AuditRecord.totalFindings');
    if (totalFindings !== undefined && totalFindings !== computedTotal) {
        fail(`AuditRecord.totalFindings (${totalFindings}) does not match summed findings (${computedTotal})`);
    }

    const resolvedNoFindings = noFindings === undefined ? resolvedTotal === 0 : Boolean(noFindings);
    if (noFindings === true && resolvedTotal !== 0) {
        fail('AuditRecord.noFindings cannot be true when findings are present');
    }

    return Object.freeze({
        byDirectory: Object.freeze(normalizedByDirectory),
        skippedFiles: Object.freeze(normalizedSkipped),
        totalFindings: resolvedTotal,
        noFindings: resolvedNoFindings,
    });
}

/**
 * ChangeRecord describes a single applied normalization.
 * @param {{ filePath: string, category: string, locator: object }} input
 */
function ChangeRecord({ filePath, category, locator } = {}) {
    requireNonEmptyString(filePath, 'ChangeRecord.filePath');
    requireOneOf(category, NORMALIZATION_CATEGORIES, 'ChangeRecord.category');
    const normalizedLocator = ElementLocator(locator || {});
    return Object.freeze({ filePath, category, locator: normalizedLocator });
}

/**
 * TokenDefinition is a new Design_Token added to the Theme_Block.
 * @see Requirement 13.4
 * @param {{ name: string, value: string, origin: string }} input
 */
function TokenDefinition({ name, value, origin } = {}) {
    requireNonEmptyString(name, 'TokenDefinition.name');
    requireString(value, 'TokenDefinition.value');
    requireNonEmptyString(origin, 'TokenDefinition.origin');
    return Object.freeze({ name, value, origin });
}

/**
 * ComponentClassDefinition is a new class added to the Component_Layer.
 * @see Requirement 13.5
 * @param {{ name: string, declaration: string, origin: string }} input
 */
function ComponentClassDefinition({ name, declaration, origin } = {}) {
    requireNonEmptyString(name, 'ComponentClassDefinition.name');
    requireString(declaration, 'ComponentClassDefinition.declaration');
    requireNonEmptyString(origin, 'ComponentClassDefinition.origin');
    return Object.freeze({ name, declaration, origin });
}

/**
 * ReviewItem records a manual-review or excluded item.
 * @see Requirement 13.6
 * @param {{
 *   classification: string,
 *   reasonCategory: string,
 *   locator: object,
 *   detail: string
 * }} input
 */
function ReviewItem({ classification, reasonCategory, locator, detail } = {}) {
    requireOneOf(classification, REVIEW_CLASSIFICATIONS, 'ReviewItem.classification');
    requireOneOf(reasonCategory, REVIEW_REASON_CATEGORIES, 'ReviewItem.reasonCategory');
    const normalizedLocator = ElementLocator(locator || {});
    requireString(detail, 'ReviewItem.detail');
    return Object.freeze({ classification, reasonCategory, locator: normalizedLocator, detail });
}

/**
 * Build a zero-initialized per-category change-count map.
 * @returns {Record<string, number>}
 */
function emptyChangeCounts() {
    const counts = {};
    for (const category of NORMALIZATION_CATEGORIES) {
        counts[category] = 0;
    }
    return counts;
}

/**
 * Changelog is the single deliverable record of normalization work.
 * @see Requirements 12.3, 13.1-13.6
 * @param {{
 *   byDirectory?: object,
 *   newTokens?: object[],
 *   newComponentClasses?: object[],
 *   reviewItems?: object[],
 *   mirrorExclusion?: { excludedFileCount: number }
 * }} [input]
 */
function Changelog({
    byDirectory = {},
    newTokens = [],
    newComponentClasses = [],
    reviewItems = [],
    mirrorExclusion = { excludedFileCount: 0 },
} = {}) {
    requireObject(byDirectory, 'Changelog.byDirectory');
    requireArray(newTokens, 'Changelog.newTokens');
    requireArray(newComponentClasses, 'Changelog.newComponentClasses');
    requireArray(reviewItems, 'Changelog.reviewItems');
    requireObject(mirrorExclusion, 'Changelog.mirrorExclusion');
    requireInteger(mirrorExclusion.excludedFileCount, 'Changelog.mirrorExclusion.excludedFileCount');
    if (mirrorExclusion.excludedFileCount < 0) {
        fail('Changelog.mirrorExclusion.excludedFileCount must be >= 0');
    }

    const normalizedByDirectory = {};
    for (const [dirRelPath, group] of Object.entries(byDirectory)) {
        requireObject(group, `Changelog.byDirectory['${dirRelPath}']`);
        const provided = group.changeCounts || {};
        requireObject(provided, `Changelog.byDirectory['${dirRelPath}'].changeCounts`);

        // Every processed directory is always present, even with all-zero counts (Req 13.2).
        const changeCounts = emptyChangeCounts();
        for (const [category, count] of Object.entries(provided)) {
            requireOneOf(category, NORMALIZATION_CATEGORIES, `changeCounts category for '${dirRelPath}'`);
            requireInteger(count, `changeCounts['${category}'] for '${dirRelPath}'`);
            if (count < 0) {
                fail(`Changelog change count for '${category}' must be >= 0`);
            }
            changeCounts[category] = count;
        }
        normalizedByDirectory[dirRelPath] = Object.freeze({ changeCounts: Object.freeze(changeCounts) });
    }

    return Object.freeze({
        byDirectory: Object.freeze(normalizedByDirectory),
        newTokens: Object.freeze(newTokens.map((token) => TokenDefinition(token))),
        newComponentClasses: Object.freeze(newComponentClasses.map((cls) => ComponentClassDefinition(cls))),
        reviewItems: Object.freeze(reviewItems.map((item) => ReviewItem(item))),
        mirrorExclusion: Object.freeze({ excludedFileCount: mirrorExclusion.excludedFileCount }),
    });
}

module.exports = {
    // Enums (frozen single sources of truth)
    FindingCategory,
    FINDING_CATEGORIES,
    NormalizationCategory,
    NORMALIZATION_CATEGORIES,
    ReviewClassification,
    REVIEW_CLASSIFICATIONS,
    ReviewReasonCategory,
    REVIEW_REASON_CATEGORIES,

    // Factories / validators
    ElementLocator,
    AuditFinding,
    SkippedFile,
    AuditRecord,
    ChangeRecord,
    TokenDefinition,
    ComponentClassDefinition,
    ReviewItem,
    Changelog,

    // Count-map helpers (shared by Auditor / Changelog writer)
    emptyFindingCounts,
    emptyChangeCounts,
};

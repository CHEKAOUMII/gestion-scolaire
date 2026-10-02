'use strict';

/**
 * Unit tests for the Tailwind CSS Standardization core data models.
 *
 * Mirrors the existing project convention (see tests/smoke.js): plain Node
 * built-in `assert`, a set of named test functions, and a `run()` driver that
 * throws (non-zero exit) on the first failed assertion. No external test
 * framework is introduced.
 *
 * Run directly:  node tools/tailwind-standardize/tests/models.test.js
 *
 * _Requirements: 13.3_
 */

const assert = require('assert');
const path = require('path');

const models = require(path.join(__dirname, '..', 'core', 'models.js'));

const {
    NormalizationCategory,
    NORMALIZATION_CATEGORIES,
    ReviewClassification,
    ReviewReasonCategory,
    ElementLocator,
    AuditRecord,
    ChangeRecord,
    ReviewItem,
    Changelog,
} = models;

/** A known-good locator input reused across tests. */
function validLocatorInput() {
    return { filePath: 'index.html', line: 12, tag: 'div' };
}

/** Assert that `fn` throws a TypeError whose message mentions `label`. */
function assertRejects(fn, label, description) {
    assert.throws(
        fn,
        (err) =>
            err instanceof TypeError && typeof err.message === 'string' && err.message.includes(label),
        description
    );
}

// ---------------------------------------------------------------------------
// ElementLocator
// ---------------------------------------------------------------------------

function testElementLocatorConstruction() {
    const locator = ElementLocator(validLocatorInput());
    assert.strictEqual(locator.filePath, 'index.html', 'filePath should be preserved');
    assert.strictEqual(locator.line, 12, 'line should be preserved');
    assert.strictEqual(locator.tag, 'div', 'tag should be preserved');
    assert.ok(Object.isFrozen(locator), 'ElementLocator should be frozen/immutable');

    // Invalid inputs are rejected early.
    assertRejects(() => ElementLocator(), 'ElementLocator.filePath', 'missing input rejected');
    assertRejects(
        () => ElementLocator({ filePath: '', line: 1, tag: 'div' }),
        'ElementLocator.filePath',
        'empty filePath rejected'
    );
    assertRejects(
        () => ElementLocator({ filePath: 'a.html', line: 1.5, tag: 'div' }),
        'ElementLocator.line',
        'non-integer line rejected'
    );
    assertRejects(
        () => ElementLocator({ filePath: 'a.html', line: '3', tag: 'div' }),
        'ElementLocator.line',
        'string line rejected'
    );
    assertRejects(
        () => ElementLocator({ filePath: 'a.html', line: 0, tag: 'div' }),
        'ElementLocator.line must be >= 1',
        'line < 1 rejected'
    );
    assertRejects(
        () => ElementLocator({ filePath: 'a.html', line: 5, tag: '' }),
        'ElementLocator.tag',
        'empty tag rejected'
    );

    console.log('[models.test] ElementLocator construction + validation OK');
}

// ---------------------------------------------------------------------------
// ChangeRecord — category restricted to NormalizationCategory
// ---------------------------------------------------------------------------

function testChangeRecordCategoryConstraint() {
    // Every predefined normalization category must be accepted.
    for (const category of NORMALIZATION_CATEGORIES) {
        const record = ChangeRecord({ filePath: 'index.html', category, locator: validLocatorInput() });
        assert.strictEqual(record.category, category, `ChangeRecord should accept category '${category}'`);
        assert.strictEqual(record.locator.tag, 'div', 'locator should be normalized through ElementLocator');
    }

    // A representative valid enum value sanity check.
    const sample = ChangeRecord({
        filePath: 'index.html',
        category: NormalizationCategory.ARBITRARY_TO_TOKEN,
        locator: validLocatorInput(),
    });
    assert.strictEqual(sample.category, 'arbitrary-to-token', 'enum value should map to its string');

    // An out-of-set category must be rejected.
    assertRejects(
        () =>
            ChangeRecord({
                filePath: 'index.html',
                category: 'not-a-real-category',
                locator: validLocatorInput(),
            }),
        'ChangeRecord.category',
        'invalid ChangeRecord category rejected'
    );

    // A FindingCategory value (different enum) must NOT be accepted as a normalization category.
    assertRejects(
        () =>
            ChangeRecord({
                filePath: 'index.html',
                category: 'arbitrary-value', // a FindingCategory, not a NormalizationCategory
                locator: validLocatorInput(),
            }),
        'ChangeRecord.category',
        'finding category rejected as normalization category'
    );

    console.log('[models.test] ChangeRecord category constraint OK');
}

// ---------------------------------------------------------------------------
// ReviewItem — reasonCategory + classification restricted to their enums
// ---------------------------------------------------------------------------

function testReviewItemConstraints() {
    // Every (classification, reasonCategory) combination from the predefined sets is accepted.
    for (const classification of Object.values(ReviewClassification)) {
        for (const reasonCategory of Object.values(ReviewReasonCategory)) {
            const item = ReviewItem({
                classification,
                reasonCategory,
                locator: validLocatorInput(),
                detail: 'context detail',
            });
            assert.strictEqual(item.classification, classification, 'classification preserved');
            assert.strictEqual(item.reasonCategory, reasonCategory, 'reasonCategory preserved');
        }
    }

    // Invalid classification rejected.
    assertRejects(
        () =>
            ReviewItem({
                classification: 'auto-fixed',
                reasonCategory: ReviewReasonCategory.NAME_COLLISION,
                locator: validLocatorInput(),
                detail: 'd',
            }),
        'ReviewItem.classification',
        'invalid classification rejected'
    );

    // Invalid reason category rejected.
    assertRejects(
        () =>
            ReviewItem({
                classification: ReviewClassification.MANUAL_REVIEW,
                reasonCategory: 'because-i-said-so',
                locator: validLocatorInput(),
                detail: 'd',
            }),
        'ReviewItem.reasonCategory',
        'invalid reason category rejected'
    );

    console.log('[models.test] ReviewItem classification + reasonCategory constraints OK');
}

// ---------------------------------------------------------------------------
// AuditRecord — aggregation soundness + noFindings flag
// ---------------------------------------------------------------------------

function testAuditRecordAggregation() {
    const locator = validLocatorInput();

    const record = AuditRecord({
        byDirectory: {
            'root': {
                findings: [
                    { category: 'arbitrary-value', locator, detail: 'mt-[16px]' },
                    { category: 'arbitrary-value', locator, detail: 'p-[3px]' },
                    { category: 'inline-style', locator, detail: 'style="color:red"' },
                ],
            },
            'forms': {
                findings: [{ category: 'physical-direction', locator, detail: 'ml-2' }],
            },
        },
    });

    // Per-category counts are derived from the findings, not trusted from input.
    assert.strictEqual(record.byDirectory.root.counts['arbitrary-value'], 2, 'root arbitrary-value count');
    assert.strictEqual(record.byDirectory.root.counts['inline-style'], 1, 'root inline-style count');
    assert.strictEqual(record.byDirectory.root.counts['physical-direction'], 0, 'root unused category is zero');
    assert.strictEqual(record.byDirectory.forms.counts['physical-direction'], 1, 'forms physical-direction count');

    // Total is the sum across all directories/categories.
    assert.strictEqual(record.totalFindings, 4, 'totalFindings should sum all findings');
    assert.strictEqual(record.noFindings, false, 'noFindings should be false when findings exist');

    // Providing a totalFindings that disagrees with the derived sum is rejected.
    assertRejects(
        () =>
            AuditRecord({
                byDirectory: { root: { findings: [{ category: 'inline-style', locator, detail: 'x' }] } },
                totalFindings: 5,
            }),
        'AuditRecord.totalFindings',
        'mismatched totalFindings rejected'
    );

    // noFindings cannot be forced true when findings are present.
    assertRejects(
        () =>
            AuditRecord({
                byDirectory: { root: { findings: [{ category: 'inline-style', locator, detail: 'x' }] } },
                noFindings: true,
            }),
        'AuditRecord.noFindings',
        'noFindings=true with findings rejected'
    );

    console.log('[models.test] AuditRecord aggregation soundness + noFindings OK');
}

function testAuditRecordNoFindings() {
    // An empty audit derives noFindings = true and a zero total.
    const empty = AuditRecord();
    assert.strictEqual(empty.totalFindings, 0, 'empty audit total is 0');
    assert.strictEqual(empty.noFindings, true, 'empty audit reports noFindings = true');
    assert.deepStrictEqual(empty.byDirectory, {}, 'empty audit has no directories');

    // A directory with an empty findings list still reports noFindings = true overall.
    const emptyDir = AuditRecord({ byDirectory: { root: { findings: [] } } });
    assert.strictEqual(emptyDir.totalFindings, 0, 'directory with no findings totals 0');
    assert.strictEqual(emptyDir.noFindings, true, 'directory with no findings reports noFindings = true');

    console.log('[models.test] AuditRecord noFindings flag OK');
}

// ---------------------------------------------------------------------------
// Changelog — every processed directory present with zero-initialized counts
// ---------------------------------------------------------------------------

function testChangelogDirectoryCoverage() {
    const changelog = Changelog({
        byDirectory: {
            // A directory that changed nothing — must still appear with all-zero counts.
            'root': { changeCounts: {} },
            // A directory with a partial count map — unspecified categories are zero-filled.
            'forms': { changeCounts: { 'arbitrary-to-token': 3, 'utility-ordering': 1 } },
        },
    });

    // Every processed directory is present.
    assert.deepStrictEqual(
        Object.keys(changelog.byDirectory).sort(),
        ['forms', 'root'],
        'changelog includes every processed directory'
    );

    // Each directory exposes a full, zero-initialized count map over ALL normalization categories.
    for (const dir of Object.keys(changelog.byDirectory)) {
        const counts = changelog.byDirectory[dir].changeCounts;
        assert.deepStrictEqual(
            Object.keys(counts).sort(),
            [...NORMALIZATION_CATEGORIES].sort(),
            `directory '${dir}' has every normalization category key`
        );
    }

    // The no-change directory is all zeros.
    for (const category of NORMALIZATION_CATEGORIES) {
        assert.strictEqual(
            changelog.byDirectory.root.changeCounts[category],
            0,
            `unchanged directory '${category}' count should be zero-initialized`
        );
    }

    // The partial directory keeps provided counts and zero-fills the rest.
    assert.strictEqual(changelog.byDirectory.forms.changeCounts['arbitrary-to-token'], 3, 'provided count kept');
    assert.strictEqual(changelog.byDirectory.forms.changeCounts['utility-ordering'], 1, 'provided count kept');
    assert.strictEqual(
        changelog.byDirectory.forms.changeCounts['conflict-removal'],
        0,
        'unspecified count zero-filled'
    );

    // Defaults for the other changelog sections.
    assert.deepStrictEqual(changelog.newTokens, [], 'newTokens defaults to empty');
    assert.deepStrictEqual(changelog.newComponentClasses, [], 'newComponentClasses defaults to empty');
    assert.deepStrictEqual(changelog.reviewItems, [], 'reviewItems defaults to empty');
    assert.strictEqual(changelog.mirrorExclusion.excludedFileCount, 0, 'mirrorExclusion defaults to 0');

    console.log('[models.test] Changelog directory coverage + zero-initialized counts OK');
}

function testChangelogRejectsInvalidCategory() {
    // An unknown category in a directory's changeCounts is rejected.
    assertRejects(
        () => Changelog({ byDirectory: { root: { changeCounts: { 'made-up-category': 1 } } } }),
        'changeCounts category',
        'invalid changelog category rejected'
    );

    // Negative counts are rejected.
    assertRejects(
        () => Changelog({ byDirectory: { root: { changeCounts: { 'utility-ordering': -1 } } } }),
        'must be >= 0',
        'negative changelog count rejected'
    );

    console.log('[models.test] Changelog invalid-category / negative-count rejection OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testElementLocatorConstruction();
    testChangeRecordCategoryConstraint();
    testReviewItemConstraints();
    testAuditRecordAggregation();
    testAuditRecordNoFindings();
    testChangelogDirectoryCoverage();
    testChangelogRejectsInvalidCategory();
    console.log('[models.test] All data-model unit tests passed');
}

run();

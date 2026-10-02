'use strict';

/**
 * Property-based test for the Changelog Writer's completeness and soundness
 * guarantee (io/changelog-writer.js, pure functions `buildChangelog` and
 * `renderChangelog`).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * config-writer.containment.property.test.js and scope-resolver.property.test.js):
 * plain Node built-in `assert`, named test functions, and a `run()` driver that
 * throws (non-zero exit) on the first failed assertion. The only added
 * dependency is `fast-check` (already a dev dependency, v4).
 *
 * `buildChangelog` is a PURE function — it folds accumulated refactor results
 * (processed directories, applied change records, new tokens / component
 * classes, manual-review / excluded items, and the mirror-exclusion count) into
 * a validated, frozen `Changelog` model, performing no file system access.
 * `renderChangelog` is likewise PURE and produces a deterministic Markdown
 * document. Each generated batch is fed directly into the two functions and the
 * results inspected structurally.
 *
 * Property under test (design Property 19):
 *
 *   For any run, the changelog includes EVERY processed directory (recording a
 *   count of 0 where nothing changed), lists EVERY new Design_Token and
 *   component class WITH ITS ORIGIN, lists EVERY manual-review / excluded item
 *   WITH ITS classification AND reason category, and uses ONLY categories drawn
 *   from the predefined `NormalizationCategory` set.
 *
 * Concretely:
 *   1. Every processed directory appears in `byDirectory` — including
 *      zero-change directories, whose per-category counts are all zero.
 *   2. Per-directory / per-category counts equal the number of change records
 *      folded into that directory and category.
 *   3. Only predefined `NormalizationCategory` keys appear in any directory's
 *      `changeCounts`, and every category key is present (zero-filled).
 *   4. Every new token and component class is present with its origin, and
 *      appears in the rendered Markdown.
 *   5. Every manual-review / excluded item is present with its classification
 *      and reason category, and appears in the rendered Markdown.
 *   6. Rendering is deterministic: the same input yields byte-identical output.
 *
 * **Validates: Requirements 13.2, 13.3, 13.4, 13.5, 13.6**
 *
 * Run directly:  node tools/tailwind-standardize/tests/changelog-writer.property.test.js
 */

const assert = require('assert');
const path = require('path');
const fc = require('fast-check');

const {
    buildChangelog,
    renderChangelog,
} = require(path.join(__dirname, '..', 'io', 'changelog-writer.js'));

const {
    NORMALIZATION_CATEGORIES,
    REVIEW_CLASSIFICATIONS,
    REVIEW_REASON_CATEGORIES,
} = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Generators
// ---------------------------------------------------------------------------

// A short, identifier-safe segment (lowercase letters/digits only).
const segment = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'x', 'y', 'z', '0', '1', '2'), {
        minLength: 2,
        maxLength: 6,
    })
    .map((chars) => chars.join(''));

// A small pool of directory keys so that change records reliably land in
// processed directories (and occasionally outside them). The workspace root is
// represented by '.', matching deriveDirectory's convention.
const DIR_POOL = ['.', 'pages', 'pages/admin', 'css', 'reports', 'reports/sub'];
const dirArb = fc.constantFrom(...DIR_POOL);

// Processed directories: a unique subset of the pool, including zero-change
// candidates (directories with no change records).
const processedDirectoriesArb = fc.uniqueArray(dirArb, { minLength: 1, maxLength: DIR_POOL.length });

// A single applied normalization, addressed by an explicit directory so the
// expected per-directory tally is deterministic, and tagged with a category
// strictly from the predefined NormalizationCategory set (Req 13.3).
const changeRecordArb = fc.record({
    directory: dirArb,
    category: fc.constantFrom(...NORMALIZATION_CATEGORIES),
});

// A new Design_Token: unique-suffixed name, value, and a non-empty origin.
const tokenArb = fc.record({
    suffix: segment,
    value: fc.constantFrom('#ffffff', '1rem', '0.5rem', '12px', 'var(--existing)'),
    origin: fc.constantFrom('arbitrary-resolver', 'pages/index.html:42', 'scale-match'),
});

// A new component class: unique-suffixed name, declaration text, non-empty origin.
const classArb = fc.record({
    suffix: segment,
    origin: fc.constantFrom('combination-detector', 'reports/list.html:7', 'synthesizer'),
});

// A manual-review / excluded item with a valid classification + reason category
// (Req 13.6) and a well-formed locator.
const reviewItemArb = fc.record({
    classification: fc.constantFrom(...REVIEW_CLASSIFICATIONS),
    reasonCategory: fc.constantFrom(...REVIEW_REASON_CATEGORIES),
    locator: fc.record({
        filePath: fc.constantFrom('index.html', 'pages/admin/users.html', 'reports/list.html'),
        line: fc.integer({ min: 1, max: 9999 }),
        tag: fc.constantFrom('div', 'span', 'button', 'section'),
    }),
    detail: fc.constantFrom('', 'needs human review', 'dynamic style set in JS'),
});

const scenarioArb = fc.record({
    processedDirectories: processedDirectoriesArb,
    changeRecords: fc.array(changeRecordArb, { maxLength: 20 }),
    tokens: fc.uniqueArray(tokenArb, { maxLength: 6, selector: (t) => t.suffix }),
    classes: fc.uniqueArray(classArb, { maxLength: 6, selector: (c) => c.suffix }),
    reviewItems: fc.array(reviewItemArb, { maxLength: 8 }),
    excludedFileCount: fc.integer({ min: 0, max: 500 }),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Materialize the scenario into the concrete buildChangelog input shape. */
function toInput(s) {
    const newTokens = s.tokens.map((t) => ({
        name: `--gen-${t.suffix}`,
        value: t.value,
        origin: t.origin,
    }));
    const newComponentClasses = s.classes.map((c) => ({
        name: `cmp-${c.suffix}`,
        declaration: `.cmp-${c.suffix} { @apply p-4; }`,
        origin: c.origin,
    }));
    return {
        processedDirectories: s.processedDirectories,
        changeRecords: s.changeRecords,
        newTokens,
        newComponentClasses,
        reviewItems: s.reviewItems,
        mirrorExclusion: { excludedFileCount: s.excludedFileCount },
    };
}

/**
 * Compute the expected per-directory / per-category tally directly from the raw
 * change records (independent of the implementation under test).
 * @returns {{ dirs: Set<string>, counts: Map<string, Map<string, number>> }}
 */
function expectedTally(input) {
    const dirs = new Set(input.processedDirectories);
    const counts = new Map();
    for (const record of input.changeRecords) {
        dirs.add(record.directory);
        if (!counts.has(record.directory)) {
            counts.set(record.directory, new Map());
        }
        const perCat = counts.get(record.directory);
        perCat.set(record.category, (perCat.get(record.category) || 0) + 1);
    }
    return { dirs, counts };
}

// ---------------------------------------------------------------------------
// Property 19
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 19: Changelog is complete and sound
function testChangelogIsCompleteAndSound() {
    fc.assert(
        fc.property(scenarioArb, (s) => {
            const input = toInput(s);
            const changelog = buildChangelog(input);
            const expected = expectedTally(input);

            // (1) Every processed directory (and every change-record directory)
            //     appears in byDirectory — none omitted.
            const resultDirs = Object.keys(changelog.byDirectory);
            for (const dir of expected.dirs) {
                assert.ok(
                    Object.prototype.hasOwnProperty.call(changelog.byDirectory, dir),
                    `directory '${dir}' must appear in the changelog byDirectory map`
                );
            }
            assert.strictEqual(
                resultDirs.length,
                expected.dirs.size,
                'byDirectory must contain exactly the union of processed and changed directories'
            );

            for (const dir of resultDirs) {
                const changeCounts = changelog.byDirectory[dir].changeCounts;
                const keys = Object.keys(changeCounts);

                // (3) Only predefined NormalizationCategory keys appear, and
                //     every category is present (zero-filled).
                assert.strictEqual(
                    keys.length,
                    NORMALIZATION_CATEGORIES.length,
                    `directory '${dir}' must record exactly the predefined categories`
                );
                for (const key of keys) {
                    assert.ok(
                        NORMALIZATION_CATEGORIES.includes(key),
                        `directory '${dir}' has out-of-set category key '${key}'`
                    );
                }

                // (2) Per-category counts match the folded change records;
                //     a zero-change directory has all-zero counts.
                const perCat = expected.counts.get(dir) || new Map();
                for (const category of NORMALIZATION_CATEGORIES) {
                    const want = perCat.get(category) || 0;
                    assert.strictEqual(
                        changeCounts[category],
                        want,
                        `count mismatch for '${dir}' / '${category}': got ${changeCounts[category]}, want ${want}`
                    );
                }
            }

            const rendered = renderChangelog(changelog);

            // (4) Every new token / component class is present with its origin,
            //     in the model and in the rendered Markdown.
            assert.strictEqual(changelog.newTokens.length, input.newTokens.length, 'all tokens retained');
            for (const token of input.newTokens) {
                const stored = changelog.newTokens.find((t) => t.name === token.name);
                assert.ok(stored, `token '${token.name}' must be present in the model`);
                assert.strictEqual(stored.origin, token.origin, `token '${token.name}' must keep its origin`);
                assert.ok(rendered.includes(token.name), `token '${token.name}' must appear in the render`);
                assert.ok(
                    rendered.includes(`origin: ${token.origin}`),
                    `token '${token.name}' origin must appear in the render`
                );
            }

            assert.strictEqual(
                changelog.newComponentClasses.length,
                input.newComponentClasses.length,
                'all component classes retained'
            );
            for (const cls of input.newComponentClasses) {
                const stored = changelog.newComponentClasses.find((c) => c.name === cls.name);
                assert.ok(stored, `component class '${cls.name}' must be present in the model`);
                assert.strictEqual(stored.origin, cls.origin, `class '${cls.name}' must keep its origin`);
                assert.ok(rendered.includes(cls.name), `class '${cls.name}' must appear in the render`);
                assert.ok(
                    rendered.includes(`origin: ${cls.origin}`),
                    `class '${cls.name}' origin must appear in the render`
                );
            }

            // (5) Every manual-review / excluded item is present with its
            //     classification and reason category, in the model and render.
            assert.strictEqual(
                changelog.reviewItems.length,
                input.reviewItems.length,
                'all review items retained'
            );
            for (const item of input.reviewItems) {
                assert.ok(
                    REVIEW_CLASSIFICATIONS.includes(item.classification),
                    'review item classification stays within the predefined set'
                );
                assert.ok(
                    REVIEW_REASON_CATEGORIES.includes(item.reasonCategory),
                    'review item reason category stays within the predefined set'
                );
                // The render emits one line per item carrying classification,
                // reason category, and locator.
                const where = `${item.locator.filePath}:${item.locator.line} <${item.locator.tag}>`;
                const head = `[${item.classification}] (${item.reasonCategory}) ${where}`;
                assert.ok(
                    rendered.includes(head),
                    `review item line '${head}' must appear in the render`
                );
            }

            // (6) Rendering is deterministic for identical input.
            const renderedAgain = renderChangelog(buildChangelog(input));
            assert.strictEqual(rendered, renderedAgain, 'render must be deterministic for identical input');
        }),
        { numRuns: 200 }
    );

    console.log('[changelog-writer.property] Property 19: changelog completeness and soundness OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testChangelogIsCompleteAndSound();
    console.log('[changelog-writer.property] All changelog-writer property tests passed');
}

run();

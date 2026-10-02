'use strict';

/**
 * Integration test on representative refactored pages (Task 17.3).
 *
 * Exercises the full Standardization_Tool pipeline end-to-end against a small,
 * self-contained TEMP workspace that mimics the real project layout:
 *
 *   - `css/tailwind-input.css` with an `@theme { ... }` block (a handful of
 *     real tokens such as `--color-primary` and `--spacing-sm`) and an
 *     `@layer components { ... }` block.
 *   - a `Cheka-project/` Mirror_Subtree (so scope resolves and the
 *     mirror-exclusion path is exercised).
 *   - two representative root `*.html` pages carrying a realistic mix of
 *     non-conforming Tailwind usage: unordered utilities, an exact-duplicate
 *     utility, an arbitrary value matching a token, a physical-direction
 *     utility, a static (convertible) inline style, a dynamic inline style
 *     (`${...}` interpolation), and a 2+ utility combination recurring across
 *     pages.
 *
 * The pipeline is driven through `refactorer.refactor(scope, { dryRun: true })`
 * so the real Verifier / build is never invoked and the real repo files are
 * never mutated — `refactor` returns the rewritten file texts and the
 * accumulated change/review records for inspection.
 *
 * Core assertions (Output-Preservation Gate, Req 2.1-2.4):
 *   - EVERY applied class-attribute edit is provably output-preserving: for each
 *     edited element we re-check the edit through `preservation-gate.evaluateEdit`
 *     and assert `approved === true` (component-class substitutions are expanded
 *     back to their `@apply` utilities, and a converted inline style is folded
 *     into the before-side so the check covers the full computed output).
 *   - A dynamic inline style is NEVER converted — it is retained verbatim and
 *     recorded as an excluded item (Req 2.5 / 7.2).
 *   - At least one ordering change and one duplicate-removal change are applied.
 *   - The Refactorer records output-would-change manual-review items where a
 *     normalization could not be proven output-preserving (Req 2.5).
 *
 * Changelog gate (end-to-end): the accumulated results are assembled with
 * `changelog-writer.buildChangelog` and written with `writeChangelog` to a temp
 * path; the test asserts `ok === true` and that every processed directory and
 * applied change category is represented in the rendered changelog.
 *
 * Mirrors the existing project test convention (see verifier.success.test.js):
 * plain Node built-in `assert`, named test functions, and a `run()` driver. No
 * external test framework is introduced.
 *
 * Run directly:  node tools/tailwind-standardize/tests/refactor.integration.test.js
 *
 * _Requirements: 2.1, 2.2, 2.3, 2.4_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scopeResolver = require(path.join(__dirname, '..', 'io', 'scope-resolver.js'));
const auditor = require(path.join(__dirname, '..', 'io', 'auditor.js'));
const refactorer = require(path.join(__dirname, '..', 'io', 'refactorer.js'));
const changelogWriter = require(path.join(__dirname, '..', 'io', 'changelog-writer.js'));
const { evaluateEdit } = require(path.join(__dirname, '..', 'core', 'preservation-gate.js'));
const { tokenize } = require(path.join(__dirname, '..', 'core', 'tokenizer.js'));
const { convertInlineStyle } = require(path.join(__dirname, '..', 'core', 'inline-style-converter.js'));

const {
    FindingCategory,
    NormalizationCategory,
    ReviewReasonCategory,
    ReviewClassification,
} = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Representative fixture content
// ---------------------------------------------------------------------------

/** A minimal CSS-first Config_Source with a real `@theme` + `@layer components`. */
const TAILWIND_INPUT_CSS = `@import "tailwindcss";

@source "../*.html";

@theme {
    --color-primary: #3b6ac5;
    --color-surface: #ffffff;
    --spacing-sm: 1rem;
    --spacing-md: 1.5rem;
    --radius-md: 16px;
}

@variant dark (&:where([data-theme="dark"], [data-theme="dark"] *));

@layer components {
    .card-shell {
        @apply rounded-md bg-surface;
    }
}
`;

/**
 * page1: unordered utilities (A), an exact-duplicate utility (B), one half of a
 * recurring combination (C), and an arbitrary value matching --color-primary (E).
 */
const PAGE1_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="css/tailwind-output.css" />
</head>
<body>
    <div class="text-white flex p-4">unordered utilities</div>
    <span class="block px-2 block">exact duplicate utility</span>
    <section class="rounded-md shadow">recurring combination</section>
    <div class="bg-[#3b6ac5]">arbitrary value matching a token</div>
</body>
</html>
`;

/**
 * page2: the other half of the recurring combination (D), a physical-direction
 * utility (F), a static convertible inline style (G), and a dynamic inline
 * style with a `${...}` interpolation (H).
 */
const PAGE2_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8" />
    <link rel="stylesheet" href="css/tailwind-output.css" />
</head>
<body>
    <article class="rounded-md shadow">recurring combination</article>
    <div class="ml-2">physical-direction utility</div>
    <div class="text-sm" style="display:flex">static convertible inline style</div>
    <div style="width: \${cardWidth}">dynamic inline style</div>
</body>
</html>
`;

// ---------------------------------------------------------------------------
// Workspace provisioning
// ---------------------------------------------------------------------------

/**
 * Build a temp workspace mirroring the project layout. Returns its absolute
 * root path. Nothing here touches the real repository.
 * @returns {string}
 */
function createWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-refactor-int-'));

    fs.mkdirSync(path.join(root, 'css'), { recursive: true });
    fs.writeFileSync(path.join(root, 'css', 'tailwind-input.css'), TAILWIND_INPUT_CSS, 'utf8');

    // Mirror_Subtree with at least one file so scope resolves and exclusion is
    // exercised. These files must never be touched by the refactor.
    fs.mkdirSync(path.join(root, 'Cheka-project'), { recursive: true });
    fs.writeFileSync(
        path.join(root, 'Cheka-project', 'mirror.html'),
        '<div class="ml-2 flex p-4">mirror file — excluded</div>\n',
        'utf8'
    );

    fs.writeFileSync(path.join(root, 'page1.html'), PAGE1_HTML, 'utf8');
    fs.writeFileSync(path.join(root, 'page2.html'), PAGE2_HTML, 'utf8');

    return root;
}

/** Best-effort recursive cleanup of the temp workspace. */
function cleanup(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        // Leftover temp dir should never fail the test.
    }
}

// ---------------------------------------------------------------------------
// Helpers for the per-element output-preservation re-check
// ---------------------------------------------------------------------------

/**
 * Map each synthesized component class name to the utility string it `@apply`s,
 * so a substituted component class can be expanded back to its constituent
 * utilities for the output-preservation re-check.
 * @param {Array<{ name: string, declaration: string }>} newComponentClasses
 * @returns {Map<string, string>}
 */
function buildComponentClassMap(newComponentClasses) {
    const map = new Map();
    for (const cls of newComponentClasses || []) {
        const match = /@apply\s+([^;]+);/.exec(cls.declaration || '');
        if (match) {
            map.set(cls.name, match[1].trim());
        }
    }
    return map;
}

/**
 * Expand any component-class token in `tokens` into the utility tokens it
 * `@apply`s. Substitution is preservation-proving by construction, so expanding
 * it lets the gate prove the substitution output-preserving over real utilities.
 * @param {object[]} tokens ClassToken[]
 * @param {Map<string, string>} componentClassMap
 * @returns {object[]} ClassToken[]
 */
function expandComponentClasses(tokens, componentClassMap) {
    const out = [];
    for (const token of tokens) {
        if (componentClassMap.has(token.raw)) {
            for (const expanded of tokenize(componentClassMap.get(token.raw))) {
                out.push(expanded);
            }
        } else {
            out.push(token);
        }
    }
    return out;
}

/** Directory key for a file relative to the workspace root ('.' at the root). */
function directoryKey(workspaceRoot, filePath) {
    const rel = path.relative(path.resolve(workspaceRoot), path.dirname(path.resolve(filePath)));
    return rel === '' ? '.' : rel.split(path.sep).join('/');
}

/** Count change records by normalization category. */
function tallyByCategory(changeRecords) {
    const tally = {};
    for (const record of changeRecords) {
        tally[record.category] = (tally[record.category] || 0) + 1;
    }
    return tally;
}

// ---------------------------------------------------------------------------
// The integration test
// ---------------------------------------------------------------------------

function testRepresentativePagesPreserveOutputEndToEnd() {
    const root = createWorkspace();
    try {
        // --- Resolve scope (root *.html + config; mirror subtree excluded) ----
        const scope = scopeResolver.resolveScope(root);
        scopeResolver.assertScopeResolved(scope, { expectMirror: true });

        assert.strictEqual(scope.rootHtmlSet.length, 2, 'two representative root pages should be in scope');
        assert.ok(scope.mirrorSubtree, 'the Cheka-project mirror subtree should resolve');
        assert.ok(
            scope.excludedFiles.length >= 1,
            'the mirror subtree should contribute at least one excluded file'
        );
        // No root page should leak into the excluded set, and no excluded file
        // should be in scope (Req 12.x — scope exclusivity).
        for (const excluded of scope.excludedFiles) {
            assert.strictEqual(
                scopeResolver.isInScope(scope, excluded),
                false,
                'mirror-subtree files must never be in scope'
            );
        }

        // --- Read-only audit over the representative pages --------------------
        const auditRecord = auditor.audit(scope);
        assert.strictEqual(auditRecord.noFindings, false, 'the representative pages contain non-conforming usage');
        assert.ok(auditRecord.totalFindings > 0, 'the audit should report findings');

        const foundCategories = new Set();
        for (const dirKey of Object.keys(auditRecord.byDirectory)) {
            for (const finding of auditRecord.byDirectory[dirKey].findings) {
                foundCategories.add(finding.category);
            }
        }
        assert.ok(foundCategories.has(FindingCategory.ARBITRARY_VALUE), 'audit should detect the arbitrary value');
        assert.ok(
            foundCategories.has(FindingCategory.PHYSICAL_DIRECTION),
            'audit should detect the physical-direction utility'
        );
        assert.ok(foundCategories.has(FindingCategory.INLINE_STYLE), 'audit should detect the inline styles');
        assert.ok(
            foundCategories.has(FindingCategory.DUPLICATE_COMBINATION),
            'audit should detect the recurring duplicate combination across pages'
        );

        // --- Refactor (dry-run: rewrite in memory, no verifier / no writes) ---
        const result = refactorer.refactor(scope, { dryRun: true, workspaceRoot: root });

        assert.strictEqual(result.halted, false, 'a dry-run over clean fixtures should not halt');
        assert.deepStrictEqual(
            [...result.processedDirectories],
            ['.'],
            'both pages live at the workspace root, so a single "." directory is processed'
        );

        // The real repo files must be untouched by the dry-run.
        assert.strictEqual(fs.readFileSync(path.join(root, 'page1.html'), 'utf8'), PAGE1_HTML, 'page1 unchanged on disk');
        assert.strictEqual(fs.readFileSync(path.join(root, 'page2.html'), 'utf8'), PAGE2_HTML, 'page2 unchanged on disk');

        // --- Output-Preservation Gate: re-check EVERY applied edit ------------
        const componentClassMap = buildComponentClassMap(result.newComponentClasses);
        let editedElementsChecked = 0;
        let inlineConversionsChecked = 0;
        let componentSubstitutionsChecked = 0;

        for (const file of scope.rootHtmlSet) {
            const originalText = fs.readFileSync(file, 'utf8');
            const rewrittenText = result.fileTexts.get(file);
            assert.ok(typeof rewrittenText === 'string', `refactor should return rewritten text for ${path.basename(file)}`);

            const originalTags = refactorer.collectStartTags(originalText);
            const rewrittenTags = refactorer.collectStartTags(rewrittenText);
            assert.strictEqual(
                originalTags.length,
                rewrittenTags.length,
                'refactoring rewrites attributes only, so the tag sequence is structurally identical'
            );

            for (let i = 0; i < originalTags.length; i += 1) {
                const before = originalTags[i];
                const after = rewrittenTags[i];

                const classChanged = (before.classValue || '') !== (after.classValue || '');
                const styleRemoved = before.styleValue !== null && after.styleValue === null;
                if (!classChanged && !styleRemoved) {
                    continue; // element emitted verbatim — nothing applied here
                }

                editedElementsChecked += 1;

                // Build the BEFORE token set for the gate. When a static inline
                // style was converted, fold its equivalent utilities into the
                // before-side so the check covers the element's full computed
                // output (class + former inline style).
                let beforeTokens = tokenize(before.classValue || '');
                if (styleRemoved) {
                    inlineConversionsChecked += 1;
                    const conv = convertInlineStyle({ value: before.styleValue, dynamic: false });
                    assert.strictEqual(
                        conv.action,
                        'convert',
                        'the static inline style fixture must be convertible'
                    );
                    beforeTokens = beforeTokens.concat(conv.utilities);
                }

                // Expand any synthesized component class back to its @apply
                // utilities before proving preservation.
                const afterRaw = tokenize(after.classValue || '');
                if (afterRaw.some((token) => componentClassMap.has(token.raw))) {
                    componentSubstitutionsChecked += 1;
                }
                const afterTokens = expandComponentClasses(afterRaw, componentClassMap);

                const verdict = evaluateEdit({ beforeTokens, afterTokens });
                assert.strictEqual(
                    verdict.approved,
                    true,
                    `applied edit on <${before.tag}> at line ${before.line} must be provably output-preserving ` +
                        `("${before.classValue}"${styleRemoved ? ` + style="${before.styleValue}"` : ''} ` +
                        `-> "${after.classValue}"); gate said: ${verdict.reason || 'approved'}`
                );
            }
        }

        assert.ok(editedElementsChecked > 0, 'the refactor should have applied at least one element edit');
        assert.ok(inlineConversionsChecked >= 1, 'the static inline style should have been converted on one element');
        assert.ok(
            componentSubstitutionsChecked >= 2,
            'the recurring combination should have been consolidated on both pages'
        );

        // --- Applied-change coverage: ordering + duplicate removal + more -----
        const tally = tallyByCategory(result.changeRecords);
        assert.ok(
            (tally[NormalizationCategory.UTILITY_ORDERING] || 0) >= 1,
            'at least one utility-ordering change should have been applied'
        );
        assert.ok(
            (tally[NormalizationCategory.CONFLICT_REMOVAL] || 0) >= 1,
            'at least one duplicate/conflict-removal change should have been applied'
        );
        assert.ok(
            (tally[NormalizationCategory.INLINE_STYLE_ELIMINATION] || 0) >= 1,
            'the static inline style should be recorded as an inline-style-elimination change'
        );
        assert.ok(
            (tally[NormalizationCategory.COMBINATION_TO_COMPONENT] || 0) >= 2,
            'the recurring combination should be consolidated into a component class on both pages'
        );

        // --- Dynamic inline style is NEVER converted (Req 2.5 / 7.2) ----------
        const dynamicExclusions = result.reviewItems.filter(
            (item) =>
                item.classification === ReviewClassification.EXCLUDED &&
                item.reasonCategory === ReviewReasonCategory.DYNAMIC_INLINE_STYLE
        );
        assert.ok(dynamicExclusions.length >= 1, 'the dynamic inline style must be recorded as an excluded item');
        // The dynamic style must remain verbatim in the rewritten page.
        const rewrittenPage2 = result.fileTexts.get(path.join(root, 'page2.html'));
        assert.ok(
            rewrittenPage2.includes('style="width: ${cardWidth}"'),
            'the dynamic inline style must be retained verbatim in the rewritten output'
        );

        // --- Output-would-change retentions are recorded for manual review ----
        const outputWouldChange = result.reviewItems.filter(
            (item) => item.reasonCategory === ReviewReasonCategory.OUTPUT_WOULD_CHANGE
        );
        assert.ok(
            outputWouldChange.length >= 1,
            'normalizations that could not be proven output-preserving must be retained as manual-review items (Req 2.5)'
        );

        // --- Changelog gate end-to-end ---------------------------------------
        const taggedChangeRecords = result.changeRecords.map((change) => ({
            directory: directoryKey(root, change.filePath),
            filePath: change.filePath,
            category: change.category,
        }));

        const changelog = changelogWriter.buildChangelog({
            processedDirectories: result.processedDirectories,
            changeRecords: taggedChangeRecords,
            newTokens: result.newTokens,
            newComponentClasses: result.newComponentClasses,
            reviewItems: result.reviewItems,
            mirrorExclusion: { excludedFileCount: scope.excludedFiles.length },
        });

        // Every processed directory is represented in the assembled changelog (Req 13.2).
        for (const dir of result.processedDirectories) {
            assert.ok(changelog.byDirectory[dir], `changelog should represent processed directory "${dir}"`);
        }

        const changelogPath = path.join(root, 'tools', 'CHANGELOG.tailwind.md');
        const writeResult = changelogWriter.writeChangelog(changelogPath, changelog);
        assert.strictEqual(writeResult.ok, true, 'the changelog gate should write successfully end-to-end');
        assert.ok(fs.existsSync(changelogPath), 'the changelog file should exist on disk');

        const content = writeResult.content;
        assert.ok(content.includes('### .'), 'changelog should include the processed root directory section');
        assert.ok(
            content.includes(NormalizationCategory.UTILITY_ORDERING),
            'changelog should reflect the applied utility-ordering changes'
        );
        assert.ok(
            content.includes(NormalizationCategory.COMBINATION_TO_COMPONENT),
            'changelog should reflect the applied component consolidation'
        );
        assert.ok(
            content.includes(`Excluded ${scope.excludedFiles.length} file(s)`),
            'changelog should report the mirror-subtree exclusion count'
        );

        console.log('[refactor.integration.test] representative pages preserve computed output end-to-end OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testRepresentativePagesPreserveOutputEndToEnd();
    console.log('[refactor.integration.test] All representative refactor integration tests passed');
}

run();

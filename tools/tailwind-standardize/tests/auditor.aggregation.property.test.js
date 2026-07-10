'use strict';

/**
 * Property-based test for Audit aggregation soundness (io/auditor.js).
 *
 * Mirrors the existing project convention (see tools/tailwind-standardize/tests/
 * scanner.property.test.js and scope-resolver.property.test.js): plain Node
 * built-in `assert`, named test functions, and a `run()` driver that throws
 * (non-zero exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Unlike the pure-core property tests, the Auditor is an I/O shell: `audit()`
 * reads files from disk. Each generated example therefore materializes a small
 * workspace (multiple files, possibly across subdirectories) under a fresh
 * `os.tmpdir()` directory, runs `audit()` against it, asserts the aggregation
 * invariants on the returned AuditRecord, and finally removes the temp files.
 *
 * Property under test:
 *
 *   Property 5: Audit aggregation is sound.
 *   For any set of findings, the per-directory per-category counts in the audit
 *   record sum to the total number of findings of that category across all
 *   files. Concretely, for the AuditRecord produced by `audit()`:
 *     (a) for each category, the sum over all directories of
 *         byDirectory[dir].counts[category] equals the number of findings of
 *         that category across all byDirectory[dir].findings;
 *     (b) the grand total of every per-directory per-category count equals
 *         record.totalFindings; and
 *     (c) record.noFindings === (record.totalFindings === 0).
 *
 * **Validates: Requirements 1.8**
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/auditor.aggregation.property.test.js
 */

// Feature: tailwind-css-standardization, Property 5: Audit aggregation is sound

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const { audit } = require(path.join(__dirname, '..', 'io', 'auditor.js'));
const { FINDING_CATEGORIES } = require(path.join(__dirname, '..', 'core', 'models.js'));

// ---------------------------------------------------------------------------
// Snippet generators — class/style values chosen to exercise every finding
// category so generated workspaces carry an assorted, non-trivial mix of
// findings (arbitrary-value, physical-direction, inline-style,
// duplicate-combination, conflict-override). Values never contain quotes, `<`,
// or `>` so each generated start tag stays well-formed.
// ---------------------------------------------------------------------------

// Tokens that trigger arbitrary-value findings (bracket notation).
const arbitraryClassArb = fc.constantFrom('p-[10px]', 'w-[50%]', 'mt-[3px]', 'text-[14px]', 'gap-[2rem]');

// Tokens that trigger physical-direction findings (left/right inline-axis).
const physicalClassArb = fc.constantFrom('ml-2', 'pl-4', 'mr-1', 'pr-3', 'border-l', 'left-0', 'right-0');

// Conforming tokens (no finding on their own).
const plainClassArb = fc.constantFrom('flex', 'grid', 'rounded', 'gap-2', 'items-center', 'text-center');

// Same-property pairs within one element trigger conflict/override findings
// (e.g. two display utilities, or two padding utilities, under one context).
const conflictClassArb = fc.constantFrom('flex block', 'block hidden', 'p-2 p-4', 'mt-1 mt-3');

// Static style values trigger inline-style findings.
const styleArb = fc.constantFrom('color:red', 'display:flex', 'margin:0', 'padding:4px', 'text-align:center');

const tagArb = fc.constantFrom('div', 'span', 'p', 'a', 'button', 'li', 'section');

/**
 * One element bearing some combination of class/style attributes. At least one
 * attribute of interest is guaranteed so most elements yield >= 1 finding, but
 * a "plain" element (only conforming classes, no style) is allowed so zero- and
 * low-finding workspaces are also exercised.
 */
const classValueArb = fc.oneof(
    arbitraryClassArb,
    physicalClassArb,
    conflictClassArb,
    plainClassArb,
    // A duplicate combination: the SAME two-utility set, used so that when it
    // recurs across >= 2 elements/files it becomes a duplicate-combination
    // finding at each location.
    fc.constant('shadow rounded-lg')
);

const elementArb = fc
    .record({
        tag: tagArb,
        hasClass: fc.boolean(),
        hasStyle: fc.boolean(),
        classValue: classValueArb,
        styleValue: styleArb,
    })
    .map((e) => {
        // Guarantee at least one attribute of interest.
        const hasClass = e.hasClass || !e.hasStyle;
        return { tag: e.tag, hasClass, hasStyle: e.hasStyle, classValue: e.classValue, styleValue: e.styleValue };
    });

function buildElementMarkup(el) {
    const attrs = [];
    if (el.hasClass) {
        attrs.push(`class="${el.classValue}"`);
    }
    if (el.hasStyle) {
        attrs.push(`style="${el.styleValue}"`);
    }
    return `  <${el.tag} ${attrs.join(' ')}>text</${el.tag}>`;
}

function buildFileText(elements) {
    const lines = ['<!doctype html>', '<html>', '<body>'];
    for (const el of elements) {
        lines.push(buildElementMarkup(el));
    }
    lines.push('</body>', '</html>');
    return lines.join('\n');
}

// A small set of subdirectory layouts (relative to the workspace root) so
// findings land across multiple `byDirectory` keys, including the root ('.').
const subdirArb = fc.constantFrom('', 'pages', 'views', path.join('views', 'admin'));

/** One file: its subdirectory plus the elements it contains. */
const fileArb = fc.record({
    subdir: subdirArb,
    elements: fc.array(elementArb, { minLength: 0, maxLength: 4 }),
});

/** A workspace is a small, possibly-empty set of files. */
const workspaceArb = fc.array(fileArb, { minLength: 1, maxLength: 5 });

// ---------------------------------------------------------------------------
// Temp-workspace helpers
// ---------------------------------------------------------------------------

/**
 * Materialize a generated workspace under a fresh temp directory. Returns the
 * workspace root and the list of written file paths. Filenames are indexed so
 * they are unique within a directory.
 */
function writeWorkspace(files) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-audit-agg-'));
    const filePaths = [];
    files.forEach((file, index) => {
        const dir = file.subdir ? path.join(root, file.subdir) : root;
        fs.mkdirSync(dir, { recursive: true });
        const filePath = path.join(dir, `page-${index}.html`);
        fs.writeFileSync(filePath, buildFileText(file.elements), 'utf8');
        filePaths.push(filePath);
    });
    return { root, filePaths };
}

function removeWorkspace(root) {
    fs.rmSync(root, { recursive: true, force: true });
}

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

function testAuditAggregationIsSound() {
    fc.assert(
        fc.property(workspaceArb, (files) => {
            const { root, filePaths } = writeWorkspace(files);
            try {
                const record = audit(filePaths, { baseDir: root });

                // Recompute, directly from the recorded findings, the number of
                // findings per category and the summed per-directory counts.
                const findingsByCategory = {};
                const countsByCategory = {};
                for (const category of FINDING_CATEGORIES) {
                    findingsByCategory[category] = 0;
                    countsByCategory[category] = 0;
                }

                let summedCounts = 0;
                for (const dirKey of Object.keys(record.byDirectory)) {
                    const group = record.byDirectory[dirKey];

                    // Tally the actual findings in this directory by category.
                    for (const finding of group.findings) {
                        findingsByCategory[finding.category] += 1;
                    }

                    // Accumulate the per-directory per-category counts.
                    for (const category of FINDING_CATEGORIES) {
                        const c = group.counts[category];
                        assert.ok(
                            Number.isInteger(c) && c >= 0,
                            `counts['${category}'] for '${dirKey}' must be a non-negative integer`
                        );
                        countsByCategory[category] += c;
                        summedCounts += c;
                    }
                }

                // (a) For each category, the summed per-directory counts equal
                // the number of findings of that category across all files.
                for (const category of FINDING_CATEGORIES) {
                    assert.strictEqual(
                        countsByCategory[category],
                        findingsByCategory[category],
                        `summed counts for '${category}' must equal the number of '${category}' findings`
                    );
                }

                // (b) The grand total of all per-category counts equals totalFindings.
                assert.strictEqual(
                    summedCounts,
                    record.totalFindings,
                    'grand total of per-directory per-category counts must equal totalFindings'
                );

                // (c) noFindings is true exactly when there are no findings.
                assert.strictEqual(
                    record.noFindings,
                    record.totalFindings === 0,
                    'noFindings must be true exactly when totalFindings === 0'
                );
            } finally {
                removeWorkspace(root);
            }
        }),
        { numRuns: 100 }
    );

    console.log('[auditor.aggregation.property] audit aggregation is sound OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testAuditAggregationIsSound();
    console.log('[auditor.aggregation.property] All auditor aggregation property tests passed');
}

run();

'use strict';

/**
 * Unit test for the explicit no-findings audit record (io/auditor.js).
 *
 * Mirrors the existing project convention (see tests/models.test.js and
 * tests/auditor.resilience.property.test.js): plain Node built-in `assert`,
 * named test functions, and a `run()` driver that throws (non-zero exit) on the
 * first failed assertion. No external test framework is introduced.
 *
 * Requirement 1.9: IF the audit completes with zero detected findings across
 * all scanned files, THEN the Auditor SHALL produce an audit record that
 * explicitly states that no non-conforming usage was detected. In the data
 * model this is surfaced as `record.noFindings === true` (with
 * `record.totalFindings === 0` and no findings under any directory).
 *
 * `audit()` is the I/O shell: it reads each file from disk. To exercise the
 * no-findings path we materialize fully-conforming HTML files under a fresh
 * temp directory (only plain utility classes — no arbitrary values, no
 * physical-direction utilities, no inline styles, no conflicts, no duplicate
 * combinations) and confirm the audit reports zero findings. Temp files are
 * removed in a `finally` block.
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/auditor.no-findings.test.js
 *
 * _Requirements: 1.9_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { audit } = require(path.join(__dirname, '..', 'io', 'auditor.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a fully-conforming HTML document. Every element uses only plain logical
 * utility classes:
 *   - no arbitrary values (no `[...]` bracket literals)        -> Req 1.3
 *   - no physical-direction utilities (no ml-/mr-/pl-/... etc.) -> Req 1.4
 *   - no inline styles or <style> blocks                        -> Req 1.5
 *   - no two elements share the same multi-utility combination  -> Req 1.6
 *   - no same-property conflicts within one element             -> Req 1.7
 *
 * Every multi-utility combination is made globally unique (it embeds `index`)
 * so the order-independent duplicate-combination detector — which flags any
 * set of two or more utilities recurring at two or more locations — finds
 * nothing recurring across the file set.
 */
function conformingHtml(index) {
    return [
        '<html>',
        '<body>',
        `  <header class="flex gap-${index + 1}">Header ${index}</header>`,
        `  <main class="block ps-${index + 1}">`,
        `    <p class="text-sm leading-${index + 5}">Paragraph ${index}</p>`,
        `    <span class="font-bold mt-${index + 2}">Label ${index}</span>`,
        '  </main>',
        `  <footer class="grid">Footer ${index}</footer>`,
        '</body>',
        '</html>',
    ].join('\n');
}

/**
 * Assert that an audit record explicitly reports no non-conforming usage:
 * the no-findings flag is set, the total is zero, and no directory carries a
 * finding (Req 1.9 / Req 1.8 aggregation).
 */
function assertExplicitNoFindings(record, description) {
    assert.strictEqual(record.totalFindings, 0, `${description}: totalFindings must be 0`);
    assert.strictEqual(record.noFindings, true, `${description}: noFindings must be true`);

    for (const [dirKey, group] of Object.entries(record.byDirectory)) {
        assert.strictEqual(
            group.findings.length,
            0,
            `${description}: directory '${dirKey}' must contain no findings`
        );
        // Every per-category count must also be zero (aggregation soundness).
        for (const [category, count] of Object.entries(group.counts)) {
            assert.strictEqual(
                count,
                0,
                `${description}: directory '${dirKey}' category '${category}' count must be 0`
            );
        }
    }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testConformingFilesYieldNoFindings() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-nofind-'));
    try {
        const filePaths = [];
        for (let i = 0; i < 3; i += 1) {
            const filePath = path.join(tmpDir, `conforming-${i}.html`);
            fs.writeFileSync(filePath, conformingHtml(i), 'utf8');
            filePaths.push(filePath);
        }

        let record;
        assert.doesNotThrow(() => {
            record = audit(filePaths, { baseDir: tmpDir });
        }, 'audit() must not throw on fully-conforming files');

        // The conforming files are readable, so nothing is skipped.
        assert.strictEqual(
            record.skippedFiles.length,
            0,
            'no conforming file should be skipped'
        );

        assertExplicitNoFindings(record, 'conforming file set');

        console.log('[auditor.no-findings.test] conforming files yield an explicit no-findings record OK');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

function testEmptyFileListYieldsNoFindings() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-nofind-empty-'));
    try {
        let record;
        assert.doesNotThrow(() => {
            record = audit([], { baseDir: tmpDir });
        }, 'audit() must not throw on an empty file list');

        assert.strictEqual(record.skippedFiles.length, 0, 'empty file list skips nothing');
        assert.deepStrictEqual(record.byDirectory, {}, 'empty file list yields no directories');
        assertExplicitNoFindings(record, 'empty file list');

        console.log('[auditor.no-findings.test] empty file list yields an explicit no-findings record OK');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testConformingFilesYieldNoFindings();
    testEmptyFileListYieldsNoFindings();
    console.log('[auditor.no-findings.test] All no-findings audit unit tests passed');
}

run();

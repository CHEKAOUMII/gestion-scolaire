'use strict';

/**
 * Property-based test for Auditor resilience (io/auditor.js).
 *
 * Mirrors the existing project convention (see scanner.property.test.js and
 * scope-resolver.property.test.js): plain Node built-in `assert`, named test
 * functions, `fast-check` (v4, already a dev dependency), and a `run()` driver
 * that throws (non-zero exit) on the first failed assertion.
 *
 * Unlike the pure-core scanner, `audit()` is the I/O shell: it reads each file
 * from disk. To exercise the resilience path we materialize a mix of REAL,
 * readable HTML files (each carrying a known finding) and "unreadable" entries
 * (paths that do not exist on disk, so `fs.readFileSync` throws). All temp
 * files are created under a fresh temp directory per iteration and removed in a
 * `finally` block.
 *
 * Property under test:
 *
 *   Property 2: Audit resilience under unreadable files.
 *   For any file set in which an arbitrary subset cannot be read or parsed, the
 *   audit completes without aborting, records each unreadable file as a skipped
 *   file with a (non-empty) failure reason, and still scans every readable file
 *   (every readable file's findings are present).
 *
 * **Validates: Requirements 1.2**
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/auditor.resilience.property.test.js
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const { audit } = require(path.join(__dirname, '..', 'io', 'auditor.js'));

// ---------------------------------------------------------------------------
// Generators — keep file sets small (Req: small inputs for fast iterations).
// ---------------------------------------------------------------------------

// Each readable file carries at least one guaranteed finding via a static
// inline style (the scanner surfaces `style="..."` as an inline-style finding
// regardless of tokenizer behaviour), keeping the "still scanned" assertion
// robust. A known arbitrary-value class is added too for variety.
const readableColorArb = fc.constantFrom('red', 'blue', 'green', 'black');

const fileSetArb = fc
    .record({
        // 1..4 readable files, 0..4 unreadable entries; at least one file total.
        readableCount: fc.integer({ min: 1, max: 4 }),
        unreadableCount: fc.integer({ min: 0, max: 4 }),
        colors: fc.array(readableColorArb, { minLength: 4, maxLength: 4 }),
        // A bit pattern deciding the interleave order of readable/unreadable.
        order: fc.array(fc.boolean(), { minLength: 0, maxLength: 8 }),
    });

// ---------------------------------------------------------------------------
// Property
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 2: Audit resilience under unreadable files
function testAuditResilienceUnderUnreadableFiles() {
    fc.assert(
        fc.property(fileSetArb, (spec) => {
            const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-audit-'));
            try {
                const readablePaths = [];
                const unreadablePaths = [];

                // Materialize readable files with a known finding each.
                for (let i = 0; i < spec.readableCount; i += 1) {
                    const filePath = path.join(tmpDir, `readable-${i}.html`);
                    const color = spec.colors[i % spec.colors.length];
                    const html = [
                        '<html><body>',
                        `<div class="p-[13px]" style="color:${color}">content ${i}</div>`,
                        '</body></html>',
                    ].join('\n');
                    fs.writeFileSync(filePath, html, 'utf8');
                    readablePaths.push(filePath);
                }

                // "Unreadable" entries: paths that do not exist on disk so the
                // read fails. They are never created.
                for (let i = 0; i < spec.unreadableCount; i += 1) {
                    unreadablePaths.push(path.join(tmpDir, `missing-${i}.html`));
                }

                // Interleave readable and unreadable paths deterministically so
                // skips are not always clustered at the start/end.
                const allPaths = [];
                let r = 0;
                let u = 0;
                let oi = 0;
                while (r < readablePaths.length || u < unreadablePaths.length) {
                    const pickUnreadable = spec.order[oi % Math.max(spec.order.length, 1)] === true;
                    oi += 1;
                    if (pickUnreadable && u < unreadablePaths.length) {
                        allPaths.push(unreadablePaths[u]);
                        u += 1;
                    } else if (r < readablePaths.length) {
                        allPaths.push(readablePaths[r]);
                        r += 1;
                    } else {
                        allPaths.push(unreadablePaths[u]);
                        u += 1;
                    }
                }

                // 1) The audit must complete without aborting/throwing.
                let record;
                assert.doesNotThrow(() => {
                    record = audit(allPaths, { baseDir: tmpDir });
                }, 'audit() must not throw when a subset of files is unreadable');

                // 2) Each unreadable path is recorded as a skipped file with a
                //    non-empty reason; no readable path is recorded as skipped.
                const skippedByPath = new Map();
                for (const skip of record.skippedFiles) {
                    skippedByPath.set(path.resolve(skip.filePath), skip);
                }
                assert.strictEqual(
                    record.skippedFiles.length,
                    unreadablePaths.length,
                    'exactly one skipped entry per unreadable path'
                );
                for (const missing of unreadablePaths) {
                    const skip = skippedByPath.get(path.resolve(missing));
                    assert.ok(skip, `unreadable path must be recorded as skipped: ${missing}`);
                    assert.ok(
                        typeof skip.reason === 'string' && skip.reason.length > 0,
                        'skipped file must carry a non-empty failure reason'
                    );
                }
                for (const readable of readablePaths) {
                    assert.ok(
                        !skippedByPath.has(path.resolve(readable)),
                        `readable file must not be skipped: ${readable}`
                    );
                }

                // 3) Every readable file is still scanned: collect the file
                //    paths of all findings and confirm each readable file
                //    produced at least one finding.
                const scannedPaths = new Set();
                for (const group of Object.values(record.byDirectory)) {
                    for (const finding of group.findings) {
                        scannedPaths.add(path.resolve(finding.locator.filePath));
                    }
                }
                for (const readable of readablePaths) {
                    assert.ok(
                        scannedPaths.has(path.resolve(readable)),
                        `readable file must still be scanned (findings present): ${readable}`
                    );
                }
            } finally {
                // Clean up temp files regardless of assertion outcome.
                fs.rmSync(tmpDir, { recursive: true, force: true });
            }
        }),
        { numRuns: 150 }
    );

    console.log('[auditor.resilience.property] audit resilience under unreadable files OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testAuditResilienceUnderUnreadableFiles();
    console.log('[auditor.resilience.property] All auditor resilience property tests passed');
}

run();

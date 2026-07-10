'use strict';

/**
 * Unit test for the Changelog Writer write-failure path (Req 13.7).
 *
 * Mirrors the existing project convention (see tests/config-writer.collision.test.js
 * and tests/auditor.no-findings.test.js): plain Node built-in `assert`, named
 * test functions, and a `run()` driver that throws (non-zero exit) on the first
 * failed assertion. No external test framework is introduced.
 *
 * Requirement 13.7: WHEN the changelog cannot be produced/written, the tool
 * SHALL retain all refactored files unchanged and return an error indicating
 * the changelog was not generated.
 *
 * `writeChangelog(targetPath, changelog)` is the only side-effecting export and,
 * per its contract, NEVER throws: it returns `{ ok: false, error }` carrying a
 * `ChangelogNotGeneratedError` (code 'CHANGELOG_NOT_GENERATED') on failure, or
 * `{ ok: true, path, content }` on success.
 *
 * To force a real write failure deterministically (cross-platform) we create a
 * temp FILE and then target `<thatFile>/changelog.md`. Because the parent path
 * is an existing regular file (not a directory), the internal `mkdirSync` /
 * `writeFileSync` calls fail (ENOTDIR / EEXIST). We then assert that:
 *   - the result is `{ ok: false }` (no throw),
 *   - `result.error` is a ChangelogNotGeneratedError with the expected code,
 *   - no changelog file was created on disk.
 *
 * The happy path and the invalid-target path are covered too so the test pins
 * down the full return contract.
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/changelog-writer.failure.test.js
 *
 * _Requirements: 13.7_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
    buildChangelog,
    writeChangelog,
    ChangelogNotGeneratedError,
} = require(path.join(__dirname, '..', 'io', 'changelog-writer.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a valid, non-trivial Changelog model via the pure `buildChangelog`
 * assembler so the test exercises real rendered content (not an empty doc).
 */
function sampleChangelog() {
    return buildChangelog({
        processedDirectories: ['src', 'src/components'],
        changeRecords: [
            { directory: 'src', category: 'arbitrary-to-token' },
            { directory: 'src/components', category: 'physical-to-logical' },
        ],
        newTokens: [{ name: '--color-primary', value: '#3b6ac5', origin: 'audit' }],
        newComponentClasses: [
            { name: 'btn-primary', declaration: '.btn-primary { @apply px-4 py-2; }', origin: 'audit' },
        ],
        reviewItems: [],
        mirrorExclusion: { excludedFileCount: 2 },
    });
}

/**
 * Assert a failure result shape: not ok, carries a ChangelogNotGeneratedError
 * with code 'CHANGELOG_NOT_GENERATED', and never throws to get there.
 */
function assertNotGenerated(result, description) {
    assert.ok(result && typeof result === 'object', `${description}: a result object is returned`);
    assert.strictEqual(result.ok, false, `${description}: result.ok must be false`);
    assert.ok(result.error, `${description}: result carries an error`);
    assert.ok(
        result.error instanceof ChangelogNotGeneratedError,
        `${description}: error should be a ChangelogNotGeneratedError (got ${result.error && result.error.name})`
    );
    assert.strictEqual(
        result.error.code,
        'CHANGELOG_NOT_GENERATED',
        `${description}: error code should be CHANGELOG_NOT_GENERATED`
    );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/**
 * Write failure (parent path is a file): writeChangelog returns a not-generated
 * error result, does not throw, and creates no changelog file (Req 13.7).
 */
function testWriteFailureReturnsNotGeneratedAndWritesNothing() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-changelog-fail-'));
    try {
        // A regular file standing in for what would be a directory.
        const blockerFile = path.join(tmpDir, 'blocker');
        fs.writeFileSync(blockerFile, 'not a directory', 'utf8');

        // Target lives "under" the blocker file, so mkdir/writeFile must fail.
        const targetPath = path.join(blockerFile, 'changelog.md');

        let result;
        assert.doesNotThrow(() => {
            result = writeChangelog(targetPath, sampleChangelog());
        }, 'writeChangelog must not throw on a write failure');

        assertNotGenerated(result, 'write failure (parent is a file)');

        // No changelog file was created on disk; the blocker file is unchanged,
        // standing in for "refactored files retained unchanged" (Req 13.7).
        assert.ok(!fs.existsSync(targetPath), 'no changelog file is created on write failure');
        assert.strictEqual(
            fs.readFileSync(blockerFile, 'utf8'),
            'not a directory',
            'pre-existing files are left unchanged on failure'
        );

        console.log(
            '[changelog-writer.failure.test] write failure -> CHANGELOG_NOT_GENERATED, nothing written OK'
        );
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

/**
 * Invalid target (empty / non-string): writeChangelog returns a not-generated
 * error result rather than throwing.
 */
function testInvalidTargetReturnsNotGenerated() {
    for (const badTarget of ['', null, undefined, 42]) {
        let result;
        assert.doesNotThrow(() => {
            result = writeChangelog(badTarget, sampleChangelog());
        }, `writeChangelog must not throw for invalid target ${JSON.stringify(badTarget)}`);

        assertNotGenerated(result, `invalid target ${JSON.stringify(badTarget)}`);
    }

    console.log('[changelog-writer.failure.test] invalid targetPath -> CHANGELOG_NOT_GENERATED OK');
}

/**
 * Happy path: a writable target under a temp dir returns ok:true and the file
 * is created with the rendered content. Confirms the failure assertions above
 * are meaningful (the writer does succeed when it can).
 */
function testSuccessPathWritesFile() {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-changelog-ok-'));
    try {
        // Nested target dir that does not exist yet, to exercise mkdir recursive.
        const targetPath = path.join(tmpDir, 'out', 'changelog.md');

        let result;
        assert.doesNotThrow(() => {
            result = writeChangelog(targetPath, sampleChangelog());
        }, 'writeChangelog must not throw on the success path');

        assert.strictEqual(result.ok, true, 'success result.ok must be true');
        assert.strictEqual(result.path, path.resolve(targetPath), 'result.path is the resolved target');
        assert.ok(typeof result.content === 'string' && result.content.length > 0, 'result carries content');
        assert.ok(fs.existsSync(targetPath), 'the changelog file is created');
        assert.strictEqual(
            fs.readFileSync(targetPath, 'utf8'),
            result.content,
            'the written file matches the returned content'
        );

        console.log('[changelog-writer.failure.test] success path -> file written OK');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testWriteFailureReturnsNotGeneratedAndWritesNothing();
    testInvalidTargetReturnsNotGenerated();
    testSuccessPathWritesFile();
    console.log('[changelog-writer.failure.test] All changelog write-failure unit tests passed');
}

run();

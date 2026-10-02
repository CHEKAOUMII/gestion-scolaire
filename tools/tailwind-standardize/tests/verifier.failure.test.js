'use strict';

/**
 * Integration test for the Verifier forced-failure halt (Req 11.7).
 *
 * Mirrors the existing project convention (see tests/scope-resolver.halt.test.js
 * and tests/auditor.no-findings.test.js): plain Node built-in `assert`, named
 * test functions, and a `run()` driver that throws (non-zero exit) on the first
 * failed assertion. No external test framework is introduced.
 *
 * `verify()` is the I/O shell: it shells out to the workspace's npm scripts in a
 * fixed sequence (css:build -> test:smoke -> lint -> test). To exercise the
 * failure/halt behaviour deterministically and WITHOUT touching the real project
 * build, each test materializes a throwaway workspace under os.tmpdir() with a
 * hand-written package.json whose scripts are cross-platform `node -e ...`
 * one-liners that pass or fail on demand. Temp workspaces are removed in a
 * `finally` block.
 *
 * Cases:
 *   A. `css:build` fails (exit 1). The gate must report the failed command,
 *      halt, mark the build step 'failed', and leave a pre-existing
 *      Compiled_Stylesheet byte-for-byte unchanged (Req 11.2).
 *   B. `css:build` succeeds (emits css/tailwind-output.css containing
 *      --color-primary) but `test:smoke` fails (exit 1). The gate must report
 *      test:smoke as the failed command, halt, and must NOT have run the later
 *      lint/test steps.
 *
 * Run directly:
 *   node tools/tailwind-standardize/tests/verifier.failure.test.js
 *
 * _Requirements: 11.7 (and 11.2 for the unchanged-stylesheet assertion)_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const { verify } = require(path.join(__dirname, '..', 'io', 'verifier.js'));

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// Cross-platform npm script fragments built from `node -e`. No double quotes
// appear inside the script bodies so they survive both cmd.exe and POSIX shells
// once wrapped by npm.
const FAIL = 'node -e "process.exit(1)"';
const PASS = 'node -e "process.exit(0)"';
// A build that actually emits the Compiled_Stylesheet with the required token.
const BUILD_WRITES_STYLESHEET =
    "node -e \"const fs=require('fs');fs.mkdirSync('css',{recursive:true});" +
    "fs.writeFileSync('css/tailwind-output.css',':root{--color-primary:#3b6ac5}')\"";

/**
 * Create a temp workspace with the given npm scripts map written to
 * package.json.
 * @param {string} prefix mkdtemp prefix
 * @param {Record<string,string>} scripts npm scripts to declare
 * @returns {string} absolute workspace root
 */
function createWorkspace(prefix, scripts) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
    const pkg = {
        name: 'tw-verifier-fixture',
        version: '0.0.0',
        private: true,
        scripts,
    };
    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    return root;
}

/** Remove the temp workspace tree (best effort). */
function cleanup(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        // Best-effort cleanup; do not fail the test over a leftover temp dir.
    }
}

/** Find the recorded step object by logical name, or undefined. */
function findStep(result, name) {
    return result.steps.find((s) => s.name === name);
}

// ---------------------------------------------------------------------------
// Case A: css:build fails -> halt, previous stylesheet left unchanged (Req 11.2)
// ---------------------------------------------------------------------------

function testBuildFailureHaltsAndPreservesStylesheet() {
    const root = createWorkspace('tw-verify-buildfail-', {
        'css:build': FAIL,
        'test:smoke': PASS,
        lint: PASS,
        test: PASS,
    });
    try {
        // Pre-create a previous Compiled_Stylesheet with known content.
        const cssDir = path.join(root, 'css');
        const stylesheetPath = path.join(cssDir, 'tailwind-output.css');
        const previousContent = '/* previous build */\n:root{--color-primary:#abc123}\n';
        fs.mkdirSync(cssDir, { recursive: true });
        fs.writeFileSync(stylesheetPath, previousContent, 'utf8');

        const result = verify({ workspaceRoot: root });

        assert.strictEqual(result.ok, false, 'result.ok must be false when css:build fails');
        assert.strictEqual(
            result.failedCommand,
            'npm run css:build',
            'failedCommand must name the failing build command'
        );
        assert.strictEqual(result.halt, true, 'result.halt must be true on build failure');

        const buildStep = findStep(result, 'css:build');
        assert.ok(buildStep, 'a css:build step must be recorded');
        assert.strictEqual(buildStep.status, 'failed', "css:build step status must be 'failed'");

        // Req 11.2: the previous Compiled_Stylesheet is left unchanged.
        const afterContent = fs.readFileSync(stylesheetPath, 'utf8');
        assert.strictEqual(
            afterContent,
            previousContent,
            'previous tailwind-output.css must be left unchanged after a failed build'
        );

        console.log('[verifier.failure.test] build failure halts and preserves previous stylesheet OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Case B: build passes, test:smoke fails -> halt before lint/test (Req 11.7)
// ---------------------------------------------------------------------------

function testSmokeFailureHaltsBeforeLaterSteps() {
    const root = createWorkspace('tw-verify-smokefail-', {
        'css:build': BUILD_WRITES_STYLESHEET,
        'test:smoke': FAIL,
        lint: PASS,
        test: PASS,
    });
    try {
        const result = verify({ workspaceRoot: root });

        assert.strictEqual(result.ok, false, 'result.ok must be false when test:smoke fails');
        assert.strictEqual(
            result.failedCommand,
            'npm run test:smoke',
            'failedCommand must name the failing test:smoke command'
        );
        assert.strictEqual(result.halt, true, 'result.halt must be true on smoke failure');

        // The build must have succeeded and produced the stylesheet with the token.
        const buildStep = findStep(result, 'css:build');
        assert.ok(buildStep, 'a css:build step must be recorded');
        assert.strictEqual(buildStep.status, 'passed', "css:build step status must be 'passed'");
        assert.strictEqual(result.stylesheet.produced, true, 'the build must have produced the stylesheet');
        assert.strictEqual(
            result.stylesheet.hasRequiredToken,
            true,
            'the produced stylesheet must contain --color-primary'
        );

        // The smoke step is the one that failed.
        const smokeStep = findStep(result, 'test:smoke');
        assert.ok(smokeStep, 'a test:smoke step must be recorded');
        assert.strictEqual(smokeStep.status, 'failed', "test:smoke step status must be 'failed'");

        // Req 11.7: later steps must NOT have run after the halt.
        const lintStep = findStep(result, 'lint');
        const testStep = findStep(result, 'test');
        assert.strictEqual(lintStep, undefined, 'lint step must not run after a smoke-test halt');
        assert.strictEqual(testStep, undefined, 'test step must not run after a smoke-test halt');

        // Cross-check: no recorded step beyond test:smoke is marked passed/failed.
        const ranLater = result.steps.some(
            (s) => (s.name === 'lint' || s.name === 'test') && (s.status === 'passed' || s.status === 'failed')
        );
        assert.strictEqual(ranLater, false, 'no later step should be marked passed/failed after the halt');

        console.log('[verifier.failure.test] smoke failure halts before lint/test OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testBuildFailureHaltsAndPreservesStylesheet();
    testSmokeFailureHaltsBeforeLaterSteps();
    console.log('[verifier.failure.test] All forced verification-failure halt integration tests passed');
}

run();

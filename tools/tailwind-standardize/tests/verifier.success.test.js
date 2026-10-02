'use strict';

/**
 * Integration test for the successful build/verify gate (Req 11.1, 11.2, 11.4).
 *
 * Mirrors the existing project convention (see tests/scope-resolver.halt.test.js
 * and tests/models.test.js): plain Node built-in `assert`, a set of named test
 * functions, and a `run()` driver that throws (non-zero exit) on the first
 * failed assertion. No external test framework is introduced.
 *
 * The Verifier runs real npm scripts via `child_process`. To keep this test fast
 * and independent of the real project build, it provisions a TEMP workspace whose
 * package.json declares trivial, fast, cross-platform scripts:
 *   - `css:build`  actually PRODUCES css/tailwind-output.css containing the
 *                  `--color-primary` Design_Token (Req 11.1, 11.4) via a small
 *                  inline `node -e` program, with a zero exit code.
 *   - `test:smoke`, `lint`, `test`  are trivial successful no-ops.
 *
 * With those scripts, `verify({ workspaceRoot, lintBaseline: Infinity })` must
 * report overall success: the gate is green, the stylesheet was produced and
 * carries the required token, and the css:build step is `passed`.
 *
 * Run directly:  node tools/tailwind-standardize/tests/verifier.success.test.js
 *
 * _Requirements: 11.1, 11.2, 11.4_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const verifier = require(path.join(__dirname, '..', 'io', 'verifier.js'));

const { verify, REQUIRED_TOKEN, COMPILED_STYLESHEET_REL } = verifier;

/**
 * Create a temporary workspace that simulates a successful build. The `css:build`
 * script writes css/tailwind-output.css containing the required `--color-primary`
 * token; the remaining gate scripts are trivial successes.
 *
 * @returns {string} absolute path to the temp workspace root
 */
function createSuccessfulWorkspace() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-verify-ok-'));

    // Inline node program for css:build: create css/ and write the compiled
    // stylesheet containing --color-primary, then exit 0. Single-quoted JS body
    // so it survives shell quoting on both Windows and POSIX.
    const buildJs =
        "require('fs').mkdirSync('css',{recursive:true});" +
        "require('fs').writeFileSync('css/tailwind-output.css','--color-primary: #3b6ac5; /* built */')";

    const pkg = {
        name: 'tw-verify-success-fixture',
        version: '1.0.0',
        private: true,
        scripts: {
            'css:build': `node -e "${buildJs}"`,
            'test:smoke': 'node -e "process.exit(0)"',
            lint: 'node -e "process.exit(0)"',
            test: 'node -e "process.exit(0)"',
        },
    };

    fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2), 'utf8');
    return root;
}

/** Remove the temp workspace tree (best-effort). */
function cleanup(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        // Best-effort cleanup; do not fail the test over a leftover temp dir.
    }
}

// ---------------------------------------------------------------------------
// A successful build/verify gate reports success and a produced stylesheet
// ---------------------------------------------------------------------------

function testSuccessfulGateReportsSuccess() {
    const root = createSuccessfulWorkspace();
    try {
        const result = verify({ workspaceRoot: root, lintBaseline: Infinity });

        // Overall gate is green (Req 11.1).
        assert.strictEqual(result.ok, true, 'gate should report overall success');
        assert.strictEqual(result.failedCommand, undefined, 'no failed command on success');
        assert.strictEqual(result.halt, false, 'gate should not signal a halt on success');

        // The Compiled_Stylesheet was produced and carries --color-primary (Req 11.1, 11.4).
        assert.strictEqual(result.stylesheet.produced, true, 'stylesheet should be produced by css:build');
        assert.strictEqual(
            result.stylesheet.hasRequiredToken,
            true,
            `stylesheet should contain the ${REQUIRED_TOKEN} token`
        );

        // The css:build step itself is recorded as passed with a zero exit code.
        const buildStep = result.steps.find((step) => step.name === 'css:build');
        assert.ok(buildStep, 'css:build step should be present in the gate steps');
        assert.strictEqual(buildStep.status, 'passed', 'css:build step status should be passed');
        assert.strictEqual(buildStep.exitCode, 0, 'css:build should complete with a zero exit code');
        assert.strictEqual(buildStep.hasRequiredToken, true, 'css:build step should report the required token');

        // The compiled stylesheet really exists on disk with the token (Req 11.1, 11.4).
        const stylesheetOnDisk = fs.readFileSync(path.join(root, COMPILED_STYLESHEET_REL), 'utf8');
        assert.ok(
            stylesheetOnDisk.includes(REQUIRED_TOKEN),
            'compiled stylesheet on disk should contain the required token'
        );

        console.log('[verifier.success.test] successful build/verify gate reports success OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testSuccessfulGateReportsSuccess();
    console.log('[verifier.success.test] All successful build/verify gate integration tests passed');
}

run();

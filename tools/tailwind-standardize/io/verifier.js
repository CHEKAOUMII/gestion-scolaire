'use strict';

/**
 * Verifier (I/O shell) for the Tailwind CSS Standardization tool.
 *
 * The Verifier is the gate that stands between a directory's edits and the
 * pipeline moving on to the next directory. It runs the project's existing
 * build and test commands, in a fixed sequence, and reports the first command
 * that fails so the Refactorer can halt before applying further refactoring
 * (Req 11.7).
 *
 * Sequence:
 *   1. `npm run css:build`  — must complete with a zero exit code and produce
 *      the Compiled_Stylesheet (`css/tailwind-output.css`), which must contain
 *      the `--color-primary` Design_Token (Req 11.1, 11.4). On build failure the
 *      previous `tailwind-output.css` is left unchanged (Req 11.2): we snapshot
 *      its bytes before the build and restore them if the build fails.
 *   2. `npm run test:smoke` — Smoke_Suite must pass (Req 11.3).
 *   3. `npm run lint`       — reported lint error count must be <= the recorded
 *      pre-refactor baseline (Req 11.5).
 *   4. `npm test`           — full test run must pass (Req 11.6).
 *
 * On any failure the Verifier returns `{ ok: false, failedCommand, halt: true }`
 * and stops running later commands (Req 11.7).
 *
 * Missing scripts degrade gracefully: a step whose npm script is not declared in
 * package.json is recorded with status `'skipped'` (reason `'script-unavailable'`)
 * and does not fail the run, while the intended sequence is preserved.
 *
 * This module performs process execution and read-only/limited file system
 * access (snapshotting and restoring the compiled stylesheet only). The pure
 * core never calls it. CommonJS + Node built-ins (`child_process`, `fs`, `path`)
 * to match existing project conventions.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7_
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

/** Relative path (from workspace root) of the Compiled_Stylesheet. */
const COMPILED_STYLESHEET_REL = path.join('css', 'tailwind-output.css');

/** The Design_Token the Smoke_Suite Tailwind output check requires (Req 11.4). */
const REQUIRED_TOKEN = '--color-primary';

/**
 * The npm scripts the Verifier runs, in order. Each entry names the logical
 * step, the npm script to invoke, and its role in the sequence so the result
 * can be reported precisely.
 */
const STEP_BUILD = 'css:build';
const STEP_SMOKE = 'test:smoke';
const STEP_LINT = 'lint';
const STEP_TEST = 'test';

/**
 * Read the `scripts` map from the workspace `package.json`. Returns an empty
 * object when it cannot be read or parsed, so a missing manifest degrades to
 * "all scripts unavailable" rather than crashing the Verifier.
 *
 * @param {string} workspaceRoot
 * @returns {Record<string, string>}
 */
function readPackageScripts(workspaceRoot) {
    const pkgPath = path.resolve(workspaceRoot, 'package.json');
    try {
        const raw = fs.readFileSync(pkgPath, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed.scripts === 'object' && parsed.scripts !== null) {
            return parsed.scripts;
        }
    } catch (err) {
        // Fall through: treat as no scripts declared.
    }
    return {};
}

/**
 * Run an npm script synchronously with the workspace root as cwd, capturing the
 * exit code and combined stdout/stderr. `npm` is resolved via the shell so this
 * works on both Windows (`npm.cmd`) and POSIX without hard-coding the binary.
 *
 * @param {string} scriptName the npm script to run (e.g. `css:build`)
 * @param {string} workspaceRoot absolute path used as cwd
 * @returns {{ exitCode: number, stdout: string, stderr: string, error: string|null }}
 */
function runNpmScript(scriptName, workspaceRoot) {
    const result = spawnSync('npm', ['run', scriptName], {
        cwd: workspaceRoot,
        encoding: 'utf8',
        shell: true,
    });

    if (result.error) {
        return {
            exitCode: typeof result.status === 'number' ? result.status : 1,
            stdout: result.stdout || '',
            stderr: result.stderr || '',
            error: result.error.message,
        };
    }

    return {
        exitCode: typeof result.status === 'number' ? result.status : 1,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
        error: null,
    };
}

/**
 * Parse the count of lint *errors* from ESLint output. ESLint's default
 * formatter prints a summary line such as:
 *   "✖ 7 problems (3 errors, 4 warnings)"
 * We extract the error count from that line. When no summary is present (clean
 * run), the error count is 0.
 *
 * @param {string} output combined stdout+stderr from the lint run
 * @returns {number} the reported number of lint errors
 */
function parseLintErrorCount(output) {
    if (typeof output !== 'string' || output.length === 0) {
        return 0;
    }
    // Match "(N error" / "(N errors" inside the ESLint summary line.
    const match = output.match(/(\d+)\s+errors?\b/);
    if (match) {
        return Number.parseInt(match[1], 10);
    }
    return 0;
}

/**
 * Snapshot the current bytes of the Compiled_Stylesheet so the previous output
 * can be restored verbatim if the build fails (Req 11.2).
 *
 * @param {string} stylesheetPath absolute path to css/tailwind-output.css
 * @returns {{ existed: boolean, contents: Buffer|null }}
 */
function snapshotStylesheet(stylesheetPath) {
    try {
        const contents = fs.readFileSync(stylesheetPath);
        return { existed: true, contents };
    } catch (err) {
        return { existed: false, contents: null };
    }
}

/**
 * Restore the Compiled_Stylesheet from a snapshot taken before a failed build,
 * so the previous output is left unchanged (Req 11.2). When the file did not
 * exist before the build, any partial output produced by the failed build is
 * removed.
 *
 * @param {string} stylesheetPath absolute path to css/tailwind-output.css
 * @param {{ existed: boolean, contents: Buffer|null }} snapshot
 */
function restoreStylesheet(stylesheetPath, snapshot) {
    try {
        if (snapshot.existed && snapshot.contents !== null) {
            fs.writeFileSync(stylesheetPath, snapshot.contents);
        } else if (fs.existsSync(stylesheetPath)) {
            fs.unlinkSync(stylesheetPath);
        }
    } catch (err) {
        // Best-effort restore: surface nothing here; the build failure itself is
        // already reported by the caller.
    }
}

/**
 * Inspect the Compiled_Stylesheet produced by the build: confirm it exists and
 * contains the required `--color-primary` Design_Token (Req 11.1, 11.4).
 *
 * @param {string} stylesheetPath absolute path to css/tailwind-output.css
 * @returns {{ produced: boolean, hasRequiredToken: boolean }}
 */
function inspectStylesheet(stylesheetPath) {
    try {
        const contents = fs.readFileSync(stylesheetPath, 'utf8');
        return {
            produced: true,
            hasRequiredToken: contents.includes(REQUIRED_TOKEN),
        };
    } catch (err) {
        return { produced: false, hasRequiredToken: false };
    }
}

/**
 * Build a uniform step result object.
 *
 * @param {string} name logical step name
 * @param {string} scriptName npm script invoked
 * @param {'passed'|'failed'|'skipped'} status
 * @param {object} [extra] additional fields (exitCode, reason, etc.)
 * @returns {object}
 */
function makeStep(name, scriptName, status, extra = {}) {
    return Object.assign(
        {
            name,
            command: `npm run ${scriptName}`,
            script: scriptName,
            status,
        },
        extra
    );
}

/**
 * Run the full verification gate for a directory.
 *
 * @param {{
 *   workspaceRoot?: string,   // absolute path; defaults to two levels up from this file's tool dir
 *   lintBaseline?: number,    // recorded pre-refactor lint error count (Req 11.5); defaults to Infinity (no regression possible)
 * }} [options]
 * @returns {{
 *   ok: boolean,
 *   failedCommand: string|undefined,
 *   halt: boolean,
 *   steps: object[],
 *   stylesheet: { path: string, produced: boolean, hasRequiredToken: boolean },
 *   lint: { baseline: number, errorCount: number|null },
 * }}
 * @see Requirements 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7
 */
function verify(options = {}) {
    const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
    const lintBaseline =
        typeof options.lintBaseline === 'number' && Number.isFinite(options.lintBaseline)
            ? options.lintBaseline
            : Infinity;

    const scripts = readPackageScripts(workspaceRoot);
    const hasScript = (name) => Object.prototype.hasOwnProperty.call(scripts, name);

    const stylesheetPath = path.resolve(workspaceRoot, COMPILED_STYLESHEET_REL);

    const steps = [];
    const lintResult = { baseline: lintBaseline === Infinity ? null : lintBaseline, errorCount: null };
    let stylesheetState = { path: stylesheetPath, produced: false, hasRequiredToken: false };

    // --- Step 1: css:build (Req 11.1, 11.2, 11.4) ---------------------------
    if (!hasScript(STEP_BUILD)) {
        steps.push(makeStep(STEP_BUILD, STEP_BUILD, 'skipped', { reason: 'script-unavailable' }));
        // Without a build we cannot assert the stylesheet was produced by us;
        // still inspect whatever is present so downstream reporting is accurate.
        stylesheetState = Object.assign(stylesheetState, inspectStylesheet(stylesheetPath));
    } else {
        const snapshot = snapshotStylesheet(stylesheetPath);
        const build = runNpmScript(STEP_BUILD, workspaceRoot);
        const inspection = inspectStylesheet(stylesheetPath);
        const buildOk = build.exitCode === 0 && inspection.produced && inspection.hasRequiredToken;

        stylesheetState = Object.assign(stylesheetState, inspection);

        if (!buildOk) {
            // Leave the previous Compiled_Stylesheet unchanged (Req 11.2).
            restoreStylesheet(stylesheetPath, snapshot);
            const restored = inspectStylesheet(stylesheetPath);
            stylesheetState = Object.assign({ path: stylesheetPath }, restored);

            steps.push(
                makeStep(STEP_BUILD, STEP_BUILD, 'failed', {
                    exitCode: build.exitCode,
                    produced: inspection.produced,
                    hasRequiredToken: inspection.hasRequiredToken,
                    error: build.error,
                    previousStylesheetRestored: snapshot.existed,
                })
            );
            return finalize(steps, `npm run ${STEP_BUILD}`, stylesheetState, lintResult);
        }

        steps.push(
            makeStep(STEP_BUILD, STEP_BUILD, 'passed', {
                exitCode: build.exitCode,
                produced: inspection.produced,
                hasRequiredToken: inspection.hasRequiredToken,
            })
        );
    }

    // --- Step 2: test:smoke (Req 11.3) --------------------------------------
    if (!hasScript(STEP_SMOKE)) {
        steps.push(makeStep(STEP_SMOKE, STEP_SMOKE, 'skipped', { reason: 'script-unavailable' }));
    } else {
        const smoke = runNpmScript(STEP_SMOKE, workspaceRoot);
        if (smoke.exitCode !== 0) {
            steps.push(makeStep(STEP_SMOKE, STEP_SMOKE, 'failed', { exitCode: smoke.exitCode, error: smoke.error }));
            return finalize(steps, `npm run ${STEP_SMOKE}`, stylesheetState, lintResult);
        }
        steps.push(makeStep(STEP_SMOKE, STEP_SMOKE, 'passed', { exitCode: smoke.exitCode }));
    }

    // --- Step 3: lint (Req 11.5) --------------------------------------------
    // Lint may exit non-zero simply because errors exist; the gate is whether the
    // reported error count stays <= the recorded pre-refactor baseline.
    if (!hasScript(STEP_LINT)) {
        steps.push(makeStep(STEP_LINT, STEP_LINT, 'skipped', { reason: 'script-unavailable' }));
    } else {
        const lint = runNpmScript(STEP_LINT, workspaceRoot);
        const errorCount = parseLintErrorCount(`${lint.stdout}\n${lint.stderr}`);
        lintResult.errorCount = errorCount;

        if (errorCount > lintBaseline) {
            steps.push(
                makeStep(STEP_LINT, STEP_LINT, 'failed', {
                    exitCode: lint.exitCode,
                    errorCount,
                    baseline: lintBaseline === Infinity ? null : lintBaseline,
                    error: lint.error,
                })
            );
            return finalize(steps, `npm run ${STEP_LINT}`, stylesheetState, lintResult);
        }

        steps.push(
            makeStep(STEP_LINT, STEP_LINT, 'passed', {
                exitCode: lint.exitCode,
                errorCount,
                baseline: lintBaseline === Infinity ? null : lintBaseline,
            })
        );
    }

    // --- Step 4: test (Req 11.6) --------------------------------------------
    if (!hasScript(STEP_TEST)) {
        steps.push(makeStep(STEP_TEST, STEP_TEST, 'skipped', { reason: 'script-unavailable' }));
    } else {
        const test = runNpmScript(STEP_TEST, workspaceRoot);
        if (test.exitCode !== 0) {
            steps.push(makeStep(STEP_TEST, STEP_TEST, 'failed', { exitCode: test.exitCode, error: test.error }));
            return finalize(steps, `npm run ${STEP_TEST}`, stylesheetState, lintResult);
        }
        steps.push(makeStep(STEP_TEST, STEP_TEST, 'passed', { exitCode: test.exitCode }));
    }

    return finalize(steps, undefined, stylesheetState, lintResult);
}

/**
 * Resolve the workspace root. When not supplied, derive it from this file's
 * location: `<root>/tools/tailwind-standardize/io/verifier.js` => `<root>`.
 *
 * @param {string|undefined} provided
 * @returns {string} absolute workspace root path
 */
function resolveWorkspaceRoot(provided) {
    if (typeof provided === 'string' && provided.length > 0) {
        return path.resolve(provided);
    }
    return path.resolve(__dirname, '..', '..', '..');
}

/**
 * Assemble the final verification result. `failedCommand` is set (and
 * `halt: true`) only when a command failed; otherwise `ok: true`.
 *
 * @param {object[]} steps
 * @param {string|undefined} failedCommand
 * @param {object} stylesheetState
 * @param {{ baseline: number|null, errorCount: number|null }} lintResult
 * @returns {object}
 */
function finalize(steps, failedCommand, stylesheetState, lintResult) {
    const ok = failedCommand === undefined;
    return {
        ok,
        failedCommand,
        halt: !ok,
        steps,
        stylesheet: stylesheetState,
        lint: lintResult,
    };
}

module.exports = {
    verify,
    // Exposed for unit/integration tests and reuse.
    runNpmScript,
    readPackageScripts,
    parseLintErrorCount,
    snapshotStylesheet,
    restoreStylesheet,
    inspectStylesheet,
    COMPILED_STYLESHEET_REL,
    REQUIRED_TOKEN,
};

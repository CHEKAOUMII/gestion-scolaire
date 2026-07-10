'use strict';

/**
 * CLI entry point for the Tailwind CSS Standardization tool.
 *
 * Wires the full pipeline end-to-end, integrating every core transform (via the
 * I/O shell modules) with no orphaned code:
 *
 *   audit    : Scope Resolver -> Auditor
 *     1. `io/scope-resolver.js` resolveScope + assertScopeResolved resolve the
 *        Root_HTML_Set / Config_Source and exclude the Mirror_Subtree, halting
 *        before any work when the mirror subtree is expected but unresolved
 *        (Req 12.5).
 *     2. `io/auditor.js` audit scans each root HTML file exactly once and emits
 *        an AuditRecord grouped by directory with per-category counts, skipped
 *        files, and the explicit `noFindings` signal (Req 1.1, 1.8, 1.9).
 *
 *   refactor : Scope Resolver -> Auditor -> Refactorer -> Verifier -> Changelog
 *     1. Resolve scope (as above).
 *     2. Run the read-only audit first so the summary is reported before any
 *        change (Req 1.1).
 *     3. `io/refactorer.js` refactor drives the gated pure transforms per
 *        directory, applying only provably output-preserving edits and running
 *        the Verifier (`io/verifier.js`) as each directory's transaction
 *        boundary. A verification (or Config Writer) failure HALTS the pipeline
 *        before the next directory (Req 11.7).
 *     4. `io/changelog-writer.js` buildChangelog + writeChangelog assemble and
 *        persist the single deliverable changelog from the accumulated refactor
 *        results (processed directories, change records, new tokens, new
 *        component classes, review items, and the mirror-exclusion count). A
 *        write failure is reported as changelog-not-generated (Req 13.7).
 *
 * The pipeline reports clearly and exits non-zero on any halt condition:
 * unresolved scope (Req 12.5), refactor/verification halt (Req 11.7), or
 * changelog-not-generated (Req 13.7).
 *
 * `main()` parses argv (a command plus `--dry-run` / `--workspace <path>`
 * flags) and only auto-runs when this module is invoked directly
 * (`require.main === module`); the command functions are exported for testing.
 *
 * CommonJS + Node built-ins to match existing project conventions.
 *
 * _Requirements: 1.1, 12.1, 13.1_
 */

const path = require('path');

const scopeResolver = require(path.join(__dirname, 'io', 'scope-resolver.js'));
const auditor = require(path.join(__dirname, 'io', 'auditor.js'));
const refactorer = require(path.join(__dirname, 'io', 'refactorer.js'));
const verifier = require(path.join(__dirname, 'io', 'verifier.js'));
const changelogWriter = require(path.join(__dirname, 'io', 'changelog-writer.js'));
const { FINDING_CATEGORIES, NORMALIZATION_CATEGORIES } = require(path.join(__dirname, 'core', 'models.js'));

/** Default changelog deliverable path (relative to the workspace root). */
const DEFAULT_CHANGELOG_REL = path.join('tools', 'tailwind-standardize', 'CHANGELOG.tailwind.md');

/**
 * Resolve the workspace root. When not supplied, derive it from this file's
 * location: `<root>/tools/tailwind-standardize/index.js` => `<root>`.
 *
 * @param {string|undefined} provided
 * @returns {string} absolute workspace root path
 */
function resolveWorkspaceRoot(provided) {
    if (typeof provided === 'string' && provided.length > 0) {
        return path.resolve(provided);
    }
    return path.resolve(__dirname, '..', '..');
}

/**
 * Compute the stable, POSIX-separated directory key for an absolute file path
 * relative to the workspace root. Files directly at the root map to '.'. This
 * mirrors the key scheme the Refactorer and Auditor use so change records fold
 * into the same directory buckets as `processedDirectories` (Req 13.2).
 *
 * @param {string} workspaceRoot
 * @param {string} filePath
 * @returns {string}
 */
function directoryKey(workspaceRoot, filePath) {
    const rel = path.relative(path.resolve(workspaceRoot), path.dirname(path.resolve(filePath)));
    if (rel === '') {
        return '.';
    }
    return rel.split(path.sep).join('/');
}

/**
 * A tiny logger indirection so tests can capture output. Defaults to the
 * console but can be overridden per call.
 * @param {{ log?: Function, error?: Function }} [io]
 * @returns {{ log: Function, error: Function }}
 */
function resolveLogger(io) {
    const log = io && typeof io.log === 'function' ? io.log : console.log;
    const error = io && typeof io.error === 'function' ? io.error : console.error;
    return { log, error };
}

/**
 * Render a human-readable summary of an AuditRecord: per-directory per-category
 * counts, the skipped files, and the explicit no-findings signal.
 *
 * @param {object} record an AuditRecord (frozen)
 * @returns {string}
 */
function formatAuditSummary(record) {
    const lines = [];
    lines.push('Tailwind Standardization — Audit Summary');
    lines.push('========================================');

    if (record.noFindings) {
        lines.push('No non-conforming Tailwind usage was detected.');
    } else {
        lines.push(`Total findings: ${record.totalFindings}`);
    }
    lines.push('');

    const dirKeys = Object.keys(record.byDirectory).sort();
    if (dirKeys.length === 0) {
        lines.push('(no directories scanned)');
    } else {
        for (const dir of dirKeys) {
            const group = record.byDirectory[dir];
            const dirTotal = group.findings.length;
            lines.push(`${dir} (${dirTotal} finding${dirTotal === 1 ? '' : 's'})`);
            for (const category of FINDING_CATEGORIES) {
                const count = group.counts[category] || 0;
                if (count > 0) {
                    lines.push(`  - ${category}: ${count}`);
                }
            }
        }
    }

    lines.push('');
    if (record.skippedFiles.length === 0) {
        lines.push('Skipped files: none');
    } else {
        lines.push(`Skipped files: ${record.skippedFiles.length}`);
        for (const skipped of record.skippedFiles) {
            lines.push(`  - ${skipped.filePath}: ${skipped.reason}`);
        }
    }

    return lines.join('\n');
}

/**
 * Render a short summary of a refactor run for the console.
 * @param {object} result the refactor() result
 * @param {object} scope the resolved scope
 * @returns {string}
 */
function formatRefactorSummary(result, scope) {
    const lines = [];
    lines.push('Tailwind Standardization — Refactor Summary');
    lines.push('===========================================');
    lines.push(`Processed directories: ${result.processedDirectories.length}`);
    lines.push(`Applied changes: ${result.changeRecords.length}`);
    lines.push(`New design tokens: ${result.newTokens.length}`);
    lines.push(`New component classes: ${result.newComponentClasses.length}`);
    lines.push(`Manual-review / excluded items: ${result.reviewItems.length}`);
    lines.push(`Mirror subtree excluded files: ${scope.excludedFiles.length}`);

    // Per-category change tally across the whole run.
    const categoryTotals = {};
    for (const category of NORMALIZATION_CATEGORIES) {
        categoryTotals[category] = 0;
    }
    for (const change of result.changeRecords) {
        categoryTotals[change.category] = (categoryTotals[change.category] || 0) + 1;
    }
    const nonZero = NORMALIZATION_CATEGORIES.filter((category) => categoryTotals[category] > 0);
    if (nonZero.length > 0) {
        lines.push('');
        lines.push('Changes by category:');
        for (const category of nonZero) {
            lines.push(`  - ${category}: ${categoryTotals[category]}`);
        }
    }

    return lines.join('\n');
}

/**
 * Resolve scope and halt cleanly on an unresolved mirror subtree (Req 12.5).
 *
 * @param {string} workspaceRoot
 * @param {{ expectMirror?: boolean }} [options]
 * @returns {{ ok: true, scope: object } | { ok: false, error: Error }}
 */
function resolveScopeOrHalt(workspaceRoot, options = {}) {
    try {
        const scope = scopeResolver.resolveScope(workspaceRoot);
        scopeResolver.assertScopeResolved(scope, {
            expectMirror: options.expectMirror !== false,
        });
        return { ok: true, scope };
    } catch (err) {
        return { ok: false, error: err };
    }
}

/**
 * `audit` command: Scope Resolver -> Auditor. Read-only; never edits anything.
 *
 * @param {{
 *   workspaceRoot?: string,
 *   expectMirror?: boolean,
 *   io?: { log?: Function, error?: Function },
 * }} [options]
 * @returns {{ exitCode: number, record?: object, scope?: object, error?: Error }}
 * @see Requirements 1.1, 12.1
 */
function runAudit(options = {}) {
    const { log, error } = resolveLogger(options.io);
    const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);

    const resolved = resolveScopeOrHalt(workspaceRoot, options);
    if (!resolved.ok) {
        // Unresolved scope: report and exit non-zero before any work (Req 12.5).
        error(`[audit] scope could not be resolved: ${resolved.error.message}`);
        return { exitCode: 1, error: resolved.error };
    }

    const scope = resolved.scope;
    let record;
    try {
        record = auditor.audit(scope);
    } catch (err) {
        error(`[audit] audit failed: ${err.message}`);
        return { exitCode: 1, error: err };
    }

    log(formatAuditSummary(record));
    log('');
    log(
        `Mirror subtree excluded files: ${scope.excludedFiles.length} ` +
            `(under ${scope.mirrorSubtree || scopeResolver.MIRROR_SUBTREE_DIRNAME})`
    );

    return { exitCode: 0, record, scope };
}

/**
 * `refactor` command: Scope Resolver -> Auditor -> Refactorer -> Verifier ->
 * Changelog Writer.
 *
 * @param {{
 *   workspaceRoot?: string,
 *   dryRun?: boolean,
 *   expectMirror?: boolean,
 *   changelogPath?: string,
 *   lintBaseline?: number,
 *   io?: { log?: Function, error?: Function },
 * }} [options]
 * @returns {{
 *   exitCode: number,
 *   record?: object,
 *   result?: object,
 *   changelog?: object,
 *   changelogPath?: string,
 *   scope?: object,
 *   error?: Error,
 * }}
 * @see Requirements 1.1, 12.1, 13.1
 */
function runRefactor(options = {}) {
    const { log, error } = resolveLogger(options.io);
    const workspaceRoot = resolveWorkspaceRoot(options.workspaceRoot);
    const dryRun = options.dryRun === true;

    const resolved = resolveScopeOrHalt(workspaceRoot, options);
    if (!resolved.ok) {
        // Unresolved scope: halt before any normalization (Req 12.5).
        error(`[refactor] scope could not be resolved: ${resolved.error.message}`);
        return { exitCode: 1, error: resolved.error };
    }

    const scope = resolved.scope;

    // Read-only audit first so the operator sees what will be addressed (Req 1.1).
    let record;
    try {
        record = auditor.audit(scope);
        log(formatAuditSummary(record));
        log('');
    } catch (err) {
        error(`[refactor] audit failed: ${err.message}`);
        return { exitCode: 1, error: err };
    }

    // Drive the gated, per-directory transforms + Verifier transaction boundary.
    let result;
    try {
        result = refactorer.refactor(scope, {
            dryRun,
            workspaceRoot,
            lintBaseline: options.lintBaseline,
            verify: verifier.verify,
        });
    } catch (err) {
        error(`[refactor] refactoring failed: ${err.message}`);
        return { exitCode: 1, error: err };
    }

    log(formatRefactorSummary(result, scope));

    // Assemble the changelog from the accumulated refactor results. Change
    // records carry absolute file paths; tag each with the matching POSIX
    // directory key so they fold into the same buckets as the processed
    // directories (Req 13.2).
    const taggedChangeRecords = result.changeRecords.map((change) => ({
        directory: directoryKey(workspaceRoot, change.filePath),
        filePath: change.filePath,
        category: change.category,
    }));

    let changelog;
    try {
        changelog = changelogWriter.buildChangelog({
            processedDirectories: result.processedDirectories,
            changeRecords: taggedChangeRecords,
            newTokens: result.newTokens,
            newComponentClasses: result.newComponentClasses,
            reviewItems: result.reviewItems,
            mirrorExclusion: { excludedFileCount: scope.excludedFiles.length },
        });
    } catch (err) {
        // The changelog could not be assembled: treat as changelog-not-generated
        // and retain refactored files unchanged (Req 13.7).
        error(`[refactor] changelog could not be generated: ${err.message}`);
        return { exitCode: 1, result, scope, error: err };
    }

    const changelogPath = options.changelogPath
        ? path.resolve(options.changelogPath)
        : path.resolve(workspaceRoot, DEFAULT_CHANGELOG_REL);

    const writeResult = changelogWriter.writeChangelog(changelogPath, changelog);
    if (!writeResult.ok) {
        // Changelog write failure (Req 13.7): report and exit non-zero.
        error(`[refactor] changelog was not generated: ${writeResult.error.message}`);
        return { exitCode: 1, result, changelog, scope, error: writeResult.error };
    }

    log('');
    log(`Changelog written to: ${writeResult.path}`);

    // A refactor/verification (or Config Writer) halt is a non-zero exit even
    // though the changelog is still produced for the committed directories
    // (Req 11.7). The directories already committed keep their prior good state.
    if (result.halted) {
        error(
            `[refactor] pipeline halted before completing all directories: ${result.failedCommand || 'verification failed'}`
        );
        return {
            exitCode: 1,
            record,
            result,
            changelog,
            changelogPath: writeResult.path,
            scope,
        };
    }

    return {
        exitCode: 0,
        record,
        result,
        changelog,
        changelogPath: writeResult.path,
        scope,
    };
}

/**
 * Parse argv into a command plus flags. Recognizes:
 *   <command>            audit | refactor
 *   --dry-run            compute + record edits without writing / verifying
 *   --workspace <path>   override the workspace root
 *   --changelog <path>   override the changelog output path
 *   --lint-baseline <n>  forwarded to the Verifier (Req 11.5)
 *
 * @param {string[]} argv typically process.argv.slice(2)
 * @returns {{ command: string|null, dryRun: boolean, workspaceRoot?: string,
 *            changelogPath?: string, lintBaseline?: number }}
 */
function parseArgs(argv) {
    const parsed = { command: null, dryRun: false };
    const args = Array.isArray(argv) ? argv.slice() : [];

    while (args.length > 0) {
        const arg = args.shift();
        if (arg === '--dry-run') {
            parsed.dryRun = true;
        } else if (arg === '--workspace' || arg === '-w') {
            parsed.workspaceRoot = args.shift();
        } else if (arg === '--changelog') {
            parsed.changelogPath = args.shift();
        } else if (arg === '--lint-baseline') {
            const value = Number.parseInt(args.shift(), 10);
            if (Number.isFinite(value)) {
                parsed.lintBaseline = value;
            }
        } else if (arg.startsWith('--workspace=')) {
            parsed.workspaceRoot = arg.slice('--workspace='.length);
        } else if (arg.startsWith('--changelog=')) {
            parsed.changelogPath = arg.slice('--changelog='.length);
        } else if (arg.startsWith('--lint-baseline=')) {
            const value = Number.parseInt(arg.slice('--lint-baseline='.length), 10);
            if (Number.isFinite(value)) {
                parsed.lintBaseline = value;
            }
        } else if (!arg.startsWith('-') && parsed.command === null) {
            parsed.command = arg;
        }
        // Unknown flags are ignored so the CLI stays forgiving.
    }

    return parsed;
}

/**
 * Parse argv, dispatch to the requested command, and return a process exit
 * code. Does NOT call `process.exit` itself so it stays testable.
 *
 * @param {string[]} [argv] defaults to process.argv.slice(2)
 * @param {{ io?: { log?: Function, error?: Function } }} [deps]
 * @returns {number} exit code
 */
function main(argv, deps = {}) {
    const { log, error } = resolveLogger(deps.io);
    const args = parseArgs(argv === undefined ? process.argv.slice(2) : argv);

    const commonOptions = {
        workspaceRoot: args.workspaceRoot,
        dryRun: args.dryRun,
        changelogPath: args.changelogPath,
        lintBaseline: args.lintBaseline,
        io: deps.io,
    };

    switch (args.command) {
        case 'audit': {
            return runAudit(commonOptions).exitCode;
        }
        case 'refactor': {
            return runRefactor(commonOptions).exitCode;
        }
        case null:
        case undefined: {
            error('Usage: node tools/tailwind-standardize/index.js <audit|refactor> [--dry-run] [--workspace <path>] [--changelog <path>] [--lint-baseline <n>]');
            return 2;
        }
        default: {
            error(`Unknown command: ${args.command}`);
            error('Usage: node tools/tailwind-standardize/index.js <audit|refactor> [--dry-run] [--workspace <path>]');
            log(''); // keep output stream symmetric
            return 2;
        }
    }
}

// Only auto-run when invoked directly; export the command functions for testing.
if (require.main === module) {
    process.exitCode = main(process.argv.slice(2));
}

module.exports = {
    main,
    runAudit,
    runRefactor,
    parseArgs,
    resolveWorkspaceRoot,
    directoryKey,
    formatAuditSummary,
    formatRefactorSummary,
    DEFAULT_CHANGELOG_REL,
};

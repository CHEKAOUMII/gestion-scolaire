'use strict';

/**
 * Property-based tests for the Scope Resolver (I/O shell).
 *
 * Mirrors the existing project convention (see tests/smoke.js and
 * tools/tailwind-standardize/tests/models.test.js): plain Node built-in
 * `assert`, named test functions, and a `run()` driver that throws (non-zero
 * exit) on the first failed assertion. The only added dependency is
 * `fast-check` (already a dev dependency, v4).
 *
 * Because `resolveScope` reads the real file system, each generated workspace
 * layout is materialized under a fresh temporary directory beneath
 * `os.tmpdir()`, exercised, and then removed. Generated trees are kept small.
 *
 * Run directly:  node tools/tailwind-standardize/tests/scope-resolver.property.test.js
 *
 * _Requirements: 12.1, 12.2, 12.3, 12.4_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const fc = require('fast-check');

const {
    resolveScope,
    isInScope,
    CONFIG_SOURCE_REL,
    MIRROR_SUBTREE_DIRNAME,
} = require(path.join(__dirname, '..', 'io', 'scope-resolver.js'));

// ---------------------------------------------------------------------------
// Comparison helper — mirrors scope-resolver's case handling so that the test
// compares paths the same way the implementation does (case-insensitive on
// win32, case-sensitive elsewhere).
// ---------------------------------------------------------------------------

function comparable(p) {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

function comparableSet(paths) {
    return new Set(paths.map(comparable));
}

// ---------------------------------------------------------------------------
// Generators — a small, well-formed workspace layout.
// ---------------------------------------------------------------------------

/** A short, file-system-safe path segment (lowercase, no separators/dots). */
const segment = fc
    .array(fc.constantFrom('a', 'b', 'c', 'd', 'e', 'f', '0', '1', '2', '_', '-'), {
        minLength: 1,
        maxLength: 8,
    })
    .map((chars) => chars.join(''));

/** One mirror-subtree file: an optional nested depth plus a leaf name. */
const mirrorFileArb = fc.record({
    depth: fc.integer({ min: 0, max: 3 }),
    name: segment,
});

/** One file nested under a non-mirror root subdirectory (to prove root scan is non-recursive). */
const nestedRootArb = fc.record({
    dir: segment,
    name: segment,
});

const layoutArb = fc.record({
    // *.html files directly at the workspace root -> the Root_HTML_Set.
    htmlNames: fc.uniqueArray(segment, { minLength: 0, maxLength: 5 }),
    // Non-html files at the root -> must never be in scope.
    otherRootNames: fc.uniqueArray(segment, { minLength: 0, maxLength: 3 }),
    // Files under Cheka-project/ at arbitrary depth -> must always be excluded.
    mirrorFiles: fc.array(mirrorFileArb, { minLength: 0, maxLength: 6 }),
    // *.html files nested under a non-mirror root subdirectory -> not in scope
    // (root scan is non-recursive).
    nestedHtml: fc.array(nestedRootArb, { minLength: 0, maxLength: 3 }),
});

// ---------------------------------------------------------------------------
// Materialization — write a generated layout to a fresh temp workspace.
// ---------------------------------------------------------------------------

function writeFileEnsuringDirs(absPath, contents) {
    fs.mkdirSync(path.dirname(absPath), { recursive: true });
    fs.writeFileSync(absPath, contents);
}

/**
 * Create a temp workspace from `layout`. Returns the workspace root plus the
 * absolute paths the property reasons about.
 */
function materialize(layout) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-scope-'));

    // Config_Source: css/tailwind-input.css
    const configSourceAbs = path.resolve(root, CONFIG_SOURCE_REL);
    writeFileEnsuringDirs(configSourceAbs, '@theme {}\n');

    // Root_HTML_Set: *.html directly at root.
    const rootHtmlAbs = layout.htmlNames.map((name) => {
        const abs = path.resolve(root, `${name}.html`);
        writeFileEnsuringDirs(abs, '<!doctype html>');
        return abs;
    });

    // Non-html root files (must not be in scope).
    const otherRootAbs = layout.otherRootNames
        // Avoid colliding with an html basename of the same stem (different ext is fine,
        // but skip names that would duplicate a directory we create such as 'css').
        .filter((name) => name !== 'css' && name !== MIRROR_SUBTREE_DIRNAME)
        .map((name) => {
            const abs = path.resolve(root, `${name}.txt`);
            writeFileEnsuringDirs(abs, 'not html');
            return abs;
        });

    // Mirror_Subtree: always create the directory so it resolves non-null, then
    // populate it. Each file gets a unique leaf (index suffix) and a unique
    // per-file directory chain so no path is an ancestor of another.
    const mirrorRootAbs = path.resolve(root, MIRROR_SUBTREE_DIRNAME);
    fs.mkdirSync(mirrorRootAbs, { recursive: true });

    const mirrorFileAbs = layout.mirrorFiles.map((spec, i) => {
        const dirParts = Array.from({ length: spec.depth }, (_unused, k) => `g${i}_${k}`);
        const leaf = `${spec.name}_${i}.html`;
        const abs = path.resolve(mirrorRootAbs, ...dirParts, leaf);
        writeFileEnsuringDirs(abs, '<!-- mirror -->');
        return abs;
    });

    // *.html under a non-mirror root subdirectory (non-recursive scan check).
    const nestedHtmlAbs = layout.nestedHtml
        .filter((spec) => spec.dir !== 'css' && spec.dir !== MIRROR_SUBTREE_DIRNAME)
        .map((spec, i) => {
            const abs = path.resolve(root, spec.dir, `${spec.name}_${i}.html`);
            writeFileEnsuringDirs(abs, '<!doctype html>');
            return abs;
        });

    return { root, configSourceAbs, rootHtmlAbs, otherRootAbs, mirrorFileAbs, nestedHtmlAbs };
}

function removeWorkspace(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (_err) {
        // Best-effort cleanup; a leftover temp dir must not fail the property.
    }
}

// ---------------------------------------------------------------------------
// Property 18
// ---------------------------------------------------------------------------

// Feature: tailwind-css-standardization, Property 18: Refactoring scope is exclusive to root files and the config source
function testScopeExclusivity() {
    fc.assert(
        fc.property(layoutArb, (layout) => {
            const ws = materialize(layout);
            try {
                const scope = resolveScope(ws.root);

                // The exact set of in-scope paths is rootHtmlSet ∪ {configSource}.
                const expectedInScope = comparableSet([...ws.rootHtmlAbs, ws.configSourceAbs]);

                // (12.1) resolveScope's Root_HTML_Set is exactly the *.html files at root.
                assert.deepStrictEqual(
                    comparableSet(scope.rootHtmlSet),
                    comparableSet(ws.rootHtmlAbs),
                    'rootHtmlSet must be exactly the *.html files at the workspace root'
                );

                // (12.1) The config source resolves to css/tailwind-input.css.
                assert.strictEqual(
                    comparable(scope.configSource),
                    comparable(ws.configSourceAbs),
                    'configSource must resolve to css/tailwind-input.css'
                );

                // Every candidate path: isInScope === membership in the expected set.
                const allCandidates = [
                    ...ws.rootHtmlAbs,
                    ws.configSourceAbs,
                    ...ws.otherRootAbs,
                    ...ws.mirrorFileAbs,
                    ...ws.nestedHtmlAbs,
                    scope.mirrorSubtree, // the mirror directory itself
                ].filter(Boolean);

                for (const candidate of allCandidates) {
                    const shouldBeInScope = expectedInScope.has(comparable(candidate));
                    assert.strictEqual(
                        isInScope(scope, candidate),
                        shouldBeInScope,
                        `isInScope mismatch for ${candidate} (expected ${shouldBeInScope})`
                    );
                }

                // (12.2) NO path under the mirror subtree is ever in scope.
                for (const mirrorPath of ws.mirrorFileAbs) {
                    assert.strictEqual(
                        isInScope(scope, mirrorPath),
                        false,
                        `mirror file must never be in scope: ${mirrorPath}`
                    );
                }

                // (12.3, 12.4) Every mirror file appears in excludedFiles, and
                // excludedFiles is exactly the set of mirror files.
                assert.deepStrictEqual(
                    comparableSet(scope.excludedFiles),
                    comparableSet(ws.mirrorFileAbs),
                    'excludedFiles must list exactly every file under the mirror subtree'
                );

                // Non-html root files and nested-subdir html are never in scope.
                for (const other of ws.otherRootAbs) {
                    assert.strictEqual(isInScope(scope, other), false, `non-html root file in scope: ${other}`);
                }
                for (const nested of ws.nestedHtmlAbs) {
                    assert.strictEqual(
                        isInScope(scope, nested),
                        false,
                        `html under a non-root subdirectory must not be in scope: ${nested}`
                    );
                    assert.ok(
                        !comparableSet(scope.rootHtmlSet).has(comparable(nested)),
                        `nested html must not appear in rootHtmlSet: ${nested}`
                    );
                }
            } finally {
                removeWorkspace(ws.root);
            }
        }),
        { numRuns: 100 }
    );

    console.log('[scope-resolver.property] Property 18: scope exclusivity OK');
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testScopeExclusivity();
    console.log('[scope-resolver.property] All scope-resolver property tests passed');
}

run();

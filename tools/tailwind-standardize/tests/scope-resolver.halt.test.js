'use strict';

/**
 * Unit test for the Scope Resolver unresolvable-mirror-subtree halt (Req 12.5).
 *
 * Mirrors the existing project convention (see tests/models.test.js): plain
 * Node built-in `assert`, a set of named test functions, and a `run()` driver
 * that throws (non-zero exit) on the first failed assertion. No external test
 * framework is introduced.
 *
 * Scenario: a workspace that contains root `*.html` files and the CSS-first
 * Config_Source (`css/tailwind-input.css`) but NO Mirror_Subtree
 * (`Cheka-project/`). When the mirror subtree is expected, the pipeline must
 * halt before any normalization and surface the unresolved-scope condition.
 *
 * Run directly:  node tools/tailwind-standardize/tests/scope-resolver.halt.test.js
 *
 * _Requirements: 12.5_
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const scopeResolver = require(path.join(__dirname, '..', 'io', 'scope-resolver.js'));

const { resolveScope, assertScopeResolved, UnresolvedScopeError, MIRROR_SUBTREE_DIRNAME } = scopeResolver;

/**
 * Create a temporary workspace under os.tmpdir() containing root *.html files
 * and css/tailwind-input.css, but deliberately WITHOUT a Cheka-project/ dir.
 * @returns {string} absolute path to the temp workspace root
 */
function createWorkspaceWithoutMirror() {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-scope-halt-'));

    // Root HTML set.
    fs.writeFileSync(path.join(root, 'index.html'), '<!doctype html><html></html>', 'utf8');
    fs.writeFileSync(path.join(root, 'login.html'), '<!doctype html><html></html>', 'utf8');

    // CSS-first Config_Source at css/tailwind-input.css.
    fs.mkdirSync(path.join(root, 'css'), { recursive: true });
    fs.writeFileSync(path.join(root, 'css', 'tailwind-input.css'), '@theme {}', 'utf8');

    // NOTE: intentionally no Cheka-project/ directory is created.
    return root;
}

/** Remove the temp workspace tree. */
function cleanup(root) {
    try {
        fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
        // Best-effort cleanup; do not fail the test over a leftover temp dir.
    }
}

// ---------------------------------------------------------------------------
// resolveScope leaves mirrorSubtree null when Cheka-project/ is absent
// ---------------------------------------------------------------------------

function testResolveScopeMirrorNullWhenAbsent() {
    const root = createWorkspaceWithoutMirror();
    try {
        const scope = resolveScope(root);

        assert.strictEqual(
            scope.mirrorSubtree,
            null,
            'mirrorSubtree should be null when Cheka-project/ does not exist'
        );
        assert.deepStrictEqual(
            scope.excludedFiles,
            [],
            'excludedFiles should be empty when there is no mirror subtree'
        );

        // The rest of the scope is still resolved (root HTML + config source).
        assert.ok(Array.isArray(scope.rootHtmlSet), 'rootHtmlSet should be an array');
        assert.strictEqual(scope.rootHtmlSet.length, 2, 'both root *.html files should be resolved');
        assert.ok(
            scope.rootHtmlSet.every((p) => p.toLowerCase().endsWith('.html')),
            'rootHtmlSet entries should be *.html paths'
        );
        assert.strictEqual(
            path.basename(scope.configSource),
            'tailwind-input.css',
            'configSource should point at css/tailwind-input.css'
        );

        console.log('[scope-resolver.halt.test] resolveScope -> mirrorSubtree === null OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// assertScopeResolved halts with UnresolvedScopeError carrying the partial scope
// ---------------------------------------------------------------------------

function testAssertScopeResolvedHaltsOnMissingMirror() {
    const root = createWorkspaceWithoutMirror();
    try {
        const scope = resolveScope(root);

        let thrown = null;
        try {
            // expectMirror defaults to true; the missing subtree must halt here.
            assertScopeResolved(scope);
        } catch (err) {
            thrown = err;
        }

        assert.ok(thrown, 'assertScopeResolved should throw when the expected mirror subtree is absent');
        assert.ok(
            thrown instanceof UnresolvedScopeError,
            'thrown error should be an UnresolvedScopeError'
        );
        assert.strictEqual(thrown.code, 'UNRESOLVED_SCOPE', 'error code should be UNRESOLVED_SCOPE');
        assert.ok(
            thrown.message.includes(MIRROR_SUBTREE_DIRNAME),
            'error message should name the unresolved mirror subtree'
        );

        // The partial scope must be carried so the caller can record the
        // unresolved-scope condition in the changelog before halting.
        assert.ok(thrown.scope, 'error should carry the partially-resolved scope');
        assert.strictEqual(thrown.scope, scope, 'error.scope should be the partial scope passed in');
        assert.strictEqual(thrown.scope.mirrorSubtree, null, 'carried scope still reports mirrorSubtree null');

        console.log('[scope-resolver.halt.test] assertScopeResolved -> UnresolvedScopeError OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Sanity: when the mirror is not expected, resolution succeeds without halting
// ---------------------------------------------------------------------------

function testNoHaltWhenMirrorNotExpected() {
    const root = createWorkspaceWithoutMirror();
    try {
        const scope = resolveScope(root);

        // With expectMirror=false, the absence is not fatal and the same scope
        // is returned unchanged (no pipeline halt).
        const returned = assertScopeResolved(scope, { expectMirror: false });
        assert.strictEqual(returned, scope, 'assertScopeResolved should return the scope when mirror not expected');

        console.log('[scope-resolver.halt.test] no halt when mirror not expected OK');
    } finally {
        cleanup(root);
    }
}

// ---------------------------------------------------------------------------
// Driver
// ---------------------------------------------------------------------------

function run() {
    testResolveScopeMirrorNullWhenAbsent();
    testAssertScopeResolvedHaltsOnMissingMirror();
    testNoHaltWhenMirrorNotExpected();
    console.log('[scope-resolver.halt.test] All unresolved-scope halt unit tests passed');
}

run();

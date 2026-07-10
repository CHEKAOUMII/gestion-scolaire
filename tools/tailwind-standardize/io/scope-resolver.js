'use strict';

/**
 * Scope Resolver (I/O shell) for the Tailwind CSS Standardization tool.
 *
 * Resolves which files the Standardization_Tool is allowed to touch and which
 * it must leave alone. Normalization applies *only* to the Root_HTML_Set
 * (`*.html` at the workspace root) plus the Config_Source
 * (`css/tailwind-input.css`); every file under the Mirror_Subtree
 * (`Cheka-project/`) is excluded.
 *
 * This module performs read-only file system access (directory listing and
 * stat). It deliberately does NOT normalize, edit, or write anything. When the
 * Mirror_Subtree is expected but cannot be resolved, it surfaces a clear,
 * actionable signal (`UnresolvedScopeError` via `assertScopeResolved`) so the
 * I/O shell can halt before any normalization begins (Req 12.5).
 *
 * CommonJS + Node built-ins (fs, path) to match existing project conventions.
 *
 * _Requirements: 12.1, 12.2, 12.5_
 */

const fs = require('fs');
const path = require('path');

/** Relative path (from workspace root) of the CSS-first Config_Source. */
const CONFIG_SOURCE_REL = path.join('css', 'tailwind-input.css');

/** Directory name of the Mirror_Subtree that must always be excluded. */
const MIRROR_SUBTREE_DIRNAME = 'Cheka-project';

/**
 * Error raised when scope cannot be resolved (e.g. the Mirror_Subtree is
 * expected but is absent). Carries the partially-resolved scope so the caller
 * can record the condition in the changelog before halting (Req 12.5).
 */
class UnresolvedScopeError extends Error {
    constructor(message, scope) {
        super(message);
        this.name = 'UnresolvedScopeError';
        this.code = 'UNRESOLVED_SCOPE';
        this.scope = scope || null;
    }
}

/**
 * Normalize a path for comparison. On case-insensitive platforms (win32) the
 * comparison key is lower-cased so `D:\\X` and `d:\\x` compare equal.
 * @param {string} p
 * @returns {string}
 */
function comparablePath(p) {
    const resolved = path.resolve(p);
    return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}

/**
 * Return true when `candidate` is the same file as `target` or nested under it.
 * @param {string} candidate
 * @param {string} target
 * @returns {boolean}
 */
function isPathWithin(candidate, target) {
    const c = comparablePath(candidate);
    const t = comparablePath(target);
    if (c === t) {
        return true;
    }
    const withSep = t.endsWith(path.sep) ? t : t + path.sep;
    return c.startsWith(withSep);
}

/**
 * Recursively collect every file path under `dir`. Symlinked directories are
 * not followed to avoid cycles. Returns absolute paths.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFilesRecursively(dir) {
    const out = [];
    const stack = [dir];

    while (stack.length > 0) {
        const current = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(current, { withFileTypes: true });
        } catch (err) {
            // An unreadable subdirectory should not abort scope resolution; the
            // directory itself is still excluded as part of the subtree.
            continue;
        }

        for (const entry of entries) {
            const full = path.join(current, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                out.push(full);
            }
        }
    }

    return out;
}

/**
 * Resolve the Root_HTML_Set: absolute paths of `*.html` files located directly
 * at the workspace root (not recursive — the config scans `../*.html`).
 * @param {string} workspaceRoot
 * @returns {string[]} sorted absolute paths
 */
function resolveRootHtmlSet(workspaceRoot) {
    let entries;
    try {
        entries = fs.readdirSync(workspaceRoot, { withFileTypes: true });
    } catch (err) {
        throw new UnresolvedScopeError(
            `Workspace root could not be read: ${workspaceRoot} (${err.message})`,
            null
        );
    }

    return entries
        .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.html'))
        .map((entry) => path.resolve(workspaceRoot, entry.name))
        .sort();
}

/**
 * Resolve the full normalization scope for a workspace.
 *
 * @param {string} workspaceRoot Absolute path to the workspace root.
 * @returns {{
 *   rootHtmlSet: string[],        // absolute paths of *.html at root
 *   configSource: string,         // absolute path to css/tailwind-input.css
 *   mirrorSubtree: string|null,   // absolute path to Cheka-project/, or null if absent
 *   excludedFiles: string[],      // absolute paths of every file under the mirror subtree
 * }}
 * @see Requirements 12.1, 12.2
 */
function resolveScope(workspaceRoot) {
    if (typeof workspaceRoot !== 'string' || workspaceRoot.length === 0) {
        throw new TypeError('[scope-resolver] workspaceRoot must be a non-empty string');
    }

    const root = path.resolve(workspaceRoot);

    const rootHtmlSet = resolveRootHtmlSet(root);
    const configSource = path.resolve(root, CONFIG_SOURCE_REL);

    const mirrorCandidate = path.resolve(root, MIRROR_SUBTREE_DIRNAME);
    let mirrorSubtree = null;
    let excludedFiles = [];
    try {
        if (fs.statSync(mirrorCandidate).isDirectory()) {
            mirrorSubtree = mirrorCandidate;
            excludedFiles = collectFilesRecursively(mirrorCandidate).sort();
        }
    } catch (err) {
        // Absent or unreadable: leave mirrorSubtree null so callers can decide
        // whether its absence is fatal via assertScopeResolved (Req 12.5).
        mirrorSubtree = null;
        excludedFiles = [];
    }

    return {
        rootHtmlSet,
        configSource,
        mirrorSubtree,
        excludedFiles,
    };
}

/**
 * Determine whether a path is in scope for normalization.
 *
 * Returns true only for files in `rootHtmlSet ∪ {configSource}`; returns false
 * for any path under the Mirror_Subtree and for anything else outside the
 * allowed set.
 *
 * @param {{ rootHtmlSet: string[], configSource: string, mirrorSubtree: string|null }} scope
 * @param {string} candidatePath
 * @returns {boolean}
 * @see Requirements 12.1, 12.2
 */
function isInScope(scope, candidatePath) {
    if (!scope || typeof scope !== 'object') {
        throw new TypeError('[scope-resolver] isInScope requires a resolved scope object');
    }
    if (typeof candidatePath !== 'string' || candidatePath.length === 0) {
        throw new TypeError('[scope-resolver] isInScope requires a non-empty path');
    }

    // Anything under the mirror subtree is never in scope (Req 12.2).
    if (scope.mirrorSubtree && isPathWithin(candidatePath, scope.mirrorSubtree)) {
        return false;
    }

    const target = comparablePath(candidatePath);

    if (comparablePath(scope.configSource) === target) {
        return true;
    }

    for (const htmlPath of scope.rootHtmlSet || []) {
        if (comparablePath(htmlPath) === target) {
            return true;
        }
    }

    return false;
}

/**
 * Guard used by the I/O shell before any normalization. When the workspace is
 * expected to contain the Mirror_Subtree but it resolved to null, this halts by
 * throwing an `UnresolvedScopeError` carrying the partial scope so the caller
 * can record the unresolved-scope condition in the changelog (Req 12.5).
 *
 * @param {{ mirrorSubtree: string|null }} scope
 * @param {{ expectMirror?: boolean }} [options] defaults to expecting the mirror
 * @returns {object} the same scope when resolution succeeds
 * @see Requirement 12.5
 */
function assertScopeResolved(scope, { expectMirror = true } = {}) {
    if (!scope || typeof scope !== 'object') {
        throw new TypeError('[scope-resolver] assertScopeResolved requires a resolved scope object');
    }
    if (expectMirror && scope.mirrorSubtree === null) {
        throw new UnresolvedScopeError(
            `Mirror subtree '${MIRROR_SUBTREE_DIRNAME}/' could not be located or resolved; ` +
                'halting before any normalization.',
            scope
        );
    }
    return scope;
}

module.exports = {
    resolveScope,
    isInScope,
    assertScopeResolved,
    UnresolvedScopeError,
    CONFIG_SOURCE_REL,
    MIRROR_SUBTREE_DIRNAME,
};

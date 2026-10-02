'use strict';

/**
 * page-access-enforcement.test.js — behavioral guard for the G1 fix
 * (docs/plans/2026-07-22-page-access-enforcement-fixes-plan.md, Task 1).
 *
 * Regression under test: an admin who unchecks ALL roles for a page ("deny-all")
 * must actually revoke it — not silently revert to the built-in PAGE_PERMISSIONS
 * defaults. The fix persists a reserved allowed=0 "override marker" row so the page
 * still counts as overridden even when it has zero allowed roles.
 *
 * This drives the REAL enforcement seam: an in-memory SQLite DB wired into the
 * shared db/context, read through the real main/auth/permissions.js
 * (getAllowedPages / canAccessPage). It deliberately does NOT go through the IPC +
 * auth + sync-capture stack — those are unrelated to the deny-all logic.
 *
 * The `saveAccess` helper reproduces exactly what appDefaults.js `savePageAccess`
 * persists (delete → allowed=0 marker → one allowed=1 row per role). The enforcement
 * side keys off row existence + the allowed flag, so the marker's specific slug is
 * intentionally not load-bearing for reads.
 */

const assert = require('assert');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const context = require(path.join(ROOT, 'main', 'db', 'context'));
const permissions = require(path.join(ROOT, 'main', 'auth', 'permissions'));

// Mirrors main/ipc/appDefaults.js: PAGE_ACCESS_OVERRIDE_MARKER.
const OVERRIDE_MARKER = '__override__';

// Institution roles = every assignable role except 'admin' (admin/developer bypass).
const INSTITUTION_ROLES = permissions.ALLOWED_ROLES.filter((r) => r !== 'admin');

function openDb() {
    let Database;
    try {
        Database = require('better-sqlite3');
        // Probe: the native binding is built against Electron's ABI, so loading it
        // under a mismatched standalone-node ABI throws here. Treat that as "skip".
        const probe = new Database(':memory:');
        probe.close();
    } catch {
        return null;
    }
    const db = new Database(':memory:');
    // Schema mirrors migration 2026-07-066-app-defaults.
    db.exec(`
        CREATE TABLE page_role_access (
            page_key   TEXT NOT NULL,
            role       TEXT NOT NULL,
            allowed    INTEGER NOT NULL DEFAULT 1,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            PRIMARY KEY (page_key, role)
        );
    `);
    return db;
}

/**
 * Reproduce appDefaults.js `savePageAccess` for a single page:
 * clear prior rows → write the allowed=0 override marker → write allowed=1 per role.
 * Callers must clearPageAccessCache() before asserting (the module caches).
 */
function saveAccess(db, pageKey, roles) {
    db.prepare('DELETE FROM page_role_access WHERE page_key = ?').run(pageKey);
    db.prepare(
        'INSERT INTO page_role_access(page_key, role, allowed) VALUES(?, ?, 0)'
    ).run(pageKey, OVERRIDE_MARKER);
    const insert = db.prepare('INSERT INTO page_role_access(page_key, role, allowed) VALUES(?, ?, 1)');
    for (const role of roles) {
        if (!INSTITUTION_ROLES.includes(role)) continue;
        insert.run(pageKey, role);
    }
    permissions.clearPageAccessCache();
}

function run() {
    // Cheap invariant (behavioral): the marker is never an assignable role.
    assert.strictEqual(
        permissions.ALLOWED_ROLES.includes(OVERRIDE_MARKER),
        false,
        'override marker must not be an assignable role'
    );

    const db = openDb();
    if (!db) {
        console.log('page-access-enforcement.test.js: OK (skipped — better-sqlite3 unavailable)');
        return;
    }

    context.setDb(db);
    try {
        const DENY_PAGE = 'grades-sheets'; // code default includes teacher + supervisor + others
        const PARTIAL_PAGE = 'grades-results'; // code default includes teacher + supervisor
        const UNTOUCHED_PAGE = 'index'; // code default = all staff

        // Sanity: before any override, the code defaults apply.
        permissions.clearPageAccessCache();
        assert.ok(
            permissions.canAccessPage('teacher', DENY_PAGE),
            'precondition: teacher can access grades-sheets by code default'
        );
        assert.ok(
            permissions.canAccessPage('supervisor', PARTIAL_PAGE),
            'precondition: supervisor can access grades-results by code default'
        );

        // ── Case A — deny-all: save the page with ZERO roles ──────────────
        saveAccess(db, DENY_PAGE, []);

        for (const role of INSTITUTION_ROLES) {
            assert.ok(
                !permissions.getAllowedPages(role).includes(DENY_PAGE),
                `deny-all: ${role} must NOT have ${DENY_PAGE} after unchecking every role`
            );
            assert.strictEqual(
                permissions.canAccessPage(role, DENY_PAGE),
                false,
                `deny-all: canAccessPage(${role}, ${DENY_PAGE}) must be false`
            );
        }

        // admin + developer always bypass, even for a deny-all page.
        assert.ok(
            permissions.getAllowedPages('admin').includes(DENY_PAGE),
            'admin bypass: deny-all page still listed for admin'
        );
        assert.ok(permissions.canAccessPage('admin', DENY_PAGE), 'admin bypasses deny-all');
        assert.ok(permissions.canAccessPage('developer', DENY_PAGE), 'developer bypasses deny-all');

        // The override must be scoped to the saved page only — untouched pages keep defaults.
        assert.ok(
            permissions.getAllowedPages('teacher').includes(UNTOUCHED_PAGE),
            'deny-all on one page must not affect untouched pages (index still allowed)'
        );

        // The marker slug must never leak into any allowed-pages result.
        for (const role of [...INSTITUTION_ROLES, 'admin', 'developer']) {
            assert.ok(
                !permissions.getAllowedPages(role).includes(OVERRIDE_MARKER),
                `override marker must never appear in getAllowedPages(${role})`
            );
        }

        // ── Case B — partial override REPLACES (not merges with) code defaults ──
        // grades-results code default includes both 'teacher' and 'supervisor';
        // override to teacher-only must drop supervisor.
        saveAccess(db, PARTIAL_PAGE, ['teacher']);

        assert.ok(
            permissions.getAllowedPages('teacher').includes(PARTIAL_PAGE),
            'partial override: explicitly-allowed teacher keeps grades-results'
        );
        assert.ok(
            permissions.canAccessPage('teacher', PARTIAL_PAGE),
            'partial override: canAccessPage(teacher, grades-results) true'
        );
        assert.ok(
            !permissions.getAllowedPages('supervisor').includes(PARTIAL_PAGE),
            'partial override REPLACES defaults: supervisor loses grades-results'
        );
        assert.ok(
            permissions.getAllowedPages('admin').includes(PARTIAL_PAGE),
            'admin bypass: partially-overridden page still listed for admin'
        );

        // ── Case C — a never-saved page falls back to PAGE_PERMISSIONS ──────
        permissions.clearPageAccessCache();
        assert.ok(
            permissions.getAllowedPages('viewer').includes(UNTOUCHED_PAGE),
            'untouched page: viewer keeps index via code default'
        );
        assert.ok(
            permissions.canAccessPage('viewer', UNTOUCHED_PAGE),
            'untouched page: canAccessPage(viewer, index) true via code default'
        );
    } finally {
        context.setDb(null);
        permissions.clearPageAccessCache();
        db.close();
    }

    console.log('page-access-enforcement.test.js: OK');
}

run();

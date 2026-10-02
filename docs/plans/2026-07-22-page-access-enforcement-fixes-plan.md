# Page Access Enforcement — Fixes Implementation Plan

**Date:** 2026-07-22
**Status:** Ready for implementation
**Owner:** (unassigned — to be executed by an implementing agent)
**Prereq reading:** `page-access-enforcement-plan.md` (repo root — the reality review this plan derives from)

---

## Context (self-contained)

The "صلاحيات الصفحات" (page permissions) matrix in `settings-defaults.html` (Tab 2) lets an
admin/developer choose which institution roles may open each page. The chain is already wired and
working end-to-end:

- Save → `appDefaults:savePageAccess` writes `page_role_access(page_key, role, allowed=1)` rows and calls `clearPageAccessCache()`.
- Server truth → `main/auth/permissions.js` `getAllowedPages(role)` merges DB overrides over code `PAGE_PERMISSIONS`.
- Exposed to renderer → `auth:getAllowedPages` (`main/ipc/auth.js`).
- Client enforcement → `js/utils.js`: `loadAllowedPagesState()` + `enforcePageRoleOrRedirect()` (redirect) and `applyNavigationRestrictions()` (sidebar hiding), both via `_canRoleOpenPage()` which consults `_allowedPagesState`.

A verified reality review found the gaps below. **G1 is the only correctness bug; the rest are cleanup.**

**Ground rules for the implementer**
- Do **not** refactor beyond the tasks below. Match existing code style.
- After each code change, run `npm test` and `npm run lint` (per `AGENTS.md`). Do not add unrelated tests.
- Follow the main-process layering rule in `AGENTS.md`: domain SQL stays where it already is; do not move logic between IPC/repos as part of this plan.

---

## Task 1 — G1 (MUST-FIX): make "deny-all roles" persist instead of reverting to code defaults

### Problem (confirmed in source)

`appDefaults:savePageAccess` only ever inserts `allowed=1` rows and never records a "this page is
overridden" fact independently of the allowed set. Both readers decide "is this page overridden?"
purely by **row existence**:

- `main/ipc/appDefaults.js` → `loadDbRoleMap()` builds `pagesWithRows` from existing rows only.
- `main/auth/permissions.js` → `ensurePageAccessCache()` runs `SELECT DISTINCT page_key FROM page_role_access`.

So if an admin unchecks **every** institution role for a page and saves → 0 rows for that page →
`pagesWithRows` excludes it → both sides fall back to built-in `PAGE_PERMISSIONS`. The admin's
"nobody may access" intent is silently discarded, and the matrix re-renders the code defaults on reload.

### Fix strategy — sentinel "override marker" row

Persist an explicit marker row for **every** page the admin saves, so "overridden" is decoupled from
"has ≥1 allowed role". The marker uses a reserved pseudo-role that is never a real role and is stored
with `allowed = 0`, so it can never leak into any allowed-roles computation.

- Reserved role slug: `__override__`
- It is **not** in `ALLOWED_ROLES` / `INSTITUTION_ROLES`, so existing role-validation loops already reject it as a selectable role.
- It is stored with `allowed = 0`; every reader that collects allowed roles filters on `allowed = 1`, so it is invisible to allow-lists.

No schema change is needed: `page_role_access` PK is `(page_key, role)` and `role` is free-text.

### Files & exact edits

#### 1a. `main/ipc/appDefaults.js` — write the marker on every save

In the `appDefaults:savePageAccess` handler, add a marker constant and an insert of the marker row for
each saved page (in addition to the existing per-role `allowed=1` inserts). The existing
`deleteStmt.run(pageKey)` already clears prior rows (including any stale marker), so ordering is:
delete → insert marker → insert allowed roles.

Add near the top of the file (module scope), next to the other constants:
```js
// Reserved pseudo-role persisted with allowed=0 so a page the admin has edited is always
// recognised as "overridden" — even when zero institution roles are allowed (deny-all).
// It is not a real role (absent from ALLOWED_ROLES/INSTITUTION_ROLES) and is filtered out
// of every allowed-roles computation because those only read rows WHERE allowed = 1.
const PAGE_ACCESS_OVERRIDE_MARKER = '__override__';
```

Inside `savePageAccess`, add a marker insert statement and write it per page:
```js
const deleteStmt = db.prepare('DELETE FROM page_role_access WHERE page_key = ?');
const markerStmt = db.prepare(`
    INSERT INTO page_role_access(page_key, role, allowed, updated_at)
    VALUES(?, ?, 0, CURRENT_TIMESTAMP)
`);
const insertStmt = db.prepare(`
    INSERT INTO page_role_access(page_key, role, allowed, updated_at)
    VALUES(?, ?, 1, CURRENT_TIMESTAMP)
`);

const tx = db.transaction(() => {
    for (const item of pages) {
        const pageKey = normalizePageKey(item?.pageKey ?? item?.page);
        if (!pageKey) continue;
        deleteStmt.run(pageKey);
        markerStmt.run(pageKey, PAGE_ACCESS_OVERRIDE_MARKER); // page is now explicitly overridden
        const roles = Array.isArray(item?.roles) ? item.roles : [];
        for (const role of roles) {
            const r = String(role || '').trim().toLowerCase();
            if (!INSTITUTION_ROLES.includes(r)) continue;
            insertStmt.run(pageKey, r);
        }
    }
});
tx();
```

> **Why this is enough:** With the marker, a deny-all page has exactly one row (`allowed=0`).
> `loadDbRoleMap()` adds it to `pagesWithRows` (so `getEffectiveRolesForPage` treats it as overridden)
> and never pushes it into `map[key]` (which only collects `allowed=1`), so it returns `[]`.
> `ensurePageAccessCache()` likewise sees the page via `SELECT DISTINCT page_key` and its
> `WHERE allowed = 1` allowed-rows query excludes the marker, yielding `[]`. **No changes are
> required in `permissions.js` or in `loadDbRoleMap` — the marker makes the existing logic correct.**

#### 1b. Defensive filter (belt-and-suspenders) — hide the marker from any role listing

Confirm the marker can never appear as a selectable/allowed role. It already cannot, because:
- `loadDbRoleMap` / `ensurePageAccessCache` push only `allowed=1` rows (marker is `allowed=0`).
- `listPages` builds role columns from `INSTITUTION_ROLES` (marker not included).

**No extra code needed.** Do **not** add the marker to `ALLOWED_ROLES`, `INSTITUTION_ROLES`, or `ROLE_LABELS`.

#### 1c. Verify the ad-hoc table creator matches the migration

`ensureExamCountTables()` in `appDefaults.js` and migration `2026-07-066-app-defaults` both create
`page_role_access` with the same shape. Leave both as-is (defensive duplicate). Do not remove the
migration; do not remove the `IF NOT EXISTS` guard.

### Backfill / compatibility note (document, no code)

Existing installs where an admin previously "denied all" never persisted any rows, so those pages
currently show code defaults. After this fix they continue to show code defaults **until the admin
re-saves** that page (which writes the marker). There is nothing to migrate. State this in the PR description.

### Tests for Task 1 (`tests/smoke.js`)

Add assertions that exercise the deny-all path against the real permissions module. Follow the
existing smoke-test style already present for `getAllowedPages('principal')`.

- After saving a page with an empty roles array (simulating deny-all), `getAllowedPages(role)` for
  every institution role must **exclude** that page.
- A page that has never been saved must still fall back to its `PAGE_PERMISSIONS` code default.
- The marker slug `__override__` must never appear in any `getAllowedPages(role)` result and must not
  be a member of `ALLOWED_ROLES`.

If the smoke test cannot open a real DB, assert on the pure logic path the same way the existing
`permissions.getAllowedPages(...)` assertions do (they call the module directly). Keep it consistent
with what is already there — do not introduce a new test framework.

### Acceptance criteria — Task 1
- Admin unchecks all roles for a page, saves, reloads the matrix → that page shows **zero** checks (not code defaults).
- A non-admin/non-developer user assigned no access to that page is redirected away from it **and** the sidebar link is hidden.
- Admin/developer still bypass (can open every page).
- Pages never touched by the admin keep their built-in defaults.
- `npm test` and `npm run lint` pass.

---

## Task 2 — G2 (cleanup): remove the dead, conflicting guard file

`js/pages/page-access-guard.js` is a second, independent guard (redirects to `index.html`, exempts
`dashboard`/`index`). A repo-wide search shows it is referenced by **no** HTML/JS file (only by the
review doc). It would conflict with the authoritative `js/utils.js` guard if ever wired.

- **Action:** Delete `js/pages/page-access-guard.js`.
- **Before deleting**, re-run a repo-wide search for `page-access-guard` to confirm zero code references (expect only markdown docs). If any HTML includes it, stop and report — do not delete.
- Do not touch the `js/utils.js` guard; it already covers redirect + sidebar hiding.

### Acceptance criteria — Task 2
- File removed; `grep -r "page-access-guard"` returns only documentation hits.
- App still enforces access (via `utils.js`) with no regression; `npm test` passes.

---

## Task 3 — G5 (perf nit): stop re-querying the whole table per page in `listPages`

In `main/ipc/appDefaults.js` → `appDefaults:listPages`, `hasDbOverride` calls `loadDbRoleMap(db)`
once **per page** inside a per-row IIFE, re-reading the entire `page_role_access` table N times.

- **Fix:** Call `loadDbRoleMap(db)` **once** before the `.map(...)`, reuse its `{ map, pagesWithRows }`
  for both the effective-roles computation and `hasDbOverride`.

Sketch:
```js
handleRead(ipcMain, 'appDefaults:listPages', (db) => {
    ensureExamCountTables(db);
    const pages = listHtmlPages();
    const roles = INSTITUTION_ROLES.map((role) => ({ role, label: ROLE_LABELS[role] || role }));
    const { map, pagesWithRows } = loadDbRoleMap(db); // once

    const result = pages.map((p) => {
        const effectiveRoles = pagesWithRows.has(p.pageKey)
            ? (map[p.pageKey] || [])
            : (PAGE_PERMISSIONS[p.pageKey] || []);
        return {
            ...p,
            roles: INSTITUTION_ROLES.map((role) => ({ role, allowed: effectiveRoles.includes(role) })),
            hasDbOverride: pagesWithRows.has(p.pageKey)
        };
    });

    return { success: true, pages: result, roles };
});
```
This preserves behaviour exactly (including the G1 marker path, since `pagesWithRows` includes
marker-only pages). `getEffectiveRolesForPage` may remain for other callers, or be inlined here as shown.

### Acceptance criteria — Task 3
- `listPages` reads `page_role_access` once per call; output identical to before (verify a page with an override, a deny-all page, and a default page).
- `npm test` / `npm run lint` pass.

---

## Task 4 — G3 (docs only): record that page-access is device-local

No code change. `page_role_access` is created by migration `2026-07-066-app-defaults`, and
`appDefaults:savePageAccess`/`saveExamCounts` are intentionally **absent** from `main/sync/capture.js`
(page permissions and exam counts are per-device admin config, consistent with each other).

- **Action:** Add one line to the PR description and, if desired, a short note under the App Defaults
  section of `AGENTS.md` stating that page-access + exam-count settings are device-local and not synced.
- Do **not** add these channels to the sync registry as part of this plan.

---

## Out of scope (do NOT do here)

- **G4 (fail-open client guard):** `_canRoleOpenPage` returns `true` when `_allowedPagesState` failed
  to load. This is a deliberate anti-lockout UX behaviour; the real security boundary is per-IPC
  server enforcement (`canAccessPage` / `SCOPED_ROLES`). Auditing/adding server-side per-handler checks
  is a **separate spec**, not part of this plan.
- Any redesign of the matrix UI, role catalog, or `PAGE_PERMISSIONS` defaults.

---

## Suggested commit sequence

1. `fix(access): persist deny-all page permissions via override marker (G1)` + smoke tests
2. `chore(access): remove dead page-access-guard.js (G2)`
3. `perf(access): read page_role_access once in listPages (G5)`
4. `docs(access): note page-access settings are device-local (G3)`

## Files of record

- `main/ipc/appDefaults.js` — `savePageAccess`, `loadDbRoleMap`, `getEffectiveRolesForPage`, `listPages`
- `main/auth/permissions.js` — `ensurePageAccessCache`, `getEffectivePageRoles`, `getAllowedPages` (no change expected)
- `js/pages/page-access-guard.js` — delete
- `tests/smoke.js` — add G1 assertions
- `main/db/migrations.js` — `2026-07-066-app-defaults` (reference only; no change)
- `AGENTS.md` — optional device-local note

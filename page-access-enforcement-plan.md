# Page Access Enforcement — Reality Review

**Date:** 2026-07-22
**Scope:** Verify that the "صلاحيات الصفحات" (Page Permissions) matrix in `settings-defaults.html` actually takes effect in the built app, so an authenticated user sees / can open only their allowed pages.
**Verdict:** ✅ Wired end-to-end and enforced — with **one real correctness gap** (deny-all cannot be persisted) plus a few minor issues.

---

## 1. What the feature is

`settings-defaults.html` → Tab 2 ("صلاحيات الصفحات") renders a matrix:

- **Rows** = pages (auto-discovered `.html` files, grouped)
- **Columns** = institution roles (all `ALLOWED_ROLES` except `admin`)
- **Checkboxes** = which roles may open each page
- Admin + Developer always bypass (stated in the hint text and enforced in code)

Editor page itself is admin/developer-only (`ADMIN_ONLY_PAGES` + `PAGE_PERMISSIONS['settings-defaults'] = []` + write handlers gated to `['admin','developer']`).

---

## 2. End-to-end chain (verified against source)

| Step | File / symbol | Behaviour |
|------|---------------|-----------|
| 1. Edit + Save | `js/pages/settings-defaults.js` → `savePageAccess()` | Sends dirty pages to `appDefaults:savePageAccess`. |
| 2. Persist | `main/ipc/appDefaults.js` → `savePageAccess` handler | `DELETE FROM page_role_access WHERE page_key=?` then one `INSERT ... allowed=1` per checked role, in a transaction. Calls `clearPageAccessCache()`. Gated to `['admin','developer']`. |
| 3. Storage | `page_role_access(page_key, role, allowed, updated_at)` | Created lazily via `ensureExamCountTables()` (`CREATE TABLE IF NOT EXISTS`). **No formal migration** in `main/db/migrations.js`. |
| 4. Server truth | `main/auth/permissions.js` → `getAllowedPages(role)` | `ensurePageAccessCache()` loads DB overrides; `getEffectivePageRoles()` returns DB rows for overridden pages, else code `PAGE_PERMISSIONS`. Admin/developer → all keys. |
| 5. Expose | `main/ipc/auth.js` → `auth:getAllowedPages` | Returns `getAllowedPages(session.role)` for the current session; `[]` if no session. |
| 6. Client load | `js/utils.js` → `loadAllowedPagesState()` | Calls `window.api.auth.getAllowedPages()`, stores `_allowedPagesState`. |
| 7. Redirect guard | `js/utils.js` → `enforceProtectedPagesAuth` IIFE → `enforcePageRoleOrRedirect()` → `_canRoleOpenPage()` | Runs on every page loading `utils.js`. If current page ∉ `_allowedPagesState`, redirects to a safe page. |
| 8. Sidebar hiding | `js/utils.js` → `applyNavigationRestrictions()` → `_isSidebarLinkBlocked()` → `_canRoleOpenPage()` | Disallowed links get `li.style.display='none'`; empty groups/section labels collapse. So the user **sees** only allowed pages, not just gets bounced. |

**Cache freshness:** Save clears the server cache; guard reloads with `forceRefresh=true` on each page bootstrap → changes apply on next navigation/reload (matches the UI hint "ستُطبَّق فوراً بعد إعادة تحميل الصفحات").

**Test coverage:** `tests/smoke.js` asserts `getAllowedPages('principal')` includes `settings-users`, and that `utils.js` contains `loadAllowedPagesState` + `_allowedPagesState.includes` — the wiring is smoke-checked.

**Conclusion for the core question:** Yes — the matrix takes effect in the built app. An authenticated non-admin user (a) has disallowed pages hidden from the sidebar and (b) is redirected away if they navigate directly to a disallowed URL.

---

## 3. Gaps found (reality vs. intent)

### 🔴 G1 — "Deny all roles" cannot be persisted (silent revert to code defaults)
`savePageAccess` only ever inserts `allowed=1` rows and never records an explicit "denied" state. Both readers key off *row existence*:

- `loadDbRoleMap()` (appDefaults) builds `pagesWithRows` from existing rows only.
- `ensurePageAccessCache()` (permissions) does `SELECT DISTINCT page_key FROM page_role_access`.

If an admin unchecks **every** institution role for a page and saves → 0 rows for that page → the page is no longer "overridden" → both sides **fall back to built-in `PAGE_PERMISSIONS`**. The admin's "no one may access" intent is silently discarded, and the matrix re-renders showing the code defaults after reload.

**Fix options:**
- (a) Persist an explicit sentinel row (e.g. `role='__none__', allowed=0`) so the page still counts as overridden; or
- (b) Add a separate `page_access_overrides(page_key)` marker table listing every page the admin has touched, and treat "overridden with empty allow-list" as deny-all.
Update both `loadDbRoleMap`/`getEffectiveRolesForPage` and `ensurePageAccessCache`/`getEffectivePageRoles` consistently.

### 🟠 G2 — Dead, conflicting guard file
`js/pages/page-access-guard.js` implements a second, independent guard (redirects to `index.html`, exempts `dashboard`/`index`) but is **not referenced by any HTML file**. It's dead code that would conflict with the `utils.js` guard if ever included. Recommend deleting it or consolidating.

### 🟢 G3 — Migration exists; sync is intentionally local (corrected)
Correction: `page_role_access` **is** created by migration `2026-07-066-app-defaults` in `main/db/migrations.js` (alongside `exam_count_rules`). The ad-hoc `CREATE TABLE IF NOT EXISTS` in `ensureExamCountTables()` is just a defensive duplicate and is harmless. `appDefaults:savePageAccess` is **not** in `main/sync/capture.js`, i.e. page-access is device-local by design (same as exam counts). This is a reasonable choice for per-device admin config — just document it explicitly; no code change required.

### 🟡 G4 — Guard fails open on load error
`_canRoleOpenPage()` returns `true` when `_allowedPagesState` isn't an array (IPC failed / not yet loaded). Deliberate (avoids locking users out), but it means the client redirect is a UX gate, not a security boundary. Real protection must come from per-IPC server checks (`canAccessPage` / `SCOPED_ROLES`) — confirm those exist for sensitive data handlers; they are out of scope for "page visibility" but are the actual security layer.

### 🟡 G5 — `listPages` N×DB reads
In the `appDefaults:listPages` handler, `hasDbOverride` calls `loadDbRoleMap(db)` once per page (inside an IIFE per row). Harmless functionally, but it re-queries the whole table for every page. Hoist `loadDbRoleMap` out of the loop.

---

## 4. Recommended task list

- [ ] **G1 (must-fix):** Make deny-all persistable; keep read + enforcement sides in sync. Add a smoke test: override a page to zero roles → `getAllowedPages(role)` excludes it.
- [ ] **G2:** Remove `js/pages/page-access-guard.js` (or wire+reconcile it, but the `utils.js` guard already covers this).
- [ ] **G3:** No code change — document that page-access is device-local (migration `2026-07-066-app-defaults` already creates the table).
- [ ] **G5:** Hoist `loadDbRoleMap` out of the per-page loop in `listPages`.
- [ ] **G4 (verify, likely separate spec):** Confirm sensitive IPC handlers enforce `canAccessPage`/`SCOPED_ROLES` server-side, not just page redirects.

---

## 5. Files of record

- UI: `settings-defaults.html`, `js/pages/settings-defaults.js`
- IPC: `main/ipc/appDefaults.js` (`listPages`, `getPageAccessMap`, `savePageAccess`), `main/ipc/auth.js` (`auth:getAllowedPages`)
- Core: `main/auth/permissions.js` (`PAGE_PERMISSIONS`, `getAllowedPages`, cache)
- Client guard: `js/utils.js` (`loadAllowedPagesState`, `enforcePageRoleOrRedirect`, `_canRoleOpenPage`, `applyNavigationRestrictions`)
- Preload: `preload.js` (`appDefaults.*`, `auth.getAllowedPages`)
- Dead code: `js/pages/page-access-guard.js`

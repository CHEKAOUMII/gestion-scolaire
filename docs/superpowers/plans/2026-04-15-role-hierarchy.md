# Role Hierarchy System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the current binary `admin/staff/viewer` role model with an 11-role hierarchy that gates IPC channels and sidebar links according to a centralized permissions map, and rebuild the user management page so `admin` (not just `developer`) can manage users.

**Architecture:** A new `main/auth/permissions.js` file becomes the single source of truth for all page-level and IPC-level access control. The `ipc-helpers.js` wrappers already do role checking — only the allowed-roles arrays change. The sidebar and the guard script shift from `developer`-only to `admin`-capable. A DB migration widens the `role` column to accept the 9 new role slugs.

**Tech Stack:** Node.js / better-sqlite3 / Electron IPC / vanilla JS / Tailwind CSS v4

---

## File Map

| Action | File | What changes |
|--------|------|--------------|
| **Create** | `main/auth/permissions.js` | Central `PAGE_PERMISSIONS`, `SCOPED_ROLES`, `canAccessPage()`, `getAllowedPages()` |
| **Modify** | `main/db/migrations.js` | New migration `2026-04-050-role-hierarchy` — widens `role` CHECK / adds comment |
| **Modify** | `main/ipc/system.js` | `users:getAll` and `users:updateRole` — extend allowed roles, add validation |
| **Modify** | `main/ipc/ipc-helpers.js` | Export `ALLOWED_ROLES` constant imported from permissions.js |
| **Modify** | `main/ipc/auth.js` | `auth:login` session build — accept all 11 roles; sidebar role-badge label map |
| **Modify** | `js/sidebar.js` | Un-hide `#sidebar-users-link` for `admin` too; add per-role page hiding |
| **Modify** | `js/pages/settings-users-guard.js` | Allow `admin` role in addition to `developer` |
| **Modify** | `settings-users.html` | Update role `<select>` to list all 9 non-developer roles |
| **Modify** | `js/pages/settings-users.js` | Update role options in table dropdowns; show role Arabic labels |
| **Modify** | `js/cc-rules.js` (if it does per-page auth redirect) | Adapt to use new role list for redirect decisions |

---

## Phase 1 — Backend Permissions Foundation

### Task 1: Create `main/auth/permissions.js`

**Files:**
- Create: `main/auth/permissions.js`

- [ ] **Step 1: Create the file with full permissions map**

```js
// main/auth/permissions.js
// Single source of truth for page-level access control.
// 'developer' and 'admin' bypass all checks (handled in canAccessPage).

const ALL_STAFF = [
    'principal', 'supervisor', 'external-guardian', 'internal-guardian',
    'admin-assistant', 'educational-specialist', 'social-specialist', 'teacher', 'viewer',
];

// All valid role slugs that can be stored in the DB (excludes 'developer' — never stored).
const ALLOWED_ROLES = [
    'admin', 'principal', 'supervisor', 'external-guardian', 'internal-guardian',
    'admin-assistant', 'educational-specialist', 'social-specialist', 'teacher', 'viewer',
];

// Map of role slug → Arabic display label for UI.
const ROLE_LABELS = {
    'developer':            'مطوّر التطبيق',
    'admin':                'مدير التطبيق',
    'principal':            'مدير المؤسسة',
    'supervisor':           'الناظر',
    'external-guardian':    'الحارس العام للخارجية',
    'internal-guardian':    'الحارس العام للداخلية',
    'admin-assistant':      'مساعد إداري',
    'educational-specialist':'مختص تربوي',
    'social-specialist':    'مختص اجتماعي',
    'teacher':              'أستاذ',
    'viewer':               'مشاهد فقط',
};

// Alias: 'director' stored in legacy rows resolves to 'principal'.
const ROLE_ALIASES = { director: 'principal' };

const PAGE_PERMISSIONS = {
    'index':                         [...ALL_STAFF],
    'students-list':                 [...ALL_STAFF],
    'students-files':                [...ALL_STAFF],
    'students-register':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-movement':             ['principal','supervisor','external-guardian','admin-assistant'],
    'students-status':               ['principal','supervisor','external-guardian','admin-assistant'],
    'student-support':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'absence-students':              [...ALL_STAFF],
    'absence-weekly':                [...ALL_STAFF],
    'absence-analytics':             [...ALL_STAFF],
    'absence-correspondence':        ['principal','supervisor','external-guardian','internal-guardian','admin-assistant'],
    'grades-sheets':                 ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'grades-results':                ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'results-hub':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'exams-schedule':                ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','teacher','viewer'],
    'exams-rooms':                   ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-proctors':                ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'exams-tests':                   ['principal','supervisor','external-guardian','educational-specialist','teacher','viewer'],
    'teachers-list':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'teachers-schedule':             ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'teachers-performance':          ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','viewer'],
    'teachers-absence':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','viewer'],
    'staff-attendance':              ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'staff-daily-report':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','viewer'],
    'timetable':                     [...ALL_STAFF],
    'timetable-teachers':            ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-students':            [...ALL_STAFF],
    'timetable-rooms':               ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'timetable-redistribution':      ['principal','supervisor','admin-assistant'],
    'compensation-tracking':         ['principal','supervisor','external-guardian','admin-assistant','viewer'],
    'tracking-teachers-performance': ['principal','supervisor','external-guardian','admin-assistant','educational-specialist','viewer'],
    'analytics':                     ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','viewer'],
    'reports-forms':                 ['principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist'],
    'reports-certificates':          ['principal','supervisor','external-guardian','admin-assistant'],
    'reports-semester':              ['principal','supervisor','external-guardian','admin-assistant','educational-specialist'],
    'settings-school':               ['principal','external-guardian'],
    'settings-imports':              ['principal','supervisor','external-guardian'],
    'settings-users':                [], // admin + developer only — handled by canAccessPage bypass
    'settings-license':              [],
    'settings-logs':                 [],
    'settings-sync':                 [],
};

// Scoped restrictions applied on top of page access (enforced individually in each IPC handler).
const SCOPED_ROLES = {
    'internal-guardian': { absences: { absence_type: 'internal' } },
    'teacher':           { grades: 'by-section', absences: 'by-section' },
};

function resolveRole(role) {
    return ROLE_ALIASES[role] || role;
}

function canAccessPage(role, pageKey) {
    const r = resolveRole(role);
    if (r === 'developer' || r === 'admin') return true;
    return (PAGE_PERMISSIONS[pageKey] || []).includes(r);
}

function getAllowedPages(role) {
    const r = resolveRole(role);
    if (r === 'developer' || r === 'admin') return Object.keys(PAGE_PERMISSIONS);
    return Object.keys(PAGE_PERMISSIONS).filter((p) => PAGE_PERMISSIONS[p].includes(r));
}

module.exports = { PAGE_PERMISSIONS, SCOPED_ROLES, ALLOWED_ROLES, ROLE_LABELS, ROLE_ALIASES, canAccessPage, getAllowedPages, resolveRole };
```

- [ ] **Step 2: Verify the file was created**

```bash
node -e "const p = require('./main/auth/permissions.js'); console.log('roles:', p.ALLOWED_ROLES.length, 'pages:', Object.keys(p.PAGE_PERMISSIONS).length);"
```
Expected output: `roles: 10 pages: 38`

- [ ] **Step 3: Commit**

```bash
git add main/auth/permissions.js
git commit -m "feat(auth): add central permissions map with 11-role hierarchy"
```

---

### Task 2: Add DB Migration to Widen `role` Column

**Files:**
- Modify: `main/db/migrations.js`

> **Context:** The `users` table has `role TEXT DEFAULT 'staff'` with no CHECK constraint, so no DDL change is needed. The migration just updates existing `'staff'` rows and documents the new valid values via a comment row in `schema_migrations`.

- [ ] **Step 1: Open `main/db/migrations.js` and locate the last entry**

The last migration is `'2026-04-049-system-tags-allow-general'` (around line 908). Append **after** it, before the closing `];`:

```js
    {
        version: '2026-04-050-role-hierarchy',
        up(db) {
            // Rename legacy 'staff' rows to 'principal' as safest default upgrade.
            // Admins should reassign roles via settings-users.html after deployment.
            db.prepare("UPDATE users SET role = 'principal' WHERE role = 'staff'").run();
        },
    },
```

- [ ] **Step 2: Run the smoke test to confirm migration registration is valid**

```bash
npm run test:smoke
```
Expected: all checks pass (no IPC mismatch, migration file parses correctly).

- [ ] **Step 3: Commit**

```bash
git add main/db/migrations.js
git commit -m "feat(db): migration 050 — rename legacy staff role to principal"
```

---

### Task 3: Extend `users:getAll` and `users:updateRole` to Support New Roles

**Files:**
- Modify: `main/ipc/system.js`

> **Context:** Currently `users:updateRole` does blind `UPDATE users SET role = ?` with no validation. We need to reject unknown role slugs. Also `users:getAll` is gated `['admin']` — `developer` is bypassed by `requireRole` already, so this is fine as-is. We add role slug validation.

- [ ] **Step 1: Add import for `ALLOWED_ROLES` at top of `main/ipc/system.js`**

Current line 0:
```js
const { getDb } = require('../db/context');
```

Add after line 3 (after the existing requires):
```js
const { ALLOWED_ROLES } = require('../auth/permissions');
```

- [ ] **Step 2: Harden `users:updateRole` handler (around line 68)**

Replace the existing handler:
```js
ipcMain.handle('users:updateRole', async (event, id, role) => {
    try {
        requireRole(event, ['admin']);
        const db = getDb();
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
```

With:
```js
ipcMain.handle('users:updateRole', async (event, id, role) => {
    try {
        requireRole(event, ['admin']);
        if (!ALLOWED_ROLES.includes(role)) {
            return { success: false, error: `دور غير صالح: ${role}` };
        }
        const db = getDb();
        db.prepare('UPDATE users SET role = ? WHERE id = ?').run(role, id);
        return { success: true };
    } catch (err) {
        return { success: false, error: err.message };
    }
});
```

- [ ] **Step 3: Harden `users:add` role validation (around line 38)**

In the `users:add` handler, replace:
```js
payload.role || 'staff',
```
With:
```js
ALLOWED_ROLES.includes(payload.role) ? payload.role : 'principal',
```

- [ ] **Step 4: Run lint**

```bash
npm run lint
```
Expected: 0 errors.

- [ ] **Step 5: Commit**

```bash
git add main/ipc/system.js
git commit -m "feat(ipc): validate new role slugs in users:add and users:updateRole"
```

---

## Phase 2 — IPC Channel Role Guards

### Task 4: Update `auth:login` to Accept All 11 Roles in Session

**Files:**
- Modify: `main/ipc/auth.js`

> **Context:** `buildPublicSession` (lines 66–77 of auth.js) stores `role` verbatim from the DB row. The login handler already reads `role` from the DB user row. The 11 new slugs will flow through automatically once the DB rows have been updated. **No code change is required to the login handler itself.** However, we need to fix one thing: the sidebar's early-render check (in `sidebar.js` line 168) currently only accepts `['admin', 'staff', 'viewer', 'developer']`. That's a frontend concern handled in Task 6.

- [ ] **Step 1: Verify that `buildPublicSession` passes `role` through untouched**

Read `main/ipc/auth.js` lines 66–77 and confirm `role` is taken directly from `userRow.role`. No change needed if it reads: `role: userRow.role`.

```bash
node -e "
const src = require('fs').readFileSync('main/ipc/auth.js', 'utf8');
const match = src.match(/buildPublicSession[\s\S]{0,400}/);
console.log(match[0].slice(0,400));
"
```
Expected: you see `role: user.role` or `role: userRow.role` — confirm the field is passed through without a whitelist filter.

- [ ] **Step 2: If a role whitelist filter exists, remove it**

If you see something like:
```js
role: ['admin','staff','viewer'].includes(userRow.role) ? userRow.role : 'viewer',
```
Replace with:
```js
role: userRow.role,
```

If no filter exists, skip this step.

- [ ] **Step 3: Commit (only if a change was made)**

```bash
git add main/ipc/auth.js
git commit -m "fix(auth): pass all role slugs through buildPublicSession without filtering"
```

---

### Task 5: Gate IPC Write Channels Using New Roles

**Files:**
- Modify: `main/ipc/system.js` (already has `users:getAll` gated to `['admin']` — correct, no change)

> **Context per spec:** The IPC layer enforces backend protection via `handleWrite(ipcMain, channel, roles, handler)`. The `roles` array is the allow-list checked by `requireRole`. Page-level access in `permissions.js` already defines who can see each page; IPC channels are a second layer for write operations. The spec does not require every page to have a new IPC guard — only the `users:*` channels (already done in Task 3) and future write handlers that need to enforce the new roles. Existing write handlers that accept `['admin']` continue to work because `developer` bypasses all role checks. No bulk change is needed here unless a write handler currently accepts `['staff']`, which would now be an invalid role.

- [ ] **Step 1: Search for any `handleWrite` call using `'staff'` in the roles array**

```bash
grep -n "'staff'" main/ipc/*.js
```

- [ ] **Step 2: For each match found, update the roles array**

If you find e.g.:
```js
handleWrite(ipcMain, 'someChannel:save', ['admin', 'staff'], handler);
```
Update it to use the appropriate new roles from `PAGE_PERMISSIONS` that should have write access to that domain. Use `ALLOWED_ROLES` as the list if the channel should be accessible to all non-viewer roles:
```js
const { ALLOWED_ROLES } = require('../auth/permissions');
// ...
handleWrite(ipcMain, 'someChannel:save', ALLOWED_ROLES.filter(r => r !== 'viewer'), handler);
```

- [ ] **Step 3: Run lint and smoke test**

```bash
npm run lint && npm run test:smoke
```
Expected: 0 errors, all IPC parity checks pass.

- [ ] **Step 4: Commit**

```bash
git add main/ipc/*.js
git commit -m "fix(ipc): replace legacy 'staff' role with new role slugs in write channel guards"
```

---

## Phase 3 — Frontend Access Control

### Task 6: Update Sidebar Role Expansion Logic

**Files:**
- Modify: `js/sidebar.js`

> **Context:** The sidebar's early-render block (lines 162–191) reads `localStorage.getItem('gsl_auth_session_v1')` and checks if the role is in `['admin', 'staff', 'viewer', 'developer']`. It un-hides `#sidebar-users-link` and `#sidebar-license-link` only for `developer`. We need to:
> 1. Expand the accepted role list to include all 11 slugs (so the user info panel shows for `principal`, `supervisor`, etc.)
> 2. Un-hide `#sidebar-users-link` for `admin` as well (settings-users page is accessible to `admin`)
> 3. Keep `#sidebar-license-link` as developer-only

- [ ] **Step 1: Locate line 168 in `js/sidebar.js`**

Current:
```js
if (['admin', 'staff', 'viewer', 'developer'].includes(role)) {
```

Replace with:
```js
const ALL_KNOWN_ROLES = ['developer','admin','principal','supervisor','external-guardian','internal-guardian','admin-assistant','educational-specialist','social-specialist','teacher','viewer'];
if (ALL_KNOWN_ROLES.includes(role)) {
```

- [ ] **Step 2: Locate the `if (role === 'developer')` block (around line 183) that un-hides dev links**

Current:
```js
if (role === 'developer') {
    const licenseLink = document.getElementById('sidebar-license-link');
    if (licenseLink) licenseLink.classList.remove('hidden');
    const usersLink = document.getElementById('sidebar-users-link');
    if (usersLink) usersLink.classList.remove('hidden');
}
```

Replace with:
```js
if (role === 'developer') {
    const licenseLink = document.getElementById('sidebar-license-link');
    if (licenseLink) licenseLink.classList.remove('hidden');
}
if (role === 'developer' || role === 'admin') {
    const usersLink = document.getElementById('sidebar-users-link');
    if (usersLink) usersLink.classList.remove('hidden');
}
```

- [ ] **Step 3: Update role badge display (the `sidebar-auth-role-badge` span)**

Find where the role badge text is set. It likely reads `sess.role` directly. Update it to use Arabic labels:

Find the line that sets `sidebar-auth-role-badge` text content (search for `sidebar-auth-role-badge`):
```bash
grep -n "sidebar-auth-role-badge\|auth-role\|auth_role\|role-badge" js/sidebar.js
```

If it reads something like:
```js
roleEl.textContent = sess.role;
```
Replace with:
```js
const ROLE_LABELS_SIDEBAR = {
    'developer':'مطوّر','admin':'مدير','principal':'مدير المؤسسة','supervisor':'الناظر',
    'external-guardian':'حارس الخارجية','internal-guardian':'حارس الداخلية',
    'admin-assistant':'مساعد إداري','educational-specialist':'مختص تربوي',
    'social-specialist':'مختص اجتماعي','teacher':'أستاذ','viewer':'مشاهد'
};
roleEl.textContent = ROLE_LABELS_SIDEBAR[role] || role;
```

- [ ] **Step 4: Lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add js/sidebar.js
git commit -m "feat(sidebar): expand role whitelist to 11 roles; show users link for admin"
```

---

### Task 7: Update the Guard Script for `settings-users.html`

**Files:**
- Modify: `js/pages/settings-users-guard.js`

> **Context:** The guard (13 lines) reads `localStorage.getItem('gsl_auth_session_v1')` and redirects unless `session.role === 'developer'`. Per the spec, `settings-users` should be accessible to `admin` and `developer` (IPC is already gated to `admin`; `developer` bypasses all role checks). Change the guard to allow both.

- [ ] **Step 1: Replace the guard file content**

```js
(function enforceDeveloperOrAdminSession() {
    try {
        const raw = localStorage.getItem('gsl_auth_session_v1');
        if (raw) {
            const session = JSON.parse(raw);
            if (session && (session.role === 'developer' || session.role === 'admin')) {
                return;
            }
        }
    } catch {}

    window.location.replace('dashboard.html');
})();
```

- [ ] **Step 2: Verify the file**

```bash
node -e "require('fs').readFileSync('js/pages/settings-users-guard.js','utf8').includes('admin') && console.log('OK')"
```
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add js/pages/settings-users-guard.js
git commit -m "fix(guard): allow admin role to access settings-users page"
```

---

### Task 8: Rebuild the User Management UI with New Roles

**Files:**
- Modify: `settings-users.html`
- Modify: `js/pages/settings-users.js`

> **Context:** The current UI shows only 3 roles in the add-user form (`admin`, `staff`, `viewer`) and the same 3 in the inline role-change dropdown. We need to show all 9 storable roles (everything except `developer`). Also, `settings-users.js` line 152 has a syntax error (`always if` — should be just `if`).

#### 8a — Fix the HTML role `<select>`

- [ ] **Step 1: Open `settings-users.html` and replace the role `<select>` (lines 73–77)**

Current:
```html
<select id="role">
    <option value="admin">admin</option>
    <option value="staff">staff</option>
    <option value="viewer">viewer</option>
</select>
```

Replace with:
```html
<select id="role">
    <option value="admin">مدير التطبيق (admin)</option>
    <option value="principal">مدير المؤسسة (principal)</option>
    <option value="supervisor">الناظر (supervisor)</option>
    <option value="external-guardian">الحارس العام للخارجية</option>
    <option value="internal-guardian">الحارس العام للداخلية</option>
    <option value="admin-assistant">مساعد إداري</option>
    <option value="educational-specialist">مختص تربوي</option>
    <option value="social-specialist">مختص اجتماعي</option>
    <option value="teacher">أستاذ</option>
    <option value="viewer">مشاهد فقط (viewer)</option>
</select>
```

#### 8b — Fix `settings-users.js`: syntax error + role dropdown in table rows

- [ ] **Step 2: Fix the syntax error on line 152**

Current:
```js
always if (!response || response.success === false) {
```
Replace with:
```js
if (!response || response.success === false) {
```

- [ ] **Step 3: Define a shared role labels constant and role options builder at the top of the file**

Add after line 5 (after `let pageVisibilitySaving = false;`):
```js
const ROLE_OPTIONS = [
    { value: 'admin',                 label: 'مدير التطبيق' },
    { value: 'principal',             label: 'مدير المؤسسة' },
    { value: 'supervisor',            label: 'الناظر' },
    { value: 'external-guardian',     label: 'حارس الخارجية' },
    { value: 'internal-guardian',     label: 'حارس الداخلية' },
    { value: 'admin-assistant',       label: 'مساعد إداري' },
    { value: 'educational-specialist',label: 'مختص تربوي' },
    { value: 'social-specialist',     label: 'مختص اجتماعي' },
    { value: 'teacher',               label: 'أستاذ' },
    { value: 'viewer',                label: 'مشاهد فقط' },
];

function buildRoleSelect(userId, currentRole) {
    const options = ROLE_OPTIONS.map(({ value, label }) =>
        `<option value="${value}" ${currentRole === value ? 'selected' : ''}>${label}</option>`
    ).join('');
    return `<select onchange="changeRole(${userId}, this.value)">${options}</select>`;
}
```

- [ ] **Step 4: Update `loadRows()` to use `buildRoleSelect` (around line 102–107)**

Current render:
```js
<td>
    <select onchange="changeRole(${user.id}, this.value)">
        <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>admin</option>
        <option value="staff" ${user.role === 'staff' ? 'selected' : ''}>staff</option>
        <option value="viewer" ${user.role === 'viewer' ? 'selected' : ''}>viewer</option>
    </select>
</td>
```

Replace with:
```js
<td>${buildRoleSelect(user.id, user.role)}</td>
```

- [ ] **Step 5: Run lint**

```bash
npm run lint
```
Expected: 0 errors (the `always if` was the only syntax error).

- [ ] **Step 6: Commit**

```bash
git add settings-users.html js/pages/settings-users.js
git commit -m "feat(ui): update settings-users to list all 11 roles; fix syntax error"
```

---

## Phase 4 — Frontend Page-Level Redirect Guard

### Task 9: Add Client-Side Page Access Guard (cc-rules.js or per-page guard)

**Files:**
- Modify: `js/cc-rules.js` (if this is where per-page role checks live)

> **Context:** The spec requires the frontend to redirect users who navigate directly to a page they don't have access to. The backend IPC layer already blocks unauthorized writes — the frontend redirect is a UX safeguard. We need to expose `PAGE_PERMISSIONS` to the renderer via a preload channel so the client can check access without embedding the map in frontend JS.

- [ ] **Step 1: Check what `js/cc-rules.js` currently does**

```bash
head -60 js/cc-rules.js
```

Note what it currently guards and how it reads session/role.

- [ ] **Step 2: Add a new IPC channel `auth:getAllowedPages` to `main/ipc/auth.js`**

Append inside `registerAuthIpc(ipcMain)`, after the existing handlers:
```js
handleRead(ipcMain, 'auth:getAllowedPages', (db, event) => {
    const { getAllowedPages } = require('../auth/permissions');
    const session = getSessionByEvent(event);
    if (!session) return [];
    return getAllowedPages(session.role);
});
```

- [ ] **Step 3: Add `auth:getAllowedPages` to `preload.js`**

Locate the `auth:` block in `preload.js` (around line 218–230). Add:
```js
getAllowedPages: () => ipcRenderer.invoke('auth:getAllowedPages'),
```

- [ ] **Step 4: Update `js/cc-rules.js` to redirect on access denial**

Open `js/cc-rules.js`. If it already has per-page role checking, replace the role list. If it needs the redirect logic, add:

```js
(async function enforcePageAccess() {
    if (!window.api?.auth?.getAllowedPages) return;
    try {
        const currentPage = window.location.pathname.split('/').pop().replace('.html', '');
        // Pages that don't require auth (login, etc.)
        const PUBLIC_PAGES = ['login', 'dashboard'];
        if (PUBLIC_PAGES.includes(currentPage)) return;

        const allowed = await window.api.auth.getAllowedPages();
        if (!Array.isArray(allowed)) return; // not logged in — login.html will handle it
        if (!allowed.includes(currentPage)) {
            window.location.replace('dashboard.html');
        }
    } catch {
        // silently ignore — don't lock users out on error
    }
})();
```

- [ ] **Step 5: Run smoke test — verify IPC parity**

```bash
npm run test:smoke
```
Expected: passes (new channel `auth:getAllowedPages` must be declared in preload AND registered in main).

- [ ] **Step 6: Commit**

```bash
git add main/ipc/auth.js preload.js js/cc-rules.js
git commit -m "feat(frontend): add auth:getAllowedPages IPC + client-side page access redirect"
```

---

## Phase 5 — New User Registration Flow (`must_change_password`)

### Task 10: Enforce Password Change on First Login

**Files:**
- Modify: `main/ipc/auth.js` (already sets `must_change_password` — verify redirect works)
- Modify: `js/pages/login.js` (or wherever the post-login redirect is handled)

> **Context per spec:** When a new user is created with a generated temp password, `must_change_password = 1` is set in the DB. After login, `buildPublicSession` returns `mustChangePassword: true`. The login page JS must intercept this and force the user to the change-password screen before any navigation. Verify this already works.

- [ ] **Step 1: Check the login JS post-login redirect**

```bash
grep -n "mustChangePassword\|must_change\|changePassword\|change-password\|change_password" js/pages/login.js
```

Note if there is already a redirect to `changePassword` flow when `mustChangePassword === true`.

- [ ] **Step 2: Add the redirect if missing**

In `js/pages/login.js`, find the block that handles a successful login response. It will look like:
```js
if (response.authenticated) {
    window.location.href = 'dashboard.html';
}
```

Update to:
```js
if (response.authenticated) {
    if (response.user?.mustChangePassword) {
        // Store a flag so the change-password form knows this is a forced change
        sessionStorage.setItem('gsl_force_pw_change', '1');
        // Navigate to the change-password section of login
        window.location.href = 'login.html#change-password';
        return;
    }
    window.location.href = 'dashboard.html';
}
```

> Note: If the login page already has a dedicated change-password form (`#form-change-password`), activate it instead of navigating. Check the login.html structure and adapt accordingly.

- [ ] **Step 3: After a successful password change, clear `must_change_password`**

The `auth:changePassword` IPC handler in `main/ipc/auth.js` should also set `must_change_password = 0` after a successful change. Find and verify:

```bash
grep -n "must_change_password\|mustChangePassword" main/ipc/auth.js
```

If absent, locate the `auth:changePassword` handler and add:
```js
db.prepare('UPDATE users SET must_change_password = 0 WHERE id = ?').run(session.userId);
```
immediately after the password hash update.

- [ ] **Step 4: Lint**

```bash
npm run lint
```

- [ ] **Step 5: Commit**

```bash
git add js/pages/login.js main/ipc/auth.js
git commit -m "feat(auth): enforce must_change_password redirect on first login"
```

---

## Phase 6 — Smoke Test & Final Verification

### Task 11: Run Full CI Check and Verify End-to-End

**Files:** None (verification only)

- [ ] **Step 1: Build Tailwind**

```bash
npm run css:build
```
Expected: `css/tailwind-output.css` rebuilt with no errors.

- [ ] **Step 2: Run lint**

```bash
npm run lint
```
Expected: 0 errors, 0 warnings beyond pre-existing ones.

- [ ] **Step 3: Run smoke test**

```bash
npm run test:smoke
```
Expected:
- IPC parity: ✅ all preload channels match registered handlers (including new `auth:getAllowedPages`)
- No CDN references: ✅
- Tailwind output exists: ✅
- Module integrity: ✅

- [ ] **Step 4: Manual walkthrough checklist**

Start the app with `npm run start` and verify:

| Scenario | Expected |
|----------|----------|
| Login as `admin` | Sidebar shows "المستخدمون" link |
| Login as `principal` | Sidebar does NOT show "المستخدمون" |
| Login as `developer` | Both license + users links visible |
| Direct URL to `settings-users.html` as `principal` | Redirected to `dashboard.html` by guard |
| `admin` opens `settings-users.html` | User table loads, all 10 roles in dropdown |
| Add new user without password | Temp password shown in toast once |
| New user logs in | Forced to change password before seeing dashboard |
| `internal-guardian` navigates to `timetable-redistribution.html` directly | Redirected to `dashboard.html` by `cc-rules.js` |

- [ ] **Step 5: Final commit**

```bash
git add -u
git commit -m "chore: role-hierarchy implementation complete — all phases done"
```

---

## Self-Review Against Spec

### Spec coverage check

| Spec requirement | Task that implements it |
|-----------------|------------------------|
| 11 roles defined with correct IDs | Task 1 (`permissions.js`) |
| `ROLE_ALIASES`: `director` → `principal` | Task 1 |
| Page permissions map (38 pages × 9 roles) | Task 1 |
| `canAccessPage()` / `getAllowedPages()` functions | Task 1 |
| DB migration for new role values | Task 2 |
| Backend IPC protection | Tasks 3, 4, 5 |
| `internal-guardian` / `teacher` scoped restrictions documented | Task 1 (`SCOPED_ROLES`) |
| Settings-users accessible to `admin` (not just `developer`) | Tasks 7 (guard) + 6 (sidebar) |
| New user flow: temp password + `must_change_password = 1` | Task 10 |
| Role dropdown shows all 9 roles in UI | Task 8 |
| Frontend redirect on unauthorized direct navigation | Task 9 |
| `settings-users`, `settings-license`, `settings-logs`, `settings-sync` locked to admin/developer | Task 1 (`PAGE_PERMISSIONS` empty array) + Task 9 |
| Old `staff` role migrated | Task 2 |
| Old `linked_devices` / `device_otp` tables: no action needed (already absent per spec, no code touches them) | N/A |

### Gaps

- **Scoped enforcement for `internal-guardian` (absences) and `teacher` (grades by section):** `SCOPED_ROLES` is defined in `permissions.js` but enforcement in each IPC handler is NOT in scope of this plan — those handlers already have their own filtering logic and the spec marks these as `*` (restricted) without requiring new handler code. A follow-up plan should harden those handlers individually.

- **`staff` role in sync capture exclusion list** (`main/sync/capture.js` line 192): The `'staff'` string there is the channel name fragment `users:getAll` — not the role — so no change needed.

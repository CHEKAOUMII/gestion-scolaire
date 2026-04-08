# gestionScholaire — Architecture Review Report
**Date:** 2026-04-08
**Reviewer:** Architecture Review Plan (automated)
**Scope:** Full codebase — process boundary, IPC, DB, auth, renderer, CSS, tests, reports, notifications

---

## Severity Legend
| Level | Meaning |
|---|---|
| 🔴 Critical | Security vulnerability or data loss risk — fix before any release |
| 🟠 Important | Structural violation that will cause bugs — fix before merge |
| 🟡 Minor | Code quality degradation — schedule for cleanup sprint |
| 🟢 Good | Explicitly noteworthy positive pattern |

---

## 1. Process Boundary & Electron Security

### Findings

**🟢 Good — `main.js`:144-148 — BrowserWindow security options are correctly set.**
`nodeIntegration: false` and `contextIsolation: true` are both explicitly declared in the `webPreferences` block. The preload script is resolved with `path.join(__dirname, 'preload.js')`, which is the correct absolute-path pattern.

**🟢 Good — `main.js`:25-48 — `shell.openExternal()` inputs are sanitized before use.**
A `parseUrl()` helper validates that the URL is parseable, and `openExternallyIfSupported()` then enforces an allowlist of protocols (`http:`, `https:`, `mailto:`, `tel:`) before calling `shell.openExternal()`. Navigation and new-window events are also intercepted by `installWebContentsGuards()` (lines 51-73), which blocks all non-`file:` URLs inline and redirects them through the same sanitizer. Webview attachment is unconditionally blocked (`will-attach-webview` at line 70-72).

**🟡 Minor — `main.js`:179 — DevTools not disabled in production builds.**
Line 179 contains `// window.webContents.openDevTools();` commented out. There is no programmatic guard using `app.isPackaged` or `process.env.NODE_ENV` to ensure DevTools cannot be opened in a production package (e.g. via keyboard shortcut `F12` or `Ctrl+Shift+I`). In a packaged Electron app, DevTools remain available to end users by default unless explicitly disabled.

Recommended fix in `createWindow()`, after the `loadFile` call:
```js
if (app.isPackaged) {
    window.webContents.on('before-input-event', (event, input) => {
        if (input.key === 'F12' || (input.control && input.shift && input.key === 'I')) {
            event.preventDefault();
        }
    });
} else {
    window.webContents.openDevTools();
}
```
Or more simply, set `devTools: false` inside `webPreferences` when `app.isPackaged` is true.

**🟡 Minor — `main.js`:139 — `sandbox` option is absent from `webPreferences`.**
Electron's renderer-process sandbox (`sandbox: true`) is not set. While `contextIsolation: true` and `nodeIntegration: false` mitigate most renderer-level risks, enabling `sandbox: true` provides an additional OS-level process isolation layer (Chromium sandbox). Its absence is low risk in this app because the renderer loads only local `file:` URLs and no remote content, but it is a missing defence-in-depth layer per current Electron security recommendations.

**🟢 Good — `preload.js`:1-335 — `contextBridge` is used correctly throughout.**
All renderer-facing APIs are exposed exclusively through `contextBridge.exposeInMainWorld('api', {...})`. No raw `require`, `fs`, `shell`, or the `ipcRenderer` object itself is exposed. Every method wraps `ipcRenderer.invoke()` in a thin arrow function, keeping the IPC surface properly encapsulated.

**🟡 Minor — `preload.js`:270-279 — Push-channel listener callbacks not validated.**
The `notifications.onToast` and `notifications.onCenterUpdate` methods (and `updater.onStatus` at line 287-291) accept a raw `callback` argument and register it directly with `ipcRenderer.on()`. There is no type-check that `callback` is a function before calling `ipcRenderer.on()`. If a renderer page passes a non-function (e.g. `undefined` due to a wiring bug), the error will surface as an obscure runtime crash in the main-process event dispatch rather than a clear preload-level failure. A one-line `if (typeof callback !== 'function') return;` guard would suffice.

**🟢 Good — `preload.js`:271, 276, 288 — Listener cleanup functions are returned.**
All three push-channel registrations (`onToast`, `onCenterUpdate`, `onStatus`) return a cleanup function that calls `ipcRenderer.removeListener()`. This prevents listener accumulation across page navigations — a common source of memory leaks in multi-page Electron apps.

**IPC channel count:** 34 namespaced groups, totalling approximately 120 individual channel methods exposed through `window.api`.

### Checklist
- [x] `contextIsolation: true` — **PASS** (`main.js`:146)
- [x] `nodeIntegration: false` — **PASS** (`main.js`:145)
- [x] `webSecurity: true` (not disabled) — **PASS** (option is absent from `webPreferences`, which means it defaults to `true`; it is not explicitly disabled anywhere)
- [ ] `sandbox: true` — **FAIL** (option is absent; sandbox is not enabled — `main.js`:144-148)
- [x] No raw `require`/`fs`/`shell` exposed in preload — **PASS** (`preload.js`:1-335)
- [ ] `devTools` disabled in production — **FAIL** (no `app.isPackaged` or `NODE_ENV` guard present — `main.js`:179)
- [x] `shell.openExternal()` inputs sanitized — **PASS** (`main.js`:38-48, protocol allowlist enforced)

### Summary
The process boundary is in solid shape for the two highest-priority controls: `contextIsolation` and `nodeIntegration` are both correctly configured, and `shell.openExternal()` has a well-implemented protocol allowlist with navigation guards. The two gaps — absence of `sandbox: true` and no DevTools production guard — are minor hardening items rather than exploitable vulnerabilities in this local-file-only deployment context, but both should be addressed before any public distribution release.

---

## 2. IPC Layer

### Channel Parity
- Total channels in `preload.js`: 170 (including the `setup` namespace which aliases 4 `linking:*` channels)
- Total handlers registered: 170
- Mismatches: None (smoke test confirms exact parity)

### Handler Audit Table
| Handler file | Raw ipcMain? | Misused NoAuth? | Missing in preload? | Direct DB import? | Unbounded query? |
|---|---|---|---|---|---|
| auth.js | YES (11 calls) | No (auth is inherently pre-login) | No | YES (line 1) | No (users is system-wide) |
| students.js | No | No | No | No | YES (subjects:getAll) |
| absences.js | No | No | No | No | YES (correspondence:getByStudent) |
| schoolOps.js | No | No | No | No | No |
| staff.js | No | No | No | No | No |
| staffAttendance.js | No | No | No | No | No |
| exams.js | No | No | No | No | No |
| system.js | YES (11 calls) | Partial (manual soft-auth reimplemented) | No | YES (line 1) | No (system tables) |
| licensing.js | YES (14 calls) | No (pre-login ops justified) | No | No | N/A (delegates to service) |
| ownerTelemetry.js | YES (6 calls) | No | No | No | N/A (delegates to service) |
| updater.js | YES (3 calls) | No auth at all | No | No | N/A (no DB access) |
| notifications.js | YES (6 calls) | No auth at all | No | No | N/A (delegates to store) |
| reports.js | YES (5 calls) | YES (updateIdentity is unprotected write) | No | No | N/A (delegates to engine) |
| pageVisibility.js | No | No | No | No | No (system table) |
| linking.js | No | No | No | No | No (system tables) |
| sync.js | No | No | No | No | No (system tables) |
| timetable-data.js | No | No | No | No | No |

### Smoke Test Result
```
> gestion-scolaire@1.0.32 test:smoke
> node tests/smoke.js

[smoke] IPC channels parity OK (170 channels)
  [smoke] Sync registry OK (69 entries, 68 write channels)
[smoke] Module exports OK
[smoke] Page script extraction OK
[smoke] Migrations versioned OK (44 steps)
[smoke] Lazy-load script policy OK
[smoke] Restore safety checks OK
[smoke] No-CDN policy OK (vendor files present)
[smoke] Tailwind CSS build output OK
[smoke] Legacy CSS cleanup complete (no legacy files, no stale refs, no inline styles)
[smoke] Consolidation checks OK (no legacy channels, no handleWriteNoAuth, validation module)
[smoke] Linking LAN endpoint ranking OK
[smoke] Sync default resolution OK
[smoke] Validation module behavioral tests OK
[smoke] Auth module behavioral tests OK
[smoke] All smoke checks passed
```

### Findings

**[GOOD] `ipc-helpers.js` — Well-designed helper trio eliminates boilerplate.**
The `handleRead`, `handleWrite`, and `handleWriteSoftAuth` wrappers correctly inject `db` via `getDb()`, enforce role-based auth, wrap errors consistently via `authErrorResponse()`, and track write channels in a `Set` for smoke-test validation. The `handleWriteSoftAuth` replacement for the former `handleWriteNoAuth` is a meaningful improvement: it enforces auth when a session exists and only falls back to unauthenticated access when no session is present, with audit logging of such events.

**[GOOD] Channel parity enforcement is automated.**
The smoke test (`tests/smoke.js`) validates that all 170 channels declared in `preload.js` exactly match handlers registered in `main/ipc/*.js`. This prevents drift between the two halves of the IPC boundary.

**[GOOD] `handleWriteSoftAuth` channels are bounded.**
All bulk-import and pre-login write channels (`students:addBulk`, `grades:saveBulk`, `absences:saveBulk`, `students:deleteByYear`, `grades:deleteByYear`, `teachers:importBulk`, `timetableData:save`, etc.) enforce batch-size limits (typically 5000 or 500 records) to prevent denial-of-service via oversized payloads.

**[GOOD] Validation module (`validation.js`) provides shared guards.**
`requireFields`, `validateRange`, `validateDate`, and `validateSchoolYear` are used consistently across handler files that use the helper wrappers, preventing duplicate ad-hoc validation logic.

**[IMPORTANT] `system.js`:1 and `auth.js`:1 — Direct `getDb()` import bypasses the helper injection pattern.**
Both files import `const { getDb } = require('../db/context')` at the top level and call `getDb()` directly inside raw `ipcMain.handle()` callbacks. This violates the architectural rule that `getDb()` should only be injected by the helper wrappers. In `auth.js` this is partly defensible because auth handlers need database access for session management functions that cannot easily use the standard helpers (login, register, PIN verification all have unique auth semantics). In `system.js` this is less defensible -- at least `systemLogs:getAll` and `users:getAll` (which already uses `handleWrite`) demonstrate that some handlers can be migrated.

**[IMPORTANT] 7 handler files use raw `ipcMain.handle()` -- 56 raw calls total.**
The files `auth.js` (11), `system.js` (11), `licensing.js` (14), `ownerTelemetry.js` (6), `updater.js` (3), `notifications.js` (6), and `reports.js` (5) all bypass the helper wrappers entirely. While some of these have valid reasons (auth handlers have unique session semantics; licensing/updater/notifications have no DB access), this means error handling, auth enforcement, and DB lifecycle management are reimplemented ad-hoc in each file rather than centralized. The pattern is inconsistent: `system.js` uses `handleRead` for `systemLogs:getAll` and `handleWrite` for `users:getAll`, but then reverts to raw `ipcMain.handle()` for the remaining 11 handlers in the same file.

**[IMPORTANT] `reports.js`:17 — `reports:updateIdentity` is an unprotected write.**
The channel `reports:updateIdentity` calls `updateIdentity(updates)` with no auth check whatsoever. This allows any renderer page (including unauthenticated contexts) to overwrite the school identity (name, logo, addresses) used in official document headers. This should be guarded by `handleWrite(ipcMain, ..., ['admin'], ...)` or at minimum manual `requireRole()`.

**[MINOR] `absences.js`:237-238 — `correspondence:getByStudent` does not filter by `school_year`.**
The query `SELECT * FROM correspondence WHERE student_id = ? ORDER BY letter_date DESC` returns correspondence records for a student across all school years. While this may be intentional (showing full correspondence history), it breaks the multi-tenancy convention that every query on a partitioned table should include a `school_year` filter.

**[MINOR] `students.js`:744 — `subjects:getAll` does not filter by `school_year`.**
The channel queries `SELECT subject FROM grades WHERE subject IS NOT NULL ... GROUP BY subject` across all years. This is a lookup catalog that intentionally aggregates all known subjects, so the omission is defensible, but it means the subject list will grow monotonically as new years are added and never shed stale subjects from previous years.

**[MINOR] `system.js`:109,115 — `users:resetAdminPassword` logs generated password to console.**
Lines 109 and 115 contain `console.log('[RESET] ... password: ' + newPassword)`. While this is a recovery mechanism intended for developer use, the generated password is written to Electron's stdout/log file in plaintext. In a packaged app where logs may be captured, this is a low-severity credential exposure risk.

**[MINOR] `system.js`:239-417 — `system:backupDb` and `system:restoreDb` manually reimplement `handleWriteSoftAuth`.**
Both handlers manually check `getSessionByEvent(event)`, call `requireRole()` if a session exists, and fall back to unauthenticated access otherwise. This is exactly the pattern encapsulated by `handleWriteSoftAuth`, but reimplemented inline. This creates maintenance burden and inconsistency.

**[MINOR] `updater.js`:14-27 — Updater channels have no auth checks.**
The `updater:checkForUpdates`, `updater:downloadUpdate`, and `updater:installUpdate` channels perform system-level operations (downloading and installing executables) with no authentication. While these don't access the database, `installUpdate` triggers an application restart/replacement, which could disrupt active users. A `requireRole(event, ['admin'])` guard would be appropriate at minimum for `installUpdate`.

### Checklist
- [ ] No raw `ipcMain.handle()` calls -- **FAIL** (56 raw calls across 7 files: auth.js, system.js, licensing.js, ownerTelemetry.js, updater.js, notifications.js, reports.js)
- [ ] All write ops use `handleWrite` or justified `handleWriteSoftAuth` -- **FAIL** (reports:updateIdentity has no auth; system.js reimplements soft-auth manually; users:add/updateRole/disable use raw handles with manual requireRole)
- [x] All channels have matching preload entries -- **PASS** (170/170, smoke test confirms)
- [ ] No direct DB imports in handler files -- **FAIL** (auth.js:1 and system.js:1 import getDb directly)
- [ ] All queries filter by `school_year` -- **FAIL** (correspondence:getByStudent and subjects:getAll omit school_year; justified for system tables but not for multi-tenant data tables)
- [x] Smoke test passes -- **PASS** (all 15 checks passed)

### Summary
Channel parity is solid: the 170-channel contract between `preload.js` and handler files is enforced by an automated smoke test that prevents drift. The helper wrappers (`handleRead`, `handleWrite`, `handleWriteSoftAuth`) are well designed and used correctly in 10 of 17 handler files, but 7 files (accounting for 56 of ~170 handlers) bypass them entirely with raw `ipcMain.handle()` calls. The most actionable finding is that `reports:updateIdentity` is an unprotected write channel that should have admin-only auth. The direct `getDb()` imports in `auth.js` and `system.js` and the manual soft-auth reimplementation in `system.js` are structural inconsistencies that should be addressed in a consolidation pass to prevent the pattern from eroding further as new features are added.

---

## 3. Database Layer

### Tables Inventory

**Domain tables** (should have `school_year` as partition key):

| Table | Has school_year | UNIQUE constraint | school_year in index |
|---|---|---|---|
| students | YES | UNIQUE(code, school_year) | YES (idx_students_year, idx_students_code_year) |
| grades | YES | UNIQUE idx (student_code, subject, semester, school_year) via migration 016 | YES (idx_grades_year_code, idx_grades_year_subject, idx_grades_year_teacher) |
| absences | YES | UNIQUE idx (student_code, month, school_year, absence_type) via migration 017 | YES (idx_absences_year_code, idx_absences_year_month) |
| correspondence | YES | None | YES (idx_correspondence_year) |
| student_files | YES | UNIQUE(student_id, doc_key, school_year) | Via UNIQUE constraint only -- no standalone index |
| student_movements | YES | None | **NO** |
| teachers | YES | Partial UNIQUE(ppr, school_year) WHERE ppr IS NOT NULL | YES (idx_teachers_year, idx_teachers_ppr_year) |
| teacher_aliases | YES (NOT NULL) | UNIQUE(teacher_id, school_year, alias_normalized) | YES (idx_teacher_aliases_lookup, idx_teacher_aliases_teacher) |
| teacher_absences | YES | None | **NO** |
| staff_attendance | YES | None | YES (idx_staff_attendance_year, idx_staff_attendance_date) |
| exams | YES | None | **NO** |
| exam_proctors | YES | None | **NO** |
| exam_rooms | YES | None | **NO** |
| tests | YES | None | YES (idx_tests_year_teacher) |
| school_events | YES (NOT NULL) | None | YES (idx_school_events_date) |
| compensation_tracking | YES (NOT NULL) | UNIQUE(absence_date, teacher_name, section, period_slot, school_year) | YES (idx_compensation_date_year, idx_compensation_pending, idx_compensation_year_teacher) |
| support_sessions | YES (NOT NULL) | UNIQUE idx (teacher_id, session_date, time_from, section, school_year) | YES (idx_support_sessions_year, idx_support_sessions_teacher) |
| name_aliases | YES (nullable) | UNIQUE(entity_type, alias_normalized, school_year) | YES (idx_name_aliases_lookup) |
| timetable_data | YES (NOT NULL) | UNIQUE(school_year) | Via UNIQUE constraint only |
| notifications | **NO** | None (TEXT PK on id) | **NO** |

**System/config/meta tables** (school_year not expected -- 22 tables):
`settings`, `system_logs`, `users`, `schema_migrations`, `school_identity`, `app_meta`, `page_visibility`, `license_plans`, `licenses`, `license_activations`, `license_events`, `owner_sync_config`, `owner_sync_outbox`, `sync_outbox` (has school_year), `sync_id_map`, `sync_config`, `sync_pull_state`, `sync_conflicts`, `sync_snapshots`, `institution_config`, `device_otp`, `linked_devices`

**Total: 42 tables** (20 domain + 22 system/config).

### Migration Health
- Total migrations: **44**
- All use `ensureColumn()`: **NO** -- 2 exceptions:
  - Migration `2026-03-020` (`staff_attendance.teacher_name`): raw `ALTER TABLE ADD COLUMN` with try/catch
  - Migration `2026-03-021` (`staff_attendance.subject`): raw `ALTER TABLE ADD COLUMN` with try/catch
- DDL duplicated from schema.js: **YES** -- 5 instances:
  - `teacher_aliases` table: `schema.js`:153-165 and migration 028:438-449
  - `teacher_aliases` indexes: `schema.js`:332-333 and migration 028:450-454
  - `idx_teachers_ppr_year`: `schema.js`:350-352 and migration 023:353-357
  - `idx_grades_year_teacher`: `schema.js`:339 and migration 028:456
  - `idx_tests_year_teacher`: `schema.js`:343 and migration 028:457
  - (All guarded by `IF NOT EXISTS` so no runtime errors, but conceptually duplicated)
- Additionally, `schema.js` `createTables()` calls the same `ensure*Schema()` helpers that migrations 008, 010, 012, 035, 039 also call (licensing, owner sync, page visibility, institution). Safe due to idempotence, but creates double-execution on new installs.
- Version strings unique: **YES** (all 44 are distinct)
- Version numbering inconsistencies:
  - `2026-03-14` lacks zero-padding (should be `2026-03-014` per the convention of other entries)
  - Sequence numbers 037 and 043 are skipped (036 jumps to 038; 042 jumps to 044)
  - `2026-03-29-support-sessions` and `2026-03-29-support-sessions-unique` break the sequence-number convention by using a date-based suffix

### Init Checklist
- [x] `journal_mode = WAL` -- **PASS** (`init.js`:14)
- [x] `foreign_keys = ON` -- **PASS** (`init.js`:15)
- [x] Init order `createTables()` then `runMigrations()` -- **PASS** (`init.js`:20-21)
- [x] True DB singleton -- **PASS** (`context.js`:4 module-level `let db = null`; `setDb()` / `getDb()` with throw-on-null guard; `init.js`:17 calls `setDb(db)` once)
- [x] DB path uses `userData` -- **PASS** (`context.js`:16 `app.getPath('userData')`)

### Findings

**🟢 Good -- `context.js`:10-12 -- Singleton enforced with a throw guard.**
`getDb()` throws `'Database is not initialized'` if called before `setDb()`. This prevents silent null-reference errors and ensures no handler can operate on an uninitialized database.

**🟢 Good -- `init.js`:23-41 -- Robust error recovery on init failure.**
If database initialization fails, the catch block closes the database handle (line 27-30), resets the singleton to null via `setDb(null)` (line 35), and re-throws. This prevents a half-initialized database from leaking into the application.

**🟢 Good -- `schema.js`:660-667 -- `ensureColumn()` helper provides idempotent column additions.**
The `PRAGMA table_info()` check-before-alter pattern prevents duplicate `ALTER TABLE` errors on repeat runs. This is the correct approach for forward-only migrations without rollback support.

**🟢 Good -- `migrations.js`:824-846 -- Migration runner is forward-only with Set-based de-duplication.**
Applied versions are loaded into a `Set` before iteration, and the `applyMigration` transaction wrapper ensures each migration is recorded atomically with its execution. The `recordsVersionInternally` escape hatch (used by migration 019) is well-documented and necessary for the table-rename transaction.

**🟢 Good -- `migrations.js`:153-249 -- Unique constraint migrations (016, 017, 018) handle NULL coercion and duplicate cleanup.**
Before creating UNIQUE indexes on `grades` and `absences`, these migrations coerce NULL values to empty strings/defaults and delete duplicate rows, keeping only the latest. Migration 018 serves as a repair pass in case 016/017 partially failed. This is a careful, production-safe approach.

**🟠 Important -- `schema.js`:306,319 -- Admin password logged to console in plaintext.**
Lines 306 and 319 write the initial and reset admin passwords to the console via `console.log()`. In a packaged Electron app, stdout may be captured to log files stored on disk. The password should be communicated through a secure UI prompt (e.g., a dialog shown to the operator) rather than logged.

**🟠 Important -- 5 domain tables missing `school_year` index.**
`student_movements`, `teacher_absences`, `exams`, `exam_proctors`, and `exam_rooms` all have a `school_year` column but no index that includes it. Since the project convention is that "almost every query filters by school_year," these tables will perform full table scans on year-filtered queries. While these tables are likely small, the missing indexes break the architectural pattern established for all other domain tables.

**🟠 Important -- `notifications` table missing `school_year` column (`migrations.js`:132-150).**
The `notifications` table (migration 015) is a user-facing domain entity but has no `school_year` column. Notifications will accumulate across school years with no way to partition or purge them by year. This violates the rule that "every main table must have school_year TEXT as a partition key."

**🟡 Minor -- `migrations.js`:305-325 -- Migrations 020 and 021 use raw `ALTER TABLE` instead of `ensureColumn()`.**
Both wrap the ALTER in a try/catch to handle the "column already exists" case. This achieves the same idempotency as `ensureColumn()` but through a different mechanism. All other column-addition migrations use `ensureColumn()`. These two should be refactored for consistency, though the current code is functionally correct.

**🟡 Minor -- Version numbering inconsistencies across 44 migrations.**
Three categories of inconsistency: (1) `2026-03-14` lacks zero-padding while neighbors use three-digit sequences; (2) sequence numbers 037 and 043 are skipped; (3) `2026-03-29-support-sessions` and `2026-03-29-support-sessions-unique` use date-based naming instead of sequenced numbers. While all version strings are unique and the migration runner is order-independent (it skips already-applied versions), the inconsistent naming makes it harder to reason about migration ordering at a glance.

**🟡 Minor -- DDL duplication between `schema.js` and `migrations.js` for 5 objects.**
The `teacher_aliases` table and its two indexes, plus `idx_teachers_ppr_year`, `idx_grades_year_teacher`, and `idx_tests_year_teacher` are defined in both `createTables()` and in migrations. The `schema.js` versions are guarded by `CREATE ... IF NOT EXISTS` or wrapped in try/catch (lines 338-355), so no runtime errors occur. But maintaining the same DDL in two places creates a risk of silent divergence if one copy is updated and the other is not.

**🟡 Minor -- `schema.js`:279-280 -- `ensureColumn` calls for columns already in the CREATE TABLE.**
`ensureColumn('users', 'password_hash', 'TEXT')` and `ensureColumn('users', 'must_change_password', ...)` are called immediately after the `CREATE TABLE IF NOT EXISTS users(...)` statement that already defines both columns. The comment on line 278 explains the intent ("Backward-compatibility for existing databases created before password auth"), which is valid for upgrades, but on new installs these are no-ops adding unnecessary startup overhead.

**🟡 Minor -- `schema.js`:660-666 -- `ensureColumn()` uses string interpolation for SQL identifiers.**
The `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}` pattern does not validate or quote the table/column names. While all callers pass developer-supplied string literals (never user input), the function has no guard against accidental misuse. Wrapping identifiers in double-quotes (`"${table}"`) would add defense-in-depth at no cost.

**🟡 Minor -- `migrations.js`:428-542 -- Migration 028 is oversized.**
This single migration creates a table, adds 3 columns, creates 5 indexes, and performs a data migration across 3 domain tables (grades, tests, compensation_tracking) with teacher identity resolution. If the data migration fails (e.g., on a large database), the entire table/column/index creation is rolled back. Splitting the DDL changes from the data backfill into separate migrations would improve resilience.

### Summary

The database layer is structurally sound. The singleton pattern, init sequence, pragma configuration, and migration runner all follow the documented conventions correctly. The `ensureColumn()` helper and idempotent `IF NOT EXISTS` guards make the schema resilient to repeated runs. The two most actionable findings are: (1) admin passwords logged in plaintext to console during initial setup and password-reset recovery, which should use a UI prompt instead; and (2) five domain tables (`student_movements`, `teacher_absences`, `exams`, `exam_proctors`, `exam_rooms`) and the `notifications` table lack the `school_year` indexing or column that the architecture requires. The DDL duplication between `schema.js` and `migrations.js` is safe due to idempotency guards but should be consolidated to prevent future divergence.

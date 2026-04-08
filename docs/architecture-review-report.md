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

---

## 4. Auth & Licensing Security

### Password Hashing
- Algorithm: `crypto.scryptSync` with key length 64 bytes (`password.js`:3,21)
- Salt: random per-password via `crypto.randomBytes(16)` (`password.js`:20)
- Format: `scrypt$<salt>$<hash>` (`password.js`:22)
- Timing-safe comparison: **YES** -- `crypto.timingSafeEqual()` on Buffer-converted hex values (`password.js`:42-45), with length pre-check at line 44

### License Key Integrity
- Signing mechanism: HMAC-SHA256 via `crypto.createHmac('sha256', secret)` (`offlineKey.js`:82)
- Key format: `GSLK-<base64url_payload>.<base64url_hmac_signature>` (`offlineKey.js`:111)
- Signature comparison: timing-safe via `safeEqual()` helper using `crypto.timingSafeEqual()` (`offlineKey.js`:74-78, called at lines 131 and 138)
- Secret hardcoded in source: **NO** -- resolved via a three-tier priority: (1) `GESTION_LICENSE_SECRET` env var, (2) per-installation `.license-secret` file in `userData`, (3) auto-generated `crypto.randomBytes(64)` persisted on first launch (`offlineKey.js`:30-62)
- Validated per-call or only at startup: **activation-only** -- `decodeOfflineLicenseKey()` verifies the HMAC signature during `activateLicense()` (`service.js`:319). Subsequent `getLicenseStatus()` calls query the stored DB record by `license_key_hash` (SHA256 of the key) without re-verifying the HMAC signature (`service.js`:120-191)

### Device Fingerprint
- Attributes used: OS platform, CPU architecture, CPU model, CPU core count, total memory (bucketed to 0.5 GB), Windows MachineGuid (registry), BIOS serial number (wmic), baseboard serial number (wmic), MAC addresses (non-internal, non-null) (`deviceFingerprint.js`:44-74)
- Stable across reboots: **YES** -- all attributes are hardware-based and persist across reboots; fuzzy matching with `REINSTALL_MATCH_THRESHOLD = 70` (`deviceFingerprint.js`:5) tolerates minor changes (e.g., MAC address changes from network adapter swaps) via weighted vector scoring (`deviceFingerprint.js`:121-156)

### AWS Credentials
- Not applicable -- no AWS services are used. The telemetry system (`ownerSync.js`) communicates with a custom HTTP server using bearer-style tokens passed in `x-owner-token` headers (`ownerSync.js`:339-341)
- Sourced from env vars: **YES** -- `OWNER_SYNC_WRITE_TOKEN`, `OWNER_SYNC_READ_TOKEN`, `OWNER_SYNC_URL` (`ownerSync.js`:49-55)
- Never hardcoded: **YES** -- `ownerSyncDefaults.js` sets all token defaults to empty strings (`ownerSyncDefaults.js`:5-11)

### Findings

**🟢 Good -- `password.js`:18-23 -- Password hashing follows all required conventions.**
Uses `crypto.scryptSync` with 64-byte key length, random 16-byte salt via `crypto.randomBytes(16)`, and the documented `scrypt$<salt>$<hash>` format. The salt parameter defaults to random but accepts an explicit value for internal use; all production call sites rely on the default random generation.

**🟢 Good -- `password.js`:42-45 -- Password verification uses `timingSafeEqual` with no `===` fallback.**
The comparison converts both hex strings to Buffers and uses `crypto.timingSafeEqual()`. The length pre-check at line 44 (`if (a.length !== b.length) return false`) is required by Node.js (which throws on mismatched Buffer lengths) and does not leak timing information about the hash content, only the key length (which is always fixed at 64 bytes).

**🟢 Good -- `offlineKey.js`:30-62 -- License signing secret is never hardcoded.**
The `getSigningSecret()` function uses a strict three-tier resolution: env var first, then per-installation persistent file, then auto-generate and persist. There are no fallback string literals or default secrets anywhere in the source. When running outside Electron without the env var, an explicit error is thrown with instructions (`offlineKey.js`:57-60).

**🟢 Good -- `offlineKey.js`:74-78 -- HMAC signature comparison is timing-safe.**
The `safeEqual()` helper converts both strings to UTF-8 Buffers and uses `crypto.timingSafeEqual()`. This is used for all signature comparisons during license key decoding (lines 131 and 138).

**🟢 Good -- `offlineKey.js`:51-53 -- Per-installation secret is generated with `crypto.randomBytes(64)` and written with restrictive permissions.**
The auto-generated secret is 128 hex characters (64 random bytes) and the file is created with `mode: 0o600` (owner read/write only).

**🟢 Good -- `ownerSyncDefaults.js`:1-18 -- All telemetry tokens default to empty strings.**
No credentials are baked into the defaults file. Sync is disabled by default (`enabled: false` at line 15) and requires explicit configuration. The `ownerSync.js` bootstrap (`getBootstrapDefaults`) further enforces this: if `serverUrl` or `writeToken` is empty, sync is forced disabled (`ownerSync.js`:72-74).

**🟢 Good -- `deviceFingerprint.js`:77-108 -- Fingerprint vector uses one-way SHA256 hashes.**
Individual hardware attributes are hashed before storage, preventing reconstruction of raw hardware identifiers from the stored fingerprint vector. Only hashed values are persisted to the database or transmitted via telemetry.

**🟡 Minor -- `offlineKey.js`:53 -- File permission `mode: 0o600` has limited effect on Windows.**
The target platform is Windows (`CLAUDE.md` specifies Windows NSIS installer). Unix-style `mode` flags passed to `fs.writeFileSync` are not enforced by the Windows filesystem (NTFS uses ACLs, not POSIX permissions). The `.license-secret` file in `userData` is protected only by the user's profile directory ACLs, which is adequate for most threat models but is not an explicit restrictive permission as the code implies. On Linux/macOS if the app were ever ported, the `0o600` mode would work as intended.

**🟡 Minor -- `offlineKey.js`:14 -- Signing secret is cached in module-level variable for process lifetime.**
`_cachedSecret` retains the signing secret in process memory once loaded. This is standard practice for performance reasons and is not exploitable without process memory access, but it means the secret cannot be rotated without restarting the Electron app.

**🟡 Minor -- `password.js`:18 -- `hashPassword` accepts an optional `saltHex` parameter.**
The function signature `hashPassword(password, saltHex = null)` allows callers to supply a fixed salt, which would produce deterministic hashes. All current callers rely on the `null` default (random salt), so this is not an active vulnerability. However, the parameter is exported publicly via `module.exports` and could be misused by future code. Consider removing the parameter from the public API or adding a JSDoc warning.

**🟡 Minor -- `service.js`:120-191 -- License status checks do not re-verify HMAC signature.**
After initial activation (where the HMAC is verified), `getLicenseStatus()` trusts the DB record without re-verifying the original license key's signature. This means that if the SQLite database file is manually tampered with (e.g., modifying `plan_code`, `expires_at`, or `status` fields in the `licenses` table), the application would honor the tampered values. For a locally-installed desktop app where the user has full filesystem access, this is an accepted trade-off -- the user could also replace the entire application binary. However, storing a signature digest alongside the license record and re-verifying on status check would add a defense-in-depth layer against casual tampering.

**🟡 Minor -- `offlineKey.js`:134-139 -- Fallback signature verification path broadens acceptance.**
When the primary signing secret does not verify a license key, `decodeOfflineLicenseKey` falls back to the per-installation `.license-secret` file as a secondary verification source. This is documented as backward compatibility for old serials, but it means a key signed with any previous signing secret used on the same machine will be accepted even after the signing secret changes (e.g., after setting a new `GESTION_LICENSE_SECRET` env var). The window of exposure is narrow (limited to the same machine's history), but the fallback should be documented in the code with a comment explaining when it can be safely removed.

### Summary

The auth and licensing security implementation is well-executed across all critical requirements. Password hashing correctly uses `crypto.scryptSync` with random per-password salts and `timingSafeEqual` for comparison -- no `===` hash comparisons exist anywhere. License key signing uses HMAC-SHA256 with a secret that is never hardcoded in source: it is sourced from an environment variable or a per-installation auto-generated file. Telemetry credentials default to empty strings and are sourced from environment variables. No critical or important findings were identified. The minor findings -- Windows file permission semantics, module-level secret caching, public `saltHex` parameter, activation-only signature verification, and the fallback verification path -- are all low-risk items appropriate for a hardening pass rather than urgent remediation.

---

## 5. Renderer Architecture

### Scope

Audited all 24 files in `js/pages/`, plus the three shared renderer modules (`js/utils.js`, `js/message-system.js`, `js/ux-enhancements.js`). Each page file was checked against seven violation categories mandated by `CLAUDE.md`.

### Shared Module Verification

| Global | File | Line | Status |
|---|---|---|---|
| `PERIOD_MAP` | `js/utils.js` | 2552 | PRESENT -- maps `h1`-`h8` and `H1`-`H8` to absolute time strings |
| `MORNING_HOUR_MAP` | `js/utils.js` | 2564 | PRESENT -- maps `H1`-`H4` to morning times |
| `AFTERNOON_HOUR_MAP` | `js/utils.js` | 2570 | PRESENT -- maps `H1`-`H4` to afternoon times |
| `resolveSlotTime()` | `js/utils.js` | 2582 | PRESENT -- slot label to time string with fallback |
| `mergeConsecutivePeriods()` | `js/utils.js` | 2598 | PRESENT -- merges consecutive time periods with section awareness |
| `FilterManager` | `js/utils.js` | 2640 | PRESENT -- unified dropdown filtering class using `window.api.classes.getAll()` and `window.api.subjects.getAll()` |
| `showConfirm()` | `js/message-system.js` | exported | PRESENT -- Promise-based confirmation dialog |
| `showToast()` | `js/ux-enhancements.js` | exported | PRESENT -- standard toast notification with `.loading()` and `.action()` variants |
| `setFieldValidation()` | `js/message-system.js` | exported | PRESENT -- inline form field validation |

All six required `utils.js` globals and all three `message-system.js` / `ux-enhancements.js` globals are present and correctly implemented.

### Violation Matrix

| # | Page file | V1: Local PERIOD_MAP copy | V2: localStorage for dropdowns | V3: No FilterManager | V4: Raw alert/confirm/prompt | V5: Delete without showConfirm | V6: No pagination | V7: Delete without edit |
|---|---|---|---|---|---|---|---|---|
| 1 | `dashboard-init.js` | -- | -- | N/A | **YES** (prompt, L16) | -- | N/A | N/A |
| 2 | `grades-sheets.js` | -- | -- | PASS | -- | -- | PASS | N/A |
| 3 | `analytics.js` | -- | -- | PASS | -- | -- | N/A | N/A |
| 4 | `students-list.js` | -- | -- | PASS | -- | -- | PASS (PAGE_SIZE=25) | N/A |
| 5 | `students-status.js` | -- | -- | PASS | -- | -- | **YES** | N/A |
| 6 | `student-profile.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 7 | `teachers-list.js` | -- | -- | PASS | -- | PASS | PASS (PAGE_SIZE=20) | PASS |
| 8 | `teachers-performance.js` | -- | -- | PASS | -- | -- | **YES** | N/A |
| 9 | `timetable.js` | **YES** (L1661-1662) | -- | N/A | -- | PASS | N/A | N/A |
| 10 | `timetable-rooms.js` | **YES** (L8-13) | -- | N/A | -- | -- | N/A | N/A |
| 11 | `timetable-students.js` | **YES** (L8-13) | -- | N/A | -- | -- | N/A | N/A |
| 12 | `timetable-redistribution.js` | **YES** (L770-774) | -- | N/A | -- | -- | PASS (PAGE_SIZE=20) | N/A |
| 13 | `support-sessions.js` | -- | -- | PASS | -- | PASS | PASS (PER_PAGE=20) | **YES** (L417) |
| 14 | `settings-imports.js` | -- | -- | N/A | **YES** (alert, L501) | PASS | N/A | N/A |
| 15 | `settings-school.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 16 | `settings-users.js` | -- | -- | N/A | -- | -- | N/A | Partial |
| 17 | `settings-license.js` | -- | -- | N/A | -- | PASS | N/A | N/A |
| 18 | `settings-sync.js` | -- | -- | N/A | -- | PASS | PASS (pageSize=50) | N/A |
| 19 | `settings-license-guard.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 20 | `settings-users-guard.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 21 | `setup.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 22 | `login.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 23 | `reports-forms.js` | -- | -- | N/A | -- | -- | N/A | N/A |
| 24 | `reports-certificates.js` | -- | -- | N/A | -- | -- | N/A | N/A |

**Legend:** `--` = not applicable / not present; `N/A` = check does not apply to this page type; `PASS` = compliant; `Partial` = partially compliant (see findings); `YES` = violation found (bold).

### Violation Counts

| Category | Files affected | Total |
|---|---|---|
| V1: Local PERIOD_MAP / hour-map duplication | timetable.js, timetable-rooms.js, timetable-students.js, timetable-redistribution.js | **4** |
| V2: localStorage timetableData for dropdown population | (none) | **0** |
| V3: Missing FilterManager where needed | (none -- justified exceptions) | **0** |
| V4: Raw alert / confirm / prompt | dashboard-init.js, settings-imports.js | **2** |
| V5: Delete without showConfirm | (none) | **0** |
| V6: Missing pagination on data tables | students-status.js, teachers-performance.js | **2** |
| V7: Delete button without sibling edit button | support-sessions.js | **1** |

**Additional violation (not in the original seven):**
| Category | Files affected | Total |
|---|---|---|
| Local showToast shadow overriding global | timetable.js | **1** |

### Findings

**V1: Local PERIOD_MAP / hour-map duplication (4 files)**

**[IMPORTANT] `timetable-rooms.js`:8-13 -- `defaultHourLabels` duplicates `MORNING_HOUR_MAP`.**
```js
const defaultHourLabels = {
    H1: '08:30-09:30',
    H2: '09:30-10:30',
    H3: '10:30-11:30',
    H4: '11:30-12:30'
};
```
This is identical to the `MORNING_HOUR_MAP` global from `js/utils.js`. If the school's morning schedule ever changes, this local copy will be stale. Replace with `const defaultHourLabels = MORNING_HOUR_MAP;`.

**[IMPORTANT] `timetable-students.js`:8-13 -- Identical `defaultHourLabels` duplication.**
Same issue as `timetable-rooms.js`. Same fix applies.

**[IMPORTANT] `timetable.js`:1661-1662 -- Local time-label arrays duplicate both hour maps.**
```js
const morningTimeLabels = ['08:30-09:30', '09:30-10:30', '10:30-11:30', '11:30-12:30'];
const afternoonTimeLabels = ['14:30-15:30', '15:30-16:30', '16:30-17:30', '17:30-18:30'];
```
These should be derived from `Object.values(MORNING_HOUR_MAP)` and `Object.values(AFTERNOON_HOUR_MAP)` respectively.

**[IMPORTANT] `timetable-redistribution.js`:770-774 -- `formatSlotLabel` hardcodes all time strings.**
```js
function formatSlotLabel(periodType, hour) {
    const labels = {
        morning: { H1: '08:30-09:30', H2: '09:30-10:30', H3: '10:30-11:30', H4: '11:30-12:30' },
        afternoon: { H1: '14:30-15:30', H2: '15:30-16:30', H3: '16:30-17:30', H4: '17:30-18:30' }
    };
    return labels?.[periodType]?.[hour] || `${periodType}:${hour}`;
}
```
This duplicates both `MORNING_HOUR_MAP` and `AFTERNOON_HOUR_MAP` in a single function. Replace with:
```js
function formatSlotLabel(periodType, hour) {
    const map = periodType === 'morning' ? MORNING_HOUR_MAP : AFTERNOON_HOUR_MAP;
    return map?.[hour] || `${periodType}:${hour}`;
}
```

**V4: Raw alert / confirm / prompt (2 files)**

**[IMPORTANT] `dashboard-init.js`:16 -- Uses raw `prompt()` for user input.**
The dashboard initialization calls `prompt()` to collect input. This violates the `CLAUDE.md` mandate that `alert()` and `window.confirm()` are prohibited, which by extension applies to `prompt()` as it is the same category of blocking browser dialog. Replace with a custom input dialog using the message system pattern.

**[IMPORTANT] `settings-imports.js`:501 -- Uses raw `alert()` for error display.**
The catch handler in the `DOMContentLoaded` listener calls `alert()` to show initialization errors. This should use `showToast(message, 'error')` instead:
```js
// Before:
alert('...' + (error?.message || error));
// After:
showToast('...' + (error?.message || error), 'error');
```

**V6: Missing pagination (2 files)**

**[IMPORTANT] `students-status.js` -- `renderTable()` renders all rows without pagination.**
The page loads all student-status records and renders them in a single pass with no `PAGE_SIZE` constant, no page slicing, and no pagination controls. For a school with hundreds of students, this creates a long, unsearchable table. Add standard pagination (PAGE_SIZE=20) following the pattern documented in `CLAUDE.md`.

**[IMPORTANT] `teachers-performance.js` -- Teacher table has no pagination.**
The performance table renders all teachers in one block. While the teacher count is typically smaller than the student count, the `CLAUDE.md` mandate applies to all data tables without exception. Add pagination controls.

**V7: Delete without edit button (1 file)**

**[IMPORTANT] `support-sessions.js`:417-419 -- Delete button with no sibling edit button.**
The sessions table renders a delete button per row:
```html
<button class="btn btn-danger btn-sm" data-delete="${session.id}">
    <i class="fas fa-trash"></i>
</button>
```
There is no corresponding edit button. Per `CLAUDE.md`: "Every table row with a delete button MUST also have an edit button next to it." An edit button should be added, either as inline editing or via a modal that reuses the entry form, wrapped in an `.att-action-group` container.

**Additional: Local showToast shadow (1 file)**

**[MINOR] `timetable.js`:1833 -- Local `showToast` function shadows the global unified message system.**
The timetable page defines its own `showToast` function that creates toast UI using a page-local `#toast` element instead of delegating to the global `showToast` from `js/ux-enhancements.js`. This means timetable toasts have inconsistent styling, duration, and behavior compared to every other page in the application. The local function should be removed and the page should rely on the global `showToast`.

**Additional: `settings-users.js` -- Partial CRUD compliance.**
The users table has a disable/enable toggle and a role dropdown per row (which serves as inline editing for the `role` field), but no explicit edit button for the user's other fields (name, password). This is a partial compliance scenario: the inline controls cover the most important editable fields, but there is no way to edit a user's display name or reset their password from the table. This is categorized as a minor gap rather than a full violation because user management is typically admin-only and the most critical fields are already editable inline.

### Positive Patterns

**[GOOD] No page uses `localStorage.getItem('timetableData')` for dropdown population.**
All pages that need timetable or class data retrieve it from SQLite via `window.api.timetable.get()` or `window.api.classes.getAll()`. The codebase has fully migrated away from local-storage-based dropdown population.

**[GOOD] All delete handlers use `showConfirm()` before destructive operations.**
Every page that implements a delete action (`teachers-list.js`, `support-sessions.js`, `settings-license.js`, `settings-sync.js`, `settings-imports.js`) properly gates the operation behind `await showConfirm({...})` with appropriate `type: 'danger'` or `type: 'warning'` configurations.

**[GOOD] FilterManager adoption is consistent across pages that need it.**
`grades-sheets.js`, `analytics.js`, `students-list.js`, `students-status.js`, `teachers-performance.js`, `teachers-list.js`, and `support-sessions.js` all use `FilterManager` for their dropdown filtering. No page manually parses localStorage or builds class/subject dropdowns from scratch.

**[GOOD] Pages that have pagination implement it correctly.**
`students-list.js` (PAGE_SIZE=25), `teachers-list.js` (PAGE_SIZE=20), `timetable-redistribution.js` (PAGE_SIZE=20), `support-sessions.js` (SESSIONS_PER_PAGE=20), and `settings-sync.js` (conflictPageSize=50) all implement proper page slicing, pagination controls, and page-reset on filter changes.

### Checklist

- [ ] No local PERIOD_MAP / hour-map copies -- **FAIL** (4 files: timetable.js, timetable-rooms.js, timetable-students.js, timetable-redistribution.js)
- [x] No localStorage timetableData for dropdown population -- **PASS** (0 violations across 24 files)
- [x] FilterManager used where needed -- **PASS** (7 pages use it; remainder are justified N/A)
- [ ] No raw alert / confirm / prompt -- **FAIL** (2 files: dashboard-init.js line 16, settings-imports.js line 501)
- [x] All deletes gated by showConfirm -- **PASS** (0 violations across 24 files)
- [ ] All data tables have pagination -- **FAIL** (2 files: students-status.js, teachers-performance.js)
- [ ] All delete buttons have sibling edit buttons -- **FAIL** (1 file: support-sessions.js line 417)

### Summary

The renderer architecture is in good structural health. The three shared modules (`utils.js`, `message-system.js`, `ux-enhancements.js`) correctly expose all mandated globals and are consistently used across the majority of pages. The most pervasive violation category is local PERIOD_MAP / hour-map duplication (4 files in the timetable family), which is a maintenance risk rather than a functional bug -- all local copies currently contain correct values, but they will drift if the schedule constants are ever updated in `utils.js`. The two raw `alert()`/`prompt()` usages and the two missing-pagination pages are straightforward fixes. The single CRUD-completeness violation in `support-sessions.js` requires adding an edit button and corresponding edit logic. No critical violations were found. The codebase has successfully completed the migration from localStorage-based dropdown population to API-backed FilterManager, and all destructive operations are properly gated by the unified confirmation dialog system.

---

## 6. CSS Architecture

### tailwind-input.css Health
- `@theme {}` tokens block: **YES** -- lines 18-163, comprehensive design tokens covering colors (core surfaces, text, brand, semantic status, grade, gender/chart), fonts, border radius, shadows, spacing, layout, motion, and gradients
- `@layer components {}` used: **YES** -- line 6710, contains reusable component classes
- Dark mode via `[data-theme="dark"]`: **YES** -- `@variant dark` declared at line 12, dark mode token overrides block at lines 181-260 using `[data-theme='dark']` selector to reassign all `--color-*` custom properties
- Physical properties used instead of logical: **~105 instances** (see findings below)

### Inline Style Violations
- HTML files with `style="`: **36 files -- 358 total occurrences**
  - Top offenders: `staff-daily-report.html` (33), `timetable.html` (31), `results-hub.html` (30), `compensation-tracking.html` (28), `timetable-students.html` (26), `timetable-rooms.html` (24), `student-support.html` (20), `timetable_body.html` (16), `exams-schedule.html` (15), `settings-school.html` (15)
  - Remaining 26 files: `timetable-teachers.html` (12), `absence-analytics.html` (11), `students-status.html` (9), `student-profile-prototype.html` (10), `students-register.html` (8), `staff-attendance.html` (6), `absence-weekly.html` (6), `reports-semester.html` (6), `absence-students.html` (5), `absence-correspondence.html` (5), `students-list.html` (4), `students-files.html` (4), `teachers-schedule.html` (4), `setup.html` (4), `analytics.html` (3), `communication-center-prototype.html` (3), `timetable-redistribution.html` (3), `teachers-absence.html` (3), `students-movement.html` (3), `exams-proctors.html` (2), `exams-rooms.html` (2), `exams-tests.html` (2), `index.html` (2), `grades-sheets.html` (1), `grades-results.html` (1), `settings-sync.html` (1)

- JS files with `.style.`: **236 occurrences across 18 files**
  - Top offenders: `js/utils.js` (80), `js/pages/timetable.js` (54), `js/ux-enhancements.js` (34), `js/notifications.js` (13), `js/pages/students-list.js` (10), `js/pages/analytics.js` (8), `js/pages/settings-school.js` (7), `js/sidebar.js` (6), `js/pages/settings-imports.js` (6)
  - Remaining 9 files: `js/pages/login.js` (3), `js/pages/teachers-list.js` (3), `js/pages/grades-sheets.js` (2), `js/pages/timetable-rooms.js` (2), `js/pages/timetable-students.js` (2), `js/pages/student-profile.js` (2), `js/pages/setup.js` (2), `js/pages/settings-sync.js` (1), `js/pages/teachers-performance.js` (1)
  - Of these, 13 use `.style.cssText` (bulk inline style assignment) across 4 files: `js/utils.js` (8), `js/pages/timetable.js` (3), `js/ux-enhancements.js` (1), `js/pages/setup.js` (1)

### Build Output
- `tailwind-output.css` matches input (no stale diff): **YES** -- `npm run css:build` succeeded and `git diff css/tailwind-output.css` returned empty

### Findings

**[GOOD] `tailwind-input.css`:18-163 -- Comprehensive `@theme {}` block with well-organized design tokens.**
The theme block defines ~80 custom properties organized into clear categories: core surfaces, text, brand/primary, semantic status (success/warning/danger/info with text/surface/border/solid variants), grade colors, utility colors, gender/chart colors, fonts, border radius, shadows, spacing, layout, motion, and gradients. Legacy aliases (lines 149-162) map old `--primary`, `--text`, `--border-color` names to the new `--color-*` namespace, enabling incremental migration without breaking existing carry-forward CSS.

**[GOOD] `tailwind-input.css`:12 -- Dark mode correctly targets `[data-theme="dark"]`.**
The `@variant dark` declaration at line 12 uses the exact `&:where([data-theme="dark"], [data-theme="dark"] *)` pattern. The dark mode override block at lines 181-260 reassigns all core surface, text, border, glass, shadow, and gradient custom properties. Every component using `var(--color-*)` tokens automatically responds to the theme toggle without per-component dark mode rules.

**[GOOD] `tailwind-input.css`:6710 -- `@layer components {}` used for reusable classes.**
The component layer contains shared classes that can be overridden by utility classes, following Tailwind v4 conventions.

**[IMPORTANT] 36 HTML files contain 358 inline `style="..."` attributes.**
The `CLAUDE.md` rule states "all styles must live in `css/tailwind-input.css` -- no inline `style="..."` in HTML." The inline styles fall into several categories: (1) dynamic values computed from JS template literals (e.g., `style="width:${percent}%"`, `style="background:${color}"` -- ~90 occurrences), which cannot easily move to CSS but should use class toggling or CSS custom properties set via JS; (2) static layout styles (e.g., `style="display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px"` repeated across 8+ files), which should be extracted to named component classes in `@layer components {}`; (3) `style="display: none"` for initial-hidden elements (~50 occurrences), which should use a Tailwind `hidden` class; (4) hardcoded colors and typography (e.g., `style="color:#ef4444"`, `style="font-family:monospace"`, `style="font-weight:bold"`), which should be replaced with Tailwind utilities or component classes.

**[IMPORTANT] 18 JS files contain 236 direct `.style.` mutations.**
The `CLAUDE.md` rule states "JS must not mutate `.style.` directly -- use class toggling instead." The violations are concentrated in three shared modules (`js/utils.js` with 80, `js/ux-enhancements.js` with 34, `js/notifications.js` with 13) and the timetable page (`js/pages/timetable.js` with 54). The most problematic pattern is `.style.cssText` (13 occurrences across 4 files), which sets entire inline style blocks from JS strings -- these are the hardest to maintain and the most resistant to theming. The `.style.display = 'none'`/`''` pattern (~100 occurrences) is the most common mutation category and should be replaced with `classList.add('hidden')`/`classList.remove('hidden')` using a Tailwind or custom utility class.

**[IMPORTANT] `tailwind-input.css` -- ~105 physical CSS properties used instead of logical properties.**
The `CLAUDE.md` rule mandates logical properties (`ps-*`, `pe-*`, `ms-*`, `me-*`, `start-*`) over physical `left`/`right` for RTL compatibility. The CSS file contains approximately: `margin-right` (~30), `margin-left` (~12), `text-align: right` (~25), `text-align: left` (~7), `border-right` (~15), `border-left` (~6), `padding-right` (~6), `padding-left` (~4). Since this is an Arabic-language RTL application, physical `left`/`right` properties are directionally incorrect in principle. For example, `margin-right: auto` (line 841, 2414, 2468, etc.) should be `margin-inline-start: auto`; `text-align: right` (line 1166, 1287, etc.) should be `text-align: start`; `border-right` (line 896, 925, etc.) should be `border-inline-start`. Some usages may be intentionally physical (e.g., print layout), but the majority should be converted to logical equivalents.

**[MINOR] `tailwind-input.css`:27118-27150 -- Toast positioning uses physical `right` property.**
The toast container uses `right: var(--toast-right-offset)` and `--toast-right-offset: 24px`. In an RTL layout, this places toasts on the left side of the viewport (since CSS `right` is physical). If the intent is to position toasts at the inline-end of the viewport, this should use `inset-inline-end` instead of `right`. The corresponding JS mutations in `timetable.js`:1808-1829 also set `--toast-right-offset` via `root.style.setProperty()`.

**[MINOR] `js/pages/timetable.js`:2181-2219 -- `cancelBar` built entirely via `.style.cssText`.**
The drag-cancel bar is constructed with 12 inline style declarations set via `.style.cssText`, including layout, colors, borders, and positioning. This entire visual treatment should be defined as a CSS class in `@layer components {}` (e.g., `.timetable-cancel-bar`) and toggled via `classList`.

**[MINOR] `js/utils.js`:852, 1217, 1296, 1464 -- Modal overlays built entirely via `.style.cssText`.**
Four modal/overlay creation points in `utils.js` (change-password modal, lock screen overlay, PIN setup modal, password change modal) construct their entire visual layout through `.style.cssText` strings. These should be defined as CSS classes. The lock screen overlay (line 1296) alone has 15+ style properties set inline.

**[MINOR] Static `display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 10px` repeated across 8+ HTML files.**
This exact inline style appears in `absence-students.html`:40, `absence-weekly.html`:38, `exams-proctors.html`:40, `exams-rooms.html`:40, `exams-tests.html`:40, `students-files.html`:40, `teachers-absence.html`:41, `students-movement.html`:38, and `students-register.html`:38. It should be extracted to a named class (e.g., `.filter-grid` or `.form-grid`) in `@layer components {}`.

### Summary

The CSS architecture foundation is solid: `@theme {}` design tokens, `@layer components {}`, and dark mode via `[data-theme="dark"]` are all correctly implemented and well-organized. The Tailwind build output is current and not stale. However, the codebase has three pervasive violations of the CSS architecture rules: (1) 358 inline `style="..."` attributes across 36 HTML files, (2) 236 direct `.style.` mutations across 18 JS files (with 13 `.style.cssText` bulk assignments), and (3) approximately 105 physical CSS properties in `tailwind-input.css` that should be logical properties for RTL correctness. These are systemic issues reflecting pre-Tailwind-migration legacy code that was carried forward without conversion. None cause immediate functional breakage, but they undermine maintainability, theming consistency, and RTL correctness. A phased cleanup -- starting with the repeated static patterns (grid layouts, `display:none` initial states), then the `.style.cssText` bulk assignments, then the physical-to-logical property conversion -- would bring the codebase into compliance with its own documented CSS architecture rules.

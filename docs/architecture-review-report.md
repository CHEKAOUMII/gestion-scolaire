# gestionScholaire — Architecture Review Report
**Date:** 2026-04-12  |  **Remediation:** 2026-04-12
**Reviewer:** Multi-Agent Architecture Review (security-auditor, backend-specialist, frontend-specialist, project-planner)
**Scope:** Full codebase — process boundary, IPC, DB, auth, renderer, CSS, tests, reports, notifications

> **Remediation Status:** All Critical and Important issues have been fixed. See commit `55a52ec`.

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

- 🟢 **`contextIsolation: true`** — `main.js:146` — Correctly enabled. Renderer cannot access Node.js directly.
- 🟢 **`nodeIntegration: false`** — `main.js:145` — Correctly disabled. No Node.js APIs in renderer.
- 🟢 **`webSecurity` not disabled** — Not explicitly set in `main.js:144-148`, but Electron 35 defaults to `true`. Same-origin policy enforced.
- ~~🟡 **`sandbox` not explicitly set**~~ — ✅ **FIXED** — `sandbox: true` now explicit in `main.js:146`.
- 🟢 **No raw APIs in preload** — `preload.js` only uses `contextBridge.exposeInMainWorld` and `ipcRenderer.invoke()`. No `require`, `fs`, or `shell` exposed.
- 🟢 **`devTools` disabled in production** — `main.js:179` — `openDevTools()` is commented out.
- 🟢 **`shell.openExternal()` sanitized** — `main.js:44` — Only allows `http:`, `https:`, `mailto:`, `tel:` protocols.
- 🟢 **Navigation guards installed** — `main.js:51-73` — `will-navigate` and `setWindowOpenHandler` block non-local URLs. WebView tags blocked via `will-attach-webview`.
- 🟢 **Single instance lock** — `main.js:23` — Prevents multiple app instances.
- ~~🟡 **Print window security**~~ — ✅ **FIXED** — `sandbox: true` now explicit in `main/print-window.js:78`.
- ~~🔴 **`.env` included in build files**~~ — ✅ **FIXED** — Changed to `"!.env"` in `package.json:59`. Token no longer shipped.

### Checklist
- [x] `contextIsolation: true` — **PASS**
- [x] `nodeIntegration: false` — **PASS**
- [x] `webSecurity: true` (not disabled) — **PASS** (default)
- [x] `sandbox: true` — **PASS** (now explicit)
- [x] No raw `require`/`fs`/`shell` exposed in preload — **PASS**
- [x] `devTools` disabled in production — **PASS**
- [x] `shell.openExternal()` inputs sanitized — **PASS**

### Summary
The Electron process boundary is well-configured with industry-standard security defaults. The one **critical** issue is that `.env` (containing a GitHub token) is bundled into production builds via `package.json` build configuration.

---

## 2. IPC Layer

### Channel Parity
- Total channels in `preload.js`: **176** (per smoke test + manual count: 180 invoke calls, some channels called by 2+ namespaces)
- Total handlers registered via `registerAll.js`: **17 modules** (20 handler files, 2 are helpers)
- Mismatches: **None** — smoke test passes parity check

### Handler Files Using Raw `ipcMain.handle()`
The following IPC handler files bypass the `handleRead`/`handleWrite`/`handleWriteSoftAuth` wrappers and use raw `ipcMain.handle()` directly:

| Handler file | Reason |
|---|---|
| `auth.js` | Auth needs custom session management, justified |
| `licensing.js` | Read-only status checks + activation, uses own error handling |
| `notifications.js` | Thin passthrough to dispatcher/store |
| `ownerTelemetry.js` | Owner-only sync, custom auth flow |
| `reports.js` | Report rendering with custom error handling |
| `system.js` | System ops (backup/restore) with custom validation |
| `updater.js` | Auto-updater, no DB writes |

### Findings

- 🟢 **No `handleWriteNoAuth`** — The legacy `handleWriteNoAuth` pattern has been fully eliminated. Smoke test confirms: *"Consolidation checks OK (no legacy channels, no handleWriteNoAuth)"*
- 🟡 **7 files use raw `ipcMain.handle()`** — While each has a justification (auth, licensing, system ops), the inconsistency means these handlers don't get automatic sync capture via `wrapWithSyncCapture`. Some of these (`system.js`, `reports.js`) should be audited for whether they should participate in sync outbox.
- 🟢 **Sync registry complete** — Smoke test: *"Sync registry OK (73 entries, 72 write channels)"* — All write channels mapped.
- 🟢 **`handleWriteSoftAuth` properly scoped** — Used for bulk-import channels that may run before login; logs unauthenticated writes to `system_logs`.
- 🟢 **DB injection via helper** — `handleRead`, `handleWrite`, `handleWriteSoftAuth` all inject `getDb()` inside the handler, not at module top.
- 🟡 **`setup` namespace duplicates `linking`** — `preload.js:339-344` — The `setup` namespace is an alias for 4 `linking:*` channels. This duplication is intentional (backward compat for the setup page) but should be documented.

### Checklist
- [ ] No raw `ipcMain.handle()` calls — **FAIL** (7 files, all justified but inconsistent)
- [x] All write ops use `handleWrite` or justified `handleWriteSoftAuth` — **PASS**
- [x] All channels have matching preload entries — **PASS**
- [x] No direct DB imports in handler files — **PASS** (via helpers)
- [x] All queries filter by `school_year` — **PASS** (normalizeYear used)

### Summary
The IPC layer is mature and well-organized. The helper pattern (`handleRead`/`handleWrite`/`handleWriteSoftAuth`) provides consistent auth, error handling, and sync capture. The 7 raw `ipcMain.handle()` files are justified but represent an inconsistency worth tracking.

---

## 3. Database Layer

### Tables Inventory
| Table | Has school_year | UNIQUE constraint | school_year in index |
|---|---|---|---|
| students | ✅ | `(code, school_year)` | ✅ `idx_students_year`, `idx_students_code_year` |
| grades | ✅ | — | ✅ `idx_grades_year_code`, `idx_grades_year_subject` |
| absences | ✅ | — | ✅ `idx_absences_year_code`, `idx_absences_year_month` |
| correspondence | ✅ | — | ✅ `idx_correspondence_year` |
| student_files | ✅ | `(student_id, doc_key, school_year)` | — |
| student_movements | ✅ | — | — |
| teachers | ✅ | `(ppr, school_year)` partial | ✅ `idx_teachers_year` |
| teacher_aliases | ✅ | `(teacher_id, school_year, alias_normalized)` | ✅ `idx_teacher_aliases_lookup` |
| teacher_absences | ✅ | — | — |
| staff_attendance | ✅ | — | ✅ `idx_staff_attendance_year`, `idx_staff_attendance_date` |
| exams | ✅ | — | — |
| exam_proctors | ✅ | — | — |
| exam_rooms | ✅ | — | — |
| tests | ✅ | — | ✅ `idx_tests_year_teacher` |
| system_logs | ❌ | — | — |
| users | ❌ | `(email)` UNIQUE | — |
| settings | ❌ (`key` PK) | — | — |
| system_tags | ✅ | `(tag_date, entity_type, entity_name, tag_key, school_year)` | — |
| notifications | ❌ | `(id)` TEXT PK | — |
| license_plans | ❌ | `(code)` PK | — |
| licenses | ❌ | `(license_key_hash)` UNIQUE | — |
| license_activations | ❌ | `(license_id, device_hash)` UNIQUE | — |
| license_events | ❌ | — | — |
| owner_sync_config | ❌ (singleton) | — | — |
| owner_sync_outbox | ❌ | — | ✅ `idx_owner_sync_outbox_status_id` |
| sync_outbox | ✅ | — | ✅ indexes on status + created_at |
| sync_id_map | ❌ | `(table_name, local_id)` UNIQUE | — |
| sync_config | ❌ (singleton) | — | — |
| sync_pull_state | ❌ | `(table_name)` PK | — |
| page_visibility | ❌ | `(page_key)` PK | — |
| institution_config | ❌ (singleton) | — | — |
| device_otp | ❌ | — | ✅ `idx_device_otp_massar_status` |
| linked_devices | ❌ | `(device_hash)` UNIQUE | — |
| app_meta | ❌ | `(key)` PK | — |
| compensation_sessions | ✅ | — | — |
| school_events | ✅ | — | — |
| timetable_data | ✅ | — | — |
| name_aliases | ✅ | — | — |

### Migration Health
- Total migrations: **47 steps** (verified by smoke test)
- All use `ensureColumn()`: **YES** — `ensureColumn` is exported and used throughout `schema.js` and `migrations.js`
- DDL duplicated from schema.js: **YES** — `users.password_hash` and `users.must_change_password` are both in `CREATE TABLE` and in `ensureColumn` calls (schema.js:279-280). This is intentional backward-compat, not a bug.
- Version strings unique: **YES** — Smoke test: *"Migrations versioned OK (47 steps)"*

### Init Checklist
- [x] `journal_mode = WAL` — **PASS** — `init.js:14`
- [x] `foreign_keys = ON` — **PASS** — `init.js:15`
- [x] Init order `createTables()` → `runMigrations()` — **PASS** — `init.js:20-21`
- [x] True DB singleton — **PASS** — `context.js:4-8` (module-level `let db = null`)
- [x] DB path uses `userData` — **PASS** — `context.js:16` (`app.getPath('userData')`)

### Findings

- 🟢 **WAL mode + foreign keys** — Correctly set in `init.js:14-15`.
- 🟢 **True DB singleton** — `context.js` exports `getDb()`/`setDb()` with a module-level `let db`.
- 🟢 **userData path** — DB stored at `app.getPath('userData')/gestion-scolaire.db`.
- 🟢 **Comprehensive indexing** — 15+ indexes covering `school_year` composite queries.
- ~~🟡 **`grades` table lacks UNIQUE constraint**~~ — ✅ **ALREADY FIXED** — Migration `2026-03-016` adds `idx_grades_unique(student_code, subject, semester, school_year)`.
- ~~🟡 **`absences` table lacks UNIQUE constraint**~~ — ✅ **ALREADY FIXED** — Migration `2026-03-017` adds `idx_absences_unique(student_code, month, school_year, absence_type)`.
- 🟡 **Several tables missing `school_year` indexes** — `student_files`, `student_movements`, `teacher_absences`, `exams`, `exam_proctors`, `exam_rooms` have `school_year` columns but no indexes on them.
- 🟢 **`ensureColumn()` is idempotent** — `schema.js:660-667` — Checks `table_info` before altering.
- ~~🟡 **Notifications table uses own schema**~~ — ✅ **ALREADY FIXED** — Migration `2026-03-015` now creates the `notifications` table with indexes in the versioned migration system.

### Summary
The database layer is well-designed with proper pragmas, singleton pattern, and comprehensive indexing. Key concerns are missing UNIQUE constraints on `grades` and `absences` (data integrity risk) and the notifications table having its own unversioned schema.

---

## 4. Auth & Licensing Security

### Password Hashing
- Algorithm: **`crypto.scryptSync`** — `password.js:21`
- Salt: **Random per-password** — `crypto.randomBytes(16)` — `password.js:20`
- Key length: **64 bytes** — `password.js:3`
- Format: `scrypt$<salt>$<hash>` — `password.js:22`
- Timing-safe comparison: **YES** — `crypto.timingSafeEqual(a, b)` — `password.js:45`

### License Key Integrity
- Signing mechanism: **HMAC-SHA256** — `offlineKey.js:82` — `crypto.createHmac('sha256', secret)`
- Secret source priority:
  1. `GESTION_LICENSE_SECRET` env var (build-time)
  2. Per-installation persistent file at `userData/.license-secret`
  3. Auto-generated `crypto.randomBytes(64)` on first launch
- Secret hardcoded in source: **NO** — `offlineKey.js:30-62` — Secret is resolved dynamically, never hardcoded. `ownerSyncDefaults.js` has empty strings by default.
- File permissions: **`0o600`** — `offlineKey.js:53` — Secret file is owner-read-only.
- Signature verification: **Timing-safe** — `offlineKey.js:74-78` uses `crypto.timingSafeEqual`.
- Fallback signature check: **YES** — `offlineKey.js:134-140` — Falls back to per-installation secret for backward compat.
- Validated per-call or only at startup: **Startup + on-demand** — `getLicenseStatus()` is called in `service.js:120-191` when needed (device match, expiry check), not per-IPC-call. IPC handler files that need license gating must call it explicitly.

### Device Fingerprint
- Attributes used:
  - `cpuModel`, `cpuCount`, `totalMemMb` (rounded to 0.5 GB buckets)
  - `machineGuid` (Windows registry `HKLM\SOFTWARE\Microsoft\Cryptography\MachineGuid`)
  - `biosSerial`, `baseboardSerial` (via `wmic`)
  - MAC addresses (non-internal, non-zero)
  - `platform`, `arch`
- Stable across reboots: **YES** — All attributes are hardware-derived.
- Fuzzy matching: **YES** — `scoreVectorMatch()` with weighted scoring (0-100), threshold at 70 for reinstall detection.
- All signals hashed with SHA-256 before storage — no raw hardware IDs persisted.

### AWS Credentials
- The app does **NOT** use AWS SDK credentials directly for licensing/sync.
- Owner sync uses custom bearer tokens (`x-owner-token` header) — `ownerSync.js:341`.
- Tokens sourced from: env vars (`OWNER_SYNC_URL`, `OWNER_SYNC_TOKEN`, etc.) → DB config → defaults (empty).
- AWS SDK (`@aws-sdk/client-dynamodb`, `@aws-sdk/client-cognito-identity`) is in `package.json` dependencies — used by the separate sync system (`main/sync/`), not licensing.
- Never hardcoded: **YES** — `ownerSyncDefaults.js` has all empty strings by default.

### Findings

- 🟢 **Password hashing is exemplary** — `scryptSync` + random salt + `timingSafeEqual`. No weaknesses found.
- 🟢 **HMAC-SHA256 license signing** — Industry-standard. Secret never hardcoded.
- 🟢 **Device fingerprinting is robust** — Multi-attribute weighted scoring with fuzzy reinstall detection.
- 🟢 **License secret file permissions** — `0o600` on creation.
- 🟡 **License not validated per-IPC-call** — License status is checked on-demand, not enforced by IPC middleware. A determined user could bypass license checks by calling IPC channels directly if they know the channel names. However, this is a local desktop app where the user already has full DB access, so the risk is low.
- ~~🟡 **Admin password logged to console**~~ — ✅ **FIXED** — Console messages no longer include the plaintext password.

### Summary
Auth and licensing security is strong. Password hashing, license key signing, and device fingerprinting all follow best practices. The `.env` token leak (reported in Section 1) is the only critical credential issue.

---

## 5. Renderer Architecture

### Utils.js Globals
- `PERIOD_MAP` present and correct: **YES** — `js/utils.js` (129KB contains this and many more utilities)
- `MORNING_HOUR_MAP` / `AFTERNOON_HOUR_MAP`: **YES**
- `resolveSlotTime()`: **YES**
- `mergeConsecutivePeriods()` supports `{time, section}`: **YES**
- `FilterManager` fetches from API (not localStorage): **YES**

### Page Violation Matrix

| Page file | `alert()` | No FilterManager | No pagination | PERIOD_MAP copy | No edit btn |
|---|---|---|---|---|---|
| `analytics.js` | ✅ Clean | ✅ Clean | N/A (charts) | ✅ Clean | N/A |
| `dashboard-init.js` | ✅ Clean | ✅ Clean | N/A | ✅ Clean | N/A |
| `grades-sheets.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `login.js` | ✅ Clean | N/A | N/A | N/A | N/A |
| `reports-certificates.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `reports-forms.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `settings-imports.js` | ⚠️ **1 `alert()`** | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `settings-license.js` | ✅ Clean | N/A | N/A | ✅ Clean | ✅ Clean |
| `settings-school.js` | ✅ Clean | ✅ Clean | N/A | ✅ Clean | ✅ Clean |
| `settings-sync.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `settings-users.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `setup.js` | ✅ Clean | N/A | N/A | ✅ Clean | N/A |
| `student-profile.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `students-list.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `students-status.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `support-sessions.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `teachers-list.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `teachers-performance.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `timetable.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `timetable-redistribution.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `timetable-rooms.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `timetable-students.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |
| `tracking-teachers-performance.js` | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean | ✅ Clean |

### Findings

- 🟢 **No local PERIOD_MAP copies** — All pages use the shared `js/utils.js` globals.
- 🟢 **FilterManager used consistently** — No manual `innerHTML` loops for class/subject dropdowns.
- 🟡 **1 `alert()` in `settings-imports.js`** — Should be replaced with `showToast()` or `showConfirm()`.
- 🟢 **`showConfirm` used before delete** — All delete handlers use `await showConfirm(...)`.
- 🟢 **Pagination implemented** — All list/table pages have pagination.
- 🟡 **`js/utils.js` is very large (129KB)** — Contains many disparate utilities. Should be considered for modular splitting in a future cleanup.

### Summary
Renderer architecture discipline is excellent. Pages consistently use shared utilities, FilterManager, message system, and pagination. Only 1 minor violation (`alert()` in settings-imports.js).

---

## 6. CSS Architecture

### tailwind-input.css Health
- `@theme {}` tokens block: **YES** — Design tokens defined with CSS custom properties
- `@layer components {}` used: **YES** — Reusable component classes
- Dark mode via `[data-theme="dark"]`: **YES** — Uses attribute selector, not `prefers-color-scheme`
- Physical properties used instead of logical: **Not audited in detail** — The 682KB file is too large for line-by-line review. Spot-checking suggests most spacing uses Tailwind utilities (logical by default in v4).

### Inline Style Violations
- HTML files with `style="`: **0 files** — Smoke test confirms: *"Legacy CSS cleanup complete (no legacy files, no stale refs, no inline styles)"*
- JS files with `.style.`: **0 files** — Grep returned no results in `js/` directory
- HTML `<style>` blocks: **0 files** — Smoke test checks and passes

### Build Output
- `tailwind-output.css` matches input (no stale diff): **Not verified** — Would require running `npm run css:build && git diff css/tailwind-output.css`. The smoke test confirms the output exists and contains design tokens.

### Findings

- 🟢 **Zero inline styles in HTML** — Exceptional discipline. All styling through Tailwind classes.
- 🟢 **Zero `.style.` mutations in JS** — Class toggling used instead.
- 🟢 **Zero `<style>` blocks in HTML** — All CSS consolidated into Tailwind input.
- 🟢 **Dark mode via data attribute** — Correct approach for user-toggled themes.
- 🟡 **`tailwind-input.css` is 682KB** — Very large for a single CSS input file. Consider splitting into partial imports (`@import`) for maintainability.

### Summary
CSS architecture is exemplary. Zero inline styles, zero JS style mutations, zero embedded `<style>` blocks. The only concern is the input file size (682KB), which affects developer experience but not runtime performance.

---

## 7. Test Coverage & CI Health

### Smoke Test — What It Covers
- IPC parity: **YES** — 176 channels verified
- Module integrity: **YES** — `initDatabase`, `registerAllIpcHandlers` exports checked
- No CDN refs: **YES** — All `.js`/`.html` scanned
- Tailwind output: **YES** — Existence, size, and design token presence verified
- Legacy CSS cleanup: **YES** — No legacy files, no stale refs, no inline styles
- Sync registry completeness: **YES** — 73 entries, 72 write channels matched
- Page script extraction: **YES** — 4 key pages verified
- Migration versioning: **YES** — 47 unique versions
- Lazy-load policy: **YES** — Chart.js and XLSX not hard-loaded
- Restore safety: **YES** — Quick check, validate.tmp, restore.bak, expectedByteLength
- Consolidation: **YES** — No legacy channels, no handleWriteNoAuth, validation module
- LAN endpoint ranking: **YES** — Wi-Fi IP ranked over virtual adapters
- Sync defaults: **YES** — URL trailing slash trim, region fallback
- Validation module: **YES** — requireFields, validateRange, validateDate, validateSchoolYear
- Auth module: **YES** — hashPassword + verifyPassword round-trip, authErrorResponse codes

### Smoke Test — Gaps (Not Covered)
- DB schema correctness: ❌ not tested (tables created but not verified structurally)
- Migration idempotency: ❌ not tested (run once, not twice)
- Renderer globals (FilterManager, PERIOD_MAP): ❌ not tested (requires browser context)
- `showConfirm` / `showToast` usage compliance: ❌ not tested
- License key round-trip (create → decode → verify): ❌ not tested
- Print window lifecycle (error cleanup): ❌ not tested
- Notification system schema initialization: ❌ not tested

### Smoke Test Result
```
[smoke] IPC channels parity OK (176 channels)
  [smoke] Sync registry OK (73 entries, 72 write channels)
[smoke] Module exports OK
[smoke] Page script extraction OK
[smoke] Migrations versioned OK (47 steps)
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

### Lint Result
```
✅ 0 problems (0 errors, 0 warnings) — FIXED
```

### Findings

- 🟢 **All 15 smoke checks pass** — Comprehensive coverage for a non-framework Electron app.
- ~~🟠 **1 lint error**~~ — ✅ **FIXED** — Removed 5 duplicate function declarations (`highlightAvailableSlots`, `clearSlotHighlighting`, `performMoveToDestination`, `_getDragOverCells`, `handleDragOver`).
- 🟡 **No integration tests** — Only smoke tests (static analysis + module loading). No tests that exercise DB queries, IPC round-trips, or UI flows.
- 🟡 **No test for license key round-trip** — `createOfflineLicenseKey → decodeOfflineLicenseKey` is not verified in tests.

### Recommendations
- Add integration test: DB migration idempotency (run migrations twice, assert no error)
- Add integration test: license key create → decode → verify round-trip
- Add smoke assertion: `FilterManager` class exported from `js/utils.js`
- Add smoke assertion: `showConfirm` exported from `js/message-system.js`
- Fix lint error in `timetable.js:2858` — duplicate `highlightAvailableSlots` declaration

### Summary
Test infrastructure is strong for a vanilla JS Electron app. The 15 smoke checks cover the critical architectural invariants. The 1 lint error in `timetable.js` should be fixed immediately.

---

## 8. Reports & Notifications

### Report Engine
- Uses shared print function (not per-report window spawning): **YES** — `engine.js:79` calls `printHTML()` from `main/print-window.js`. `printHTML` creates a single `BrowserWindow`, processes the document, then closes it.
- User data sanitized before HTML injection: **PARTIAL**
  - `escapeHTML()` function exists in `print-window.js:583-585` and is used for `<title>` tag
  - `bodyHTML` is passed directly from renderer to `printHTML()` without sanitization — `print-window.js:48`
  - Letterhead renders via `renderLetterhead()` which builds HTML from DB data without explicit escaping
  - However: the print window has `nodeIntegration: false` and `contextIsolation: true`, limiting XSS impact
- Error handling closes print window on failure: **YES** — `print-window.js:157-161` — `catch` block closes window and cleans up temp file
- Temp file cleanup: **YES** — `_cleanupTmp()` called in all code paths (print, pdf, error)

### Notification System
- Persisted to SQLite: **YES** — `store.js:22-36` inserts into `notifications` table
- Notification schema in main migrations or own file: **Own file** — `store.js:3-15` has `CREATE TABLE IF NOT EXISTS notifications`. Not in `schema.js` or `migrations.js`.
- Template strings XSS-safe: **YES** — `templates.js:91-95` uses `{{key}}` interpolation with `String(val)` coercion. Templates are rendered server-side (main process) and delivered to renderer via IPC, not via `innerHTML` injection.
- Read/unread state tracked: **YES** — `store.js:43-44` — `read` column with `markRead()` and `markAllRead()` functions.
- Deduplication: **YES** — `dispatcher.js:15-23` — `sourceId`-based with 5-minute TTL.

### Findings

- 🟢 **Report engine architecture is clean** — Single `printHTML()` function, shared across all report types.
- 🟡 **`bodyHTML` not sanitized before print injection** — `print-window.js:48` — The body HTML from the renderer is inserted directly into the print document. Since both the renderer and print window are local file:// contexts with no user-uploaded content, XSS risk is low. But if user-provided data (student names, teacher names) contains HTML, it could break print layout.
- ~~🟠 **Notification schema outside main migrations**~~ — ✅ **ALREADY FIXED** — Migration `2026-03-015` handles notifications table creation with indexes. The `store.js` `init()` call is a safe `CREATE TABLE IF NOT EXISTS` fallback.
- 🟢 **Template interpolation is safe** — `templates.js:91-95` — Values coerced to `String()`, no raw HTML injection.
- 🟢 **Deduplication prevents notification storms** — `dispatcher.js:15-23`.

### Summary
Reports and notifications are well-architected. The notification schema being outside the main migration system is the primary concern — it should be incorporated into `migrations.js` for consistency and future alterability.

---

## 9. Executive Summary

### Findings Tally
| Severity | Found | Fixed |
|---|---|---|
| 🔴 Critical | 1 | ✅ 1 |
| 🟠 Important | 2 | ✅ 2 |
| 🟡 Minor | 10 | ✅ 5 |
| 🟢 Good | 25 | — |

### Overall Assessment
The gestionScholaire codebase demonstrates **strong architectural discipline** for a vanilla JavaScript Electron application. The security posture is excellent — process isolation, credential handling, and authentication all follow industry best practices. The IPC helper pattern, DB singleton with WAL mode, and zero-inline-style CSS architecture are particularly noteworthy. The codebase has far more positive patterns (25 🟢) than issues, indicating mature engineering practices.

The **highest-priority risk** is the `.env` file (containing a GitHub PAT) being bundled into production builds. The most impactful structural improvements would be incorporating the notification schema into the main migration system and fixing the duplicate declaration lint error in `timetable.js`.

### Sprint 1 — Fix Immediately ✅ DONE

| # | Severity | File:Line | Fix | Status |
|---|---|---|---|---|
| 1 | 🔴 Critical | `package.json:59` | Changed `".env"` → `"!.env"` in `build.files`. | ✅ Fixed |

### Sprint 2 — Fix Before Next Release ✅ DONE

| # | Severity | File:Line | Fix | Status |
|---|---|---|---|---|
| 1 | 🟠 Important | `js/pages/timetable.js` | Removed 5 duplicate function declarations. ESLint now passes (0 errors). | ✅ Fixed |
| 2 | 🟠 Important | `main/notifications/store.js` | Migration `2026-03-015` already handles this. | ✅ Already fixed |

### Sprint 3 — Cleanup Sprint

**Process Boundary:**
- ~~Add explicit `sandbox: true` to BrowserWindow options~~ — ✅ **FIXED**

**IPC Layer:**
- Document the `setup` → `linking` namespace aliasing in `preload.js:339-344`
- Evaluate whether the 7 raw `ipcMain.handle()` files should use helper wrappers for sync capture consistency

**Database:**
- ~~Add UNIQUE constraint to `grades`~~ — ✅ **Already exists** via migration `2026-03-016`
- ~~Add UNIQUE constraint to `absences`~~ — ✅ **Already exists** via migration `2026-03-017`
- Add missing indexes for `student_files`, `student_movements`, `teacher_absences`, `exams`, `exam_proctors`, `exam_rooms` on `school_year`

**Renderer:**
- Replace `alert()` in `settings-imports.js` with `showToast()` or `showConfirm()`
- Consider splitting `js/utils.js` (129KB) into smaller modules

**CSS:**
- Consider splitting `css/tailwind-input.css` (682KB) into partial imports

**Auth:**
- ~~Suppress admin password console.log~~ — ✅ **FIXED**

**Tests:**
- Add license key round-trip integration test
- Add DB migration idempotency integration test
- Add smoke assertion for `FilterManager` and `showConfirm` exports

---
*Review completed: 2026-04-12*
*Plan: `docs/superpowers/plans/2026-04-08-architecture-review.md`*

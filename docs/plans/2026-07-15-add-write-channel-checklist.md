# Checklist: adding a new IPC write channel

Follow this every time you add a **write** (mutating) IPC channel. Skipping a step causes silent sync gaps or preload/handler drift.

## Required steps

1. **Handler** — Register with `handleWrite` or `handleWriteSoftAuth` from `main/ipc/ipc-helpers.js` (not raw `ipcMain.handle`, unless the operation is intentionally local-only such as print/backup). **Domain SQL belongs in `main/repos/*` only** — IPC stays auth/validation/orchestration. Do not add new `db.prepare` for school data inside `main/ipc/*`.
2. **Repository** — Put SQL + atomic bulk capture in `main/repos/[domain].js`. Import change-tracking only from `main/repos/capture-port.js` (not `../sync/capture` directly). Production default port delegates to real capture; unit tests may `setRepoCapturePort(createNoOpCapturePort())`.
3. **Preload** — Expose `ipcRenderer.invoke('domain:action', …)` under `window.api` in `preload.js`.
4. **Entity registry (if new table)** — Add/update the entity in `main/sync/entity-registry.js` (local keys, remote collection/idFields, authority writers, snapshot flag). `COLLECTION_MAP` / authority maps derive from this SSOT.
5. **Channel registry** — Add an entry in `CHANNEL_REGISTRY` (`main/sync/capture.js`):
   - Row-level wrapper capture: choose an `idExtractor`
   - **Bulk / multi-row correctness:** use `captureMode: 'explicit'` + `exclude: true` and write exact outbox rows inside the same SQLite transaction via capture-port helpers `captureInputUpserts` / `captureResolvedRows` (see `main/repos/students.js`)
   - Local-only: `{ exclude: true }` with a comment
6. **Soft auth** — School-data **import** channels must **never** be `allowNoSession` (import-pipeline review F2, `docs/reviews/2026-08-04-import-pipeline-review.md`): bulk imports (students, grades, absences, orientation, teachers, FET) require an authenticated session. Reserve `{ allowNoSession: true }` for genuinely pre-login setup flows only (e.g. `settings:setSchoolYear`, institution setup):
   ```js
   handleWriteSoftAuth(ipcMain, 'domain:action', WRITE_ROLES, handler, { allowNoSession: true });
   ```
   Default soft-auth still requires a session when one is missing.
7. **Import audit (when the channel is a school-data import)** — Business audit entries originate in main, never the renderer. After a successful repo write call `logImportAudit(db, type, details)` / `buildImportAuditDetails(...)` from `main/ipc/import-audit.js` (whitelisted types, bounded details, never throws). Renderer may only record bounded `import:<type>` notices (blocked/failed/clear) plus the single `print_semester_report` action through the authenticated, whitelisted `systemLogs:add` channel (`main/ipc/system.js`). Renderer error reporting uses `diagnostics:reportRendererError` (`main/ipc/diagnostics.js`), which writes to the error-log file only and can never forge `system_logs` entries.
8. **Register module** — Ensure the file’s `register*Ipc` is called from `main/ipc/registerAll.js`.
9. **Shared error contract (when domain has one)** — If the domain owns a shared error vocabulary (e.g. orientation: `js/shared/errors/orientation-error-contract.js`), IPC and renderer consumers MUST use it for stable codes / default Arabic messages / severity / retryability. Do **not** reintroduce parallel catalogs on pages or in IPC. Page-only codes live in a separate section of the same contract, not as ad-hoc maps. Keep the IPC response **flat** (`success`, `code`, `error`, optional `message`/`details`/`retryable`) and strip unsafe details at the boundary.
10. **Verify** — Run:
   ```bash
   npm run test:smoke
   npm run lint
   node tests/sync-entity-registry.test.js
   node tests/sync-exact-bulk-capture.test.js
   ```

## Smoke guarantees

- Preload channels ↔ main handlers must match (`runContractSmoke`).
- Every `handleWrite` / `handleWriteSoftAuth` channel must appear in `CHANNEL_REGISTRY` (or be marked `exclude`) (`runSyncRegistryCompletenessSmoke`).

## Domain file map (after SOLID split)

| Namespace | Module |
|---|---|
| `students:*` | `main/ipc/students.js` |
| `grades:*` | `main/ipc/grades.js` |
| `settings:*` | `main/ipc/settings-ipc.js` |
| `classes:*` / `subjects:*` / `stats:*` | `main/ipc/catalog.js` |
| `studentProfile:*` | `main/ipc/student-profile.js` |
| `teachers:*` | `main/ipc/staff.js` |
| `teacherAbsences:*` | `main/ipc/teacher-absences.js` |
| `dailyReport:*` / `schoolEvents:*` | `main/ipc/daily-report.js` |
| `compensation:*` | `main/ipc/compensation.js` |
| `supportSessions:*` | `main/ipc/support-sessions.js` |
| `systemTags:*` | `main/ipc/system-tags.js` |
| `inspectors:*` | `main/ipc/inspectors.js` |
| `appDefaults:*` | `main/ipc/appDefaults.js` |
| `staffAttendance:*` | `main/ipc/staffAttendance.js` |
| `institution:*` | `main/ipc/institution.js` |
| `users:*` / `systemLogs:*` | `main/ipc/system.js` |
| `auth:*` | `main/ipc/auth.js` |

## Layering Architecture & Exemptions (027 rule)

All domain SQL queries (`db.prepare`, `db.exec`, `db.transaction`) must reside in `main/repos/*` and are enforced in CI via `tests/ipc-layering-guard.test.js`.

The following 6 files are explicitly exempt from this rule as they handle SQLite or sync engine infrastructure rather than school-domain entities:
- `system-backup.js`: SQLite schema introspection, dynamic table cloning, and schema copy PRAGMAs.
- `sync.js`: Sync engine internal tables (`sync_outbox`, `sync_conflicts`, `sync_id_map`, `sync_config`).
- `settings-ipc.js`: Generic key-value application settings table.
- `ipc-helpers.js`: Cross-cutting audit logging and error handling plumbing.
- `import-audit.js`: Import audit log writer.
- `app-admin.js`: Administrative identity change request approvals on `sync_config`.
| `system:print*` | `main/ipc/system-print.js` (local-only) |
| `system:backup*` / `restore*` | `main/ipc/system-backup.js` (local-only) |

## Related SOLID follow-ups (done)

| Area | Location |
|------|----------|
| Soft-auth pre-login | `handleWriteSoftAuth(..., { allowNoSession: true })` |
| Exam LS → DB migration | `js/exams/exam-config-migration.js` |
| Student profile pure helpers | `js/student-profile/pure.js` |
| Profile tab field allowlist | `js/data/student-profile-fields.js` (shared main + renderer) |
| Capture DB injection | `setCaptureGetDb` / `wrapWithSyncCapture(ch, fn, { getDb })` in `main/sync/capture.js` |
| Entity metadata SSOT | `main/sync/entity-registry.js` |
| Exact bulk capture | `captureInputUpserts` + repos `students` / `grades` / `absences` |
| Domain repositories (WP4) | Prefer `main/repos/*` for all SQL; keep IPC for auth/validation/orchestration only |
| Typed bulk expansion | `main/sync/engine/expand-bulk.js` (D3 outcomes) |
| Auth ↔ sync lifecycle | `main/sync/lifecycle.js` |
| Legacy bulk quarantine | `main/sync/legacy-bulk-repair.js` |
| Apply hooks | `main/sync/apply-hooks.js` |
| D1 student remote IDs | Writers: `school_year` + `code`; pull dual-accepts legacy `code`; report: `npm run sync:student-id-report` |
| Sync engine modules (WP3) | `main/sync/engine/*` + `main/sync/transport/firestore.js`; import via `main/sync/engine.js` only |

# Checklist: adding a new IPC write channel

Follow this every time you add a **write** (mutating) IPC channel. Skipping a step causes silent sync gaps or preload/handler drift.

## Required steps

1. **Handler** — Register with `handleWrite` or `handleWriteSoftAuth` from `main/ipc/ipc-helpers.js` (not raw `ipcMain.handle`, unless the operation is intentionally local-only such as print/backup).
2. **Preload** — Expose `ipcRenderer.invoke('domain:action', …)` under `window.api` in `preload.js`.
3. **Sync registry** — Add an entry in `CHANNEL_REGISTRY` (`main/sync/capture.js`), or set `{ exclude: true }` with a comment if the write must not sync.
4. **Soft auth (optional)** — If the channel must work **before login** (setup / bulk import), pass:
   ```js
   handleWriteSoftAuth(ipcMain, 'domain:action', WRITE_ROLES, handler, { allowNoSession: true });
   ```
   Default soft-auth still requires a session when one is missing.
5. **Register module** — Ensure the file’s `register*Ipc` is called from `main/ipc/registerAll.js`.
6. **Verify** — Run:
   ```bash
   npm run test:smoke
   npm run lint
   ```

## Smoke guarantees

- Preload channels ↔ main handlers must match (`runContractSmoke`).
- Every `handleWrite` / `handleWriteSoftAuth` channel must appear in `CHANNEL_REGISTRY` (or be marked `exclude`) (`runSyncRegistryCompletenessSmoke`).

## Domain file map (after SOLID split)

| Namespace | Module |
|-----------|--------|
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

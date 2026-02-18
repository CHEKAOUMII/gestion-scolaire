# Gestion Scolaire (Electron)

School management desktop application (Arabic UI) built with Electron and SQLite (`sql.js`).

## Architecture (No Bundler)

- **Main process bootstrap**: `main.js`
- **Database layer**:
    - `main/db/context.js`
    - `main/db/init.js`
    - `main/db/schema.js`
    - `main/db/migrations.js`
- **IPC modules**:
    - `main/ipc/auth.js`
    - `main/ipc/students.js`
    - `main/ipc/absences.js`
    - `main/ipc/schoolOps.js`
    - `main/ipc/staff.js`
    - `main/ipc/exams.js`
    - `main/ipc/licensing.js`
    - `main/ipc/ownerTelemetry.js`
    - `main/ipc/system.js`
    - `main/ipc/registerAll.js`
- **Licensing core**:
    - `main/licensing/offlineKey.js`
    - `main/licensing/deviceFingerprint.js`
    - `main/licensing/service.js`
    - `main/licensing/ownerSync.js`
- **Renderer pages** (multi-page HTML, no bundler):
    - `index.html` + `app.js` + `js/pages/dashboard-init.js`
    - `students-list.html` + `js/pages/students-list.js`
    - `settings-imports.html` + `js/pages/settings-imports.js`

## IPC Contract

- Renderer bridge is defined in `preload.js` via `window.api`.
- Every `ipcRenderer.invoke('<channel>')` must have exactly one matching `ipcMain.handle('<channel>')`.
- Contract parity is validated by `tests/smoke.js`.

## Backup and Restore

- UI logic lives in `js/backup.js`.
- Full backup contains:
    - selected `localStorage` keys
    - SQLite snapshot (`dbBase64`) via `system:backupDb`
- Restore applies localStorage and database snapshot via `system:restoreDb`.
- Database restore uses prechecks and a rollback-safe file swap (`.restore.tmp` + `.restore.bak`).

## Migrations

- `main/db/migrations.js` ensures `schema_migrations` exists.
- Schema updates are applied as ordered versioned migrations in `MIGRATIONS`.
- Current migration steps include:
    - `2026-02-001-grades-section`
    - `2026-02-002-students-registration-type`
    - `2026-02-003-teacher-absences-justified`
    - `2026-02-004-exam-proctors-date`
    - `2026-02-005-exam-proctors-session`
    - `2026-02-006-grades-teacher-name`
    - `2026-02-007-grades-level`
    - `2026-02-008-licensing-schema`
    - `2026-02-009-users-password-auth`
    - `2026-02-010-owner-sync-schema`
    - `2026-02-011-owner-sync-token-split`

## Licensing

- Added per-device licensing foundation with plan tiers:
    - Basic: 1 device
    - Pro: 3 devices
    - Business: 10 devices
- Device matching supports reinstall tolerance through weighted fingerprint scoring.
- Offline grace fields are tracked (`offline_grace_days`, `last_validated_at`).
- Generate offline keys for local testing:
    - `npm run license:key -- --plan=pro --days=365 --customer=SCHOOL-001 --online=false`

## Owner Telemetry (Installed PCs Dashboard)

- Centralized sync server is available in `server/index.js`.
- Start server:
    - `npm run owner:server`
- Railway/host env vars:
    - `OWNER_SYNC_WRITE_TOKEN`
    - `OWNER_SYNC_READ_TOKEN`
    - `OWNER_DB_PATH` (ex: `/data/owner-telemetry.json`)
- For automatic client connection in all sold installations, set build defaults once in:
    - `main/licensing/ownerSyncDefaults.js`
    - Fill `serverUrl`, `writeToken`, and set `enabled: true`
    - Optional admin dashboard token: `readToken`
- Configure sync from `settings-license.html` (admin):
    - server URL
    - write token (clients)
    - read token (dashboard)
    - heartbeat interval
    - use "اختبار الاتصال" before saving
- Synced device counts appear in the main dashboard (`index.html`) for admin users.

## Performance Notes

- Heavy external libraries are loaded on demand:
    - `Chart.js` from `app.js`, `analytics.html`, and `absence-analytics.html` when charts are rendered
    - `XLSX` from `app.js`/`js/pages/settings-imports.js` when import/export is used

## Development Commands

- `npm run start` - start Electron app
- `npm run lint` - run ESLint on refactored JS scope
- `npm run format` - run Prettier on refactored JS/docs/workflow files
- `npm run test:smoke` - contract + module + page extraction smoke checks
- `npm run owner:server` - run central telemetry server for installed devices tracking

## CI

GitHub Actions workflow at `.github/workflows/ci.yml` runs:

1. `npm ci`
2. `npm run lint`
3. `npm run test:smoke`

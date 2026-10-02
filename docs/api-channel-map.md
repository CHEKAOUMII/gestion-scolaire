# IPC channel map (preload namespaces)

Grouped by `window.api` surface from `preload.js`. Handlers live under `main/ipc/*` unless noted.

| Preload namespace | Primary IPC module | Notes |
|-----------------|--------------------|-------|
| `students` | `main/ipc/students.js` + `main/repos/students.js` | **cycle** — authenticated reads; bulk uses explicit atomic capture |
| `studentProfile` | `main/ipc/student-profile.js` | |
| `classes` / `subjects` | `main/ipc/catalog.js` | |
| `grades` | `main/ipc/grades.js` + `main/repos/grades.js` | **cycle** — authenticated reads; bulk explicit capture |
| `settings` | `main/ipc/settings-ipc.js` | |
| `pageVisibility` | `main/ipc/pageVisibility.js` | |
| `appDefaults` | `main/ipc/appDefaults.js` | Some writes excluded from fine-grained outbox |
| `stats` | `main/ipc/catalog.js` | |
| `absences` | `main/ipc/absences.js` + `main/repos/absences.js` | **cycle** — authenticated reads; bulk explicit capture |
| `correspondence` | `main/ipc/absences.js` / school ops | **cycle** — authenticated reads via `main/repos/absences.js` |
| `studentFiles` / `studentMovements` | `main/ipc/schoolOps.js` | **cycle** — `main/repos/student-files.js`, `main/repos/student-movements.js` |
| `teachers` | `main/ipc/staff.js` | |
| `teacherAbsences` | `main/ipc/teacher-absences.js` | |
| `staffAttendance` | `main/ipc/staffAttendance.js` | |
| `exams` / proctors / rooms / tests | `main/ipc/exams.js` | |
| `system` / users / logs | `main/ipc/system.js` | Mixed admin domain (split optional) |
| `auth` | `main/ipc/auth.js` | Lifecycle via `main/sync/lifecycle.js` |
| `sync` | `main/ipc/sync.js` | Config local-only |
| `licensing` / `ownerTelemetry` | `main/ipc/licensing.js`, `ownerTelemetry.js` | |
| `updater` | `main/ipc/updater.js` | |
| `notifications` | `main/ipc/notifications.js` | |
| `reports` | `main/ipc/reports.js` | |
| `institution` | `main/ipc/institution.js` | Mostly local/cloud admin |
| `systemTags` | `main/ipc/system-tags.js` | |
| `compensation` | `main/ipc/compensation.js` | |
| `supportSessions` | `main/ipc/support-sessions.js` | |
| `timetableData` | `main/ipc/timetable-data.js` | Local-only exclude |
| `examConfig` | `main/ipc/exam-config-data.js` | Local-only exclude |
| `inspectors` | `main/ipc/inspectors.js` | |
| `appAdmin` | `main/ipc/app-admin.js` | |
| `diagnostics` | `main/ipc/diagnostics.js` | |

**Sync SSOT:** `main/sync/entity-registry.js`  
**Write capture policy:** `main/sync/capture.js` → `CHANNEL_REGISTRY`  
**Checklist:** `docs/plans/2026-07-15-add-write-channel-checklist.md`

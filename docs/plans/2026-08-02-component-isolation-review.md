# Component Isolation Review & Remediation Plan

**Date:** 2026-08-02
**Branch:** 029-stage-rules-management
**Type:** Architecture review + phased remediation plan
**Scope:** Dependency direction and component isolation across renderer / IPC / repos / services / sync

---

## 1. Context

This document records a review of how well the app components are isolated (decoupled from one
another and from concrete infrastructure), following the reference boundary model in
`docs/plans/2026-07-17-layering-architecture-review-plan.md`.

Reference layers:

| Layer | Responsibility |
|---|---|
| Renderer / UI | Views, forms, page controllers. Talks only through `window.api`. |
| IPC bridge | `preload.js` + thin `ipcMain` handlers. Whitelisted contract; no domain SQL/rules. |
| Business logic / services | Rules (attendance, merge, lockout, validation). Framework-agnostic when pure. |
| Data access | All SQL behind repository-style functions (`main/repos/*`). |
| Sync engine | Outbox, push/pull, conflict, Firestore transport. Isolated from pure domain rules. |

---

## 2. Review findings

### 2.1 Well-isolated components (strong)

- **Process isolation is healthy.** `main.js` sets `contextIsolation: true`, `nodeIntegration: false`,
  `sandbox: true`; renderer pages talk only to `window.api` (contextBridge in `preload.js`). Audit
  confirmed `js/pages/*` contains zero `require(`, `process.`, `electron.remote`, or `nodeIntegration`.
- **Data-access layer is expanding.** Repository pattern now covers students, grades, absences, exams,
  staff, orientation, stage-rules, cycles, student-files. Ten repos use the injectable
  capture-port (`setRepoCapturePort` / `createNoOpCapturePort`) so unit tests run with a no-op
  change tracker instead of the real outbox/sync module.
- **Pure domain modules are isolated and unit-testable.** `proctor-v3`, `cc-rules`,
  `student-averages`, `import-center/*`, and the `js/shared/*` dual-export modules are
  framework-free.
- **Sync engine is well factored.** `main/sync/engine/{push,pull,apply,outbox,transport}` plus
  `entity-registry.js`, `capture.js`, and per-domain apply hooks.
- **Error flow is good.** `ipc-helpers` sanitizes driver errors (strips `SQLITE_*`, stacks; returns
  Arabic / `INTERNAL_ERROR` to the UI).

### 2.2 Weak isolation: SQL still inside IPC handlers

| IPC file | SQL stmts | Notes |
|---|---|---|
| `system-backup.js` | 18 | backup machinery; legit but thick |
| `system.js` | 14 | system/settings writes |
| `institution.js` | 14 | institution ops |
| `auth.js` | 14 | auth god path (IPC + SQLite + Firebase + Firestore) |
| `system-tags.js` | 10 | domain write path — should be a repo |
| `sync.js` | 8 | sync config |
| `staffAttendance.js` | 5 | domain write path |
| `appDefaults.js` | 5 | app settings / defaults |
| `daily-report.js` | 5 | daily report writes |
| `settings-ipc.js` | 3 | settings |
| `exam-config-data.js` | 3 | exam config (bulk) |
| `support-sessions.js` | 3 | support sessions |
| `compensation.js` | 2 | compensation writes |
| `pageVisibility.js` | 2 | device-local access |
| `ipc-helpers.js` | 2 | helper layer leakage |
| `inspectors.js` | 2 | inspectors writes |
| `teacher-absences.js` | 2 | teacher absence writes |
| `app-admin.js` | 1 | admin ops |
| `reports.js` | 1 | reports |

### 2.3 Weak isolation: fat renderer inline scripts

Several HTML pages still carry large inline `<script>` blocks that have not been extracted to
`js/pages/*`:

| HTML file | Inline script lines |
|---|---|
| `reports-semester.html` | ~1453 |
| `student-support.html` | ~1093 |
| `grades-results.html` | ~485 |
| `timetable-students.html` | ~481 |
| `timetable-rooms.html` | ~430 |
| `timetable-teachers.html` | ~303 |

These are page-level components that cannot be unit-tested or reused in isolation.

### 2.4 Assessment vs. 2026-07-17 baseline

- Baseline then: 3 repos, ~26/37 IPC files with `.prepare()` SQL, capture woven into writes.
- Now: 10+ repos all using injectable capture-port; IPC SQL count reduced but still present in
  ~19 IPC files (several on active domain write paths).
- Renderer boundary remains pristine; auth vertical slice is still multi-stack.

---

## 3. Remediation phases

### Phase A — Domain write paths to repos (highest leverage, behavior-preserving)

Move SQL out of IPC into `main/repos/*`, leaving IPC = role check + `requireFields` /
`requireSchoolYear` + repo call + response mapping. Register capture ports properly so outbox
behavior is unchanged.

1. `system-tags.js` -> new `main/repos/system-tags.js` (IPC: auth + validation only).
2. `staffAttendance.js` + `teacher-absences.js` -> extend `main/repos/absences.js` or a staff repo.
3. `daily-report.js` -> new `main/repos/daily-report.js`.
4. `inspectors.js`, `compensation.js`, `support-sessions.js` -> small repos / extend staff repo.
5. `exam-config-data.js` + `appDefaults.js` -> new `main/repos/app-defaults.js` (config rows).
6. Follow `docs/plans/2026-07-15-add-write-channel-checklist.md` for every write moved so capture
   registration stays intact (bulk writes: `captureMode: 'explicit'` + `exclude: true`).

### Phase B — Keep legitimately system-level SQL thin and documented

`system.js`, `system-backup.js`, `sync.js`, `settings-ipc.js`, `pageVisibility.js` are bootstrap /
backup / device-local settings. Rather than forcing repos:

- Wrap SQL behind small accessor functions in `main/db/*` or dedicated repos;
- Document in AGENTS.md why these remain near the IPC layer (device-local, non-sync, backup scope).

### Phase C — Auth decoupling

- Keep pure policies (`lockout-policy.js`, `session-policy.js`, `permissions.js`) framework-free.
- Move remaining user/pin/password SQL in `auth.js` into existing `main/repos/users.js`.
- Keep the Firebase adapter isolated in `firebase-auth-service.js`; IPC `auth.js` becomes
  composition + error translation only.
- Matches 027 FR-011 / SC-003 (lockout/session policy unit-testable without remote identity or UI).

### Phase D — Renderer inline-script extraction (optional, larger)

- Extract `reports-semester.html`, `student-support.html`, `grades-results.html`, `timetable-*`
  inline scripts into `js/pages/*` modules, preserving behavior exactly.
- Treat as its own workstream; each page extraction independently verified.

---

## 4. Verification

- `npm test` and `npm run lint` green after each phase (full suite incl. `stage-rules-*`, `cycle-*`,
  `sync-*`, `orientation-*`).
- Add/extend repo unit tests for each newly extracted domain, runnable without the desktop UI
  (no-op capture ports).
- Re-run isolation greps after each phase and record before/after:
  - `db.prepare|db.exec` in `main/ipc/*`
  - `require('../sync/...')` / `require('electron')` in `main/repos/*`
  - inline `<script>` line totals per HTML page
- Smoke regression: login, one bulk import, one exam write, one staff write, one orientation write,
  one sync push cycle — matching pre-change behavior.

---

## 5. Out of scope

- Big-bang rewrite, naming/style linting, full security audit.
- Moving backups/system diagnostics into repos strictly (Phase B keeps them documented as system
  utilities).
- Deleting legacy settings keys before the full release-cycle compat window (row-124 rule).

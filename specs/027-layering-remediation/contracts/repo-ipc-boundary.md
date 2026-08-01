# Contract: Repository ↔ IPC boundary

**Feature**: 027-layering-remediation  
**Applies to migrated domains**: students, grades, absences, exams, staff, orientation, users

## Purpose

Define what may live in IPC handlers vs repositories so extractions modules stay thin and testable.

## IPC handler responsibilities (allowed)

1. Register channels with `handleRead` / `handleWrite` / `handleWriteSoftAuth`.
2. Authorize via roles / soft-auth options already used on the channel.
3. Validate inputs: `requireFields`, `requireSchoolYear`, `normalizeYear`, pagination helpers, max batch sizes.
4. Call repository functions with `db` injected by helpers.
5. Map rows to aliases for renderer if already done (e.g. student `massar_code`).
6. Return values in the **same shapes** preload/renderer already expect.
7. Rely on ipc-helpers for error sanitization on thrown errors.

## IPC handler responsibilities (forbidden after domain migration)

1. New domain SQL via `db.prepare` / `db.exec` / ad-hoc transactions for that domain’s tables.
2. Importing `main/sync/capture` for domain bulk capture (repos + capture-port only).
3. Changing channel names or argument order without a coordinated preload + renderer migration (out of scope).

## Repository responsibilities (allowed)

1. All SQL for the domain’s tables.
2. Transactions spanning multiple statements/tables for one use case (e.g. teacher delete cascades).
3. Calling CapturePort inside transactions for explicit bulk/delete paths.
4. Domain constants (allowed statuses, updatable field lists).
5. Pure helpers colocated for normalize/merge used only by that domain.
6. Accepting optional `validate` callbacks from IPC for bulk imports.

## Repository responsibilities (forbidden)

1. `require('electron')`, `ipcMain`, session maps, BrowserWindow.
2. `require('../sync/capture')` direct (must use `./capture-port`).
3. Firebase / remote SDK imports.
4. Reading auth session; authorization is IPC’s job.
5. Calling `getDb()` globally — `db` is always a parameter.

## Channel stability contract

| Namespace | IPC module | Repo module |
|-----------|------------|-------------|
| `students:*` | `main/ipc/students.js` | `main/repos/students.js` |
| `grades:*` | `main/ipc/grades.js` | `main/repos/grades.js` |
| `absences:*` | `main/ipc/absences.js` | `main/repos/absences.js` |
| `exams:*`, `examProctors:*`, `examRooms:*`, `tests:*`, `examInvitations:*`, `examAttendance:*` | `main/ipc/exams.js` | `main/repos/exams.js` |
| `teachers:*` | `main/ipc/staff.js` | `main/repos/staff.js` |
| `orientation:*` | `main/ipc/orientation.js` | `main/repos/orientation.js` |
| `auth:*` / related auth channels | `main/ipc/auth.js` | `main/repos/users.js` + pure policy |

Preload `window.api` shapes are **unchanged** by this feature.

## Example (illustrative)

```js
// main/ipc/exams.js — allowed shape after extraction
handleWrite(ipcMain, 'exams:save', WRITE_ROLES, (db, _event, payload) => {
    requireFields(payload, [/* existing */]);
    requireSchoolYear(payload.school_year);
    return examsRepo.save(db, payload);
});
```

```js
// main/repos/exams.js
function save(db, payload) {
    // SQL only + capture-port if needed
}
```

## Verification

- `npm run test:smoke` — channel parity + sync registry completeness.
- Domain unit tests import **repo** modules only, not IPC registrars.

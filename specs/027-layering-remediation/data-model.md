# Data Model: 027-layering-remediation

**Date**: 2026-07-17  
**Note**: This feature does **not** change SQLite schema. It reassigns ownership of existing tables/modules. Below is the **logical** model for implementation and tests.

---

## 1. Module entities (architecture)

### CapturePort

| Attribute | Description |
|-----------|-------------|
| Role | Injectable change-tracking side-effect API for repos |
| Default | Delegates to `main/sync/capture` |
| Test double | No-op methods that skip outbox writes; delete helpers still perform local DELETE when the production helper combines delete+capture |
| Consumers | `main/repos/*` only |

**Operations (logical):**

- `captureInputUpserts(db, opts)`
- `captureResolvedRows(db, tableName, rows, operation)`
- `captureDeletesFromRows(db, tableName, rows)`
- `capturePutsByIds(db, tableName, ids)` (if used)
- `selectRowsBySchoolYear(db, tableName, year)`
- `deleteBySchoolYearWithCapture(db, tableName, year)` → returns delete count
- `notifyCaptureCommitted()`

### Repository (per domain)

| Attribute | Description |
|-----------|-------------|
| Identity | Domain name: students, grades, absences, exams, staff, orientation, users |
| Inputs | `db` handle first; domain payloads; optional validate callbacks |
| Outputs | Rows, counts, or `{ success, error, … }` matching current IPC contracts |
| Constraints | No Electron imports; no direct `require('../sync/capture')`; school_year filters on partitioned tables |

### AuthPolicy (pure)

| Attribute | Description |
|-----------|-------------|
| Lockout | max attempts, schedule array, attempt TTL |
| Session | TTL ms; validity predicate from `createdAt`/`lastActivity` as currently stored |
| Side effects | None |

### RemoteIdentityAdapter

| Attribute | Description |
|-----------|-------------|
| Existing module | `main/auth/firebase-auth-service.js` |
| Responsibility | Sign-in, sign-out, password change, profile load |
| Not this feature | Redesign of Firebase collections |

### CommunicationHandler (IPC)

| Attribute | Description |
|-----------|-------------|
| Responsibility | Role/session checks, field validation, call repo/policy/adapter, map errors via ipc-helpers |
| Forbidden after migration | Domain `.prepare` SQL for exams/staff/orientation/users (auth SQL moved to users repo) |

---

## 2. Persistent tables owned after extraction

No column changes. Ownership for SQL access:

| Table(s) | Owning repo after feature | Notes |
|----------|---------------------------|--------|
| `students` | `repos/students` (existing) | Capture via port |
| `grades` | `repos/grades` (existing) | Capture via port |
| `absences` (+ related bulk helpers) | `repos/absences` (existing) | Capture via port |
| `exams`, `exam_proctors`, `exam_rooms`, `tests`, `exam_invitations`, `exam_attendance` | `repos/exams` (new) | As currently used in `ipc/exams.js` |
| `teachers`, `teacher_aliases` (+ cascade cleanup of related FKs on delete) | `repos/staff` (new) | Cascades today touch grades/tests/attendance/proctors/compensation—preserve order |
| `student_orientation` | `repos/orientation` (new) | Merge import rules preserved |
| `users`, `login_attempts` | `repos/users` (new) | |
| `settings` key `app_auth_session` | `repos/users` (new) | Session persistence row only for that key helper API |
| Sync tables (`sync_outbox`, …) | still `sync/*` | Repos touch only via CapturePort |

Teacher absences module (`main/ipc/teacher-absences.js`) is **out of scope** unless already embedded in staff extraction; leave separate IPC file.

---

## 3. Validation rules (preserve; do not invent)

Documented for test authors—source of truth remains current IPC until moved:

### Cross-domain

- `school_year` required on mutating operations that are year-scoped (`requireSchoolYear` / `normalizeYear` behavior unchanged at IPC).
- Write roles: non-viewer staff roles as today (`ALLOWED_ROLES` filter).

### Exams (representative)

- Exam/proctor/room/test payloads require fields currently enforced by `requireFields` / date validators in `ipc/exams.js`.
- Bulk import empty array → failure response.
- Round-robin generate fails when no exams or no active teachers.

### Staff

- Teacher add requires identity fields currently required.
- Delete teacher cascades aliases and clears dependent references as today.
- Bulk import upserts by PPR/name rules as today.

### Orientation

- Bulk merge uses existing text/number normalize (comma decimals, upper codes).
- Clear year deletes all `student_orientation` for year.

### Auth

- Lockout after 5 failed attempts with escalating delays.
- PIN lockout after 5 failed PIN attempts.
- Session TTL 12h product expectation.

---

## 4. State transitions

### Login attempt record

```text
[none] --fail--> attempts=1, locked_until=null
       --fail--> attempts++
       --fail at threshold--> locked_until = now + schedule[min(index)]
       --success login--> record cleared
       --TTL expire--> treat as fresh (existing cleanup behavior)
```

### Outbox intent (logical)

```text
local mutation in transaction
  → CapturePort writes outbox rows (or no-op in unit tests)
  → commit
  → notifyCaptureCommitted (may debounce push)
```

Atomicity: capture rows and domain rows share one SQLite transaction for explicit bulk paths.

### Session

```text
login success → in-memory SESSION_BY_SENDER + optional settings persistence
activity / reopen within TTL → valid
past TTL → unauthenticated
logout → cleared memory + settings row
```

---

## 5. Relationships (logical)

```text
Renderer --invoke--> Preload window.api
                         |
                         v
                   IPC handler (authz + validate)
                      |            \
                      v             v
                   Repository    Auth policy (pure)
                      |             |
                      v             v
                   SQLite      users repo / remote adapter
                      |
                      v
                 CapturePort --> sync outbox --> push engine (unchanged)
```

---

## 6. Test fixtures (minimal)

Unit tests should CREATE only tables needed, e.g.:

- Exams tests: `exams`, `exam_proctors`, `teachers` (if generate/import needs them), `school_year` columns as in production.
- Staff tests: `teachers`, `teacher_aliases`.
- Orientation tests: `student_orientation`, optional `students` for join paths.
- Users tests: `users`, `login_attempts`, `settings`.

Prefer copying DDL snippets from `main/db/schema.js` for accuracy rather than inventing columns.

# Database Schema Remediation Plan — `gestionScholaire3`

| | |
|---|---|
| **Date** | 2026-07-07 |
| **Supersedes** | `docs/database-schema-audit.md` (modeling lens) + `docs/reviews/2026-07-07-database-schema-analysis.md` (runtime lens) |
| **Engine** | SQLite via `better-sqlite3`, Electron main process |
| **Init flow** | `main/db/init.js` → `new Database()` → `WAL` + `foreign_keys=ON` → `createTables()` → `runMigrations()` |
| **Schema sources** | `main/db/schema.js` (735 L), `main/db/migrations.js` (1364 L, 67 migrations) |
| **Migration model** | Forward-only, no rollback, version-string PK in `schema_migrations`. **Every change below ships as a new migration.** |

> This plan consolidates two prior reviews. The **audit** owned data modeling and redundancy; the **analysis** owned runtime/operational integrity and was code-grounded. This document keeps the grounding, unifies severity, adds the migration mechanics both under-specified, and closes the gaps each left (the audit missed all runtime issues; the analysis missed the live `grades INSERT OR REPLACE` bug and most redundancy analysis).

---

## 1. Executive Summary

The schema is operationally mature: clean migration runner, WAL, FK enforcement, `school_year`-leading composite indexes on every hot table, transactional bulk writes and a transactional pull-apply path. It is not the problem.

The problems cluster in four areas, mapped to the original brief:

| Brief requirement | Health | Where it bleeds |
|---|---|---|
| **Data integrity** | ⚠️ weak at the edges | No `ON DELETE` policy; 8 logical FKs unconstrained; `grades` uses `INSERT OR REPLACE` |
| **Performance** | ✅ good, 2 gaps | `system_logs` unindexed + unbounded; no `busy_timeout`/`synchronous` tuning |
| **Scalability** | ✅ mostly | Operational data in JSON blobs; sync-marking not atomic |
| **Redundancy** | ⚠️ structural | Dual `student_id`/`student_code` and `teacher_id`/`teacher_name` keys throughout; free-text name joins |

**Do these first (cheap, high-value, low-risk):**
1. **R1** — Replace `grades` `INSERT OR REPLACE` with `ON CONFLICT DO UPDATE` (fixes row-identity churn on synced rows).
2. **R2** — Index + retain `system_logs`.
3. **R3** — PRAGMA tuning (`busy_timeout`, `synchronous=NORMAL`).
4. **R4** — Wrap sync `markEntrySent` in a transaction.

Then the structural campaign (**R5–R8**: FK delete policy + real FKs, absence semantics, redundancy strategy) in a single supervised, backup-guarded migration window because they require SQLite table rebuilds.

---

## 2. Findings — unified & grounded

Severity: 🔴 P1 (integrity/perf hazard, act soon) · 🟡 P2 (real, schedule it) · 🟢 P3 (hygiene).

### 🔴 P1 — F1 · `grades` uses `INSERT OR REPLACE` on a synced table
`grades:save`/`saveBulk` at [students.js:639](main/ipc/students.js:639) and [:666](main/ipc/students.js:666) use `INSERT OR REPLACE`. In SQLite `REPLACE` = DELETE + INSERT, so `grades.id` changes on every re-save, resetting `created_at` and breaking `sync_id_map` local-id linkage → duplicate/mis-keyed pushes.
*(Caught by the audit; missed by the analysis despite it warning about this pattern generically.)*
**Fix:** explicit upsert on the existing unique key `(student_code, subject, semester, school_year)` — see R1.

### 🔴 P1 — F2 · No `ON DELETE` behavior on any FK
All 13 declared FKs end at `REFERENCES target(id)` with no `ON DELETE`/`ON UPDATE` (verified: 0 `ON DELETE` clauses in `schema.js`/`migrations.js`). Default `NO ACTION` means student/teacher deletes either fail opaquely or, for the unconstrained refs below, orphan children. No `PRAGMA foreign_key_check` runs anywhere, so pre-existing orphans are invisible.

### 🔴 P1 — F3 · `system_logs` unindexed and unbounded
Highest-write table; only the implicit rowid PK ([schema.js:253](main/db/schema.js:253)), no index on `entity_type`/`entity_id`/`action`/`created_at`, and no retention job anywhere. Every filtered read is a full scan; the table grows forever.

### 🟡 P2 — F4 · 8 logical references carry no FK constraint
`grades.teacher_id`, `tests.teacher_id`, `staff_attendance.teacher_id`, `compensation_tracking.teacher_id`, `support_sessions.teacher_id`, `exam_invitations.teacher_id`, `exam_attendance.teacher_id` → `teachers(id)`; `student_risk_snapshot.student_id` → `students(id)`. `student_profile_data.student_id` is `NOT NULL` yet written as `0` — a **documented dead column** (mig 062); its real key is `student_code`. Adding FKs requires table rebuilds (see §4).

### 🟡 P2 — F5 · No `busy_timeout` / durability tuning
`init.js` sets only `journal_mode=WAL` and `foreign_keys=ON`. Missing `busy_timeout` (default 0 → immediate `SQLITE_BUSY` when sync push and UI write collide) and `synchronous` (WAL default FULL; NORMAL is the standard, ~2× faster, same crash-safety under WAL).

### 🟡 P2 — F6 · Sync `markEntrySent` is not atomic
[engine.js:1038](main/sync/engine.js:1038) runs four separate UPDATEs (outbox, id_map version, id_map ancestor, conflicts) with no wrapping transaction, called per-item after a Firestore batch commit. A crash between the remote commit and local marking → remote has it, local thinks pending → duplicate push next cycle.

### 🟡 P2 — F7 · Absences conflate event and monthly-aggregate models
`absences` stores event fields (`absence_date`, `reason`) but the unique key is monthly: `(student_code, month, school_year, absence_type)` ([absences.js:103](main/ipc/absences.js:103)). Two same-type events in one month can't coexist; `absence_date`/`reason`/`student_id` go stale on monthly upsert. Decide: event-level table + derived monthly summary, **or** commit to monthly-only and strip event fields from the IPC contract.

### 🟡 P2 — F8 · Redundant identity keys everywhere (the "redundancy" brief)
| Redundant pair | Tables | Failure mode |
|---|---|---|
| `student_id` + `student_code` | grades, absences, correspondence, profile, risk | Update `students.code`/`school_year` → dependents desync |
| `teacher_id` + `teacher_name` | grades, tests, staff_attendance, exam_*, compensation, support_sessions | Rename leaves stale names; same-name teachers merge wrongly |
| copied `section` | students, grades, compensation, support_sessions | Student movement leaves stale sections |

Name-based **unique constraints** are the sharp edge: `exam_invitations`/`exam_attendance` are unique on `teacher_name` ([exams.js:418](main/ipc/exams.js:418),[:458](main/ipc/exams.js:458)) — a rename creates duplicates, two same-name teachers collide.
**Strategy:** pick `id`/`code` as the canonical operational key; keep name/section as **display snapshots**; move name-based unique indexes to partial unique on `teacher_id` with a name fallback only `WHERE teacher_id IS NULL`.

### 🟡 P2 — F9 · Duplicate table definitions outside `main/db/`
`notifications` defined in mig 015 **and** `main/notifications/store.js:4`; `school_identity` in mig 014 **and** `main/reports/identity.js:23`. Both `IF NOT EXISTS`, so first writer wins silently — drift risk.

### 🟡 P2 — F10 · Migration version scheme is mixed
Dominant `YYYY-MM-NNN-slug` interleaved with bare-date slugs (`2026-03-29-…`, `2026-04-15-…`). Version is the PK; a collision silently skips the newer migration (mig 062 documents a near-miss). No sequence guard.

### 🟢 P3 — F11 · Enum-like columns are free text
`students.status`, `student_movements.movement_type`, `staff_attendance.type`, `exam_attendance.role`/`status`, `support_sessions.attendance_status` — no `CHECK`. Vocabulary drifts (`expelled` vs `expulsion`). Add `CHECK(... IN (...))` on new tables; harmonize existing values before constraining.

### 🟢 P3 — F12 · Loose temporal typing
Three timestamp formats coexist (`CURRENT_TIMESTAMP`, epoch-ms, `datetime('now')`); `school_year` is unvalidated free text. Standardize new tables on `DATETIME DEFAULT CURRENT_TIMESTAMP`; add a `db/time.js` helper rather than rewriting history.

### 🟢 P3 — F13 · JSON blobs for operational data
`timetable_data.data_json`, `exam_config_data.data_json`, `student_profile_data.data_json`. Fine for small config; risky when data needs indexing/reporting/partial-update/row-level sync. `student_profile_data` already has IPC allowlisting + size limits — good pattern to copy. Normalize only when a blob demonstrably needs query/report/conflict-resolution.

### 🟢 P3 — F14 · Sync-snapshot & `SELECT *` hygiene
`sync_snapshots` has point-deletes only ([snapshot.js:82](main/sync/snapshot.js:82)), no bulk purge of orphans; 68 `SELECT *` mostly on single-row config lookups (harmless). Low priority.

---

## 3. Roadmap (severity × effort × risk)

| # | Sev | Finding | Action | Effort | Migration/rebuild? |
|---|---|---|---|---|---|
| **R1** | P1 | F1 | Swap `grades` `INSERT OR REPLACE` → `ON CONFLICT(student_code,subject,semester,school_year) DO UPDATE`. Code-only change in `students.js`. | S | No |
| **R2** | P1 | F3 | Add `idx_system_logs_entity(entity_type,created_at)` + `idx_system_logs_action(action,created_at)`; add retention (keep N days, default 90, configurable via `settings`) on the existing cleanup timer. | S | Index migration only |
| **R3** | P2 | F5 | In `init.js`: `busy_timeout=5000`, `synchronous=NORMAL`, explicit `wal_autocheckpoint`. | S | No |
| **R4** | P2 | F6 | Wrap `markEntrySent`'s 4 UPDATEs in `db.transaction()`; batch-mark a committed Firestore chunk in one transaction. | S | No |
| **R5** | P2 | F9,F10 | Move `notifications`/`school_identity` DDL to migrations only; callers use a shared `ensure*Schema()`. Adopt `YYYY-MM-NNN-slug` exclusively; add a dev assertion that versions are unique + monotonic. | S | No |
| **R6** | P1/P2 | F2,F4 | Decide per-parent delete policy (students → `CASCADE`/`SET NULL` on academic children; teachers → restrict-while-referenced or `SET NULL`). Add real FKs with that policy to the 8 logical refs. Run `PRAGMA foreign_key_check` before/after. Treat `student_profile_data.student_id` separately (drop or backfill). | **M** | **Yes — table rebuilds** |
| **R7** | P2 | F7,F8 | Choose canonical keys: `student_id`/`teacher_id` as operational truth, name/section as snapshots. Move `exam_invitations`/`exam_attendance` name-unique → partial-unique on `teacher_id` (name fallback `WHERE teacher_id IS NULL`). Decide absences event-vs-monthly and align the IPC contract. | **M** | Partly (unique-index migrations + code) |
| **R8** | P3 | F11,F12 | Add `CHECK` enums on new tables; harmonize `status`/`movement_type` vocab; add `db/time.js`. | S | Value cleanup + new-table only |
| **R9** | P3 | F13,F14 | Add `sync_snapshots` orphan purge to the cleanup timer; extend JSON allowlist/size-limit pattern to `timetable_data`; normalize a blob only when it needs reporting/search. | S | No |

### Suggested execution order
**Sprint 1 (code-only, ship now):** R1 → R3 → R4 → R2 → R5. All small, no rebuilds, immediate integrity/perf wins.
**Sprint 2 (supervised, backup first):** R6 + R7 together as one table-rebuild campaign — same tables get rebuilt, so do FKs + `NOT NULL` tightening + name→id unique-index migration in one pass.
**Sprint 3 (opportunistic):** R8 → R9.

---

## 4. Migration mechanics (the part both prior docs under-specified)

Adding a FK or `ON DELETE` to an existing SQLite table **cannot** be done with `ALTER TABLE`. Each affected table in R6/R7 needs the rebuild dance, inside one migration, with `foreign_keys` temporarily off:

```sql
PRAGMA foreign_keys = OFF;              -- for the duration of the migration txn
BEGIN;
  CREATE TABLE grades_new ( ...same columns...,
    FOREIGN KEY(student_id) REFERENCES students(id) ON DELETE CASCADE,
    FOREIGN KEY(teacher_id) REFERENCES teachers(id) ON DELETE SET NULL );
  INSERT INTO grades_new SELECT * FROM grades;   -- preserves id → keeps sync_id_map valid
  DROP TABLE grades;
  ALTER TABLE grades_new RENAME TO grades;
  -- recreate ALL indexes (they don't survive the rename)
COMMIT;
PRAGMA foreign_key_check;                -- must return zero rows
PRAGMA foreign_keys = ON;
```

**Non-negotiables for R6/R7:**
- `INSERT INTO ..._new SELECT *` must **preserve `id`** — `sync_id_map`/`sync_snapshots` key on local `id`; a fresh rowid breaks sync.
- Recreate every index from the inventory after each rename.
- Run `PRAGMA foreign_key_check` and log orphan rows **before** enforcing — clean them or the migration will strand them.
- Take a DB backup (the app's own backup export) before Sprint 2; the migration system has no rollback.
- Do R1 (grades upsert) **before** R6 rebuilds `grades`, so the code no longer churns `id` when the FK lands.

---

## 5. What to verify before acting
- Run `EXPLAIN QUERY PLAN` on the real production-sized DB before adding any performance index — the `school_year` composites may already cover the hot paths.
- `PRAGMA foreign_key_check` on a real DB to size the orphan cleanup R6 needs.
- Confirm `grades:save` callers don't depend on `grades.id` staying stable across saves today (they shouldn't; R1 makes it true).

---

## 6. Bottom line
The schema is healthy; the risk is concentrated. Four small code-only fixes (R1–R4) remove the two P1 integrity/perf hazards this week. The structural debt — unconstrained FKs, dual identity keys, absence semantics — is real but bounded, and should ship as **one** backup-guarded table-rebuild campaign rather than piecemeal, because every affected table pays the rebuild cost only once.

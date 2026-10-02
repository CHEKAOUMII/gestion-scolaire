# Database Schema Analysis — `gestionScholaire3`

| | |
|---|---|
| **Date** | 2026-07-07 |
| **Engine** | SQLite via `better-sqlite3` (Electron main process) |
| **DB file** | `app.getPath('userData')/gestion-scolaire.db` |
| **Journal mode** | WAL (`PRAGMA journal_mode = WAL`) |
| **Foreign keys** | Enabled at runtime (`PRAGMA foreign_keys = ON`) |
| **Schema sources** | `main/db/schema.js` (735 L), `main/db/migrations.js` (1364 L, 66 migrations) |
| **Init flow** | `main/db/init.js` → `new Database()` → WAL + FKs on → `createTables()` → `runMigrations()` |

---

## 1. Executive Summary

The schema is **well-organized and operationally mature**: a clean migration runner with a `schema_migrations` tracking table, WAL enabled, foreign keys enforced, thoughtful composite indexes on the dominant `school_year` filter axis, and a transactional pull-apply path in the sync engine. Tables are grouped sensibly by domain (students, teachers, staff/exams, sync, licensing, institution/linking).

The five issues most worth fixing, in priority order:

1. **No `ON DELETE` cascade/restrict on any FK** — deleting a student/teacher silently orphans 5+ child tables (P1).
2. **`system_logs` has no index and no retention** — unbounded growth on the highest-write table (P1).
3. **Missing FK constraints on logical references** — `grades.teacher_id`, `tests.teacher_id`, `staff_attendance.teacher_id`, `compensation_tracking.teacher_id`, `support_sessions.teacher_id`, `student_files` (these last two are NOT NULL) have no FK despite referencing `teachers(id)`/`students(id)` (P1).
4. **No `busy_timeout` / WAL checkpoint tuning** — risk of `SQLITE_BUSY` on long push cycles and unbounded WAL growth (P2).
5. **Push path marks outbox rows sent one-by-one outside a transaction** — crash mid-batch leaves partial state (P2).

Two structural debts are worth noting but are **already documented** as deliberate decisions: the `student_profile_data.student_id` dead column (migration `062`) and the migration-version-key collision avoided in `062`. Neither needs action now; both should be revisited in a supervised maintenance window.

---

## 2. Schema Inventory

35 tables across 7 domains. PK = primary key; UC = unique constraint; UI = unique index; FK = foreign key declared in `CREATE TABLE`.

### 2.1 Students / academics

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `students` | 12 | `id` | `UC(code, school_year)` | — | base |
| `grades` | 12 | `id` | `UI(student_code, subject, semester, school_year)` (mig 016) | `student_id→students(id)` | base |
| `absences` | 11 | `id` | `UI(student_code, month, school_year, absence_type)` (mig 017) | `student_id→students(id)` | base |
| `correspondence` | 9 | `id` | — | `student_id→students(id)` | base |
| `student_files` | 6 | `id` | `UC(student_id, doc_key, school_year)` | `student_id→students(id)` NOT NULL | base |
| `student_movements` | 9 | `id` | — | `student_id→students(id)` NOT NULL | base |
| `student_profile_data` | 8 | `id` | `UC(student_code, tab_key, school_year)` | none (logical only) | mig 048 |
| `student_risk_snapshot` | 8 | `id` | `UC(student_code, school_year)` | none (logical only) | mig 062 |

### 2.2 Teachers / identity

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `teachers` | ~38 | `id` | `UI(ppr, school_year)` partial (mig 023) | — | base |
| `teacher_aliases` | 7 | `id` | `UC(teacher_id, school_year, alias_normalized)` | `teacher_id→teachers(id)` NOT NULL | base + mig 028 |
| `teacher_absences` | 7 | `id` | — | `teacher_id→teachers(id)` NOT NULL | base |
| `name_aliases` | 9 | `id` | `UC(entity_type, alias_normalized, school_year)` | none | mig 042 |

### 2.3 Staff / exams / support

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `staff_attendance` | 13 | `id` | 2 partial UIs (absence/late, mig 053) | **none** (logical `teacher_id`) | base |
| `exams` | 8 | `id` | — | — | base |
| `exam_proctors` | ~12 | `id` | — | `exam_id→exams(id)`, `teacher_id→teachers(id)` | base |
| `exam_rooms` | 6 | `id` | — | — | base |
| `exam_invitations` | 7 | `id` | `UC(school_year, teacher_name)` | none | mig 058 |
| `exam_attendance` | 11 | `id` | `UC(school_year, session_key, teacher_name)` | none | mig 059 |
| `exam_config_data` | 5 | `id` | `UC(school_year, config_key)` | none | mig 061 |
| `tests` | 10 | `id` | — | **none** (logical `teacher_id`) | base |
| `support_sessions` | 12 | `id` | `UI(teacher_id, session_date, time_from, section, school_year)` | **none** (logical `teacher_id`) | mig 039 |
| `compensation_tracking` | 13 | `id` | `UC(absence_date, teacher_name, section, period_slot, school_year)` | **none** (logical `teacher_id`) | mig 027 |
| `inspectors` | 11 | `id` | — | — | mig 050 |

### 2.4 System / config

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `settings` | 2 | `key` | — | — | base |
| `system_logs` | 6 | `id` | — | — | **base — no index** |
| `system_tags` | 12 | `id` | 2 partial UIs (standalone / note_entity) | none | mig 045/047/049/052 |
| `notifications` | 9 | `id` (TEXT) | — | — | mig 015 |
| `page_visibility` | 3 | `page_key` | — | — | mig 012 |
| `app_meta` | 2 | `key` | — | — | mig 012 |
| `school_identity` | 3 | `key` | — | — | mig 014 |
| `school_events` | 7 | `id` | — | — | mig 026 |
| `timetable_data` | 4 | `id` | `UC(school_year)` | — | mig 044 |
| `schema_migrations` | 2 | `version` | — | — | runner |

### 2.5 Sync subsystem

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `sync_outbox` | 12 | `id` | — | — | base (ensureSyncSchema) |
| `sync_id_map` | 5 | `row_sync_id` | `UC(table_name, local_id)` | — | base |
| `sync_config` | ~30 | `id` (singleton, `CHECK(id=1)`) | — | — | base |
| `sync_pull_state` | 4 | `table_name` | — | — | base |
| `sync_conflicts` | 13 | `id` | — | — | mig 032 |
| `sync_snapshots` | 4 | `row_sync_id` | — | — | mig 033 |
| `owner_sync_config` | 10 | singleton | — | — | base |
| `owner_sync_outbox` | 9 | `id` | — | — | base |

### 2.6 Licensing / institution

| Table | Cols | PK | Unique | FK | Domain |
|-------|------|----|--------|----|--------|
| `license_plans` | 4 | `code` | — | — | base |
| `licenses` | 12 | `id` | `UC(license_key_hash)` | `plan_code→license_plans(code)` | base |
| `license_activations` | 11 | `id` | `UC(license_id, device_hash)` | `license_id→licenses(id)` NOT NULL | base |
| `license_events` | 5 | `id` | — | `license_id→licenses(id)` | base |
| `institution_config` | ~11 | singleton | — | — | base |
| `device_otp` | 8 | `id` | — | — | base |
| `linked_devices` | 9 | `id` | `UC(device_hash)` | — | base |
| `users` | ~16 | `id` | `email`, `firebase_uid` (partial UI) | — | base |

---

## 3. Relationships Map

### Declared FKs (13 total, all in `schema.js` except `teacher_aliases` which also appears in mig 028)

```
grades               .student_id  → students(id)
absences             .student_id  → students(id)
correspondence       .student_id  → students(id)
student_files        .student_id  → students(id)   [NOT NULL]
student_movements    .student_id  → students(id)   [NOT NULL]
teacher_aliases      .teacher_id  → teachers(id)   [NOT NULL]
teacher_absences     .teacher_id  → teachers(id)   [NOT NULL]
exam_proctors        .exam_id     → exams(id)
exam_proctors        .teacher_id  → teachers(id)
licenses             .plan_code   → license_plans(code)
license_activations  .license_id  → licenses(id)   [NOT NULL]
license_events       .license_id  → licenses(id)
```

### Logical references with NO FK constraint (orphans possible)

| Column | References | Risk |
|--------|------------|------|
| `grades.teacher_id` | `teachers(id)` | Orphan grades if teacher deleted/merged |
| `tests.teacher_id` | `teachers(id)` | Same |
| `staff_attendance.teacher_id` | `teachers(id)` | Same; nullable so half-linked |
| `compensation_tracking.teacher_id` | `teachers(id)` | Same |
| `support_sessions.teacher_id` | `teachers(id)` | Same |
| `exam_invitations.teacher_id` | `teachers(id)` | Same (only `teacher_name` is unique) |
| `exam_attendance.teacher_id` | `teachers(id)` | Same |
| `student_profile_data.student_id` | `students(id)` | **NOT NULL but routinely written as 0** — documented dead column (mig 062); real key is `student_code` |
| `student_risk_snapshot.student_id` | `students(id)` | Nullable logical link; `student_code` is the keyed field |

---

## 4. Data Integrity Findings

### 🔴 P1 — `INT-1`: No `ON DELETE` behavior on any FK
All 13 declared FKs end at `REFERENCES target(id)` with no `ON DELETE` / `ON UPDATE` clause. SQLite's default is `NO ACTION`, which in practice means either (a) the delete silently fails when FK enforcement catches it, or (b) orphans accumulate when it doesn't. There is **no `PRAGMA foreign_key_check` anywhere in the codebase**, so pre-existing orphans from before `foreign_keys=ON` (or from any disabled-FK window during migration `019`) are undetected.
**Impact**: Referential integrity is enforcement-only and unmonitored.

### 🔴 P1 — `INT-2`: Missing FK constraints on logical teacher/student references
Eight columns point at `teachers(id)` or `students(id)` by design but carry no FK constraint (see §3). Notably `student_profile_data.student_id` is declared `NOT NULL` but is written as `0` (documented in migration `062` as an intentional dead column — the real key is `student_code`). Adding real FKs in SQLite requires a full table rebuild (`CREATE _new → copy → DROP → RENAME → reindex`), which is why migration `062` deliberately deferred it.
**Impact**: Cascade behavior absent on the most-referenced entity (`teachers`).

### 🟡 P2 — `INT-3`: Duplicate table definitions outside `main/db/`
Two tables are re-defined in non-DB modules, creating divergence risk:
- `notifications` — defined in migration `015` (`main/db/migrations.js:136`) AND in `main/notifications/store.js:4`.
- `school_identity` — defined in migration `014` (`main/db/migrations.js:103`) AND in `main/reports/identity.js:23`.

Both use `CREATE TABLE IF NOT EXISTS` so they don't error today, but if one copy drifts (added column, changed default), the other silently wins or loses depending on init order.
**Impact**: Schema drift across modules; hard-to-trace column-missing bugs.

### 🟡 P2 — `INT-4`: Migration version-key scheme is inconsistent
Migrations use two formats interleaved:
- `YYYY-MM-NNN-slug` (the dominant form, e.g. `2026-03-016-grades-unique-constraint`)
- bare date slugs: `2026-03-29-support-sessions`, `2026-04-15-role-hierarchy`, `2026-04-18-…`, `2026-04-19-…`, `2026-04-22-…`

Because `schema_migrations.version` is the `PRIMARY KEY` and the runner skips already-recorded versions, a collision silently skips the newer migration. Migration `062` documents a near-miss: the task brief referenced `2026-04-050-student-risk-snapshot` but `050` was already taken by `inspectors-table`, so it was renumbered to `062`. The bare-date scheme makes collisions more likely since there's no sequence guard.
**Impact**: Silent migration skipping on collision — data integrity loss without error.

### 🟢 P3 — `INT-5`: Loose date/timestamp typing
Dates are stored as `TEXT`/`DATE` with no `CHECK` constraints, and three timestamp formats coexist:
- `DATETIME DEFAULT CURRENT_TIMESTAMP` (most tables)
- `INTEGER DEFAULT (strftime('%s','now') * 1000)` (`school_identity.updated_at`)
- `TEXT DEFAULT (datetime('now'))` (`support_sessions.created_at`, `name_aliases.created_at`)

`school_year` itself is freeform `TEXT` (`'2025/2026'`) with no enum/regex check. Queries that compare across these formats will misbehave.
**Impact**: Low immediate risk; complicates cross-table temporal queries and reporting.

### 🟢 P3 — `INT-6`: `student_id` / `teacher_id` nullable where they shouldn't be
`grades.student_id`, `grades.teacher_id`, `staff_attendance.teacher_id`, `exam_proctors.teacher_id`, `exam_proctors.exam_id` are all nullable despite logically being required. The codebase works around this by filtering on `student_code`/`teacher_name` strings instead, but the columns invite half-populated rows.
**Impact**: Tolerable; the denormalized `*_code`/`*_name` columns carry the real linkage.

---

## 5. Performance & Scalability Findings

### 🟢 Positive — well-handled
- **WAL enabled** (`init.js:14`) → readers don't block the writer.
- **Composite indexes on `school_year`** for every hot table (`students`, `grades`, `absences`, `teachers`, `staff_attendance`, `system_tags`, `sync_outbox`, `sync_conflicts`, exam tables). Since ~every query filters by `school_year`, this is the right design.
- **Pull-apply is transactional**: `engine.js:3256` wraps the entire local apply loop in a single `db.transaction()`, with deferred-dependency passes for grades/absences/student_files.
- **Bulk IPC writes use transactions**: `absences.js`, `exams.js`, `staff.js`, `institution.js`, `schoolOps.js` all wrap multi-row inserts in `db.transaction()`.
- **Sync outbox retention exists**: `capture.js:706` purges rows older than `retention_days` (default 7), on an interval timer (`capture.js:722`).
- **Sync conflicts retention exists**: `snapshot.js:91` deletes resolved conflicts older than 30 days.
- **Prepared statements are reused** within loops (the statement is `.prepare()`'d once before the loop, then `.run()` inside).

### 🔴 P1 — `PERF-1`: `system_logs` has no index and no retention
`system_logs` (the highest-write table — one row per audited action) has **zero indexes** beyond the implicit rowid PK and **no cleanup routine anywhere**. Every `INSERT` is fine, but any query that filters by `entity_type`, `entity_id`, `action`, or `created_at` does a full table scan, and the table grows unbounded.
**Impact**: Degrades over time; the audit log becomes a liability instead of an asset.

### 🟡 P2 — `PERF-2`: No `busy_timeout` / WAL checkpoint / memory tuning
Only two PRAGMAs are set at init (`journal_mode = WAL`, `foreign_keys = ON`). Missing:
- `PRAGMA busy_timeout` — default is 0; any concurrent access (e.g. sync push running while UI writes) can throw `SQLITE_BUSY` immediately instead of waiting.
- `PRAGMA wal_autocheckpoint` — default 1000 pages is usually fine but should be a deliberate choice.
- `PRAGMA synchronous` — WAL default is `FULL`; `NORMAL` is the standard WAL pairing and ~2× faster for the same durability guarantee on commit.
- `PRAGMA mmap_size`, `PRAGMA cache_size` — unset.

**Impact**: `SQLITE_BUSY` failures on the long-running push cycles (which can hold the DB during batch commits); slower-than-necessary commits.

### 🟡 P2 — `PERF-3`: Push path marks outbox rows sent one-by-one, outside a transaction
`markEntrySent` (`engine.js:1038`) runs **four separate `UPDATE` statements** (`sync_outbox`, `sync_id_map` version bump, `sync_id_map` ancestor, `sync_conflicts` resolve) — none wrapped in a transaction. After a successful Firestore batch commit (`engine.js:1827`), each item in the batch calls `markEntrySent` individually (`engine.js:1832`). A crash between the Firestore commit and the local marking, or between the four local UPDATEs, leaves the system in a state where remote has the data but local thinks it's still pending → **duplicate push on next cycle**.
**Impact**: Idempotency relies entirely on Firestore merge semantics; local bookkeeping can desync.

### 🟢 P3 — `PERF-4`: 68 `SELECT *` usages
Most are on single-row config lookups (`SELECT * FROM sync_config WHERE id = 1`, `SELECT * FROM users WHERE id = ?`) — harmless. A few pull full `users` rows in auth hot paths, which is acceptable given small user counts.
**Impact**: Negligible at current scale; worth pruning if `users` grows security-sensitive columns.

### 🟢 P3 — `PERF-5`: `sync_snapshots` has only point-deletes
`snapshot.js:82` deletes a snapshot row when re-snapshotting that exact row, but there's no bulk purge of stale snapshots for rows no longer in `sync_id_map`. Low volume today.
**Impact**: Minor; could accumulate orphan snapshot rows over time.

---

## 6. Recommendations (prioritized)

| # | Sev | Finding | Recommended action | Effort | Risk if unaddressed |
|---|-----|---------|--------------------|--------|---------------------|
| R1 | P1 | `system_logs` unindexed + no retention (`PERF-1`) | Add indexes on `(entity_type, created_at)` and `(action, created_at)`; add a daily/weekly retention routine (e.g. keep 90 days, configurable in `settings`). | S | Audit log degrades performance and grows without bound. |
| R2 | P1 | No `ON DELETE` behavior on FKs (`INT-1`) | Decide a policy per parent: students → `CASCADE` or `SET NULL` on child academic rows; teachers → block delete while referenced, or `SET NULL`. Then rebuild affected tables in a migration (SQLite needs table rebuild to add `ON DELETE`). Run `PRAGMA foreign_key_check` after to report orphans. | M | Silent orphans accumulate; delete operations fail opaquely. |
| R3 | P1 | Missing FKs on logical teacher/student refs (`INT-2`) | Add real FKs (with the chosen `ON DELETE` policy from R2) to `grades.teacher_id`, `tests.teacher_id`, `staff_attendance.teacher_id`, `compensation_tracking.teacher_id`, `support_sessions.teacher_id`. Requires the same rebuild pattern. Treat `student_profile_data.student_id` separately (it's a documented dead column — either drop it or repopulate it in a supervised backfill). | M | Teacher deletion/merge leaves dangling references in 5 tables. |
| R4 | P2 | No `busy_timeout` / WAL tuning (`PERF-2`) | Set `PRAGMA busy_timeout = 5000`, `PRAGMA synchronous = NORMAL`, and make `wal_autocheckpoint` explicit in `init.js`. | S | Intermittent `SQLITE_BUSY` errors during sync; slower commits. |
| R5 | P2 | Push marks outbox sent outside a transaction (`PERF-3`) | Wrap the per-item `markEntrySent` (and its 4 UPDATEs) in a `db.transaction()`, and batch-mark whole committed Firestore chunks in one transaction. | S | Crash mid-batch desyncs local outbox vs. remote → duplicate pushes. |
| R6 | P2 | Duplicate table defs outside `main/db/` (`INT-3`) | Move `notifications` and `school_identity` definitions to live only in migrations; have `notifications/store.js` and `reports/identity.js` call a shared `ensure*Schema()` instead of re-declaring. | S | Schema drift across modules. |
| R7 | P2 | Migration version-key scheme inconsistent (`INT-4`) | Adopt the `YYYY-MM-NNN-slug` format exclusively; add a dev-time assertion (or lint check) that `version` values are unique and monotonic. Reserve the bare-date form for nothing. | S | Silent migration skipping on collision. |
| R8 | P3 | Loose date/timestamp typing (`INT-5`) | Standardize on `DATETIME DEFAULT CURRENT_TIMESTAMP` for new tables. For existing mixed tables, document the format per table; add helper formatters in a `db/time.js` rather than rewriting historical data. | S | Cross-table temporal queries are error-prone. |
| R9 | P3 | Nullable required FK columns (`INT-6`) | Fold into R2/R3 when those tables are rebuilt — add `NOT NULL` where the column is the real link. | — (part of R2/R3) | Half-populated rows; reliance on denormalized name/code strings. |
| R10 | P3 | `sync_snapshots` no bulk purge (`PERF-5`) | Add a periodic delete of snapshot rows whose `row_sync_id` is no longer in `sync_id_map`, alongside the existing outbox cleanup. | S | Orphan snapshot rows accumulate slowly. |

**Suggested execution order**: R1 (quick, high value) → R4 (quick, prevents a class of bugs) → R6 + R7 (cheap structural cleanup) → R2 + R3 together (one table-rebuild migration campaign, done with backups) → R5 → R8/R10 as opportunity allows.

---

## 7. Appendix A — Index Inventory

### Base indexes (`schema.js`)
| Index | Table | Columns | Type |
|-------|-------|---------|------|
| `idx_students_year` | students | `(school_year)` | normal |
| `idx_students_code_year` | students | `(code, school_year)` | normal |
| `idx_grades_year_code` | grades | `(school_year, student_code)` | normal |
| `idx_grades_year_subject` | grades | `(school_year, subject)` | normal |
| `idx_grades_year_teacher` | grades | `(school_year, teacher_id)` | normal |
| `idx_absences_year_code` | absences | `(school_year, student_code)` | normal |
| `idx_absences_year_month` | absences | `(school_year, month)` | normal |
| `idx_teachers_year` | teachers | `(school_year)` | normal |
| `idx_teachers_ppr_year` | teachers | `(ppr, school_year)` | unique, partial (`ppr != ''`) |
| `idx_teacher_aliases_lookup` | teacher_aliases | `(school_year, alias_normalized)` | normal |
| `idx_teacher_aliases_teacher` | teacher_aliases | `(teacher_id, school_year)` | normal |
| `idx_correspondence_year` | correspondence | `(school_year)` | normal |
| `idx_staff_attendance_year` | staff_attendance | `(school_year)` | normal |
| `idx_staff_attendance_date` | staff_attendance | `(attendance_date, school_year)` | normal |
| `uidx_staff_attendance_absence` | staff_attendance | `(attendance_date, school_year, COALESCE(teacher_id,-1), COALESCE(teacher_name,''), COALESCE(absence_period,'full_day'))` | unique, partial (`type='absence'`) |
| `uidx_staff_attendance_late` | staff_attendance | `(attendance_date, school_year, COALESCE(teacher_id,-1), COALESCE(teacher_name,''))` | unique, partial (`type='late'`) |
| `idx_tests_year_teacher` | tests | `(school_year, teacher_id)` | normal |
| `uidx_users_firebase_uid` | users | `(firebase_uid)` | unique, partial (`trim != ''`) |
| `idx_users_auth_source` | users | `(auth_source)` | normal |
| `idx_users_invite_status` | users | `(invite_status)` | normal |
| `idx_owner_sync_outbox_status_id` | owner_sync_outbox | `(status, id)` | normal |
| `idx_sync_outbox_status_id` | sync_outbox | `(status, id)` | normal |
| `idx_sync_outbox_created_at` | sync_outbox | `(created_at)` | normal |
| `idx_page_visibility_visible` | page_visibility | `(is_visible)` | normal |
| `idx_device_otp_massar_status` | device_otp | `(massar_code, status)` | normal |
| `idx_linked_devices_status` | linked_devices | `(status)` | normal |

### Migration-added indexes
| Index | Table | Columns | Type | Mig |
|-------|-------|---------|------|-----|
| `idx_notifications_created` | notifications | `(created_at)` | normal | 015 |
| `idx_notifications_read` | notifications | `(read)` | normal | 015 |
| `idx_grades_unique` | grades | `(student_code, subject, semester, school_year)` | unique | 016/018 |
| `idx_absences_unique` | absences | `(student_code, month, school_year, absence_type)` | unique | 017/018 |
| `idx_school_events_date` | school_events | `(event_date, school_year)` | normal | 026 |
| `idx_compensation_date_year` | compensation_tracking | `(absence_date, school_year)` | normal | 027 |
| `idx_compensation_pending` | compensation_tracking | `(compensated, school_year)` | normal | 027 |
| `idx_compensation_year_teacher` | compensation_tracking | `(school_year, teacher_id)` | normal | 028 |
| `idx_sync_conflicts_status` | sync_conflicts | `(status, created_at)` | normal | 032 |
| `idx_sync_conflicts_row` | sync_conflicts | `(table_name, row_sync_id)` | normal | 032 |
| `idx_sync_outbox_conflict_check` | sync_outbox | `(status, table_name, row_sync_id)` | normal | 032 |
| `idx_sync_snapshots_table` | sync_snapshots | `(table_name)` | normal | 033 |
| `idx_support_sessions_year` | support_sessions | `(school_year)` | normal | 039 |
| `idx_support_sessions_teacher` | support_sessions | `(teacher_id, school_year)` | normal | 039 |
| `idx_support_sessions_unique` | support_sessions | `(teacher_id, session_date, time_from, section, school_year)` | unique | 039b |
| `idx_name_aliases_lookup` | name_aliases | `(entity_type, alias_normalized, school_year)` | normal | 042 |
| `idx_system_tags_date` | system_tags | `(tag_date, school_year)` | normal | 045/047/049/052 |
| `idx_system_tags_entity` | system_tags | `(entity_type, entity_name, school_year)` | normal | 045/047/049/052 |
| `uidx_system_tags_standalone` | system_tags | `(tag_date, entity_type, COALESCE(entity_id,-1), entity_name, tag_key, school_year)` | unique, partial (`note_group IS NULL`) | 047/049/052 |
| `uidx_system_tags_note_entity` | system_tags | `(note_group, entity_type, COALESCE(entity_id,-1), entity_name)` | unique, partial (`note_group IS NOT NULL`) | 047/049/052 |
| `idx_student_profile_student` | student_profile_data | `(student_code, school_year)` | normal | 048 |
| `idx_inspectors_year` | inspectors | `(school_year)` | normal | 050 |
| `idx_inspectors_specialty` | inspectors | `(school_year, specialty)` | normal | 050 |
| `idx_exam_invitations_year` | exam_invitations | `(school_year)` | normal | 058 |
| `idx_exam_attendance_session` | exam_attendance | `(school_year, session_key)` | normal | 059 |
| `idx_exam_attendance_teacher` | exam_attendance | `(school_year, teacher_name)` | normal | 059 |
| `idx_exams_year_date` | exams | `(school_year, exam_date)` | normal | 060 |
| `idx_exam_proctors_year` | exam_proctors | `(school_year)` | normal | 060 |
| `idx_exam_rooms_year` | exam_rooms | `(school_year)` | normal | 060 |
| `idx_exam_invitations_year_teacher` | exam_invitations | `(school_year, teacher_name)` | normal | 060 |
| `idx_teacher_absences_year` | teacher_absences | `(school_year)` | normal | 060 |
| `idx_exam_config_year` | exam_config_data | `(school_year)` | normal | 061 |
| `idx_student_risk_snapshot_year_level` | student_risk_snapshot | `(school_year, risk_level)` | normal | 062 |

**Tables with no index (beyond implicit rowid PK)**: `settings`, `system_logs`, `school_identity`, `exam_config_data`* (has `idx_exam_config_year`), `schema_migrations` (PK on `version`), `app_meta` (PK on `key`), `timetable_data` (unique on `school_year`). Of these, only **`system_logs`** is both frequently-written and frequently-scanned.

---

## 8. Appendix B — Migration List (66 total)

```
2026-02-001-grades-section
2026-02-002-students-registration-type
2026-02-003-teacher-absences-justified
2026-02-004-exam-proctors-date
2026-02-005-exam-proctors-session
2026-02-006-grades-teacher-name
2026-02-007-grades-level
2026-02-008-licensing-schema
2026-02-009-users-password-auth
2026-02-010-owner-sync-schema
2026-02-011-owner-sync-token-split
2026-02-012-page-visibility-controls
2026-02-013-students-birth-place
2026-03-014-school-identity
2026-03-015-notifications-table
2026-03-016-grades-unique-constraint
2026-03-017-absences-unique-constraint
2026-03-018-repair-unique-constraints
2026-03-019-students-unique-constraint-year      [recordsVersionInternally]
2026-03-020-staff-attendance-teacher-name
2026-03-021-staff-attendance-subject
2026-03-022-user-pin-support
2026-03-023-teachers-admin-columns
2026-03-024-teachers-specialty-subject
2026-03-025-teachers-ministry-fields
2026-03-026-school-events-table
2026-03-027-compensation-tracking
2026-03-028-teacher-identity-foundation
2026-03-029-teachers-surplus-flag
2026-03-030-sync-foundation
2026-03-031-push-engine-config
2026-03-032-pull-engine
2026-03-033-integrity-conflict-resolution
2026-03-034-sync-config-license-key
2026-03-035-institution-device-linking
2026-03-036-sync-app-defaults
2026-03-038-massar-schoolid-sync
2026-03-039-page-visibility-seed-all
2026-03-29-support-sessions                        ← bare-date format
2026-03-29-support-sessions-unique                 ← bare-date format
2026-04-040-staff-attendance-absence-period
2026-04-041-compensation-tracking-reason-notes
2026-04-042-name-aliases
2026-04-044-timetable-data-table
2026-04-045-system-tags
2026-04-046-system-tags-notes
2026-04-047-system-tags-fix-unique
2026-04-048-student-profile-data
2026-04-049-system-tags-allow-general
2026-04-15-role-hierarchy                         ← bare-date format
2026-04-18-firebase-sync-config                   ← bare-date format
2026-04-19-backfill-firebase-functions-url        ← bare-date format
2026-04-22-firebase-onboarding-auth-schema        ← bare-date format
2026-04-050-inspectors-table
2026-04-051-normalize-subject-names
2026-04-052-system-tags-allow-inspector-subject
2026-04-053-staff-attendance-unique
2026-04-054-sync-credential-store
2026-05-055-exam-proctors-extra-columns
2026-05-056-exam-proctors-workplace
2026-05-057-exam-proctors-name-fr
2026-05-058-exam-invitations
2026-05-059-exam-attendance
2026-05-060-exam-indexes
2026-05-061-exam-config-data
2026-05-062-student-risk-snapshot
2026-05-063-massar-code-column
```

(Gaps in numbering — `037`, `043`, `054`→`055` jump — reflect reserved/collapsed migrations; no functional impact.)

---

*End of analysis. No code changes were made; this document is observational. Recommended fixes are listed in §6 for separate planning and execution.*

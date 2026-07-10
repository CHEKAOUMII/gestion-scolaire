## Plan: Database Schema Analysis Report

### Deliverable
Create **`docs/reviews/2026-07-07-database-schema-analysis.md`** — a comprehensive schema evaluation covering tables, columns, constraints, relationships, and a prioritized recommendation list. No code changes; this is an analysis document only.

### Scope of the analysis (already complete — gathered in this session)
All schema is defined in two files and fully read:
- `main/db/schema.js` (735 lines) — base `createTables()` + `ensure*Schema()` helpers
- `main/db/migrations.js` (1364 lines) — 66 sequential migrations + runner
- `main/db/init.js` — DB open + PRAGMAs (WAL, foreign_keys)
- Query/sync patterns: `main/sync/engine.js`, `capture.js`, `snapshot.js`, IPC handlers

~35 tables catalogued across domains: students/grades/absences, teachers/identity, staff/exams, sync (outbox/id_map/conflicts/snapshots), licensing, institution/linking, page-visibility, system_tags, notifications, etc.

### Report structure
1. **Header** — date, scope, files analyzed, DB engine/version assumptions (Electron + better-sqlite3, WAL).
2. **Executive summary** — overall health verdict + top 5 issues in one paragraph.
3. **Schema inventory** — table-by-table summary grouped by domain (entity, columns count, PK, unique constraints, FKs, indexes present).
4. **Relationships map** — declared FKs vs. logical relationships missing FKs.
5. **Data integrity findings** (P0–P3 severity each):
   - **No `ON DELETE` clauses** on any of the 13 FKs (orphan rows on student/teacher/exam/license delete).
   - **Dangling logical FKs** — `grades.teacher_id`, `staff_attendance.teacher_id`, `tests.teacher_id`, `compensation_tracking.teacher_id`, `exam_proctors` (re-declared), `support_sessions.teacher_id` have no FK constraint at all despite migration 028 adding the column.
   - **`student_profile_data.student_id` declared NOT NULL but written as 0** (documented in migration 062 as known dead-column; real key is `student_code`).
   - **Duplicate schema definitions** — `notifications` (migration 015 vs `main/notifications/store.js`) and `school_identity` (migration 14 vs `main/reports/identity.js`) re-created in non-db modules — divergence risk.
   - **Migration versioning inconsistency** — mix of `MMM-NNN-...` and bare calendar dates (`2026-03-29-…`, `2026-04-15/18/19/22-…`); collision narrowly avoided (documented in migration 062 comment).
   - **`foreign_keys = ON` enabled but `PRAGMA foreign_key_check` never run** — undetected pre-existing orphans likely.
   - **Type discipline** — heavy use of `TEXT` for dates/dates (e.g. `school_year`, `birth_date`) with no `CHECK`; inconsistent timestamp formats (`CURRENT_TIMESTAMP` vs `strftime('%s','now')*1000` vs `datetime('now')`).
6. **Performance/scalability findings** (P0–P3 each):
   - **No `busy_timeout` / `cache_size` / `mmap_size` / `wal_checkpoint` tuning** — WAL enabled but un-tuned; risk of `SQLITE_BUSY` on long push cycles.
   - **`system_logs` has no index** and no retention routine → unbounded growth on the highest-write table.
   - **Push engine marks outbox rows sent one-by-one** (`markEntrySent` per item, line 1832/1629) outside a transaction even when batched to Firestore — partial-state window on crash.
   - **`sync_outbox` cleanup is interval-timer based** (`capture.js:722`, 7-day default) — good, but `sync_conflicts` cleanup only runs from `snapshot.js:91` (30-day) and `sync_snapshots` only deletes individual rows on update — check coverage.
   - **68 `SELECT *` usages** (mostly fine on small config tables, but flagged on `users`/`sync_config`).
   - **Positive**: pull-apply is wrapped in a single `db.transaction` (engine.js:3256); bulk IPC writes use `db.transaction`; good composite indexes on `school_year` + entity key for all hot tables.
7. **Recommendations table** — one row per finding: Severity | Finding | Recommended action | Effort (S/M/L) | Risk if unaddressed. Ordered P0→P3.
8. **Appendix** — full index inventory, full FK inventory, migration list.

### Out of scope
- Writing or applying any migration / PRAGMA / index changes.
- Modifying `firestore.rules` (cloud-side, separate concern).
- Refactoring query code.

### Output location
`docs/reviews/2026-07-07-database-schema-analysis.md` (matches the existing `docs/reviews/YYYY-MM-DD-*.md` convention seen in that folder).
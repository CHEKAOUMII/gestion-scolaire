# Database Schema Analysis Report

**Date:** 2026-07-15  
**Scope:** Full local SQLite schema (`main/db/schema.js`, `main/db/migrations.js`, `main/repos/*`)  
**Previous audit:** `docs/database-schema-audit.md` (pre-migration-065)  

---

## Executive Summary

The schema has matured considerably since the last audit. Migration **065** (FK ON DELETE rebuild) addressed the most critical structural issues — 15 tables were rebuilt with proper foreign keys and delete behaviours. Grades were migrated from `INSERT OR REPLACE` to `ON CONFLICT DO UPDATE`. Exam attendance and invitations now use `teacher_id`-based uniqueness.

However, **10 open issues** remain across five categories: data model ambiguity, missing integrity constraints, JSON blob risk, index gaps, and pattern inconsistencies.

---

## ✅ What Has Been Fixed Since Last Audit

| # | Issue | Resolution |
|---|-------|-----------|
| 1 | FKs lacked ON DELETE behaviour | **065** — rebuilt 15 tables with `CASCADE`/`SET NULL` |
| 2 | `grades` used `INSERT OR REPLACE` (ID drift) | Now uses `ON CONFLICT DO UPDATE` in `main/repos/grades.js` |
| 3 | Exam invitations used `teacher_name` uniqueness | Now uses partial unique index on `teacher_id` with name fallback |
| 4 | Exam attendance used `teacher_name` uniqueness | Now uses partial unique index on `teacher_id` with name fallback |
| 5 | `compensation_tracking` joined without `school_year` | Addressed in migration + repo |
| 6 | `student_orientation` table missing | Added via migration **068** |
| 7 | `guidance` tab key not allowed in `student_profile_data` | Added via migration **067** |
| 8 | `page_role_access` table missing | Added via migration **066** |
| 9 | `exam_count_rules` table missing | Added via migration **066** |
| 10 | `notifications` schema was duplicated (migration vs store.js) | Consolidated to single source in `schema.js` |

---

## 🔴 High-Priority Issues

### H1. Absence model is ambiguous (event vs. aggregate)

**Problem:** The absences table has a hybrid personality:
- `saveOne()` does a plain `INSERT` (event semantics — can create duplicates)
- `saveBulk()` uses `ON CONFLICT(student_code, month, school_year, absence_type) DO UPDATE SET hours, days` (aggregate semantics — monthly summaries)
- Columns like `absence_date` and `reason` imply event-level data, but the unique constraint is monthly

**Risk:** Duplicate rows silently overwrite each other. Daily absence history can be lost. `absence_date` and `reason` are updated inconsistently — `saveBulk` doesn't touch them on conflict.

**Recommendation:** Choose one model:
- **Option A (recommended):** Split into an event table (`absence_events` with per-day rows, no UNIQUE on month) and keep `absences` as aggregated monthly summary computed from events.
- **Option B:** Replace `saveOne()`'s plain INSERT with `ON CONFLICT DO UPDATE` and drop `absence_date`/`reason` from the schema — making it explicitly a monthly aggregate table.

### H2. Student identity dual-key (student_id vs student_code)

**Problem:** Six tables reference students via both `student_id` (proper FK) and `student_code` (logical key):
- `grades`, `absences`, `correspondence`, `student_profile_data`, `student_risk_snapshot`, `student_orientation`

When a student's `code` changes (which happens in practice), code-based joins break silently. The FK only protects `student_id` references.

**Risk:** Reports join on `student_code` and miss rows, or join old code to new student. Profile data (stored keyed by `student_code`) detaches from the canonical student.

**Recommendation:** 
- Phase out `student_code` in favour of `student_id` in all tables
- Keep `student_code` as a denormalized display field only (not in UNIQUE constraints)
- For tables where `student_code` is the PK (`student_orientation`, `student_profile_data`), add a real `student_id` FK column and migrate to it

### H3. `INSERT OR REPLACE` still used in 3 places

**Problem:** The old audit flagged `grades` — which was fixed. But `settings` and `users` still use REPLACE:
- `main/ipc/settings-ipc.js:25` — `INSERT OR REPLACE INTO settings`
- `main/ipc/settings-ipc.js:32` — `INSERT OR REPLACE INTO settings`
- `main/repos/users.js:65` — `INSERT OR REPLACE INTO settings(key, value)`

For the `settings` table (TEXT key, TEXT value), the risk is lower because the PK is stable. But this pattern is inconsistent with the rest of the codebase and can reset `created_at` if that column is ever added.

**Recommendation:** Replace all three with `ON CONFLICT(key) DO UPDATE SET value = excluded.value`.

---

## 🟠 Medium-Priority Issues

### M1. Missing CHECK constraints on enum-like columns

**Problem:** Several columns behave as enums but are stored as free text with no validation:

| Table | Column | Current | Proposed CHECK |
|-------|--------|---------|---------------|
| `students` | `status` | free text | `CHECK(status IN ('active','dropout','expelled','not_enrolled','transferred_in'))` |
| `student_movements` | `movement_type` | free text | `CHECK(movement_type IN ('transfer','section_change','dropout','re_enrollment'))` |
| `staff_attendance` | `type` | free text | `CHECK(type IN ('absence','late'))` |
| `exam_attendance` | `role` | free text | `CHECK(role IN ('proctor','supervisor','invigilator','coordinator'))` |
| `support_sessions` | `attendance_status` | already CHECK'd | ✅ already done |
| `system_logs` | `action` | free text | Consider lookup table for known actions |

**Risk:** Data quality drifts over time — typos, Arabic variants, and legacy imports introduce values that break filters and reports.

### M2. `student_profile_data.student_id` is a dead column

**Problem:** Declared `INTEGER NOT NULL` but routinely written as `0`. The real key is `(student_code, school_year)`. Migration 062 explicitly documented the decision to leave it untouched.

**Risk:** Misleading schema — any developer reading it assumes `student_id` is a reliable FK when it isn't.

**Recommendation:** Either:
- Backfill real `student_id` values from `students.code` and enforce the FK, or
- Make it nullable with `ALTER TABLE` and document it as deprecated

### M3. Missing `school_year` indexes on 6 operational tables

**Problem:** These tables have a `school_year` column but no dedicated index on it:
- `student_files` — no `school_year` index
- `student_movements` — no `school_year` index
- `teacher_absences` — migration 060 added `idx_teacher_absences_year` ✅
- `exams` — migration 060 added `idx_exams_year_date` ✅
- `exam_proctors` — migration 060 added `idx_exam_proctors_year` ✅
- `exam_rooms` — migration 060 added `idx_exam_rooms_year` ✅

Actually, most of these were added in migration 060. Let me check more carefully what's missing.

**Re-checked:** Migration 060 added indexes for `exams`, `exam_proctors`, `exam_rooms`, `exam_invitations`, `teacher_absences`. So remaining without dedicated `school_year` index:

- `student_files` — no school_year index
- `student_movements` — no school_year index

These are small tables typically queried via a parent student, so the impact is low.

### M4. JSON blob tables lack queryability

**Problem:** Three tables store operational data as opaque JSON blobs:

| Table | JSON Column | Size Risk |
|-------|------------|-----------|
| `timetable_data` | `data_json` | Can be large (full timetable) |
| `exam_config_data` | `data_json` | Per-config-key, moderate |
| `student_profile_data` | `data_json` | Per-tab, moderate |
| `sync_conflicts` | Multiple TEXT JSON | Small |
| `sync_snapshots` | `checksum` | Fixed-size |

**Risk:** JSON columns cannot be indexed, queried with WHERE, or partially updated. For `timetable_data`, the full timetable is one JSON blob — any change rewrites the entire row. Sync conflict resolution requires reading/parsing the full blob.

**Recommendation:** 
- For `timetable_data` — consider normalising to `timetable_slots(day, period, teacher_id, section, subject, room, school_year)` when sync/reporting needs grow
- For `student_profile_data` — current IPC-level validation and size limits are acceptable for per-tab data
- For `exam_config_data` — acceptable as config storage

### M5. No FTS for Arabic name search

**Problem:** Student and teacher name search uses `LIKE '%term%'` which cannot use b-tree indexes. With hundreds or thousands of Arabic names, this becomes a full table scan.

**Recommendation:** Add SQLite FTS5 virtual tables for `students(full_name, code)` and `teachers(full_name, ppr)`:

```sql
CREATE VIRTUAL TABLE IF NOT EXISTS students_fts USING fts5(
    full_name, code, content='students', content_rowid='id'
);
```

This requires triggers to keep the FTS index in sync, but enables fast Arabic substring search via `MATCH`.

---

## 🟡 Minor / Cosmetic Issues

### C1. Inconsistent timestamp types

The codebase uses three different timestamp representations:

| Type | Used By | 
|------|---------|
| `DATETIME DEFAULT CURRENT_TIMESTAMP` | Most tables (SQLite ISO-8601 text) |
| `TEXT DEFAULT (datetime('now'))` | `support_sessions`, `name_aliases` |
| `INTEGER DEFAULT (strftime('%s','now') * 1000)` | `school_identity`, `notifications` |

**Recommendation:** Standardize on `DATETIME` (ISO-8601 text) for human-readability. Keep epoch ms only for `notifications` (where numeric sorting is needed).

### C2. `staff_attendance` unique index uses `COALESCE(teacher_id, -1)`

Sentinel value `-1` is used because SQLite partial indexes cannot reference the indexed column in a `WHERE teacher_id IS NOT NULL` clause for a multi-column unique index. This is a SQLite limitation, but `-1` is fragile — if a real teacher with `id = -1` is somehow created, collisions occur.

**Recommendation:** Document this as a known SQLite constraint trade-off. Consider splitting into two partial indexes (one for absence type, one for late type) which already exists, but the `-1` sentinel remains in the composite column expression.

### C3. `teachers` has 30+ columns — normalization candidate

`teachers` holds administrative fields (hire_date, echelon, titularization) alongside personal fields (address, phone, marital_status). For a school managing many teachers over many years, some of these are per-year (grade, echelon, function_title) while others are permanent (cin, birth_date).

**Recommendation:** Consider splitting into `teacher_base` (permanent) and `teacher_year_info` (per-school-year) when the schema next undergoes major revision.

### C4. No DB-level encryption

SQLite has no native encryption. Student PII (birth dates, addresses, phone numbers, parent names) is stored in plaintext. The DB file at `app.getPath('userData')/gestion-scolaire.db` is readable by anyone with file system access.

**Recommendation:** Evaluate `better-sqlite3` encryption extensions or SQLite's `sqlcipher` for production deployments handling sensitive student data. This is a legal/privacy compliance issue (GDPR, Moroccan law 09-08).

---

## Best Practice Compliance Matrix

| Practice | Status | Notes |
|----------|--------|-------|
| Primary keys on all tables | ✅ | All tables have explicit PK |
| Foreign keys with ON DELETE | ✅ | Migration 065 — all FKs have CASCADE or SET NULL |
| `school_year` scoping | ✅ | All operational tables have school_year |
| Unique constraints on natural keys | ✅ | Students, grades, absences, teachers, etc. |
| WAL mode + busy_timeout | ✅ | Set in `init.js` |
| Migration versioning | ✅ | `schema_migrations` table + sequential version strings |
| Idempotent migrations | ✅ | `ensureColumn()` + `CREATE TABLE IF NOT EXISTS` |
| `ON CONFLICT DO UPDATE` vs `INSERT OR REPLACE` | ⚠️ | Fixed for grades; 3 REPLACE remain in settings/users |
| CHECK constraints on enums | ⚠️ | Only `support_sessions`, `exam_attendance`, `system_tags`, `student_profile_data` |
| Consistent timestamp types | ❌ | 3 different timestamp formats |
| FTS for text search | ❌ | No FTS tables |
| DB encryption | ❌ | Plaintext SQLite file |
| Trigger-based audit | ❌ | `system_logs` is app-level, not DB trigger |
| `updated_at` auto-update | ❌ | No triggers — relies on app code |
| Composite indexes matching query patterns | ⚠️ | Good coverage but gaps in student listing + absence filtering |

---

## Recommended Action Plan

### Phase 1 — Safety (immediate)
| Priority | Action | Effort |
|----------|--------|--------|
| H3 | Replace `INSERT OR REPLACE` in `settings-ipc.js` + `users.js` with `ON CONFLICT DO UPDATE` | 15 min |
| H1 | Choose absence data model (event vs aggregate) and align code | 1-2 days |

### Phase 2 — Integrity (next sprint)
| Priority | Action | Effort |
|----------|--------|--------|
| H2 | Migrate student-code-keyed tables to `student_id` as primary FK | 2-3 days |
| M1 | Add CHECK constraints on enum columns | 1 day |
| M4 | Add indexes for missing `school_year` on `student_files`, `student_movements` | 30 min |

### Phase 3 — Hardening (next release)
| Priority | Action | Effort |
|----------|--------|--------|
| M5 | Add FTS5 indexes for Arabic search on students + teachers | 1 day |
| M2 | Backfill or nullable `student_profile_data.student_id` | 1 day |
| M4 | Consider normalising high-growth JSON blobs | 2-3 days |

### Phase 4 — Scalability (future)
| Priority | Action | Effort |
|----------|--------|--------|
| C1 | Standardize timestamp types across all tables | 1 day |
| C3 | Split `teachers` into base + yearly info if perf becomes an issue | 2-3 days |
| C4 | Evaluate SQLCipher or `better-sqlite3` encryption for student PII | 2-5 days |
| C2 | Document `staff_attendance` sentinel pattern | 15 min |

---

## What's Working Well

Despite the open issues, the schema has several strong points worth preserving:

- **Every operational table has `school_year`** — This is the correct scoping for a yearly academic cycle
- **Migration sequence is clean** — Monotonically increasing `YYYY-MM-NNN` versioning prevents silent skips
- **`ensureColumn()` is idempotent** — Safe for repeated runs across versions
- **Teacher identity resolution** — `teacher_aliases` + `name_aliases` + `resolveTeacherIdentity` form a robust fuzzy-match system
- **Sync outbox + conflict resolution** — Clean separation of sync infrastructure from domain tables
- **Repo pattern** — SQL lives in `repos/*`, IPC handlers do auth/validation only. This is the correct layering
- **Partial unique indexes** — Used effectively for conditional uniqueness (exam invitations, attendance, system_tags)

---

*Built on the foundation of `docs/database-schema-audit.md`. Verified against current migrations up to 068.*

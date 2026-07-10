# Database Schema Audit

## Overview

This audit reviews the local SQLite schema and database usage in the school management application. The reviewed areas include:

- `main/db/schema.js`
- `main/db/migrations.js`
- `main/db/init.js`
- `main/ipc/students.js`
- `main/ipc/absences.js`
- `main/ipc/staff.js`
- `main/ipc/staffAttendance.js`
- `main/ipc/exams.js`
- `main/ipc/schoolOps.js`
- `main/ipc/exam-config-data.js`
- `main/ipc/timetable-data.js`
- `main/sync/capture.js`
- `main/firebase/collections.js`

The app uses `better-sqlite3`, enables WAL mode, and turns on foreign keys during database initialization. Most operational tables are scoped by `school_year`, which matches the yearly workflow of Moroccan high-school administration.

## Strengths

- SQLite is initialized with `journal_mode = WAL` and `foreign_keys = ON` in `main/db/init.js`.
- Core uniqueness is partially enforced for students, grades, absences, teachers, staff attendance, exam config data, and other operational tables.
- Most high-volume reads filter by `school_year`.
- Several useful indexes already exist for year-based filtering, teacher aliases, sync queues, notifications, exam data, and staff attendance.
- Bulk import paths generally use transactions or upserts.
- Teacher identity handling has improved through `teacher_aliases`, `name_aliases`, and `resolveTeacherIdentity`.
- JSON profile data in `student_profile_data` has field allowlisting and size limits in `main/ipc/students.js`.

## High-priority findings

### 1. Student relationships are inconsistent

The schema mixes `student_id` and `student_code` across multiple tables:

- `grades`
- `absences`
- `correspondence`
- `student_profile_data`
- `student_risk_snapshot`

This creates integrity risk when a student is deleted, when a code changes, or when a row is imported without a valid `student_id`.

**Risks**

- Student deletes can fail because of foreign-key references.
- Code-based tables can keep orphaned rows after a student is deleted.
- Updating `students.code` or `students.school_year` can desynchronize dependent rows.
- Reports may join different versions of the same student identity.

**Recommendation**

Choose one canonical relationship model:

1. Prefer `student_id` internally and keep `student_code` as display/import data; or
2. Use `(student_code, school_year)` consistently and add composite foreign keys where SQLite constraints allow it.

Also extend student delete/year-delete flows to include profile and risk tables:

- `student_profile_data`
- `student_risk_snapshot`

### 2. Absences mix event-level and monthly aggregate models

`absences` stores event-like fields such as `absence_date` and `reason`, but uniqueness is enforced by a monthly aggregate key:

```sql
(student_code, month, school_year, absence_type)
```

This means multiple same-type absences for the same student in the same month cannot be represented safely as separate dated events.

**Risks**

- Manual absence saves and bulk absence imports have different semantics.
- Multiple events in one month/type can conflict.
- `absence_date`, `reason`, and `student_id` can become stale after monthly upserts.
- Day-level absence history can be lost.

**Recommendation**

Split absence storage into two concepts:

```sql
absence_events (
  id,
  student_id,
  student_code,
  absence_date,
  absence_type,
  hours,
  reason,
  school_year
)
```

Then compute monthly summaries from events, or store them in a separate summary table. If the current table is intended to be monthly-only, remove event-level assumptions from IPC handlers and update all canonical fields on conflict.

### 3. Grades use `INSERT OR REPLACE`

`grades:save` and `grades:saveBulk` use `INSERT OR REPLACE`.

In SQLite, `REPLACE` deletes the existing row and inserts a new one. That can change row identity.

**Risks**

- `grades.id` can change unexpectedly.
- `created_at` can reset.
- Sync/local ID mappings can break.
- Future foreign-key relationships to `grades` would be unsafe.

**Recommendation**

Replace `INSERT OR REPLACE` with explicit upsert:

```sql
INSERT INTO grades (
  student_id,
  student_code,
  teacher_id,
  subject,
  grade,
  semester,
  teacher_name,
  level,
  section,
  school_year
)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
ON CONFLICT(student_code, subject, semester, school_year)
DO UPDATE SET
  student_id = excluded.student_id,
  teacher_id = excluded.teacher_id,
  grade = excluded.grade,
  teacher_name = excluded.teacher_name,
  level = excluded.level,
  section = excluded.section;
```

### 4. Teacher identity remains partially ambiguous

The schema includes stable teacher identifiers such as `id`, `ppr`, and `cin`, but many tables still duplicate free-text `teacher_name`.

Affected tables include:

- `grades`
- `tests`
- `staff_attendance`
- `exam_proctors`
- `compensation_tracking`
- `exam_invitations`
- `exam_attendance`
- `support_sessions`

**Risks**

- Teacher renames can leave stale names in dependent tables.
- Two teachers with the same display name can be merged incorrectly.
- Ambiguous aliases can force fallback to free-text names instead of `teacher_id`.

**Recommendation**

Prefer stable identifiers in operational constraints and joins:

- `teacher_id`
- `ppr`
- `cin`

Use `teacher_name` as a display snapshot only when historical preservation is intentional. If duplicate teacher names are possible, require explicit conflict resolution instead of automatic name matching.

### 5. Compensation joins should include school year

Compensation queries join `compensation_tracking` to `staff_attendance` by date and teacher. They should also include `school_year` in the join.

**Risk**

The same teacher and date can exist across different school years, causing compensation records to display or inherit the wrong `reason` or `notes`.

**Recommendation**

Add this condition to compensation/staff-attendance joins:

```sql
AND sa.school_year = c.school_year
```

Also consider supporting indexes:

```sql
CREATE INDEX idx_staff_attendance_year_date_type_teacher
ON staff_attendance(school_year, attendance_date, type, teacher_id);

CREATE INDEX idx_staff_attendance_year_date_type_name
ON staff_attendance(school_year, attendance_date, type, teacher_name);
```

### 6. Exam attendance and invitations are name-based

`exam_invitations` and `exam_attendance` use `teacher_name` in uniqueness constraints.

**Risks**

- Renamed teachers can create duplicate rows.
- Two teachers with the same name can collide.
- Attendance and invitation data can drift from canonical teacher records.

**Recommendation**

Prefer partial unique indexes using `teacher_id` when available, with name fallback only for unresolved rows:

```sql
CREATE UNIQUE INDEX uidx_exam_attendance_teacher_id
ON exam_attendance(school_year, session_key, teacher_id)
WHERE teacher_id IS NOT NULL;

CREATE UNIQUE INDEX uidx_exam_attendance_teacher_name
ON exam_attendance(school_year, session_key, teacher_name)
WHERE teacher_id IS NULL;
```

Apply the same principle to `exam_invitations`.

## Data redundancy risks

| Redundant data | Current locations | Risk |
|---|---|---|
| `student_id` + `student_code` | `grades`, `absences`, `correspondence`, profile/risk tables | Student updates can desynchronize dependent rows. |
| `teacher_id` + `teacher_name` | Grades, tests, staff attendance, exams, compensation, support sessions | Renames and duplicate names can corrupt reports. |
| Repeated `section` values | Students, grades, compensation, support sessions | Student movement can leave stale section data. |
| Copied exam proctor teacher fields | `exam_proctors` | Imported data may drift from canonical teacher data. |
| Operational JSON blobs | `timetable_data`, `exam_config_data`, `student_profile_data` | Hard to validate, query, partially update, and sync. |

## Constraints and data integrity recommendations

### Add or tighten `CHECK` constraints

Several columns behave like enums but are stored as free text.

Candidates for `CHECK` constraints or lookup tables:

- `students.status`
- `student_movements.movement_type`
- `staff_attendance.type`
- `exam_attendance.role`
- `exam_attendance.status`
- `support_sessions.attendance_status`

Example:

```sql
CHECK(status IN ('active','dropout','expelled','not_enrolled','transferred_in'))
```

Also harmonize vocabulary in code and data. For example, avoid mixing terms such as `expelled` and `expulsion` unless both have distinct meanings.

### Avoid misleading relational columns

`student_profile_data.student_id` is declared as required but may be written as `0`. This makes the column look relational while not being trustworthy.

Recommended options:

1. Backfill real `student_id` values and enforce integrity; or
2. Make the column nullable or remove/deprecate it, treating `(student_code, school_year)` as the true key.

## Performance and index recommendations

The schema already has useful indexes, especially around `school_year`. The following indexes should be considered after checking `EXPLAIN QUERY PLAN` with real school data.

### Student listing and filtering

```sql
CREATE INDEX idx_students_year_section_name
ON students(school_year, section, full_name);
```

```sql
CREATE INDEX idx_students_year_status_section_name
ON students(school_year, status, section, full_name);
```

### Absence lookups and reports

```sql
CREATE INDEX idx_absences_student_year_date
ON absences(student_id, school_year, absence_date);
```

```sql
CREATE INDEX idx_absences_year_date
ON absences(school_year, absence_date);
```

### Exam proctor deletes and joins

```sql
CREATE INDEX idx_exam_proctors_exam_id
ON exam_proctors(exam_id);
```

### Tests by year/date

```sql
CREATE INDEX idx_tests_year_date
ON tests(school_year, test_date);
```

### Staff attendance listing

```sql
CREATE INDEX idx_staff_attendance_year_date_created
ON staff_attendance(school_year, attendance_date DESC, created_at DESC);
```

### Support sessions filtering

```sql
CREATE INDEX idx_support_sessions_year_section_subject_date
ON support_sessions(school_year, section, subject, session_date);
```

### Search performance

Queries using `%term%` cannot use normal b-tree indexes effectively. For Arabic name/code search at scale, consider SQLite FTS.

## JSON blob scalability

JSON is acceptable for small UI configuration, but risky for operational datasets that need indexing, reporting, partial updates, or row-level sync.

Current JSON-backed areas include:

- `timetable_data.data_json`
- `exam_config_data.data_json`
- `student_profile_data.data_json`

`student_profile_data` has useful IPC-level validation and a size limit. `timetable_data` and large exam config keys should be monitored as data volume grows.

**Recommendation**

Keep JSON for small config and preferences. Normalize high-growth operational data when it needs reporting, partial updates, search, or conflict resolution.

Possible future normalized tables:

- `exam_sessions`
- `exam_candidates`
- `exam_room_assignments`
- `exam_distribution_rows`
- `timetable_slots`

## Sync considerations

`main/sync/capture.js` captures many operational tables. Any schema change should preserve stable row identity and sync document IDs.

Specific risks to verify:

- `main/firebase/collections.js` should match actual local table columns.
- Tables captured for sync should either have correct collection mappings or be intentionally excluded.
- Avoid `INSERT OR REPLACE` for synced rows because it can change local row IDs.

## Recommended action plan

### Phase 1 — Integrity fixes

1. Replace grade `INSERT OR REPLACE` with explicit `ON CONFLICT DO UPDATE`.
2. Add `school_year` to compensation/staff-attendance joins.
3. Extend student delete/year-delete logic to profile and risk tables.
4. Decide whether absences are event-level or monthly aggregates.

### Phase 2 — Relationship cleanup

1. Choose the canonical student key strategy.
2. Backfill or remove unreliable `student_id` fields in profile/risk tables.
3. Tighten teacher alias conflict handling.
4. Move exam attendance/invitation uniqueness toward `teacher_id`.

### Phase 3 — Performance hardening

1. Add targeted composite indexes.
2. Run `EXPLAIN QUERY PLAN` on real school datasets.
3. Add SQLite FTS for Arabic name/code search if needed.

### Phase 4 — Scalability

1. Normalize large exam/timetable JSON data where needed.
2. Add schema validation and size limits for remaining JSON config.
3. Preserve sync IDs when migrating existing tables.

## Bottom line

The schema is usable and already has thoughtful migrations, but its biggest long-term risks are mixed identity models, free-text name joins, ambiguous absence semantics, and operational JSON blobs. Fixing these areas will improve data integrity, reduce redundancy, and make performance and sync behavior more predictable.

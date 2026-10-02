# Pencil2 database schema — analysis & best-practices report

**Subject:** `main/db/schema.js` + `main/db/migrations.js` (SQLite, better-sqlite3, WAL mode)
**Scope:** 53 tables across 12 domains (students, faculty, exams, licensing, sync engine, etc.)
**Method:** full structural review of the schema doc, cross-checked against current SQLite and offline-sync design guidance (sources listed at the end).

---

## 1. Executive summary

The schema is well beyond "just make it work" — it shows real design intent: differentiated delete behavior per relationship, partial unique indexes for optional foreign keys, a versioned outbox/conflict sync engine, and singleton config tables done the right way. Those are not beginner patterns.

The issues found are mostly consistency and hardening gaps rather than fundamental flaws: a handful of foreign-key columns used in `ON DELETE CASCADE` aren't actually indexed, one linkage strategy (FK vs. code-only) is applied unevenly across otherwise-similar student tables, timestamps are stored in three different formats, and some longer-lived secrets sit in plaintext columns. None of this requires a rewrite — it's a punch list.

---

## 2. Architecture overview

| Domain | Tables | Pattern |
|---|---|---|
| Student core | `students` + 6 cascade-linked children | Hub-and-spoke, `ON DELETE CASCADE` |
| Student extended | `student_profile_data`, `student_orientation` | Linked by `student_code` only, **no FK** |
| Faculty | `teachers` + 8 `SET NULL`-linked tables, 2 cascade-linked | Hub-and-spoke, mixed delete policy |
| Exams | `exams`, `exam_proctors`, `exam_rooms`, `exam_invitations`, `exam_attendance`, `exam_config_data`, `exam_count_rules`, `tests` | Partial hub, mostly independent lookup tables |
| Licensing | `license_plans` → `licenses` → `license_activations`/`license_events` | Clean 3-level hierarchy |
| Sync engine | `sync_outbox`, `sync_id_map`, `sync_pull_state`, `sync_conflicts`, `sync_snapshots`, `sync_config` | Outbox pattern + versioned conflict log |
| Owner sync | `owner_sync_config`, `owner_sync_outbox` | Same pattern, separate channel |
| Config/lookup | `settings`, `app_meta`, `page_visibility`, `page_role_access`, `school_identity`, `institution_config` | Key-value / singleton |
| Tags & logs | `system_tags`, `system_logs`, `name_aliases`, `inspectors`, `notifications` | Polymorphic references, no FK |

Roughly 45% of the 53 tables (sync internals, config, logging, licensing internals) are intentionally standalone — that's appropriate for their role, not a gap.

---

## 3. What's working well

**Delete policy matches data lifecycle, not just table shape.** Deleting a `student` cascades — the whole academic record disappears with them, which is correct for GDPR/erasure-style requests. Deleting a `teacher` mostly sets `teacher_id` to `NULL` on `grades`, `tests`, `staff_attendance`, `exam_proctors`, etc. — the *record* of what happened survives even if the person who did it is gone, which is exactly right for an audit-relevant history. Only `teacher_aliases` and `teacher_absences` cascade, because those really are the teacher's own data. This distinction — cascade for "belongs to," set-null for "was involved in" — is a deliberate, correct call that a lot of schemas get wrong by cascading everything.

**Partial unique indexes for optional foreign keys.** `exam_attendance`, `exam_invitations`, and `staff_attendance` use `WHERE teacher_id IS NOT NULL` / `WHERE teacher_id IS NULL` partial indexes to enforce "unique when we know who it is, otherwise allow duplicates by name." That's a genuinely non-trivial SQLite technique and it's applied correctly and consistently.

**The sync engine follows an established pattern, not an improvised one.** `sync_outbox` (pending mutations), `sync_id_map` (local↔remote id + version), and `sync_conflicts` (which stores `local_data`, `remote_data`, *and* `ancestor_data` together with `conflicting_fields`) is the outbox pattern plus three-way merge — comparing both edited versions against their common ancestor to isolate what actually conflicts, rather than just picking a winner. That's the same idea behind CouchDB/PouchDB-style replication and Git's own merge algorithm, and it's the right tool for a desktop app that spends real time offline.

**Singleton tables via `CHECK(id=1)`.** `institution_config`, `sync_config`, `owner_sync_config` — clean way to model "exactly one row" without a separate service or ORM-level enforcement.

**Indexing discipline is generally good.** Consistent `idx_`/`uidx_` naming, sensible composite indexes ordered by the filter you'd actually run (`school_year` first, in most cases), and correct use of `UNIQUE` constraints as the natural key almost everywhere they belong.

---

## 4. Issues, ranked by impact

### 4.1 High — cascade foreign keys are indexed on the wrong column

SQLite indexes a parent table's primary key automatically, but it does **not** automatically index the child column that references it — and `ON DELETE CASCADE` has to scan the child table for matching rows every time a parent is deleted. Several tables here index the *denormalized* lookup column (`student_code`) instead of the actual FK column (`student_id`) that the cascade fires on:

| Table | FK column (drives CASCADE) | What's actually indexed |
|---|---|---|
| `absences` | `student_id` | `student_code` only |
| `correspondence` | `student_id` | nothing but `school_year` |
| `student_risk_snapshot` | `student_id` | `student_code` only |
| `student_movements` | `student_id` | **no index at all** |
| `teacher_absences` | `teacher_id` | `school_year` only |
| `exam_proctors` | `exam_id`, `teacher_id` | `school_year` only |

Deleting a student or teacher currently means SQLite full-scans each of these tables to find rows to cascade. At current data volumes for a single school this is invisible; it stops being invisible as `school_year` history accumulates across multiple years in the same file. `student_movements` is the sharpest case — it has no index whatsoever, including on `school_year`.

**Fix:** add `CREATE INDEX idx_<table>_<fk> ON <table>(<fk_column>);` for each row above. Cheap to add, no schema redesign needed. Worth running `PRAGMA foreign_key_check;` after the migration that adds them, as a sanity pass.

### 4.2 High — long-lived secrets stored as plaintext columns

`sync_config` holds `firebase_api_key`, `firebase_credential`, `firebase_functions_url`, and related fields as plain `TEXT`. `owner_sync_config` holds `owner_token`, `write_token`, `read_token` the same way. These sit in the same SQLite file as student and teacher PII (national ID, birth date, address, phone) — a file that gets backed up, synced, and potentially copied to USB drives in a school office setting.

The standard fix for desktop apps isn't "encrypt the whole database" — it's keep secrets out of the app database entirely. Windows Credential Manager / DPAPI, macOS Keychain, or a small `SQLCipher`-encrypted side-store with the passphrase held in the OS keychain are the usual choices; the plaintext columns become just a non-secret pointer ("credential is stored, use OS vault to fetch it").

**Fix:** move `firebase_credential`, the three `owner_sync_config` tokens, and `firebase_api_key` out of `sync_config`/`owner_sync_config` into OS-level secure storage; keep only non-secret config (URLs, intervals, flags) in SQLite.

### 4.3 Medium — inconsistent student linkage strategy

Every other student-child table (`grades`, `absences`, `correspondence`, `student_files`, `student_movements`, `student_risk_snapshot`) uses a real FK on `student_id` with `ON DELETE CASCADE`. `student_profile_data` and `student_orientation` link by `student_code` alone, with **no FK constraint at all**. `student_profile_data` goes further and keeps a `student_id INTEGER NOT NULL` column that the docs themselves flag as dead — it exists in the table but nothing populates or checks it against `students.id`.

Two consequences: (1) SQLite's own `foreign_key_check` and referential-integrity guarantees don't cover these two tables — an orphaned `student_code` (deleted student, code typo, year mismatch) can't be caught by the database, only by app-layer logic; (2) the dead `student_id` column is actively misleading to anyone reading the schema for the first time, including future-you.

**Fix (pick one, don't leave both live):** either add the real FK (`student_code`/`school_year` composite FK is possible in SQLite against `students(code, school_year)` since that pair has a `UNIQUE` constraint), or explicitly drop the dead `student_id` column and document the code-only link as intentional in the schema doc itself, not just implied by its absence.

### 4.4 Medium — denormalization without a stated reconciliation rule

`teacher_name` is duplicated in `grades`, `staff_attendance`, `compensation_tracking`, `support_sessions`, `exam_proctors` (twice — Arabic and French), `exam_invitations`, and `exam_attendance`. `student_code` is duplicated alongside `student_id` in most student-child tables. This is a defensible choice — it lets rows stay meaningful even when `teacher_id`/`student_id` goes `NULL` after a delete, and it avoids a join for read-heavy reports. But nothing in the schema states what happens when a teacher is renamed: do the historical `teacher_name` snapshots stay frozen (a deliberate "as it was recorded" audit trail) or are they supposed to be updated everywhere? Right now that's undocumented, which means it's one migration away from silently drifting.

**Fix:** not a schema change — a one-paragraph decision, written down: "teacher_name / student_code are point-in-time snapshots and are never backfilled" (or the opposite). Whichever it is, put it in the schema doc next to the column.

### 4.5 Medium — three different timestamp representations

- `DATETIME DEFAULT CURRENT_TIMESTAMP` (most tables) — SQLite stores this as `TEXT`, e.g. `'2026-07-20 10:00:00'`.
- `TEXT DEFAULT (datetime('now'))` (`support_sessions`, `name_aliases`) — same underlying format, different declared type.
- Integer Unix time in milliseconds (`notifications.created_at`, `school_identity.updated_at`).

None of this breaks anything in isolation — SQLite doesn't enforce column types anyway — but it means any cross-table query or export that sorts or compares timestamps has to know, per table, which of the three formats it's dealing with. That's exactly the kind of thing that produces a silent bug six months from now in a reporting feature that joins across tables.

**Fix:** standardize on one representation for all new tables going forward (ISO-8601 `TEXT` is the more common SQLite convention and sorts correctly as a string); leave existing columns alone rather than doing a risky mass migration, but note the two legacy formats explicitly in the schema doc so nobody re-introduces a fourth.

### 4.6 Low — JSON columns without a validity guard

`student_profile_data.data_json`, `exam_config_data.data_json`, `timetable_data.data_json`, `licenses.metadata`, `sync_outbox.row_data`, and a handful of sync tables all store JSON as `TEXT`, which is the correct SQLite choice (not `BLOB`). None of them have a `CHECK (json_valid(data_json))` constraint, so a malformed write from application-layer code fails silently at read time instead of at insert time. Separately, if any of these JSON fields get filtered or sorted on in a query path that matters for performance (e.g. `student_profile_data` by `tab_key` values inside the JSON), a `STORED` generated column with an index on it is cheap in modern SQLite and avoids a full-table JSON scan.

**Fix:** add `json_valid()` check constraints on the JSON columns; only add generated columns if a specific query is measured to need it — don't do this preemptively for all six.

### 4.7 Low — mixed natural/surrogate primary key strategy

Most tables use an `INTEGER` auto-increment surrogate `id`. Config and lookup tables correctly use natural keys instead (`settings.key`, `license_plans.code`, `sync_pull_state.table_name`, `exam_count_rules(level_code, subject)`). This split is fine and arguably correct — but it's worth a one-line note in the docs that it's a deliberate pattern ("KV/lookup tables use natural keys; entity tables use surrogate ids") so a future contributor doesn't "fix" the natural-key tables to match the majority.

### 4.8 Low — no visible retention policy for logs and outbox history

`sync_config.retention_days` (default 7) suggests *some* pruning intent for sync data, but `system_logs` and `sync_outbox`/`owner_sync_outbox` rows with `status = 'sent'` have no stated cleanup path in the schema. For a desktop app that's been running across several `school_year`s, these are the tables most likely to grow unbounded.

**Fix:** confirm there's an app-layer job pruning sent outbox rows and old `system_logs` past a retention window; if there is, note it in the docs so it's not mistaken for a gap.

---

## 5. Prioritized action list

1. Add the six missing FK-column indexes (§4.1) — low effort, no risk, immediate win once `school_year` history piles up.
2. Move sync credentials out of plaintext columns into OS-level secure storage (§4.2) — security-relevant, do before the next release that touches sync.
3. Resolve the `student_profile_data` dead column + decide the FK-vs-code-only question for the two orphaned student tables (§4.3).
4. Write down the denormalization and timestamp conventions in the schema doc itself (§4.4, §4.5) — zero code change, prevents future drift.
5. Add `json_valid()` checks on JSON columns (§4.6).
6. Confirm and document the log/outbox retention job (§4.8).

---

## 6. Sources consulted

- SQLite documentation and community guidance on indexing foreign key columns and `PRAGMA foreign_key_check` — coddy.tech/docs/sqlite/foreign-keys, dbschema.com/blog/sqlite/index
- Offline-first sync design: outbox pattern, versioning, and three-way merge against a common ancestor — dev.to (Sync Conflict Handling in Offline-First PWAs), makitsol.com/offline-first, rafa.ee (three-way merge via `git merge-file`)
- SQLite JSON storage guidance (TEXT over BLOB, `json_valid`, generated columns for indexed lookups) — sqlite.org/json1.html, sqldocs.org/sqlite-database/sqlite-json-data
- Secrets storage for desktop/local apps (OS keychain, SQLCipher, avoiding plaintext credential columns) — newsoftwares.net (Storing Secrets In Apps), sqliteforum.com (SQLite Encryption and Secure Storage)

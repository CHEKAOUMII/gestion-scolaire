# Database Schema Remediation — Follow-up Implementation Plan

| | |
|---|---|
| **Date** | 2026-07-20 |
| **Author** | Schema review (grounded against live code) |
| **Builds on** | `docs/plans/2026-07-07-database-schema-remediation-plan.md` (R1–R9) and `docs/pencil2-schema-analysis-report(1).md` (§4.1–§4.8) |
| **Engine** | SQLite via `better-sqlite3`, Electron main process |
| **Schema sources** | `main/db/schema.js` (`createTables` + `ensure*Schema`), `main/db/migrations.js` (`MIGRATIONS` array) |
| **Init flow** | `main/db/init.js` → `new Database()` → `applyConnectionPragmas()` (`context.js`) → `createTables()` → `runMigrations()` |
| **Audience** | Implementing agent. This document is the single source of truth for the remaining work — follow it verbatim. |

> **Read this first.** The analysis report `pencil2-schema-analysis-report(1).md` was written against an **older snapshot** of the database. Since then, migration `2026-07-065-fk-ondelete-and-identity-keys` and several code-only fixes have already closed most of what that report and the 2026-07-07 plan flagged. **Do not re-implement work marked ✅ DONE below** — doing so would duplicate migration 065 and corrupt `schema_migrations` sequencing. Only the tasks in §3 are open.

---

## 1. Status ledger — what is already done vs. open

Verified against `main/db/schema.js`, `main/db/migrations.js`, `main/db/context.js`, and `main/repos/grades.js` on 2026-07-20.

| Ref | Item | Status | Evidence in code |
|-----|------|--------|------------------|
| Report §4.3 / Plan R6 | Real FKs + `ON DELETE CASCADE`/`SET NULL` on student & teacher & exam children | ✅ DONE | Migration `2026-07-065-fk-ondelete-and-identity-keys` rebuilds 15 tables with FK + `ON DELETE` and runs a scoped `PRAGMA foreign_key_check` gate |
| Report §4.3 / Plan R7 | `exam_invitations`/`exam_attendance` name-unique → partial unique on `teacher_id` | ✅ DONE | Migration 065 `uidx_exam_invitations_teacher` / `uidx_exam_attendance_teacher` (partial, `WHERE teacher_id IS NOT NULL`) + name fallback |
| Report §4.3 / Plan F4 | `student_risk_snapshot.student_id` real FK + backfill | ✅ DONE | Migration 065 rebuild + `UPDATE ... SET student_id = (SELECT s.id ...)` backfill |
| Plan R1 | `grades` `INSERT OR REPLACE` → `ON CONFLICT DO UPDATE` | ✅ DONE | `main/repos/grades.js` `saveOne`/`saveBulk` use `ON CONFLICT(student_code, subject, semester, school_year) DO UPDATE` |
| Report §4.8 / Plan R2 | `system_logs` composite indexes | ✅ DONE | Migration `2026-07-064-system-logs-indexes` (`idx_system_logs_entity`, `idx_system_logs_action`) + retention note (`systemLogsRetentionDays`) |
| Plan R3 | `busy_timeout`, `synchronous=NORMAL`, `wal_autocheckpoint` | ✅ DONE | `main/db/context.js` `applyConnectionPragmas()` |
| Plan R5 | DDL dedup (`notifications`/`school_identity`) + monotonic version guard | ✅ DONE | `ensureNotificationsSchema`/`ensureSchoolIdentitySchema` in `schema.js`; `assertMigrationVersionIntegrity` in `migrations.js` |
| Report §4.3 / Plan F4 | `student_profile_data.student_id` dead column | ✅ DECIDED (no-op) | Documented in migration `2026-05-062-student-risk-snapshot` — intentionally left; `student_code` is the real key |
| **Report §4.1** | **Index on the FK child column that CASCADE/SET NULL fires on** | ❌ **OPEN** | grep confirms **no** `idx_*_student_id` / `idx_*_teacher_id` / `idx_*_exam_id` exists. Now higher-risk: migration 065 made the cascades *live*, so each parent delete full-scans these children. **→ Task A** |
| **Report §4.2** | **Long-lived secrets stored as plaintext columns** | ❌ **OPEN** | `sync_config.firebase_api_key`, `sync_config.firebase_credential`, `owner_sync_config.owner_token`/`write_token`/`read_token` are plain `TEXT` in `schema.js`. **→ Task B** |
| **Report §4.6** | **`CHECK(json_valid(...))` on JSON `TEXT` columns** | ❌ **OPEN** | No `json_valid` guard on `student_profile_data.data_json`, `exam_config_data.data_json`, `timetable_data.data_json`, `licenses.metadata`, `sync_outbox.row_data`. **→ Task C** |
| **Report §4.4/§4.5/§4.7** | **Written-down conventions** (denormalization snapshot rule, timestamp formats, PK strategy) | ❌ **OPEN** | Not stated anywhere. **→ Task D** (docs only) |
| Report §4.8 / Plan R9 | Retention for `sent` `sync_outbox` rows + orphan `sync_snapshots` purge | ⚠️ VERIFY | `sync_config.retention_days` exists; confirm a cleanup job consumes it. **→ Task E** |
| Plan R4 | `markEntrySent` atomic transaction | ⚠️ VERIFY | Symbol not found under that name — the sync-marking code path may have been renamed/refactored. **→ Task E** |

**Net remaining scope:** Task A (indexes — do first), Task B (secrets), Task C (JSON guards), Task D (docs), Task E (verification only).

---

## 2. Non-negotiable conventions (apply to every migration you write)

These are enforced by the existing runner — violating them breaks the build or silently skips your migration.

1. **Append to the `MIGRATIONS` array** in `main/db/migrations.js`, in order, at the end.
2. **Versioning:** `YYYY-MM-NNN-slug`. `assertMigrationVersionIntegrity` requires the `NNN` sequence to be **strictly increasing**. The last used is **`2026-07-068`**, so the next free numbers are **`069`, `070`, `071`, …**. Do not reuse a number (a duplicate PK is silently skipped — see the cautionary note in migration 062).
3. **Idempotency:** every `CREATE INDEX`/`CREATE TABLE` uses `IF NOT EXISTS`. Migrations may re-run on partially-migrated DBs.
4. **Default transaction:** the runner wraps each migration in `db.transaction()` and records the version for you. **Only** set `recordsVersionInternally: true` when you must toggle `PRAGMA foreign_keys` (which cannot run inside a transaction) — then you own the transaction and the `INSERT INTO schema_migrations` yourself, exactly as migration 065 does.
5. **Fresh-DB parity:** anything that should exist on a brand-new database must **also** be added to `main/db/schema.js` (`createTables` or the relevant `ensure*Schema`), because a fresh install runs `createTables()` *then* migrations. Additive indexes are safe to place in both; the migration guarantees existing installs get them too.
6. **No rollback exists.** Structural (table-rebuild) changes require a user-visible backup step first.
7. After any FK/constraint change, gate with `PRAGMA foreign_key_check` scoped to the tables you touched (copy the pattern from migration 065, lines that filter `violations` by `rebuiltSet`).

---

## 3. Tasks

### Task A — Index every FK child column that a cascade fires on  ⭐ do first

**Why.** SQLite auto-indexes a parent's PK but **never** the child column referencing it. Migration 065 added `ON DELETE CASCADE`/`SET NULL` to these children, so deleting a student or teacher now triggers a child-table lookup on the FK column — and every one of the columns below is currently **unindexed or only covered by a composite whose leading column is `school_year`/`session_key`** (a `WHERE teacher_id = ?` cascade cannot use a `(school_year, teacher_id)` index by the left-prefix rule). Result: parent deletes full-scan these tables, and the cost grows as multi-year history accumulates in one file.

**Scope decision (already computed — do not re-derive).** Only columns **not** already led by a usable index are listed. Explicitly **excluded** because an existing index already leads with the FK column:
- `student_files.student_id` → covered by `UNIQUE(student_id, doc_key, school_year)`
- `teacher_aliases.teacher_id` → covered by `idx_teacher_aliases_teacher(teacher_id, school_year)`
- `support_sessions.teacher_id` → covered by `idx_support_sessions_teacher(teacher_id, school_year)`

**Indexes to create (14):**

| Table | Column | Delete behaviour (from mig 065) |
|-------|--------|----------------------------------|
| `grades` | `student_id` | CASCADE |
| `grades` | `teacher_id` | SET NULL |
| `absences` | `student_id` | CASCADE |
| `correspondence` | `student_id` | CASCADE |
| `student_movements` | `student_id` | CASCADE (currently **zero** indexes on this table) |
| `student_risk_snapshot` | `student_id` | CASCADE |
| `tests` | `teacher_id` | SET NULL |
| `staff_attendance` | `teacher_id` | SET NULL |
| `compensation_tracking` | `teacher_id` | SET NULL |
| `teacher_absences` | `teacher_id` | CASCADE |
| `exam_proctors` | `exam_id` | CASCADE |
| `exam_proctors` | `teacher_id` | SET NULL |
| `exam_invitations` | `teacher_id` | SET NULL |
| `exam_attendance` | `teacher_id` | SET NULL |

**Implementation.** Pure additive index migration — no rebuild, runs inside the normal transaction wrapper (do **not** set `recordsVersionInternally`).

Append to `MIGRATIONS`:

```js
{
    // Task A — index FK child columns that migration 065 made cascade-active.
    // SQLite does not auto-index the referencing column; each parent delete
    // otherwise full-scans these children. Additive + idempotent, no rebuild.
    version: '2026-07-069-fk-child-column-indexes',
    up: () => {
        const db = getDb();
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_grades_student_id                 ON grades(student_id);
            CREATE INDEX IF NOT EXISTS idx_grades_teacher_id                 ON grades(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_absences_student_id               ON absences(student_id);
            CREATE INDEX IF NOT EXISTS idx_correspondence_student_id         ON correspondence(student_id);
            CREATE INDEX IF NOT EXISTS idx_student_movements_student_id      ON student_movements(student_id);
            CREATE INDEX IF NOT EXISTS idx_student_risk_snapshot_student_id  ON student_risk_snapshot(student_id);
            CREATE INDEX IF NOT EXISTS idx_tests_teacher_id                  ON tests(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_staff_attendance_teacher_id       ON staff_attendance(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_compensation_tracking_teacher_id  ON compensation_tracking(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_teacher_absences_teacher_id       ON teacher_absences(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_exam_proctors_exam_id             ON exam_proctors(exam_id);
            CREATE INDEX IF NOT EXISTS idx_exam_proctors_teacher_id          ON exam_proctors(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_exam_invitations_teacher_id       ON exam_invitations(teacher_id);
            CREATE INDEX IF NOT EXISTS idx_exam_attendance_teacher_id        ON exam_attendance(teacher_id);
        `);
    }
},
```

**Fresh-DB parity:** add the same 14 `CREATE INDEX IF NOT EXISTS` statements to the performance-index block near the end of `createTables()` in `main/db/schema.js` (the block that already defines `idx_students_year` etc.). Guard the exam-table ones the same way that file already guards `idx_grades_year_teacher` (they are created by later migrations on upgraded DBs, but on a fresh DB the tables exist by the time `createTables` runs, so a plain `CREATE INDEX IF NOT EXISTS` is fine — verify table existence order; `exam_invitations`/`exam_attendance` are created by migrations only, so **those two must live in the migration only**, not in `createTables`).

> ⚠️ Precise parity rule: put an index in `createTables` **only** for tables that `createTables` itself creates (`grades`, `absences`, `correspondence`, `student_movements`, `staff_attendance`, `tests`, `exam_proctors`, `teacher_absences`). Tables created solely by migrations (`student_risk_snapshot`, `compensation_tracking`, `exam_invitations`, `exam_attendance`) get their index in the migration only.

**Verification.**
- `PRAGMA index_list('<table>')` shows the new index for each table above.
- `EXPLAIN QUERY PLAN DELETE FROM students WHERE id = ?` on a real-sized DB shows index use on the child scans instead of `SCAN TABLE`.
- Run the app test suite (`npm test`) and `npm run lint`.

**Risk:** minimal. Indexes are additive; worst case is slightly slower writes and more disk — negligible at this data scale.

---

### Task B — Move long-lived secrets out of plaintext columns

**Why.** `sync_config.firebase_api_key`, `sync_config.firebase_credential`, and `owner_sync_config.owner_token`/`write_token`/`read_token` sit as plain `TEXT` in the same SQLite file as student/teacher PII (CIN, birth date, address, phone). That file is backed up, synced, and can be copied to USB in a school office. The standard desktop fix is **keep secrets out of the app DB** and hold them in OS-backed secure storage.

**Recommended mechanism: Electron `safeStorage`.** It is built into Electron (no native module like `keytar` to compile/ship), and encrypts with DPAPI (Windows), Keychain (macOS), or libsecret (Linux). API: `safeStorage.isEncryptionAvailable()`, `encryptString(plain) → Buffer`, `decryptString(buf) → string`.

> If `safeStorage.isEncryptionAvailable()` is `false` on a target machine (rare Linux headless case), fall back to keeping the value in the DB **but flag it** — do not silently lose the credential. Design for this branch explicitly.

**Design.**
1. Add a small module `main/security/secret-store.js`:
   - `setSecret(name, plaintext)` → encrypts via `safeStorage`, writes the ciphertext (base64) to a file under `app.getPath('userData')/secrets/` (one file per secret) **or** to a dedicated `app_secrets(name TEXT PRIMARY KEY, ciphertext BLOB, updated_at)` table. A dedicated table keeps everything in one place but the ciphertext is only decryptable with the OS user key, so it is **not** plaintext-equivalent. Prefer the table for backup simplicity.
   - `getSecret(name)` → reads + `decryptString`. Returns `null` if absent.
   - `hasSecret(name)`.
2. Replace all **reads** of the five plaintext columns with `getSecret(...)`, and all **writes** with `setSecret(...)`, in the sync + owner-sync config code paths (search `firebase_api_key`, `firebase_credential`, `owner_token`, `write_token`, `read_token` across `main/`).
3. Keep the existing columns for **one release** as a migration source, then blank them.

**Migration (data move, then blanking).** This is data-plus-code; split into two migrations across two releases to be safe, or do the move in a migration and blank in the same one only after confirming `getSecret` round-trips. Because `safeStorage` needs the Electron `app` to be ready, prefer doing the **move at app startup** (not inside the DDL migration), then a later migration blanks the columns. Concretely:

- **Release N:** ship `secret-store.js` + a one-time startup routine `migratePlaintextSecretsToVault()` that, for each of the five values, if the column is non-empty and the vault has no entry, calls `setSecret` then `UPDATE ... SET <col> = ''`. Idempotent (guarded by `hasSecret`). All reads/writes already go through the store.
- **Release N+1:** add a migration that documents the columns as deprecated (they are now always empty). Optionally rebuild `sync_config`/`owner_sync_config` to drop the columns — but these are singleton config tables; dropping columns requires the rebuild dance and is low value. Simpler: leave the (now-empty) columns and note them deprecated in `docs/database-schema.md`.

**Files to touch:** new `main/security/secret-store.js`; startup wiring (near `initDatabase()` call, after `app.whenReady`); every read/write of the five columns; `docs/database-schema.md` (mark columns deprecated); this plan's status ledger.

**Verification.**
- With a populated legacy DB, launch once → confirm the five columns are blanked and `getSecret` returns the original values.
- Confirm sync + owner-sync still authenticate end-to-end.
- Confirm a fresh install never writes secrets to the columns.
- Confirm behaviour when `safeStorage.isEncryptionAvailable()` is `false` (documented fallback, no data loss).

**Risk:** medium — touches live auth paths. Do behind the sync test suite; take a DB backup first. **Do not** log decrypted secret values.

---

### Task C — Add `json_valid()` guards to JSON columns

**Why.** A malformed JSON write currently fails silently at *read* time instead of loudly at *insert* time. A `CHECK(json_valid(col))` moves the failure to the write, where it is debuggable.

**Two-tier approach (existing tables need a rebuild — treat accordingly):**

- **New tables going forward:** always declare JSON columns as `data_json TEXT NOT NULL CHECK(json_valid(data_json))`. Add this to the team conventions doc (Task D).
- **Existing tables** (`student_profile_data.data_json`, `exam_config_data.data_json`, `timetable_data.data_json`, `licenses.metadata`, `sync_outbox.row_data`): adding a `CHECK` requires the full table-rebuild dance (SQLite can't `ALTER` in a constraint). This is only worth doing in a **supervised, backup-guarded window**, and only after confirming no existing row would violate it:

  ```sql
  SELECT COUNT(*) FROM <table> WHERE <json_col> IS NOT NULL AND json_valid(<json_col>) = 0;
  ```

  If that returns 0 for a table, you may rebuild it using the `rebuildTableWithConstraints(db, name, createSql, extraIndexes)` helper already exported from `migrations.js` (it preserves `id` and named indexes — critical for `sync_id_map`). If it returns >0, **fix or quarantine those rows first**; do not let the rebuild strand them.

  > Caution: `sync_outbox.row_data` is written on the hot sync path and can legitimately be `NULL` for `DEL` operations — the guard must be `CHECK(row_data IS NULL OR json_valid(row_data))`. Same nullable pattern for `licenses.metadata`.

**Recommendation:** implement the **new-tables convention (Task D)** now; schedule the existing-table rebuilds only if a specific corruption bug appears. Do not preemptively rebuild five tables for a low-severity hygiene gain.

**Verification (if you do rebuild any table):** the pre-check count is 0; after rebuild `PRAGMA foreign_key_check` (if the table has FKs) returns 0; a deliberate malformed insert is now rejected; `npm test` passes.

**Risk:** low if convention-only; medium per table if rebuilding (same class as migration 065).

---

### Task D — Write down the undocumented conventions (docs only, zero code)

Add a short "Conventions" section to `docs/database-schema.md` capturing the three decisions the report flagged as unstated. These prevent future drift and are effectively free.

1. **Denormalization / snapshot rule (§4.4).** State explicitly, e.g.:
   > `teacher_name`, `teacher_name_fr`, `student_code`, and copied `section` columns are **point-in-time display snapshots**. The operational key is always the id/code (`teacher_id`, `student_id`/`student_code`). Snapshots are **not** backfilled when a teacher/student is renamed — historical rows intentionally show the value as recorded. (This matches migration 065's `SET NULL` design, which drops the id link but keeps the name snapshot.)

   Confirm this matches actual runtime behaviour before writing it; if any code path *does* backfill names, document that instead.

2. **Timestamp formats (§4.5).** State the standard and the two legacy exceptions:
   > New tables use `DATETIME DEFAULT CURRENT_TIMESTAMP` (ISO-8601 text, sorts correctly). Legacy exceptions retained as-is: `notifications.created_at` and `school_identity.updated_at` store integer Unix ms; `support_sessions.created_at` and `name_aliases.created_at` use `datetime('now')` text. Any cross-table timestamp comparison must account for these. Do **not** introduce a fourth format. Use the helper in `main/db/time.js`.

3. **Primary-key strategy (§4.7).** One line:
   > Entity tables use surrogate `INTEGER PRIMARY KEY AUTOINCREMENT` ids. Key-value / lookup / singleton tables use natural keys (`settings.key`, `license_plans.code`, `exam_count_rules(level_code, subject)`, `*_config` with `CHECK(id=1)`). This split is deliberate — do not "normalize" the natural-key tables to surrogate ids.

Also update the status ledger in this plan and the `docs/database-schema.md` footer date.

**Verification:** peer read; `docs/database-schema.md` renders; the denormalization statement is checked against real code, not assumed.

**Risk:** none.

---

### Task E — Verify (not necessarily change) retention & atomic sync-marking

These are prior-plan items whose current status is ambiguous from static reading. **Confirm before deciding to act.**

1. **`sync_outbox` / `owner_sync_outbox` `sent`-row + `sync_snapshots` orphan retention (§4.8 / R9).** `sync_config.retention_days` (default 7) implies pruning intent. Find the cleanup timer/job (search `retention_days`, `retention`, cleanup schedulers under `main/sync/` and `main/`), confirm it deletes `status = 'sent'` outbox rows and orphaned `sync_snapshots` past the window. If it does, document it in `docs/database-schema.md` so it is not mistaken for a gap. If it does **not**, open a small follow-up to add it to the existing cleanup timer.

2. **Atomic sync-marking (prior-plan R4).** The symbol `markEntrySent` no longer exists under that name — the push/mark path was likely refactored. Locate the code that, after a successful remote batch commit, updates `sync_outbox.status`, `sync_id_map` version/ancestor, and `sync_conflicts` (search `sent_at`, `status = 'sent'`, and `db.transaction` in `main/sync/`). Confirm those updates for a committed chunk run inside **one** `db.transaction()`. If already transactional → mark R4 done in the ledger. If not → wrap them.

**Verification:** cite file/line for each finding in the ledger; add tests only if you change code.

**Risk:** none for verification; low for the wrap if needed.

---

## 4. Execution order & effort

| Order | Task | Effort | Rebuild? | Backup needed? |
|-------|------|--------|----------|----------------|
| 1 | **A** — FK child-column indexes | S | No | No |
| 2 | **D** — write down conventions | S | No | No |
| 3 | **E** — verify retention + atomic marking | S | No | No |
| 4 | **B** — secrets → OS vault | M | No (columns kept, then blanked) | Yes (touches live auth) |
| 5 | **C** — JSON guards (convention now; rebuilds only if needed) | S / M | Only if rebuilding existing tables | Yes if rebuilding |

**Do Task A first** — it is the single highest-value, lowest-risk item and directly hardens the cascades migration 065 just turned on.

---

## 5. Definition of done

- [ ] Task A migration `2026-07-069-fk-child-column-indexes` added; 14 indexes present on real + fresh DBs; `EXPLAIN QUERY PLAN` on a parent delete shows indexed child scans; parity indexes added to `schema.js` per the precise parity rule.
- [ ] Task B: `secret-store.js` in place; five secret values live only in the OS vault on upgraded and fresh installs; sync + owner-sync verified end-to-end; fallback path documented; no secret values logged.
- [ ] Task C: JSON-column convention documented; existing-table rebuilds deferred unless a pre-check + supervised window is explicitly scheduled.
- [ ] Task D: `docs/database-schema.md` gains a "Conventions" section (denormalization, timestamps, PK strategy) verified against real code.
- [ ] Task E: retention job and atomic sync-marking status confirmed with file/line evidence; ledger updated; any needed wrap/prune shipped.
- [ ] `npm test` and `npm run lint` pass.
- [ ] `docs/database-schema.md` footer date bumped; the status ledger in this plan updated to reflect completion.

---

## 6. Guardrails (repeat — these bite)

- Next migration versions are **`069, 070, …`** (`068` is the last used). Strictly increasing `NNN` or `assertMigrationVersionIntegrity` throws.
- Additive index migrations run inside the default transaction — **do not** set `recordsVersionInternally`. Only FK/`PRAGMA foreign_keys` migrations do (see migration 065).
- Any table rebuild must use `rebuildTableWithConstraints(...)` (exported from `migrations.js`) to **preserve `id`** — `sync_id_map`/`sync_snapshots` key on local `id`; a fresh rowid breaks sync.
- Take an app backup before any rebuild; there is no rollback.
- Mirror fresh-DB-relevant DDL into `schema.js`, respecting the precise parity rule in Task A (migration-only tables stay migration-only).

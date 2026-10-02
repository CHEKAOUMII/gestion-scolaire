# ADR: Child-owner cycle enforcement via composite foreign keys

- Date: 2026-10-01
- Status: Accepted
- Plan: `docs/plans/2026-09-27-isolation-principle-stage-separation(1).md`, Slice 0 decision gate 1
- Implemented in: migration `2026-09-087-student-child-cycle-isolation` (`main/db/migrations.js`)

## Context

Slice 1 requires schema-level proof that a student child row belongs to its
owner student's stage. An FK from child tables to `cycles(code)` alone is
insufficient: foreign keys are evaluated independently, so nothing stops a
child row carrying `cycle_code = A` while its owner student carries cycle `B`.

## Options considered

1. **Composite FK**: `students` carries `UNIQUE(id, cycle_code)`; each child
   table declares `FOREIGN KEY(student_id, cycle_code) REFERENCES
   students(id, cycle_code)`. Needs a `UNIQUE` index on `students` (index-only,
   no table rebuild) **and** a rebuild of every child table, since SQLite
   cannot add a constraint with `ALTER TABLE` (backup step, maintenance
   window, `PRAGMA foreign_keys` verified on).
2. **`BEFORE INSERT/UPDATE` triggers** enforcing `NEW.cycle_code =
   (SELECT cycle_code FROM students WHERE id = NEW.student_id)`. Avoids
   rebuilds but is less declarative.

## Decision

Composite foreign keys on the four unenforced child tables
(`correspondence`, `student_files`, `student_movements`,
`student_profile_data`).

## Rationale

- `cycle_code NOT NULL` requires a table rebuild either way (SQLite cannot add
  `NOT NULL` via `ALTER`), so folding the composite FK into the same rebuild
  adds no extra data movement.
- The FK is then enforced declaratively by the engine on every connection
  (`foreign_keys=ON` is the standard pragma), covering repos, sync pull, and
  future writers with no per-path code.
- Triggers were rejected: the same predicate would be duplicated 8x
  (insert+update x 4 tables), triggers are invisible to
  `PRAGMA foreign_key_list` audits, and they cannot deliver DDL `NOT NULL` by
  themselves.

## Consequences

- Migration 087 rebuilds the four tables (idempotent, zero outbox rows) with
  migration-time backfill from the owner student and per-table orphan policy;
  see the migration header comment for the full backfill/quarantine rules.
- Pull-side mirror: `checkStudentChildCycleConsistency`
  (`main/repos/student-cycle.js`, wired in `main/sync/engine/apply.js`)
  quarantines mismatched rows instead of half-writing.
- No `contractVersion` bump: no new columns and no key changes, so the sync
  contract is unchanged.

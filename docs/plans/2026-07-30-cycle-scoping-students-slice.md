# Cycle Scoping — Students Vertical Slice

| | |
|---|---|
| **Date** | 2026-07-30 |
| **Audience** | Implementing agent — execute in order; the decisions in §2 are settled, do not re-litigate them. |
| **Parent plan** | `multi-school-cycle-management-plan.md` (Tasks 8–9, §5.4, §9.2) |
| **Scope** | The `students` table only, end to end: schema → repo → read contract → sync contract → tests. |
| **Primary code** | `main/db/migrations.js`, `main/repos/students.js`, `main/ipc/students.js`, `main/sync/entity-registry.js` |
| **Out of scope** | `grades`, `absences`, `exams`, timetable, orientation, reports. They resolve their cycle through the student and follow this pattern once it is proven. |

## 1. Why students first

Every other operational table reaches its cycle through a student or a section. If the
pattern established here is wrong, the cost is one table and one migration instead of
eight. This slice must therefore answer, in code, four questions the parent plan leaves
open — and each answer becomes the template for the rest.

The slice is complete when a student created under one cycle is invisible to a session
active in another cycle, including through a direct IPC call, and a device that has not
run the migration refuses those rows rather than applying them unscoped.

## 2. Decisions (settled)

### D1 — `cycle_code` is stored on `students`, not derived

There is no `sections` table yet; `students.section` is free text (`main/db/schema.js`).
Deriving a cycle through the section is therefore not possible today, and adding the
`sections` table first would make this slice depend on Task 4.

**Rule:** the cycle is stored on root tables (`students`, later `sections`) and derived
on dependents (`grades`, `absences`, …) through their student. Dependents get a
consistency check, not a duplicated column, unless profiling later proves the join too
expensive on `grades`.

### D2 — The cycle comes from the writing session, never from the record's shape

A student's cycle is stamped from the session's active cycle context at write time. It is
**not** inferred from the section name, the level string, the file name, or a
`cycle_code` sent by the renderer (§13 forbids all four).

This dissolves the "student without a section" transitional state: a student imported
before section assignment already has a cycle, because the person importing had one. The
row is complete from creation; only its *section* is pending.

### D3 — `cycleScoped` in the entity registry means cycle-**keyed**, not cycle-carrying

The registry flag added on 2026-07-30 requires `cycle_code` inside `keyFields` and
`remote.idFields`. That is correct for entities whose logical key can collide across
cycles (a section named `1A` may exist in both), and **wrong** for students, whose key
(`school_year` + `code`) is already unique institution-wide. Forcing `cycle_code` into the
students key would break identity with every remote document already written under
`school_year+code`.

**Rule:**

| Entity kind | Declares | Meaning |
|---|---|---|
| Cycle-carrying (students) | `requiredColumns: ['cycle_code']` + `contractVersion` | the row has a cycle; identity is unchanged |
| Cycle-keyed (future `sections`) | `cycleScoped: true` + the above | the cycle participates in identity and merge keys |

Rename `cycleScoped` → `cycleKeyed` in `main/sync/entity-registry.js` (one flag, one
validator branch, one accessor `isCycleScoped` → `isCycleKeyed`, one test) so the two
concepts cannot be confused later. Students declare only `requiredColumns`.

### D4 — Pre-login bulk import is allowed only while the cycle is unambiguous

`students:addBulk` is registered with `handleWriteSoftAuth(..., { allowNoSession: true })`
because `settings-imports` can run before login, and `handleWriteSoftAuth` — like
`handleRead` — **discards `event`**, so it cannot see a session even when one exists.

**Rule:**

1. Pass `event` through `handleWriteSoftAuth` to its handler (same shape as
   `handleAuthedRead`: `{ db, event, session }`), so a logged-in import stamps the
   session's cycle.

   **Amended during implementation:** the helper has 32 call sites across 14 files, so the
   new shape is opt-in per channel via `{ withContext: true }` rather than a repo-wide
   signature change. Domains migrate as they become cycle-aware, and a handler that
   declares the wrong shape fails immediately on its first `db` call rather than silently.
2. With no session, resolve the institution's single enabled *supported* cycle. Exactly
   one → use it. More than one → reject with `يتعذر تحديد السلك — يرجى تسجيل الدخول قبل الاستيراد`.

Today's single-cycle installs keep working unchanged; the ambiguous case is refused
rather than guessed.

## 3. Already in place (do not rebuild)

- `institution_cycles`, the closed catalog, and per-window `ActiveCycleContext`
- `handleAuthedRead` + `peekContext` — the read seam this slice consumes
- Entity contract enforcement (`requiredColumns` → quarantine in `main/sync/engine/apply.js`)
- `clearSchemaColumnsCache()` on DB swap

## 4. Steps

### Step 1 — Rename the registry flag (D3)

`main/sync/entity-registry.js`, `tests/sync-contract-version.test.js`. Pure rename plus a
comment stating the distinction. No behavior change.

**Verify:** `node tests/sync-contract-version.test.js`, `npm run test:smoke`.

### Step 2 — Migration

New versioned step in `main/db/migrations.js` (follow `2026-07-070-institution-cycles`):

```
ensureColumn('students', 'cycle_code', "TEXT NOT NULL DEFAULT 'secondary_qualifiant'")
UPDATE students SET cycle_code = 'secondary_qualifiant' WHERE cycle_code IS NULL OR cycle_code = ''
CREATE INDEX IF NOT EXISTS idx_students_year_cycle ON students(school_year, cycle_code)
```

Keep `UNIQUE(code, school_year)` — a student belongs to exactly one cycle, so the key
does not change (D3). Do not touch `idx_students_year` / `idx_students_code_year`; measure
before adding anything further.

**Verify:** migration is idempotent on re-run; existing rows all read
`secondary_qualifiant`; `npm run test:smoke` (migration numbering check).

### Step 3 — Repository filter

`main/repos/students.js`. Every read takes an explicit `cycleCode` argument — never a
default, never a global: `listByYear`, `listPaginated`, `getCodesByYear`, `getByCode`,
`search`, `getByStatus`, `findByLocalKeys`.

Writes stamp `cycle_code` from the caller-supplied context: `insertOne`, `addBulk`.
`updateById` must **not** accept `cycle_code` in `UPDATABLE_FIELDS` — moving a student
between cycles is a separate, deliberate operation, not a field edit.

`deleteByYear` becomes delete-by-year-**and-cycle**. This is the sharpest risk in the
slice: unscoped, an admin working in one cycle wipes the other cycle's students for that
year.

**Verify:** `node tests/repos-domain-key-fields.test.js` (note: this suite currently fails
for unrelated reasons — its hand-written fake DB has not been updated for the `level` /
`school_name` columns; fix it as part of this step since you are touching the same insert).

**Outcome:** the fake DB was replaced with a real engine rather than patched again — its
positional parameter unpacking had decayed silently across three column additions. Two
things surfaced once the suite ran to completion: `main/ipc/grades.js` still owned a
`SELECT id, code FROM students` (moved to `studentsRepo.listCodeIndexByYear`, deliberately
un-scoped because grades are not cycle-partitioned yet), and `node:sqlite` binds JS numbers
as doubles, so `CAST(? AS TEXT)` yields `'1.0'` where better-sqlite3 yields `'1'` — the
fallback engine now binds integral numbers as BigInt to match production affinity.

### Step 4 — Read channels onto the authenticated seam

`main/ipc/students.js`: migrate `students:getAll`, `students:list`, `students:getByCode`,
`students:getCodesByYear`, `students:search`, `students:getByStatus` from `handleRead` to
`handleAuthedRead`, passing `cycleContext.cycleCode` into the repo.

Before migrating, confirm no pre-login page reads students. Current consumers are
`app.js`, `js/utils.js`, `js/cross-source-validator.js`, and the pages
`settings-imports`, `students-list`, `students-status`, `student-profile`,
`grades-sheets`, `absence-analytics`, `absence-weekly`, `reports-certificates` — all
post-login. If any pre-login caller is found, record it in an explicit exception list with
a comment; do not silently keep it unauthenticated.

When `peekContext` returns null (no cycle selected yet), resolve the single enabled
supported cycle, exactly as D4 does for writes.

### Step 5 — Write channels

`main/ipc/students.js` + `main/ipc/ipc-helpers.js`:

- `handleWriteSoftAuth` passes `{ db, event, session }` (D4). Update its existing callers
  mechanically — they ignore the new shape until they need it.
- `students:add`, `students:addBulk`, `students:update`, `students:delete`,
  `students:deleteByYear`, `students:updateStatusBulk` resolve the cycle in main and pass
  it to the repo.
- Any `cycle_code` present in a renderer payload is **ignored**, not validated (§13).

### Step 6 — Sync contract

`main/sync/entity-registry.js`, students entry:

```js
local: { ..., contractVersion: 2, requiredColumns: ['cycle_code'] }
```

Identity fields stay `['school_year', 'code']` (D3). A device that has not run Step 2's
migration will now quarantine incoming student rows with the Arabic "update this device"
reason instead of writing them cycle-less — which is the whole point of the contract.

**Verify:** `node tests/sync-contract-version.test.js`, `node tests/sync-entity-registry.test.js`.

### Step 7 — Tests

New `tests/cycle-isolation-students.test.js` (real SQL, `better-sqlite3` with the
`node:sqlite` fallback used by `tests/cycles-repo-ipc.test.js`):

1. Two students, same year, different `cycle_code`; each cycle's list returns exactly one.
2. `getByCode` with the other cycle's code returns nothing.
3. `deleteByYear` in one cycle leaves the other cycle's rows intact.
4. A read channel invoked directly with no cycle context does not return both cycles.
5. `updateById` cannot change `cycle_code`.
6. Migration re-run leaves counts unchanged.

Isolation tests operate at repo level with two raw `cycle_code` values, because
`secondary_collegial` is still `not_supported` and cannot be selected through IPC. Test
the capability gate separately — it already has coverage in `tests/cycles-repo-ipc.test.js`.

### Step 8 — Import review surface

`js/import-center`: show the cycle every imported row will be stamped with, sourced from
the session context, before the write is confirmed.

**Known limitation to state in the UI, not paper over:** until level→cycle mapping exists
(parent plan Task 4), a file containing another cycle's students cannot be detected — every
row takes the importing session's cycle. Say so on the review screen.

## 5. Risks

| Risk | Mitigation |
|---|---|
| `deleteByYear` unscoped deletes another cycle's students | Step 3 makes the cycle mandatory in the SQL; Step 7 test 3 |
| A pre-login page silently loses data when reads require auth | Step 4 audit before migration; explicit exception list |
| Bulk import stamps the wrong cycle | D4: exactly one supported cycle, or login required |
| Older device receives scoped rows | Step 6 contract → quarantine with a clear Arabic reason |
| Renaming the registry flag breaks a caller | Step 1 is a standalone commit with its tests green |

## 6. Verification

```bash
npm run test:smoke
```

```bash
npm test
```

```bash
npm run lint
```

Baseline before starting: 221/230 in `npm test`. The 9 failures were pre-existing
(6 proctor-v2, `inv-e-display-aggregation`, `repos-domain-key-fields`,
`sync-exact-bulk-capture`).

**Result after the slice: 224/231.** `repos-domain-key-fields` and `sync-exact-bulk-capture`
are both fixed (the latter needed the `SELECT 1 FROM grades` existence probe its fake DB
never implemented). The remaining 7 failures are the 6 proctor-v2 suites and
`inv-e-display-aggregation`, untouched by this work.

## 7. Rollback

Reverting the build is sufficient. The added column carries a default and older code
ignores it, so a downgraded build reads and writes `students` normally — the column simply
stops being maintained. Capability downgrade (`not_supported`) remains the mechanism for
withdrawing cycle *selection*; it does not and need not reverse this migration.

## 8. Deliberately not in this slice

- `grades` / `absences` / `exams` scoping — they follow this pattern afterwards
- the `sections` table and level→cycle mapping (Task 4)
- `user_cycle_access` — per-cycle permissions come after the data is partitioned (§9.1)
- cross-cycle conflict engines for timetable and proctoring (§7.10)
- collegial policies — `secondary_collegial` stays `not_supported` throughout

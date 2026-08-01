# Exam Center Independence — Implementation Plan

| | |
|---|---|
| **Date** | 2026-07-20 |
| **Audience** | Implementing agent — execute verbatim. |
| **Scope** | The exam-center domain only: `exams`, `exam_proctors`, `exam_rooms`, `exam_invitations`, `exam_attendance`, `exam_config_data`, `exam_count_rules`, `tests`. |
| **Primary code** | `main/repos/exams.js` (SQL owner), `main/ipc/exams.js` (auth/validation), `main/teachers/identity.js` (resolver used at fetch time). |
| **Related** | `docs/database-schema.md`, `docs/plans/2026-07-20-database-schema-remediation-followup-plan.md` (Task A already indexes exam FK columns). |

> **One-line goal:** make the exam center self-contained by default; allow **reading** teacher/student data from the DB **only** as an explicit one-time import that produces an independent **snapshot**; **never** couple via a live read-time join/merge.

---

## 1. The design contract (الميثاق)

Arabic requirement (source of truth):
> مركز الامتحان مستقل. الجلب (fetch) من القاعدة مسموح **فقط** في الحالات الخاصة حين يكون التلاميذ/الأساتذة هم المعنيون بالامتحان، وينتج **لقطة (snapshot)**. **الدمج (merge) ممنوع**. خارج تلك الحالات الجلب **غير متاح**.

Formalized as four rules the implementation must satisfy:

| # | Rule | Meaning in code |
|---|------|-----------------|
| **C1** | Independent by default | Exam-center reads/writes must not require rows in `teachers`/`students` to function. Every teacher-linked exam table already carries a name snapshot and supports `teacher_id IS NULL`. |
| **C2** | Fetch is allowed, but only via an explicit whitelist | Reading `teachers`/`students` is permitted **only** at the enumerated import/assign entry points (§3), and each read **copies** the needed fields into the exam row (snapshot). |
| **C3** | Merge is forbidden | No read-time `JOIN teachers` / `JOIN students` whose result the UI depends on. Display must come from the stored snapshot columns. (Internal joins within the exam domain — e.g. `exam_proctors → exams` — are allowed.) |
| **C4** | Fetch is not available outside the whitelist | New code must not add ad-hoc reads of `teachers`/`students` into exam paths. Enforced by a grep guard test (§ Task 4). |

**The optional FK stays.** `exam_proctors.teacher_id`, `exam_invitations.teacher_id`, `exam_attendance.teacher_id`, `tests.teacher_id → teachers(id)` are `ON DELETE SET NULL` and nullable (migration 065). That is a *reference when known*, not a merge — it satisfies C1 (deleting a teacher nulls the link but keeps the snapshot) and is **kept as-is**.

---

## 2. Current state — assessment

Verified against `main/repos/exams.js` and all `teacher_full_name` consumers on 2026-07-20.

**Compliant already:**
- Writes/imports (`saveProctorManual`, `bulkImportProctors`, `generateProctorsRoundRobin`, `saveTest`, `upsertInvitation`, `upsertAttendance`, `bulkUpsertAttendance`) resolve identity via `resolveTeacherIdentity`/`teacherIdOrNull`, then **store a snapshot** (`teacher_name`, and for proctors also `teacher_name_fr`, `cin`, `som`, `gender`, `specialty`, `workplace`). They work with `teacher_id = NULL`. → **fetch, not merge** ✅
- FK is `SET NULL` + nullable → reference, not merge ✅
- No linkage to `students` anywhere in the exam domain ✅

**One violation of C3 — a live read-time merge:**
- `listProctors()` in `main/repos/exams.js`:
  ```sql
  SELECT p.*, e.title as exam_title, t.full_name as teacher_full_name
  FROM exam_proctors p
  LEFT JOIN exams e ON e.id = p.exam_id
  LEFT JOIN teachers t ON t.id = p.teacher_id      -- ❌ external merge
  WHERE p.school_year = ?
  ORDER BY p.id DESC
  ```
  The `LEFT JOIN teachers` exposes `teacher_full_name` (the *live* teacher name), which the UI prefers over the snapshot. This breaks C3 and also contradicts the "as recorded" snapshot semantics (a renamed teacher would retroactively change historical proctor displays).

**Safety of removing the join (verified):** every consumer of `teacher_full_name` uses the fallback pattern `teacher_full_name || teacher_name`:
- `js/pages/exams-rooms.js` (lines ~144, ~182, ~191, ~661)
- `js/pages/exams-proctors.js` (~4765, ~5328)
- `js/pages/exams-schedule.js` (~904)
- `js/data/proctor-key-resolver.js` + `js/algorithms/proctor-v3.bundle.js` (`teacher_full_name || teacher_name || key`)

When `teacher_full_name` is absent, they fall back to the snapshot `teacher_name`. Removing the join therefore changes nothing visible **except** correctly showing the recorded name. No consumer relies on `teacher_full_name` without a `teacher_name` fallback.

> **Out of scope:** `main/ipc/support-sessions.js` uses the same `LEFT JOIN teachers ... AS teacher_full_name` pattern, but support-sessions is **not** the exam center. Do **not** change it in this plan (its consumers also fall back to `teacher_name`, so it is safe, but it belongs to a separate cleanup).

---

## 3. Whitelist of allowed fetch entry points (C2)

These are the **only** places allowed to read `teachers` (and, in future, `students`) inside the exam center. Each must produce a snapshot and tolerate an unresolved (NULL id) result. The implementing agent must not add others.

| Entry point (`main/repos/exams.js`) | Reads | Produces snapshot | Tolerates no-match |
|---|---|---|---|
| `saveProctorManual` | `resolveTeacherIdentity` | `teacher_name` | yes (`teacher_id` NULL) |
| `bulkImportProctors` | `resolveTeacherIdentity` | full proctor snapshot | yes |
| `generateProctorsRoundRobin` | `SELECT id, full_name FROM teachers WHERE active=1` | `teacher_name` | n/a (requires teachers by design — "special case") |
| `saveTest` | `resolveTeacherIdentity` | `teacher_name` | yes |
| `upsertInvitation` | `teacherIdOrNull` | `teacher_name` | yes |
| `upsertAttendance` / `bulkUpsertAttendance` | `teacherIdOrNull` | `teacher_name` | yes |

Everything else — especially **list/read** paths (`listProctors`, `listInvitations`, `listAttendance`, `listTests`, `listExams`, `listRooms`) — must be **snapshot-only** (no `teachers`/`students` join).

---

## 4. Tasks

### Task 1 — Remove the read-time merge in `listProctors` (fixes C3) ⭐

**File:** `main/repos/exams.js`, function `listProctors`.

**Change** the query to drop the external `teachers` join while keeping the internal `exams` join:

```js
function listProctors(db, year) {
    return db
        .prepare(
            `
            SELECT p.*, e.title as exam_title
            FROM exam_proctors p
            LEFT JOIN exams e ON e.id = p.exam_id
            WHERE p.school_year = ?
            ORDER BY p.id DESC
        `
        )
        .all(year);
}
```

- Removed: `, t.full_name as teacher_full_name` and `LEFT JOIN teachers t ON t.id = p.teacher_id`.
- Kept: `LEFT JOIN exams e` — internal to the exam domain (allowed by C3).
- Result rows still include the snapshot `p.teacher_name` (and `teacher_name_fr`), which every UI consumer already falls back to.

**Zero-risk alternative (only if a reviewer worries about the absent field):** alias the snapshot into the old field name instead of joining —
`SELECT p.*, e.title as exam_title, p.teacher_name AS teacher_full_name`.
This keeps the property present but sourced from the snapshot. Prefer the clean removal above; use this only if a consumer without a fallback is discovered.

**Do not** change any other function in this task.

---

### Task 2 — Codify the contract in code comments + the whitelist

**File:** `main/repos/exams.js`.

1. Add a module-level header comment stating C1–C4 and pointing to this plan:
   ```js
   /**
    * EXAM CENTER INDEPENDENCE CONTRACT (see docs/plans/2026-07-20-exam-center-independence-plan.md)
    *  C1 Independent by default — never require teachers/students rows to function.
    *  C2 Fetch only at the whitelisted import/assign entry points; each copies a snapshot.
    *  C3 No read-time merge — list/read paths are snapshot-only (no JOIN teachers/students).
    *      (Internal joins within the exam domain, e.g. exam_proctors→exams, are allowed.)
    *  C4 No ad-hoc reads of teachers/students in new exam code.
    */
   ```
2. Above each whitelisted fetch function (§3), add a one-line comment: `// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id`.
3. Above the list/read functions, add: `// [snapshot-only C3] no teachers/students join.`

No behavior change — comments only.

---

### Task 3 — Document the contract in the schema doc

**File:** `docs/database-schema.md`.

Add a section **"Exam Center — Independence Contract"** near the Exam Domain map containing:
- The four rules C1–C4 (copy from §1).
- A statement: *the `teacher_id` FKs on `exam_proctors`/`exam_invitations`/`exam_attendance`/`tests` are optional references (`ON DELETE SET NULL`, nullable); the exam center operates on the stored name snapshots and tolerates unmatched/absent teachers.*
- A statement: *there is currently no link between exams and `students`; if candidate-student linkage is added later it must follow the same fetch-to-snapshot rule (Task 5), never a live join or hard FK.*
- Bump the doc footer "Last updated" date.

---

### Task 4 — Guard test: forbid new external merges (enforces C4)

Add a lightweight test that fails if an exam **read** path re-introduces a `teachers`/`students` join. Place it with the existing repo/db tests (match the project's test location & runner — check `package.json` `test` script and existing `tests/` layout before writing).

**Assertion logic (pseudocode):**
```js
const src = fs.readFileSync('main/repos/exams.js', 'utf8');
// Allowed internal joins only. Any JOIN targeting teachers/students is a C3 violation.
const externalJoins = src.match(/JOIN\s+(teachers|students)\b/gi) || [];
assert.strictEqual(externalJoins.length, 0,
  'Exam center must be snapshot-only: no JOIN teachers/students in main/repos/exams.js (see exam-center-independence plan C3).');
```
Also assert that `listProctors` no longer selects `teacher_full_name` from a join (regex: no `t.full_name`).

> If the codebase has no JS test runner wired for `main/`, instead add this as a check in the existing lint/smoke step; do not invent a new framework — reuse what `npm test` already runs.

---

### Task 5 — (Future-proofing, documentation only) students-in-exams rule

No code today. Record the rule so a future feature stays compliant:
- If exams must target specific candidate **students**, add snapshot columns to the exam-side table (e.g. `candidate_code`, `candidate_name`) populated by an **explicit import** that reads `students` once.
- Do **not** add a hard FK to `students` and do **not** join `students` in exam read paths.
- Mirror the proctor pattern: optional nullable id reference at most, snapshot for display, tolerate absence.

Put this as a short note under the §Task 3 schema section and in this plan (done, here).

---

## 5. Execution order

1. **Task 1** — remove the `teachers` join in `listProctors` (the only real fix).
2. **Task 2** — code comments / whitelist markers.
3. **Task 3** — schema-doc contract section.
4. **Task 4** — guard test.
5. **Task 5** — future-proofing note (docs only).

All are low risk and require **no migration** (no schema/DDL change; the FKs and columns stay).

---

## 6. Verification / Definition of Done

- [ ] `listProctors` no longer joins `teachers`; grep for `JOIN teachers` / `JOIN students` in `main/repos/exams.js` returns **zero**.
- [ ] Manually load the proctors list in the UI (`exams-proctors`, `exams-rooms`, `exams-schedule`): names still render (from `teacher_name`), including for proctors with `teacher_id IS NULL` and for imported external supervisors.
- [ ] A proctor whose teacher was renamed shows the **recorded** name (snapshot), not the new live name — confirming C3.
- [ ] Whitelisted fetch entry points (§3) still resolve + snapshot correctly (add a manual proctor, bulk import, round-robin generate).
- [ ] Contract comments present in `main/repos/exams.js`; contract section present in `docs/database-schema.md` with bumped date.
- [ ] Guard test (Task 4) passes and fails if a `JOIN teachers` is reintroduced.
- [ ] `npm test` and `npm run lint` pass.

---

## 7. Guardrails

- **Do not** remove or weaken the optional `teacher_id` FKs (they are `SET NULL` references, not merges — they satisfy C1).
- **Do not** touch `main/ipc/support-sessions.js` (out of scope, separate domain).
- **Do not** add a migration — this plan is code + docs only; the schema is unchanged.
- **Do not** change insert/import snapshot logic — fetch-to-snapshot is already correct; only the read-time join is wrong.
- Keep internal exam-domain joins (`exam_proctors → exams`) — independence is about **external** coupling only.

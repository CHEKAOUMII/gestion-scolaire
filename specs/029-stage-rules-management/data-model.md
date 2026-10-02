# Data Model: Stage Rules Management

**Branch**: `029-stage-rules-management` | **Date**: 2026-08-01
Derived from `spec.md` (Key Entities). Domain-level model; exact SQL lives in `ensureStageRulesSchema` (schema.js) + migration `2026-08-001-stage-rules-management`.

---

## Entity Map

```text
SchoolYear ──1:N──> RuleVersion (stage_rule_sets)
RuleVersion ──1:N──> SubjectCoefficientRule (subject_coefficients)
RuleVersion ──1:N──> ExamCountRule (exam_count_rules)
SubjectCode/LevelCode/StreamCode (catalogs — sibling plan) ──<── referenced by rule rows
Actor (session user) ──creates──> AuditEntry (system_logs, action STAGE_RULE_OVERRIDE)
```

## 1. Rule Version (`stage_rule_sets`)

A frozen, immutable set of grading rules for one school year.

| Field | Type | Rules |
|---|---|---|
| `id` | INTEGER PK | Auto-increment; `localIdField: 'id'` for sync |
| `school_year` | TEXT NOT NULL | School year |
| `revision` | INTEGER NOT NULL | Monotonic per school year; `UNIQUE(school_year, revision)` |
| `status` | TEXT NOT NULL | `CHECK(status IN ('draft','active','closed'))` |
| `created_by` | TEXT | Actor user id/name |
| `reason` | TEXT NOT NULL | Mandatory reason for the change that created this version |
| `created_at` | DATETIME | Default `CURRENT_TIMESTAMP` |

**Constraints**
- `UNIQUE(school_year, revision)`
- Partial unique index: **at most one `active` per `school_year`** (`WHERE status = 'active'`)
- Immutability: no UPDATE path — every change creates a new revision

**State transitions**

```text
draft ──(publish)──> active ──(superseded by new revision)──> closed
closed ───────────────────────────────────────────────────────> immutable (never reopens)
```

- Save/reset → new row with `revision = max+1`, `status = 'active'`; previous active → `closed`.
- `closed` rows keep producing historical results and are never edited.

## 2. Subject Coefficient Rule (`subject_coefficients`)

| Field | Type | Rules |
|---|---|---|
| `id` | INTEGER PK | Auto-increment |
| `rule_set_id` | INTEGER NOT NULL | FK → `stage_rule_sets(id)` |
| `cycle_code` | TEXT NOT NULL | Cycle (e.g. `secondary_qualifiant`) |
| `level_code` | TEXT NOT NULL | Level; `'*'` = wildcard |
| `stream_code` | TEXT NOT NULL | Stream/branch; `'*'` = wildcard |
| `subject_code` | TEXT NOT NULL | Canonical catalog subject code |
| `coefficient` | INTEGER NOT NULL | `CHECK(coefficient BETWEEN 1 AND 20)` |
| `source` | TEXT NOT NULL | `CHECK(source IN ('official','custom'))` |
| `updated_by` | TEXT | Actor |
| `reason` | TEXT | Change reason |
| `updated_at` | DATETIME | Default `CURRENT_TIMESTAMP` |

**Constraints**
- `UNIQUE(rule_set_id, cycle_code, level_code, stream_code, subject_code, source)` — official and custom rows **coexist** for the same key.
- Wildcards: `level_code = '*'` and/or `stream_code = '*'` represent defaults (resolution precedence in contracts/resolver.md).
- No rows for primary cycle (contract: `cycle_profiles.uses_coefficients = false`).
- User paths never write `source = 'official'` rows; only seed/upgrade paths do.

## 3. Exam Count Rule (`exam_count_rules` — rebuilt)

Legacy table `(level_code, subject)` PK, no cycle/school_year/source → rebuilt into the versioned model.

| Field | Type | Rules |
|---|---|---|
| `id` | INTEGER PK | New; auto-increment |
| `rule_set_id` | INTEGER NOT NULL | FK → `stage_rule_sets(id)` |
| `cycle_code` | TEXT NOT NULL | New dimension (was missing) |
| `level_code` | TEXT NOT NULL | `'*'` = wildcard |
| `subject_code` | TEXT NOT NULL | Canonical subject code (was free text) |
| `exam_count` | INTEGER NOT NULL | `CHECK(exam_count BETWEEN 1 AND 12)` |
| `source` | TEXT NOT NULL | `official` / `custom` |
| `updated_by` | TEXT | Actor |
| `reason` | TEXT | Change reason |
| `updated_at` | DATETIME | Default `CURRENT_TIMESTAMP` |

**Constraints**
- `UNIQUE(rule_set_id, cycle_code, level_code, subject_code, source)`
- Backfill (migration): existing rows → official rule set of the year(s) present, `cycle_code = 'secondary_qualifiant'`; subject text mapped via catalog/aliases; unmappable → logged failure.

## 4. Referenced Catalogs (owned by sibling plan `2026-08-01-primary-stage-catalogs`)

- `education_subjects` (`subject_code` PK, labels, sort, active) — canonical subject source.
- `subject_aliases` (`normalized_alias` UNIQUE → `subject_code`) — used by migration to map legacy text names; unmappable = migration failure (never guessed).
- `education_levels` / `level_aliases` — canonical levels.
- `cycle_profiles` — planned (sibling); `uses_coefficients = false` for primary blocks coefficient resolution.

## 5. Audit Entry

Reuses `system_logs`. New action code `STAGE_RULE_OVERRIDE` (unified for save/reset). Records actor, reason, before/after values, rule-set revision. Legacy `SUBJECT_COEFFICIENT_ADMIN_OVERRIDE` rows remain visible read-only.

---

## Validation Summary (from spec FR-003/FR-004/FR-010)

| Rule | Enforced at |
|---|---|
| coefficient 1–20 | DB CHECK + IPC validation |
| exam_count 1–12 | DB CHECK + IPC validation |
| mandatory reason (bounded length) | IPC + repo (save/reset) |
| no writes to `closed` version | repo (target version must be `active`/`draft`) |
| no writes to `official` rows from user paths | repo (user writes only create `custom`) |
| one `active` per school year | partial unique index |
| `school_year` present in every rule query | repo (join via rule_set) |

# Research: Stage Rules Management

**Branch**: `029-stage-rules-management` | **Date**: 2026-08-01
**Phase**: 0 — resolves all NEEDS CLARIFICATION from the plan template.

Each entry: Decision / Rationale / Alternatives considered. All facts verified against source code (file:line cited).

---

## D1 — Sync capture model for the new rule tables

- **Decision**: **Explicit outbox capture** — `captureMode: 'explicit'` + `exclude: true` in `CHANNEL_REGISTRY`, outbox rows written inside the repo's SQLite transaction via `main/repos/capture-port.js` (pattern of `main/repos/absences.js:104-131`, `students`, `grades`). Snapshot: **false** for all three rule tables.
- **Rationale**:
  - `stageRules:saveCoefficients` / `resetToOfficial` are inherently **multi-row** (a save copies all custom rows into a new revision). `tests/sync-bulk-channels-explicit.test.js:12-26` fails any `bulk: true` channel that is not explicit — snapshot-only would trip the automated gate or require a documented exception.
  - Outbox rows are atomic with the mutation (`capture.js:566-608` throws → whole transaction rolls back), and push is scheduled immediately after commit (`capture.js:683-707`), vs. snapshot's 10–120 min drift cycle (default 30, `snapshot.js:169`).
  - Seed/migration writes never touch the outbox under explicit capture (migrations don't call repos) — satisfying M4's required test "migration creates no outbox rows for seeds" by construction.
  - Aligned with AGENTS.md 027-layering and the write-channel checklist (`docs/plans/2026-07-15-add-write-channel-checklist.md`).
- **Alternatives considered**:
  - **Snapshot-only (examCountRules pattern, `entity-registry.js:453-464`)** — minimal plumbing, but: drift-based with no revision/ordering knowledge; an old device aggressively re-pushes stale local rows (perpetual conflict noise) and can seed a fresh cloud with old official data; eventual-only (≥10 min).
  - **Mixed** — plan explicitly forbids mixing capture behaviors without a documented reason; the rule tables share one lifecycle, so one model.

## D2 — Protection against official-revision downgrade (old device pushing older rules)

- **Decision**: Three complementary guards:
  1. **Push side (exists, keep)**: `writeItemWithVersionCheck` (`main/sync/transport/firestore.js:76`) already refuses writes when `remoteVersion >= item.version` — same for both capture models. No change needed.
  2. **Pull side (new)**: register an **entity apply hook** for `stage_rule_sets` via the registry's `applyHooks` mechanism (`entity-registry.js:656-662`) that skips/quarantines an incoming PUT whose `revision <=` the local row's `revision`. `applyPutOperation` (`apply.js:156-249`) is unconditional today; `merge.js:58` LWW is wall-clock based — neither understands domain revisions, so the hook is the correct seam.
  3. **Seed side (new)**: the official-upgrade migration/repo path never writes `revision <= max(revision)` for the school year, and never captures seeds (D1).
- **Rationale**: the plan contract ("apply/sync must not downgrade an official revision", plan §7) has no existing mechanism on the pull side; the hook keeps the guard next to the data it protects and avoids touching generic merge logic used by every entity.
- **Alternatives considered**: generic revision-aware merge in `merge.js` (too invasive, affects all entities); schema `contractVersion` bump only (`apply.js:61-83` quarantines until migration — schema-level, not revision-level, insufficient alone).

## D3 — Legacy data migration

- **Decision**: Single new migration `2026-08-001-stage-rules-management` (next monotonic version after `2026-07-077`; format `YYYY-MM-NNN-slug` enforced at `migrations.js:2370-2403`):
  1. Canonical DDL in a new `ensureStageRulesSchema(db)` helper in `main/db/schema.js` (per constitution: migrations call schema helpers, no duplicate DDL — pattern `ensureCycleReferenceSchema`, `schema.js:892-964`); `ensureColumn` for ALTER additions.
  2. **`exam_count_rules` rebuild** (PK `(level_code, subject)` → `id` PK + `rule_set_id` FK + `cycle_code` + `subject_code` + `source`; logical key `(rule_set_id, cycle_code, level_code, subject_code, source)`): full-table rebuild via `rebuildTableWithConstraints` (`migrations.js:2330-2351`, pattern of `2026-04-047`). Backfill: create one **official** rule set per school year present in `students` (or the current year if none), map existing rows into it as `cycle_code = 'secondary_qualifiant'`; `level_code = '*'` rows become wildcard rows.
  3. **Legacy override JSON** `subjectCoefficientMappings:v1` (`main/repos/subject-coefficients.js:34-47`, always `cycleCode='secondary_qualifiant'`, free-text subject): migrate each entry to a **custom** row in the year's active rule set, mapping subject text → `subject_code` via `subject_aliases`/catalog. Unmappable rows are **logged as migration failures** (`system_logs`, pattern `recordUnmappableCycle` in `2026-07-077`, `migrations.js:26-41`) and never guessed. After migration the key becomes rollback-only: code stops reading **and** writing it (plan §6.2).
  4. **Seed data**: coefficients extracted from `CC_BRANCH_COEFFICIENTS` (`js/cc-rules.js:224-554`) into seed modules `main/db/education-catalogs/*` (plan M1); `js/cc-rules.js` keeps only algorithms. NOTE: the plan says "13 branches"; the code has **15 branch keys** (9×`2BAC*`, 4×`1BAC*`, `TCS`, `TCLSH`) — seeds must be generated from the code keys, not the plan's count.
  5. **Primary cycle**: no coefficients seeded; `cycle_profiles.uses_coefficients = false` is the contract (`cycle_profiles` does not exist yet — owned by the sibling catalogs plan; stage-rules depends on it, see D6).
- **Rationale**: follows the established 077 rebuild/backfill/report-unmappable pattern; keeps legacy behavior for one release (rollback-only key) per user decision §6.2.
- **Alternatives considered**: keep `subject` text column with a second `subject_code` column (documented as legacy — plan allows but defers; rebuild is cleaner and the 047 pattern is proven); drop legacy rows silently (violates contract §7); composite PK without `id` (rejected in plan debate: sync needs `localIdField: 'id'`).

## D4 — Rule-version lifecycle

- **Decision**: close at **school-year close** (user decision §6.1 default). States: `draft → active → closed` (`stage_rule_sets.status CHECK IN ('draft','active','closed')`). A save/reset always creates a **new revision** (`revision = max+1`) as `active`; the superseded version becomes `closed`. `closed` versions are immutable and keep producing historical results. Partial unique index enforces **at most one `active` per `school_year`**. `draft` is reserved (official-upgrade staging in a later slice); the v1 UI shows `active`/`closed`.
- **Rationale**: user decisions §6.1 + §5 (no silent edit of a closed version; immutable sets, not mutable rows with `updated_at`).
- **Alternatives considered**: close at term end (rejected by default — yearly granularity matches school-year data model); mutable rows with `source`+`updated_at` (rejected in plan debate — source alone does not make versions).

## D5 — Resolver precedence and `RULES_UNAVAILABLE`

- **Decision**: renderer-side resolver in `js/cc-rules.js`, extended to load the **active rule set for the school year** once per page (replacing `ensureSubjectCoefficientMappings`, `cc-rules.js:897-912`). Lookup precedence per key: **exact `(cycle, level, stream, subject)` → stream wildcard → level wildcard → cycle default**; within the same key **custom wins over official**. Missing rule → `MISSING_RULE` domain error; active set unavailable → `RULES_UNAVAILABLE` with `officialExportBlocked: true`; **no silent fallback to constants**.
- **Rationale**: plan §2/M2 contract; callers today pass only `{schoolYear, streamCode}` — level is inferred via `inferQualifiantLevel(branch)` (`cc-rules.js:651-656`) and cycle defaults to `secondary_qualifiant`, which is compatible for the qualifiant scope of v1 (`grades-results.html:220-224` already passes `cycleCode` explicitly; results-hub/analytics/students-list/student-profile pass partial context — documented gap, resolved by inference, upgraded per-page in M3).
- **Alternatives considered**: main-process resolution (all averages are computed renderer-side today — `computeSubjectAverage`/`computeWeightedGeneralAverage` have no main-side counterpart, so a main-side gate would need new machinery); constant fallback on IPC failure (explicitly forbidden by plan — would silently corrupt results).

## D6 — Cross-plan dependency

- **Decision**: declare dependency on the sibling plan `docs/plans/2026-08-01-primary-stage-catalogs.md` for: `cycle_profiles` (incl. `uses_coefficients`), `education_levels`, `education_subjects`, `level_aliases`, `subject_aliases` seeding (all tables exist empty since 077; `cycle_profiles` exists only in the sibling plan). The stage-rules migration maps legacy subject text through `subject_aliases`; unmappable entries are logged, never guessed (contract §7). The sibling plan (already updated this session) owns catalogs + `cycle_code` wiring; stage-rules owns `exam_count_rules` rebuild, subject-coefficients versioning, and both rule tables' sync.
- **Rationale**: both plans were edited together in this session (ownership split per §7 contract).
- **Alternatives considered**: self-contained seeding of catalogs by stage-rules (duplicates sibling ownership — rejected; keeps single source of truth).

## D7 — Error contract and export gate

- **Decision**: new dual-export contract `js/shared/errors/stage-rules-error-contract.js` mirroring `subject-coefficient-error-contract.js` (112-line pattern: shared + dual-export IIFE, codes `RULES_UNAVAILABLE` / `MISSING_RULE` / `INVALID_RULE_VERSION`, `createIncompleteResultMetadata`-style metadata with `officialExportBlocked: true`, `isOfficialExportAllowed` helper). Gate points: reuse the existing `grades-results.html:568` and `student-profile.js:3219` gates (they already consume `officialExportBlocked`); `RULES_UNAVAILABLE` additionally blocks at the same points. Main-side gate at `reports:printDocument` (`main/ipc/reports.js:40`) is **deferred** — it is unauthenticated/passthrough today and all averages are renderer-side; adding it requires renderer-supplied metadata, so it is a M3/M4 follow-up, not v1 blocking.
- **Rationale**: 028/029 convention (AGENTS.md); the existing subject-coefficient contract is the closest model and its gate code is already wired.
- **Alternatives considered**: extend `subject-coefficient-error-contract.js` with new codes (legacy filter must stay read-only; new domain deserves its own catalog per single-responsibility).

---

## Consolidated unknown-resolution map

| # | Unknown (plan template) | Resolution |
|---|---|---|
| 1 | Capture model A vs B | D1 — explicit outbox |
| 2 | Downgrade protection mechanism | D2 — push guard (exists) + apply hook (new) + seed guard |
| 3 | Migration shape/backfill | D3 — `2026-08-001-stage-rules-management`, rebuild + backfill + unmappable logging |
| 4 | Version close timing | D4 — school-year close (user decision §6.1) |
| 5 | Resolver precedence + RULES_UNAVAILABLE | D5 — renderer-side, 4-level precedence, custom>official, no fallback |
| 6 | Catalog ownership vs sibling plan | D6 — sibling owns catalogs/cycle_profiles; stage-rules depends + coordinates |
| 7 | Export blocking strategy | D7 — renderer gates + error contract; main-side gate deferred |
| 8 | Seed branch count (13 vs 15) | D3 note — generate from actual code keys (15) |

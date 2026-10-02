# Pencil2 Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-08-01

## Active Technologies
- JavaScript (CommonJS) on Electron 35 / Node.js runtime; vanilla renderer scripts + `better-sqlite3`; existing modules: `main/repos/capture-port.js`, `main/sync/capture.js`, `main/sync/entity-registry.js`, `main/sync/engine/*`, `main/ipc/ipc-helpers.js` (`handleAuthedRead`, `handleWriteSoftAuth`), `main/auth/resolve-cycle.js` (`resolveCycleForRequest`, `listUsableCycles`), `main/db/schema.js` (`ensureColumn`, `rebuildTableWithConstraints`, `ensureCycleReferenceSchema` pattern), `js/shared/errors/*` (028 dual-export pattern) (029-stage-rules-management)
- SQLite via better-sqlite3; new migration `2026-08-001-stage-rules-management`; canonical DDL helper `ensureStageRulesSchema(db)` in `schema.js` (029-stage-rules-management)

- JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts + Electron IPC/contextBridge, `better-sqlite3`, Node built-ins (`crypto`, `dgram`, `http`, `os`), existing auth/licensing/sync/linking modules (013-ipc-layer)

## Project Structure

```text
src/
tests/
```

## Commands

npm test; npm run lint

## Code Style

JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts: Follow standard conventions

## Recent Changes
- 029-stage-rules-management: Added JavaScript (CommonJS) on Electron 35 / Node.js runtime; vanilla renderer scripts + `better-sqlite3`; existing modules: `main/repos/capture-port.js`, `main/sync/capture.js`, `main/sync/entity-registry.js`, `main/sync/engine/*`, `main/ipc/ipc-helpers.js` (`handleAuthedRead`, `handleWriteSoftAuth`), `main/auth/resolve-cycle.js` (`resolveCycleForRequest`, `listUsableCycles`), `main/db/schema.js` (`ensureColumn`, `rebuildTableWithConstraints`, `ensureCycleReferenceSchema` pattern), `js/shared/errors/*` (028 dual-export pattern)

- 013-ipc-layer: Added JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts + Electron IPC/contextBridge, `better-sqlite3`, Node built-ins (`crypto`, `dgram`, `http`, `os`), existing auth/licensing/sync/linking modules

<!-- MANUAL ADDITIONS START -->

## System Tags Architecture

A note-based tagging system for recording structured daily observations about teachers and sections using `@mention` autocomplete.

### Database: `system_tags` table

| Column | Type | Description |
|--------|------|-------------|
| `id` | INTEGER PK | Auto-increment |
| `tag_date` | TEXT NOT NULL | Date (YYYY-MM-DD) |
| `entity_type` | TEXT NOT NULL | `'teacher'` or `'section'` |
| `entity_id` | INTEGER | Teacher ID (NULL for sections) |
| `entity_name` | TEXT NOT NULL | Teacher name or section code |
| `tag_key` | TEXT NOT NULL | Tag identifier (e.g. `educational_activity`) |
| `tag_label` | TEXT NOT NULL | Arabic display label |
| `note_group` | TEXT | UUID linking rows of the same note |
| `note_text` | TEXT | Full note text with @mentions |
| `details` | TEXT | Extra details (legacy single-tag mode) |
| `school_year` | TEXT NOT NULL | School year |
| `created_at` | DATETIME | Creation timestamp |

**Unique constraint:** `(tag_date, entity_type, entity_name, tag_key, school_year)`

### Tag Types — Single Source of Truth

**File:** `js/data/system-tag-types.js` (global `ALL_TAG_TYPES` array)

Always import this file in any page that needs tag type definitions. **Never** define tag types inline.

Available keys: `educational_activity`, `meeting`, `competition`, `training`, `inspection`, `field_trip`, `early_release`, `short_session`, `cancelled_session`, `cultural_activity`, `sports_activity`, `disciplinary_council`, `other`

### IPC Channels

| Channel | Auth | Purpose |
|---------|------|---------|
| `systemTags:getByDate` | `handleRead` | Fetch tags by date + schoolYear |
| `systemTags:save` | `handleWriteSoftAuth(admin,staff)` | Insert/update single tag |
| `systemTags:saveNote` | `handleWriteSoftAuth(admin,staff)` | Save note with @mentions (creates note_group UUID, one row per mention) |
| `systemTags:delete` | `handleWriteSoftAuth(admin,staff)` | Delete single tag by ID |
| `systemTags:deleteByGroup` | `handleWriteSoftAuth(admin,staff)` | Delete all rows sharing a note_group |

### Preload API: `window.api.systemTags`

```js
window.api.systemTags.getByDate(date, schoolYear)
window.api.systemTags.save(payload)
window.api.systemTags.saveNote({ tag_date, tag_key, tag_label, note_text, mentions: [{type, id, name}], school_year })
window.api.systemTags.delete(id)
window.api.systemTags.deleteByGroup(noteGroup)
```

### Sync Capture (capture.js)

All systemTags channels are registered in `CHANNEL_REGISTRY` for sync outbox capture.

### Files Involved

- **DB schema:** `main/db/migrations.js` (migrations `2026-04-045-system-tags`, `2026-04-046-system-tags-notes`)
- **IPC handlers:** `main/ipc/system-tags.js`
- **Preload:** `preload.js` (`systemTags` namespace)
- **Sync capture:** `main/sync/capture.js` (4 channel entries)
- **Tag types:** `js/data/system-tag-types.js` (centralized `ALL_TAG_TYPES`)
- **Frontend:** `staff-daily-report.html` (note form, @mention autocomplete, tags table)
- **Plan doc:** `docs/plans/2026-04-10-system-tags.md`
- **Write-channel checklist:** `docs/plans/2026-07-15-add-write-channel-checklist.md`

## Main-process layering (027-layering-remediation)

Standing rule for **new** school-data write features:

1. **All domain SQL** lives in `main/repos/*` — not in `main/ipc/*`.
2. **IPC handlers** only: role/session auth, field validation (`requireFields` / `requireSchoolYear`), call repo, map response.
3. **Change-tracking** from repos goes through `main/repos/capture-port.js` (never `require('../sync/capture')` inside a repo). Default port is real capture; tests use `createNoOpCapturePort()` / `setRepoCapturePort`.
4. **Bulk / multi-row writes** use `captureMode: 'explicit'` + `exclude: true` in `CHANNEL_REGISTRY` and write outbox rows **inside** the same SQLite transaction (see students/grades/absences repos).
5. Follow the full write-channel checklist: `docs/plans/2026-07-15-add-write-channel-checklist.md`.

Feature specs: `specs/027-layering-remediation/`.

## Orientation error contract (028)

- **SSOT**: `js/shared/errors/orientation-error-contract.js` (dual-export: shared + page-only sections).
- IPC (`main/ipc/orientation.js`) and pages (`settings-imports`, `students-orientation`) must consume it — no parallel catalogs.
- Spec/plan: `specs/028-orientation-error-contract/`.

## Stage rules management (029)

Versioned, editable, synced stage grading rules. Official seed rules ship with the app; admin/principal edits create immutable new revisions with a mandatory reason; rules drive grade results with **no silent fallback** to constants.

### Database: `stage_rule_sets`, `subject_coefficients`, `exam_count_rules`, `subject_weight_rules`

- `stage_rule_sets`: `UNIQUE(school_year, revision)`; status CHECK `draft/active/closed`; partial unique index = one `active` per school year. Edits copy the active set to revision max+1, mark the previous `closed`.
- `subject_coefficients`: dims `(rule_set_id, cycle_code, level_code, stream_code, subject_code)` + `source` CHECK `official/custom` in the logical UNIQUE; `coefficient` CHECK 1..20. `custom` rows shadow `official` rows on the same key (official row is never overwritten).
- `exam_count_rules`: dims `(rule_set_id, cycle_code, level_code, subject_code)` + `source`; `exam_count` CHECK 1..12.
- `subject_weight_rules`: dims `(rule_set_id, cycle_code, subject_code)` + `source`; basis-point exam/activity weights must total 10000. Official rows seed the current `CC_SUBJECT_WEIGHTS` behavior; custom rows are editable for `secondary_qualifiant`.
- Canonical DDL helper: `ensureStageRulesSchema(db)` in `main/db/schema.js`. Migration: `2026-08-001-stage-rules-management` (idempotent, zero outbox rows; legacy `exam_count_rules` rebuilt; legacy settings key `subjectCoefficientMappings:v1` migrated to custom rows, key kept rollback-only; unmappable subjects logged as `STAGE_RULES_MIGRATION_UNMAPPABLE`, never guessed).

### Resolution precedence (SSOT: `specs/029-stage-rules-management/contracts/resolver.md`)

Exact `(cycle, level, stream, subject)` → stream wildcard → level wildcard (`(cycle,* ,stream)` then `(cycle,*,*)`) → cycle default → **`MISSING_RULE`** (never constants). Custom beats official on the same key. IPC failure / missing set → `RULES_UNAVAILABLE` with `officialExportBlocked: true`.

### Error contract

**SSOT**: `js/shared/errors/stage-rules-error-contract.js` (dual-export IIFE, pattern 028): codes `RULES_UNAVAILABLE`, `MISSING_RULE`, `INVALID_RULE_VERSION`, `CONFIRM_REQUIRED`, `REASON_REQUIRED`, `COEFFICIENT_OUT_OF_RANGE`, `EXAM_COUNT_OUT_OF_RANGE`, `SUBJECT_WEIGHT_OUT_OF_RANGE`. Helpers `createIncompleteResultMetadata`, `isOfficialExportAllowed` — reuse the existing export gates (`grades-results.html`, `student-profile.js`), never add parallel catalogs.

### IPC channels

| Channel | Auth | Purpose |
|---------|------|---------|
| `stageRules:getActive` | `handleAuthedRead` | Active rule set + rows for a school year |
| `stageRules:saveCoefficients` | `handleWriteSoftAuth(admin,principal)` | Version-copy save of coefficient overrides |
| `stageRules:saveExamCounts` | `handleWriteSoftAuth(admin,principal)` | Version-copy save of exam-count overrides |
| `stageRules:saveAll` | `handleWriteSoftAuth(admin,principal)` | Atomic version-copy save of coefficients, exam counts, and subject weights |
| `stageRules:resetToOfficial` | `handleWriteSoftAuth(admin,principal)` | Row/bulk restore (bulk requires `confirm: true`) |

Preload: `window.api.stageRules.{getActive, saveCoefficients, saveExamCounts, saveAll, resetToOfficial}`. Cycle authorization via `resolveCycleForRequest` + `user_cycle_access`; only `secondary_qualifiant` is editable for coefficients and subject weights. Every write: new revision, audit `STAGE_RULE_OVERRIDE` in `system_logs` (actor, reason, revision, changed/removed keys with before values), explicit outbox capture inside the repo transaction (capture-port, `captureMode: 'explicit'` + `exclude: true` in `CHANNEL_REGISTRY` — never add to snapshot tables).

### Files Involved

- **Repo:** `main/repos/stage-rules.js` (all SQL; `getActiveRuleSet`, `getRuleSetRows`, `saveCoefficients`, `saveExamCounts`, `saveAllRules`, `applyOfficialRuleSet(db, seedData, reason)` — never captures, `resetToOfficial`); seeds in `main/db/education-catalogs/` (`subject-catalog.js`, `qualifiant-coefficients.js`, `subject-weights.js`, `exam-count-defaults.js`).
- **App-start upgrade:** `maybeApplyOfficialRuleSets(db)` in `main/db/init.js` (compares `OFFICIAL_RULES_SEED_REVISION` vs DB max revision).
- **IPC:** `main/ipc/stage-rules.js`; **preload:** `preload.js`.
- **Sync:** `main/sync/entity-registry.js` (4 entries, snapshot:false, contractVersion 2), `main/sync/capture.js` (4 channels), `main/sync/apply-hooks-stage-rules.js` (`revisionGuard` — skips stale remote PUTs, pull-side downgrade guard).
- **Renderer:** `js/cc-rules.js` (`ensureStageRuleSet(schoolYear)`, coefficient resolver, subject-weight resolver, `computeWeightedGeneralAverageResult` preflights the rule set), UI in `settings-defaults.html` («قواعد المرحلة» tab), audit filter in `settings-logs.html`.
- **Legacy (rollback-only):** `main/repos/subject-coefficients.js` (`readMappings` → `[]`, `overrideMapping` throws; channels `subjectCoefficients:*` retired; settings key kept for rollback).
- **Tests:** `tests/stage-rules-{repo,migration,resolver,upgrade}.test.js`, `tests/cc-rules-coefficient-golden.test.js`.
- **Spec/plan:** `specs/029-stage-rules-management/`, `docs/plans/2026-08-01-stage-rules-management.md`; sibling ownership: `docs/plans/2026-08-01-primary-stage-catalogs.md`.

## Primary stage catalogs (2026-08-01-primary-stage-catalogs)

The primary cycle is catalogued as `preview` (visible, read-only, never a work cycle); flow-slice work and `capability: 'supported'` are deferred.

### Cycle catalog SSOT (`js/shared/education/cycles.js`)

- Three entries: `primary` (preview, `sortOrder: 5`, `primary-2026-v1`), `secondary_collegial` (supported, `collegial-2026-v1`), `secondary_qualifiant` (supported). `listCycleCatalog` order = array order.
- `inferCycleFromSection` / `inferCycleFromLevel`: primary = anchored `[1-6]AP(?:-|$)` + Arabic `(الأولى|…|السادسة)\s*ابتدائي`. **Collegial `[123]APIC` is matched before the primary `[1-6]AP` branch** so `1APIC` never falls into primary; `1API`/`1APX` resolve to null.
- `resolveCycleForRequest` only counts `capability === 'supported'` cycles (`listUsableCycles`), so preview cycles never affect resolution.

### Level catalogs (S2)

- `main/db/education-catalogs/primary-levels.js`: `PRIMARY_LEVEL_CODES` (`1AP`–`6AP`), `COLLEGIAL_LEVEL_CODES` (`1APIC`–`3APIC`).
- `main/db/exam-count-defaults.js`: `QUALIFIANT_LEVEL_CODES` (alias of `LEVEL_CODES` — the legacy shape `appDefaults:listLevels` keeps returning without a cycle).
- `appDefaults:listLevels` accepts `{ cycleCode }` and serves the per-cycle catalog; unknown cycle → `UNKNOWN_CYCLE` (API only, no UI consumption yet).

### Subjects & aliases (S2/S3)

- Subjects are an **institution-wide shared catalog**: `education_subjects.subject_code` global PK; no `cycle_subjects` tables. Primary seeding = union `INSERT OR IGNORE` of missing codes only.
- `main/db/education-catalogs/primary-subjects.js` (`seedPrimarySubjects`), `primary-aliases.js` (`seedPrimaryLevelAliases`, `normalizeLevelAlias`).
- Alias collisions resolve **first-wins** via the global unique constraint: `الاجتماعيات` keeps pointing at `HISTORY_GEOGRAPHY` (qualifiant legacy); `SOCIAL_STUDIES` still gets its own subject row for the future stage-profile binding.
- Migration `2026-08-080-primary-stage-catalogs`: seeds `education_levels` (three cycles), subjects, `level_aliases`, and inserts the `institution_cycles` `primary` row via **direct idempotent SQL** — never `cyclesRepo.addCycle` (outbox capture side effects are rejected during migrations; seed rows are local data with zero outbox rows). No primary `exam_count_rules` (official rule pending; ownership = stage-rules plan).

### Section population (S5)

- `populateSectionsFromStudents` (`main/db/migrations.js`): never reclassifies a student with a non-empty `cycle_code`; students without one get catalog inference (primary-aware); unclassified rows are logged as `CYCLE_SECTION_UNCLASSIFIED` for operator review.
- **Tests:** `tests/primary-stage-catalogs.test.js` (S1–S3: inference, seeding idempotence, no-outbox, cycle-aware endpoint; S1 non-retroactive inference block).

### Multi-stage S1 slice (2026-08-02-multi-stage-school-architecture.md, §3 S1)

- **Three-state capability vocabulary** (`hidden` / `preview` / `supported`) is the only catalog vocabulary in `js/shared/education/cycles.js`; the pre-S1 `not_supported` alias is retired from the catalog (primary remains `preview`, while collegial is now `supported`). `normalizeCapability` survives only as a documented data-compat mapping for legacy DB rows.
- **Cycle-code constants live in the shared SSOT only**: `PRIMARY_CYCLE`, `COLLEGIAL_CYCLE`, `QUALIFIANT_CYCLE` exported by `js/shared/education/cycles.js`. Seeds/migrations (schema.js, migrations.js, init.js, education-catalogs seeds, stage-rules repo seeds) consume `QUALIFIANT_CYCLE`; no `'secondary_qualifiant'` literal remains under `main/` (grep `'secondary_qualifiant'` in `main/` must stay empty).
- **No runtime default to qualifiant** (G3 rule): `getContext` in `main/auth/active-cycle-context.js` no longer defaults the cycle (absent/unknown → `buildContext` throws); `resolveSubjectWeights` in `js/cc-rules.js` returns `{ ok: false, code: 'RULES_UNAVAILABLE' }` when the context carries no cycle instead of guessing qualifiant. Request/calculation paths must pass the cycle explicitly.
- Renderer page payloads (`js/pages/*`, `js/import-center/import-context.js`) still carry explicit `'secondary_qualifiant'` payloads — S5 scope (consume `resolveCycleForRequest`), not an S1 violation.

### Multi-stage S2 slice (2026-08-02-multi-stage-school-architecture.md, §3 S2)

- **Qualifiant level catalog SSOT**: `js/shared/education/qualifiant-levels.js` (dual-export IIFE, global `EducationQualifiantLevels`) is the single source for the 41 qualifiant levels — `QUALIFIANT_LEVELS` (array, no `*` row), `LEVEL_CODE_TO_AR` (map), `LEVEL_KEYS_DESC`, `matchLevelFromSection`. `main/db/exam-count-defaults.js` (`LEVEL_CODES`) and `js/utils.js` (`LEVEL_CODE_TO_AR`, `getLevelFromSection`, `sortLevelNames`) are thin references — never redefine level data inline. Pages using `getLevelFromSection`/`LEVEL_CODE_TO_AR` must load the module script before `js/utils.js` (already done: exam-papers, grades-sheets, students-orientation, students-status, settings-imports).
- **Legacy `*` row lives only in `appDefaults:listLevels`** (prepended for the no-cycle and qualifiant paths as the compat adapter); it is not part of any catalog.
- **Cycle-aware exam counts (fail-closed)**: `resolveExamCountRow`/`examCountSource`/`lookupExamCount` and `appDefaults:getExamCounts`/`getExamCount`/`saveExamCounts` accept `cycleCode` (default qualifiant for legacy payloads). Primary reads return the 8 seeded subjects with `examCount: null` + `source: 'missing'` + `assessmentModel` from the catalog (`'continuous'` on the primary entry of `js/shared/education/cycles.js`); collegial reads use its catalog and official rule rows, returning `null`/`missing` for any unseeded subject; unknown cycles → `UNKNOWN_CYCLE`. `saveExamCounts` stamps the cycle on every entry so the repo guard `requireQualifiantCycles` rejects non-qualifiant writes with `FORBIDDEN` — never weaken it.
- **Tests**: `tests/qualifiant-level-catalog.test.js`, `tests/appdefaults-exam-counts-cycle.test.js`, `tests/primary-assessment-model.test.js` (primary write guard + seed invariant: zero primary rows in `subject_coefficients`/`exam_count_rules`/`subject_weight_rules`).

### Multi-stage S4 slice — cycle profiles & effectivity spine (2026-08-02-multi-stage-school-architecture.md, §3 S4, rows 105-115)

- **`cycle_profiles`**: official immutable stage profiles, logical key `(cycle_code, profile_version)`, columns `uses_coefficients` (0/1) + `assessment_model` (`exams`/`continuous`/`exams_activities`). Seeded: `primary/primary-2026-v1` (continuous, 0), `secondary_collegial/collegial-2026-v1` (exams + integrated activities, 1), and `secondary_qualifiant/qualifiant-2026-v1` (exams, 1). `default_exam_counts` is never recreated anywhere (`exam_count_rules` is the sole source — row 107).
- **`cycle_profile_assignments`**: one row per `(school_year, cycle_code)` binding `profile_version` + `rule_set_id` (FK `stage_rule_sets`). **Runtime-authoritative**: `rule_set_id` must be non-null exactly when the profile uses coefficients and must reference the active revision of the SAME school year; NULL for continuous profiles. `CYCLE_CATALOG.profileVersion` / `institution_cycles.profile_version` are seed/migration hints only (row 110) — never used to resolve effectivity.
- **Strict repo guards** (`main/repos/stage-rules.js`): `resolveProfileForCycle` throws `RULES_UNAVAILABLE` when the table or row is missing (never guesses `uses_coefficients` — row 114); `getActiveProfileForCycle(db, year, cycle)` is the runtime-authoritative profile resolver — it returns the profile the assignment POINTS AT (never the newest version) and throws `RULES_UNAVAILABLE` on a dangling assignment; `assignActiveProfile` refuses coefficient-without-rule-set, continuous-with-rule-set, missing rule set, and cross-year rule sets; `getActiveRuleSetForCycle(db, year, cycle)` is the assignment-based resolver (never falls back to `getActiveRuleSet`) and also verifies the assigned `profile_version` still resolves. Every version-copy save (`saveCoefficients`/`saveExamCounts`/`saveAllRules`/`resetToOfficial`) and `applyOfficialRuleSet` re-binds the assignment inside the same transaction; `captureRevisionRows` also captures the year's assignment row(s).
- **Migration `2026-08-082-cycle-profiles`**: canonical DDL `ensureCycleProfilesSchema(db)` in `main/db/schema.js` (includes the composite FK `(cycle_code, profile_version)` → `cycle_profiles` on `cycle_profile_assignments`); seeds profiles + backfills qualifiant assignments for ACTIVE rule-set years via direct idempotent SQL (`INSERT OR IGNORE` profiles, `ON CONFLICT(school_year, cycle_code) DO UPDATE` assignments) — local seed data, zero outbox rows. **Migration `2026-08-083-cycle-profile-assignments-fk`** (recordsVersionInternally, pattern 065) rebuilds `cycle_profile_assignments` with that FK on upgraded DBs so every install enforces the same constraint. Official profiles are content-immutable: `checkCycleProfileConsistency` refuses a pulled PUT that changes an existing row's content (a new official file ships as a NEW `profile_version`), while identical re-pulls pass.
- **Sync contract** (`main/sync/entity-registry.js`): both tables registered `snapshot: false`, `contractVersion: 2`, `requiredColumns` (`cycle_profiles`: `cycle_code`,`profile_version`; assignments: `school_year`,`cycle_code`,`profile_version`), `minAppVersion: '1.0.42'`, remote collections `cycleProfiles` / `cycleProfileAssignments`, writers `admin`/`principal`. The version-gate API (`getMinAppVersion`, `getLocalAppVersion` (electron `app.getVersion`, null → gate skipped), `setLocalAppVersionForTests` seam, `compareSemanticVersions` (pure, null on unparseable), `checkAppVersionGate`) is owned by the registry — compare with semantic-version semantics, never string order.
- **Sync apply** (`main/sync/engine/apply.js`): after the §9.2 contract gate, the version gate (row 112) and `checkCycleProfileConsistency` (row 113, `main/sync/apply-hooks-stage-rules.js` — mirrors the repo checks incl. `isKnownCycleCode` from `js/shared/education/cycles.js`, PUT-only; also enforces profile content-immutability: a pulled PUT that changes an existing profile row's `uses_coefficients`/`assessment_model` is refused, identical re-pulls pass) each route failures to `recordPullQuarantine` — the row is held for replay, never written half-consistent, and never holds the pull cursor. `TOPO_ORDER_PUT` in `engine/helpers.js` applies `cycle_profiles` before `cycle_profile_assignments`, after the stage-rule tables.
- **IPC**: `stageRules:getActive` returns `{ ruleSet, rows, profiles, assignments }` (no new channels; the repo captures assignment rows alongside each revision).
- **Tests**: `tests/cycle-profiles.test.js` (registry declarations, version-gate helpers, migration seeds/backfill/idempotence/no-outbox, repo effectivity + `RULES_UNAVAILABLE` refusals, consistency-check unit cases, engine-apply quarantine vs apply). Fixture pattern: canonical `cycle_profiles` shape (with `profile_version` column) in `stage-rules-repo.test.js` §12a, `stage-rules-upgrade.test.js` §7, `appdefaults-exam-counts-cycle.test.js`, `primary-assessment-model.test.js` (primary write guard + zero primary assignments).

### Multi-stage S5 slice — renderer wiring (2026-08-02-multi-stage-school-architecture.md, §3 S5, rows 119-123)

- **Catalog-driven stage selector** (`js/pages/settings-defaults.js`): hardcoded `STAGE_CYCLES` replaced by `window.api.cycles.getCatalog()` — `hidden` cycles filtered out, `preview` shown with suffix «قيد الإعداد», `supported` selectable; default resolved via `cycles.getActive()` with fallback to first supported → first catalog entry (lines ~474-503). Cycle select rendering ~981; `stageSelectedCycle()`/`stageWeightFor()` null-safe; `loadStageLevels(cycleCode)` passes the cycle (~990-991); `loadStageRules` ingests `res.profiles` (~1022-1023); init order `loadStageCycles → initStagePickers → loadStageLevels` (~1307-1310).
- **Cycle-transfer generalization** (`js/pages/teachers-list.js`): «نقل للسلك الآخر» binary buttons replaced by one «نقل إلى X» button per other usable cycle — `loadUsableCycles()` uses `window.api.cycles.list()` filtered `is_active && supported` + `otherUsableCycles` (~601, 766).
- **Exams-schedule optgroup** (`exams-schedule.html:422`): «الابتدائي والإعدادي» optgroup (`id="non-qualifiant-exam-optgroup"`) bound to the real catalog via inline script — hidden unless `primary`/`secondary_collegial` is `supported`; fail-closed on catalog error (~1046-1069).
- **Hardcoded-payload sweep (row 123)**: 9 renderer call sites now pass the resolved active cycle instead of the literal `'secondary_qualifiant'` — `js/pages/analytics.js` (2), `js/pages/results-hub.js` (3), `js/pages/students-list.js` (1), `js/pages/student-profile.js` (2), `grades-results.html` (1); `js/import-center/import-context.js` + settings-defaults.js payloads consume the same pattern. `activeCycleCode` resolves via `cycles.getActive()` in init; when unavailable it flows to `buildCoefficientContext` (legacy `CC_BRANCH_COEFFICIENTS` fallback) — no runtime cycle guessing.
- **appDefaults cycle-awareness** (row 122) was completed in the S2 slice (`resolveExamCountRow`/`lookupExamCount`/`getExamCounts` + repo guard `requireQualifiantCycles`). The row-124 compat-adapter removal in `appDefaults:listLevels` is deliberately deferred until a full release cycle passes with no legacy caller — do not delete the `*` row early.
- **Tests/quality**: no new test files in S5 (UI slice); agents' changed files lint-clean, full suite re-verified green post-merge.

### Multi-stage S6 slice — `user_cycle_access` management (2026-08-02-multi-stage-school-architecture.md, §3 S6, rows 128-130)

- **Sync decision: local-only (row 130)**. Reasons: (1) `users` is not a sync entity — user IDs are per-device, so a synced access row could not resolve its FK target on another device; (2) it is an authorization policy, not school data — same rationale as the device-local page-access permissions («App Defaults and Page Access»); (3) per-device trust/installation model. Consequences: **no** `entity-registry.js` entry, **no** sync hooks; both channels are `exclude: true` in `main/sync/capture.js` CHANNEL_REGISTRY (no outbox capture).
- **IPC channels** (`main/ipc/cycle-access.js`): `cycleAccess:list` via `handleAuthedRead(admin)`; `cycleAccess:setUsers` / `cycleAccess:setCycles` via `handleWriteSoftAuth(admin)` (admin only — never grants management to principal). All SQL lives in `main/auth/cycle-access.js` (repo layer, never in IPC); registered in `main/ipc/registerAll.js`; preload: `window.api.cycleAccess.{list, setUsers, setCycles}`.
- **Repo guards** (`main/auth/cycle-access.js`): `CYCLE_ACCESS_ERROR_CODES` SSOT; `setUserCycles`/`setCyclesForAllUsers` transactional; `assertKeepsLastUsableCycle` (row 129) enforced at repo level so no caller (IPC or future remote path) can disable/revoke the last usable supported cycle — codes `LAST_USABLE_CYCLE`, `USER_NOT_FOUND`, `UNKNOWN_CYCLE`, `CYCLE_NOT_IN_INSTITUTION`, `FORBIDDEN`. Cannot revoke `developer`/`admin`/`principal` roles.
- **UI** (`settings-users.html` + `js/pages/settings-users.js`): «صلاحيات الأسلاك» admin section (hidden for non-admin), user×cycle checkbox matrix, per-user save, per-cycle enable/disable for all with `showConfirm`, capability hints («قيد التفعيل» / «متاح»).
- **Orientation row 132 (partial)**: `main/repos/orientation.js` insert branch skips rows with no student-roster match (`reason: 'no_matching_student'`, counted in `skipped`, reported in `unresolvedCycle`, ~626-635) instead of writing a NULL-cycle row — gated on `hasStudentCycleCode` so pre-081 fixtures keep the legacy NULL-write fallback. **Deliberately deferred**: rejecting students «غير المنتمي للسياق» (context-cycle membership) — the institution-wide orientation exception stays pinned by `tests/s0-cycle-gate.test.js`; do not enforce until a future slice makes `user_cycle_access` the basis for it.
- **Tests**: `tests/cycle-access-management.test.js` (IPC auth matrix — teacher FORBIDDEN on all 3 channels, registry/capture exclusion asserts, LAST_USABLE_CYCLE via IPC and repo-direct, legal multi-grant/disable round trips, UNKNOWN_CYCLE / CYCLE_NOT_IN_INSTITUTION / USER_NOT_FOUND); `tests/cycle-access.test.js` extended with the S6 block.

## Top-bar stage switcher (2026-08-02-topbar-cycle-switcher)

The stage switcher is a **single global control in the top bar** (`js/sidebar.js`), injected into `.header-right` on every page (no per-page HTML edits; pages without `.header-right` are skipped). It replaced the old sidebar switcher (`#sidebar-cycle-switcher` removed).

- **Options**: every **active** institution stage appears in the dropdown — `preview` rows rendered **disabled** with a «قيد الإعداد» label suffix so the user sees why they are not workable; only `capability === 'supported'` rows are selectable; inactive rows never appear. Pure helper `window.buildCycleSwitcherOptions(cycles, activeCycleCode)` returns `{value, label, selected, disabled}`.
- **States**: 0 active stages → wrapper hidden; fewer than 2 selectable (supported) stages → visible disabled indicator listing all active stages (preview greyed out, no switch possible); 2+ selectable → active switcher with the session stage (`getActive` → `context.cycleCode`) pre-selected.
- **Switch flow**: dirty-page guard (`[data-unsaved-changes="true"]` + cancelable `app:beforeCycleChange`, unchanged contract) → `cycles.setActive(value, getSchoolYear())` → reload on success, revert + toast on failure.
- **Wiring**: `window.refreshCycleSwitcher` / `window.loadTopbarCycleSwitcher` (same function; `settings-school.js` calls the former unchanged); `cycles.onConfigurationChanged` subscribed at module level (independent of the sidebar).
- **No IPC/preload/DB/sync changes.** Tests: `tests/cycle-switcher.test.js` (vm DOM harness — 13 cases covering the pure builder, all three states, the guard, reload/revert, idempotence, and the subscription).

## Stage isolation (2026-09-27 isolation plan, implemented 2026-10-01)

Collegial vs qualifiant are isolated domains in one DB: schema (`cycle_code NOT NULL` + composite child-owner FKs, migration `2026-09-087`), resolver (per-stage rules, 4-step contract, no `cycle '*'` wildcard), auth (`user_cycle_access`), UI (stage-aware components + switcher cache invalidation).

- **Child-owner consistency**: `FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)` on correspondence/student_files/student_movements/student_profile_data (+ `UNIQUE(id, cycle_code)` on students); pull-side mirror `checkStudentChildCycleConsistency` (`main/repos/student-cycle.js`, wired in `main/sync/engine/apply.js`) routes mismatches to `recordPullQuarantine`. Gate-1 ADR + orphan/backfill policy live in the 087 migration header comment.
- **Resolver**: `specs/029-stage-rules-management/contracts/resolver.md` is 4-step (cycle-default deleted); missing cycle fails closed (`RULES_UNAVAILABLE`), unseeded fails `MISSING_RULE`. `stageRuleSetCache` keyed by `(schoolYear, cycleCode)`; `clearStageRuleSetCache()` on switch. `getSubjectWeights()` is a legacy display shim: rule hits carry `isAuthoritative: true`, constant fallback is explicitly `provisional` — authoritative paths must use `resolveSubjectWeights()` directly.
- **Transition seam**: `stageTransition:transferStudent` (`main/ipc/stage-transition.js` + `main/repos/stage-transition.js`, table `student_stage_transitions` via `2026-10-088`, explicit capture + `exclude: true` registry entry). Inter-year progression creates the toYear row; intra-year reclassification realigns child rows in-transaction. Dual-cycle actor authorization enforced in repo (never IPC-only).
- **Carve-outs (institution-wide by design, Slice 0)**: reports engine (render-only; `identity.js` exempt), school events, system tags, compensation (row-131-like), exam-center config (venue ops). Each carries an `ISOLATION-CARVEOUT` marker; `scripts/check-invariants.js` Check D pins markers + bans `cycle_code`/school-data queries there. Scoping any carve-out needs an ADR + tests.
- **Tests**: `tests/collegial/*` + `tests/qualifiant/*` suites + constitution test, wired in `tests/run-all.js` group 5; registry tail pinned `[087, 088]` in `tests/s1-student-child-cycle-migration.test.js` (extend deliberately when appending migrations).
- **Level routing (gate 2)**: KEEP the 08-03 mechanism (official names via `listLevels`/`classes:getAll`); grading derivation only via the collegial policy in `js/cc-rules.js` (ADR note in `js/pages/settings-defaults.js`). Do not implement route-by-active-cycle display.
- **Stage config**: `main/repos/stage-config.js` (device-local calendars/terms/attendance) + `stageConfig:get/list/save` IPC (`main/ipc/stage-config.js`, `exclude: true` — never synced) consumed by the settings-defaults stage tab.
- **Stage thresholds (Slice 2)**: `js/shared/education/stage-thresholds.js` (dependency-free dual-export IIFE, collegial-levels pattern) is the SSOT for mention/grade-comment vocabulary. Qualifiant 5-band mention + 6-band comment scales are verbatim extracts (the two wordings are intentionally NOT unified — official-document change needs a product decision). Fail-closed: known-unseeded stage → `MISSING_RULE` (pages render averages without words + one shared notice); unknown/missing stage → legacy display (same precedent as the row-123 coefficient fallback). Consumers: results-hub, analytics, reports-semester, grades-results (wiring pinned in `tests/stage-thresholds.test.js` §5; partition property in §6). Colors/CssVars stay per-page (styling, not stage data); `PASS_MARK=10` is system-wide. Preserved quirk: analytics distribution buckets keep the legacy `max - 0.01` edges (exact `*.99` grades fall through uncounted, as before) — fix separately, not inside a migration.

<!-- MANUAL ADDITIONS END -->

## App Defaults and Page Access

Page-access permissions and exam-count defaults are device-local application settings stored in the local SQLite database. They are intentionally excluded from sync and must be configured independently on each deployed device.

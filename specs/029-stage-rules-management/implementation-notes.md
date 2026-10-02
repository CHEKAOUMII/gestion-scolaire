# Implementation Notes — Stage Rules Management (029)

**Status:** Implemented (2026-08-02) — all five user stories, tests 241/241, lint 0 errors.
**Branch:** `029-stage-rules-management`

## What was built

- **Schema helper:** `ensureStageRulesSchema(db)` in `main/db/schema.js` — `stage_rule_sets`
  (UNIQUE(school_year, revision), status CHECK draft/active/closed, partial unique index =
  one active per year), `subject_coefficients` (dims + source CHECK official/custom in the
  logical UNIQUE, coefficient CHECK 1..20), rebuilt `exam_count_rules` (dims + source,
  exam_count CHECK 1..12).
- **Migration `2026-08-001-stage-rules-management`** (idempotent, zero outbox rows):
  legacy `exam_count_rules` renamed → dropped after rebuild; one active revision-1 rule set
  per school year present in `students` (fallback: `currentSchoolYear` setting); official
  coefficients seeded; exam counts backfilled via subject catalog/aliases with unmappable
  rows logged as `STAGE_RULE_MIGRATION_UNMAPPABLE` (never guessed); legacy settings key
  `subjectCoefficientMappings:v1` migrated to custom rows (e.g. mathematics → coefficient 7,
  stream 2BACSMA), key kept rollback-only.
- **Seeds:** `main/db/education-catalogs/subject-catalog.js` (48 subject codes, 156 aliases,
  `mapSubjectToCode`, `seedSubjectCatalog`) and `qualifiant-coefficients.js` (15 branch keys,
  194 official rows, `getOfficialCoefficientRows`, `seedOfficialCoefficients`).
- **Repo `main/repos/stage-rules.js`:** `getActiveRuleSet`, `getRuleSetRows`,
  `saveCoefficients`, `saveExamCounts`, `applyOfficialRuleSet(db, seedData, reason)`
  (never captures), `resetToOfficial`. Every write: new revision = max+1, previous active →
  closed, custom upserts only (official rows never written by the user path), audit
  `STAGE_RULE_OVERRIDE` in `system_logs`, explicit outbox capture inside the repo
  transaction via capture-port.
- **IPC `main/ipc/stage-rules.js`:** `stageRules:getActive` (handleAuthedRead),
  `saveCoefficients` / `saveExamCounts` / `resetToOfficial`
  (handleWriteSoftAuth admin+principal, cycle auth via `resolveCycleForRequest` +
  `user_cycle_access`), error mapping to the 029 contract codes; preload
  `window.api.stageRules.*`; primary cycle (`uses_coefficients = 0`) write-blocked FORBIDDEN.
- **Sync:** 3 registry entries (snapshot:false, contractVersion 2, rule_set_id-scoped keys),
  3 explicit+exclude channels in `capture.js`, `revisionGuard` apply hook
  (`{ defer: true }` on stale remote PUTs — pull-side downgrade guard).
- **Renderer:** `js/cc-rules.js` rewritten — `ensureStageRuleSet(schoolYear)`, 5-step
  precedence resolver (exact → stream wildcard → level wildcard → cycle default →
  MISSING_RULE), `RULES_UNAVAILABLE` on IPC failure (no silent fallback to constants),
  `computeWeightedGeneralAverageResult` preflights the rule set; export gates
  (`grades-results.html`, `student-profile.js`) block official export via
  `isOfficialExportAllowed`. «قواعد المرحلة» tab in `settings-defaults.html` with version
  badge, mandatory reason, closed-version lock, per-row + bulk restore (confirm required),
  audit filter in `settings-logs.html`.
- **Legacy retired (rollback-only):** `subjectCoefficients:*` channels removed,
  `main/repos/subject-coefficients.js` → `readMappings` returns `[]`, `overrideMapping`
  throws; settings key untouched; legacy audit action stays readable.

## Decisions & deviations from plan

1. **Cycle blocking:** `cycle_profiles` table is owned by the sibling plan and did not exist
   yet — the repo checks `sqlite_master` defensively: table missing → writes allowed
   (qualifiant default); row with `uses_coefficients = 0` → `FORBIDDEN`.
2. **`INSERT OR IGNORE` + SELECT id** for rule-set creation in the migration (partial
   unique index breaks naive re-runs); exam-count seeding only when the rule set has zero
   exam rows (prevents default-seed duplication on re-run).
3. **Default exam-count seeds collapse duplicates:** `التاريخ والجغرافيا` and
   `الاجتماعيات` both map to `HISTORY_GEOGRAPHY` → 14 distinct rows instead of 15
   (verified by test).
4. **Deprecated compat shims** (`ensureSubjectCoefficientMappings`, etc.) kept in
   `js/cc-rules.js` so legacy pages don't throw at load; all pages were migrated to
   `ensureStageRuleSet` in T021.
5. **`applyOfficialRuleSet` seed contract:** `seedData = { revision, cycleCode,
   coefficients, examCounts }` with snake_case rows lacking `rule_set_id`; created revision
   is always max+1 (the seed `revision` is metadata only). Seed path intentionally writes
   no audit and no outbox.

## Verification

- `npm test` → 241/241 (includes new `tests/stage-rules-{repo,migration,resolver,upgrade}.test.js`
  and rewritten `cc-rules-coefficient-golden` / `subject-coefficients-repo`).
- `npm run lint` → 0 errors (55 pre-existing warnings, unchanged).
- `npm run test:smoke` → all checks passed; IPC parity 241 channels.
- `npm run css:build` → clean.
- better-sqlite3 binary is broken under system Node v24 on this machine (ABI mismatch);
  all tests run on the `node:sqlite` fallback driver which the suites support explicitly.

## Open items (out of scope, deferred)

- `subject_weights` (activity weights) — later slice W.
- Main-side export gate at `reports:printDocument` (renderer-supplied metadata follow-up).
- `draft` status is reserved; saves create `active` immediately.

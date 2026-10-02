# 2026-08-01-primary-stage-catalogs — Implementation Notes

Status: **S1, S2, S3, S5, S6 done** (2026-08-02) — S4 (`cycle_profiles`) deferred to the
flows slice with `capability` promotion. Sibling plan: `2026-08-02-multi-stage-school-architecture.md`.

## What shipped

- `js/shared/education/cycles.js` — `primary` catalog entry (`preview`, `sortOrder: 5`,
  `profileVersion: 'primary-2026-v1'`); inference extended with anchored `[1-6]AP(?:-|$)`
  and Arabic `(الأولى|…|السادسة)\s*ابتدائي`. Collegial `[123]APIC` is matched first so
  `1APIC` never falls into primary; `1API`/`1APX`/`9AP` stay null.
- `main/db/education-catalogs/primary-levels.js` — `PRIMARY_LEVEL_CODES` (1AP–6AP),
  `COLLEGIAL_LEVEL_CODES` (1APIC–3APIC). `QUALIFIANT_LEVEL_CODES` export added in
  `exam-count-defaults.js` (alias of `LEVEL_CODES`; legacy shape preserved).
- `main/db/education-catalogs/primary-subjects.js` — 8 primary subjects; union
  `INSERT OR IGNORE` seeding (shared codes reused: ARABIC/MATH/ISLAMIC_EDUCATION/FRENCH;
  new: SCIENCE_ACTIVITY, SOCIAL_STUDIES, ARTS_EDUCATION, PHYSICAL_MOTOR_EDUCATION).
- `main/db/education-catalogs/primary-aliases.js` — cycle-scoped `level_aliases`
  (السنة الأولى → 1AP … السادسة → 6AP + ordinals + codes), `normalizeLevelAlias`.
- `main/db/migrations.js` — `2026-08-080-primary-stage-catalogs`: seeds
  `education_levels` (three cycles, `*` marker excluded), subjects/aliases union,
  and the `institution_cycles` `primary` row via direct idempotent SQL. Zero outbox rows.
  No primary `exam_count_rules` (ownership = stage-rules plan).
- `main/ipc/appDefaults.js` + `preload.js` — `appDefaults:listLevels({ cycleCode })`
  serves the per-cycle catalog; unknown cycle → `UNKNOWN_CYCLE`. No UI consumption.
- `populateSectionsFromStudents` — never reclassifies an explicit `cycle_code`; students
  without one get primary-aware inference; unclassified rows are logged
  `CYCLE_SECTION_UNCLASSIFIED` (operator review, §13 style).

## Verification

- `tests/primary-stage-catalogs.test.js` — S1 inference (anchored 1AP vs 1APIC, Arabic
  patterns, conflict → null), S3 seeding idempotence + no-outbox (row-count comparison),
  alias first-wins (`الاجتماعيات` → `HISTORY_GEOGRAPHY`), cycle-aware endpoint.
- Updated: `tests/cycles-context.test.js` (catalog size 3 + primary preview),
  `tests/cycles-repo-ipc.test.js` (unknown-cycle example + catalog order).
- `npm test`: 244/244. `npm run lint`: 0 errors (55 pre-existing warnings elsewhere).

## Decisions honored

1. Subjects stay an institution-wide shared catalog — union seeding, no `cycle_subjects`.
2. `exam_count_rules` rebuild + versioning stayed with the stage-rules plan (migration
   `2026-08-001` already shipped with `rule_set_id`/`cycle_code`).
3. No `coefficient: null` anywhere; `usesCoefficients: false` arrives with `cycle_profiles` (S4).
4. `institution_cycles` primary row seeded by direct SQL inside the migration — never
   `cyclesRepo.addCycle` (outbox capture + `notifyCaptureCommitted` are rejected during
   migrations). `institution_cycles` remains a normal synced table for later IPC ops.
5. No UI in this slice — API-only extension of `appDefaults` points.
6. `resolveCycleForRequest` is cycle-neutral by construction: `listUsableCycles` filters
   `capability === 'supported'`, preview cycles never count.

## Remaining (deferred)

- S4: `cycle_profiles` + `cycle_profile_assignments` tables (immutable, versioned,
  `assessment_model`, `uses_coefficients`, no `default_exam_counts`), `grades.semester`
  profile-driven reading.
- S6-(3): cycle_profiles immutability/assignment tests.
- Primary import flow, result/certificate templates, stage switcher UI, per-cycle page
  permissions, `capability` promotion → `supported`.

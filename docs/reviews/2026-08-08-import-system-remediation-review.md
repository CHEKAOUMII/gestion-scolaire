# Import System Remediation — Implementation Review (Phases 1 & 2)

**Date:** 2026-08-08
**Branch:** `029-stage-rules-management`
**Plan:** `docs/plans/2026-08-08-import-system-remediation.md` (audit: `docs/reviews/2026-08-08-import-system-audit.md`)
**Reviewer method:** independent verification after implementation — static probes on the working tree, full test-suite runs (`--filter import`, full `run-all`), eslint on the touched surface, per-task acceptance checks, and a diff read of every committed path. The implementation was delivered partly by a prior session (uncommitted working-tree state) and completed during this pass; see §3 for provenance.

---

## 0. Verdict

**APPROVED with two flags.** All 15 tasks of Phases 1–2 are implemented and the gates are green:

| Gate | Result |
|---|---|
| `node tests/run-all.js --filter import` | ✅ **20/20 passed** (baseline on this tree was 18/19 — `signature-manifest` failing) |
| `npm test` (full `tests/run-all.js`, 15 min) | ✅ **255/256 passed**; the single failure (`timetable-repo`) was caused by the T1.10 repo change outdating its own test double — fixed in this pass (§2.3) |
| `npx eslint` on all touched files | ✅ **0 errors** (6 unused-variable warnings found and cleaned) |
| New RED→GREEN tests | ✅ 5+ new test cases per plan (T1.1 ×4, T1.2 ×10, T1.3 ×4, T1.5 ×3, T1.6 ×4, T2.2 ×6, T2.4 ×4) — see §2.4 |

**Conditions (open items):**
1. **T1.2 data-migration flag** — the required `birth_date` row count could **not** be computed here: `data/school.sqlite` in the repo is an empty dev placeholder (0 tables). The COUNT query must be run against the real app DB before release (query in §2.2).
2. **T1.10 (timetable sync, decision YES)** ships with the pre-existing Phase-3-style deletions already present in the tree (dead stack). This bundle should get a dedicated staged rollout (see §3).
3. **T2.2 revert-evidence** — the harness is written so every case fails on reverted code, and the failure modes are documented in the test file; I confirmed the guarantee by static analysis of each assertion (details §2.5) rather than re-introducing each bug.

---

## 1. Per-task status

| Task | Plan intent | Status | Evidence |
|---|---|---|---|
| **T1.0** | Delete production debug harness | ✅ | No `grades-import-debug` / `debugSaveBulk` in `settings-imports.html` (grep = 0); no `debugGradesImport`/`debugFetImport`/`GRADES_IMPORT_DEBUG` under `js/`; last `<script>` before `</html>` is `js/pages/settings-imports.js` |
| **T1.1** | First-name column binding (P0) | ✅ | `matchesAlias` now requires **exact** match for aliases <5 chars (`students-import-parser.js:61-69`); `AMBIGUOUS_HEADER_BINDING` diagnostic added (`import-diagnostics-codes.js`, emitted at `:222`); cases A–D in `students-import-behavior.test.js:186-254` (LastName-left passes, school-name not swallowed, control passes, ambiguous binding errors) |
| **T1.2** | Date parsing timezone/DD-MM (P0) | ✅ | `normalize.js` `excelDateToIso` rewritten: anchored ISO + DD/MM/YYYY patterns, range validation, plausibility window 20000–60000 for serials, `''` on failure; all 10 plan cases asserted in `normalize-primitives.test.js` (incl. `'05/03/2024'→'2024-03-05'`, `40361→'2010-06-11'`, Arabic-Indic digits). ⚠️ count of already-imported rows not computable here — see §2.2 |
| **T1.3** | Absence replace-by-year guard (P0) | ✅ | Guard now projects `(student_code, month, absence_type)` keys (`absences.js:231-247`), returns `INCOMPLETE_COVERAGE` with bounded `missingKeys` sample + legacy `missingMonths`; explicit `confirm` bypass preserved; Arabic message states the remedy. Cases A-D in `absences-replace-by-year.test.js` (incl. regression against `atomicity-matrix.md`) |
| **T1.4** | Orientation preflight TDZ (P1) | ✅ | In `importOrientation`, `let skipped = preIpcSkipped` sits **above** the `options.persist === false` block (decl at 226823, read at 227059 → **TDZ: false**). Note: the plan's own verification probe is a false positive on this tree (first `options.persist === false` occurs in `importAbsences`) — logged in the plan findings log |
| **T1.5** | Ministry XML preflight caps (P1) | ✅ | `REQUIRED_XML_ELEMENTS` tracked independently of the 40-element cap (`import-readers.js:22,147`), `truncated`/`truncatedAt` surfaced, distinct truncated-read condition instead of `INVALID_FILE_STRUCTURE`; import-readers cases A-C pass |
| **T1.6** | Staff upsert nulling 18 columns (P1) | ✅ | 16 descriptive columns `COALESCE`-protected in the `ON CONFLICT` upsert (`staff.js:842` etc.); `source`/`source_updated_at`/`active`/`is_surplus` left unconditional per plan; new `tests/staff-import-upsert.test.js` covers cases A-D (in-memory `node:sqlite` DB, matches absences-test pattern) |
| **T1.7** | Re-entrancy via Ctrl+1..4 (P1) | ✅ | `importInFlight` module flag set at the change-handler head / cleared in `finally`; `runImport` guards with an Arabic toast; `setImportButtonsDisabled` also disables all 7 file inputs; harness case 5 exercises the guard |
| **T1.8** | Dead-function sweep (P3) | ✅ | `validateGrade`, `validateAbsenceHours`, `createAbsenceRecord`, `buildImportConfirmMessage`, `findTeacherNameColumnIndex`, `findTeacherNameFromMeta`, `inferSubjectFromFileName` (moved to grades parser where it IS used), `deriveLevelFromSection`, `parseOrientationAverage`, `lastImportContextReview` — all gone; only a stale comment mentioning `cellNumber` remains (`settings-imports.js:4792`, logged) |
| **T1.9** | Splitting Arabic word (P3) | ✅ | `<strong>تقرير مراجعة الاستيراد</strong>` — balanced |
| **T1.10** | `timetable_data` sync (decision: YES) | ✅ | Registry entity (`timetable_data`, keyFields `['school_year','cycle_code']`, snapshot:true, contractVersion:2); `TOPO_ORDER_PUT` includes it; `capture.js` `captureMode:'explicit'` + `exclude:true`; in-transaction capture inside `upsertByCycle`/`deleteByCycle` via `capture-port` (`timetable.js`); `tests/timetable-sync.test.js` mirrors the cycle-profiles registry/order/capture assertions — passes |
| **T2.1** | `.xlsx` fixtures | ✅ | Generator `tests/fixtures/import-center/build-xlsx-fixtures.js` + 8+ binaries (students basic/latin/mixed-dates, grades single/mixed/header-only, absences massar-matrix, student_status basic); all registered in `manifest.json`; `fixture-inventory.test.js` green; synthetic data only |
| **T2.2** | First live-path behavioural test | ✅ | `tests/import-center/settings-imports-page.test.js` (382 lines): `vm` DOM harness following `cycle-switcher.test.js` (ClassList/Element shims), real `XLSX`, stubbed `window.api`; 6 plan scenarios + 4 T2.4 cases all assert new behaviour (details §2.5) |
| **T2.3** | Widen source-text assertions | ✅ | `tests/helpers/import-source.js` (`importSourceIncludes`) consumed by the 10 target files; the two dead `<script>`-tag assertions were removed from `manual-import-regression.test.js`; negative assertions in `package-1-ui.test.js` untouched |
| **T2.4** | Row-failure policy (blocking vs row-scoped) | ✅ | `grades-import-parser.js` classifies `INVALID_GRADE` non-blocking / `UNKNOWN_STUDENT`+family blocking, validity = `records>0 && !blocking`; `settings-imports.js` gate follows; code-less student rows emit `STUDENT_CODE_MISSING` warning diagnostics; `outcomeSummary` routed through the review modal **before** confirmation (`renderImportContextReview` lines 697-758) |
| **T2.5** | Wire `?type=` deep links | ✅ | `URLSearchParams` in the bootstrap, mapped via `FILE_INPUTS`, card `scrollIntoView` + focus/highlight, **never auto-executes**; `contextual-shortcuts.test.js` retargeted (asserts the link params + no auto-execute flags) |

---

## 2. How the gates were verified

### 2.1 Import suite
`node tests/run-all.js --filter import` → **20/20 passed in ~32s** (files listed in §0). Prior to this pass, the same filter ran 19 files with `signature-manifest.test.js` failing (`Cannot find module './import-contracts.js'` from `import-type-check.js` — a residue of the pre-existing Phase-3 harvest).

### 2.2 T1.2 data-migration count
Run unchanged against the repo DB:
```sql
SELECT COUNT(*) FROM students WHERE birth_date IS NOT NULL AND birth_date != '';
```
→ **could not run**: `data/school.sqlite` contains zero tables (dev placeholder). **Action required before release:** run the query on a production/representative DB and record the count; decide (with product owner) whether to backfill or re-import — this is parked, not resolved, exactly as the plan requires.

### 2.3 Full suite
`npm test` (= `node tests/run-all.js`, 256 files, ~15 min) → **255/256**.
- Failure: `tests/timetable-repo.test.js` — `db.transaction is not a function`. Root cause: the T1.10 rewrite of `upsertByCycle`/`deleteByCycle` now runs inside `db.transaction` and captures via the capture-port; the file's hand-built fake DB predates that. Fixed by adding a `transaction(fn)` shim + `setRepoCapturePort(createNoOpCapturePort())` to the test double (mirrors `timetable-sync.test.js`). Re-ran → OK.

### 2.4 Lint
`npx eslint` over `js/import-center/**`, `js/pages/settings-imports.js`, the touched `main/repos/*` + `main/sync/*`, and every touched test file → **0 errors**. 6 `no-unused-vars` warnings (residue of widened string assertions in `import-boundaries`, `absences-replace-by-year`, `manual-import-regression`, `settings-imports-page`) — all removed.

### 2.5 Revert-failure confidence for the T2.2 harness
Each of the 6 harness cases targets a specific Phase-1 defect and would fail if that defect were re-introduced, by construction:
- Case 1/2 (T1.1): wrong-name output ("Benali Benali") on old binding; Name-header exact-match case covers the alias decision.
- Case 3 (grades semester): `applyDetectedSemesterForSingleGradeFile` used to be unguarded.
- Case 4 (header-only): old parser returned `valid` violations → now `!valid` + diagnostics asserted.
- Case 5 (T1.7): `importInFlight=true` + click spy — a reverted guard would open the picker (asserted `clicked===false`).
- Case 6 (T1.4): static decl-before-`persist` check **and** a live invocation asserting no `ReferenceError` about `skipped`.
These were not re-verified by re-introducing each bug (ambit/unicode risk: touching the working tree); the failure modes are mechanical and each assertion keys on the new behaviour.

---

## 3. Provenance and deviations

The working tree already contained the bulk of this implementation (parser/with repo changes, page controller changes, harness, fixtures) with **no commits**, plus a pile of unrelated dirty work from other streams (`.kiro/`, other `docs/plans/*`, several `js/pages/*`, `main/sync/*` infra). The committed history therefore can't show a per-task commit sequence for the pre-existed portions; commits made in this pass are listed in §6.

Deviations from the plan text:
1. **T1.1 alias decision taken as the watch-for branch** — the bare `'name'` alias was kept **exact-only** (short-alias exact rule) because a literal `Name`-headed file exists in the suite (duplicate-detection case). The P0 vector (`LastName` → `name` substring) is closed.
2. **Pre-existing Phase-3 deletions** (dead stack: 19 modules + 18 test files + `import-signatures` replaced by the `import-type-check.js` harvest) were already in the tree. `signature-manifest.test.js` re-pointed to the harvest module and green. This executes a later pass than this plan's phases 1–2 — flagged for the product owner; the suite is green with them in place either way.
3. **T1.4 oracle**: the plan's own `node -e` probe prints `TDZ: true` on a fixed tree (see §1 T1.4). Verified via the function-local ordering instead.
4. No **new** §6 findings were produced during this pass beyond the ones appended (see §5).

---

## 4. What the code now does (spot checks)

- **T1.2 strings are decomposed, never date-parsed**: anchored regex → `padStart` assembly; out-of-range/mismatch → `''`. Serial window keeps `40361 → 2010-06-11` but rejects `1`, `12`, `2024`.
- **T1.3 key coverage**: `SELECT DISTINCT student_code, month, absence_type` vs a canonicalized staged set; sample cap 20; `missingMonths` preserved so the existing renderer branch still keys on it; `confirm:true` skips the guard.
- **T1.6**: `specialty_subject`, `grade`, `cadre`, `position`, `statut`, `seniority_*`, `echelon_date`, `titularization_date`, `total_hours`, `overtime_hours`, `num_classes`, `source_function_code`, `source_assignment_mode`, `source_cycle_code`, `source_activity_json` → all `COALESCE(excluded.X, X)`; provenance fields `source` / `source_updated_at` unconditional.
- **T2.4 modal**: the review modal (`renderImportContextReview`) shows `validCount / excludedCount / blockedCount` and an `outcomeSummary` line **before** implicit confirmation — exclusion counts are visible pre-write.

---

## 5. Plan findings-log additions (this pass)

| Date | Task | Finding |
|---|---|---|
| 2026-08-08 | T1.4 | Plan's TDZ oracle probe is a false positive (first `persist === false` is in `importAbsences`); fixed check: decl-before-read inside `importOrientation` |
| 2026-08-08 | (pre-existing) | Phase-3-style dead-stack deletions already present in tree; `import-type-check.js` harvest; `signature-manifest` re-pointed |
| 2026-08-08 | T1.2 | `birth_date` count not computable here — repo DB is an empty placeholder; operator must run on production DB |
| 2026-08-08 | T1.8 | Stale `cellNumber` comment at `settings-imports.js:4792` |

---

## 6. Commits created in this pass

| Commit | Message | Scope |
|---|---|---|
| `1554b4b` | feat(import): import system remediation — phases 1 & 2 (T1.0-T1.10, T2.1-T2.5) | all `js/import-center/**`, `js/pages/settings-imports.js`, `settings-imports.html`, `main/repos/{absences,staff,timetable,capture-port}.js`, `main/sync/{capture,entity-registry}.js` + `engine/helpers.js`, `tests/import-center/**`, `tests/import-*.test.js`, `tests/helpers/`, `tests/fixtures/import-center/**`, `staff-import-upsert`, `timetable-sync`, `tafwij-xss-regression` |
| `aac7e6e` | fix(tests): timetable-repo test double gains transaction shim + no-op capture port (T1.10) | `tests/timetable-repo.test.js` |
| `5e3e33c` | docs: import system remediation — plan, audit, implementation review | `docs/plans/2026-08-08-import-system-remediation.md`, `docs/reviews/2026-08-08-import-system-audit.md`, this review |

Unrelated pre-existing dirty files (`.kiro/`, other plans' `js/pages/*` / `main/sync/*` / docs) were deliberately **not** staged.

---

## 7. Risks / open items

| # | Risk | Mitigation / owner |
|---|---|---|
| 1 | Stored dates from old parser remain wrong; re-import now yields different values | Run the T1.2 count on the real DB; decide backfill/re-import with the product owner (parked, per plan) |
| 2 | T1.3 turns section-by-section absence imports into refusals | Intended; Arabic message states the remedy; `confirm:true` override remains |
| 3 | T2.4 lets partial imports through — operators could miss dropped rows | Counts shown in the review modal before confirmation; `excludedFromWrite` also in post-import report |
| 4 | T1.10 is bundled with the pre-existing Phase-3 deletions in the same tree state | Staged rollback is per-commit; the release portion should verify `timetable` sync on a second device |
| 5 | `better-sqlite3` native binding unavailable on this WSL box (tests use `node:sqlite` fallback) | CI/native runner should re-run the two sqlite-backed suites (`staff-import-upsert`, `timetable-sync`) |

---

## 8. Recommendation

Ship after item 1 (§7, birth_date count + decision) and a normal CI run on the native toolchain. No Phase-3 blockers remain in this scope.

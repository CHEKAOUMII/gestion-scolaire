# Import System Audit — end to end

**Date:** 2026-08-08
**Entry point:** `settings-imports.html`
**Scope:** renderer orchestration, adapters/parsers, main-process write path, sync/cycle/error contracts, tests + a11y
**Mode:** read-only audit. No files were modified.

**Method:** five parallel audit agents, one per layer. Every P0 and every disputed P1 was then independently re-verified by hand; those are marked **[verified]**. Claims the agents could not confirm are marked **unverified** and listed in §8.

---

## 0. Verdict

The plumbing is in good shape. Main-process layering, auth guards, transactions, SQL-injection posture, FK handling and sync capture are largely compliant with `AGENTS.md` — see §6 for the specifics that pass.

The problems are concentrated in three places:

1. **A dead architecture layer that still ships to users** (§1).
2. **Silent data-corruption paths in parsing** (§2, P0-1 / P0-2).
3. **One destructive write with an insufficient guard, and one import type that never syncs** (§2, P0-3 / P0-4).

Severity scale: **P0** = silent data loss or corruption reachable in normal use · **P1** = high user impact or a feature that does not work · **P2** = correctness/security/a11y defect with a workaround · **P3** = hygiene.

---

## 1. The architecture is bifurcated — half of it is dead **[verified]**

`js/import-center/` contains two complete, mutually-inconsistent import stacks.

### 1.1 Never loaded by any page

Grep of all `*.html` returns **zero** hits for each of these. ~130 KB, ~3,200 LOC:

| Module | Global defined | Consumers |
|---|---|---|
| `import-orchestrator.js` | `window.ImportOrchestrator` @ `:19` | tests only |
| `import-session.js` | `window.ImportSession` @ `:16` | tests only |
| `import-center-view.js` | `window.ImportCenterView` @ `:16` | tests only |
| `import-classifier.js` | `window.ImportClassifier` @ `:22` | tests only |
| `import-signatures.js` | `window.ImportSignatures` @ `:21` | `import-classifier.js:12` (itself dead) |
| `import-post-import.js` | `window.ImportPostImport` @ `:16` | tests only |
| `import-query-context.js` | `window.ImportQueryContext` @ `:17` | **none at all** |

### 1.2 Loaded on every page view, never invoked

12 `<script>` tags at `settings-imports.html:746-758`, ~100 KB:

```
import-contracts.js                     13,146 B
import-row-validation.js                26,383 B
import-preflight.js                     12,220 B
adapters/adapter-base.js                10,633 B
adapters/students-import-adapter.js      4,673 B
adapters/grades-import-adapter.js        5,257 B
adapters/absences-import-adapter.js      5,123 B
adapters/fet-import-adapter.js           5,236 B
adapters/agent-xml-import-adapter.js     3,943 B
adapters/student-status-import-adapter   4,555 B
adapters/orientation-import-adapter.js   5,593 B
adapters/index.js                        2,936 B
                              TOTAL     99,698 B
```

Confirmed: `js/pages/settings-imports.js` contains **zero** references to `ImportAdapters`, `ImportPreflight`, `ImportRowValidation`, `ImportAdapterBase` or `ImportOrchestrator`. The only genuinely-used module in that block is `import-readers.js` (`settings-imports.js:943, 1015-1016`).

### 1.3 The live path

`runImport` (`settings-imports.js:2117`) → file input `change` (`:350`) → `showImportContextReview` (`:1150`) → `runManualImportPreflight` (`:852-970`) → `commitImport` (`:2382`) → direct `importStudents` (`:2886`) / `importGrades` (`:2978`) / … → IPC.

Bypassed entirely: classification, signature detection, the session state machine, the dependency graph, the adapter layer, and the post-import boundary.

### 1.4 This was deliberate — but is now mislabelled

`tests/import-center/package-1-ui.test.js:100-107` asserts the smart-import scripts were **removed** from the HTML, so nothing is crashing. But two assertions now lock the dead weight in place under misleading names:

```js
// tests/import-center/manual-import-regression.test.js:54-55
assert.ok(html.includes('js/import-center/import-preflight.js'), 'preflight runtime is loaded');
assert.ok(html.includes('js/import-center/adapters/orientation-import-adapter.js'), ...);
```

The file is loaded. It is never called.

**Why it matters:** 12 test files assert behaviour no user can reach; the two stacks *disagree* with each other (different numeric parsing — §3 P2-8, different row-failure policy, different error strings — §5.3), so the dead one cannot simply be switched on; and any reviewer reading the adapters draws wrong conclusions about production behaviour.

---

## 2. P0 — data loss and silent corruption

### P0-1 · `LastName` column silently becomes the first name **[verified]**

```js
// js/import-center/students-import-parser.js:38-39
familyName: ['familyname', 'lastname', 'nom', 'النسب', 'العائلي', 'الاسم العائلي'],
firstName:  ['firstname', 'name', 'prenom', 'الاسم', 'الإسم', 'الاسم الشخصي'],

// :61-66
function matchesAlias(value, aliases) {
    const key = normalizeKey(value);
    return Boolean(key) && aliases.some((alias) => {
        const aliasKey = normalizeKey(alias);
        return aliasKey && key.includes(aliasKey);   // <-- substring, not equality
    });
}

// :74-78  findHeaderIndex returns the FIRST match
```

`normalizeKey('LastName')` → `'lastname'`, which **contains** `'name'` → matches the `firstName` alias list. Because `findHeaderIndex` scans left-to-right, any roster whose `LastName` / `FullName` / `SchoolName` column sits to the left of `FirstName` binds **both** name roles to the same column.

Result: students imported as `"Benali Benali"`, or `"<school name> <lastname>"`, with **zero diagnostics**. It propagates into grades, absences, printouts and reports.

Arabic headers are incidentally safe (`اسم المؤسسة` → `اسمالمؤسسة` does not contain `الاسم`); Latin-header exports are not.

**Fix:** drop the bare `'name'` alias; require exact match for aliases shorter than ~5 characters (`findTeacherNameColumnIndex` at `settings-imports.js:1682` already does this); score all headers and take the best rather than the first; emit a diagnostic when two roles resolve to the same column index.

### P0-2 · Every parsed date is timezone-shifted and DD/MM-ambiguous **[verified]**

```js
// js/import-center/normalize.js:48-49
const parsed = new Date(text(value));
return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toISOString().slice(0, 10);
```

`new Date('05/03/2024')` parses as **May 3** (US MM/DD), then `.toISOString()` shifts back one day at UTC+1 → stored as `2024-05-02`. The correct value for a Moroccan/French-format file is `2024-03-05`. **Wrong month and wrong day.**

Other confirmed outputs: `'March 5, 2024'` → `2024-03-04`; `'12'` → `2001-12-01`; `'2024'` → `2024-01-01`; `'٢٠٢٤-٠٣-٠٥'` → returned unchanged.

Consumers: `birth_date` in `students-import-parser.js:275` and `settings-imports.js:4167` (status), plus `deriveAbsenceDate` (`:1846`).

**Fix:** anchored `^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$` after `toLatinDigits`; build the ISO string from the captured parts, never via `Date`; return `''` plus a diagnostic for anything unrecognised instead of guessing.

Related: `normalize.js:44-46` converts Excel serials with no bounds check — serial `1` → `1899-12-31`, so any stray number in a date column becomes a date.

### P0-3 · Partial absence re-import silently deletes a year of data **[verified]**

```js
// main/repos/absences.js:237-245  — the ONLY guard, months only
const missingMonths = existingMonths.filter((m) => !stagedMonths.has(m));
if (missingMonths.length) return { success:false, code:'INCOMPLETE_COVERAGE', ... };

// :259-261
const deletedRows = db.prepare('SELECT * FROM absences WHERE school_year = ? AND cycle_code = ?').all(year, cycle);
captureDeletesFromRows(db, 'absences', deletedRows);
const deleted = db.prepare('DELETE FROM absences WHERE school_year = ? AND cycle_code = ?').run(year, cycle).changes;
```

The guard compares **months**. It has no student or section coverage check.

A section-by-section import, or a re-export missing one class, covers the same months, passes the guard with **no warning and no confirmation**, and destroys every absence row not present in that file. The deletions are captured as DEL tombstones **inside the same transaction** (`:260`), so the loss propagates to every other device. There is no in-app undo.

**Fix:** compare the existing `(student_code, month, absence_type)` key set against the staged set, not just the month set. Alternatively make replace scope-explicit (replace only the `(month, section)` slices present in the file) and reserve full-year replace for an explicit «استبدال كامل» action.

**Blast radius note:** there is currently no manual absence-entry UI (`api.absences.*` exposes only `deleteByYear, getAll, getByStudentCode, replaceByYear, saveBulk`), so the victim is previously *imported* data. Still silent, still cross-device, still unrecoverable.

### P0-4 · FET timetable import never syncs **[verified]**

```js
// main/sync/capture.js:509-510
'timetableData:save':   { tables: ['timetable_data'], operation: 'UPSERT', idExtractor: 'argKey', exclude: true },
'timetableData:delete': { tables: ['timetable_data'], operation: 'DEL',    idExtractor: 'argKey', exclude: true },
```

`timetable_data` has **no entry in `main/sync/entity-registry.js`**. The sole output of the FET import is device-local: import the timetable on the office PC and no other device ever sees it — no error, no warning, no diagnostic. `main/ipc/system-backup.js:46` restores the table, which masks the gap during testing.

`AGENTS.md` documents deliberate local-only decisions (page access, `user_cycle_access`) with justifying comments, and the write-channel checklist requires `{ exclude: true }` **with a comment**. Compare `capture.js:501-505`. This entry has none, so it reads as an oversight.

**Fix:** either register the entity (`keyFields: ['school_year','cycle_code']`, `contractVersion: 2`, `requiredColumns: ['cycle_code']`, `snapshot: true`, add to `TOPO_ORDER_PUT`) and switch the channel to `captureMode: 'explicit'` with in-transaction capture in `main/repos/timetable.js:26-43` — or document it as device-local in `AGENTS.md` and surface it in the import UI.

---

## 3. P1 — high impact

| ID | Finding | Evidence |
|---|---|---|
| **P1-1** | **Ministry XML import is unusable on real files. [verified]** Preflight requires `DATAIDENTIFPERSONNEL` inside a set capped at `MAX_XML_ELEMENTS = 40` (`import-readers.js:20`; gate at `settings-imports.js:945`), and decoded text is silently truncated at `MAX_TEXT_BYTES = 512 KB` (`import-readers.js:524-539`) with no `truncated` flag — while the importer itself allows 20 MB (`settings-imports.js:28`). Real `DsAgentExport` files carry ≥9 reference tables (`settings-imports.js:3593-3607`) before the personnel block and routinely exceed both limits. | Valid files rejected as `INVALID_FILE_STRUCTURE` |
| **P1-2** | **373-line debug block ships to production. [verified]** `settings-imports.html:762-1135` monkey-patches `gradesApi.saveBulk = debugSaveBulk` (`:943`) and rewrites four live globals via `wrapGlobalFunction` — `runImport` (`:1009`), `showImportContextReview` (`:1021`), `handleImport` (`:1041`), `importGrades` (`:1059`) — plus `GradesImportParser.parseGradesSheets` (`:1110`). It installs permanent `error`/`unhandledrejection` listeners (`:1113-1124`). `electron-builder.files` is `**/*`, so it packages. A throw in any wrapper breaks the real import path. | Debug code in the IPC write path |
| **P1-3** | **Semester mismatch guard is a tautology for single-file imports.** `settings-imports.js:3065` sets `#semester-select` *from the parser* immediately before `:3066` compares the two; `autoSelectSemester` is true iff `fileList.length === 1` (`:2503`). Separately, `grades-import-parser.js:359-363` fixes `metadata.semester` from the **first** sheet (`else if (metadata.semester == null)`) while each record carries its own sheet's semester (`:445`) — a mixed-semester workbook writes S2 rows past an S1-only check. Storage key is `(student_code, subject, semester, school_year)`. | A term of grades can be overwritten silently |
| **P1-4** | **Ministry XML re-import nulls ~18 teacher columns.** `main/repos/staff.js:842-879` sets `specialty_subject`, `grade`, `cadre`, `position`, `statut`, `seniority_*`, `echelon_date`, `titularization_date`, `total_hours`, `source_*` … to `excluded.X` **unconditionally**, while `full_name`/`phone` correctly use `COALESCE(excluded.X, X)`. A partial or older XML erases manually-entered values. | Silent teacher-record loss |
| **P1-5** | **Re-entrancy: Ctrl+1..4 bypasses the in-progress lock.** `setImportButtonsDisabled` (`settings-imports.js:523-529`) only targets `document.querySelectorAll('[data-action]')`; the shortcut handler (`:379-387`) calls `runImport` directly, and `runImport` (`:2117-2126`) has no guard before `input.click()`. The hidden file inputs carry no `data-action` (`settings-imports.html:47-99`) so they are never disabled. The entire review phase runs with buttons enabled. | Concurrent imports race `saveBulk` and the shared `#semester-select` |
| **P1-6** | **Primary-cycle files import into the wrong cycle.** `import-context.js:173-201` `detectCycle` has **no `primary` branch**; a `null` source cycle yields `status:'missing'`, which `decide()` maps to `REQUIRE_REVIEW`, not `BLOCK` (`import-preflight-policy.js:45-47`). A primary-cycle file imported while collegial is active is written as `cycle_code='secondary_collegial'` after a dismissible warning. Compounding: at `:184` three of five qualifiant regex alternatives contain `أ`, which `key()` (`:49-59`) always folds to `ا` — they can never match, pushing more qualifiant files into the same non-blocking branch. | Cross-cycle contamination |
| **P1-7** | **`sections` is never written at import.** The only writer is the one-shot migration `populateSectionsFromStudents` (`main/db/migrations.js:46-95`, called once at `:2330`). No IPC channel or repo inserts a section at runtime. Sections introduced by any later import exist in no table, are never captured and never sync — although `sections` **is** a registered sync entity (`entity-registry.js:206-223`). Downstream consumers (`repos/exams.js:85-95`, `migrations.js:97-113`) degrade silently. | Silent downstream degradation |
| **P1-8** | **Every file is parsed twice; grades hit `students.getAll` three times.** Preflight parses (`settings-imports.js:860, 880, 903, 918, 930`), commit re-parses from scratch (`:2902, 3008, 2514, 2527`). `students.getAll` at `:875`, `:623` (via `:1089`) and `:2981`; `teachers.getAll` at `:878` and `:2996`. Orientation parses three times (`:2453` bypasses the cache). `XLSX.read` runs **synchronously on the UI thread** (`:1936`) under a 100 MB cap (`:27`); the 60 s FileReader timeout (`:1924-1931`) does not cover the parse. | Perf, UI freeze, and a TOCTOU window between validation and write |
| **P1-9** | **`settings-imports.js` (5,479 lines) has zero behavioural tests.** Four test files reference it — all four read it as a **string** via `fs.readFileSync`. Example: `manual-import-regression.test.js:87` asserts `pageJs.includes('if (options.autoSelectSemester) applyDetectedSemesterForSingleGradeFile(...)')`. These pass after a behaviour-breaking rename and fail on a cosmetic reformat. Separately, **no `.xlsx`/`.xls` fixture exists anywhere in `tests/`** (verified empty), so the production file format's read path — merged cells, `raw` vs formatted values, Excel serials, blank-cell holes — is untestable by construction; every parser test feeds hand-built arrays. | The riskiest code in the system is unverified |

---

## 4. P2 — correctness, security, accessibility

### 4.1 Main process

| ID | Finding | Evidence |
|---|---|---|
| P2-1 | **Destructive channels under-guarded.** `students:deleteByYear`, `grades:deleteBySemester`, `absences:replaceByYear`, `orientation:clearYear` use the broad `WRITE_ROLES` — which includes `teacher`, `social-specialist`, `educational-specialist` (9 roles). Compare `teachers:deleteByYear`, correctly `['admin']`. Only barrier is a renderer-side `showConfirm`. | `main/ipc/students.js:138`, `grades.js:201-202`, `absences.js:92-116`, `orientation.js:334`; vs `staff.js:84` |
| P2-2 | **Unauthenticated PII reads.** `teachers:getAll` / `teachers:getNameAliases` and `orientation:list` / `orientation:stats` use `handleRead` (no session required, `ipc-helpers.js:117-136`). `staffRepo.listByYear` is `SELECT * FROM teachers` — returns `cin`, `phone`, `email`, `address`, `birth_date`. | `main/ipc/staff.js:16,132`; `main/ipc/orientation.js:284-300`; `main/repos/staff.js:197` |
| P2-3 | **Clear-statuses updates zero rows and reports success.** The caller builds `{ id, status }` but the repo reads `Number(item.student_id)` and `continue`s. IPC returns `{success:true, count:0}`; the page shows success and clears the registry. | `settings-imports.js:2355` vs `main/repos/students.js:427`; `main/ipc/students.js:161` |
| P2-4 | **Status import is the only non-atomic one.** 500-row chunks, one IPC per chunk; a failure at chunk *n* leaves 1..*n*-1 committed. Acknowledged in-code as `partialCommit`. Grades explicitly refuse to split for this reason (`:3039-3041`). | `settings-imports.js:4214-4229` |
| P2-5 | **Multi-file grades import is not atomic across files.** `grades.saveBulk` is called inside the per-file loop, so file 3 of 5 failing leaves files 1-2 written with no rollback path. Contrast absences, which correctly stages all files before writing (`:2514, 2524`). | `settings-imports.js:2418, 2501-2512, 3075` |
| P2-6 | **Alias branch of the authoritative teacher match is dead.** `matchTeacherByOrderedKey` selects `ta.teacher_id, t.full_name, t.subject` but tests `row.alias_name` — a column not in the SELECT. Always `undefined`; the full `teacher_aliases` scan runs for nothing. | `main/teachers/identity.js:174-187` |
| P2-7 | **Per-row `db.prepare` in bulk loops.** `findStudentOwner` and `recordOutboxEntry` compile SQL per row; `resolveTeacherIdentity` adds a `PRAGMA table_info(teachers)` per unresolved row. ≈3 avoidable compilations + 2 avoidable SELECTs per grade row. | `main/repos/student-cycle.js:23-30, 40-46`; `main/sync/capture.js:562-567, 585-590`; `main/teachers/identity.js:163` |

### 4.2 Parsing

| ID | Finding | Evidence |
|---|---|---|
| P2-8 | **Two numeric parsers that disagree in both directions.** Adapters use bare `Number()`; parsers use `parseStrictNumber`. `"12,5"` and `"١٢"` rejected by adapters, accepted by parsers. `"0x10"`→16 and `"1e1"`→10 accepted by adapters, rejected by parsers. `" "` → grade `0`. | `import-row-validation.js:346` vs `normalize.js:52-58` |
| P2-9 | **Absence hours silently become 0.** `toNumber` extracts ASCII digits only and falls back to `0`: `'١٢'`→0, `'abc'`→0. Applied to all 40 month columns of the Massar matrix. No `INVALID_HOURS` equivalent on the live path. | `settings-imports.js:1855-1862`, used at `:3155-3158` |
| P2-10 | **Bidirectional alias matching selects wrong columns.** `key.includes(a) \|\| a.includes(key)` — a column literally named «م» is selected as the student-code column because `'الرمز'.includes('م')`. | `import-row-validation.js:82` |
| P2-11 | **Five competing Arabic normalizers.** Only `foldArabic` handles ة→ه, ى→ي, tatweel and ٱ. `normalize.js`'s own docstring (`:4-6`) says it exists to prevent exactly this divergence. | `normalize.js:26`, `import-readers.js:207`, `import-row-validation.js:66`, `teacher-identity.js:83`, `students-import-parser.js:49` |
| P2-12 | **CSV quotes cannot span newlines.** Split on raw newlines before quote handling, so a quoted multi-line field shreds into column-shifted fragment rows. | `import-readers.js:43, 48-70` |
| P2-13 | **Preflight validates 12 rows and reports confidence over N.** `MAX_SAMPLE_ROWS = 12`; an 800-row file yields `recordEstimate: 800` with 12 `rowOutcomes` and `valid: true`. `notPersisted` is a comment, not a guard. | `import-readers.js:18` |
| P2-14 | **XML "parsed" by regex in the reader.** Truncated XML yields `{xmlRoot, xmlElements, error:null}` and `valid:true`; the `parsererror` guard at `:129` is dead (it tests the root *name*, which a regex parser cannot set). The live `DOMParser` paths **do** check correctly (`settings-imports.js:3394, 3573`). Adjacent: `js/pages/timetable.js:1137-1141` has no `parsererror` check. | `import-readers.js:107-160` |
| P2-15 | **Fuzzy teacher match returns first-over-threshold with no ambiguity detection.** `محمد العلمي` → `محمد العلوي` at 0.88 with `needsReview` **not** set. Never writes data (preflight display only), but the preflight and the writing resolver (`teacher-identity.js`, exact sorted-token key) are different algorithms and can disagree on every teacher. | `js/name-resolver.js:125-130`; `import-row-validation.js:165` vs `settings-imports.js:3051, 3435` |
| P2-16 | **Grades parse is all-or-nothing.** `diagnostic()` defaults to `severity:'error'`, so one `UNKNOWN_STUDENT` or one out-of-range grade rejects the whole file — the exact opposite of the adapter layer's documented per-row-exclusion policy (`import-row-validation.js:4`). | `grades-import-parser.js:150-162, 473`; `settings-imports.js:3014-3038` |
| P2-17 | **Duplicate grades resolve last-wins, silently.** The counter increments but `recordMap.set` overwrites unconditionally; no indication which value survived or that they differed. | `grades-import-parser.js:458-463` |
| P2-18 | **Duplicate detection only runs for students/status.** Grades and absences get zero duplicate diagnostics, then collide on the DB upsert key. | `import-row-validation.js:388` |
| P2-19 | **Orientation CSV/XLSX branch validates nothing.** Header-only → `valid:true, executable:true`. Garbage `aaa,bbb / 1,2` → `valid:true, recordEstimate:2`. Only adapter that does not import `ImportRowValidation`. | `orientation-import-adapter.js:92-115` |

### 4.3 Sync / context / error contracts

| ID | Finding | Evidence |
|---|---|---|
| P2-20 | **Explicit capture never writes `sync_snapshots`,** so the next snapshot cycle re-enqueues every just-captured row. A 20,000-grade import produces **≈40,000** outbox rows instead of 20,000. | `main/sync/capture.js:581-591` vs `main/sync/snapshot.js:57-68` |
| P2-21 | **`restoreDbContent` weaponises a local restore.** Deletes and re-inserts 27 tables while leaving `sync_id_map` / `sync_snapshots` / `sync_outbox` intact → the next snapshot emits DEL tombstones for the restore's deletions (propagating them cluster-wide) and PUTs that resurrect rows deleted elsewhere. No confirmation, no sync pause. Both restore handlers also proceed with **no session**. | `main/ipc/system-backup.js:461-531, 264-269, 417-423`; `main/sync/snapshot.js:71-84` |
| P2-22 | **`grades:saveBulk` is the only bulk import channel with no per-row year validation.** Compare `grades:save` (`:104`), `students:addBulk` (`ipc/students.js:103`), `absences:*` (`ipc/absences.js:26-33`). `normalizeYear` silently substitutes the DB default on reads (`ipc-helpers.js:94-99`) while `requireSchoolYear` throws on writes — a confusing split. | `main/ipc/grades.js:122-181` |
| P2-23 | **`school_year` read from unvalidated `localStorage`** with a hardcoded `'2025/2026'` fallback repeated in 8 places and no format check. | `js/shared/auth-session.js:175-181, 214-235`; `js/utils.js:2647-2652, 2706-2720` |
| P2-24 | **`teacher_teaching_assignments` missing from `TOPO_ORDER_PUT` and `PULL_SOFT_FOREIGN_KEYS`,** yet declares `teacher_id NOT NULL REFERENCES teachers(id)` with `foreign_keys = ON`. A pulled row whose teacher is absent locally becomes a hard apply failure rather than a replayable quarantine. | `main/sync/engine/helpers.js:10-36`; `apply.js:20-33`; `main/db/schema.js:466` |
| P2-25 | **Orientation import collapses auth codes into `DATABASE_ERROR`.** `UNAUTHENTICATED` / `FORBIDDEN` / `SESSION_LOCKED` / `INTERNAL_ERROR` are not in `ALL_CODES`, so the user is told the database failed (retryable) when they need to log in. The SSOT's own `normalize()` already handles these correctly (`orientation-error-contract.js:396-408`) — the import path bypasses it. | `settings-imports.js:5359-5364, 4244-4247` |
| P2-26 | **Three overlapping error catalogs with divergent Arabic text.** `INVALID_FILE_STRUCTURE` defined in `import-result-contract.js:36`, `orientation-error-contract.js:146` and `orientation-import-adapter.js:48` — three different messages. `SEMESTER_UNRESOLVED` / `SUBJECT_UNRESOLVED` duplicated across three files. **36 of 40** `throw new Error` sites in `settings-imports.js` carry no `.code` at all. | `import-result-contract.js:18-43`, `import-diagnostics-codes.js:14-43`, `import-preflight-policy.js:14-29` |
| P2-27 | **`SCHOOL_YEAR_MISMATCH` is dead at the service boundary.** A `SHARED_CODE` + `LOCKED_SHARED_CODE` in the contract, but nothing in `main/ipc/orientation.js` or `main/repos/orientation.js` ever emits it; the renderer synthesises it locally from a per-row `reason`. | `orientation-error-contract.js:38, 106-114`; `settings-imports.js:5406-5407` |
| P2-28 | **`runOutboxCleanup` purges pending rows.** Deletes rows older than `retention_days` (default 7) with **no `status` filter**. Mitigated for import tables (all `snapshot: true`); not mitigated for `snapshot: false` entities. | `main/sync/capture.js:1097-1109` |

### 4.4 HTML / accessibility / UX

| ID | Finding | Evidence |
|---|---|---|
| P2-29 | **Seven delete buttons are indistinguishable to a screen reader.** Accessible name is only «حذف» ×6 / «مسح» ×1; the distinguishing text sits in `title`, which accname computation ignores when the element has text content. A user hears "حذف, حذف, حذف, حذف, حذف, مسح, حذف" with no way to tell "delete all students" from "delete the timetable". These are irreversible bulk deletes. | `settings-imports.html:451-560` |
| P2-30 | **Pre-import review is never announced.** `#import-context-review-content` has `aria-live="polite"` but is populated *before* its ancestor is unhidden — a live region inside a hidden subtree is not in the a11y tree, so nothing is queued. | `html:397, 399`; `settings-imports.js:746-767` |
| P2-31 | **Failure report is never announced.** Same pattern: `role="status" aria-live="polite"` on the element that is itself toggled `hidden`; content set at `:781`, unhidden at `:782`. This is the highest-value announcement on the page. | `html:424`; `settings-imports.js:777-782` |
| P2-32 | **`tabindex="-1"` implies focus management that was never wired.** `.focus()` appears **zero** times in the whole 5,479-line file. Keyboard and screen-reader users stay at the trigger while the decisive review panel renders off-screen below. | `html:397`; `settings-imports.js` |
| P2-33 | **A control labelled "import-only" silently scopes a destructive action.** `#semester-select` is «دورة استيراد النقط», but `clearData('grades')` reads it and passes it to `grades.deleteBySemester`. Partially mitigated — the dialog interpolates the semester name — but the label denies the control has any delete role. | `html:238-260, 245`; `settings-imports.js:2287, 2332` |
| P2-34 | **Single-click confirmation on 7 irreversible year-scoped deletes.** No type-to-confirm, no year re-entry, no undo. The dialog text is well written (names the year and cycle, `type:'danger'`, `confirmText:'حذف نهائي'`) — it is just a weak barrier. Only recovery is a manual backup the user may never have run. | `settings-imports.js:2313-2320, 2325-2363` |

---

## 5. P3 — hygiene

- **`settings-imports.html:426`** — `<strong>تقرير مراجعة الاست</strong>يراد</strong>` **[verified]**. Splits «الاستيراد» across a tag boundary (breaks Arabic shaping and the bidi run in RTL) plus a stray unmatched closing tag. A balanced-tag scan reports this as the file's **only** markup error.
- **Section comments numbered 1,2,3,4,5,5,6** — two sections numbered 5 (`html:436`, `:565`), including the destructive one.
- **`#ic-context-hint`** (`html:224`) declares `role="status" aria-live="polite"` and is referenced by **zero** JS. Dead a11y scaffolding.
- **`XLSX_CDN`** (`settings-imports.js:20`) is a *local* vendor path named `_CDN`, injected as a `<script>` (`:180-182`) though the HTML already loads it statically (`html:760`). The name invites a future "fix" into a real CDN URL, which would break offline deployment.
- **Ctrl+1..4 covers 4 of 7 import types** and does not bail out when focus is in a text input (`#header-search`, `#quick-nav-search-input`).
- **Seven silent `catch { setValue(id,'-') }` blocks** in `loadDataStats` (`settings-imports.js:2187-2249`) — a broken stats channel is invisible, including after every import.
- **`formatDateTime(...)` interpolated unescaped** into `innerHTML` at `settings-imports.js:3944-3945` while every sibling cell uses `escapeHtml`. Not currently exploitable (DB timestamps), but inconsistent in an Electron renderer.
- **Tautology** at `import-preflight-policy.js:34`: `return status === 'missing' || status === 'unknown' ? DECISIONS.BLOCK : DECISIONS.BLOCK;`.
- **`orientation` missing from `IMPORT_SOURCE_TYPES` / `REGISTERED_SOURCE_TYPES`** (`import-contracts.js:20-38`) though it is a registered adapter — `isImportSourceType('orientation') === false`.
- **`orientation:delete`** declares `captureMode:'explicit'` without `exclude:true`, unlike every sibling (`capture.js:332-337`). Behaviourally identical; breaks the invariant `tests/sync-bulk-channels-explicit.test.js:47-49` pins.
- **Registry drift:** `grades:saveBulk` omits `teacher_aliases` from its `tables` (written at `repos/grades.js:324`); `students:deleteByYear` omits `student_profile_data` (deleted at `repos/students.js:20, 323-325`).
- **Duplicated level catalogs inside parsers** (`students-import-parser.js:159`, `grades-import-parser.js:109-116`) that **contradict** the SSOT — `2BACSE` maps to «علوم تجريبية» locally vs «علوم الإقتصاد والتدبير» in `qualifiant-levels.js`. Currently unreachable (catalog consulted first), but a direct SSOT violation.
- **Polymorphic return shapes:** `importStudentStatus` returns `{records}` or a bare `number`; `importOrientation` returns `{rows}` or `{imported, inserted, …}`. `settings-imports.js:2527` does arithmetic on a value that is an object in the other mode.
- **`absences:saveBulk` is dead in the normal flow** — `importAbsences` is always called with `{persist:false}`, so the `saveBulk` call at `:3373` is unreachable; absences actually go through the destructive `replaceByYear` (P0-3).
- **`detectFormat` has no `json` branch** (`import-readers.js:29-36`) although the orientation input accepts `.json`.
- **Orientation JSON reader does not strip the BOM** (`orientation-import-adapter.js:20-24`), unlike `ImportReaders.readAsText` and unlike the live path — preflight rejects a file the importer would accept.
- **`unresolvedCycle` dropped from the orientation success response** (`main/ipc/orientation.js:266-280` vs `repos/orientation.js:754`), though the empty-rows branch declares it.
- **No unique index on `(full_name, school_year)`** backing the no-PPR teacher insert path (`repos/staff.js:882-895`); `selectByName.get` is non-deterministic if duplicates exist.
- **`adapter-base` metadata is decorative** — `canAnalyze`, `formats`, `manualFunctionName` are consumed by nothing.
- **No cancellation anywhere.** No `AbortController`, no cancel button. A user who selects the wrong 80 MB file waits or kills the app.
- **Lint:** 1 warning — unused `eslint-disable` at `js/import-center/import-classifier.js:397`.

---

## 6. What is genuinely solid

Worth stating precisely, because it is most of the main process:

- **`AGENTS.md` 027 layering — full pass.** Zero `db.prepare` / `.exec` in `main/ipc/**` for import channels (the only two hits are the sanctioned `system_logs` audit rows). Every repo imports change-tracking via `capture-port.js`; the only `require('../sync/capture')` under `main/repos/` is the port's own lazy default. All 12 bulk import channels are `captureMode:'explicit'` + `exclude:true` with outbox writes **inside** the same transaction. No import channel uses `allowNoSession`.
- **No SQL injection.** Every interpolation resolves to a module constant or an allowlist (`UPDATABLE_FIELDS`, `STUDENT_DEPENDENT_TABLES`, `PRAGMA table_info` filters); all file- and renderer-derived values are bound parameters.
- **Foreign keys enforced** (`PRAGMA foreign_keys = ON`, `main/db/context.js:36`), and missing parents are handled explicitly — grades/absences resolve the owner first and throw an Arabic error on an unknown code, rather than writing orphans.
- **No SQLite message leakage.** `sanitizeIpcErrorMessage` (`ipc-helpers.js:42-51`) passes Arabic only; `looksLikeInternalErrorMessage` collapses anything matching `SQLITE|constraint|at …(`.
- **Cycle resolution is server-side.** Main never trusts the renderer's cycle — `resolveCycleForRequest` on every import write channel. Preview cycles cannot be activated (three independent gates). The S5 hardcoded-cycle sweep is complete: zero `'secondary_qualifiant'` hits in `main/` and in all `*.html`.
- **Students / grades / orientation re-import is genuinely non-destructive.** Guarded upserts with `WHERE cycle_code = excluded.cycle_code`, blank values never clobbering stored ones, orientation doing a per-field merge with `cycle_code` immutable after insert. Departed students are **reported, never deleted**.
- **Strict UTF-8 CSV gate** (`import-readers.js:497-519`) makes Windows-1256 mojibake impossible — a PDF renamed `.csv` is also blocked by the same path.
- **Arabic normalization primitives are well tested** (`normalize-primitives.test.js`): Arabic-Indic and Persian digits, NFD + tashkeel stripping, hamza folding, `'`-prefixed Massar codes, comma decimals, and `parseStrictNumber` never coercing to `0`.
- **028 orientation error contract is correctly consumed** on the live path by `main/ipc/orientation.js:13`, `settings-imports.js:4240-4317` and `students-orientation.js:37-39`, with a clean shared/page-only partition. The only violation is in the dead adapter.
- **Fixture governance** — `tests/fixtures/import-center/manifest.json` with provenance and `sensitive:false`, enforced by `fixture-inventory.test.js`.
- **`absences:replaceByYear` has real transactional coverage** against in-memory SQLite — the only import type that does.
- **36/36 import tests pass in 5.95 s; lint is clean** apart from one unused directive.
- **Several a11y hypotheses came back negative:** `aria-valuenow` *is* updated (`settings-imports.js:543, 558`), hidden file inputs *are* labelled at runtime (`:150-166`) using a clip-based visually-hidden pattern, no duplicate IDs (102 checked), no orphan ARIA references, RTL logical properties used consistently, Ctrl+1..4 handlers *do* exist, and all 7 deletes *are* confirmed.

---

## 7. Suggested order of work

1. **P0-1, P0-2** — two small, contained parser fixes that stop ongoing silent corruption. Highest value per line changed.
2. **P0-3** — widen the absences coverage guard from the month set to the row-key set.
3. **P0-4** — decide and document: register `timetable_data` as a sync entity, or declare it device-local in `AGENTS.md` and say so in the UI.
4. **P1-2** — delete or flag-gate the inline debug block. Pure deletion, zero risk.
5. **P1-1** — the ministry-XML element cap and text truncation; the import is currently unusable on real files.
6. **§1** — decide the fate of the dead layer. Deleting it removes ~230 KB, 12 script tags and 12 misleading test files. Keeping it requires first reconciling the two stacks' contradictions (P2-8, P2-16, P2-26).
7. **P1-9** — add `.xlsx` binary fixtures and the first behavioural test for `settings-imports.js`. Without this, none of the above can be regression-guarded.

Two scope notes:

- The **departed-students bulk-status flow** (`html:342-392`) mutates whole rosters and has **zero** tests — `departed` returns no matches anywhere in `tests/`. Same for the **tafwij matching flow** beyond an XSS regression test.
- **Partial-failure rollback is a documented non-guarantee** for 6 of 7 import types, pinned by `tests/import-center/absences-replace-by-year.test.js:48-50` against `docs/import-center/atomicity-matrix.md`. P0-3 and P2-5 are therefore gaps in *tested behaviour*, not violations of a promised guarantee.

---

## 8. Explicitly unverified

Listed so nothing here is mistaken for a confirmed defect.

- The application was not executed. All conclusions are static, from the cited `file:line`, except the test and lint runs in §6.
- Chromium `DOMParser` behaviour against XXE and billion-laughs payloads was **not** runtime-tested. Static reading indicates no XXE vector (no entity-resolution code; Chromium does not fetch external DTDs); entity-expansion resistance is unverified.
- Real-world `DsAgentExport` distinct-element-name counts were inferred from the tags the importer queries (`settings-imports.js:3593-3607`), not measured against a production file.
- Whether the P2-20 duplicate snapshot-originated PUT bumps the remote document version or produces conflict rows — `engine/push.js` `writeItemWithVersionCheck` was not read.
- Whether whole-file `restoreDb` produces duplicate remote documents when the backup originates from a different device hash.
- Whether `showConfirm` traps focus well enough to block Ctrl+1..4 during the review modal. P1-5 is demonstrated independently for the commit phase, where no modal is open.
- Runtime interaction between the top-bar cycle switcher and an in-flight import (`js/sidebar.js` not read).
- Wall-clock performance figures. Operation *counts* in P1-8 and P2-7 are derived from code; nothing was benchmarked.

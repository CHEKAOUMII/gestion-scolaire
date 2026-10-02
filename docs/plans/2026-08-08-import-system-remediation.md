# Import System Remediation — Phases 1 & 2 (execution plan)

**Date:** 2026-08-08
**Source audit:** `docs/reviews/2026-08-08-import-system-audit.md`
**Scope of this plan:** Phase 1 (stop the bleeding) + Phase 2 (build the safety net).
**Out of scope:** Phase 3 (delete the dead stack) and Phase 4 (convergence) — recorded in §5 for a later pass.

**Audience:** executing agents. Each task is self-contained. Do not read the audit first — everything needed is inline.

---

## 0. Ground rules — read before touching anything

### 0.1 Execution discipline

1. **One task = one commit.** Do not batch. Every task below has its own acceptance criteria and rollback.
2. **Do not refactor while fixing.** These tasks are surgical. If you find yourself moving a function, stop — that is Phase 4.
3. **Do not fix things not in this plan.** The audit lists ~70 findings. Only the ones here are in scope. If you find something new, append it to §6 (Findings log) and keep going.
4. **T1.0 must land before every other task.** It removes a debug harness that monkey-patches the functions later tasks modify. Verifying behaviour while it is installed measures the wrapper, not the code.
5. **Order within Phase 1 is otherwise free**, except T2.4 which depends on T2.2.

### 0.2 The Arabic encoding trap — this WILL bite you

The Windows PowerShell console mangles UTF-8 Arabic. `Get-Content` piped to the terminal renders `العربية` as `OU,O1O�O"USOc`. **The files are fine; the console is lying.**

- **Never** use `Get-Content` / `rg` output to read or copy Arabic strings.
- **Always** use the `Read` tool when you need to see or preserve Arabic text.
- **Always** use the `Edit` tool for changes touching Arabic strings. Never `Set-Content`, never here-strings, never `sed`-style shell edits.
- When adding a new Arabic message, write it with the `Edit`/`Write` tool and then re-`Read` the file to confirm it round-tripped.

### 0.3 Commands

```powershell
# Full import-related suite (36 files, ~6s) — the primary gate
node tests/run-all.js --filter import

# One file
node tests/run-all.js --only tests/import-center/normalize-primitives.test.js

# Verbose (stream child stdio — use when a test fails)
node tests/run-all.js --filter import -v

# Full suite (run before closing a phase)
npm test

# Lint the touched surface
npx eslint "js/import-center/**/*.js" "js/pages/settings-imports.js" "main/repos/*.js" "tests/import-center/**/*.js"
```

Test runner facts: `tests/run-all.js` auto-discovers `tests/**.test.js`, excludes `fixtures`/`integration`/`e2e` dirs, and runs each file as a plain `node` subprocess using `assert`. There is no Jest/Mocha. New test files need no registration.

### 0.4 Definition of done for every task

- [ ] The RED test fails on unmodified code (paste the failure output in the commit body)
- [ ] The RED test passes after the change
- [ ] `node tests/run-all.js --filter import` is green
- [ ] `npx eslint <touched files>` is clean
- [ ] No unrelated file is modified

---

## 1. Phase 1 — Stop the bleeding

Ten tasks. Target: ~135 lines changed, ~585 deleted, 5 new test cases. Nothing structural moves.

---

### T1.0 — Delete the production debug harness — **DO THIS FIRST**

| | |
|---|---|
| **Severity** | P1 |
| **Files** | `settings-imports.html:762-1135` |
| **Depends on** | nothing |
| **Blocks** | every other task |

**Current state.** A 373-line inline `<script>` block labelled `[grades-import-debug]` sits at the bottom of the page. It is not passive logging — it rewrites live functions:

- `settings-imports.html:943` — `gradesApi.saveBulk = debugSaveBulk` (wraps the IPC write channel)
- `:1009` — wraps `window.runImport`
- `:1021` — wraps `window.showImportContextReview`
- `:1041` — wraps `window.handleImport`
- `:1059` — wraps `window.importGrades`
- `:1092` — wraps `window.GradesImportParser.parseGradesSheets`
- `:1113-1124` — installs permanent `error` / `unhandledrejection` listeners

`electron-builder` `files` is `**/*`, so this ships to users. It logs filenames (which encode school code / section / subject) and full stack traces to the console.

**Required change.** Delete the entire `<script>` element spanning lines 762-1135 inclusive. Do not replace it. Do not gate it behind a flag — if debug instrumentation is wanted later it belongs in `js/import-center/import-debug.js`, excluded from the packaged build.

Also delete the now-orphaned trigger constant in the page controller:
- `js/pages/settings-imports.js:266` — `GRADES_IMPORT_DEBUG` const (reads `?debugGrades=1`)
- `:268` — `debugGradesImport` function
- `:271` — `debugFetImport` function

(Verify with `rg -n "debugGradesImport|debugFetImport|GRADES_IMPORT_DEBUG" js/` that no call sites remain — expected: zero outside these declarations.)

**Verification.**
```powershell
rg -n "wrapGlobalFunction|grades-import-debug|debugSaveBulk" settings-imports.html   # expect: no matches
rg -n "debugGradesImport|debugFetImport|GRADES_IMPORT_DEBUG" js/                    # expect: no matches
node tests/run-all.js --filter import
```

**Acceptance.** Suite green. `settings-imports.html` ends with the `</html>` structure intact and the last `<script>` tag is `js/pages/settings-imports.js` at line 761.

**Rollback.** `git revert` — the block is self-contained and referenced by nothing.

---

### T1.1 — **P0** Student first-name column binds to the wrong column

| | |
|---|---|
| **Severity** | P0 — silent data corruption |
| **Files** | `js/import-center/students-import-parser.js:36-47, 61-67, 74-79` |
| **Test file** | `tests/import-center/students-import-behavior.test.js` (extend) |

**Current state.**

```js
// :38-39
familyName: ['familyname', 'lastname', 'nom', 'النسب', 'العائلي', 'الاسم العائلي'],
firstName:  ['firstname', 'name', 'prenom', 'الاسم', 'الإسم', 'الاسم الشخصي'],

// :61-67  — substring match, not equality
function matchesAlias(value, aliases) {
    const key = normalizeKey(value);
    return Boolean(key) && aliases.some((alias) => {
        const aliasKey = normalizeKey(alias);
        return aliasKey && key.includes(aliasKey);
    });
}

// :74-79  — returns the FIRST match
function findHeaderIndex(row, aliases) {
    for (let index = 0; index < row.length; index += 1) {
        if (matchesAlias(row[index], aliases)) return index;
    }
    return -1;
}
```

`normalizeKey('LastName')` → `'lastname'`, which **contains** `'name'` → matches the `firstName` alias list. Because `findHeaderIndex` returns the first hit, any roster with `LastName` / `FullName` / `SchoolName` to the **left** of `FirstName` binds both name roles to the same column. Students import as `"Benali Benali"` or `"<school> <lastname>"` with zero diagnostics.

Arabic headers are incidentally safe (`اسم المؤسسة` → `اسمالمؤسسة` does not contain `الاسم`). Latin-header exports are not.

**Required change.**

1. Remove the bare `'name'` alias from `firstName` (`:39`). It is subsumed by `'firstname'`.
2. In `matchesAlias`, require **exact** match when the normalized alias is shorter than 5 characters; keep substring matching only for longer aliases. Short aliases are the corruption vector.
3. In `mapHeaderPositions` (`:81+`), after resolving all roles, detect the case where two distinct roles resolved to the **same column index** and push an `error`-severity diagnostic. Reuse the existing diagnostic factory in this file (`:172-184`) and an existing code from `js/import-center/import-diagnostics-codes.js` if one fits; otherwise add `AMBIGUOUS_HEADER_BINDING` to that catalog (it is the SSOT for parser diagnostics).

Keep `isOnlyAlias` (`:69-72`) unchanged — it already uses equality.

**RED test first.** Add to `tests/import-center/students-import-behavior.test.js`, following the existing hand-built-rows pattern at `:22-32`:

```
Case A: headers ['Massar','LastName','FirstName','BirthDate']
        → full_name must be "<first> <last>", NOT "<last> <last>"
Case B: headers ['Massar','SchoolName','FirstName','LastName']
        → full_name must not contain the school name
Case C: headers ['Massar','FirstName','LastName']   (control)
        → unchanged behaviour, still passes
Case D: two roles on one column → an error diagnostic is emitted
```

**Acceptance.** All four cases pass. `students-import-behavior.test.js` and `import-boundaries.test.js` stay green.

**Watch for.** `HEADER_ALIASES.firstName` is also read at `:93`. Confirm the `'name'` removal does not break header-row detection for a file whose only name column is literally headed `Name` — if such a fixture exists, add `'name'` back as an **exact-only** alias rather than deleting it.

---

### T1.2 — **P0** Date parsing is timezone-shifted and DD/MM-ambiguous

| | |
|---|---|
| **Severity** | P0 — silent data corruption |
| **Files** | `js/import-center/normalize.js:42-50` |
| **Test file** | `tests/import-center/normalize-primitives.test.js` (extend) |

**Current state.**

```js
// :42-50
function excelDateToIso(value) {
    if (value === null || value === undefined || value === '') return '';
    if (typeof value === 'number') {
        const date = new Date((value - 25569) * 86400 * 1000);
        return Number.isNaN(date.getTime()) ? '' : date.toISOString().slice(0, 10);
    }
    const parsed = new Date(text(value));
    return Number.isNaN(parsed.getTime()) ? text(value) : parsed.toISOString().slice(0, 10);
}
```

Two defects in the string branch:
- `new Date('05/03/2024')` parses as **May 3** (US MM/DD). Moroccan/French files mean **3 March**.
- `.toISOString()` then converts local→UTC, shifting back one day at UTC+1. Net stored value: `2024-05-02`. Wrong month **and** wrong day.

Confirmed outputs today: `'March 5, 2024'` → `2024-03-04`; `'12'` → `2001-12-01`; `'2024'` → `2024-01-01`; `'٢٠٢٤-٠٣-٠٥'` → returned unchanged.

The numeric branch has no bounds check: serial `1` → `1899-12-31`, so any stray number in a date column becomes a date.

**Consumers** (all inherit the bug): `students-import-parser.js:275` (`birth_date`), `js/pages/settings-imports.js:4167` (student status), and `deriveAbsenceDate` at `settings-imports.js:1846`.

**Required change.** Rewrite `excelDateToIso`:

1. **String branch** — after `toLatinDigits(value)` (already exported at `:19-24`), match against anchored patterns in this order:
   - `^(\d{4})-(\d{1,2})-(\d{1,2})$` → ISO, use as-is
   - `^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$` → **DD/MM/YYYY**
   Build the output string from the captured groups with `String.padStart(2,'0')`. **Never** construct a `Date` from a string.
2. Validate ranges (month 1-12, day 1-31) and return `''` for anything out of range or unmatched. **Do not** return the raw text as today (`:49`) — that silently propagates junk into a date column.
3. **Numeric branch** — reject serials outside a plausible schooling range (roughly 20000-60000, i.e. ~1954-2064) and return `''`. Keep the existing epoch arithmetic for in-range values but build the ISO string from UTC components to avoid the same local→UTC shift.
4. Return `''` on failure. Callers already treat `''` as "no date".

**RED test first.** Extend `tests/import-center/normalize-primitives.test.js` (existing date coverage is at `:60`):

```
'05/03/2024'   → '2024-03-05'      (was '2024-05-02')
'3/3/2024'     → '2024-03-03'
'2024-03-05'   → '2024-03-05'      (ISO passthrough)
'March 5, 2024'→ ''                (was '2024-03-04')
'12'           → ''                (was '2001-12-01')
'2024'         → ''                (was '2024-01-01')
''             → ''
1              → ''                (implausible serial; was '1899-12-31')
40361          → '2010-06-11'      (in-range serial, verify exact expected value first)
'٠٥/٠٣/٢٠٢٤'   → '2024-03-05'      (Arabic-Indic digits via toLatinDigits)
```

Before asserting the `40361` case, compute the correct expectation from the existing implementation under `TZ=UTC` and confirm it is unchanged by the fix.

**Acceptance.** All cases pass. `students-import-behavior.test.js` stays green.

**⚠ Data-migration flag — raise before merging.** This changes what gets *stored* going forward. Rows already imported under the buggy parser remain wrong, and a re-import will now produce different values than the first import did. Before this ships, run a read-only count of affected rows:

```sql
SELECT COUNT(*) FROM students WHERE birth_date IS NOT NULL AND birth_date != '';
```

Report the number in the PR. Deciding whether to re-import or backfill is **not** part of this task — flag it and stop.

---

### T1.3 — **P0** Partial absence re-import deletes a year of data

| | |
|---|---|
| **Severity** | P0 — irreversible data loss, propagates via sync |
| **Files** | `main/repos/absences.js:231-247` |
| **Test file** | `tests/import-center/absences-replace-by-year.test.js` (extend — already uses real in-memory SQLite) |

**Current state.**

```js
// :231-247 — the ONLY guard
if (opts && opts.confirm !== true) {
    const existingMonths = db.prepare(
        'SELECT DISTINCT month FROM absences WHERE school_year = ? AND cycle_code = ?'
    ).all(year, cycle).map((row) => canonicalMonth(row.month)).filter(Boolean);
    if (existingMonths.length) {
        const stagedMonths = new Set(absences.map((a) => canonicalMonth(a.month)).filter(Boolean));
        const missingMonths = existingMonths.filter((m) => !stagedMonths.has(m));
        if (missingMonths.length) {
            return { success:false, code:'INCOMPLETE_COVERAGE', error:'…', missingMonths };
        }
    }
}
// :259-261 — then deletes EVERYTHING for the year+cycle
const deletedRows = db.prepare('SELECT * FROM absences WHERE school_year = ? AND cycle_code = ?').all(year, cycle);
captureDeletesFromRows(db, 'absences', deletedRows);
const deleted = db.prepare('DELETE FROM absences WHERE school_year = ? AND cycle_code = ?').run(year, cycle).changes;
```

The guard compares **months only**. A section-by-section import, or a re-export missing one class, covers the same months, passes the guard with no warning, and destroys every absence row not in the file. Deletions are captured as DEL tombstones **inside the same transaction** (`:260`), so the loss propagates to every other device. No undo.

**Required change.** Widen the guard from a month set to the row key set.

1. Replace the `SELECT DISTINCT month` probe with a projection of the existing key tuple: `SELECT DISTINCT student_code, month, absence_type FROM absences WHERE school_year = ? AND cycle_code = ?`. (Confirm the canonical key against the upsert conflict clause at `main/repos/absences.js:56` — it is `(student_code, month, school_year, absence_type)`.)
2. Build the staged key set from `absences` using the same `canonicalMonth` normalization already applied at `:236`, plus `normalizeStudentCode`-equivalent handling if the repo applies one (check `resolveAbsenceForBulk`).
3. If any existing key is **not** covered by the staged set, return `INCOMPLETE_COVERAGE` with a bounded sample of uncovered keys (cap at ~20 to keep the IPC response small) **and** retain `missingMonths` for backwards compatibility with the existing renderer branch.
4. Keep the `opts.confirm === true` bypass unchanged — that is the deliberate operator override.
5. The Arabic error message at `:242` must be updated to explain the new condition and the remedy. **Use the `Edit` tool** (see §0.2). Suggested meaning: "the file does not cover all previously recorded absence rows for this year and cycle; importing would delete the uncovered records — re-export a complete file, or confirm replacement explicitly."

**RED test first.** Extend `tests/import-center/absences-replace-by-year.test.js`:

```
Case A: seed rows for sections X and Y across months 9,10.
        Replace with a file covering ONLY section X, months 9,10.
        → must return INCOMPLETE_COVERAGE. Section Y rows must still exist.
        (Today this SUCCEEDS and deletes section Y.)
Case B: same seed, file covers X and Y, months 9,10
        → succeeds, replaces cleanly. (regression guard)
Case C: same seed, opts.confirm === true, partial file
        → succeeds and deletes. (explicit override preserved)
Case D: empty table + any file → succeeds. (first import unaffected)
```

**Acceptance.** All four pass. Existing assertions in that file — including the `:48-50` check against `docs/import-center/atomicity-matrix.md` — stay green.

**Watch for.** `tests/import-boundaries.test.js` asserts the literal string `INCOMPLETE_COVERAGE` and `showConfirm(` in `settings-imports.js`. Keep the code constant identical; only the message text and the detection logic change.

---

### T1.4 — **P1** Orientation preflight always throws (TDZ)

| | |
|---|---|
| **Severity** | P1 — a whole import type's review path is broken |
| **Files** | `js/pages/settings-imports.js:5286-5305` |
| **Test** | manual runtime confirmation now; regression covered by T2.2 |

**Current state.**

```js
5286: if (options.persist === false) {
5287:     return {
5288:         rows: deduped,
...
5293:         skipped,                      // <-- read here
...
5299:     };
5300: }
5301:
5302: let inserted = 0;
5303: let updated = 0;
5304: let unchanged = 0;
5305: let skipped = preIpcSkipped;          // <-- declared here
```

`skipped` is a function-scoped `let` declared at `:5305`. The read at `:5293` occurs while the binding is in its temporal dead zone, so **every** call with `options.persist === false` throws `ReferenceError: Cannot access 'skipped' before initialization`.

`runManualImportPreflight` calls `importOrientation(..., { persist: false })` at `js/pages/settings-imports.js:930` and `:933`. The throw is caught at `:962` and converted to a preflight failure, which `:1067-1086` then forces to **blocking**. Net effect: orientation preflight never succeeds.

**Required change.** Move the four declarations at `:5302-5305` to **above** the `if (options.persist === false)` block at `:5286`, preserving initializers. `preIpcSkipped` must already be defined at that point — verify by reading upward from `:5286`; if it is not, initialize `skipped` to `0` in the preflight return instead and leave the persist-path assignment where it is.

Do not change the returned shape. (The shape is polymorphic between preflight and commit — that is a known Phase 4 item, not this task.)

**Verification.**

1. **Before the fix**, confirm the throw. From the repo root:
   ```powershell
   node -e "const s=require('fs').readFileSync('js/pages/settings-imports.js','utf8'); const i=s.indexOf('let skipped = preIpcSkipped'); const j=s.indexOf('skipped,', s.indexOf('options.persist === false')); console.log('read at', j, 'decl at', i, '=> TDZ:', j < i && j > -1);"
   ```
   Expect `TDZ: true`.
2. **After the fix**, the same probe must print `TDZ: false`.
3. Runtime confirmation (preferred if the app can be launched): select an orientation file, observe that the review panel renders instead of a preflight failure.

**Acceptance.** Static probe flips to `false`; `--filter import` green.

**Note for the executing agent.** This is a one-line move. Resist the temptation to also fix the polymorphic return, the 5 positional parameters, or the 307-line function length — all Phase 4.

---

### T1.5 — **P1** Ministry XML preflight rejects valid files

| | |
|---|---|
| **Severity** | P1 — the ministry-XML import is unusable |
| **Files** | `js/import-center/import-readers.js:20-21, 147, 521-541` |
| **Test file** | `tests/import-center/import-readers.test.js` (extend — real `.xml` fixtures already exist) |

**Current state.** Two silent caps:

```js
// :20-21
const MAX_XML_ELEMENTS = 40;
const MAX_TEXT_BYTES = 512 * 1024;

// :147 — stops collecting distinct element names at 40
while ((em = elRe.exec(raw)) && elSet.size < MAX_XML_ELEMENTS) { … }

// :524, :530, :533, :539 — silently truncates decoded text, no flag
return decodeTextStrict(toBytes(file)).slice(0, MAX_TEXT_BYTES);
```

The live agent-XML preflight gate at `js/pages/settings-imports.js:945` requires `DATAIDENTIFPERSONNEL` to be present in `features.xmlElements`:

```js
const requiredElement = action === 'fet' ? 'Teacher' : 'DATAIDENTIFPERSONNEL';
```

A real `DsAgentExport` contains ≥9 reference tables before the personnel block — each contributing 3-4 distinct element names (`R_GRADE/CD_GRADE/LL_GRADE`, `R_Discip/CD_Discip/LL_DISCIP/LA_DISCIP`, `R_FONCT/…`, `R_DipSCol/…`, `R_DipProf/…`; enumerated at `settings-imports.js:3593-3607`). The 40-name cap is exhausted before `DATAIDENTIFPERSONNEL` is reached, and files above 512 KB lose their tail entirely. The importer itself allows 20 MB (`settings-imports.js:28`), so every realistic ministry file is rejected at preflight with `INVALID_FILE_STRUCTURE`.

**Required change.**

1. **Track required names separately from the capped set.** Add a `REQUIRED_XML_ELEMENTS` list (at minimum `Teacher`, `Teachers_Timetable`, `DATAIDENTIFPERSONNEL`, `AGENT`, `DsAgentExport`) and record their presence as booleans during the scan at `:147`, **regardless** of whether `elSet` is full. Merge those into the returned `xmlElements` so downstream `.includes()` checks keep working unchanged.
2. **Optionally short-circuit** the scan once every required name has been seen and `elSet` is full — a cheap win, not required for correctness.
3. **Surface truncation.** When `.slice(0, MAX_TEXT_BYTES)` actually shortens the input, set `truncated: true` (and `truncatedAt`) on the returned features object.
4. **Never draw a negative conclusion from a truncated read.** In `js/pages/settings-imports.js:942-950`, when `features.truncated === true` **and** the required element was not found, do not throw `INVALID_FILE_STRUCTURE` — the file may be valid past the cut. Report a distinct condition instead. Add a code to `js/import-center/import-diagnostics-codes.js` (SSOT) rather than inventing an inline string.

Do **not** simply raise the constants. `tests/import-boundaries.test.js:18-19` asserts the `MAX_*` literals verbatim; more importantly, raising a cap only moves the failure threshold.

**RED test first.** Extend `tests/import-center/import-readers.test.js`:

```
Case A: synthesized DsAgentExport with 45 distinct element names where
        DATAIDENTIFPERSONNEL appears LAST
        → xmlElements must include 'DATAIDENTIFPERSONNEL'   (today: absent)
Case B: XML text > MAX_TEXT_BYTES
        → features.truncated === true                        (today: undefined)
Case C: small valid FET file (existing fixture)
        → unchanged: xmlRoot 'Teachers_Timetable', includes 'Teacher'
```

Generate the Case A/B inputs in the test rather than adding large binary fixtures. If you do add fixture files, register them in `tests/fixtures/import-center/manifest.json` — `fixture-inventory.test.js` enforces provenance and a `sensitive:false` flag.

**Acceptance.** Three cases pass; `import-readers.test.js`, `import-encoding.test.js` and `import-boundaries.test.js` stay green.

---

### T1.6 — **P1** Ministry XML re-import nulls ~18 teacher columns

| | |
|---|---|
| **Severity** | P1 — silent loss of manually-entered teacher data |
| **Files** | `main/repos/staff.js:842-879` |
| **Test file** | new — `tests/staff-import-upsert.test.js` |

**Current state.** The `ON CONFLICT(ppr, school_year)` upsert mixes two policies. Most identity fields are protected:

```sql
cin        = COALESCE(excluded.cin, cin),
full_name  = COALESCE(excluded.full_name, full_name),
phone      = COALESCE(excluded.phone, phone),
```

But these are overwritten **unconditionally**, so a partial or older XML erases them:

```
specialty_subject, grade, cadre, position, statut,
seniority_admin, seniority_grade, echelon_date, titularization_date,
total_hours, overtime_hours, num_classes, is_surplus,
source, active,
source_function_code, source_assignment_mode, source_cycle_code,
source_updated_at, source_activity_json
```

**Required change.** Convert the ministry-sourced descriptive columns to `COALESCE(excluded.X, X)`:

`specialty_subject`, `grade`, `cadre`, `position`, `statut`, `seniority_admin`, `seniority_grade`, `echelon_date`, `titularization_date`, `total_hours`, `overtime_hours`, `num_classes`, `source_function_code`, `source_assignment_mode`, `source_cycle_code`, `source_activity_json`.

**Deliberately leave unconditional** (they describe the import event, not the teacher, and must always reflect the newest file):
- `source` — provenance marker
- `source_updated_at` — freshness timestamp
- `active` — see below
- `is_surplus` — see below

For `active` and `is_surplus`: these are booleans where `0` is meaningful, so `COALESCE` is the wrong tool (it only guards `NULL`). Determine from the parser at `js/pages/settings-imports.js:3805-3832` whether a missing XML tag yields `null` or `0`. If **`null`**, apply `COALESCE`. If **`0`**, leave unconditional and note the limitation in a code comment — do not invent a sentinel.

Follow the `subject` column's existing `CASE WHEN … != '' THEN … ELSE COALESCE(…)` pattern (`:845-849`) for any column where empty-string, not `NULL`, is the "absent" marker.

**RED test first.** New file `tests/staff-import-upsert.test.js`, modelled on the in-memory-SQLite setup in `tests/import-center/absences-replace-by-year.test.js`:

```
Case A: importBulk a teacher with full fields (PPR set)
        → then importBulk the SAME PPR with specialty_subject/grade/cadre absent
        → those three must retain their original values   (today: nulled)
Case B: second import DOES carry new values
        → the new values win                              (regression guard)
Case C: source_updated_at always reflects the latest import
Case D: teachers with no PPR still take the insert-by-name path unchanged
```

**Acceptance.** Four cases pass; `--filter import` green; `npm test` green (staff touches several suites).

---

### T1.7 — **P1** Import re-entrancy via keyboard shortcut

| | |
|---|---|
| **Severity** | P1 — concurrent imports race the same IPC channel |
| **Files** | `js/pages/settings-imports.js:523-529, 350-375, 2117-2126` |
| **Test** | covered by T2.2 (do the code change here, the test lands in Phase 2) |

**Current state.**

```js
// :523-529 — only disables buttons carrying [data-action]
function setImportButtonsDisabled(disabled) {
    document.querySelectorAll('[data-action]').forEach((btn) => {
        btn.disabled = disabled;
        btn.style.opacity = disabled ? '0.7' : '1';
        btn.style.pointerEvents = disabled ? 'none' : 'auto';
    });
}

// :2117-2126 — no guard, opens the picker unconditionally
async function runImport(action) {
    const inputId = FILE_INPUTS[action];
    const input = document.getElementById(inputId);
    if (!input) { showToast('…', 'error'); return; }
    updateImportSelectionStatus(`… ${ACTION_LABELS[action] || action}`);
    input.click();
}
```

The Ctrl+1..4 handler at `:379-387` calls `runImport(action)` **directly**, bypassing the disabled buttons. The hidden file inputs (`settings-imports.html:47-99`) carry no `data-action`, so they are never disabled either. Pressing Ctrl+2 during a running grades import opens a second picker and can start a concurrent import — racing `grades.saveBulk` and the shared `#semester-select`.

**Required change.**

1. Add a module-level `let importInFlight = false;` near the other module state (`:22-25`).
2. Set it `true` at the top of the file-input `change` handler (`:350`) and clear it in that handler's existing `finally` block (`:372-374`, which already resets `input.value`).
3. Guard `runImport` (`:2118`): if `importInFlight`, show a toast explaining an import is already running and return without calling `input.click()`. **Use the `Edit` tool** for the Arabic toast text (§0.2).
4. Extend `setImportButtonsDisabled` to also disable the seven file inputs listed in `FILE_INPUTS` (`:1-9`).

Do **not** attempt cancellation — that is a separate, larger change.

**Acceptance.** `--filter import` green. Manual check: trigger an import, press Ctrl+2 mid-run, confirm no second picker opens. Automated coverage arrives in T2.2.

---

### T1.8 — **P3** Delete dead functions in the page controller

| | |
|---|---|
| **Severity** | P3 — hygiene, ~210 lines |
| **Files** | `js/pages/settings-imports.js` |

**Candidates** (each reported as having zero call sites — **verify each independently before deleting**):

| Symbol | Line |
|---|---|
| `validateGrade` | 315 |
| `validateAbsenceHours` | 319 |
| `createAbsenceRecord` | 323 |
| `buildImportConfirmMessage` | 564 |
| `findTeacherNameColumnIndex` | 1670 |
| `findTeacherNameFromMeta` | 1690 |
| `inferSubjectFromFileName` | 1989 |
| `deriveLevelFromSection` | 2064 |
| `cellNumber` | 4535 |
| `parseOrientationAverage` | 4603 |
| `lastImportContextReview` (state) | declared 25; written 1152, 2387; **never read** |

(`debugGradesImport`, `debugFetImport`, `GRADES_IMPORT_DEBUG` are removed in T1.0.)

**Required change.** For **each** symbol, in order:

```powershell
rg -n "\b<symbol>\b" --glob "!node_modules" .
```

Delete **only** if the sole hits are the declaration itself. Pay attention to:
- `tests/**` — several test files assert on the *source text* of `settings-imports.js` (see §0.5 below). A `function X` assertion counts as a call site for this purpose: do not delete it, report it instead.
- `settings-imports.html` — the file is loaded as a classic script, so every top-level `function` declaration is implicitly `window.<name>`. Check the HTML too.
- `js/import-center/import-contracts.js:114-124` and `adapters/index.js:49-57` reference the seven importer names by string. None of the candidates above appear there, but confirm.

For `lastImportContextReview`: delete the declaration and both write sites.

**Acceptance.** `--filter import` green; `npm test` green; eslint clean. Record in the commit body which symbols were deleted and which were kept (with the blocking reference).

---

### T1.9 — **P3** Malformed `<strong>` splits an Arabic word

| | |
|---|---|
| **Severity** | P3 |
| **Files** | `settings-imports.html:426` |

**Current state.**

```html
<strong>تقرير مراجعة الاست</strong>يراد</strong>
```

The word «الاستيراد» is split across a tag boundary (breaking Arabic shaping and the bidi run in RTL), plus a stray unmatched `</strong>`. A balanced-tag scan reports this as the file's only markup error.

**Required change.** Replace with `<strong>تقرير مراجعة الاستيراد</strong>`. **Use the `Edit` tool** (§0.2).

**Acceptance.** Balanced-tag scan clean; `--filter import` green.

---

### T1.10 — **BLOCKED: decision required** — `timetable_data` never syncs

| | |
|---|---|
| **Severity** | P0 if sync is expected; P3 if local-only is intended |
| **Files** | `main/sync/capture.js:509-510`, `main/sync/entity-registry.js`, `main/repos/timetable.js:26-43` |
| **Status** | **DO NOT START** until the product decision is recorded below |

**Current state.**

```js
// main/sync/capture.js:509-510
'timetableData:save':   { tables:['timetable_data'], operation:'UPSERT', idExtractor:'argKey', exclude:true },
'timetableData:delete': { tables:['timetable_data'], operation:'DEL',    idExtractor:'argKey', exclude:true },
```

`timetable_data` has **no entry** in `main/sync/entity-registry.js`. The sole output of the FET import is device-local: import the timetable on one machine and no other device ever sees it — no error, no warning. `main/ipc/system-backup.js:46` restores the table, which masks the gap in testing.

The write-channel checklist (`docs/plans/2026-07-15-add-write-channel-checklist.md`, step 5) requires `{ exclude: true }` to carry a justifying comment. This entry has none, unlike every other local-only entry (compare `capture.js:501-505` and the `user_cycle_access` decision in `AGENTS.md`).

**The decision:** *should an FET timetable imported on one device appear on the others?*

**If YES** (treat as P0):
1. Register `timetable_data` in `main/sync/entity-registry.js`: `keyFields: ['school_year','cycle_code']`, `contractVersion: 2`, `requiredColumns: ['cycle_code']`, `snapshot: true`, remote collection name, writer roles matching the channel's auth.
2. Add `timetable_data` to `TOPO_ORDER_PUT` in `main/sync/engine/helpers.js:10-36`.
3. Change `capture.js:509-510` to `captureMode: 'explicit'` + `exclude: true`.
4. Add in-transaction capture in `main/repos/timetable.js:26-43` via `main/repos/capture-port.js` (**never** `require('../sync/capture')` — `AGENTS.md` rule 3).
5. Follow the full write-channel checklist. Add tests mirroring `tests/cycle-profiles.test.js`.

**If NO** (P3):
1. Add the justifying comment at `capture.js:509-510`.
2. Document it in `AGENTS.md` beside the other local-only decisions (page access, `user_cycle_access`).
3. Surface it in the import UI so operators know to import FET on each device.

**Record the decision here before starting:**

> **Decision:** YES — timetable_data should sync across devices (P0). FET timetable imported on one device must appear on others. Implemented: entity-registry `timetable_data` (`school_year`,`cycle_code`), `TOPO_ORDER_PUT`, `captureMode: explicit`, in-transaction capture via `capture-port`, `notifyCaptureCommitted`.
> **Decided by:** user (b) **Date:** 2026-08-08

---

### Phase 1 gate

- [ ] T1.0 landed first
- [ ] T1.1 – T1.9 complete (T1.10 either complete or explicitly deferred with the decision recorded)
- [ ] `node tests/run-all.js --filter import` green
- [ ] `npm test` green
- [ ] `npx eslint "js/import-center/**/*.js" "js/pages/settings-imports.js" "main/repos/*.js"` clean
- [ ] 5 new RED→GREEN test cases exist and demonstrably fail on reverted code
- [ ] T1.2's `birth_date` row count reported

---

## 2. Phase 2 — Build the safety net

Five tasks. Goal: make the live path testable, then use that capability immediately.

---

### T2.1 — `.xlsx` binary fixtures

| | |
|---|---|
| **Files** | `tests/fixtures/import-center/**`, `tests/fixtures/import-center/manifest.json` |
| **Depends on** | nothing |

**Current state.** `tests/fixtures/import-center/` exists with governed CSV and XML fixtures (`manifest.json` records provenance and a `sensitive:false` flag; `fixture-inventory.test.js` enforces ≥2 valid samples per type). But:

```powershell
Get-ChildItem tests -Include *.xlsx,*.xls -Recurse   # → empty
```

**Zero `.xlsx` fixtures exist.** `.xlsx` is the primary production format — it is first in every `accept` list (`settings-imports.html:51,58,66,81,96`) and the vendor lib is loaded at `:760`. Consequently the `XLSX.read → SheetNames → getSheetRows → rows[][]` conversion (merged cells, `raw` vs formatted values, Excel serials, blank-cell holes, multi-sheet ordering, `'`-prefixed text codes) is **structurally untestable**, and every parser test feeds hand-built arrays.

**Required change.** Add a minimum viable set, generated programmatically with the vendored `vendor/xlsx.full.min.js` (or the `xlsx` package if it is a devDependency — check `package.json` first) so the fixtures are reproducible rather than opaque binaries:

| Fixture | Purpose |
|---|---|
| `students/basic.xlsx` | happy path, Arabic headers |
| `students/latin-headers-lastname-first.xlsx` | **T1.1 regression** — `LastName` left of `FirstName` |
| `students/mixed-dates.xlsx` | **T1.2 regression** — Excel serial and `DD/MM/YYYY` string in one column |
| `grades/single-semester.xlsx` | happy path |
| `grades/mixed-semester-sheets.xlsx` | sheet 1 «الدورة الأولى», sheet 2 «الدورة الثانية» |
| `grades/header-only.xlsx` | zero data rows |
| `absences/massar-matrix.xlsx` | the positional month-matrix layout |
| `student_status/basic.xlsx` | happy path |

Prefer a small generator script committed alongside (e.g. `tests/fixtures/import-center/build-xlsx-fixtures.js`) so the binaries can be regenerated and reviewed as code.

**Register every fixture in `manifest.json`** with the same provenance/`sensitive` fields the existing entries use — otherwise `fixture-inventory.test.js` fails.

**Acceptance.** `node tests/run-all.js --only tests/import-center/fixture-inventory.test.js` green; a scratch script can `XLSX.read` each fixture and produce the expected sheet names.

**Constraint.** Fixtures must contain **no real student data**. Synthesize names and codes.

---

### T2.2 — First behavioural test for the live path

| | |
|---|---|
| **Files** | new — `tests/import-center/settings-imports-page.test.js` |
| **Depends on** | T2.1 |

**Current state.** `js/pages/settings-imports.js` is 5,479 lines and 128 top-level functions. It owns `runImport`, `handleImport`, `commitImport`, all seven per-type importers, `clearData`, the tafwij panel and the departed-students panel. **Four test files reference it — all four read it as a string via `fs.readFileSync`. No test has ever executed it.**

**Required change.** Build a `vm`-based DOM harness. **Follow the existing pattern in `tests/cycle-switcher.test.js`** — it already implements a minimal `ClassList`/element shim (`:19-45`) and evaluates a renderer script inside a `vm` context. Reuse that approach rather than inventing a new one, and reuse its shims where possible.

Harness must stub: `window.api` (the IPC channels the importers call), `XLSX` (or load the real vendored lib and feed it T2.1 fixtures), `showToast`, `showConfirm`, `escapeHtml`, `DataSourceRegistry`, `CrossSourceValidator`, `ImportContext`, `ImportReaders`, `ImportResultContract`, `OrientationErrorContract`, `PencilShared.TeacherIdentity`, `StudentImportParser`, `GradesImportParser`.

Minimum coverage:

| # | Scenario | Guards |
|---|---|---|
| 1 | Single-file students import, happy path | baseline |
| 2 | Students import with `LastName` left of `FirstName` | **T1.1** |
| 3 | Multi-file grades with an explicit semester selection | P1-3 (Phase 4) |
| 4 | Malformed / header-only file surfaces a diagnostic, writes nothing | — |
| 5 | Re-entrancy: `runImport` while `importInFlight` opens no second picker | **T1.7** |
| 6 | Orientation preflight returns a review object, does not throw | **T1.4** |

**Acceptance.** All six pass. Each must **fail** when its corresponding Phase 1 fix is reverted — verify this explicitly and paste the output in the commit body. This is the single most important deliverable in the plan: it is the first executable coverage of the live import path.

---

### T2.3 — Widen the source-text test assertions

| | |
|---|---|
| **Files** | 10 test files (listed below) |
| **Depends on** | nothing — land as its own commit |

**Current state.** Ten test files assert on the *source text* of `js/pages/settings-imports.js` using `String.includes` / regex over `fs.readFileSync`. Examples:

```js
// tests/import-center/manual-import-regression.test.js:87
assert.ok(pageJs.includes('if (options.autoSelectSemester) applyDetectedSemesterForSingleGradeFile(parsed.metadata.semester, 1)'))

// tests/import-boundaries.test.js:18
assert.ok(pageJs.includes('const MAX_XLSX_IMPORT_SIZE = 100 * 1024 * 1024;'))
```

These pass after a behaviour-breaking rename and fail on a cosmetic reformat. More importantly they **block Phase 4**: any extraction that moves a function out of the page file breaks them even though runtime behaviour is unchanged.

**Required change.** Introduce a shared helper (e.g. `tests/helpers/import-source.js`) exposing something like `importSourceIncludes(needle)` that searches `js/pages/settings-imports.js` **plus** `js/import-center/**/*.js`. Retarget the assertions to it.

Files to update:

```
tests/import-center/manual-import-regression.test.js
tests/import-center/package-7-cleanup.test.js
tests/import-center/package-1-properties.test.js
tests/import-center/package-1-ui.test.js
tests/import-center/package-2-properties.test.js
tests/import-center/adapters-contract.test.js
tests/import-center/import-center-phase-one.test.js
tests/import-boundaries.test.js
tests/tafwij-xss-regression.test.js
tests/import-center/absences-replace-by-year.test.js
```

Two special cases:
- `manual-import-regression.test.js:54-55` asserts that `import-preflight.js` and `orientation-import-adapter.js` appear as `<script>` tags, with the message *"preflight runtime is loaded"*. Both files are loaded and **never invoked**. **Delete these two lines** — they assert a tag, not behaviour, and they will block Phase 3.
- `package-1-ui.test.js:100-107` asserts certain scripts are **absent**. Those are negative assertions that stay valid — leave unchanged.

**Acceptance.** `npm test` green; the widened assertions still fail if the asserted literal is removed from *both* locations (verify with a scratch edit + revert).

---

### T2.4 — Row-failure policy: row-scoped for data, blocking for reference

| | |
|---|---|
| **Files** | `js/import-center/grades-import-parser.js:150-162, 405-430, 468-474`; `js/pages/settings-imports.js:3014-3038, 4149`; `js/import-center/students-import-parser.js:230` |
| **Depends on** | **T2.2** — write the test first, using the new harness |

**Decision (recorded):** data errors exclude the offending **row**; reference errors block the **file**. Nothing is ever dropped silently.

**Current state — two opposite failure modes coexist.**

Grades is all-or-nothing:

```js
// grades-import-parser.js:150 — severity defaults to 'error'
function diagnostic(code, message, sheet, row, field, severity = 'error') { … }

// :424-429 — one bad cell produces an 'error'
if (!Number.isFinite(grade) || grade < 0 || grade > 20) {
    counts.invalidRows += 1;
    diagnostics.push(diagnostic(Diagnostics.INVALID_GRADE, `…`, sheetName, rowIndex + 1, 'grade'));
    return;
}

// :473
valid: uniqueRecords.length > 0 && !diagnostics.some((item) => item.severity === 'error')

// settings-imports.js:3014-3015 — and the whole file is rejected
const errors = parsed.diagnostics.filter((item) => item.severity === 'error');
if (!parsed.valid || errors.length) { … throw … }
```

Note the parser already builds a clean `records[]` with bad rows dropped (`:408, :416, :429`). The rejection is caused purely by the severity default plus the `errors.length` test.

Students and status fail silently:

```js
// students-import-parser.js:230
if (!code) continue;                        // no diagnostic, no count

// settings-imports.js:4149-4152
skippedNoCode++;                            // counted, but no diagnostic
```

And absences silently coerce unparsable hours to `0` (`settings-imports.js:1855-1862`).

**Required change.**

1. **Classify diagnostics.** Add an explicit `blocking` flag (or a third severity tier) to `grades-import-parser.js:150`. Classify:
   - **Row-scoped (non-blocking):** `INVALID_GRADE` (`:427`)
   - **File-blocking:** `UNKNOWN_STUDENT` (`:414`), `STUDENT_CODE_MISSING` (`:407`), `GRADE_COLUMNS_NOT_FOUND` (`:373`), and the school-mismatch family
2. **Change the validity test** at `:473` to `uniqueRecords.length > 0 && !diagnostics.some((d) => d.blocking)`.
3. **Change the gate** at `settings-imports.js:3015` to test blocking diagnostics + `records.length > 0`.
4. **Add per-row diagnostics for silent skips:** `students-import-parser.js:230` and `settings-imports.js:4149`. Use codes from `js/import-center/import-diagnostics-codes.js` (SSOT) — add new ones there if needed, never inline strings.
5. **Surface reconciliation counts.** Every import must report `validCount` / `invalidCount` / `excludedFromWrite`. `ImportResultContract.outcomeSummary` already exists and is live at `settings-imports.js:772` — route through it.
6. **Show counts BEFORE confirmation.** The exclusion summary must appear in the review modal (`renderImportContextReview`, `settings-imports.js:741-768`), not only in the post-import report. An operator must not discover that 12 rows were dropped after the write.

**Rationale for the split** (do not "simplify" it away): a grade for a student code that exists nowhere cannot be written anywhere — importing "the other 400 rows" means twelve pupils silently have no marks. That must block. A single `"abs"` cell in a 400-row export is a *cell* defect, not a *file* defect, and forcing a re-export for it is what drives operators to work around the tool.

**RED test first** — in the T2.2 harness:

```
Case A: grades file, 1 unparsable cell out of 400 rows
        → 399 rows written, 1 reported as excluded, import SUCCEEDS   (today: whole file rejected)
Case B: grades file with 1 unknown student code
        → import BLOCKED, nothing written                             (today: same — regression guard)
Case C: students file with a code-less row
        → row skipped AND a diagnostic emitted AND counted            (today: silent)
Case D: the review modal shows the exclusion count before confirmation
```

**Acceptance.** Four cases pass; `grades-import-behavior.test.js` updated to reflect the new policy (its existing `INVALID_GRADE` expectations will change — that is intended, not a regression); `npm test` green.

---

### T2.5 — Wire `?type=` deep links

| | |
|---|---|
| **Files** | `js/pages/settings-imports.js`; retarget `tests/import-center/contextual-shortcuts.test.js:38-58` |
| **Depends on** | nothing (do last — lowest value) |

**Current state.** Eight pages link to `settings-imports.html?type=…&source=…`:

```
students-list.html:44          ?type=students
grades-sheets.html:42          ?type=grades
absence-analytics.html:43      ?type=absences
students-status.html:40        ?type=student-status
teachers-list.html:41          ?type=agent-xml
students-orientation.html:77   ?type=orientation
students-orientation.html:172  ?type=orientation
timetable.html:303             ?type=fet
js/pages/timetable.js:84       ?type=fet   (set at runtime)
js/pages/students-orientation.js:1208      (inside an empty-state message)
```

`settings-imports.js` reads `location.search` **only** at `:267`, for `debugGrades=1`. Every one of those links currently lands on the page and does nothing. The module built to consume them (`js/import-center/import-query-context.js`) is never loaded by any HTML.

**Required change.** ~25 lines in the `DOMContentLoaded` bootstrap (`:337-521`):

1. Read `?type=` via `URLSearchParams`.
2. Map the value to an action key using the existing `FILE_INPUTS` map (`:1-9`) — the link values already match those keys. Ignore unknown values silently.
3. Scroll the matching `.imports-action-card[data-action="…"]` into view and give it focus, with a brief visual highlight.
4. **Never auto-execute.** Do not call `runImport`. The user must click.

Do not load `import-query-context.js` — it is scheduled for deletion in Phase 3.

**Acceptance.** Navigating to `settings-imports.html?type=grades` focuses the grades card. `contextual-shortcuts.test.js:38-58` (which asserts the eight inbound links carry the params and no auto-execute flag) retargeted and green.

---

### Phase 2 gate

- [ ] `.xlsx` fixtures exist and are registered in `manifest.json`
- [ ] `tests/import-center/settings-imports-page.test.js` executes the live page controller
- [ ] Each of its 6 cases fails when the corresponding Phase 1 fix is reverted (evidence in commit bodies)
- [ ] Source-text assertions widened; the two dead `<script>`-tag assertions removed
- [ ] Row-failure policy converged; exclusion counts visible pre-confirmation
- [ ] `npm test` green; eslint clean
- [ ] **Reassess before starting Phase 3**

---

## 3. Risk register

| Risk | Task | Mitigation |
|---|---|---|
| **Stored dates already wrong.** T1.2 fixes the parser, not existing rows. A re-import now produces different values than the original import did. | T1.2 | Report the affected row count. Migration/backfill is a separate decision — flag and stop. |
| **T1.3 turns a working workflow into a refusal.** Operators doing section-by-section absence imports will start hitting `INCOMPLETE_COVERAGE`. | T1.3 | Intended. The Arabic message must state the remedy, not just refuse. |
| **T2.4 changes what gets written.** Files that previously failed entirely now import partially. | T2.4 | Exclusion counts must appear in the review modal *before* confirmation (step 6). |
| **T1.6 `active`/`is_surplus` semantics.** `COALESCE` only guards `NULL`; if the parser emits `0` for a missing tag, it is the wrong tool. | T1.6 | Determine the parser's actual output first. Do not guess; document the limitation if unresolved. |
| **T1.0 removes diagnostics someone relies on.** | T1.0 | The block is unreferenced by any module. Confirm nobody is mid-investigation. |
| **T2.2 harness drift.** A bespoke DOM shim can diverge from real browser behaviour and give false confidence. | T2.2 | Reuse `tests/cycle-switcher.test.js`'s shims. Every case must be proven to fail on reverted code — a test that cannot fail is not a test. |

---

## 4. Task dependency graph

```
T1.0 ──┬─> T1.1  T1.2  T1.3  T1.4  T1.5  T1.6  T1.8  T1.9   (parallel-safe)
       └─> T1.7 ──────────────────────────────┐
                                              │
T1.10  [BLOCKED — product decision]           │
                                              v
T2.1 ────────────────────────> T2.2 ────> T2.4
T2.3  (independent, any time)
T2.5  (independent, do last)
```

Parallelisation: T1.1/T1.2 (parsers), T1.3/T1.6 (repos) and T1.5 (readers) touch disjoint files and can run concurrently. T1.8 must run **after** the others, since deleting symbols is only safe once no in-flight task is about to reference them.

---

## 5. Recorded decisions for Phase 3 / 4 (not this pass)

Confirmed with the product owner on 2026-08-08:

- **Harvest before delete.** `import-signatures.js` `SIGNATURES` + `scoreSignature` (~300 lines) → new `js/import-center/import-type-check.js`, wired into `prepareImportContextReview` (`settings-imports.js:1065-1087`) as a **non-blocking warning**. Keep `signature-manifest.test.js`, re-pointed. **This harvest gates the deletion — do not delete `import-signatures.js` before it lands.** Motivation: clicking «استيراد التلاميذ» on a Massar grades export today silently creates student rows from a grades sheet. (The reverse — grades card on a students file — is already caught by `GRADE_COLUMNS_NOT_FOUND`.)
- **Also harvest:** `findBestHeaderRow` from `import-readers.js:326-402` (proper Massar sub-header merging) to replace the weaker `settings-imports.js:2103-2115`; and a `DUPLICATE_GRADE` warning at `grades-import-parser.js:458-463`, which today overwrites duplicates last-wins with no diagnostic.
- **Then delete** 19 modules + 18 test files ≈ 7,894 LOC / 312 KB / 39 files, plus 12 `<script>` tags at `settings-imports.html:746,748-758`. Four tests get edited, not deleted: `manual-import-regression`, `import-encoding`, `package-1-properties`, `contextual-shortcuts`. `package-1-ui.test.js` needs no change.
- **Phase 4 convergence:** one Arabic normalizer (promote `foldArabic`'s rules — ة→ه, ى→ي, tatweel, ٱ — into `normalize.js`, make the other four thin re-exports); extract **only** the absences/status/orientation parsers (the one extraction that kills the second header engine rather than relocating code); one error catalog (`import-result-contract.js` as SSOT + a test asserting every emitted code exists in it); parse-once via the existing `importFilePreflightCache`; main-process statement hoisting and `sync_snapshots`-on-capture.
  - Expected effect for a 20,000-grade import: **~60,000 SQL compilations → ~0**, ~100,000 executions → ~60,000, outbox rows **40,000 → 20,000**.

**Explicitly not planned:** full teardown of the 5,479-line page controller (17 of 21 candidate steps relocate code without removing duplication, and each carries a test-rewrite tax); reviving the orchestrator/session/queue (its retry and DAG only pay off with a queue UI that `package-1-ui.test.js:44-55` deliberately asserts was removed).

---

## 6. Findings log

Append anything discovered during execution that is **not** in this plan. Do not fix it inline.

| Date | Task | Finding | File:line | Severity |
|---|---|---|---|---|
| 2026-08-08 | audit | Orientation preflight TDZ — became T1.4 | `settings-imports.js:5293/5305` | P1 |
| 2026-08-08 | audit | 8 inert `?type=` deep links — became T2.5 | 8 files | P2 |
| 2026-08-08 | review | The plan's T1.4 verification probe is a false positive on the current tree: `options.persist === false` first occurs in `importAbsences`, so `indexOf('skipped,')` lands in an unrelated function. Verified the real fix by declaration order inside `importOrientation` (decl before the persist block). | `settings-imports.js` | P3 |
| 2026-08-08 | review | Tree already contains Phase-3/5 deletions (dead stack: `adapters/*`, `import-contracts.js`, `import-signatures.js`, orchestrator/session/view/classifier/query-context, 18 test files) and the `import-signatures` harvest (`import-type-check.js`) — beyond this plan's phases 1-2 scope, pre-existing in the working tree. `signature-manifest.test.js` re-pointed to `import-type-check.js`; suite green with the deletions in place. | `js/import-center/` | P3 |
| 2026-08-08 | review | T1.2 data-migration count cannot be computed in this environment: `./data/school.sqlite` is an empty dev placeholder (0 tables). Operator must run the `birth_date` SELECT against the real app DB before release. | `data/school.sqlite` | P2 |
| 2026-08-08 | review | Stale comment referencing the deleted `cellNumber` helper remains at `settings-imports.js:4792`. | `js/pages/settings-imports.js:4792` | P3 |
| 2026-08-09 | review-2 | **T1.1 regression (fixed):** the "exact match for aliases <5 chars" rule killed the 3-char alias `رمز`, so the header «رمز مسار» no longer resolved the student-code column. `students/valid-01.csv` and the new `students/mixed-dates.xlsx` fixture went from importing correctly to `STUDENT_CODE_COLUMN_MISSING` + `NO_VALID_STUDENTS`. Replaced with exact-outranks-substring scoring + exclusive role binding. | `js/import-center/students-import-parser.js:61-140` | P0 |
| 2026-08-09 | review-2 | **T1.1 premise wrong (fixed):** the plan assumed Arabic headers were safe. `normalizeKey('الاسم العائلي')` contains the `الاسم` alias, so the canonical Massar pair «الاسم العائلي»/«الاسم الشخصي» bound both name roles to one column (old code produced «بنعلي بنعلي»; the first fix turned it into a hard `AMBIGUOUS_HEADER_BINDING` error). Exclusive binding now resolves it; the diagnostic is a non-blocking warning reserved for a single column shared by both composed-name roles. | `js/import-center/students-import-parser.js:105-145` | P0 |
| 2026-08-09 | review-2 | **T1.1 applied to only one of the two header engines (fixed):** `settings-imports.js` keeps its own `findHeaderIndex` (first match, bare `'name'` alias). `importStudentStatus` used it to compose `full_name` and wrote through `students.addBulk`, so the original "Benali Benali" corruption was still live for the student-status import. Added `bindHeaderRoles` (exclusive best-match) and switched the status importer to it. | `js/pages/settings-imports.js:1705-1760, 4160-4183` | P0 |
| 2026-08-09 | review-2 | **T1.3 had no UI path forward (fixed):** the renderer gated the confirm-to-override dialog on `missingMonths.length`, but the new row-key guard returns an EMPTY `missingMonths` for the section-by-section case it was written for — the operator got a refusal with no way to confirm. Dialog now triggers on the code alone and falls back to `missingKeys` for the detail. | `js/pages/settings-imports.js:2599-2625` | P1 |
| 2026-08-09 | review-2 | **T1.5 step 4 not implemented (fixed):** `XML_TRUNCATED` was thrown as a preflight error, and `:1089` converts any invalid preflight to `blocking / canProceed:false` — an oversized ministry XML stayed blocked, which is exactly the "negative conclusion from a truncated read" the task forbade. Truncated-and-unverified now yields a valid, executable preflight carrying an `XML_TRUNCATED` warning. | `js/pages/settings-imports.js:938-968` | P1 |
| 2026-08-09 | review-2 | **T2.1 fixtures were inert (fixed):** no test read any `.xlsx` fixture, so the `XLSX.read → getSheetRows` path stayed untested and `students/mixed-dates.xlsx` parsed to zero records unnoticed. Added `tests/import-center/xlsx-fixture-parsing.test.js`. | `tests/fixtures/import-center/**` | P2 |
| 2026-08-09 | review-2 | **T2.2 cases could not fail (partly fixed):** cases 3/5/6 were wrapped in `if (typeof fn === 'function') … else { log('skipped') }` and passed silently; case 6's runtime probe fed `{rows: []}`, which throws `EMPTY_FILE` before the persist block, so it passed on reverted code too. Skips are now `assert.fail`, case 6 passes a row that survives validation, and the stubbed `OrientationErrorContract` was replaced by the real module. 7 of 10 cases still call the pure parsers directly rather than the page — an end-to-end `handleImport` case remains open. | `tests/import-center/settings-imports-page.test.js` | P2 |
| 2026-08-09 | review-2 | Review doc `2026-08-08-import-system-remediation-review.md` states `40361 → 2010-06-11` (actual and asserted: `2010-07-02`), `npm test` 255/256 in ~15 min (actual: 257/257 in ~110 s), and commit `5e3e33c` for the docs commit (actual: `9f97bcc`). | `docs/reviews/2026-08-08-import-system-remediation-review.md` | P3 |
| 2026-08-09 | review-2 | Open, not fixed: `excelDateToIso` drops `YYYY/MM/DD` strings to `''` (only ISO `-` and `DD/MM/YYYY` are matched); the page's `findHeaderIndex` is still a first-match duplicate of the parser engine (Phase 4 convergence); `settings-imports.js:4837` still references the deleted `cellNumber`; the T1.2 `birth_date` count still has to be run on a production DB. | multiple | P3 |
| | | | | |

---

## 7. Reference

**Audit:** `docs/reviews/2026-08-08-import-system-audit.md` — full finding list including the ~50 P2/P3 items not scheduled here.

**Binding project rules** (`AGENTS.md`):
- All domain SQL in `main/repos/*`, never `main/ipc/*`
- Repos reach change-tracking only via `main/repos/capture-port.js`
- Bulk writes: `captureMode:'explicit'` + `exclude:true`, outbox rows written **inside** the same transaction
- Full write-channel checklist: `docs/plans/2026-07-15-add-write-channel-checklist.md`
- Error contracts are SSOT modules with dual-export; no parallel catalogs (pattern 028)

**Related docs:** `docs/import-center/atomicity-matrix.md` (partial-failure rollback is a *documented non-guarantee* for 6 of 7 import types — pinned by `absences-replace-by-year.test.js:48-50`), `docs/import-center/contracts.md`, `docs/import-center/signatures.md`.

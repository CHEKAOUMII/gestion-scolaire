# Data-Import Pipeline Review — settings-imports.html → SQLite

**Date:** 2026-08-04
**Scope:** File reading → parsing → data normalization → preflight/context review → IPC → main repos → SQLite + sync outbox. Plus the shared filter system (`js/shared/filter-manager.js`) and a "unify manager-user filtering" assessment.
**Method:** 5 parallel sub-agent explorations (renderer orchestration, parsers/normalization, main-process save path, filter-manager adoption, supporting modules), cross-checked by the author.
**Status:** Review complete. Roadmap Phases 0–3 implemented 2026-08-04 (5 parallel sub-agents + author integration; 270/270 tests green, lint 0 errors). See [§12.1 Implementation Status](#121-implementation-status).

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Pipeline Overview](#2-pipeline-overview)
3. [Stage 1 — File Selection & Reading](#3-stage-1--file-selection--reading)
4. [Stage 2 — Parsing (per import type)](#4-stage-2--parsing-per-import-type)
5. [Stage 3 — Data Normalization](#5-stage-3--data-normalization)
6. [Stage 4 — Preflight Policy & Context Review](#6-stage-4--preflight-policy--context-review)
7. [Stage 5 — IPC & Repos (save to DB)](#7-stage-5--ipc--repos-save-to-db)
8. [Stage 6 — Post-Import Validation, Readiness & Logs](#8-stage-6--post-import-validation-readiness--logs)
9. [import-parser.js Review](#9-import-parserjs-review)
10. [Filter Manager & Filtering Unification](#10-filter-manager--filtering-unification)
11. [Prioritized Findings Register](#11-prioritized-findings-register)
12. [Recommendations / Roadmap](#12-recommendations--roadmap)
13. [Appendix — Full File Inventory](#13-appendix--full-file-inventory)

---

## 1. Executive Summary

The pipeline is **well-architected at the edges and fragmented in the middle**.

### What works well

- **Fail-closed context review.** Five high-risk import types (students, grades, absences, student-status, orientation) pass through a context-review gate backed by `import-context.js` + `import-preflight-policy.js` (a real decision table: template-version mismatch → block; school-year detected from cells → block; cycle high-confidence mismatch → block; semester/subject unknown → block for grades/absences).
- **Strict main-side cycle authorization.** Students/grades/absences repos re-derive the cycle from the session — renderer-supplied `cycle_code` is ignored; cross-cycle rows are skipped, never overwritten (`WHERE ... cycle_code = excluded.cycle_code`).
- **Correct sync-capture pattern for bulk imports.** Repos write outbox rows inside the same transaction (027 layering rule): `capture-port.js` inside `db.transaction(...)`, bulk channels are `exclude: true` in `CHANNEL_REGISTRY` with `captureMode: 'explicit'`.
- **Encoding fail-closed.** `decodeTextStrict` (import-readers.js:497) rejects undecodable encodings (e.g. Windows-1256) instead of silently writing mojibake.
- **Pure, testable parsers exist for students and grades.** They are XLSX/IPC-free, dual-export, return diagnostic objects, and never throw.

### What needs attention

- **Normalization is duplicated 2–5× across parsers.** Only `ma-education-labels.js` and `collegial-levels.js` / `qualifiant-levels.js` are consistently shared; even those are bypassed by the grades and students parsers (inline level tables).
- **Only 2 of 7 import types have dedicated parsers.** Absences, student-status, orientation, FET, and agent-XML parsing are ~1,300 lines of page-embedded functions in `settings-imports.js` that throw Arabic-string `Error`s and cannot be unit-tested or reused by the import-center adapters.
- **Three inconsistent error vocabularies coexist:** `ImportResultContract` codes, `OrientationErrorContract` codes, and plain `new Error(...)` literals that fall through to a generic fallback message.
- **Real security/audit gaps:** an unescaped FET-subject interpolation into `innerHTML` (XSS), an unauthenticated `systemLogs:add` channel (forgeable audit trail), and a silent student-`status` reset on re-import.
- **`filter-manager.js` is not a filtering framework.** It is a cascading level→class→subject select-populator with a phantom `teacher` key. Manager-user (and teacher) lists each hand-roll their own filtering; `settings-users.js` has no filtering at all.

### The normalization verdict (agreed 2026-08-04, see §5.5)

Normalization keeps its role but only as a **thin canonical-key SSOT**; ~70% of the current implementation is removable. Because the three teacher-name sources (grade Excel `الأستاذ: X`, FET XML `نور_الدين_السعيدي_`, Ministry `نور الدين السعيدي` + `EL SAIDI Noureddine`) represent the same identity in different orders/scripts/separators, a ~15-line shared `normalizeIdentityKey` + a pivot on the Ministry roster (PPR) is required — but the fuzzy/transliteration machinery, duplicated digit/key/date normalizers, and inline level tables can be deleted, with the tafwij manual-review panel as the only fallback. `decodeTextStrict` and the blank-clobber guards stay (they protect *correct* files too).

---

## 2. Pipeline Overview

```
[hidden <input type=file> change event] settings-imports.js:345
   │
   │  PRIORITY actions (students/grades/absences/student-status/orientation)
   ├─ showImportContextReview() :910
   │    └─ preflightImport() :806
   │         └─ ImportContext.extractContext(workbook, fileName, {action})
   │              (js/import-center/import-context.js — year/code/cycle/levels scan)
   │         └─ ImportContext.compareContexts(src, dst, action)
   │              └─ ImportPreflightPolicy.decide() → allow | require_review | block
   │         └─ renderImportContextReview() :742 + showConfirm() gate :916
   │
   │  fet / agent-xml → generic showConfirm() only (not high-risk per policy) :359-368
   │
   └─ commitImport(action, files) :2046
        ├─ students    → parseStudentSheets        (students-import-parser.js) :2550
        │                → getCodesByYear diff (mark transferred_in) :2564
        │                → window.api.students.addBulk(records)              :2580
        ├─ grades      → parseGradesSheets         (grades-import-parser.js) :2656
        │                → 5000-row cap, teacher resolve, assessment flatten :2687-2706
        │                → window.api.grades.saveBulk(records)               :2707
        ├─ absences    → importAbsences() (3 matrix modes, page-local)       :2743
        │                → staged rows; unknown codes → throw                :2177
        │                → window.api.absences.replaceByYear(year, rows)     :2267
        │                  (fallback deleteByYear + saveBulk)                :2272
        ├─ status      → importStudentStatus() (page-local)                  :3735
        │                → window.api.students.addBulk, 500/batch            :3868
        ├─ orientation → importOrientation() (page-local)                    :4766
        │                → year-match assert, dedupe, 500/batch
        │                → window.api.orientation.bulkUpsert({rows, schoolYear}) :4913
        ├─ fet         → importFetXml() (DOMParser, page-local)              :3017
        │                → auto teacher match (buildTeacherResolver :1375)
        │                → window.api.timetable.save(payload)                :3163/:3184
        │                → window.api.teachers.saveTafwijAliases             :1254
        └─ agent-xml   → importAgentXml() (DOMParser, page-local)            :3206
                         → window.api.teachers.importBulk(teachers)          :3503
        │
        → CrossSourceValidator.validateAfterImport(type, data)   (§8)
        → DataSourceRegistry.update(source, year, meta, warnings) (§8)
        → safeLogImport() → window.api.systemLogs.add(...) :3525   (⚠ unauthenticated)

Main side (per-domain handlers main/ipc/* → repos main/repos/*):
   handleWriteSoftAuth(wrapWithSyncCapture(...))  →  repo in db.transaction(...)
   repo writes rows + outbox rows (capture-port) inside the same txn
```

### IPC channel inventory per import type

| Import type | Channels | Batch cap |
|---|---|---|
| students | `students:addBulk`, `students:getCodesByYear`, `students:getAll`, `students:getByStatus`, `students:updateStatusBulk`, `students:deleteByYear` | 5000 |
| grades | `grades:saveBulk`, `grades:getAll`, `grades:deleteBySemester` | 5000 |
| absences | `absences:replaceByYear`, `absences:saveBulk`, `absences:deleteByYear`, `absences:getAll` | 5000 |
| orientation | `orientation:bulkUpsert`, `orientation:stats`, `orientation:clearYear` | 5000 (repo guard) |
| fet / tafwij | `timetable.save`, `timetable.get`, `timetable.delete`, `teachers.saveTafwijAliases`, `teachers.getAll` | 5 MB JSON blob |
| agent-xml | `teachers.importBulk`, `teachers.getAll`, `teachers.deleteByYear` | **none** ⚠ |
| shared | `reports.getIdentity`, `cycles.getActive`, `systemLogs.add/getAll`, `students.getByStatus` | — |

---

## 3. Stage 1 — File Selection & Reading

### 3.1 Flow

- `FILE_INPUTS` maps hidden inputs (`settings-imports.js:1-9`); `change` listener at `:345-383`; manual cards call `runImport(action)` → `fileInput.click()` (:1781, :1789); keyboard shortcuts Ctrl+1..4 (:387-395).
- Files are gathered as `Array.from(event.target.files || [])` (:346) — **multi-file is first-class** for grades/absences/status/orientation.
- Confirmation fan-out (:357-372): priority actions → `showImportContextReview`; fet/agent-xml → generic confirm.
- `finally { input.value = '' }` (:381) — re-selecting the same file re-fires `change`.
- Reading mechanics:
  - XLSX/CSV: `parseWorkbook(file)` :1637-1652 → `FileReader.readAsArrayBuffer` → `XLSX.read(new Uint8Array(...), {type:'array'})`; rows via `getSheetRows` (`sheet_to_json(..., {header:1, raw:true})`) :1737-1740.
  - FET/agent-XML: `FileReader.readAsText(file, 'UTF-8')` + `DOMParser.parseFromString(text, 'text/xml')` (:3200, :3520).
  - Orientation JSON: `readAsText` + `JSON.parse` (:4615-4666).

### 3.2 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| F9 | 🟡 | **No file-size guard anywhere.** A multi-hundred-MB file is read fully into memory; `getSheetRows` materializes every sheet into an array. Only grades caps parsed records (5000 at :2687). The import-center *reader* layer is bounded (512 KB / 5 sheets / 40 XML elements — import-readers.js:18-21,434) but the **manual** path is not. | settings-imports.js:1637-1740 |
| F17 | 🟡 | **No `reader.onabort` / no timeout.** If the OS cancels the read, `parseWorkbook`/`parseOrientationJsonFile`/`importFetXml`/`importAgentXml` promises never resolve — progress bar hangs mid-import. | :1637-1652, :3017, :3206 |
| F18 | 🟢 | `parseWorkbook` on a 0-byte XLSX lets `XLSX.read` throw, surfaced as the generic «تعذر قراءة الملف» rather than a mapped `EMPTY_FILE`. | :1649 |
| F19 | 🟢 | `importWorkbookCache` (WeakMap, :23) is reused by students/grades/absences/status in commit, but orientation and the XML paths re-parse, ignoring the cache. | :847, :2117, :3017 |

---

## 4. Stage 2 — Parsing (per import type)

### 4.1 Inventory

| Type | Parser | Nature | Output shape (per record) |
|---|---|---|---|
| students | `StudentImportParser.parseStudentSheets` (`js/import-center/students-import-parser.js`, 363 L) | Pure, returns object | `{code, full_name, family_name, birth_date, birth_place, gender, section, level, school_name, school_year, status:'active', registration_type:'new'}` |
| grades | `GradesImportParser.parseGradesSheets` (`js/import-center/grades-import-parser.js`, 481 L) | Pure, returns object | `{student_id, student_code, teacher_id, subject, assessment, grade, semester, teacher_name, level, section, school_year}` |
| absences | `importAbsences()` page-local :2743-3015 | Throws Arabic `Error` | `{student_id, student_code, absence_date, month, absence_type, hours, days, reason:'', school_year}` (3 modes: Massar matrix :2758, 3-level header matrix :2859, simple rows :2933) |
| student-status | `importStudentStatus()` page-local :3735-3886 | Throws Arabic `Error` | `{code, full_name, family_name, birth_date, birth_place, gender, section, school_year, status}` |
| orientation | `importOrientation()` / `extractOrientationRowsFromWorkbook()` / `normalizeOrientationRecord()` page-local :4041-4954 | Contract-based (OrientationErrorContract) | `{student_code, full_name, gender, section, level, origin_stream, choice_1..3, assigned_stream, decision_status, average, rank_num, notes, school_year}` |
| fet | `importFetXml()` page-local :3017-3202 | Throws Arabic `Error` | timetable blob `{version:2, teachers[], teacherMetaByKey{}, subjects[], classes[], timetables{}, unresolvedTeacherKeys[]}` |
| agent-xml | `importAgentXml()` page-local :3206-3522 | Throws Arabic `Error` | ~40-field teacher object `{ppr, cin, full_name, full_name_fr, ... source:'agent_xml', school_year, active:1, source_cycle_code, scope_type, ...}` |

**Also present (preflight-only, parallel):** `js/import-center/import-readers.js` (hdr heuristic, `findBestHeaderRow`/`mergeHeaderRows`, CSV/XML/XLSX readers) and `js/import-center/import-row-validation.js` (648 L, per-row `rowOutcomes`, `validateXmlStructure`) — these back the import-center adapters and form a **second, disconnected parse layer**.

### 4.2 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| F11 | 🟡 | **5 of 7 import types are page-embedded and non-testable.** Absences/status/orientation/fet/agent-xml parsing cannot be unit-tested in Node and cannot be reused by the import-center adapters or by `timetable.js` (which has its own `parseFetFile` — a 4th FET parser). | settings-imports.js:2743,3735,4766,3017,3206; timetable.js:1269 |
| F20 | 🟡 | **Two parallel parse pipelines share nothing.** The manual flow (page functions) and the preflight flow (import-readers + row-validation) implement separate header heuristics, alias tables, and normalization. A header that `findBestHeaderRow` finds is never reused by the commit parsers. | §13 |
| F21 | 🟢 | `js/shared/fet-import.js` is the good pattern: shared constants/helpers (day mappings, `getBaseClassName`, `ensureFetDaySkeleton`) — but it is **not** a parser; real XML parsing lives in 2 page files. | fet-import.js:25-71 |
| F22 | 🟢 | Orientation JSON is the most defensive parser (5 shape detections, explicit `EMPTY_FILE`, `INVALID_FILE_STRUCTURE`, `UNSUPPORTED_FORMAT`). | :4615-4701 |

---

## 5. Stage 3 — Data Normalization

### 5.1 Shared SSOT modules (the "good" ones)

| Module | Provides | Consumed where |
|---|---|---|
| `js/data/ma-education-labels.js` | `normalizeSubjectName` (470-483), `translateSubject` (393-422, memoized), `translateCadre`, `translateGrade`, `translateMaritalStatus` | grades parser, FET import, agent-XML import, `utils.js:2584` |
| `js/shared/education/collegial-levels.js` | `resolveLevel` | students parser :165, settings-imports :1705 |
| `js/shared/education/qualifiant-levels.js` | `QUALIFIANT_LEVELS`, `LEVEL_CODE_TO_AR`, `matchLevelFromSection` (75-92) | `utils.js` :2410-2422, settings-imports :1714-1716 — **NOT** the grades/students parsers |

### 5.2 Duplication register (with evidence)

| Operation | Copies | Re-implementations (each a separate body) |
|---|---|---|
| Arabic→Latin digits (`٠-٩`) | **4** | students-import-parser:40-42; grades-import-parser:35-37; teachers-performance.js:380-382; tracking-teachers-performance.js:362-364 |
| Key normalize (NFD + strip combining + strip tashkeel + lowercase + alnum-filter) | **5 variants** | students:44-51; grades:39-47; settings-imports:1278-1286; import-row-validation:58-65 (NFKD); import-readers `normalizeHeaderCell`:207-214 (NFKD) |
| Student-code normalize (space/quote/`.0`/upper) | **4** | students:53-58; grades:49-55; settings-imports:1288-1294 (no Arabic-digit step); row-validation:305 (trim only — weakest) |
| Excel date → ISO | **2** | students:60-68; settings-imports:1501-1509 (identical) |
| Subject suffix strip `(فرض n)` / `(الأنشطة المندمجة)` | **4** | ma-education-labels:475-477; utils.js:2577-2578; grades:105-108; cc-rules.js:144-146 — the exact same regex |
| Qualifiant level tables | **3 inline (divergent) + 1 SSOT** | students:170-184 & grades:115-128 (both bypass the SSOT); settings-imports:1672-1700 |
| School-year `20XX[/-]20XX` regex | **3** | grades:137-140; settings-imports:3978-3985; import-readers:86-95 |
| Header alias tables (`code/massar/cne/الرمز`) | **5 independent tables** | students:23-34; grades:15-27; settings-imports:191-260; row-validation:80-100; import-readers:166-228 |
| Header matching semantics | **divergent** | one-directional `key.includes(alias)` (students:82, grades:70, settings-imports:1488) vs **bidirectional include** (row-validation:67-78) |
| `label: value` + neighbor-cell metadata scan | **2** | students `readLabeledValue`:128-151; grades `extractLabeledValue`:173-199 |
| Strict numeric parse (comma→dot, never coerce 0) | **3 variants inline** | grades `parseGrade`:142-148; settings-imports `toNumber`:1589-1596; `parseOrientationNumericStrict`:4041-4051 |
| Trim helper `text()` | **2** | students:36-38; grades:57-59 |
| Month→number map | **1 (page-local only)** | settings-imports `parseMonthNumber`:1511-1577 |

### 5.3 Divergence risks from duplication

- **Blank vs null sentinel differs per layer:** students/grades/page parsers use `''`; `import-row-validation` `normalizedRecord` uses `null` for blank grade/hours (:457,460); orientation uses `null` (:4382-4398). A future shared consumer cannot assume one.
- **Same field, different normalization strength:** code normalization is full-featured in the pure parsers but only `.trim()` in `row-validation` — the preflight review can approve rows the commit path normalizes differently.
- **Level resolution divergence:** students inlines `1BACSEG→الأولى باكالوريا علوم تجريبية` (duplicating `qualifiant-levels.js`), grades inlines its own regex table, settings-imports uses the SSOT — three different answers for the same cell are possible.

### 5.4 Security notes

- No prototype-pollution or ReDoS vectors found in the parse path (alias matching happens after char-filtering; regexes are short and linear).
- `decodeTextStrict` is the strongest defensive point and should survive any parser consolidation.

### 5.5 Verdict & agreed direction (review follow-up 2026-08-04)

**Question debated:** the input files are internally well-formed ("correct naming") — does the normalization layer still hold any importance?

**Agreed answer:** normalization keeps its role, but only as a **thin canonical-key SSOT**; roughly **~70% of the current implementation is removable**. The debate's key evidence — the actual shape of the three teacher-name sources:

| Source | Real format | Same logical person appears as |
|---|---|---|
| FET XML (`<Teacher name>`) | Arabic, family-first, `_` separators, **trailing `_` / double `__` artifacts**, mixed `_`-vs-space style | `نور_الدين_السعيدي_` |
| Grade Excel (sheet heading) | `الأستاذ: <name>` display string | `الأستاذ: نور الدين السعيدي` |
| Ministry XML | NOMA = Arabic **first-first**; NOML = Latin **family-first uppercase** | `نور الدين السعيدي` + `EL SAIDI Noureddine` |

Each file is internally correct — but the same identity is 3 different strings, with **flipped token order (family-first vs first-first), two scripts, and separator garbage**. That is a *format* problem, not a *correctness* problem, and it is precisely what normalization must bridge. "Correct naming" does not mean "identical naming."

**Agreed simplification plan (pivot on the Ministry roster):**

1. The Ministry XML is the authoritative identity source (carries PPR). Use the existing `(ppr, school_year)` teacher identity once per year; do not add a new `teacher_key` table or column.
2. Store deterministic Arabic/Latin order variants in the existing `teacher_aliases` table. Grade-Excel and FET names reduce to *normalize-then-lookup* against those aliases. No second identity system.
3. The manual tafwij review panel is the **only** fallback — never auto-transliterate.
4. **Delete** the Latin transliteration engine, the Levenshtein fuzzy pass (0.85/0.88 thresholds), the duplicated digit/key/date normalizers, the inline level tables, and the per-parser header alias soup.
5. **Keep**:
   - one shared `normalizeIdentityKey` (~15 lines): strip `_` / whitespace / punctuation / titles → Arabic fold (`أإآ→ا`, `ة→ه`, `ى→ي`) → NFC → ordered tokens → joined key;
   - `decodeTextStrict` (encoding guard — a correct file can still be silently corrupted by Windows-1256);
   - the blank-clobber guards (F3/F4 happen with **perfectly correct** files).

**Net verdict:** the user's instinct is correct — a large share of the layer is removable once teacher joining pivots on the Ministry roster. What remains is a ~15-line shared canonical-key function plus the encoding/blank guards, which is exactly the right size for this pipeline.

---

## 6. Stage 4 — Preflight Policy & Context Review

### 6.1 How it works

- `import-context.js` (382 L, dual-export) extracts **source context** from the first 60 rows of the workbook + the filename:
  - `school_year` via first-year regex then filename fallback (`source:'filename'`); `normalizeYear` requires second year = first+1 (:63-68).
  - institution code/name via `findLabeledValue` alias regexes (:176-183).
  - cycle via labeled value search + full-cell scan; `confidence:'high'` only from an explicit labeled cell, else `'medium'`/`'derived'` (:126-154).
  - levels/streams/sections via `collectLabeledMetadata` (:156-168).
- **Destination context** (`getImportDestinationContext` settings-imports.js:657-687) resolves from `reports.getIdentity()` + `cycles.getActive()`; throws `DESTINATION_CONTEXT_UNAVAILABLE` and `CYCLE_SELECTION_REQUIRED` (when >1 usable cycle: `active.requiresSelection`).
- `compareContexts` (:243-361) produces per-field checks, then `import-preflight-policy.js` decides.

### 6.2 Policy decision table (import-preflight-policy.js)

```
PERMISSIVE          match / info                          → allow
BLOCK               templateVersion non-match             → block
REVIEW              institutionName any                   → require_review
schoolYear mismatch → source 'filename' → review
                     else high-risk     → block, else review
institutionCode mism→ high-risk         → block, else review
cycle mismatch      → highRisk && conf high → block, else review
cycle unknown       → high-risk         → block, else review
semester|subject|studentCodes non-match → grades/absences → block, else review
FALLBACK            warning|mismatch|missing|unknown      → review; else allow
```

### 6.3 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| F23 | 🟡 | **fet/agent-xml skip the context review** by design (not in `PRIORITY_IMPORT_ACTIONS`); they get only a generic confirm. For those, `lastImportContextReview = null` so the audit line logs «غير متحقق». | :356-368, :2051 |
| F24 | ✅ | Semester is extracted into the import context and grades commit blocks when it differs from `#semester-select`. | import-context.js:225-254; settings-imports.js:3041-3048 |
| F25 | 🟢 | The destination context is stamped into the audit log but **not merged into the payloads** — main re-derives the cycle, so the review is advisory + gate, and IPC is authoritative. Coherent design. | :883, :2333, §7 |
| F26 | 🟢 | Review and commit re-parse the same blob (harmless TOCTOU, same `File` object). | §2 |

---

## 7. Stage 5 — IPC & Repos (save to DB)

### 7.1 Handler inventory (`main/ipc/*`)

All write channels use `handleWriteSoftAuth` (+ `wrapWithSyncCapture` unless `exclude:true`). `handleWriteSoftAuth` semantics (`main/ipc/ipc-helpers.js:233-288`): no session → blocked unless `allowNoSession:true`; the no-session path only logs an `UNAUTHENTICATED_WRITE` row, it does **not** check roles.

| Channel | Handler | Roles | Payload validation |
|---|---|---|---|
| `students:addBulk` | students.js:80-99 | WRITE_ROLES | array + cap 5000; per-row code/full_name/school_year; cycle from session |
| `students:deleteByYear` | students.js:114-124 | WRITE_ROLES | year |
| `students:updateStatusBulk` | students.js:126-141 | WRITE_ROLES | array + cap 500, no per-row |
| `grades:saveBulk` | grades.js:104-137 | WRITE_ROLES | array + cap 5000; per-row code/subject/semester/year; `validateRange('grade',0,20)`; semester ∈ {1,2} |
| `absences:saveBulk` | absences.js:25-34 | WRITE_ROLES | array + cap 5000; per-row code/month/year — **no date/hours validation** |
| `absences:replaceByYear` | absences.js:47-57 | WRITE_ROLES | year + array (same weak per-row) |
| `teachers:importBulk` | staff.js:89-93 | WRITE_ROLES | array + per-row school-year — **no batch cap** ⚠ |
| `teachers:deleteByYear` | staff.js:79-82 | **admin only** | year |
| `teachers:saveTafwijAliases` | staff.js:84-87 | WRITE_ROLES | year |
| `orientation:bulkUpsert` | orientation.js:284-312 | WRITE_ROLES | `prepareBulkUpsertPayload` (year coerce, code dedupe, skip reasons) |
| `orientation:clearYear` | orientation.js:315-322 | WRITE_ROLES | year |
| `timetableData:save` | timetable-data.js:53-71 | WRITE_ROLES | `requireSchoolYear`, 5 MB JSON cap |
| `systemLogs:add` | system.js:185-215 | **raw handler — no auth** ⚠ | none |

### 7.2 Repo write functions (`main/repos/*`)

All bulk repos follow the 027 pattern (SQL in repos, capture-port inside the txn, bulk channels `exclude:true` in `CHANNEL_REGISTRY`).

- **`students.addBulk`** (students.js:163-230): upsert `ON CONFLICT(code, school_year) DO UPDATE ... WHERE students.cycle_code = excluded.cycle_code`; main-side re-normalization via `|| ''` + `status || 'active'`; capture `captureInputUpserts` inside txn (:213).
- **`grades.saveBulk`** (grades.js:268-326): per-row `resolveStudentOwnership` (unknown → **throws, whole batch rolls back**; foreign-cycle → skipped, reported); upsert key `(student_code, subject, semester, school_year)`; optional assignment-suggestion cascade in the same txn (:309-311); per-row `existing.get` (:293).
- **`absences.saveBulk`** (absences.js:104-131): upsert key `(student_code, month, school_year, absence_type)`, merge on conflict; `replaceByYear` (:186-218): delete year/cycle + insert staged rows **in one txn**.
- **`orientation.bulkUpsert`** (orientation.js:443-744): non-destructive merge (last-wins per `(student_code, school_year)`); `mapRow` upper/locale numeric normalize (:48-63); cycle re-derived from roster; `no_matching_student` rows rejected (gated on `hasStudentCycleCode`) (:626-635); ~4 queries/row (:557,574,587); capture inside txn (:716).
- **`staff.importBulk`** (staff.js:787-958): txn; upsert by `(ppr, school_year)` with `insertByName` fallback; captures teachers + teacher_aliases via `captureResolvedRows` (:945-953); **no cap**.
- **`timetableRepo.upsertByCycle`** (timetable.js:26-37): single-statement upsert of the whole JSON blob; `timetable_data` is **not a sync entity** (device-local).

### 7.3 Findings (the most impactful)

| # | Severity | Finding | Location |
|---|---|---|---|
| F2 | 🔴 | **`systemLogs:add` is unauthenticated** (raw `ipcMain.handle`) and all import/stats audit entries are written **from the renderer**. A compromised renderer can forge the entire audit trail; main-side repos write no audit rows (stage-rules is the exception). | main/ipc/system.js:185-215 |
| F3 | 🔴 | **Re-import resets student `status` to `'active'`.** The upsert SET list includes `status=excluded.status` with no `COALESCE(NULLIF(...))` guard (unlike `level`/`school_name`). A second import of the same Massar file erases mid-year `dropout`/`expelled` statuses. | main/repos/students.js:168-179,204 |
| F4 | 🔴 | **Grades bulk clobbers empty `level`/`section`.** IPC `resolveRow` sets `level: grade.level || ''` and the upsert writes them verbatim — a row missing section/level silently blanks the DB columns. Opposite guard to students. | main/ipc/grades.js:117-118; main/repos/grades.js:231-232 |
| F5 | 🔴 | **`orientation:clearYear` has no transaction and no capture** — cleared rows never produce DEL tombstones for other devices (snapshot reconcile is the only backstop). | main/repos/orientation.js:746-749 |
| F6 | 🔴 | **`teachers:importBulk` has no batch-size cap** (the only bulk import without one) and only `full_name`/`school_year` presence is enforced per row. | main/ipc/staff.js:89-93; main/repos/staff.js:787 |
| F7 | 🟡 | **Absence bulk path skips date/hours validation** (single-row `absences:save` validates both). Month-matrix mode stores `absence_date: ''`. | main/ipc/absences.js:30-31 vs :22; settings-imports.js:2796 |
| F8 | 🟡 | **`replaceByYear` is destructive**: deletes the entire year/cycle then inserts staged rows in one txn — a partial file (or unknown/foreign rows) silently wipes other months. | main/repos/absences.js:186-218,190 |
| F13 | 🟡 | **Post-commit capture for single-row channels** (`wrapWithSyncCapture` runs the handler first, then captures the outbox in a separate write). Crash between commit and capture = silent sync loss. Bulk repos are exempt (in-txn capture). | main/sync/capture.js:768-814,781-793 |
| F10-* | 🟡 | **Per-row N+1 inside bulk txns:** grades `existing.get` per row (:293); orientation ~4 queries/row (:557,574,587) + `captureInputUpserts` re-reads each applied row (capture.js:625). Acceptable in WAL but not batch-prepared. | main/repos/grades.js, orientation.js |
| F27 | 🟢 | `grades:deleteBySemester` uses `parseInt(semester,10) || 1` — a falsy semester silently deletes semester 1. | main/ipc/grades.js:150, main/repos/grades.js:383 |
| F28 | 🟢 | Teachers writes are **not cycle-scoped** (`source_cycle_code` stored but unused); `teachers:deleteByYear` deletes all cycles' teachers for the year. Today institution-wide by design — flag for the multi-stage future. | main/ipc/staff.js, main/repos/staff.js |

### 7.4 Delete / clear actions (btn-clear-*)

| UI type | Channel | Transaction / capture |
|---|---|---|
| students | `students:deleteByYear` | txn, captures DELs incl. dependent tables (chunked 500) |
| grades | `grades:deleteBySemester` | txn, captures DELs, cycle-scoped |
| absences | `absences:deleteByYear` | txn, captures DELs |
| teachers | `teachers:deleteByYear` | txn, captures (admin-only) |
| timetable | `timetableData:delete` | single DELETE, no capture (local-only table) |
| status reset | `students:getByStatus` + `updateStatusBulk` | txn on update, captures |
| orientation | `orientation:clearYear` | **no txn, no capture** ⚠ |

### 7.5 Backup/restore (brief)

- **Renderer legacy** `js/backup.js`: JSON envelope v2; `data` = full localStorage snapshot, `database` = optional base64 SQLite via `system.backupDb`; 500 MB client cap; local rollback on write failure but no cross-part (local+DB) atomicity; `formatVersion` saved but never validated on restore.
- **Main** `main/ipc/system-backup.js`: `database.backup()` → base64 + cycle inventory + contract versions; restore-content sanitizes rows and routes through capture.

---

## 8. Stage 6 — Post-Import Validation, Readiness & Logs

### 8.1 Cross-source validation (`js/cross-source-validator.js`)

- Contract: `validateAfterImport(type, data) → Promise<{valid, warnings}>`; **never throws** (internal try/catch).
- Checks: `_validateGrades` → SECTION_NOT_FOUND (error), TEACHER_IN_GRADES_UNRESOLVED (warning), LEVEL_SECTION_MISMATCH (warning); `_validateAbsences` → STUDENT_CODE_NOT_FOUND (error) + teacher warning; `_validateFet` → TEACHER_FET_UNRESOLVED (warning); `_validateAgentXml` → DUPLICATE_PPR (warning).
- Resolver built once per `validateAfterImport`, but **each import re-fetches `teachers.getAll` + `timetable.get`**.

### 8.2 Data-source registry (`js/data-source-registry.js`)

- Pure localStorage store (key `dataSourceRegistry`), header-commented «Future: imported by js/master-data.js» (module doesn't exist yet).
- Readiness is **not computed here** — `renderImportStatusPanel` (settings-imports.js:31-107) derives status from `importedAt` presence + warning levels. **Never reconciled against the actual DB**; a source cleared outside `clear()` stays "ok".

### 8.3 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| F1 | 🔴 | **XSS: unescaped FET subject → innerHTML.** `renderTafwijMatchingPanel` joins `entry.subjects` (from FET XML `<Subject name=...>`) and interpolates them **without `escapeHtml`** into `tbody.innerHTML` (:1221), while the rest of the row is escaped (:1210-1215). Attacker-controlled file data → HTML injection. Also the only page-local usage that lacks a `typeof escapeHtml` guard. | settings-imports.js:1206-1222 |
| F29 | 🟡 | **Teacher-name checks are warning-only** — a fully unmatched FET/grades file only yellows the panel, never blocks. | cross-source-validator.js |
| F30 | 🟡 | Warning objects are free-form `{level, code, message, count}` Arabic strings with **no shared error contract**. | cross-source-validator.js |
| F31 | 🟡 | **Name-matching split-brain:** FET auto-link uses strict exact `buildTeacherResolver` (:1375, differs from `NameResolver.normalizeName`), while the fuzzy/transliteration `NameResolver` only powers *warnings*. A name the validator flags "unresolved" was never offered to the auto-matcher. | :1375 vs name-resolver.js |
| F32 | 🟡 | `resolveAsync` is awaited serially per name in validators → many IPC round-trips on large rosters; Levenshtein is O(candidates × len²) with a full DP array per comparison. | name-resolver.js |

### 8.4 Name resolver quality (`js/name-resolver.js`)

- 6-step pipeline: exact → swapped (2-token only) → stripped titles (0.93 cap) → transliterated (Latin skeleton, similarity ≥ 0.88) → fuzzy (≥ 0.85) → alias via `getNameAliases`.
- Weaknesses: `_latinSkeleton` drops `ع` entirely; 0.85/0.88 thresholds are generous for short names; 3-part names never get order-rotation; aliases fetched once per validator run.

---

## 9. import-parser.js Review

> Note: there is no single `import-parser.js`. The parsers are `js/import-center/students-import-parser.js` and `js/import-center/grades-import-parser.js` (plus page-embedded functions listed in §4).

### 9.1 Strengths

- **Pure & testable:** no DOM/IPC/XLSX dependencies (documented in header, students:1-4).
- **UMD dual-export** (global + `module.exports`) — Node-testable and browser-loadable.
- **Return-not-throw contract:** `{valid, records, diagnostics, counts}` with per-row diagnostics `{code, severity, stage:'parse', sheet, row, field, rule, action}`.
- **Hard-block on structural ambiguity:** `MULTIPLE_SCHOOLS` / `SCHOOL_MISMATCH` invalidate the whole workbook; duplicate codes are warned.
- **Grade scale enforced:** `INVALID_GRADE` per cell outside 0-20, parse continues.

### 9.2 Weaknesses

| # | Severity | Finding | Location |
|---|---|---|---|
| F12a | 🟡 | **Diagnostic codes are inline literals, not SSOT.** `INVALID_GRADE` exists independently in grades-import-parser:427 **and** import-row-validation:343; code sets are per-file. No import from `js/shared/errors/*` anywhere in `js/import-center` (grep: zero hits). | grades-import-parser.js, import-row-validation.js |
| F12b | 🟡 | **Gender is raw pass-through** — no M/F/ذكر/أنثى mapping. | students-import-parser.js:294 |
| F12c | 🟡 | **`grades.normalizeLevel` is a fully inline regex table** that diverges from the `qualifiant-levels.js` SSOT (different mechanism, different coverage). | grades-import-parser.js:115-128 |
| F12d | 🟢 | **Blank sentinel = `''`** in both parsers; the parallel row-validation pipeline uses `null`. | students/grades vs row-validation:457,460 |
| F12e | 🟢 | `student_id` in grade records is `null` at parse time (`teacher_id: null`) — ownership resolved later in the repo; a stale/cached grade row carries no student FK until save. | grades-import-parser.js:435-447 |

---

## 10. Filter Manager & Filtering Unification

### 10.1 What `js/shared/filter-manager.js` actually is

438 lines, dual-export (`PencilShared.FilterManager` + bare global; re-exported by `utils.js:2851`). **It is not a row/column filtering framework** — it is a cascading **level → class → subject** `<select>` populator for Arabic school catalogs:

- Config: `{selectors:{level,class,subject,teacher}, onChange, onError, placeholders, subjectsFromGrades, year, autoInit}` (:39-69).
- API: `init`, `getValues`, `setValues`, `reset`, `getData`, `getLoadWarnings`, `destroy` — no rows, no columns, no comparison modes, no pagination, **no per-page state persistence** (only `students-list.js` persists filters itself via `sl_filters`).
- **The `teacher` key is a stub:** placeholder + event wiring only (:48, :105-107, :415-420); `_loadData` never fetches teachers.
- No Arabic folding anywhere in the file (أ/إ/آ, ة→ه, tatweel); only `.toLowerCase()` at :260. The only Arabic normalizer in the app lives in `cc-rules.js:632-636`, not in filtering.

### 10.2 Adoption map

Loaded (defer tag) by **~53 HTML pages**, instantiated by only **12**:

| Consumer | Keys | Notes |
|---|---|---|
| `js/pages/analytics.js:554` | level,class,subject | `subjectsFromGrades` |
| `js/pages/results-hub.js:158` | level,class,subject | +manual zeros-class select |
| `reports-semester.html:912` (inline) | level,class,subject | |
| `js/pages/teachers-performance.js:153` | level,class,subject | |
| `js/pages/tracking-teachers-performance.js:136` | subject | |
| `js/pages/students-list.js:133` | level,class | persists `sl_filters` |
| `js/pages/students-status.js:136` | level,class | |
| `js/pages/absence-analytics.js:127,159` | level,class | rebuilds+destroy on year change |
| `js/pages/support-sessions.js:276` | class | mirrors section list into own `filterSection` |
| `js/pages/students-orientation.js:799` | class | |
| `js/pages/compensation-tracking.js:343` | class,subject | |
| `js/pages/grades-sheets.js:98` | level,class,subject | |
| `grades-results.html:182` (inline) | level,class | calls `destroy()` at :581 |

### 10.3 Structurally repetitive bespoke filtering (manager/teacher lists)

| Page | Filtering today | Location |
|---|---|---|
| `teachers-list.js` | text search + 5 selects (cadre/source/gender/subject/fonction), client pagination (PAGE_SIZE 20) | :8, :226-307 |
| `settings-users.js` | **none** — renders every user, no search/pagination | :283-316 |
| `staff-attendance.js` | teacher dropdown built from grades | :251-308 |
| `compensation-tracking.js` | subject→teacher intersects timetable, `localeCompare('ar')` | :336, :360-456, :444 |
| `teachers-performance.js` / `tracking-teachers-performance.js` | shared `populateTeachersBySubject` (utils.js:2502) | :203, :227 |
| `exams-rooms.js` | `renderTeacherFilter` from summary rows | :312-319 |
| `support-sessions.js` | `filterTeachersBySubject` + secondary | :233-271 |
| `teachers-absence.html` (inline) | teacher select via `createElement`/`textContent` | :95-102 |
| `inspectors.js` | search + status/specialty selects + pagination | :88-122 |
| `absence-students.html` (inline) | class filter + `includes(name)` — **no trim/lowercase** | :139-142 |
| `settings-logs.js` | single `#action-filter` select, `exact action ===` | :51-91 |
| `cycle-access` UI (settings-users.js) | user×cycle checkbox matrix, no filter | :387-470 |

### 10.4 "Filter by user/account" — the manager-user gap

- **No module filters any list by user/account.** `users:getAll` is consumed only by `settings-users.js:284`; the channel is `exclude:true` (device-local).
- **`system_logs` has no `actor` column** (`main/ipc/system.js:185-193` stores action/details/entity_type/entity_id) — filtering logs by user requires a schema change first.
- The only "created-by" data surfaced is `stage_rule_sets.created_by` (tooltip only, settings-defaults.js:695).

### 10.5 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| F33 | 🟡 | **"Unified" claim is misleading.** FilterManager has no arbitrary data-source/row abstraction; search, table filters, pagination, persistence are out of scope — pages hand-roll all of them. | filter-manager.js (whole) |
| F34 | 🟡 | **Phantom `teacher` key** misleads consumers into building bespoke teacher dropdowns (6+ distinct implementations). Either populate it (via `teachers.getAll(year)`) or delete it. | filter-manager.js:48,415-420 |
| F35 | 🟡 | **Pages poke private members:** `_getLocalLevelName` / `_levelsMapping` used as de-facto public API in 5 pages (analytics:164,564; results-hub:148,168; students-list:141,148; teachers-performance:167,258; tracking-teachers-performance:147). Any refactor breaks them. | §10.2 |
| F36 | 🟡 | `_resolveElements` treats selectors as element IDs (non-`HTMLElement` → `getElementById`); a real CSS selector (`'.foo'`) silently yields null — `_needsSelector` still fetches data for it (wasted IPC). | filter-manager.js:146-157 |
| F37 | 🟡 | **Memory leak:** `destroy()` called in only 2 places; `absence-analytics.js` creates a new instance per year-change without guaranteed teardown. | absence-analytics.js:127,158 |
| F38 | 🟡 | **No state persistence** (except students-list). Filters reset on every navigation. | §10.2 |
| F39 | 🟡 | **Divergent search:** `.toLowerCase().includes` (teachers) vs plain `includes` (absence-students — no lowercasing at all); no Arabic folding anywhere in the filter path. | teachers-list.js:271-283; absence-students.html:141 |
| F40 | 🟡 | **Divergent sort:** `.sort()` (teachers-list cadre:228, settings-logs actions:82) vs `localeCompare('ar')` (compensation:444, exams-rooms:300, settings-users:699) vs catalog sorters (`compareSubjects`/`sortLevelNames`). | §10.3 |
| F41 | 🟢 | **Duplicated `setSelectOptions`:** `js/shared/dom-helpers.js:38` vs `js/utils.js:1941`. | §13 |
| F42 | 🟢 | `settings-users` table is unfilterable and unpaginated → unusable at scale; the primary gap for "filtering manager users". | settings-users.js:283-316 |
| I11 | 🟡 | XSS pattern-prone: inline `onclick="cycleAccessEnableForAll('${safeText(...)}')"` (settings-users.js:413) and any new "user filter" dropdown must not interpolate names into innerHTML without escaping. | settings-users.js:413 |

### 10.6 Effort assessment

**Prerequisite:** FilterManager cannot be "adopted" for user/teacher table filtering without an abstraction extension (no rows/columns concept exists).

1. **Extend FilterManager (or add a sibling table-filter module)** — 0.5-1.5 days: generic `source` contract `{api, key, labelKey, groupBy}`, public `filterRows(rows)` comparator; implement or delete the `teacher` key; Arabic folding (أ/إ/آ→ا, ة→ه, tatweel) + one `compareFilterOptions`; optional `saveToStorage` persistence.
2. **Backend gap — small but real:** no users search/read-scoped IPC (`users:getAll` only); `system_logs` needs an `actor` column + channel change for by-user log filtering (local-DB work only; sync not affected).
3. **Retrofit teacher/user pages** — 1-2 days: `teachers-list.js` (907 L) mechanical; `settings-users.js` is new feature work (search by name/email/role + status); converge the 6+ teacher-dropdown implementations onto a shared helper (removes ~400 lines of duplication).
4. **Cleanup — low:** drop ~40 dead `filter-manager.js` script tags; merge the two `setSelectOptions`; expose `_levelsMapping`/`_getLocalLevelName` formally.

**Total: ~2-4 working days for correct unification; ~1 day for a stop-gap** (make `settings-users.js` searchable + centralize teacher dropdowns on `populateTeachersBySubject`).

---

## 11. Prioritized Findings Register

Legend: 🔴 blocking/security/integrity · 🟡 important · 🟢 minor.

| # | Sev | Finding | Location |
|---|---|---|---|
| F1 | 🔴 | XSS: FET `<Subject name>` → unescaped `innerHTML` in tafwij panel | settings-imports.js:1208-1222 |
| F2 | 🔴 | `systemLogs:add` unauthenticated → forgeable audit trail | main/ipc/system.js:185 |
| F3 | 🔴 | Re-import resets student `status` → erases dropout/expelled | main/repos/students.js:177,204 |
| F4 | 🔴 | Grades bulk clobbers empty level/section | main/ipc/grades.js:117; main/repos/grades.js:231 |
| F5 | 🔴 | `orientation:clearYear` no txn, no capture → sync gap | main/repos/orientation.js:746 |
| F6 | 🔴 | `teachers:importBulk` no batch cap | main/ipc/staff.js:89 |
| F7 | 🟡 | Absences bulk: no date/hours validation; empty dates stored | main/ipc/absences.js:30; settings-imports.js:2796 |
| F8 | 🟡 | `replaceByYear` destructive on partial files | main/repos/absences.js:186 |
| F9 | 🟡 | No file-size guard / whole-sheet materialization | settings-imports.js:1737-1740 |
| F10 | 🟡 | Normalization duplicated 2-5×; 2 SSOTs bypassed | §5.2 |
| F11 | 🟡 | 5/7 import types page-embedded, non-testable | §4.1 |
| F12 | 🟡 | 3 parallel error vocabularies + colliding inline codes | §6/§9 |
| F13 | 🟡 | Post-commit capture for single-row channels | capture.js:768-814 |
| F14 | 🟡 | Name-matching split-brain (exact vs fuzzy) | :1375 vs name-resolver.js |
| F15 | 🟢 | Progress-title icon accumulation; multi-file grades totals overwrite | :554-557, :2173 |
| F16 | 🟢 | Hardcoded `'2025/2026'` fallback; debug console.logs | :1625, :3049, :3250 |
| F17 | 🟡 | No `reader.onabort` / no read timeout | :1637-1652 |
| F18 | 🟢 | 0-byte XLSX → generic message, not `EMPTY_FILE` | :1649 |
| F19 | 🟢 | Workbook cache ignored by orientation/XML paths | :847, :2117 |
| F20 | 🟡 | Two disconnected parse pipelines (manual vs preflight) | §4.2 |
| F21 | 🟢 | `fet-import.js` shared, but 2 page-local XML parsers remain | §4.2 |
| F22 | 🟢 | Orientation JSON path is the most defensive | :4615-4701 |
| F23 | 🟡 | fet/agent-xml skip context review | :356-368 |
| F24 | ✅ | Semester is extracted and cross-checked with the page selector | import-context.js:225-254; settings-imports.js:3041-3048 |
| F25 | 🟢 | Review = advisory gate, IPC = authoritative (coherent) | §6 |
| F26 | 🟢 | Review/commit re-parse (harmless TOCTOU) | §6 |
| F27 | 🟢 | `deleteBySemester` `|| 1` on falsy semester | grades.js:383 |
| F28 | 🟢 | Teachers not cycle-scoped (multi-stage flag) | staff.js |
| F29 | 🟡 | Teacher-name cross-checks are warning-only | cross-source-validator.js |
| F30 | 🟡 | Free-form warning objects, no shared contract | cross-source-validator.js |
| F31 | 🟡 | Name-matching split-brain | §8.3 |
| F32 | 🟡 | Serial `resolveAsync` + O(len²) Levenshtein in validators | name-resolver.js |
| F33-F41 | 🟡/🟢 | Filter-manager suite (§10.5) | filter-manager.js + pages |
| F42 | 🟢 | `settings-users` unfilterable/unpaginated | settings-users.js:283 |

---

## 12. Recommendations / Roadmap

### Phase 0 — Data integrity and write security

1. **Preserve student status correctly (F3):** normal roster imports must omit status, so an existing `dropout`/`expelled` status is untouched and new rows still default to `active`. Route the dedicated status importer through the existing `students:updateStatusBulk` path, or otherwise mark status as explicitly supplied. A blank-only `COALESCE` guard is not sufficient while normal imports send `status: 'active'`.
2. **Protect blank grade fields (F4):** update `grades.level` and `grades.section` only when the imported value is non-blank.
3. **Authenticate business imports and audit writes (F2):** remove `allowNoSession` from school-data import writes, including students, grades, absences, orientation, and teachers, unless a concrete startup workflow requires it. Make business audit entries originate in authenticated main-process handlers/repos. Move renderer error reporting to a separate, tightly bounded diagnostic path; it must not be able to forge arbitrary `system_logs` actions.
4. **Make orientation deletes atomic and sync-visible (F5):** put both `clearYear` and `deleteById` in repo transactions and capture deleted rows through the capture port inside those transactions. Register the affected channels as explicit capture paths so the wrapper does not create duplicate post-commit tombstones.
5. **Bound teacher bulk import (F6):** reject oversized arrays before entering the repo transaction and validate the minimum required fields and bounded string values per row.

F1 is not an active roadmap item if the current `subjectsHint` escaping fix is retained. Keep the finding in this historical review until that fix is committed and covered by a regression test.

### Phase 1 — Deterministic teacher aliases

6. Reuse the existing `(ppr, school_year)` identity and `teacher_aliases` table. Do not create a new canonical identity table or `teacher_key` column.
7. Extract one shared exact `normalizeIdentityKey` for separators, titles, Arabic folding, and token cleanup.
8. During Ministry roster import, seed Arabic and Latin order variants from the existing Ministry fields. Make grade and FET lookup query those aliases.
9. Treat zero and multiple matches as manual review. Persist accepted mappings through the existing tafwij alias path.
10. Add fixtures for family-first/first-first order, Arabic/Latin names, underscores, and collision cases. Only after those fixtures pass, remove transliteration and Levenshtein auto-binding.

### Phase 2 — Import boundaries

11. Add file-size checks before reading and reject `FileReader` aborts or failed reads instead of leaving the UI pending (F9, F17).
12. Add bulk absence date/month/hours/days validation to match the single-row path (F7).
13. Before destructive `replaceByYear`, verify month coverage or require an explicit confirmation for incomplete coverage (F8).

### Phase 3 — Incremental parser cleanup

14. Extract one parser only when it is being changed. Share the parser result shape, small normalization primitives, and level catalogs, but do not create a global header/error framework or rewrite all five page-local parsers at once (F10-F12, F20).

### Separate UX maintenance

User search, teacher-dropdown consolidation, dead script-tag removal, and `FilterManager` scope clarification are useful but should not block import integrity work. Do not extend `FilterManager` into a generic table-filter framework as part of this plan.

### Deferred

- Move single-row post-commit capture into repo transactions (F13) unless a concrete import data-loss incident justifies the wider sync change.
- Cycle-scope teachers (F28) when the multi-stage ownership policy is defined.
- Optimize bulk N+1 queries (F10-*), after correctness fixes are covered by measurements.

### 12.1 Implementation Status (2026-08-04)

Implemented by 5 parallel sub-agents (Phase 0 completion, Phase 1 backend, Phase 2 boundaries, Phase 3 primitives, Phase 1 renderer wiring + XSS) plus author integration and follow-up fixes. Verification: `npm test` 271/271, `npm run lint` 0 errors, invariants gate green.

**Phase 0 — Data integrity and write security**

- F3 ✅ `main/repos/students.js` `addBulk` — status preserved unless explicitly supplied (`CASE WHEN ? = 1 THEN excluded.status ELSE students.status END`); dedicated status imports pass `status` explicitly.
- F4 ✅ `main/repos/grades.js` upsert — `level`/`section` guarded with `COALESCE(NULLIF(trim(excluded...), ''), grades...)`.
- F2 ✅ `systemLogs:add` now `handleWriteSoftAuth` + notice-bounded (`blocked`/`failed`/`clear` import notices only, plus `print_semester_report`); audit reads require a session; renderer errors route to `diagnostics:reportRendererError` (bounded); `allowNoSession` removed from all import writes; successful import audits are written by main-side handlers inside the existing domain transactions via `writeImportAudit` (details ≤ 4000); `systemLogs:add` remains `exclude: true`.
- F5 ✅ `main/repos/orientation.js` `clearYear`/`deleteById` — `db.transaction` + `captureDeletesFromRows` inside the txn + `notifyCaptureCommitted`; capture failure rolls the delete back; channels `orientation:clearYear`/`orientation:delete` now `captureMode: 'explicit'` (no wrapper double-capture).
- F6 ✅ `main/ipc/staff.js` `teachers:importBulk` — cap 5000 before the repo txn, non-array/non-object rejection, `full_name`+`school_year` required, name fields ≤ 500 chars.
- F1 ✅ escaping verified + regression test (`tests/tafwij-xss-regression.test.js`): subjectsHint escaped at renderTafwijMatchingPanel, `typeof escapeHtml` guard present.
- F27 ✅ `grades:deleteBySemester` fail-closed — only 1|2 accepted (`INVALID_SEMESTER`), no more `|| 1` default.

**Phase 1 — Deterministic teacher aliases** (pivot on Ministry roster, §5.5)

- ✅ Shared SSOT `js/shared/teacher-identity.js` (dual-export `PencilShared.TeacherIdentity`): `foldArabic`, `stripTitlePrefix`, `tokenizeName`, `normalizeIdentityKey` (ordered tokens — §5.5 equivalence: FET `نور_الدين_السعيدي_` ≡ grade `الأستاذ: نور الدين السعيدي` ≡ Ministry first-first ≡ reversed), `buildNameVariants`, `groupEntriesByKey`/`matchEntriesByKey`.
- ✅ `main/teachers/identity.js` — rotation variants (`نور الدين السعيدي` → `السعيدي نور الدين`) seeded from every seed path (Ministry importBulk, add/updateTeacher, migration backfill) via `seedTeacherNameVariants`; shared-key ambiguity is checked before legacy aliases (zero/multiple → unresolved/manual); grade-import aliases are persisted by the grades repository and captured with the grade transaction.
- ✅ Renderer auto-link (`settings-imports.js` `buildSharedKeyTeacherResolver`): exactly one key match → auto-link; zero/multiple → manual tafwij review only — transliteration/Levenshtein removed from the auto-link path (name-resolver warnings unchanged).
- ✅ Fixtures: `tests/teacher-identity.test.js`, `tests/staff-aliases-seeding.test.js` (order variants, re-import idempotence, collision → ambiguous, FET-style family-first lookup).
- No new identity table/column — `(ppr, school_year)` + `teacher_aliases` reused as required.

**Phase 2 — Import boundaries**

- F9 ✅ size guards: XLSX/CSV ≤ 100 MB, XML/JSON ≤ 20 MB (`readImportFileAsText`), Arabic rejection messages.
- F17 ✅ `reader.onerror`/`onabort` + 60 s timeout wired into parseWorkbook, FET/agent XML readers, orientation JSON reader.
- F18 ✅ 0-byte XLSX → `EMPTY_FILE` context error.
- F7 ✅ bulk absences validation (`validateAbsenceRow` for saveBulk + replaceByYear): date/months (1–12, `YYYY-MM`/`سنوي`), hours 0–24, days 0–31, date-or-month required; matrix/simple modes reconciled via `normalizeAbsenceMonth`.
- F8 ✅ `replaceByYear` coverage and scope guards: staged months must cover existing (year, cycle) months or the call is refused with `INCOMPLETE_COVERAGE` + `missingMonths`; every row must match the requested school year and active cycle, and all ownership is resolved before the destructive delete; renderer shows the confirm dialog listing missing months.

**Phase 3 — Incremental parser cleanup**

- ✅ `js/import-center/normalize.js` (`ImportCenterNormalize`): `text`, `toLatinDigits`, `normalizeKey`, `normalizeStudentCode`, `excelDateToIso`, `parseStrictNumber` — duplicated bodies removed from students/grades parsers (behavior-identical, existing suites green).
- ✅ `js/import-center/import-diagnostics-codes.js` (`ImportCenterDiagnostics`): the complete import diagnostic vocabulary, including preflight/XML row-validation codes, is consumed by students/grades parsers + `import-row-validation.js` (guarded browser fallback).
- ✅ F12c: grades level resolution now SSOT-first (`matchLevelFromSection`) with legacy table fallback — identical output for tested level strings.
- ✅ Script tags added to `settings-imports.html` (`normalize.js`, `import-diagnostics-codes.js`, `teacher-identity.js`).
- F12d ('' vs null sentinels) and F20 (two pipelines) deliberately untouched per Phase 3 constraints.

**Renderer UX**

- F15 ✅ `updateImportProgress` `replaceChildren` (no icon accumulation); multi-file grades totals accumulate.
- F16 ✅ hardcoded `'2025/2026'` fallback removed; debug `console.log`s removed.
- F24 ✅ `resolveSemesterDecision` — grades commit blocks (`SEMESTER_MISMATCH`) only when parser semester and `#semester-select` differ.

**Deferred as planned:** F13, F28, F10-* N+1, FilterManager suite (F33–F42), settings-users search (F42), absence-students trim/lowercase (F39).

**New test files:** `tests/teacher-identity.test.js`, `tests/staff-aliases-seeding.test.js`, `tests/grades-teacher-alias-capture.test.js`, `tests/orientation-clear-capture.test.js`, `tests/grades-delete-semester.test.js`, `tests/import-boundaries.test.js`, `tests/tafwij-xss-regression.test.js`, `tests/import-center/normalize-primitives.test.js`; extended: `tests/import-audit-auth.test.js`, `tests/import-center/absences-replace-by-year.test.js`, `tests/import-center/manual-import-regression.test.js`.

---

## 13. Appendix — Full File Inventory

### Renderer / page
| File | Role |
|---|---|
| `settings-imports.html` | Page markup: file inputs, status panel, manual cards, tafwij/departed panels, progress, stats, logs, backup |
| `js/pages/settings-imports.js` (5,457 L) | Orchestration + 5 page-embedded importers |
| `js/import-center/import-context.js` (382 L) | Source/destination context extraction + compare |
| `js/import-center/import-preflight-policy.js` (56 L) | Decision table allow/review/block |
| `js/import-center/import-result-contract.js` (152 L) | Stable error contract + `normalizeError`/`message`/`createContextError`/`outcomeSummary` |
| `js/import-center/students-import-parser.js` (363 L) | Pure students parser |
| `js/import-center/grades-import-parser.js` (481 L) | Pure grades parser |
| `js/import-center/import-readers.js` | Preflight CSV/XML/XLSX readers, header heuristics, `decodeTextStrict` |
| `js/import-center/import-row-validation.js` (648 L) | Preflight per-row validation / XML structure validation |
| `js/import-center/adapters/*` | Read-only preflight analysis wrappers |
| `js/data-source-registry.js` | localStorage readiness store (stub per header) |
| `js/cross-source-validator.js` | Never-throwing cross checks |
| `js/name-resolver.js` | 6-step teacher-name matcher (fuzzy/transliteration) |
| `js/shared/fet-import.js` | FET day constants + class-name helper |
| `js/backup.js` | localStorage + optional DB backup/restore |
| `js/shared/dom-helpers.js` / `auth-session.js` | Safe DOM helpers; session, role checks (12 h TTL, non-crypto hash) |
| `js/shared/filter-manager.js` (438 L) | Cascading select-populator (level/class/subject) |
| `vendor/xlsx.full.min.js` | SheetJS |

### Main process
| File | Role |
|---|---|
| `preload.js` | `window.api.*` bridges |
| `main/ipc/students.js`, `grades.js`, `absences.js`, `staff.js`, `orientation.js`, `timetable-data.js`, `system.js`, `system-backup.js` | Handlers (auth + validation + delegate) |
| `main/ipc/ipc-helpers.js` | `handleAuthedRead`, `handleWriteSoftAuth` (`allowNoSession` logging :252-267) |
| `main/repos/students.js`, `grades.js`, `absences.js`, `staff.js`, `orientation.js`, `timetable.js` | Domain SQL, in-txn outbox capture |
| `main/repos/capture-port.js` | Repo → sync-capture port (NoOp in tests) |
| `main/sync/capture.js` | `wrapWithSyncCapture` (768-814), CHANNEL_REGISTRY, `captureInputUpserts` |
| `main/auth/resolve-cycle.js` | `resolveCycleForRequest` (fail-closed pre-login) |

### Docs / specs referenced
- `docs/plans/2026-07-15-add-write-channel-checklist.md`
- `specs/027-layering-remediation/`
- `specs/028-orientation-error-contract/`, `specs/029-stage-rules-management/`

---

### Methodology note

Findings were produced by 5 parallel sub-agents: (1) renderer orchestration, (2) parsers + normalization, (3) main-process save path, (4) filter-manager adoption map, (5) supporting modules. Each returned file:line evidence. Severity labels were applied by the author using the code-review-checklist criteria (correctness, security, performance, DRY/SOLID, testing). Line numbers refer to the state of the repository at review time.

**Follow-up (2026-08-04):** the normalization verdict (§5.5) was reached in a debate with the project owner using real file-format samples (FET `_teachers*.xml` teacher-name shape, Ministry `10401E_*.xml` NOMA/NOML fields, grade-Excel heading format). The example files were used only as format evidence, not as a cross-school matching test. Roadmap Phases 0-3 were subsequently narrowed to data integrity, deterministic aliases, import boundaries, and incremental parser cleanup; generic filtering and broad parser/error-framework work were deferred.

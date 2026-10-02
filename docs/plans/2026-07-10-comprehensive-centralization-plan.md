# Comprehensive Plan: Centralize Duplicate Algorithms — All Pages

| Field | Value |
|-------|-------|
| **Date** | 2026-07-10 |
| **Status** | **Complete for planned CH* + base C5/C11 log-io + proctor canonical SSOT** (2026-07-11) · optional deeper proctor phase DRY / load-state align |
| **Stack** | Electron 35 · Node.js main · vanilla multi-page JS · better-sqlite3 |
| **Supersedes scope of** | [Base plan](./2026-07-10-centralize-duplicates-plan.md) · [Inventory](./2026-07-10-duplicate-inventory.md) · [Design](./2026-07-10-find-centralize-duplicates.md) |
| **Adds** | HTML-inline `<script>` coverage + full sidebar page map + new clusters |

---

## Why this plan exists

The base plan (clusters **C1–C17**) is correct but **incomplete by construction**. Two coverage gaps were found:

1. **HTML-inline scripts were never scanned.** `dup:report` scopes jscpd to `main js preload.js app.js`. Every page whose logic lives in an inline `<script>` inside its `.html` file is invisible to the baseline. jscpd also **cannot** tokenize HTML inline JS in this setup (markup format → 0 files analyzed; no cross-format JS-in-HTML vs JS-file clone detection). So the "137 clones" figure undercounts reality.
2. **New pages were added after the baseline.** e.g. `exam-papers.html` (created 2026-07-09) reimplements already-centralized algorithms and appears in no cluster.

This plan closes both gaps: it audits **every sidebar page**, adds the missing clusters, and keeps all base-plan decisions (KD1–KD15) intact.

---

## Method note (tooling reality)

- jscpd stays the source of truth for **JS↔JS** clones (`npm run dup:report`).
- jscpd **cannot** see HTML-inline JS here. HTML-inline duplication in this plan was confirmed by **targeted grep** against known canonical signatures (`escapeHtml`, `csvEscape`, `ttResolveTeacherKeys`, `ttNormalizeName`, `debounce`, `formatNumber`, date helpers, chart-theme helpers).
- **Structural recommendation (prerequisite for several clusters):** extract each page's inline `<script>` into a real `js/pages/<page>.js` file. This is the single highest-leverage move — it makes the code visible to jscpd, lint, and shared-module reuse. Pages already following this pattern (e.g. `exam-papers`, `staff-*`) are easier to dedupe than inline-script pages.

---

## Coverage map — sidebar pages

Legend: ✅ covered by a cluster · ➕ new cluster added here · ⚪ no known duplication · 🔎 needs inline-extraction first

| Sidebar page | Logic location | Duplication status | Cluster |
|--------------|----------------|--------------------|---------|
| `index.html` | app.js / mixed | chart-theme helper (`getChartThemeColors`) | ➕ CH6 |
| `students-list.html` | `js/pages/students-list.js` | gender + list/init dups | ✅ C8 · ➕ CH8 |
| `students-movement.html` | page js | ⚪ (verify) | — |
| `students-status.html` | page js | ⚪ (verify) | — |
| `teachers-list.html` | `js/pages/teachers-list.js` | own `debounce`; list dups | ➕ CH5, CH8 |
| `inspectors.html` | `js/pages/inspectors.js` | init/list dups w/ students/teachers | ➕ CH8 |
| `tracking-teachers-performance.html` | page js | metrics + `csvEscape` | ✅ C1 |
| `teachers-performance.html` | page js | metrics + `csvEscape` | ✅ C1 |
| `staff-attendance.html` | `js/pages/staff-attendance.js` | timetable resolver (OK) + date helpers | ✅ (uses `timetable-utils`) · ➕ CH4 |
| `staff-daily-report.html` | `js/pages/staff-daily-report.js` | timetable resolver (OK) + date helpers | ✅ · ➕ CH4 |
| `compensation-tracking.html` | **inline** | **full inline copy** of resolver + `escapeHtml` + date helpers | 🔎 ➕ CH1, CH2, CH4 |
| `timetable.html` | page js (rooms/students tabs) | view helpers | ✅ C5 |
| `timetable-redistribution.html` | `js/pages/timetable-redistribution.js` | subject-sort soft-global (OK) | ⚪ |
| `results-hub.html` | page js | ⚪ (verify) | — |
| `analytics.html` | `js/pages/analytics.js` | metrics helpers + chart lifecycle | ✅ C4 · ➕ CH6 |
| `grades-sheets.html` | `js/pages/grades-sheets.js` | ⚪ (verify subject/section helpers) | — |
| `exam-papers.html` | `js/pages/exam-papers.js` | resolver reimpl + `normName` + exam-count map | ➕ CH2, CH7 |
| `grades-results.html` | page js | ⚪ (verify) | — |
| `student-support.html` | page js | ⚪ (verify) | — |
| `absence-weekly.html` | **inline** | timetable-walk + `getNextMondayISO` date helper | 🔎 ➕ CH2, CH4 |
| `absence-students.html` | page/inline | ⚪ (verify) | — |
| `absence-correspondence.html` | page/inline | ⚪ (verify) | — |
| `absence-analytics.html` | **inline** | `escapeCsv` (unhardened) + `debounce` + `formatNumber` + chart-theme | 🔎 ➕ CH3, CH5, CH6 |
| `exams-schedule.html` | **inline** | `escHtml` + `formatDateAr` | 🔎 ➕ CH1, CH4 |
| `exams-proctors.html` | **inline** + `proctor-v3.bundle.js` | `escHtml` + `formatDateAr`; bundle = proctor phases | ✅ C2/C3/C10 · 🔎 ➕ CH1, CH4 |
| `exams-rooms.html` | **inline** | `escHtml` | 🔎 ➕ CH1 |
| `exams-tests.html` | page/inline | ⚪ (verify) | — |
| `reports-certificates.html` | page js + `main/reports/*` | footer/letterhead dups | ➕ CH9 (main) |
| `reports-forms.html` | page js + `main/reports/*` | adminForms internal dup | backlog |
| `reports-semester.html` | page js | ⚪ (verify) | — |
| `settings-school.html` | page js | ⚪ | — |
| `settings-imports.html` | `js/pages/settings-imports.js` | timetable-parse dup w/ `timetable.js` | ➕ CH10 |
| `settings-users.html` | `js/pages/settings-users.js` | admin guard/init dup | ➕ CH11 |
| `settings-defaults.html` | `js/pages/settings-defaults.js` | admin guard/init dup | ➕ CH11 |
| `settings-logs.html` | page js | ⚪ | — |
| `settings-license.html` | page js | ⚪ | — |
| `app-admin.html` | `js/pages/app-admin.js` | admin guard/init dup | ➕ CH11 |
| `settings-sync.html` | page js | ⚪ | — |
| `communication-center-prototype.html` | prototype | out of scope (prototype) | — |

> ⚪ "verify" = not yet grep-confirmed either way; sweep during the audit PR.

---

## New clusters (this plan) — CH-series

Priority: **P0** breaks/security-relevant · **P1** high-churn shared algo · **P2** cosmetic/small.

| ID | Cluster | Canonical home (SSOT) | Consumers to fix | Priority | Confidence |
|----|---------|-----------------------|------------------|----------|------------|
| **CH1** | `escHtml` / `escapeHtml` inline copies | **existing** `window.escapeHtml` (`js/utils.js`) | exams-proctors, exams-rooms, exams-schedule, compensation-tracking (+ 2 test copies) | P1 | High |
| **CH2** | Teacher→timetable section resolver | **existing** `js/shared/timetable-utils.js` ✅ | exam-papers + compensation-tracking ✅ · absence-weekly N/A (class index walk, not teacher resolve) | **P0** | High |
| **CH3** | CSV cell escaping (hardened) | **new** `js/shared/csv.js` ✅ | absence-analytics + teachers-performance + tracking ✅ | **P0** | High |
| **CH4** | Date helpers (`todayStr`, `formatDateAr` styles, `formatDateShort`, `getNextMondayISO`) | **new** `js/shared/date-utils.js` ✅ | compensation, absence-weekly, exams-proctors/schedule, staff-attendance, staff-daily-report | P1 | High |
| **CH5** | `debounce` / `formatNumber` | **existing** `js/utils.js` ✅ | debounce ✅ · formatNumber(`locale` default + `fixed`) ✅ | P2 | High |
| **CH6** | Chart theme + defaults | **new** `js/shared/chart-theme.js` ✅ | absence-analytics, analytics, teachers-performance, tracking, index/`app.js` | P2 | Medium |
| **CH7** | Exam-count (`فروض`) fallback map | **existing** `main/db/exam-count-defaults.js` (`DEFAULT_EXAM_COUNTS`) exposed to renderer via IPC/appDefaults | exam-papers.js `FROUD_FALLBACK` | P1 | High |
| **CH8** | Student gender helpers (+ optional list chrome) | **`js/shared/gender.js` ✅** (students only) | students-list + student-profile ✅ · teachers-list **excluded** | P2 | High |
| **CH9** | Report chrome (footer ↔ letterhead) | **`main/reports/html-escape.js` ✅** | footer.js + letterhead.js | P2 | High |
| **CH10** | FET day map + base class (import parse core) | **`js/shared/fet-import.js` ✅** | settings-imports + timetable ✅ (full XML pipelines stay local) | P1 | High |
| **CH11** | Admin/dev page role session guards | **`js/shared/role-session-guard.js` ✅** | app-admin / settings-defaults / users / license guards | P2 | High |

### Behavioral flags (must resolve before merge)

| Cluster | Flag | Resolution |
|---------|------|------------|
| **CH2** | exam-papers/compensation resolvers are **weaker** (name-only, no ID match, no meta merge). Unifying **changes behavior** toward the correct 4-phase resolver. | Approve as improvement (KD9); add characterization tests capturing new (correct) matches. Keep subject-filter step local in exam-papers. |
| **CH3** | `absence-analytics` `escapeCsv` only quotes; canonical hardens formula injection (`=+-@\t\r`). | Unify on **hardened** (same as Gate 0 / KD11). This is a **security fix**, not just DRY. |
| **CH4** | `formatDateAr` variants differ (dmy / locale-short / locale-long / moroccan; empty `—` vs `''`). | ✅ Resolved via **style parameter** — not silent merge. Matrix in `js/shared/date-utils.js` header. |
| **CH1** | `escHtml` variants: some escape `"` only partially. | Canonical `escapeHtml` must cover `& < > "` (and `'` if any caller relies on it). Verify each caller's needs. |
| **CH5** | `absence-analytics` fixed Western vs utils `ar-MA` locale. | ✅ Resolved: `formatNumber(n, style)` — default `'locale'`; analytics uses `'fixed'`. |

---

## Module placement (respects KD3 — domain modules, no mega-utils)

| Need | Home | Kind |
|------|------|------|
| HTML escaping | `js/utils.js` `window.escapeHtml` (existing) | already global |
| Timetable resolve/normalize | `js/shared/timetable-utils.js` (existing) | flat globals |
| CSV escape (hardened) | `js/shared/teacher-performance-metrics.js` (C1) **or** small `js/shared/csv.js` | dual-export |
| Dates | **new** `js/shared/date-utils.js` | dual-export |
| Chart theme | **new** `js/shared/chart-theme.js` | dual-export |
| Exam counts | `main/db/exam-count-defaults.js` (existing) via `window.api.appDefaults.getExamCount` | main SSOT + IPC |
| Admin guard | evaluate existing guard files before new `js/shared/admin-guard.js` | dual-export |

Rules preserved from base plan: do **not** grow `js/utils.js` with new domains; do **not** invent `main/lib/`; new renderer shared modules **dual-export** (`module.exports` + `window`) for Node tests + `<script>` tags; legacy `js/shared/*` stay flat-global (no rewrite).

---

## PR sequence (extends base plan)

```text
BASE PLAN (unchanged):
  PR0 → PR-G(C8) → PR1(C1) → PR2(C5) → PR3(C11) → PR5(C6) → PR6(C2/C3) → PR7

THIS PLAN (new), sequenced by risk:
  PRA  Inline-extraction audit        (enabler; no behavior change)
   ├── PRB  CH1  escapeHtml unify      (safe; script-tag + delete inline)
   ├── PRC  CH3  csvEscape hardened    (SECURITY; after C1 lands the shared csvEscape)
   ├── PRD  CH2  timetable resolver    (P0; needs char-tests; after PRA)
   ├── PRE  CH4  date-utils module     (needs diff matrix)
   ├── PRF  CH7  exam-count via IPC    (data SSOT)
   ├── PRG  CH5  debounce/formatNumber (cosmetic)
   ├── PRH  CH6  chart-theme           (cosmetic)
   ├── PRI  CH10 timetable-parse       (medium risk)
   ├── PRJ  CH11 admin-guard           (auth-sensitive; preserve semantics)
   └── PRK  CH8/CH9 list + report chrome (opportunistic)
  PRL  Refresh inventory + expand dup coverage note
```

Dependencies: **PRA before PRB/PRD** (extraction first). **C1 before PRC** (shared `csvEscape` must exist). **PRD after PRA** for compensation-tracking (needs its inline JS extracted first).

### PR details (new)

**PRA — Inline-extraction audit (enabler)** ✅ **done 2026-07-11**
- Move inline `<script>` logic from `compensation-tracking.html`, `absence-analytics.html`, `absence-weekly.html`, `exams-rooms.html` (and confirm exams-proctors/-schedule) into `js/pages/<page>.js`.
- Add `<script src=".../<page>.js" defer>` tags; add the new files to lint globs (`js/pages/*.js` already covered).
- **No behavior change**; pure move. Re-run `npm run dup:report` — these pages now appear in jscpd.
- **Landed files:**
  - `js/pages/compensation-tracking.js` ← `compensation-tracking.html`
  - `js/pages/absence-analytics.js` ← `absence-analytics.html`
  - `js/pages/absence-weekly.js` ← `absence-weekly.html`
  - `js/pages/exams-rooms.js` ← `exams-rooms.html`
  - `js/pages/exams-proctors.js` ← `exams-proctors.html`
  - `js/pages/exams-schedule.js` ← `exams-schedule.html`
- Each host HTML ends with `<script src="js/pages/<page>.js" defer></script>`; zero remaining inline `<script>` blocks without `src`.

**PRB — CH1 escapeHtml unify** ✅ **done 2026-07-11**
- Delete inline `escHtml`/`escapeHtml`; call `window.escapeHtml`. Ensure each host page loads `js/utils.js` before its page script.
- Update the 2 test files to import the canonical function instead of a verbatim copy.
- **Landed:** removed local escapers from `exams-proctors.js`, `exams-rooms.js`, `exams-schedule.js`, `compensation-tracking.js`; all call sites use `escapeHtml(...)`.
- **Tests:** `tests/escape-html-unit.test.js` (canonical `& < > " '`); ed-matrix render + property-4 now extract from `js/pages/exams-proctors.js` and inject utils `escapeHtml`.
- **Note:** proctors/schedule previously omitted `'` escaping; canonical also maps `'` → `&#39;` (strictly safer HTML).

**PRC — CH3 csvEscape hardened (security)** ✅ **done 2026-07-11**
- New dual-export `js/shared/csv.js` (`csvEscape` + alias `escapeCsv`); hardens `=+-@\t\r`.
- Wired: absence-analytics, teachers-performance, tracking-teachers-performance (+ HTML script tags).
- Test: `tests/csv-escape-unit.test.js`.

**PRD — CH2 timetable resolver (P0)** ✅ **done 2026-07-11**
- exam-papers: `getAssignedSections` uses `ttResolveTeacherKeys(tt, teacherId, name)` + subject filter; HTML loads `timetable-utils.js`.
- compensation-tracking: removed local 4-phase copy; uses `ttResolveTeacherKeys` / `ttGetStoredTeacherEntries` / `ttNormalizeName`.
- absence-weekly: no teacher resolver (indexes all classes) — out of CH2 scope.
- Characterization: `tests/timetable-resolver-unit.test.js` (ID / exact / normalized / partial).

**PRE — CH4 date-utils** ✅ **done 2026-07-11**
- New dual-export `js/shared/date-utils.js`: `todayStr`, `daysAgoISO`/`thirtyDaysAgo`, `getNextMondayISO`, `formatDateDMY`, `formatDateShort`, `formatDateAr(s, style)`.
- Styles: `dmy` (default) · `dm` · `locale-short` · `locale-long` · `moroccan`. Does **not** export `formatDate` (avoids shadowing `utils.formatDate`).
- Wired HTML + pages: compensation-tracking, staff-daily-report (`locale-long`), staff-attendance (thin `formatDate`→`formatDateDMY`), exams-proctors (`dmy`), exams-schedule (wrapper `moroccan`), absence-weekly (`getNextMondayISO`).
- Test: `tests/date-utils-unit.test.js`.

**PRF — CH7 exam-count** ✅ **done 2026-07-11**
- exam-papers.js: dropped local `FROUD_FALLBACK` / `froudCountFallback`; uses `warmFroudCache` → `appDefaults.getExamCounts` + single-subject `getExamCount`; sync path reads cache only, else `DEFAULT_FROUD_COUNT = 3`.
- Init: `await warmFroudCache('*')` on DOMContentLoaded; level-specific warm inside async `froudCount`.
- Test: `tests/exam-papers-froud-ssot.test.js` (no local table; SSOT remains `main/db/exam-count-defaults.js`).

**PRG — CH5 debounce/formatNumber** ✅ **complete 2026-07-11**
- ✅ Removed local `debounce` from absence-analytics + teachers-list.
- ✅ Residual CH1: removed local `escapeHtml` from absence-analytics.
- ✅ **formatNumber(num, style)** in `js/utils.js`: `'locale'` (default, ar-MA) · `'fixed'` (Western, int or 1 decimal). absence-analytics call sites use `'fixed'`.
- Tests: `tests/debounce-unit.test.js`, `tests/format-number-unit.test.js`.

**PRH — CH6 chart-theme** ✅ **done 2026-07-11**
- New dual-export `js/shared/chart-theme.js`: `getChartThemeColors` (dual key aliases for absence + dashboard), `applyGlobalChartDefaults`, `ensureChartJsLoaded`, `destroyChartInstance`.
- Removed local theme/loader copies from `absence-analytics.js`, `analytics.js`, `teachers-performance.js`, `tracking-teachers-performance.js`; `app.js` uses shared theme + prefers shared loader.
- HTML script tags: absence-analytics, analytics, teachers-performance, tracking-teachers-performance, index.
- Test: `tests/chart-theme-unit.test.js`.
- Note: light-mode grid unified to `rgba(0,0,0,0.06)` (was `#e2e8f0` on absence page) — cosmetic.

**PR-G / CH8 student gender** ✅ **done 2026-07-11**
- `js/shared/gender.js` dual-export: `isMale`, `isFemale`, `getGenderLabel`, `getGenderIcon`.
- Wired `students-list` + `student-profile-prototype`; **teachers-list** keeps object/code gender API.
- Test: `tests/gender-helpers-unit.test.js`.

**PRK / CH9 report esc** ✅ **done 2026-07-11**
- `main/reports/html-escape.js`; footer + letterhead require shared `esc` (also escapes `'`).
- Test: `tests/reports-html-escape-unit.test.js`.

**PRI / CH10 FET import shared bits** ✅ **done 2026-07-11**
- `js/shared/fet-import.js`: `FET_DAY_MAPPINGS`, `FET_ARABIC_DAYS`, `getBaseClassName`, `ensureFetDaySkeleton`.
- Full FET XML import loops remain in page files (subject translate / DB save differ).
- Test: `tests/fet-import-unit.test.js`.

**PRJ / CH11 admin-guard** ✅ **done 2026-07-11**
- `js/shared/role-session-guard.js`: `enforceRoleSession({ roles, redirectTo })` + matrix tests.
- Thin wrappers keep role sets; redirect unified to **`index.html`** (replaces missing `dashboard.html`).
- Test: `tests/role-session-guard-unit.test.js` (allow/deny matrix).

**PRL — Inventory refresh** ✅ **done 2026-07-11**
- Updated `2026-07-10-duplicate-inventory.md` with cluster status + shared module list + jscpd HTML note.

---

## Tests by cluster

| Cluster | Minimum |
|---------|---------|
| PRA | lint passes on new `js/pages/*.js`; `dup:report` runs; manual page smoke |
| CH1 | test files import canonical; escaping unit test (`& < > "`) |
| CH3 | **mandatory** hardened-escape unit test (formula injection) |
| CH2 | **mandatory** characterization tests for resolver (ID/name/meta/partial); exam-papers subject-filter test |
| CH4 | snapshot tests per caller for date output strings |
| CH5/CH6 | unit test for `debounce`/`formatNumber`; chart-theme smoke |
| CH7 | test that renderer reads count from IPC/SSOT, not a local table |
| CH11 | auth guard behavior preserved (allow/deny matrix) |

---

## Gates & decisions

Inherits **KD1–KD15** from the base plan. Adds:

| # | Decision |
|---|----------|
| KD16 | HTML-inline duplication is **in scope**; jscpd blind spot mitigated by inline-extraction (PRA), not by fighting the tokenizer. |
| KD17 | `escapeHtml`, `debounce`, `formatNumber`, timetable resolver already have SSOTs — **reuse, do not create new modules**. |
| KD18 | CH3 (CSV) is treated as a **security fix** (formula injection), unified on the hardened variant. |
| KD19 | New shared renderer modules (`date-utils`, `chart-theme`, optional `csv`) are **dual-export**; legacy `js/shared/*` stay flat-global. |
| KD20 | CH2 unification **changes exam-papers/compensation matching behavior** toward the correct resolver — approved as an improvement with characterization tests (KD9). |
| KD21 | Exam-count table has exactly **one** source: `main/db/exam-count-defaults.js`; renderer never re-declares it. |

---

## Non-goals

- Rewriting legacy `js/shared/*` for dual-export consistency.
- Migrating pages to a framework or introducing a renderer bundler.
- Deduping prototypes (`*-prototype.html`), `vendor/`, `node_modules/`.
- Touching proctor **v2** internals (C9) or changing proctor fairness.
- Merging student gender with `teachers-list` gender.
- Cosmetic HTML/CSS dedupe beyond required script extraction.

---

## Risks

| Risk | Severity | Mitigation |
|------|----------|------------|
| Inline extraction changes load order / breaks a page | Medium | PRA is pure move + `<script defer>` in correct order; per-page smoke |
| CH2 behavior shift surfaces previously-missing matches | Medium | Characterization tests; document as fix (KD20) |
| CH4 date-string drift between callers | Medium | Diff matrix + per-caller snapshot tests |
| CH3 missed a CSV export path | Medium (security) | grep all `escapeCsv`/`csv` exporters before closing |
| Auth guard regression (CH11) | High | Allow/deny matrix test; smoke each admin/dev page |
| jscpd still can't see remaining inline pages | Low | Extraction backlog tracked; PRL documents limitation |

---

## Immediate next actions

1. ~~Approve cluster set (CH1–CH11) and the **inline-extraction-first** approach (PRA).~~ ✅
2. ~~Land **PRA** (enabler).~~ ✅ **2026-07-11**
3. ~~**PRB / CH1** — unify on `window.escapeHtml`.~~ ✅ **2026-07-11**
4. ~~**PRG / CH5 debounce**~~ ✅ **2026-07-11** · formatNumber still deferred
5. ~~**PRF / CH7 exam-count**~~ ✅ **2026-07-11**
6. ~~**PRH / CH6 chart-theme**~~ ✅ **2026-07-11**
7. ~~**PRC / CH3 csvEscape**~~ ✅ **2026-07-11** (KD9 matrix in `js/shared/csv.js` header)
8. ~~**PRD / CH2 timetable resolver**~~ ✅ **2026-07-11** (KD20 improvement + characterization tests)
9. ~~**PRE / CH4 date-utils**~~ ✅ **2026-07-11** (style-based KD9 matrix)
10. ~~**CH8 gender + CH9 report esc**~~ ✅ **2026-07-11**
11. ~~**CH10 FET import + CH11 role guards + PRL**~~ ✅ **2026-07-11**
12. ~~**CH5 formatNumber styles**~~ ✅ **2026-07-11**
13. **Optional remaining:** base-plan C2/C3 proctor-v3 DRY · C5 timetable view · diagnostics log I/O · re-run `npm run dup:report` for fresh %.

---

## References

- Base plan: [`2026-07-10-centralize-duplicates-plan.md`](./2026-07-10-centralize-duplicates-plan.md)
- Inventory: [`2026-07-10-duplicate-inventory.md`](./2026-07-10-duplicate-inventory.md)
- Design: [`2026-07-10-find-centralize-duplicates.md`](./2026-07-10-find-centralize-duplicates.md)
- SSOTs: `js/shared/timetable-utils.js`, `js/utils.js` (`escapeHtml`/`debounce`/`formatNumber`), `main/db/exam-count-defaults.js`
- Sidebar page catalog: `js/sidebar.js`, `main/db/exam-count-defaults.js` (`PAGE_LABELS`)

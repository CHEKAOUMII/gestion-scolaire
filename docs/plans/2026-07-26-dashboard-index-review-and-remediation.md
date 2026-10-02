# Dashboard (`index.html`) Code Review & Remediation Plan

- **Date:** 2026-07-26
- **Scope:** `index.html` and everything it loads — `app.js`, `js/pages/dashboard-init.js`, `js/utils.js` (`setupUnifiedHeader`), `js/ux-enhancements.js`, `js/shared/auth-session.js`
- **Status:** Proposed (no code changed yet)
- **Related plans:** `2026-07-19-dashboard-redesign.md`, `2026-07-23-google-calendar-milestone-timeline.md`, `2026-07-18-sticky-topbar-print-all-pages.md`, `2026-07-17-tailwind-vanilla-css-cleanup-plan.md`

---

## 1. Executive summary

The dashboard markup itself is in good shape: correct RTL setup, `aria-*` on every icon button, `sr-only` page heading, no inline handlers, `theme-boot.js` loaded synchronously in `<head>` to avoid FOUC, and the Electron shell is properly hardened (`main.js:190-193` — `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`).

The defects are concentrated in the **seams** between this page and the shared scripts, and they fall into three clusters:

| Cluster | Nature | Impact |
|---|---|---|
| **A. Header source-of-truth split** | `index.html` hand-writes a topbar and opts out of the shared builder | Backup/restore + shortcuts modals are unreachable; dead listeners |
| **B. School-year flow collision** | Two competing `#school-year` change handlers | Listener leak, redundant reload, add-season feature destroyed, select/state desync |
| **C. Journey data correctness** | Placeholder arithmetic and fabricated fallbacks | Wrong and invented numbers rendered as real school data |

Plus a large body of dead code: `refreshDashboard()` drives only 4 functions, yet ~1,200 lines of chart/table/print code in `app.js` has no live caller on this page.

**Recommended sequencing:** Phase 1 (A) → Phase 2 (B) → Phase 3 (C) → Phase 4 (a11y/perf) → Phase 5 (dead-code removal).

---

## 2. Findings

### 2.1 Critical

#### F1 — Backup modal and shortcuts modal have no trigger

`index.html` is the **only** page in the repo that hardcodes `data-unified-header="true"`. The shared builder bails on that flag:

```js
// js/utils.js:2226
if (!header || header.dataset.unifiedHeader === 'true') return;
```

That builder is the sole injector of `#shortcuts-btn` and `#backup-btn` (`js/utils.js:2245-2252`, gated on the presence of `#shortcuts-modal` / `#backup-modal` — which exist only in `index.html`).

Consequences:

- `#backup-modal` is in the DOM with no way to open it. The listener block at `js/pages/dashboard-init.js:130-140` binds to a non-existent `#backup-btn`.
- `#shortcuts-modal` is reachable only via the `?` key (`js/ux-enhancements.js:253`), never a button.
- `js/ux-enhancements.js:420-430` and `js/pages/dashboard-init.js:133` both query `.header-tools` (`HTMLDetailsElement`) — markup that exists in no page anymore.

Backup/restore is the most safety-critical control on this screen. This is a data-loss-adjacent defect.

#### F2 — "+ إضافة موسم" option is wiped before the user can use it

`index.html` declares `<option value="new">+ إضافة موسم</option>` and `js/pages/dashboard-init.js:14-27` handles it. But `initDatabase()` → `updateAvailableYears()` rebuilds the select from scratch without that option:

```js
// app.js:175
yearSelect.innerHTML = '';
```

`initDatabase()` runs on `DOMContentLoaded`, so the option is gone before first paint settles. The `prompt()` branch is unreachable dead code.

#### F3 — Leaking `#school-year` listeners + redundant page reload

```js
// app.js:188-194
yearSelect.onchange = null;   // does NOT remove addEventListener-registered listeners
yearSelect.addEventListener('change', () => { ... setSchoolYear(chosen); });
```

`updateAvailableYears()` is called from `initDatabase()`, which is itself called from the change handler in `js/pages/dashboard-init.js:31`. Every year switch therefore appends another never-removed listener.

Worse, `setSchoolYear()` ends in `window.location.reload()` (`js/shared/auth-session.js`), while `dashboard-init.js` has already `await`ed a full `initDatabase(selectedYear)` and fired a success toast. One year change = full data load + full render + toast, then an immediate reload that discards all of it. The two handlers fight each other.

Additionally the add-season path never calls `setSchoolYear()`, so `updateAvailableYears()` re-selects the **old** `getSchoolYear()` value while `currentSchoolYear` holds the new one → visible select-vs-state desync.

#### F4 — Shortcuts modal advertises five shortcuts, all wrong

Against `initKeyboardShortcuts()` (`js/ux-enhancements.js:225-270`):

| Modal claims | Actual behaviour |
|---|---|
| لوحة التحكم → `Ctrl+P` | Print preview |
| النتائج والإحصائيات → `/` | Focus header search |
| تحليل النتائج → `Ctrl+K` | Toggle quick-nav |
| جداول الحصص → `?` | Open this modal |
| ورقة الغياب الأسبوعية → `Esc` | Close open modals |

The same incorrect list is duplicated in `settings-imports.html`, `settings-sync.html`, `timetable.html`, `timetable_body.html`.

### 2.2 High — wrong or invented data on screen

#### F5 — "المتمدرسون" always equals total

```js
// app.js:2018
const active = Math.max(stats.total - 0, 0);
```

A placeholder that was never filled in — `#sj-summary-active-value` is always identical to `#sj-summary-total-value`. The correct value is already computed and then discarded:

```js
// app.js:1893 — inside sjRiskData(), assigned, never used
const active = Math.max(stats.total - dropouts - notEnrolled - expelled, 0);
```

Compounding it, the card footer is set to `معدل X تلميذ/قسم` (`app.js:2027`) — a per-section average under a label reading "المواظبون على الدراسة". Wrong number, unrelated caption.

#### F6 — Fabricated sample data rendered as real

`SJ_DEFAULT_AGE_BARS` / `SJ_DEFAULT_SUBJECT_BARS` (`app.js:1645-1665`) are hand-invented numbers used whenever the query returns nothing. The fallback tags them:

```js
// app.js:1698 and app.js:1854
return SJ_DEFAULT_AGE_BARS.map((b) => ({ ...b, isDefault: true }));
```

`isDefault` is **never read anywhere**. `sjRenderAge` / `sjRenderRatio` draw the invented bars with no visual distinction. On an empty school year the dashboard reports ~129 students that do not exist. For a school-records product this is a correctness defect, not a cosmetic one.

#### F7 — Milestone timeline is permanently hardcoded

```js
// app.js:2051
sjRenderTimeline(SJ_DEFAULT_MILESTONES);
```

No data path exists. Dates are derived from `new Date().getFullYear()` (`app.js:1673-1690`), so selecting season 2023/2024 still renders "سبتمبر 2026". `2026-07-23-google-calendar-milestone-timeline.md` is the intended fix; until it lands the card must be labelled as illustrative or hidden.

#### F8 — `#owner-sync-section` can get stuck visible-but-empty

Two render paths use different visibility mechanisms:

```js
// app.js:451  (error path)
section.style.display = 'block';
// app.js:471 / 498  (main path)
section.classList.add('hidden') / .remove('hidden')
```

`.hidden { display: none }` is a plain Tailwind class (`css/tailwind-output.css:6945`), so an inline `display: block` wins on specificity permanently. Sequence: telemetry error renders → role/session changes → next `refreshDashboard()` clears `innerHTML` and adds `.hidden` → an empty bordered box remains on the page.

> Positive: the admin gate is enforced server-side as well — `main/ipc/ownerTelemetry.js:29` and `:38` both call `requireRole(event, ['admin'])`. The renderer-side `isAdminRoleOnDashboard()` is defence-in-depth, not the only control. No change needed there.

### 2.3 Medium

| ID | Finding | Anchor |
|---|---|---|
| F9 | `#header-search` is decorative — nothing binds to `#header-search` or `.search-box input`. `/` focuses a box that does nothing. Placeholder promises student/teacher/section search. | `index.html` header; `js/ux-enhancements.js:242-249` |
| F10 | ~1,200 lines of `app.js` dead on this page. `refreshDashboard()` (`app.js:1632`) calls only `updateDashboardContext`, `loadDashboardAux`, `renderStudentJourney`, `renderOwnerSyncSection`. Zero live callers: `renderStatsCards` (408), `renderCharts` (802 — referenced only by its own filter `onchange` at 1029), `renderExtraCharts` (1034), `renderMovement` (1387), `renderStudentsTable`/`performSearch`/`clearSearch`/`goToPage`/`handleTableClick` (1437-1605). `updateDashboardContext` targets `#dashboard-school-year`, `#dashboard-data-scope`, `#dashboard-last-refresh` — none exist. `.chart-card`/`.btn-print`/`.btn-export` delegated handlers (`app.js:2207-2223`) match nothing. | `app.js` |
| F11 | `aria-live="polite"` wraps the entire `#student-journey-section`; five `innerHTML` blocks are replaced per render → screen readers re-announce the whole dashboard on load and on every theme toggle. | `index.html` |
| F12 | Theme toggle triggers a full data + IPC refetch. The `data-theme` `MutationObserver` (`app.js:1618-1630`) calls `renderStudentJourney()` with no `stats`, re-running `loadDashboardAux()` and two IPC calls in `sjRiskData()`. All journey colours come from CSS classes (`sj-bar--male`, `sj-risk-pill--critical`) — there is nothing to recolour in JS. | `app.js:1618-1630` |
| F13 | `#sj-loading-note` can stick forever. It is hidden only *after* `await loadDashboardAux()` (`app.js:2043-2048`); a rejection leaves the note visible and `#sj-bento` `hidden`, with no error state. Call site `void renderStudentJourney(stats)` (`app.js:1638`) has no rejection handler. | `app.js:2032-2053` |
| F14 | Corrupted Arabic literal: `showToast('?? ????? ???? ??????', 'success')`. | `app.js:2063` |

### 2.4 Low / hygiene

| ID | Finding |
|---|---|
| F15 | School identity hardcoded twice — `index.html:7` `<title>` and `app.js:2083` print header — while `printChart` correctly reads `window.api.reports.getIdentity()` (`app.js:2141`). |
| F16 | `BIRTH_PLACE_MAPPING` (`app.js:626-720+`) hardcodes ~100 commune-specific place aliases in application code; belongs in data/config. |
| F17 | `index.html` omits `js/print-system.js` (every other page loads it), so `app.js`'s `electronPrint` paths would silently degrade to `window.print()`. Currently masked by F10. |
| F18 | Mixed styling idioms inside `renderOwnerSyncSection`: legacy semantic classes (`students-results`, `stat-card`, `students-table`) interleaved with Tailwind arbitrary values (`border-[rgba(240,173,78,0.45)]`, `px-4 py-[18px]`) in one markup string. |
| F19 | `meta theme-color` is static (`#42516a`), never updated on dark-mode toggle. |
| F20 | 837 KB / 35,471 lines of `css/tailwind-output.css` on every page (mostly hand-written CSS carried inside `tailwind-input.css`). `css/student-journey.css` is loaded separately instead of via the PostCSS pipeline that already `@import`s `print.css`. |
| F21 | No `Content-Security-Policy` meta on any page. Low risk given `sandbox: true` + all-local assets, but cheap to add. |
| F22 | Weak year validation `/^\d{4}\/\d{4}$/` (`js/pages/dashboard-init.js:17`) accepts `1999/2050`. Native `prompt()` bypasses the app's `showConfirm`/`showToast` system and renders unstyled in RTL. |

---

## 3. Root-cause analysis

Three underlying causes explain most of the list:

1. **Two topbar implementations.** `2026-07-18-sticky-topbar-print-all-pages.md` introduced `setupUnifiedHeader()` for all pages; `index.html` kept its hand-written header and set `data-unified-header="true"` to suppress the builder. The two have since drifted (missing buttons, different search placeholder). → F1, F9, F17, F19.
2. **Two owners of `#school-year`.** `app.js:updateAvailableYears()` (legacy dashboard) and `js/pages/dashboard-init.js` (new dashboard init) both populate and both listen. → F2, F3, F22.
3. **Redesign left scaffolding in place.** `2026-07-19-dashboard-redesign.md` replaced the stats/charts/table dashboard with the Student Journey bento, but the old `app.js` code, its placeholder arithmetic, and its invented demo data were never removed or finished. → F5, F6, F7, F10, F14.

---

## 4. Remediation plan

### Phase 1 — Restore reachable controls (F1, F9, F17, F19)

**Decision required first:** pick one topbar owner.

- **Option 1A (recommended):** remove `data-unified-header="true"` from `index.html` and let `setupUnifiedHeader()` own the topbar on every page. Lowest long-term maintenance; single source of truth.
  - Risk: the builder replaces `.header-right`, so the dashboard-specific `.dashboard-year-control` label wrapper and the `+ إضافة موسم` option must be reproduced by the builder or re-attached after it runs.
- **Option 1B:** keep the hand-written header and add `#shortcuts-btn` + `#backup-btn` to `index.html` directly.
  - Cheaper now, keeps the drift.

Tasks:

| # | Task | Files |
|---|---|---|
| 1.1 | Decide 1A vs 1B; record the decision in this doc | this file |
| 1.2 | Ensure `#backup-btn` and `#shortcuts-btn` exist on the dashboard and open their modals | `index.html` or `js/utils.js` |
| 1.3 | Remove the `.header-tools` `<details>` assumptions | `js/pages/dashboard-init.js:130-140`, `js/ux-enhancements.js:420-430` |
| 1.4 | Either wire `#header-search` (delegate to a real search) or delete the box and the `/` shortcut's dependence on it | `index.html`, `js/ux-enhancements.js:242-249` |
| 1.5 | Add `js/print-system.js` to `index.html` **or** drop the print paths as part of Phase 5 | `index.html` |
| 1.6 | Update `meta theme-color` on theme toggle | `js/ux-enhancements.js` theme handler |

**Acceptance:** On the dashboard, a visible button opens the backup modal; create-backup and restore both complete; a visible button opens the shortcuts modal and `Esc` closes it; no console errors from missing `.header-tools`.

### Phase 2 — One owner for the school-year control (F2, F3, F22)

| # | Task | Files |
|---|---|---|
| 2.1 | Make `updateAvailableYears()` **populate only** — remove the `addEventListener` at `app.js:188-194` and the `onchange = null` line | `app.js:154-200` |
| 2.2 | Preserve the `+ إضافة موسم` option when rebuilding options (append after the year list) | `app.js:175-187` |
| 2.3 | Rewrite the `dashboard-init.js` change handler to be the single owner: on a real year → call `setSchoolYear(year)` and let its reload do the work (drop the now-pointless `initDatabase` + toast); on `new` → prompt, persist, then `setSchoolYear(newYear)` so select and state agree after reload | `js/pages/dashboard-init.js:10-40` |
| 2.4 | Replace `prompt()` with the app's own modal/confirm flow; tighten validation to consecutive years (`YYYY/YYYY+1`) | `js/pages/dashboard-init.js:14-27` |
| 2.5 | Verify no other page regressed — `auth-session.js`, `pure.js`, `reports-forms.js`, `settings-imports.js`, `settings-school.js`, `print-system.js` all reference `#school-year` | grep sweep |

**Acceptance:** Switching seasons triggers exactly one reload and one data load; repeated switching does not accumulate listeners (verify via `getEventListeners` in devtools or a counter); adding a new season leaves the select showing the new season.

### Phase 3 — Journey data correctness (F5, F6, F7, F8, F13, F14)

| # | Task | Files |
|---|---|---|
| 3.1 | Have `sjRiskData()` return its computed `active` (or lift the calculation into `calculateStats()`), and consume it in `sjRenderSummary` | `app.js:1870-1930`, `app.js:2017-2030` |
| 3.2 | Fix the "المتمدرسون" footer caption to describe the value shown; move the per-section average to the sections card | `app.js:2027` |
| 3.3 | Replace `SJ_DEFAULT_AGE_BARS` / `SJ_DEFAULT_SUBJECT_BARS` fallbacks with explicit empty states ("لا توجد بيانات لهذا الموسم"); delete the unused `isDefault` flag | `app.js:1645-1665`, `1698`, `1854`, `sjRenderAge`, `sjRenderRatio` |
| 3.4 | Label the milestone timeline as illustrative (or hide the card) until the calendar plan lands; make its year derive from the selected season, not `new Date()` | `app.js:1673-1690`, `2051` |
| 3.5 | Make `#owner-sync-section` visibility class-only — remove `section.style.display = 'block'` | `app.js:451` |
| 3.6 | Wrap `renderStudentJourney` in `try/catch`; render an error state that hides `#sj-loading-note` and reveals a retry affordance; add a rejection handler at the `app.js:1638` call site | `app.js:1638`, `2032-2053` |
| 3.7 | Fix the mojibake toast string | `app.js:2063` |

**Acceptance:** On a season with zero students, every journey card shows an empty state and no invented numbers; "المتمدرسون" ≤ "إجمالي التلاميذ" and matches the at-risk math; forcing an IPC failure shows an error state rather than a permanent spinner note; the owner-sync section never renders as an empty box.

### Phase 4 — Accessibility & render cost (F11, F12)

| # | Task | Files |
|---|---|---|
| 4.1 | Narrow `aria-live` from `#student-journey-section` to `#sj-loading-note` and the three summary values | `index.html` |
| 4.2 | Remove the `data-theme` `MutationObserver` re-render, or reduce it to only what CSS cannot handle (verify no inline colours remain in `sj-*` renderers) | `app.js:1618-1630` |
| 4.3 | Re-verify dark-mode contrast on all `sj-*` cards after 4.2 | `css/student-journey.css` |

**Acceptance:** Toggling the theme issues zero IPC calls (verify in the main-process log or via an IPC counter) and journey colours still adapt; screen reader announces only the summary values on refresh.

### Phase 5 — Dead-code removal (F10, F15, F16, F18)

Do this **last**, after Phases 1-4 confirm what is genuinely needed.

| # | Task | Files |
|---|---|---|
| 5.1 | Delete `renderStatsCards`, `renderCharts`, `renderExtraCharts`, `renderMovement`, `renderStudentsTable`, `handleTableClick/Input/Change`, `goToPage`, `performSearch`, `clearSearch`, `destroyCharts`/`destroyChartInstances` if unreferenced after removal, and the `.chart-card`/`.btn-print`/`.btn-export` delegated handlers | `app.js:361-1610`, `2200-2230` |
| 5.2 | Delete or repoint `updateDashboardContext` (its three target IDs do not exist) | `app.js:79-105`, `1635` |
| 5.3 | Decide the fate of `printTable`/`exportToExcel`/`goToHome` — remove, or re-expose with real buttons | `app.js:2058-2130` |
| 5.4 | Move `BIRTH_PLACE_MAPPING` out of `app.js` into a data module | `app.js:626+` → `js/data/` |
| 5.5 | Read school name from `window.api.reports.getIdentity()` instead of hardcoding; set `<title>` dynamically | `index.html:7`, `app.js:2083` |
| 5.6 | Normalise `renderOwnerSyncSection` markup to one styling idiom | `app.js:465-560` |
| 5.7 | Verify `ensureChartLoaded()` / `ensureXlsxLoaded()` are still needed after 5.1/5.3 | `app.js:39-59` |

**Acceptance:** `app.js` line count materially reduced; dashboard renders identically; no `ReferenceError` in console; grep confirms no remaining references to removed symbols across `js/**`, `app.js`, `*.html`.

### Phase 6 — Optional hygiene (F20, F21, and cross-page F4 duplication)

| # | Task | Files |
|---|---|---|
| 6.1 | Correct the shortcuts list in all five pages that duplicate it — **or** generate the list from a single shared shortcut registry so it can never drift again (preferred) | `index.html`, `settings-imports.html`, `settings-sync.html`, `timetable.html`, `timetable_body.html`, `js/ux-enhancements.js` |
| 6.2 | Fold `css/student-journey.css` into the PostCSS pipeline via `@import` in `tailwind-input.css` | `css/tailwind-input.css`, `index.html` |
| 6.3 | Add a `Content-Security-Policy` meta (or session-level header in `main.js`) | `main.js` or all `*.html` |

> 6.1 is listed here for pipeline reasons but the **content fix is Critical (F4)** — do the content correction inside Phase 1 even if the shared-registry refactor waits.

---

## 5. Verification strategy

Per phase:

1. `npm run lint`
2. `npm test` — check whether existing suites cover `updateAvailableYears` / dashboard init; if not, add unit coverage for the year-select population (option set includes `+ إضافة موسم`, listener registered once) and for `sjRenderSummary` (`active <= total`).
3. Manual smoke on the dashboard:
   - Load with data → journey renders, loading note hidden.
   - Load on an empty season → empty states, no invented numbers.
   - Switch season ×3 → one reload each, no listener growth.
   - Add a new season → select reflects it after reload.
   - Open backup modal → create + restore both work.
   - Open shortcuts modal → every listed shortcut behaves as described.
   - Toggle theme ×3 → colours adapt, zero IPC calls.
   - Non-admin session → owner-sync section absent (not an empty box).
4. Devtools console must be clean of `null` dereference and `ReferenceError`.
5. Screen-reader pass (NVDA, Arabic) on the journey section after Phase 4.

---

## 6. Risks

| Risk | Mitigation |
|---|---|
| Option 1A replaces `.header-right` and could drop the dashboard year-control label | Reproduce the label wrapper in the builder; visual diff before/after |
| Phase 2 changes `#school-year` semantics used by 8 other modules | Grep sweep in task 2.5; smoke each consuming page |
| Phase 5 deletions may remove code some other page depends on via globals | Grep `js/**`, `app.js`, `*.html` for each symbol before deleting; delete in small commits |
| Removing fabricated fallbacks may make the dashboard look "broken" on demo/empty databases | Explicit, designed empty states with copy, not blank cards |
| F7 overlaps with the in-flight Google Calendar plan | Keep Phase 3.4 to labelling + season-correct dates only; defer the data source to that plan |

---

## 7. Out of scope

- Google Calendar milestone data source (owned by `2026-07-23-google-calendar-milestone-timeline.md`)
- Broader Tailwind/vanilla CSS consolidation (owned by `2026-07-17-tailwind-vanilla-css-cleanup-plan.md`)
- Sync/telemetry backend behaviour — server-side role enforcement already verified correct
- Any schema or IPC contract change; this plan is renderer-side plus dead-code removal only

---

## 8. Decision log

| Date | Decision | Rationale |
|---|---|---|
| 2026-07-26 | Plan drafted from review; no code changed | Await owner decision on Option 1A vs 1B before Phase 1 |

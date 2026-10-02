# Students Orientation Page Code Review

**Date:** 2026-07-16  
**Scope:** `students-orientation.html`, its renderer script, orientation preload/IPC APIs, shared filtering support, and related styles.  
**Review mode:** Static analysis only; no application code was modified.

## Executive summary

The page has a sound baseline: deferred scripts, native labelled controls, debounced search, paginated detail rendering, concurrent initial requests, explicit Chart.js cleanup, response validation, and accessible text summaries for charts.

Two correctness defects should be fixed first:

1. Active filters update KPIs and tables but do not update charts or the origin-to-choice matrix.
2. Printing a legitimate zero-result filter falls back to every orientation row for the school year.

The main performance constraint is that the complete year is transferred to the renderer and filtered in memory even though the IPC list handler supports several filters. Additional costs come from repeated matrix scans, unnecessary shared-filter API requests, and incremental live-DOM insertion.

## Prioritized findings

### High — Filtered tables disagree with charts and matrix

`loadAll()` requests year-wide list and statistics data, calls `applyClientFilters()`, and then renders charts and the matrix from the original statistics response:

- `js/pages/students-orientation.js:903-975`
- `js/pages/students-orientation.js:1031-1098`
- `main/ipc/orientation.js:316-414`

Changes to level, section, origin, first choice, or search update the filtered KPIs, orientation boards, status board, and detail table. They do not recompute `renderCharts(statsRes)` or `renderMatrix(statsRes.matrix)`. Consequently, different components can display different populations at the same time.

**Recommendation:** Establish one aggregate source for the active filter state. While the page retains all rows client-side, derive chart series and matrix cells from `filteredRows`. If filtering moves to SQLite, extend `orientation:stats` to accept the same filter object as `orientation:list` and refresh both responses together.

### High — A zero-result print can include the entire year

`buildOrientationPrintSheet()` selects its source with:

```js
const sourceRows = filteredRows.length ? filteredRows : allRows;
```

Reference: `js/pages/students-orientation.js:543-544`.

After data has loaded, a filter with zero matches is valid state. Treating an empty filtered array as “no filter state” causes the print preview to include every row instead of an empty report. Besides being incorrect, this can expose student records outside the user's intended filter.

**Recommendation:** Track loading state separately. Once data has loaded, always print `filteredRows`, including when it is empty. Use `allRows` only for an explicit unfiltered state.

### Medium — The renderer receives the complete year despite IPC-side filters

The renderer requests only the school year in `loadAll()`:

- `js/pages/students-orientation.js:924-927`

The list handler already accepts origin, section, exact level, first choice, assigned stream, and search filters:

- `main/ipc/orientation.js:273-315`
- Preload exposure: `preload.js:194-200`

`PAGE_SIZE = 20` limits only the rendered detail slice. It does not reduce the SQLite query result, IPC payload, or renderer memory usage:

- `js/pages/students-orientation.js:9`
- `js/pages/students-orientation.js:1618-1621`

**Recommendation:** Pass supported active filters to `orientation:list`. For datasets that can grow substantially, add server-side pagination and a filtered total. If grouped level options do not map directly to `o.level`, define their mapping in the IPC query rather than loading the full year as a workaround.

### Medium — Zero matches hide useful result context

When `filteredRows` is empty, `applyClientFilters()` switches to the page-wide empty state and returns:

- `js/pages/students-orientation.js:1031-1077`

The empty orientation and status boards are rendered inside `#content-area`, but that container is hidden. Users lose table headings, zero-valued KPIs, and the context showing which result set is empty.

**Recommendation:** Keep `#content-area` visible after a successful data load. Render zero KPIs and component-level empty states. Reserve the page-wide state for initial selection, no data for the year, and fatal load errors.

### Medium — Section changes can invoke filtering twice

The page directly listens to section changes as part of the section/origin/choice listener group:

- `js/pages/students-orientation.js:105-110`

`FilterManager` is also configured for `section-select` with an `onChange` callback that calls `applyClientFilters()`:

- `js/pages/students-orientation.js:678-691`

**Recommendation:** Give ownership of the section change event to either the page or `FilterManager`, not both.

### Medium — Shared filter initialization performs unrelated work

The page configures `FilterManager` only for the class/section selector, but `_loadData()` still loads classes, `levelsMapping`, and subjects:

- `js/pages/students-orientation.js:678-691`
- `js/shared/filter-manager.js:144-218`

The loader also catches these failures and converts them into empty values, which makes an IPC or database failure indistinguishable from a valid empty dataset. A teardown method exists at `js/shared/filter-manager.js:118-126`, but this page does not call it.

**Recommendation:** Load only data required by configured selectors. Expose initialization failures through a callback or structured warning. Call `destroy()` if the renderer can be initialized more than once without a full document unload.

### Medium — Matrix maximum is recalculated for each populated cell

`renderMatrix()` calls `maxCell(cells)` inside the nested origin-by-choice loop:

- `js/pages/students-orientation.js:1539-1597`
- `js/pages/students-orientation.js:1587`
- `js/pages/students-orientation.js:1599-1607`

Each call scans the complete matrix, making heat-intensity calculation approximately quadratic in the number of cells.

**Recommendation:** Calculate the maximum once before rendering rows and reuse it for every cell.

### Low — Tables use repeated live-DOM insertion

Rows are appended individually to active table bodies, including:

- orientation board: `js/pages/students-orientation.js:1309`
- status board: `js/pages/students-orientation.js:1355`
- matrix: `js/pages/students-orientation.js:1539-1597`
- detail table: `js/pages/students-orientation.js:1616+`

**Recommendation:** Build each result set in a `DocumentFragment` and replace the table body once. This is most useful for unpaginated aggregate tables and the matrix.

### Low — The renderer script has too many responsibilities

`js/pages/students-orientation.js` combines state, filter initialization, data loading, normalization, aggregation, DOM rendering, chart lifecycle, pagination, print CSS, and print document construction.

The print stylesheet occupies `js/pages/students-orientation.js:170-539` and is reassigned through `style.textContent` at `js/pages/students-orientation.js:178` whenever print preview is prepared.

**Recommendation:** Separate the implementation into focused modules:

- data loading and response validation;
- pure filtering and aggregation;
- KPI/table/matrix rendering;
- Chart.js lifecycle;
- print view-model construction.

Move stable print rules to a stylesheet and keep only genuinely dynamic print values in JavaScript.

### Low — Stable presentation rules are inline

Representative inline styles appear at:

- `students-orientation.html:44`
- `students-orientation.html:87`
- `students-orientation.html:117-128`
- `students-orientation.html:211+`
- `students-orientation.html:381+`

Matrix alignment, emphasis, and heat intensity are also assigned directly by JavaScript.

**Recommendation:** Move stable layout rules into an orientation stylesheet. For dynamic heat intensity, set a CSS custom property or semantic intensity class instead of assigning multiple style properties.

## Accessibility and UX findings

### Theme toggle lacks an accessible name

The theme button at `students-orientation.html:66-68` relies on `title` and contains an unhidden icon.

**Recommendation:** Add an Arabic `aria-label` and mark the icon `aria-hidden="true"`.

### Decorative icons are inconsistently hidden

Some action icons correctly use `aria-hidden="true"`, but heading and KPI icons do not. Representative locations include:

- `students-orientation.html:42`
- `students-orientation.html:82`
- `students-orientation.html:213`

**Recommendation:** Hide decorative icons consistently so they do not add noise to accessible names.

### Data tables have no programmatic labels

Visual section headings identify the tables, but the tables do not have captions or `aria-labelledby` relationships.

**Recommendation:** Add a `<caption>`—visually hidden when necessary—or assign an ID to each section heading and reference it from the corresponding table with `aria-labelledby`.

### Dynamic result changes are not announced

Result count, board subtitles, and empty-state changes are visual-only updates.

**Recommendation:** Use one restrained `aria-live="polite"` result-status region for filter updates. Avoid marking every KPI as live.

### Print preview is duplicated

Two visible buttons perform the same action:

- HTML controls: `students-orientation.html:59` and `students-orientation.html:124`
- Event bindings: `js/pages/students-orientation.js:159-160`

**Recommendation:** Keep one primary preview action unless a second location is intentionally required for long-page discoverability.

## Existing strengths

- Scripts are loaded with `defer`.
- Filter labels are associated with native controls.
- Search input filtering is debounced by 250 ms.
- Detail rows are paginated.
- Initial list and statistics requests run concurrently with `Promise.all`.
- Responses are checked for success and school-year consistency.
- Existing Chart.js instances are destroyed before replacement.
- Charts expose textual summaries through `aria-describedby`.
- Interpolated student values in generated detail markup are escaped.

## Recommended implementation sequence

### Phase 1 — Correctness

1. Make print preview preserve a legitimate empty filtered result.
2. Recompute charts and matrix from the same population used by KPIs and tables.
3. Keep filtered empty-state context visible.

### Phase 2 — Data and rendering performance

1. Remove duplicate section filtering.
2. Compute the matrix maximum once.
3. Batch table DOM updates.
4. Pass supported filters through IPC and introduce server-side pagination if dataset size warrants it.

### Phase 3 — Maintainability and accessibility

1. Split data, aggregation, rendering, chart, and print concerns.
2. Move stable screen and print styling into stylesheets.
3. Add accessible names, programmatic table labels, decorative-icon hiding, and a polite result announcement.

## Validation note

This report was produced from static inspection of the current repository implementation. No application files were modified, and no tests or lint commands were run because the task was review-only.

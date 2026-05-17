# Staff Management Pages Code Review - 2026-05-16

Reviewed pages:

- `teachers-list.html` / `js/pages/teachers-list.js`
- `inspectors.html` / `js/pages/inspectors.js`
- `tracking-teachers-performance.html` / `js/pages/tracking-teachers-performance.js`
- `staff-attendance.html` / `js/pages/staff-attendance.js`
- `staff-daily-report.html` / `js/pages/staff-daily-report.js`
- `compensation-tracking.html`

Also reviewed related IPC, preload, schema/migrations, sync capture, and available tests.

Automated checks:

- `npm run lint` passes with 0 errors and 6 warnings.
- `npm test` fails because `package.json` has no `test` script.
- The lint command does not cover inline script in `compensation-tracking.html`.

## Summary

Overall quality is mixed. The newer staff pages show good progress toward safer DOM construction and IPC-backed persistence, especially `teachers-list.js`, `inspectors.js`, and `staff-attendance.js`. The weakest areas are cross-page consistency, large page-owned workflows, compensation identity modeling, and missing tests for the staff-management domain. The most important production risks are school-year inconsistency in the teacher performance page, name-based compensation uniqueness, expensive repeated IPC/read loops in compensation tracking, and inline `innerHTML`/`onclick` patterns that remain in compensation tracking and performance reporting.

## Architecture & Design Findings

### Finding A1

- **Severity:** Major
- **Issue:** `tracking-teachers-performance.html` does not use the same school-year source as the other staff pages.
- **Evidence:** `js/pages/tracking-teachers-performance.js:7` captures `DEFAULT_YEAR = getSchoolYear()`, but `getCurrentYear()` then checks `window.api.settings.get('schoolYear')` at `js/pages/tracking-teachers-performance.js:123`. The app-wide helper stores the active year under `gsl_current_school_year` and DB setting `currentSchoolYear` in `js/utils.js:2560`.
- **Impact:** Teacher performance can load grades, absences, compensation, and support sessions for a different year than teachers list, staff attendance, daily report, and compensation tracking. This leads to reports that do not match the visible staff records.
- **Suggestion:** Create a shared `getActiveSchoolYear()` helper for renderer pages that reads the same source as `getSchoolYear()`/`currentSchoolYear`. Replace the `schoolYear` settings key in `tracking-teachers-performance.js` with that helper.

### Finding A2

- **Severity:** Major
- **Issue:** Compensation tracking identity is still name-first even though `teacher_id` exists.
- **Evidence:** `compensation_tracking` has `teacher_id` added in `main/db/migrations.js:435`, but its uniqueness remains `UNIQUE(absence_date, teacher_name, section, period_slot, school_year)` in `main/db/migrations.js:405`. `compensation:saveBatch` resolves identity but inserts into that name-based unique constraint at `main/ipc/staff.js:814`.
- **Impact:** Two teachers with the same display name can collide for the same date, section, and period. One teacher's compensation session may be ignored by `INSERT OR IGNORE`.
- **Suggestion:** Add a generated or stored identity key for compensation rows, or recreate the unique index around `COALESCE(teacher_id, -1)` plus a fallback normalized name. Keep `teacher_name` as display data.

### Finding A3

- **Severity:** Major
- **Issue:** `compensation-tracking.html` owns too many responsibilities in one inline script.
- **Evidence:** The page is `1,116` lines and includes date utilities, timetable resolution, auto-seeding from attendance, filters, printing, stats, table rendering, pagination, and status updates in one HTML file.
- **Impact:** The page cannot be linted by the current ESLint config, is hard to unit test, and duplicates logic already present in `staff-attendance.js` and `staff-daily-report.js`.
- **Suggestion:** Extract modules such as `js/pages/staff/compensation-model.js`, `compensation-render.js`, `timetable-session-extractor.js`, and a small page controller.

### Finding A4

- **Severity:** Minor
- **Issue:** There is an active navigation/catalog mismatch for staff-management pages.
- **Evidence:** The sidebar shows `tracking-teachers-performance.html` and `compensation-tracking.html` under `تدبير الموظفين` in `js/sidebar.js:38`, but the page visibility catalog still lists `teachers-schedule.html`, `teachers-absence.html`, and `teachers-performance.html` in `js/utils.js:109`.
- **Impact:** Visibility management and sidebar navigation can drift. Admins may configure pages that users do not see, or see pages that visibility controls do not manage.
- **Suggestion:** Decide the canonical staff page set and align `js/sidebar.js`, `js/utils.js`, `main/db/managed-pages.js`, and `page-visibility-defaults.json`.

## Code Quality Findings

### Finding Q1

- **Severity:** Major
- **Issue:** `compensation-tracking.html` still uses string-built interactive controls with inline handlers.
- **Evidence:** Table action buttons use `onclick="toggleComp(...)"` at `compensation-tracking.html:1030`; pagination uses `onclick="gotoPage(...)"` at `compensation-tracking.html:1075`.
- **Impact:** Inline handlers couple rendering to global functions, bypass the safer event-delegation pattern used in `teachers-list.js:370` and `inspectors.js:410`, and keep this code outside lint coverage.
- **Suggestion:** Render `data-action`/`data-id` attributes and attach delegated listeners to `#tracking-tbody` and `#comp-pagination`.

### Finding Q2

- **Severity:** Major
- **Issue:** There is a full obsolete `saveRecord` implementation left commented in `staff-attendance.js`.
- **Evidence:** A large commented-out `saveRecord` block remains at `js/pages/staff-attendance.js:887`, followed by the active implementation at `js/pages/staff-attendance.js:1008`.
- **Impact:** This adds noise to an already large file, makes reviews harder, and increases the chance someone edits or reasons from stale logic.
- **Suggestion:** Delete the obsolete block and rely on version control for history.

### Finding Q3

- **Severity:** Major
- **Issue:** Teacher detail rendering mixes escaped and unescaped values.
- **Evidence:** `showDetail()` builds `body.innerHTML` at `js/pages/teachers-list.js:489`. Most field values go through `escapeHtml`, but `label` is inserted directly at `js/pages/teachers-list.js:474`, and translated values from `translateCadre`/`translateGrade` pass through `f()` as values but still depend on string HTML rendering.
- **Impact:** Current labels are static, so immediate exploit risk is low, but the helper is unsafe by contract and invites future injection if labels become dynamic.
- **Suggestion:** Build detail fields with DOM nodes, or escape labels as well. Keep `f()` and `fFull()` pure and safe for arbitrary strings.

### Finding Q4

- **Severity:** Minor
- **Issue:** Performance page title is inserted via `innerHTML` even though it includes a teacher name.
- **Evidence:** `updateTrackingPageTitle()` writes `<i ...></i> ${title}` to `titleNode.innerHTML` at `js/pages/tracking-teachers-performance.js:104`; `title` can include selected teacher display text from `getSelectedTeacherDisplayName()` at `js/pages/tracking-teachers-performance.js:99`.
- **Impact:** Teacher names are usually DB-originated but still user-controlled through imports/manual records. This can break markup.
- **Suggestion:** Clear the node, append the icon element, and append a text node for the title.

### Finding Q5

- **Severity:** Minor
- **Issue:** The codebase has duplicated staff timetable-resolution logic.
- **Evidence:** `staff-attendance.js` defines timetable cache and teacher schedule helpers at `js/pages/staff-attendance.js:61`; `staff-daily-report.js` has similar cache and schedule helpers at `js/pages/staff-daily-report.js:43`; `compensation-tracking.html` repeats detailed session extraction at `compensation-tracking.html:475`.
- **Impact:** Bug fixes in timetable matching can land in one page and not the others.
- **Suggestion:** Extract shared timetable/teacher-session helpers into `js/pages/staff/staff-timetable.js` or extend `js/shared/timetable-utils.js`.

## Performance Findings

### Finding P1

- **Severity:** Major
- **Issue:** Compensation tracking fetches compensated records one day at a time.
- **Evidence:** `fetchCompensatedInRange()` loops from `dateFrom` to `dateTo` and calls `window.api.compensation.getByDate()` for each day at `compensation-tracking.html:855`.
- **Impact:** A 60-day range performs up to 60 renderer-to-main IPC calls and 60 SQL queries. This is avoidable latency and can make filtering feel slow.
- **Suggestion:** Add `compensation:getByRange({ school_year, date_from, date_to, include_compensated })` and query with `WHERE absence_date BETWEEN ? AND ?`.

### Finding P2

- **Severity:** Major
- **Issue:** Auto-seeding compensation reloads timetable data per date.
- **Evidence:** `autoSeedFromAttendance()` groups absences by date and calls `getDetailedSessionsForDay()` for each date at `compensation-tracking.html:560`; `getDetailedSessionsForDay()` calls `window.api.timetable.get()` each time at `compensation-tracking.html:478`.
- **Impact:** Date ranges with many absent days repeatedly fetch the same timetable. This is an N+1 IPC pattern.
- **Suggestion:** Load timetable once before the date loop and pass it into a pure `extractDetailedSessionsForDay(ttData, absenceRecords, date)` helper.

### Finding P3

- **Severity:** Major
- **Issue:** Staff attendance table does async schedule resolution per rendered row.
- **Evidence:** `renderTable()` awaits `getScheduleForDay()` and `getSectionsForDay()` inside `Promise.all(pageRows.map(...))` at `js/pages/staff-attendance.js:737`.
- **Impact:** Caching helps, but every render still performs multiple async lookups per row. This grows with page size and makes table render tied to timetable traversal.
- **Suggestion:** Precompute a per-page `{recordId: schedule, sections}` view model before rendering, or batch derive schedules from one timetable pass.

### Finding P4

- **Severity:** Minor
- **Issue:** Daily report auto-saves compensation sessions every time the report loads.
- **Evidence:** `loadReport()` calls `window.api.compensation.saveBatch(detailedSessions)` after calculating sessions at `js/pages/staff-daily-report.js:543`.
- **Impact:** `INSERT OR IGNORE` limits duplicates, but every report view still does write IPC and DB work. Users opening old dates repeatedly trigger writes.
- **Suggestion:** Save only when missing rows are detected, or move auto-seeding to a dedicated IPC that computes and inserts in one transaction and reports inserted/skipped counts.

## Testing Findings

### Finding T1

- **Severity:** Major
- **Issue:** There is no `npm test` script despite project instructions mentioning it.
- **Evidence:** `npm test` fails with `Missing script: "test"`. `package.json` defines `test:smoke`, `test:integration`, `test:auth-firebase`, and `test:fairness`, but no aggregate `test`.
- **Impact:** Developers and CI cannot run a standard verification command. Staff-management regressions are likely to ship unnoticed.
- **Suggestion:** Add `npm test` that runs smoke tests plus focused staff-management unit tests.

### Finding T2

- **Severity:** Major
- **Issue:** No focused tests exist for the six reviewed staff-management pages.
- **Evidence:** Searching `tests/` for staff/teacher attendance/compensation/inspectors found no matching page tests; existing tests focus heavily on exams/proctors and Firebase.
- **Impact:** Core workflows such as staff attendance duplicate handling, compensation seeding, inspector CRUD, and daily report tags are not protected.
- **Suggestion:** Add unit tests for pure helpers and IPC integration tests with an in-memory SQLite DB for `staffAttendance`, `compensation`, `systemTags`, `inspectors`, and teacher import/update.

### Finding T3

- **Severity:** Major
- **Issue:** Important logic remains trapped in HTML or global scripts, making direct testing hard.
- **Evidence:** `compensation-tracking.html` owns merge, seed, filter, render, and toggle logic inline. `tracking-teachers-performance.js` contains many pure-ish analytics helpers but exports none.
- **Impact:** Tests would need DOM-heavy setup or copied logic, which drifts from production.
- **Suggestion:** Extract pure functions for compensation merging, date-range generation, teacher performance aggregation, duration/stat calculations, and system-tag mention parsing.

### Finding T4

- **Severity:** Minor
- **Issue:** Missing regression cases are clear from the code paths.
- **Evidence:** Staff attendance duplicate detection is implemented in `main/ipc/staffAttendance.js:15`; compensation uniqueness is name-based in `main/db/migrations.js:418`; tag note replacement deletes and reinserts groups in `main/ipc/staff.js:1157`.
- **Impact:** These are high-value edge cases without automated protection.
- **Suggestion:** Add tests for duplicate teacher names, same-day absence periods, late vs absence uniqueness, multi-day absence partial failure, compensation same-name collision, tag note edit replacement, and school-year mismatch.

## Reliability & Error Handling Findings

### Finding R1

- **Severity:** Major
- **Issue:** Teachers list does not handle load/save/delete exceptions.
- **Evidence:** `loadTeachers()` directly awaits `window.api.teachers.getAll(year)` at `js/pages/teachers-list.js:93`; form submit directly awaits add/update at `js/pages/teachers-list.js:558`; delete directly awaits `window.api.teachers.delete(id)` at `js/pages/teachers-list.js:591`.
- **Impact:** IPC failures can produce unhandled rejections and leave the UI in a stale state with no user-facing error.
- **Suggestion:** Wrap these calls in `try/catch`, use loading toasts for writes, and show recoverable empty states on load failure.

### Finding R2

- **Severity:** Major
- **Issue:** Compensation status toggles are not transactional from the renderer perspective.
- **Evidence:** `toggleComp()` loops IDs and awaits `window.api.compensation.toggleCompensated(id, compensated)` one at a time at `compensation-tracking.html:1094`.
- **Impact:** For merged consecutive sessions, one row can be updated while another fails, leaving a partially compensated merged row.
- **Suggestion:** Add `compensation:toggleMany(ids, compensated)` and update all rows in a single SQLite transaction. Return updated count and surface partial failures.

### Finding R3

- **Severity:** Major
- **Issue:** Inspector update/delete IPC does not scope by school year or check affected rows.
- **Evidence:** `inspectors:update` updates by `id` only at `main/ipc/inspectors.js:90`; `inspectors:delete` deletes by `id` only at `main/ipc/inspectors.js:99`.
- **Impact:** The UI only passes visible IDs, but IPC allows cross-year updates/deletes by ID if called directly through preload by any authorized renderer context.
- **Suggestion:** Require `school_year` in update/delete payloads and add `WHERE id = ? AND school_year = ?`; return an error when `changes === 0`.

### Finding R4

- **Severity:** Minor
- **Issue:** Inspector date/email/status validation is minimal.
- **Evidence:** `inspectors:add` only requires required fields at `main/ipc/inspectors.js:43`; `last_visit_date`, `email`, and `status` are inserted without validation at `main/ipc/inspectors.js:48`.
- **Impact:** Invalid date strings can break visit stats, and arbitrary status values make active/inactive counts unreliable.
- **Suggestion:** Use `validateDate()` for `last_visit_date` when present, normalize status to an allowlist, and validate email shape lightly if provided.

### Finding R5

- **Severity:** Minor
- **Issue:** Several catch blocks swallow diagnostics completely.
- **Evidence:** `inspectors.js` catches subject loading errors and ignores them at `js/pages/inspectors.js:60`; `staff-daily-report.js` cache loaders catch and replace with empty arrays at `js/pages/staff-daily-report.js:727`.
- **Impact:** Missing API/data problems can look like empty data, making support diagnosis harder.
- **Suggestion:** Log a namespaced warning in catch blocks and show a non-blocking warning where the user can act on it.

## Conclusion

Top improvements, in priority order:

1. Centralize staff-page school-year resolution and fix `tracking-teachers-performance.js` to use it.
2. Rework compensation identity and uniqueness to be `teacher_id`/identity-key first, not display-name first.
3. Extract `compensation-tracking.html` inline script into testable modules and replace inline handlers with event delegation.
4. Add range/batch IPC for compensation reads and status toggles to remove N+1 IPC and partial-update risks.
5. Add `npm test` plus focused tests for staff attendance, compensation tracking, daily report system tags, inspector CRUD, and teacher import/update.

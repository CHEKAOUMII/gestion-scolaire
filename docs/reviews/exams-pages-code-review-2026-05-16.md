# Exams Pages Code Review - 2026-05-16

Reviewed the current local state of `exams-schedule.html`, `exams-proctors.html`, and `exams-rooms.html`, plus related IPC/schema where needed.

`npm run lint` passes with 0 errors and 6 warnings, but the lint command does not cover inline scripts inside these HTML files.

## Architecture & Design

### Positive observations

- The v2 proctor distribution algorithm is separated into `js/algorithms/proctor-distribution-v2.js:1`.
- The new proctor-key resolver is a pure, testable helper in `js/data/proctor-key-resolver.js:45`.
- IPC namespaces are reasonably clear: `examConfig`, `examProctors`, `examAttendance`.

### Issues found

- The three exam pages do not share one active school-year source. `exams-schedule.html` uses `selectedSchoolYear` or date fallback, while proctors/rooms use `getSchoolYear()` or `currentSchoolYear`: `exams-schedule.html:601`, `exams-proctors.html:1148`, `exams-rooms.html:697`. This can save schedule/config data under one `school_year` and read distribution/summary under another.
- The HTML files are doing too much. `exams-proctors.html` is 6,511 lines and owns import, scheduling, distribution, summaries, printing, and persistence orchestration.
- The H5 key-based identity fix is applied to summary aggregation, but invitations and attendance still aggregate by display name: `exams-rooms.html:1348`, `exams-rooms.html:1848`. The schema also enforces `UNIQUE(school_year, session_key, teacher_name)`: `main/db/migrations.js:1231`.

### Recommendations

- Centralize active school-year resolution in one shared helper and use it in all three pages.
- Split `exams-proctors.html` into page controller, import service, distribution service, print builders, and shared exam-config helpers.
- Make proctor identity key-first across invitations and attendance: persist `proctor_key` or `teacher_id`, display `teacher_name` only as presentation.

## Code Quality

### Positive observations

- Escaping is used in many render paths through `escHtml`.
- Several newer comments document non-obvious migration/fairness decisions.
- The proctor distribution tests show good attention to regression preservation.

### Issues found

- Some user-controlled values are interpolated into `innerHTML` without escaping. Example: custom `level.name` is rendered directly in the rooms table: `exams-schedule.html:1298`. `s.duration` is also unescaped: `exams-schedule.html:1109`.
- Inline event handlers are widespread, and attendance only replaces `'` before injecting names into JS attributes: `exams-rooms.html:1903`. A name containing `"` or HTML-sensitive characters can break attributes or worse.
- There is duplicated logic for migration, XLSX loading, schedule access, date/session keys, print HTML, and proctor imports across pages.

### Recommendations

- Prefer DOM construction/event delegation over string-built inline handlers.
- Add separate helpers for `escapeHtml`, `escapeAttr`, and `escapeJsString`, or avoid JS-in-HTML attributes entirely.
- Extract duplicated exam helpers into `js/pages/exams/shared-*.js`.

## Performance

### Positive observations

- Tables are paginated for proctors/supervisors.
- The resolver precomputes a `Map`, which is appropriate for repeated key lookups.

### Issues found

- Several paths repeatedly fetch the same config inside loops. `getReadinessHalfdayRows()` calls `getRoomRowsForLevel()`, which re-reads `examCenterRoomsData` per schedule entry: `exams-proctors.html:1436`, `exams-proctors.html:3379`.
- `buildSummaryData()` calls `getSummaryCandidateCountForLevel()` per entry, and that function fetches rooms data each time: `exams-proctors.html:6316`, `exams-proctors.html:6332`.
- Large synchronous distribution/rendering work runs on the renderer thread, so bigger centers can freeze the UI.

### Recommendations

- Load `examCenterRoomsData`, `examCenterLevels`, and schedule data once per render/build pass, then pass maps down.
- Cache room rows by level for the duration of a distribution/readiness run.
- Move heavy distribution work to a worker or at least add visible busy/disabled states around the run button.

## Testing

### Positive observations

- There is strong coverage around the v2 algorithm, key stability, synthetic room behavior, and H5 summary consistency.
- `npm run lint` completed successfully with warnings only.

### Issues found

- `package.json` has no test script even though `AGENTS.md` says `npm test`.
- ESLint does not lint inline scripts in these three HTML files, which are the main code under review.
- Many tests mirror production functions copied from HTML. That catches expected behavior, but it can drift from production code and miss integration regressions.
- I did not find coverage for the duration parser edge cases like `45د` or `1س30د`, school-year consistency across pages, or invitation/attendance duplicate-name collisions.

### Recommendations

- Add a real `npm test` script that runs the proctor/exam test suite.
- Extract inline JS into importable modules so tests can execute production code directly.
- Add regression tests for school-year resolution, duration parsing, edit existing proctor, duplicate-name invitations, and duplicate-name attendance.

## Reliability & Error Handling

### Positive observations

- Many IPC calls have user-facing toast failures.
- The v2 algorithm returns diagnostics and has internal fallback behavior.

### Issues found

- Guard-hour summaries are wrong for Arabic minute durations. `parseDurationHours('45د')` returns `45`, and `parseDurationHours('1س30د')` returns `1`: `exams-rooms.html:755`. This directly affects `guardHours`.
- Editing an existing proctor sets `_saved = false`, then `saveProctorsToDb()` calls `bulkImport`, which only inserts rows. This can duplicate edited proctors instead of updating them: `exams-proctors.html:5773`, `exams-proctors.html:5807`, `main/ipc/exams.js:181`.
- `runAutoDistributionV2()` has no outer `try/catch`, and the click handler does not await it: `exams-proctors.html:2600`, `exams-proctors.html:2712`. If the algorithm throws, the UI can fail silently.
- `detectSavedAlgorithmVersion()` still tries to `JSON.parse` data that now comes back from `examConfig.get()` already parsed: `exams-proctors.html:2499`, `exams-proctors.html:2555`.
- Migration behavior differs: proctors removes migrated localStorage keys, schedule does not, so stale localStorage can rehydrate deleted DB config later: `exams-schedule.html:617`, `exams-proctors.html:1128`.

### Recommendations

- Fix duration parsing before relying on guard-hour totals.
- Route edited proctors through an update/upsert IPC path, not `bulkImport`.
- Wrap distribution execution in `try/catch/finally`, disable the run button during execution, and surface diagnostics on failure.
- Normalize migration behavior and delete stale localStorage after successful migration.

## Overall

Request changes before treating these pages as production-stable. The top priorities are school-year consistency, key-based identity for invitations/attendance, duration parsing, and proctor edit persistence.

---

## Expanded Full Review

### Review scope

Reviewed the current local filesystem state of:

- `exams-schedule.html` (`1,787` lines)
- `exams-proctors.html` (`6,511` lines)
- `exams-rooms.html` (`2,125` lines)
- `main/ipc/exams.js`
- `main/ipc/exam-config-data.js`
- `main/db/migrations.js`
- `preload.js`
- related proctor distribution and proctor-key tests

Automated checks:

- `npm run lint` passes with 0 errors and 6 warnings.
- `npm test` fails because `package.json` does not define a `test` script.
- Current lint config does not lint inline `<script>` code in the three reviewed HTML pages, so the highest-risk code is mostly outside automated lint coverage.

### Current worktree note

The repo already has uncommitted changes in the reviewed files and many untracked proctor/exam test files. This review is based on the current working tree, not a clean baseline diff.

## Findings By Severity

### High: Exam config can be saved and read under different school years

Evidence:

- `exams-schedule.html:601` resolves the year from `localStorage.getItem('selectedSchoolYear')`, then falls back to a date-derived value.
- The app-wide helper in `js/utils.js:2560` uses key `gsl_current_school_year`, not `selectedSchoolYear`.
- `exams-proctors.html:1148` uses `getSchoolYear()`.
- `exams-rooms.html:697` uses `getSchoolYear()` or falls back to `currentSchoolYear`.
- `main/ipc/exam-config-data.js:22` stores all exam config by the provided `school_year` and `config_key`.

Impact:

Schedule/rooms data can be saved under one `school_year`, while proctor distribution and rooms summaries read another. The user-facing symptom is that data appears to disappear between exam pages, or old/stale exam config reappears after navigation. This also makes migrations and sync harder to reason about because `exam_config_data` is correctly scoped by year, but each renderer page may pass a different year.

Recommended fix:

- Add one shared active-year helper for exam pages, preferably backed by the same `getSchoolYear()`/settings source as the rest of the app.
- Use that helper in schedule, proctors, rooms, migrations, print views, summary views, attendance, and invitations.
- Avoid date-derived fallback for writes. If the year cannot be resolved, block save with a visible error instead of silently selecting a year.

Regression tests:

- Unit-test the helper against `gsl_current_school_year`, DB `currentSchoolYear`, and missing localStorage cases.
- Integration-test that schedule save, proctor distribution read, rooms summary read, invitations, and attendance all call IPC with the same year.

### High: Attendance and invitations still collapse duplicate teachers by display name

Evidence:

- Summary aggregation now has a key-based path in `exams-rooms.html:835`, using `proctor_keys` and `buildProctorDisplayMap`.
- Invitations still build `teacherMap` by name in `exams-rooms.html:1343`; `getOrCreate(name)` keys only on the display name at `exams-rooms.html:1348`.
- Invitation metadata is also keyed by name in `exams-rooms.html:1324`.
- Attendance records are keyed by `session_key + '|' + teacher_name` in `exams-rooms.html:1803`.
- Attendance session rows dedupe by `role + '|' + name` in `exams-rooms.html:1848`.
- IPC persists invitations with `ON CONFLICT(school_year, teacher_name)` in `main/ipc/exams.js:368`.
- IPC persists attendance with `ON CONFLICT(school_year, session_key, teacher_name)` in `main/ipc/exams.js:415`.
- Schema enforces the same name-based uniqueness in `main/db/migrations.js:1212` and `main/db/migrations.js:1231`.

Impact:

Two proctors with the same Arabic display name are treated as one person for invitations and attendance. One invitation can represent both teachers, and one attendance status can overwrite the other in the same session. This is especially likely because the v2 key shape intentionally handles empty CIN values with synthetic keys, but invitations/attendance ignore those keys.

Recommended fix:

- Carry `proctor_key` through distribution rows, invitation rows, attendance rows, and IPC payloads.
- Add DB columns such as `proctor_key TEXT` to `exam_invitations` and `exam_attendance`.
- Change uniqueness to key-first, for example `UNIQUE(school_year, proctor_key)` for invitations and `UNIQUE(school_year, session_key, proctor_key)` for attendance.
- Keep `teacher_name` as display text only.
- Add a migration that backfills `proctor_key` where possible from `teacher_id`, `cin`, or existing proctor list order; mark ambiguous rows for conservative fallback.

Regression tests:

- Two proctors with the same `teacher_name` and different `cin` produce two invitations.
- Two same-name proctors in the same session can have different attendance statuses.
- Legacy saved rows without `proctor_key` still display, but new writes use key-first identity.

### High: Guard-hour totals are wrong for Arabic duration strings

Evidence:

- `exams-rooms.html:755` calls `parseDurationHours(entry.duration)` before falling back to time difference.
- `parseDurationHours` at `exams-rooms.html:761` captures the first number and returns it as hours.
- For `45د`, the regex captures `45`, so it returns `45` hours.
- For `1س30د`, the regex captures only `1`, so it returns `1` hour instead of `1.5`.
- Default schedule data in `exams-schedule.html:635` includes durations such as `45د`, `1س30د`, and `1س15د`.

Impact:

Teacher workload summaries overstate or understate guard hours. This makes fairness reports and attendance/summary views misleading even when assignment counts are correct.

Recommended fix:

- Replace the parser with a duration parser that handles:
  - Arabic hours: `س`, `ساعة`, `ساعات`
  - Arabic minutes: `د`, `دقيقة`, `دقائق`
  - compact strings: `1س30د`
  - decimal strings: `1.5س`, `1,5س`
  - ranges such as `2-3س` using a documented policy, preferably max or average
- Only fall back to `time_from/time_to` if duration parsing returns no usable value.

Regression tests:

- `45د` => `0.75`
- `1س30د` => `1.5`
- `1س15د` => `1.25`
- `2س` => `2`
- `2-3س` follows the chosen policy consistently
- Invalid strings return `0` and allow time-difference fallback.

### High: Editing a saved proctor inserts a duplicate instead of updating

Evidence:

- `loadProctors()` stores DB `id` on each row in `exams-proctors.html:5687`.
- `editProctor()` mutates the existing in-memory object but sets `_saved = false` at `exams-proctors.html:5782`.
- `saveProctorsToDb()` filters unsaved rows and calls `examProctors.bulkImport` at `exams-proctors.html:5807`.
- The bulk import payload at `exams-proctors.html:5812` does not include `id`.
- `examProctors:bulkImport` in `main/ipc/exams.js:181` only executes `INSERT INTO exam_proctors`; it has no update/upsert branch.
- `examProctors:saveManual` can update by `id`, but its update statement at `main/ipc/exams.js:116` does not cover `cin`, `som`, `gender`, `specialty`, `workplace`, or `teacher_name_fr`.

Impact:

Editing a saved proctor and pressing save can duplicate that proctor instead of updating the existing row. Because distribution identity uses CIN/index-derived keys, duplicate rows can shift synthetic index keys, alter fairness calculations, and create confusing attendance/invitation output.

Recommended fix:

- Split row state into `isNew` and `isDirty`.
- For existing rows with `id`, call an update/upsert IPC path that updates all proctor fields.
- For new rows, call insert/bulk import.
- Consider a unique or soft-dedup rule for `(school_year, cin)` when CIN is present, but avoid name-only dedup.

Regression tests:

- Edit existing proctor name/CIN/gender, save, reload: row count stays the same and fields update.
- Add new proctor, save, reload: row count increases by one.
- Editing a proctor with empty CIN does not change other same-name rows.

### High: Attendance guard subject changes are not persisted

Evidence:

- The attendance UI reads `rec?.guard_subject` in `exams-rooms.html:1898`.
- `changeAttGuardSubject()` updates in-memory `attState.records` with `guard_subject` at `exams-rooms.html:2035`.
- `exam_attendance` schema has no `guard_subject` column in `main/db/migrations.js:1231`.
- `examAttendance:getAll` and `getBySession` selects in `main/ipc/exams.js:394` and `main/ipc/exams.js:400` do not include `guard_subject`.
- `examAttendance:upsert` and `bulkUpsert` in `main/ipc/exams.js:406` and `main/ipc/exams.js:448` do not write `guard_subject`.

Impact:

Changing the guard subject appears successful in the current UI because memory is updated, but the value is lost on reload. That is a data-loss bug disguised as a successful save.

Recommended fix:

- Add `guard_subject TEXT` to `exam_attendance`.
- Include it in IPC reads and writes.
- Keep it separate from `notes`; notes should not be the only persistence location for structured subject changes.

Regression tests:

- Select a guard subject, reload attendance page, verify the selected subject remains.
- Bulk mark present does not erase existing `guard_subject`.

### High: Inline HTML event handlers are unsafe with teacher names and notes

Evidence:

- Attendance table is string-built with inline `onchange` handlers in `exams-rooms.html:1893`.
- `eName` only replaces `'` at `exams-rooms.html:1903`.
- The same partially escaped value is injected into JS string literals inside attributes at `exams-rooms.html:1909`, `exams-rooms.html:1912`, `exams-rooms.html:1920`, and `exams-rooms.html:1933`.
- Subject option values use `escHtml`, which is not equivalent to JS-string escaping or attribute-safe event handler construction.

Impact:

A teacher name containing quotes, backslashes, newlines, or HTML-sensitive characters can break the generated markup or execute unintended script in the renderer context. Even in Electron, renderer XSS matters because the page has access to privileged APIs through preload.

Recommended fix:

- Stop using inline event handlers for generated rows.
- Render rows with `data-*` attributes containing stable IDs/keys, then use delegated event listeners on the table.
- If string rendering remains temporarily, use separate `escapeHtml`, `escapeAttr`, and `escapeJsString` helpers, but this should be a short-term bridge only.

Regression tests:

- Teacher names containing `'`, `"`, `<`, `>`, `&`, backslash, and newline render safely.
- Changing attendance for those teachers calls IPC with the original exact name/key.

### Medium: User-controlled schedule/level values are interpolated into `innerHTML`

Evidence:

- `s.duration` is rendered unescaped in `exams-schedule.html:1109`.
- Custom `level.name` is rendered unescaped into the rooms table at `exams-schedule.html:1300`.
- `renderAddedLevels()` mostly escapes display text, but uses escaped text inside `aria-label` attributes without a separate attribute escaping strategy at `exams-schedule.html:1148`.

Impact:

Custom level names and durations can break markup or inject HTML. The risk is lower than the attendance inline-handler issue, but these values are user-controlled and later saved into shared exam config.

Recommended fix:

- Escape all displayed string values before inserting into `innerHTML`.
- Prefer DOM node creation for editable tables and generated controls.
- Use attribute-safe escaping for `title`, `aria-label`, `value`, and `data-*` attributes.

Regression tests:

- Custom level name `<img src=x onerror=...>` displays as text.
- Duration containing quotes or angle brackets displays as text.

### Medium: Saved algorithm-version detection is stale after moving config to IPC

Evidence:

- `initAutoDistributionPanel()` receives already-parsed config data from `examConfig.get` at `exams-proctors.html:2499`.
- `main/ipc/exam-config-data.js:31` returns `JSON.parse(row.data_json)`.
- `detectSavedAlgorithmVersion()` still assumes raw localStorage JSON string and calls `JSON.parse(rawData)` at `exams-proctors.html:2555`.

Impact:

Saved v1 array data is detected as `null` instead of `v1`, so the algorithm toggle defaults to v2. Saved v2 object data is also only handled correctly elsewhere in `initAutoDistributionPanel`, not by the detector itself. This can confuse users opening older saved distributions.

Recommended fix:

- Update `detectSavedAlgorithmVersion()` to accept parsed arrays/objects and legacy JSON strings.
- Rename parameter/comments from `rawData` to `savedData`.

Regression tests:

- Parsed v2 object => `v2`
- Parsed array => `v1`
- JSON string v2 object => `v2`
- JSON string array => `v1`
- Invalid/missing => `null`

### Medium: Distribution execution has no top-level failure handling or busy state

Evidence:

- The click handler calls `runAutoDistributionV2()` without `await` in `exams-proctors.html:2600`.
- `runAutoDistributionV2()` has no outer `try/catch/finally` at `exams-proctors.html:2712`.
- The algorithm call is synchronous at `exams-proctors.html:2729`.

Impact:

Thrown errors or unexpected rejected promises can fail silently or appear only in DevTools. The run button remains active during heavy work, allowing repeated clicks. Large centers can freeze the renderer with no visible busy/disabled state.

Recommended fix:

- Make `handleDistributionButtonClick()` async and await both v1 and v2 paths.
- Wrap distribution in `try/catch/finally`.
- Disable run/save/delete buttons while distribution runs.
- Show an error toast and diagnostics fallback when the algorithm throws.
- Consider moving the v2 algorithm to a worker if real center data causes UI freezes.

Regression tests:

- Mock `ProctorDistributionV2.run` to throw; verify error toast and button re-enabled.
- Double-click run button; verify only one run executes.

### Medium: Repeated IPC/config reads create avoidable slow paths

Evidence:

- `getRoomRowsForLevel()` reads `examCenterRoomsData` every call at `exams-proctors.html:3379`.
- `getAutoSessionNeedStats()` calls it inside a loop at `exams-proctors.html:3292`.
- `buildGuardQuota()` calls it inside a loop at `exams-proctors.html:4093`.
- `buildPerTeacherQuota()` calls it inside a loop at `exams-proctors.html:4125`.
- `getSummaryCandidateCountForLevel()` reads `examCenterRoomsData` every call at `exams-proctors.html:6316`.
- `buildSummaryData()` calls that per schedule entry at `exams-proctors.html:6326`.

Impact:

Each distribution/readiness/summary run performs repeated renderer-to-main IPC calls and repeated object scans. On large schedules, this adds latency and keeps more work on the renderer thread.

Recommended fix:

- Load `examCenterRoomsData`, `examCenterLevels`, rules, and schedule entries once per render/build pass.
- Build a `roomsByLevel` map and pass it through helper functions.
- Cache by level only for the duration of a single operation so the UI still reflects saved changes on the next run.

Regression tests:

- Stub `examConfig.get` and verify summary/distribution readiness reads `examCenterRoomsData` once per operation, not once per entry.

### Medium: Migration behavior differs between exam pages

Evidence:

- Schedule migration copies localStorage keys to DB but does not remove them after success in `exams-schedule.html:617`.
- Proctors migration removes stale localStorage keys when data already exists or migration succeeds in `exams-proctors.html:1128`.

Impact:

If a user deletes or changes DB-backed config, stale schedule localStorage can rehydrate old data later. Proctors avoids this, schedule does not.

Recommended fix:

- Use one shared migration helper for exam config keys.
- Remove localStorage values after successful migration or after detecting DB already has the key.
- Log or toast migration failures, but do not remove local data if DB save fails.

Regression tests:

- Existing DB config + stale localStorage: localStorage is removed and DB is not overwritten.
- Missing DB config + localStorage: DB is written once and localStorage is removed after success.

### Medium: The main reviewed code is not importable or directly testable

Evidence:

- `exams-proctors.html` is `6,511` lines and contains page control, imports, distribution, config migration, rendering, printing, and persistence.
- `exams-rooms.html` is `2,125` lines and contains summary, invitations, attendance, printing, and identity loading.
- Tests such as `tests/inv-h5-cross-page-consistency.test.js` replicate production functions from HTML instead of importing them directly.
- ESLint script in `package.json` only covers `main/**/*.js`, `preload.js`, `js/backup.js`, `js/pages/*.js`, and `tests/**/*.js`.

Impact:

Important behavior can drift between tests and production. Inline HTML scripts are harder to lint, unit-test, and reuse, which increases the risk of regressions in exactly the code that owns exam persistence and reporting.

Recommended fix:

- Extract pure helpers into importable modules under `js/pages/exams/`, for example:
  - `school-year.js`
  - `duration.js`
  - `exam-config-migration.js`
  - `rooms-data.js`
  - `attendance-model.js`
  - `invitation-model.js`
  - `print-builders.js`
- Keep HTML files as page controllers that wire DOM events to tested modules.
- Add lint coverage for extracted modules and reduce inline script surface area over time.

Regression tests:

- Move copied test replicas to import production helpers.
- Add focused tests for duration parsing, identity keys, school-year resolution, migration, and proctor persistence.

## Recommended Fix Order

1. Fix active school-year resolution across all three pages.
2. Fix duration parsing and add tests.
3. Fix proctor edit persistence with update/upsert IPC.
4. Add `proctor_key` identity through invitations and attendance, including DB migration.
5. Persist `guard_subject` correctly.
6. Remove inline event handlers from attendance rendering.
7. Normalize migration cleanup for schedule/proctors/rooms config keys.
8. Cache rooms/config data per operation to reduce IPC churn.
9. Extract shared helpers into importable modules and wire tests to production code.
10. Add a real `npm test` script that runs the exam/proctor test suite.

## Suggested Test Suite Additions

- `tests/exam-duration-parser.test.js`
- `tests/exam-school-year-resolution.test.js`
- `tests/exam-config-migration.test.js`
- `tests/exam-proctors-edit-persistence.test.js`
- `tests/exam-invitations-key-identity.test.js`
- `tests/exam-attendance-key-identity.test.js`
- `tests/exam-attendance-guard-subject.test.js`
- `tests/exam-render-escaping.test.js`

## Final recommendation

Request changes. The distribution algorithm work has useful separation and meaningful tests, but the surrounding exam pages still have production-blocking risks in year scoping, identity, persistence, and renderer safety.

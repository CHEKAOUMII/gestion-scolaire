# Bulk Grades Import — Graceful Per-File Failure Plan

> **Status:** reviewed against the codebase on 2026-08-10.  
> **Constraint:** plan only; do not change production code in this step.  
> **Scope:** the multi-file grades path started by `#grades-file-input` in `settings-imports.html`.

## Goal

When a grades batch contains both usable and unusable files, show one primary rejection reason for each unusable file, let the operator confirm importing only the usable files, and include preflight skips in the final report without changing non-grade import semantics.

## Verified Current Behaviour

- `#grades-file-input` accepts multiple files (`settings-imports.html:54-60`).
- The change listener calls `showImportContextReview(action, files)` and, only after a `true` result, calls `handleImport(action, files)` (`js/pages/settings-imports.js:332-352`).
- `prepareImportContextReview` builds per-file reviews but currently sets batch `canProceed` to `blocking.length === 0`; one blocked file therefore blocks the whole batch (`js/pages/settings-imports.js:1008-1182`).
- Invalid preflight content is represented twice: once in `preflight.errors` and once as a synthetic `comparison` check with `key: 'fileContent'` (`js/pages/settings-imports.js:1120-1138`). Both are rendered (`js/pages/settings-imports.js:683-740`, `743-768`), which causes duplicate messages.
- `renderImportContextReview` also places the complete textual review in its summary and then renders every file again in `<details>` (`js/pages/settings-imports.js:743-768`).
- `commitImport` already continues after per-file exceptions, but its totals and reports are derived only from the files it receives (`js/pages/settings-imports.js:2443-2640`, `2738-2791`). Passing only filtered files would lose rejected-file reporting and alter original batch totals.
- `importGrades` enables automatic semester selection when `commitImport` receives one file (`js/pages/settings-imports.js:2562-2564`, `3137-3145`). Filtering a larger original batch down to one file would incorrectly activate single-file behaviour.

## Corrections to the Original Plan

1. **Do not define executability by ignoring every blocker except `fileContent`.** Grades context checks can block on school year, institution, high-confidence cycle, semester, subject, and template (`js/import-center/import-context.js:303-445`). A file is executable only when its grades preflight succeeds and it has no file-scoped context blocker.
2. **Do not discover global failures by scanning per-file checks.** Destination failures are thrown before the per-file loop by `getImportDestinationContext` (`js/pages/settings-imports.js:638-670`, `1008-1017`). Student and teacher availability are shared grades dependencies and should be checked once for the batch, not repeated and rendered as twelve file failures.
3. **Do not use `noRecordsSaved` as a skippability signal.** It defaults to `true` for most normalized failures (`js/import-center/import-result-contract.js:55-68`) and does not distinguish file defects from batch dependency failures.
4. **Do not filter the array passed to `commitImport`.** Keep the original files and associate decisions by original index, not filename. Duplicate filenames are possible, and the original file count controls progress, reporting, and semester behaviour.
5. **Do not add a generic empty-file mapping.** A zero-byte file already produces `EMPTY_FILE` in `parseWorkbook` (`js/pages/settings-imports.js:1976-1980`). A non-empty workbook with no recognized student-code header is silently ignored by the grades parser and later becomes `INVALID_FILE_STRUCTURE`; the parser does not currently expose enough evidence to classify that workbook as empty safely (`js/import-center/grades-import-parser.js:335-382`, `489-495`).
6. **Do not rely on the proposed generic dedup key.** The original diagnostic may contain sheet/row/field data while the synthetic `fileContent` check does not, so those objects do not share a stable structural key. Render one authoritative primary reason instead.
7. **Keep this change grades-only.** `prepareImportContextReview`, the listener, and `commitImport` are shared by all manual imports. Absence replacement remains atomic and other import actions keep their current all-or-nothing review semantics.

## Safety Invariants

- A file with any blocking context comparison must never reach `grades.saveBulk`.
- Destination, cycle-selection, student-roster, and teacher-loading failures remain batch-level stops with zero writes.
- A preflight-rejected file must not be parsed or saved again during commit.
- The original selected-file count remains authoritative for progress, totals, and automatic semester selection.
- Preflight skips and runtime failures are reported separately; both may appear in the same final report.
- No new diagnostic codes, IPC methods, database migrations, or parser policy changes are required.
- Existing post-save validation behaviour is out of scope. A failure after `grades.saveBulk` may represent a partial commit, so the implementation must not introduce new claims that every caught commit error saved nothing (`js/pages/settings-imports.js:3147-3163`).

## Implementation Tasks

### 1. Add behavioural coverage for the real review-to-commit boundary

Create a focused VM test for the grades batch flow instead of relying on the existing page harness stubs. The current harness replaces `showImportContextReview` and `handleImport` and therefore cannot verify this feature (`tests/import-center/settings-imports-page.test.js:83-103`).

The harness must execute the production `prepareImportContextReview`, confirmation branch, listener/handler handoff, and `commitImport` with stubbed read APIs and a counted `grades.saveBulk`.

**Verify:** a mixed two-file batch reaches `saveBulk` exactly once and retains both original file indexes in the review/commit state.

### 2. Load shared grades dependencies once before per-file classification

In `js/pages/settings-imports.js`, add a grades batch precheck used by `prepareImportContextReview`:

- load students once and fail with `STUDENTS_UNAVAILABLE` or `STUDENTS_REQUIRED`;
- load teachers once and fail with `TEACHERS_UNAVAILABLE`;
- pass the loaded students into each grades preflight instead of reloading students and teachers per file;
- remove the redundant per-file `getGradesStudentDependencyCheck` injection for this path.

Keep `getImportDestinationContext` before the per-file loop. Its typed destination/cycle failures remain batch-level errors and must not be converted into file skips.

**Verify:** a batch of twelve files performs one student lookup and one teacher lookup; any shared dependency failure produces zero file attempts and zero writes.

### 3. Add an explicit grades file-decision model

Extend each grades entry returned by `prepareImportContextReview` with:

- `index`: its position in the original selection;
- `executable`: `preflight.valid && preflight.executable && recordEstimate > 0 && comparison.blocking.length === 0`;
- `blockedReason`: one normalized `{ code, message }` selected in this order: file-read error, first preflight error, then first context blocker.

Keep the synthetic `fileContent` check only if existing comparison bookkeeping still needs it, but mark/filter it as presentation-only duplicate. Never use it to ignore other context blockers.

Add grades-only batch fields:

- `executableCount`;
- `blockedFileCount`;
- `canProceedPartially` when both counts are non-zero;
- `canProceed = executableCount > 0` after all batch-level preconditions succeeded;
- `status = 'blocked'` when no grades file is executable, `'review'` for a mixed batch or warnings, otherwise `'ready'`.

For every non-grade action, preserve the current `blocking.length === 0` aggregation.

**Verify:** a valid file plus a semester-, institution-, cycle-, or structure-blocked file yields one executable file; the blocked file never becomes executable merely because its blocker is not `fileContent`.

### 4. Render one authoritative reason per blocked file

Refactor `buildImportContextReviewDetail` and `renderImportContextReview` to share the same per-file presentation rules:

- the region summary contains only batch status and `X صالح من N`, not the complete report;
- a blocked file renders `blockedReason` once;
- do not render the synthetic `fileContent` check in addition to `preflight.errors`;
- do not suppress an explicit context mismatch through a broad code filter; primary-reason selection decides what is shown;
- valid files may still show non-blocking warnings and context evidence;
- the footer says the whole import is blocked only when `executableCount === 0`; a mixed batch says unusable files will be skipped after confirmation.

The review region itself has `tabindex="-1"`; keyboard access comes from the generated `<summary>` controls (`settings-imports.html:397-400`). Preserve that behaviour.

**Verify:** each blocked file shows one blocking reason in both the modal detail and the on-page review; the full report is not duplicated in the summary.

### 5. Return the review decision without discarding the original batch

Change `showImportContextReview` to return a decision object such as `{ confirmed, review }`.

Branch only for grades:

- all executable: keep the normal confirmation;
- mixed: show a warning confirmation for importing the executable files only;
- none executable: show a danger halt with `0 صالح من N` and no commit;
- batch-level exception: keep a global halt/error and no commit.

Update the listener and `handleImport` to pass the original `files` plus the confirmed review to `commitImport`. Update the source assertion in `tests/import-center/manual-import-regression.test.js:50-54`; it currently requires the exact old `await handleImport(action, files)` call.

**Verify:** cancelling the mixed-batch confirmation performs zero writes, while confirming passes the unchanged original file array and its review decisions to commit.

### 6. Skip rejected indexes inside `commitImport` and merge reports

Extend `handleImport`/`commitImport` with an options object containing the confirmed review. In the existing loop:

- locate the review entry by original index, never by filename;
- for a preflight-rejected grades file, do not call `getWorkbookForImport` or `importGrades`;
- increment a dedicated `preflightSkippedFiles` count;
- append a report entry using `blockedReason` with file counters such as `{ parsed: 0, saved: 0, skipped: 1, failed: 0 }`;
- advance progress for the original index and continue;
- keep `failedFiles` for runtime failures and `succeededFiles` for completed executable files.

Use the unchanged original `fileList.length` for `autoSelectSemester`, progress, and final totals. Merge preflight-skip reports with runtime-failure reports in `window.lastFailedImports`, and summarize file outcomes as success / skipped before save / failed during execution.

If every executable file later fails during commit, populate and render the merged report before propagating the batch failure; the current early `!succeededFiles` throw occurs before report publication (`js/pages/settings-imports.js:2639-2653`, `2761-2764`).

**Verify:** duplicate filenames receive independent decisions by index; a mixed batch with one preflight skip and one later runtime failure reports both files accurately.

### 7. Run targeted and full validation

Add or update tests for:

1. valid + zero-byte file (`EMPTY_FILE`);
2. valid + non-empty headerless workbook (`INVALID_FILE_STRUCTURE`);
3. valid + missing grade columns;
4. valid + school-year, institution, high-confidence cycle, and semester blockers;
5. shared destination, cycle-selection, student, and teacher failures;
6. mixed-batch cancellation;
7. duplicate filenames;
8. preflight skip plus runtime failure, including the all-executable-files-failed case;
9. original multi-file selection reduced to one executable file does not enable single-file semester auto-selection;
10. non-blocking `INVALID_GRADE` behaviour remains unchanged;
11. non-grade actions retain current aggregation semantics.

Run:

```text
node tests/import-center/grades-import-behavior.test.js
node tests/import-preflight-policy.test.js
node tests/import-context-preflight.test.js
node tests/import-error-presentation.test.js
node tests/import-center/manual-import-regression.test.js
node tests/import-center/settings-imports-page.test.js
npm run lint
npm test
```

## Done When

- A mixed grades batch can be confirmed and imports every executable file exactly once.
- No blocked file reaches `grades.saveBulk`.
- Every blocked file has one concise reason in review and in the final merged report.
- Original batch totals and multi-file semester semantics are preserved.
- All-invalid and global-failure batches perform zero writes.
- Existing non-grade import behaviour remains unchanged.
- Targeted tests, lint, and the full test suite pass.

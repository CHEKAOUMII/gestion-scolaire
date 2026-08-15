# Harden Excel Grade Import

## Goal

Make `importGrades()` reliably import Massar grade workbooks without skipping students, assigning incorrect metadata, or overwriting distinct assessments. Keep `vendor/xlsx.full.min.js` unchanged; it only reads workbook cells.

## Reference workbook contract

For a file such as `Export_10401E_1BACSEF-1_LANGUE ARABE_28072026153232.xlsx`, the importer must:

- read every worksheet and every populated student row;
- identify `رقم التلميذ` as the Massar code;
- extract `LANGUE ARABE` from the filename and normalize the subject;
- extract `1BACSEF-1`, `2025/2026`, `الدورة الأولى`, the Arabic level, and the teacher name from RTL metadata;
- create separate records for `الفرض الأول`, `الفرض الثاني`, and `الأنشطة المندمجة`;
- ignore student name, birth date, and teacher-notes columns during grade persistence.

## Tasks

- [ ] Add `tests/import-center/grades-import-behavior.test.js` with a two-row Massar header and representative metadata. Verify that the first and last students are imported and that each student produces three distinct grade records.
- [ ] Extract the deterministic workbook-to-grade transformation from `js/pages/settings-imports.js` into a small browser/Node-compatible parser used by `importGrades()`. Verify that tests can execute the real parser without DOM or IPC mocks.
- [ ] Replace the unconditional next-row assumption with explicit secondary-header detection. Verify both one-row and two-row header workbooks without skipping the first data row.
- [ ] Centralize RTL metadata extraction for inline and adjacent values in both directions. Verify subject, section, level, teacher, school year, and semester extraction from the reference workbook layout; block saving when subject or semester remains unresolved.
- [ ] Derive a canonical assessment label from the actual column headers, including single-column files. Verify that separate files for the first and second tests generate different grade keys and cannot overwrite each other.
- [ ] Normalize every Massar code with `normalizeStudentCode()` before lookup and persistence. Reject unknown codes with sheet and row diagnostics, and add a matching existence check in `main/ipc/grades.js` before `main/repos/grades.js` writes the transaction.
- [ ] Validate grades before persistence and return explicit imported, updated, duplicate, and skipped counts. Fix post-import validation to use `teacher_name` and `level`, and let teacher-loading failures surface instead of continuing with an empty teacher list.
- [ ] Preserve the documented per-file transaction boundary. Detect the `grades:saveBulk` size limit before writing and show a blocking, actionable message rather than splitting one file into non-atomic writes.
- [ ] Update `docs/import-center/atomicity-matrix.md` only if the write boundary or IPC contract changes.
- [ ] Run the new grade behavior test, existing `tests/import-center/*.test.js` regressions, and a manual import of the reference workbook; confirm the displayed totals equal persisted rows and no orphan grade records are created.

## Done when

- [ ] A one-row header never loses the first student.
- [ ] The reference two-row workbook imports three correctly labeled grades per student.
- [ ] Subject, level, teacher, section, year, and semester match the workbook metadata.
- [ ] Unknown students, unresolved subjects or semesters, and invalid grades are reported before saving.
- [ ] Re-importing the same assessment updates it, while importing a different assessment preserves both.
- [ ] No project code changes are made inside `vendor/xlsx.full.min.js`.

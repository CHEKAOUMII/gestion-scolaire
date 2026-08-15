# Student Import: Level and School Provenance

## Goal
Extend student Excel import to extract `المستوى` and `المؤسسة` from table columns or sheet metadata, persist both fields, and reject clearly wrong-school workbooks before any student is saved.

## Confirmed behavior
- Read every worksheet and every student row after its detected header; save only supported student fields, not arbitrary Excel columns.
- Resolve `level` in this order: row `المستوى` column → sheet metadata `المستوى:` → normalized value derived from `section`/sheet name.
- Resolve `school_name` in this order: row `المؤسسة` column → sheet metadata `المؤسسة:` → workbook-wide school value.
- Preserve the original school name for display/storage; use a normalized copy only for comparison.
- Compare imported school names with the configured `school_name` returned by `window.api.reports.getIdentity()` (backed by the `school_identity` key/value table). One different school or multiple schools is a blocking error before `students.addBulk()`.
- If the configured school name or workbook school name is missing, allow the import with a warning; never invent a school name. On re-import, blank incoming `level`/`school_name` values preserve existing nonblank database values.
- Keep `UNIQUE(code, school_year)`: this app remains institution-scoped; `school_name` is provenance and a safety guard, not a multi-school tenancy key.

## Tasks

- [ ] **1. Add persistent student fields** — Add nullable `level TEXT` and `school_name TEXT` to the fresh `students` DDL in `main/db/schema.js`, then add migration `2026-07-069-students-level-school-name` using `ensureColumn()` twice in `main/db/migrations.js`. No index is needed because neither field is a lookup key. **Verify:** a fresh database and an upgraded database both expose the two columns while retaining `UNIQUE(code, school_year)`.

- [ ] **2. Extend repository writes safely** — Update `UPDATABLE_FIELDS`, `insertOne()`, and `addBulk()` in `main/repos/students.js` to bind both fields. In the conflict update, use the incoming value only when nonblank; otherwise retain `students.level`/`students.school_name`. Keep required IPC fields unchanged, so old callers remain compatible. **Verify:** insert stores both values, re-import updates nonblank values, and blank re-import values do not erase existing data.

- [ ] **3. Create a testable student parser** — Add `js/import-center/students-import-parser.js` as a DOM/IPC/XLSX-independent parser, following the architecture of `grades-import-parser.js`. It will accept `{ sheets, schoolYear, configuredSchoolName, normalizeLevel }` and return `{ records, diagnostics, schools, levels }`. Load it before `settings-imports.js` in `settings-imports.html`. **Verify:** the module works through `window.StudentImportParser` and Node `require()`.

- [ ] **4. Parse table and metadata layouts** — Recognize level aliases (`المستوى`, `المستوى الدراسي`, `level`, `school level`, `niveau`) and school aliases (`المؤسسة`, `اسم المؤسسة`, `school`, `school name`, `institution`, `établissement`, `etablissement`, `nom établissement`). Scan metadata before the table and support: label in one cell with the next non-empty cell as value, `label: value` in one cell, and repeated table columns. This covers `ListEleve_20251124.xlsx`, where `المؤسسة:` and `المستوى:` appear above row 10. **Verify:** all sheets in that fixture receive their metadata values, while column-based synthetic fixtures also parse correctly.

- [ ] **5. Normalize level and school comparison** — Reuse the current level normalization/section derivation used by imports, including codes such as `TCSF-1` and `1BACSEG-1`. Normalize school names for comparison by removing Arabic diacritics/tatweel, punctuation, repeated whitespace, and case differences without changing the stored display value. **Verify:** formatting-only variants match; genuinely different institution names do not.

- [ ] **6. Add pre-save validation and detailed errors** — In `importStudents()` (`js/pages/settings-imports.js`), load `window.api.reports.getIdentity()`, transform workbook sheets to row arrays, call the parser, and validate all diagnostics before reconciliation or `students.addBulk()`. Use structured diagnostics containing `code`, `severity`, `sheet`, `row`, `field`, `message`, and `action`. Block atomically for missing code columns, no valid students, multiple imported schools, configured/imported school mismatch, or identity lookup failure. Report up to the first eight sheet/row-specific errors. **Verify:** every blocking case saves zero records and the Arabic error names the configured school, detected school, and affected sheet where applicable.

- [ ] **7. Surface nonblocking import information** — Deduplicate by normalized Massar code, keep first occurrence, and issue warnings for duplicates, missing school metadata, missing configured school identity, or levels that cannot be resolved. Convert parser diagnostics from `severity` to the registry’s `{ level, message }` warning shape, pass them with `sections`, `levels`, and `schools` to `DataSourceRegistry.update()`, and update its metadata JSDoc. Include detected school/level counts in the import log or completion summary without exposing raw workbook contents. **Verify:** successful imports show useful summaries and the readiness panel retains and renders warnings.

- [ ] **8. Add regression coverage** — Add `tests/import-center/students-import-behavior.test.js` for metadata extraction, column extraction, all-sheet traversal, level fallback, school-name normalization, missing metadata warnings, multiple-school rejection, school mismatch rejection, missing code errors, duplicate codes, and no partial records. Update `tests/sync-exact-bulk-capture.test.js` so repository inserts/upserts and captured sync rows include `level` and `school_name`; add a migration/schema assertion if needed. **Verify:** targeted tests, `npm run lint`, `npm run test:smoke`, and `npm test` pass.

## Done when
- [ ] The supplied `ListEleve_20251124.xlsx` imports students with `level` and `school_name` populated from each sheet’s metadata.
- [ ] A workbook from another or multiple schools is rejected before database mutation with a clear Arabic explanation.
- [ ] Older files without school/level metadata still import with warnings and cannot erase previously stored values.
- [ ] Database upgrade, sync capture, targeted parser tests, lint, smoke tests, and the full suite pass.

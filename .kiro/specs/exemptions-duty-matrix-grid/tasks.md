# Implementation Plan: Exemptions & Duty Matrix Grid

## Overview

This plan implements the matrix-grid redesign of the "الإعفاءات والمداومة" sub-panel in `exams-proctors.html` as a UI/display change over the existing data model. The approach extracts pure logic (session column building, status resolution, summary counting, store reduction, search/filter/sort, distribution constraint predicates) into testable functions first, then builds the thin DOM rendering layer on top, then wires persistence and reset. Property-based tests (`fast-check`) validate the 24 correctness properties from the design; unit and integration tests cover empty states, UI interactions, and persistence wiring.

The pure logic is implemented in a new module so it can be tested without a browser, then imported into the renderer. Each task builds on the previous, ending with full integration into the existing Save/Reset button model and distribution status refresh.

## Tasks

- [x] 1. Set up the matrix logic module and status constants
  - Create a new module (e.g. `js/exams/ed-matrix-logic.js`) for the pure logic layer
  - Define `STATUS`, `STATUS_CODE` (guard→`ك`, exempt→`معفى`, duty→`م`, reserve→`إح`), and `STATUS_COLOR` (four distinct background tokens) constants
  - Re-export / reference the existing `getProctorExemptionKey` and `getScheduleSessionKey` helpers so the module is the single source of truth for key derivation
  - Ensure the module is loadable both by the test runner and by the `exams-proctors.html` renderer
  - _Requirements: 3.1, 3.2, 6.2_

- [x] 2. Implement session column and date-group construction
  - [x] 2.1 Implement `buildSessionColumns(scheduleEntries)` and `buildDateGroups(sessionColumns)`
    - Collapse schedule entries into distinct (date, period, session) tuples, attach matching subjects, compute `sessionKey`, `exemptKey`, `dateKey`, `dateLabel`, `sortKey`
    - Order columns by date ascending, then period (صباحا before زوالا), then session sequence (الحصة الأولى/الثانية/الثالثة)
    - Group columns under a Date_Group_Header per distinct date, ordered chronologically ascending
    - _Requirements: 1.2, 1.3, 1.4_

  - [x]* 2.2 Write property test for one column per distinct session
    - **Property 2: One column per distinct session**
    - **Validates: Requirements 1.2**

  - [x]* 2.3 Write property test for grouped, chronologically ordered columns
    - **Property 3: Session columns are grouped and chronologically ordered**
    - **Validates: Requirements 1.3, 1.4**

- [x] 3. Implement status resolution from the store
  - [x] 3.1 Implement `resolveCellStatus(store, proctorKey, sessionColumn)`
    - Apply precedence reserve → duty → exempt → guard (default)
    - Look up duty/reserve by `sessionKey|subject` across the session's subjects and the legacy key shape; exempt by `exemptKey`
    - Return guard for any missing entry or any value not in {exempt, duty, reserve}
    - _Requirements: 4.1, 4.3_

  - [x]* 3.2 Write property test for absent/unrecognized entry resolving to guard (display)
    - **Property 9: Absent or unrecognized store entry resolves to guard (display)**
    - **Validates: Requirements 4.1, 4.3**

- [x] 4. Implement proctor row and matrix model construction
  - [x] 4.1 Implement `buildProctorRows(proctorsList, sessionColumns, store)` and `buildMatrixModel(proctors, sessions, store)`
    - Map identity fields (name→`teacher_name`, registration→`som`, institution→`workplace`, specialty→`specialty`); compute `proctorKey` via `getProctorExemptionKey`
    - Set `hasAnyIdentity`; omit rows whose five identity fields are all empty/null
    - Resolve each cell via `resolveCellStatus`; assemble `MatrixModel` with `sessions`, `dateGroups`, `rows`, `totalSessions`
    - Number the ترتيب column as a gapless 1..n sequence in display order
    - _Requirements: 1.1, 2.3, 2.4, 2.5_

  - [x]* 4.2 Write property test for one row per identity-bearing proctor
    - **Property 1: One row per identity-bearing proctor**
    - **Validates: Requirements 1.1, 2.3**

  - [x]* 4.3 Write property test for gapless 1..n order column
    - **Property 5: Order column is a gapless 1..n sequence in display order**
    - **Validates: Requirements 2.4, 2.5**

- [x] 5. Implement summary computation
  - [x] 5.1 Implement `computeRowSummary(cellStatuses)`
    - Count guard, exempt, duty, reserve across a row's cells (including default-guard cells)
    - Guarantee invariant guard + exempt + duty + reserve === totalSessions
    - _Requirements: 8.1, 8.2, 8.3, 8.4, 8.6, 8.7_

  - [x]* 5.2 Write property test for row summaries equal to live cell counts
    - **Property 18: Row summaries equal the live cell counts**
    - **Validates: Requirements 8.1, 8.2, 8.3, 8.4, 8.5, 8.6**

  - [x]* 5.3 Write property test for summary counts conserving to session total
    - **Property 19: Row summary counts conserve to the session total**
    - **Validates: Requirements 8.7**

- [x] 6. Implement store reduction for Save
  - [x] 6.1 Implement `reduceMatrixToStore(matrixModel)`
    - Route exempt → `exemptionsData[exemptKey][proctorKey] = 'no'`, duty → `dutyData[sessionKey|subject][proctorKey] = true`, reserve → `reservesData[sessionKey|subject][proctorKey] = true`
    - Omit every guard cell from all three maps
    - Use `getProctorExemptionKey` for every inner key
    - _Requirements: 6.1, 6.2, 6.3_

  - [x]* 6.2 Write property test for routing each non-guard status to its own map
    - **Property 12: Save routes each non-guard status to its own store map**
    - **Validates: Requirements 6.1**

  - [x]* 6.3 Write property test for keys produced by getProctorExemptionKey
    - **Property 13: Persisted statuses are keyed by getProctorExemptionKey**
    - **Validates: Requirements 6.2**

  - [x]* 6.4 Write property test for guard cells never persisted
    - **Property 14: Guard cells are never persisted**
    - **Validates: Requirements 6.3**

  - [x]* 6.5 Write property test for save-then-reload identity round-trip
    - **Property 15: Save then reload is an identity round-trip**
    - **Validates: Requirements 6.4**

- [x] 7. Checkpoint - Ensure all logic-layer tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 8. Implement search, filter, and sort
  - [x] 8.1 Implement `applySearchFilterSort(rows, { searchText, statusFilter, sort })`
    - Search: trim, case-insensitive, match name (الاسم) OR specialty (مادة التخصص); empty/whitespace imposes no search restriction
    - Status filter: keep rows with ≥1 cell of the selected status; "all"/cleared imposes no status restriction
    - Sort: by identity column, ascending first then toggle asc/desc on repeated activation
    - Preserve every cell's status; renumber ترتيب for the visible subset
    - _Requirements: 9.1, 9.2, 9.3, 9.4, 9.5, 9.7_

  - [x]* 8.2 Write property test for search matching name or specialty
    - **Property 20: Search shows rows matching name or specialty**
    - **Validates: Requirements 9.1, 9.2**

  - [x]* 8.3 Write property test for status filter showing rows with a matching cell
    - **Property 21: Status filter shows rows with a matching cell**
    - **Validates: Requirements 9.3, 9.4**

  - [x]* 8.4 Write property test for sorting order and direction toggle
    - **Property 22: Sorting orders by column and toggles direction**
    - **Validates: Requirements 9.5**

  - [x]* 8.5 Write property test for search/filter/sort preserving cell statuses
    - **Property 23: Search, filter, and sort preserve cell statuses**
    - **Validates: Requirements 9.7**

- [x] 9. Implement the distribution constraint adapter
  - [x] 9.1 Implement `honorsUserChoices(storeBefore, assignmentResult)` and default-guard predicate
    - Verify exempt/duty/reserve statuses are identical before and after a run
    - Verify generated guard assignments target only guard-status proctor/sessions
    - Mirror the existing `isExempt`/`isOnDuty` predicates; absence resolves to guard-eligible
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 4.2, 4.4_

  - [x]* 9.2 Write property test for absent/unrecognized entry resolving to guard (distribution)
    - **Property 10: Absent or unrecognized store entry resolves to guard (distribution)**
    - **Validates: Requirements 4.2, 4.4**

  - [x]* 9.3 Write property test for distribution preserving user-selected statuses
    - **Property 16: Distribution preserves user-selected statuses**
    - **Validates: Requirements 7.1, 7.2, 7.4**

  - [x]* 9.4 Write property test for generated guard duties targeting only guard-status proctors
    - **Property 17: Generated guard duties target only guard-status proctors**
    - **Validates: Requirements 7.3**

- [x] 10. Checkpoint - Ensure all logic and distribution tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 11. Implement the matrix grid rendering layer
  - [x] 11.1 Implement `renderMatrixGrid(matrixModel, viewState)` replacing `renderEdTable`
    - Build the matrix DOM: identity columns, date-group + session headers, status cells, summary columns
    - Render each Status_Cell with its Status_Code and unique background color per status; render an explicit "unrecognized" marker for non-enum in-memory values
    - Render an identical placeholder marker for any empty/null identity field
    - Apply RTL layout with identity columns at the right edge and session columns ordered right-to-left
    - Apply sticky CSS so identity columns stay frozen on horizontal scroll and date/session headers stay frozen on vertical scroll
    - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.4, 10.1, 10.2, 10.3, 10.4_

  - [x]* 11.2 Write property test for status code one-to-one mapping
    - **Property 6: Status code is a one-to-one mapping**
    - **Validates: Requirements 3.1**

  - [x]* 11.3 Write property test for pairwise-distinct status background colors
    - **Property 7: Status background colors are pairwise distinct**
    - **Validates: Requirements 3.2**

  - [x]* 11.4 Write property test for identical placeholder on missing identity fields
    - **Property 4: Missing identity fields render an identical placeholder**
    - **Validates: Requirements 2.2**

  - [x]* 11.5 Write unit tests for empty-state messages, identity order, and unrecognized marker
    - Test "add proctors first" (no rows), "no sessions available" (proctors exist, no sessions), and precedence when both empty
    - Test identity column order (ترتيب, الاسم, رقم التأجير, المؤسسة, مادة التخصص) and the unrecognized-status display marker
    - _Requirements: 1.5, 1.6, 1.7, 2.1, 3.4_

- [x] 12. Implement inline cell editing
  - [x] 12.1 Implement `openCellEditor(rowKey, sessionKey)` and `onCellStatusSelected(rowKey, sessionKey, newStatus)`
    - Present the four status options for the activated cell only; dismiss-without-select leaves the cell unchanged
    - Set the cell to the selected status; selecting the current status leaves it unchanged
    - Recompute the row's summary columns and re-render the cell, fully replacing code and color
    - On recompute failure, revert the cell, retain prior summaries, and surface an error indication; no persistence occurs
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 3.3, 8.5_

  - [ ]* 12.2 Write property test for selecting a status setting the cell
    - **Property 11: Selecting a status sets the cell to that status**
    - **Validates: Requirements 5.2, 5.5**

  - [ ]* 12.3 Write property test for a status change fully replacing code and color
    - **Property 8: A status change fully replaces code and color**
    - **Validates: Requirements 3.3**

  - [ ]* 12.4 Write unit tests for inline editor interactions
    - Test opening the editor presents four options (5.1), dismiss-without-select (5.6), and summary-recompute-failure revert (5.4)
    - _Requirements: 5.1, 5.4, 5.6_

- [x] 13. Wire persistence (Save) into the existing config API
  - [x] 13.1 Implement `initExemptionsDutyMatrix()` and `saveMatrix()`
    - Load store + proctors + schedule, build the matrix model, and render the grid on panel open
    - On Save: `reduceMatrixToStore` on a cloned store, persist `examExemptionsData`/`examDutyTeachersData`/`examReservesData` through `window.api.examConfig`
    - On success: refresh the distribution status view and show a success indication
    - On failure: restore the pre-save store snapshot, skip the refresh, and show an error indication
    - _Requirements: 6.1, 6.5, 6.6, 8.6_

  - [ ]* 13.2 Write integration tests for Save persistence wiring
    - Mock `window.api.examConfig`: success refreshes distribution view + shows success; failure retains store, skips refresh, shows error
    - _Requirements: 6.5, 6.6_

- [x] 14. Implement reset scope
  - [x] 14.1 Implement `resetMatrix(scope)`
    - Present a confirmation prompt; make no store change until explicit confirmation; cancel leaves store and cells unchanged
    - On confirm: clear exempt/duty/reserve entries in scope on a clone, persist through `window.api.examConfig`, and on success render every in-scope cell as guard (`ك`)
    - On persistence failure: retain the prior store and all cell statuses, show an error indication
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 14.2 Write property test for reset clearing the scope to guard
    - **Property 24: Reset clears the scope to guard**
    - **Validates: Requirements 11.1, 11.2**

  - [ ]* 14.3 Write integration/unit tests for reset confirmation and failure
    - Test confirmation prompt and cancel leaving store unchanged (11.3, 11.4); persistence failure retains store (11.5)
    - _Requirements: 11.3, 11.4, 11.5_

- [x] 15. Wire search/filter/sort controls and integrate into the panel
  - [x] 15.1 Connect the search, status-filter, and sortable-header controls to `applySearchFilterSort` and re-render
    - Re-render the visible, renumbered subset on each change while preserving cell statuses
    - Display a "no proctors match" message when the active search and filter yield no rows
    - Replace the legacy single-session controls and ensure the panel uses `initExemptionsDutyMatrix` end-to-end
    - _Requirements: 9.6, 9.7, 10.4_

  - [ ]* 15.2 Write unit test for the no-match message
    - Test that no rows satisfying search + filter shows the no-match message
    - _Requirements: 9.6_

- [x] 16. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass and `npm run lint` is clean, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Property tests use `fast-check` with the existing `npm test` runner, a minimum of 100 generated cases each, and are tagged with `// Feature: exemptions-duty-matrix-grid, Property {number}: {property_text}`.
- Distribution property tests (16, 17) run `proctor-v3.bundle.js` with mocked room/quota needs.
- Sticky-layout, RTL, and within-1-second timing requirements (10.1–10.4, 8.5, 10.2) are verified by asserting sticky/RTL CSS classes and manual visual inspection, not by properties.
- Each task references specific requirement sub-clauses for traceability; the implementation preserves the existing store shape and `getProctorExemptionKey` with no data migration.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "3.1", "5.1", "6.1", "8.1", "9.1"] },
    { "id": 2, "tasks": ["2.2", "2.3", "3.2", "5.2", "5.3", "6.2", "6.3", "6.4", "6.5", "8.2", "8.3", "8.4", "8.5", "9.2", "9.3", "9.4"] },
    { "id": 3, "tasks": ["4.1"] },
    { "id": 4, "tasks": ["4.2", "4.3", "11.1"] },
    { "id": 5, "tasks": ["11.2", "11.3", "11.4", "11.5", "12.1"] },
    { "id": 6, "tasks": ["12.2", "12.3", "12.4", "13.1", "14.1"] },
    { "id": 7, "tasks": ["13.2", "14.2", "14.3", "15.1"] },
    { "id": 8, "tasks": ["15.2"] }
  ]
}
```

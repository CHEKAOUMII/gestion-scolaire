# Requirements Document

## Introduction

This feature redesigns the "الإعفاءات والمداومة" (Exemptions & Duty) sub-panel inside `exams-proctors.html`. The current design forces the user to pick a single session (day + period + session) and then edit a flat list of proctors, one status dropdown per proctor, for that one session only.

The redesign replaces this with a **matrix grid** (Option B, hybrid): one row per proctor (teacher) and one column per exam session, where each session is the combination of (date + period + session/الحصة). Session columns are grouped under their date. Each cell shows the proctor's status for that session as a short, color-coded code, and is editable inline by clicking. Identity columns (order, name, registration number, institution, specialty) and summary/total columns stay visible while the user scrolls the wide grid horizontally.

The redesign is a **UI/display change over the same underlying data**. It preserves the existing data model and storage (`examExemptionsData`, `examDutyTeachersData`, `examReservesData` persisted through `window.api.examConfig`) and the existing proctor key derivation (`getProctorExemptionKey`). It additionally makes explicit two behavioral guarantees that the distribution algorithm must honor: user choices are hard constraints the algorithm must not override, and the default status for any unselected proctor/session is حراسة (guard).

## Glossary

- **Matrix_Grid**: The redesigned table that renders one row per proctor and one column per exam session, replacing the previous single-session flat list.
- **Proctor_Row**: A single row in the Matrix_Grid representing one proctor (teacher), including identity columns and one status cell per session.
- **Session_Column**: A column in the Matrix_Grid representing one exam session, identified by the tuple (date, period, session). Period is one of صباحا (morning) or زوالا (afternoon). Session (الحصة) is one of الحصة الأولى/الثانية/الثالثة as defined by the schedule.
- **Date_Group_Header**: A header row/cell that spans all Session_Columns belonging to the same exam date.
- **Status_Cell**: The editable cell at the intersection of a Proctor_Row and a Session_Column, holding exactly one Proctor_Status.
- **Proctor_Status**: One of four values for a proctor in a session: `guard` (حراسة), `exempt` (معفى), `duty` (مداومة), `reserve` (احتياط).
- **Status_Code**: The short visible label rendered inside a Status_Cell: `ك` for guard (حراسة), `م` for duty (مداومة), `إح` for reserve (احتياط), and `معفى` for exempt.
- **Identity_Columns**: The leading columns of each Proctor_Row: ترتيب (order index), الاسم (name), رقم التأجير (registration/SOM number), المؤسسة (institution), and مادة التخصص (specialty).
- **Summary_Columns**: The trailing columns that show per-proctor totals derived from the proctor's Status_Cells (for example total guard sessions, total duty sessions, total reserve sessions, total exempt sessions).
- **Distribution_Algorithm**: The existing automatic proctor-assignment process that reads the saved exemptions/duty/reserve data when distributing guard assignments.
- **Exemptions_Duty_Store**: The persisted data consisting of `examExemptionsData`, `examDutyTeachersData`, and `examReservesData`, saved and loaded through `window.api.examConfig`.
- **Proctor_Key**: The stable identifier for a proctor produced by the existing `getProctorExemptionKey` function (`cin` or `som` or `idx_<index>`).

## Requirements

### Requirement 1: Matrix grid layout

**User Story:** As an exam coordinator, I want a matrix of proctors against sessions, so that I can see and edit every proctor's status across all sessions on one screen instead of one session at a time.

#### Acceptance Criteria

1. WHEN the Exemptions & Duty sub-panel is opened, THE Matrix_Grid SHALL render one Proctor_Row for each proctor in the proctors list.
2. WHEN the Exemptions & Duty sub-panel is opened, THE Matrix_Grid SHALL render one Session_Column for each exam session defined in the schedule.
3. WHEN the Exemptions & Duty sub-panel is opened, THE Matrix_Grid SHALL render Session_Columns grouped under a Date_Group_Header for each distinct exam date, with Date_Group_Headers ordered chronologically ascending (earliest date first).
4. WHERE Session_Columns belong to the same exam date, THE Matrix_Grid SHALL order them by period (صباحا before زوالا) and then by session sequence (الحصة الأولى, الثانية, الثالثة).
5. IF the proctors list is empty, THEN THE Matrix_Grid SHALL display a message instructing the user to add proctors first AND SHALL render no Proctor_Row.
6. IF no exam sessions are defined in the schedule AND the proctors list is not empty, THEN THE Matrix_Grid SHALL display a message indicating that no sessions are available to edit AND SHALL render no Session_Column.
7. IF both the proctors list is empty AND no exam sessions are defined, THEN THE Matrix_Grid SHALL display only the "add proctors first" message and SHALL NOT display the "no sessions available" message.

### Requirement 2: Identity columns

**User Story:** As an exam coordinator, I want each proctor row to show identifying details, so that I can recognize the teacher while assigning statuses.

#### Acceptance Criteria

1. THE Matrix_Grid SHALL display in each Proctor_Row the Identity_Columns in this left-to-right-equivalent RTL order: ترتيب, الاسم, رقم التأجير, المؤسسة, and مادة التخصص.
2. WHERE a proctor has no value (empty or null) for an individual Identity_Column field, THE Matrix_Grid SHALL display in that column a single visible placeholder marker that is identical across all missing Identity_Column fields and indicates the value is unavailable.
3. IF a proctor record has no value (empty or null) for every one of the five Identity_Column fields, THEN THE Matrix_Grid SHALL omit that Proctor_Row from the grid.
4. THE Matrix_Grid SHALL number the ترتيب column with sequential integers starting at 1 and incrementing by 1 with no gaps, matching the top-to-bottom display order of the visible Proctor_Rows.
5. WHEN the display order of the visible Proctor_Rows changes, THE Matrix_Grid SHALL renumber the ترتيب column so that the visible Proctor_Rows are numbered sequentially starting at 1 with no gaps in the new order.

### Requirement 3: Status cell display

**User Story:** As an exam coordinator, I want each cell to show a clear color-coded status, so that I can read the whole assignment grid at a glance.

#### Acceptance Criteria

1. THE Status_Cell SHALL display exactly one Status_Code that corresponds to the cell's current Proctor_Status, using the one-to-one mapping `ك` for guard (حراسة), `معفى` for exempt (معفى), `م` for duty (مداومة), and `إح` for reserve (احتياط).
2. THE Status_Cell SHALL apply a background color that is unique to its current Proctor_Status, such that each of the four Proctor_Status values (guard, exempt, duty, reserve) maps to its own background color and no two of the four values share the same background color.
3. WHEN a Status_Cell's Proctor_Status changes to another of the four defined values, THE Status_Cell SHALL update both its Status_Code and its background color to match the new value in the same render, leaving no Status_Code or background color belonging to the previous Proctor_Status visible.
4. IF a Status_Cell's current Proctor_Status is not one of the four defined values (guard, exempt, duty, reserve), THEN THE Status_Cell SHALL display an indication that the status is unrecognized and SHALL NOT display any of the four Status_Codes.

### Requirement 4: Default guard status

**User Story:** As an exam coordinator, I want guard to be the default for everyone, so that proctors are available for guarding unless I explicitly exempt or reassign them.

#### Acceptance Criteria

1. WHEN the Matrix_Grid renders a Status_Cell AND the proctor has no entry keyed by that proctor's Proctor_Key for that session in the Exemptions_Duty_Store, THE Matrix_Grid SHALL display that Status_Cell as guard (حراسة) with Status_Code `ك`.
2. WHERE a proctor has no entry keyed by that proctor's Proctor_Key for a session in the Exemptions_Duty_Store, THE Distribution_Algorithm SHALL treat that proctor's status for that session as guard (حراسة).
3. IF the Exemptions_Duty_Store contains, for a proctor's session, a status value that is not one of exempt (معفى), duty (مداومة), or reserve (احتياط), THEN THE Matrix_Grid SHALL display that Status_Cell as guard (حراسة) with Status_Code `ك`.
4. IF the Exemptions_Duty_Store contains, for a proctor's session, a status value that is not one of exempt (معفى), duty (مداومة), or reserve (احتياط), THEN THE Distribution_Algorithm SHALL treat that proctor's status for that session as guard (حراسة).

### Requirement 5: Inline cell editing

**User Story:** As an exam coordinator, I want to change a status by interacting with its cell directly, so that editing stays fast across a wide grid.

#### Acceptance Criteria

1. WHEN the user activates a Status_Cell, THE Matrix_Grid SHALL present, for that Status_Cell only, the four Proctor_Status options (guard, exempt, duty, reserve) for selection.
2. WHEN the user selects a Proctor_Status for a Status_Cell, THE Matrix_Grid SHALL set that Status_Cell to the selected value.
3. WHEN a Status_Cell value changes, THE Matrix_Grid SHALL recompute the affected Proctor_Row's Summary_Columns.
4. IF recomputation of a Proctor_Row's Summary_Columns fails, THEN THE Matrix_Grid SHALL revert that Status_Cell to its previous Proctor_Status, retain the previous values of that Proctor_Row's Summary_Columns, and display an indication to the user that the change was not applied.
5. WHEN the user selects the same Proctor_Status that a Status_Cell already holds, THE Matrix_Grid SHALL leave that Status_Cell unchanged.
6. WHEN the user dismisses the presented Proctor_Status options without selecting a value, THE Matrix_Grid SHALL leave that Status_Cell unchanged.

### Requirement 6: Persistence with existing data model

**User Story:** As an exam coordinator, I want my edits saved into the existing storage, so that the rest of the application keeps working without data migration.

#### Acceptance Criteria

1. WHEN the user saves the Matrix_Grid, THE System SHALL persist exempt selections into `examExemptionsData`, duty selections into `examDutyTeachersData`, and reserve selections into `examReservesData` through `window.api.examConfig`.
2. THE System SHALL key every persisted Proctor_Status by the Proctor_Key produced by `getProctorExemptionKey`.
3. WHEN the user saves the Matrix_Grid, THE System SHALL omit every guard Status_Cell from the Exemptions_Duty_Store, since guard is the default.
4. WHEN the Matrix_Grid is reloaded after a save, THE Matrix_Grid SHALL display each Status_Cell with the exact Proctor_Status that was saved, without converting between status values (round-trip consistency).
5. WHEN persistence through `window.api.examConfig` completes successfully, THE System SHALL refresh the distribution status view and display an indication that the save succeeded.
6. IF persistence through `window.api.examConfig` fails, THEN THE System SHALL leave the previously saved Exemptions_Duty_Store unchanged, SHALL NOT refresh the distribution status view, and SHALL display an error indication that the save did not complete.

### Requirement 7: Distribution algorithm respects user choices

**User Story:** As an exam coordinator, I want the automatic distribution to honor my manual choices, so that exemptions and duty assignments are never overridden.

#### Acceptance Criteria

1. WHERE a proctor has a user-selected Proctor_Status of exempt, duty, or reserve recorded in the Exemptions_Duty_Store for a session, WHEN the Distribution_Algorithm runs, THE Distribution_Algorithm SHALL preserve that exact Proctor_Status for that proctor and session without modification.
2. IF the Distribution_Algorithm would otherwise assign a guard duty to a proctor whose user-selected Proctor_Status in the Exemptions_Duty_Store is exempt, duty, or reserve for that session, THEN THE Distribution_Algorithm SHALL skip that assignment and leave that proctor's Proctor_Status for that session unchanged.
3. WHEN the Distribution_Algorithm runs, THE Distribution_Algorithm SHALL assign generated guard duties only to proctors whose Proctor_Status for the session is guard.
4. WHEN the Distribution_Algorithm completes, THE Distribution_Algorithm SHALL leave every user-selected exempt, duty, and reserve Proctor_Status identical to its value recorded in the Exemptions_Duty_Store before the run.

### Requirement 8: Summary columns

**User Story:** As an exam coordinator, I want per-proctor totals beside each row, so that I can verify the workload balance without counting cells manually.

#### Acceptance Criteria

1. THE Matrix_Grid SHALL display, per Proctor_Row, a Summary_Column whose value is an integer from 0 to the total number of Session_Columns equal to the count of that row's Status_Cells whose current Proctor_Status is guard, including Status_Cells displayed as guard by default per Requirement 4.
2. THE Matrix_Grid SHALL display, per Proctor_Row, a Summary_Column whose value is an integer from 0 to the total number of Session_Columns equal to the count of that row's Status_Cells whose current Proctor_Status is duty.
3. THE Matrix_Grid SHALL display, per Proctor_Row, a Summary_Column whose value is an integer from 0 to the total number of Session_Columns equal to the count of that row's Status_Cells whose current Proctor_Status is reserve.
4. THE Matrix_Grid SHALL display, per Proctor_Row, a Summary_Column whose value is an integer from 0 to the total number of Session_Columns equal to the count of that row's Status_Cells whose current Proctor_Status is exempt.
5. WHEN any Status_Cell in a Proctor_Row changes its Proctor_Status, THE Matrix_Grid SHALL, within 1 second, recompute and display that row's guard, duty, reserve, and exempt Summary_Columns so that each count equals the number of that row's Status_Cells currently holding the corresponding Proctor_Status.
6. WHEN the Exemptions & Duty sub-panel is opened, THE Matrix_Grid SHALL compute and display each Proctor_Row's guard, duty, reserve, and exempt Summary_Columns from that row's current Status_Cells.
7. THE Matrix_Grid SHALL ensure that, for each Proctor_Row, the sum of the guard, duty, reserve, and exempt Summary_Column counts equals the total number of Session_Columns.

### Requirement 9: Search, filter, and sort

**User Story:** As an exam coordinator, I want to keep searching, filtering, and sorting proctors, so that I do not lose the controls I rely on in the current design.

#### Acceptance Criteria

1. WHEN the user enters text in the search control, THE Matrix_Grid SHALL display only Proctor_Rows whose Identity_Columns name (الاسم) or specialty (مادة التخصص) contains the entered text after trimming leading and trailing whitespace, matched case-insensitively, and hide all non-matching Proctor_Rows.
2. WHEN the user clears the search control or the trimmed search text is empty, THE Matrix_Grid SHALL display all Proctor_Rows that satisfy the active status filter.
3. WHEN the user selects a specific status filter, THE Matrix_Grid SHALL display only Proctor_Rows that have at least one Status_Cell whose Proctor_Status matches the selected status, and hide all other Proctor_Rows.
4. WHEN the user clears the status filter or selects an option representing all statuses, THE Matrix_Grid SHALL display all Proctor_Rows that satisfy the active search text.
5. WHEN the user activates a sortable Identity_Column header, THE Matrix_Grid SHALL sort the displayed Proctor_Rows by that column in ascending order on the first activation and toggle between ascending and descending order on each subsequent activation of the same header.
6. IF no Proctor_Rows satisfy the active search text and status filter, THEN THE Matrix_Grid SHALL display a message indicating that no proctors match the current search and filter.
7. WHEN the search, filter, or sort changes, THE Matrix_Grid SHALL preserve the current Proctor_Status of every Status_Cell.

### Requirement 10: Wide-grid navigation and responsiveness

**User Story:** As an exam coordinator, I want identity and headers to stay visible while I scroll a wide grid, so that I never lose track of which proctor and which session a cell belongs to.

#### Acceptance Criteria

1. WHILE the user scrolls the Matrix_Grid horizontally, THE Matrix_Grid SHALL keep all Identity_Columns fixed at the leading edge of the grid with their full width remaining within the visible viewport and unobscured by any Session_Column.
2. WHERE a UI interaction such as resizing temporarily obscures the Identity_Columns, THE Matrix_Grid SHALL restore their full visibility within 1 second after the interaction completes.
3. WHILE the user scrolls the Matrix_Grid vertically, THE Matrix_Grid SHALL keep the Date_Group_Header and Session_Column headers fixed at the top edge of the grid with their full height remaining within the visible viewport.
4. THE Matrix_Grid SHALL render in a right-to-left layout in which the Identity_Columns are positioned at the right edge and Session_Columns are ordered from right to left.

### Requirement 11: Reset scope

**User Story:** As an exam coordinator, I want to reset statuses, so that I can clear mistaken assignments without editing each cell.

#### Acceptance Criteria

1. WHEN the user confirms a reset, THE System SHALL remove all exempt, duty, and reserve selections currently recorded in the Exemptions_Duty_Store for the reset scope and persist the change through `window.api.examConfig`.
2. WHEN a reset is persisted successfully, THE Matrix_Grid SHALL display every Status_Cell within the reset scope as guard (حراسة) with Status_Code `ك`.
3. IF the user cancels the reset confirmation, THEN THE System SHALL leave the Exemptions_Duty_Store unchanged and leave every Status_Cell at its current Proctor_Status.
4. WHEN the user initiates a reset, THE System SHALL present a confirmation prompt and SHALL make no change to the Exemptions_Duty_Store until the user explicitly confirms.
5. IF persisting the reset through `window.api.examConfig` fails, THEN THE System SHALL leave the Exemptions_Duty_Store unchanged, retain the prior Proctor_Status of every affected Status_Cell, and display an error indication that the reset did not complete.

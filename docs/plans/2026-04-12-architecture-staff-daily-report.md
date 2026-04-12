# Plan: Refactoring Daily Report Architecture
Date: 2026-04-12
Title: Modularization of staff-daily-report.html

## Objective
Extract the monolithic inline JavaScript block (~1100 lines) from `staff-daily-report.html` into a dedicated modular file `js/pages/staff-daily-report.js`. This structural refactoring improves codebase maintainability and aligns the Daily Report page with the established architecture principles used for other page modules (like `timetable.js` and `students-status.js`).

## Proposed Architecture

### 1. New Module: `js/pages/staff-daily-report.js`
Create this file and migrate all logic from `staff-daily-report.html`. The logic will be structured within an IIFE (`(function () { 'use strict'; ... })();`) and broken into specialized sections:

*   **Constants & State Variables:** Setup internal caches (`_timetableCache`, `_teachersCache`, `_allSectionsCache`) and operational flags (`_saveTagNoteInFlight`, `_mentionActiveIndex`).
*   **DOM References:** Centralized element selectors (e.g., `report-date`, `load-btn`, `stat-cards`, `tags-table`).
*   **Initialization & Events:** `DOMContentLoaded` setup, initial date value setup, and unified event binding.
*   **Data Loading & Processing:** Logical functions for data retrieval:
    *   `loadReport()` core function.
    *   `getTimetableData()`, `getSectionsForDay()`, `getScheduleForDay()`.
    *   Parsing teachers absences, tardiness, and processing compensatory hours calculations.
*   **UI Rendering Elements:**
    *   `formatCompactList()`, `formatSubject()`, HTML table population logic, and stat cards updates based on the processed absences.
*   **System Tags (& Mentions):**
    *   Display tag elements with `renderTagsTable()`.
    *   Note Forms interactions (`showTagNoteForm`, `saveTagNote`, `deleteTagNote`, `editTagNote`).
    *   `@mention` autocomplete, index tracking, highlighting, and keydown listeners.

### 2. View Refactoring: `staff-daily-report.html`
*   Remove the entire `<script>` tag block starting at approximately line 292.
*   Add the new module reference `<script src="js/pages/staff-daily-report.js" defer></script>` in the document head alongside the other global scripts (`js/utils.js`, `js/data/system-tag-types.js`, etc.).

## Advantages of this Refactoring
- **Separation of Concerns:** Clear divider between presentation (HTML/CSS) and application logic (JS).
- **Encapsulation:** Global namespace pollution is avoided by wrapping everything inside an IIFE.
- **Maintainability:** Makes unit testing or isolating data fetching code easier in the future without navigating large HTML dumps.
- **Performance:** Browsers can cache external scripts effectively if they don't change, which is not possible with inline HTML scripts.

## Verification
- Test Daily Report loading logic.
- Ensure Tag interactions (Add, Remove, Annotate variables) continue functioning.
- Test print layouts with dummy tags.

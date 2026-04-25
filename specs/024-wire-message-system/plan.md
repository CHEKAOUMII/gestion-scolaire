# Implementation Plan: Wire Message System Across All Pages

**Branch**: `024-wire-message-system` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/024-wire-message-system/spec.md`

## Summary

Add `message-system.js` as a deferred script tag to 44 HTML pages so that `showConfirm()`, `setFieldValidation()`, and `clearValidation()` are globally available everywhere. Simultaneously, remove the single dead-code alias (`timetableShowToast`) from `timetable.js` — **not** the local `showToast` function itself, which is intentionally kept for the timetable's dedicated `#toast` DOM element.

## Technical Context

**Language/Version**: Vanilla JavaScript (ES6+), HTML5
**Primary Dependencies**: Existing `js/notifications.js`, `js/utils.js`, `js/ux-enhancements.js` — no new dependencies
**Storage**: N/A
**Testing**: `npm run test:smoke` (CI gate) + manual DevTools console verification
**Target Platform**: Electron renderer process (Chromium), Windows
**Project Type**: Desktop app (multi-page HTML, no bundler)
**Performance Goals**: No measurable impact — `defer` attribute ensures zero render-blocking
**Constraints**: Must not break IPC parity smoke test; no CDN references; `defer` on all script tags
**Scale/Scope**: 44 HTML files edited, 1 line removed from `timetable.js`

## Constitution Check

| Principle | Gate | Status |
|-----------|------|--------|
| I — No dead code | `timetableShowToast` alias (line 1842) must be removed | ✅ Addressed |
| I — Single responsibility | `message-system.js` already authored; this phase only wires it | ✅ Pass |
| II — CI gate | `npm run test:smoke` must pass; no IPC changes, so parity check unaffected | ✅ Pass |
| II — No CDN references | Script tag uses local path `js/message-system.js` | ✅ Pass |
| II — Manual RTL visual check | Required after timetable.js change — toast must still render in Arabic | ✅ Required |
| III — Consistent interaction | Wiring `showConfirm` globally enforces the shared utility pattern | ✅ Pass |
| IV — No bundler reliance | Pure HTML edits, no build tool changes | ✅ Pass |
| IV — Three-file rule | No IPC changes; rule does not apply | ✅ N/A |
| V — CSS build | No CSS changes in Phase 4; rebuild not required | ✅ N/A |

**No violations. Gates pass.**

## Project Structure

### Documentation (this feature)

```text
specs/024-wire-message-system/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← not applicable (no data entities)
└── tasks.md             ← Phase 2 output (/speckit.tasks — not created by /speckit.plan)
```

### Source Code (affected files)

```text
js/pages/
└── timetable.js         ← remove line 1842 (timetableShowToast alias only)

*.html (44 files)        ← add <script src="js/message-system.js" defer> after notifications.js
    index.html
    login.html           ← insert after ux-enhancements.js (has no notifications.js)
    setup.html
    students-list.html
    students-register.html
    students-files.html
    students-movement.html
    students-status.html
    teachers-list.html
    teachers-schedule.html
    teachers-absence.html
    teachers-performance.html
    staff-attendance.html
    staff-daily-report.html
    timetable.html
    timetable-redistribution.html
    timetable-students.html
    timetable-rooms.html
    timetable-teachers.html
    results-hub.html
    analytics.html
    grades-sheets.html
    grades-results.html
    student-support.html
    support-sessions.html
    absence-weekly.html
    absence-students.html
    absence-correspondence.html
    absence-analytics.html
    exams-schedule.html
    exams-proctors.html
    exams-rooms.html
    exams-tests.html
    reports-certificates.html
    reports-forms.html
    reports-semester.html
    settings-imports.html
    settings-school.html
    settings-users.html
    settings-license.html
    settings-logs.html
    settings-sync.html
    compensation-tracking.html
    student-profile-prototype.html

EXCLUDED (do not touch):
    timetable_body.html           ← partial iframe fragment, no <script> block
    communication-center-prototype.html  ← prototype, no shared script infra
```

**Structure Decision**: Single project layout. Changes are flat HTML file edits at the repo root and a one-line JS removal. No new files, no new directories.

## Key Research Findings

See [research.md](research.md) for full rationale. Critical points:

1. **Timetable local `showToast` is intentional** — the comment at line 1881 of `timetable.js` explicitly says to keep it. It targets a page-specific `#toast` DOM element used by `updateToastOffsets()`. Only the unused `timetableShowToast` alias at line 1842 is dead code.
2. **44 pages in scope** (not 40+ as estimated in the spec) — 2 files excluded: `timetable_body.html` (no script block) and `communication-center-prototype.html` (prototype with no shared infra).
3. **Insertion point is always after `notifications.js`** — all 43 main pages follow the same `utils.js → notifications.js → [here] → ux-enhancements.js` order. `login.html` (the exception) gets the tag after `ux-enhancements.js`.
4. **No CSS rebuild, no IPC changes** — this phase is pure HTML and one JS line.

# Tasks: Wire Message System Across All Pages (024)

**Input**: Design documents from `/specs/024-wire-message-system/`
**Branch**: `024-wire-message-system`
**Prerequisites**: plan.md ✅ | spec.md ✅ | research.md ✅

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to
- No tests requested — test tasks omitted

## Critical Context for Implementor

Before starting, read these findings from `research.md`:

1. **DO NOT delete `showToast` from `timetable.js`** — the local function is intentional (targets `#toast` DOM element, used by `updateToastOffsets()`). Only remove **line 1842**: `const timetableShowToast = showToast;`
2. **Insertion rule for 43 pages**: insert `<script src="js/message-system.js" defer></script>` immediately after `<script src="js/notifications.js" defer></script>`
3. **Exception — `login.html`**: has no `notifications.js`; insert after `<script src="js/ux-enhancements.js" defer></script>`
4. **Do NOT touch**: `timetable_body.html` (no script block) and `communication-center-prototype.html` (prototype)
5. **No CSS rebuild, no IPC changes** needed

---

## Phase 1: Setup — Foundational Dead-Code Removal

**Purpose**: Remove the one dead-code line in `timetable.js` before touching any HTML files. This is prerequisite to US1 verification.

**⚠️ CRITICAL NOTE**: Do NOT remove the `showToast` function itself. Only remove the alias on line 1842.

- [X] T001 [US1] Remove dead-code alias `const timetableShowToast = showToast;` (line 1842 only) from `js/pages/timetable.js`

**What to do**: Open `js/pages/timetable.js`, find line 1842 which reads exactly `const timetableShowToast = showToast;`, and delete that single line. Verify the function definition `function showToast(message, type = 'info')` at line 1811 remains untouched. Verify `updateToastOffsets` and all `showToast(...)` call sites in the file are unchanged.

**Verification**: Run `grep -n "timetableShowToast" js/pages/timetable.js` — must return no results. Run `grep -n "function showToast" js/pages/timetable.js` — must still return line 1811.

**Checkpoint US1**: Timetable dead-code is gone. US1 is complete after manual visual check (Phase 5).

---

## Phase 2: User Story 2 — Wire Script on All 44 HTML Pages (Priority: P1)

**Goal**: Add `<script src="js/message-system.js" defer></script>` to every production HTML page so `showConfirm`, `setFieldValidation`, and `clearValidation` become globally available.

**Independent Test**: Open DevTools console on any page → type `typeof showConfirm` → must return `"function"`.

**Insertion rule**: After `<script src="js/notifications.js" defer></script>` (43 pages), or after `<script src="js/ux-enhancements.js" defer></script>` for `login.html` only.

**Exact string to insert**: `        <script src="js/message-system.js" defer></script>`
(use the same indentation — 8 spaces — as the surrounding script tags on each page)

### Group A — Core / Auth / Setup (5 pages)

- [X] T002 [P] [US2] Add message-system.js script tag after notifications.js in `index.html`
- [X] T003 [P] [US2] Add message-system.js script tag after ux-enhancements.js in `login.html` ← EXCEPTION: no notifications.js on this page
- [X] T004 [P] [US2] Add message-system.js script tag after notifications.js in `setup.html`

### Group B — Students (5 pages)

- [X] T005 [P] [US2] Add message-system.js script tag after notifications.js in `students-list.html`
- [X] T006 [P] [US2] Add message-system.js script tag after notifications.js in `students-register.html`
- [X] T007 [P] [US2] Add message-system.js script tag after notifications.js in `students-files.html`
- [X] T008 [P] [US2] Add message-system.js script tag after notifications.js in `students-movement.html`
- [X] T009 [P] [US2] Add message-system.js script tag after notifications.js in `students-status.html`

### Group C — Teachers (4 pages)

- [X] T010 [P] [US2] Add message-system.js script tag after notifications.js in `teachers-list.html`
- [X] T011 [P] [US2] Add message-system.js script tag after notifications.js in `teachers-schedule.html`
- [X] T012 [P] [US2] Add message-system.js script tag after notifications.js in `teachers-absence.html`
- [X] T013 [P] [US2] Add message-system.js script tag after notifications.js in `teachers-performance.html`

### Group D — Staff (2 pages)

- [X] T014 [P] [US2] Add message-system.js script tag after notifications.js in `staff-attendance.html`
- [X] T015 [P] [US2] Add message-system.js script tag after notifications.js in `staff-daily-report.html`

### Group E — Timetable (5 pages)

- [X] T016 [P] [US2] Add message-system.js script tag after notifications.js in `timetable.html`
- [X] T017 [P] [US2] Add message-system.js script tag after notifications.js in `timetable-redistribution.html`
- [X] T018 [P] [US2] Add message-system.js script tag after notifications.js in `timetable-students.html`
- [X] T019 [P] [US2] Add message-system.js script tag after notifications.js in `timetable-rooms.html`
- [X] T020 [P] [US2] Add message-system.js script tag after notifications.js in `timetable-teachers.html`

### Group F — Results / Analytics / Grades (4 pages)

- [X] T021 [P] [US2] Add message-system.js script tag after notifications.js in `results-hub.html`
- [X] T022 [P] [US2] Add message-system.js script tag after notifications.js in `analytics.html`
- [X] T023 [P] [US2] Add message-system.js script tag after notifications.js in `grades-sheets.html`
- [X] T024 [P] [US2] Add message-system.js script tag after notifications.js in `grades-results.html`

### Group G — Student Support (2 pages)

- [X] T025 [P] [US2] Add message-system.js script tag after notifications.js in `student-support.html`
- [X] T026 [P] [US2] Add message-system.js script tag after notifications.js in `support-sessions.html`

### Group H — Absence (4 pages)

- [X] T027 [P] [US2] Add message-system.js script tag after notifications.js in `absence-weekly.html`
- [X] T028 [P] [US2] Add message-system.js script tag after notifications.js in `absence-students.html`
- [X] T029 [P] [US2] Add message-system.js script tag after notifications.js in `absence-correspondence.html`
- [X] T030 [P] [US2] Add message-system.js script tag after notifications.js in `absence-analytics.html`

### Group I — Exams (4 pages)

- [X] T031 [P] [US2] Add message-system.js script tag after notifications.js in `exams-schedule.html`
- [X] T032 [P] [US2] Add message-system.js script tag after notifications.js in `exams-proctors.html`
- [X] T033 [P] [US2] Add message-system.js script tag after notifications.js in `exams-rooms.html`
- [X] T034 [P] [US2] Add message-system.js script tag after notifications.js in `exams-tests.html`

### Group J — Reports (3 pages)

- [X] T035 [P] [US2] Add message-system.js script tag after notifications.js in `reports-certificates.html`
- [X] T036 [P] [US2] Add message-system.js script tag after notifications.js in `reports-forms.html`
- [X] T037 [P] [US2] Add message-system.js script tag after notifications.js in `reports-semester.html`

### Group K — Settings (6 pages)

- [X] T038 [P] [US2] Add message-system.js script tag after notifications.js in `settings-imports.html`
- [X] T039 [P] [US2] Add message-system.js script tag after notifications.js in `settings-school.html`
- [X] T040 [P] [US2] Add message-system.js script tag after notifications.js in `settings-users.html`
- [X] T041 [P] [US2] Add message-system.js script tag after notifications.js in `settings-license.html`
- [X] T042 [P] [US2] Add message-system.js script tag after notifications.js in `settings-logs.html`
- [X] T043 [P] [US2] Add message-system.js script tag after notifications.js in `settings-sync.html`

### Group L — Other (2 pages)

- [X] T044 [P] [US2] Add message-system.js script tag after notifications.js in `compensation-tracking.html`
- [X] T045 [P] [US2] Add message-system.js script tag after notifications.js in `student-profile-prototype.html`

**Checkpoint US2**: All 44 pages have the script tag. Verify with:
```bash
grep -rl "message-system.js" *.html | wc -l
# Must output: 44
```

---

## Phase 3: User Story 3 — Regression Verification (Priority: P2)

**Goal**: Confirm zero regressions across representative pages after T001–T045.

**Independent Test**: 5+ pages load cleanly with no console errors and all existing functionality intact.

- [X] T046 [US3] Run smoke test suite to confirm IPC parity and Tailwind output unchanged: `npm run test:smoke`
- [ ] T047 [US3] Manual spot-check `index.html` (dashboard): open in Electron, verify page loads, no console errors, `typeof showConfirm === "function"` in DevTools
- [ ] T048 [US3] Manual spot-check `timetable.html`: trigger a teacher selection or slot action to produce a toast — verify toast appears in the `#toast` element with correct styling and Arabic text
- [ ] T049 [US3] Manual spot-check `settings-imports.html`: verify page loads with no errors, open DevTools and confirm `typeof showConfirm === "function"`
- [ ] T050 [US3] Manual spot-check `students-list.html`: verify page loads, student list renders, `typeof showConfirm === "function"` in DevTools
- [ ] T051 [US3] Manual spot-check `login.html`: verify page loads, login form renders, `typeof showConfirm === "function"` in DevTools (exception page — inserted after ux-enhancements.js)
- [X] T052 [US3] Verify excluded pages untouched: confirm `timetable_body.html` and `communication-center-prototype.html` do NOT contain `message-system.js` by running `grep "message-system.js" timetable_body.html communication-center-prototype.html` — must return no matches

**Checkpoint US3**: All checks pass — zero regressions confirmed.

---

## Phase 4: Polish & Commit

**Purpose**: Clean commit history per constitution Principle I (conventional commit format).

- [ ] T053 Commit timetable dead-code removal: `git add js/pages/timetable.js && git commit -m "refactor(timetable): remove unused timetableShowToast alias"`
- [ ] T054 Commit HTML rollout: `git add *.html && git commit -m "chore: add message-system.js script tag to all 44 HTML pages"`

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (T001)**: No external dependencies — start immediately
- **Phase 2 (T002–T045)**: No dependency on Phase 1; all HTML tasks are fully independent of each other and of T001
- **Phase 3 (T046–T052)**: Depends on Phase 1 AND Phase 2 being fully complete
- **Phase 4 (T053–T054)**: Depends on Phase 3 (all checks passing)

### User Story Dependencies

- **US1 (T001)**: Independent — no dependency on US2 or US3
- **US2 (T002–T045)**: Independent — no dependency on US1 or US3; all 44 tasks within US2 are parallel with each other
- **US3 (T046–T052)**: Depends on US1 and US2 being complete (verifies them)

### Parallel Opportunities

All T002–T045 are marked `[P]` — they touch different files with zero shared state. An LLM can process all 44 in a single batch operation or in any order.

---

## Parallel Execution Example: Phase 2

```text
# All of these can be done simultaneously — different files, no conflicts:
T002: index.html
T005: students-list.html
T010: teachers-list.html
T016: timetable.html
T027: absence-weekly.html
T031: exams-schedule.html
T038: settings-imports.html
... (all 44 in one pass)
```

---

## Implementation Strategy

### Fastest Path (Recommended for LLM)

1. **T001** — remove line 1842 from `js/pages/timetable.js` (1 edit)
2. **T002–T045** — add script tag to all 44 HTML files in one batch (44 edits, all parallel)
3. **T046** — run `npm run test:smoke`
4. **T047–T052** — manual spot-checks (5 pages)
5. **T053–T054** — two commits

### MVP Validation Point

After T001 + T002–T045 + T046:
- Run `grep -rl "message-system.js" *.html | wc -l` → must be `44`
- Run `grep "timetableShowToast" js/pages/timetable.js` → must be empty
- Run `npm run test:smoke` → must pass
- The feature is functionally complete; T047–T052 are manual confirmation

---

## Notes

- Every HTML edit is the same pattern — only the filename changes. An LLM can template this.
- `login.html` is the **only** exception to the insertion rule (after `ux-enhancements.js`, not `notifications.js`).
- `timetable_body.html` and `communication-center-prototype.html` must **not** be touched.
- The smoke test (`npm run test:smoke`) validates IPC parity, no CDN refs, and Tailwind output — it will catch any accidental breakage.
- Constitution requires a manual RTL visual check for the timetable toast (T048 covers this).

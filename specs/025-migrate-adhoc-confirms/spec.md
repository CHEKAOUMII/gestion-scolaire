# Feature Specification: Migrate Ad-hoc Confirmation Patterns

**Feature Branch**: `025-migrate-adhoc-confirms`
**Created**: 2026-04-01
**Status**: Draft
**Input**: User description: "Replace ad-hoc confirm patterns with unified showConfirm() across settings-imports.html and all JS pages that use window.confirm()"

## Overview

This feature migrates all legacy ad-hoc confirmation patterns in the application to use the unified `showConfirm()` API introduced in the message system (Phase 1–4). The migration covers two distinct areas:

1. **settings-imports page** — a custom-built HTML overlay (`import-confirm-overlay`) and six "clear data" buttons each backed by inline JavaScript logic.
2. **All other JS pages** — any file using the browser-native `window.confirm()` dialog, which is synchronous, unstyled, and untranslated.

After this migration, no page in the application should display a browser-native confirm box or the old bespoke import overlay.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Deleting student data triggers a branded confirmation (Priority: P1)

A school administrator on the **Settings → Imports** page clicks "حذف بيانات التلاميذ" (Delete Student Data). Instead of the old custom overlay or a browser-native dialog, a polished RTL-aware confirmation dialog appears with a red danger header, a clear warning message, and a "حذف نهائي" (Permanent Delete) button. Cancelling does nothing; confirming proceeds with the deletion.

**Why this priority**: The six clear-data buttons onSettings Imports represent the highest-risk destructive actions in the whole application. They are the primary driver for this migration and the most visible improvement to end users.

**Independent Test**: Can be fully tested by opening settings-imports.html, clicking any "حذف" stat-card button, and verifying the unified dialog appears — without touching any other page.

**Acceptance Scenarios**:

1. **Given** the Settings → Imports page is open, **When** the admin clicks "حذف بيانات التلاميذ", **Then** a danger-type confirmation dialog appears with title "حذف بيانات التلاميذ", a detail line "لا يمكن التراجع عن هذا الإجراء.", and buttons "حذف نهائي" / "إلغاء".
2. **Given** the dialog is open, **When** the admin clicks "إلغاء" or presses Escape, **Then** the dialog closes and no data is deleted.
3. **Given** the dialog is open, **When** the admin clicks "حذف نهائي", **Then** the dialog closes and the existing deletion logic executes.
4. **Given** the dialog is open, **When** the admin clicks outside the card area, **Then** the dialog closes without deleting data.

---

### User Story 2 — Import-start confirmation uses the unified dialog (Priority: P1)

When a school administrator clicks "بدء الاستيراد" (Start Import) on the Settings → Imports page, the old bespoke `import-confirm-overlay` HTML block is gone. In its place, `showConfirm()` presents the same information (import summary message) in the standard dialog, with an "info" header, "بدء الاستيراد" confirm button, and "إلغاء" cancel button.

**Why this priority**: The import confirmation is the second core interaction on this page and was the original motivation for the bespoke overlay. Removing that overlay also simplifies the HTML.

**Independent Test**: Can be fully tested by initiating a file import on settings-imports.html and verifying the unified dialog appears instead of the old overlay div.

**Acceptance Scenarios**:

1. **Given** a valid import file is selected, **When** the admin clicks "بدء الاستيراد", **Then** the unified info-type dialog appears with the dynamically built import-summary message.
2. **Given** the import dialog is open, **When** the admin clicks "إلغاء", **Then** no import begins and the dialog closes.
3. **Given** the import dialog is open, **When** the admin clicks "بدء الاستيراد", **Then** the import proceeds as before.
4. **Given** the old `import-confirm-overlay` HTML block existed, **After** migration, **Then** it is no longer present in settings-imports.html.

---

### User Story 3 — All native browser confirm dialogs are replaced (Priority: P2)

Any page in the application that previously called `window.confirm()` or `confirm()` now uses `await showConfirm()` instead. Users no longer see an unstyled, untranslated browser dialog — every confirmation is branded, RTL-correct, and consistent.

**Why this priority**: This is a completeness requirement. Leaving stray `confirm()` calls would create an inconsistent experience, but it is lower priority than the settings-imports migration because fewer user-facing flows are affected.

**Independent Test**: Can be verified by searching the entire JS directory for `confirm(` calls — none should remain (excluding the `showConfirm` implementation itself). Each affected page can also be opened and the relevant action triggered.

**Acceptance Scenarios**:

1. **Given** a search of all JS files for `window.confirm(` or bare `confirm(`, **When** the search runs, **Then** zero matches are found (excluding `message-system.js` and any `showConfirm` call sites).
2. **Given** any page that previously showed a native browser confirm, **When** the user triggers that action, **Then** the unified `showConfirm()` dialog appears instead.
3. **Given** the containing function previously used the synchronous `if (confirm(...))` pattern, **After** migration, **Then** the function is `async` and uses `await showConfirm()`.

---

### Edge Cases

- What happens when a user rapidly clicks a delete button twice before the dialog appears? The `showConfirm()` API closes any existing active confirm before opening a new one — only one dialog is ever visible.
- What happens if `showConfirm()` is called from a non-async function? The function must be converted to `async`; failing to do so would silently swallow the promise result.
- What happens if the page JS file uses a module pattern that makes the function non-async-capable? The specific confirm call must be refactored into a named async handler.
- What happens to the now-unused `import-confirm-overlay` CSS rules in `tailwind-input.css`? They may be left in place for backward compatibility during the transition or removed — this is a cosmetic choice that does not affect functionality.
- What happens when an async event handler is registered on a non-async-aware event emitter? The handler must be wrapped correctly so rejections surface and are caught by the global error boundary.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The application MUST replace the custom `import-confirm-overlay` HTML block in settings-imports.html with a call to `showConfirm()`.
- **FR-002**: The application MUST present a danger-type confirmation for each of the six data-clear buttons (`btn-clear-students`, `btn-clear-grades`, `btn-clear-absences`, `btn-clear-timetable`, `btn-clear-status`, `btn-clear-teachers`) using `showConfirm()`.
- **FR-003**: Each danger confirmation MUST include a title identifying the data type being deleted, a warning message, a detail line stating the action is irreversible, and a "حذف نهائي" confirm button.
- **FR-004**: The import-start confirmation MUST use an info-type `showConfirm()` with the dynamically composed import summary as the message.
- **FR-005**: All occurrences of `window.confirm()` and standalone `confirm()` in `js/` MUST be replaced with `await showConfirm()`, with the enclosing function converted to `async` where needed.
- **FR-006**: After migration, zero native browser confirm dialogs MUST appear anywhere in the application.
- **FR-007**: Cancelling any confirmation dialog MUST leave application state unchanged — no data must be deleted or imported.
- **FR-008**: Confirming any dialog MUST execute the same underlying action that the previously replaced confirm guard protected.
- **FR-009**: The `import-confirm-overlay` div block MUST be removed from settings-imports.html DOM.
- **FR-010**: All migrated async handlers MUST propagate errors correctly so the global error boundary can catch and display them.

### Key Entities

- **Confirmation Dialog**: The unified `showConfirm()` call with its configuration object — type, title, message, detail, confirmText, cancelText.
- **Destructive Action Guard**: The before/after pattern around data deletion or import logic, now expressed as `const { confirmed } = await showConfirm(…); if (!confirmed) return;`.
- **Legacy Overlay**: The `import-confirm-overlay` HTML element and its related show/hide JavaScript — to be fully removed.
- **Bare Confirm Call Site**: Any location in `js/` where `confirm(` or `window.confirm(` appears outside the message-system module itself.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Zero instances of `window.confirm()` or bare `confirm(` remain anywhere in the `js/` directory after migration (excluding `message-system.js`).
- **SC-002**: Zero instances of the `import-confirm-overlay` element remain in any HTML file after migration.
- **SC-003**: All six data-clear buttons on the Settings → Imports page present a `showConfirm()` danger dialog before proceeding, verified by manual click-through of each button.
- **SC-004**: The import-start flow presents a `showConfirm()` info dialog, verified by initiating an import and observing the dialog.
- **SC-005**: Clicking "إلغاء" on any migrated dialog results in no state change — 100% of cancel actions are no-ops.
- **SC-006**: Clicking the confirm button on any migrated dialog results in the expected action executing — 100% of confirm actions complete successfully.
- **SC-007**: No unhandled promise rejections appear in the console as a result of migrated async handlers on any affected page.

---

## Assumptions

- `showConfirm()` from `js/message-system.js` is already implemented, tested, and loaded on all pages (completed in Phase 1–4 of the message system rollout).
- The six clear-data buttons (`btn-clear-*`) already have click handlers in `js/pages/settings-imports.js`; this migration wraps those handlers, it does not replace the underlying deletion logic.
- The import confirmation message is dynamically composed in `js/pages/settings-imports.js` before the old overlay was shown; that same message string is reused in the `showConfirm()` call.
- Any JS function that calls `confirm()` today can be safely converted to `async` without breaking other callers (i.e. callers do not depend on a synchronous return value from these functions).
- The legacy `import-confirm-overlay` CSS in `tailwind-input.css` can remain or be removed — either is acceptable; the spec does not mandate CSS removal.

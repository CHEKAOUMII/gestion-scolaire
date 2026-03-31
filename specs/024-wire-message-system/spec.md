# Feature Specification: Wire Message System Across All Pages

**Feature Branch**: `024-wire-message-system`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Remove duplicate showToast from timetable.js and wire message-system.js script tag across all HTML pages (Phase 4 of the message system plan)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Consistent Toast Notifications on Timetable Page (Priority: P1)

A user working on the timetable page triggers any action that produces a toast notification (e.g., importing data, saving changes). Currently, the timetable page defines its own local copy of `showToast`, which can diverge from the application-wide implementation and produce inconsistent or broken notifications.

**Why this priority**: The duplicate function is a latent defect — it shadows the global implementation, meaning any improvements to the global toast system are silently not applied on the timetable page. Fixing this is foundational before rolling out the new message system.

**Independent Test**: Navigate to the timetable page and trigger any action that shows a toast notification. Verify the toast appears correctly with the same visual style and behavior as toasts on other pages.

**Acceptance Scenarios**:

1. **Given** a user is on the timetable page, **When** they trigger an action that calls `showToast`, **Then** the notification appears with the same appearance, timing, and behavior as toasts on every other page.
2. **Given** the timetable page is loaded, **When** the developer console is inspected, **Then** there is no locally-scoped `showToast` function definition on that page — only the global one is used.
3. **Given** a future improvement is made to the global toast system, **When** the timetable page is loaded, **Then** it automatically benefits from that improvement without any additional changes.

---

### User Story 2 - New Confirmation System Available on Every Page (Priority: P1)

A user on any page of the application (students, teachers, absences, settings, etc.) triggers an action that requires confirmation (e.g., deleting a record, clearing data). The new `showConfirm()` function must be available and callable on every page — not just the pages where it is explicitly wired.

**Why this priority**: Without the script being loaded on all pages, the new message system cannot be adopted application-wide. Future phases (replacing `window.confirm()` calls, migrating ad-hoc overlays) depend entirely on this being in place first.

**Independent Test**: Open any HTML page in the application. Open the developer console and type `typeof showConfirm`. The result must be `"function"`, not `"undefined"`.

**Acceptance Scenarios**:

1. **Given** any HTML page in the application is loaded, **When** the developer console evaluates `typeof showConfirm`, **Then** the result is `"function"`.
2. **Given** any HTML page in the application is loaded, **When** the developer console evaluates `typeof setFieldValidation`, **Then** the result is `"function"`.
3. **Given** any HTML page in the application is loaded, **When** the developer console evaluates `typeof clearValidation`, **Then** the result is `"function"`.
4. **Given** the message system script is wired on all pages, **When** any page loads, **Then** no JavaScript console errors are produced by the message system script itself.
5. **Given** a page already loads the notifications module, **When** the message system module is also loaded on that page, **Then** both scripts coexist without conflict and all toast and confirmation functions work correctly.

---

### User Story 3 - No Regression on Any Page After Rollout (Priority: P2)

After the script is added to all pages and the duplicate removed, every page in the application continues to function identically to before — no broken layouts, no missing notifications, no errors introduced by the change.

**Why this priority**: A broad rollout touching 40+ files carries regression risk. Verifying no existing functionality is broken is essential before this phase is considered done.

**Independent Test**: Spot-check at least 5 representative pages (e.g., students list, timetable, settings-imports, results hub, login). Each page must load without errors and all existing interactions must work normally.

**Acceptance Scenarios**:

1. **Given** the message system module has been added to all HTML pages, **When** any page is loaded, **Then** the page renders without visual glitches or broken layout.
2. **Given** the duplicate `showToast` has been removed from the timetable page, **When** the timetable page is loaded and used, **Then** all existing timetable functionality works identically to before.
3. **Given** all changes are applied, **When** 5+ representative pages are opened in sequence, **Then** the developer console shows zero new errors compared to before the changes.

---

### Edge Cases

- What happens if the message system module is loaded on a page where the notifications module has not yet been loaded — does load order matter for the two to coexist correctly?
- What happens if a page already has an inline script that defines a local `showConfirm` — does the global definition conflict or get silently overridden?
- What happens if the timetable page calls `showToast` before the global notifications module has finished loading (script load order issue)?
- How does the message system module behave on pages where neither the notifications module nor the utils module is present?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The duplicate `showToast` function definition in the timetable page module MUST be removed entirely; the timetable page MUST rely solely on the globally defined `showToast` from the notifications module.
- **FR-002**: The message system module script tag MUST be present on every HTML page in the application (all 40+ pages listed in the plan).
- **FR-003**: The message system module script tag MUST be inserted after the notifications module script tag on pages that include it, preserving correct load order so that global utilities are available when the message system initialises.
- **FR-004**: On pages where the notifications module is absent, the message system module script tag MUST be inserted after the utils module script tag.
- **FR-005**: After the rollout, the `showConfirm`, `setFieldValidation`, and `clearValidation` functions MUST be accessible as globals on every HTML page in the application.
- **FR-006**: The timetable page MUST continue to display toast notifications correctly after the duplicate function is removed.
- **FR-007**: No existing page functionality MUST be broken by the addition of the message system module script tag.
- **FR-008**: The message system module script tag MUST use the non-blocking deferred loading attribute, consistent with other shared script tags in the application.

### Key Entities

- **HTML Page**: Any `.html` file in the application root that represents a navigable screen. Approximately 40+ such files exist.
- **Global Function**: A JavaScript function attached to the global window object, accessible from any script on any page without import.
- **Script Load Order**: The sequence in which script tags appear in an HTML file, which determines the order in which functions become available at runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The `showConfirm`, `setFieldValidation`, and `clearValidation` functions are available on 100% of application HTML pages — verifiable by console inspection on each page.
- **SC-002**: Zero new console errors appear on any page after the rollout, compared to the baseline before this phase.
- **SC-003**: The timetable page produces visually identical toast notifications after the duplicate removal — indistinguishable from before by manual side-by-side observation.
- **SC-004**: The timetable module contains zero locally-scoped `showToast` function definitions after the change.
- **SC-005**: All 40+ HTML pages load and render without visual regression — verified by spot-checking at least 5 representative pages across different sections of the application.

## Assumptions

- The plan document lists the complete and authoritative set of HTML files that require the script tag; no additional pages exist outside that list.
- The notifications module is already present on the majority of pages; the few pages without it use the utils module as the fallback anchor point for script tag placement.
- Non-blocking deferred loading is consistent with how other shared script tags are declared throughout the application.
- Removing the duplicate `showToast` from the timetable module does not require any call-site changes — the global version is signature-compatible and behaviorally equivalent.
- The global `showToast` is loaded before any timetable-specific code that calls it, by virtue of the notifications module being declared earlier in the HTML than page-specific scripts.

## Out of Scope

- Replacing any `window.confirm()` calls or ad-hoc confirm overlays with `showConfirm()` — that is Phase 5.
- Adding message system functionality to the main process or IPC layer.
- Modifying the content or behavior of `message-system.js` itself — Phase 1 covers that.
- Adding the loading/action toast variants to the notifications module — Phase 2 covers that.
- Adding the global error boundary to the utils module — Phase 3 covers that.

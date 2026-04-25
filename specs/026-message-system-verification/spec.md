# Feature Specification: Message System — Verification & Polish

**Feature Branch**: `026-message-system-verification`  
**Created**: 2026-04-01  
**Status**: Draft  
**Input**: Phase 6 "Verification & Polish" from the unified message system implementation plan — full test pass covering dark theme, RTL layout, keyboard navigation, toast variants, and error boundary.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Visual Consistency Across Themes (Priority: P1)

A developer or QA tester switches the application to dark mode and verifies that every message system element — confirmation dialogs, toast notifications of all types, and inline validation messages — renders correctly with proper contrast and no visual regressions.

**Why this priority**: Theme correctness is a baseline quality gate. Broken dark-mode rendering is immediately visible to all users and undermines trust in the entire system.

**Independent Test**: Can be fully tested by toggling to dark mode and triggering one of each message type; delivers the guarantee that the message system is visually correct for dark-mode users.

**Acceptance Scenarios**:

1. **Given** the application is in dark mode, **When** a confirmation dialog of type `danger`, `warning`, or `info` is opened, **Then** the dialog card, header accent, body text, and action buttons all have sufficient contrast and no white/light artifacts bleed through.
2. **Given** the application is in dark mode, **When** a loading toast, a success toast, an error toast, and an action toast are each triggered, **Then** all toast variants display legible text and icons with proper background colors.
3. **Given** the application is in dark mode, **When** inline validation messages (error, warning, success) are attached to form fields, **Then** the message text and icon are clearly readable against the dark surface.

---

### User Story 2 — RTL Layout Correctness (Priority: P1)

A QA tester verifies that all message system components respect the application's right-to-left reading direction: button order, icon placement, text alignment, and close button position are all culturally and visually correct for Arabic-speaking users.

**Why this priority**: The application is an Arabic-language system. Incorrect RTL layout is a functional defect, not a cosmetic one — it affects usability for every user.

**Independent Test**: Can be fully tested by opening a confirm dialog and a toast on any page, inspecting button order and alignment without dark mode; delivers the guarantee that message UI is correct for all Arabic users.

**Acceptance Scenarios**:

1. **Given** an RTL page layout, **When** a confirmation dialog is displayed, **Then** the Cancel button appears on the right and the Confirm button appears on the left (matching Arabic reading order).
2. **Given** an RTL page layout, **When** a toast notification appears, **Then** the close button is positioned on the left side of the toast and text aligns to the right.
3. **Given** an RTL page layout, **When** an inline validation message appears beneath a form field, **Then** the icon is on the right and the message text flows naturally toward the left.

---

### User Story 3 — Keyboard Navigation & Accessibility (Priority: P2)

A keyboard-only user interacts with a confirmation dialog entirely without a mouse: they Tab through the controls, confirm or cancel with Enter/Escape, and receive focus back on the element that triggered the dialog after it closes.

**Why this priority**: Keyboard accessibility ensures the dialog is operable without a pointer device and is required for baseline usability compliance.

**Independent Test**: Can be fully tested by opening a confirm dialog and pressing Tab and Escape without touching the mouse; delivers a working keyboard-accessible dialog.

**Acceptance Scenarios**:

1. **Given** a confirmation dialog is open, **When** the user presses Tab repeatedly, **Then** focus cycles only within the dialog (focus trap active) and never escapes to the underlying page.
2. **Given** a confirmation dialog is open, **When** the user presses Escape, **Then** the dialog closes and focus returns to the element that triggered it.
3. **Given** a confirmation dialog is open and focus is on the Confirm button, **When** the user presses Enter, **Then** the confirmation resolves as confirmed and the dialog closes.
4. **Given** a confirmation dialog with a required text input is open and the input is empty, **When** the user attempts to activate the Confirm button, **Then** the button is disabled and no confirmation occurs.
5. **Given** a confirmation dialog with a required text input is open and the field has been filled, **When** the user presses Enter while focused on the input, **Then** the confirmation resolves as confirmed.

---

### User Story 4 — Toast Variant Lifecycle (Priority: P2)

A developer or QA tester manually triggers each toast variant and verifies the full lifecycle: correct icon, correct color, correct auto-dismiss timing, and correct state transitions for the loading toast.

**Why this priority**: Toasts are the primary feedback mechanism for async operations. Incorrect behavior directly impairs user confidence in the system's responses.

**Independent Test**: Can be fully tested via browser console commands on any loaded page without interacting with application features.

**Acceptance Scenarios**:

1. **Given** a standard success toast is triggered, **When** it appears, **Then** it shows a green check icon and auto-dismisses after approximately 3 seconds.
2. **Given** a standard error toast is triggered, **When** it appears, **Then** it shows a red exclamation icon and auto-dismisses after approximately 3–5 seconds.
3. **Given** a loading toast is triggered, **When** `.success(message)` is called on its handle, **Then** the spinner changes to a check icon, the background updates to success styling, and the toast dismisses after approximately 3 seconds.
4. **Given** a loading toast is triggered, **When** `.error(message)` is called on its handle, **Then** the spinner changes to an error icon, the background updates to error styling, and the toast dismisses after approximately 5 seconds.
5. **Given** an action toast is triggered with an Undo button, **When** the button is clicked, **Then** the callback fires exactly once and the toast dismisses immediately.
6. **Given** any toast is visible, **When** the user clicks the toast body (outside any action button), **Then** the toast dismisses immediately.

---

### User Story 5 — Global Error Boundary Behavior (Priority: P2)

A developer verifies that the global error boundary catches uncaught JavaScript errors and unhandled promise rejections, surfaces a single user-friendly toast, and suppresses duplicate/flood toasts when many errors fire rapidly.

**Why this priority**: Without a tested error boundary, users experience silent failures. The flood protection is critical to prevent the UI from being overwhelmed by cascading errors.

**Independent Test**: Can be fully tested by throwing errors in the browser console; delivers the guarantee that unhandled errors never reach users silently.

**Acceptance Scenarios**:

1. **Given** the application is loaded, **When** an uncaught JavaScript error occurs, **Then** a single error toast appears within 1 second and the error is logged to the console.
2. **Given** the application is loaded, **When** an unhandled promise rejection occurs, **Then** a single error toast appears and the rejection is logged.
3. **Given** a first error toast was just shown, **When** a second error fires within 3 seconds, **Then** no second toast appears (throttle active).
4. **Given** more than 5 errors fire within a 10-second window, **When** the flood threshold is exceeded, **Then** a single "multiple errors — please reload" toast appears and subsequent individual error toasts are suppressed.
5. **Given** flood protection has activated, **When** no errors fire for 10 seconds, **Then** the flood counter resets and the next error produces a normal error toast.

---

### Edge Cases

- What happens if a confirmation dialog is triggered while another is already open? The first dialog must be resolved as cancelled before the new one appears.
- What happens if `showToast` is not yet available when the error boundary fires its first event? The boundary must degrade gracefully (console log only, no crash).
- What happens if a toast's container element is removed from the DOM between creation and dismissal? The dismiss operation must not throw.
- What happens if a form field is removed from the DOM before its validation message finishes animating in? No error must be thrown.
- What happens if the user rapidly opens and closes a confirm dialog with a required input? The promise resolves exactly once per dialog invocation.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The message system MUST render without visual defects in both light and dark themes — all text, icons, backgrounds, and borders must have observable contrast in both modes.
- **FR-002**: All message system components MUST respect RTL layout — button order, close button position, icon placement, and text alignment must match Arabic right-to-left conventions.
- **FR-003**: Confirmation dialogs MUST implement a focus trap — keyboard focus MUST NOT reach the underlying page while the dialog is open.
- **FR-004**: Pressing Escape on an open confirmation dialog MUST close it and resolve its promise as cancelled.
- **FR-005**: Pressing Enter while focused on the Confirm button or a filled required input MUST confirm the dialog.
- **FR-006**: The Confirm button MUST be disabled when `requireInput` is set and the input field is empty.
- **FR-007**: After a dialog closes by any means, keyboard focus MUST return to the element that triggered the dialog.
- **FR-008**: Each standard toast type (success, error, warning, info) MUST display the correct icon and color variant and MUST auto-dismiss within its designated duration.
- **FR-009**: The loading toast handle MUST expose `.success()`, `.error()`, `.progress()`, and `.dismiss()` methods that each transition the toast to the correct visual state.
- **FR-010**: Action toast callbacks MUST fire exactly once when the action button is clicked, after which the toast MUST dismiss immediately.
- **FR-011**: Any visible toast MUST dismiss immediately when its body area is clicked (outside an action button).
- **FR-012**: The global error boundary MUST produce a user-facing error toast for uncaught errors and unhandled promise rejections.
- **FR-013**: The error boundary MUST throttle toasts so that no more than one error toast appears within any 3-second window.
- **FR-014**: The error boundary MUST apply flood protection — after 5 errors within 10 seconds, individual toasts MUST be suppressed and a single "multiple errors" toast MUST appear instead.
- **FR-015**: The CSS build MUST complete without errors and the application MUST launch without console errors attributable to the message system.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every message system element (dialog, all toast variants, all validation states) renders without observable visual defects in both light and dark themes — zero contrast failures detectable by manual inspection.
- **SC-002**: Every message system element displays in correct RTL orientation — zero directional layout defects observable by manual inspection.
- **SC-003**: A keyboard-only user can open, navigate within, confirm, and cancel a confirmation dialog without a mouse — the full keyboard flow completes successfully.
- **SC-004**: Each toast variant transitions through its complete lifecycle (appear → state change → dismiss) with zero stuck or orphaned toast elements remaining in the DOM afterward.
- **SC-005**: Triggering 10 rapid errors produces at most 2 visible toasts (one individual + one flood message) — never 10 separate toasts.
- **SC-006**: The CSS build and application launch complete without errors attributable to the message system.
- **SC-007**: All confirmed deletion and import flows in the settings-imports page operate end-to-end without regression after the ad-hoc overlay replacement.

---

## Assumptions

- All preceding phases (1–5) of the message system plan are fully implemented: CSS styles are compiled, `message-system.js` is loaded on all pages, `showToast.loading()` and `showToast.action()` exist on `window.showToast`, and the ad-hoc confirmation overlays in `settings-imports` have been replaced with `showConfirm()`.
- "Sufficient contrast" is evaluated by visual inspection; no automated accessibility scanner tool is required for this phase.
- RTL correctness is validated against the existing Arabic layout of the application — no locale switching mechanism is required.
- Screen reader announcement testing is considered optional and is not a mandatory success criterion for this phase.
- `npm run css:build` and `npm start` are the canonical commands for verifying the built output.

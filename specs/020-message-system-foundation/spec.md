# Feature Specification: Message System Foundation — CSS + Core API

**Feature Branch**: `020-message-system-foundation`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Phase 1: Foundation — CSS + Core API from the message system plan"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Confirm a Destructive Action (Priority: P1)

A user is about to delete records or perform an irreversible operation. Instead of the browser's native `confirm()` dialog (which is unstyled, blocks the thread, and feels jarring), they see a polished, RTL-aware confirmation dialog that matches the app's visual design. The dialog clearly communicates severity and gives the user a clear choice.

**Why this priority**: Confirmation dialogs are the most critical safety net in the application. Without a native-feeling replacement, users get jarring browser dialogs or no confirmation at all. This is the primary deliverable of the entire message system.

**Independent Test**: Can be fully tested by calling `showConfirm({ title: '...', message: '...', type: 'danger' })` in any page console and verifying the dialog appears, animates in, and resolves the returned Promise when the user clicks Confirm or Cancel.

**Acceptance Scenarios**:

1. **Given** a page has loaded the message-system module, **When** `showConfirm({ title: 'حذف البيانات', message: 'هل أنت متأكد؟', type: 'danger' })` is called, **Then** an overlay fades in with a card that has a red top-border, danger icon, title, message, Cancel button, and a red Confirm button.
2. **Given** the dialog is open, **When** the user clicks the Confirm button, **Then** the returned Promise resolves with `{ confirmed: true }` and the dialog animates out and is removed from the DOM.
3. **Given** the dialog is open, **When** the user clicks Cancel, the close (×) button, the backdrop, or presses Escape, **Then** the Promise resolves with `{ confirmed: false }` and the dialog is removed.
4. **Given** `type: 'warning'` is passed, **Then** the header border and icon use amber/warning colors instead of red.
5. **Given** `type: 'info'` or no type is passed, **Then** the header uses the primary blue color.
6. **Given** `requireInput: true` is passed, **Then** the Confirm button is disabled until the user types something in the input field; pressing Enter in the filled input confirms.
7. **Given** a confirm dialog is already open and `showConfirm()` is called again, **Then** the first dialog resolves with `{ confirmed: false }` before the second one opens.

---

### User Story 2 - See Inline Field Validation (Priority: P2)

A user fills in a form field incorrectly. Rather than a generic alert, an inline message appears directly below the field, color-coded to the severity (error, warning, success), with a matching icon. The field border also changes color to reinforce the state.

**Why this priority**: Inline validation is essential for data-entry forms across the entire application. It provides contextual, immediate feedback that generic toasts cannot achieve.

**Independent Test**: Can be tested independently by calling `setFieldValidation(inputEl, 'هذا الحقل مطلوب', 'error')` on any input element and verifying the visual state changes.

**Acceptance Scenarios**:

1. **Given** an input element exists in the DOM, **When** `setFieldValidation(field, 'هذا الحقل مطلوب', 'error')` is called, **Then** a red inline message with an error icon appears below the field and the field's border turns red.
2. **Given** a validation message is showing, **When** `setFieldValidation(field, null)` or `clearValidation(container)` is called, **Then** the message disappears, the border resets, and ARIA attributes are removed.
3. **Given** `type: 'success'` is passed, **Then** the message and border are green.
4. **Given** `type: 'warning'` is passed, **Then** the message and border are amber.
5. **Given** `setFieldValidation` is called twice on the same field, **Then** only one validation message exists below it (the previous is replaced, no duplicates).

---

### User Story 3 - Visual Coherence Across Themes (Priority: P3)

A user switches to dark mode. All message-system UI elements (confirmation dialog and validation messages) adapt to the dark theme without hardcoded colors breaking the layout or contrast.

**Why this priority**: The app supports a dark theme. All visual components must respect it. This is a quality baseline, not a core flow.

**Independent Test**: Toggle `data-theme="dark"` on the document element while a confirm dialog is visible; verify the card background, shadows, and text all use dark-theme tokens.

**Acceptance Scenarios**:

1. **Given** `data-theme="dark"` is active, **When** a confirm dialog is shown, **Then** the card uses a dark surface background, stronger shadow, and text remains legible.
2. **Given** dark mode is active, **When** validation messages are shown, **Then** their colors are drawn from CSS variables and remain accessible.

---

### Edge Cases

- What happens when `showConfirm()` is called before the DOM is ready? The function must only append to `document.body` after the DOM is available.
- How does the system handle a missing `openDialog()` dependency? It must fall back gracefully to manual focus management without throwing.
- What if the user programmatically removes the overlay from the DOM while a confirm is pending? The Promise must still resolve with `{ confirmed: false }` to prevent memory leaks.
- What if `setFieldValidation` is called on a detached element (null `parentNode`)? It must return silently without error.
- What if `clearValidation` is called on a container with no validation messages? It must be a no-op.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST expose a global `showConfirm(config)` function that returns a Promise resolving to `{ confirmed: boolean, inputValue?: string }`.
- **FR-002**: `showConfirm` MUST support three severity types — `danger`, `warning`, and `info` — each with distinct visual treatment (top-border color, icon, confirm button color).
- **FR-003**: The confirmation dialog MUST animate in (fade + scale) and animate out before being removed from the DOM.
- **FR-004**: The confirmation dialog MUST be keyboard-accessible: Escape cancels, Tab cycles focus within the dialog, Enter confirms when a required input is filled.
- **FR-005**: The confirmation dialog MUST carry appropriate accessibility attributes (`role="alertdialog"`, `aria-modal="true"`, `aria-labelledby`, `aria-describedby`).
- **FR-006**: Dialog content (title, message, detail text, confirm/cancel button labels, icon) MUST be fully configurable via the `config` argument.
- **FR-007**: When `requireInput: true` is passed, the Confirm button MUST remain disabled until the user types a non-empty value; pressing Enter in the field MUST confirm.
- **FR-008**: Only one confirmation dialog MAY be open at a time; calling `showConfirm` while one is already open MUST auto-dismiss the first one with `{ confirmed: false }`.
- **FR-009**: The system MUST expose a global `setFieldValidation(field, message, type)` function that shows a color-coded inline message below a form field and updates its border state.
- **FR-010**: `setFieldValidation` MUST support three types: `error`, `warning`, `success`, each with a distinct icon and color.
- **FR-011**: Calling `setFieldValidation` on a field that already has a validation message MUST replace the existing message (no duplicate messages below a field).
- **FR-012**: The system MUST expose a global `clearValidation(container)` function that removes all validation messages and resets all field border states within a container.
- **FR-013**: All UI styles MUST use the application's existing CSS design tokens so they automatically adapt to light and dark themes without hardcoded color values.
- **FR-014**: All new CSS classes MUST be added to the shared Tailwind CSS source file and compiled successfully via the project's standard build command.

### Key Entities

- **Confirmation Dialog**: A modal overlay with a styled card containing a header (severity icon + title + close button), body (message + optional detail + optional text input), and action footer (Cancel + Confirm buttons). Severity is expressed through top-border color and icon color.
- **Validation Message**: A small inline element inserted immediately after a form field in the DOM, containing an icon and text, revealed with an animated expand transition.
- **CSS Design Token**: A CSS custom property (e.g., `--color-danger-solid`, `--color-primary`, `--color-surface`) defined in the app's theme block and referenced by all message-system styles.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer can invoke `showConfirm()` with any severity type and receive a correctly resolved Promise across all three outcomes (confirm, cancel, escape) with zero unhandled exceptions.
- **SC-002**: The confirmation dialog appears and is fully interactive within one animation frame after `showConfirm()` is called — no perceptible lag in manual testing.
- **SC-003**: Switching between light and dark themes while a dialog or validation message is visible produces no hardcoded-color artifacts — all colors adapt automatically via CSS variables.
- **SC-004**: Calling `setFieldValidation` followed by `clearValidation` leaves the DOM in exactly the same state as before either call — no orphaned elements, no residual ARIA attributes.
- **SC-005**: The CSS build completes without errors after the new styles are added, and the compiled output contains all new class names.
- **SC-006**: All keyboard navigation paths (Tab, Shift+Tab, Escape, Enter) function correctly inside the confirmation dialog without requiring mouse interaction.

---

## Assumptions

- The existing `openDialog()` / `closeDialog()` functions from `js/ux-enhancements.js` are available on pages that load it. The new module must degrade gracefully on pages that do not include it.
- All HTML pages already include `js/notifications.js` and `js/utils.js`; the script tag for `js/message-system.js` will be added to HTML pages in a later phase (Phase 4). This spec covers only the module and CSS creation.
- The application's design tokens (`--color-danger-solid`, `--color-warning-solid`, `--color-primary`, `--color-surface`, etc.) are already defined and stable; no new tokens need to be introduced.
- RTL layout is the default; all directional properties must use logical CSS properties or RTL-aware values.
- Acceptance testing for this phase is done via DevTools console on any already-loaded page, not through automated test suites.

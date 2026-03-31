# Feature Specification: Enhanced Toast Variants

**Feature Branch**: `021-enhanced-toast-variants`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "read docs/superpowers/plans/2026-03-31-message-system.md and create a specification for the Phase 2 Enhanced Toast Variants ONLY."

## Overview

Extend the existing toast notification system with two new variants — a **loading toast** (progress-aware, state-transitioning) and an **action toast** (dismissible with an embedded call-to-action button) — to replace ad-hoc loading spinners and bare text alerts currently scattered across the application.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Track a Long-Running Operation with a Loading Toast (Priority: P1)

A user triggers an operation that takes several seconds (e.g., saving a large dataset, running an import). The app shows a toast with a spinner and progress indicator so the user knows work is in progress. When the operation completes, the toast transitions in-place to a success or error state without flickering or spawning a new toast.

**Why this priority**: This is the highest-value variant. It replaces invisible or broken feedback during async operations — a top source of user confusion.

**Independent Test**: Can be fully tested by triggering any multi-step form submission and verifying the toast transitions from loading → success or loading → error without additional UI noise.

**Acceptance Scenarios**:

1. **Given** a user submits a form that triggers a background save, **When** the save begins, **Then** a loading toast appears immediately with a spinner and a descriptive message.
2. **Given** a loading toast is visible, **When** the operation completes successfully, **Then** the spinner is replaced with a success icon, the message updates, and the toast auto-dismisses after 3 seconds.
3. **Given** a loading toast is visible, **When** the operation fails, **Then** the spinner is replaced with an error icon, the message updates to reflect the failure, and the toast stays visible for 5 seconds.
4. **Given** a loading toast is visible, **When** a user clicks the close button, **Then** the toast dismisses immediately regardless of operation state.
5. **Given** a loading toast is visible and shows a progress bar, **When** progress advances, **Then** the progress bar width updates smoothly to reflect the current percentage (0–100%).

---

### User Story 2 — Offer a Recoverable Action After a Destructive Operation (Priority: P2)

A user deletes a record or performs a bulk clear. The app shows a toast confirming the action and offers an inline "Undo" button. The user can click Undo within the toast's visible window to reverse the operation without navigating away.

**Why this priority**: Reduces irreversible mistakes and increases user confidence. Secondary to loading because it requires a pre-existing undo mechanism in the calling code.

**Independent Test**: Can be fully tested by triggering any delete action that supports undo and verifying the undo button appears, is clickable, and triggers the recovery callback.

**Acceptance Scenarios**:

1. **Given** a user deletes a record, **When** the deletion succeeds, **Then** an action toast appears with the deletion confirmation message and an "Undo" button.
2. **Given** an action toast is visible, **When** the user clicks the Undo button, **Then** the registered callback is invoked and the toast dismisses immediately.
3. **Given** an action toast is visible, **When** the user does not interact with it, **Then** it auto-dismisses after 8 seconds (default duration).
4. **Given** an action toast is visible, **When** the user clicks anywhere on the toast body (not the action button), **Then** the toast dismisses without triggering the action callback.
5. **Given** an action toast appears, **When** the same message is triggered again within 2 seconds, **Then** a duplicate toast is NOT created (deduplication is active).

---

### User Story 3 — Dismiss Any Toast by Clicking It (Priority: P3)

A user sees a standard or enhanced toast and wants to dismiss it before its auto-dismiss timer expires. Clicking anywhere on the toast (except interactive buttons) closes it immediately.

**Why this priority**: Quality-of-life improvement that applies to all toast types consistently.

**Independent Test**: Can be fully tested by triggering any toast and clicking its body.

**Acceptance Scenarios**:

1. **Given** any toast is visible, **When** the user clicks the toast body, **Then** the toast fades out and is removed within 300ms.
2. **Given** a toast with an action button is visible, **When** the user clicks the action button, **Then** only the action callback fires — the click does not also trigger the body-dismiss path a second time.

---

### Edge Cases

- What happens when two loading toasts are triggered in rapid succession for the same message? The second call is suppressed by deduplication (2-second window).
- What happens when progress is set to a value outside 0–100? Values are clamped to the valid range silently.
- What happens when `.success()` or `.error()` is called on an already-dismissed loading toast? The call is a no-op; no new toast is created.
- What happens when the toast container does not exist in the DOM? It is created automatically and appended to the page.
- What happens when the action callback throws an error? The toast still dismisses; errors do not cascade to the UI.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a `showToast.loading(message)` function that returns a control handle object.
- **FR-002**: The control handle MUST expose `.success(message?)`, `.error(message?)`, `.progress(percent)`, and `.dismiss()` methods.
- **FR-003**: Calling `.success()` MUST transition the loading toast in-place: replace spinner with success icon, apply success styling, and auto-dismiss after 3 seconds.
- **FR-004**: Calling `.error()` MUST transition the loading toast in-place: replace spinner with error icon, apply error styling, and auto-dismiss after 5 seconds.
- **FR-005**: Calling `.progress(percent)` MUST update the progress bar within the loading toast to the given percentage (0–100), clamped at boundaries.
- **FR-006**: The loading toast MUST display a close button that allows the user to dismiss it at any time.
- **FR-007**: The system MUST provide a `showToast.action(message, actionConfig, opts?)` function that shows a toast with an embedded action button.
- **FR-008**: The action button MUST display a label and optionally an icon; clicking it MUST invoke the provided callback and dismiss the toast.
- **FR-009**: The action toast MUST auto-dismiss after a configurable duration (default: 8 seconds).
- **FR-010**: Both new variants MUST suppress duplicate toasts when the same message is triggered within a 2-second window.
- **FR-011**: Both new variants MUST be accessible as properties on the existing global toast function (`showToast.loading`, `showToast.action`).
- **FR-012**: All toasts (including existing standard toasts) MUST dismiss when the user clicks the toast body.
- **FR-013**: The loading toast progress bar MUST animate smoothly when its width changes.
- **FR-014**: Calling `.success()` or `.error()` on an already-dismissed handle MUST be a no-op (no error, no new toast).

### Key Entities

- **Loading Toast Handle**: Returned by `showToast.loading()`. Represents the live reference to the toast, tracks dismissed state, and exposes state-transition methods.
- **Action Config**: The second argument to `showToast.action()`. Carries `label` (display text), optional `icon` (icon identifier), and `onClick` (callback function).
- **Toast Container**: Singleton element that hosts all active toasts. Auto-created if absent at the time a toast is triggered.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A loading toast transitions to its final state (success or error) within one rendered frame of the corresponding method call — no perceptible delay.
- **SC-002**: No duplicate toasts appear when the same operation is triggered twice within a 2-second window.
- **SC-003**: All toast variants dismiss within 300ms of a user click interaction.
- **SC-004**: Progress bar width visually reflects the value passed to `.progress()` within one rendering cycle, with a smooth animated transition (no jump).
- **SC-005**: The action callback is invoked exactly once when the action button is clicked — never zero times, never more than once per click event.
- **SC-006**: Calling `.success()` or `.error()` on an already-dismissed handle produces no visible side-effect.
- **SC-007**: Both new variants render correctly and maintain readable contrast in both light and dark themes.
- **SC-008**: Toast layout and close button placement are correctly mirrored for right-to-left reading direction.

---

## Assumptions

- The calling code is responsible for implementing the actual undo/recovery logic; the action toast only provides the UI affordance and triggers the registered callback.
- The existing standard `showToast` variant remains unchanged in behavior; only additive changes are made.
- The toast container is shared across all toast types; stacking order is handled by existing CSS.
- The 2-second deduplication window and 8-second default action toast duration are derived from the implementation plan and require no further clarification.
- Dark theme support is required — the app already has a dark theme system.
- The app is RTL (Arabic); toast layout must respect right-to-left logical directions throughout.

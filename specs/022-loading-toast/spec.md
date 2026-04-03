# Feature Specification: Loading Toast Variant

**Feature Branch**: `022-loading-toast`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Loading Toast — showToast.loading() enhanced variant with progress, success, and error states"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Triggering a Loading Toast for a Long Operation (Priority: P1) 🎯 MVP

When a user initiates a slow operation (e.g., importing data, saving a large record, syncing), the application shows a persistent loading toast so the user knows the system is working. The toast stays on screen until the operation completes or fails, at which point it transitions to a success or error state automatically — without the user having to do anything.

**Why this priority**: Users currently have no feedback during slow operations. Without this, they may click again (causing duplicate requests) or assume the app has frozen. This is the single highest-impact usability improvement in the notification system.

**Independent Test**: Can be fully tested by triggering any long-running action and verifying that: (a) a spinner toast appears immediately, (b) it transitions to success after the operation completes, and (c) it auto-dismisses — all without any additional user interaction.

**Acceptance Scenarios**:

1. **Given** the user clicks a button that triggers a slow operation, **When** the operation starts, **Then** a toast with a spinning indicator and descriptive message appears within 100ms of the action being triggered.

2. **Given** a loading toast is visible, **When** the operation completes successfully, **Then** the spinner is replaced by a success indicator, the message updates to a confirmation, and the toast auto-dismisses after 3 seconds.

3. **Given** a loading toast is visible, **When** the operation fails, **Then** the spinner is replaced by an error indicator, the message updates to describe the failure, and the toast stays visible for 5 seconds before dismissing.

4. **Given** a loading toast is visible, **When** the user clicks the close button, **Then** the toast dismisses immediately regardless of operation state.

5. **Given** a loading toast is already visible, **When** the same operation is triggered again within 2 seconds (e.g., double-click), **Then** no duplicate toast appears (deduplication is enforced).

---

### Edge Cases

- What happens if `.success()` or `.error()` is called after the toast was manually dismissed? → The call is silently ignored; no new toast appears and no error is thrown.
- What happens if the operation never calls `.success()` or `.error()` (e.g., a hung network request)? → The loading toast remains indefinitely until the user manually closes it; it does not auto-dismiss on its own.
- What happens if `.progress()` is called with a value outside 0–100? → Values are clamped to the valid range (0–100) silently.
- What happens if multiple different loading toasts are shown simultaneously? → Each is independent and manages its own lifecycle; they stack in the toast container.
- What happens if the operation result arrives before the toast animation completes? → The final state (success/error) is applied and the toast still transitions correctly.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST display a loading toast immediately when a slow operation begins, showing a spinning indicator and a caller-supplied message.
- **FR-002**: The loading toast MUST remain visible until explicitly resolved (via success, error, or manual dismiss) — it MUST NOT auto-dismiss on its own while in the loading state.
- **FR-003**: The caller MUST be able to transition the loading toast to a success state by providing an optional updated message; the toast MUST then auto-dismiss after 3 seconds.
- **FR-004**: The caller MUST be able to transition the loading toast to an error state by providing an optional updated message; the toast MUST then auto-dismiss after 5 seconds.
- **FR-005**: The loading toast MUST include a manual close button that dismisses it immediately at any point in its lifecycle.
- **FR-006**: The loading toast MUST support an optional visual progress bar that callers can update from 0% to 100% during the operation.
- **FR-007**: The system MUST deduplicate loading toasts: if an identical message is triggered within 2 seconds, the second call is silently ignored and returns a no-op handle.
- **FR-008**: All state transitions (loading → success, loading → error) MUST be reflected visually (icon change, color change, message update) without creating a new toast element.
- **FR-009**: Calling `.success()`, `.error()`, `.progress()`, or `.dismiss()` on a handle after the toast has already been dismissed MUST be a safe no-op (no errors thrown).
- **FR-010**: The loading toast MUST be usable in both light and dark themes with appropriate contrast and legibility.

### Key Entities

- **Loading Toast Handle**: The object returned to the caller when a loading toast is created. Contains methods: `.success(message?)`, `.error(message?)`, `.progress(percent)`, `.dismiss()`. Represents the lifecycle controller for a single in-progress operation notification.
- **Toast State**: The current display state of a loading toast — one of: `loading` (default), `success`, `error`, `dismissed`. Transitions are one-way; a dismissed toast cannot be revived.
- **Progress Bar**: An optional visual sub-element of the loading toast showing operation completion percentage (0–100). Visible only when the caller invokes `.progress()`.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A loading toast appears within 100ms of the triggering action — users perceive immediate feedback with no perceptible delay.
- **SC-002**: 100% of loading toast → success/error transitions occur without creating a new toast element — users see a smooth in-place update, not a flash.
- **SC-003**: After transitioning to success, the toast auto-dismisses in exactly 3 seconds (±200ms); after transitioning to error, exactly 5 seconds (±200ms).
- **SC-004**: Duplicate loading toasts (same message within 2 seconds) are suppressed 100% of the time — users never see stacked identical toasts from double-clicks.
- **SC-005**: Calling `.dismiss()` on an already-dismissed handle produces zero errors in 100% of cases — callers require no defensive guard code.
- **SC-006**: The loading toast is visually legible and correctly themed in both light and dark modes, verified by visual inspection.
- **SC-007**: Manual close button is reachable and functional in 100% of cases during all lifecycle states (loading, success, error).

---

## Assumptions

- The toast container already exists or is created on demand by the existing notification system; this feature does not need to create it from scratch.
- Callers are responsible for calling `.success()` or `.error()` when their operation ends; the loading toast does not have any built-in timeout while loading.
- "Slow operation" is defined from the caller's perspective — this feature makes no judgment about minimum duration; it is the caller's responsibility to decide when to show a loading toast.
- Deduplication threshold (2 seconds, same message) is a reasonable default for this application's usage patterns and does not need to be configurable at this stage.
- The progress bar is optional and purely visual; it does not affect the operation's actual outcome or the toast's lifecycle.
- RTL (right-to-left) layout is required since this is an Arabic-language application; directional properties must be used throughout.

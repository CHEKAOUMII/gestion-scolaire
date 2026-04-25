# Feature Specification: Global Error Boundary

**Feature Branch**: `023-global-error-boundary`
**Created**: 2026-03-31
**Status**: Draft
**Input**: User description: "Phase 3 of the unified message system — Global Error Boundary that catches unhandled JS errors and promise rejections app-wide, surfaces user-friendly Arabic toast notifications with throttling and flood protection."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Unexpected Error Surfaces a Clear Notification (Priority: P1)

A school staff member is using the application when an unexpected internal error occurs (e.g., a background data operation fails silently). Instead of seeing a frozen or broken screen with no explanation, they immediately see a brief, friendly Arabic notification at the corner of the screen informing them that something went wrong. The notification disappears on its own after a few seconds.

**Why this priority**: This is the core value of the feature — turning invisible, confusing failures into visible, user-friendly feedback. Without this, users are left confused with no way to understand why something stopped working.

**Independent Test**: Can be fully tested by deliberately triggering a runtime script error on any page and confirming the Arabic error toast appears, then auto-dismisses — no other features needed.

**Acceptance Scenarios**:

1. **Given** the application is open on any page, **When** an unhandled JavaScript error occurs anywhere in the page scripts, **Then** an Arabic error notification appears within 1 second informing the user that an unexpected error occurred.
2. **Given** the application is open on any page, **When** an asynchronous operation (promise) fails without being caught, **Then** an Arabic error notification appears informing the user that an operation could not be completed.
3. **Given** an error notification has appeared, **When** no user action is taken, **Then** the notification auto-dismisses after a short period (approximately 4–5 seconds).

---

### User Story 2 - Rapid Error Storms Do Not Flood the Screen (Priority: P2)

A school administrator has a page open that enters a broken state causing many errors to fire in quick succession. Instead of seeing dozens of overlapping error toasts that make the UI unusable, they see at most one notification within any short time window, followed — if the errors keep coming — by a single clear Arabic message advising them to reload the page.

**Why this priority**: Without rate limiting, a single bad state can render the entire UI inaccessible behind a wall of notifications. This protects usability when things go wrong badly.

**Independent Test**: Can be fully tested by artificially triggering 6+ errors in rapid succession and confirming only the throttled and flood-protection messages appear — demonstrating the safeguard independently of other error flows.

**Acceptance Scenarios**:

1. **Given** an error notification has just been shown, **When** another error occurs within 3 seconds, **Then** no additional notification is shown (throttle is active).
2. **Given** more than 5 errors occur within a 10-second window, **When** the flood threshold is crossed, **Then** a single Arabic notification appears advising the user to reload the page, and no further individual error toasts appear for that window.
3. **Given** the flood-protection window has expired (10 seconds with no errors), **When** a new error occurs, **Then** the system resets and shows the error notification normally again.

---

### User Story 3 - Errors Are Silently Logged for Diagnosis (Priority: P3)

A system administrator reviewing application logs after a reported incident can see structured records of errors that occurred — including the error message, source location, and stack trace — without the regular user having been interrupted beyond the brief toast.

**Why this priority**: Operational visibility matters for diagnosing production issues, but it must not degrade the end user's experience. This story completes the feature by making errors both visible to users and traceable by administrators.

**Independent Test**: Can be tested by triggering an error and checking the application's log output to confirm a structured record was written — independently of what the UI showed.

**Acceptance Scenarios**:

1. **Given** an unhandled error occurs, **When** the error boundary captures it, **Then** a structured log entry is written containing the error message, source file, line number, and stack trace.
2. **Given** an unhandled promise rejection occurs, **When** the error boundary captures it, **Then** a structured log entry is written containing the rejection reason and stack trace.
3. **Given** flood protection has suppressed display of an error, **When** the error is still captured internally, **Then** the log entry is still written (logging is not throttled, only the visible notification is).

---

### Edge Cases

- What happens when the error notification system itself has not yet loaded when an early page error occurs? The boundary must degrade gracefully — no crash, and the error is still logged even if no toast can be shown.
- What happens when an error fires before the page is fully interactive? The boundary must register as early as possible in the page lifecycle so no errors are missed.
- How does the system handle exactly 5 errors — right at the flood threshold? The 5th error should still show a normal toast; only the 6th triggers flood protection.
- What happens if an error storm stops and then restarts after the 10-second window? Each new 10-second window resets the counter independently.
- What happens when multiple application pages are open concurrently? Each page manages its own error boundary, throttle state, and flood counter independently.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST automatically intercept all unhandled script errors on every application page without requiring page-by-page manual setup beyond including the module.
- **FR-002**: The system MUST automatically intercept all unhandled promise rejections on every application page.
- **FR-003**: When an intercepted error occurs, the system MUST display a brief Arabic-language error notification to the user within 1 second of the error being thrown.
- **FR-004**: The notification for unhandled script errors MUST communicate that "an unexpected error occurred" in user-friendly Arabic language.
- **FR-005**: The notification for unhandled promise rejections MUST communicate that "an operation could not be completed" in user-friendly Arabic language.
- **FR-006**: The system MUST throttle error notifications so that no more than one notification is shown within any 3-second window, regardless of how many errors occur.
- **FR-007**: The system MUST count errors within a rolling 10-second window and, upon exceeding 5 errors in that window, switch to flood-protection mode.
- **FR-008**: In flood-protection mode, the system MUST display a single Arabic notification advising the user to reload the page, and MUST suppress all further individual error notifications for the remainder of that window.
- **FR-009**: At the end of any 10-second error-free period, the system MUST automatically reset flood-protection mode and restore normal notification behaviour.
- **FR-010**: The system MUST write a structured log entry for every intercepted error, including: error type, message, source file, line number, and stack trace (where available).
- **FR-011**: Log entries MUST be written regardless of whether a visible notification was shown — throttling and flood protection affect display only, not logging.
- **FR-012**: Error notifications MUST auto-dismiss without requiring any user interaction.
- **FR-013**: The error boundary MUST be active on every HTML page in the application.

### Key Entities

- **Error Event**: An unhandled runtime script error — carries message text, source file location, line number, and stack trace.
- **Rejection Event**: An unhandled promise rejection — carries the rejection reason and stack trace where available.
- **Error Notification**: The brief Arabic-language toast message shown to the user — has a type (unexpected error / operation failure / flood warning), display duration, and auto-dismiss behaviour.
- **Throttle State**: Per-page in-memory record of the timestamp of the last displayed notification — used to enforce the 3-second quiet period between notifications.
- **Flood Counter**: Per-page in-memory count of errors and the start timestamp of the current counting window — resets after 10 seconds of no errors.
- **Log Entry**: A structured record forwarded to the application's logging channel — contains error type, message, source location, and stack trace.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every unhandled error or promise rejection on any application page results in a visible Arabic notification appearing within 1 second — 100% capture rate with no silent failures reaching the user unnoticed.
- **SC-002**: No more than one error notification is displayed within any 3-second period, even when 10+ errors fire simultaneously — the screen remains usable under error conditions.
- **SC-003**: When more than 5 errors occur within 10 seconds, the user sees exactly one flood-warning notification advising a page reload, and no further individual error toasts appear for that window.
- **SC-004**: After a 10-second error-free period following flood protection, triggering a single new error results in a normal notification — confirming the reset works correctly.
- **SC-005**: Every intercepted error produces a corresponding structured log entry regardless of throttle state, confirmed by counting log entries against triggered errors (1:1 ratio at all throttle levels).
- **SC-006**: The error boundary is present and active on all application pages from the moment each page loads, verified by triggering an early-lifecycle error on at least 3 representative pages and confirming capture in each case.

## Assumptions

- The existing toast notification component (already present in the application) is used to display all error messages — the error boundary does not introduce a new notification UI of its own.
- "Reload the page" is an appropriate user instruction for a desktop application where the user can refresh the current window.
- Structured log entries are forwarded to the application's existing main-process logging channel available via the IPC bridge — no new logging infrastructure is introduced.
- All notification text is in Arabic, consistent with the application's Arabic-language interface.
- Per-page in-memory state (throttle timestamp, flood counter) is acceptable — state does not need to be shared across multiple open pages or persisted across page reloads.
- The error boundary does not attempt to recover from errors or retry failed operations — it is purely observational and communicative.
- Errors originating from third-party vendor scripts (e.g. charting or spreadsheet libraries) are captured the same as application errors — no filtering by source is applied.

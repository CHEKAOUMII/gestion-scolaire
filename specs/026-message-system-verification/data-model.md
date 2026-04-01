# Data Model: Message System — Verification & Polish

**Branch**: `026-message-system-verification` | **Date**: 2026-04-01

---

This feature is a **verification and gap-close pass** — no new data entities are
introduced. The message system operates entirely in transient DOM state (no database
reads or writes, no IPC channels, no localStorage). The entities below are runtime
state objects that live in memory during a page session.

---

## Runtime State Entities

### Confirmation Dialog State

A singleton slot — at most one dialog is active at any time.

| Field | Type | Description |
|-------|------|-------------|
| `overlay` | `HTMLElement` | The `.msg-confirm-overlay` DOM node |
| `resolve` | `Function` | Promise resolve callback |
| `inputEl` | `HTMLElement \| null` | The optional required-input field |

**Lifecycle**: Created on `showConfirm()` call → stored in `_activeConfirm` →
cleared (set to `null`) the moment `_resolveConfirm()` fires.

**Constraint**: If `_activeConfirm` is non-null when `showConfirm()` is called again,
the existing dialog is resolved as `{ confirmed: false }` before the new one opens.

---

### Toast Handle

Returned by `showToast.loading()`. Callers hold this reference to transition state.

| Field | Type | Description |
|-------|------|-------------|
| `success(msg?)` | `Function` | Transitions to success state, schedules dismiss |
| `error(msg?)` | `Function` | Transitions to error state, schedules dismiss |
| `progress(pct)` | `Function` | Updates progress bar width (0–100) |
| `dismiss()` | `Function` | Immediately removes the toast |

**Lifecycle**: Created on `showToast.loading()` → caller invokes one transition
method → toast auto-removes after its dismiss timeout.

---

### Error Boundary State

Module-level counters maintained inside the IIFE in `js/utils.js`.

| Field | Type | Description |
|-------|------|-------------|
| `_lastErrorToastTime` | `number` | Timestamp of last shown error toast (ms) |
| `_errorCount` | `number` | Errors within the current flood window |
| `_errorWindowStart` | `number` | Timestamp when current flood window began |
| `_floodStopped` | `boolean` | Whether the "reload" toast has been shown this window |

**Constraints**:
- Throttle: no second toast within 3 000 ms of the previous one.
- Flood limit: after 5 errors in 10 000 ms, suppress individual toasts and show one "multiple errors" toast. Counter resets when the window expires.

---

## CSS Class Inventory (verification scope)

These classes must exist in `css/tailwind-input.css` and compile into
`css/tailwind-output.css` before any visual test can pass.

| Class | Component | Verified? |
|-------|-----------|-----------|
| `.msg-confirm-overlay` | Confirm dialog backdrop | ❌ Missing |
| `.msg-confirm-overlay.active` | Backdrop visible state | ❌ Missing |
| `.msg-confirm-card` | Dialog card | ❌ Missing |
| `.msg-confirm-header` | Dialog header strip | ❌ Missing |
| `.msg-confirm-header.danger/.warning/.info` | Header accent variants | ❌ Missing |
| `.msg-confirm-title` | Dialog title text | ❌ Missing |
| `.msg-confirm-close` | Close × button | ❌ Missing |
| `.msg-confirm-body` | Body area | ❌ Missing |
| `.msg-confirm-message` | Primary message text | ❌ Missing |
| `.msg-confirm-detail` | Secondary detail text | ❌ Missing |
| `.msg-confirm-input` | Optional required input | ❌ Missing |
| `.msg-confirm-actions` | Button row | ❌ Missing |
| `.field-validation` | Validation label | ❌ Missing |
| `.field-validation.visible` | Animated-in state | ❌ Missing |
| `.field-validation.error/.warning/.success` | Type variants | ❌ Missing |
| `.field-invalid / .field-warning / .field-valid` | Field border states | ❌ Missing |
| `.toast.loading` | Loading toast variant | ❌ Missing |
| `.toast-progress-bar` | Progress bar inside loading toast | ❌ Missing |
| `.toast-action-btn` | Action button inside action toast | ❌ Missing |
| `.toast-close` | Close button inside loading toast | ❌ Missing |

**Note**: `js/message-system.js` (380 lines) and the error boundary in `js/utils.js`
are present and correct. The gap is exclusively CSS + `showToast.loading/action`.

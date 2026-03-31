# Data Model: Global Error Boundary

**Feature**: `023-global-error-boundary`
**Date**: 2026-03-31

---

## Runtime State (in-memory, per page, IIFE-scoped)

These are not persisted. They reset on every page load.

| Variable | Type | Initial Value | Purpose |
|----------|------|---------------|---------|
| `_lastToastTime` | number (timestamp ms) | `0` | Tracks when the last toast was shown; enforces 3-second throttle |
| `_errorCount` | number | `0` | Count of errors in the current 10-second window |
| `_windowStart` | number (timestamp ms) | `0` | Start of the current counting window; resets when window expires |
| `_floodStopped` | boolean | `false` | When `true`, individual toasts are suppressed (flood mode active) |

---

## Persisted Entity: System Log Entry

Written to the existing `system_logs` table via `window.api.systemLogs.add()`. No schema changes required.

| Field | Type | Value for error boundary |
|-------|------|--------------------------|
| `action` | string | `'uncaught_error'` or `'unhandled_rejection'` |
| `details` | string (JSON) | `{ message, filename, lineno, stack }` |
| `entity_type` | string | `'renderer'` |
| `entity_id` | string | `window.location.pathname` (e.g. `'/timetable.html'`) |

### `details` JSON shape

```json
{
  "message":  "Cannot read properties of null (reading 'id')",
  "filename": "file:///D:/gestionScholaire/js/pages/students-list.js",
  "lineno":   342,
  "stack":    "TypeError: Cannot read properties...\n    at Object.<anonymous> ..."
}
```

For `unhandled_rejection`, `filename` and `lineno` are omitted when unavailable; `message` is the stringified rejection reason.

---

## State Transitions

```
Page loads → all state initialised to zero/false

On each error/rejection event:
  1. Log to main process (unconditional)
  2. If now - _windowStart > FLOOD_WINDOW_MS:
       _errorCount = 0, _windowStart = now, _floodStopped = false
  3. _errorCount++
  4. If _errorCount > FLOOD_LIMIT and not _floodStopped:
       _floodStopped = true → show flood toast
  5. Else if _floodStopped:
       skip (no toast)
  6. Else if now - _lastToastTime < THROTTLE_MS:
       skip (throttled)
  7. Else:
       _lastToastTime = now → show error/rejection toast
```

---

## No schema changes

The `system_logs` table already contains all required columns. No migration is needed.

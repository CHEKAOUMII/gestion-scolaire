# Data Model: Loading Toast Variant

**Branch**: `022-loading-toast` | **Date**: 2026-03-31

## Entities

### LoadingToastHandle

The object returned by `showToast.loading(message)`. Represents the lifecycle controller for a single in-progress operation notification.

| Attribute | Type | Description |
|-----------|------|-------------|
| `dismissed` | boolean (internal) | True once the toast has been removed from the DOM. Set by `dismiss()` or auto-dismiss after resolution. |
| `resolved` | boolean (internal) | True once `.success()` or `.error()` has been called. Prevents double-resolution. |

**Methods**:

| Method | Signature | Behaviour |
|--------|-----------|-----------|
| `.success(msg?)` | `(string?) → void` | Transitions toast to success state. Updates icon + class. Optional message replaces original. Auto-dismisses after 3 s. No-op if already dismissed or resolved. |
| `.error(msg?)` | `(string?) → void` | Transitions toast to error state. Updates icon + class. Removes progress bar. Auto-dismisses after 5 s. No-op if already dismissed or resolved. |
| `.progress(pct)` | `(number) → void` | Sets progress bar width to `clamp(0, pct, 100)%`. No-op if dismissed or resolved. |
| `.dismiss()` | `() → void` | Immediately hides and removes the toast. No-op if already dismissed. |

---

### ToastState

An implicit state machine. Transitions are **one-way**; a dismissed toast cannot be revived.

```
[loading] ──.success()──▶ [success] ──3 s──▶ [dismissed]
[loading] ──.error()────▶ [error]   ──5 s──▶ [dismissed]
[loading] ──.dismiss()──▶ [dismissed]
[success] ──.dismiss()──▶ [dismissed]
[error]   ──.dismiss()──▶ [dismissed]
```

---

### ProgressBar (optional sub-element)

| Attribute | Type | Description |
|-----------|------|-------------|
| `width` | string (`0%`–`100%`) | CSS width of the bar; controlled by `.progress(pct)` calls. |
| Lifetime | DOM element inside toast | Removed from DOM when `.error()` is called (error state has no progress bar). |

---

### NoopHandle

Returned by `showToast.loading(message)` when deduplication suppresses the call.

All four methods (`success`, `error`, `progress`, `dismiss`) are empty functions. Callers need no defensive guard code.

---

## State Storage

All state is **ephemeral DOM** — no localStorage, no IPC, no database. The toast element lives in `#toast-container` (created on demand). When the toast is removed, all associated state is garbage-collected.

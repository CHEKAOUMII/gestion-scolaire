# Contract: LoadingToastHandle

**Branch**: `022-loading-toast` | **Date**: 2026-03-31

## Overview

`showToast.loading(message)` is a renderer-side global function that creates a persistent loading toast and returns a **handle** for controlling its lifecycle. This contract defines the exact interface callers must use.

---

## Call Signature

```
showToast.loading(message) → LoadingToastHandle | NoopHandle
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | Yes | Initial text shown in the loading toast (Arabic, RTL) |

**Returns**: A `LoadingToastHandle` if a new toast was created, or a `NoopHandle` if deduplication suppressed the call (same message within 2 seconds).

---

## Handle Methods

### `.success(message?)`

```
handle.success(message?)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | No | Replacement text for the success state. If omitted, original message is kept. |

- Transitions toast from `loading` → `success`
- Icon changes to a check-circle indicator
- Progress bar fills to 100%
- Toast auto-dismisses after **3 seconds**
- **No-op** if already dismissed or resolved

---

### `.error(message?)`

```
handle.error(message?)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `message` | string | No | Replacement text for the error state. If omitted, original message is kept. |

- Transitions toast from `loading` → `error`
- Icon changes to an error indicator
- Progress bar is removed
- Toast auto-dismisses after **5 seconds**
- **No-op** if already dismissed or resolved

---

### `.progress(percent)`

```
handle.progress(percent)
```

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `percent` | number | Yes | Progress percentage, clamped to 0–100 |

- Updates progress bar width
- Values outside 0–100 are silently clamped
- **No-op** if already dismissed or resolved

---

### `.dismiss()`

```
handle.dismiss()
```

- Immediately removes the toast from the DOM
- **No-op** if already dismissed
- Safe to call at any lifecycle state

---

## Deduplication Behaviour

If `showToast.loading(message)` is called with the same `message` value within **2 seconds** of a previous call, the call is silently suppressed and a `NoopHandle` is returned. All four methods on a `NoopHandle` are empty functions — callers need no defensive guard code.

---

## Usage Example

```js
// Caller pattern (Arabic messages, RTL)
var handle = showToast.loading('جاري الاستيراد...');

doSlowOperation()
    .then(function () {
        handle.success('تم الاستيراد بنجاح');
    })
    .catch(function (err) {
        handle.error('فشل الاستيراد، يرجى المحاولة مجدداً');
    });

// Optional: update progress during operation
handle.progress(45);
```

---

## Constraints

- Function is available **only in the renderer process** via `window.showToast.loading`
- No IPC calls are made — entirely DOM-based
- Caller must provide Arabic text for all user-facing messages (RTL requirement)
- Caller is responsible for calling `.success()` or `.error()` when the operation ends — the toast does not auto-dismiss while in the loading state

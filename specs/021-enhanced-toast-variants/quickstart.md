# Quickstart: Enhanced Toast Variants

**Branch**: `021-enhanced-toast-variants` | **Date**: 2026-03-31
**Phase**: 1 — Design & Contracts

---

## What This Feature Adds

Three additive changes to `js/notifications.js` and `css/tailwind-input.css`:

1. **`showToast.loading(message)`** — shows a spinner toast and returns a handle to transition it in-place
2. **`showToast.action(message, actionConfig, opts?)`** — shows a toast with an inline action button
3. **Click-to-dismiss** — all existing standard toasts gain a body-click dismiss handler

No new files. No IPC changes. No HTML changes in this phase.

---

## Files to Modify

| File | Change |
|------|--------|
| `js/notifications.js` | Add `_ensureToastContainer`, `_deduplicateToast`, `_createNoopHandle`, `renderLoadingToast`, `renderActionToast`; modify `renderToast` for click-to-dismiss; attach `.loading` and `.action` on `window.showToast` |
| `css/tailwind-input.css` | Add `.toast.loading`, `.toast-progress-bar`, `.toast-action-btn`, `.toast-close` + dark theme overrides |

---

## Usage Examples

### Loading toast

```js
const handle = showToast.loading('جاري الحفظ...');

// On success
handle.success('تم الحفظ بنجاح');

// On error
handle.error('فشل الحفظ، يرجى المحاولة مجدداً');

// Update progress (0-100)
handle.progress(75);

// Dismiss immediately
handle.dismiss();
```

### Action toast

```js
showToast.action(
    'تم حذف السجل',
    {
        label: 'تراجع',
        icon: 'fa-undo',
        onClick: () => { /* restore logic */ }
    },
    { duration: 8000, type: 'warning' }
);
```

---

## Implementation Insertion Point

All new code goes **inside the existing IIFE** in `js/notifications.js`, between the closing `}` of `renderToast` (line 51) and the `// ===== Notification center helpers =====` comment (line 53).

The final lines of the IIFE change from:

```js
window.showToast = renderToast;
```

to:

```js
window.showToast = renderToast;
window.showToast.loading = renderLoadingToast;
window.showToast.action = renderActionToast;
```

---

## Pre-Merge Checklist (constitution-mandated)

- [ ] `npm run css:build` succeeds (no PostCSS errors)
- [ ] `npm run lint` passes with zero errors
- [ ] `npm run test:smoke` passes (IPC parity, no CDN refs, CSS output updated)
- [ ] Manual visual check: loading toast → success transition in RTL Arabic mode
- [ ] Manual visual check: action toast button click triggers callback only once
- [ ] Manual visual check: dark theme renders correctly for all new toast states
- [ ] Manual visual check: close button appears on the reading-start side (right edge in RTL)

---

## Key Constraints

- **No new npm packages** — pure DOM manipulation, existing CSS variable system
- **No CDN references** — Font Awesome is already vendored
- **RTL-safe CSS** — use `inset-inline-start` not `left` for positioned elements
- **Dark theme** — new CSS classes need `[data-theme="dark"]` overrides in the same source file
- **Arabic strings** — all user-facing message strings in callers must be in Arabic

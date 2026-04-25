# Quickstart: Loading Toast Variant

**Branch**: `022-loading-toast` | **Date**: 2026-03-31

## What Was Built

A persistent loading toast that stays on screen until an async operation resolves, then transitions in-place to success or error. Available globally as `showToast.loading(message)`.

## Status

**Implementation complete** — landed in commit `0d7a23d`. CSS present in `css/tailwind-input.css`. Only verification remains before merge.

---

## Verification Checklist (pre-merge)

Run these steps in order:

```bash
# 1. Rebuild CSS
npm run css:build

# 2. Lint
npm run lint

# 3. Smoke test
npm run test:smoke

# 4. Launch app for visual check
npm run dev
```

**Manual visual check** (required by Constitution §II):

Open DevTools console on any page and run:

```js
// Test 1: loading → success
var h = showToast.loading('جاري الحفظ...');
setTimeout(function () { h.success('تم الحفظ بنجاح'); }, 2000);

// Test 2: loading → error (wait 5s after Test 1 for dedup window)
setTimeout(function () {
    var h2 = showToast.loading('جاري التزامن...');
    setTimeout(function () { h2.error('فشل الاتصال بالخادم'); }, 2000);
}, 7000);

// Test 3: progress bar
setTimeout(function () {
    var h3 = showToast.loading('جاري الاستيراد...');
    var pct = 0;
    var interval = setInterval(function () {
        pct += 10;
        h3.progress(pct);
        if (pct >= 100) {
            clearInterval(interval);
            h3.success('اكتمل الاستيراد');
        }
    }, 300);
}, 15000);
```

Verify in **both light and dark themes** (`[data-theme="dark"]`), and confirm RTL layout is correct (spinner on the right, close button on the left in RTL context).

---

## API Reference

```js
var handle = showToast.loading('جاري التنفيذ...');

handle.success('تمت العملية');        // → success state, auto-dismiss 3s
handle.error('حدث خطأ');            // → error state, auto-dismiss 5s
handle.progress(75);                 // → progress bar at 75%
handle.dismiss();                    // → immediate dismiss
```

---

## Files Changed

| File | Change |
|------|--------|
| [js/notifications.js](../../js/notifications.js) | `renderLoadingToast()` added (lines 91–170); exposed as `window.showToast.loading` |
| [css/tailwind-input.css](../../css/tailwind-input.css) | `.toast.loading`, `.toast-progress-bar`, `.toast-close`, dark-mode overrides |

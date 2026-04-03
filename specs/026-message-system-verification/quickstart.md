# Quickstart: Message System — Verification & Polish

**Branch**: `026-message-system-verification` | **Date**: 2026-04-01

---

## Prerequisites

Before running any verification tests, two blocking gaps from Phases 2–3 must be closed:

1. **CSS classes are missing** — `.msg-confirm-*`, `.field-validation`, and toast variant classes do not yet exist in `css/tailwind-input.css`.
2. **Toast variants are not attached** — `showToast.loading` and `showToast.action` are not declared on `window.showToast` in `js/notifications.js`.

Close both gaps first, then run the verification steps below.

---

## Step 1: Close CSS Gap

Open [css/tailwind-input.css](css/tailwind-input.css) and append the three CSS blocks from the plan (confirm dialog, inline validation, toast variants) to the end of the `@layer components {}` section.

Then rebuild:

```bash
npm run css:build
```

Expected: completes in under 10 seconds, no errors.

---

## Step 2: Close Toast Variants Gap

Open [js/notifications.js](js/notifications.js). The current export on line 227 is:

```js
window.showToast = renderToast;
```

This needs to become:

```js
window.showToast = renderToast;
window.showToast.loading = renderLoadingToast;
window.showToast.action = renderActionToast;
```

The `renderLoadingToast`, `renderActionToast`, and `_ensureToastContainer` functions (from the plan spec) must be added above this line.

Also add click-to-dismiss on the base `renderToast` function after `container.appendChild(toast)`:

```js
toast.style.cursor = 'pointer';
toast.addEventListener('click', function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(function () { toast.remove(); }, 300);
});
```

---

## Step 3: Launch the App

```bash
npm start
```

Open DevTools (F12) on any page. Verify `window.showConfirm`, `window.showToast`, `window.showToast.loading`, and `window.showToast.action` are all defined.

---

## Step 4: Run Verification Tests

### 4a — Dark Theme

1. Toggle to dark mode via the settings gear.
2. Run in console: `showConfirm({ title: 'اختبار', message: 'هذا اختبار', type: 'danger' })`
3. Visually check: card background is dark, text is legible, header bar is red.
4. Run: `showToast('نجح الاختبار', 'success')`
5. Visually check: green toast, legible text.

### 4b — RTL Layout

(Switch back to light mode for clarity.)

1. Open the confirm dialog: `showConfirm({ title: 'اختبار RTL', message: 'تحقق من ترتيب الأزرار' })`
2. Confirm: Cancel is on the **right**, Confirm is on the **left**.
3. Trigger a toast. Confirm text aligns to the right.

### 4c — Keyboard Navigation

1. Open a confirm dialog from the console.
2. Press Tab — focus cycles within the dialog only.
3. Press Escape — dialog closes, focus returns to the trigger.
4. Open again, press Enter on the Confirm button — resolves confirmed.

### 4d — Toast Lifecycle

```js
// Loading toast — success path
const h = showToast.loading('جاري الحفظ...');
setTimeout(() => h.success('تم الحفظ بنجاح'), 2000);

// Loading toast — error path (wait 3s for throttle)
const h2 = showToast.loading('جاري المعالجة...');
setTimeout(() => h2.error('فشلت العملية'), 2000);

// Action toast
showToast.action('تم حذف السجل', { label: 'تراجع', icon: 'fa-undo', onClick: () => console.log('Undo!') });
```

### 4e — Error Boundary

```js
// Single error toast
throw new Error('اختبار الخطأ');

// Flood protection (paste as one block, wait for throttle first)
for (let i = 0; i < 10; i++) window.dispatchEvent(new ErrorEvent('error', { message: 'flood ' + i }));
```

After 5+ rapid errors: only one "multiple errors" toast should appear.

### 4f — Settings-Imports End-to-End

Open `settings-imports.html`. Click any "حذف" (delete) stat card button. Confirm the new `showConfirm()` dialog appears (not the old overlay). Complete the flow.

---

## Step 5: Final Quality Gates

```bash
npm run lint        # Zero errors
npm run css:build   # Succeeds under 10s
npm run test:smoke  # Passes
```

Commit:

```bash
git add css/tailwind-input.css js/notifications.js
git commit -m "feat: complete message system CSS and toast variant attachment"
git add -A
git commit -m "feat: complete unified error and confirmation message system"
```

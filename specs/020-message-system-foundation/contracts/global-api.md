# Global API Contract: Message System Foundation

**Branch**: `020-message-system-foundation` | **Date**: 2026-03-31

> These are the **renderer-global** functions exposed by `js/message-system.js`.
> They become available on `window` after the script loads (deferred).
> No IPC. No main-process surface. No new `preload.js` channels.

---

## `window.showConfirm(config)`

### Signature

```js
showConfirm(config: ConfirmConfig): Promise<ConfirmResult>
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `config.title` | string | No | Dialog heading. Default: `'تأكيد'` |
| `config.message` | string | Yes | Primary body text |
| `config.type` | `'danger' \| 'warning' \| 'info'` | No | Severity. Default: `'info'` |
| `config.icon` | string | No | Font Awesome class (e.g. `'fa-trash'`). Overrides type default |
| `config.confirmText` | string | No | Confirm button label. Default: `'تأكيد'` |
| `config.cancelText` | string | No | Cancel button label. Default: `'إلغاء'` |
| `config.confirmClass` | string | No | CSS class for confirm button. Overrides type default |
| `config.detail` | string | No | Secondary muted text below message |
| `config.requireInput` | boolean | No | Show text input; blocks confirm until filled. Default: `false` |
| `config.inputPlaceholder` | string | No | Placeholder for optional input |

### Return value

```js
Promise<{ confirmed: boolean, inputValue?: string }>
```

| Field | Type | When present | Value |
|-------|------|-------------|-------|
| `confirmed` | boolean | Always | `true` = user confirmed; `false` = cancelled |
| `inputValue` | string | Only when `requireInput: true` | Text the user typed |

### Behaviour guarantees

- Only one dialog open at a time. Calling while a dialog is active resolves the first with `{ confirmed: false }` immediately.
- All cancel paths (Cancel button, × button, backdrop click, Escape key) resolve with `{ confirmed: false }`.
- Dialog element is removed from DOM after the 200ms exit animation.
- Focus is restored to the previously focused element on close (via `openDialog`/`closeDialog` when available).

### Usage

```js
// Simple danger confirmation
const { confirmed } = await showConfirm({
    title: 'حذف التلميذ',
    message: 'هل أنت متأكد من حذف هذا التلميذ نهائياً؟',
    detail: 'لا يمكن التراجع عن هذا الإجراء.',
    type: 'danger',
    confirmText: 'حذف نهائي',
});
if (!confirmed) return;

// With required input
const { confirmed, inputValue } = await showConfirm({
    title: 'تأكيد الاستيراد',
    message: 'اكتب كلمة "تأكيد" للمتابعة',
    type: 'warning',
    requireInput: true,
    inputPlaceholder: 'تأكيد',
    confirmText: 'بدء الاستيراد',
});
```

---

## `window.setFieldValidation(field, message, type)`

### Signature

```js
setFieldValidation(field: HTMLElement, message: string | null, type?: 'error' | 'warning' | 'success'): void
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `field` | HTMLElement | Yes | The input/select/textarea to annotate |
| `message` | string \| null | Yes | Message text. Pass `null` to clear |
| `type` | `'error' \| 'warning' \| 'success'` | No | Severity. Default: `'error'` |

### Behaviour guarantees

- Calling with `message = null` is equivalent to calling `clearValidation` on the field's parent.
- Calling twice on the same field replaces the existing message (no duplicates).
- Detached elements (null `parentNode`) are silently ignored.
- Sets `aria-invalid="true"` on the field for `type: 'error'`; removes it for other types.
- Sets `aria-describedby` on the field pointing to the generated message element ID.

### Usage

```js
const nameField = document.getElementById('student-name');

// Show error
setFieldValidation(nameField, 'اسم التلميذ مطلوب', 'error');

// Show success
setFieldValidation(nameField, 'الاسم صحيح', 'success');

// Clear
setFieldValidation(nameField, null);
```

---

## `window.clearValidation(container)`

### Signature

```js
clearValidation(container: HTMLElement): void
```

### Parameters

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| `container` | HTMLElement | Yes | Parent element to sweep for validation state |

### Behaviour guarantees

- Removes **all** `.field-validation` elements within the container.
- Removes `field-invalid`, `field-warning`, `field-valid` classes from all fields within.
- Removes `aria-invalid` and `aria-describedby` from all affected fields.
- No-op if container has no validation state.
- Does not throw on null/undefined container (guard at top of function).

### Usage

```js
// Clear an entire form on submit or cancel
const form = document.getElementById('student-form');
clearValidation(form);

// Clear a single field's validation
clearValidation(nameField.parentNode);
```

---

## Availability guarantee

All three functions are available on `window` after `js/message-system.js` has loaded.
The script must be added to HTML pages **after** `js/notifications.js` and `js/ux-enhancements.js`
(or at least not before them), to ensure `openDialog`/`closeDialog` are defined first.

```html
<script src="js/utils.js" defer></script>
<script src="js/notifications.js" defer></script>
<script src="js/ux-enhancements.js" defer></script>
<script src="js/message-system.js" defer></script>
```

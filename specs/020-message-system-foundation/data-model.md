# Data Model: Message System Foundation — CSS + Core API

**Branch**: `020-message-system-foundation` | **Date**: 2026-03-31

> This feature is purely renderer-side UI with no database entities. This document
> describes the in-memory state shapes and DOM structures that constitute the
> "data model" for the message system module.

---

## 1. Confirmation Dialog State

### `ConfirmConfig` — Input to `showConfirm()`

| Field | Type | Required | Default | Description |
|-------|------|----------|---------|-------------|
| `title` | string | No | `'تأكيد'` | Dialog header title text (Arabic) |
| `message` | string | Yes | — | Primary body message |
| `type` | `'danger' \| 'warning' \| 'info'` | No | `'info'` | Severity type controlling colors and icon |
| `icon` | string | No | type default | Font Awesome class override (e.g. `'fa-trash'`) |
| `confirmText` | string | No | `'تأكيد'` | Confirm button label |
| `cancelText` | string | No | `'إلغاء'` | Cancel button label |
| `confirmClass` | string | No | type default | CSS class override for confirm button |
| `detail` | string | No | — | Secondary muted text below message |
| `requireInput` | boolean | No | `false` | Whether to show a text input; blocks confirm until filled |
| `inputPlaceholder` | string | No | `''` | Placeholder for the optional input field |

### `ConfirmResult` — Promise resolution value

| Field | Type | Always present | Description |
|-------|------|----------------|-------------|
| `confirmed` | boolean | Yes | `true` if user clicked Confirm; `false` for all cancel paths |
| `inputValue` | string \| undefined | Only when `requireInput: true` | The value the user typed |

### `_ActiveConfirmState` — Module-level singleton (internal)

| Field | Type | Description |
|-------|------|-------------|
| `overlay` | HTMLElement | The `.msg-confirm-overlay` element currently in DOM |
| `resolve` | Function | The Promise resolver for the current dialog |
| `inputEl` | HTMLInputElement \| null | The optional input element, or null |

**State transitions**:
```
null ──showConfirm()──► _activeConfirm set
          │
          ▼
     Dialog open
          │
     ┌────┴──────────────────────────────┐
     │ confirm click / Enter in input    │ cancel / Escape / backdrop / showConfirm() again
     ▼                                   ▼
_resolveConfirm(true)            _resolveConfirm(false)
          │                                │
          └──────────────┬─────────────────┘
                         ▼
              overlay.classList.remove('active')
              setTimeout(overlay.remove, 200ms)
              _activeConfirm = null
              Promise resolves
```

---

## 2. Severity Type Configuration

### `MSG_TYPE_CONFIG` — Static lookup table (internal)

| Type key | `headerClass` | `icon` | `confirmClass` |
|----------|--------------|--------|----------------|
| `danger` | `'danger'` | `'fa-exclamation-triangle'` | `'btn-danger'` |
| `warning` | `'warning'` | `'fa-exclamation-circle'` | `'btn-warning'` |
| `info` | `'info'` | `'fa-info-circle'` | `'btn-primary'` |

---

## 3. Inline Validation State

### Per-field validation (DOM-attached, no JS object)

The validation state for each field is encoded entirely in the DOM:

| DOM indicator | When set | Meaning |
|---------------|----------|---------|
| `field.classList` contains `field-invalid` | `setFieldValidation(field, msg, 'error')` | Error border state |
| `field.classList` contains `field-warning` | `setFieldValidation(field, msg, 'warning')` | Warning border state |
| `field.classList` contains `field-valid` | `setFieldValidation(field, msg, 'success')` | Valid border state |
| `field.getAttribute('aria-invalid')` = `'true'` | Error type only | ARIA error signal |
| `field.getAttribute('aria-describedby')` = `'fv-XXXX'` | Any active validation | Points to message element ID |
| `field.dataset.validationId` | Any active validation | ID of the `.field-validation` div below |
| `.field-validation` div as `field.nextElementSibling` | Inserted by `setFieldValidation` | The visible message element |

### `ValidationMessageElement` — DOM structure

```
<div class="field-validation {type}" id="fv-{random6}" role="{alert|status}">
  <i class="fas {icon}" aria-hidden="true"></i>
  <span>{message text}</span>
</div>
```

| `type` | CSS class | `role` | Icon class |
|--------|-----------|--------|------------|
| `error` | `field-validation error` | `alert` | `fa-exclamation-circle` |
| `warning` | `field-validation warning` | `status` | `fa-exclamation-triangle` |
| `success` | `field-validation success` | `status` | `fa-check-circle` |

**State transitions**:
```
No validation
     │
     ▼ setFieldValidation(field, msg, type)
Field has border class + aria attrs
.field-validation div inserted after field
     │
     ▼ requestAnimationFrame
.field-validation.visible (animated expand)
     │
     ├─► setFieldValidation(field, msg2, type2)  → _clearFieldValidation first, then re-insert
     │
     └─► setFieldValidation(field, null) OR clearValidation(container)
              ▼
         Border class removed, aria attrs removed
         .field-validation div removed
         Back to: No validation
```

---

## 4. CSS Class Inventory

### Confirm Dialog Classes

| Class | Element | Purpose |
|-------|---------|---------|
| `.msg-confirm-overlay` | Root overlay div | Fixed fullscreen backdrop, flex centering |
| `.msg-confirm-overlay.active` | — | Visible state (opacity + visibility transition) |
| `.msg-confirm-card` | Inner card | The visible dialog panel |
| `.msg-confirm-header` | Header row | Icon + title + close button |
| `.msg-confirm-header.danger` | — | Red top border |
| `.msg-confirm-header.warning` | — | Amber top border |
| `.msg-confirm-header.info` | — | Primary blue top border |
| `.msg-confirm-title` | `<h3>` | Title text |
| `.msg-confirm-close` | `<button>` | × close button |
| `.msg-confirm-body` | Body div | Message + detail + optional input |
| `.msg-confirm-message` | `<p>` | Primary message text |
| `.msg-confirm-detail` | `<p>` | Secondary muted text |
| `.msg-confirm-input` | `<input>` | Optional confirmation input |
| `.msg-confirm-actions` | Footer div | Cancel + Confirm buttons |

### Inline Validation Classes

| Class | Element | Purpose |
|-------|---------|---------|
| `.field-validation` | Message div | Base: hidden, zero height |
| `.field-validation.visible` | — | Expanded + opaque (animated) |
| `.field-validation.error` | — | Red text color |
| `.field-validation.warning` | — | Amber text color |
| `.field-validation.success` | — | Green text color |
| `.field-invalid` | Form field | Red border state |
| `.field-warning` | Form field | Amber border state |
| `.field-valid` | Form field | Green border state |

### Toast Variant Classes (additions to existing toast system)

| Class | Element | Purpose |
|-------|---------|---------|
| `.toast.loading` | Toast div | Blue-mist background, spinner variant |
| `.toast-progress-bar` | Child div | Bottom progress bar strip |
| `.toast-action-btn` | `<button>` | Inline action button within toast |
| `.toast-close` | `<button>` | Dismiss × button on loading toast |

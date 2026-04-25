# Error & Confirmation Message System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a unified message system across the entire application with 4 tiers: Enhanced Toasts (loading/action variants), Promise-based Confirmation Dialogs, Inline Validation, and a Global Error Boundary — replacing all fragmented ad-hoc patterns.

**Source Spec:** `docs/superpowers/specs/2026-03-31-error-confirmation-message-system.md`

**Architecture:** Renderer-side only. Single new file `js/message-system.js` provides `showConfirm()`, `setFieldValidation()`, `clearValidation()`. Extended toast variants added to existing `js/notifications.js`. Global error boundary added to `js/utils.js`. No IPC or main-process changes.

**Tech Stack:** Vanilla JS, existing CSS variables, existing `openDialog()`/`closeDialog()` from `js/ux-enhancements.js`, Font Awesome icons.

---

## Files Map

| Action | File | Responsibility |
|--------|------|----------------|
| New | `js/message-system.js` | `showConfirm()`, `setFieldValidation()`, `clearValidation()` |
| Modify | `js/notifications.js` | Add `showToast.loading()`, `showToast.action()` variants |
| Modify | `js/utils.js` | Global error boundary (Tier 4) |
| Modify | `css/tailwind-input.css` | Confirm dialog, validation, toast variant styles |
| Modify | `settings-imports.html` | Replace ad-hoc confirm overlay with `showConfirm()` |
| Modify | `js/pages/settings-imports.js` | Wire `showConfirm()` for delete/clear operations |
| Modify | `js/pages/timetable.js` | Remove duplicate `showToast()` definition |
| Modify | All `.html` pages | Add `<script src="js/message-system.js" defer>` |
| No change | `main/notifications/` | Main process engine — untouched |
| No change | `preload.js` | No new IPC channels |
| No change | `js/ux-enhancements.js` | Reuses existing `openDialog()`/`closeDialog()` as-is |

---

## Phase 1: Foundation — CSS + Core API

> Spec Kit cycle 1: Lay the visual foundation and core JavaScript module.

### Task 1.1: Add confirmation dialog CSS

**Files:** `css/tailwind-input.css`

- [ ] **Step 1: Add `.msg-confirm-*` styles at the end of the components section**

Find the closing `}` of the last component block (near the import-confirm styles) and add:

```css
/* ============================
   Message System — Confirm Dialog
   ============================ */
.msg-confirm-overlay {
    position: fixed;
    inset: 0;
    z-index: 10050;
    display: flex;
    align-items: center;
    justify-content: center;
    background: rgba(15, 23, 42, 0.55);
    backdrop-filter: blur(4px);
    -webkit-backdrop-filter: blur(4px);
    opacity: 0;
    visibility: hidden;
    transition: opacity 0.2s ease, visibility 0.2s ease;
    padding: 16px;
}

.msg-confirm-overlay.active {
    opacity: 1;
    visibility: visible;
}

.msg-confirm-card {
    width: min(480px, 92vw);
    background: var(--color-surface, #fff);
    border-radius: var(--radius-lg, 16px);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.25);
    overflow: hidden;
    transform: scale(0.92) translateY(12px);
    transition: transform 0.2s cubic-bezier(0.34, 1.56, 0.64, 1);
}

.msg-confirm-overlay.active .msg-confirm-card {
    transform: scale(1) translateY(0);
}

.msg-confirm-header {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 16px 20px;
    border-top: 4px solid var(--color-primary);
    border-bottom: 1px solid var(--color-accent, #e5e7eb);
}

.msg-confirm-header.danger { border-top-color: var(--color-danger-solid); }
.msg-confirm-header.warning { border-top-color: var(--color-warning-solid); }
.msg-confirm-header.info { border-top-color: var(--color-primary); }

.msg-confirm-header i {
    font-size: 20px;
    flex-shrink: 0;
}

.msg-confirm-header.danger i { color: var(--color-danger-solid); }
.msg-confirm-header.warning i { color: var(--color-warning-solid); }
.msg-confirm-header.info i { color: var(--color-primary); }

.msg-confirm-title {
    flex: 1;
    font-size: 16px;
    font-weight: 700;
    color: var(--color-text-main);
    margin: 0;
}

.msg-confirm-close {
    border: none;
    background: transparent;
    font-size: 18px;
    cursor: pointer;
    color: var(--color-text-muted);
    padding: 4px;
    border-radius: var(--radius-sm, 6px);
    transition: background 0.15s, color 0.15s;
}

.msg-confirm-close:hover {
    background: var(--color-surface-hover, rgba(0, 0, 0, 0.06));
    color: var(--color-text-main);
}

.msg-confirm-body {
    padding: 20px;
}

.msg-confirm-message {
    font-size: 14px;
    color: var(--color-text-main);
    line-height: 1.6;
    margin: 0 0 6px 0;
}

.msg-confirm-detail {
    font-size: 13px;
    color: var(--color-text-muted);
    line-height: 1.5;
    margin: 0;
}

.msg-confirm-input {
    width: 100%;
    margin-top: 14px;
    padding: 10px 14px;
    border: 1px solid var(--color-accent, #d1d5db);
    border-radius: var(--radius-sm, 8px);
    background: var(--color-surface, #fff);
    color: var(--color-text-main);
    font-family: var(--font-main);
    font-size: 14px;
    transition: border-color 0.2s;
}

.msg-confirm-input:focus {
    outline: none;
    border-color: var(--color-primary);
    box-shadow: 0 0 0 3px var(--color-primary-mist, rgba(59, 106, 197, 0.15));
}

.msg-confirm-actions {
    display: flex;
    gap: 10px;
    justify-content: flex-end;
    padding: 14px 20px;
    border-top: 1px solid var(--color-accent, #e5e7eb);
}

.msg-confirm-actions .btn {
    min-width: 90px;
    font-size: 13px;
    font-weight: 600;
}

/* Dark theme overrides */
[data-theme='dark'] .msg-confirm-card {
    background: var(--color-surface, #1e293b);
    box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
}

[data-theme='dark'] .msg-confirm-overlay {
    background: rgba(0, 0, 0, 0.65);
}
```

- [ ] **Step 2: Add inline validation CSS**

```css
/* ============================
   Message System — Inline Validation
   ============================ */
.field-validation {
    display: flex;
    align-items: center;
    gap: 6px;
    font-size: 12px;
    margin-top: 4px;
    padding: 0 2px;
    overflow: hidden;
    max-height: 0;
    opacity: 0;
    transition: max-height 0.15s ease, opacity 0.15s ease, margin 0.15s ease;
}

.field-validation.visible {
    max-height: 40px;
    opacity: 1;
    margin-top: 6px;
}

.field-validation.error {
    color: var(--color-danger-solid);
}

.field-validation.warning {
    color: var(--color-warning-solid);
}

.field-validation.success {
    color: var(--color-success-solid, #10b981);
}

.field-validation i {
    font-size: 12px;
    flex-shrink: 0;
}

/* Field border states */
.field-invalid {
    border-color: var(--color-danger-solid) !important;
}

.field-warning {
    border-color: var(--color-warning-solid) !important;
}

.field-valid {
    border-color: var(--color-success-solid, #10b981) !important;
}
```

- [ ] **Step 3: Add enhanced toast variant CSS**

```css
/* ============================
   Message System — Toast Variants
   ============================ */
.toast.loading {
    background: var(--color-primary-mist, #eff6ff);
    border-right-color: var(--color-primary);
}

.toast.loading i.fa-spinner {
    animation: spin 1s linear infinite;
}

.toast .toast-progress-bar {
    position: absolute;
    bottom: 0;
    right: 0;
    height: 3px;
    background: var(--color-primary);
    border-radius: 0 0 var(--radius-sm, 8px) 0;
    transition: width 0.3s ease;
}

.toast .toast-action-btn {
    margin-inline-start: 10px;
    padding: 4px 12px;
    border: 1px solid currentColor;
    border-radius: var(--radius-sm, 6px);
    background: transparent;
    color: inherit;
    font-family: var(--font-main);
    font-size: 12px;
    font-weight: 600;
    cursor: pointer;
    white-space: nowrap;
    transition: background 0.15s;
}

.toast .toast-action-btn:hover {
    background: rgba(255, 255, 255, 0.2);
}

.toast .toast-close {
    position: absolute;
    top: 6px;
    left: 6px;
    border: none;
    background: transparent;
    color: inherit;
    font-size: 12px;
    cursor: pointer;
    opacity: 0.5;
    padding: 2px 4px;
    border-radius: 4px;
    transition: opacity 0.15s;
}

.toast .toast-close:hover {
    opacity: 1;
}
```

- [ ] **Step 4: Rebuild Tailwind CSS**

```bash
cd d:/gestionScholaire
npm run css:build
```

Expected: `css/tailwind-output.css` updated with no errors.

- [ ] **Step 5: Commit**

```bash
git add css/tailwind-input.css
git commit -m "style: add message system CSS (confirm dialog, validation, toast variants)"
```

---

### Task 1.2: Create `js/message-system.js` — showConfirm API

**Files:** New file `js/message-system.js`

- [ ] **Step 1: Create the file with showConfirm implementation**

Create `js/message-system.js` with the following content. The function creates DOM elements dynamically, leverages `openDialog()`/`closeDialog()` from `ux-enhancements.js` for focus trapping, and returns a Promise:

```js
/**
 * Message System — Unified confirmations and validation
 * نظام الرسائل الموحد — تأكيدات والتحقق من الحقول
 */
(function () {
    'use strict';

    const MSG_TYPE_CONFIG = {
        danger: {
            headerClass: 'danger',
            icon: 'fa-exclamation-triangle',
            confirmClass: 'btn-danger'
        },
        warning: {
            headerClass: 'warning',
            icon: 'fa-exclamation-circle',
            confirmClass: 'btn-warning'
        },
        info: {
            headerClass: 'info',
            icon: 'fa-info-circle',
            confirmClass: 'btn-primary'
        }
    };

    let _activeConfirm = null;

    /**
     * showConfirm — Promise-based confirmation dialog
     *
     * @param {Object} config
     * @param {string} config.title
     * @param {string} config.message
     * @param {string} [config.type='info']        — 'danger' | 'warning' | 'info'
     * @param {string} [config.icon]               — FontAwesome class override
     * @param {string} [config.confirmText='تأكيد']
     * @param {string} [config.cancelText='إلغاء']
     * @param {string} [config.detail]             — secondary text
     * @param {boolean} [config.requireInput]      — show input, disable confirm until filled
     * @param {string}  [config.inputPlaceholder]
     * @returns {Promise<{ confirmed: boolean, inputValue?: string }>}
     */
    function showConfirm(config) {
        // Close any existing confirm
        if (_activeConfirm) {
            _resolveConfirm(false);
        }

        return new Promise((resolve) => {
            const type = config.type || 'info';
            const typeConfig = MSG_TYPE_CONFIG[type] || MSG_TYPE_CONFIG.info;
            const icon = config.icon || typeConfig.icon;
            const confirmText = config.confirmText || 'تأكيد';
            const cancelText = config.cancelText || 'إلغاء';
            const confirmBtnClass = config.confirmClass || typeConfig.confirmClass;

            // Build DOM
            const overlay = document.createElement('div');
            overlay.className = 'msg-confirm-overlay';
            overlay.setAttribute('role', 'alertdialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'msg-confirm-title');
            overlay.setAttribute('aria-describedby', 'msg-confirm-message');

            let inputHTML = '';
            if (config.requireInput) {
                inputHTML = `<input class="msg-confirm-input" id="msg-confirm-input"
                    type="text" placeholder="${_escHtml(config.inputPlaceholder || '')}"
                    autocomplete="off" />`;
            }

            let detailHTML = '';
            if (config.detail) {
                detailHTML = `<p class="msg-confirm-detail">${_escHtml(config.detail)}</p>`;
            }

            overlay.innerHTML = `
                <div class="msg-confirm-card">
                    <div class="msg-confirm-header ${typeConfig.headerClass}">
                        <i class="fas ${icon}"></i>
                        <h3 class="msg-confirm-title" id="msg-confirm-title">${_escHtml(config.title || 'تأكيد')}</h3>
                        <button type="button" class="msg-confirm-close" data-action="cancel" aria-label="إغلاق">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                    <div class="msg-confirm-body">
                        <p class="msg-confirm-message" id="msg-confirm-message">${_escHtml(config.message || '')}</p>
                        ${detailHTML}
                        ${inputHTML}
                    </div>
                    <div class="msg-confirm-actions">
                        <button type="button" class="btn btn-secondary" data-action="cancel">
                            <i class="fas fa-times"></i> ${_escHtml(cancelText)}
                        </button>
                        <button type="button" class="btn ${confirmBtnClass}" data-action="confirm" id="msg-confirm-ok">
                            <i class="fas fa-check"></i> ${_escHtml(confirmText)}
                        </button>
                    </div>
                </div>
            `;

            document.body.appendChild(overlay);

            const confirmBtn = overlay.querySelector('[data-action="confirm"]');
            const inputEl = overlay.querySelector('#msg-confirm-input');

            // Disable confirm if requireInput and empty
            if (config.requireInput && confirmBtn) {
                confirmBtn.disabled = true;
                if (inputEl) {
                    inputEl.addEventListener('input', () => {
                        confirmBtn.disabled = !inputEl.value.trim();
                    });
                }
            }

            // Store state
            _activeConfirm = { overlay, resolve, inputEl };

            // Show with animation
            requestAnimationFrame(() => {
                overlay.classList.add('active');
            });

            // Use existing openDialog for focus trap if available
            if (typeof openDialog === 'function') {
                openDialog(overlay, {
                    contentSelector: '.msg-confirm-card',
                    initialFocus: config.requireInput ? '#msg-confirm-input' : '#msg-confirm-ok',
                    onCloseRequest: () => _resolveConfirm(false)
                });
            } else {
                // Fallback focus
                requestAnimationFrame(() => {
                    const target = config.requireInput ? inputEl : confirmBtn;
                    target?.focus();
                });
            }

            // Event delegation
            overlay.addEventListener('click', (e) => {
                const action = e.target.closest('[data-action]')?.dataset.action;
                if (action === 'confirm') _resolveConfirm(true);
                else if (action === 'cancel') _resolveConfirm(false);
                else if (e.target === overlay) _resolveConfirm(false); // overlay click
            });

            // Keyboard
            overlay.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    _resolveConfirm(false);
                }
                if (e.key === 'Enter' && e.target === inputEl && !confirmBtn.disabled) {
                    e.preventDefault();
                    _resolveConfirm(true);
                }
            });
        });
    }

    function _resolveConfirm(confirmed) {
        if (!_activeConfirm) return;
        const { overlay, resolve, inputEl } = _activeConfirm;
        const inputValue = inputEl ? inputEl.value : undefined;
        _activeConfirm = null;

        overlay.classList.remove('active');

        // Close via openDialog system if available
        if (typeof closeDialog === 'function') {
            closeDialog(overlay);
        }

        setTimeout(() => {
            overlay.remove();
        }, 200);

        resolve({ confirmed, inputValue });
    }

    // ===== Inline Validation =====

    const VALIDATION_ICON = {
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        success: 'fa-check-circle'
    };

    const VALIDATION_FIELD_CLASS = {
        error: 'field-invalid',
        warning: 'field-warning',
        success: 'field-valid'
    };

    /**
     * Show/update validation state on a form field.
     * @param {HTMLElement} field     — input/select/textarea
     * @param {string|null} message  — null to clear
     * @param {'error'|'warning'|'success'} [type='error']
     */
    function setFieldValidation(field, message, type) {
        if (!field) return;
        type = type || 'error';

        // Remove existing
        _clearFieldValidation(field);

        if (!message) return;

        // Add field border class
        const cls = VALIDATION_FIELD_CLASS[type];
        if (cls) field.classList.add(cls);

        // Set ARIA
        if (type === 'error') field.setAttribute('aria-invalid', 'true');

        // Create message element
        const div = document.createElement('div');
        div.className = `field-validation ${type}`;
        div.setAttribute('role', type === 'error' ? 'alert' : 'status');

        const id = 'fv-' + Math.random().toString(36).slice(2, 8);
        div.id = id;

        const icon = document.createElement('i');
        icon.className = `fas ${VALIDATION_ICON[type] || VALIDATION_ICON.error}`;
        icon.setAttribute('aria-hidden', 'true');

        const span = document.createElement('span');
        span.textContent = message;

        div.appendChild(icon);
        div.appendChild(span);

        field.setAttribute('aria-describedby', id);
        field.parentNode.insertBefore(div, field.nextSibling);

        // Trigger animation
        requestAnimationFrame(() => div.classList.add('visible'));
    }

    function _clearFieldValidation(field) {
        if (!field) return;
        field.classList.remove('field-invalid', 'field-warning', 'field-valid');
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');

        const next = field.nextElementSibling;
        if (next && next.classList.contains('field-validation')) {
            next.remove();
        }
    }

    /**
     * Clear all validation messages within a container.
     * @param {HTMLElement} container
     */
    function clearValidation(container) {
        if (!container) return;
        container.querySelectorAll('.field-validation').forEach(el => el.remove());
        container.querySelectorAll('.field-invalid, .field-warning, .field-valid').forEach(el => {
            el.classList.remove('field-invalid', 'field-warning', 'field-valid');
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-describedby');
        });
    }

    // ===== Helpers =====

    function _escHtml(str) {
        const div = document.createElement('div');
        div.textContent = String(str || '');
        return div.innerHTML;
    }

    // ===== Global Exports =====
    window.showConfirm = showConfirm;
    window.setFieldValidation = setFieldValidation;
    window.clearValidation = clearValidation;
})();
```

- [ ] **Step 2: Verify the file loads without errors**

Temporarily add `<script src="js/message-system.js" defer></script>` to `index.html` and check DevTools console — no errors. Test `showConfirm({ title: 'Test', message: 'Test message', type: 'info' })` in console.

- [ ] **Step 3: Commit**

```bash
git add js/message-system.js
git commit -m "feat: add message-system.js with showConfirm, setFieldValidation, clearValidation"
```

---

## Phase 2: Enhanced Toast Variants

> Spec Kit cycle 2: Extend the existing toast system with loading and action variants.

### Task 2.1: Add `showToast.loading()` and `showToast.action()` to notifications.js

**Files:** `js/notifications.js`

- [ ] **Step 1: Add loading toast variant**

After the `renderToast` function definition (line ~51) and before the notification center helpers section, add:

```js
// ===== Enhanced toast variants =====

var MAX_VISIBLE_TOASTS = 4;
var _toastQueue = [];
var _lastToastMessage = '';
var _lastToastTime = 0;

function _deduplicateToast(message) {
    var now = Date.now();
    if (message === _lastToastMessage && now - _lastToastTime < 2000) return true;
    _lastToastMessage = message;
    _lastToastTime = now;
    return false;
}

function _getVisibleToastCount() {
    var container = document.getElementById('toast-container');
    return container ? container.children.length : 0;
}

function renderLoadingToast(message) {
    if (_deduplicateToast(message)) return _createNoopHandle();

    var container = _ensureToastContainer();
    var toast = document.createElement('div');
    toast.className = 'toast loading';
    toast.style.position = 'relative';

    var spinner = document.createElement('i');
    spinner.className = 'fas fa-spinner fa-spin';

    var span = document.createElement('span');
    span.textContent = message;

    var progressBar = document.createElement('div');
    progressBar.className = 'toast-progress-bar';
    progressBar.style.width = '0%';

    var closeBtn = document.createElement('button');
    closeBtn.className = 'toast-close';
    closeBtn.innerHTML = '<i class="fas fa-times"></i>';
    closeBtn.setAttribute('aria-label', 'إغلاق');

    toast.appendChild(spinner);
    toast.appendChild(span);
    toast.appendChild(progressBar);
    toast.appendChild(closeBtn);
    container.appendChild(toast);

    var dismissed = false;

    function dismiss() {
        if (dismissed) return;
        dismissed = true;
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(function () { toast.remove(); }, 300);
    }

    closeBtn.addEventListener('click', dismiss);

    return {
        success: function (msg) {
            if (dismissed) return;
            spinner.className = 'fas fa-check-circle';
            toast.className = 'toast success';
            if (msg) span.textContent = msg;
            progressBar.style.width = '100%';
            setTimeout(dismiss, 3000);
        },
        error: function (msg) {
            if (dismissed) return;
            spinner.className = 'fas fa-exclamation-circle';
            toast.className = 'toast error';
            if (msg) span.textContent = msg;
            progressBar.remove();
            setTimeout(dismiss, 5000);
        },
        progress: function (percent) {
            if (dismissed) return;
            var clamped = Math.max(0, Math.min(100, Number(percent) || 0));
            progressBar.style.width = clamped + '%';
        },
        dismiss: dismiss
    };
}

function _createNoopHandle() {
    return { success: function(){}, error: function(){}, progress: function(){}, dismiss: function(){} };
}

function renderActionToast(message, actionConfig, opts) {
    if (_deduplicateToast(message)) return;
    opts = opts || {};
    var duration = opts.duration || 8000;

    var container = _ensureToastContainer();
    var toast = document.createElement('div');
    toast.className = 'toast ' + (opts.type || 'info');

    var icon = document.createElement('i');
    var iconMap = { success: 'fa-check-circle', error: 'fa-exclamation-circle', warning: 'fa-exclamation-triangle', info: 'fa-info-circle' };
    icon.className = 'fas ' + (iconMap[opts.type] || iconMap.info);

    var span = document.createElement('span');
    span.textContent = message;

    toast.appendChild(icon);
    toast.appendChild(span);

    if (actionConfig && actionConfig.label) {
        var actionBtn = document.createElement('button');
        actionBtn.className = 'toast-action-btn';
        actionBtn.type = 'button';
        if (actionConfig.icon) {
            actionBtn.innerHTML = '<i class="fas ' + actionConfig.icon + '"></i> ';
        }
        actionBtn.appendChild(document.createTextNode(actionConfig.label));
        actionBtn.addEventListener('click', function () {
            if (typeof actionConfig.onClick === 'function') actionConfig.onClick();
            dismissToast();
        });
        toast.appendChild(actionBtn);
    }

    container.appendChild(toast);

    function dismissToast() {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(function () { toast.remove(); }, 300);
    }

    toast.addEventListener('click', function (e) {
        if (e.target.closest('.toast-action-btn')) return;
        dismissToast();
    });

    setTimeout(dismissToast, duration);
}

function _ensureToastContainer() {
    var container = document.getElementById('toast-container');
    if (!container) {
        container = document.createElement('div');
        container.id = 'toast-container';
        container.className = 'toast-container';
        document.body.appendChild(container);
    }
    return container;
}
```

- [ ] **Step 2: Attach variants as properties of `window.showToast`**

Find the line `window.showToast = renderToast;` (line ~227) and replace with:

```js
window.showToast = renderToast;
window.showToast.loading = renderLoadingToast;
window.showToast.action = renderActionToast;
```

- [ ] **Step 3: Add click-to-dismiss on all toasts**

In the existing `renderToast` function, after `container.appendChild(toast);` add:

```js
toast.style.cursor = 'pointer';
toast.addEventListener('click', function () {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(-20px)';
    setTimeout(function () { toast.remove(); }, 300);
});
```

- [ ] **Step 4: Verify in DevTools console**

```js
// Test loading toast
const h = showToast.loading('جاري الحفظ...');
setTimeout(() => h.success('تم الحفظ'), 2000);

// Test action toast
showToast.action('تم حذف السجل', { label: 'تراجع', icon: 'fa-undo', onClick: () => alert('Undo!') });
```

- [ ] **Step 5: Commit**

```bash
git add js/notifications.js
git commit -m "feat: add showToast.loading() and showToast.action() enhanced variants"
```

---

## Phase 3: Global Error Boundary

> Spec Kit cycle 3: Catch and surface unhandled errors gracefully.

### Task 3.1: Add error boundary to `js/utils.js`

**Files:** `js/utils.js`

- [ ] **Step 1: Add error boundary at the very top of `js/utils.js` (after the initial comment block)**

Insert after line 4 (`*/`):

```js
// ===== Global Error Boundary =====
(function () {
    var _lastErrorToastTime = 0;
    var _errorCount = 0;
    var _errorWindowStart = 0;
    var ERROR_THROTTLE_MS = 3000;
    var ERROR_FLOOD_LIMIT = 5;
    var ERROR_FLOOD_WINDOW_MS = 10000;
    var _floodStopped = false;

    function _shouldShowErrorToast(message) {
        var now = Date.now();

        // Reset flood counter if window expired
        if (now - _errorWindowStart > ERROR_FLOOD_WINDOW_MS) {
            _errorCount = 0;
            _errorWindowStart = now;
            _floodStopped = false;
        }

        _errorCount++;

        // Flood protection
        if (_errorCount > ERROR_FLOOD_LIMIT) {
            if (!_floodStopped) {
                _floodStopped = true;
                if (typeof showToast === 'function') {
                    showToast('أخطاء متعددة — يرجى إعادة تحميل الصفحة', 'error', 8000);
                }
            }
            return false;
        }

        // Throttle
        if (now - _lastErrorToastTime < ERROR_THROTTLE_MS) return false;
        _lastErrorToastTime = now;
        return true;
    }

    function _logToMain(data) {
        try {
            if (window.api && window.api.logs && window.api.logs.error) {
                window.api.logs.error(data);
            }
        } catch (_) {}
    }

    window.addEventListener('error', function (event) {
        console.error('[GlobalError]', event.error || event.message);
        _logToMain({
            type: 'uncaught_error',
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            stack: event.error ? event.error.stack : ''
        });
        if (_shouldShowErrorToast(event.message)) {
            if (typeof showToast === 'function') {
                showToast('حدث خطأ غير متوقع', 'error', 5000);
            }
        }
    });

    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason || {};
        console.error('[UnhandledRejection]', reason);
        _logToMain({
            type: 'unhandled_rejection',
            message: String(reason.message || reason),
            stack: reason.stack || ''
        });
        if (_shouldShowErrorToast(String(reason))) {
            if (typeof showToast === 'function') {
                showToast('خطأ في معالجة العملية', 'error', 4000);
            }
        }
    });
})();
```

- [ ] **Step 2: Verify error boundary works**

In DevTools console:
```js
// Should trigger error toast
throw new Error('Test error');

// Should trigger rejection toast (wait 3s for throttle)
Promise.reject('Test rejection');
```

- [ ] **Step 3: Commit**

```bash
git add js/utils.js
git commit -m "feat: add global error boundary with throttling and flood protection"
```

---

## Phase 4: Remove duplicates + wire script across pages

> Spec Kit cycle 4: Clean up dead code and integrate the new module everywhere.

### Task 4.1: Remove duplicate showToast from timetable.js

**Files:** `js/pages/timetable.js`

- [ ] **Step 1: Find and remove the duplicate `showToast` function**

Search for `function showToast(` in `js/pages/timetable.js` (line ~1811). Remove the entire function definition (approximately 20 lines). The global `window.showToast` from `notifications.js` will be used instead.

- [ ] **Step 2: Verify the timetable page still shows toasts correctly**

Open timetable page, trigger an action that shows a toast (e.g., import). Confirm toast appears correctly.

- [ ] **Step 3: Commit**

```bash
git add js/pages/timetable.js
git commit -m "refactor: remove duplicate showToast from timetable.js (use global)"
```

---

### Task 4.2: Add `message-system.js` script tag to all HTML pages

**Files:** All `.html` pages (30+ files)

- [ ] **Step 1: Add `<script src="js/message-system.js" defer></script>` to every HTML page**

Insert it right after the `<script src="js/notifications.js" defer></script>` line (or after `<script src="js/utils.js" defer></script>` if notifications.js is not present).

Affected files (full list):
```
index.html, login.html, setup.html,
students-list.html, students-register.html, students-files.html,
students-movement.html, students-status.html,
teachers-list.html, teachers-schedule.html, teachers-absence.html,
teachers-performance.html,
staff-attendance.html, staff-daily-report.html,
timetable.html, timetable-redistribution.html, timetable-students.html,
timetable-rooms.html, timetable-teachers.html,
results-hub.html, analytics.html, grades-sheets.html, grades-results.html,
student-support.html, support-sessions.html,
absence-weekly.html, absence-students.html, absence-correspondence.html,
absence-analytics.html,
exams-schedule.html, exams-proctors.html, exams-rooms.html, exams-tests.html,
reports-certificates.html, reports-forms.html, reports-semester.html,
settings-imports.html, settings-school.html, settings-users.html,
settings-license.html, settings-logs.html, settings-sync.html,
compensation-tracking.html
```

- [ ] **Step 2: Spot-check 3 pages: open DevTools console → verify `window.showConfirm` is defined**

- [ ] **Step 3: Commit**

```bash
git add *.html
git commit -m "chore: add message-system.js script tag to all HTML pages"
```

---

## Phase 5: Migration — Replace ad-hoc patterns

> Spec Kit cycle 5: Replace existing fragmented confirmations with the unified system.

### Task 5.1: Replace settings-imports.html confirm overlay

**Files:** `settings-imports.html`, `js/pages/settings-imports.js`

- [ ] **Step 1: Remove the ad-hoc confirmation overlay HTML from `settings-imports.html`**

Delete the entire block from `<div class="import-confirm-overlay"` to its closing `</div>` (lines ~600–617).

- [ ] **Step 2: In `js/pages/settings-imports.js`, replace the old confirm show/hide logic with `showConfirm()`**

Find where the overlay is shown (e.g. `document.getElementById('import-confirm-overlay').classList.add('active')`) and replace the entire flow with:

```js
const { confirmed } = await showConfirm({
    title: 'تأكيد الاستيراد',
    message: confirmMessage,  // dynamically built message
    type: 'info',
    icon: 'fa-cloud-upload-alt',
    confirmText: 'بدء الاستيراد',
    cancelText: 'إلغاء',
});
if (!confirmed) return;
```

- [ ] **Step 3: Add `showConfirm()` to all delete/clear stat card buttons**

For each `btn-clear-*` button (`btn-clear-students`, `btn-clear-grades`, `btn-clear-absences`, `btn-clear-timetable`, `btn-clear-status`, `btn-clear-teachers`), wrap the handler with:

```js
document.getElementById('btn-clear-students').addEventListener('click', async () => {
    const { confirmed } = await showConfirm({
        title: 'حذف بيانات التلاميذ',
        message: 'هل أنت متأكد من حذف جميع بيانات التلاميذ لهذه السنة؟',
        detail: 'لا يمكن التراجع عن هذا الإجراء.',
        type: 'danger',
        confirmText: 'حذف نهائي',
    });
    if (!confirmed) return;
    // existing delete logic here
});
```

- [ ] **Step 4: Remove now-unused import-confirm CSS** (optional — keep for backward compat or remove)

- [ ] **Step 5: Test all 6 delete buttons + import confirmation flow**

- [ ] **Step 6: Commit**

```bash
git add settings-imports.html js/pages/settings-imports.js
git commit -m "refactor: replace ad-hoc import confirm overlay with showConfirm()"
```

---

### Task 5.2: Audit and replace bare `window.confirm()` calls

**Files:** Multiple JS files

- [ ] **Step 1: Search entire codebase for `window.confirm(` and `confirm(`**

```bash
grep -rn "window.confirm\|[^w]confirm(" js/ --include="*.js" | grep -v node_modules | grep -v message-system
```

- [ ] **Step 2: Replace each usage with `await showConfirm()`**

For each match, convert the synchronous `if (confirm('...'))` to an async `showConfirm()` call. Ensure the containing function becomes `async` if not already.

- [ ] **Step 3: Test each affected page**

- [ ] **Step 4: Commit**

```bash
git add js/
git commit -m "refactor: replace all window.confirm() with unified showConfirm()"
```

---

## Phase 6: Verification & Polish

> Spec Kit cycle 6: End-to-end testing and quality pass.

### Task 6.1: Full test pass

- [ ] **Step 1: Test dark theme** — Toggle to dark mode, verify: confirm dialog, toasts, validation messages all render correctly with proper contrast.

- [ ] **Step 2: Test RTL layout** — Confirm dialog buttons are right-to-left ordered (cancel on right, confirm on left). Toast close button is on left side. Validation messages align properly.

- [ ] **Step 3: Keyboard navigation test:**
  - Open a confirm dialog → Tab cycles through buttons
  - Escape closes dialog
  - Enter on confirm button confirms
  - Focus returns to trigger element after close

- [ ] **Step 4: Screen reader test (optional)** — Verify `aria-live`, `role="alertdialog"`, `aria-invalid` are properly announced.

- [ ] **Step 5: Test toast variants:**
  - `showToast('Test', 'success')` — green, auto-dismiss 3s
  - `showToast('Test', 'error')` — red, auto-dismiss 3s
  - `showToast.loading('Loading')` → `.success()` → resolves to success
  - `showToast.loading('Loading')` → `.error()` → resolves to error
  - `showToast.action('Deleted', { label: 'Undo', onClick: fn })` — button visible, clickable

- [ ] **Step 6: Test error boundary:**
  - Trigger `throw new Error()` in console — toast appears
  - Trigger 6+ errors rapidly — flood protection kicks in with reload message

- [ ] **Step 7: Rebuild CSS and run app**

```bash
npm run css:build
npm start
```

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete unified error and confirmation message system"
```

---

## Summary

| Phase | Deliverable | New/Modified Files |
|-------|-------------|-------------------|
| 1 | CSS foundation + `showConfirm` + `setFieldValidation` | `css/tailwind-input.css`, `js/message-system.js` |
| 2 | `showToast.loading()`, `showToast.action()` | `js/notifications.js` |
| 3 | Global error boundary | `js/utils.js` |
| 4 | Script tag rollout + duplicate cleanup | All `.html`, `js/pages/timetable.js` |
| 5 | Migration of ad-hoc patterns | `settings-imports.html`, `js/pages/settings-imports.js`, other JS |
| 6 | Full verification pass | — |

# Tasks: Message System Foundation — CSS + Core API

**Branch**: `020-message-system-foundation`
**Input**: Design documents from `/specs/020-message-system-foundation/`
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Research**: [research.md](./research.md)

> **Context for the implementing LLM**:
> This is a **renderer-only** Electron feature. No IPC, no main process, no bundler.
> Vanilla JS IIFE pattern. Tailwind CSS v4 compiled via `npm run css:build`.
> RTL Arabic UI. Two files are modified/created total:
>
> - **NEW**: `js/message-system.js` — IIFE exposing `showConfirm`, `setFieldValidation`, `clearValidation` on `window`
> - **MODIFIED**: `css/tailwind-input.css` — 3 new CSS blocks appended inside `@layer components {}`
>
> **Key constraints** (constitution):
>
> - All CSS must use logical properties (`inset-inline-start` NOT `left`, `padding-inline` NOT `padding-left`)
> - All CSS uses existing tokens (`var(--color-danger-solid)` etc.) — no hardcoded hex colors
> - Dark mode via `[data-theme='dark']` selector only
> - Pass `npm run lint` and `npm run css:build` — run these before committing
> - IIFE wrapped in `(function(){ 'use strict'; ... })()` — no ES module syntax

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup (Read existing code)

**Purpose**: Understand the insertion points before making any changes. Do NOT modify files in this phase — read only.

- [x] T001 Read `css/tailwind-input.css` lines 1–200 to locate the `@theme {}` block and confirm design tokens: `--color-danger-solid`, `--color-warning-solid`, `--color-success-solid`, `--color-primary`, `--color-primary-mist`, `--color-surface`, `--color-text-main`, `--color-text-muted`, `--color-accent`, `--radius-lg`, `--radius-sm`, `--font-main`
- [x] T002 Read `css/tailwind-input.css` to locate the end of the last `@layer components {}` block — this is the exact insertion point for all new CSS (after the existing import-confirm or last component block)
- [x] T003 [P] Read `js/notifications.js` lines 1–60 to locate the `renderToast` function definition and the `window.showToast = renderToast` assignment line — record the exact line numbers for T012 and T013
- [x] T004 [P] Read `js/ux-enhancements.js` lines 120–230 to confirm `openDialog(dialog, options)` and `closeDialog(dialog)` signatures and that they are exported on the `window` object at the bottom of the file

**Checkpoint**: You now know exactly where to insert CSS and what APIs are available. No file has been changed.

---

## Phase 2: Foundational (CSS in `css/tailwind-input.css`)

**Purpose**: Add all CSS classes that the JS module depends on. CSS must be built and verified before any JS is written. Without these classes the confirm dialog and validation messages will be invisible.

**⚠️ CRITICAL**: Complete T005 → T008 in order, then run the build gate T009 before starting any Phase 3 work.

- [x] T005 Add the **confirm dialog CSS block** to `css/tailwind-input.css` inside `@layer components {}`, after the last existing component block. Add this exact block (use logical properties throughout):

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
        transition:
            opacity 0.2s ease,
            visibility 0.2s ease;
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
    .msg-confirm-header.danger {
        border-top-color: var(--color-danger-solid);
    }
    .msg-confirm-header.warning {
        border-top-color: var(--color-warning-solid);
    }
    .msg-confirm-header.info {
        border-top-color: var(--color-primary);
    }
    .msg-confirm-header i {
        font-size: 20px;
        flex-shrink: 0;
    }
    .msg-confirm-header.danger i {
        color: var(--color-danger-solid);
    }
    .msg-confirm-header.warning i {
        color: var(--color-warning-solid);
    }
    .msg-confirm-header.info i {
        color: var(--color-primary);
    }
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
        transition:
            background 0.15s,
            color 0.15s;
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
    [data-theme='dark'] .msg-confirm-card {
        background: var(--color-surface, #1e293b);
        box-shadow: 0 20px 50px rgba(0, 0, 0, 0.5);
    }
    [data-theme='dark'] .msg-confirm-overlay {
        background: rgba(0, 0, 0, 0.65);
    }
    ```

- [x] T006 Add the **inline validation CSS block** to `css/tailwind-input.css` immediately after the confirm dialog block (T005):

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
        transition:
            max-height 0.15s ease,
            opacity 0.15s ease,
            margin 0.15s ease;
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

- [x] T007 Add the **toast variant CSS block** to `css/tailwind-input.css` immediately after the validation block (T006):

    ```css
    /* ============================
       Message System — Toast Variants
       ============================ */
    .toast.loading {
        background: var(--color-primary-mist, #eff6ff);
        border-inline-end-color: var(--color-primary);
    }
    .toast.loading i.fa-spinner {
        animation: spin 1s linear infinite;
    }
    .toast .toast-progress-bar {
        position: absolute;
        bottom: 0;
        inset-inline-end: 0;
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
        inset-inline-start: 6px;
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

- [x] T008 Verify the three CSS blocks were appended inside (or just before the closing of) `@layer components {}` in `css/tailwind-input.css` — read the bottom ~50 lines to confirm correct placement and that no extra closing braces are missing

- [x] T009 Run `npm run css:build` from the repo root — verify it exits with code 0 and `css/tailwind-output.css` is updated. If it fails, fix the CSS syntax before proceeding.

**Checkpoint**: CSS builds successfully. All visual classes exist. User story implementations can now begin.

---

## Phase 3: User Story 1 — Confirm a Destructive Action (Priority: P1) 🎯 MVP

**Goal**: Create `js/message-system.js` as a single IIFE module that exposes `window.showConfirm()` — a Promise-based, keyboard-accessible, RTL-aware confirmation dialog.

**Independent Test**: Open any existing HTML page in the app (e.g. `settings-imports.html`). Temporarily add `<script src="js/message-system.js" defer></script>` to it. Open DevTools console and run:

```js
showConfirm({ title: 'اختبار', message: 'هل أنت متأكد؟', type: 'danger' }).then((r) => console.log(r));
```

Verify: overlay fades in, card animates, clicking Confirm logs `{confirmed: true}`, clicking Cancel/Escape/backdrop logs `{confirmed: false}`, element is removed from DOM after close.

### Implementation for User Story 1

- [x] T010 [US1] Create `js/message-system.js` with the IIFE wrapper, strict mode, and the `MSG_TYPE_CONFIG` lookup table:

    ```js
    /**
     * Message System — Unified confirmations and field validation
     * نظام الرسائل الموحد — تأكيدات والتحقق من الحقول
     */
    (function () {
        'use strict';

        var MSG_TYPE_CONFIG = {
            danger: { headerClass: 'danger', icon: 'fa-exclamation-triangle', confirmClass: 'btn-danger' },
            warning: { headerClass: 'warning', icon: 'fa-exclamation-circle', confirmClass: 'btn-warning' },
            info: { headerClass: 'info', icon: 'fa-info-circle', confirmClass: 'btn-primary' }
        };

        var _activeConfirm = null;

        // ... (functions added in subsequent tasks)

        window.showConfirm = showConfirm;
        window.setFieldValidation = setFieldValidation;
        window.clearValidation = clearValidation;
    })();
    ```

    > **Note**: The `window.*` assignments at the bottom must reference the three functions that will be defined in T011–T015. Write the full file structure now so later tasks fill in the function bodies.

- [x] T011 [US1] Implement the `_escHtml(str)` helper and `_resolveConfirm(confirmed)` function inside `js/message-system.js`. Place them before the `showConfirm` function:

    ```js
    function _escHtml(str) {
        var div = document.createElement('div');
        div.textContent = String(str || '');
        return div.innerHTML;
    }

    function _resolveConfirm(confirmed) {
        if (!_activeConfirm) return;
        var overlay = _activeConfirm.overlay;
        var resolve = _activeConfirm.resolve;
        var inputEl = _activeConfirm.inputEl;
        var inputValue = inputEl ? inputEl.value : undefined;
        _activeConfirm = null;

        overlay.classList.remove('active');

        if (typeof closeDialog === 'function') {
            closeDialog(overlay);
        }

        setTimeout(function () {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        }, 200);

        resolve({ confirmed: confirmed, inputValue: inputValue });
    }
    ```

- [x] T012 [US1] Implement the `showConfirm(config)` function inside `js/message-system.js`. This function must: close any existing dialog, build the DOM structure dynamically, set ARIA attributes, handle `requireInput` disabling of confirm button, attach to `openDialog()` with fallback, and wire click/keyboard event delegation:

    ```js
    function showConfirm(config) {
        if (_activeConfirm) {
            _resolveConfirm(false);
        }

        return new Promise(function (resolve) {
            var type = config.type || 'info';
            var typeConfig = MSG_TYPE_CONFIG[type] || MSG_TYPE_CONFIG.info;
            var icon = config.icon || typeConfig.icon;
            var confirmText = config.confirmText || 'تأكيد';
            var cancelText = config.cancelText || 'إلغاء';
            var confirmBtnClass = config.confirmClass || typeConfig.confirmClass;

            var overlay = document.createElement('div');
            overlay.className = 'msg-confirm-overlay';
            overlay.setAttribute('role', 'alertdialog');
            overlay.setAttribute('aria-modal', 'true');
            overlay.setAttribute('aria-labelledby', 'msg-confirm-title');
            overlay.setAttribute('aria-describedby', 'msg-confirm-message');

            var inputHTML = config.requireInput
                ? '<input class="msg-confirm-input" id="msg-confirm-input" type="text" placeholder="' +
                  _escHtml(config.inputPlaceholder || '') +
                  '" autocomplete="off" />'
                : '';

            var detailHTML = config.detail ? '<p class="msg-confirm-detail">' + _escHtml(config.detail) + '</p>' : '';

            overlay.innerHTML =
                '<div class="msg-confirm-card">' +
                '  <div class="msg-confirm-header ' +
                typeConfig.headerClass +
                '">' +
                '    <i class="fas ' +
                _escHtml(icon) +
                '" aria-hidden="true"></i>' +
                '    <h3 class="msg-confirm-title" id="msg-confirm-title">' +
                _escHtml(config.title || 'تأكيد') +
                '</h3>' +
                '    <button type="button" class="msg-confirm-close" data-action="cancel" aria-label="إغلاق">' +
                '      <i class="fas fa-times" aria-hidden="true"></i>' +
                '    </button>' +
                '  </div>' +
                '  <div class="msg-confirm-body">' +
                '    <p class="msg-confirm-message" id="msg-confirm-message">' +
                _escHtml(config.message || '') +
                '</p>' +
                detailHTML +
                inputHTML +
                '  </div>' +
                '  <div class="msg-confirm-actions">' +
                '    <button type="button" class="btn btn-secondary" data-action="cancel">' +
                '      <i class="fas fa-times" aria-hidden="true"></i> ' +
                _escHtml(cancelText) +
                '    </button>' +
                '    <button type="button" class="btn ' +
                confirmBtnClass +
                '" data-action="confirm" id="msg-confirm-ok">' +
                '      <i class="fas fa-check" aria-hidden="true"></i> ' +
                _escHtml(confirmText) +
                '    </button>' +
                '  </div>' +
                '</div>';

            document.body.appendChild(overlay);

            var confirmBtn = overlay.querySelector('[data-action="confirm"]');
            var inputEl = overlay.querySelector('#msg-confirm-input');

            if (config.requireInput && confirmBtn) {
                confirmBtn.disabled = true;
                if (inputEl) {
                    inputEl.addEventListener('input', function () {
                        confirmBtn.disabled = !inputEl.value.trim();
                    });
                }
            }

            _activeConfirm = { overlay: overlay, resolve: resolve, inputEl: inputEl };

            requestAnimationFrame(function () {
                overlay.classList.add('active');
            });

            if (typeof openDialog === 'function') {
                openDialog(overlay, {
                    contentSelector: '.msg-confirm-card',
                    initialFocus: config.requireInput ? '#msg-confirm-input' : '#msg-confirm-ok',
                    onCloseRequest: function () {
                        _resolveConfirm(false);
                    }
                });
            } else {
                requestAnimationFrame(function () {
                    var target = config.requireInput ? inputEl : confirmBtn;
                    if (target) target.focus();
                });
            }

            overlay.addEventListener('click', function (e) {
                var action = e.target.closest('[data-action]');
                if (action && action.dataset.action === 'confirm') {
                    _resolveConfirm(true);
                } else if (action && action.dataset.action === 'cancel') {
                    _resolveConfirm(false);
                } else if (e.target === overlay) {
                    _resolveConfirm(false);
                }
            });

            overlay.addEventListener('keydown', function (e) {
                if (e.key === 'Escape') {
                    e.preventDefault();
                    _resolveConfirm(false);
                }
                if (e.key === 'Enter' && e.target === inputEl && confirmBtn && !confirmBtn.disabled) {
                    e.preventDefault();
                    _resolveConfirm(true);
                }
            });
        });
    }
    ```

- [x] T013 [US1] Verify `js/message-system.js` passes the linter: run `npm run lint` from the repo root. Fix any ESLint errors before continuing. Common issues: declared-but-unused `var`, `var` inside blocks (use function scope), semicolons.

**Checkpoint — US1 complete**: `showConfirm()` is working. Test it manually per the Independent Test above before moving to Phase 4.

---

## Phase 4: User Story 2 — Inline Field Validation (Priority: P2)

**Goal**: Add `setFieldValidation()` and `clearValidation()` function bodies inside `js/message-system.js`.

**Independent Test**: On any page with a form input, open DevTools console and run:

```js
var f = document.querySelector('input, select');
setFieldValidation(f, 'هذا الحقل مطلوب', 'error');
// verify: red border on field, red message with icon appears below
setFieldValidation(f, 'القيمة صحيحة', 'success');
// verify: green border, green check message replaces the previous one
setFieldValidation(f, null);
// verify: border reset, message gone, no ARIA attributes remain
clearValidation(f.closest('form') || f.parentNode);
// verify: no-op (already clean), no errors thrown
```

### Implementation for User Story 2

- [x] T014 [P] [US2] Add the `VALIDATION_ICON` and `VALIDATION_FIELD_CLASS` lookup tables inside the IIFE in `js/message-system.js`, just before the `setFieldValidation` function definition:

    ```js
    var VALIDATION_ICON = {
        error: 'fa-exclamation-circle',
        warning: 'fa-exclamation-triangle',
        success: 'fa-check-circle'
    };

    var VALIDATION_FIELD_CLASS = {
        error: 'field-invalid',
        warning: 'field-warning',
        success: 'field-valid'
    };
    ```

- [x] T015 [US2] Add the `_clearFieldValidation(field)` internal helper and the `setFieldValidation(field, message, type)` public function inside the IIFE in `js/message-system.js`:

    ```js
    function _clearFieldValidation(field) {
        if (!field) return;
        field.classList.remove('field-invalid', 'field-warning', 'field-valid');
        field.removeAttribute('aria-invalid');
        field.removeAttribute('aria-describedby');

        var existingId = field.dataset.validationId;
        if (existingId) {
            var existingEl = document.getElementById(existingId);
            if (existingEl) existingEl.parentNode.removeChild(existingEl);
            delete field.dataset.validationId;
        }
    }

    function setFieldValidation(field, message, type) {
        if (!field) return;
        type = type || 'error';

        _clearFieldValidation(field);

        if (!message) return;
        if (!field.parentNode) return;

        var cls = VALIDATION_FIELD_CLASS[type];
        if (cls) field.classList.add(cls);

        if (type === 'error') {
            field.setAttribute('aria-invalid', 'true');
        }

        var id = 'fv-' + Math.random().toString(36).slice(2, 8);
        field.dataset.validationId = id;
        field.setAttribute('aria-describedby', id);

        var div = document.createElement('div');
        div.className = 'field-validation ' + type;
        div.setAttribute('role', type === 'error' ? 'alert' : 'status');
        div.id = id;

        var icon = document.createElement('i');
        icon.className = 'fas ' + (VALIDATION_ICON[type] || VALIDATION_ICON.error);
        icon.setAttribute('aria-hidden', 'true');

        var span = document.createElement('span');
        span.textContent = message;

        div.appendChild(icon);
        div.appendChild(span);
        field.parentNode.insertBefore(div, field.nextSibling);

        requestAnimationFrame(function () {
            div.classList.add('visible');
        });
    }
    ```

- [x] T016 [US2] Add the `clearValidation(container)` public function inside the IIFE in `js/message-system.js`:

    ```js
    function clearValidation(container) {
        if (!container) return;
        var messages = container.querySelectorAll('.field-validation');
        messages.forEach(function (el) {
            if (el.parentNode) el.parentNode.removeChild(el);
        });
        var fields = container.querySelectorAll('.field-invalid, .field-warning, .field-valid');
        fields.forEach(function (el) {
            el.classList.remove('field-invalid', 'field-warning', 'field-valid');
            el.removeAttribute('aria-invalid');
            el.removeAttribute('aria-describedby');
            delete el.dataset.validationId;
        });
    }
    ```

- [x] T017 [US2] Run `npm run lint` again to confirm no new ESLint errors. Verify `window.setFieldValidation` and `window.clearValidation` are both assigned at the bottom of the IIFE (they should already be from T010 — confirm they are present).

**Checkpoint — US2 complete**: Test per the Independent Test above. Both `setFieldValidation` and `clearValidation` work correctly, no DOM leaks.

---

## Phase 5: User Story 3 — Visual Coherence Across Themes (Priority: P3)

**Goal**: Verify all new UI elements respect `data-theme="dark"` and RTL layout. No new code is written in this phase — this is a verification + correction phase.

**Independent Test**: With the app running (`npm run dev`), toggle dark mode via the theme button on any page that has `js/message-system.js` loaded. Open console and call `showConfirm(...)`. Inspect visually that the card background is dark, text is legible, and no hardcoded hex colors appear in computed styles.

### Implementation for User Story 3

- [x] T018 [US3] Open `css/tailwind-input.css`, find the two `[data-theme='dark']` overrides added in T005. Verify the selectors are exactly `[data-theme='dark'] .msg-confirm-card` and `[data-theme='dark'] .msg-confirm-overlay`. If the dark theme is not being applied, check if the selector should be `[data-theme="dark"]` (double quotes) — match whatever the rest of the file uses.

- [x] T019 [US3] Scan the three new CSS blocks added in T005–T007 for any hardcoded hex color values (e.g. `#fff`, `#e5e7eb`, `#1e293b`) that are NOT inside a CSS variable fallback (`var(--token, #fallback)`). Any standalone hex not serving as a var fallback must be replaced with the appropriate `var(--color-*)` token. Reference T001 token list.

- [x] T020 [US3] Scan the three new CSS blocks for any physical direction properties: `left`, `right`, `padding-left`, `padding-right`, `margin-left`, `margin-right`, `border-left`, `border-right`. Replace with logical equivalents: `inset-inline-start`, `inset-inline-end`, `padding-inline-start`, `padding-inline-end`, `margin-inline-start`, `margin-inline-end`, `border-inline-start`, `border-inline-end`. (The blocks were authored with logical properties, but this task confirms no physical properties slipped through.)

- [x] T021 [US3] Run `npm run css:build` one final time to confirm the build still passes after any corrections in T019–T020.

**Checkpoint — US3 complete**: Dark mode and RTL verified. CSS build passing.

---

## Phase 6: Polish & Cross-Cutting

**Purpose**: Final quality gates. Do not skip.

- [x] T022 Run `npm run lint` from repo root — confirm zero errors for `js/message-system.js`. If warnings appear for renderer code, they are acceptable (the ESLint config is relaxed for `js/`).
- [x] T023 Run `npm run css:build` from repo root — confirm clean exit, no warnings about unknown utilities.
- [x] T024 Run `npm run test:smoke` from repo root — confirm all IPC parity checks pass (no new channels were added, so this should pass automatically), no CDN references introduced, Tailwind output present.
- [ ] T025 [P] Manually verify the confirm dialog in both light and dark mode: open any HTML page in Electron (`npm run start`), run `showConfirm({ title: 'اختبار', message: 'رسالة اختبار', type: 'danger' })` in DevTools, cycle through all cancel paths (Escape, backdrop, × button, Cancel button), then test confirm path. Confirm DOM is clean after each close (no leftover overlay elements).
- [ ] T026 [P] Manually verify keyboard navigation inside the dialog: Tab cycles between Cancel and Confirm buttons, Shift+Tab reverses, Enter on Confirm button closes with `{confirmed: true}`, no focus escapes to the page behind the overlay.

**Final Checkpoint**: All gates pass. `js/message-system.js` is ready to be wired into HTML pages (Phase 4 of the broader message-system plan).

---

## Dependencies & Execution Order

### Phase Dependencies

```
Phase 1 (Read/Setup)
    │
    ▼
Phase 2 (CSS — T005→T009) ← BLOCKS all code phases
    │
    ├──► Phase 3 (US1 — showConfirm JS)
    │         │
    │         ▼
    ├──► Phase 4 (US2 — validation JS)  ← can start in parallel with Phase 3 after T009
    │         │
    │         ▼
    └──► Phase 5 (US3 — theme verification) ← needs Phase 3+4 complete
              │
              ▼
         Phase 6 (Polish — final gates)
```

### User Story Dependencies

- **US1 (P1)**: Depends on Phase 2 (CSS) only — no dependency on US2 or US3
- **US2 (P2)**: Depends on Phase 2 (CSS) only — can be started in parallel with US1 after T009
- **US3 (P3)**: Depends on US1 and US2 being complete (theme verification needs the full module)

### Within Each User Story

- CSS (Phase 2) before any JS
- Helper functions (`_escHtml`, `_resolveConfirm`, `_clearFieldValidation`) before the public functions that call them
- Public functions before the `window.*` assignments (or ensure assignments reference the functions by name)

---

## Parallel Opportunities

```
# After T009 (CSS build passes), these can run in parallel:
Task T010: Start IIFE skeleton + showConfirm in js/message-system.js
Task T014: Prepare validation lookup tables

# Within Phase 3 (US1):
T010 → T011 → T012 must be sequential (each builds on the previous)

# T013 (lint) and T017 (lint) are sequential — run after each phase's JS is complete

# Phase 6 tasks T025 and T026 are parallel (different verification paths)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Read existing code (T001–T004)
2. Complete Phase 2: Add all CSS, build passes (T005–T009)
3. Complete Phase 3: `showConfirm()` implemented and tested (T010–T013)
4. **STOP and VALIDATE**: Confirm dialog works in DevTools console on any real page
5. Phase 4–6 add validation and polish without touching confirmed working code

### Incremental Delivery

1. CSS + `showConfirm` → usable immediately to replace `window.confirm()` calls
2. Add `setFieldValidation` / `clearValidation` → form validation now available
3. Theme verification → production-ready for both themes

### Key Implementation Notes for the Implementing LLM

- **Do not use `innerHTML` with unsanitized strings** — all user-provided config values must go through `_escHtml()` before being placed in HTML
- **IIFE means no `let`/`const`** — use `var` and `function` declarations to match the existing renderer JS code style (checked by Prettier)
- **`openDialog`/`closeDialog` are globals** — do not `require` or `import` them. Check `typeof openDialog === 'function'` before calling
- **`forEach` on NodeList** — safe in Chromium (Electron renderer). No need for `Array.from()`
- **The `window.showConfirm/setFieldValidation/clearValidation` assignments at the bottom of the IIFE** — these must be inside the IIFE, referencing the function names. Do not assign before the functions are defined (hoisting works with `function` declarations but be explicit)
- **Prettier formatting** — 4-space indent, single quotes, semicolons, 120-char line width. Run `npm run format` if unsure

---

## Notes

- `[P]` tasks touch different files or are independent verification steps — they can be dispatched in parallel
- `[US1]`, `[US2]`, `[US3]` labels map to user stories from `spec.md`
- The `contracts/global-api.md` file is the authoritative reference for all three function signatures — refer to it for exact parameter names, types, and defaults
- Total files modified: **2** (`css/tailwind-input.css` modified, `js/message-system.js` created)
- No IPC changes, no `preload.js` changes, no main-process changes

# Tasks: Message System — Verification & Polish

**Branch**: `026-message-system-verification` | **Spec**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

**Input**: Design documents from `specs/026-message-system-verification/`  
**Context**: This is a verification + gap-close pass. Two Phase 2–3 artifacts are missing and must be added before any visual verification test can run. All tasks reference exact file paths and include the specific code to write — an LLM can execute each task independently.

**No tests requested** — verification is manual via DevTools console as specified in the plan.

---

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on each other)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup (Confirm Working State)

**Purpose**: Verify the repository is on the correct branch and the app can be launched before making any changes.

- [x] T001 Confirm current git branch is `026-message-system-verification` by running `git branch --show-current` in `d:/gestionScholaire`
- [x] T002 Confirm `js/message-system.js` exists and exports `window.showConfirm`, `window.setFieldValidation`, `window.clearValidation` (grep for `window.showConfirm = showConfirm` in `js/message-system.js`)
- [x] T003 Confirm error boundary is present in `js/utils.js` by grepping for `_floodStopped` — should return at least one match
- [x] T004 Confirm `showConfirm()` is wired in `js/pages/settings-imports.js` by grepping for `await showConfirm` — should return 4 matches

**Checkpoint**: Repository state confirmed. Two gaps identified (CSS missing, toast variants missing). Proceed to Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Close the two gaps that block ALL visual verification tests. No user story testing is possible until both tasks are complete.

**⚠️ CRITICAL**: Complete T005 and T006 before any Phase 3+ work.

- [x] T005 Add all message system CSS classes to `css/tailwind-input.css` — append the three CSS blocks (confirm dialog, inline validation, toast variants) listed verbatim below to the end of the `@layer components {}` block

    **Exact location**: Open `css/tailwind-input.css`, find the closing `}` of the `@layer components` block, and insert before it:

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

- [x] T006 [P] Add `renderLoadingToast`, `renderActionToast`, `_ensureToastContainer` functions to `js/notifications.js` and attach them to `window.showToast`, and add click-to-dismiss on the base `renderToast`

    **Exact changes to `js/notifications.js`**:

    **Change 1** — find `container.appendChild(toast);` in the existing `renderToast` function (around line 48) and add these three lines immediately after it:

    ```js
    toast.style.cursor = 'pointer';
    toast.addEventListener('click', function () {
        toast.style.opacity = '0';
        toast.style.transform = 'translateY(-20px)';
        setTimeout(function () {
            toast.remove();
        }, 300);
    });
    ```

    **Change 2** — find `// ===== Notification center helpers =====` (around line 53) and insert the following block **before** that comment:

    ```js
    // ===== Enhanced toast variants =====

    var _lastToastMessage = '';
    var _lastToastTime = 0;

    function _deduplicateToast(message) {
        var now = Date.now();
        if (message === _lastToastMessage && now - _lastToastTime < 2000) return true;
        _lastToastMessage = message;
        _lastToastTime = now;
        return false;
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

    function _createNoopHandle() {
        return {
            success: function () {},
            error: function () {},
            progress: function () {},
            dismiss: function () {}
        };
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
            setTimeout(function () {
                toast.remove();
            }, 300);
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

    function renderActionToast(message, actionConfig, opts) {
        if (_deduplicateToast(message)) return;
        opts = opts || {};
        var duration = opts.duration || 8000;

        var container = _ensureToastContainer();
        var toast = document.createElement('div');
        toast.className = 'toast ' + (opts.type || 'info');

        var iconMap = {
            success: 'fa-check-circle',
            error: 'fa-exclamation-circle',
            warning: 'fa-exclamation-triangle',
            info: 'fa-info-circle'
        };
        var icon = document.createElement('i');
        icon.className = 'fas ' + (iconMap[opts.type] || iconMap.info);

        var span = document.createElement('span');
        span.textContent = message;

        toast.appendChild(icon);
        toast.appendChild(span);

        var actionFired = false;

        if (actionConfig && actionConfig.label) {
            var actionBtn = document.createElement('button');
            actionBtn.className = 'toast-action-btn';
            actionBtn.type = 'button';
            if (actionConfig.icon) {
                var btnIcon = document.createElement('i');
                btnIcon.className = 'fas ' + actionConfig.icon;
                actionBtn.appendChild(btnIcon);
                actionBtn.appendChild(document.createTextNode(' '));
            }
            actionBtn.appendChild(document.createTextNode(actionConfig.label));
            actionBtn.addEventListener('click', function () {
                if (!actionFired && typeof actionConfig.onClick === 'function') {
                    actionFired = true;
                    actionConfig.onClick();
                }
                dismissToast();
            });
            toast.appendChild(actionBtn);
        }

        container.appendChild(toast);

        function dismissToast() {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(-20px)';
            setTimeout(function () {
                toast.remove();
            }, 300);
        }

        toast.addEventListener('click', function (e) {
            if (e.target.closest('.toast-action-btn')) return;
            dismissToast();
        });

        setTimeout(dismissToast, duration);
    }
    ```

    **Change 3** — find `window.showToast = renderToast;` (line 227) and replace with:

    ```js
    window.showToast = renderToast;
    window.showToast.loading = renderLoadingToast;
    window.showToast.action = renderActionToast;
    ```

- [x] T007 Rebuild Tailwind CSS by running `npm run css:build` in `d:/gestionScholaire` — confirm the command exits with code 0 and no errors

**Checkpoint**: CSS compiled. Toast variants attached. `window.showToast.loading` and `window.showToast.action` are now available. Run `npm start` and open DevTools to confirm all three globals are defined before proceeding.

---

## Phase 3: User Story 1 — Visual Consistency Across Themes (Priority: P1) 🎯 MVP

**Goal**: Verify all message system elements render correctly in both light and dark themes with no contrast failures.

**Independent Test**: Toggle to dark mode → trigger one dialog + one of each toast type + one validation message → all readable with proper contrast.

### Implementation for User Story 1

- [ ] T008 [US1] Launch the app with `npm start`, open DevTools (F12) on `settings-imports.html`, run in console: `showConfirm({ title: 'اختبار', message: 'هذا اختبار تحقق من وجود الحوار', type: 'danger' })` — confirm the dialog appears with red header bar and legible text in light mode
- [ ] T009 [US1] In light mode, run in console: `showConfirm({ title: 'اختبار', message: 'تحذير', type: 'warning' })` — confirm amber/yellow header; then `showConfirm({ title: 'اختبار', message: 'معلومات', type: 'info' })` — confirm blue header
- [ ] T010 [US1] Toggle application to dark mode (settings gear → theme toggle). Run: `showConfirm({ title: 'وضع داكن', message: 'تحقق من التباين', type: 'danger' })` — confirm dark card background, legible text, no white bleed-through on the card
- [ ] T011 [US1] In dark mode, run: `showToast('نجح الاختبار', 'success')` — green icon, legible; `showToast('فشل الاختبار', 'error')` — red icon, legible; `showToast('تحذير', 'warning')` — amber icon, legible; `showToast('معلومة', 'info')` — blue icon, legible
- [ ] T012 [US1] In dark mode, run: `const h = showToast.loading('جاري التحميل...')` — confirm loading spinner toast appears with blue background and spinner animation in dark mode — then run `h.success('تم')` — confirm transition to green success state
- [ ] T013 [US1] In dark mode, open a page with a form field (e.g., any settings page). Run in console: `setFieldValidation(document.querySelector('input'), 'خطأ في الحقل', 'error')` — confirm the red validation message is legible against the dark background
- [ ] T014 [US1] If any dark-mode contrast issue is found in T008–T013, fix the CSS in `css/tailwind-input.css` by adding or adjusting `[data-theme='dark']` override rules for the failing class, then re-run `npm run css:build` and retest

**Checkpoint**: All message system elements visually correct in both themes. Zero contrast failures.

---

## Phase 4: User Story 2 — RTL Layout Correctness (Priority: P1)

**Goal**: Verify all message system components use correct RTL button order, icon placement, and text alignment for Arabic users.

**Independent Test**: Switch to light mode → open a confirm dialog → Cancel is on the right, Confirm is on the left → toast close button is on the left side.

### Implementation for User Story 2

- [ ] T015 [US2] In light mode, run: `showConfirm({ title: 'تحقق RTL', message: 'هل ترتيب الأزرار صحيح؟', type: 'info' })` — inspect the action row: the **Cancel (إلغاء) button must be on the right** and the **Confirm (تأكيد) button must be on the left** (matching Arabic right-to-left reading order)
- [ ] T016 [US2] Run: `showToast('اختبار إغلاق', 'info')` — confirm the close button (`×`) of the loading toast appears on the **left side** of the toast (logical `inset-inline-start`), and the message text aligns to the right
- [ ] T017 [US2] Run: `setFieldValidation(document.querySelector('input'), 'حقل مطلوب', 'error')` on a page with an input — confirm the icon (`!`) appears on the **right** and the text flows to the left
- [ ] T018 [US2] Run: `showToast.action('تم الحذف', { label: 'تراجع', icon: 'fa-undo', onClick: function(){} })` — confirm the Undo button appears **to the left** of the message text (Arabic reading direction: message first right, action button left)
- [ ] T019 [US2] If any RTL issue is found in T015–T018, fix the CSS in `css/tailwind-input.css` — replace any physical `left`/`right` properties with logical `inset-inline-start`/`inset-inline-end`, `margin-inline-start`/`margin-inline-end`, `padding-inline-start`/`padding-inline-end`. Re-run `npm run css:build` and retest.

**Checkpoint**: All RTL layout correct. Zero directional defects.

---

## Phase 5: User Story 3 — Keyboard Navigation & Accessibility (Priority: P2)

**Goal**: Verify the confirm dialog implements a focus trap, responds to Escape/Enter, and returns focus to the trigger after close.

**Independent Test**: Open a confirm dialog via console → press Tab → focus stays inside dialog → press Escape → dialog closes.

### Implementation for User Story 3

- [ ] T020 [US3] Click any button on the page to set a known focus target. Then run in console: `showConfirm({ title: 'اختبار لوحة المفاتيح', message: 'اضغط Tab عدة مرات', type: 'info' })` — press Tab 10 times — confirm focus never leaves the dialog (no background elements receive focus)
- [ ] T021 [US3] With a confirm dialog open, press **Escape** — confirm the dialog closes with fade-out animation and focus returns to the element that was focused before the dialog opened
- [ ] T022 [US3] Open a dialog, Tab to the Confirm button, press **Enter** — confirm the dialog resolves as confirmed (check via: `showConfirm({...}).then(r => console.log(r))` — should log `{ confirmed: true }`)
- [ ] T023 [US3] Test disabled confirm: run `showConfirm({ title: 'اختبار', message: 'مطلوب نص', requireInput: true, inputPlaceholder: 'اكتب هنا' })` — confirm the Confirm button is **disabled** when input is empty. Type text into the input — confirm the button becomes **enabled**. Press Enter while focused on the input — confirm dialog resolves as `{ confirmed: true, inputValue: '...' }`
- [ ] T024 [US3] If focus trap is not working (T020 fails), inspect `js/message-system.js` — the `openDialog()` call on line ~464 handles focus trapping via `js/ux-enhancements.js`. Verify `openDialog` is defined globally by running `typeof openDialog` in the console. If it returns `'undefined'`, the fallback path in `message-system.js` (lines ~472–476) handles basic focus — investigate why `ux-enhancements.js` is not loaded and fix the script load order in the relevant HTML page.

**Checkpoint**: Full keyboard flow works. Focus trap active. Escape/Enter/disabled-state all correct.

---

## Phase 6: User Story 4 — Toast Variant Lifecycle (Priority: P2)

**Goal**: Verify all toast variants display correct icons/colors and complete their full lifecycle with no stuck or orphaned DOM elements.

**Independent Test**: Run loading toast → call `.success()` → toast transitions to green and auto-removes from DOM after ~3s.

### Implementation for User Story 4

- [ ] T025 [US4] Run: `showToast('نجح', 'success')` — confirm green `fa-check-circle` icon, auto-dismisses in ~3s, no element remains in `#toast-container` after dismissal (check with `document.querySelectorAll('.toast').length`)
- [ ] T026 [US4] Wait 3s (throttle reset). Run: `showToast('خطأ', 'error')` — confirm red `fa-exclamation-circle` icon, auto-dismisses in ~3–5s
- [ ] T027 [US4] Run: `const h = showToast.loading('جاري الحفظ...')` — confirm blue loading toast with spinning `fa-spinner`. Wait 2s, run `h.success('تم الحفظ بنجاح')` — confirm spinner changes to `fa-check-circle`, background changes to green, toast auto-removes after ~3s
- [ ] T028 [US4] Run: `const h2 = showToast.loading('جاري المعالجة...')`. Wait 2s, run `h2.error('فشلت العملية')` — confirm spinner changes to `fa-exclamation-circle`, background changes to red, toast auto-removes after ~5s
- [ ] T029 [US4] Run: `showToast.action('تم حذف السجل', { label: 'تراجع', icon: 'fa-undo', onClick: function(){ console.log('Undo triggered'); } })` — confirm action button is visible, click it — confirm `'Undo triggered'` appears in console exactly once, toast dismisses immediately
- [ ] T030 [US4] Run: `showToast('انقر لإغلاق', 'info')` — click the **body** of the toast (not any button) — confirm toast dismisses immediately
- [ ] T031 [US4] Run `h.success('test')` on an already-dismissed handle — confirm no error is thrown (the `dismissed` guard prevents double-transition)
- [ ] T032 [US4] After completing T025–T031, inspect DOM: `document.querySelectorAll('.toast').length` — must return `0` (no orphaned toast elements)

**Checkpoint**: All toast variants work correctly. No orphaned DOM elements.

---

## Phase 7: User Story 5 — Global Error Boundary Behavior (Priority: P2)

**Goal**: Verify the error boundary catches uncaught errors and unhandled rejections, shows one toast per event (throttled), and activates flood protection after 5 rapid errors.

**Independent Test**: `throw new Error('test')` in console → single error toast appears → no second toast within 3s.

### Implementation for User Story 5

- [ ] T033 [US5] Run in console: `throw new Error('اختبار خطأ غير متوقع')` — confirm a single error toast appears within 1 second with text containing "خطأ" and the error is logged in console as `[GlobalError]`
- [ ] T034 [US5] Wait 5 seconds (clear throttle). Run: `Promise.reject(new Error('اختبار رفض الوعد'))` — confirm a single error toast appears and `[UnhandledRejection]` is logged in console
- [ ] T035 [US5] Wait 5 seconds (clear throttle). Run two errors rapidly: `throw new Error('أول')` — note the toast. Within 3 seconds run the second: `window.dispatchEvent(new ErrorEvent('error', { message: 'ثاني' }))` — confirm **no second toast appears** (throttle active)
- [ ] T036 [US5] Wait 15 seconds (flood window reset). Run this block to trigger 10 rapid errors:
    ```js
    for (var i = 0; i < 10; i++) {
        window.dispatchEvent(new ErrorEvent('error', { message: 'flood ' + i, error: new Error('flood') }));
    }
    ```
    Confirm: at most **2 toasts** appear total — one individual toast and one "أخطاء متعددة" (multiple errors) toast. NOT 10 separate toasts.
- [ ] T037 [US5] After the flood window expires (wait 15 seconds), run: `throw new Error('بعد انتهاء الفيضان')` — confirm a **normal** single error toast appears (flood counter has reset)
- [ ] T038 [US5] If any error boundary test fails, review `js/utils.js` lines 1–90 — check `ERROR_THROTTLE_MS` (should be 3000), `ERROR_FLOOD_LIMIT` (should be 5), `ERROR_FLOOD_WINDOW_MS` (should be 10000). Fix values if incorrect and retest.

**Checkpoint**: Error boundary throttle and flood protection both work correctly.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Settings-imports end-to-end verification, edge cases, and all CI gates.

- [ ] T039 Open `settings-imports.html` in the running app. Click the **"حذف بيانات التلاميذ"** button (or any stat card delete/clear button) — confirm the new `showConfirm()` dialog appears (not the old inline overlay). Click Cancel — confirm nothing is deleted. Click the button again, confirm, observe the result.
- [ ] T040 Open `settings-imports.html`. Initiate an import action that triggers the import confirmation flow — confirm `showConfirm()` dialog appears with title "تأكيد الاستيراد" and type `info`. Cancel it — confirm import does not proceed.
- [ ] T041 Test edge case — rapid dialog open: Run in console two `showConfirm()` calls back-to-back without awaiting. The first must resolve as `{ confirmed: false }` before the second dialog appears. Verify: `let r1, r2; showConfirm({title:'1',message:'1'}).then(r=>console.log('first:',r)); showConfirm({title:'2',message:'2'}).then(r=>console.log('second:',r))` — console should show `first: {confirmed: false}` immediately, then the second dialog appears.
- [x] T042 Test edge case — `showToast` unavailable at error time: In `js/utils.js`, confirm lines 46–50 check `typeof showToast === 'function'` before calling it — grep for `typeof showToast` in `js/utils.js`, confirm at least one match. This ensures graceful degradation if `notifications.js` loads after the first error.
- [x] T043 Run `npm run lint` in `d:/gestionScholaire` — confirm zero errors. If lint errors appear in `js/notifications.js` due to new code, fix them: use `var` (not `let`/`const`), single quotes, 4-space indent, semicolons, 120-char max line length.
- [x] T044 Run `npm run css:build` in `d:/gestionScholaire` — confirm completes under 10 seconds with no errors
- [x] T045 Run `npm run test:smoke` in `d:/gestionScholaire` — confirm all smoke tests pass (IPC parity, no CDN refs, Tailwind output present)
- [ ] T046 Commit all changes: `git add css/tailwind-input.css js/notifications.js` then `git commit -m "feat: complete message system CSS and toast variant attachment"`. Verify commit succeeds.

**Checkpoint**: All CI gates pass. Branch is ready for merge.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 confirmation — BLOCKS all verification phases
- **Phase 3–7 (User Stories)**: All depend on Phase 2 completion (T007 must pass)
    - US1 and US2 (P1) should be completed before P2 stories
    - US3, US4, US5 can proceed in any order after US1+US2 pass
- **Phase 8 (Polish)**: Depends on all Phase 3–7 verification passing

### User Story Dependencies

- **US1 (P1)**: No dependencies on other stories. Must pass first — it validates the CSS foundation.
- **US2 (P1)**: No dependencies on other stories. Can run immediately after US1 (same app session).
- **US3 (P2)**: Depends on Phase 2 only. `message-system.js` handles focus logic independently.
- **US4 (P2)**: Depends on T006 (toast variants added). Independent of US1–US3.
- **US5 (P2)**: Depends on Phase 2 only. Error boundary is already in `utils.js`.

### Parallel Opportunities

- T005 (CSS) and T006 (JS toast variants) — **[P]** — different files, can be edited simultaneously
- T008–T013 (US1 dark theme checks) — all run in the same console session but test different components
- T015–T018 (US2 RTL checks) — sequential visual inspection, same session
- T025–T031 (US4 toast lifecycle) — must respect 3s throttle between some tests; otherwise sequential

---

## Parallel Example

```text
# Phase 2 gap-close — do both in parallel (different files):
Task T005: Edit css/tailwind-input.css — add 3 CSS blocks
Task T006: Edit js/notifications.js — add renderLoadingToast, renderActionToast, attach to window.showToast

# Then sequentially:
Task T007: npm run css:build (depends on T005)
# T006 does not require a build step
```

---

## Implementation Strategy

### MVP First (User Story 1 + 2 Only)

1. Complete Phase 1: Setup confirmation (T001–T004)
2. Complete Phase 2: Close both gaps + rebuild (T005–T007)
3. Complete Phase 3: Dark theme visual pass (T008–T014)
4. Complete Phase 4: RTL layout pass (T015–T019)
5. **STOP and VALIDATE**: US1 and US2 are both P1 — if these pass, the system is correct for all users in all themes
6. Proceed to P2 stories (US3–US5) and Polish

### Incremental Delivery

1. Phase 1+2 → Foundation ready, CSS compiled, toast variants available
2. Phase 3 → Theme correctness guaranteed
3. Phase 4 → RTL correctness guaranteed
4. Phase 5 → Keyboard accessibility guaranteed
5. Phase 6 → Toast lifecycle verified
6. Phase 7 → Error boundary verified
7. Phase 8 → CI gates pass, branch mergeable

---

## Notes

- All console commands run in Electron DevTools (F12) on a page loaded via `npm start`
- `[P]` tasks (T005, T006) edit different files with no shared state — safe to do simultaneously
- Each user story verification is independently completable in a single DevTools session
- If a verification test fails, the fix task within the same phase tells exactly which file and property to change
- Commit only after Phase 8 CI gates pass — do not commit broken CSS or JS

---

## Context for Implementing LLM

### Project facts (do not guess — these are verified):

- **App type**: Electron desktop app, vanilla JS, no bundler, no npm test framework for renderer
- **CSS**: Tailwind v4, source at `css/tailwind-input.css`, compiled to `css/tailwind-output.css` via `npm run css:build`
- **Dark mode**: Controlled by `[data-theme='dark']` on the document root (set by existing theme toggle)
- **RTL**: App is `dir="rtl" lang="ar"`, use logical CSS properties (`inset-inline-start`, `margin-inline-start`, etc.) — physical `left`/`right` are prohibited
- **JS style**: ES5 `var`, single quotes, 4-space indent, semicolons, 120-char line limit (enforced by ESLint + Prettier)
- **`js/message-system.js`**: EXISTS and is correct (380 lines). Do NOT rewrite it.
- **`js/utils.js`**: Error boundary EXISTS and is correct. Do NOT modify it.
- **`js/pages/settings-imports.js`**: `showConfirm()` is already wired at 4 call sites. Do NOT modify it.
- **`js/notifications.js`**: Only `window.showToast = renderToast` exists. Add the new code exactly as specified in T006.
- **`css/tailwind-input.css`**: Message system CSS is entirely absent. Add exactly as specified in T005.

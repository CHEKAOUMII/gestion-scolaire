# Tasks: Enhanced Toast Variants

**Input**: Design documents from `/specs/021-enhanced-toast-variants/`
**Branch**: `021-enhanced-toast-variants`
**Spec**: spec.md | **Plan**: plan.md | **Data Model**: data-model.md | **Research**: research.md

**Organization**: Tasks are grouped by user story. No tests are requested — implementation tasks only.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files or independent additions)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)
- Exact file paths are included in every task description

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Read existing code and understand the insertion points before writing anything.

- [x] T001 Read `js/notifications.js` in full to understand the existing IIFE structure, `renderToast` implementation, and the `window.showToast = renderToast` assignment at line 227
- [x] T002 Read `css/tailwind-input.css` to find the `@layer components {}` block and the last component class definition — this is the CSS insertion point for new toast classes
- [x] T003 Read `docs/superpowers/plans/2026-03-31-message-system.md` Phase 2 section to cross-reference the exact code expected from the plan

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Add the shared private helpers inside `js/notifications.js` that ALL three user stories depend on. **Must be complete before any user story phase begins.**

**⚠️ CRITICAL**: All tasks in this phase modify the same IIFE closure in `js/notifications.js`. Complete them sequentially.

- [x] T004 In `js/notifications.js`, extract the toast-container creation block from `renderToast` (lines 17–23) into a new private helper function `_ensureToastContainer()` placed immediately after the closing `}` of `renderToast` (after line 51). Then replace the inline container creation in `renderToast` with a call to `_ensureToastContainer()`.

    The helper must look exactly like this (matching existing style: `var`, single quotes, 4-space indent, semicolons):

    ```js
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

- [x] T005 In `js/notifications.js`, add the deduplication state variables and helper function directly after `_ensureToastContainer()`:

    ```js
    var _lastToastMessage = '';
    var _lastToastTime = 0;

    function _deduplicateToast(message) {
        var now = Date.now();
        if (message === _lastToastMessage && now - _lastToastTime < 2000) return true;
        _lastToastMessage = message;
        _lastToastTime = now;
        return false;
    }
    ```

- [x] T006 In `js/notifications.js`, add the no-op handle factory directly after `_deduplicateToast()`:

    ```js
    function _createNoopHandle() {
        return {
            success: function () {},
            error: function () {},
            progress: function () {},
            dismiss: function () {}
        };
    }
    ```

- [x] T007 In `js/notifications.js`, add click-to-dismiss to the existing `renderToast` function. After the line `container.appendChild(toast);` (currently line 42), insert:

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

**Checkpoint**: `js/notifications.js` now has `_ensureToastContainer`, `_deduplicateToast`, `_createNoopHandle` as private helpers, and `renderToast` gains click-to-dismiss. Run `npm run lint` — must pass with zero errors.

---

## Phase 3: User Story 1 — Loading Toast (Priority: P1) 🎯 MVP

**Goal**: `showToast.loading(message)` returns a stateful handle. Callers can transition the toast in-place to success or error, update a progress bar, or dismiss it.

**Independent Test**: Open DevTools console on any page. Run:

```js
const h = showToast.loading('جاري الحفظ...');
setTimeout(() => h.progress(50), 1000);
setTimeout(() => h.success('تم الحفظ بنجاح'), 2500);
```

Verify: spinner toast appears → progress bar fills to 50% → transitions to green success → auto-dismisses after 3s.

### Implementation for User Story 1

- [x] T008 [US1] In `css/tailwind-input.css`, append the following CSS block inside the `@layer components {}` section, after the last existing component class. This adds visual styles for the loading toast, its spinner animation, and the progress bar:

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

    [data-theme='dark'] .toast.loading {
        background: rgba(59, 106, 197, 0.15);
    }
    ```

- [x] T009 [US1] Run `npm run css:build` from the repo root to compile the new CSS. Expected: `css/tailwind-output.css` is updated with no errors. Fix any PostCSS errors before continuing.

- [x] T010 [US1] In `js/notifications.js`, add the `renderLoadingToast` function after `_createNoopHandle()` (after T006's insertion point) and before the `// ===== Notification center helpers =====` comment. The complete function:

    ```js
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
        closeBtn.type = 'button';
        closeBtn.setAttribute('aria-label', 'إغلاق');
        closeBtn.innerHTML = '<i class="fas fa-times"></i>';

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
    ```

- [x] T011 [US1] In `js/notifications.js`, find the line `window.showToast = renderToast;` (near the bottom of the IIFE, currently line 227) and replace it with:

    ```js
    window.showToast = renderToast;
    window.showToast.loading = renderLoadingToast;
    ```

- [x] T012 [US1] Run `npm run lint` from the repo root. Fix any ESLint errors before continuing. Common issues: unused variable warnings in main-process code (renderer code has relaxed rules, so these are fine).

**Checkpoint**: User Story 1 is fully functional. Loading toast appears, transitions in-place, progress bar animates. Verify with the Independent Test above before proceeding.

---

## Phase 4: User Story 2 — Action Toast (Priority: P2)

**Goal**: `showToast.action(message, actionConfig, opts?)` shows a toast with an inline action button. Clicking the button invokes the callback and dismisses immediately. Toast auto-dismisses after 8s by default.

**Independent Test**: Open DevTools console on any page. Run:

```js
showToast.action('تم حذف السجل', {
    label: 'تراجع',
    icon: 'fa-undo',
    onClick: function () {
        console.log('UNDO clicked');
    }
});
```

Verify: toast appears with "تراجع" button → clicking button logs "UNDO clicked" → toast dismisses. Also verify clicking the toast body dismisses without logging.

### Implementation for User Story 2

- [x] T013 [US2] In `css/tailwind-input.css`, inside the `@layer components {}` section (after the block added in T008), append the action button style:

    ```css
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
    ```

- [x] T014 [US2] Run `npm run css:build` to compile the updated CSS. Expected: no errors.

- [x] T015 [US2] In `js/notifications.js`, add the `renderActionToast` function after `renderLoadingToast` (after the closing `}` of the function added in T010) and before the `// ===== Notification center helpers =====` comment:

    ```js
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
            if (e.target.closest('.toast-action-btn')) {
                if (typeof actionConfig.onClick === 'function') actionConfig.onClick();
                dismissToast();
                return;
            }
            dismissToast();
        });

        setTimeout(dismissToast, duration);
    }
    ```

- [x] T016 [US2] In `js/notifications.js`, add `.action` to the exports block. The two lines at the bottom of the IIFE (updated in T011) should now read:

    ```js
    window.showToast = renderToast;
    window.showToast.loading = renderLoadingToast;
    window.showToast.action = renderActionToast;
    ```

- [x] T017 [US2] Run `npm run lint` from the repo root. Fix any errors.

**Checkpoint**: User Story 2 is fully functional. Verify with the Independent Test above.

---

## Phase 5: User Story 3 — Click-to-Dismiss All Toasts (Priority: P3)

**Goal**: All toast types (including existing standard toasts) dismiss immediately when the user clicks the toast body.

**Note**: This was implemented in Phase 2 (T007) as a foundational change to `renderToast`. This phase is a **verification-only** checkpoint — no new code is written.

**Independent Test**: Call `showToast('رسالة تجريبية', 'success')` in console. Click the toast body before the 3-second auto-dismiss. Verify it fades and removes within 300ms.

### Implementation for User Story 3

- [x] T018 [US3] Verify T007 from Phase 2 was correctly applied. Read `js/notifications.js` and confirm that `renderToast` contains a `toast.addEventListener('click', ...)` block after `container.appendChild(toast)`. If it is missing, add it now:

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

**Checkpoint**: All three user stories are independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, dark theme verification, RTL check, and CI gate.

- [x] T019 [P] Run `npm run css:build` one final time and confirm the build completes in under 10 seconds with no errors
- [x] T020 [P] Run `npm run lint` and confirm zero errors across all modified files
- [x] T021 Run `npm run test:smoke` and confirm all checks pass (IPC parity, no CDN refs, CSS output present)
- [ ] T022 Manual dark theme check: toggle `document.documentElement.setAttribute('data-theme', 'dark')` in DevTools, then trigger all three toast types. Verify readable contrast for `.toast.loading` in dark theme.
- [ ] T023 Manual RTL check: confirm the loading toast close button (`×`) appears on the **right** edge (reading-start in RTL Arabic layout). This is controlled by `inset-inline-start: 6px` in the CSS — verify it renders correctly.
- [ ] T024 Manual deduplication check: call `showToast.loading('test')` twice within 1 second. Verify only one toast appears.
- [ ] T025 Manual no-op guard check: run `const h = showToast.loading('x'); h.dismiss(); h.success('should not appear');` — verify no second toast or transition occurs after dismiss.
- [ ] T026 Commit all changes with conventional commit message:
    ```
    git add js/notifications.js css/tailwind-input.css
    git commit -m "feat: add showToast.loading() and showToast.action() enhanced variants"
    ```

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — read files first, start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS all user stories
- **Phase 3 (US1 — Loading Toast)**: Depends on Phase 2 completion
- **Phase 4 (US2 — Action Toast)**: Depends on Phase 2 completion; can run after Phase 3 or in parallel once foundational helpers exist
- **Phase 5 (US3 — Click-to-Dismiss)**: Verification only; depends on Phase 2 (T007)
- **Phase 6 (Polish)**: Depends on all story phases complete

### User Story Dependencies

- **US1 (Loading Toast)**: Independent after Phase 2
- **US2 (Action Toast)**: Independent after Phase 2 — shares `_ensureToastContainer` and `_deduplicateToast` helpers from Phase 2 but adds no dependency on US1
- **US3 (Click-to-Dismiss)**: Already implemented in Phase 2 (T007); Phase 5 is verification only

### Within Each Phase

- CSS tasks (T008, T013) must run before their corresponding `npm run css:build` tasks (T009, T014)
- `renderLoadingToast` (T010) must exist before the exports line is updated (T011)
- `renderActionToast` (T015) must exist before the exports line is updated (T016)
- All foundational helpers (T004–T007) must be complete before any US implementation task

### Parallel Opportunities

- T008 (CSS for US1) and T005/T006 (JS helpers) can run in parallel — different files
- T013 (CSS for US2) can run in parallel with T010 (JS for US1 loading toast)
- T019, T020 (final build + lint) can run in parallel
- T022, T023, T024, T025 (manual checks) can run in parallel

---

## Parallel Example: Phase 2 + Phase 3 Setup

```
After T003 (read files) is done:

Parallel track A (js/notifications.js edits):
  T004 → T005 → T006 → T007

Parallel track B (css/tailwind-input.css edits):
  T008 → T009 (css:build verify)

Then:
  T010 → T011 → T012 (lint) ← Phase 3 complete
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Read files (T001–T003)
2. Complete Phase 2: Foundational helpers (T004–T007)
3. Complete Phase 3: Loading toast (T008–T012)
4. **STOP and validate**: Run Independent Test for US1 in DevTools console
5. Loading toast is shippable as MVP

### Incremental Delivery

1. Setup + Foundational → shared helpers ready
2. US1 → loading toast works → validate → commit
3. US2 → action toast works → validate → commit
4. US3 → verify click-to-dismiss → commit
5. Polish → CI gate passes → merge

### Single-Developer Fast Path

All tasks are sequential in a single file pair. Recommended order:
`T001 → T002 → T003 → T004 → T005 → T006 → T007 → T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021 → T022 → T023 → T024 → T025 → T026`

---

## Notes

- **No new files** — all changes are inside `js/notifications.js` and `css/tailwind-input.css`
- **No IPC changes** — pure renderer-only feature
- **`var` not `let/const`** — the existing IIFE uses ES5 `var` throughout; match this style
- **Single quotes** — Prettier config enforces single quotes; use them everywhere
- **4-space indent** — match the existing indentation exactly
- **Arabic strings** — all user-facing message strings must be in Arabic (e.g., `'جاري الحفظ...'`)
- **[P] tasks** can be done in parallel (different files or sections with no write conflict)
- Each story has an independent test — run it before marking the story done
- Commit after each story phase is validated, not at the very end

# Tasks: Global Error Boundary

**Input**: Design documents from `/specs/023-global-error-boundary/`
**Branch**: `023-global-error-boundary`
**Prerequisites**: plan.md ✅ · spec.md ✅ · research.md ✅ · data-model.md ✅

**Organization**: Tasks follow the 3 user stories from spec.md (P1 → P2 → P3), all implemented inside a single IIFE block inserted at the top of `js/utils.js`. No new files, no HTML changes, no new IPC channels.

---

## Critical Context for the Implementing LLM

Read this before touching any file.

**One file is modified**: `js/utils.js`

**What already exists** (do not create or duplicate):

- `window.showToast(message, type, duration)` — defined in `js/notifications.js`, available at page runtime as `window.showToast`. Call it as `window.showToast('text', 'error', 5000)`.
- `window.api.systemLogs.add({ action, details, entity_type, entity_id })` — existing IPC channel exposed in `preload.js`. Writes to the `system_logs` SQLite table. Use this for all logging.
- A **duplicate `showToast` function** exists in `js/utils.js` around line 1832 — this MUST be removed as part of this work.

**Load order**: `js/utils.js` loads first (first `defer` script on every page). The error boundary IIFE must be at the very top of `utils.js` so it registers its listeners before any other script runs.

**Toast guard**: Always wrap `showToast` calls with `typeof showToast === 'function'` — `notifications.js` may not have executed yet during very early errors.

**IPC guard**: Always wrap `window.api.systemLogs.add` calls in a `try/catch` — the IPC bridge may not be available in every context.

**Code style** (enforced by Prettier + ESLint — `npm run lint` must pass):

- Single quotes, 4-space indent, semicolons, 120-char line width, no trailing commas
- `var` is acceptable for IIFE-scoped variables (renderer code follows relaxed ESLint rules)
- All Arabic strings use RTL text — do not modify them

---

## Phase 1: Setup

**Purpose**: Confirm the working environment and understand the existing file before modifying it.

- [x] T001 Read `js/utils.js` from top to bottom — note the opening comment block (end of it is the insertion point for the IIFE), locate the duplicate `showToast` function near line 1832, and confirm no existing `window.addEventListener('error')` or `window.addEventListener('unhandledrejection')` handler is present
- [x] T002 Confirm `window.api.systemLogs.add` is exposed by searching `preload.js` for `systemLogs` — verify the payload shape `{ action, details, entity_type, entity_id }` matches what `main/ipc/system.js` expects

**Checkpoint**: You understand the file structure and know exactly where to insert the IIFE and where to remove the duplicate.

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: Insert the IIFE skeleton into `js/utils.js` before the user stories add behaviour. This must be done first because all three user stories add code inside this same IIFE.

**⚠️ CRITICAL**: Phases 3, 4, and 5 all extend the IIFE created here. Do not start them until this phase is complete.

- [x] T003 In `js/utils.js`, immediately after the opening comment block (before any `const`/`var` declarations), insert the following skeleton IIFE — leave the inner functions empty for now:

    ```js
    // ===== Global Error Boundary =====
    (function () {
        'use strict';

        var THROTTLE_MS = 3000;
        var FLOOD_LIMIT = 5;
        var FLOOD_WINDOW_MS = 10000;
        var ERROR_TOAST_DURATION = 5000;
        var REJECTION_TOAST_DURATION = 4000;
        var FLOOD_TOAST_DURATION = 8000;

        var _lastToastTime = 0;
        var _errorCount = 0;
        var _windowStart = 0;
        var _floodStopped = false;

        function _logToMain(action, data) {
            // implemented in Phase 3
        }

        function _shouldShowToast() {
            // implemented in Phase 4
            return false;
        }

        window.addEventListener('error', function (event) {
            // implemented in Phase 3 and 4
        });

        window.addEventListener('unhandledrejection', function (event) {
            // implemented in Phase 3 and 4
        });
    })();
    ```

- [x] T004 Run `npm run lint` and confirm zero errors — the empty IIFE skeleton must be clean before adding logic

**Checkpoint**: IIFE skeleton is in place. `npm run lint` passes.

---

## Phase 3: User Story 1 — Unexpected Error Surfaces a Clear Notification (Priority: P1) 🎯 MVP

**Goal**: Every unhandled script error and promise rejection shows an Arabic error toast to the user within 1 second, auto-dismissing without user action.

**Independent Test**: Open any page (e.g. `index.html`) in the Electron app. Open DevTools console. Run `throw new Error('test')`. An Arabic error toast must appear within 1 second and disappear automatically after ~5 seconds. Then wait 3 seconds and run `Promise.reject('test rejection')`. A second Arabic toast must appear.

### Implementation for User Story 1

- [x] T005 [US1] In `js/utils.js`, implement `_logToMain(action, data)` inside the IIFE — this function forwards structured error data to the main process:

    ```js
    function _logToMain(action, data) {
        try {
            if (window.api && window.api.systemLogs && window.api.systemLogs.add) {
                window.api.systemLogs.add({
                    action: action,
                    details: JSON.stringify(data),
                    entity_type: 'renderer',
                    entity_id: window.location.pathname
                });
            }
        } catch (_) {}
    }
    ```

- [x] T006 [US1] In `js/utils.js`, wire the `window.addEventListener('error', ...)` handler to call `_logToMain` and show an Arabic toast — implement the full handler body:

    ```js
    window.addEventListener('error', function (event) {
        _logToMain('uncaught_error', {
            message: event.message,
            filename: event.filename,
            lineno: event.lineno,
            stack: event.error ? event.error.stack : ''
        });
        if (_shouldShowToast()) {
            if (typeof showToast === 'function') {
                showToast('حدث خطأ غير متوقع', 'error', ERROR_TOAST_DURATION);
            }
        }
    });
    ```

- [x] T007 [US1] In `js/utils.js`, wire the `window.addEventListener('unhandledrejection', ...)` handler similarly:

    ```js
    window.addEventListener('unhandledrejection', function (event) {
        var reason = event.reason || {};
        _logToMain('unhandled_rejection', {
            message: String(reason.message || reason),
            stack: reason.stack || ''
        });
        if (_shouldShowToast()) {
            if (typeof showToast === 'function') {
                showToast('خطأ في معالجة العملية', 'error', REJECTION_TOAST_DURATION);
            }
        }
    });
    ```

- [x] T008 [US1] Implement `_shouldShowToast()` with a stub that **always returns `true`** for now (flood protection is added in Phase 4):

    ```js
    function _shouldShowToast() {
        return true;
    }
    ```

- [ ] T009 [US1] Run `npm run lint` — confirm zero errors. Then manually verify in the Electron app: open DevTools on any page, run `throw new Error('test')`, confirm Arabic toast appears and auto-dismisses.

**Checkpoint**: User Story 1 is fully functional. Errors and rejections show Arabic toasts. Logging goes to `systemLogs`. `npm run lint` passes.

---

## Phase 4: User Story 2 — Rapid Error Storms Do Not Flood the Screen (Priority: P2)

**Goal**: Replace the stub `_shouldShowToast()` with real throttle + flood-protection logic so that no more than one toast shows per 3-second window, and 5+ errors in 10 seconds switches to a single Arabic reload-warning toast.

**Independent Test**: Open DevTools on any page. Run this in the console to fire 8 errors rapidly:

```js
for (let i = 0; i < 8; i++)
    setTimeout(() => {
        throw new Error('flood test ' + i);
    }, i * 50);
```

Expected: Only 1 individual error toast appears (throttle), then 1 flood-warning toast (`'أخطاء متعددة — يرجى إعادة تحميل الصفحة'`), then silence. After 10 seconds, run `throw new Error('recovery')` — a normal error toast must reappear.

### Implementation for User Story 2

- [x] T010 [US2] In `js/utils.js`, replace the stub `_shouldShowToast()` with the full throttle and flood-protection implementation:

    ```js
    function _shouldShowToast() {
        var now = Date.now();

        // Reset window if expired
        if (now - _windowStart > FLOOD_WINDOW_MS) {
            _errorCount = 0;
            _windowStart = now;
            _floodStopped = false;
        }

        _errorCount++;

        // Flood protection: too many errors in window
        if (_errorCount > FLOOD_LIMIT) {
            if (!_floodStopped) {
                _floodStopped = true;
                if (typeof showToast === 'function') {
                    showToast('أخطاء متعددة — يرجى إعادة تحميل الصفحة', 'error', FLOOD_TOAST_DURATION);
                }
            }
            return false;
        }

        // Throttle: too soon since last toast
        if (now - _lastToastTime < THROTTLE_MS) {
            return false;
        }

        _lastToastTime = now;
        return true;
    }
    ```

- [ ] T011 [US2] Run `npm run lint` — confirm zero errors. Manually verify the flood scenario: fire 8 rapid errors, confirm only 1 individual toast + 1 flood warning appear. Wait 10+ seconds, fire 1 more error, confirm normal toast reappears.

**Checkpoint**: User Story 2 is complete. Error storms are rate-limited and the reload warning appears correctly.

---

## Phase 5: User Story 3 — Errors Are Silently Logged for Diagnosis (Priority: P3)

**Goal**: Confirm that `_logToMain` writes a structured log entry for every intercepted error — including those suppressed by throttle or flood protection. Logging must be unconditional.

**Independent Test**: Open the Electron app with DevTools. Navigate to Settings → Logs (or the system logs viewer if available). In DevTools console: fire 8 rapid errors to trigger flood protection (so display is suppressed). Then check the system logs — all 8 errors must have a log entry even though only 1–2 toasts were shown.

Alternatively, verify via the IPC layer: in DevTools, add a temporary log: `const orig = window.api.systemLogs.add; window.api.systemLogs.add = (p) => { console.log('LOG:', p); return orig(p); };` — then fire errors and confirm every error produces a console log entry.

### Implementation for User Story 3

- [x] T012 [US3] Audit the `window.addEventListener('error', ...)` handler in `js/utils.js` and confirm that `_logToMain(...)` is called **before** the `_shouldShowToast()` check — logging must never be gated by throttle state. The handler order must be: (1) `_logToMain`, (2) `if (_shouldShowToast()) { showToast(...) }`. Fix if the order is wrong.

- [x] T013 [US3] Audit the `window.addEventListener('unhandledrejection', ...)` handler in `js/utils.js` and confirm the same unconditional logging order. Fix if needed.

- [x] T014 [US3] Verify the `_logToMain` payload is complete: `action` is `'uncaught_error'` or `'unhandled_rejection'`, `details` is a valid JSON string with `message` + `filename` + `lineno` + `stack` (error handler) or `message` + `stack` (rejection handler), `entity_type` is `'renderer'`, `entity_id` is `window.location.pathname`.

- [ ] T015 [US3] Run `npm run lint` — confirm zero errors. Perform manual log audit: trigger 6 rapid errors (to activate flood protection), then open the system logs UI or temporarily instrument `window.api.systemLogs.add` as described in the Independent Test — verify 6 log entries were written despite only 1–2 toasts being shown.

**Checkpoint**: All 3 user stories are complete. Every error is logged unconditionally; throttle and flood protection affect display only.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Remove dead code, run the full CI gate, and do a final RTL visual check.

- [x] T016 In `js/utils.js`, find and **delete** the duplicate `showToast` function near line 1832 (it is a local function declaration that predates `js/notifications.js` — the global `window.showToast` is the correct one to use). Search for `function showToast(` in `js/utils.js` to locate it exactly.

- [x] T017 [P] Run the full CI sequence and confirm all gates pass:

    ```bash
    npm run css:build
    npm run lint
    npm run test:smoke
    ```

- [ ] T018 [P] Do a manual RTL visual check: launch `npm run dev`, open at least 3 different pages (e.g. `index.html`, `students-list.html`, `settings-imports.html`), trigger `throw new Error('visual check')` in DevTools on each — confirm the Arabic toast text renders correctly RTL in both light and dark themes (`[data-theme="dark"]`).

- [ ] T019 Commit all changes with a conventional commit message:
    ```
    feat: add global error boundary with throttling and flood protection
    ```

**Checkpoint**: CI passes. Visual check done. Duplicate `showToast` removed. Feature complete.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 — BLOCKS Phases 3, 4, 5
- **Phase 3 (US1 — Toast notification)**: Depends on Phase 2
- **Phase 4 (US2 — Throttle + flood)**: Depends on Phase 3 (extends `_shouldShowToast`)
- **Phase 5 (US3 — Log audit)**: Depends on Phase 3 (audits handlers written in Phase 3)
- **Phase 6 (Polish)**: Depends on Phases 3, 4, 5 all complete

### User Story Dependencies

- **US1 (P1)**: Can start after Phase 2 — no dependency on US2 or US3
- **US2 (P2)**: Depends on US1 (replaces `_shouldShowToast` stub written in US1)
- **US3 (P3)**: Depends on US1 (audits handlers written in US1) — can run in parallel with US2

### Within Each Phase

- Implement tasks top-to-bottom within each phase
- Run `npm run lint` after each phase before proceeding
- All changes are in a single file (`js/utils.js`) — no parallel file opportunities within phases

---

## Parallel Opportunities

Tasks within Phase 6 marked `[P]` (T017, T018) can run together:

```
Phase 6 parallel:
  Task T017: npm run css:build && npm run lint && npm run test:smoke
  Task T018: npm run dev → manual RTL visual check across 3 pages
```

US3 (Phase 5) and US2 (Phase 4) can overlap if the implementer is confident: Phase 5 only audits and validates handler order (read-only verification), while Phase 4 replaces the stub function.

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (read and understand `js/utils.js`)
2. Complete Phase 2: Foundational (insert IIFE skeleton)
3. Complete Phase 3: User Story 1 (wire error handlers + logging + stub `_shouldShowToast`)
4. **STOP and VALIDATE**: Throw an error in DevTools — confirm Arabic toast appears, log is written
5. This alone is a working error boundary with full logging

### Incremental Delivery

1. Phase 1 + 2 → IIFE skeleton in place
2. Phase 3 → MVP: errors surface as Arabic toasts, all logged ✅
3. Phase 4 → Add throttle + flood protection ✅
4. Phase 5 → Audit and confirm logging is unconditional ✅
5. Phase 6 → Remove dead code, CI gate, commit ✅

---

## Notes

- All tasks modify only `js/utils.js` — no parallel file-level work is possible between phases
- `[P]` marks only appear in Phase 6 where the CI commands and manual check are independent
- The implementing LLM should **not** introduce any new `npm` packages, new files, HTML changes, or IPC channels — all required infrastructure already exists
- If `npm run lint` fails after any phase, fix linting errors before proceeding to the next phase
- The duplicate `showToast` removal in T016 is safe — `js/notifications.js` sets `window.showToast` which is what the error boundary calls

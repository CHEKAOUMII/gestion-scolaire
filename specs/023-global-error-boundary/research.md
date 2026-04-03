# Research: Global Error Boundary

**Feature**: `023-global-error-boundary`
**Date**: 2026-03-31

---

## Decision 1: Where to place the error boundary code

**Decision**: Add the global error boundary as a self-contained IIFE at the very top of `js/utils.js`, inserted after the opening comment block (before any other code).

**Rationale**: `utils.js` is the first script loaded on every page (it precedes `notifications.js`, `sidebar.js`, and all page-specific scripts in `index.html` and every other page). Placing the boundary at the top of `utils.js` — without a separate file — means it registers `window.addEventListener('error')` and `window.addEventListener('unhandledrejection')` before any other renderer code runs, maximising error capture coverage. No new HTML `<script>` tag is needed across 46 pages.

**Alternatives considered**:
- *New standalone file `js/message-system.js`* — requires adding a `<script>` tag to all 46 HTML pages; rejected because it is a large, fragile edit with no coverage benefit over placing the boundary in `utils.js`.
- *`js/ux-enhancements.js`* — loads later than `utils.js`; errors thrown by `notifications.js` or `sidebar.js` would not be caught; rejected.
- *`js/notifications.js`* — circular dependency risk (the boundary calls `showToast`; if `notifications.js` itself errors during load the boundary would be offline); rejected.

---

## Decision 2: Dependency on `showToast` before it is available

**Decision**: Guard every `showToast` call with `typeof showToast === 'function'` before calling it. If `notifications.js` has not yet executed (very-early-load errors), the boundary still logs to the main process but skips the toast silently.

**Rationale**: All scripts use `defer`, so there is a narrow window where the boundary can fire before `showToast` is defined. The guard prevents a secondary error inside the error handler — which would itself trigger the boundary in an infinite loop.

**Alternatives considered**:
- *Load `notifications.js` without `defer`* — changes load semantics for all pages; over-engineered for a narrow edge case; rejected.
- *Queue toasts until `showToast` is available* — adds complexity for a very unlikely scenario (errors during script parse, not runtime); rejected.

---

## Decision 3: IPC logging channel to use

**Decision**: Use the existing `window.api.systemLogs.add(payload)` IPC channel (exposed in `preload.js` at line 192–194, backed by `systemLogs:add` in `main/ipc/system.js`).

**Rationale**: The channel already exists, is already registered, and writes to the `system_logs` table. No new IPC channel, no changes to `preload.js`, no changes to `main/ipc/`, and no smoke-test parity risk. The payload shape (`action`, `details`, `entity_type`, `entity_id`) maps cleanly to error boundary data.

**Alternatives considered**:
- *New `errorLog:add` IPC channel* — would require the three-file rule (handler + registerAll + preload), triggering smoke test changes; rejected as unnecessary when `systemLogs:add` already serves the purpose.
- *`console.error` only (no IPC)* — errors would only appear in DevTools, not in the admin log viewer; rejected because the spec requires structured log entries.

**Payload mapping**:
| `system_logs` field | Error boundary value |
|---------------------|----------------------|
| `action`            | `'uncaught_error'` or `'unhandled_rejection'` |
| `details`           | JSON string of `{ message, filename, lineno, stack }` |
| `entity_type`       | `'renderer'` |
| `entity_id`         | `window.location.pathname` (identifies the page) |

---

## Decision 4: Throttle and flood-protection implementation

**Decision**: In-memory variables within the IIFE scope: `_lastToastTime` (timestamp of last shown toast), `_errorCount` (running count in current window), `_windowStart` (start of current 10-second window), `_floodStopped` (boolean flag). Constants: `THROTTLE_MS = 3000`, `FLOOD_LIMIT = 5`, `FLOOD_WINDOW_MS = 10000`.

**Rationale**: Per-page in-memory state is exactly what the spec requires. No persistence, no cross-page sharing, no external dependencies. The IIFE scope keeps all state private and prevents any accidental global mutation.

**Alternatives considered**:
- *`sessionStorage` for state* — unnecessary persistence across page refreshes; rejected.
- *Shared state across windows* — spec explicitly says per-page state is acceptable; rejected.

---

## Decision 5: Duplicate `showToast` cleanup

**Decision**: The duplicate `function showToast()` in `js/utils.js` at line ~1832 is removed as part of this feature. The duplicate in `js/pages/timetable.js` at line ~1811 is out of scope for this feature (covered by the plan's Task 4.1 in the parent message-system plan).

**Rationale**: The duplicate in `utils.js` is in the same file being modified. Removing it now avoids a naming collision risk where the local function declaration could shadow `window.showToast` in some execution contexts. The `timetable.js` duplicate is a separate concern on a different page.

---

## Decision 6: Toast message text (Arabic)

| Scenario | Arabic message |
|----------|----------------|
| Unhandled script error | `'حدث خطأ غير متوقع'` ("An unexpected error occurred") |
| Unhandled promise rejection | `'خطأ في معالجة العملية'` ("Error processing the operation") |
| Flood protection warning | `'أخطاء متعددة — يرجى إعادة تحميل الصفحة'` ("Multiple errors — please reload the page") |

**Rationale**: Messages match the spec requirements, are consistent with existing Arabic UI text patterns in the app, and fit the toast display area without truncation.

---

## No-change decisions

- **No new npm packages** — pure vanilla JS, no new dependencies.
- **No new HTML files** — boundary lives in `utils.js`.
- **No database migrations** — `system_logs` table already exists.
- **No CSS changes** — error boundary uses existing toast styles; no new visual components.
- **No changes to `preload.js`** — `systemLogs.add` is already exposed.
- **No changes to `main/ipc/`** — `systemLogs:add` handler already exists.

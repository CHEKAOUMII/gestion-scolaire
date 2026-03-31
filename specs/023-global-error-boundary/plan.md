# Implementation Plan: Global Error Boundary

**Branch**: `023-global-error-boundary` | **Date**: 2026-03-31 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/023-global-error-boundary/spec.md`

## Summary

Add a global error boundary to the renderer layer that silently intercepts all unhandled JavaScript errors and promise rejections on every application page, surfaces user-friendly Arabic toast notifications with 3-second throttling and 5-error/10-second flood protection, and forwards structured log entries to the existing `systemLogs:add` IPC channel. Implemented as a self-contained IIFE at the top of `js/utils.js` — no new files, no new IPC channels, no HTML changes across 46 pages.

## Technical Context

**Language/Version**: Vanilla JavaScript (ES6+), Node.js 24 LTS (Electron main)
**Primary Dependencies**: Electron (renderer/main boundary), existing `window.showToast` from `js/notifications.js`, existing `window.api.systemLogs.add` IPC channel
**Storage**: Existing `system_logs` SQLite table (no schema changes)
**Testing**: `npm run test:smoke` (smoke test), `npm run lint` (ESLint), manual DevTools console verification
**Target Platform**: Electron desktop app, Windows (school hardware, 4 GB RAM / HDD)
**Project Type**: Multi-page Electron desktop app, vanilla JS, no bundler
**Performance Goals**: Error handler must not block the UI thread; all state operations are O(1) in-memory comparisons
**Constraints**: No new npm packages; no CDN references; no new HTML `<script>` tags across 46 pages; no new IPC channels; must not introduce ESLint errors
**Scale/Scope**: 46 HTML pages, single renderer per page, one error boundary instance per page

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
|-----------|-------|--------|
| I — Formatting (Prettier: single quotes, 4-space indent, semicolons, 120-char) | Error boundary IIFE must pass `npm run format` | ✅ Required |
| I — Linting (ESLint zero errors, renderer relaxed rules) | No `no-unused-vars` errors; renderer rules apply to `js/utils.js` | ✅ Required |
| I — No dead code | Remove duplicate `showToast` function from `js/utils.js` as part of this change | ✅ Required |
| II — CI gate (`test:smoke` passes) | No IPC changes; smoke test parity unaffected | ✅ No risk |
| II — No CDN references | No new vendor scripts introduced | ✅ No risk |
| III — RTL-first | Error boundary adds no new UI elements; uses existing toast (already RTL-compliant) | ✅ No risk |
| III — Arabic text | All three toast messages authored in Arabic RTL | ✅ Required |
| III — Dark mode | No new CSS; existing toast handles dark mode | ✅ No risk |
| III — Consistent interaction patterns | Uses `window.showToast()` — the mandated toast utility | ✅ Compliant |
| IV — IPC contract | Uses existing `window.api.systemLogs.add`; no new channels | ✅ Compliant |
| IV — No bundler | Vanilla JS IIFE, no imports | ✅ Compliant |
| IV — Three-file rule | No new IPC feature — not triggered | ✅ N/A |
| V — Memory | IIFE state is 4 primitive variables; negligible | ✅ Compliant |

**Complexity Tracking**: No violations. No justification table needed.

## Project Structure

### Documentation (this feature)

```text
specs/023-global-error-boundary/
├── plan.md              ← this file
├── research.md          ← Phase 0 output
├── data-model.md        ← Phase 1 output
└── tasks.md             ← Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (modified files only)

```text
js/
└── utils.js             ← Insert error boundary IIFE at top (after opening comment);
                            remove duplicate showToast at line ~1832
```

**No new files. No HTML changes. No IPC changes. No CSS changes.**

---

## Phase 0: Research

*Complete. See [research.md](research.md) for all decisions and rationale.*

**Key findings**:
- Zero existing global error handlers in the renderer layer
- `js/utils.js` is the correct insertion point — it is the first `defer` script on every page
- `window.showToast(msg, 'error', duration)` is the correct toast API (self-creates its container)
- `window.api.systemLogs.add(payload)` already exists — no new IPC needed
- `system_logs` table already exists — no migration needed
- 46 HTML pages require no changes

---

## Phase 1: Design

### Data Flow

```
Runtime error / rejected promise
        │
        ▼
window.addEventListener('error' | 'unhandledrejection')   ← registered at page load
        │
        ├─→ _logToMain(payload)          ← always, unconditionally
        │       └─→ window.api.systemLogs.add({ action, details, entity_type, entity_id })
        │
        └─→ _shouldShowToast(message)?
                ├─ NO (throttled / flood-stopped) → skip toast
                └─ YES
                        ├─ flood triggered? → showToast(floodMsg, 'error', 8000)
                        └─ normal          → showToast(errorMsg, 'error', 5000 or 4000)
```

### State Machine (per page, in-memory IIFE scope)

```
State: IDLE
  ─ error arrives ──────────────────────────────────────────────────────────→ log always
  ─ _errorCount++ ; reset window if >10s elapsed
  ─ if _errorCount > FLOOD_LIMIT and !_floodStopped:
      _floodStopped = true → show flood toast → State: FLOOD_STOPPED
  ─ if now - _lastToastTime < THROTTLE_MS:
      → skip toast → State: IDLE
  ─ else:
      _lastToastTime = now → show toast → State: IDLE

State: FLOOD_STOPPED
  ─ error arrives → log always; suppress toast
  ─ if now - _windowStart > FLOOD_WINDOW_MS:
      reset _errorCount, _floodStopped → State: IDLE
```

### Interface Contracts

This feature has no external interface. It wires into existing interfaces:

| Existing interface | Usage |
|--------------------|-------|
| `window.showToast(message, type, duration)` | Called to display error toasts |
| `window.api.systemLogs.add(payload)` | Called to write structured log entries |

Both are read-only usages of existing contracts — no new contracts defined.

### Logging Payload Shape

```js
window.api.systemLogs.add({
    action:      'uncaught_error' | 'unhandled_rejection',
    details:     JSON.stringify({ message, filename, lineno, stack }),
    entity_type: 'renderer',
    entity_id:   window.location.pathname   // identifies the page (e.g. '/timetable.html')
});
```

### Constants

| Constant | Value | Meaning |
|----------|-------|---------|
| `THROTTLE_MS` | `3000` | Minimum ms between shown toasts |
| `FLOOD_LIMIT` | `5` | Max errors shown individually per window |
| `FLOOD_WINDOW_MS` | `10000` | Rolling error-count window duration |
| `ERROR_TOAST_DURATION` | `5000` | Auto-dismiss ms for uncaught errors |
| `REJECTION_TOAST_DURATION` | `4000` | Auto-dismiss ms for unhandled rejections |
| `FLOOD_TOAST_DURATION` | `8000` | Auto-dismiss ms for flood warning |

### Toast Strings (Arabic)

| Scenario | Message |
|----------|---------|
| Uncaught error | `'حدث خطأ غير متوقع'` |
| Unhandled rejection | `'خطأ في معالجة العملية'` |
| Flood protection | `'أخطاء متعددة — يرجى إعادة تحميل الصفحة'` |

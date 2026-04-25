# Research: Sync Settings UI

**Feature**: 006-sync-settings-ui
**Date**: 2026-03-21

## R1: HTML Page Structure Pattern

**Decision**: Follow the `settings-imports.html` pattern (the most modern settings page).

**Rationale**: This is the canonical modern template with `defer` attributes, `meta description`, `meta theme-color`, noscript block, and full quick-nav panel. Other settings pages (license, school) use an older, simpler pattern.

**Key structure**:
- Head: `lang="ar" dir="rtl"`, 3 CSS links (`google-fonts.css`, `fontawesome/all.min.css`, `tailwind-output.css`), 4 scripts (`utils.js defer`, `notifications.js` **no defer**, `sidebar.js defer`, `ux-enhancements.js defer`)
- Body: `<noscript>` block → `<div class="toast-container" id="toast-container">` → `<aside class="sidebar" id="sidebar"></aside>` (empty, injected by `sidebar.js`) → `<main class="main-content standalone-page ...">`
- Main content: `<header class="header unified-header">` → `<div class="page-title-row">` → `<div class="grades-container">` with `<div class="students-results">` sections
- Bottom: `<script src="js/pages/settings-sync.js" defer></script>`

**Alternatives considered**: Inline `<script>` at bottom of body (settings-license/settings-school pattern) — rejected because separate JS file is cleaner and follows the established pattern for complex pages.

---

## R2: Content Section Pattern

**Decision**: Use `<div class="students-results">` sections with `<h3>` headings inside `<div class="grades-container">`.

**Rationale**: This is the most widely used section container across settings pages. It provides consistent glass-panel styling with proper spacing and dark mode support.

**Alternatives considered**:
- `identity-section` + `identity-form` (settings-school) — rejected; specific to key-value form groups, not suitable for mixed content sections.
- `search-section` (settings-license) — acceptable but less common.

---

## R3: Status Display Pattern

**Decision**: Use a responsive grid of glass KPI cards (`grid gap-3 sm:grid-cols-2 xl:grid-cols-3`) with `aria-live="polite"` for accessibility.

**Rationale**: This exact pattern is already used in `settings-license.html` for device stats. Each card uses `rounded-[var(--radius-sm)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 shadow-[var(--shadow-soft)]` with a label `div` + value `div`.

**Alternatives considered**: Custom dashboard-style cards — rejected; existing glass cards are consistent with the app's design language.

---

## R4: Toast Notification Availability

**Decision**: `showToast(message, type)` is globally available via `js/notifications.js` loaded synchronously (no `defer`) in the head.

**Rationale**: Confirmed by reading all settings pages. `js/notifications.js` defines `showToast()` on `window` and must be loaded without `defer` so it's available when deferred scripts run.

**Usage**: `showToast('تم حفظ الإعدادات', 'success')` — types: `success`, `error`, `warning`, `info`.

---

## R5: IPC Contract — No New Channels Needed

**Decision**: The settings-sync page consumes only the 6 existing `sync:*` IPC channels. No new channels need to be added.

**Rationale**: All required data is served by the existing channels:
- `sync:getConfig` — load current configuration
- `sync:setConfig` — save configuration changes (admin only)
- `sync:getStatus` — poll sync engine state
- `sync:triggerNow` — manual sync trigger (admin only)
- `sync:getConflictLog` — load conflict list with filtering/pagination
- `sync:resolveConflict` — resolve individual conflicts (admin only)

Both `preload.js` and `main/ipc/sync.js` already declare these channels. The smoke test IPC parity check will pass without modifications.

---

## R6: Sidebar Injection and Sync Indicator

**Decision**: The sidebar is dynamically injected by `js/sidebar.js`. Add a sync settings menu item in the sidebar HTML template inside `sidebar.js`, and add a small status indicator element next to it.

**Rationale**: All pages use `<aside class="sidebar" id="sidebar"></aside>` with content injected by `sidebar.js`. The sync indicator must be part of this injected HTML to appear on all pages. The indicator will poll `sync:getStatus` on a timer and update its visual state.

**Implementation approach**: Add the indicator logic to `js/ux-enhancements.js` (or a new `js/sync-indicator.js` loaded on all pages) that reads `window.api.sync.getStatus()` every 15 seconds and updates a DOM element in the sidebar.

**Alternatives considered**: Adding indicator HTML directly in each page's sidebar aside — rejected; sidebar is dynamically injected so modifications go in `sidebar.js`.

---

## R7: Conflict Log Display Pattern

**Decision**: Use the `students-table` inside `table-responsive` pattern for the conflict log, with expandable rows for side-by-side data comparison.

**Rationale**: This is the standard table pattern across the app (used in settings-license for device tables, in students-list for student data). The expandable detail row is achieved by inserting a `<tr>` below the conflict row with `colspan` on click.

**Key UX decisions**:
- Conflict filtering: dropdown/select for status (all/unresolved/resolved)
- Pagination: simple prev/next with offset tracking (max 200 per page from backend)
- Detail view: expanded row shows local vs. remote data as formatted JSON with conflicting fields highlighted in color
- Resolution actions: two buttons per unresolved conflict — "قبول المحلي" (Accept Local) and "قبول البعيد" (Accept Remote)

---

## R8: Form Validation Pattern

**Decision**: Client-side validation before calling `sync:setConfig`, with inline validation messages.

**Rationale**: The backend validates `syncIntervalMinutes` (1–30) and returns `{ success: false, error }`. The UI should pre-validate to provide instant feedback:
- `syncIntervalMinutes`: integer, 1–30
- `authLambdaUrl`: non-empty string when enabling sync
- `schoolId`: non-empty string when enabling sync
- `awsRegion`: non-empty string when enabling sync

**Alternatives considered**: Server-only validation — rejected; round-trip for simple range checks is poor UX.

---

## R9: Auto-Refresh Strategy

**Decision**: Poll `sync:getStatus` every 10 seconds using `setInterval`. Clear interval on page unload to prevent memory leaks.

**Rationale**: The sync engine status changes on every push/pull cycle (every 1–30 minutes). 10-second polling provides near-real-time visibility without excessive IPC overhead. The status object is small (~20 fields of primitives).

**Implementation**:
```
let statusTimer = null;
DOMContentLoaded → statusTimer = setInterval(refreshStatus, 10000);
window.addEventListener('beforeunload', () => clearInterval(statusTimer));
```

**Alternatives considered**: WebSocket/IPC event push — rejected; not available in the current architecture, and polling is simple and sufficient.

---

## R10: Role-Based UI Restrictions

**Decision**: Check user role from `window.api.auth.getSession()` or equivalent. Hide/disable write controls for non-admin users.

**Rationale**: The backend already enforces admin-only on `sync:setConfig`, `sync:triggerNow`, and `sync:resolveConflict` via `handleWrite(['admin'])`. The UI should also visually indicate restrictions:
- Configuration form: inputs disabled, save button hidden
- Sync Now button: hidden or disabled
- Conflict resolution buttons: hidden

**Approach**: On page load, check session role. If not admin, add a `readonly` class to the page body and use CSS to hide `.admin-only` elements.

---

## R11: Smoke Test Compliance

**Decision**: The new page must satisfy all existing smoke test checks.

**Verified requirements**:
1. **IPC parity**: No new channels needed — all 6 sync channels already match between `preload.js` and `main/ipc/sync.js`.
2. **Sync registry completeness**: Write channels (`sync:setConfig`, `sync:triggerNow`, `sync:resolveConflict`) are already in the registry.
3. **No CDN references**: All vendor libs from `vendor/`.
4. **No inline `<style>` blocks**: Use only `tailwind-output.css`.
5. **No `handleWriteNoAuth`**: All sync write channels use `handleWrite`.

**New sidebar.js changes**: Adding a menu item for sync settings requires updating the sidebar template in `sidebar.js`. This does not affect smoke tests.

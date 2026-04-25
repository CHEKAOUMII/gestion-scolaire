# Tasks: Sync Settings UI

**Input**: Design documents from `/specs/006-sync-settings-ui/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ipc-sync.md, quickstart.md

**Tests**: Not requested in feature specification. Smoke tests (`npm run test:smoke`) serve as the quality gate.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing of each story.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

- Root-level HTML pages: `settings-sync.html`
- Page JS modules: `js/pages/settings-sync.js`
- Shared JS: `js/sidebar.js`, `js/ux-enhancements.js`
- CSS source: `css/tailwind-input.css`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Create the HTML page scaffold and shared CSS additions that all user stories build upon.

- [x] T001 Create `settings-sync.html` with full page scaffold following the `settings-imports.html` pattern: `<!doctype html>`, `<html lang="ar" dir="rtl">`, head with 3 CSS links (`vendor/fonts/google-fonts.css`, `vendor/fontawesome/css/all.min.css`, `css/tailwind-output.css`) and 4 scripts (`js/utils.js defer`, `js/notifications.js` **no defer**, `js/sidebar.js defer`, `js/ux-enhancements.js defer`), body with `<noscript>` block, `<div class="toast-container" id="toast-container">`, empty `<aside class="sidebar" id="sidebar"></aside>`, `<main class="main-content standalone-page flex-1 min-w-0 overflow-x-clip p-5 transition-[margin] duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] ms-[var(--sidebar-width)]">` with full `<header class="header unified-header">` (menu toggle, search, theme toggle, shortcuts button, user info), `<div class="page-title-row">` with icon `fa-cloud` and title "المزامنة السحابية", empty `<div class="grades-container" id="sync-page-content">` placeholder, and `<script src="js/pages/settings-sync.js" defer>` at bottom of body. Include quick-nav panel and shortcuts modal blocks from `settings-imports.html`.

- [x] T002 [P] Add sync settings menu item to sidebar in `js/sidebar.js`: add a new `<li>` entry under the settings sub-menu section with link `href="settings-sync.html"`, icon `<i class="fas fa-cloud">`, and Arabic label "المزامنة السحابية". Also add a `<span class="sync-status-badge" id="sidebar-sync-badge"></span>` element next to or inside the menu item for the sidebar indicator (US5 will populate it).

- [x] T003 [P] Add sync indicator CSS component classes in `css/tailwind-input.css` inside `@layer components {}`: add `.sync-status-badge` with base styles (inline-block, width/height 8px, rounded-full, transition), and modifier classes `.sync-badge-connected` (green `var(--color-success-bg)`), `.sync-badge-syncing` (green with `animation: pulse`), `.sync-badge-offline` (yellow `var(--color-warning-bg)`), `.sync-badge-error` (red `var(--color-danger-bg)`), `.sync-badge-disabled` (gray `var(--color-text-light)`). Add a `@keyframes sync-pulse` animation for the syncing state. Run `npm run css:build` after.

- [x] T004 [P] Create `js/pages/settings-sync.js` with the initialization scaffold: a single `document.addEventListener('DOMContentLoaded', async () => { ... })` handler that: (1) checks user role via session info to determine if admin (store in `let isAdmin`), (2) if not admin, adds class `sync-readonly` to `document.body` to hide `.admin-only` elements via CSS, (3) calls placeholder functions `await loadConfig()`, `await refreshStatus()`, `await loadConflicts()`, (4) sets up `statusTimer = setInterval(refreshStatus, 10000)` for auto-refresh, (5) adds `window.addEventListener('beforeunload', () => clearInterval(statusTimer))` for cleanup. Define empty stub functions for `loadConfig()`, `refreshStatus()`, `loadConflicts()`. Use Prettier style: single quotes, 4-space indent, semicolons.

**Checkpoint**: Page loads in Electron with sidebar link, empty content sections, no errors in console. `npm run css:build` succeeds. `npm run lint` passes. `npm run test:smoke` passes.

---

## Phase 2: User Story 1 — View Sync Status at a Glance (Priority: P1) 🎯 MVP

**Goal**: Admin opens the sync settings page and immediately sees sync health: enabled/disabled, connection state, last push/pull timestamps, pending/failed/conflict counts, with auto-refresh every 10 seconds.

**Independent Test**: Navigate to `settings-sync.html`, verify status KPI cards display correctly for various sync states (connected, offline, error, disabled). Verify auto-refresh updates values without page reload.

### Implementation for User Story 1

- [x] T005 [US1] Add status panel HTML section in `settings-sync.html` inside `<div class="grades-container">`: add a `<div class="students-results" id="sync-status-section">` with `<h3><i class="fas fa-heartbeat"></i> حالة المزامنة</h3>`, then a `<div class="grid gap-3 sm:grid-cols-2 xl:grid-cols-3" id="status-cards" aria-live="polite">` containing 7 glass KPI cards (each using `rounded-[var(--radius-sm)] border border-[var(--glass-border)] bg-[var(--glass-bg)] p-3 shadow-[var(--shadow-soft)]`): (1) "حالة الاتصال" / connection state with id `status-connection`, (2) "آخر رفع" / last push with id `status-last-push`, (3) "آخر سحب" / last pull with id `status-last-pull`, (4) "التغييرات المعلقة" / pending count with id `status-pending`, (5) "العناصر الفاشلة" / failed count with id `status-failed`, (6) "التعارضات" / conflict count with id `status-conflicts`, (7) "آخر فحص" / last snapshot with id `status-last-snapshot`. Each card has a label `<div>` (small, muted) and a value `<div>` (large, bold, primary color) with initial content "—".

- [x] T006 [US1] Implement `refreshStatus()` function in `js/pages/settings-sync.js`: call `const status = await window.api.sync.getStatus()`, then update each KPI card element: (1) `status-connection` — derive state from `status` using the logic from data-model.md (connected/syncing/offline/error/disabled) and display Arabic label with colored icon (green `fa-check-circle` for connected, spinning `fa-sync fa-spin` for syncing, yellow `fa-wifi-slash` or `fa-exclamation-triangle` for offline, red `fa-times-circle` for error, gray `fa-pause-circle` for disabled), (2) `status-last-push` — format `status.lastPushAt` as relative Arabic time (e.g., "منذ 5 دقائق") or "—" if null, (3) `status-last-pull` — same for `status.lastPullAt`, (4) `status-pending` — show `status.pendingCount` with color (green if 0, amber if >0), (5) `status-failed` — show `status.failedCount` with color (green if 0, red if >0), (6) `status-conflicts` — show `status.conflictCount` with color (green if 0, red if >0), (7) `status-last-snapshot` — format `status.lastSnapshotAt`. Add a helper function `formatRelativeTime(isoString)` that converts ISO timestamps to Arabic relative time strings. If `status.lastPushError` or `status.lastPullError` is set, show error text below the corresponding card in a small red `<div>`.

- [x] T007 [US1] Add a connection state summary banner at the top of the status section in `settings-sync.html`: a `<div id="sync-state-banner" class="mb-4 rounded-xl px-4 py-3.5">` that displays the overall sync state with a large icon and Arabic text. In `js/pages/settings-sync.js`, update this banner inside `refreshStatus()`: set background color and text based on derived state — green bg + "متصل ومزامن" for connected, animated bg + "جاري المزامنة..." for syncing, amber bg + "غير متصل — التغييرات في قائمة الانتظار" for offline, red bg + error message for error, gray bg + "المزامنة معطلة" for disabled.

**Checkpoint**: Page displays live sync status. Changing sync state in backend (via other tools or manually) is reflected within 10 seconds on the page. All KPI cards show correct values.

---

## Phase 3: User Story 2 — Configure Sync Settings (Priority: P1) 🎯 MVP

**Goal**: Admin can enable/disable sync and adjust parameters (interval, AWS region, auth URL, school ID), with validation and immediate engine restart on save.

**Independent Test**: Change configuration values, save, and verify sync engine restarts with new settings. Enter invalid values and verify validation messages appear.

### Implementation for User Story 2

- [x] T008 [US2] Add configuration form HTML section in `settings-sync.html` after the status section: a `<div class="students-results admin-only" id="sync-config-section">` with `<h3><i class="fas fa-cog"></i> إعدادات المزامنة</h3>`, then a `<form id="sync-config-form">` containing: (1) primary fields in a `<div class="grid gap-4 md:grid-cols-2">`: toggle checkbox `<label class="flex items-center gap-2"><input type="checkbox" id="cfg-enabled"> تفعيل المزامنة</label>`, text input `id="cfg-school-id"` with label "معرف المؤسسة", text input `id="cfg-auth-url"` with label "رابط المصادقة", text input `id="cfg-region"` with label "المنطقة (AWS Region)", number input `id="cfg-interval"` min=1 max=30 with label "فترة المزامنة (دقائق)". (2) Advanced settings in a `<details><summary class="cursor-pointer font-semibold text-[var(--color-text-muted)]"><i class="fas fa-sliders-h"></i> إعدادات متقدمة</summary>` containing a grid with: number input `id="cfg-batch-size"` label "حجم الدفعة", number input `id="cfg-max-retries"` label "أقصى محاولات", number input `id="cfg-retention"` label "أيام الاحتفاظ", number input `id="cfg-snapshot-interval"` label "فترة الفحص (دقائق)". (3) Validation message area: `<div id="config-validation" class="validation-message warning mt-4 hidden"></div>`. (4) Submit button: `<button class="btn btn-primary mt-4" type="submit"><i class="fas fa-save"></i> حفظ الإعدادات</button>`. All inputs must have `<label>` elements for accessibility.

- [x] T009 [US2] Implement `loadConfig()` function in `js/pages/settings-sync.js`: call `const config = await window.api.sync.getConfig()` and `const status = await window.api.sync.getStatus()`. If config is null, leave form with defaults. Otherwise populate each input: `cfg-enabled` checked = `config.enabled`, `cfg-school-id` value = `config.schoolId || ''`, `cfg-auth-url` value = `config.authLambdaUrl || ''`, `cfg-region` value = `config.awsRegion || 'us-east-1'`, `cfg-interval` value = `config.syncIntervalMinutes || 10`, `cfg-batch-size` value = `config.pushBatchSize || 100`, `cfg-max-retries` value = `config.maxRetries || 10`, `cfg-retention` value = `config.retentionDays || 7`, `cfg-snapshot-interval` value = `status.snapshotIntervalMinutes || 30` (note: snapshot interval comes from status, not config).

- [x] T010 [US2] Implement config form submit handler in `js/pages/settings-sync.js`: add event listener on `sync-config-form` submit. On submit: (1) `e.preventDefault()`, (2) run client-side validation — `syncIntervalMinutes` must be integer 1–30, if enabling sync then `schoolId`, `authLambdaUrl`, and `awsRegion` must be non-empty. If validation fails, show error in `config-validation` div and return. (3) Build updates object from form values, (4) call `const result = await window.api.sync.setConfig(updates)`, (5) if `result.success`, call `showToast('تم حفظ الإعدادات بنجاح', 'success')`, then `await loadConfig()` and `await refreshStatus()` to reflect new state. (6) if `!result.success`, show `showToast(result.error, 'error')`. (7) Handle thrown errors with try/catch: `showToast('حدث خطأ أثناء الحفظ', 'error')`.

- [x] T011 [US2] Add read-only mode CSS in `css/tailwind-input.css` inside `@layer components {}`: add rule `.sync-readonly .admin-only { display: none !important; }` so non-admin users cannot see config form, sync now button, or conflict resolution buttons. Run `npm run css:build`.

**Checkpoint**: Admin can configure sync settings and save. Validation catches invalid inputs. Non-admin users see status only (config section hidden). Saving restarts the sync engine.

---

## Phase 4: User Story 3 — Trigger Manual Sync (Priority: P2)

**Goal**: Admin clicks "Sync Now" to trigger immediate push + pull + snapshot cycle, sees loading state, and gets detailed results.

**Independent Test**: Click Sync Now with sync enabled, verify push/pull/snapshot results displayed. Click with sync disabled, verify button is disabled.

### Implementation for User Story 3

- [x] T012 [US3] Add Sync Now button and results panel HTML in `settings-sync.html` after the config section: a `<div class="students-results admin-only" id="sync-trigger-section">` with `<h3><i class="fas fa-bolt"></i> مزامنة يدوية</h3>`, a `<button class="btn btn-warning" id="btn-sync-now" type="button"><i class="fas fa-sync"></i> مزامنة الآن</button>`, and a results panel `<div id="sync-results" class="mt-4 hidden">` that will be populated with push/pull/snapshot results.

- [x] T013 [US3] Implement `onTriggerNow()` function in `js/pages/settings-sync.js`: (1) add click listener on `btn-sync-now`, (2) on click: disable the button, change its text to `<i class="fas fa-spinner fa-spin"></i> جاري المزامنة...`, (3) call `const result = await window.api.sync.triggerNow()` in try/catch, (4) re-enable button and restore original text, (5) show results in `sync-results` div — render a summary card with 3 sub-sections (Push, Pull, Snapshot), each showing: success/fail icon, counts (sentCount, appliedCount, changesDetected etc.), errors if any. Handle `skipped` results (show reason). (6) If overall `result.error`, show `showToast(result.error, 'error')`. (7) Call `await refreshStatus()` to update KPI cards. (8) If button click occurs while sync is disabled or already running (check via status), show `showToast('المزامنة معطلة أو جارية بالفعل', 'warning')` and don't call triggerNow.

- [x] T014 [US3] Update `refreshStatus()` in `js/pages/settings-sync.js` to also control Sync Now button state: if `!status.enabled` or `status.pushRunning || status.pullRunning`, disable `btn-sync-now` and set its `title` attribute to explain why ("المزامنة معطلة" or "المزامنة جارية"). Otherwise enable it.

**Checkpoint**: Sync Now button triggers a full sync cycle and shows detailed results. Button is disabled when sync is off or already running. Status refreshes after manual sync.

---

## Phase 5: User Story 4 — View and Resolve Conflicts (Priority: P2)

**Goal**: Admin views conflict log with filtering and pagination, expands conflict details to see local vs. remote data side-by-side, and resolves conflicts by choosing local or remote.

**Independent Test**: Create synthetic conflicts in the database. Verify they appear in the log, can be filtered, expanded for detail, and resolved.

### Implementation for User Story 4

- [x] T015 [US4] Add conflict log HTML section in `settings-sync.html` after the trigger section: a `<div class="students-results" id="sync-conflicts-section">` with `<h3><i class="fas fa-code-branch"></i> سجل التعارضات <span class="badge" id="conflict-badge"></span></h3>`, a filter row `<div class="flex items-center gap-3 mb-3">` containing a `<select id="conflict-filter">` with options "الكل" (value=all), "غير محلولة" (value=unresolved, selected), "محلولة" (value=resolved), and a `<div class="table-responsive">` with `<table class="students-table"><caption class="sr-only">سجل تعارضات المزامنة</caption>` with thead columns: #, النوع (entity type), المعرف (row sync ID), الحقول المتعارضة, الحالة, التاريخ, الإجراء (admin-only class). Add `<tbody id="conflict-tbody">` with initial loading row. Add pagination controls: `<div class="flex items-center justify-between mt-3" id="conflict-pagination">` with prev/next buttons and page info text.

- [x] T016 [US4] Implement `loadConflicts()` function in `js/pages/settings-sync.js`: (1) read filter value from `conflict-filter` select, (2) call `const conflicts = await window.api.sync.getConflictLog({ status: filterValue, limit: 50, offset: currentOffset })`, (3) populate `conflict-tbody` — for each conflict, render a `<tr>` with: index number, `entityType` translated to Arabic label (e.g., STUDENT → "تلميذ", GRADE → "نقطة"), truncated `rowSyncId`, `conflictingFields.join(', ')`, status badge (`<span>` with colored bg — red for unresolved, green for resolved), formatted `createdAt`, and action column with expand button `<button class="btn btn-sm btn-secondary"><i class="fas fa-eye"></i></button>` plus resolution buttons (admin-only, only for unresolved) `<button class="btn btn-sm btn-primary admin-only" data-id="${c.id}" data-action="local"><i class="fas fa-desktop"></i> محلي</button>` and `<button class="btn btn-sm btn-warning admin-only" data-id="${c.id}" data-action="remote"><i class="fas fa-cloud"></i> بعيد</button>`. (4) Update pagination controls (prev/next enabled state, page info). (5) If no conflicts, show "لا توجد تعارضات" message. (6) Add change listener on `conflict-filter` to reload conflicts with offset=0. (7) Store `currentOffset` and `conflictPageSize` (50) as module-level variables.

- [x] T017 [US4] Implement conflict detail expansion in `js/pages/settings-sync.js`: add delegated click handler on `conflict-tbody` for expand buttons. On click: (1) toggle a detail `<tr>` below the clicked row, (2) the detail row has a single `<td colspan="7">` containing a side-by-side comparison: two `<div>` columns (local on right, remote on left — RTL layout) each showing formatted JSON of `localData` and `remoteData` respectively. (3) Highlight conflicting fields: for each field in `conflictingFields`, wrap the field name in `<span class="font-bold text-[var(--color-danger-bg)]">` in both columns. (4) If already expanded, collapse (remove the detail row). Use `JSON.stringify(data, null, 2)` for formatting inside `<pre class="text-xs overflow-auto max-h-60 p-2 rounded bg-[var(--glass-bg)]">`.

- [x] T018 [US4] Implement conflict resolution in `js/pages/settings-sync.js`: add delegated click handler on `conflict-tbody` for resolution buttons (`data-action="local"` or `data-action="remote"`). On click: (1) get `conflictId` from `data-id` and `resolution` from `data-action`, (2) disable the buttons on that row, (3) call `const result = await window.api.sync.resolveConflict({ conflictId, resolution })` in try/catch, (4) if `result.success`: show `showToast('تم حل التعارض بنجاح', 'success')`, reload conflicts list, and call `refreshStatus()` to update conflict count KPI card. (5) if `!result.success`: show `showToast(result.error, 'error')`, re-enable buttons. (6) Handle errors gracefully.

- [x] T019 [US4] Implement pagination in `js/pages/settings-sync.js`: add click handlers for prev/next buttons in `conflict-pagination`. Prev button: decrease `currentOffset` by `conflictPageSize` (min 0), call `loadConflicts()`. Next button: increase `currentOffset` by `conflictPageSize`, call `loadConflicts()`. Disable prev when `currentOffset === 0`. Disable next when fewer results than `conflictPageSize` were returned (indicating last page). Show current page info as "صفحة X".

**Checkpoint**: Conflict log displays correctly with filtering and pagination. Expanding a conflict shows local vs. remote data with highlighted fields. Resolving a conflict updates the list and status counts.

---

## Phase 6: User Story 5 — Sidebar Sync Status Indicator (Priority: P3)

**Goal**: A small sync status badge appears in the sidebar on ALL pages, reflecting the current sync state (connected/syncing/offline/error/disabled), clickable to navigate to the sync settings page.

**Independent Test**: Navigate to any page (e.g., dashboard), verify the sidebar shows the sync indicator with correct state. Click it, verify navigation to `settings-sync.html`.

### Implementation for User Story 5

- [x] T020 [US5] Implement sync indicator polling logic in `js/ux-enhancements.js`: add a function `initSyncIndicator()` that: (1) finds `#sidebar-sync-badge` in the DOM (added by T002 in sidebar.js), (2) if element doesn't exist or `window.api.sync` is undefined, return silently (graceful degradation), (3) defines `async function updateSyncBadge()` that calls `const status = await window.api.sync.getStatus()`, derives the sync state (connected/syncing/offline/error/disabled using the logic from data-model.md), then sets the badge class: remove all `sync-badge-*` classes, add the appropriate one (e.g., `sync-badge-connected`), and set `title` attribute with Arabic state label. (4) Calls `updateSyncBadge()` immediately, (5) sets `setInterval(updateSyncBadge, 15000)` for ongoing updates, (6) wraps everything in try/catch so failures don't break other pages. Call `initSyncIndicator()` at the end of the existing `DOMContentLoaded` handler in `ux-enhancements.js`. Add `initSyncIndicator` to the `window.UXEnhancements` export object.

- [x] T021 [US5] Make the sidebar sync badge clickable in `js/sidebar.js`: ensure the sync menu item link (`<a href="settings-sync.html">`) wraps the badge, or add a click handler on the badge element that navigates to `settings-sync.html` via `window.location.href = 'settings-sync.html'`. The badge should have `cursor: pointer` styling (add to `.sync-status-badge` in the CSS component class from T003).

**Checkpoint**: Sidebar shows sync status badge on every page. Badge reflects correct state and updates every 15 seconds. Clicking badge navigates to sync settings page. No console errors on pages that don't have sync configured.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, code quality, and edge case handling.

- [x] T022 Run `npm run lint` and fix any ESLint errors in `js/pages/settings-sync.js`, `js/sidebar.js`, and `js/ux-enhancements.js`
- [x] T023 Run `npm run format` to apply Prettier formatting to all modified files
- [x] T024 Run `npm run css:build` and verify `css/tailwind-output.css` compiles without errors
- [x] T025 Run `npm run test:smoke` and verify all checks pass (IPC parity, no CDN refs, no inline styles, sync registry)
- [ ] T026 Manual RTL visual check: launch app (`npm run dev`), navigate to `settings-sync.html`, confirm all text renders correctly in Arabic RTL, all icons align properly, all interactive elements work
- [ ] T027 Manual dark mode check: toggle theme on `settings-sync.html`, verify all sections (status cards, config form, conflict log, buttons, table) render correctly in dark theme
- [ ] T028 Manual sidebar indicator check: navigate to at least 3 other pages (dashboard, `students-list.html`, `settings-imports.html`), verify sidebar sync badge appears and reflects correct state
- [ ] T029 Edge case: verify non-admin user experience — log in as staff user, navigate to sync settings, confirm config form and resolution buttons are hidden, status is visible read-only

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **US1 (Phase 2)**: Depends on Setup — needs HTML scaffold and JS skeleton
- **US2 (Phase 3)**: Depends on Setup — independent of US1 (separate HTML section and JS functions)
- **US3 (Phase 4)**: Depends on Setup and US1 (needs `refreshStatus()` from US1, and button state depends on status)
- **US4 (Phase 5)**: Depends on Setup — independent of US1/US2/US3 (separate section and functions)
- **US5 (Phase 6)**: Depends on Setup (T002, T003) — independent of US1–US4 (runs on all pages, not just sync settings)
- **Polish (Phase 7)**: Depends on all user stories being complete

### User Story Dependencies

- **User Story 1 (P1)**: Setup → US1. No other story dependencies
- **User Story 2 (P1)**: Setup → US2. No other story dependencies
- **User Story 3 (P2)**: Setup + US1 (`refreshStatus()`) → US3
- **User Story 4 (P2)**: Setup → US4. Uses `refreshStatus()` from US1 but can stub it
- **User Story 5 (P3)**: Setup (T002, T003) → US5. Fully independent of US1–US4

### Within Each User Story

- HTML structure first, then JS implementation
- Status display functions before dependent functions
- Core functionality before edge case handling
- Each story checkpoint validates independently

### Parallel Opportunities

**Setup phase**: T002, T003, T004 can all run in parallel (different files)

**After Setup**:
- US1 (status display) and US2 (config form) can run in parallel — different HTML sections and JS functions
- US4 (conflict log) can run in parallel with US1/US2 — independent section
- US5 (sidebar indicator) can run in parallel with all others — modifies different files

**Within US4**: T015 (HTML) → T016, T017, T018, T019 must be sequential (all in same JS file, dependent)

---

## Parallel Example: After Setup Completion

```
# These can all start simultaneously after Phase 1:

Agent A: US1 — T005, T006, T007 (status display)
Agent B: US2 — T008, T009, T010, T011 (config form)
Agent C: US4 — T015, T016, T017, T018, T019 (conflict log)
Agent D: US5 — T020, T021 (sidebar indicator)

# Then after US1 completes:
Agent A: US3 — T012, T013, T014 (manual sync, depends on refreshStatus from US1)
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 Only)

1. Complete Phase 1: Setup (T001–T004)
2. Complete Phase 2: US1 — status display (T005–T007)
3. Complete Phase 3: US2 — config form (T008–T011)
4. **STOP and VALIDATE**: Admin can view status and configure sync
5. Run smoke tests, manual visual check
6. This covers FR-001 through FR-007, SC-001, SC-002 — the core settings page

### Incremental Delivery

1. Setup + US1 + US2 → Status + Config (MVP!)
2. Add US3 → Manual sync trigger
3. Add US4 → Conflict log and resolution
4. Add US5 → Sidebar indicator on all pages
5. Polish phase → Final validation

### Single Developer Strategy

Complete phases sequentially: Setup → US1 → US2 → US3 → US4 → US5 → Polish

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- All text content must be in Arabic
- All layout must use RTL logical properties (ps-*, pe-*, ms-*, me-*, start-*, end-*)
- No new IPC channels needed — all 6 `sync:*` channels pre-exist
- `showToast()` is global from `js/notifications.js` — no import needed
- `snapshotIntervalMinutes` comes from `getStatus()`, NOT `getConfig()` — special handling in T009
- Smoke test passes without any backend changes
- Entity type translation map (STUDENT → تلميذ, GRADE → نقطة, etc.) needed in T016

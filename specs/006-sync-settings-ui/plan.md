# Implementation Plan: Sync Settings UI

**Branch**: `006-sync-settings-ui` | **Date**: 2026-03-21 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/006-sync-settings-ui/spec.md`

## Summary

Build a dedicated sync settings page (`settings-sync.html` + `js/pages/settings-sync.js`) that gives administrators visibility and control over the DynamoDB synchronization engine. The page consumes 6 pre-existing `sync:*` IPC channels to display live sync status, manage configuration, trigger manual sync cycles, and review/resolve data conflicts. A persistent sidebar indicator across all pages shows sync health at a glance. No new backend code or IPC channels are needed — this is a pure UI layer on top of Phases 1–5.

## Technical Context

**Language/Version**: JavaScript (ES2020+), HTML5, Tailwind CSS v4
**Primary Dependencies**: Electron (renderer process), FontAwesome 6, Tailwind CSS v4, `js/notifications.js` (showToast), `js/sidebar.js`, `js/ux-enhancements.js`
**Storage**: N/A — reads from existing sync IPC channels backed by SQLite tables created in Phases 1–5
**Testing**: `npm run test:smoke` (IPC parity, no CDN refs, no inline styles, sync registry completeness), manual RTL visual check
**Target Platform**: Windows desktop (Electron app)
**Project Type**: Desktop app (Electron, multi-page HTML, vanilla JS)
**Performance Goals**: Status panel renders within 2 seconds; conflict log handles 200 rows without lag; status polling every 10 seconds with no memory leaks
**Constraints**: RTL Arabic-only, offline-capable (UI works when sync is disabled/offline), no bundler, no new npm dependencies
**Scale/Scope**: 1 new HTML page, 1 new JS module, 2 modified shared JS files, 1 CSS update

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Code Quality & Consistency** | PASS | Single-quote Prettier, ESLint flat config, camelCase JS, separate `js/pages/` file per page, no dead code |
| **II. Testing Standards** | PASS | Smoke tests pass (no new IPC channels needed, no CDN refs, no inline styles). Manual RTL visual check required |
| **III. User Experience Consistency** | PASS | RTL-first with logical properties, Arabic text, `showToast()` for feedback, dark mode via `@variant dark`, `dir="rtl" lang="ar"` on `<html>` |
| **IV. Good Practices & Architecture** | PASS | No new IPC channels = no three-file-rule changes needed. Uses `window.api.sync.*` exclusively. No bundler. All vendor libs from `vendor/` |
| **V. Performance Requirements** | PASS | Lightweight polling (10s interval, small status object). No heavy computation. No full table scans |
| **Security & Data Integrity** | PASS | Write operations (setConfig, triggerNow, resolveConflict) use `handleWrite(['admin'])` — backend enforced. UI also hides controls for non-admin |

**Post-Phase 1 re-check**: All gates still pass. No violations introduced.

## Project Structure

### Documentation (this feature)

```text
specs/006-sync-settings-ui/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research findings
├── data-model.md        # Phase 1: data entities and state
├── quickstart.md        # Phase 1: developer quickstart
├── contracts/
│   └── ipc-sync.md      # Phase 1: IPC channel contract reference
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
# New files
settings-sync.html                  # Sync settings page (HTML)
js/pages/settings-sync.js           # Page logic module

# Modified files
js/sidebar.js                       # Add sync settings menu item + indicator element
js/ux-enhancements.js               # Add sync status indicator polling logic
css/tailwind-input.css              # Add sync indicator component classes (minimal)

# Existing files consumed (no changes)
preload.js                          # window.api.sync.* (6 channels, already declared)
main/ipc/sync.js                    # 6 sync IPC handlers (already implemented)
main/ipc/registerAll.js             # sync module already registered
js/notifications.js                 # showToast() global
js/utils.js                         # Shared utilities
vendor/fontawesome/css/all.min.css  # Icons
css/tailwind-output.css             # Compiled CSS (rebuilt via npm run css:build)
```

**Structure Decision**: This feature follows the existing Electron multi-page pattern. One new HTML page + one new `js/pages/` module. Two shared files modified (sidebar menu + UX indicator). No new directories needed.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| *(none)* | — | — |

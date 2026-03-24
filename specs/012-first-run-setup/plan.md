# Implementation Plan: First-Run Setup Page

**Branch**: `012-first-run-setup` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/012-first-run-setup/spec.md`

## Summary

Implement a full-screen first-run setup page (`setup.html`) that appears before the login screen when no institution is configured. The page provides a two-step wizard: (1) choose between "New Institution" or "Link to Existing", then (2) fill the appropriate form. New institutions enter a MASSAR code and create an admin account; linking devices enter a MASSAR code and 6-digit OTP with LAN-first/server-fallback verification. A startup redirect in `main.js` gates the flow based on `institution_config.setup_completed`. Four new IPC channels in a `setup` namespace handle the pre-auth operations.

## Technical Context

**Language/Version**: JavaScript (Node.js 18+, vanilla browser JS — no framework)
**Primary Dependencies**: Electron, better-sqlite3, Tailwind CSS v4, FontAwesome
**Storage**: SQLite via better-sqlite3 (existing `institution_config`, `linked_devices`, `users` tables)
**Testing**: Smoke tests (`npm run test:smoke`) — IPC parity check, no CDN refs, Tailwind build
**Target Platform**: Windows desktop (Electron), Arabic RTL UI
**Project Type**: Desktop app (Electron, multi-page HTML)
**Performance Goals**: Setup page interactive within 3 seconds on 4 GB RAM / HDD; OTP verification via LAN < 5s, server fallback < 10s
**Constraints**: Offline-capable for "New Institution" flow; LAN or internet required for "Link to Existing" flow; < 512 MB memory
**Scale/Scope**: Single new HTML page, 1 new page JS, 1 new IPC module, 4 modified files

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality | PASS | Prettier + ESLint enforced. camelCase JS, snake_case DB, kebab-case IPC with `setup:` prefix. No dead code. Single-responsibility: `setup.js` serves only `setup.html`. |
| II. Testing Standards | PASS | Smoke test updated with new channel count. IPC parity maintained (4 new channels in preload + handler). No CDN refs. Manual RTL visual check required. |
| III. UX Consistency | PASS | RTL-first with logical properties. `dir="rtl" lang="ar"` on HTML. Arabic text throughout. Dark mode via `@variant dark`. Toast via `showToast()`. No new interaction patterns — reuses existing form/button/toast conventions. |
| IV. Architecture | PASS | IPC via `window.api.setup.*`. `contextIsolation: true`. Handlers use `handleRead`/`handleWriteNoAuth` (never raw `ipcMain.handle`). Three-file rule: `main/ipc/setup.js` + `registerAll.js` + `preload.js`. |
| V. Performance | PASS | Setup page is minimal HTML — well under 3s startup. DB query is single-row singleton lookup. No full table scans. |
| Security | PASS | Passwords hashed via `hashPassword()` (scrypt). Pre-auth channels use `handleWriteNoAuth`. No secrets in code. |
| Workflow | PASS | Feature branch `012-first-run-setup`. Conventional commits. Pre-merge: lint + css:build + smoke + RTL visual check. |

**Post-Phase 1 re-check**: All gates still pass. No constitution violations introduced by the design.

## Project Structure

### Documentation (this feature)

```text
specs/012-first-run-setup/
├── spec.md              # Feature specification
├── plan.md              # This file
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: dev quickstart guide
├── contracts/
│   └── ipc-channels.md  # Phase 1: IPC contract definitions
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

```text
# New files
setup.html                    # Full-screen setup page (no sidebar)
js/pages/setup.js             # Renderer: two-step wizard, validation, IPC calls
main/ipc/setup.js             # Main process: 4 IPC handlers (pre-auth)

# Modified files
main.js                       # Startup redirect: institution_config check → setup.html or index.html
main/ipc/registerAll.js       # Register registerSetupIpc
preload.js                    # Add setup namespace (4 channels)
tests/smoke.js                # Update expected channel count
```

**Structure Decision**: Follows the existing Electron multi-page pattern — one HTML page + one `js/pages/*.js` file + one `main/ipc/*.js` module. No new directories needed beyond what already exists.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.

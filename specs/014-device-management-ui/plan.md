# Implementation Plan: Device Management UI

**Branch**: `014-device-management-ui` | **Date**: 2026-03-23 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/014-device-management-ui/spec.md`

## Summary

Add a device management section to the existing sync settings page (`settings-sync.html`) that displays current device info, enables admin OTP generation with a live countdown timer, shows a table of all linked devices, and allows admins to revoke devices. This requires creating a new `main/ipc/linking.js` IPC module with 6 post-auth channels, extending `preload.js` with a `linking` namespace, and adding HTML sections + JS logic to the existing sync settings page.

## Technical Context

**Language/Version**: JavaScript (ES2020+, Node.js 18+, Chromium via Electron)
**Primary Dependencies**: Electron, better-sqlite3, crypto (Node.js built-in), dgram/http (Node.js built-in)
**Storage**: SQLite via better-sqlite3 — tables `institution_config`, `linked_devices`, `device_otp` (created in Phase 7.1)
**Testing**: Smoke tests (`npm run test:smoke`) — IPC parity validation, no CDN refs, Tailwind output check
**Target Platform**: Windows desktop (Electron), with RTL Arabic UI
**Project Type**: Desktop application (Electron, multi-page HTML, vanilla JS, no bundler)
**Performance Goals**: Device info section loads within 2 seconds; OTP countdown updates every second without drift
**Constraints**: Must work on modest school hardware (4 GB RAM, HDD); all text in Arabic RTL; dark mode support required
**Scale/Scope**: Up to 20 linked devices per institution; single sync settings page modification

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
| --------- | ------ | ----- |
| I. Code Quality & Consistency | PASS | Prettier/ESLint enforced. IPC channels use `namespace:camelCase` pattern. One IPC module per domain (`linking.js`). |
| II. Testing Standards | PASS | Smoke test updated with new channel count. IPC parity validated. Manual RTL check required. |
| III. User Experience Consistency | PASS | RTL-first with logical properties. Arabic text throughout. `showToast()` for feedback. Dark mode via `@variant dark`. `dir="rtl" lang="ar"` on HTML element. Unicode bidi isolates for device hashes embedded in Arabic text. |
| IV. Good Practices & Architecture | PASS | Three-file rule followed (linking.js + registerAll.js + preload.js). `handleWrite`/`handleRead` wrappers used (no raw `ipcMain.handle`). Context isolation maintained. |
| V. Performance Requirements | PASS | No full table scans. `linked_devices` indexed on `status`. Countdown uses wall-clock comparison (no drift). |
| Security & Data Integrity | PASS | Admin-only channels use `handleWrite` with `['admin']` role enforcement. OTP plaintext never stored. Self-revoke prohibited. |
| Development Workflow | PASS | Feature branch `014-device-management-ui`. Pre-merge checklist: lint + css:build + smoke + manual RTL check. |

**Post-Phase 1 re-check**: All gates PASS. No violations.

## Project Structure

### Documentation (this feature)

```text
specs/014-device-management-ui/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 research findings
├── data-model.md        # Entity definitions and state transitions
├── quickstart.md        # Development setup guide
├── contracts/
│   └── ipc-contracts.md # IPC channel contracts (6 channels)
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
main/
├── ipc/
│   ├── linking.js           # NEW — 6 IPC handlers for device management
│   └── registerAll.js       # MODIFIED — register registerLinkingIpc
├── linking/
│   ├── otp.js               # EXISTS (Phase 7.2) — OTP generation/verification
│   ├── lan.js               # EXISTS (Phase 7.3) — LAN server/discovery
│   └── server.js            # EXISTS (Phase 7.4) — Server-side OTP client
├── licensing/
│   └── deviceFingerprint.js # EXISTS — collectCurrentFingerprint()
└── db/
    └── schema.js            # EXISTS (Phase 7.1) — institution_config, linked_devices, device_otp

preload.js                   # MODIFIED — add linking namespace (6 channels)

settings-sync.html           # MODIFIED — add device management HTML sections
js/pages/settings-sync.js    # MODIFIED — add device management JS logic

tests/
└── smoke.js                 # MODIFIED — update expected channel count
```

**Structure Decision**: This feature follows the existing Electron multi-page architecture. No new HTML pages or JS page modules are created — all UI is added to the existing `settings-sync.html` + `js/pages/settings-sync.js`. One new IPC module (`main/ipc/linking.js`) is created following the established one-module-per-domain pattern.

## Complexity Tracking

No constitution violations. No complexity justifications needed.

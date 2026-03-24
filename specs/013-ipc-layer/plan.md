# Implementation Plan: Phase 7.6 IPC Layer

**Branch**: `[013-ipc-layer]` | **Date**: 2026-03-23 | **Spec**: `specs/013-ipc-layer/spec.md`
**Input**: Feature specification from `specs/013-ipc-layer/spec.md`

## Summary

Create a canonical `linking` IPC domain for institution setup, device linking, OTP management, and linked-device administration while keeping the existing first-run renderer working through a temporary preload-level `setup` compatibility alias. The implementation will reuse the current linking helpers, keep all new handlers inside the repository's IPC wrapper architecture, standardize request/response DTOs and failure codes, and update preload, registration, sync-capture exclusions, and smoke-test parity together.

## Technical Context

**Language/Version**: JavaScript on Electron 35 with Node.js runtime and vanilla renderer scripts  
**Primary Dependencies**: Electron IPC/contextBridge, `better-sqlite3`, Node built-ins (`crypto`, `dgram`, `http`, `os`), existing auth/licensing/sync/linking modules  
**Storage**: SQLite singleton database (`institution_config`, `device_otp`, `linked_devices`, `sync_config`, `users`, `licenses`)  
**Testing**: `npm run lint`, `npm run test:smoke`, targeted manual verification through `setup.html` and renderer DevTools  
**Target Platform**: Windows desktop Electron application  
**Project Type**: Multi-page Electron desktop app  
**Performance Goals**: Preserve <3s startup, keep local status/OTP/device lookups effectively instant (<1s), keep LAN discovery on the existing 5s default, and keep admin status/device-roster retrieval within the 10s spec target  
**Constraints**: Use wrapper-based IPC only; canonical channel strings use domain-prefixed kebab-case; `window.api` remains the only renderer boundary; pre-login writes use soft-auth only; no new npm dependencies; no schema changes in this phase; keep preload/handler/smoke/sync-capture inventories aligned  
**Scale/Scope**: 10 canonical linking channels, 4 temporary `setup` compatibility methods in preload, 1 new IPC module, and coordinated updates to `preload.js`, `main/ipc/registerAll.js`, `main/sync/capture.js`, and `tests/smoke.js`

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

- **Pre-Phase 0 - Wrapper-only IPC**: PASS. New channels use `handleRead`, `handleWrite`, and `handleWriteSoftAuth`; raw `ipcMain.handle()` is rejected for this feature.
- **Pre-Phase 0 - Channel naming and parity**: PASS. Canonical IPC channel strings will use the constitution's domain-prefixed kebab-case format while preload methods remain camelCase for renderer ergonomics; preload exposure, handler registration, sync-capture exclusions, and smoke expectations will be updated in one change set.
- **Pre-Phase 0 - Security boundary**: PASS. First-run setup/link actions remain pre-login only, admin device-management actions remain admin-only, and current-device revocation stays blocked.
- **Pre-Phase 0 - Dependency discipline**: PASS. The plan reuses existing linking, auth, sync, and licensing modules with no new packages or bundler changes.
- **Post-Phase 1 - Contract isolation**: PASS. The design keeps setup bootstrap, OTP lifecycle, linked-device management, and bootstrap payload DTOs in the linking domain without leaking UI concerns into main-process contracts.
- **Post-Phase 1 - Scope and security**: PASS. Licensing activation remains a separate domain, but linking contracts carry the bootstrap metadata required for downstream sync setup and clear failure handling.
- **Post-Phase 1 - Verification readiness**: PASS. The artifacts define lint/smoke validation plus direct renderer-console checks for pre-login and admin-only IPC flows before Phase 2 task breakdown.

## Project Structure

### Documentation (this feature)

```text
specs/013-ipc-layer/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── linking-ipc.md
└── tasks.md
```

### Source Code (repository root)

```text
main/
├── ipc/
│   ├── ipc-helpers.js
│   ├── linking.js
│   └── registerAll.js
├── linking/
│   ├── lan.js
│   ├── otp.js
│   └── server.js
└── sync/
    └── capture.js

js/
└── pages/
    └── setup.js

preload.js
tests/
└── smoke.js
```

**Structure Decision**: Keep the existing single Electron app structure. Add a dedicated `main/ipc/linking.js` module as the canonical main-process contract, expose it through `preload.js`, keep `window.api.setup` as a temporary compatibility alias for the live first-run page, and retire `main/ipc/setup.js` after its logic is absorbed into the linking module.

## Complexity Tracking

No constitution exceptions are required for this plan.

# Implementation Plan: OTP Module for Device Linking

**Branch**: `009-otp-module` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/009-otp-module/spec.md`

## Summary

Implement a secure OTP (one-time password) module for linking additional school devices to an institution. The module provides four core operations — generate, verify, status check, and cleanup — using the existing scrypt-based password hashing infrastructure. Rate limiting follows the proven in-memory `Map` pattern from the login throttling system. This is a pure logic layer (`main/linking/otp.js`) with no IPC handlers (those belong to Phase 7.6).

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron main process)
**Primary Dependencies**: `crypto` (Node.js built-in), `main/auth/password.js` (existing scrypt hashing), `better-sqlite3` (existing DB driver)
**Storage**: SQLite via `better-sqlite3` — `device_otp` table (already exists from Phase 7.1)
**Testing**: `npm run lint` + `npm run test:smoke` (existing CI gates)
**Target Platform**: Windows desktop (Electron), school administration hardware (4 GB RAM, HDD)
**Project Type**: Desktop app (Electron) — main process module
**Performance Goals**: OTP generation < 1 second (scrypt hash of a 6-digit string)
**Constraints**: No new npm dependencies; offline-capable; reuse existing cryptographic infrastructure
**Scale/Scope**: Single new file (`main/linking/otp.js`), ~150–200 lines

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | Single module, camelCase functions, snake_case DB columns, Prettier/ESLint compliant |
| II. Testing Standards | PASS | `npm run lint` + `npm run test:smoke` — no IPC changes so smoke parity unaffected |
| III. User Experience Consistency | N/A | No UI in this phase (pure backend module) |
| IV. Good Practices & Architecture | PASS | No IPC handlers (those are Phase 7.6). Module follows the `ensureInstitutionSchema(existingDb)` pattern — accepts `db` parameter. No `require('electron')` or renderer access |
| V. Performance Requirements | PASS | Scrypt hashing of a 6-digit string is sub-second. No full table scans — queries use `idx_device_otp_massar_status` index |
| Security & Data Integrity | PASS | OTP plaintext never persisted. Timing-safe comparison via `verifyPassword()`. Rate limiting prevents brute-force. No secrets in code |
| Development Workflow | PASS | Feature branch `009-otp-module`. No new dependencies. Forward-only (no migrations needed — table exists from 7.1) |

**Post-Phase 1 re-check**: All gates still pass. The design adds one new file with no IPC surface, no UI, and no new dependencies. The in-memory rate limiting follows the exact pattern proven in `auth.js`.

## Project Structure

### Documentation (this feature)

```text
specs/009-otp-module/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity model
├── quickstart.md        # Phase 1: development quickstart
├── contracts/
│   └── otp-module.md    # Phase 1: module API contract
├── checklists/
│   └── requirements.md  # Spec quality checklist
└── tasks.md             # Phase 2 output (via /speckit.tasks)
```

### Source Code (repository root)

```text
main/
├── auth/
│   └── password.js          # Existing — reused for hashPassword/verifyPassword
├── db/
│   ├── context.js           # Existing — getDb() singleton
│   └── schema.js            # Existing — device_otp table already defined
├── licensing/
│   └── deviceFingerprint.js # Existing — reused for collectCurrentFingerprint()
└── linking/
    └── otp.js               # NEW — OTP generation, verification, cleanup, validation
```

**Structure Decision**: Single new file in `main/linking/` directory. This directory will later hold `lan.js` (Phase 7.3) and `server.js` (Phase 7.4), forming a cohesive linking subsystem. No test files are created in this phase — the module is validated via lint + smoke tests and will be integration-tested when consumed by the IPC layer in Phase 7.6.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.

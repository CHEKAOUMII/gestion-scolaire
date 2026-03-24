# Implementation Plan: Institution Device Linking — Database Schema

**Branch**: `008-institution-db-schema` | **Date**: 2026-03-22 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/008-institution-db-schema/spec.md`

## Summary

Add three new database tables (`institution_config`, `device_otp`, `linked_devices`) and a forward-only migration to support the institution device linking flow (Phase 7.1). The schema function follows the established `ensure*Schema()` pattern. The migration auto-populates `institution_config` from existing `sync_config.school_id` for seamless upgrades. Two files are modified: `main/db/schema.js` and `main/db/migrations.js`.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron main process)
**Primary Dependencies**: `better-sqlite3` (synchronous SQLite driver, already in project)
**Storage**: SQLite via `better-sqlite3`, WAL mode, foreign keys ON
**Testing**: `npm run test:smoke` (IPC parity, module integrity), `npm run lint` (ESLint flat config v9)
**Target Platform**: Windows desktop (Electron), school administration hardware (4 GB RAM, HDD)
**Project Type**: Desktop application (Electron)
**Performance Goals**: Migration completes in <1 second on typical school database (<10k rows)
**Constraints**: Offline-capable, no new npm dependencies, idempotent DDL
**Scale/Scope**: 2 files modified, 1 new function, 1 new migration entry

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | snake_case columns, camelCase functions, Prettier/ESLint enforced |
| II. Testing Standards | PASS | Smoke tests validate schema integrity; no IPC changes so no parity impact |
| III. User Experience Consistency | N/A | No UI changes in this phase |
| IV. Good Practices & Architecture | PASS | Schema function pattern matches `ensureSyncSchema`/`ensureLicensingSchema`; no bundler reliance; no new dependencies |
| V. Performance Requirements | PASS | DDL is instant; migration reads one row from `sync_config` |
| Security & Data Integrity | PASS | OTP hashes stored (not plaintext); no secrets in code; singleton constraint enforced at DB level |
| Development Workflow | PASS | Feature branch `008-institution-db-schema`; migration appends to array with unique version string |

**Post-Phase 1 re-check**: All gates still pass. No violations found.

## Project Structure

### Documentation (this feature)

```text
specs/008-institution-db-schema/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0: research decisions
├── data-model.md        # Phase 1: entity definitions
├── quickstart.md        # Phase 1: verification guide
├── contracts/
│   └── schema-contract.md   # Phase 1: schema function & migration contracts
├── checklists/
│   └── requirements.md      # Spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command)
```

### Source Code (repository root)

```text
main/
├── db/
│   ├── schema.js        # MODIFIED — add ensureInstitutionSchema(), call from createTables(), export
│   └── migrations.js    # MODIFIED — append migration 2026-03-035-institution-device-linking

tests/
└── smoke.js             # VERIFY — existing smoke tests must still pass (no changes expected)
```

**Structure Decision**: This feature modifies two existing files in the established `main/db/` directory. No new files or directories are created in the source tree. The project's existing single-module Electron architecture is preserved.

## Complexity Tracking

> No constitution violations. No complexity justifications needed.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|--------------------------------------|
| *(none)* | — | — |

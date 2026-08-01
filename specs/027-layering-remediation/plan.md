# Implementation Plan: Main-Process Layering Remediation

**Branch**: `027-layering-remediation` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/027-layering-remediation/spec.md`  
**Source review**: [docs/plans/2026-07-17-layering-architecture-review-plan.md](../../docs/plans/2026-07-17-layering-architecture-review-plan.md)

## Summary

Remediate collapsed main-process layers without changing school-facing behavior: (1) invert data→sync coupling so `main/repos/*` receive an injectable capture port; (2) extract SQL from fat IPC modules for **exams**, **staff/teachers**, and **orientation** into `main/repos/*` with thin IPC; (3) split **auth** into pure policy, local user/attempt repo, remote identity adapter, and thin IPC; (4) document standing guardrails for new write channels. Success is measured by smoke parity, domain unit tests without Electron UI, and full regression of login + migrated write paths + one sync push.

## Technical Context

**Language/Version**: JavaScript (CommonJS) on Electron 35 / Node.js runtime  
**Primary Dependencies**: Electron IPC (`preload` + `ipcMain`), `better-sqlite3`, existing `main/sync/capture` + entity-registry, Firebase Auth/Firestore (auth adapter only)  
**Storage**: SQLite (`gestion-scolaire.db`); no schema redesign required for this feature  
**Testing**: Node test scripts under `tests/` (pattern: `tests/sync-exact-bulk-capture.test.js`, `tests/repos-domain-key-fields.test.js`); CI gate `npm run test:smoke` + `npm run lint`  
**Target Platform**: Windows Electron desktop (primary); plain Node for unit tests  
**Project Type**: Desktop multi-page Electron app (no bundler)  
**Performance Goals**: No intentional query plan changes; bulk atomic capture must remain same-transaction; unit tests for a domain complete in seconds without launching Electron  
**Constraints**: Behavioral parity (FR-001); IPC channel names and preload contract stable; `school_year` discipline; capture registry completeness for writes; no big-bang rewrite of all IPC modules  
**Scale/Scope**: 3 new/extended repos + capture port + auth policy split + docs; ~3 existing repos refactored for injection; out of scope: remaining ~20 fat IPC domains, institution setup, renderer god-pages

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| I. Code Quality & Consistency | Pass | Prettier/ESLint; camelCase JS; snake_case columns; domain-prefixed IPC channels unchanged |
| II. Testing Standards | Pass | Smoke remains mandatory per slice; new unit tests under `tests/`; no CDN; no new migrations unless a gap is found (none planned) |
| III. UX Consistency | Pass | No intentional UI/copy changes; auth errors stay Arabic + sanitized |
| IV. Good Practices & Architecture | Pass / strengthens | Renderer still only via `window.api`; three-file rule for any new channels (none expected); handlers stay on `handleRead`/`handleWrite`/`handleWriteSoftAuth`; repos formalize single-responsibility beyond IPC-only |
| V. Performance | Pass | Same SQL shapes; no full-table-scan introduction |

**Post-Phase 1 re-check**: Design uses existing repo + explicit-capture patterns; no constitution violations. Optional `main/auth/*` pure modules and `main/repos/*` additions are justified complexity (see Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/027-layering-remediation/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
│   ├── capture-port.md
│   ├── repo-ipc-boundary.md
│   └── auth-layering.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit.tasks — not this command)
```

### Source Code (repository root)

```text
main/
├── auth/
│   ├── password.js              # existing pure
│   ├── permissions.js           # existing (DB override load unchanged this feature unless cheap)
│   ├── firebase-auth-service.js # remote adapter (slim SQL side-effects if easy)
│   ├── lockout-policy.js        # NEW pure
│   └── session-policy.js        # NEW pure (TTL constants + validity helpers)
├── repos/
│   ├── capture-port.js          # NEW: default + no-op + setCapturePort
│   ├── students.js              # REFACTOR: use capture-port
│   ├── grades.js                # REFACTOR: use capture-port
│   ├── absences.js              # REFACTOR: use capture-port
│   ├── exams.js                 # NEW extract from main/ipc/exams.js
│   ├── staff.js                 # NEW extract from main/ipc/staff.js
│   ├── orientation.js           # NEW extract from main/ipc/orientation.js
│   └── users.js                 # NEW: users + login_attempts + session settings row helpers
├── ipc/
│   ├── exams.js                 # THIN: auth/validate → examsRepo
│   ├── staff.js                 # THIN: auth/validate → staffRepo
│   ├── orientation.js           # THIN: auth/validate → orientationRepo
│   ├── auth.js                  # THIN: compose policy + usersRepo + firebase adapter
│   └── students.js / grades.js / absences.js  # wire capture-port if needed (usually default)
├── sync/
│   └── capture.js               # unchanged API surface; consumed via capture-port only from repos
└── teachers/
    └── identity.js              # keep; call from staff/exams repo or thin IPC as today

tests/
├── repos-capture-port.test.js           # NEW
├── repos-exams.test.js                  # NEW
├── repos-staff.test.js                  # NEW
├── repos-orientation.test.js            # NEW
├── auth-lockout-policy.test.js          # NEW
├── auth-session-policy.test.js          # NEW
├── sync-exact-bulk-capture.test.js      # UPDATE if import paths for capture change
└── smoke.js                             # must stay green (no channel renames)

docs/plans/
├── 2026-07-15-add-write-channel-checklist.md  # UPDATE: layering rule + capture-port note
└── 2026-07-17-layering-architecture-review-plan.md  # reference only

Agents.md / Claude.md                    # UPDATE: standing "no SQL in new IPC" rule (manual section)
```

**Structure Decision**: Stay in the existing Electron monorepo layout. Add/extend `main/repos/*` (data access), small pure modules under `main/auth/*` (policy), and a thin `capture-port` so repos never import `sync/capture` directly. Do **not** introduce a full `main/services/` tree in this feature unless a multi-step pure rule does not fit repo or auth (orientation merge SQL stays in orientation repo; pure merge helpers may live as functions inside that repo file or a colocated `orientation-merge.js` without a global services package).

## Complexity Tracking

| Violation / Extra structure | Why Needed | Simpler Alternative Rejected Because |
|----------------------------|------------|-------------------------------------|
| `main/repos/capture-port.js` indirection | Spec FR-004: repos must not hard-depend on sync | Keep `require('../sync/capture')` in every repo — blocks unit tests without full sync stack |
| `main/auth/lockout-policy.js` + `session-policy.js` | Spec FR-006/011: pure policy unit tests | Leave policy in `ipc/auth.js` — cannot test without IPC/session maps |
| `main/repos/users.js` | Isolates login_attempts/users SQL from IPC | Leave SQL in `ipc/auth.js` — continues god-path |
| New repos for exams/staff/orientation | Spec FR-003/012 | Thin wrappers only moving half the SQL — still untestable fat IPC |

## Implementation Phases (for `/speckit.tasks`)

Ordered for dependency safety; each slice ends with smoke green.

### Slice 0 — Guardrails (docs only)

- Document standing rule: new domain SQL lives in `main/repos/*`; IPC = auth + validation + orchestration.
- Link `docs/plans/2026-07-15-add-write-channel-checklist.md` and note `captureMode: 'explicit'` + capture-port.
- Update `Agents.md` manual section (and Claude.md if it duplicates architecture rules).

### Slice 1 — Capture port (behavior-neutral)

- Implement `main/repos/capture-port.js` exporting the subset of capture APIs repos use (`captureInputUpserts`, `captureResolvedRows`, `captureDeletesFromRows`, `selectRowsBySchoolYear`, `deleteBySchoolYearWithCapture`, `capturePutsByIds`, `notifyCaptureCommitted`, … as needed).
- Default implementation delegates to `main/sync/capture`.
- `createNoOpCapturePort()` / `setRepoCapturePort(port)` for tests.
- Refactor `students` / `grades` / `absences` repos to import only from `./capture-port`.
- Update/extend tests so bulk capture tests still pass with real port; add a test that no-op port allows SQL-only exercise.

### Slice 2 — Exams repo

- Move SQL and domain write transactions from `main/ipc/exams.js` → `main/repos/exams.js`.
- Keep `resolveTeacherIdentity` usage at repo or thin IPC (prefer repo to keep IPC free of DB).
- Preserve explicit capture inside transactions for bulk/generate paths.
- IPC becomes channel registration + validation only.
- Unit tests: happy path + validation/failure (e.g. missing year, empty bulk).

### Slice 3 — Staff repo

- Extract `main/ipc/staff.js` SQL (teachers, aliases, bulk import, delete cascades) → `main/repos/staff.js`.
- Thin IPC; unit tests for add/update/import failure cases.

### Slice 4 — Orientation repo

- Extract list/stats SQL, bulk merge import, clear/delete → `main/repos/orientation.js`.
- Pure text/number normalize helpers stay in repo file (or small colocated pure module) without Electron deps.
- Unit tests for merge/import and clearYear.

### Slice 5 — Auth split

- Extract pure lockout schedule + attempt evaluation → `main/auth/lockout-policy.js`.
- Extract session TTL helpers → `main/auth/session-policy.js`.
- Extract users / login_attempts / app session settings SQL → `main/repos/users.js`.
- Slim `main/ipc/auth.js` to compose policy + usersRepo + `firebase-auth-service`.
- Prefer moving school_id persistence side-effects out of the hot login path only if zero behavior change; otherwise leave and document as follow-up.
- Unit tests for lockout schedule and session validity; manual login regression.

### Slice 6 — Verification package

- Full smoke + lint + domain tests + documented manual regression checklist (quickstart).

## Design Principles (implementation)

1. **No channel renames** — preload and smoke parity stay green by construction.
2. **Copy then thin** — move functions with minimal logic rewrites; avoid “while we’re here” refactors.
3. **Explicit capture for bulk** — keep `captureMode: 'explicit'` + `exclude: true` registry entries as today.
4. **db first arg** — repos continue `(db, …)` injection (no `getDb()` inside repos).
5. **Error boundary stays at IPC** — repos may return `{ success: false, error }` or throw; IPC helpers still sanitize for renderer.

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Missed capture after move | Keep registry entries; extend exact-bulk tests; manual sync push check |
| Auth regression | Extract pure policy first with golden tests against current constants; then move SQL |
| Oversized PR | Merge by slice 0→5; each independently shippable |
| Hidden teacher identity coupling | Call `main/teachers/identity` from repo, not renderer |

## Success Mapping

| Spec SC | Plan evidence |
|---------|----------------|
| SC-001 | Manual checklist in quickstart |
| SC-002 | `tests/repos-exams|staff|orientation.test.js` |
| SC-003 | `tests/auth-lockout-policy.test.js`, `auth-session-policy.test.js` |
| SC-004 | Repos use capture-port; no-op in unit tests |
| SC-005 | `npm run test:smoke` per slice |
| SC-006 | Agents.md + write-channel checklist update |
| SC-007 | No change to `sanitizeIpcErrorMessage`; spot-check |

## Phase 0 & 1 Outputs

- [research.md](./research.md) — decisions for capture port, extraction order, auth boundaries  
- [data-model.md](./data-model.md) — logical modules/entities (no schema change)  
- [contracts/](./contracts/) — capture-port, repo↔IPC, auth layering  
- [quickstart.md](./quickstart.md) — how to verify locally  

## Next Command

Run **`/speckit.tasks`** to generate dependency-ordered `tasks.md` from this plan.

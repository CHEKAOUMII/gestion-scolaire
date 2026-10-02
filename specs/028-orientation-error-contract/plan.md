# Implementation Plan: Orientation Error Contract (Hybrid Handling)

**Branch**: `028-orientation-error-contract` | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)  
**Input**: Feature specification from `/specs/028-orientation-error-contract/spec.md`  
**Source plan**: [docs/plans/2026-07-17-centralized-error-handling-plan.md](../../docs/plans/2026-07-17-centralized-error-handling-plan.md)  
**Sibling (out of scope)**: [docs/plans/2026-07-17-centralize-error-handling-plan.md](../../docs/plans/2026-07-17-centralize-error-handling-plan.md) (`ipc-result` reaction helper)

## Summary

Establish a **hybrid** error-handling architecture for student orientation: one dual-export vocabulary module (`js/shared/errors/orientation-error-contract.js`) owns stable codes, default Arabic messages, severity, retryability, classification, safe-detail rules, and flat-shape `normalize` for both **shared** and **page-only** sections. Main-process orientation IPC and the import/display pages consume that vocabulary and drop competing catalogs. Page recovery stays local (parse/batching/summaries, `loadGeneration` stale discard, independent list/stats/chart recovery). Clarified product rules: multi-batch import reports **partial progress + failed batch**; stale loads are **silent**; wrong-year responses get a **visible non-blocking notice**; message **core fixed, context allowed**.

## Technical Context

**Language/Version**: JavaScript (CommonJS + dual-export UMD/IIFE) on Electron 35 / Node.js runtime  
**Primary Dependencies**: Existing IPC helpers (`handleRead` / `handleWrite` / `handleWriteSoftAuth`), `main/repos/orientation.js`, `preload.js` `window.api.orientation` (pass-through), unified message system (`showToast` / `showConfirm`)  
**Storage**: SQLite orientation tables — **no schema migration** for this feature  
**Testing**: Node unit tests under `tests/orientation/` (extend suite; pattern matches `tests/orientation/*.test.js`); CI gates `npm run lint` + `npm run test:smoke`; full `npm test` / `tests/run-all.js` for orientation slices  
**Target Platform**: Windows Electron desktop; plain Node for contract unit tests (no Electron UI)  
**Project Type**: Desktop multi-page Electron app (no bundler; deferred `<script>` load order)  
**Performance Goals**: Pure normalize/catalog lookups O(1); no change to bulk batch size (500) or repo transaction shape  
**Constraints**: Flat failure shape preserved (no nested `error` object); IPC sanitization non-regression; locked codes (esp. `IMPORT_ROLLBACK` + all current IPC-boundary codes); 027 layering (no SQL in IPC; repo + capture-port untouched functionally); Arabic RTL user messages  
**Scale/Scope**: Orientation domain only — 1 new shared module, ~3 consumers (IPC + import + display), optional ipc-helpers export of sanitizer, tests + checklist note; not app-wide domains

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|--------|
| I. Code Quality & Consistency | Pass | Prettier/ESLint; camelCase JS; shared dual-export matches `js/shared/gender.js` idiom |
| II. Testing Standards | Pass | New contract unit tests; smoke parity (no channel renames); no CDN; no migration |
| III. UX Consistency | Pass | Arabic defaults; toasts/status via existing message system; RTL content; core message + optional context |
| IV. Good Practices & Architecture | Pass | Renderer still only via `window.api`; no new IPC channels; handlers stay on wrappers; pure shared module has no Electron/SQLite/DOM |
| V. Performance | Pass | No query plan changes; pure vocabulary work only |
| Security & Data Integrity | Pass | Safe-detail allowlist; strip internals at IPC boundary; no secrets in contract |

**Post-Phase 1 re-check**: Design centralizes vocabulary only; page recovery and repo transactions remain local. Sanitizer dedupe exports from `ipc-helpers` (optional) does not weaken auth wrappers. No constitution violations. Complexity is justified by three-catalog drift (see Complexity Tracking).

## Project Structure

### Documentation (this feature)

```text
specs/028-orientation-error-contract/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── orientation-error-contract.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Phase 2 (/speckit.tasks — not this command)
```

### Source Code (repository root)

```text
js/shared/errors/
└── orientation-error-contract.js   # NEW: dual-export vocabulary + normalize + safeDetails

main/ipc/
├── ipc-helpers.js                  # OPTIONAL: export looksLikeInternalErrorMessage (+ keep sanitize)
└── orientation.js                  # CONSUME contract; drop inline catalog; keep toOrientationErrorResponse boundary

main/repos/
└── orientation.js                  # NO functional change (transactions + capture-port)

js/pages/
├── settings-imports.js             # Drop local catalog; consume contract; keep parse/batch/summary/partial-progress
└── students-orientation.js         # Drop local catalog; consume contract; keep loadGeneration / recovery UX

settings-imports.html               # Script tag for contract (defer, before page JS)
students-orientation.html           # Same

preload.js                          # Unchanged (raw pass-through)
main/sync/capture.js                # Unchanged (orientation bulk exclude/explicit)

tests/orientation/
├── error-contract-unit.test.js     # NEW
├── ipc-bulk-safety.test.js         # EXTEND if needed for rollback codes
└── merge-and-map.test.js           # Touch only if imports break

docs/plans/
└── 2026-07-15-add-write-channel-checklist.md  # ADD: consume shared error contract step for domain writes
```

**Structure Decision**: Stay in the existing Electron monorepo. Place the contract under `js/shared/errors/` (new folder) as a dependency-free dual-export module, matching `js/shared/gender.js`. Do **not** invent `main/services/` or change preload channels. Repo layer remains the SQL/transaction owner; IPC remains the security boundary for outbound failure shapes.

## Complexity Tracking

| Extra structure | Why Needed | Simpler Alternative Rejected Because |
|-----------------|------------|-------------------------------------|
| Dual-export shared contract module | Spec FR-001/003: one vocabulary for main + both pages | Keep three catalogs — proven drift (§source plan 2.8) |
| Two sections (shared + page-only) in one module | Clarification Q1; SC-008 reviewability | Page-local catalogs for page-only codes — reintroduces split ownership |
| Keep `toOrientationErrorResponse` as adapter | Security boundary + detail stripping + code inference | Let pages trust raw throws — leaks internals |
| Optional export of `looksLikeInternalErrorMessage` | FR-020 remove orientation-only duplicate | Leave near-duplicate in orientation.js — maintenance drift |

## Implementation Phases (for `/speckit.tasks`)

Ordered for compatibility safety; each slice ends with targeted tests green.

### Slice 0 — Inventory lock

- Record exact keys/messages from three catalogs (already in source plan + data-model).
- Grep all code references to each code before any rename.
- Mark **compatibility-locked** shared codes (no silent renames).

### Slice 1 — Contract module + unit tests

- Implement `js/shared/errors/orientation-error-contract.js` (UMD like `gender.js`).
- Export: catalogs (shared + pageOnly), metadata getters, `normalize`, `unknownCode` / fallback, `isRetryable`, `safeDetails` / filter, `userMessage` baseline helper.
- Pure only: no Electron, SQLite, DOM, `showToast`.
- Add `tests/orientation/error-contract-unit.test.js`.

### Slice 2 — Main IPC integration

- `require` contract from `main/ipc/orientation.js`.
- Replace inline `ORIENTATION_ERROR_CATALOG`; keep `toOrientationErrorResponse`, `inferOrientationErrorCode`, five channels, `IMPORT_ROLLBACK` remap.
- Remove local `looksLikeInternalMessage`; use exported sanitizer from `ipc-helpers` (or thin wrapper that reuses it + `[sync:capture]` rule if needed).
- Confirm repo + capture registration unchanged.

### Slice 3 — Import page (`settings-imports`)

- Load contract script in HTML; remove local 18-code catalog.
- Use shared section for IPC codes; page-only section for file/parse codes.
- Preserve: year hard-match, dedupe, batching 500, summary, **partial progress + failed batch** (FR-011a), never `clearYear` on normal path.
- Presentation context allowed around default message (FR-002a).

### Slice 4 — Display page (`students-orientation`)

- Load contract script; remove `ORIENTATION_DISPLAY_ERRORS`.
- Preserve: `loadGeneration`, independent list/stats, chart isolation.
- **Silent** stale discard (FR-012a); **visible non-blocking** wrong-year notice (FR-012b).

### Slice 5 — Cleanup & docs

- Grep for deleted catalog names / duplicate sanitizer.
- Update write-channel checklist: “consume shared error contract when domain has one.”
- Optional ownership note near contract file header.
- Run lint + smoke + orientation tests + manual smoke from quickstart.

## Key design decisions (see research.md)

1. Dual-export UMD; pure data + pure functions only.
2. Flat normalize output (rich + lean → superset).
3. Canonical defaults for shared codes prefer main IPC catalog; reconcile drift per research R3.
4. `SCHOOL_YEAR_MISMATCH` remains in **shared** section for compatibility; file-level hard-stop and per-row `year_mismatch` details keep current product semantics.
5. Sibling `ipc-result` helper is out of scope; contract `normalize` is the future input for that helper.

## Risks (from source plan — mitigations retained)

| Risk | Mitigation |
|------|------------|
| Code rename breaks logs/branches | Inventory + lock + aliases if ever renamed |
| Nested shape breaks consumers | Contract emits flat shape; unit-test both inputs |
| Dual-export CJS vs browser divergence | Copy `gender.js` idiom; load smoke in both contexts |
| Global handler hides page context | Not building a global handler |
| Partial multi-batch messaging | FR-011a / clarification Q3 |
| Stale overwrite | Keep generation token; silent discard |
| Wrong-year vs empty | FR-012b visible notice |

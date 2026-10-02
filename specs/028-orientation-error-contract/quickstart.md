# Quickstart: Verify 028-orientation-error-contract

**Branch**: `028-orientation-error-contract`  
**Goal**: Confirm one orientation error vocabulary, safe messaging, and page-local recovery without schema or channel changes.

## Prerequisites

- Repo root install: `npm ci` if needed
- Dev launch available: `npm run dev` or `npm start` (Windows)
- Prefer a non-production school year for import/clear experiments

## 1. Automated gates (every slice)

```bash
npm run lint
npm run test:smoke
```

Contract and orientation unit tests (no Electron window):

```bash
node tests/orientation/error-contract-unit.test.js
node tests/orientation/ipc-bulk-safety.test.js
node tests/orientation/merge-and-map.test.js
```

If the repo wires these into `npm test` / `tests/run-all.js`, also run:

```bash
npm test
```

## 2. Contract inventory check (SC-001 / SC-008)

1. Open `js/shared/errors/orientation-error-contract.js`.
2. Confirm **shared** and **page-only** sections exist.
3. Grep for competing catalogs:

```bash
# Expect no remaining full local catalogs for orientation errors
rg "ORIENTATION_ERROR_CATALOG|ORIENTATION_DISPLAY_ERRORS" js/pages main/ipc
```

4. Confirm `main/ipc/orientation.js` requires the contract and does not redefine a parallel full catalog.
5. Confirm service path does not depend on page-only codes to build responses.

Pass: one vocabulary, zero competing full catalogs, shared codes have single default message/severity/retryable.

## 3. Manual — import (SC-002 / SC-006)

| # | Case | Steps | Pass criteria |
|---|------|-------|----------------|
| 1 | Happy import | Import valid orientation file for selected year | Arabic summary counts; year data not cleared |
| 2 | Empty / bad file | Empty or unsupported format | Clear local failure; no writes |
| 3 | Year mismatch file | File year ≠ selected | Hard stop; no writes; mismatch message |
| 4 | Missing student code | Row without code | Actionable validation outcome |
| 5 | Forced batch failure | Simulate DB/tx failure mid-import if possible | Failed batch = rollback wording; not “permanently partial save” for that batch |
| 6 | Multi-batch partial | Large file (multiple 500-row batches); fail later batch if injectable | Prior batch counts accurate + separate failed-batch notice |
| 7 | Clear-year isolation | Normal import path | Zero clear-year; clear-year only via explicit confirmed UI |

## 4. Manual — display (SC-003)

| # | Case | Steps | Pass criteria |
|---|------|-------|----------------|
| 1 | List ok / stats fail | Force stats failure if possible | Table remains; stats error shown; retry stats path |
| 2 | Chart fail | Break chart data/render | Tables/KPIs remain; chart notice only |
| 3 | Rapid year switch | Switch year A→B while loading | Older response discarded **silently** (no toast spam) |
| 4 | Wrong-year response | If injectable: response year ≠ request | Visible non-blocking notice; not empty success; no overwrite |
| 5 | Valid empty | Year/filter with zero rows | Empty state, not load error |

## 5. Safety (SC-004)

Force an internal-style failure (invalid DB path simulation or known IPC error path). Confirm UI text has:

- No `SQLITE_*`, stack frames, `.js:line`, absolute paths
- Arabic product language only

## 6. Regression control (SC-007)

- Valid list + stats still load for a known year
- Smoke parity still green (no preload channel renames)
- Auth denial on write still lean auth outcome, not fake validation code

## 7. Suggested workflow per implementation slice

1. Implement slice (see plan.md slices 0–5).
2. Run lint + smoke + `error-contract-unit` (+ relevant orientation tests).
3. Spot-check manual rows for that slice.
4. Commit when green.

## 8. Out of scope for this verification

- App-wide `ipc-result` helper
- Other domains’ error catalogs
- Schema migrations
- Redesign of orientation merge/SQL

## Next

Generate tasks with `/speckit.tasks`.

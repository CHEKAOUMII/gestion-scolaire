# Implementation Plan: Save License Key on Paid Activation

**Branch**: `016-auto-sync-paid-key` | **Date**: 2026-03-26 | **Spec**: [spec.md](spec.md)
**Input**: Feature specification from `/specs/016-auto-sync-paid-key/spec.md`

## Summary

When a paid license is activated via `activateLicense()` in `main/licensing/service.js`, the system must automatically save the original (pre-hash) normalized key (`decoded.normalizedKey`) into `sync_config.license_key`. This eliminates the manual step where administrators copy-paste the key into the sync settings page. The change is a single try/catch-wrapped UPDATE statement inserted into the existing `activateLicense()` function, covering all three success paths (new activation, re-activation, reinstall merge) with one insertion point.

## Technical Context

**Language/Version**: JavaScript (Node.js, Electron)
**Primary Dependencies**: `better-sqlite3`, `electron`
**Storage**: SQLite — `sync_config` table (single-row, `id = 1`), `license_key` column (TEXT, nullable, added by migration `2026-03-034`)
**Testing**: `npm run lint` + `npm run test:smoke` (IPC parity, module integrity, no CDN refs)
**Target Platform**: Windows desktop (Electron)
**Project Type**: Desktop app (Electron, no bundler)
**Performance Goals**: N/A — single synchronous DB UPDATE, negligible overhead
**Constraints**: Must not break activation if `sync_config` table/row is missing
**Scale/Scope**: Single function modification in one file

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | Notes |
|-----------|--------|-------|
| I. Code Quality & Consistency | PASS | camelCase functions, snake_case DB columns, Prettier/ESLint enforced |
| II. Testing Standards | PASS | `npm run lint` + `npm run test:smoke` as CI gate. No new IPC channels, so IPC parity unaffected |
| III. User Experience Consistency | PASS | No UI changes — purely internal main-process logic |
| IV. Good Practices & Architecture | PASS | No new IPC channels. No renderer changes. No `preload.js` changes. Uses existing `getDb()` singleton |
| V. Performance Requirements | PASS | Single synchronous `UPDATE` on a 1-row table — negligible cost |
| Security & Data Integrity | PASS | No secrets in code. The normalized key is stored in the local SQLite DB (already stores license hashes). `handleWrite` auth not relevant — this runs inside the main process, not via IPC |
| Development Workflow | PASS | Feature branch `016-auto-sync-paid-key`. Will run lint + smoke before merge |

**Gate result**: ALL PASS — no violations.

## Project Structure

### Documentation (this feature)

```text
specs/016-auto-sync-paid-key/
├── plan.md              # This file
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
└── tasks.md             # Phase 2 output (/speckit.tasks)
```

### Source Code (repository root)

```text
main/licensing/service.js    # MODIFY — activateLicense() function (lines 318–540)
```

**Structure Decision**: No new files. Single modification to an existing function in `main/licensing/service.js`. The change adds ~8 lines (a try/catch-wrapped UPDATE) after line 410 (post license insert/update, pre device-limit check).

## Design

### Insertion Point Analysis

The `activateLicense()` function (lines 318–540) has this flow:

```
1. Decode + validate key        → fail returns (lines 319–340)
2. Hash key, get db             → line 342
3. Insert OR update license     → lines 350–410
4. Check existing activations   → lines 412–472 (success return: re-activation/reinstall)
5. Check device limit           → lines 474–493 (fail return: limit reached)
6. Insert new activation        → lines 495–533 (success return: new activation)
```

The optimal insertion point is **after step 3 (line 410)** and **before step 4 (line 412)**. At this point:
- The key has been validated (steps 1–2 passed)
- The license record exists in the DB (step 3 completed)
- We have access to `db` and `decoded.normalizedKey`
- ALL subsequent success paths (re-activation at L464, new activation at L535) are covered
- The device-limit failure at L481 is harmless — if activation fails due to device limit, having the key saved is inconsequential (it will be overwritten on the next successful activation)

### Implementation Approach

Insert a single try/catch block after line 410:

```javascript
// Save the license key for sync authentication
try {
    db.prepare('UPDATE sync_config SET license_key = ? WHERE id = 1').run(decoded.normalizedKey);
} catch {
    // sync_config table may not exist yet (pre-migration) — safe to ignore
}
```

**Why try/catch with empty catch:**
- The `sync_config` table is created by `ensureSyncSchema()` which runs during DB init
- The `license_key` column is added by migration `2026-03-034`
- On a fresh install, if the activation somehow runs before migrations complete, the UPDATE would throw `SqliteError: no such table: sync_config` or `no such column: license_key`
- The empty catch matches the existing ESLint config (`no-empty` allows empty catch blocks)

**Why UPDATE not INSERT OR REPLACE:**
- `sync_config` is initialized with `INSERT OR IGNORE INTO sync_config(id, ...) VALUES(1, ...)` during `ensureSyncSchema()` (schema.js:534)
- The row with `id = 1` always exists in normal operation
- UPDATE on a non-existent row affects 0 rows (no error) — this is the fallback
- No need for INSERT — the schema init handles row creation

### Key Format Verification

- `decoded.normalizedKey` is the full `GSLK-<base64>.<signature>` string
- `readLicenseKey()` in `main/sync/credentials.js:12` reads `config.license_key` and trims it
- The credential refresh flow (`refreshCredentials()` at line 17) sends this key to the Auth Lambda
- Format is identical — no transformation needed

## Complexity Tracking

No violations to justify — all constitution gates pass.

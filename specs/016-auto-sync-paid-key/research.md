# Research: Save License Key on Paid Activation

**Feature**: `016-auto-sync-paid-key`
**Date**: 2026-03-26

## Research Tasks

### R1: Where to insert the sync key save in `activateLicense()`

**Decision**: Insert a single try/catch-wrapped UPDATE after line 410 (post license insert/update), before line 412 (device activation checks).

**Rationale**: This is the earliest point where all preconditions are met (key validated, license record exists, `db` and `decoded.normalizedKey` available) and it covers all subsequent success paths (re-activation at L464, new activation at L535) with a single insertion point. Placing it at each `return { success: true }` would duplicate code across two locations.

**Alternatives considered**:
- **Before key hashing (line 342)**: Too early — key validation has passed but the license record hasn't been inserted yet. If the INSERT/UPDATE fails, we'd have saved a key for a failed activation.
- **At each success return (lines 464, 535)**: Correct behavior but duplicates the same 4-line block in two places.
- **After line 410 (chosen)**: Single point, all preconditions met, covers all success paths. The device-limit failure path (L481) is irrelevant — saving the key for a denied activation is harmless since the next successful activation will overwrite it.

### R2: Error handling strategy for missing sync_config

**Decision**: Use try/catch with empty catch block.

**Rationale**: The `sync_config` table and `license_key` column are created by database initialization (`ensureSyncSchema()` in schema.js) and migration `2026-03-034`. In normal operation they always exist before `activateLicense()` can be called. The try/catch handles the edge case of a fresh install where activation somehow runs before migrations complete. The ESLint config explicitly allows empty catch blocks (`no-empty: ['error', { allowEmptyCatch: true }]`).

**Alternatives considered**:
- **Check table existence before UPDATE**: Adds unnecessary complexity. The UPDATE on a missing table throws; catching it is simpler and equally safe.
- **Log a warning in catch**: Adds noise for a scenario that shouldn't occur in practice. The plan's Feature 2+ will also use this pattern, so logging would be inconsistent unless all features log.
- **Empty catch (chosen)**: Simplest, consistent with existing codebase patterns, ESLint-compliant.

### R3: Key format compatibility

**Decision**: Use `decoded.normalizedKey` directly — no transformation needed.

**Rationale**: Verified the full data flow:
1. `activateLicense()` receives raw key → `decodeOfflineLicenseKey()` produces `decoded.normalizedKey` (format: `GSLK-<base64>.<signature>`)
2. `readLicenseKey()` in `main/sync/credentials.js:12` reads `sync_config.license_key`, trims whitespace
3. `refreshCredentials()` sends the key to Auth Lambda as-is
4. The formats are identical — `decoded.normalizedKey` is exactly what `readLicenseKey()` expects.

**Alternatives considered**: None — the format is unambiguous.

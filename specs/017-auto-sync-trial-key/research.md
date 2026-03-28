# Research: Auto-Generate Trial Sync Key

**Feature**: `017-auto-sync-trial-key`
**Date**: 2026-03-26

## Research Tasks

### R1: Where to place `ensureTrialSyncKey()` function

**Decision**: Add to `main/licensing/service.js` as a new exported function.

**Rationale**: `service.js` already contains `activateLicense()` which writes to `sync_config.license_key` (line 414). It also imports `getTrialStatus` from `./trialService` and exports `getPublicActivationStatus()`. Placing the new function here keeps all license key lifecycle logic in one module and reuses existing imports.

**Alternatives considered**:
- `main/sync/credentials.js` — Rejected: this file is focused on reading sync config and refreshing AWS credentials, not generating/writing keys. Adding write logic here would violate single responsibility.
- New file `main/licensing/trialSyncKey.js` — Rejected: Overkill for a single function. Would add an unnecessary module to the licensing directory.

### R2: Startup call site placement

**Decision**: Insert `ensureTrialSyncKey()` call in `main.js` at line 188, after `initDatabase()` and before `registerAllIpcHandlers(ipcMain)`.

**Rationale**:
- After `initDatabase()`: Guarantees all migrations have run (including `2026-03-034` which adds `sync_config.license_key` column), so the table and column exist.
- Before `registerAllIpcHandlers()`: Ensures the key is in place before any IPC handler could potentially read sync config.
- Before `startSyncPushBackground()` / `startSyncPullBackground()`: Ensures the key is available when sync background tasks attempt to authenticate via `readLicenseKey()` in `credentials.js`.

**Alternatives considered**:
- After `registerAllIpcHandlers()` but before sync tasks — Would work but is less clean; the key should be ready before any code path could read it.
- Lazy initialization on first sync attempt — Rejected: Adds complexity to sync code path, harder to reason about, and sync tasks start immediately on boot.

### R3: How to detect active trial status

**Decision**: Use `getPublicActivationStatus()` which is already defined in `service.js` and returns `{ status: 'trial', trialActive: true, trialEndDate: '...' }` when trial is active.

**Rationale**: This is the canonical public API for license/trial status. It internally calls `getLicenseStatus()` and `getTrialStatus()` (from `trialService.js`). The `trialEndDate` field (ISO 8601 string) is exactly what `createOfflineLicenseKey()` needs for its `expiresAt` parameter.

**Alternatives considered**:
- Call `getTrialStatus()` directly from `trialService.js` — Rejected: Would bypass the full license status check. A user with a valid paid license should not get a trial key even if `isTrialActive` is true. `getPublicActivationStatus()` handles this correctly by only returning `status: 'trial'` when there is no valid paid license.

### R4: Key generation parameters

**Decision**: Call `createOfflineLicenseKey()` with:
```
{
  planCode: 'basic',
  expiresAt: trialEndDate,    // ISO 8601 from getPublicActivationStatus()
  customerRef: 'TRIAL',
  requiresOnlineValidation: false
}
```

**Rationale**:
- `planCode: 'basic'` — Trial users get the basic plan tier, matching the plan document specification.
- `expiresAt: trialEndDate` — Key expiry matches trial expiry so the key naturally becomes invalid when the trial ends.
- `customerRef: 'TRIAL'` — Identifies auto-generated trial keys vs. paid keys for debugging/auditing.
- `requiresOnlineValidation: false` — Trial keys work offline, consistent with the app's offline-capable design.
- `deviceCode` omitted (defaults to `''`) — Trial keys are not device-locked.

**Alternatives considered**:
- Setting `requiresOnlineValidation: true` — Rejected: Would require network connectivity during trial, breaking offline capability.
- Using a different `customerRef` format — Rejected: `'TRIAL'` is simple and clear for identification.

### R5: Error handling strategy

**Decision**: Wrap the entire `ensureTrialSyncKey()` body in a try/catch that logs errors via `console.error` and returns silently. Never throw or propagate errors.

**Rationale**: The function runs during app startup. Any unhandled error would trigger `handleFatalStartupError()` and prevent the app from launching. This is unacceptable for a non-critical feature (sync key generation). The existing pattern in `activateLicense()` (line 413-417) already uses try/catch around the `sync_config` write for the same reason.

**Alternatives considered**:
- Returning an error object — Rejected: The caller (`main.js` startup) has no meaningful way to handle it. Silent failure with logging is the correct approach.
- Only catching the DB write — Rejected: Any step (status check, key generation, DB write) could fail. Wrapping the entire function is simpler and safer.

### R6: NULL vs empty string handling for existing key check

**Decision**: Use `readLicenseKey(db)` from `main/sync/credentials.js` which already handles both cases — returns `null` for NULL, empty string, or whitespace-only values.

**Rationale**: `readLicenseKey()` at line 12-15 does:
```js
return config.license_key ? String(config.license_key).trim() || null : null;
```
This collapses NULL, empty string, and whitespace to `null`. The truthiness check `if (readLicenseKey(db))` is sufficient.

**Alternatives considered**:
- Writing a custom check — Rejected: `readLicenseKey()` already exists and is the canonical way to read the key. Duplicating this logic would violate DRY.

### R7: Signing secret compatibility

**Decision**: No action needed. `createOfflineLicenseKey()` uses `getSigningSecret()` which has a three-level priority chain: env var → per-installation file (`userData/.license-secret`) → auto-generated. The same secret is used for both paid and trial keys.

**Rationale**: For the Auth Lambda to accept the trial key, the signing secret must match the one in AWS Secrets Manager (`pencil2/license-secret`). This is an operational deployment concern — if the secrets don't match, the key will be rejected at auth time, which is handled gracefully by the sync credential refresh flow (returns `null`). No code changes needed for this.

**Alternatives considered**: None — this is purely operational.

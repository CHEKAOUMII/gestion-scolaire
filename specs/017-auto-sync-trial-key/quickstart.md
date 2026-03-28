# Quickstart: Auto-Generate Trial Sync Key

**Feature**: `017-auto-sync-trial-key`
**Branch**: `017-auto-sync-trial-key`

## What This Feature Does

Automatically generates a trial sync license key on app startup when:
1. No sync license key exists in `sync_config`
2. The user is in an active trial period

This eliminates manual key entry for trial users.

## Files Changed

| File | Change |
|------|--------|
| `main/licensing/service.js` | Add `ensureTrialSyncKey()` function + export |
| `main.js` | Add `ensureTrialSyncKey()` call in startup sequence |

## Implementation Overview

### New function: `ensureTrialSyncKey()`

Location: `main/licensing/service.js`

```
ensureTrialSyncKey()
  1. Get db via getDb()
  2. Read license key via readLicenseKey(db) — if truthy, return early
  3. Get status via getPublicActivationStatus() — if not trial/active, return early
  4. Generate key via createOfflineLicenseKey({ planCode: 'basic', expiresAt: trialEndDate, customerRef: 'TRIAL', requiresOnlineValidation: false })
  5. Write key to sync_config: UPDATE sync_config SET license_key = ? WHERE id = 1
  6. Entire function wrapped in try/catch — errors logged, never thrown
```

### Startup integration

Location: `main.js`, inside `app.whenReady().then()`

```
initDatabase();              // existing — migrations run, sync_config table ready
ensureTrialSyncKey();        // NEW — generate trial key if needed
registerAllIpcHandlers();    // existing
startOwnerSyncBackground();  // existing — sync tasks can now read the key
startSyncPushBackground();   // existing
...
```

## How to Test

1. **Trial key generation**: Delete `sync_config.license_key` (or start fresh), ensure trial is active, launch app → verify key is populated
2. **Key preservation**: Set a key manually, restart app → verify key unchanged
3. **Non-trial skip**: Expire the trial, clear the key, restart → verify no key generated
4. **Error resilience**: Temporarily break `sync_config` table, restart → verify app starts without errors

## Verification Commands

```bash
npm run lint          # ESLint must pass
npm run test:smoke    # Smoke tests must pass (IPC parity, no CDN refs)
npm run dev           # Manual verification — app starts normally
```

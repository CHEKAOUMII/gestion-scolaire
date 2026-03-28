# Quickstart: Update Sync Key on License Status Change

**Feature**: 019-sync-key-license-change
**Date**: 2026-03-26

## Overview

This feature adds automatic sync key lifecycle management. When license status changes (deactivation, expiration, upgrade), the system automatically clears or replaces `sync_config.license_key` and invalidates cached AWS credentials.

## Files to Modify

| File | Change |
|------|--------|
| `main/sync/credentials.js` | Add `clearSyncLicenseKey(db)` helper, export `readLicenseKey`/`readSyncConfig`, add expiration guard in `getCredentials()` |
| `main/licensing/service.js` | Call `clearSyncLicenseKey` in `deactivateCurrentDevice()`, call `clearCredentials` after key write in `activateLicense()`, add expiration-aware key clearing in `getPublicActivationStatus()` |

## No New Files

This feature modifies two existing files only. No new modules, no new IPC channels, no new migrations, no new HTML pages.

## Development Workflow

```bash
# 1. Start the dev environment
npm run dev

# 2. Test deactivation flow
# - Activate a paid license via the UI
# - Verify sync_config.license_key is populated (Feature 1)
# - Deactivate device via Settings > License > Deactivate
# - Verify sync_config.license_key is NULL

# 3. Test upgrade flow (trial → paid)
# - Start with trial (ensure ensureTrialSyncKey runs)
# - Activate a paid license
# - Verify key is replaced and sync works immediately

# 4. Run validation
npm run lint
npm run test:smoke
```

## Key Design Decisions

1. **Centralized clear helper**: `clearSyncLicenseKey(db)` in `credentials.js` handles both the DB NULL and the in-memory cache clear in one call.
2. **No polling loop**: Expiration is detected at natural call points (sync operations, status queries) rather than via a dedicated background timer.
3. **Fix readLicenseKey export**: The existing import in `service.js` gets `undefined` because `readLicenseKey` is not exported from `credentials.js`. This must be fixed as part of this feature.
4. **Idempotent operations**: Clearing an already-NULL key succeeds silently. All DB operations are wrapped in try/catch for pre-migration safety.

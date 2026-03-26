# Quickstart: Save License Key on Paid Activation

**Feature**: `016-auto-sync-paid-key`
**Date**: 2026-03-26

## What This Feature Does

Automatically saves the license key into the sync configuration when a paid license is activated, so administrators don't have to manually enter it in the sync settings page.

## File Changed

- **`main/licensing/service.js`** — `activateLicense()` function (~line 410): Add a try/catch-wrapped `UPDATE sync_config SET license_key = ?` using the decoded normalized key.

## How to Verify

1. Generate a test license key:
   ```bash
   npm run license:key -- --plan=pro --days=365 --customer=TEST-001
   ```

2. Launch the app:
   ```bash
   npm run dev
   ```

3. Activate the license key in Settings → License

4. Check the sync config:
   - Open Settings → Sync
   - The license key field should already be populated (or verify via SQLite: `SELECT license_key FROM sync_config WHERE id = 1`)

## How to Run Validation

```bash
npm run lint
npm run test:smoke
```

Both must pass with zero errors.

# Quickstart: Hide License Key Field from Sync Settings UI

**Feature**: `018-hide-sync-license-field`
**Date**: 2026-03-26

## What This Feature Does

Hides the license key input field from the sync settings configuration form. The license key is now managed automatically by the system (via Features 1 & 2), so admins no longer need to see or interact with it.

## Files Modified

| File | Change |
|------|--------|
| `settings-sync.html` | Add `hidden` attribute to the `<div>` wrapping `cfg-license-key` (lines 198–210) |
| `js/pages/settings-sync.js` | Remove license key reading (line 345) and payload inclusion (line 382) from form submit handler |

## How to Verify

1. **Checkout the branch**:
   ```bash
   git checkout 018-hide-sync-license-field
   ```

2. **Run CI checks**:
   ```bash
   npm run lint
   npm run css:build
   npm run test:smoke
   ```

3. **Manual verification**:
   ```bash
   npm run dev
   ```
   - Navigate to the sync settings page
   - Confirm the license key field is not visible
   - Save settings — confirm success toast appears
   - Check `sync_config.license_key` in the database is unchanged after save
   - Verify RTL layout has no gaps where the field was

## Rollback

To re-enable the license key field:
1. Remove the `hidden` attribute from the wrapper `<div>` in `settings-sync.html`
2. Re-add the license key reading and payload lines in `js/pages/settings-sync.js`

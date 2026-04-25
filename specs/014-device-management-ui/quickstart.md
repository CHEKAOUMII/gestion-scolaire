# Quickstart: Device Management UI

**Feature**: 014-device-management-ui
**Date**: 2026-03-23

## Prerequisites

1. **Node.js** installed (project uses built-in Node.js modules only — no new dependencies)
2. **Dependencies installed**: `npm ci`
3. **Phases 7.1–7.6 completed** (database schema, OTP module, LAN discovery, server OTP, setup page, IPC layer — or at minimum the DB schema from 7.1 and OTP module from 7.2)

## Development Setup

```bash
# Start the app in development mode (CSS watch + Electron)
npm run dev

# Or run CSS build once and start Electron separately
npm run css:build
npm run start
```

## Files to Create

| File | Purpose |
| ---- | ------- |
| `main/ipc/linking.js` | IPC handler module for 6 device management channels |

## Files to Modify

| File | Change |
| ---- | ------ |
| `settings-sync.html` | Add device management HTML sections (device info, OTP generation, linked devices table) |
| `js/pages/settings-sync.js` | Add device management JS logic (load devices, OTP countdown, revoke flow) |
| `main/ipc/registerAll.js` | Register `registerLinkingIpc` module |
| `preload.js` | Add `linking` namespace with 6 channels |
| `tests/smoke.js` | Update expected channel count (+6) |

## Key Patterns to Follow

### IPC Handler Pattern (`main/ipc/linking.js`)

```js
const { handleRead, handleWrite } = require('./ipc-helpers');
const { getDb } = require('../db/context');

function registerLinkingIpc(ipcMain) {
    // Read channels — any authenticated user
    handleRead(ipcMain, 'linking:getCurrentDevice', async (db) => {
        // ... return { success, deviceHash, deviceName, ... }
    });

    // Write channels — admin only
    handleWrite(ipcMain, 'linking:generateOtp', ['admin'], async (db, event) => {
        // ... return { success, otp, expiresAt }
    });
}

module.exports = { registerLinkingIpc };
```

### Admin-Only UI Pattern (`js/pages/settings-sync.js`)

```js
// Already exists in settings-sync.js:
const sess = JSON.parse(localStorage.getItem('gsl_auth_session_v1') || '{}');
const isAdmin = (sess.role || '').toLowerCase() === 'admin';
if (!isAdmin) document.body.classList.add('sync-readonly');

// For new elements — use CSS class:
//   .sync-readonly .admin-only { display: none !important; }
// And conditional JS rendering for interactive elements.
```

### HTML Section Pattern (`settings-sync.html`)

```html
<div class="students-results" id="device-management-section">
    <h3><i class="fas fa-laptop"></i> إدارة الأجهزة</h3>
    <!-- content -->
</div>
```

### Table Pattern

```html
<div class="table-responsive">
    <table class="students-table">
        <caption class="sr-only">جدول الأجهزة المرتبطة</caption>
        <thead><tr><th>...</th></tr></thead>
        <tbody id="devices-tbody">
            <tr><td colspan="5" class="loading-cell">
                <i class="fas fa-spinner fa-spin"></i> جاري التحميل...
            </td></tr>
        </tbody>
    </table>
</div>
```

## Verification Checklist

```bash
# 1. Lint all modified files
npm run lint

# 2. Build CSS (in case tailwind classes were added)
npm run css:build

# 3. Run smoke tests (validates IPC parity)
npm run test:smoke

# 4. Manual verification
npm run dev
# → Login as admin → Navigate to sync settings
# → Verify: device info section shows current device
# → Verify: linked devices table renders
# → Verify: OTP generate button is visible (admin) / hidden (non-admin)
# → Verify: generate OTP → 6-digit code + countdown
# → Verify: cancel OTP → resets to initial state
# → Verify: revoke a non-current device → confirmation → status changes
# → Verify: dark mode renders correctly
# → Verify: RTL layout is correct
```

## Debugging Tips

- **IPC parity error in smoke test**: Ensure every channel in `preload.js` `linking` namespace has a matching handler in `main/ipc/linking.js`, and that `registerAll.js` imports and calls `registerLinkingIpc`.
- **OTP not generating**: Check that `institution_config` has `setup_completed = 1` and a valid `massar_code`.
- **LAN server not starting**: Check ports 19876/19877 are not in use. The LAN server requires an active OTP.
- **Device hash mismatch**: `collectCurrentFingerprint()` may return different hashes across OS reinstalls. Check `main/licensing/deviceFingerprint.js` for the hash composition logic.

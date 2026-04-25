# Quickstart: First-Run Setup Page

**Feature**: 012-first-run-setup
**Date**: 2026-03-22

## Prerequisites

Before implementing this feature, these must be complete:
- Phase 7.1 (DB Schema) — `institution_config`, `device_otp`, `linked_devices` tables
- Phase 7.2 (OTP Module) — `main/linking/otp.js` with `generateOtp()`, `verifyOtp()`
- Phase 7.3 (LAN Discovery) — `main/linking/lan.js` with `discoverLanDevices()`, `verifyViaLan()`
- Phase 7.4 (Server OTP) — `main/linking/server.js` with `verifyViaServer()`

## Files to Create

| File | Purpose |
|------|---------|
| `setup.html` | Full-screen setup page (no sidebar) |
| `js/pages/setup.js` | Renderer logic: two-step wizard, validation, IPC calls |
| `main/ipc/setup.js` | IPC handlers for 4 setup channels |

## Files to Modify

| File | Change |
|------|--------|
| `main.js` (~line 158) | Add setup-completed check before `loadFile()` |
| `main/ipc/registerAll.js` | Register `registerSetupIpc` |
| `preload.js` | Add `setup` namespace (4 channels) |
| `tests/smoke.js` | Update expected channel count |

## Development Workflow

```bash
# 1. Start dev mode
npm run dev

# 2. To test first-run: delete institution_config row
#    Open DevTools console in the app, or use sqlite3 CLI:
#    DELETE FROM institution_config WHERE id = 1;
#    Then restart the app — setup.html should appear

# 3. After making changes, validate:
npm run lint
npm run css:build
npm run test:smoke
```

## Key Patterns to Follow

### HTML page template (setup.html)
```html
<!DOCTYPE html>
<html lang="ar" dir="rtl">
<head>
    <meta charset="UTF-8" />
    <title>إعداد المؤسسة</title>
    <link rel="stylesheet" href="vendor/fonts/google-fonts.css" />
    <link rel="stylesheet" href="vendor/fontawesome/css/all.min.css" />
    <link rel="stylesheet" href="css/tailwind-output.css" />
    <script src="js/notifications.js"></script>
</head>
<body class="bg-secondary text-text-main font-main min-h-screen flex items-center justify-center">
    <div id="toast-container" class="toast-container"></div>
    <!-- wizard content here -->
    <script src="js/pages/setup.js" defer></script>
</body>
</html>
```

### IPC handler (main/ipc/setup.js)
```javascript
const { handleRead, handleWriteNoAuth } = require('./ipc-helpers');

function registerSetupIpc(ipcMain) {
    handleRead(ipcMain, 'setup:getInstitutionStatus', async (db) => {
        const row = db.prepare('SELECT * FROM institution_config WHERE id = 1').get();
        return { success: true, setupCompleted: !!(row && row.setup_completed) };
    });

    handleWriteNoAuth(ipcMain, 'setup:setupNewInstitution', async (db, payload) => {
        // validate, transaction, return
    });
}
```

### Renderer IPC call (js/pages/setup.js)
```javascript
const result = await window.api.setup.setupNewInstitution({
    massarCode: massarInput.value.trim(),
    institutionName: nameInput.value.trim(),
    adminName: adminNameInput.value.trim(),
    adminPassword: passwordInput.value,
});
if (result.success) {
    location.href = 'index.html';
} else {
    showToast(result.error, 'error');
}
```

### Button loading state
```javascript
const originalHTML = btn.innerHTML;
btn.disabled = true;
btn.innerHTML = '<i class="fas fa-spinner fa-spin"></i> جاري الإعداد...';
try {
    // async operation
} finally {
    btn.disabled = false;
    btn.innerHTML = originalHTML;
}
```

## Constitution Compliance Notes

- Use `handleWriteNoAuth` / `handleRead` — never raw `ipcMain.handle()` (Principle IV)
- Use logical CSS properties (`ps-*`, `pe-*`, `ms-*`, `me-*`) — no physical left/right (Principle III)
- All text in Arabic, `dir="rtl" lang="ar"` on `<html>` (Principle III)
- Dark mode must work — use Tailwind theme tokens (Principle III)
- Run `npm run lint` + `npm run test:smoke` before commit (Principle II)

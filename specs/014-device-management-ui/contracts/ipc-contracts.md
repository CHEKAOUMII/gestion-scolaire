# IPC Contracts: Device Management UI

**Feature**: 014-device-management-ui
**Date**: 2026-03-23
**Namespace**: `linking`

All channels below are **post-auth** (require logged-in session). Admin-only channels use `handleWrite` with `['admin']` role. Read channels use `handleRead` (any authenticated user).

---

## Channel: `linking:getCurrentDevice`

**Type**: Read (any role)
**Helper**: `handleRead`
**Renderer call**: `window.api.linking.getCurrentDevice()`

### Request
No arguments.

### Response
```json
{
    "success": true,
    "deviceHash": "a1b2c3d4e5f67890...",
    "deviceName": "PC-ADMIN-01",
    "platform": "win32",
    "appVersion": "1.0.17"
}
```

### Error Response
```json
{
    "success": false,
    "error": "Failed to collect device fingerprint"
}
```

### Notes
- Calls `collectCurrentFingerprint()` from `main/licensing/deviceFingerprint.js`
- `deviceHash` is the 64-character hex string used to identify this device in the `linked_devices` table
- The truncated hash shown in the UI is `deviceHash.substring(0, 8)`

---

## Channel: `linking:getLinkedDevices`

**Type**: Read (any role)
**Helper**: `handleRead`
**Renderer call**: `window.api.linking.getLinkedDevices()`

### Request
No arguments.

### Response
```json
{
    "success": true,
    "devices": [
        {
            "deviceHash": "a1b2c3d4e5f67890...",
            "deviceName": "PC-ADMIN-01",
            "osPlatform": "win32",
            "appVersion": "1.0.17",
            "linkedBy": "setup_new",
            "linkedAt": "2026-03-20T10:00:00.000Z",
            "lastSeenAt": "2026-03-23T14:30:00.000Z",
            "revokedAt": null,
            "status": "active"
        }
    ]
}
```

### Notes
- Returns all rows from `linked_devices` ordered by `linked_at ASC`
- Column names are camelCased for the renderer (snake_case in DB)
- `linkedBy` is one of: `'setup_new'`, `'otp_lan'`, `'otp_server'`
- `status` is one of: `'active'`, `'revoked'`

---

## Channel: `linking:generateOtp`

**Type**: Write (admin only)
**Helper**: `handleWrite` with `['admin']`
**Renderer call**: `window.api.linking.generateOtp()`

### Request
No arguments. The MASSAR code and device hash are read from the database and device fingerprint internally.

### Response
```json
{
    "success": true,
    "otp": "482917",
    "expiresAt": "2026-03-23T15:10:00.000Z"
}
```

### Error Response
```json
{
    "success": false,
    "error": "No institution configured"
}
```

### Notes
- Calls `generateOtp(db, massarCode, deviceHash)` from `main/linking/otp.js`
- Also calls `startLinkingServer(db)` from `main/linking/lan.js` to enable LAN discovery
- The plaintext `otp` is returned ONLY here — it cannot be retrieved later
- Any previously active OTP is automatically invalidated
- The OTP expires after 10 minutes

---

## Channel: `linking:cancelOtp`

**Type**: Write (admin only)
**Helper**: `handleWrite` with `['admin']`
**Renderer call**: `window.api.linking.cancelOtp()`

### Request
No arguments.

### Response
```json
{
    "success": true,
    "message": "OTP cancelled"
}
```

### Notes
- Expires any active OTP for the institution's MASSAR code
- Calls `stopLinkingServer()` from `main/linking/lan.js` to shut down LAN services
- Idempotent — safe to call when no OTP is active

---

## Channel: `linking:getOtpStatus`

**Type**: Read (any role)
**Helper**: `handleRead`
**Renderer call**: `window.api.linking.getOtpStatus()`

### Request
No arguments.

### Response (active OTP)
```json
{
    "success": true,
    "active": true,
    "expiresAt": "2026-03-23T15:10:00.000Z",
    "remainingSeconds": 342
}
```

### Response (no active OTP)
```json
{
    "success": true,
    "active": false
}
```

### Notes
- Calls `getActiveOtp(db, massarCode)` from `main/linking/otp.js`
- The UI should compute remaining time from `expiresAt` (not `remainingSeconds`) to avoid drift
- `remainingSeconds` is a convenience field for initial display

---

## Channel: `linking:revokeDevice`

**Type**: Write (admin only)
**Helper**: `handleWrite` with `['admin']`
**Renderer call**: `window.api.linking.revokeDevice(deviceHash)`

### Request
| Parameter | Type | Required | Description |
| --------- | ---- | -------- | ----------- |
| `deviceHash` | string | Yes | The 64-char hex hash of the device to revoke |

### Response
```json
{
    "success": true,
    "message": "Device revoked"
}
```

### Error Response
```json
{
    "success": false,
    "error": "Cannot revoke the current device"
}
```

### Validation Rules
- The target `deviceHash` must not match the current device's hash (self-revoke is prohibited)
- The target device must exist in `linked_devices` and have `status = 'active'`

### Notes
- Sets `status = 'revoked'`, `revoked_at = CURRENT_TIMESTAMP` on the target `linked_devices` row
- Returns error if the device is already revoked or doesn't exist

---

## Preload.js Contract

The `linking` namespace must be added to `preload.js` `contextBridge.exposeInMainWorld('api', { ... })`:

```js
linking: {
    getCurrentDevice: ()           => ipcRenderer.invoke('linking:getCurrentDevice'),
    getLinkedDevices: ()           => ipcRenderer.invoke('linking:getLinkedDevices'),
    generateOtp:      ()           => ipcRenderer.invoke('linking:generateOtp'),
    cancelOtp:        ()           => ipcRenderer.invoke('linking:cancelOtp'),
    getOtpStatus:     ()           => ipcRenderer.invoke('linking:getOtpStatus'),
    revokeDevice:     (deviceHash) => ipcRenderer.invoke('linking:revokeDevice', deviceHash)
}
```

**Total new channels**: 6
**Smoke test impact**: Channel count increases by 6. `tests/smoke.js` expectations must be updated.

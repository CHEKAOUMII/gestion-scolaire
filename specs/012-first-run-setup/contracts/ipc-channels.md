# IPC Contracts: First-Run Setup Page

**Feature**: 012-first-run-setup
**Date**: 2026-03-22

## Namespace: `setup`

All channels in this namespace are **pre-auth** (no login required). They use `handleWriteNoAuth` or `handleRead` from `ipc-helpers.js`.

---

### `setup:getInstitutionStatus`

**Direction**: Renderer → Main
**Auth**: None (pre-login)
**Handler wrapper**: `handleRead`

**Request**: No arguments

**Response**:
```json
{
  "success": true,
  "setupCompleted": false,
  "massarCode": null,
  "institutionName": null
}
```

**Behavior**:
- Reads `institution_config` singleton (id=1)
- Returns `setupCompleted: true` if `setup_completed = 1`
- Returns `setupCompleted: false` if row is missing or `setup_completed = 0`

---

### `setup:setupNewInstitution`

**Direction**: Renderer → Main
**Auth**: None (pre-login)
**Handler wrapper**: `handleWriteNoAuth`

**Request**:
```json
{
  "massarCode": "M320456",
  "institutionName": "ثانوية الفارابي",
  "adminName": "المدير",
  "adminPassword": "securePass123"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| massarCode | string | Yes | Alphanumeric, matches `/^[A-Za-z]\d{4,8}$/`, trimmed |
| institutionName | string | No | Trimmed, max 200 chars |
| adminName | string | Yes | Non-empty, trimmed |
| adminPassword | string | Yes | Min 6 characters |

**Response (success)**:
```json
{
  "success": true,
  "message": "تم إعداد المؤسسة بنجاح"
}
```

**Response (failure)**:
```json
{
  "success": false,
  "error": "رمز ماسار غير صالح"
}
```

**Behavior**:
1. Validate all inputs (MASSAR format, password length, admin name non-empty)
2. INSERT or UPDATE `institution_config` (id=1): set `massar_code`, `institution_name`, `setup_completed=1`, `setup_mode='new'`, `setup_device_hash`
3. UPDATE `users` (id=1): set `name`, `password_hash` (via `hashPassword()`), `must_change_password=0`
4. INSERT into `linked_devices`: current device with `linked_by='setup_new'`
5. Return success

**Atomicity**: All 3 writes wrapped in a single transaction. Rollback on any failure.

---

### `setup:verifyAndLink`

**Direction**: Renderer → Main
**Auth**: None (pre-login)
**Handler wrapper**: `handleWriteNoAuth`

**Request**:
```json
{
  "massarCode": "M320456",
  "otp": "482917"
}
```

| Field | Type | Required | Validation |
|-------|------|----------|------------|
| massarCode | string | Yes | Alphanumeric, trimmed |
| otp | string | Yes | Exactly 6 digits |

**Response (success)**:
```json
{
  "success": true,
  "message": "تم ربط الجهاز بنجاح",
  "verifiedVia": "lan"
}
```

**Response (failure)**:
```json
{
  "success": false,
  "error": "الرمز غير صحيح أو منتهي الصلاحية"
}
```

**Behavior**:
1. Validate inputs (MASSAR format, OTP is 6 digits)
2. Attempt LAN discovery (`discoverLanDevices(massarCode, 5000)`)
3. If LAN device found → verify via LAN HTTP (`verifyViaLan(...)`)
4. If LAN not found or failed → fall back to server verification (`verifyViaServer(...)`)
5. On success: import sync config, INSERT `institution_config` (setup_completed=1, setup_mode='linked'), INSERT `linked_devices` (linked_by='otp_lan' or 'otp_server')
6. Return success with `verifiedVia` indicating which method succeeded

**Progress events**: The main process may send progress updates via the IPC response lifecycle. The renderer shows appropriate Arabic progress text based on the verification stage.

---

### `setup:discoverLanDevices`

**Direction**: Renderer → Main
**Auth**: None (pre-login)
**Handler wrapper**: `handleRead`

**Request**:
```json
{
  "massarCode": "M320456",
  "timeoutMs": 5000
}
```

**Response**:
```json
{
  "success": true,
  "devices": [
    {
      "ip": "192.168.1.50",
      "port": 19876,
      "deviceName": "ADMIN-PC"
    }
  ]
}
```

**Behavior**:
- Listens for UDP broadcast beacons on port 19877
- Filters by matching `massarCode`
- Returns list of discovered devices within timeout

---

## Preload.js Namespace Shape

```javascript
setup: {
    getInstitutionStatus: () => ipcRenderer.invoke('setup:getInstitutionStatus'),
    setupNewInstitution: (payload) => ipcRenderer.invoke('setup:setupNewInstitution', payload),
    verifyAndLink: (payload) => ipcRenderer.invoke('setup:verifyAndLink', payload),
    discoverLanDevices: (payload) => ipcRenderer.invoke('setup:discoverLanDevices', payload),
}
```

## Channel Summary

| Channel | Wrapper | Purpose |
|---------|---------|---------|
| `setup:getInstitutionStatus` | `handleRead` | Check if setup is completed |
| `setup:setupNewInstitution` | `handleWriteNoAuth` | Create institution + admin |
| `setup:verifyAndLink` | `handleWriteNoAuth` | OTP verify + import config |
| `setup:discoverLanDevices` | `handleRead` | Scan LAN for admin devices |

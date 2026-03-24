# Linking IPC Contract

## Namespaces

- **Canonical renderer namespace**: `window.api.linking`
- **Temporary compatibility namespace**: `window.api.setup`
- **Compatibility rule**: `window.api.setup` proxies only the four first-run methods to the canonical `window.api.linking` contract. No duplicate IPC handlers are registered for compatibility.

## Standard Response Envelope

### Success

```json
{
    "success": true
}
```

Success payloads extend this envelope with method-specific fields.

### Failure

```json
{
    "success": false,
    "code": "MACHINE_READABLE_CODE",
    "error": "Human-readable message"
}
```

## Canonical Channel Catalog

| Renderer method                        | IPC channel                      | Auth policy                        | Request shape                                                | Success shape                                                                         |
| -------------------------------------- | -------------------------------- | ---------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| `linking.getInstitutionStatus()`       | `linking:get-institution-status` | Pre-login read                     | none                                                         | `{ success, setupCompleted, massarCode, institutionName }`                            |
| `linking.setupNewInstitution(payload)` | `linking:setup-new-institution`  | Pre-login soft-auth write          | `{ massarCode, institutionName?, adminName, adminPassword }` | `{ success, message, setupCompleted: true, institution, currentDevice }`              |
| `linking.discoverLanDevices(payload)`  | `linking:discover-lan-devices`   | Pre-login read                     | `{ massarCode, timeoutMs? }`                                 | `{ success, devices: [{ ip, port, deviceName }] }`                                    |
| `linking.verifyAndLink(payload)`       | `linking:verify-and-link`        | Pre-login soft-auth write          | `{ massarCode, otp }`                                        | `{ success, message, verifiedVia, setupCompleted: true, institution, currentDevice }` |
| `linking.generateOtp()`                | `linking:generate-otp`           | Admin-only write                   | none                                                         | `{ success, otp, expiresAt, remainingSeconds, transport }`                            |
| `linking.cancelOtp()`                  | `linking:cancel-otp`             | Admin-only write                   | none                                                         | `{ success, cancelled: true }`                                                        |
| `linking.getOtpStatus()`               | `linking:get-otp-status`         | Admin-only read-like write wrapper | none                                                         | `{ success, active, status, expiresAt, remainingSeconds, transport }`                 |
| `linking.getLinkedDevices()`           | `linking:get-linked-devices`     | Admin-only read-like write wrapper | none                                                         | `{ success, devices }`                                                                |
| `linking.revokeDevice(payload)`        | `linking:revoke-device`          | Admin-only write                   | `{ deviceHash }`                                             | `{ success, revokedDeviceHash }`                                                      |
| `linking.getCurrentDevice()`           | `linking:get-current-device`     | Admin-only read-like write wrapper | none                                                         | `{ success, device }`                                                                 |

## Compatibility Mapping

| Compatibility method                 | Canonical method                       |
| ------------------------------------ | -------------------------------------- |
| `setup.getInstitutionStatus()`       | `linking.getInstitutionStatus()`       |
| `setup.setupNewInstitution(payload)` | `linking.setupNewInstitution(payload)` |
| `setup.discoverLanDevices(payload)`  | `linking.discoverLanDevices(payload)`  |
| `setup.verifyAndLink(payload)`       | `linking.verifyAndLink(payload)`       |

## DTO Details

### Institution

```json
{
    "massarCode": "M320456",
    "institutionName": "ثانوية ابن سينا"
}
```

### Current Device

```json
{
    "deviceHash": "opaque-device-hash",
    "deviceName": "DESKTOP-ADMIN",
    "platform": "win32",
    "appVersion": "1.0.18",
    "massarCode": "M320456",
    "institutionName": "ثانوية ابن سينا"
}
```

### OTP Transport Status

```json
{
    "lanActive": true,
    "serverPublished": true
}
```

### Linked Device Summary

```json
{
    "deviceHash": "opaque-device-hash",
    "deviceName": "LAB-PC-02",
    "platform": "win32",
    "appVersion": "1.0.18",
    "linkedBy": "otp_lan",
    "linkedAt": "2026-03-23T08:00:00.000Z",
    "lastSeenAt": "2026-03-23T08:10:00.000Z",
    "status": "active",
    "revokedAt": null,
    "isCurrentDevice": false
}
```

## Failure Codes

| Code                       | Meaning                                       | Applies to                            |
| -------------------------- | --------------------------------------------- | ------------------------------------- |
| `ALREADY_CONFIGURED`       | Local device already completed setup          | setup and link writes                 |
| `INVALID_MASSAR`           | MASSAR code missing or invalid                | setup, discovery, link                |
| `INVALID_ADMIN_NAME`       | Founding admin name missing                   | new-institution setup                 |
| `INVALID_PASSWORD`         | Founding admin password missing or too short  | new-institution setup                 |
| `INVALID_OTP`              | OTP missing or incorrect                      | link verify                           |
| `OTP_EXPIRED`              | OTP expired before validation                 | link verify, OTP status               |
| `OTP_CANCELLED`            | OTP was cancelled by the admin                | link verify                           |
| `NO_ACTIVE_OTP`            | No active OTP exists for the institution      | link verify, OTP status               |
| `RATE_LIMITED`             | OTP verification was throttled                | link verify                           |
| `LAN_UNAVAILABLE`          | No acceptable LAN candidate was found         | discovery or hybrid linking telemetry |
| `SERVER_UNAVAILABLE`       | Server verification could not complete        | hybrid linking                        |
| `UNAUTHENTICATED`          | No active session exists                      | admin-only methods                    |
| `FORBIDDEN`                | Session exists but user is not an admin       | admin-only methods                    |
| `DEVICE_NOT_FOUND`         | Requested device does not exist in the roster | revoke device                         |
| `DEVICE_ALREADY_REVOKED`   | Requested device is already revoked           | revoke device                         |
| `CURRENT_DEVICE_PROTECTED` | Attempted to revoke the current device        | revoke device                         |
| `INTERNAL_ERROR`           | Unexpected main-process failure               | any method                            |

## Behavioral Rules

- Canonical IPC channels use wrapper-based auth and error handling only.
- Admin-only read-like channels are treated as auth-gated management calls and excluded from sync capture.
- A successful link write must not be reported until institution bootstrap data has been imported locally.
- Failed link attempts must leave local setup incomplete.
- OTP generation invalidates any previously active OTP for the same institution.
- Current-device protection is enforced in the main process, not only in the renderer.

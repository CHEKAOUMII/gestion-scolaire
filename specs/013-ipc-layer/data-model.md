# Data Model: Phase 7.6 IPC Layer

## Entities

### 1. Institution Status

Represents the minimum institution identity the renderer needs to decide whether onboarding is required.

| Field             | Type           | Rules                                            | Notes                                                   |
| ----------------- | -------------- | ------------------------------------------------ | ------------------------------------------------------- |
| `setupCompleted`  | boolean        | Required                                         | `false` means first-run setup must continue.            |
| `massarCode`      | string or null | Uppercase, pattern `^[A-Z]\d{4,8}$` when present | Returned only when institution identity already exists. |
| `institutionName` | string or null | Trimmed nullable string                          | Optional display identity.                              |

### 2. New Institution Setup Request

Represents the pre-login payload used when the first device creates the institution.

| Field             | Type           | Rules                                         | Notes                                              |
| ----------------- | -------------- | --------------------------------------------- | -------------------------------------------------- |
| `massarCode`      | string         | Required, uppercase, pattern `^[A-Z]\d{4,8}$` | Canonical institution identifier.                  |
| `institutionName` | string or null | Optional, trimmed, empty becomes `null`       | Display-only identity.                             |
| `adminName`       | string         | Required, non-empty after trim                | Used to seed or update the founding admin account. |
| `adminPassword`   | string         | Required, minimum length 6                    | Hashed before persistence.                         |

### 3. Link Verification Request

Represents the pre-login payload used when an additional device links to an existing institution.

| Field        | Type   | Rules                                         | Notes                                           |
| ------------ | ------ | --------------------------------------------- | ----------------------------------------------- |
| `massarCode` | string | Required, uppercase, pattern `^[A-Z]\d{4,8}$` | Must match the institution that issued the OTP. |
| `otp`        | string | Required, exactly 6 digits                    | One-time secret entered by the operator.        |

### 4. Link Bootstrap Payload

Represents the internal payload imported after OTP verification succeeds.

| Field                            | Type            | Rules                             | Notes                                                         |
| -------------------------------- | --------------- | --------------------------------- | ------------------------------------------------------------- |
| `institution.massarCode`         | string          | Required, uppercase MASSAR format | Becomes the linked institution identity.                      |
| `institution.institutionName`    | string or null  | Optional                          | Preserved as display identity.                                |
| `syncConfig.schoolId`            | string          | Required                          | Mirrors MASSAR for sync bootstrap.                            |
| `syncConfig.authLambdaUrl`       | string or null  | Optional, trimmed URL string      | Used by downstream sync bootstrap.                            |
| `syncConfig.awsRegion`           | string or null  | Optional                          | Passed through from the source device.                        |
| `syncConfig.syncIntervalMinutes` | number or null  | Positive integer when present     | Imported without altering unrelated sync state.               |
| `syncConfig.enabled`             | boolean or null | Optional                          | Preserves source-device sync intent.                          |
| `syncConfig.licenseKey`          | string or null  | Optional                          | Carried for downstream licensing/sync integration.            |
| `users[]`                        | array           | Optional                          | Imported user records must include `name` and `passwordHash`. |

### 5. OTP Session

Represents the active link code managed by an authenticated administrator.

| Field                       | Type         | Rules                                                | Notes                                                                             |
| --------------------------- | ------------ | ---------------------------------------------------- | --------------------------------------------------------------------------------- |
| `otp`                       | string       | Exactly 6 digits when newly generated                | Returned only from generation, not from status polling after the fact.            |
| `expiresAt`                 | ISO datetime | Required when active                                 | Drives countdown display and timeout behavior.                                    |
| `remainingSeconds`          | integer      | Zero or positive                                     | Derived from `expiresAt`.                                                         |
| `status`                    | enum         | `active`, `cancelled`, `expired`, `used`, `inactive` | `inactive` is the read-model state when no active OTP exists.                     |
| `transport.lanActive`       | boolean      | Required for admin status                            | Indicates whether LAN discovery/verification services are running.                |
| `transport.serverPublished` | boolean      | Required for admin status                            | Indicates whether the OTP payload is currently available through the server path. |

### 6. Linked Device Record

Represents a device currently known to belong to the institution.

| Field             | Type                 | Rules                                | Notes                                                 |
| ----------------- | -------------------- | ------------------------------------ | ----------------------------------------------------- |
| `deviceHash`      | string               | Required, non-empty                  | Stable device identity key.                           |
| `deviceName`      | string               | Optional, trimmed                    | Human-readable machine name.                          |
| `platform`        | string or null       | Optional                             | Operating-system label.                               |
| `appVersion`      | string or null       | Optional                             | Version visible to administrators.                    |
| `linkedBy`        | enum                 | `setup_new`, `otp_lan`, `otp_server` | Describes how the record became active.               |
| `linkedAt`        | ISO datetime or null | Optional                             | Creation/reactivation timestamp.                      |
| `lastSeenAt`      | ISO datetime or null | Optional                             | Most recent activity marker.                          |
| `status`          | enum                 | `active`, `revoked`                  | `revoked` devices remain visible in management views. |
| `revokedAt`       | ISO datetime or null | Optional                             | Present when `status = revoked`.                      |
| `isCurrentDevice` | boolean              | Required in read models              | Prevents self-revocation in the UI.                   |

### 7. Current Device Summary

Represents the local device identity returned to authenticated administrators.

| Field             | Type           | Rules    | Notes                                                       |
| ----------------- | -------------- | -------- | ----------------------------------------------------------- |
| `deviceHash`      | string         | Required | Must match one linked-device record when setup is complete. |
| `deviceName`      | string         | Required | Derived from local fingerprint context.                     |
| `platform`        | string         | Required | Current platform label.                                     |
| `appVersion`      | string         | Required | Current application version.                                |
| `massarCode`      | string or null | Optional | Current institution identifier.                             |
| `institutionName` | string or null | Optional | Current institution display name.                           |

## Relationships

- One `Institution Status` maps to one local-device setup state.
- One institution can have many historical `OTP Session` records, but only one active session at a time.
- One institution can have many `Linked Device Record` entries.
- One `Link Verification Request` consumes one active `OTP Session` and creates or reactivates one `Linked Device Record`.
- One `Current Device Summary` should correspond to exactly one linked-device record after setup completes.

## Validation Rules

- MASSAR codes are normalized to uppercase and must follow the same single rule at every IPC entry point.
- OTP values must be six digits and are never stored or returned in plaintext except at generation time.
- First-run setup requests are rejected once local setup is already marked complete.
- Link requests do not change local setup state unless verification and bootstrap import both succeed.
- Admin-only device-management actions require an authenticated admin session.
- Revocation requests are rejected for unknown devices, already-revoked devices, and the current device.

## State Transitions

### Local Setup State

| From                | Event                            | To                  |
| ------------------- | -------------------------------- | ------------------- |
| `unconfigured`      | Successful new-institution setup | `configured-new`    |
| `unconfigured`      | Successful OTP link              | `configured-linked` |
| `configured-new`    | External reset only              | `unconfigured`      |
| `configured-linked` | External reset only              | `unconfigured`      |

### OTP Session State

| From                             | Event                           | To          |
| -------------------------------- | ------------------------------- | ----------- |
| `inactive`                       | Admin generates OTP             | `active`    |
| `active`                         | Admin cancels OTP               | `cancelled` |
| `active`                         | OTP is consumed by a valid link | `used`      |
| `active`                         | Expiry time passes              | `expired`   |
| `cancelled` / `used` / `expired` | Admin generates a new OTP       | `active`    |

### Linked Device State

| From      | Event                                         | To        |
| --------- | --------------------------------------------- | --------- |
| `missing` | First-device setup                            | `active`  |
| `missing` | Successful OTP link                           | `active`  |
| `active`  | Admin revokes device                          | `revoked` |
| `revoked` | Device re-links successfully with a valid OTP | `active`  |

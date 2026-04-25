# Data Model: LAN Discovery & Verification

**Feature**: 010-lan-discovery
**Date**: 2026-03-22
**Status**: Complete

---

## Entities

This module does not introduce new database tables — it operates on tables created by Phase 7.1 (`institution_config`, `device_otp`, `linked_devices`) and reads from existing tables (`sync_config`, `users`). The data model here documents the **runtime data structures** used by the LAN module.

---

### Linking Beacon (UDP Broadcast Message)

A JSON-encoded datagram broadcast every 3 seconds while a linking session is active.

| Field        | Type   | Constraints                  | Description                                      |
|--------------|--------|------------------------------|--------------------------------------------------|
| service      | string | Constant: `"pencil2-link"`   | Magic identifier to filter unrelated UDP traffic  |
| massar       | string | 5–10 alphanumeric chars      | School MASSAR code being advertised                |
| port         | number | Integer, 1024–65535          | HTTP verification server port (default: 19876)     |
| deviceName   | string | Non-empty                    | Admin device hostname (`os.hostname()`)            |

**Example**:
```json
{"service":"pencil2-link","massar":"M320456","port":19876,"deviceName":"PC-ADMIN-01"}
```

---

### Discovered Device (Client-Side Discovery Result)

Returned by the discovery listener when a matching beacon is received.

| Field      | Type   | Constraints             | Description                                |
|------------|--------|-------------------------|--------------------------------------------|
| ip         | string | Valid IPv4 address      | Source IP of the broadcasting device        |
| port       | number | Integer, 1024–65535     | HTTP verification port from beacon         |
| deviceName | string | Non-empty               | Admin device hostname from beacon          |

---

### Verification Request (HTTP POST Body)

Sent by the joining device to `POST /verify-link` on the admin device.

| Field      | Type   | Constraints             | Description                                    |
|------------|--------|-------------------------|------------------------------------------------|
| massar     | string | 5–10 alphanumeric chars | School MASSAR code to verify against           |
| otp        | string | 6 digits                | OTP plaintext entered by the user              |
| deviceHash | string | 64-char hex (SHA-256)   | Hardware fingerprint of the joining device     |
| deviceName | string | Non-empty               | Hostname of the joining device                 |

---

### Verification Response — Success

Returned when OTP verification passes.

| Field         | Type   | Description                                              |
|---------------|--------|----------------------------------------------------------|
| success       | boolean| Always `true`                                            |
| syncConfig    | object | Sync configuration for DynamoDB connectivity             |
| institution   | object | Institution identity information                         |
| users         | array  | User account records for import on joining device        |

**`syncConfig` fields**:

| Field                  | Type   | Source Table   | Description                     |
|------------------------|--------|----------------|---------------------------------|
| school_id              | string | sync_config    | DynamoDB partition key           |
| aws_region             | string | sync_config    | AWS region for DynamoDB          |
| auth_lambda_url        | string | sync_config    | Authentication Lambda URL        |
| sync_interval_minutes  | number | sync_config    | Sync interval in minutes         |
| enabled                | number | sync_config    | Whether sync is enabled (0/1)    |

**`institution` fields**:

| Field             | Type   | Source Table        | Description                  |
|-------------------|--------|---------------------|------------------------------|
| massar_code       | string | institution_config  | School MASSAR code           |
| institution_name  | string | institution_config  | Display name (may be null)   |

**`users` array item fields**:

| Field               | Type   | Source Table | Description                          |
|---------------------|--------|--------------|--------------------------------------|
| name                | string | users        | User display name                    |
| email               | string | users        | Unique email (may be null)           |
| role                | string | users        | User role (admin, staff, etc.)       |
| password_hash       | string | users        | Scrypt hash — portable across devices|
| pin_hash            | string | users        | PIN scrypt hash (may be null)        |
| must_change_password| number | users        | Force password change flag           |

---

### Verification Response — Failure

Returned when OTP verification fails.

| Field   | Type    | Description                                                   |
|---------|---------|---------------------------------------------------------------|
| success | boolean | Always `false`                                                |
| error   | string  | Error code: `INVALID_OTP`, `RATE_LIMITED`, `NO_ACTIVE_OTP`, `OTP_EXPIRED`, `MASSAR_MISMATCH`, `INVALID_REQUEST` |

---

### Linked Device Record (Database — Phase 7.1 Table)

Inserted by `lan.js` into `linked_devices` on successful verification.

| Field       | Type   | Value Set By LAN Module      | Description                          |
|-------------|--------|------------------------------|--------------------------------------|
| device_hash | string | From request `deviceHash`    | Hardware fingerprint, UNIQUE         |
| device_name | string | From request `deviceName`    | Hostname of joined device            |
| os_platform | string | Inferred or from request     | OS platform (e.g., `win32`)          |
| app_version | string | From app package version     | Application version at link time     |
| linked_by   | string | Constant: `"otp_lan"`        | Linking method identifier            |
| linked_at   | string | `CURRENT_TIMESTAMP`          | When the device was linked           |
| last_seen_at| string | `CURRENT_TIMESTAMP`          | Initially same as `linked_at`        |
| status      | string | Default: `"active"`          | Device status                        |

---

## State Transitions

### Linking Server Lifecycle

```
                 ┌──────────┐
    startLinkingServer()     │
         │                   │
         ▼                   │
    ┌─────────┐              │
    │ RUNNING │──── OTP expires / consumed ────► STOPPED
    │         │──── stopLinkingServer()    ────► STOPPED
    │         │──── app shutdown           ────► STOPPED
    └─────────┘              │
         │                   │
         │ startLinkingServer() called again
         │                   │
         ▼                   │
    stop previous ───────────┘
    then start new
```

### Verification Request Flow

```
    Request arrives at POST /verify-link
              │
              ▼
    ┌─ Parse JSON body ──► malformed? ──► 400 INVALID_REQUEST
    │
    ▼
    MASSAR matches active session?
    │ no ──► 403 MASSAR_MISMATCH
    │
    ▼ yes
    verifyOtp(db, massar, otp, deviceHash)
    │
    ├── { valid: false, error: 'RATE_LIMITED' }  ──► 429 RATE_LIMITED
    ├── { valid: false, error: 'NO_ACTIVE_OTP' } ──► 400 NO_ACTIVE_OTP
    ├── { valid: false, error: 'OTP_EXPIRED' }   ──► 400 OTP_EXPIRED
    ├── { valid: false, error: 'INVALID_OTP' }   ──► 401 INVALID_OTP
    │
    └── { valid: true }
              │
              ▼
        INSERT INTO linked_devices
        Read sync_config + institution_config + users
              │
              ▼
        200 { success: true, syncConfig, institution, users }
              │
              ▼
        Schedule server stop (OTP consumed)
```

---

## Relationships

```
institution_config (1) ──── massar_code ──── (1) Linking Beacon
                                              │
device_otp (1) ──── massar_code ──── (1) Verification Request
                                              │
linked_devices (N) ──── device_hash ──── (1) Verification Request
                                              │
sync_config (1) ──── * ──── (1) Verification Response.syncConfig
users (N) ──── * ──── (N) Verification Response.users
```

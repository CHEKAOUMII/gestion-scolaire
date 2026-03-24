# Contract: LAN Discovery & Verification Module

**Module**: `main/linking/lan.js`
**Feature**: 010-lan-discovery
**Date**: 2026-03-22
**Status**: Complete

---

## Exported Functions

### `startLinkingServer(db)`

Starts the UDP broadcast beacon and HTTP verification server for a linking session. Reads the active OTP from the database to determine the MASSAR code and expiry time. If a server is already running, stops it first.

**Parameters**:

| Name | Type   | Required | Description                        |
| ---- | ------ | -------- | ---------------------------------- |
| db   | object | Yes      | `better-sqlite3` database instance |

**Returns**: `Promise<{ port: number, address: string }>` — resolves after the HTTP server and UDP broadcast socket are successfully bound.

**Throws**: `Error` if:

- No institution is configured in `institution_config`
- The configured institution MASSAR code is invalid
- No active OTP exists in the database
- The UDP broadcast socket cannot be created or bound
- HTTP port 19876 is already in use by another application

**Side effects**:

1. Binds a UDP socket on an ephemeral local port and begins broadcasting a beacon to UDP port 19877 every 3 seconds
2. Starts an HTTP server on port 19876 with a `POST /verify-link` endpoint
3. Schedules a `setTimeout` to auto-stop when the active OTP expires
4. If a previous linking server is running, calls `stopLinkingServer()` first

**Beacon format** (sent every 3 seconds via UDP broadcast):

```json
{ "service": "pencil2-link", "massar": "M320456", "port": 19876, "deviceName": "PC-ADMIN-01" }
```

---

### `stopLinkingServer()`

Stops the UDP broadcast and HTTP server, releasing all ports and clearing all timers. Safe to call when no server is running (no-op).

**Parameters**: None

**Returns**: `void`

**Side effects**:

1. Closes the UDP socket (stops broadcasting)
2. Closes the HTTP server (stops accepting connections)
3. Clears the OTP expiry timeout
4. Sets internal state to "not running"

---

### `discoverLanDevices(massarCode, timeoutMs)`

Listens for UDP broadcast beacons on port 19877, filtering for a specific MASSAR code. Collects matching devices until the timeout expires.

**Parameters**:

| Name       | Type   | Required | Description                                         |
| ---------- | ------ | -------- | --------------------------------------------------- |
| massarCode | string | Yes      | MASSAR code to filter beacons by (case-insensitive) |
| timeoutMs  | number | No       | Discovery timeout in milliseconds (default: 5000)   |

**Returns**: `Promise<Array<{ ip: string, port: number, deviceName: string }>>` — resolves with all unique matching devices discovered before timeout.

**Throws**: `Error` if:

- `massarCode` fails validation (`validateMassarCode()`)
- UDP socket cannot be created

**Side effects**:

1. Binds a temporary UDP socket to listen for broadcast messages
2. Socket is automatically closed when timeout expires
3. Deduplicates devices by IP address (same device sending multiple beacons)

**Behavior notes**:

- Returns an empty array if no matching beacons are received before timeout
- Ignores malformed beacons and beacons with non-matching MASSAR codes silently
- After the socket is created, runtime/bind errors resolve with the devices collected so far (often `[]`) so callers can fall back cleanly
- The returned promise always resolves for timeout or runtime socket failure; only socket creation/validation failures reject

---

### `verifyViaLan(targetIp, targetPort, massar, otp, deviceHash, deviceName)`

Sends an HTTP POST request to a discovered admin device to verify an OTP and retrieve sync configuration.

**Parameters**:

| Name       | Type   | Required | Description                                     |
| ---------- | ------ | -------- | ----------------------------------------------- |
| targetIp   | string | Yes      | IP address of the admin device (from discovery) |
| targetPort | number | Yes      | HTTP port of the admin device (from discovery)  |
| massar     | string | Yes      | MASSAR code to verify                           |
| otp        | string | Yes      | 6-digit OTP plaintext                           |
| deviceHash | string | Yes      | Hardware fingerprint of the joining device      |
| deviceName | string | Yes      | Hostname of the joining device                  |

**Returns**: `Promise<object>` — resolves with the verification response:

Success:

```json
{
    "success": true,
    "syncConfig": {
        "school_id": "M320456",
        "aws_region": "eu-west-1",
        "auth_lambda_url": "https://...",
        "sync_interval_minutes": 10,
        "enabled": 1
    },
    "institution": {
        "massar_code": "M320456",
        "institution_name": "ثانوية ابن رشد"
    },
    "users": [
        {
            "name": "أحمد المدير",
            "email": "admin@school.ma",
            "role": "admin",
            "password_hash": "scrypt$...$...",
            "pin_hash": null,
            "must_change_password": 0
        }
    ]
}
```

Failure:

```json
{
    "success": false,
    "error": "INVALID_OTP"
}
```

**Throws**: `Error` if:

- Network connection to the admin device fails (unreachable, connection refused)
- Response is not valid JSON
- Request times out (10-second timeout)

**Side effects**: None on the calling device. On the admin device, a successful verification triggers device registration and OTP consumption.

---

## Internal Functions (Not Exported)

### HTTP Request Handler (`POST /verify-link`)

Handles incoming verification requests on the admin device.

**Request validation**:

1. Method must be `POST`, path must be `/verify-link` — otherwise 404
2. Content-Type must be `application/json` — otherwise 400
3. Body must be valid JSON under 4KB — otherwise 400
4. Required fields: `massar` (string), `otp` (string), `deviceHash` (non-empty string after trim), `deviceName` (non-empty string after trim) — otherwise 400

**Processing**:

1. Ensure a linking session is still active — otherwise `NO_ACTIVE_OTP`
2. Validate `massar` matches the active linking session's MASSAR code — otherwise `MASSAR_MISMATCH`
3. Call `verifyOtp(db, massar, otp, deviceHash)` from Phase 7.2
4. On failure: return the error from `verifyOtp` (maps to `INVALID_OTP`, `RATE_LIMITED`, `NO_ACTIVE_OTP`, `OTP_EXPIRED`)
5. On success:
   a. Insert into `linked_devices` (device_hash, device_name, os_platform, app_version, linked_by='otp_lan', linked_at, last_seen_at)
   b. Read `sync_config WHERE id = 1`
   c. Read `institution_config WHERE id = 1`
   d. Read `users WHERE disabled = 0`
   e. Return success response with syncConfig, institution, users
   f. Schedule `stopLinkingServer()` (OTP is now consumed)

**HTTP status codes**:

| Status | When                                             |
| ------ | ------------------------------------------------ |
| 200    | Successful verification (body: success response) |
| 400    | Malformed request, invalid JSON, missing fields  |
| 401    | Invalid OTP                                      |
| 403    | MASSAR code mismatch                             |
| 404    | Unknown endpoint (not POST /verify-link)         |
| 413    | Request body exceeds 4KB                         |
| 429    | Rate limited (too many failed attempts)          |

---

## Module State

The module maintains internal state variables (not exported):

| Variable       | Type           | Description                                           |
| -------------- | -------------- | ----------------------------------------------------- |
| httpServer     | http.Server    | Active HTTP server instance, or `null`                |
| udpSocket      | dgram.Socket   | Active UDP broadcast socket, or `null`                |
| broadcastTimer | NodeJS.Timeout | Interval timer for beacon broadcast, or `null`        |
| expiryTimer    | NodeJS.Timeout | Timeout for OTP expiry auto-stop, or `null`           |
| activeMassar   | string         | MASSAR code of the current linking session, or `null` |
| activeDb       | object         | Database reference for the current session, or `null` |

All state is reset to `null` when `stopLinkingServer()` is called.

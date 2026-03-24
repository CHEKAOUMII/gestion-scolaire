# Tasks: LAN Discovery & Verification

**Input**: Design documents from `/specs/010-lan-discovery/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/lan-module.md, quickstart.md

**Tests**: Not requested — no test tasks included.

**Organization**: Tasks are grouped by user story. This is a single-file module (`main/linking/lan.js`) so most tasks are sequential within the file, but the overall structure enables incremental validation.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

## Path Conventions

This is an Electron desktop app. All paths are relative to repository root:

- **New file**: `main/linking/lan.js`
- **Existing dependency (OTP)**: `main/linking/otp.js` — provides `verifyOtp`, `getActiveOtp`, `validateMassarCode`
- **Existing dependency (fingerprint)**: `main/licensing/deviceFingerprint.js` — provides `collectCurrentFingerprint`
- **Existing DB tables**: `institution_config`, `device_otp`, `linked_devices`, `sync_config`, `users` (all created by Phase 7.1 or earlier)

---

## Phase 1: Setup

**Purpose**: Create file skeleton with requires, constants, module state, and exports

- [x] T001 Create `main/linking/lan.js` file with module boilerplate, constants, state variables, and exports

**Details for T001**:

Create the file `main/linking/lan.js` with the following exact content:

```js
'use strict';

const dgram = require('dgram');
const http = require('http');
const os = require('os');
const { verifyOtp, getActiveOtp, validateMassarCode } = require('./otp');

// ── Constants ──
const UDP_BROADCAST_PORT = 19877;
const HTTP_SERVER_PORT = 19876;
const BEACON_INTERVAL_MS = 3000; // 3 seconds
const BEACON_SERVICE_ID = 'pencil2-link';
const MAX_REQUEST_BODY_BYTES = 4096; // 4KB limit (R6)
const HTTP_CLIENT_TIMEOUT_MS = 10000; // 10 seconds for verifyViaLan requests
const DEFAULT_DISCOVERY_TIMEOUT_MS = 5000; // 5 seconds default discovery timeout

// ── Module state (all reset to null by stopLinkingServer) ──
let httpServer = null;
let udpSocket = null;
let broadcastTimer = null;
let expiryTimer = null;
let activeMassar = null;
let activeDb = null;

module.exports = {
    startLinkingServer,
    stopLinkingServer,
    discoverLanDevices,
    verifyViaLan
};
```

The four exported function names are declared but not yet implemented — they will be added in the following tasks. The `require` statements, constants, and module state variables are final and should not change.

**Important notes**:

- `dgram` is Node.js built-in for UDP sockets — no npm install needed.
- `http` is Node.js built-in for HTTP server/client — no npm install needed.
- `os` is Node.js built-in — used for `os.hostname()` in beacon messages.
- The imports from `./otp` reference the Phase 7.2 module in the same directory.
- Do NOT import `getDb` — this module receives `db` as a parameter from callers.

**Checkpoint**: File exists at `main/linking/lan.js`. Running `npm run lint` may show warnings about undeclared functions — that is expected until all tasks are complete.

---

## Phase 2: Foundational — Internal Helper Functions

**Purpose**: Internal helper functions that ALL user stories depend on. These MUST be implemented before any user story work begins.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

- [x] T002 Implement internal `buildBeaconMessage(massarCode, port)` helper in `main/linking/lan.js`
- [x] T003 Implement internal `buildSuccessPayload(db)` helper in `main/linking/lan.js`
- [x] T004 Implement internal `registerLinkedDevice(db, deviceHash, deviceName)` helper in `main/linking/lan.js`
- [x] T005 Implement internal `sendJsonResponse(res, statusCode, body)` helper in `main/linking/lan.js`
- [x] T006 Implement internal `collectRequestBody(req, maxBytes)` helper in `main/linking/lan.js`

**Details for T002**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block:

```js
function buildBeaconMessage(massarCode, port) {
    const message = JSON.stringify({
        service: BEACON_SERVICE_ID,
        massar: massarCode,
        port: port,
        deviceName: os.hostname()
    });
    return Buffer.from(message);
}
```

**What this does**: Creates a JSON-encoded Buffer containing the beacon payload. The `service` field is the fixed magic identifier `"pencil2-link"` that client listeners use to filter out unrelated UDP traffic. The `port` field tells the client which HTTP port to connect to for verification.

**Acceptance check**: `buildBeaconMessage('M320456', 19876)` returns a Buffer. Parsing it with `JSON.parse(buffer.toString())` produces `{ service: 'pencil2-link', massar: 'M320456', port: 19876, deviceName: '<hostname>' }`.

---

**Details for T003**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `buildBeaconMessage`:

```js
function buildSuccessPayload(db) {
    // 1. Read sync configuration
    const syncRow = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
    const syncConfig = syncRow
        ? {
              school_id: syncRow.school_id || null,
              aws_region: syncRow.aws_region || 'eu-west-1',
              auth_lambda_url: syncRow.auth_lambda_url || null,
              sync_interval_minutes: syncRow.sync_interval_minutes || 10,
              enabled: syncRow.enabled || 0
          }
        : null;

    // 2. Read institution identity
    const instRow = db.prepare('SELECT massar_code, institution_name FROM institution_config WHERE id = 1').get();
    const institution = instRow
        ? {
              massar_code: instRow.massar_code,
              institution_name: instRow.institution_name || null
          }
        : null;

    // 3. Read all active (non-disabled) user accounts
    const users = db
        .prepare(
            `
            SELECT name, email, role, password_hash, pin_hash, must_change_password
            FROM users
            WHERE disabled = 0
        `
        )
        .all();

    return { syncConfig, institution, users };
}
```

**What this does**: Reads three database tables and assembles the payload returned to the joining device on successful OTP verification:

1. `sync_config` (id=1): DynamoDB connection details — `school_id`, `aws_region`, `auth_lambda_url`, `sync_interval_minutes`, `enabled`. These allow the joining device to configure its own sync engine.
2. `institution_config` (id=1): Institution identity — `massar_code` and `institution_name`.
3. `users`: All non-disabled user accounts with their password hashes and PIN hashes. Password hashes are `scrypt$<salt>$<hash>` format and are portable across devices (the joining device can insert them directly).

**Why password hashes are included**: Per research decision R5, the OTP verification already establishes trust. Including scrypt-hashed passwords (never plaintext) allows staff to log in on the joining device immediately without the admin needing to reset every password.

**Acceptance check**: When `sync_config`, `institution_config`, and `users` tables have data, calling `buildSuccessPayload(db)` returns `{ syncConfig: {...}, institution: {...}, users: [{...}] }`.

---

**Details for T004**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `buildSuccessPayload`:

```js
function registerLinkedDevice(db, deviceHash, deviceName) {
    const now = new Date().toISOString();
    const platform = process.platform; // e.g. 'win32'
    let appVersion = null;
    try {
        const { app } = require('electron');
        appVersion = app.getVersion();
    } catch (_) {
        appVersion = 'unknown';
    }

    // Use INSERT OR REPLACE to handle the case where the device was
    // previously linked (e.g. revoked then re-linked).
    // The linked_devices table has UNIQUE(device_hash).
    db.prepare(
        `
        INSERT INTO linked_devices (device_hash, device_name, os_platform, app_version, linked_by, linked_at, last_seen_at, status)
        VALUES (?, ?, ?, ?, 'otp_lan', ?, ?, 'active')
        ON CONFLICT(device_hash) DO UPDATE SET
            device_name = excluded.device_name,
            os_platform = excluded.os_platform,
            app_version = excluded.app_version,
            linked_by = excluded.linked_by,
            linked_at = excluded.linked_at,
            last_seen_at = excluded.last_seen_at,
            status = excluded.status,
            revoked_at = NULL
    `
    ).run(deviceHash, deviceName, platform, appVersion, now, now);
}
```

**What this does**: Registers a verified device in the `linked_devices` table. Per research decision R7, this is the responsibility of `lan.js` (not `otp.js`).

Key behaviors:

- `linked_by` is always `'otp_lan'` — distinguishes LAN-linked devices from server-linked ones (`'otp_server'` in Phase 7.4).
- Uses `ON CONFLICT ... DO UPDATE` so that a previously revoked device can re-link by entering a new OTP — the row is updated to `status = 'active'` and `revoked_at` is cleared.
- `platform` is read from `process.platform` (the admin device's OS, which is where the HTTP server runs — but the `deviceHash` and `deviceName` come from the joining device's request, so this records the **joining device's** identity but the **admin device's** platform. This is acceptable since `os_platform` is informational only).

**Correction note**: The `platform` should ideally come from the joining device. However, the HTTP POST body only contains `massar`, `otp`, `deviceHash`, and `deviceName` — not `platform`. Since `os_platform` is informational only and the app currently only runs on Windows, using `process.platform` is fine for now. If multi-platform support is added later, the POST body can be extended.

**Acceptance check**: After calling `registerLinkedDevice(db, 'abc123hash', 'PC-NEW-01')`, querying `SELECT * FROM linked_devices WHERE device_hash = 'abc123hash'` returns a row with `linked_by = 'otp_lan'`, `status = 'active'`.

---

**Details for T005**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `registerLinkedDevice`:

```js
function sendJsonResponse(res, statusCode, body) {
    const payload = JSON.stringify(body);
    res.writeHead(statusCode, {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload)
    });
    res.end(payload);
}
```

**What this does**: Sends an HTTP JSON response with the correct headers. Used by the HTTP request handler to send both success and error responses. Sets `Content-Type` to `application/json` and `Content-Length` for proper framing.

**Acceptance check**: This is a trivial helper — it will be exercised by the HTTP request handler in T008.

---

**Details for T006**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `sendJsonResponse`:

```js
function collectRequestBody(req, maxBytes) {
    return new Promise((resolve, reject) => {
        const chunks = [];
        let totalBytes = 0;

        req.on('data', (chunk) => {
            totalBytes += chunk.length;
            if (totalBytes > maxBytes) {
                req.destroy();
                reject(new Error('REQUEST_TOO_LARGE'));
                return;
            }
            chunks.push(chunk);
        });

        req.on('end', () => {
            resolve(Buffer.concat(chunks).toString('utf8'));
        });

        req.on('error', (err) => {
            reject(err);
        });
    });
}
```

**What this does**: Collects the incoming HTTP request body into a string, enforcing a maximum size limit. If the body exceeds `maxBytes` (4096 bytes per research decision R6), the request stream is destroyed and the promise rejects with `'REQUEST_TOO_LARGE'`. This prevents memory abuse from malicious or buggy clients on the LAN.

**Acceptance check**: This is exercised by the HTTP request handler in T008. When a request body exceeds 4096 bytes, the promise rejects with an Error whose message is `'REQUEST_TOO_LARGE'`.

**Checkpoint**: Foundation ready — all internal helpers are in place. User story implementation can now begin.

---

## Phase 3: User Story 1 — Admin Starts LAN Linking Service (Priority: P1) 🎯 MVP

**Goal**: When an admin generates an OTP, the system starts a UDP broadcast beacon and an HTTP verification server. Both auto-stop when the OTP expires or is consumed.

**Independent Test**: Call `startLinkingServer(db)` after generating an OTP via `generateOtp()`. Verify:

1. Return value has `{ port: 19876, address: '0.0.0.0' }`
2. A UDP broadcast is being sent every 3 seconds on port 19877
3. An HTTP server responds on port 19876
4. After calling `stopLinkingServer()`, both ports are released

- [x] T007 [US1] Implement `stopLinkingServer()` function in `main/linking/lan.js`
- [x] T008 [US1] Implement internal `handleVerifyRequest(req, res)` HTTP handler in `main/linking/lan.js`
- [x] T009 [US1] Implement `startLinkingServer(db)` function in `main/linking/lan.js`

**Important**: T007 must be implemented BEFORE T009 because `startLinkingServer` calls `stopLinkingServer` internally (to stop any previous session).

**Details for T007**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER the `collectRequestBody` function (i.e., after all internal helpers):

```js
function stopLinkingServer() {
    // 1. Clear the beacon broadcast interval
    if (broadcastTimer) {
        clearInterval(broadcastTimer);
        broadcastTimer = null;
    }

    // 2. Clear the OTP expiry timeout
    if (expiryTimer) {
        clearTimeout(expiryTimer);
        expiryTimer = null;
    }

    // 3. Close the UDP socket
    if (udpSocket) {
        try {
            udpSocket.close();
        } catch (_) {
            // Socket may already be closed — ignore
        }
        udpSocket = null;
    }

    // 4. Close the HTTP server
    if (httpServer) {
        try {
            httpServer.close();
        } catch (_) {
            // Server may already be closed — ignore
        }
        httpServer = null;
    }

    // 5. Reset module state
    activeMassar = null;
    activeDb = null;
}
```

**What this does**: Stops all active networking services and resets module state. Safe to call even when no server is running (every section is guarded by a null check). This is the single cleanup function called by:

- `startLinkingServer()` — to stop a previous session before starting a new one
- The OTP expiry timeout — when the OTP's TTL elapses
- The verification handler — after an OTP is successfully consumed
- Application shutdown — via the IPC layer (Phase 7.6)

The `try/catch` blocks around `close()` calls ensure the function never throws, even if sockets are already in a bad state.

**Acceptance check**: After calling `stopLinkingServer()`, all module state variables (`httpServer`, `udpSocket`, `broadcastTimer`, `expiryTimer`, `activeMassar`, `activeDb`) are `null`. Calling it again is a no-op (no errors).

---

**Details for T008**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `stopLinkingServer`:

```js
async function handleVerifyRequest(req, res) {
    // 1. Only accept POST /verify-link
    if (req.method !== 'POST' || req.url !== '/verify-link') {
        sendJsonResponse(res, 404, { success: false, error: 'NOT_FOUND' });
        return;
    }

    // 2. Collect request body with size limit
    let rawBody;
    try {
        rawBody = await collectRequestBody(req, MAX_REQUEST_BODY_BYTES);
    } catch (err) {
        if (err.message === 'REQUEST_TOO_LARGE') {
            sendJsonResponse(res, 413, { success: false, error: 'REQUEST_TOO_LARGE' });
        } else {
            sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        }
        return;
    }

    // 3. Parse JSON
    let body;
    try {
        body = JSON.parse(rawBody);
    } catch (_) {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
    }

    // 4. Validate required fields
    const { massar, otp, deviceHash, deviceName } = body;
    if (
        !massar ||
        typeof massar !== 'string' ||
        !otp ||
        typeof otp !== 'string' ||
        !deviceHash ||
        typeof deviceHash !== 'string' ||
        !deviceName ||
        typeof deviceName !== 'string'
    ) {
        sendJsonResponse(res, 400, { success: false, error: 'INVALID_REQUEST' });
        return;
    }

    // 5. Check MASSAR code matches the active linking session
    const validation = validateMassarCode(massar);
    if (!validation.valid || validation.normalized !== activeMassar) {
        sendJsonResponse(res, 403, { success: false, error: 'MASSAR_MISMATCH' });
        return;
    }

    // 6. Verify OTP using Phase 7.2 module
    const result = verifyOtp(activeDb, validation.normalized, otp, deviceHash.trim());

    if (!result.valid) {
        // Map OTP errors to HTTP status codes
        const statusMap = {
            RATE_LIMITED: 429,
            NO_ACTIVE_OTP: 400,
            OTP_EXPIRED: 400,
            INVALID_OTP: 401
        };
        const status = statusMap[result.error] || 400;
        sendJsonResponse(res, status, { success: false, error: result.error });
        return;
    }

    // 7. OTP valid — register the joining device
    registerLinkedDevice(activeDb, deviceHash.trim(), deviceName.trim());

    // 8. Build and send the success payload
    const payload = buildSuccessPayload(activeDb);
    sendJsonResponse(res, 200, {
        success: true,
        syncConfig: payload.syncConfig,
        institution: payload.institution,
        users: payload.users
    });

    // 9. OTP is consumed — schedule server stop (next tick to let response flush)
    setImmediate(() => {
        stopLinkingServer();
    });
}
```

**What this does step by step**:

1. **Route check**: Only `POST /verify-link` is accepted. All other method/path combinations get 404.
2. **Body collection**: Reads the request body up to 4KB. Rejects oversized bodies with 413.
3. **JSON parsing**: Attempts to parse the body as JSON. Returns 400 if malformed.
4. **Field validation**: Checks that `massar`, `otp`, `deviceHash`, and `deviceName` are all present and strings. Returns 400 if any are missing.
5. **MASSAR match**: Validates the submitted MASSAR code format and checks it matches the active linking session's MASSAR code. Returns 403 if mismatched.
6. **OTP verification**: Delegates to `verifyOtp()` from Phase 7.2. This handles rate limiting (5 attempts/10 min), expiry checks, and scrypt hash comparison. Maps each error code to an appropriate HTTP status.
7. **Device registration**: On success, inserts the joining device into `linked_devices` with `linked_by = 'otp_lan'`.
8. **Success response**: Reads `sync_config`, `institution_config`, and `users` tables and returns the combined payload.
9. **Auto-stop**: Schedules `stopLinkingServer()` on the next tick, giving the HTTP response time to flush. The OTP is now consumed (marked `used` by `verifyOtp`), so the linking session is complete.

**HTTP status codes used**:

| Status | Error Code          | Meaning                                           |
| ------ | ------------------- | ------------------------------------------------- |
| 200    | —                   | Successful verification                           |
| 400    | `INVALID_REQUEST`   | Malformed JSON, missing fields, or expired/no OTP |
| 401    | `INVALID_OTP`       | OTP code doesn't match                            |
| 403    | `MASSAR_MISMATCH`   | MASSAR code doesn't match active session          |
| 404    | `NOT_FOUND`         | Unknown endpoint                                  |
| 413    | `REQUEST_TOO_LARGE` | Body exceeds 4KB                                  |
| 429    | `RATE_LIMITED`      | Too many failed attempts                          |

**Acceptance check**: This function is exercised by `startLinkingServer` (T009) which passes it as the HTTP request handler. It will be testable once the server is running.

---

**Details for T009**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `handleVerifyRequest`:

```js
function startLinkingServer(db) {
    // 1. Stop any previous session
    stopLinkingServer();

    // 2. Check for an active OTP in the database
    // We need to find the MASSAR code from institution_config
    const instRow = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get();
    if (!instRow || !instRow.massar_code) {
        throw new Error('No institution configured — cannot start linking server');
    }

    const validation = validateMassarCode(instRow.massar_code);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code in institution_config');
    }
    const massarCode = validation.normalized;

    // 3. Verify an active OTP exists for this MASSAR code
    const otpStatus = getActiveOtp(db, massarCode);
    if (!otpStatus.active) {
        throw new Error('No active OTP — generate an OTP before starting the linking server');
    }

    // 4. Store references in module state
    activeMassar = massarCode;
    activeDb = db;

    // 5. Create and start the HTTP verification server
    httpServer = http.createServer((req, res) => {
        handleVerifyRequest(req, res).catch((err) => {
            try {
                sendJsonResponse(res, 500, { success: false, error: 'INTERNAL_ERROR' });
            } catch (_) {
                // Response may already be sent — ignore
            }
        });
    });

    httpServer.listen(HTTP_SERVER_PORT, '0.0.0.0');

    // 6. Create the UDP broadcast socket
    udpSocket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    udpSocket.bind(0, () => {
        udpSocket.setBroadcast(true);
    });

    // 7. Start broadcasting beacon every 3 seconds
    const beaconBuffer = buildBeaconMessage(massarCode, HTTP_SERVER_PORT);
    broadcastTimer = setInterval(() => {
        try {
            udpSocket.send(beaconBuffer, 0, beaconBuffer.length, UDP_BROADCAST_PORT, '255.255.255.255');
        } catch (_) {
            // Socket may have been closed — ignore
        }
    }, BEACON_INTERVAL_MS);

    // 8. Schedule auto-stop when OTP expires
    const remainingMs = otpStatus.remainingSeconds * 1000;
    expiryTimer = setTimeout(() => {
        stopLinkingServer();
    }, remainingMs);

    return { port: HTTP_SERVER_PORT, address: '0.0.0.0' };
}
```

**What this does step by step**:

1. **Stop previous**: Calls `stopLinkingServer()` to ensure no previous session is running (FR-011).
2. **Read MASSAR code**: Queries `institution_config` for the school's MASSAR code. Throws if not configured.
3. **Validate MASSAR**: Normalizes the MASSAR code using the Phase 7.2 validator.
4. **Check active OTP**: Calls `getActiveOtp()` from Phase 7.2 to verify an OTP exists and is not expired. Throws if no active OTP — the caller must generate one first via `generateOtp()`.
5. **Store state**: Saves `activeMassar` and `activeDb` in module-level variables so the HTTP handler can access them.
6. **HTTP server**: Creates an HTTP server with `handleVerifyRequest` as the request handler. Listens on port 19876 on all interfaces (`0.0.0.0`). Catches unhandled promise rejections from the async handler and returns 500.
7. **UDP socket**: Creates a UDP4 socket with `reuseAddr: true` for robustness. Binds to an ephemeral port (port 0 — we're sending, not listening). Enables broadcast mode via `setBroadcast(true)`.
8. **Beacon broadcast**: Sends the pre-built beacon Buffer to `255.255.255.255:19877` every 3 seconds using `setInterval`. The `try/catch` prevents errors if the socket is closed between intervals.
9. **OTP expiry auto-stop**: Calculates the remaining OTP lifetime in milliseconds and schedules `stopLinkingServer()` via `setTimeout`. This ensures cleanup even if no verification attempt arrives (R4).
10. **Return value**: Returns the HTTP server's port and address for the caller to display.

**Key design decisions**:

- The UDP socket binds to port 0 (ephemeral) because it is SENDING broadcasts, not LISTENING. The listening port 19877 is the DESTINATION of the broadcast.
- `reuseAddr: true` allows re-binding quickly after a previous session.
- The beacon buffer is pre-built once and reused every 3 seconds — no per-tick JSON serialization.

**Acceptance check**:

1. Generate an OTP: `generateOtp(db, 'M320456', 'adminDeviceHash')`
2. Call `startLinkingServer(db)` — should return `{ port: 19876, address: '0.0.0.0' }`
3. The HTTP server should respond to requests at `http://localhost:19876/verify-link`
4. UDP beacons should appear on port 19877
5. Call `stopLinkingServer()` — both services stop, ports are released

**Checkpoint**: `startLinkingServer` and `stopLinkingServer` work. The admin can start and stop the linking service. This is the MVP — the server-side infrastructure is in place.

---

## Phase 4: User Story 2 — New Device Discovers Admin on LAN (Priority: P1)

**Goal**: A joining device can scan the local network for admin devices broadcasting a specific MASSAR code, receiving their IP address, HTTP port, and device name.

**Independent Test**: Start the linking server on Device 1, then call `discoverLanDevices('M320456', 5000)` on Device 2 (same network). Verify:

1. Returns an array with at least one entry: `[{ ip: '...', port: 19876, deviceName: '...' }]`
2. Calling with a non-matching MASSAR code returns `[]`
3. Calling with no server running returns `[]` after timeout

**Depends on**: Phase 3 (US1) must be complete because discovery needs a server to be broadcasting.

- [x] T010 [US2] Implement `discoverLanDevices(massarCode, timeoutMs)` function in `main/linking/lan.js`

**Details for T010**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `startLinkingServer`:

```js
function discoverLanDevices(massarCode, timeoutMs) {
    // 1. Validate MASSAR code
    const validation = validateMassarCode(massarCode);
    if (!validation.valid) {
        throw new Error('Invalid MASSAR code format');
    }
    const normalizedMassar = validation.normalized;

    const timeout = typeof timeoutMs === 'number' && timeoutMs > 0 ? timeoutMs : DEFAULT_DISCOVERY_TIMEOUT_MS;

    return new Promise((resolve, reject) => {
        const discovered = new Map(); // ip → { ip, port, deviceName } — deduplicates by IP

        let socket;
        try {
            socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
        } catch (err) {
            reject(new Error('Failed to create UDP socket for discovery: ' + err.message));
            return;
        }

        // Timeout: resolve with whatever we've found so far
        const timer = setTimeout(() => {
            try {
                socket.close();
            } catch (_) {
                // ignore
            }
            resolve(Array.from(discovered.values()));
        }, timeout);

        socket.on('error', (err) => {
            clearTimeout(timer);
            try {
                socket.close();
            } catch (_) {
                // ignore
            }
            reject(new Error('Discovery socket error: ' + err.message));
        });

        socket.on('message', (msg, rinfo) => {
            // Parse the beacon message
            let beacon;
            try {
                beacon = JSON.parse(msg.toString('utf8'));
            } catch (_) {
                return; // Ignore malformed messages silently
            }

            // Validate beacon structure
            if (
                beacon.service !== BEACON_SERVICE_ID ||
                typeof beacon.massar !== 'string' ||
                typeof beacon.port !== 'number' ||
                typeof beacon.deviceName !== 'string'
            ) {
                return; // Ignore invalid beacons silently
            }

            // Filter by MASSAR code (case-insensitive)
            if (beacon.massar.toUpperCase() !== normalizedMassar) {
                return; // Not our school — ignore
            }

            // Deduplicate by source IP
            if (!discovered.has(rinfo.address)) {
                discovered.set(rinfo.address, {
                    ip: rinfo.address,
                    port: beacon.port,
                    deviceName: beacon.deviceName
                });
            }
        });

        // Bind to the broadcast port to receive beacons
        socket.bind(UDP_BROADCAST_PORT, () => {
            // Socket is now listening for broadcast messages
        });
    });
}
```

**What this does step by step**:

1. **Validate input**: Checks the MASSAR code format using `validateMassarCode()`. Throws if invalid.
2. **Set timeout**: Uses the provided timeout or defaults to 5000ms (5 seconds).
3. **Create UDP socket**: Creates a UDP4 socket with `reuseAddr: true`. This socket LISTENS on the broadcast port 19877 — the opposite of the beacon sender which SENDS to port 19877.
4. **Timeout handler**: When the timeout expires, closes the socket and resolves the promise with all discovered devices (may be empty).
5. **Error handler**: If the socket encounters an error (e.g., port unavailable), cleans up and rejects.
6. **Message handler**: For each received UDP datagram:
    - Attempts to parse as JSON — silently ignores malformed messages
    - Validates the beacon structure (must have `service`, `massar`, `port`, `deviceName`)
    - Checks the `service` field equals `"pencil2-link"` — filters out unrelated UDP traffic
    - Compares the beacon's MASSAR code against the target (case-insensitive)
    - If it matches, adds to the `discovered` Map keyed by source IP — deduplicates multiple beacons from the same device
7. **Bind**: Binds to `UDP_BROADCAST_PORT` (19877) to receive broadcast messages.

**Key design decisions**:

- Uses a `Map` for deduplication: since beacons are sent every 3 seconds, the same device will be heard multiple times during the timeout window.
- The promise **always resolves** — it never rejects for timeout. An empty array means no matching devices were found (SC-001).
- Malformed beacons and non-matching MASSAR codes are silently ignored — no logging, no errors. This is intentional since the LAN may have other UDP traffic.

**Acceptance check**:

1. Start a linking server on one machine (via T009)
2. On another machine on the same network, call `discoverLanDevices('M320456', 5000)`
3. Should resolve within 5 seconds with `[{ ip: '192.168.x.x', port: 19876, deviceName: 'PC-ADMIN-01' }]`
4. Calling with `'M999999'` should resolve with `[]` (no match)

**Checkpoint**: Discovery works. A new device can find the admin device on the LAN.

---

## Phase 5: User Story 3 — New Device Verifies OTP via LAN (Priority: P1)

**Goal**: A joining device can send an OTP to the discovered admin device via HTTP and receive sync configuration + user accounts on success.

**Independent Test**: Start the linking server, discover it, then call `verifyViaLan(ip, port, 'M320456', '482961', deviceHash, deviceName)`. Verify:

1. On correct OTP: returns `{ success: true, syncConfig: {...}, institution: {...}, users: [...] }`
2. On wrong OTP: returns `{ success: false, error: 'INVALID_OTP' }`
3. After success, the device appears in the `linked_devices` table

**Depends on**: Phase 4 (US2) must be complete for the full integration flow, but the function itself only requires a running HTTP server (Phase 3).

- [x] T011 [US3] Implement `verifyViaLan(targetIp, targetPort, massar, otp, deviceHash, deviceName)` function in `main/linking/lan.js`

**Details for T011**:

Add this function to `main/linking/lan.js`, ABOVE the `module.exports` block, AFTER `discoverLanDevices`:

```js
function verifyViaLan(targetIp, targetPort, massar, otp, deviceHash, deviceName) {
    return new Promise((resolve, reject) => {
        // 1. Build the request body
        const bodyObj = {
            massar: massar,
            otp: otp,
            deviceHash: deviceHash,
            deviceName: deviceName
        };
        const bodyStr = JSON.stringify(bodyObj);

        // 2. Configure the HTTP request
        const options = {
            hostname: targetIp,
            port: targetPort,
            path: '/verify-link',
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Content-Length': Buffer.byteLength(bodyStr)
            },
            timeout: HTTP_CLIENT_TIMEOUT_MS
        };

        // 3. Send the request
        const req = http.request(options, (res) => {
            const chunks = [];
            res.on('data', (chunk) => chunks.push(chunk));
            res.on('end', () => {
                const raw = Buffer.concat(chunks).toString('utf8');
                try {
                    const parsed = JSON.parse(raw);
                    resolve(parsed);
                } catch (_) {
                    reject(new Error('Invalid JSON response from admin device'));
                }
            });
        });

        req.on('timeout', () => {
            req.destroy();
            reject(new Error('Connection to admin device timed out'));
        });

        req.on('error', (err) => {
            reject(new Error('Failed to connect to admin device: ' + err.message));
        });

        req.write(bodyStr);
        req.end();
    });
}
```

**What this does step by step**:

1. **Build body**: Creates the JSON request body with the 4 required fields: `massar`, `otp`, `deviceHash`, `deviceName`.
2. **Configure request**: Sets up an HTTP POST to `http://<targetIp>:<targetPort>/verify-link` with JSON content type and a 10-second timeout.
3. **Send request**: Writes the body and ends the request.
4. **Handle response**: Collects the response body chunks, concatenates them, and parses as JSON. Resolves the promise with the parsed response object.
5. **Handle timeout**: If the connection takes longer than 10 seconds, destroys the request and rejects.
6. **Handle errors**: If the connection fails (admin device unreachable, refused, etc.), rejects with a descriptive error.

**Return values** (resolved promise — these come from the admin's HTTP handler in T008):

- Success: `{ success: true, syncConfig: {...}, institution: {...}, users: [...] }`
- Wrong OTP: `{ success: false, error: 'INVALID_OTP' }`
- Rate limited: `{ success: false, error: 'RATE_LIMITED' }`
- MASSAR mismatch: `{ success: false, error: 'MASSAR_MISMATCH' }`
- No active OTP: `{ success: false, error: 'NO_ACTIVE_OTP' }`
- OTP expired: `{ success: false, error: 'OTP_EXPIRED' }`

**Rejection** (thrown Error — network-level failures):

- `'Connection to admin device timed out'` — 10-second timeout elapsed
- `'Failed to connect to admin device: ...'` — connection refused, unreachable, etc.
- `'Invalid JSON response from admin device'` — response wasn't valid JSON

The caller (Phase 7.6 IPC layer or Phase 7.5 setup page) can distinguish between:

- **Application errors** (resolved promise with `success: false`) — show the error to the user
- **Network errors** (rejected promise) — fall back to server-based verification (Phase 7.4)

**Acceptance check**:

1. Start a linking server with a known OTP
2. Call `verifyViaLan('127.0.0.1', 19876, 'M320456', '<correct-otp>', 'abc123hash', 'PC-NEW-01')`
3. Should resolve with `{ success: true, syncConfig: {...}, institution: {...}, users: [...] }`
4. Calling with a wrong OTP should resolve with `{ success: false, error: 'INVALID_OTP' }`

**Checkpoint**: Full LAN linking flow works end-to-end: admin starts server → new device discovers → new device verifies OTP → receives config + users.

---

## Phase 6: User Story 4 — Linking Server Lifecycle Management (Priority: P2)

**Goal**: The system manages server lifecycle to prevent resource leaks and port conflicts.

**No new tasks needed** — lifecycle management was implemented as part of earlier tasks:

1. **Single instance** (FR-011): `startLinkingServer()` calls `stopLinkingServer()` as its very first step (T009, line: "Stop any previous session"). Starting a new session always stops the old one.

2. **Auto-stop on OTP expiry** (FR-002): `startLinkingServer()` schedules a `setTimeout` aligned to the OTP's remaining lifetime (T009, line: "Schedule auto-stop when OTP expires"). When it fires, `stopLinkingServer()` is called.

3. **Auto-stop on OTP consumption**: `handleVerifyRequest()` calls `stopLinkingServer()` via `setImmediate()` after a successful verification (T008, line: "OTP is consumed — schedule server stop").

4. **Graceful cleanup** (FR-012): `stopLinkingServer()` closes all sockets, clears all timers, and resets all state variables (T007). Every `close()` call is wrapped in `try/catch` for robustness.

5. **Port conflict detection**: If the HTTP port is already in use, `httpServer.listen()` will emit an `error` event. If the UDP socket fails to create, the `dgram.createSocket()` call throws. Both surface clear errors to the caller.

**Verification**: The following behavior is already in place from T007 + T008 + T009:

- `stopLinkingServer()` is called at the start of `startLinkingServer()` — prevents duplicate servers
- `expiryTimer` fires `stopLinkingServer()` — prevents stale servers after OTP expires
- `handleVerifyRequest` calls `stopLinkingServer()` after success — prevents stale servers after OTP is consumed
- `stopLinkingServer()` is a no-op when no server is running — safe to call at any time
- All `close()` calls use `try/catch` — never throws even if sockets are already closed

**Checkpoint**: Lifecycle management is fully integrated. No additional code needed.

---

## Phase 7: Polish & Verification

**Purpose**: Final validation that the complete module passes linting, smoke tests, and follows project conventions.

- [x] T012 Verify the complete `main/linking/lan.js` file passes `npm run lint`
- [x] T013 Verify `npm run test:smoke` passes (no IPC changes, so channel parity should be unaffected)
- [x] T014 Verify the final `module.exports` block exports exactly 4 functions in `main/linking/lan.js`

**Details for T012**:

Run `npm run lint` from the repository root. The file `main/linking/lan.js` must pass with zero errors.

Common issues to check for:

- No unused variables — all internal helpers (`buildBeaconMessage`, `buildSuccessPayload`, `registerLinkedDevice`, `sendJsonResponse`, `collectRequestBody`) are used by the exported functions
- The `dgram`, `http`, and `os` imports are all used
- The imports from `./otp` are all used (`verifyOtp` in handler, `getActiveOtp` in startServer, `validateMassarCode` in handler + discovery)
- Single quotes, no trailing commas, 4-space indent, semicolons (Prettier style)
- No `console.log` statements (this module should not log)
- The `async` keyword on `handleVerifyRequest` is needed (it uses `await collectRequestBody`)

If lint fails, fix the issues in `main/linking/lan.js` before proceeding.

---

**Details for T013**:

Run `npm run test:smoke` from the repository root. This module has NO IPC handlers (those are Phase 7.6), so the smoke test's channel parity check should be unaffected — the `preload.js` and `main/ipc/*.js` files are not modified.

If smoke tests fail, investigate — it should NOT be caused by this module. The `linked_devices`, `institution_config`, and `device_otp` tables already exist from Phase 7.1, so schema checks should pass.

---

**Details for T014**:

Verify the `module.exports` block at the bottom of `main/linking/lan.js` exports exactly these 4 functions:

```js
module.exports = {
    startLinkingServer,
    stopLinkingServer,
    discoverLanDevices,
    verifyViaLan
};
```

The internal helpers (`buildBeaconMessage`, `buildSuccessPayload`, `registerLinkedDevice`, `sendJsonResponse`, `collectRequestBody`, `handleVerifyRequest`) must NOT be exported. They are private to the module.

**Checkpoint**: Module is complete, lint-clean, and ready for integration by Phase 7.6 (IPC handlers).

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 — BLOCKS all user stories
- **US1 — Start/Stop Server (Phase 3)**: Depends on Phase 2 — this is the MVP
- **US2 — Discovery (Phase 4)**: Depends on Phase 3 (needs a running server to discover)
- **US3 — Verify via LAN (Phase 5)**: Depends on Phase 3 (needs a running server to send requests to)
- **US4 — Lifecycle (Phase 6)**: Already done in T007 + T008 + T009 — just a verification checkpoint
- **Polish (Phase 7)**: Depends on ALL phases complete

### User Story Dependencies

- **US1 (P1)**: Depends on Foundational (Phase 2) only — implements `startLinkingServer` and `stopLinkingServer`
- **US2 (P1)**: Depends on US1 — `discoverLanDevices` is useful only if a server is broadcasting
- **US3 (P1)**: Depends on US1 — `verifyViaLan` is useful only if a server is listening
- **US4 (P2)**: No additional tasks — already integrated into US1

### Within the Module

Since this is a single file, tasks are mostly sequential. However:

- T010 (`discoverLanDevices`) and T011 (`verifyViaLan`) are independent of each other — they only depend on the server being implemented (Phase 3)

### Parallel Opportunities

```
Phase 2 complete (T002–T006)
    │
    ▼
Phase 3: T007 ──► T008 ──► T009  (sequential — stopServer → handler → startServer)
    │
    ▼
Phase 3 complete
    ├── T010 (discoverLanDevices)  [can run in parallel with T011]
    └── T011 (verifyViaLan)        [can run in parallel with T010]
```

---

## Parallel Example: After Phase 3

```text
# These can run in parallel after Phase 3 is complete:
Task T010: [US2] Implement discoverLanDevices function
Task T011: [US3] Implement verifyViaLan function

# These are sequential within Phase 3:
Task T007: [US1] Implement stopLinkingServer (needed by startLinkingServer)
Task T008: [US1] Implement handleVerifyRequest (needed by startLinkingServer)
Task T009: [US1] Implement startLinkingServer (main entry point)
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1: Setup (T001)
2. Complete Phase 2: Foundational (T002, T003, T004, T005, T006)
3. Complete Phase 3: US1 — startLinkingServer + stopLinkingServer (T007, T008, T009)
4. **STOP and VALIDATE**: The server starts, broadcasts beacons, accepts POST requests, and auto-stops on expiry
5. Run lint + smoke (T012, T013)

### Full Delivery

1. Setup + Foundational → T001–T006
2. US1 (start/stop server) → T007, T008, T009 — **Server infrastructure complete**
3. US2 (discovery) → T010
4. US3 (verify via LAN) → T011 — **Full LAN linking flow complete**
5. Polish → T012, T013, T014

### Single-File Strategy

Since all tasks modify the same file (`main/linking/lan.js`), the recommended approach is:

1. Create the file skeleton with constants, requires, state, and exports (T001)
2. Add internal helper functions (T002–T006)
3. Add `stopLinkingServer` (T007)
4. Add `handleVerifyRequest` (T008)
5. Add `startLinkingServer` (T009)
6. Add `discoverLanDevices` (T010)
7. Add `verifyViaLan` (T011)
8. Run lint after each function to catch issues early
9. Final lint + smoke after all functions are in place

---

## Complete File Reference

When all tasks are complete, `main/linking/lan.js` should contain, in order:

1. `'use strict'` directive — from T001
2. `require` statements (`dgram`, `http`, `os`, `./otp`) — from T001
3. Constants (`UDP_BROADCAST_PORT`, `HTTP_SERVER_PORT`, `BEACON_INTERVAL_MS`, `BEACON_SERVICE_ID`, `MAX_REQUEST_BODY_BYTES`, `HTTP_CLIENT_TIMEOUT_MS`, `DEFAULT_DISCOVERY_TIMEOUT_MS`) — from T001
4. Module state variables (`httpServer`, `udpSocket`, `broadcastTimer`, `expiryTimer`, `activeMassar`, `activeDb`) — from T001
5. `buildBeaconMessage()` — from T002 (NOT exported)
6. `buildSuccessPayload()` — from T003 (NOT exported)
7. `registerLinkedDevice()` — from T004 (NOT exported)
8. `sendJsonResponse()` — from T005 (NOT exported)
9. `collectRequestBody()` — from T006 (NOT exported)
10. `stopLinkingServer()` — from T007 (EXPORTED)
11. `handleVerifyRequest()` — from T008 (NOT exported)
12. `startLinkingServer()` — from T009 (EXPORTED)
13. `discoverLanDevices()` — from T010 (EXPORTED)
14. `verifyViaLan()` — from T011 (EXPORTED)
15. `module.exports` block — from T001

Total: ~300–350 lines, single file, no new dependencies.

---

## Notes

- All code uses single quotes, no trailing commas, 4-space indent, semicolons (Prettier config)
- Database column names are snake_case (`massar_code`, `device_hash`, `linked_by`)
- Function names are camelCase (`startLinkingServer`, `discoverLanDevices`)
- The `linked_devices`, `institution_config`, `device_otp`, `sync_config`, and `users` tables already exist — do NOT create them or modify `main/db/schema.js`
- This module has NO IPC handlers — do NOT modify `preload.js`, `main/ipc/registerAll.js`, or create `main/ipc/linking.js` (that is Phase 7.6)
- The `os` import is used only for `os.hostname()` in beacon messages
- All networking uses Node.js built-ins (`dgram`, `http`) — no npm dependencies added
- The module state variables are reset to `null` by `stopLinkingServer()` — they should never be accessed without a null check

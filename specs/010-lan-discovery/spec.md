# Feature Specification: LAN Discovery & Verification

**Feature Branch**: `010-lan-discovery`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Phase 7.3: LAN Discovery & Verification - Create a new file main/linking/lan.js that implements LAN-based device discovery and OTP verification for linking devices within the same local network. This includes: 1) UDP Broadcast Discovery on port 19877 - admin device sends beacon every 3s with service info, stops when OTP expires/consumed. 2) HTTP Verification Server on port 19876 - POST /verify-link endpoint that validates OTP and returns sync config + user accounts on success. 3) UDP Listener (Client) on Device 2 - listens for broadcast beacons, filters by MASSAR code. Functions: startLinkingServer(db), stopLinkingServer(), discoverLanDevices(massarCode, timeoutMs), verifyViaLan(targetIp, targetPort, massar, otp, deviceHash, deviceName). Uses built-in Node.js dgram + http modules only."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Starts LAN Linking Service (Priority: P1)

A school administrator generates an OTP code for device linking (via Phase 7.2). The system automatically starts broadcasting the school's presence on the local network and begins listening for incoming link requests from other devices. The admin sees the OTP code displayed and knows the school network is ready to accept new devices.

**Why this priority**: This is the foundational capability — without the admin-side server running, no LAN-based linking is possible. It enables all other stories.

**Independent Test**: Can be tested by starting the linking server and confirming a UDP beacon is being broadcast on the local network and the HTTP verification endpoint is responding.

**Acceptance Scenarios**:

1. **Given** an admin has generated an OTP for a MASSAR code, **When** the linking server starts, **Then** the system begins broadcasting UDP beacons every 3 seconds containing the MASSAR code and HTTP server port, and starts an HTTP server ready to accept verification requests.
2. **Given** the linking server is running, **When** the OTP expires or is consumed, **Then** both the UDP broadcast and HTTP server stop automatically and release their ports.
3. **Given** the linking server is running, **When** the admin cancels the OTP, **Then** both services stop immediately and release their ports.

---

### User Story 2 - New Device Discovers Admin on LAN (Priority: P1)

A staff member setting up a new school device enters the school's MASSAR code on the setup screen. The system automatically scans the local network for a device that is broadcasting a linking beacon for that MASSAR code. Within seconds, the new device discovers the admin's device and displays its name, confirming they are on the same network.

**Why this priority**: Discovery is the critical first step of the linking flow — the new device must find the admin device before any verification can occur. Equal priority to Story 1 as both are essential.

**Independent Test**: Can be tested by running a beacon broadcaster on one device and confirming a listener on a second device on the same network discovers it and returns the correct MASSAR code, IP address, and device name.

**Acceptance Scenarios**:

1. **Given** an admin device is broadcasting a linking beacon for MASSAR code "M320456", **When** a new device on the same network listens for beacons matching "M320456", **Then** the new device discovers the admin device within 5 seconds and receives its IP address, HTTP port, and device name.
2. **Given** an admin device is broadcasting for MASSAR code "M320456", **When** a new device listens for a different MASSAR code "M999999", **Then** the new device does not match any beacons and reports no devices found after the timeout.
3. **Given** no admin device is broadcasting on the network, **When** a new device listens for any MASSAR code, **Then** the discovery times out gracefully and returns an empty result.
4. **Given** multiple admin devices on the same network are broadcasting for the same MASSAR code, **When** a new device listens, **Then** the new device discovers all matching devices and returns a list.

---

### User Story 3 - New Device Verifies OTP via LAN (Priority: P1)

After discovering the admin device on the local network, the staff member enters the 6-digit OTP code. The new device sends the OTP to the admin device over the local network for verification. On success, the admin device responds with the school's sync configuration and user accounts, and the new device is automatically registered as a linked device. No internet connection is required.

**Why this priority**: This completes the LAN linking flow — without verification, discovery alone provides no value. This is the core value proposition of LAN-based linking (fast, offline-capable).

**Independent Test**: Can be tested by running the linking server, sending a valid OTP via HTTP POST, and confirming the response contains sync configuration data and that the requesting device is registered.

**Acceptance Scenarios**:

1. **Given** the linking server is running and an active OTP exists for MASSAR code "M320456", **When** a new device sends the correct OTP along with its device hash and name, **Then** the server responds with success, the sync configuration payload, user accounts for import, and the new device is recorded in the linked devices registry.
2. **Given** the linking server is running, **When** a new device sends an incorrect OTP, **Then** the server responds with a failure message and does not register the device or share any configuration data.
3. **Given** the linking server is running, **When** a new device sends an OTP for a different MASSAR code than the one being broadcast, **Then** the server responds with an error indicating a MASSAR code mismatch.
4. **Given** the linking server is running, **When** 5 failed OTP attempts have been made within 10 minutes, **Then** subsequent verification attempts are rejected with a rate-limit error, regardless of OTP correctness.

---

### User Story 4 - Linking Server Lifecycle Management (Priority: P2)

The system manages the linking server's lifecycle to prevent resource leaks and port conflicts. Only one linking session can be active at a time. The server cleans up after itself on shutdown, OTP expiry, or application exit.

**Why this priority**: Important for robustness but not part of the core linking flow. A simple implementation could work without lifecycle management for initial testing.

**Independent Test**: Can be tested by starting and stopping the server multiple times, verifying ports are released, and confirming no stale processes or sockets remain.

**Acceptance Scenarios**:

1. **Given** a linking server is already running, **When** a new OTP is generated (new linking session requested), **Then** the existing server is stopped first and a new server starts for the new session.
2. **Given** the linking server is running, **When** the application is shutting down, **Then** the server stops gracefully, closing all sockets and releasing all ports.
3. **Given** the default port is already in use by another application, **When** the linking server attempts to start, **Then** the system reports a clear error indicating the port conflict.

---

### Edge Cases

- What happens when the UDP broadcast port (19877) is blocked by a firewall or antivirus on the admin device? The system should report a clear error to the admin.
- What happens when the HTTP verification port (19876) is blocked or already in use? The system should report the conflict and not silently fail.
- What happens when a device sends a malformed or oversized request to the verification endpoint? The server should reject it safely without crashing.
- What happens when the admin device and new device are on different subnets within the same building? UDP broadcast may not cross subnet boundaries — discovery will time out and the system will fall back to server-based linking (Phase 7.4).
- What happens when the network is extremely slow or lossy? Some beacons may be lost, but the 3-second interval provides redundancy; HTTP verification uses standard timeouts.
- What happens if the linking server crashes mid-verification? The new device should receive a connection error and can retry or fall back to server-based linking.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST broadcast a UDP beacon every 3 seconds on the local network when a linking session is active, containing the service identifier, MASSAR code, HTTP verification port, and admin device name.
- **FR-002**: System MUST stop broadcasting and shut down the HTTP server automatically when the active OTP expires or is consumed.
- **FR-003**: System MUST provide an HTTP endpoint that accepts verification requests containing a MASSAR code, OTP plaintext, device hash, and device name.
- **FR-004**: System MUST validate the submitted OTP against the stored OTP hash using the existing OTP verification infrastructure (Phase 7.2 OTP module).
- **FR-005**: System MUST return the school's sync configuration and user account data upon successful OTP verification.
- **FR-006**: System MUST register the verified device in the linked devices registry with its device hash, name, platform, application version, and linking method ("otp_lan").
- **FR-007**: System MUST reject verification attempts when the submitted MASSAR code does not match the active linking session's MASSAR code.
- **FR-008**: System MUST enforce the existing OTP rate-limiting rules (maximum 5 failed attempts per MASSAR code per 10-minute window).
- **FR-009**: System MUST allow a new device to listen for UDP beacons on the local network and filter results by a specific MASSAR code, returning the IP address, HTTP port, and device name of each matching admin device.
- **FR-010**: System MUST support a configurable timeout for LAN discovery, after which it returns whatever results have been collected (possibly empty).
- **FR-011**: System MUST ensure only one linking server instance runs at a time — starting a new session stops any previous session first.
- **FR-012**: System MUST release all network ports and clean up all sockets when the linking server is stopped, whether by explicit request, OTP expiry, or application shutdown.
- **FR-013**: System MUST reject requests to non-existent HTTP endpoints with an appropriate error response.
- **FR-014**: System MUST reject request bodies that exceed a reasonable size limit to prevent abuse.
- **FR-015**: System MUST use only built-in platform networking capabilities — no external networking dependencies.

### Key Entities

- **Linking Beacon**: A periodic broadcast message advertising a device's availability for linking. Contains: service identifier ("pencil2-link"), MASSAR code, HTTP verification port number, and broadcasting device name.
- **Verification Request**: A request from a new device to verify its OTP and retrieve configuration. Contains: MASSAR code, OTP plaintext, requesting device's hardware hash, and requesting device's name.
- **Verification Response**: The admin device's response to a verification request. On success: sync configuration (server URL, cloud region, license key, sync interval) and user accounts for import. On failure: error description.
- **Linked Device Record**: A registry entry created upon successful verification. Contains: device hash, device name, operating system, application version, linking method, and timestamp.

## Assumptions

- The admin device and the new device are on the same local network and subnet (UDP broadcast does not cross routers/subnets by default).
- Standard networking ports 19876 (HTTP) and 19877 (UDP) are available and not blocked by local firewall/antivirus software on either device.
- The Phase 7.2 OTP module is complete and its verification functions are available for use.
- The database schema for `institution_config`, `device_otp`, and `linked_devices` tables is already in place (Phase 7.1).
- Device identification (hardware fingerprinting) is available from the existing licensing infrastructure.
- The sync configuration and user account data needed for the verification response are accessible from the local database at the time of the request.
- If LAN discovery fails (different subnets, firewall, etc.), the overall system will fall back to server-based OTP verification (Phase 7.4) — this fallback is outside the scope of this specification.

## Dependencies

- **Phase 7.1 (Database Schema)**: The `institution_config`, `device_otp`, and `linked_devices` tables must exist.
- **Phase 7.2 (OTP Module)**: The `verifyOtp()`, `getActiveOtp()`, and `validateMassarCode()` functions must be available from `main/linking/otp.js`.
- **Device Fingerprinting**: The `collectCurrentFingerprint()` function from `main/licensing/deviceFingerprint.js` must be available for identifying devices.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new device on the same local network discovers the admin device within 5 seconds of starting to listen, when the admin is broadcasting.
- **SC-002**: A successful OTP verification over LAN completes (from submission to receiving configuration) within 2 seconds.
- **SC-003**: The linking server starts and begins broadcasting within 1 second of being requested.
- **SC-004**: The linking server releases all ports within 1 second of being stopped (by any trigger: explicit stop, OTP expiry, or OTP consumption).
- **SC-005**: 100% of invalid OTP attempts are rejected without leaking any sync configuration or user account data.
- **SC-006**: The rate-limiting mechanism blocks further attempts after 5 failures within 10 minutes, with zero exceptions.
- **SC-007**: The entire LAN linking flow (discovery + verification + device registration) completes without any internet connectivity.
- **SC-008**: Starting and stopping the linking server 10 consecutive times produces no port conflicts, socket leaks, or residual processes.

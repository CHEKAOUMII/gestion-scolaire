# Research: LAN Discovery & Verification

**Feature**: 010-lan-discovery
**Date**: 2026-03-22
**Status**: Complete

---

## R1: UDP Broadcast vs Multicast for Device Discovery

**Decision**: Use UDP broadcast (`255.255.255.255`) on port 19877.

**Rationale**: UDP broadcast is the simplest approach for single-subnet discovery. It requires no multicast group management, works out-of-the-box on Windows (the target platform), and is supported by Node.js `dgram` with zero configuration. The school network scenario (devices on the same LAN/subnet) maps perfectly to broadcast semantics.

**Alternatives considered**:
- **UDP multicast**: More scalable and can cross subnets with router support, but adds complexity (group join/leave management, IGMP). Overkill for a single-school LAN where all devices share one subnet.
- **mDNS/DNS-SD**: Industry standard for service discovery (Bonjour/Avahi), but requires either a native dependency or reimplementing the protocol. Violates the "no external networking dependencies" requirement (FR-015).
- **TCP scanning**: Scanning IP ranges for open ports. Slow, noisy, triggers security software alerts. Poor user experience.

---

## R2: HTTP Server for Verification vs Raw TCP or UDP

**Decision**: Use Node.js built-in `http` module to serve a single `POST /verify-link` endpoint on port 19876.

**Rationale**: HTTP provides structured request/response semantics, content-type negotiation, and status codes — perfect for a verification handshake that returns a JSON payload. The `http` module is built into Node.js and requires no dependencies. The payload size (sync config + user accounts) fits comfortably in a single HTTP response.

**Alternatives considered**:
- **Raw TCP socket**: Lower overhead but requires custom framing/serialization protocol. No benefit since the payload is JSON and HTTP's overhead is negligible for a single request.
- **UDP request/response**: Unreliable — no delivery guarantee, size limits (64KB per datagram), no built-in request/response correlation. The verification response needs reliable delivery.
- **WebSocket**: Adds bidirectional capability we don't need. The interaction is a single request/response. WebSocket handshake is slower than a direct HTTP POST.

---

## R3: Beacon Message Format

**Decision**: JSON-encoded UDP datagram with fixed structure: `{"service":"pencil2-link","massar":"<code>","port":19876,"deviceName":"<hostname>"}`.

**Rationale**: JSON is self-describing, easily parsed, and consistent with the rest of the codebase (all IPC returns JSON objects). The fixed `service` field acts as a magic identifier to filter out unrelated UDP traffic. Including the HTTP `port` in the beacon allows future port flexibility without protocol changes.

**Alternatives considered**:
- **Binary protocol**: Smaller packets but harder to debug, no benefit at 3-second intervals with <200 byte payloads.
- **Plain text delimited**: Simpler to parse but fragile (delimiter conflicts, no field identification).
- **Protocol Buffers / MessagePack**: Requires external dependencies, violates FR-015.

---

## R4: OTP Expiry Auto-Stop Mechanism

**Decision**: Use a `setTimeout` scheduled at server start, aligned with the OTP's `expiresAt` timestamp. Additionally, poll the OTP status from the database before each verification attempt.

**Rationale**: The timeout provides automatic cleanup even if no verification attempts arrive. The poll-before-verify check catches OTPs that were consumed by a different channel (e.g., server-side verification in Phase 7.4) or cancelled by the admin. Both mechanisms are lightweight and eliminate race conditions.

**Alternatives considered**:
- **Database polling on interval**: Adds unnecessary DB queries every few seconds. The timeout is more efficient.
- **Event emitter from otp.js**: Would require modifying the completed Phase 7.2 module. Violates the principle of not modifying completed phases unnecessarily.
- **Relying solely on otp.js verifyOtp rejection**: Works for attempts but doesn't stop the broadcast when OTP expires silently (no one tries to verify).

---

## R5: Verification Response Payload Composition

**Decision**: The successful verification response includes two data sections: (1) sync configuration from `sync_config` table, and (2) all active user accounts from the `users` table (with password hashes included for seamless import).

**Rationale**: The joining device needs sync config to connect to DynamoDB, and user accounts so staff can log in immediately after linking. Password hashes are safe to transfer within the LAN — they are already scrypt-hashed (not plaintext) and the transfer happens over a private network after OTP verification. This matches the plan document (Phase 7.3: "Success response includes sync config + user accounts").

**Alternatives considered**:
- **Exclude password hashes, force password reset**: More secure in theory, but creates a poor UX — every user on the joining device would need the admin to reset their password. The OTP already provides the trust boundary.
- **Include only sync config, sync users later**: Would work but adds a dependency on internet/DynamoDB being available immediately after linking. LAN linking should be self-sufficient (SC-007).
- **Encrypt the payload with the OTP as key material**: Adds complexity for marginal security gain — the OTP is already verified, and the HTTP connection is on a private LAN. (Phase 7.4 does this for server-side linking because the payload traverses the internet.)

---

## R6: Request Body Size Limit

**Decision**: Limit incoming HTTP request bodies to 4KB (4096 bytes).

**Rationale**: The verification request body contains only 4 fields (`massar`, `otp`, `deviceHash`, `deviceName`), totaling well under 1KB in practice. A 4KB limit provides generous headroom while preventing memory abuse from oversized payloads. This aligns with FR-014.

**Alternatives considered**:
- **1KB**: Too tight — could fail with long device names or unexpected encoding.
- **1MB**: Too generous — no legitimate request needs anywhere near this, opens the door to memory abuse.
- **No limit**: Unacceptable for a server exposed on the LAN — any device on the network can send requests.

---

## R7: Linked Device Registration — Who Inserts?

**Decision**: `lan.js` (the HTTP verification handler) inserts the device into `linked_devices` after a successful `verifyOtp()` call. The `otp.js` module does NOT handle device registration.

**Rationale**: `otp.js` is a pure OTP lifecycle module — it only marks the OTP as `used` and records `used_by_device`. The caller is responsible for the side effects of a successful verification. This separation allows different linking channels (LAN, server, future methods) to handle registration differently (e.g., different `linked_by` values: `otp_lan` vs `otp_server`).

**Alternatives considered**:
- **otp.js handles registration**: Would couple OTP verification to device management, violating single responsibility. Future linking methods would need to work around or duplicate logic.
- **Separate registration module**: Over-engineering for a single `INSERT INTO linked_devices` statement. The registration logic is simple enough to inline in the verification handler.

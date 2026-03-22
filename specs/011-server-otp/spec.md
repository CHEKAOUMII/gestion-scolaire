# Feature Specification: Server-Side OTP (Lambda + DynamoDB)

**Feature Branch**: `011-server-otp`
**Created**: 2026-03-22
**Status**: Draft
**Input**: Phase 7.4 from the institution device linking plan — server-side OTP publish and verify via the existing Auth Lambda and DynamoDB, used as a fallback when devices are NOT on the same LAN.

## Context

Phase 7.3 (LAN Discovery) enables device linking when both devices share a local network. However, many schools have devices on separate subnets, VLANs, or entirely different networks (e.g. an administrator at home linking a school device remotely). Phase 7.4 provides a **server-side fallback** so that OTP-based device linking works over the internet via the existing Lambda Function URL and DynamoDB table.

The flow:
1. **Device 1 (admin)** generates an OTP locally (Phase 7.2), then **publishes** the OTP hash + encrypted sync config to DynamoDB via a new Lambda route.
2. **Device 2 (linking device)** submits the OTP plaintext to a new Lambda route, which verifies the hash in DynamoDB and returns the encrypted config.
3. Device 2 decrypts the config using the OTP as key material and completes linking.

This phase touches **two layers**:
- **Lambda (server)**: Add path-based routing to the existing `pencil2-sync-auth` Lambda, plus two new `/link/*` route handlers.
- **Client (Electron)**: A new `main/linking/server.js` module that calls the Lambda endpoints and handles encryption/decryption.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Publishes OTP to Server (Priority: P1)

A school administrator generates an OTP for device linking (Phase 7.2). The system automatically publishes the OTP hash and an encrypted copy of the school's sync configuration to the cloud server, making it available for remote verification. The admin does not need to take any additional action — the publish happens transparently when the OTP is generated.

**Why this priority**: Without publishing, there is nothing for Device 2 to verify against on the server. This is the prerequisite for all server-side linking.

**Independent Test**: Can be tested by calling `publishOtpToServer()` with a valid license key, MASSAR code, OTP hash, and sync config payload, then confirming that a DynamoDB item is created with the correct PK/SK pattern and TTL.

**Acceptance Scenarios**:

1. **Given** an admin has generated a local OTP and the device has a valid license key, **When** the system publishes to the server, **Then** the Lambda stores the OTP hash and encrypted config in DynamoDB with a TTL matching the OTP expiry (10 minutes), and returns success.
2. **Given** a previous server-side OTP exists for the same MASSAR code, **When** the admin publishes a new OTP, **Then** the previous item is replaced (overwritten) with the new OTP data.
3. **Given** the device has no internet connectivity, **When** the publish is attempted, **Then** the system fails gracefully without crashing, returning an error that can be shown to the admin as a non-blocking warning (LAN linking still works).
4. **Given** the license key is expired or invalid, **When** the publish is attempted, **Then** the Lambda rejects the request with an appropriate error code and no data is stored.

---

### User Story 2 - New Device Verifies OTP via Server (Priority: P1)

A staff member setting up a new device enters the MASSAR code and 6-digit OTP. After LAN discovery times out (no admin device found on the local network), the system falls back to server verification. It sends the OTP plaintext to the Lambda, which verifies it against the stored hash in DynamoDB. On success, the encrypted sync config is returned, the new device decrypts it, and device linking completes.

**Why this priority**: This is the core value proposition — enabling device linking when LAN is unavailable. Equal priority to Story 1 as both are required for the server flow.

**Independent Test**: Can be tested by first publishing an OTP (Story 1), then calling `verifyOtpViaServer()` with the correct MASSAR code and OTP plaintext, confirming the response includes the encrypted config payload that can be decrypted.

**Acceptance Scenarios**:

1. **Given** an OTP has been published for MASSAR code "M320456", **When** the new device submits the correct 6-digit OTP, **Then** the Lambda returns the encrypted config payload and marks the OTP item as consumed.
2. **Given** an OTP has been published, **When** the new device submits an incorrect OTP, **Then** the Lambda returns an error and increments the failure count, but the OTP remains available for retry.
3. **Given** an OTP was published but has expired (TTL elapsed), **When** any OTP is submitted, **Then** the Lambda returns an expiration error (or the item no longer exists due to DynamoDB TTL cleanup).
4. **Given** an OTP has already been consumed by another device, **When** the same OTP is submitted again, **Then** the Lambda returns an error indicating the OTP was already used.
5. **Given** the new device has no internet connectivity, **When** the server verification is attempted, **Then** the system fails gracefully and reports the error to the user.

---

### User Story 3 - Brute-Force Protection on Server (Priority: P2)

An unauthorized person discovers a school's MASSAR code and attempts to guess the 6-digit OTP by repeatedly calling the server verification endpoint. The Lambda enforces a rate limit, blocking further attempts after 5 failures within the OTP's lifetime.

**Why this priority**: Important security safeguard, but the 6-digit code space (900,000 values) combined with the 10-minute TTL already provides substantial protection. Rate limiting adds defense-in-depth.

**Independent Test**: Can be tested by publishing an OTP, then submitting 5 incorrect codes, and confirming the 6th attempt is rejected even with the correct code.

**Acceptance Scenarios**:

1. **Given** 5 failed verification attempts have been made for a MASSAR code, **When** a 6th attempt is made (even with the correct OTP), **Then** the Lambda rejects it with a rate-limit error.
2. **Given** a rate-limited MASSAR code, **When** the OTP expires and a new one is published, **Then** the failure count resets for the new OTP.

---

### User Story 4 - Encrypted Config Payload (Priority: P1)

The sync configuration and user accounts transmitted through the server are encrypted end-to-end. The server (Lambda) cannot read the config — it only stores and returns opaque ciphertext. Only the device that knows the OTP plaintext can decrypt the payload.

**Why this priority**: The config payload contains license keys, sync credentials, and user password hashes. These must never be visible to the server or any intermediary.

**Independent Test**: Can be tested by encrypting a known config payload with a known OTP, confirming the ciphertext is opaque, then decrypting with the same OTP and confirming the plaintext matches.

**Acceptance Scenarios**:

1. **Given** Device 1 encrypts the sync config using the OTP as key material, **When** Device 2 receives the ciphertext and decrypts it with the same OTP, **Then** the decrypted payload exactly matches the original config.
2. **Given** the encrypted payload is stored in DynamoDB, **When** the Lambda handler processes it, **Then** the Lambda never attempts to decrypt or inspect the payload contents — it is treated as an opaque blob.
3. **Given** an attacker intercepts the encrypted payload, **When** they attempt to decrypt without knowing the OTP, **Then** decryption fails (AES-256-GCM authentication tag mismatch).

---

### Edge Cases

- What happens when the DynamoDB TTL cleanup hasn't run yet but the OTP has logically expired? The Lambda must check `expiresAt` explicitly, not rely solely on DynamoDB TTL (which is eventually consistent and can lag by up to 48 hours).
- What happens when two admins on different devices publish OTPs for the same MASSAR code simultaneously? The last write wins — the PK/SK pattern (`OTP#<massar>` / `ACTIVE`) ensures only one active OTP per institution.
- What happens when the Lambda cold-starts during a verification request? The 10-second timeout should accommodate cold starts. The cached signing secret pattern is already in place.
- What happens when the encrypted payload exceeds DynamoDB's 400KB item limit? The sync config + user accounts should be well under this limit, but the Lambda should validate payload size and reject oversized requests.
- What happens when the OTP plaintext used for encryption differs from the OTP used to hash (e.g. a bug generates two different codes)? The encrypt and hash operations must use the same OTP value within a single `publishOtpToServer()` call.

## Requirements *(mandatory)*

### Functional Requirements

#### Lambda Route Handling

- **FR-001**: The Lambda handler MUST support path-based routing, inspecting `event.requestContext.http.path` (or `event.rawPath`) to distinguish between the existing credential-exchange root path (`/`) and the new `/link/publish-otp` and `/link/verify-otp` routes.
- **FR-002**: The existing credential-exchange behavior (current `handler()` logic) MUST remain unchanged and continue to be served at the root path (`POST /`).
- **FR-003**: Unrecognized paths MUST return `404 NOT_FOUND`.

#### Publish OTP (`POST /link/publish-otp`)

- **FR-004**: The publish route MUST require license key authentication — the same `licenseKey` + `deviceHash` validation used by the existing credential-exchange route.
- **FR-005**: The publish route MUST accept: `massar` (MASSAR code, alphanumeric 5-10 chars), `otpHash` (the scrypt hash string from the local OTP module), `encryptedPayload` (base64-encoded ciphertext of the sync config), `iv` (base64-encoded initialization vector), `authTag` (base64-encoded GCM authentication tag).
- **FR-006**: The publish route MUST store a DynamoDB item with `PK: OTP#<massar>`, `SK: ACTIVE`, containing the OTP hash, encrypted payload, IV, auth tag, the publishing device's `customerRef` (schoolId from license), and an `expiresAt` attribute set to the current time + 600 seconds (10 minutes).
- **FR-007**: The publish route MUST overwrite any existing item with the same PK/SK, ensuring only one active server-side OTP per MASSAR code.
- **FR-008**: The publish route MUST validate that `massar` matches the `customerRef` from the license key, preventing a school from publishing OTPs for a different institution's MASSAR code.
- **FR-009**: The publish route MUST reject encrypted payloads larger than 300KB (leaving headroom under DynamoDB's 400KB item limit).

#### Verify OTP (`POST /link/verify-otp`)

- **FR-010**: The verify route MUST NOT require license key authentication — the OTP itself serves as the authentication credential. The request body requires only: `massar` (MASSAR code) and `otp` (6-digit plaintext code).
- **FR-011**: The verify route MUST look up the DynamoDB item at `PK: OTP#<massar>`, `SK: ACTIVE` and check that it exists and has not expired (`expiresAt > now`).
- **FR-012**: The verify route MUST verify the submitted OTP against the stored `otpHash` using scrypt-based comparison (same algorithm as `main/auth/password.js`). The Lambda MUST include its own scrypt verification function (since `password.js` is a main-process module, not deployed to Lambda).
- **FR-013**: On successful verification, the route MUST return the `encryptedPayload`, `iv`, and `authTag` to the caller, then update the DynamoDB item to set `status: "used"` and `usedAt` timestamp (or delete it).
- **FR-014**: On failed verification, the route MUST increment a `failureCount` attribute on the DynamoDB item and return an error.
- **FR-015**: The verify route MUST enforce a rate limit of 5 failed attempts per OTP item. Once `failureCount >= 5`, all subsequent attempts MUST be rejected with a `RATE_LIMITED` error, regardless of OTP correctness.
- **FR-016**: The verify route MUST reject requests where the DynamoDB item does not exist with a `NOT_FOUND` error (not distinguishing between "never published" and "TTL-cleaned" for security).

#### Client Module (`main/linking/server.js`)

- **FR-017**: The client module MUST export a `publishOtpToServer(authLambdaUrl, licenseKey, deviceHash, massar, otpPlaintext, syncConfig)` function that: (a) derives an AES-256-GCM key from the OTP plaintext using HKDF-SHA256, (b) encrypts the JSON-serialized sync config, (c) calls `POST <authLambdaUrl>/link/publish-otp` with the license key, device hash, MASSAR code, OTP hash (from the local OTP module), and encrypted payload.
- **FR-018**: The client module MUST export a `verifyOtpViaServer(authLambdaUrl, massar, otpPlaintext)` function that: (a) calls `POST <authLambdaUrl>/link/verify-otp` with the MASSAR code and OTP plaintext, (b) on success, derives the same AES-256-GCM key from the OTP, (c) decrypts the returned payload, (d) returns the parsed sync config object.
- **FR-019**: Both client functions MUST handle network errors gracefully, returning structured error objects (not throwing unhandled exceptions).
- **FR-020**: The client module MUST use Node.js built-in `crypto` for all cryptographic operations — no new dependencies.

#### Encryption Scheme

- **FR-021**: The encryption key MUST be derived from the OTP plaintext using HKDF (RFC 5869) with SHA-256, a fixed application-specific salt (`pencil2-link-v1`), info string (`otp-payload-key`), and 32-byte output length.
- **FR-022**: Encryption MUST use AES-256-GCM with a random 12-byte IV per encryption operation.
- **FR-023**: The IV and GCM authentication tag MUST be transmitted alongside the ciphertext (not embedded) to allow the Lambda to store them as separate DynamoDB attributes.

### Key Entities

- **Server OTP Item**: A DynamoDB item representing a published OTP available for server-side verification. Key schema: `PK: OTP#<massar>`, `SK: ACTIVE`. Contains the scrypt hash of the OTP, the encrypted sync config payload (ciphertext + IV + auth tag), the publishing school's identifier, a failure counter, and an `expiresAt` TTL attribute. Status transitions: stored → verified (deleted/marked used) | expired (TTL-cleaned).

- **Encrypted Config Payload**: The sync configuration and user account data from Device 1, encrypted with AES-256-GCM using a key derived from the OTP plaintext. Contents (before encryption): `syncConfig` (auth_lambda_url, aws_region, license_key, sync_interval_minutes, enabled), `institution` (massar_code, institution_name), `users` (name, email, role, password_hash, pin_hash, must_change_password). The server never sees the plaintext.

- **Sync Config Transfer Object**: The plaintext structure encrypted inside the payload, matching the data returned by the LAN verification endpoint (Phase 7.3) for consistency. Both linking paths (LAN and server) should produce the same config structure on the receiving device.

## Assumptions

- The existing `pencil2-sync` DynamoDB table is available and its `expiresAt` TTL attribute is enabled (already configured in the CDK stack).
- The existing Auth Lambda Function URL accepts requests at its root path and will accept the addition of path-based routing without breaking the existing credential-exchange flow.
- The `customerRef` field in the license key payload corresponds to the school's MASSAR code (or schoolId), and can be used to validate that a publish request is authorized for a specific MASSAR code.
- Node.js 18's built-in `crypto` module supports `hkdfSync` (available since Node.js 16) and `createCipheriv`/`createDecipheriv` with `aes-256-gcm`.
- The Lambda's 10-second timeout is sufficient for DynamoDB read/write operations even during cold starts.
- The encrypted payload size (sync config + user accounts) will remain well under 300KB for any real school deployment.
- DynamoDB TTL cleanup may lag up to 48 hours — the Lambda must explicitly check `expiresAt` rather than relying on item absence.
- The Phase 7.2 OTP module (`main/linking/otp.js`) is complete and its `hashPassword()` output format is compatible with the scrypt verification the Lambda will implement.

## Dependencies

- **Phase 7.1 (Database Schema)**: The `institution_config`, `sync_config`, and `users` tables must exist to extract the config payload for encryption.
- **Phase 7.2 (OTP Module)**: The local OTP generation (`generateOtp()`) and its hash format must be available. The `hashPassword()` format (`scrypt$<salt>$<hash>`) from `main/auth/password.js` must be understood by the Lambda's verification logic.
- **Phase 7.3 (LAN Discovery)**: The sync config transfer object format used in `verifyViaLan()` response must be defined, so the server flow returns the same structure. (Phase 7.3 and 7.4 can be implemented in parallel as long as the transfer object schema is agreed upon.)
- **Existing CDK Stack (`infra/lib/sync-stack.ts`)**: The `pencil2-sync` DynamoDB table and the `pencil2-sync-auth` Lambda must be deployed.
- **Existing Auth Lambda (`infra/lib/auth-lambda/`)**: The Lambda handler, license validator, and schema constants must be in place.

## Files to Create

| File | Purpose |
|------|---------|
| `main/linking/server.js` | Client-side module: `publishOtpToServer()`, `verifyOtpViaServer()`, encryption/decryption helpers |

## Files to Modify

| File | Change |
|------|--------|
| `infra/lib/auth-lambda/index.js` | Add path-based routing (`/`, `/link/publish-otp`, `/link/verify-otp`); add DynamoDB client; add scrypt verification; add two new route handlers |
| `infra/lib/auth-lambda/schema-constants.js` | Add `OTP_PK_PREFIX = 'OTP#'` and `OTP_SK_ACTIVE = 'ACTIVE'` constants |
| `infra/lib/sync-stack.ts` | Grant the Auth Lambda `dynamodb:PutItem`, `dynamodb:GetItem`, `dynamodb:UpdateItem`, `dynamodb:DeleteItem` permissions on the sync table (scoped to `OTP#*` leading keys if feasible, otherwise full table access) |

## DynamoDB Item Schema

```
PK:               OTP#M320456
SK:               ACTIVE
otpHash:          scrypt$<salt>$<hash>       (same format as password.js)
encryptedPayload: <base64 ciphertext>
iv:               <base64 12-byte IV>
authTag:          <base64 16-byte GCM tag>
schoolId:         M320456                    (customerRef from license)
publishedBy:      <deviceHash>
failureCount:     0                          (incremented on failed verify)
status:           active                     (active | used)
usedAt:           null                       (ISO timestamp on consumption)
expiresAt:        1711234567                  (Unix epoch seconds, DynamoDB TTL)
createdAt:        2026-03-22T10:00:00.000Z
```

## API Contract

### `POST /link/publish-otp`

**Auth**: License key required (same as root `/` route).

**Request body**:
```json
{
    "licenseKey": "GSLK-<payload>.<signature>",
    "deviceHash": "<64-char hex>",
    "massar": "M320456",
    "otpHash": "scrypt$<salt>$<hash>",
    "encryptedPayload": "<base64>",
    "iv": "<base64>",
    "authTag": "<base64>"
}
```

**Success response** (200):
```json
{
    "success": true,
    "expiresAt": 1711234567
}
```

**Error responses**:
- 400 `MALFORMED_REQUEST` — missing/invalid fields
- 400 `MASSAR_MISMATCH` — massar does not match license customerRef
- 400 `PAYLOAD_TOO_LARGE` — encrypted payload exceeds 300KB
- 401 `INVALID_KEY` — license validation failed
- 401 `EXPIRED_KEY` — license expired
- 500 `INTERNAL_ERROR` — unexpected server error

### `POST /link/verify-otp`

**Auth**: None (OTP is the credential).

**Request body**:
```json
{
    "massar": "M320456",
    "otp": "482917"
}
```

**Success response** (200):
```json
{
    "success": true,
    "encryptedPayload": "<base64>",
    "iv": "<base64>",
    "authTag": "<base64>"
}
```

**Error responses**:
- 400 `MALFORMED_REQUEST` — missing/invalid fields
- 404 `NOT_FOUND` — no active OTP for this MASSAR code
- 401 `INVALID_OTP` — OTP verification failed
- 410 `OTP_EXPIRED` — OTP exists but `expiresAt` has passed
- 410 `OTP_USED` — OTP was already consumed
- 429 `RATE_LIMITED` — too many failed attempts (>= 5)
- 500 `INTERNAL_ERROR` — unexpected server error

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can publish an OTP to the server within 3 seconds (including network latency to Lambda + DynamoDB write).
- **SC-002**: A valid OTP is successfully verified via the server within 3 seconds (including network latency + DynamoDB read + scrypt comparison).
- **SC-003**: An expired server-side OTP is rejected 100% of the time, even if DynamoDB TTL cleanup has not yet removed the item.
- **SC-004**: After 5 incorrect server-side verification attempts, subsequent attempts are blocked with a rate-limit error.
- **SC-005**: The encrypted payload cannot be decrypted without knowing the 6-digit OTP plaintext (AES-256-GCM authentication tag verification fails).
- **SC-006**: The existing credential-exchange flow (`POST /` with `licenseKey` + `deviceHash`) continues to work identically after the Lambda routing changes are deployed.
- **SC-007**: Publishing a new OTP for the same MASSAR code always replaces the previous server-side OTP (no stale items accumulate).
- **SC-008**: The sync config decrypted on Device 2 exactly matches the config encrypted on Device 1 — byte-for-byte fidelity after JSON round-trip.
- **SC-009**: `npm run lint` passes for all new and modified files.
- **SC-010**: The Lambda handler correctly routes to 404 for unknown paths (e.g. `POST /link/unknown`).

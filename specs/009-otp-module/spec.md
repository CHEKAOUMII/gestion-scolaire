# Feature Specification: OTP Module for Device Linking

**Feature Branch**: `009-otp-module`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Phase 7.2 OTP Module — secure one-time password generation and verification for linking additional school devices to an institution"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Generates OTP for Device Linking (Priority: P1)

A school administrator wants to link a second computer to their institution. From the admin panel, they request a one-time password. The system generates a 6-digit code, displays it on screen with a countdown timer, and the admin shares this code verbally or on paper with the person setting up the second device.

**Why this priority**: This is the core capability — without OTP generation, no additional devices can be linked to an institution. It enables the entire multi-device workflow.

**Independent Test**: Can be fully tested by generating an OTP from an admin session and verifying the code is a valid 6-digit number with an expiration time. Delivers the ability to create secure, time-limited linking codes.

**Acceptance Scenarios**:

1. **Given** an admin is logged in and the institution is set up, **When** they request an OTP, **Then** the system returns a 6-digit code and an expiration time (10 minutes from now)
2. **Given** an active OTP already exists for the institution, **When** the admin generates a new OTP, **Then** the previous OTP is invalidated and a new one is issued
3. **Given** an admin requests an OTP, **When** the OTP is generated, **Then** only a secure hash of the code is stored — the plaintext code is returned once and never persisted

---

### User Story 2 - Second Device Verifies OTP to Link (Priority: P1)

A person setting up a second device enters the institution's MASSAR code and the 6-digit OTP shared by the admin. The system verifies the OTP against the stored hash. On success, the device is registered as linked and the OTP is marked as consumed.

**Why this priority**: Verification is the counterpart to generation — both are required for the linking flow to function. Without verification, the generated OTP serves no purpose.

**Independent Test**: Can be fully tested by generating an OTP, then calling verification with the correct code and confirming success, and with an incorrect code and confirming rejection. Delivers secure device-to-institution binding.

**Acceptance Scenarios**:

1. **Given** an active OTP exists for a MASSAR code, **When** the correct 6-digit code is submitted with a device identifier, **Then** verification succeeds, the OTP is marked as used, and the consuming device is recorded
2. **Given** an active OTP exists, **When** an incorrect code is submitted, **Then** verification fails with an error message and the OTP remains active for retry
3. **Given** an OTP has expired (past its 10-minute window), **When** any code is submitted for that MASSAR code, **Then** verification fails with an expiration error
4. **Given** an OTP has already been used, **When** the same code is submitted again, **Then** verification fails with a "code already used" error

---

### User Story 3 - Brute-Force Protection (Priority: P2)

An unauthorized person attempts to guess OTP codes by submitting many incorrect values. The system enforces a rate limit, blocking further attempts after repeated failures to prevent brute-force attacks.

**Why this priority**: Security is critical but the rate limit is a safeguard layer on top of the core generation/verification flow. The 6-digit code space (900,000 values) combined with rate limiting provides adequate security.

**Independent Test**: Can be fully tested by submitting 5 incorrect OTP values for the same MASSAR code and verifying that the 6th attempt is rejected with a rate-limit error, even if the correct code is provided.

**Acceptance Scenarios**:

1. **Given** 5 failed verification attempts have occurred for a MASSAR code within 10 minutes, **When** a 6th attempt is made (even with the correct code), **Then** the system rejects it with a rate-limit error
2. **Given** the rate limit was reached, **When** 10 minutes have elapsed since the first failed attempt in that window, **Then** the rate limit resets and new attempts are allowed

---

### User Story 4 - Admin Checks OTP Status (Priority: P3)

The admin wants to know whether an OTP they previously generated is still active and how much time remains before it expires.

**Why this priority**: This is a convenience feature for the admin UI — useful but not essential for the core linking flow.

**Independent Test**: Can be fully tested by generating an OTP, then querying its status and verifying the response includes active state and remaining time.

**Acceptance Scenarios**:

1. **Given** an active OTP exists for the institution, **When** the admin checks OTP status, **Then** the system returns the active status and remaining time until expiration
2. **Given** no active OTP exists, **When** the admin checks OTP status, **Then** the system returns an indication that no OTP is currently active

---

### User Story 5 - Expired OTP Cleanup (Priority: P3)

Over time, expired and used OTP records accumulate in the database. The system periodically removes stale records to keep the database clean.

**Why this priority**: Housekeeping feature — the system functions correctly without it, but it prevents unbounded growth of OTP records.

**Independent Test**: Can be fully tested by inserting expired OTP records and running cleanup, then verifying the records are removed.

**Acceptance Scenarios**:

1. **Given** expired OTP records exist in the database, **When** the cleanup process runs, **Then** all expired records are removed
2. **Given** active (non-expired) OTP records exist, **When** the cleanup process runs, **Then** active records are preserved

---

### Edge Cases

- What happens when the system clock is significantly wrong (skewed time)? The OTP expiration is relative to creation time, so clock skew between admin and linking devices could cause premature expiration or extended validity.
- How does the system handle concurrent OTP generation requests from the same admin? Only the latest OTP should be valid; previous ones are invalidated.
- What happens when the database is locked or unavailable during OTP verification? The verification should fail gracefully with an appropriate error.
- What happens if the MASSAR code format is invalid? The system should reject it before attempting any OTP operations.
- What happens if the device identifier is empty or missing during verification? The system should require a valid device identifier.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST generate a cryptographically random 6-digit numeric code (range 100000–999999) when an admin requests an OTP
- **FR-002**: System MUST store only a secure hash of the OTP code, never the plaintext — the plaintext is returned to the caller exactly once at generation time
- **FR-003**: System MUST invalidate any previously active OTP for the same MASSAR code when a new OTP is generated (one active OTP per institution at a time)
- **FR-004**: System MUST enforce a 10-minute time-to-live (TTL) on generated OTPs, after which they cannot be used for verification
- **FR-005**: System MUST verify a submitted OTP by comparing it against the stored hash using timing-safe comparison to prevent timing attacks
- **FR-006**: System MUST mark an OTP as "used" upon successful verification, recording which device consumed it and when
- **FR-007**: System MUST enforce a rate limit of maximum 5 failed verification attempts per MASSAR code within a 10-minute sliding window
- **FR-008**: System MUST reject verification attempts that exceed the rate limit, even if the submitted code is correct
- **FR-009**: System MUST provide a way to check whether an active OTP exists for a given MASSAR code and how much time remains
- **FR-010**: System MUST provide a cleanup mechanism to remove expired and consumed OTP records from storage
- **FR-011**: System MUST reuse the existing password hashing infrastructure (scrypt-based) for OTP hashing and verification — no new cryptographic dependencies
- **FR-012**: System MUST validate MASSAR code format before performing any OTP operations

### Key Entities

- **OTP Record**: Represents a single one-time password lifecycle — contains the secure hash of the code, the associated institution identifier (MASSAR code), the device that created it, expiration timestamp, consumption status, and the device that used it (if consumed). Status transitions: active → used | expired.
- **Rate Limit Window**: A logical tracking mechanism for failed verification attempts per institution identifier within a rolling time window. Resets after the window elapses.

## Assumptions

- The `device_otp` database table (from Phase 7.1) is available with columns: `otp_hash`, `massar_code`, `created_by_device`, `expires_at`, `used_by_device`, `used_at`, `status`
- The existing `hashPassword()` and `verifyPassword()` functions from the auth module are suitable for OTP hashing (scrypt with timing-safe comparison)
- The 10-minute TTL is sufficient for the physical process of sharing an OTP code between two people in the same school
- A single active OTP per institution is sufficient — there is no need for multiple concurrent linking sessions
- Rate limiting is tracked in-memory or via the same database table — no external rate-limiting service is needed
- MASSAR codes follow a known format (e.g., alphanumeric starting with "M") that can be validated

## Dependencies

- **Phase 7.1 (Database Schema)**: The `device_otp` table must exist before OTP operations can function
- **Existing auth module**: `hashPassword()` and `verifyPassword()` from `main/auth/password.js` are reused for secure OTP storage

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can generate an OTP and receive the 6-digit code within 1 second
- **SC-002**: A valid OTP is successfully verified on the first correct attempt 100% of the time (within the TTL window)
- **SC-003**: An expired OTP is rejected 100% of the time, regardless of whether the correct code is submitted
- **SC-004**: After 5 incorrect attempts within 10 minutes, subsequent attempts are blocked until the window resets
- **SC-005**: A previously used OTP cannot be reused — reuse attempts are rejected 100% of the time
- **SC-006**: Only one active OTP exists per institution at any time — generating a new one always invalidates the previous
- **SC-007**: The OTP plaintext is never found in persistent storage (database) — only the secure hash is stored
- **SC-008**: Cleanup successfully removes all expired/used OTP records without affecting active ones

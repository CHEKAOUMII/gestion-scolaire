# Feature Specification: Phase 7.6 IPC Layer

**Feature Branch**: `[013-ipc-layer]`  
**Created**: 2026-03-22  
**Status**: Draft  
**Input**: User description: `read @eager-drifting-yeti.md and create a specification for the Phase 7.6 "Phase 7.6: IPC Layer" ONLY.`

## User Scenarios & Testing _(mandatory)_

### User Story 1 - Complete first-device setup (Priority: P1)

As a school administrator launching the application on an unconfigured device, I need the app to determine whether institution setup is required and let me create the institution if it is the first device, so the school can begin using the system immediately.

**Why this priority**: The application cannot be used until the device knows whether it belongs to an existing institution or must complete first-run setup.

**Independent Test**: Start from a device with no completed institution setup, request institution status, submit valid new-institution details, and confirm the institution is created, the administrator account is established, and the current device is registered as active.

**Acceptance Scenarios**:

1. **Given** a device has no completed institution setup, **When** the first-run experience checks institution status, **Then** it receives a response that setup is required and no prior institution identity is returned.
2. **Given** a device has no completed institution setup, **When** an administrator submits a valid MASSAR code, optional institution name, and administrator account details, **Then** the institution is created, setup is marked complete, and the current device becomes the founding active device.
3. **Given** a device already belongs to a configured institution, **When** the first-run experience checks institution status, **Then** it receives a response showing setup is complete and enough institution identity to skip onboarding.

---

### User Story 2 - Link an additional device (Priority: P1)

As a staff member or administrator preparing an additional device, I need to join the device to an existing institution using the school's MASSAR code and a one-time link code, so the device can start operating with the same institution settings.

**Why this priority**: Multi-device onboarding is a core outcome of institution device linking and depends on this feature exposing the full linking flow before login.

**Independent Test**: Start from an unconfigured device, submit a valid MASSAR code and one-time link code, and confirm the device receives institution settings, setup completes, and the device is registered as linked.

**Acceptance Scenarios**:

1. **Given** an unconfigured device and a valid MASSAR code with a valid one-time link code, **When** the user submits the link request, **Then** the device is linked to the institution, required institution settings are imported, and setup is marked complete.
2. **Given** an unconfigured device and a one-time link code that is invalid, expired, cancelled, or already used, **When** the user submits the link request, **Then** setup remains incomplete and the user receives a clear reason the request was rejected.
3. **Given** the preferred verification path is unavailable but an approved fallback verification path is available, **When** the user submits a valid link request, **Then** the device can still complete linking without switching to a different workflow.

---

### User Story 3 - Manage institution linking access (Priority: P2)

As an institution administrator, I need to issue and monitor time-limited link codes, review linked devices, identify the current device, and revoke devices that should no longer have access, so I can control which devices belong to the institution.

**Why this priority**: After onboarding works, administrators need an operational control surface to safely expand or reduce device access.

**Independent Test**: Sign in as an administrator, generate a link code, confirm its active status and remaining validity, view the linked device list including the current device, cancel the active code, and revoke a non-current device.

**Acceptance Scenarios**:

1. **Given** an authenticated administrator and no active link code, **When** the administrator requests a new code, **Then** the system returns a single active time-limited code with its remaining validity.
2. **Given** an authenticated administrator and an active link code, **When** the administrator cancels the code, **Then** the code immediately becomes unusable and is no longer reported as active.
3. **Given** an authenticated administrator, **When** the administrator requests device management data, **Then** the system returns the current device identity and the full linked-device roster with status and recent activity details.
4. **Given** an authenticated administrator and a linked device other than the current device, **When** the administrator revokes that device, **Then** the device is marked revoked and no longer appears as active in subsequent management results.

---

### Edge Cases

- A setup action is requested on a device that is already marked as configured.
- A link request is submitted with a code issued for a different MASSAR code.
- More than one discoverable institution source is found for the same MASSAR code; linking must only complete after the submitted code validates against the intended institution.
- An administrator asks for a new link code while another link code is still active.
- A non-admin or signed-out user attempts to generate codes, inspect device records, or revoke devices.
- An administrator attempts to revoke a device that is already revoked or attempts to revoke the current device.

## Requirements _(mandatory)_

### Functional Requirements

- **FR-001**: The system MUST provide a pre-login institution status response that tells the application whether setup is required and, when setup is already complete, returns the institution identity needed to skip onboarding.
- **FR-002**: The system MUST allow a not-yet-configured device to create a new institution using a valid MASSAR code, an optional institution name, and administrator account details.
- **FR-003**: When a new institution is created, the system MUST mark setup as completed and register the current device as an active linked device created during initial setup.
- **FR-004**: The system MUST allow a not-yet-configured device to request discovery results for nearby institutions that match a supplied MASSAR code to support guided linking.
- **FR-005**: The system MUST allow a not-yet-configured device to submit a MASSAR code and one-time link code to join an existing institution and receive the institution settings required to finish setup.
- **FR-006**: When a link request succeeds, the system MUST store the linked institution identity, register the current device as active, and mark setup as completed on that device.
- **FR-007**: When a link request fails, the system MUST leave setup incomplete and return a clear failure reason that distinguishes invalid, expired, cancelled, already-used, unauthorized, and unreachable verification outcomes.
- **FR-008**: The system MUST restrict institution device-management actions to authenticated administrators.
- **FR-009**: The system MUST allow an authenticated administrator to generate a single active time-limited one-time link code for the institution and retrieve its remaining validity.
- **FR-010**: The system MUST allow an authenticated administrator to cancel the active one-time link code, making it immediately unusable for new linking attempts.
- **FR-011**: The system MUST allow an authenticated administrator to retrieve the linked-device roster, including each device's display identity, link source, current status, recent activity time, and an indicator for the current device.
- **FR-012**: The system MUST allow an authenticated administrator to revoke a linked device other than the current device and reflect the revoked status in subsequent roster results.
- **FR-013**: The system MUST prevent a device that already has completed institution setup from re-running new-institution setup or link-to-existing setup unless the institution configuration has been explicitly reset outside this phase.
- **FR-014**: The system MUST treat upgraded installations that are already recognized as configured institutions as completed setups so users are not forced through onboarding again.

### Scope Boundaries

- This phase defines the application-facing contract for institution setup and device management only.
- Visual layout, screen copy, and interaction design for setup and settings screens are outside the scope of this phase.
- Background synchronization behavior, device heartbeat updates, and cross-device revocation enforcement are outside the scope of this phase.

### Assumptions

- Time-limited one-time link code generation, code validation, nearby-device discovery, and fallback verification behavior are available from dependent phases and are consumed by this phase.
- The first-run setup experience and the device-management settings experience are specified separately and rely on this phase to provide their required actions and status data.
- Existing installations that already have institution identity after upgrade are considered configured and should bypass onboarding.
- For continuity and lockout prevention, the current device cannot be revoked through the standard device-management action in this phase.

### Key Entities _(include if feature involves data)_

- **Institution Profile**: The school's identity used during onboarding and management, including MASSAR code, optional display name, and whether setup is complete on the device.
- **Link Code Session**: A time-limited one-time code issued by an administrator for a specific institution, including its current status and remaining validity.
- **Linked Device Record**: A device approved to belong to the institution, including its display identity, how it was linked, current status, linked date, and most recent activity.
- **Current Device Context**: The local device identity used to determine whether setup is complete and to mark which linked-device record represents the active device.
- **Link Request**: The information submitted by a not-yet-configured device to join an institution, including institution identity, one-time code, and the device identity to be registered on success.

## Success Criteria _(mandatory)_

### Measurable Outcomes

- **SC-001**: In 100% of validation tests, a first app launch on a device correctly identifies whether onboarding is required or the user should proceed directly to sign-in.
- **SC-002**: At least 95% of administrators can complete first-device institution setup in under 3 minutes once they have the required school and administrator information.
- **SC-003**: At least 95% of valid additional-device linking attempts complete successfully in under 2 minutes, including cases that require the approved fallback verification path.
- **SC-004**: In 100% of validation tests, invalid, expired, cancelled, already-used, or mismatched link codes are rejected without changing the device's setup-complete state.
- **SC-005**: In 100% of validation tests, non-admin users cannot perform institution device-management actions, and at least 95% of administrators can retrieve current link-code status or the linked-device roster in under 10 seconds.

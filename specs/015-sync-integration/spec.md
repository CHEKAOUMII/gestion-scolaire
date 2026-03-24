# Feature Specification: Sync Integration

**Feature Branch**: `015-sync-integration`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "Phase 7.8: Sync Integration — MASSAR as canonical schoolId, auto-config sync on device link, device heartbeat, revocation enforcement"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — MASSAR Code as Canonical School Identity (Priority: P1)

When an administrator sets up a new institution or links a device via OTP, the MASSAR code entered during setup becomes the single source of truth for identifying the school across all sync operations. The system uses this code as the partition key when pushing and pulling data to/from the cloud, ensuring all devices belonging to the same institution share the same data namespace.

**Why this priority**: Without a canonical school identity flowing through the sync layer, devices cannot correctly partition their data in the cloud. This is the foundational requirement that all other sync integration features depend on.

**Independent Test**: Can be fully tested by completing the first-run setup with a MASSAR code, then verifying that the sync configuration automatically contains the correct school identifier derived from that MASSAR code.

**Acceptance Scenarios**:

1. **Given** a device completes first-run setup as a new institution with MASSAR code "M320456", **When** the sync configuration is read, **Then** the school identifier used for cloud data partitioning equals "M320456"
2. **Given** a device already has sync configured with a legacy school identifier, **When** the application is upgraded and the institution config has a MASSAR code, **Then** the sync school identifier is updated to match the MASSAR code
3. **Given** a device has completed institution setup, **When** any sync push or pull operation executes, **Then** the MASSAR code is used as the partition key for cloud data storage

---

### User Story 2 — Automatic Sync Configuration on Device Linking (Priority: P1)

When a second device links to an existing institution via OTP (either over LAN or via the server), the sync configuration (cloud endpoint, region, license key, sync interval) is automatically transferred from the admin device and applied on the newly linked device. The administrator does not need to manually configure sync settings on each new device.

**Why this priority**: This is the primary value proposition of device linking — zero-configuration sync setup. Without it, linking devices provides no practical benefit over manual configuration.

**Independent Test**: Can be fully tested by setting up Device 1 with sync enabled and configured, generating an OTP, then linking Device 2 via that OTP and verifying that Device 2's sync settings match Device 1's without any manual input.

**Acceptance Scenarios**:

1. **Given** Device 1 has sync enabled with a cloud endpoint and license key configured, **When** Device 2 links via OTP successfully, **Then** Device 2's sync configuration automatically contains the same cloud endpoint, region, license key, and sync interval as Device 1
2. **Given** Device 2 has just completed OTP linking, **When** the user navigates to sync settings on Device 2, **Then** sync is enabled and all configuration fields are pre-populated from Device 1's settings
3. **Given** Device 1 changes its sync interval after Device 2 has already linked, **When** Device 2 performs its next sync, **Then** Device 2 retains its own sync interval (config is copied at link time, not kept in sync)

---

### User Story 3 — Device Heartbeat During Sync (Priority: P2)

Each time a device performs a sync cycle (push or pull), it records its activity timestamp in the local device registry. This allows the administrator to see on the device management screen when each linked device was last active, aiding in monitoring and troubleshooting.

**Why this priority**: Heartbeats enable the admin to monitor fleet health. Important for operational visibility, but the system functions correctly without it.

**Independent Test**: Can be fully tested by triggering a sync cycle on a linked device and verifying that the "last seen" timestamp in the device registry is updated to the current time.

**Acceptance Scenarios**:

1. **Given** a device is linked and sync is enabled, **When** a sync cycle completes (push or pull), **Then** the device's "last seen" timestamp in the local device registry is updated to the current time
2. **Given** an administrator views the linked devices list, **When** a device has recently synced, **Then** its "last seen" column shows the most recent sync completion time
3. **Given** a device has not synced for an extended period, **When** the administrator views the linked devices list, **Then** the "last seen" timestamp reflects the last successful sync, making idle devices identifiable

---

### User Story 4 — Revocation Enforcement via Sync (Priority: P2)

When an administrator revokes a device from the device management screen, the revoked device's identifier is published to the cloud during the next sync cycle. When the revoked device attempts its next sync pull, it detects its own revocation and disables sync automatically, preventing further data exchange.

**Why this priority**: Revocation enforcement is essential for security and data governance — ensuring a lost, stolen, or decommissioned device can no longer exchange data with the institution. Ranked P2 because the admin can already revoke locally; cloud enforcement adds the remote dimension.

**Independent Test**: Can be fully tested by linking two devices, revoking Device 2 from Device 1's admin UI, triggering a sync push on Device 1, then triggering a sync pull on Device 2 and verifying that Device 2's sync is disabled with an appropriate message.

**Acceptance Scenarios**:

1. **Given** an administrator revokes Device 2 from the device management screen, **When** the next sync push occurs on the admin device, **Then** Device 2's identifier is included in the revocation data sent to the cloud
2. **Given** a revoked device's identifier has been pushed to the cloud, **When** the revoked device performs a sync pull, **Then** the device detects its own revocation, disables sync, and displays a notification to the user
3. **Given** a device has been revoked and its sync disabled, **When** the user attempts to re-enable sync on the revoked device, **Then** the system prevents re-enabling and displays a message explaining the device has been revoked by the administrator

---

### Edge Cases

- What happens when a device is linked via OTP but the admin device has sync disabled? The linked device should still receive institution identity but sync remains disabled until configured.
- What happens when the MASSAR code in `institution_config` differs from the legacy `school_id_hash` in `sync_config` during migration? The MASSAR code takes precedence as the canonical identifier, and the legacy value is overwritten.
- What happens when a revoked device is re-linked via a new OTP? The device should be allowed to re-link (a new entry is created), clearing the previous revocation.
- What happens when multiple devices sync simultaneously and one pushes a revocation for another? The revocation should be idempotent — processing it multiple times produces the same result.
- What happens when the sync pull detects self-revocation but the device has unsynced local changes? The system should warn the user about unsynced data before disabling sync, but still disable sync to enforce the revocation.
- What happens when the admin device itself is revoked? The system should prevent revoking the device that created the institution (the "origin" device).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST use the MASSAR code from the institution configuration as the canonical school identifier for all sync operations (push and pull)
- **FR-002**: System MUST write the MASSAR code into the sync configuration's school identifier field when an institution is set up for the first time
- **FR-003**: System MUST automatically populate the sync configuration on a newly linked device using the settings received from the admin device during OTP verification (cloud endpoint, region, license key, sync interval)
- **FR-004**: System MUST enable sync automatically on a newly linked device after successful OTP verification, provided the admin device has sync enabled
- **FR-005**: System MUST update the current device's "last seen" timestamp in the local device registry after each completed sync cycle
- **FR-006**: System MUST include revoked device identifiers in the data pushed to the cloud during sync
- **FR-007**: System MUST check for self-revocation during each sync pull cycle
- **FR-008**: System MUST disable sync and notify the user when self-revocation is detected during a pull
- **FR-009**: System MUST prevent re-enabling sync on a device that has been revoked, until the device is re-linked via a new OTP
- **FR-010**: System MUST prevent revoking the origin device (the device that initially created the institution)
- **FR-011**: System MUST handle the migration case where existing installations have a legacy school identifier by overwriting it with the MASSAR code from institution configuration
- **FR-012**: System MUST ensure that sync configuration copied to a linked device is a point-in-time snapshot — subsequent changes on the admin device do not propagate automatically

### Key Entities

- **Institution Configuration**: The local record of the school's identity (MASSAR code, name, setup status). Serves as the authoritative source for the school identifier used in sync.
- **Sync Configuration**: Per-device settings controlling sync behavior (enabled state, interval, cloud endpoint, region, license key, school identifier). Updated during setup/linking and read by the sync engine.
- **Linked Device**: A registered device in the institution's device registry, tracking identity (device hash, name), link method, activity (last seen), and access status (active/revoked).
- **Revocation Record**: A cloud-stored marker indicating a device has been revoked, checked by each device during sync pull to detect self-revocation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of newly set up institutions have their MASSAR code reflected as the sync school identifier without any manual sync configuration step
- **SC-002**: Devices linked via OTP have their sync fully configured and operational within 10 seconds of successful OTP verification, with zero manual configuration fields
- **SC-003**: The "last seen" timestamp for any active device is accurate to within one sync cycle interval (default 10 minutes)
- **SC-004**: A revoked device stops syncing within two sync cycles of the revocation being pushed to the cloud
- **SC-005**: Administrators can identify inactive devices (no sync activity in 24+ hours) from the device management screen
- **SC-006**: Existing installations upgrading from a legacy school identifier to MASSAR-based identity experience zero data loss and no manual reconfiguration

## Assumptions

- Phases 7.1–7.7 are fully implemented: institution database schema, OTP module, LAN discovery, server-side OTP, first-run setup page, IPC layer, and device management UI are all operational
- The existing sync push and pull engines (Phases 1–6) are functional and can be extended with hooks for heartbeat and revocation checks
- The admin device's sync configuration is considered the "golden" configuration — it is the source of truth when linking new devices
- Revocation enforcement via cloud is eventually consistent — there may be a delay of up to two sync cycles before a revoked device detects its revocation
- The origin device (first device that created the institution) cannot be revoked through the device management UI

## Dependencies

- **Phase 7.1** (Database Schema): `institution_config`, `linked_devices` tables must exist
- **Phase 7.2** (OTP Module): OTP verification must return sync config payload from admin device
- **Phase 7.6** (IPC Layer): Linking IPC channels must be registered and functional
- **Phase 7.7** (Device Management UI): Revocation UI must call the appropriate IPC channels
- **Phases 1–6** (Sync Engine): Push and pull engines must support extensibility for heartbeat updates and revocation checks

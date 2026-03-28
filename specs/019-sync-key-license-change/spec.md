# Feature Specification: Update Sync Key on License Status Change

**Feature Branch**: `019-sync-key-license-change`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "When the license status changes (trial to paid, paid to expired, reactivation, device deactivation), automatically update or clear sync_config.license_key to match the new state."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Device Deactivation Clears Sync Key (Priority: P1)

An admin deactivates their device from the license management screen. The system automatically clears the stored sync license key so that sync operations stop authenticating on behalf of a deactivated device.

**Why this priority**: A deactivated device should immediately lose sync access. Leaving a stale key in place allows the device to continue syncing after deactivation, which is a security and licensing integrity issue.

**Independent Test**: Activate a paid license, verify sync key is populated, then deactivate the device and confirm sync_config.license_key is cleared.

**Acceptance Scenarios**:

1. **Given** a device with an active paid license and a populated sync_config.license_key, **When** the admin deactivates the current device, **Then** sync_config.license_key is set to NULL
2. **Given** a device with an active paid license and a populated sync_config.license_key, **When** the admin deactivates the current device, **Then** any cached sync credentials in memory are also invalidated
3. **Given** a deactivated device, **When** background sync tasks attempt to run, **Then** they fail gracefully because no license key is available

---

### User Story 2 - Paid Activation Over Trial Replaces Sync Key (Priority: P2)

An admin who was using a trial license activates a paid license. The system replaces the trial sync key with the paid license key so that sync continues seamlessly under the paid plan.

**Why this priority**: This is the primary upgrade path. Users expect a smooth transition from trial to paid without manual key management.

**Independent Test**: Start with a trial license (auto-generated trial sync key), activate a paid license, and verify sync_config.license_key now contains the paid key.

**Acceptance Scenarios**:

1. **Given** a device with a trial sync key in sync_config.license_key, **When** the admin activates a paid license, **Then** sync_config.license_key is overwritten with the paid license key
2. **Given** a device with a trial sync key, **When** the admin activates a paid license, **Then** cached sync credentials are invalidated so subsequent sync operations use the new key

---

### User Story 3 - Reactivation After Deactivation Restores Sync Key (Priority: P3)

An admin who previously deactivated their device reactivates with a new or existing license key. The system writes the new key to sync_config.license_key, restoring sync capability.

**Why this priority**: Reactivation is a less frequent but important recovery path. The existing Feature 1 logic (activateLicense writes the key) already handles this, but this feature ensures cached credentials are also refreshed.

**Independent Test**: Deactivate a device (key is cleared), then activate a new license and verify the sync key is populated again.

**Acceptance Scenarios**:

1. **Given** a device with no sync key (previously deactivated), **When** the admin activates a license, **Then** sync_config.license_key is populated with the new key
2. **Given** a reactivated device, **When** background sync tasks run, **Then** they authenticate successfully with the new key

---

### User Story 4 - License Expiration Clears Sync Key (Priority: P3)

When a paid or trial license expires, the system detects the expiration and clears the stored sync key so that sync stops relying solely on server-side rejection.

**Why this priority**: Defense-in-depth measure. The Auth Lambda already rejects expired keys, but clearing locally ensures consistency and avoids confusion.

**Independent Test**: Set up a license with an expiration date in the past, trigger a status check, and verify sync_config.license_key is cleared.

**Acceptance Scenarios**:

1. **Given** a device with a paid license that has expired, **When** the system checks license status, **Then** sync_config.license_key is cleared
2. **Given** a device with a trial that has expired, **When** the system checks license status, **Then** sync_config.license_key is cleared
3. **Given** a device with an active (non-expired) license, **When** the system checks license status, **Then** sync_config.license_key is NOT cleared

---

### Edge Cases

- What happens when sync_config table does not exist yet (fresh install before sync migration)? All write/clear operations must be wrapped in error handling to avoid crashes.
- What happens during a race condition where deactivation and sync run concurrently? The sync operation should fail gracefully if the key disappears mid-operation.
- What happens if the admin deactivates while offline? The deactivation is local-only; the key is still cleared locally. The Auth Lambda will independently reject the key on next online sync attempt.
- What happens if the key is already NULL when a clear operation runs? The operation should succeed silently (idempotent).
- What happens when the license transitions to grace_warning or grace_expired status? The key should be cleared on grace_expired (sync should stop) but NOT on grace_warning (sync should continue during the warning period).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST clear sync_config.license_key when the current device is deactivated
- **FR-002**: System MUST invalidate any cached sync credentials in memory when the sync key is cleared or replaced
- **FR-003**: System MUST replace the sync key when a paid license is activated over an existing trial key (already covered by Feature 1; this feature ensures cache invalidation also occurs)
- **FR-004**: System MUST handle the case where sync_config table does not exist by silently catching errors during key clear/write operations
- **FR-005**: System MUST clear sync_config.license_key when a paid license transitions to expired status
- **FR-006**: System MUST clear sync_config.license_key when a trial transitions to expired status
- **FR-007**: System MUST clear sync_config.license_key when the license reaches grace_expired status
- **FR-008**: System MUST NOT clear the sync key during grace_warning status (sync should continue during the warning period)
- **FR-009**: System MUST NOT clear the sync key on transient status checks that return an active status
- **FR-010**: Clear operations MUST be idempotent (clearing an already-NULL key succeeds silently)

### Key Entities

- **sync_config.license_key**: The stored sync authentication key (TEXT, nullable). Set by Features 1 and 2, cleared/updated by this feature on status transitions.
- **License Status**: Computed on-the-fly from the licenses table. Possible values: active, expired, device_not_activated, grace_warning, grace_expired, suspended. No persistent status field exists — transitions are detected by comparing current computed status.
- **In-Memory Credential Cache**: Cached sync credentials held in memory by the sync module. Must be invalidated whenever the database key changes.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After device deactivation, the stored sync key is removed immediately (within the same operation) so no stale key persists
- **SC-002**: After paid license activation over a trial, sync operations use the new key on the very next sync cycle with zero manual intervention
- **SC-003**: After license expiration (paid or trial), the stored sync key is cleared so that sync stops without relying solely on server-side rejection
- **SC-004**: All sync key lifecycle operations (clear, replace, invalidate cache) complete without errors even when sync_config table does not exist
- **SC-005**: Lint and smoke tests pass with no regressions

## Assumptions

- Feature 1 (016-auto-sync-paid-key: save paid key on activation) is already implemented and merged
- Feature 2 (017-auto-sync-trial-key: auto-generate trial sync key) is already implemented and merged
- Feature 3 (018-hide-sync-license-field: hide license key field from UI) is already implemented and merged
- The Auth Lambda independently validates key expiration, so clearing an expired key locally is a defense-in-depth measure rather than the sole enforcement mechanism
- License expiration detection does not require a dedicated background polling loop — it can be checked at natural call points (e.g., when sync operations run or when license status is queried)
- The clearCredentials() function in the sync credentials module clears the in-memory cache but does not touch the database; a separate database clear operation is needed

## Dependencies

- **Feature 1** (016-auto-sync-paid-key): Provides the pattern for writing license keys to sync_config
- **Feature 2** (017-auto-sync-trial-key): Provides ensureTrialSyncKey and the trial key generation pattern
- **Feature 3** (018-hide-sync-license-field): UI no longer exposes the license key field, so automated management is the only path
- **sync_config table**: Must exist with license_key column (created by migration 2026-03-034)

## Scope Boundaries

### In Scope

- Clearing sync_config.license_key on device deactivation
- Invalidating in-memory credential cache on key changes
- Clearing sync key on detected license/trial expiration (including grace_expired)
- Ensuring the activation-time key write also invalidates cached credentials

### Out of Scope

- Changing how the Auth Lambda validates keys (server-side)
- Adding a background polling loop solely for license status monitoring
- Modifying the license key generation logic (Features 1 and 2)
- Adding UI indicators for sync key status (the field is already hidden by Feature 3)
- Handling multi-device key distribution or revocation across devices

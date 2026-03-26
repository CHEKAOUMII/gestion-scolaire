# Feature Specification: Save License Key on Paid Activation

**Feature Branch**: `016-auto-sync-paid-key`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "When activating a paid license, automatically save the original pre-hash key into sync_config.license_key for seamless sync authentication"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Paid license activation auto-populates sync key (Priority: P1)

An administrator activates a paid license key on a school device. The system validates the key, activates the license, and — as part of the same operation — stores the original (pre-hash) license key into the sync configuration. This enables the cloud sync feature to authenticate without requiring the admin to manually copy-paste the key into the sync settings page.

**Why this priority**: This is the core behavior — without it, administrators must manually enter their license key a second time in the sync settings page, which is error-prone and creates a support burden.

**Independent Test**: Can be fully tested by activating any valid paid license key and then querying the sync configuration to confirm the key was saved. Delivers immediate value by eliminating the manual sync key entry step.

**Acceptance Scenarios**:

1. **Given** a valid paid license key has not been activated on this device, **When** the admin activates the license successfully, **Then** the original (pre-hash) license key is saved in the sync configuration and is readable by the sync authentication system.
2. **Given** a valid paid license key is activated on a device that already has a different sync license key, **When** the activation succeeds, **Then** the sync configuration is updated with the new license key, replacing the old one.
3. **Given** a valid paid license key is activated, **When** the sync configuration storage is not yet available (e.g., fresh install before sync database migration), **Then** the license activation still succeeds without error — the sync key storage is silently skipped.

---

### User Story 2 - Re-activation preserves sync key consistency (Priority: P2)

An administrator re-activates the same license key on a device (e.g., after a reinstall or device merge). The system recognizes the device and updates the activation record. The sync configuration key remains consistent with the currently active license.

**Why this priority**: Re-activation is a common scenario (reinstalls, hardware changes) and must not break the sync key that was previously saved.

**Independent Test**: Can be tested by activating a license key, noting the sync key, then re-activating the same key and verifying the sync key is still present and correct.

**Acceptance Scenarios**:

1. **Given** a license key was previously activated on this device, **When** the same key is re-activated (exact match or fuzzy device match), **Then** the sync configuration retains the correct license key.

---

### Edge Cases

- What happens when the license key is invalid or expired? The activation fails before reaching the sync key storage step — no sync key change occurs.
- What happens when the device limit is reached? The activation is denied — no sync key change occurs.
- What happens when the device fingerprint doesn't match (device-locked key)? The activation is rejected — no sync key change occurs.
- What happens when the sync configuration table doesn't have a row yet? The default row (id=1) is inserted by database initialization — the UPDATE targets this row. If for any reason the row doesn't exist, the UPDATE affects zero rows (no error).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST save the original (pre-hash, full-format) license key into the sync configuration whenever a paid license is successfully activated.
- **FR-002**: The saved key MUST be in the exact format expected by the sync authentication system (the normalized key format: `GSLK-<base64>.<signature>`).
- **FR-003**: The sync key save MUST occur for all successful activation paths: new activation, re-activation (exact device match), and device reinstall merge (fuzzy match).
- **FR-004**: If the sync configuration storage is unavailable (table not yet created, missing row, or database error), the license activation MUST still succeed — the sync key save failure is silently handled.
- **FR-005**: When a new paid key is activated on a device that already has a sync key stored, the system MUST overwrite the existing sync key with the new one.
- **FR-006**: The sync key save MUST NOT introduce any new user-facing prompts, settings, or configuration steps — it is fully automatic and invisible to the user.

### Key Entities

- **Sync Configuration**: A single-row configuration record that holds sync settings including the license key used for cloud authentication. Key attribute: `license_key` (text, nullable).
- **License Key (normalized)**: The full original key string in `GSLK-<base64>.<signature>` format, before any hashing. This is the credential the sync system uses to authenticate with the cloud service.
- **License Activation**: The record of a license being activated on a specific device. The sync key save is a side-effect of successful activation.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of successful paid license activations result in the sync configuration containing the correct license key, with zero manual intervention required.
- **SC-002**: License activation completes successfully even when the sync configuration storage is unavailable, with no user-visible errors.
- **SC-003**: Administrators no longer need to manually enter a license key in the sync settings page after activating a paid license — the field is pre-populated automatically.
- **SC-004**: Existing lint checks and smoke tests continue to pass with no regressions.

## Assumptions

- The sync configuration table and its default row (id=1) are created by database initialization and migrations that run before license activation can occur in normal usage.
- The `license_key` column on the sync configuration table already exists (added by migration `2026-03-034`).
- The normalized key format produced during activation is identical to the format consumed by the sync authentication system.
- This feature does not need to handle trial license keys — that is a separate feature (Feature 2 in the plan).
- No new IPC channels or UI changes are required — this is purely internal main-process logic.

## Scope Boundaries

**In scope:**
- Saving the license key during paid activation only
- Handling all three successful activation paths (new, re-activation, reinstall merge)
- Graceful handling of sync config unavailability

**Out of scope:**
- Trial license key generation (Feature 2)
- Hiding the license key field from sync settings UI (Feature 3)
- Updating sync key on license status changes like expiration or deactivation (Feature 4)
- Any changes to the sync authentication flow itself
- Any new IPC channels or renderer-side changes

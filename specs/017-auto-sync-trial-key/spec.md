# Feature Specification: Auto-Generate Trial Sync Key

**Feature Branch**: `017-auto-sync-trial-key`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "On app startup, if the license status is trial (active) and sync_config.license_key is empty, auto-generate a trial sync key using the offline key generation mechanism."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trial User Gets Automatic Sync Key (Priority: P1)

A school administrator installs the application for the first time and begins using it during the trial period. When the app starts up, the system automatically generates a trial sync key and stores it in the sync configuration. The administrator does not need to manually enter any license key to enable sync functionality during trial — it just works.

**Why this priority**: This is the core feature. Without automatic key generation, trial users must manually enter a sync key, which creates friction and prevents seamless sync onboarding.

**Independent Test**: Launch the app with an active trial license and an empty sync license key field. Verify the key is automatically populated after startup completes.

**Acceptance Scenarios**:

1. **Given** the app is launching for the first time with a fresh trial, **When** the startup sequence runs, **Then** a trial sync key is generated and stored in the sync configuration
2. **Given** the app has an active trial and no sync license key, **When** startup completes, **Then** the generated key is a valid offline license key with trial parameters (basic plan, trial expiry date, TRIAL customer reference)
3. **Given** the app has an active trial, **When** the trial sync key is generated, **Then** the key can be used to authenticate with the sync service

---

### User Story 2 - Existing Key Is Preserved on Restart (Priority: P1)

A user (trial or paid) already has a sync license key configured. When the app restarts, the system detects that a key already exists and does not overwrite it. This prevents paid keys from being replaced by trial keys, and avoids unnecessary key regeneration on every startup.

**Why this priority**: Equally critical — overwriting an existing paid key with a trial key would break sync for paid users.

**Independent Test**: Set up the app with a pre-existing license key in sync config, restart the app, and verify the key remains unchanged.

**Acceptance Scenarios**:

1. **Given** a sync license key already exists in the configuration, **When** the app starts up, **Then** the existing key is not modified or replaced
2. **Given** a paid license key is stored in sync config, **When** the app restarts during an active trial period, **Then** the paid key is preserved

---

### User Story 3 - Non-Trial Users Are Unaffected (Priority: P2)

A user whose trial has expired or who has no active trial does not get a trial key auto-generated. The feature only activates when the license status is "trial" and the trial period is still active.

**Why this priority**: Important for correctness — generating keys for expired trials would create keys that cannot authenticate.

**Independent Test**: Launch the app with an expired trial and no sync key. Verify no key is generated.

**Acceptance Scenarios**:

1. **Given** the trial period has expired, **When** the app starts up, **Then** no trial sync key is generated
2. **Given** the user has a paid license (not trial), **When** the app starts up with no sync key, **Then** no trial key is generated (paid key handling is a separate feature)

---

### User Story 4 - Graceful Handling When Sync Infrastructure Is Missing (Priority: P2)

On a fresh install or when the sync configuration table does not yet exist (e.g., migration has not run), the key generation process does not crash the app or block startup. The feature silently skips and the app continues normally.

**Why this priority**: The app must remain stable regardless of database migration state — startup failures are unacceptable.

**Independent Test**: Launch the app before the sync configuration migration has run. Verify the app starts without errors.

**Acceptance Scenarios**:

1. **Given** the sync configuration table does not exist yet, **When** the app starts up, **Then** the key generation is skipped without errors
2. **Given** the key generation fails for any reason, **When** the app starts up, **Then** the failure is logged but does not block the rest of the startup sequence

---

### Edge Cases

- What happens if the trial end date is in the past but trial status is still reported as active due to a race condition? The generated key would have an expired `exp` date and would be rejected by the sync auth service — acceptable behavior, no special handling needed.
- What happens if the local signing secret does not match the server-side secret? The generated key will fail authentication at the sync auth service. This is expected and handled at the sync layer, not at key generation time.
- What happens if the license key column contains an empty string vs NULL? Both should be treated as "no key exists" — the check must handle both cases.
- What happens if key generation is called concurrently (e.g., rapid restart)? Since the check-then-write runs synchronously in the main process startup sequence, concurrency is not a concern.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST check whether a sync license key already exists in the sync configuration during app startup
- **FR-002**: System MUST check the current license status to determine if the user is in an active trial period
- **FR-003**: System MUST generate an offline license key with trial parameters (basic plan, trial expiry date, TRIAL customer reference, no online validation required) when both conditions are met: no existing key AND active trial
- **FR-004**: System MUST store the generated trial key in the sync configuration so it is available for sync authentication
- **FR-005**: System MUST NOT generate or store a trial key if a sync license key already exists (regardless of whether the existing key is a trial key or paid key)
- **FR-006**: System MUST NOT generate a trial key if the license status is anything other than "trial" with an active trial period
- **FR-007**: System MUST treat both NULL and empty string values for the license key as "no key exists"
- **FR-008**: System MUST NOT block or crash the app startup if key generation fails or if the sync configuration table does not exist
- **FR-009**: System MUST run the key generation check after the database is initialized but before sync background tasks start
- **FR-010**: System MUST log any errors during key generation without propagating them to the startup sequence

### Key Entities

- **Sync Configuration**: The stored sync settings including the license key used for sync authentication. Key attribute: `license_key` (text, nullable).
- **Trial License Key**: An auto-generated offline license key with parameters: basic plan tier, expiry matching the trial end date, TRIAL customer reference, no online validation required.
- **License Status**: The current activation state of the app, including whether a trial is active and the trial end date.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of new trial installations have a sync license key automatically available after first launch — no manual key entry required
- **SC-002**: Zero instances of existing license keys being overwritten by the automatic trial key generation
- **SC-003**: App startup time is not noticeably affected by the key generation check (sub-50ms overhead)
- **SC-004**: Zero app startup failures caused by the key generation feature, regardless of database state or migration status
- **SC-005**: Generated trial keys are accepted by the sync authentication service when the local signing secret matches the server-side secret

## Assumptions

- The sync configuration table may not exist on first launch if the database migration has not yet run. The feature must handle this gracefully.
- The local signing secret used to generate the key must match the server-side secret for the key to be valid for sync authentication. This is an operational requirement, not something the feature needs to verify.
- The key generation mechanism is already proven and reliable — this feature reuses it without modification.
- Feature 1 (Save License Key on Paid Activation) establishes the pattern of writing to `sync_config.license_key`. This feature follows the same pattern.
- The trial end date is available from the license status check and is used as the key's expiry date.

## Dependencies

- **Feature 1 (auto-sync-paid-key)**: Should land first to establish the pattern. Conceptually independent but sequentially ordered.
- **Database migration**: The `sync_config.license_key` column must exist. The feature handles the case where this migration has not yet run.
- **Offline key generation**: Relies on the existing key generation function with no modifications needed.
- **License status check**: Relies on the existing license status function to determine trial state.

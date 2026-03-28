# Feature Specification: Hide License Key Field from Sync Settings UI

**Feature Branch**: `018-hide-sync-license-field`
**Created**: 2026-03-26
**Status**: Draft
**Input**: User description: "Hide License Key Field from Sync Settings UI — the license key is now managed automatically (Features 1 & 2), so remove it from the admin-facing form."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Admin Opens Sync Settings Page (Priority: P1)

An admin navigates to the sync settings page to configure cloud synchronization. The license key field is no longer visible because the system now manages it automatically. The admin sees only the fields they need to interact with (school ID, auth URL, region, interval, etc.), resulting in a cleaner, less confusing form.

**Why this priority**: This is the core purpose of the feature — removing visual clutter and preventing manual interference with an auto-managed field.

**Independent Test**: Open the sync settings page and visually confirm the license key input field and its label are not displayed.

**Acceptance Scenarios**:

1. **Given** the sync settings page loads, **When** the admin views the configuration form, **Then** the license key field and its label are not visible anywhere on the page.
2. **Given** the sync settings page loads, **When** the admin inspects the form layout, **Then** the remaining fields (school ID, auth URL, region, interval, batch size, retries, retention, snapshot interval) are displayed without any visual gap or layout disruption where the license key field used to be.

---

### User Story 2 - Admin Saves Sync Settings Without License Key (Priority: P1)

An admin fills in the sync configuration fields and submits the form. The save operation succeeds without requiring or sending a license key value, since the key is managed automatically by the system.

**Why this priority**: Equally critical — if the save logic still references the hidden field, it could overwrite the auto-managed key with null/empty or cause errors.

**Independent Test**: Fill in the sync config form and submit it. Verify the save succeeds, the auto-managed license key in the database is not overwritten or cleared, and a success toast appears.

**Acceptance Scenarios**:

1. **Given** the admin has filled in sync settings, **When** the admin clicks Save, **Then** the settings are saved successfully and a success confirmation is shown.
2. **Given** a license key was previously auto-set by the system, **When** the admin saves sync settings, **Then** the existing license key value in the database is preserved unchanged.
3. **Given** the admin submits the form with sync enabled, **When** validation runs, **Then** the license key is not included in the validation checks (no error about a missing license key).

---

### User Story 3 - RTL Layout Integrity (Priority: P2)

The sync settings page uses a right-to-left (Arabic) layout. After hiding the license key field, the form layout remains visually correct with no gaps, misaligned labels, or broken spacing in RTL mode.

**Why this priority**: Layout integrity is important for usability but is secondary to functional correctness.

**Independent Test**: Open the sync settings page and verify the form renders correctly in RTL mode with no visual artifacts from the removed field.

**Acceptance Scenarios**:

1. **Given** the app is running in RTL mode, **When** the sync settings page loads, **Then** all remaining form fields are properly aligned and spaced without gaps.

---

### Edge Cases

- What happens if a user manually un-hides the field via browser DevTools? The field should still be excluded from the save payload, so manual edits to the hidden field have no effect on the saved configuration.
- What happens on a fresh install where no license key exists yet? The page loads normally without errors — the hidden field's absence does not affect form initialization.
- What happens if the auto-managed license key is null/empty in the database? The page loads normally; the hidden field is simply not shown regardless of its value.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The license key input field and its label MUST NOT be visible to the admin on the sync settings page.
- **FR-002**: The license key field MUST remain in the HTML source (hidden, not deleted) to preserve the existing data flow and allow potential future re-enablement.
- **FR-003**: The form save operation MUST NOT include the license key in the payload sent to the backend, preventing accidental overwrites of the auto-managed key.
- **FR-004**: The form load operation MAY continue to populate the hidden field's value (harmless, maintains data flow consistency).
- **FR-005**: The form validation logic MUST NOT require or check the license key field when sync is enabled.
- **FR-006**: The remaining form fields MUST render without layout gaps or visual artifacts after the license key field is hidden.

### Key Entities

- **sync_config**: Configuration record for cloud synchronization. The `license_key` field within this record is now managed automatically and should not be exposed in the UI for manual editing.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The license key field is not visible on the sync settings page under any normal usage scenario.
- **SC-002**: Admins can save sync settings successfully without encountering errors related to the license key field.
- **SC-003**: The auto-managed license key stored in the database is never overwritten or cleared by the form save operation.
- **SC-004**: The sync settings form passes visual inspection in RTL layout with no gaps or misalignment.
- **SC-005**: All existing lint checks and smoke tests continue to pass.

## Assumptions

- Features 1 (Save License Key on Paid Activation) and 2 (Auto-Generate Trial Sync Key) have already landed, meaning the license key is reliably auto-managed before this feature ships.
- The hidden HTML element does not need to be fully removed from the DOM — hiding it is sufficient.
- The `loadConfig()` function continuing to set the hidden field's value is acceptable and does not introduce any side effects.

## Dependencies

- **Feature 1** (paid license key auto-save): Must be in place so the key is auto-managed.
- **Feature 2** (auto-generate trial sync key): Must be in place so trial users also get an auto-managed key.
- Without both, hiding the field removes the only way for admins to set the license key.

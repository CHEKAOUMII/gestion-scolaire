# Feature Specification: Device Management UI

**Feature Branch**: `014-device-management-ui`
**Created**: 2026-03-23
**Status**: Draft
**Input**: User description: "Phase 7.7: Device Management UI — Add device management section to sync settings page with current device info, OTP generation for admin, and linked devices table with revoke capability"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — View Current Device Info (Priority: P1)

An administrator or staff member navigates to the sync settings page and immediately sees their own device's identity: the device name (hostname), a truncated device hash, and the institution's MASSAR code. This provides at-a-glance confirmation that the device is correctly linked to the right institution.

**Why this priority**: Before any management actions, users must understand which device they are on and which institution it belongs to. This is the foundational context for all other device operations.

**Independent Test**: Can be fully tested by opening the sync settings page on any linked device and verifying all three pieces of information (device name, truncated hash, MASSAR code) are displayed correctly.

**Acceptance Scenarios**:

1. **Given** a device that has completed institution setup, **When** the user navigates to sync settings, **Then** the page displays the current device's name, a truncated device hash (first 8 characters), and the institution MASSAR code.
2. **Given** a device where the institution name was provided during setup, **When** viewing the current device section, **Then** the institution name is also displayed alongside the MASSAR code.
3. **Given** any user role (admin or non-admin), **When** viewing the current device section, **Then** the device info is visible to all roles.

---

### User Story 2 — View Linked Devices Table (Priority: P1)

An administrator views a table of all devices linked to the institution. Each row shows the device name, how it was linked (new setup, LAN OTP, or server OTP), when it was last seen, and its status (active or revoked). This gives the admin a clear overview of the institution's device fleet.

**Why this priority**: Visibility into the device fleet is critical for administration and security — admins need to know which devices have access before they can take management actions like revoking.

**Independent Test**: Can be tested by linking 2+ devices to an institution, then navigating to sync settings on the admin device and verifying all linked devices appear in the table with correct metadata.

**Acceptance Scenarios**:

1. **Given** an institution with 3 linked devices, **When** the admin views the linked devices section, **Then** a table shows all 3 devices with columns: Device Name, Linked Via, Last Seen, Status, and Actions.
2. **Given** a device that was linked via LAN OTP, **When** displayed in the table, **Then** the "Linked Via" column shows the appropriate Arabic label for LAN linking.
3. **Given** a device that has not synced in a long time, **When** displayed in the table, **Then** the "Last Seen" column shows a relative time in Arabic (e.g., "منذ 3 أيام").
4. **Given** a revoked device, **When** displayed in the table, **Then** its status shows as "ملغى" (revoked) with a distinct visual indicator, and no revoke action is available for it.
5. **Given** a non-admin user, **When** viewing the linked devices section, **Then** the table is visible but the Actions column (revoke buttons) is hidden.

---

### User Story 3 — Generate OTP for Device Linking (Priority: P2)

An administrator clicks a "Generate linking code" button to produce a 6-digit OTP that another device can use to join the institution. The OTP is displayed in large, easily readable digits alongside a countdown timer showing remaining validity. The admin can cancel the OTP before it expires.

**Why this priority**: OTP generation is the admin's primary action for onboarding new devices. It depends on device info (P1) being visible for context but delivers distinct value — enabling multi-device linking.

**Independent Test**: Can be tested by clicking the generate button, verifying the 6-digit code appears with a countdown timer, waiting for expiry (or cancelling), and confirming the UI resets.

**Acceptance Scenarios**:

1. **Given** an admin user with no active OTP, **When** they click the "توليد كود ربط" (Generate linking code) button, **Then** a 6-digit OTP is displayed in large, clearly readable font with a countdown timer showing minutes and seconds remaining.
2. **Given** an active OTP is displayed, **When** the admin clicks the cancel button, **Then** the OTP is cancelled, the display resets to the initial state showing only the generate button, and a confirmation toast appears.
3. **Given** an active OTP is displayed, **When** the countdown reaches zero, **Then** the OTP display automatically resets to the initial state and a toast informs the admin that the code has expired.
4. **Given** a non-admin user, **When** viewing the OTP section, **Then** the generate button and entire OTP generation area are hidden.
5. **Given** an active OTP already exists, **When** the admin clicks generate again, **Then** the previous OTP is invalidated and a new one is generated (only one active OTP at a time).

---

### User Story 4 — Revoke a Linked Device (Priority: P2)

An administrator revokes a linked device, preventing it from syncing with the institution. A confirmation prompt appears before the action is executed. The current device (the one the admin is using) cannot be revoked.

**Why this priority**: Revoking devices is critical for security (lost/stolen devices, staff changes) but depends on the device table (P1) being in place.

**Independent Test**: Can be tested by linking a secondary device, then revoking it from the admin device and confirming its status changes to "revoked" in the table.

**Acceptance Scenarios**:

1. **Given** an admin viewing the linked devices table, **When** they click "إلغاء" (Revoke) on a device that is not the current device, **Then** a confirmation dialog appears asking to confirm the revocation with the device name displayed.
2. **Given** the admin confirms the revocation, **When** the revocation completes, **Then** the device's status changes to "ملغى" (revoked) in the table, the revoke button disappears for that row, and a success toast is shown.
3. **Given** the admin is viewing the current device's row, **When** looking at the Actions column, **Then** the revoke button is not available (a device cannot revoke itself).
4. **Given** a revocation fails (e.g., due to a database error), **When** the error occurs, **Then** an error toast is displayed with a user-friendly Arabic message and the device's status remains unchanged.

---

### User Story 5 — OTP Status Persistence Across Navigation (Priority: P3)

If an admin generates an OTP and then briefly navigates away from the sync settings page and returns, the active OTP and its remaining countdown are restored rather than showing the initial state.

**Why this priority**: This is a quality-of-life enhancement. Without it, admins might think their OTP disappeared and generate a new one unnecessarily.

**Independent Test**: Can be tested by generating an OTP, navigating to another page, returning to sync settings, and verifying the OTP and countdown are still displayed with the correct remaining time.

**Acceptance Scenarios**:

1. **Given** an admin has generated an OTP with 7 minutes remaining, **When** they navigate away and return to sync settings within those 7 minutes, **Then** the OTP digits and an updated countdown (reflecting elapsed time) are displayed.
2. **Given** an admin has generated an OTP that expired while they were on another page, **When** they return to sync settings, **Then** the initial state (generate button only) is shown.

---

### Edge Cases

- What happens when the devices table is empty (only the current device exists)? The table should show only the current device row with a contextual message indicating no other devices are linked.
- What happens when the institution setup has not been completed? The device management section should not be rendered; instead the page should indicate that setup is required first.
- What happens if two admins on different devices both generate OTPs simultaneously? Only one active OTP should exist per institution — the most recently generated one replaces any previous one.
- What happens when the page loads but the backend call to fetch linked devices fails? An error state should be shown in the table area with a retry option.
- How does the linked devices table handle a large number of devices (e.g., 20+)? The table should remain scrollable and performant. Given that schools typically have fewer than 20 devices, pagination is not required — a simple scrollable table suffices.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display the current device's name, truncated hash (first 8 characters), and institution MASSAR code in a dedicated section at the top of the device management area.
- **FR-002**: System MUST display the institution name alongside the MASSAR code when one has been configured.
- **FR-003**: System MUST display a table of all linked devices showing: Device Name, Linked Via (method), Last Seen (relative time in Arabic), Status (active/revoked), and an Actions column.
- **FR-004**: The "Linked Via" column MUST show Arabic labels for each linking method: "إعداد جديد" (new setup), "ربط محلي" (LAN OTP), "ربط عبر السيرفر" (server OTP).
- **FR-005**: System MUST provide a "توليد كود ربط" (Generate linking code) button visible only to admin users.
- **FR-006**: When an OTP is generated, system MUST display the 6-digit code in large, clearly readable font alongside a countdown timer showing remaining validity in minutes and seconds.
- **FR-007**: System MUST provide a cancel button to invalidate an active OTP before its natural expiry.
- **FR-008**: System MUST automatically reset the OTP display to the initial state (generate button only) when the countdown reaches zero.
- **FR-009**: System MUST ensure only one active OTP exists per institution at any time — generating a new OTP invalidates any previous one.
- **FR-010**: System MUST allow admins to revoke any linked device except the current device.
- **FR-011**: System MUST show a confirmation dialog before executing a device revocation, displaying the target device's name.
- **FR-012**: After successful revocation, the device's status MUST update to "ملغى" (revoked) in the table without requiring a full page reload.
- **FR-013**: The Actions column (revoke buttons) MUST be hidden for non-admin users using the existing admin-only visibility pattern.
- **FR-014**: The OTP generation section MUST be hidden for non-admin users.
- **FR-015**: All user-facing text MUST be in Arabic, consistent with the rest of the application.
- **FR-016**: When returning to the sync settings page while an OTP is still active, the system MUST restore the OTP display with the correct remaining countdown time.
- **FR-017**: System MUST show a contextual empty state when no other devices besides the current one are linked to the institution.
- **FR-018**: System MUST show success/error feedback via toast notifications for all actions (generate OTP, cancel OTP, revoke device).
- **FR-019**: The current device's row in the linked devices table MUST be visually distinguished (e.g., highlighted or labeled) so the admin can identify it.

### Key Entities

- **Current Device**: The device the user is currently operating. Identified by its device hash. Displays name (hostname), truncated hash, and linked institution info.
- **Linked Device**: A device registered in the institution's device registry. Has a name, hash, linking method, last-seen timestamp, and status (active or revoked).
- **OTP (One-Time Password)**: A 6-digit time-limited code generated by an admin to authorize new device linking. Has a creation time, expiry time, and status (active, used, or expired).
- **Institution**: The school/institution identified by its MASSAR code. Serves as the organizational unit that devices are linked to.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can identify their current device and institution within 2 seconds of the device management section loading.
- **SC-002**: Admins can generate a linking code in a single click, with the code displayed within 1 second.
- **SC-003**: The OTP countdown timer updates in real-time (every second) with no visible lag or drift.
- **SC-004**: Admins can view the status of all linked devices in a single scrollable view without pagination for typical school deployments (up to 20 devices).
- **SC-005**: Device revocation completes and reflects in the UI within 2 seconds of confirmation.
- **SC-006**: All device management actions (generate OTP, cancel OTP, revoke device) provide immediate visual feedback via toast notifications.
- **SC-007**: Non-admin users see all informational content (device info, device table) but cannot access any management actions (generate OTP, revoke device).
- **SC-008**: The device management section integrates seamlessly with the existing sync settings page layout and visual style, requiring no additional learning for users familiar with the sync settings.

## Assumptions

- The IPC channels for device management (`linking:generateOtp`, `linking:cancelOtp`, `linking:getOtpStatus`, `linking:getLinkedDevices`, `linking:revokeDevice`, `linking:getCurrentDevice`) are implemented and registered by the time this UI is built (Phase 7.6 dependency).
- The `linked_devices` and `institution_config` database tables exist with the schema defined in Phase 7.1.
- The existing admin-only visibility pattern (`sync-readonly` body class + `admin-only` CSS class + conditional rendering) is used for consistency.
- The `settings-sync.html` page exists or will be created as part of this phase (currently only `js/pages/settings-sync.js` exists without a companion HTML file).
- Toast notifications use the existing global `showToast()` function available in the application.
- The `formatRelativeTime()` helper already in `settings-sync.js` is reused for the "Last Seen" column.
- Schools typically have fewer than 20 linked devices, so pagination in the devices table is unnecessary.
- The OTP has a 10-minute TTL as defined in Phase 7.2.

## Dependencies

- **Phase 7.6 (IPC Layer)**: The IPC channels for all device management operations must be implemented before this UI can function.
- **Phase 7.1 (Database Schema)**: The `institution_config`, `linked_devices`, and `device_otp` tables must exist.
- **Phase 7.2 (OTP Module)**: The OTP generation and verification logic must be operational for the OTP generation UI to work.
- **Existing sync settings page**: The device management section is added to the existing sync settings page, requiring that page's structure to be stable.

## Out of Scope

- Device linking flow (handled by the first-run setup page in Phase 7.5).
- OTP verification from the linking device's perspective (handled by Phase 7.5).
- LAN discovery and server-side OTP verification logic (Phases 7.3 and 7.4).
- Sync integration and revocation enforcement across the network (Phase 7.8).
- Editing device names or institution details from this UI.
- Notification/alerting when a new device links to the institution.

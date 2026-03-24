# Feature Specification: First-Run Setup Page

**Feature Branch**: `012-first-run-setup`
**Created**: 2026-03-22
**Status**: Draft
**Input**: User description: "Phase 7.5 from eager-drifting-yeti.md — First-Run Setup Page for institution device onboarding"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - New Institution Setup (Priority: P1)

A school administrator launches the application for the very first time on the school's first device. They are presented with a full-screen setup page (no sidebar, no header) where they choose "مؤسسة جديدة" (New Institution). They enter their school's MASSAR code (Ministry identifier), optionally provide an institution name, and create an admin account with a name and password. Upon completion, the system stores the institution configuration, creates the admin account, registers the device, and redirects to the main login page.

**Why this priority**: This is the foundational flow — without it, no institution can be created in the system. Every school's first device must go through this path.

**Independent Test**: Can be fully tested by launching the app with no institution configured, completing the new-institution form, and verifying redirect to the login page with a working admin account.

**Acceptance Scenarios**:

1. **Given** the application has never been set up (no institution record exists), **When** the user launches the app, **Then** the full-screen setup page is displayed instead of the login page.
2. **Given** the user is on the setup page, **When** they select "مؤسسة جديدة", **Then** they see a form requesting MASSAR code, optional institution name, and admin account fields (name, password, confirm password).
3. **Given** the user has filled the new-institution form with valid data, **When** they submit, **Then** the institution configuration is stored, the admin account is created, the current device is registered, and the user is redirected to the main application login page.
4. **Given** the user enters a MASSAR code in an invalid format, **When** they attempt to submit, **Then** a validation error is shown and submission is blocked.
5. **Given** the user enters mismatched passwords, **When** they attempt to submit, **Then** a validation error is shown indicating the passwords do not match.

---

### User Story 2 - Link to Existing Institution via OTP (Priority: P1)

A staff member launches the application on a second (or subsequent) device at the school. They choose "ربط بمؤسسة موجودة" (Link to Existing Institution) on the setup page. They enter the school's MASSAR code and the 6-digit OTP that the admin generated from the first device. The system attempts LAN discovery first, then falls back to server verification, imports the institution configuration, and redirects to the main login page.

**Why this priority**: This is equally critical — schools need multiple devices linked to the same institution. Without this flow, multi-device operation is impossible.

**Independent Test**: Can be tested by setting up an institution on one device, generating an OTP, then launching a fresh app instance and completing the linking flow with the OTP.

**Acceptance Scenarios**:

1. **Given** the user is on the setup page, **When** they select "ربط بمؤسسة موجودة", **Then** they see a form requesting MASSAR code and a 6-digit OTP input.
2. **Given** the user enters a valid MASSAR code and correct OTP, **When** they submit, **Then** the system attempts LAN discovery first, then server fallback if LAN is unavailable, imports configuration, registers the device, and redirects to the main login page.
3. **Given** the admin device is on the same local network, **When** the linking device submits the OTP, **Then** the system discovers the admin device via LAN and verifies directly without internet.
4. **Given** the admin device is NOT on the same local network, **When** the linking device submits the OTP, **Then** the system falls back to server-based verification after a brief LAN discovery timeout.
5. **Given** the user enters an incorrect OTP, **When** they submit, **Then** an error message is displayed indicating the code is invalid.
6. **Given** the OTP has expired (beyond 10-minute window), **When** the user submits, **Then** an error message indicates the code has expired and they should request a new one from the admin.

---

### User Story 3 - Startup Redirect for Existing Installations (Priority: P2)

A user with an already-configured installation updates the application to a version that includes the setup page. When they launch the app, the system detects that setup is already completed (either via prior setup or via the migration that auto-populates from existing sync configuration) and redirects directly to the main login page — they never see the setup page.

**Why this priority**: Important for upgrade compatibility — existing users must not be disrupted by the new setup flow.

**Independent Test**: Can be tested by upgrading an existing installation and verifying the app loads the login page directly without showing the setup screen.

**Acceptance Scenarios**:

1. **Given** an existing installation with `setup_completed` flagged in institution configuration, **When** the user launches the app, **Then** the main login page is shown directly.
2. **Given** an existing installation that had a school identifier set prior to upgrade, **When** the data migration runs, **Then** institution configuration is auto-populated with setup marked as completed and the user is never shown the setup page.

---

### User Story 4 - Mode Selection Navigation (Priority: P3)

A user on the setup page initially selects one mode (e.g., "Link to Existing") but realizes they need the other mode (e.g., "New Institution"). They can navigate back to the mode selection step and choose the other option.

**Why this priority**: Quality-of-life feature — users should not be locked into a choice before submitting.

**Independent Test**: Can be tested by selecting one mode, then navigating back and selecting the other, verifying the correct form is displayed.

**Acceptance Scenarios**:

1. **Given** the user is on Step 2 (either new or link form), **When** they click a back/return control, **Then** they return to Step 1 (mode selection) with no data loss or side effects.

---

### Edge Cases

- What happens when the user closes the app mid-setup and reopens it? The setup page should appear again since setup was not completed.
- What happens if the device loses network connectivity during OTP verification via server? An appropriate error message should be shown, and the user should be able to retry.
- What happens if two users try to set up a "new institution" with the same MASSAR code on two separate devices simultaneously? The second device should use the "link to existing" flow instead; conflicts are handled at the sync/server level.
- What happens if the MASSAR code input contains extra whitespace? The system should normalize input by trimming whitespace.
- What happens if the admin account password is too short? A minimum password length should be enforced with a clear validation message.
- What happens if the user rapidly taps the submit button multiple times? The system should prevent duplicate submissions by disabling the button after the first click and showing a loading state.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST display a full-screen setup page (no sidebar, no header) when no institution configuration exists.
- **FR-002**: System MUST provide two setup modes: "New Institution" (مؤسسة جديدة) and "Link to Existing" (ربط بمؤسسة موجودة), presented as selectable cards.
- **FR-003**: In "New Institution" mode, the system MUST collect: MASSAR code (required, validated format), institution name (optional), admin name (required), admin password (required), and password confirmation (required).
- **FR-004**: System MUST validate MASSAR code format before allowing submission (alphanumeric, matching Ministry format conventions).
- **FR-005**: System MUST validate that password and password confirmation fields match before allowing submission.
- **FR-006**: System MUST enforce a minimum password length of 6 characters for the admin account.
- **FR-007**: In "New Institution" mode, on successful submission the system MUST: store institution configuration, create the admin user account, register the current device in the device registry, and redirect to the main application page.
- **FR-008**: In "Link to Existing" mode, the system MUST collect: MASSAR code (required) and a 6-digit OTP (required).
- **FR-009**: The OTP input MUST be presented as individual large digit boxes (one per digit) for clear, accessible entry.
- **FR-010**: On OTP submission, the system MUST first attempt LAN-based discovery and verification, then fall back to server-based verification if LAN fails.
- **FR-011**: The system MUST display progress feedback during verification, indicating whether LAN or server verification is in progress (e.g., "جاري البحث في الشبكة المحلية..." then "جاري التحقق عبر السيرفر...").
- **FR-012**: On successful OTP verification and linking, the system MUST import institution configuration, register the device, and redirect to the main application page.
- **FR-013**: The system MUST display clear error messages in Arabic for all failure scenarios (invalid OTP, expired OTP, network errors, validation failures).
- **FR-014**: At application startup, the system MUST check institution configuration status and redirect to the setup page if setup is not completed, or to the main login page if setup is completed.
- **FR-015**: The setup page MUST allow the user to navigate back from Step 2 (form) to Step 1 (mode selection).
- **FR-016**: The setup page MUST follow RTL (right-to-left) layout conventions consistent with the rest of the application.
- **FR-017**: If the app is closed before setup completes, the next launch MUST show the setup page again.
- **FR-018**: The submit button MUST be disabled after first click during processing to prevent duplicate submissions.

### Key Entities

- **Institution Configuration**: Represents the school's identity within the system. Key attributes: MASSAR code (unique Ministry identifier), institution name, setup completion status, setup mode (new vs. linked), originating device identifier.
- **Device**: Represents a physical machine running the application. Key attributes: device identifier (hardware-based hash), device name, linking method (setup-new, OTP-LAN, OTP-server), status (active/revoked), last activity timestamp.
- **Admin Account**: The first user account created during new-institution setup. Key attributes: username, securely stored password, administrative role.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of first-time users are automatically directed to the setup page on application launch.
- **SC-002**: Users can complete the "New Institution" setup flow in under 2 minutes.
- **SC-003**: Users can complete the "Link to Existing" flow in under 1 minute (excluding OTP generation time on the admin device).
- **SC-004**: 100% of existing installations (upgraded from pre-setup versions) bypass the setup page and load the main application directly.
- **SC-005**: OTP verification via LAN completes within 5 seconds when both devices are on the same network.
- **SC-006**: When LAN is unavailable, server-based fallback verification completes within 10 seconds on a standard internet connection.
- **SC-007**: All validation errors and progress messages are displayed in Arabic, consistent with the application's language.
- **SC-008**: The setup page renders correctly in RTL layout with no visual glitches or misaligned elements.
- **SC-009**: 95% of users successfully complete the appropriate setup flow on their first attempt without external assistance.

## Assumptions

- The MASSAR code follows a consistent alphanumeric format assigned by the Moroccan Ministry of Education (e.g., "M320456").
- The OTP module (Phase 7.2), LAN discovery service (Phase 7.3), server OTP verification (Phase 7.4), and IPC layer (Phase 7.6) are implemented and available before this feature is built.
- The database schema (Phase 7.1) including institution configuration, OTP, and linked devices tables are already in place.
- The application's existing design system, dark mode support, and Tailwind CSS styling conventions apply to the setup page.
- Minimum password length of 6 characters is a reasonable default for a school management application operating in a local/LAN environment.
- The setup page uses the same RTL conventions and Arabic language as all other pages in the application.

## Scope Boundaries

### In Scope

- Full-screen setup page with two-step flow (mode selection, then mode-specific form)
- New institution creation with admin account
- Device linking via OTP with LAN-first, server-fallback strategy
- Startup redirect logic based on institution configuration status
- Input validation (MASSAR format, password match, password length, OTP format)
- Progress indicators during OTP verification
- Arabic error messages and RTL layout
- Back navigation from Step 2 to Step 1

### Out of Scope

- OTP generation UI (handled by Phase 7.7: Device Management UI)
- OTP module internals (handled by Phase 7.2)
- LAN discovery service (handled by Phase 7.3)
- Server-side OTP verification endpoint (handled by Phase 7.4)
- IPC channel implementation (handled by Phase 7.6)
- Device management and revocation (handled by Phase 7.7)
- Sync integration with DynamoDB (handled by Phase 7.8)
- Modifying the existing login page or dashboard

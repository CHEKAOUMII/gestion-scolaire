# Feature Specification: Sync Settings UI

**Feature Branch**: `006-sync-settings-ui`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User description: "Phase 6 — Sync Settings UI from DynamoDB Sync Executive Summary"

## User Scenarios & Testing

### User Story 1 - View Sync Status at a Glance (Priority: P1)

An administrator opens the sync settings page and immediately sees the current synchronization status: whether sync is enabled, whether the app is currently connected to AWS, when the last push and pull occurred, and how many changes are pending or failed. This gives the admin confidence that data is flowing between school PCs without needing to check each machine individually.

**Why this priority**: Without status visibility, administrators have no way to know if sync is working. This is the fundamental value proposition of the entire settings page — making the invisible visible.

**Independent Test**: Can be fully tested by navigating to the sync settings page and verifying that status information is displayed correctly for various sync states (idle, syncing, error, offline).

**Acceptance Scenarios**:

1. **Given** sync is enabled and operating normally, **When** the admin opens the sync settings page, **Then** they see a status panel showing "connected" state, last push/pull timestamps in human-readable format, and zero pending/failed counts.
2. **Given** sync is enabled but the network is unavailable, **When** the admin opens the sync settings page, **Then** they see an "offline" indicator with the count of queued changes waiting to be pushed.
3. **Given** sync is disabled, **When** the admin opens the sync settings page, **Then** they see a clear "disabled" state with a prompt to enable sync.
4. **Given** the sync settings page is open, **When** a sync cycle completes in the background, **Then** the status display refreshes automatically to show updated timestamps and counts.

---

### User Story 2 - Configure Sync Settings (Priority: P1)

An administrator enables or disables synchronization and adjusts sync parameters (sync interval, AWS region, authentication endpoint, school identifier). After saving, the sync engine immediately restarts with the new configuration.

**Why this priority**: Configuration is co-equal with status visibility — without it, the admin cannot activate or tune sync. Together with Story 1, this forms the minimum viable settings page.

**Independent Test**: Can be fully tested by changing sync configuration values, saving, and verifying that the sync engine reflects the new settings.

**Acceptance Scenarios**:

1. **Given** sync is currently disabled, **When** the admin fills in the required fields (school ID, AWS region, auth endpoint) and toggles sync to enabled, **Then** the system saves the configuration.
2. **Given** sync is enabled, **When** the admin changes the sync interval from 5 to 10 minutes and saves, **Then** the sync engine restarts with the new interval and a success confirmation is shown.
3. **Given** the admin enters an invalid sync interval (e.g., 0 or 60), **When** they attempt to save, **Then** the system rejects the input with a clear validation message indicating the allowed range (1–30 minutes).
4. **Given** sync is enabled, **When** the admin toggles sync to disabled, **Then** the sync engine stops, and the status display updates to show sync as disabled.

---

### User Story 3 - Trigger Manual Sync (Priority: P2)

An administrator wants to force an immediate sync cycle — for example, after entering a batch of grades that need to be available on other PCs right away. They click a "Sync Now" button and see the results of the push, pull, and snapshot operations.

**Why this priority**: While automatic sync handles most cases, urgent situations (end-of-term grade entry, exam scheduling) require on-demand sync. This is a high-value convenience feature that builds on the existing infrastructure.

**Independent Test**: Can be fully tested by clicking the Sync Now button and verifying that push/pull/snapshot operations execute and results are displayed.

**Acceptance Scenarios**:

1. **Given** sync is enabled and the app is online, **When** the admin clicks "Sync Now", **Then** the button shows a loading state, a sync cycle executes (push + pull + snapshot), and the results (success/failure for each operation) are displayed.
2. **Given** a sync cycle is already in progress, **When** the admin clicks "Sync Now", **Then** the button is disabled and a message indicates that sync is already running.
3. **Given** sync is disabled, **When** the admin views the page, **Then** the "Sync Now" button is disabled with a tooltip or message explaining that sync must be enabled first.
4. **Given** the network is unavailable, **When** the admin clicks "Sync Now", **Then** the operation fails gracefully and the error is shown without crashing the page.

---

### User Story 4 - View and Resolve Conflicts (Priority: P2)

An administrator notices the conflict count badge on the sync status panel showing unresolved conflicts. They navigate to the conflict log section, review each conflict to see what data differs between the local and remote copies, and choose to accept the local version or the remote version for each conflict.

**Why this priority**: Conflicts are rare by design (last-writer-wins handles most cases automatically), but when they occur, the admin needs a clear way to understand and resolve them. Without this, unresolved conflicts silently accumulate.

**Independent Test**: Can be fully tested by creating synthetic conflict records and verifying the conflict log display, filtering, and resolution actions.

**Acceptance Scenarios**:

1. **Given** there are unresolved conflicts in the conflict log, **When** the admin opens the conflict log section, **Then** they see a list of conflicts showing the entity type, affected record identifier, conflicting fields, and when the conflict occurred.
2. **Given** the admin is viewing a conflict, **When** they expand the conflict details, **Then** they see the local data and remote data side-by-side with the conflicting fields highlighted.
3. **Given** the admin is viewing an unresolved conflict, **When** they click "Accept Local", **Then** the conflict is marked as resolved, the local data is re-queued for push to DynamoDB, and a confirmation is shown.
4. **Given** the admin is viewing an unresolved conflict, **When** they click "Accept Remote", **Then** the conflict is marked as resolved with the remote data winning, and a confirmation is shown.
5. **Given** the conflict log contains many entries, **When** the admin filters by status (all/unresolved/resolved), **Then** only matching conflicts are displayed.

---

### User Story 5 - Sidebar Sync Status Indicator (Priority: P3)

Across all pages of the application, the sidebar displays a small sync status indicator that shows the current sync state at a glance — connected, syncing, offline, or error — so the admin does not need to visit the sync settings page to know if sync is healthy.

**Why this priority**: This is a quality-of-life enhancement. The core functionality (Stories 1–4) works without it, but the persistent indicator adds continuous awareness without page navigation.

**Independent Test**: Can be fully tested by verifying that the sidebar indicator appears on any page, reflects different sync states correctly, and links to the sync settings page when clicked.

**Acceptance Scenarios**:

1. **Given** sync is enabled and connected, **When** any page loads, **Then** the sidebar shows a green indicator with "connected" state near the sync settings menu item.
2. **Given** a sync cycle is actively running, **When** the admin is on any page, **Then** the indicator changes to a spinning/animated state showing "syncing".
3. **Given** the network is unavailable, **When** sync fails to reach DynamoDB, **Then** the indicator shows an orange/yellow "offline" state.
4. **Given** a sync error occurred, **When** the last sync cycle failed, **Then** the indicator shows a red "error" state.
5. **Given** sync is disabled, **When** any page loads, **Then** the sidebar shows a gray/neutral indicator or no indicator at all.
6. **Given** the admin clicks the sync indicator, **When** on any page, **Then** they are navigated to the sync settings page.

---

### Edge Cases

- What happens when the admin saves configuration while a sync cycle is actively running? The running cycle should complete, and the new configuration should take effect on the next cycle.
- What happens when the sync settings page is open on two windows simultaneously? Each window should independently read the current config; the last save wins.
- What happens when the admin has a non-admin role? They should be able to view sync status (read-only) but not modify configuration, trigger manual sync, or resolve conflicts.
- What happens when there are hundreds of conflicts in the log? The conflict log should paginate (max 200 per page) and remain performant.
- What happens when the admin resolves a conflict but the network is down? The resolution should be saved locally (conflict marked resolved, local data re-queued) and pushed when connectivity returns.
- What happens when the page is left open for an extended period? Status information should continue to refresh periodically without memory leaks.

## Requirements

### Functional Requirements

- **FR-001**: System MUST provide a dedicated sync settings page accessible from the sidebar navigation under the settings section.
- **FR-002**: System MUST display current sync status including: enabled/disabled state, connection state (connected/offline/error), last push timestamp, last pull timestamp, pending change count, failed change count, and unresolved conflict count.
- **FR-003**: System MUST auto-refresh the sync status display periodically (every 10–15 seconds) while the page is open, without requiring manual page reload.
- **FR-004**: System MUST allow administrators to enable or disable synchronization via a toggle control.
- **FR-005**: System MUST allow administrators to configure sync parameters: sync interval (1–30 minutes), AWS region, authentication endpoint URL, and school identifier.
- **FR-006**: System MUST validate all configuration inputs before saving and display clear validation messages for invalid values.
- **FR-007**: System MUST apply configuration changes immediately by restarting the sync engine after a successful save.
- **FR-008**: System MUST provide a "Sync Now" button that triggers an immediate push + pull + snapshot cycle and displays the results.
- **FR-009**: System MUST disable the "Sync Now" button when sync is disabled or a cycle is already in progress.
- **FR-010**: System MUST display a conflict log showing unresolved and resolved conflicts with entity type, record identifier, conflicting fields, timestamps, and resolution method.
- **FR-011**: System MUST allow administrators to filter the conflict log by status: all, unresolved, or resolved.
- **FR-012**: System MUST allow administrators to view conflict details showing local vs. remote data side-by-side with conflicting fields highlighted.
- **FR-013**: System MUST allow administrators to resolve conflicts by choosing "accept local" or "accept remote" for each unresolved conflict.
- **FR-014**: System MUST show a confirmation message after each conflict resolution and update the conflict list.
- **FR-015**: System MUST display a persistent sync status indicator in the sidebar across all application pages (not just the sync settings page).
- **FR-016**: The sidebar indicator MUST reflect one of four states: connected (green), syncing (animated), offline (yellow/orange), or error (red). When sync is disabled, no indicator or a neutral/gray indicator should be shown.
- **FR-017**: The sidebar indicator MUST link to the sync settings page when clicked.
- **FR-018**: System MUST restrict write operations (configure, trigger sync, resolve conflicts) to admin-role users only. Non-admin users may view sync status in read-only mode.
- **FR-019**: All UI text MUST be in Arabic, consistent with the rest of the application.
- **FR-020**: The page MUST support both light and dark themes, following the existing `data-theme` toggle pattern.
- **FR-021**: The page layout MUST use RTL direction and logical CSS properties consistent with the rest of the application.
- **FR-022**: System MUST provide paginated conflict log navigation when the number of conflicts exceeds the display limit.

### Key Entities

- **Sync Configuration**: The set of parameters controlling sync behavior — enabled state, sync interval, AWS region, authentication endpoint, school identity, push batch size, max retries, retention period, and snapshot interval.
- **Sync Status**: A real-time snapshot of the sync engine state — whether push/pull/snapshot are running, last operation timestamps, error messages, and aggregate counts of pending, failed, and conflicting items.
- **Conflict Record**: An individual data conflict between local and remote versions of a record — includes the table/entity type, the conflicting row identifier, local data, remote data, the list of conflicting fields, resolution status, resolution method (automatic LWW, merged, or manual), and timestamps.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Administrators can determine the current sync health (connected, offline, error, or disabled) within 2 seconds of opening the sync settings page.
- **SC-002**: Administrators can enable sync and save a valid configuration in under 1 minute on first use.
- **SC-003**: Administrators can trigger a manual sync and see its results within the time it takes for one sync cycle to complete (typically under 30 seconds).
- **SC-004**: Administrators can review and resolve an individual data conflict in under 30 seconds, including understanding what changed and choosing a resolution.
- **SC-005**: The sync status indicator in the sidebar accurately reflects the current sync state across all pages, updating within 15 seconds of a state change.
- **SC-006**: The conflict log displays up to 200 entries per page without noticeable UI slowdown.
- **SC-007**: All existing smoke tests continue to pass with the new page, IPC channels, and sidebar modifications integrated.
- **SC-008**: Non-admin users can view sync status but cannot modify settings or resolve conflicts — attempts are blocked at both UI and backend levels.

## Assumptions

- All six sync IPC channels (`sync:getConfig`, `sync:setConfig`, `sync:getStatus`, `sync:triggerNow`, `sync:getConflictLog`, `sync:resolveConflict`) are fully implemented and functional in the backend before this UI work begins.
- The sync engine (push, pull, snapshot) is operational and tested at the backend level (Phases 1–5 complete).
- The existing sidebar HTML structure across all pages follows the `.sidebar .sub-menu a` pattern and can accommodate an additional menu item and status indicator.
- The `showToast()` function is available globally on all pages for user feedback.
- FontAwesome icon library is available for status icons (e.g., `fa-sync`, `fa-check-circle`, `fa-exclamation-triangle`).
- Advanced configuration fields (push batch size, max retries, retention days, snapshot interval) are considered secondary — they can be shown in an "Advanced Settings" collapsible section to avoid overwhelming the admin on first use.
- The conflict detail view shows JSON-formatted data; no custom rendering per entity type is required for the initial implementation.

## Dependencies

- **Phase 5 (Integrity & Conflict Resolution)**: Must be complete — the `sync_conflicts` table, three-way merge logic, and snapshot cycle must all be operational.
- **Phase 4 (Pull Engine + IPC Channels)**: All six `sync:*` IPC channels must be registered and functional.
- **Phase 3 (Push Engine)**: The push engine and credential manager must be working.
- **Existing UI infrastructure**: Tailwind CSS v4 build pipeline, FontAwesome icons, `showToast()`, sidebar structure, theme toggle.

## Out of Scope

- Per-table sync controls (e.g., "sync grades but not absences") — sync is all-or-nothing in this phase.
- Real-time push notifications from DynamoDB (WebSocket/SSE) — the UI polls for status updates.
- Custom conflict resolution strategies beyond accept-local/accept-remote (e.g., field-level manual merge).
- Multi-language support — the UI is Arabic-only, consistent with the rest of the application.
- Mobile or responsive layouts — this is a desktop Electron app with fixed window dimensions.
- Conflict resolution for non-admin users — only admins can resolve conflicts.

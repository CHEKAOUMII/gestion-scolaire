# Feature Specification: Pull Engine + IPC Channels

**Feature Branch**: `004-pull-engine`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User description: "Phase 4 of DynamoDB Sync — Pull Engine + IPC Channels: Receive remote changes and expose sync status to the UI"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Remote Changes Appear Locally (Priority: P1)

A school administrator enters a new student record on PC-A in the admin office. Within the next sync interval, PC-B in the teacher room automatically receives that student record and it appears in the local database — without any manual action by the staff member on PC-B.

**Why this priority**: This is the core value of the pull engine. Without receiving remote changes, the entire sync system is one-directional and schools cannot share data across PCs. This completes the bi-directional sync loop that Phase 3 (push) started.

**Independent Test**: Can be fully tested by pushing a record from one device, waiting one sync interval, and verifying the record exists in the second device's local database. Delivers the fundamental value of multi-PC data sharing.

**Acceptance Scenarios**:

1. **Given** sync is enabled on PC-B and PC-A has pushed a new student record to the cloud, **When** the pull engine runs its next cycle, **Then** the student record appears in PC-B's local database with all non-sensitive fields intact.
2. **Given** sync is enabled and PC-A has pushed an update to an existing grade record, **When** PC-B pulls, **Then** the local grade record is updated to match the remote version.
3. **Given** sync is enabled and PC-A has pushed a deletion (DEL operation), **When** PC-B pulls, **Then** the corresponding local record is removed from PC-B's database.
4. **Given** the pull engine has never run before (fresh install), **When** the first pull cycle executes, **Then** all remote records for the school are ingested into the local database.

---

### User Story 2 - Pull Engine Runs Automatically in the Background (Priority: P1)

Once sync is enabled, the pull engine starts automatically when the app launches, runs on a configurable interval alongside the push engine, and stops cleanly when the app exits. No user intervention is required for ongoing synchronization.

**Why this priority**: The pull engine must be automatic and reliable for sync to be useful. Manual triggering alone would defeat the purpose of seamless multi-PC synchronization.

**Independent Test**: Can be tested by enabling sync, launching the app, and verifying that the pull engine fires on schedule and stops without errors on exit.

**Acceptance Scenarios**:

1. **Given** sync is enabled with a valid configuration, **When** the app starts, **Then** the pull engine starts a background timer alongside the push engine.
2. **Given** the pull engine is running, **When** the app is closed, **Then** the pull timer is stopped cleanly and no orphan processes remain.
3. **Given** the pull engine is running, **When** the internet connection is lost, **Then** the pull cycle fails gracefully, logs the error, and retries on the next interval without crashing.
4. **Given** a pull cycle is already in progress, **When** the timer fires again, **Then** the new cycle is skipped (re-entrancy guard) to prevent overlapping pulls.

---

### User Story 3 - Sync Status Visibility via IPC (Priority: P1)

Any renderer page can query the current sync status — whether sync is enabled, when the last push/pull occurred, how many entries are pending, and whether any errors exist. This information flows through well-defined IPC channels exposed on `window.api.sync`.

**Why this priority**: Without IPC channels, the renderer has no way to know about sync state. These channels are the prerequisite for the Phase 6 sync settings UI and for any status indicators in the sidebar.

**Independent Test**: Can be tested by calling each IPC channel from the renderer console and verifying correctly shaped responses, without needing the full sync settings UI page.

**Acceptance Scenarios**:

1. **Given** sync is enabled and has completed at least one cycle, **When** the renderer calls `window.api.sync.getStatus()`, **Then** it receives the current sync state including last push/pull times, pending count, and error information.
2. **Given** sync is disabled, **When** the renderer calls `window.api.sync.getStatus()`, **Then** it receives a response indicating sync is disabled with no active timers.
3. **Given** sync is enabled, **When** the renderer calls `window.api.sync.getConfig()`, **Then** it receives the current sync configuration (interval, enabled state, cloud region).

---

### User Story 4 - Sync Configuration via IPC (Priority: P2)

An administrator can update sync settings (enable/disable sync, change the sync interval, set the cloud endpoint) through IPC channels. Configuration changes take effect immediately by restarting the sync engines.

**Why this priority**: Configuration channels are necessary for the Phase 6 UI to function, but the pull engine itself can operate with manually-set database values. This is a building block, not a standalone user-facing feature.

**Independent Test**: Can be tested by calling `window.api.sync.setConfig()` with new values and verifying the database is updated and the sync engines restart with the new settings.

**Acceptance Scenarios**:

1. **Given** sync is currently disabled, **When** the renderer calls `window.api.sync.setConfig({ enabled: true })`, **Then** the configuration is saved and both push and pull engines start.
2. **Given** sync is running with a 5-minute interval, **When** the admin changes the interval to 10 minutes via `setConfig`, **Then** both engines restart with the new interval.
3. **Given** a non-admin user is logged in, **When** they call `window.api.sync.setConfig()`, **Then** the call is rejected with an authorization error.

---

### User Story 5 - Manual Sync Trigger (Priority: P2)

An administrator can trigger an immediate sync cycle (both push and pull) without waiting for the next scheduled interval. This is useful after entering a batch of data or when the admin wants to verify that sync is working.

**Why this priority**: Manual trigger provides a safety valve and debugging aid. It is not critical for automated sync but greatly improves administrator confidence and troubleshooting capability.

**Independent Test**: Can be tested by calling `window.api.sync.triggerNow()` and verifying that both push and pull cycles execute immediately and return results.

**Acceptance Scenarios**:

1. **Given** sync is enabled and idle, **When** the renderer calls `window.api.sync.triggerNow()`, **Then** both a push flush and a pull cycle execute immediately and the response includes results from both.
2. **Given** sync is enabled but a cycle is already in progress, **When** `triggerNow()` is called, **Then** the call waits for the current cycle to finish or returns a status indicating a cycle is already running.
3. **Given** sync is disabled, **When** `triggerNow()` is called, **Then** the call is rejected with a clear message that sync is not enabled.

---

### User Story 6 - Conflict Log Access (Priority: P2)

When the pull engine encounters a record that conflicts with a local change (same record modified on two PCs), it logs the conflict for later review. Administrators can retrieve the conflict log through an IPC channel.

**Why this priority**: Conflict logging provides visibility into data inconsistencies. While Phase 5 will implement full conflict resolution, logging conflicts during pull is essential groundwork that surfaces problems early.

**Independent Test**: Can be tested by creating a conflicting write scenario (two PCs modify the same record) and verifying the conflict appears in the log via `window.api.sync.getConflictLog()`.

**Acceptance Scenarios**:

1. **Given** a remote record has a newer version than the local record for the same entity, **When** the pull engine processes this record, **Then** the remote version overwrites the local version (last-writer-wins) and no conflict is logged.
2. **Given** a locally modified record exists in the outbox (pending push) and the pull engine receives a remote update for the same record, **When** the pull processes this record, **Then** a conflict entry is logged with both local and remote data, and the remote version is applied.
3. **Given** conflicts have been logged, **When** the renderer calls `window.api.sync.getConflictLog()`, **Then** it receives a list of conflict entries with timestamps, entity types, and both local and remote data snapshots.

---

### Edge Cases

- What happens when the pull engine receives a record for an entity type not in the local registry? The record is skipped and an error is logged.
- What happens when the pull engine receives a record from the same device that pushed it? The record is skipped to avoid redundant self-application.
- What happens when the pull receives a DEL operation for a record that does not exist locally? The deletion is silently ignored (idempotent).
- What happens when a pulled record references a foreign key that does not exist locally (e.g., a grade for a student not yet synced)? The record is queued for retry on the next pull cycle, giving the referenced record time to arrive.
- What happens when the cloud returns more than 500 items in a single pull query? The pull engine paginates using the `LastEvaluatedKey` cursor and processes all pages within a single cycle.
- What happens when the local database schema is older than the remote data (e.g., missing columns)? Unknown columns in the remote data are silently dropped during local insert/update.
- What happens when multiple pull cycles run concurrently? A re-entrancy guard prevents concurrent pulls — the second attempt is skipped.

## Requirements *(mandatory)*

### Functional Requirements

**Pull Engine Core**

- **FR-001**: System MUST query the cloud index for all changes since the last pull timestamp, ordered chronologically, limited to 500 items per page.
- **FR-002**: System MUST paginate through all available pages within a single pull cycle when more than 500 items are returned.
- **FR-003**: System MUST store the highest sync cursor value from each successful pull as the starting point for the next pull.
- **FR-004**: System MUST skip records that originated from the current device (matching `deviceHash`) to avoid self-application.
- **FR-005**: System MUST translate remote sync IDs to local database IDs using the `sync_id_map` table before applying changes.
- **FR-006**: For records with no local ID mapping, the system MUST insert a new row and create a corresponding `sync_id_map` entry.
- **FR-007**: For PUT operations on existing local records, the system MUST update the local row with the remote data.
- **FR-008**: For DEL operations, the system MUST delete the corresponding local row if it exists. If no local row exists, the operation is silently ignored.
- **FR-009**: All local database changes from a single pull cycle MUST be applied within a single transaction to ensure atomicity.
- **FR-010**: System MUST NOT apply remote changes to records that have pending outbox entries (local modifications awaiting push), and MUST log these as conflicts instead.
- **FR-011**: System MUST log conflicts to a local conflict log with both the local pending data and the incoming remote data.

**Pull Engine Lifecycle**

- **FR-012**: System MUST start the pull engine background timer when the app launches and sync is enabled, alongside the existing push engine.
- **FR-013**: The pull engine timer MUST use the same configurable interval as the push engine (default 5 minutes, range 1–30 minutes).
- **FR-014**: System MUST enforce a re-entrancy guard so that only one pull cycle runs at a time.
- **FR-015**: System MUST stop the pull timer cleanly on app exit using `.unref()` to avoid blocking Electron shutdown.
- **FR-016**: Pull cycle errors MUST be stored in the configuration record (`last_pull_at`, `last_pull_error`) and never thrown to crash the app.

**IPC Channels**

- **FR-017**: System MUST expose a `sync:getConfig` read channel that returns the current sync configuration (enabled, interval, cloud region, school ID).
- **FR-018**: System MUST expose a `sync:setConfig` write channel (admin-only) that updates sync configuration and restarts both push and pull engines.
- **FR-019**: System MUST expose a `sync:getStatus` read channel that returns current sync state including: enabled, last push/pull times, pending outbox count, last errors, and whether engines are currently running.
- **FR-020**: System MUST expose a `sync:triggerNow` write channel (admin-only) that immediately executes both a push flush and a pull cycle.
- **FR-021**: System MUST expose a `sync:getConflictLog` read channel that returns recent conflict entries.
- **FR-022**: System MUST expose a `sync:resolveConflict` write channel (admin-only) that marks a conflict as resolved and optionally applies the chosen version (local or remote).

**Integration**

- **FR-023**: All new IPC channels MUST be registered in the IPC registration module and declared in the preload bridge under a `sync` namespace.
- **FR-024**: The smoke test MUST pass with all new channels — preload declarations must exactly match registered handlers.
- **FR-025**: The pull engine MUST reuse the existing credential manager from Phase 3 for cloud authentication.
- **FR-026**: The pull engine MUST reuse the existing `sync_pull_state` table (created in Phase 1) to track per-table pull cursors.
- **FR-027**: Configuration write channels (`sync:setConfig`, `sync:resolveConflict`) MUST be registered in the sync capture registry if they modify database tables tracked by the outbox.

### Key Entities

- **Pull Cursor**: Tracks the last-seen sync timestamp per school, used to fetch only new changes on each pull. Stored in `sync_pull_state`.
- **Remote Sync Item**: An incoming cloud record containing entity type, operation (PUT/DEL), row data, version, device origin, and sync ID. Translated to a local database row during ingestion.
- **Sync ID Mapping**: The bidirectional mapping between cloud sync IDs (`{deviceHash}:{table}:{localId}`) and local integer row IDs. Used during pull to find or create local rows.
- **Conflict Entry**: A record of a collision between a pending local change and an incoming remote change for the same entity. Contains both data snapshots, entity type, timestamp, and resolution status.
- **Sync Configuration**: The singleton settings record controlling sync behavior — enabled state, interval, cloud endpoint, school identity, and operational timestamps (last push/pull times and errors).
- **Sync Status**: A runtime snapshot (not persisted) combining configuration data with live engine state — whether timers are active, current cycle progress, and pending counts.

## Assumptions

- Phase 1 (sync foundation), Phase 2 (AWS infrastructure), and Phase 3 (push engine) are fully implemented and merged before Phase 4 begins.
- The `sync_pull_state` table already exists from Phase 1 migration and is ready to use without additional schema changes.
- The DynamoDB `SyncGSI` index is deployed and supports the chronological query pattern defined in Phase 2.
- The credential manager (`main/sync/credentials.js`) from Phase 3 provides valid temporary credentials for both push and pull operations.
- Conflict resolution in this phase is limited to logging and basic last-writer-wins. Full field-level merge and conflict UI are deferred to Phase 5 and Phase 6.
- The `sync:setConfig` channel does not need to be captured in the sync outbox because sync configuration is device-local and should not be replicated to other PCs.
- Pull applies to all 17 entity types defined in the entity type registry (same set as push).
- Foreign key ordering during pull (e.g., student must exist before their grades) is handled by retry-on-next-cycle for unresolvable references, not by sorting the pull results.

## Out of Scope

- Full conflict resolution UI — deferred to Phase 6 (Sync Settings UI).
- Field-level merge for non-overlapping changes — deferred to Phase 5 (Integrity & Conflict Resolution).
- Re-snapshot checker for detecting missed changes — deferred to Phase 5.
- Sync settings HTML page and visual sync indicators — deferred to Phase 6.
- Schema migration synchronization across devices — each device runs its own migrations independently.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A record pushed from one device appears in a second device's local database within 2 sync intervals (default: 10 minutes) without manual intervention.
- **SC-002**: The pull engine processes 500 incoming records in under 30 seconds on standard school hardware.
- **SC-003**: The pull engine operates continuously for 24 hours without memory leaks, crashes, or unhandled errors.
- **SC-004**: All 6 new IPC channels respond with correctly structured data when called from the renderer.
- **SC-005**: The existing smoke test suite passes with zero regressions after adding the new sync IPC channels.
- **SC-006**: The app continues to function identically when sync is disabled — no errors, no performance impact, no blocked operations.
- **SC-007**: When a conflict occurs (local pending change vs. incoming remote change), the conflict is logged with both data snapshots and retrievable via the conflict log channel.
- **SC-008**: An administrator can trigger an immediate sync cycle and receive results within 10 seconds (excluding network latency).

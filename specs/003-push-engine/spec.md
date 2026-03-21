# Feature Specification: Push Engine

**Feature Branch**: `003-push-engine`
**Created**: 2026-03-21
**Status**: Draft
**Input**: Phase 3 of DynamoDB Sync Integration — Send local changes to DynamoDB via outbox flusher with Cognito credential manager

## User Scenarios & Testing

### User Story 1 - Outbox Changes Are Automatically Pushed to Cloud (Priority: P1)

When a staff member performs any write operation on their PC (adding a student, recording a grade, marking an absence), the change is already captured in the local `sync_outbox` by Phase 1. The push engine periodically reads pending outbox rows, batches them into cloud write operations, and sends them. The user never interacts with the push process — it runs silently in the background.

**Why this priority**: Without push, no data leaves the local PC. This is the core value of Phase 3 — making local changes available to other school PCs.

**Independent Test**: Can be fully tested by performing a write operation on one PC (e.g., adding a student), waiting for the push interval to elapse, and verifying the record appears in the cloud data store.

**Acceptance Scenarios**:

1. **Given** a pending outbox entry exists, **When** the push engine runs its flush cycle, **Then** the entry is sent to the cloud and its outbox status is marked as `sent`
2. **Given** multiple pending outbox entries exist (e.g., 15 rows), **When** the push engine runs, **Then** all entries are batched efficiently and sent in as few network calls as possible
3. **Given** the push engine encounters a network error mid-flush, **When** the flush cycle completes, **Then** successfully sent entries are marked `sent`, failed entries remain `pending` with an incremented retry count and recorded error message
4. **Given** no pending outbox entries exist, **When** the push engine runs, **Then** no network calls are made and no errors are logged

---

### User Story 2 - Push Engine Obtains and Manages Cloud Credentials (Priority: P1)

Before pushing data, the engine must authenticate the school's identity. The credential manager presents the school's license key to the authentication service (deployed in Phase 2), receives temporary credentials scoped to the school's data partition, caches those credentials in memory, and automatically refreshes them before they expire.

**Why this priority**: Without valid credentials, no data can be written to the cloud. Credential management is a prerequisite for every push operation.

**Independent Test**: Can be tested by triggering credential acquisition and verifying that (a) valid temporary credentials are returned, (b) they are cached for reuse, and (c) they are refreshed before the 60-minute expiry window.

**Acceptance Scenarios**:

1. **Given** the app has a valid license key and internet connectivity, **When** the credential manager requests credentials for the first time, **Then** it contacts the authentication service, receives temporary credentials, and caches them in memory
2. **Given** cached credentials are older than 50 minutes, **When** any push operation needs credentials, **Then** the credential manager automatically refreshes them before use
3. **Given** the authentication service rejects the license key (expired or invalid), **When** the credential manager attempts to authenticate, **Then** it records the error, does not cache invalid credentials, and the push engine gracefully skips the current cycle
4. **Given** the network is unavailable, **When** the credential manager attempts to refresh credentials, **Then** it retries on the next cycle without crashing or surfacing errors to the user

---

### User Story 3 - Push Engine Runs as a Background Process on App Startup (Priority: P1)

When the Electron app starts, the push engine initializes alongside other background services. It runs on a configurable interval (default: every 5 minutes), flushing the outbox each cycle. When the app shuts down, the push engine stops cleanly without blocking the exit.

**Why this priority**: The push engine must start automatically — users should never need to manually trigger sync for routine operation.

**Independent Test**: Can be tested by launching the app with sync enabled, confirming the push timer starts, verifying it fires at the configured interval, and shutting down the app to confirm clean exit (no orphan timers or hanging processes).

**Acceptance Scenarios**:

1. **Given** sync is enabled in the sync configuration, **When** the app starts, **Then** the push engine begins running at the configured interval
2. **Given** sync is disabled in the sync configuration, **When** the app starts, **Then** the push engine does not start and no background timer is created
3. **Given** the push engine is running, **When** the app is closed, **Then** the push engine stops cleanly and does not prevent the app from exiting
4. **Given** the push interval is changed in the sync configuration, **When** the engine is restarted, **Then** it adopts the new interval

---

### User Story 4 - Failed Pushes Are Retried with Backoff (Priority: P2)

When a push attempt fails for a specific outbox entry (network timeout, throttling, transient error), the entry is not discarded. It stays in the outbox with an incremented retry counter and is attempted again on subsequent flush cycles. Entries that exceed a maximum retry count are moved to a permanent failure state so they do not block other entries indefinitely.

**Why this priority**: Transient failures are common in network operations. Retry logic ensures data is eventually delivered without manual intervention.

**Independent Test**: Can be tested by simulating network failures during a push cycle and verifying that entries are retried on subsequent cycles, with retry counts incrementing, and that entries exceeding the max retry limit are marked as permanently failed.

**Acceptance Scenarios**:

1. **Given** an outbox entry fails to push, **When** the next flush cycle runs, **Then** the entry is retried with its retry count incremented
2. **Given** an outbox entry has been retried the maximum number of times (default: 10), **When** the next flush cycle runs, **Then** the entry is marked as `failed` and excluded from future flush cycles
3. **Given** a previously failed entry exists, **When** the push engine flushes, **Then** it processes other pending entries normally without being blocked by the failed entry

---

### User Story 5 - Writer Authority Is Enforced Before Push (Priority: P2)

Not all PCs are allowed to push all data types. Before sending an outbox entry to the cloud, the push engine checks the current user's role against the writer authority matrix (e.g., only admin can push student records; admin and staff can push grades/absences). Entries for which the current PC lacks write authority are skipped and flagged.

**Why this priority**: Enforcing write permissions client-side prevents unauthorized data from reaching the cloud and reduces wasted network calls.

**Independent Test**: Can be tested by logging in as a staff user, performing write operations on an admin-only domain (e.g., students), and verifying the outbox entries for that domain are skipped during push with an appropriate log message.

**Acceptance Scenarios**:

1. **Given** the current user has the `admin` role and an outbox entry is for the `students` table, **When** the push engine runs, **Then** the entry is pushed to the cloud
2. **Given** the current user has the `staff` role and an outbox entry is for the `students` table, **When** the push engine runs, **Then** the entry is skipped with a log message indicating insufficient permissions
3. **Given** the current user has the `staff` role and an outbox entry is for the `grades` table, **When** the push engine runs, **Then** the entry is pushed to the cloud (staff may write grades)

---

### User Story 6 - Bulk Placeholder Entries Are Expanded Before Push (Priority: P2)

Phase 1's capture layer records some complex multi-row operations (bulk imports, batch updates) as single placeholder entries with `_bulk: true` in the outbox. Before pushing, the engine must expand these placeholders into individual per-row entries by querying the current state of affected rows from the local database.

**Why this priority**: The cloud data store requires individual item writes. Bulk placeholders cannot be sent as-is — they must be expanded to maintain data integrity.

**Independent Test**: Can be tested by performing a bulk import (e.g., importing 50 students via XLSX), verifying the outbox contains a `_bulk: true` placeholder, triggering a push cycle, and confirming that 50 individual records appear in the cloud data store.

**Acceptance Scenarios**:

1. **Given** an outbox entry has `_bulk: true`, **When** the push engine processes it, **Then** it queries the local database for all affected rows, creates individual cloud items for each, and marks the placeholder as `sent`
2. **Given** a bulk placeholder references rows that no longer exist locally (deleted between capture and push), **When** the engine expands it, **Then** the missing rows are skipped without error
3. **Given** a bulk placeholder references a table with 500 rows, **When** the engine expands it, **Then** all 500 rows are pushed in batched cloud write calls

---

### Edge Cases

- What happens when the outbox grows very large during extended offline periods (e.g., 10,000+ entries)? The engine must process entries in bounded batches per cycle (e.g., 100 per flush) to avoid memory exhaustion and long-running operations.
- What happens if two flush cycles overlap (e.g., a slow network causes one cycle to extend past the next interval)? A re-entrancy guard must prevent concurrent flush execution.
- What happens if the cloud data store throttles requests? The engine must handle throttling errors gracefully — retry the batch on the next cycle without marking entries as permanently failed.
- What happens if an outbox entry contains data for a row that was subsequently updated again? The engine must send entries in chronological order so the latest version wins in the cloud.
- What happens when the app starts for the first time and no sync configuration exists? The push engine should default to disabled, requiring the admin to enable sync before any data is pushed.
- What happens if credential refresh fails repeatedly? The engine must not attempt to push data with expired credentials — it should skip flush cycles until valid credentials are obtained.

## Requirements

### Functional Requirements

- **FR-001**: System MUST read pending outbox entries (`status = 'pending'`) in chronological order (ascending by ID) during each flush cycle
- **FR-002**: System MUST batch outbox entries into cloud write calls, respecting the 25-item-per-batch limit
- **FR-003**: System MUST mark successfully pushed entries as `sent` in the outbox and record the push timestamp
- **FR-004**: System MUST increment the retry count and record the error message for entries that fail to push
- **FR-005**: System MUST mark entries as `failed` after exceeding the maximum retry limit (default: 10 retries)
- **FR-006**: System MUST obtain temporary credentials by presenting the school's license key hash and device hash to the authentication service
- **FR-007**: System MUST cache credentials in memory and reuse them for subsequent push operations within their validity window
- **FR-008**: System MUST refresh credentials proactively when they are within 10 minutes of expiry (i.e., after 50 minutes for 60-minute credentials)
- **FR-009**: System MUST start the push background timer on app startup when sync is enabled in the configuration
- **FR-010**: System MUST stop the push timer on app shutdown without blocking the exit
- **FR-011**: System MUST prevent concurrent flush executions via a re-entrancy guard
- **FR-012**: System MUST enforce writer authority by checking the current user's role against the writer authority matrix before pushing each entry
- **FR-013**: System MUST expand `_bulk: true` placeholder outbox entries into individual per-row entries before pushing
- **FR-014**: System MUST send entries in chronological order to ensure last-writer-wins semantics are preserved
- **FR-015**: System MUST process a bounded number of entries per flush cycle (configurable, default: 100) to prevent resource exhaustion
- **FR-016**: System MUST handle cloud throttling errors without marking entries as permanently failed
- **FR-017**: System MUST not push data when credentials are expired or unavailable — the flush cycle is skipped silently
- **FR-018**: System MUST log push activity (entries sent, failures, credential refreshes) without exposing sensitive data
- **FR-019**: System MUST construct cloud data items using the single-table design from Phase 2 (school partition key + entity sort key)
- **FR-020**: System MUST include version, writer device hash, writer role, synced-at timestamp, and TTL attributes on each cloud item
- **FR-021**: System MUST use conditional writes (version guards) to prevent stale overwrites
- **FR-022**: System MUST strip sensitive fields (`password_hash`, `pin_hash`) from data before pushing (defense-in-depth, complementing Phase 1's stripping)
- **FR-023**: System MUST support a configurable push interval (default: 5 minutes, range: 1–30 minutes)
- **FR-024**: System MUST default to sync disabled on first launch, requiring explicit admin enablement

### Key Entities

- **Outbox Entry**: A pending change record captured by Phase 1, containing: table name, local row ID, sync ID, operation type (PUT/DEL), serialized row data, school year, status, retry count, and timestamps
- **Credential Set**: Temporary cloud credentials (access key, secret key, session token) with an expiry timestamp, scoped to a single school's data partition
- **Cloud Sync Item**: A single-table item containing: school partition key, entity sort key, full row data, operation type, version, writer metadata, and TTL
- **Writer Authority Matrix**: A mapping of data domains (table names) to the roles permitted to push changes for that domain
- **Sync Configuration**: Key-value settings controlling push behavior: enabled flag, push interval, device identifier, last push timestamp, and last error

## Success Criteria

### Measurable Outcomes

- **SC-001**: All pending outbox entries on a connected PC are delivered to the cloud within two push intervals (default: within 10 minutes)
- **SC-002**: The push engine processes at least 100 outbox entries per flush cycle without exceeding 30 seconds of execution time
- **SC-003**: Credential acquisition completes within 3 seconds on a standard internet connection
- **SC-004**: Credential refresh happens automatically with zero user intervention — users never see an authentication prompt or error
- **SC-005**: The push engine survives 24 hours of continuous operation without memory leaks, crashes, or orphaned timers
- **SC-006**: Entries that fail due to transient errors are successfully delivered on retry within 3 subsequent cycles (under normal network conditions)
- **SC-007**: Writer authority enforcement correctly blocks 100% of unauthorized push attempts (e.g., staff pushing student records)
- **SC-008**: Bulk placeholder entries are fully expanded — the number of cloud items matches the number of individual rows affected by the bulk operation
- **SC-009**: The push engine does not block or delay any user-facing operations — all push work happens asynchronously in the background
- **SC-010**: All existing smoke tests pass unchanged after the push engine is integrated

## Assumptions

- Phase 1 (Sync Foundation) is complete: `sync_outbox`, `sync_id_map`, `sync_config`, and `sync_pull_state` tables exist, and the IPC capture layer is recording changes to the outbox
- Phase 2 (AWS Infrastructure) is deployed: the cloud data store table, authentication pool, auth service, and access roles are operational
- The authentication endpoint URL is stored in the sync configuration (set by the admin during initial sync setup, delivered in Phase 6)
- Required cloud SDK packages will be added as production dependencies
- On-demand cloud capacity is sufficient for the expected write volume (small schools, 1–5 PCs, modest data volumes)
- The existing `ownerSync.js` background timer pattern is the established convention for background processes in this app

## Dependencies

- **Phase 1 (Sync Foundation)**: Outbox table schema, sync ID mapping, capture layer, channel registry — all must be stable and functioning
- **Phase 2 (AWS Infrastructure)**: Cloud data store table, authentication pool, auth service, access roles — all must be deployed and accessible
- **Pencil2 Licensing System**: The push engine relies on the existing license key for authentication — the licensing module must remain stable

## Out of Scope

- Pull engine (receiving remote changes) — Phase 4
- Sync IPC channels for UI interaction — Phase 4
- Conflict detection and resolution — Phase 5
- Re-snapshot integrity checker — Phase 5
- Sync settings UI — Phase 6
- Admin-facing error notifications for push failures (will be exposed via Phase 4 IPC channels and Phase 6 UI)

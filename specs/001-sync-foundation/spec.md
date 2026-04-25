# Feature Specification: Sync Foundation

**Feature Branch**: `001-sync-foundation`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User description: "Phase 1 of DynamoDB Sync Integration — lay the database and change-capture groundwork with new SQLite sync tables and an IPC interception capture layer"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Changes Are Automatically Captured to the Sync Outbox (Priority: P1)

When school staff use the application normally — entering grades, recording absences, updating student records — the system silently captures every data-modifying operation into a local outbox queue, without requiring any user action or awareness. This outbox becomes the reliable source of "what changed locally" that future sync phases will consume.

**Why this priority**: The outbox is the single foundation for all future synchronization. Without it, no data can ever flow between PCs. Every subsequent phase (push, pull, conflict resolution) depends entirely on changes being recorded here.

**Independent Test**: Can be fully tested by performing any write operation (e.g., adding a student) and then verifying that a corresponding row appears in the `sync_outbox` table with the correct table name, operation type, and row data.

**Acceptance Scenarios**:

1. **Given** the application is running normally, **When** a user adds a new student via the existing "add student" workflow, **Then** a row is inserted into the outbox with the table name `students`, operation `PUT`, and row data containing the student's full record.
2. **Given** the application is running normally, **When** a user updates an existing grade, **Then** a row is inserted into the outbox with the table name `grades`, operation `PUT`, and row data containing the full updated row.
3. **Given** the application is running normally, **When** a user deletes a record (e.g., removes a student movement), **Then** a row is inserted into the outbox with operation `DEL` and enough identifying information to locate the deleted row.
4. **Given** a write operation fails (e.g., a constraint violation), **When** the handler throws an error, **Then** no row is inserted into the outbox — only successful writes are captured.

---

### User Story 2 - Every Write Channel Is Mapped and Captured (Priority: P1)

All existing write IPC channels in the application (approximately 40 channels across 14 domain modules) are mapped to their corresponding database tables via a channel-to-table registry. The capture layer uses this registry to know which table was affected by each IPC call, ensuring complete coverage with no blind spots.

**Why this priority**: Partial capture is worse than no capture — it would cause silent data divergence between PCs. The registry must cover every write channel from day one.

**Independent Test**: Can be verified by comparing the channel-to-table registry against the list of all write handler registrations in the codebase, confirming 100% coverage. Additionally, the existing smoke test should validate registry completeness.

**Acceptance Scenarios**:

1. **Given** the channel-to-table registry exists, **When** compared against all registered write handlers across domain modules, **Then** every write channel has a corresponding entry in the registry mapping it to one or more database tables.
2. **Given** a new IPC write handler is added in the future without a registry entry, **When** the smoke test runs, **Then** it detects the unmapped channel and fails with a clear error message indicating which channel is missing.
3. **Given** the registry maps a channel to a table, **When** that channel's handler is invoked, **Then** the capture layer correctly extracts the affected rows from the handler's arguments or return value and records them in the outbox.

---

### User Story 3 - Sync Tables Are Created During Database Initialization (Priority: P1)

When the application starts for the first time (or upgrades from a version without sync support), the four new sync-related tables (`sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`) are created automatically as part of the standard migration process. No manual database setup is required.

**Why this priority**: The tables must exist before the capture layer or any future sync engine can operate. This is the structural prerequisite for all other stories.

**Independent Test**: Can be verified by starting the application on a fresh database (or one from a previous version) and confirming all four tables exist with the correct schema by inspecting the database metadata.

**Acceptance Scenarios**:

1. **Given** a fresh database with no sync tables, **When** the application starts and runs its initialization sequence, **Then** all four sync tables (`sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`) are created.
2. **Given** a database that already has the sync tables from a previous launch, **When** the application starts again, **Then** the migration is idempotent — no errors occur and existing data is preserved.
3. **Given** the migration runs successfully, **When** the outbox table is inspected, **Then** it has columns for: row identifier, table name, operation type, row data (as JSON), status, timestamps, and retry metadata.
4. **Given** the migration runs successfully, **When** the ID mapping table is inspected, **Then** it has columns for a global sync ID, table name, and local integer ID, with appropriate uniqueness constraints.

---

### User Story 4 - Global Row Identity Without Schema Changes (Priority: P2)

Each locally-created row is assigned a globally unique sync ID using the pattern `{deviceHash}:{table_name}:{local_integer_id}`. This identity is stored in a mapping table, allowing future sync phases to translate between local integer IDs and global sync IDs without modifying any existing table schemas.

**Why this priority**: Global identity is essential for sync but is consumed by later phases (push/pull). The mapping table and ID generation logic must be in place, but the actual translation is exercised in Phase 3+.

**Independent Test**: Can be verified by capturing a write operation and confirming that a mapping entry is created with the correct composite sync ID linking the table name and local row ID to a globally unique identifier.

**Acceptance Scenarios**:

1. **Given** a student record is created with local ID 42 on a device with hash `a1b2c3d4`, **When** the capture layer processes the write, **Then** a mapping row is created with sync ID `a1b2c3d4:students:42`, table name `students`, local ID `42`.
2. **Given** a mapping entry already exists for a row, **When** the same row is updated, **Then** no duplicate mapping is created — the existing mapping is reused.
3. **Given** a row is deleted, **When** the capture layer processes the delete, **Then** the mapping entry is retained (not deleted) to allow future sync phases to reference the tombstone.

---

### User Story 5 - Capture Layer Does Not Affect Existing Functionality (Priority: P1)

The IPC interception capture layer wraps existing write handlers without modifying their code, arguments, or return values. All existing application behavior, performance characteristics, and error handling remain unchanged. If the capture layer encounters an internal error (e.g., failing to write to the outbox), it logs the error but does not disrupt the original operation.

**Why this priority**: The capture layer must be invisible to the rest of the application. Any regression in existing functionality would be a critical defect that blocks adoption.

**Independent Test**: Can be verified by running the full existing smoke test suite with the capture layer active and confirming all tests pass. Additionally, manually testing write operations and confirming that return values are identical to pre-capture behavior.

**Acceptance Scenarios**:

1. **Given** the capture layer is active, **When** any existing IPC write handler is called, **Then** the handler returns exactly the same result as it would without the capture layer.
2. **Given** the capture layer encounters an error writing to the outbox (e.g., disk full), **When** this error occurs, **Then** the original handler's result is still returned to the renderer, and the error is logged for later investigation.
3. **Given** the capture layer is active, **When** the full smoke test suite runs, **Then** all existing tests pass without modification.
4. **Given** the capture layer wraps a handler, **When** the handler throws an error (e.g., auth failure, validation error), **Then** the error propagates to the renderer exactly as before — the capture layer does not interfere with error handling.

---

### Edge Cases

- What happens when multiple write operations occur within a single IPC handler (e.g., a bulk import that inserts hundreds of rows)? The capture layer must record each individual row change, not just a single aggregate entry.
- What happens when a write handler modifies multiple tables in a single call (e.g., adding a student also creates a default record in another table)? The registry must map such channels to all affected tables.
- What happens when the outbox table grows very large because no sync engine is consuming it yet (Phase 1 has no push)? The outbox should have a configurable retention limit or age-based cleanup to prevent unbounded growth.
- What happens when a sync migration runs on a database that was restored from a backup created before sync support? The migration must be idempotent and not fail on partial state.
- What happens when a soft-auth handler is called without authentication (the bulk-import path)? The capture layer must still record the change, using a fallback device identifier.

## Clarifications

### Session 2026-03-21

- Q: Should sensitive fields (password_hash, pin_hash) be stripped from outbox row data serialization? → A: Yes — strip sensitive fields before serialization to prevent accidental credential leakage when push is enabled in Phase 3.
- Q: How should the capture layer obtain the local row ID for outbox entries and sync ID mapping? → A: Use the database's last-insert-ID for inserts; extract IDs from handler arguments for updates/deletes.
- Q: Should the outbox record the school_year partition key on each entry for Phase 3 readiness? → A: Yes — record school_year on each outbox entry, extracted from handler arguments, to avoid costly backfill when push is enabled.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST create four new database tables (`sync_outbox`, `sync_id_map`, `sync_config`, `sync_pull_state`) via a new database migration during application startup.
- **FR-002**: System MUST provide a channel-to-table registry that maps every existing write IPC channel to its affected database table(s).
- **FR-003**: System MUST provide a capture wrapper function that intercepts existing IPC write handlers at registration time, recording each successful write operation to the outbox table.
- **FR-004**: The capture wrapper MUST execute after the original handler succeeds and MUST NOT alter the handler's return value or error behavior.
- **FR-005**: The capture wrapper MUST NOT insert an outbox row when the original handler fails (throws an error or returns a failure response).
- **FR-006**: System MUST generate a globally unique sync ID for each captured row using the format `{deviceHash}:{table_name}:{local_integer_id}` and store the mapping in the ID mapping table.
- **FR-007**: The outbox table MUST record: the affected table name, the operation type (`PUT` or `DEL`), the full row data as JSON, a status field (`pending`/`sent`), the `school_year` partition key, creation timestamp, and retry metadata (retry count, last attempt timestamp, last error message).
- **FR-008**: The ID mapping table MUST enforce uniqueness on `(table_name, local_id)` to prevent duplicate mappings.
- **FR-009**: The configuration table MUST store sync configuration as key-value pairs, including at minimum: sync enabled/disabled flag, sync interval, and device identifier.
- **FR-010**: The pull state table MUST store per-table high-water marks (timestamps) for tracking the last successfully pulled change from a remote store.
- **FR-011**: The capture layer MUST be applied in the existing handler registration flow without modifying any individual IPC handler module.
- **FR-012**: The channel-to-table registry MUST be validated by the smoke test to ensure every registered write channel has a corresponding mapping.
- **FR-013**: System MUST handle bulk operations (handlers that insert/update/delete multiple rows) by recording one outbox entry per affected row.
- **FR-014**: The capture layer MUST silently log and swallow its own internal errors (e.g., outbox write failure) without disrupting the original handler's operation.
- **FR-015**: The outbox MUST have a configurable maximum age to prevent unbounded growth during Phase 1 (when no push engine exists to consume it), with a default retention of 7 days.
- **FR-016**: The capture layer MUST strip sensitive fields (`password_hash`, `pin_hash`) from row data before serializing to the outbox, to prevent credential leakage when the outbox is eventually pushed to a remote store in later phases.

### Key Entities

- **Sync Outbox Entry**: Represents a single captured data change event. Contains the affected table name, operation type, serialized row data (with sensitive fields stripped), the school_year partition key, processing status, and retry metadata. One entry per row changed.
- **Sync ID Mapping**: A bidirectional translation record between a globally unique sync ID (composite of device hash, table name, and local row ID) and the local integer primary key. Enables future sync phases to identify rows across devices without modifying existing table schemas.
- **Sync Configuration**: A key-value settings store for sync behavior (enabled/disabled, interval, device identity). Consumed by future phases but initialized in Phase 1.
- **Sync Pull State**: Per-table timestamp tracking the last successfully pulled remote change. Unused in Phase 1 but created now to avoid a future migration.
- **Channel-Table Registry**: A static mapping of every write IPC channel name to the database table(s) it affects. Used by the capture layer to determine what to record and validated by the smoke test for completeness.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every write operation performed through any of the application's ~40 write IPC channels results in a corresponding outbox entry within the same operation, with zero data-modifying operations missed.
- **SC-002**: All existing smoke tests pass without modification after the capture layer is integrated.
- **SC-003**: The channel-to-table registry covers 100% of write IPC channels, validated automatically by an extended smoke test.
- **SC-004**: The capture layer adds less than 50 milliseconds of overhead to any individual write operation under normal conditions.
- **SC-005**: A failure in the capture layer (e.g., outbox table locked) does not cause any user-visible error or change in application behavior.
- **SC-006**: The four sync tables are created successfully on both fresh databases and databases upgrading from the previous version.
- **SC-007**: The outbox self-cleans entries older than the configured retention period, keeping table size bounded even without an active sync engine.

## Assumptions

- The existing device fingerprint module provides a stable device hash that can be reused as the device identifier component of sync IDs.
- The existing owner sync outbox pattern (status tracking, retry metadata, flush mutex) is a proven pattern that can be adapted for the sync outbox.
- Write IPC handlers consistently use the shared write wrapper helpers, making interception at the wrapper level feasible without per-handler modifications.
- The handler's return value or arguments contain enough information to determine the affected table and row ID(s) — for inserts, the capture layer uses the database's last-insert-ID; for updates/deletes, IDs are extracted from the handler's arguments. The registry maps channel names to extraction strategies.
- Bulk import operations may insert large batches; the capture layer should batch outbox inserts efficiently (e.g., using a single transaction) to avoid performance degradation.
- The configuration and pull state tables are created in Phase 1 for schema completeness but are not actively read/written until Phase 2+.

## Out of Scope

- AWS infrastructure (DynamoDB, Cognito, Lambda) — deferred to Phase 2.
- Push engine (flushing outbox to DynamoDB) — deferred to Phase 3.
- Pull engine (ingesting remote changes) — deferred to Phase 4.
- Conflict detection and resolution — deferred to Phase 5.
- Sync settings UI — deferred to Phase 6.
- Periodic re-snapshot integrity checker — deferred to Phase 5.
- Any new IPC channels for sync status/control — deferred to Phase 4.

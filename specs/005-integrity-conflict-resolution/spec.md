# Feature Specification: Integrity & Conflict Resolution

**Feature Branch**: `005-integrity-conflict-resolution`
**Created**: 2026-03-21
**Status**: Draft
**Input**: User description: "Phase 5 of DynamoDB Sync — Integrity & Conflict Resolution: Catch edge cases with periodic re-snapshot checking and handle conflicts gracefully with field-level merge and auto-resolution"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Missed Changes Are Automatically Detected and Synced (Priority: P1)

A school administrator restores a database backup on PC-A, or a migration adds new data directly to SQLite outside the sync capture layer. The re-snapshot checker detects that local table state has drifted from the last synced state and automatically enqueues the missed changes to the sync outbox, ensuring they reach other PCs without manual intervention.

**Why this priority**: Without re-snapshot detection, any changes that bypass the capture layer (backup restores, migrations, direct SQLite writes, bulk imports) silently diverge from the cloud. This is the most dangerous data integrity gap — users believe they are in sync when they are not.

**Independent Test**: Can be fully tested by directly inserting a row into a local SQLite table (bypassing IPC), waiting for the re-snapshot checker to run, and verifying that the new row appears in the sync outbox as a pending entry.

**Acceptance Scenarios**:

1. **Given** a row was inserted directly into a local table outside the sync capture layer, **When** the re-snapshot checker runs its next cycle, **Then** the new row is detected and enqueued in the sync outbox with a PUT operation.
2. **Given** a row was updated directly in the local database (bypassing IPC), **When** the re-snapshot checker runs, **Then** the modified row is detected by comparing checksums and enqueued as a PUT operation in the sync outbox.
3. **Given** a row was deleted directly from the local database, **When** the re-snapshot checker runs, **Then** the deletion is detected and enqueued as a DEL operation in the sync outbox.
4. **Given** a database backup was restored that rolls back several tables to an earlier state, **When** the re-snapshot checker runs, **Then** all differences between the restored state and the last-synced snapshot are detected and enqueued.
5. **Given** no changes have occurred since the last snapshot, **When** the re-snapshot checker runs, **Then** no new outbox entries are created and the snapshot timestamp is updated.

---

### User Story 2 - Stale Cloud Writes Are Rejected with Version Guards (Priority: P1)

When two PCs modify the same record and push to the cloud, the cloud rejects stale writes using conditional version checks. The device whose write is rejected receives clear feedback that a newer version exists, preventing silent data loss from overwrites.

**Why this priority**: Without version-guarded writes, the last device to push silently overwrites changes from other devices. Version guards are the foundation of conflict detection — they turn silent data loss into observable, resolvable conflicts.

**Independent Test**: Can be tested by pushing a record from PC-A, then attempting to push an older version of the same record from PC-B, and verifying the cloud rejects PC-B's write with a version conflict error.

**Acceptance Scenarios**:

1. **Given** PC-A pushes a record with version 1 to the cloud, **When** PC-B attempts to push the same record with version 1, **Then** the cloud rejects PC-B's write because a record with version >= 1 already exists.
2. **Given** PC-A pushes a record with version 2 (an update), **When** PC-B pushes the same record with version 3, **Then** the cloud accepts PC-B's write because version 3 > version 2.
3. **Given** a conditional write is rejected, **When** the push engine processes the rejection, **Then** the outbox entry is marked as a version conflict and a conflict record is logged locally.

---

### User Story 3 - Non-Overlapping Field Changes Are Merged Automatically (Priority: P1)

A teacher on PC-A updates a student's phone number, while an administrator on PC-B updates the same student's address. When the pull engine detects both changes, the system merges them automatically — keeping the phone number from PC-A and the address from PC-B — without requiring manual intervention.

**Why this priority**: Field-level merge eliminates the majority of "false conflicts" that would otherwise require administrator attention. In a school environment, different staff members routinely update different fields on the same record, and treating every such case as a conflict would quickly overwhelm administrators.

**Independent Test**: Can be tested by creating two versions of the same record with non-overlapping field changes, running the merge logic, and verifying the output contains both changes with no conflict logged.

**Acceptance Scenarios**:

1. **Given** a local record has field A modified and a remote record has field B modified (compared to the common ancestor version), **When** the conflict resolver processes these changes, **Then** the merged result contains both field A from local and field B from remote, and no conflict entry is logged.
2. **Given** a local record has fields A and B modified, and a remote record has field C modified, **When** the merge runs, **Then** all three field changes are preserved in the merged result.
3. **Given** both local and remote modify the same field to the same value, **When** the merge runs, **Then** the identical change is kept and no conflict is logged.

---

### User Story 4 - Overlapping Field Changes Apply Last-Writer-Wins (Priority: P2)

When both PCs modify the same field on the same record to different values, the system applies last-writer-wins — the change with the most recent timestamp takes precedence. The overwritten value is preserved in the conflict log for administrator review.

**Why this priority**: While field-level merge handles most cases automatically, true conflicts (same field, different values) need a deterministic resolution strategy. Last-writer-wins provides predictable behavior without blocking the sync process, while the conflict log ensures no data is permanently lost.

**Independent Test**: Can be tested by creating two versions of the same record where both modify the same field to different values, running the auto-resolution, and verifying the most recent change wins and a conflict entry is logged.

**Acceptance Scenarios**:

1. **Given** both local and remote records modify the same field to different values, **When** the auto-resolver runs, **Then** the version with the later timestamp wins, and the other value is preserved in the conflict log.
2. **Given** an overlapping conflict is auto-resolved, **When** an administrator views the conflict log, **Then** they see both the winning and losing values along with timestamps and device origins.
3. **Given** an auto-resolved conflict exists in the log, **When** the administrator disagrees with the resolution, **Then** they can override it by choosing the alternative value via the existing `sync:resolveConflict` IPC channel.

---

### User Story 5 - Re-Snapshot Checker Runs Periodically in the Background (Priority: P2)

The re-snapshot checker starts automatically alongside the push and pull engines, runs on a configurable interval (default 30 minutes), and stops cleanly on app exit. It does not interfere with ongoing push or pull operations.

**Why this priority**: The re-snapshot checker must run reliably in the background to catch drift. Without automatic scheduling, missed changes would only be detected when an administrator manually triggers a check — which defeats the purpose of automatic sync integrity.

**Independent Test**: Can be tested by enabling sync, verifying the snapshot timer starts, waiting for one interval, and confirming the checker executed without errors.

**Acceptance Scenarios**:

1. **Given** sync is enabled, **When** the app starts, **Then** the re-snapshot checker starts a background timer with the configured interval (default 30 minutes).
2. **Given** the snapshot checker is running, **When** the app is closed, **Then** the snapshot timer stops cleanly without blocking shutdown.
3. **Given** the snapshot checker is running, **When** a re-snapshot cycle is already in progress and the timer fires again, **Then** the new cycle is skipped (re-entrancy guard).
4. **Given** the snapshot checker encounters an error (e.g., database locked), **When** the cycle fails, **Then** the error is logged and the checker retries on the next interval without crashing.

---

### User Story 6 - Conflict Log Records Are Enriched with Resolution Details (Priority: P3)

When conflicts are detected and resolved (either automatically or manually), the conflict log stores comprehensive details including: the common ancestor version, both competing versions, which fields conflicted, the resolution method used (field-merge, last-writer-wins, or manual), and the final merged result.

**Why this priority**: Enriched conflict records enable administrators to audit sync behavior, understand what changed, and build trust in the automatic resolution system. This is important for accountability in a school environment but is additive to the core merge functionality.

**Independent Test**: Can be tested by triggering a conflict, verifying the conflict log entry includes all expected fields, and confirming the resolution details are accurate.

**Acceptance Scenarios**:

1. **Given** a field-level merge was performed automatically, **When** the conflict log entry is created, **Then** it records the resolution method as "merged", lists the fields that were auto-merged, and stores the final merged data.
2. **Given** a last-writer-wins resolution was applied, **When** the conflict log entry is created, **Then** it records the resolution method as "lww", identifies the conflicting fields, and stores both the winning and losing values.
3. **Given** an administrator queries the conflict log via `sync:getConflictLog`, **Then** each entry includes: table name, record identifier, local data, remote data, resolution method, conflicting field names, and timestamps.

---

### Edge Cases

- What happens when the re-snapshot checker runs on a table that has never been synced before? The checker performs a full snapshot comparison against an empty baseline, treating all existing rows as new and enqueuing them for push.
- What happens when the re-snapshot checker detects changes on a table the current user's role cannot push? The changes are enqueued in the outbox but will be skipped by the push engine's authority check — they persist until a user with the appropriate role pushes them.
- What happens when a field-level merge encounters a field present in one version but absent in the other? The present value is kept — a field addition is not considered a conflict.
- What happens when both local and remote versions add a new field that did not exist in the ancestor? If the values are identical, no conflict. If different, last-writer-wins is applied for that field.
- What happens when the re-snapshot checker runs during an active pull cycle? The re-snapshot checker acquires a lightweight coordination lock; if a pull is in progress, the snapshot cycle is deferred to the next interval.
- What happens when the database schema has changed since the last snapshot (e.g., new columns added by migration)? The checker uses the current schema to compute checksums, effectively treating new columns as new data — any populated values in new columns will be detected and synced.
- What happens when the conflict log grows very large? Resolved conflicts older than 30 days are automatically pruned during each snapshot cycle to prevent unbounded growth.

## Requirements *(mandatory)*

### Functional Requirements

**Re-Snapshot Checker**

- **FR-001**: System MUST periodically compare the current state of each synced table against a stored snapshot of the last-known synced state.
- **FR-002**: For each row that differs between the current state and the stored snapshot, the system MUST enqueue the appropriate operation (PUT for inserts/updates, DEL for deletions) in the sync outbox.
- **FR-003**: The snapshot comparison MUST use row-level checksums computed from all non-sensitive columns to detect modifications efficiently.
- **FR-004**: The system MUST store per-table snapshot metadata (last snapshot timestamp, row count, aggregate checksum) to enable fast "has anything changed?" pre-checks before performing full row-level comparisons.
- **FR-005**: The re-snapshot checker MUST run on a configurable interval, defaulting to 30 minutes, with a valid range of 10–120 minutes.
- **FR-006**: The re-snapshot checker MUST enforce a re-entrancy guard so only one snapshot cycle runs at a time.
- **FR-007**: The re-snapshot checker MUST coordinate with the pull engine to avoid running simultaneously — if a pull is in progress, the snapshot cycle is deferred.
- **FR-008**: The re-snapshot checker MUST start and stop alongside the push and pull engines as part of the sync lifecycle.
- **FR-009**: Snapshot cycle errors MUST be logged and never crash the application; the checker retries on the next interval.

**Version-Guarded Cloud Writes**

- **FR-010**: The push engine MUST include a version number with each record pushed to the cloud.
- **FR-011**: Cloud writes MUST use conditional expressions that reject writes where the incoming version is not greater than the existing version.
- **FR-012**: When a conditional write is rejected (version conflict), the push engine MUST mark the outbox entry as a conflict and create a local conflict log entry.
- **FR-013**: After a version conflict, the push engine MUST fetch the current cloud version of the record to enable conflict resolution.

**Field-Level Merge**

- **FR-014**: When a conflict is detected between a local change and a remote change for the same record, the system MUST compare changes at the individual field level against a common ancestor version.
- **FR-015**: For fields modified only in the local version or only in the remote version (non-overlapping changes), the system MUST automatically merge both changes without logging a conflict.
- **FR-016**: For fields modified in both versions to the same value, the system MUST keep the common value without logging a conflict.
- **FR-017**: For fields modified in both versions to different values (true overlap), the system MUST apply last-writer-wins based on the record's timestamp.
- **FR-018**: After auto-resolution of overlapping fields, the system MUST log the conflict with both values, the resolution method, and the list of conflicting fields.

**Conflict Log Enrichment**

- **FR-019**: Each conflict log entry MUST include: table name, row sync ID, entity type, local data snapshot, remote data snapshot, conflicting field names, resolution method (merged/lww/manual), and the final resolved data.
- **FR-020**: The system MUST store the common ancestor version (the last successfully synced state) for use in three-way merge comparisons.
- **FR-021**: Resolved conflict entries older than 30 days MUST be automatically pruned during snapshot cycles.
- **FR-022**: The existing `sync:getConflictLog` IPC channel MUST return enriched conflict entries including resolution details and conflicting field names.

**Integration**

- **FR-023**: The re-snapshot checker MUST reuse the existing credential manager and sync configuration from prior phases.
- **FR-024**: All new sync outbox entries created by the re-snapshot checker MUST follow the same format as entries created by the capture layer.
- **FR-025**: The existing smoke test suite MUST pass with no regressions after adding the snapshot checker and merge logic.
- **FR-026**: The re-snapshot checker interval MUST be configurable via the existing `sync:setConfig` IPC channel.

### Key Entities

- **Table Snapshot**: A per-table record of the last-known synced state — includes table name, row count, aggregate checksum, and the timestamp of the last snapshot. Used to detect drift between the local database and what has been synced.
- **Row Checksum**: A hash computed from all non-sensitive columns of a single row, used to detect whether a row has been modified since the last snapshot.
- **Common Ancestor**: The last successfully synced version of a record, stored locally. Used as the baseline for three-way field-level merge when comparing local and remote changes.
- **Field-Level Diff**: The set of individual field changes between two versions of a record, computed by comparing each field value. Used to determine whether changes overlap or can be merged automatically.
- **Enriched Conflict Entry**: An enhanced conflict log record that includes not just the local and remote data, but also the ancestor version, the list of conflicting fields, the resolution method applied, and the final merged result.

## Assumptions

- Phases 1–4 (sync foundation, AWS infrastructure, push engine, pull engine) are fully implemented and merged before Phase 5 begins.
- The `sync_conflicts` table already exists from the Phase 4 migration and will be extended with additional columns for enriched conflict data.
- The `sync_id_map` table provides reliable bidirectional mapping between local IDs and cloud sync IDs for all synced records.
- The push engine already uses conditional writes (`ConditionExpression`) for versioned entries — Phase 5 extends this to all writes and adds proper conflict handling for rejections.
- The number of rows per synced table is small enough (typically under 10,000 per school per year) that row-level checksum comparison is feasible within the 30-minute snapshot interval.
- Sensitive fields (password hashes, tokens) are already stripped by the capture layer and do not need special handling in the snapshot checker.
- The `sync:resolveConflict` IPC channel from Phase 4 already exists and can be extended to support the enriched conflict data.

## Out of Scope

- Sync settings UI page — deferred to Phase 6 (Sync Settings UI).
- Real-time conflict resolution notifications — deferred to Phase 6 (the UI will poll the conflict log).
- Schema migration synchronization across devices — each device runs its own migrations independently.
- Selective table sync (choosing which tables to sync) — all 17 entity types are synced.
- Conflict resolution for soft-deleted or archived records — soft deletes follow the same DEL operation flow.
- Three-way merge UI showing ancestor/local/remote side-by-side — deferred to Phase 6.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A row inserted directly into the local database (bypassing the sync capture layer) is detected and synced to other PCs within 2 snapshot intervals (default: 60 minutes) without manual intervention.
- **SC-002**: The re-snapshot checker processes all 17 synced tables in under 60 seconds on standard school hardware with up to 10,000 rows per table.
- **SC-003**: When two PCs modify different fields on the same record, the system auto-merges the changes with zero conflicts logged in 100% of cases.
- **SC-004**: When two PCs modify the same field on the same record, the system applies last-writer-wins and logs the conflict with both values in 100% of cases.
- **SC-005**: Version-guarded cloud writes reject 100% of stale writes — no silent overwrites occur.
- **SC-006**: The conflict log includes resolution details (method, conflicting fields, ancestor data) for every auto-resolved conflict.
- **SC-007**: Resolved conflicts older than 30 days are automatically cleaned up, keeping the conflict log under 1,000 entries per school.
- **SC-008**: The existing smoke test suite passes with zero regressions after all Phase 5 changes.
- **SC-009**: The application continues to function identically when sync is disabled — no errors, no performance impact from snapshot checking.

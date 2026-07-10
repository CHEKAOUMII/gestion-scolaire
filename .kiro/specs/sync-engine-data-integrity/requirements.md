# Requirements Document

## Introduction

A code review of the cloud sync flow (`settings-sync.html` plus the modules under `main/sync/` and `main/firebase/`) surfaced multiple data-loss and non-convergence risks. This spec captures those risks as testable requirements so the sync engine can be hardened against silent data loss, tombstone resurrection, and divergence between devices.

Before drafting each requirement the cited code was read and the claim verified against the current implementation. Each requirement below records the validation outcome (Confirmed / Partially Confirmed) and the exact code location so the design phase starts from ground truth rather than the review text alone.

The sync model is an outbox/cursor design: local writes are captured into `sync_outbox`, pushed to Firestore as both per-entity documents and `syncLog` change records, and remote changes are pulled back via a cursor over `syncLog` (or a one-time bootstrap from entity collections). Per-row version/ancestor state lives in `sync_id_map`. Conflicts are resolved with a three-way merge that falls back to last-writer-wins (LWW).

Scope priority:
- **Requirements 1-6** address the six CRITICAL findings and are in scope.
- **Requirements 7-12** address IMPORTANT findings and are proposed but flagged for the user to confirm scope.
- Cosmetic nits (numbered restating comments, stale AWS labels such as Lambda/Cognito/DynamoDB in `settings-sync.js`, long mixed-concern functions) are noted at the end and are considered out of scope unless requested.

### Relationship to the `sync-phantom-version-conflicts` spec

Requirement 6 overlaps with the already-shipped spec at `.kiro/specs/sync-phantom-version-conflicts`. That spec implemented `reconcileUnreconciledRow` in `main/sync/engine.js` to stop phantom conflicts on seeded rows. Verification (see Requirement 6) found a residual gap relative to that spec's own Requirement 2.2, not a request to redo it. Requirement 6 is therefore scoped to **complete/correct** that branch and explicitly cross-references the prior spec to avoid duplicating shipped behavior.

## Glossary

- **Sync_Engine**: The set of modules in `main/sync/` plus `main/firebase/sync-log.js` and `main/firebase/collections.js` that capture, push, and pull data between local SQLite and Firestore.
- **Push_Pipeline**: The push path in `main/sync/engine.js` (`flushSyncOutbox`, `flushPreparedItems`, `flushExpandedEntries`, `writeItemWithVersionCheck`, `markEntrySent`).
- **Pull_Pipeline**: The pull path in `main/sync/engine.js` (`pullRemoteChanges`, `applySingleItem`, `applyPutOperation`, `handlePullConflict`).
- **Bootstrap_Loader**: `bootstrapFromCollections` in `main/firebase/sync-log.js`, used on first pull when local data is empty.
- **Capture_Layer**: `main/sync/capture.js`, which records local writes into `sync_outbox` and maintains `sync_id_map`.
- **Sync_Status_Service**: The `sync:getStatus` IPC handler in `main/ipc/sync.js` and the renderer status logic in `js/pages/settings-sync.js`.
- **Outbox**: The `sync_outbox` table; rows have `status` in `pending|sent|failed|superseded` and an `operation` of `PUT` or `DEL`.
- **Pull_Cursor**: The `sync_config.pull_cursor` value (`{updatedAt, changeId}`) marking the last consumed `syncLog` change.
- **Sync_Id_Map**: The `sync_id_map` table tracking `row_sync_id`, `table_name`, `local_id` (INTEGER), `version`, and `ancestor_data` per row.
- **Business_Key_Document**: A Firestore document whose ID is built from business-key fields (e.g. `students.code`, `grades.student_code__subject__semester__school_year`) rather than the local SQLite integer id, per `COLLECTION_MAP` in `main/firebase/collections.js`.
- **Tombstone**: A Firestore document representing a deleted row (operation `DEL`).
- **Expanded_Row**: An individual row produced by `expandBulkEntry` when a bulk Outbox summary entry is flushed.
- **Unreconciled_Row**: A row whose `sync_id_map.version` is missing or `0` and whose `ancestor_data` is null.
- **Three_Way_Merge**: `threeWayMerge` in `main/sync/merge.js`, returning `{ merged, conflicts, resolution }` where `resolution` is `clean`, `merged`, or `lww`.

## Requirements

### Requirement 1: Pull cursor must not advance past unapplied changes

**User Story:** As a school operator syncing across devices, I want the pull cursor to only advance over changes that were actually applied locally, so that a transient apply failure does not permanently skip remote changes.

**Validation:** Confirmed. In `pullRemoteChanges` (`main/sync/engine.js`), `newCursor` is computed from `allItems[allItems.length - 1]` and written via `UPDATE sync_config SET pull_cursor = ?` unconditionally, regardless of `stats.failedCount`. `applySingleItem` increments `stats.failedCount` on apply errors (INSERT/UPDATE/DELETE failures, unresolved `student_files` references) but those failures do not hold back the cursor. A subsequent pull starts after the skipped change, so failed items are never retried.

#### Acceptance Criteria

1. WHEN a pull cycle finishes with at least one failed item, THE Pull_Pipeline SHALL set the Pull_Cursor no further than the position of the last successfully applied change.
2. IF a pull cycle applies a contiguous prefix of changes and then encounters a failed change, THEN THE Pull_Pipeline SHALL advance the Pull_Cursor only up to the last change in that successfully applied prefix.
3. WHEN a pull cycle applies every fetched change successfully, THE Pull_Pipeline SHALL advance the Pull_Cursor to the last fetched change.
4. WHEN a subsequent pull cycle runs after a previous cycle had failed items, THE Pull_Pipeline SHALL re-fetch the changes that were not successfully applied.

### Requirement 2: Pull conflict resolution must converge and use the real local edit time

**User Story:** As a user editing data on two devices, I want a merged or chosen value to actually propagate to other devices, so that all devices converge on the same value instead of silently keeping divergent copies.

**Validation:** Confirmed. In `handlePullConflict` (`main/sync/engine.js`), `localTs` is set to `Math.floor(Date.now() / 1000)`, which biases the LWW comparison in `Three_Way_Merge` toward the local value because the local timestamp is always "now" rather than the actual local edit time. After merging, the pending Outbox entry is set to `status = 'sent'` (both in the `resolution === 'clean'` branch and after recording the conflict) without enqueueing a push of the merged/chosen value, so the resolved value is never propagated to Firestore or other devices.

#### Acceptance Criteria

1. WHEN the Pull_Pipeline resolves a conflict by choosing or merging a value that differs from the current remote value, THE Push_Pipeline SHALL propagate that resolved value to the remote store.
2. WHILE resolving a pull-side conflict, THE Pull_Pipeline SHALL use the recorded local edit timestamp of the pending change as the local side of the last-writer-wins comparison.
3. IF a pull-side merge produces a value byte-identical to the current remote value, THEN THE Pull_Pipeline SHALL mark the corresponding Outbox entry sent without scheduling a redundant push.
4. WHEN a pull-side conflict resolution completes, THE Sync_Engine SHALL leave the resolved value, the `sync_id_map` version, and the `ancestor_data` in a state where the next push and pull converge to the same value on all devices.

### Requirement 3: Entity writes and sync-log propagation must be durable together

**User Story:** As a user whose change was saved to the server, I want other devices to reliably receive that change, so that a sync-log write failure does not leave a change stranded on one device.

**Validation:** Confirmed. In `flushPreparedItems` (`main/sync/engine.js`), each item calls `markEntrySent(db, prepared.entryId)` immediately after a successful `writeItemWithVersionCheck`, and `writeSyncLogWithRetry` is only called once after the loop. If the entity write succeeds but the `syncLog` batch write permanently fails, the Outbox entry is already `sent`, so the change is logged locally as propagated while no `syncLog` record exists for other devices to pull. (`flushExpandedEntries` already gates `markEntrySent` on `syncLogWritten`, so the defect is specific to `flushPreparedItems`.)

#### Acceptance Criteria

1. IF an entity document write succeeds but the corresponding `syncLog` change write fails permanently, THEN THE Push_Pipeline SHALL NOT mark the Outbox entry as fully sent.
2. WHEN both the entity document write and the corresponding `syncLog` change write succeed, THE Push_Pipeline SHALL mark the Outbox entry as sent.
3. WHEN a `syncLog` change write fails after its entity document write succeeded, THE Push_Pipeline SHALL retain enough state to re-attempt propagation of that change on a later push cycle.
4. WHEN a push cycle re-attempts an entry whose entity document was already written, THE Push_Pipeline SHALL complete `syncLog` propagation without creating a duplicate or divergent entity document.

### Requirement 4: Deletes must be safe for business-key documents and survive bootstrap

**User Story:** As a user who deletes a record, I want the deletion to propagate correctly and stay deleted on every device, so that deleted records are not silently retained or resurrected.

**Validation:** Confirmed (multiple parts).
- `recordOutboxEntry` (`main/sync/capture.js`) stores `row_data = null` for `DEL` and identifies the row only by the local SQLite integer id embedded in `row_sync_id`.
- `buildFirestoreDoc` (`main/sync/engine.js`) parses `row_data` (null → `{}`) and calls `buildDocumentId`, which for Business_Key_Documents (e.g. `grades`, `absences`, `staff_attendance`, `student_files`) requires business-key fields that are absent for a `DEL`; `buildDocumentId` then returns null and the delete cannot be pushed.
- `writeItemWithVersionCheck` uses `transaction.set(docRef, payload, { merge: true })` for every operation including `DEL`, so a delete merges into the existing document rather than removing it, leaving a Tombstone.
- `bootstrapFromCollections` (`main/firebase/sync-log.js`) maps every fetched document to `operation: 'PUT'`, so any document still present on the server is recreated locally during bootstrap, resurrecting deleted rows.

#### Acceptance Criteria

1. WHEN a row backed by a Business_Key_Document is deleted, THE Capture_Layer SHALL retain enough business-key information for the Push_Pipeline to construct the correct remote document identifier for that deletion.
2. WHEN the Push_Pipeline processes a `DEL` operation, THE Push_Pipeline SHALL produce a valid remote document identifier or record an actionable failure rather than silently dropping the deletion.
3. WHEN a `DEL` operation is applied to the remote store, THE Push_Pipeline SHALL represent the deletion such that the Pull_Pipeline on other devices removes the corresponding local row.
4. WHEN the Bootstrap_Loader reads a document that represents a deletion, THE Bootstrap_Loader SHALL preserve the deletion semantics so that the row is not recreated locally.
5. WHEN the Pull_Pipeline receives a deletion for a row that exists locally, THE Pull_Pipeline SHALL remove the corresponding local row.

### Requirement 5: Bulk-expanded rows must update per-row sync state

**User Story:** As a user whose bulk operation was synced, I want each affected row to have correct version and ancestor state, so that later edits to those rows merge correctly instead of producing phantom conflicts.

**Validation:** Confirmed. `flushExpandedEntries` (`main/sync/engine.js`) writes each Expanded_Row via `writeItemWithVersionCheck` but only calls `markEntrySent(db, entryId)` for the single bulk summary Outbox row. It never updates `sync_id_map.version` or `ancestor_data` for the individual `row_sync_id`s produced by `expandBulkEntry`. Those rows therefore stay at `version = 0` / `ancestor_data = null`, so their next push collides at the version guard and degrades into conflict handling.

#### Acceptance Criteria

1. WHEN the Push_Pipeline successfully writes an Expanded_Row to the remote store, THE Push_Pipeline SHALL update that row's `sync_id_map.version` to match the written version.
2. WHEN the Push_Pipeline successfully writes an Expanded_Row to the remote store, THE Push_Pipeline SHALL set that row's `sync_id_map.ancestor_data` to the data that was written.
3. WHEN a bulk Outbox summary entry is fully flushed, THE Push_Pipeline SHALL leave every successfully written Expanded_Row in a reconciled state equivalent to a single-row push of the same data.
4. WHEN an Expanded_Row that was previously flushed is edited and pushed again, THE Push_Pipeline SHALL push it at the correct incremented version without entering conflict handling solely because of stale per-row state.

### Requirement 6: Reconciled seeded rows with genuine local edits must propagate

**User Story:** As a user who edited a seeded row before its first sync, I want my edit to reach other devices, so that adopting the server baseline during reconciliation does not silently discard my change.

**Validation:** Confirmed gap relative to the shipped `sync-phantom-version-conflicts` spec (its Requirement 2.2). `reconcileUnreconciledRow` (`main/sync/engine.js`) adopts the server data as ancestor and re-runs `threeWayMerge(serverData, localData, serverData, ...)`. In `merge.js`, a field the local device changed (where `ancestor === remote` but `local` differs) is classified as "only local changed": it is placed in `merged` with the local value, sets `hadNonOverlap = true`, and is **not** added to `conflicts`, so `resolution === 'merged'` and `conflicts.length === 0`. `reconcileUnreconciledRow` only defers to a re-push/conflict path when `conflicts.length > 0`; for the `conflicts.length === 0` case it calls `markEntrySent(...)`, marking the entry sent and adopting the server version without uploading the genuine local change. The prior spec's Requirement 2.2 states the row should be re-pushed "only if a genuine local change remains", so this is a residual gap in the shipped implementation, not new behavior.

This requirement is scoped to correcting that reconciliation outcome. It must **not** alter the phantom-conflict behavior already validated by the prior spec (silent reconciliation when there is no genuine local change, and genuine-conflict logging when fields truly overlap).

#### Acceptance Criteria

1. WHEN reconciliation of an Unreconciled_Row adopts the server baseline and the re-merge shows the local row changed one or more fields the server did not, THE Push_Pipeline SHALL propagate those local changes to the remote store rather than marking the entry sent without uploading.
2. WHEN reconciliation re-pushes a genuine local change, THE Push_Pipeline SHALL use the adopted server version incremented by one so the conditional write is accepted.
3. WHERE reconciliation finds no field that differs between the local row and the adopted server baseline, THE Push_Pipeline SHALL complete reconciliation silently without recording an unresolved conflict, preserving the behavior shipped in the `sync-phantom-version-conflicts` spec.
4. WHEN reconciliation re-merge reports a genuine field-level overlap, THE Push_Pipeline SHALL record an unresolved conflict as defined by the `sync-phantom-version-conflicts` spec.
5. WHEN reconciliation completes for an Unreconciled_Row, THE Sync_Engine SHALL leave the row's `sync_id_map.version` and `ancestor_data` consistent with the value that was propagated.

## Proposed Requirements (Scope Confirmation Needed)

The following requirements address IMPORTANT findings. They are validated against the code but flagged for the user to confirm whether each is in scope for this spec.

### Requirement 7: Sync status must reflect actual cycle activity

**User Story:** As an operator watching the sync settings page, I want the "syncing" indicator to reflect whether a sync cycle is actually running, so that I am not misled by a timer that merely exists.

**Validation:** Confirmed. `sync:getStatus` (`main/ipc/sync.js`) returns `pushRunning: isPushTimerRunning()` and `pullRunning: isPullTimerRunning()`, which check `_syncTimer !== null` / `_pullTimer !== null` (timer existence). The engine exposes actual cycle flags (`isPullCycleRunning()` over `_pullRunning`; `_flushRunning` for push) that are not used by the status handler. `deriveSyncState` in `js/pages/settings-sync.js` shows `syncing` whenever `pushRunning || pullRunning || snapshotRunning`, so the page reports "syncing" continuously while timers are scheduled.

#### Acceptance Criteria

1. WHEN the Sync_Status_Service reports push activity, THE Sync_Status_Service SHALL base that value on whether a push cycle is currently executing rather than on the existence of a scheduling timer.
2. WHEN the Sync_Status_Service reports pull activity, THE Sync_Status_Service SHALL base that value on whether a pull cycle is currently executing rather than on the existence of a scheduling timer.
3. WHILE no sync cycle is executing, THE Sync_Status_Service SHALL report a non-running state for push and pull activity.

### Requirement 8: Admin role definition must be consistent across renderer and main process

**User Story:** As a developer-role user, I want consistent access to sync administration, so that the UI and the backend agree on who may manage sync.

**Validation:** Confirmed. `js/pages/settings-sync.js` defines `SYNC_ADMIN_ROLES = new Set(['admin', 'developer'])` and gates the UI on it, while `main/ipc/sync.js` uses `SYNC_ADMIN_ROLES = ['admin']` for `handleAdminRead` and `['admin']` for write channels. A `developer` user sees sync admin controls in the renderer but is rejected by the IPC layer.

#### Acceptance Criteria

1. THE Sync_Engine SHALL apply one consistent definition of which roles may administer sync across the renderer and the main process.
2. IF a role is permitted to view sync administration controls, THEN THE Sync_Engine SHALL permit that role to invoke the corresponding sync administration operations, or SHALL hide those controls from that role.

### Requirement 9: A zero max-retries setting must not strand pending changes

**User Story:** As an operator, I want every configured retry limit to still allow at least one push attempt, so that changes are not stuck unsent because of the retry-limit setting.

**Validation:** Confirmed. `SYNC_NUMBER_LIMITS.maxRetries` in `main/ipc/sync.js` allows a minimum of `0`. `readPendingOutboxBatch` (`main/sync/engine.js`) selects rows with `retries < ?` bound to `maxRetries`. With `maxRetries = 0`, the predicate `retries < 0` is never satisfied for any row (retries default to `0`), so no pending rows are ever selected for push and they remain `pending` indefinitely.

#### Acceptance Criteria

1. WHEN the configured maximum retry count is zero, THE Push_Pipeline SHALL still attempt to push each pending Outbox entry at least once.
2. IF the configured maximum retry count would otherwise prevent any push attempt, THEN THE Sync_Engine SHALL treat the setting so that a pending entry receives at least one attempt before being considered failed.

### Requirement 10: Text-primary-key tables must apply pulled updates correctly

**User Story:** As a user, I want settings and page-visibility changes to apply correctly when pulled, so that remote updates to text-keyed rows are not silently dropped.

**Validation:** Confirmed. `settings` (PK `key TEXT`) and `page_visibility` (PK `page_key TEXT`) use text primary keys (`main/db/schema.js`), but `sync_id_map.local_id` is `INTEGER NOT NULL`. The Capture_Layer stores a hashed integer (`hashStringToInt`) as `local_id` for these tables. In `applyPutOperation` (`main/sync/engine.js`), when a `sync_id_map` mapping exists the UPDATE targets `WHERE "<pkColumn>" = mapping.local_id`, i.e. the hashed integer, which cannot match the real text key, so the update affects no rows and the pulled change is silently lost.

#### Acceptance Criteria

1. WHEN the Pull_Pipeline applies a change to a table whose primary key is a text column, THE Pull_Pipeline SHALL locate the target row by its business key rather than by a hashed integer identifier.
2. WHEN the Pull_Pipeline applies an update to a text-primary-key row that already exists locally, THE Pull_Pipeline SHALL modify the intended row.
3. WHEN the Capture_Layer records a change for a text-primary-key table, THE Sync_Engine SHALL maintain identity information sufficient for the Pull_Pipeline to resolve the correct local row.

### Requirement 11: Captured tables must be registered as syncable entities

**User Story:** As a user, I want every table that is captured for sync to actually sync, so that changes captured into the Outbox are not silently skipped.

**Validation:** Confirmed. `CHANNEL_REGISTRY` in `main/sync/capture.js` captures writes for `exam_invitations`, `exam_attendance`, `school_events`, `inspectors`, and `name_aliases`, but `WRITER_AUTHORITY` / `ENTITY_TYPE_REGISTRY` in `main/sync/authority.js` and `COLLECTION_MAP` in `main/firebase/collections.js` do not include these tables. Outbox entries are created (`canPush` returns false and `getEntityType` returns null), so the Push_Pipeline skips them and the captured changes never propagate.

#### Acceptance Criteria

1. THE Sync_Engine SHALL ensure that every table captured into the Outbox is either registered as a syncable entity with a defined remote collection and document identity, or is explicitly excluded from capture.
2. IF a captured table has no syncable-entity registration, THEN THE Sync_Engine SHALL surface an actionable indication rather than silently skipping the captured change.
3. WHERE a captured table is intended to sync, THE Sync_Engine SHALL define its entity type, write authority, and remote document identity consistently across the Capture_Layer, authority registry, and collection map.

### Requirement 12: "Configured" status must require credentials needed for Firebase auth

**User Story:** As an operator, I want the sync "configured" indicator to mean sync can actually authenticate, so that I am not told sync is configured when it cannot connect.

**Validation:** Partially Confirmed. `getSyncConfig` / `sync:getStatus` (`main/ipc/sync.js`) compute `configured` from `school_id`, `firebaseFunctionsUrl`, and `firebaseProjectId` only. `ensureFirebaseApp` (`main/sync/credentials.js`) requires `apiKey` and `projectId` to initialize the Firebase app, and email/password auth additionally needs the app to be initialized. So `configured` can be true while `firebase_api_key` (and the app id surfaced to the renderer) is empty, in which case authentication cannot succeed. The exact set of fields required for a successful sign-in should be confirmed during design.

#### Acceptance Criteria

1. WHEN the Sync_Status_Service reports that sync is configured, THE Sync_Status_Service SHALL require that all credential fields necessary to authenticate with Firebase are present.
2. IF a credential field required for Firebase authentication is missing, THEN THE Sync_Status_Service SHALL report sync as not fully configured.

## Out of Scope (Noted Only)

These cosmetic and structural items were observed but are not proposed as requirements unless requested:
- Numbered restating comments that duplicate code intent.
- Stale AWS labels (Lambda / Cognito / DynamoDB) in `js/pages/settings-sync.js` (around the functions-URL field) that no longer match the Firebase backend.
- Long, mixed-concern functions in `main/sync/engine.js` that could be decomposed for readability.

## Notes

- All six critical findings (Requirements 1-6) were confirmed against the current code at the cited locations.
- Requirement 6 is deliberately scoped to complete the prior `sync-phantom-version-conflicts` spec's Requirement 2.2 rather than re-implement its reconciliation; design work for Requirement 6 should cross-reference that spec's `design.md`.
- Requirements 7-12 are proposed pending your confirmation of scope.

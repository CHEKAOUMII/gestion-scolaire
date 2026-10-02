# Requirements Document

## Introduction

The cloud sync upload (push) path drains far too slowly. At the time of writing, roughly 47,301 changes are stuck pending in the local `sync_outbox`. The root cause is that the push path (`flushSyncOutbox` → `flushPreparedItems`) processes items strictly one at a time: each item is `await`ed inside a sequential `for` loop, and each item opens its own Firestore `runTransaction` (a read-before-write optimistic version guard). With a typical round-trip latency near 200ms per document, effective throughput is roughly 5 documents/second, so a large backlog takes hours to drain.

This feature improves push throughput in two layers while preserving the existing correctness model exactly:

- **Layer 1 (primary):** Replace the sequential per-item loop with bounded parallelism (a concurrency pool) that ramps up under success and backs off under throttling, keeping the per-document version guard unchanged. Raise the per-cycle drain limit while a backlog exists.
- **Layer 2 (structural):** Add an optional batched fast path for the common no-conflict case: bulk-read current remote versions, compare versions locally, commit non-conflicting survivors via Firestore `writeBatch`, and fall back to the existing per-document version-guard transaction for the rare conflicting items.

The optimistic version guard, conflict detection (`logVersionConflict`), phantom-conflict reconciliation (`reconcileUnreconciledRow`), role-based push authority (`canPush`), bulk-entry expansion (`expandBulkEntry`), and self-origin handling MUST be preserved with no data loss and no silent overwrites.

### Environment Constraints (informative)

- Electron 35 main process (Node.js); `better-sqlite3` is the local source of truth.
- Firebase Web/Client SDK (`firebase/firestore`). Firestore server-only `BulkWriter` is NOT available and MUST NOT be used. `firebase-admin` is out of scope (no client service-account credentials).
- Devices authenticate as users; Firestore security rules apply.
- Firestore enforces a hard limit of 500 write operations per `writeBatch` commit (a batch-size limit, not a concurrency level).
- Firestore's guidance is to ramp request load up gradually and back off on throttling. This client applies that guidance through bounded transaction concurrency, not raw request-rate tuning: concurrency starts conservatively (default initial 10), increases in small steps (+5) on sustained success, and is capped (default 20, never above the absolute ceiling of 50). A client-side Electron app must never run hundreds of concurrent Firestore transactions.

## Glossary

- **Push_Engine**: The component implemented in `main/sync/engine.js` that drains pending rows from `sync_outbox` to Firestore. Entry point `flushSyncOutbox`; item dispatch in `flushPreparedItems`.
- **Outbox**: The local `sync_outbox` table holding pending change rows ordered by `id` ascending.
- **Version_Guard**: The optimistic-concurrency mechanism in `writeItemWithVersionCheck` that, within a Firestore `runTransaction`, reads the remote document and writes only when the local `item.version` is strictly greater than the remote `version`; otherwise it reports a conflict.
- **Concurrency_Controller**: The Layer 1 bounded-parallelism pool that dispatches multiple `Version_Guard` writes concurrently up to a configured concurrency limit.
- **Rate_Limiter**: The logic that governs the active concurrency level via gradual ramp-up on success and exponential back-off on throttling.
- **Throttling_Error**: A Firestore error indicating the service is rejecting load, identified by error code `resource-exhausted` (and equivalent unavailable/aborted overload signals).
- **Batched_Fast_Path**: The optional Layer 2 path that bulk-reads remote versions, compares locally, and commits non-conflicting items via Firestore `writeBatch`.
- **Conflict_Detection**: Existing behavior comprising `logVersionConflict` (records unresolved conflicts) and `reconcileUnreconciledRow` (phantom-conflict reconciliation for unreconciled seeded rows).
- **Push_Authority**: The role-based gate `canPush(table_name, role)` that determines whether the current session may push a given table.
- **Bulk_Entry**: An outbox entry expanded into multiple documents via `expandBulkEntry`.
- **Push_Metrics**: Observable counters and timing values describing push throughput, outcomes, and errors for a push cycle.
- **Backlog**: The set of `sync_outbox` rows whose `status` is `pending`.
- **Push_Cycle**: One invocation of `flushSyncOutbox` from start to completion.
- **Nominal_Conditions**: Single client device, healthy network with median Firestore write round-trip latency of approximately 200ms, no sustained throttling, and the device authorized to push the affected collections.

## Requirements

### Requirement 1: Bounded-Concurrency Parallel Push (Layer 1)

**User Story:** As a school administrator with a large pending backlog, I want the push path to upload many changes in parallel, so that the outbox drains in minutes instead of hours.

#### Acceptance Criteria

1. WHEN the Push_Engine dispatches a group of prepared items, THE Concurrency_Controller SHALL issue multiple `writeItemWithVersionCheck` operations concurrently, with the number of simultaneously in-flight operations never exceeding the active concurrency limit, where the active concurrency limit is a configurable integer in the inclusive range 1 to 50 with a default initial value of 10.
2. THE Concurrency_Controller SHALL apply the `Version_Guard` (per-document `runTransaction` read-before-write) to every dispatched item without modifying its conflict-detection semantics.
3. WHEN every dispatched item in a group has settled, where settled means each dispatched operation has reached exactly one terminal outcome (sent, equivalent-conflict accepted, reconciled, or failed), THE Push_Engine SHALL record the same per-item outcome that the sequential implementation produces for the identical input and identical remote state.
4. WHEN one or more items in a concurrent group fail, THE Push_Engine SHALL record each failed item as failed with its failure cause, retain that item for retry, leave all other items in the group unaffected, allow the remaining in-flight and not-yet-dispatched items in the group to settle rather than cancelling them, and evaluate any Requirement 4 access-denied abort only after every item in the group has settled.
5. WHEN a concurrent group has settled, THE Push_Engine SHALL batch the syncLog entries for the successfully sent items via the existing `writeSyncLogWithRetry` path.

### Requirement 2: Configurable Concurrency Limits

**User Story:** As an operator, I want the push concurrency to be configurable within safe bounds, so that I can tune throughput without code changes and without overwhelming Firestore.

#### Acceptance Criteria

1. THE Push_Engine SHALL read an initial concurrency value from `sync_config.push_concurrency`.
2. IF `sync_config.push_concurrency` is absent, non-numeric, not an integer, or less than 1, THEN THE Push_Engine SHALL use a default initial concurrency of 10.
3. THE Push_Engine SHALL read a maximum concurrency cap from `sync_config.push_concurrency_max` and SHALL clamp the active concurrency limit to be no greater than that cap.
4. IF `sync_config.push_concurrency_max` is absent, non-numeric, not an integer, or less than 1, THEN THE Push_Engine SHALL use a default maximum concurrency cap of 20.
5. WHERE the configured initial concurrency exceeds the configured maximum cap, THE Push_Engine SHALL clamp the active concurrency limit to the maximum cap.
6. THE Push_Engine SHALL maintain an active concurrency limit of at least 1 and no greater than the maximum cap at all times.
7. THE Push_Engine SHALL clamp the configured maximum concurrency cap to an absolute ceiling of 50, so that no configured value raises the active concurrency limit above 50.

### Requirement 3: Rate-Limit Ramp-Up and Back-Off

**User Story:** As an operator, I want push concurrency to start conservatively and adapt to Firestore's capacity, so that the system maximizes throughput without triggering sustained throttling.

#### Acceptance Criteria

1. THE Rate_Limiter SHALL begin each Push_Engine background run at the configured initial concurrency value (default 10, an integer in the inclusive range 1 to the active maximum cap).
2. WHILE consecutive concurrent groups complete without a Throttling_Error, THE Rate_Limiter SHALL increase the active concurrency limit by 5 per successful group until the active maximum cap (default 20, configurable up to the absolute ceiling of 50) is reached.
3. WHILE the active concurrency limit has reached the active maximum cap, THE Rate_Limiter SHALL hold the active concurrency limit at the cap and SHALL NOT increase it further.
4. IF a Throttling_Error (error code `resource-exhausted`, `unavailable`, or `aborted` due to overload) is detected, THEN THE Rate_Limiter SHALL reduce the active concurrency limit to the maximum of 1 and the floor of half the current active limit.
5. WHEN the active concurrency limit is reduced due to a Throttling_Error, THE Rate_Limiter SHALL wait for a back-off delay of 1000 milliseconds multiplied by 2 raised to the power of (the count of consecutive Throttling_Errors minus 1), capped at a maximum of 60000 milliseconds, before dispatching the next group.
6. WHEN a concurrent group completes with no Throttling_Error after a prior back-off, THE Rate_Limiter SHALL reset the consecutive-throttle count to zero.
7. WHEN a Throttling_Error causes an item to remain unsent, THE Push_Engine SHALL leave that item in `pending` status (not `failed`) so that it is retried on a subsequent group or Push_Cycle.
8. IF a Throttling_Error is encountered, THEN THE `writeItemWithVersionCheck` result SHALL set its throttle indicator to true so the Rate_Limiter can act on it.

### Requirement 4: Preserve Version-Guard and Conflict-Detection Correctness

**User Story:** As a data owner, I want the parallel and batched push paths to never overwrite newer remote data or lose conflicts, so that multi-device sync remains correct.

#### Acceptance Criteria

1. WHILE writing any item through any push path, THE Push_Engine SHALL write the document only when the local item version is strictly greater than the current remote version, and SHALL NOT write the document when the local item version is less than or equal to the current remote version, identical to the existing `Version_Guard` rule.
2. IF the remote version is greater than or equal to the local item version AND the remote data is equivalent to the local data, THEN THE Push_Engine SHALL mark the entry sent using the remote version, matching existing equivalent-conflict handling.
3. IF the remote version is greater than or equal to the local item version AND the remote data is not equivalent, THEN THE Push_Engine SHALL invoke `reconcileUnreconciledRow` and, when not reconciled, record the conflict via `logVersionConflict`, matching existing behavior.
4. WHEN the Batched_Fast_Path cannot read or evaluate the strict version-greater-than rule for an item, THE Push_Engine SHALL route that item to the per-document `Version_Guard` transaction instead of including it in the batch.
5. IF a Firestore access-denied error (error code `permission-denied`) is encountered, THEN THE Push_Engine SHALL stop initiating new writes for the current Push_Cycle and surface the access-denied condition to the caller, matching existing behavior.
6. WHEN a Push_Cycle aborts, THE Push_Engine SHALL preserve the `markEntrySent` side effects for items already written and SHALL apply no `markEntrySent` side effects for items not yet written.
7. THE Push_Engine SHALL preserve `markEntrySent` side effects (updating `sync_id_map` version and resolving related `sync_conflicts`) for every successfully sent item regardless of which push path sent it.
8. IF a write fails for any reason, including access-denied or a Throttling_Error, THEN THE Push_Engine SHALL apply no `markEntrySent` side effects for that item.

### Requirement 5: Respect Push Authority, Self-Origin, and Bulk Expansion

**User Story:** As a security-conscious maintainer, I want throughput changes to keep existing authorization and expansion rules intact, so that no unauthorized or malformed writes occur.

#### Acceptance Criteria

1. WHILE preparing items for any push path, THE Push_Engine SHALL skip any entry for which `canPush(table_name, role)` returns false, excluding it from dispatch, leaving its outbox row unchanged, and not marking it sent.
2. THE Push_Engine SHALL invoke `expandBulkEntry` for Bulk_Entry rows before enqueueing their documents into the concurrency pool or the Batched_Fast_Path.
3. THE Push_Engine SHALL push each expanded document through behavior equivalent to the existing single-item push path, preserving self-origin and device-hash handling.
4. WHERE `expandBulkEntry` returns zero documents for an entry, THE Push_Engine SHALL mark the originating entry sent and dispatch no documents, matching existing behavior.
5. IF `expandBulkEntry` fails for an entry, THEN THE Push_Engine SHALL leave the originating entry unmarked, dispatch no documents for that entry, and surface the error.

### Requirement 6: Backlog Drain Throughput

**User Story:** As an administrator returning online after offline data entry, I want a large backlog to drain quickly and automatically, so that other devices receive my changes promptly.

#### Acceptance Criteria

1. WHILE a Backlog exists (pending count greater than `sync_config.push_batch_size`), THE Push_Engine SHALL read up to the effective backlog drain limit pending rows per Push_Cycle, where the effective backlog drain limit is `sync_config.push_backlog_batch_size` clamped to a maximum of 5000 rows per cycle.
2. IF `sync_config.push_backlog_batch_size` is absent, non-numeric, or less than `sync_config.push_batch_size`, THEN THE Push_Engine SHALL use a default backlog drain limit of 1000 rows per Push_Cycle.
3. WHEN a Push_Cycle ends with pending rows remaining AND at least one item was sent AND no item failed, THE Push_Engine SHALL schedule a follow-up Push_Cycle via the existing `scheduleBacklogPush` mechanism within 5 seconds.
4. WHILE no Backlog exists (pending count at or below `sync_config.push_batch_size`), THE Push_Engine SHALL limit each Push_Cycle to `sync_config.push_batch_size` rows (default 100), preserving existing steady-state behavior.
5. WHEN draining a Backlog under Nominal_Conditions using Layer 1 at the default maximum concurrency cap of 20, THE Push_Engine SHALL sustain an effective throughput of at least 50 documents per second, measured as documents marked sent divided by elapsed wall-clock push time over a sample of at least 1000 documents.
6. WHEN draining a Backlog of 47,301 documents under Nominal_Conditions with Layer 1 enabled, THE Push_Engine SHALL reduce the pending count to zero within 30 minutes of continuous push activity, excluding time spent backed off due to Throttling_Errors.

### Requirement 7: Batched Fast-Path for No-Conflict Writes (Layer 2)

**User Story:** As an administrator with tens of thousands of fresh local changes, I want non-conflicting writes committed in batches, so that the backlog drains using far fewer network round-trips.

#### Acceptance Criteria

1. WHERE `sync_config.push_batched_fast_path_enabled` is true, THE Batched_Fast_Path SHALL bulk-read current remote versions for a group of pending documents using chunked `documentId() in [...]` queries of at most 30 document ids per query.
2. THE Batched_Fast_Path SHALL include an item in a `writeBatch` commit only when the local item version is strictly greater than the remote version observed in the bulk read.
3. THE Batched_Fast_Path SHALL commit non-conflicting items via Firestore `writeBatch` using `{ merge: true }` payloads, with at most 500 write operations per commit.
4. IF an item's remote version observed in the bulk read is greater than or equal to the local item version, THEN THE Batched_Fast_Path SHALL route that item to the per-document `Version_Guard` transaction rather than the batch.
5. IF the bulk read fails for a group, THEN THE Batched_Fast_Path SHALL route every item in the affected group to the per-document `Version_Guard` transaction.
6. IF a `writeBatch` commit fails for any reason, THEN THE Push_Engine SHALL re-route every item in that commit to the per-document `Version_Guard` transaction so that no item is marked sent without a successful guarded write.
7. THE Batched_Fast_Path SHALL produce the same `markEntrySent` side effects and syncLog entries for batched items as the per-document path produces for the same items.
8. WHERE `sync_config.push_batched_fast_path_enabled` is false or absent, THE Push_Engine SHALL route all items through the Layer 1 bounded-concurrency path and SHALL make no Batched_Fast_Path version-comparison or batch-routing decisions.
9. WHEN the Batched_Fast_Path is enabled and draining a Backlog of predominantly non-conflicting documents (at least 95% non-conflicting) under Nominal_Conditions, THE Push_Engine SHALL achieve an effective throughput of at least 200 documents per second, measured over a sample of at least 1000 documents.

### Requirement 8: Push Observability and Metrics

**User Story:** As an operator diagnosing sync performance, I want visibility into push throughput, outcomes, and errors, so that I can confirm the optimization works and detect throttling.

#### Acceptance Criteria

1. WHEN a Push_Cycle completes, THE Push_Engine SHALL record the counts of sent, failed, and skipped items, the remaining pending count, and the cycle duration in milliseconds.
2. WHEN a Push_Cycle completes with a cycle duration greater than zero, THE Push_Engine SHALL record the effective throughput as documents sent divided by the cycle duration in seconds.
3. IF a Push_Cycle completes with a cycle duration of zero, THEN THE Push_Engine SHALL record the effective throughput as 0.
4. WHEN the Rate_Limiter changes the active concurrency limit, THE Push_Engine SHALL record the new active concurrency limit and the reason (ramp-up or throttle back-off).
5. WHEN a Throttling_Error is detected during a Push_Cycle, THE Push_Engine SHALL record the count of Throttling_Errors observed in that cycle.
6. WHEN a Push_Cycle ends, THE Push_Engine SHALL update `sync_config.last_push_at` and `sync_config.last_push_error` consistent with existing `updatePushMeta` behavior.
7. IF a Push_Cycle ends with the syncLog batch write having failed, THEN THE Push_Engine SHALL record a last-push error indicating that other devices may not receive the changes, matching existing behavior.
8. IF recording the last-push error state itself fails, THEN THE Push_Engine SHALL apply a fallback that logs the failed batch-write error condition so the error state is captured.

### Requirement 9: Backward-Compatible Configuration and Schema

**User Story:** As a maintainer deploying this change to existing installations, I want it to work without database migrations or breaking existing configs, so that rollout is low risk.

#### Acceptance Criteria

1. THE Push_Engine SHALL operate using the existing `sync_outbox`, `sync_id_map`, `sync_conflicts`, and `sync_config` tables without issuing any DDL (CREATE, ALTER, or DROP) statement for Layer 1.
2. IF any new `sync_config` tuning key (`push_concurrency`, `push_concurrency_max`, `push_backlog_batch_size`, `push_batched_fast_path_enabled`) is absent, THEN THE Push_Engine SHALL apply the documented default for that key and continue without error.
3. IF any new `sync_config` tuning key is present but invalid (non-numeric, non-boolean, or out of range as applicable), THEN THE Push_Engine SHALL reject the value, apply the documented default, and continue without error.
4. IF a documented default value cannot be applied due to an implementation error, THEN THE Push_Engine SHALL abort initialization before any Push_Cycle begins, surface the failing key, and never proceed with an undefined tuning value.
5. THE Push_Engine SHALL keep the single-flight guard active at all times so that overlapping invocations of `flushSyncOutbox` never run concurrent Push_Cycles.
6. THE Push_Engine SHALL drive the background timer from `sync_config.sync_interval_minutes` clamped to the inclusive range 1 to 30 minutes, defaulting to 5 minutes when the value is absent or out of range.

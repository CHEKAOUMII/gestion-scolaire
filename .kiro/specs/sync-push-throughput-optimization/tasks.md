# Implementation Plan: Sync Push Throughput Optimization

## Overview

This plan implements two layers of push-throughput improvement in `main/sync/engine.js`
while preserving the existing correctness model exactly. Work proceeds bottom-up: pure
tuning/rate-limiter/chunking helpers first, then the bounded-concurrency dispatcher and
shared per-item outcome handler, then wiring Layer 1 into `flushSyncOutbox`, then metrics
and follow-up scheduling, and finally the optional Layer 2 batched fast path gated on
config. Each step builds on the previous one and ends wired into the live push cycle, with
no orphaned code. Property tests (`fast-check`, `{ numRuns: 100 }`) and unit tests are
co-located with the code they validate.

## Tasks

- [x] 1. Implement configuration resolution helpers
  - [x] 1.1 Implement `resolvePushTuning`, `resolveDrainLimit`, and the sync-interval clamp
    - Add exportable pure helpers in `main/sync/engine.js`
    - `resolvePushTuning(config)`: resolve `push_concurrency` (default 10), `push_concurrency_max` (default 20, clamped to absolute ceiling 50), clamp initial `<= max` and `>= 1`, resolve `push_backlog_batch_size` (default 1000, `< push_batch_size` → 1000, clamp `<= 5000`), parse `push_batched_fast_path_enabled` (truthy/falsey, default false)
    - `resolveDrainLimit(config, pendingCount, tuning)`: backlog (`pendingCount > push_batch_size`) → `min(backlogBatchSize, 5000)`; steady → `push_batch_size`
    - Sync-interval clamp helper: `sync_interval_minutes` clamped to `[1, 30]`, default 5
    - Abort initialization surfacing the failing key if a documented default cannot be applied
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 6.1, 6.2, 6.4, 7.8, 9.2, 9.3, 9.4, 9.6_

  - [x]* 1.2 Write property test for tuning resolution invariants
    - **Property 1: Tuning resolution invariants**
    - **Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 7.8, 9.2, 9.3**

  - [x]* 1.3 Write property test for backlog drain-limit resolution
    - **Property 2: Backlog drain-limit resolution**
    - **Validates: Requirements 6.1, 6.2, 6.4**

  - [x]* 1.4 Write property test for sync-interval clamp
    - **Property 3: Sync interval clamp**
    - **Validates: Requirements 9.6**

  - [x]* 1.5 Write unit tests for config edge cases
    - Reading a valid `push_concurrency` value (Req 2.1)
    - Init-abort fail-safe when a default cannot be applied (Req 9.4)
    - _Requirements: 2.1, 9.4_

- [x] 2. Implement rate limiter and throttle-error detection
  - [x] 2.1 Implement `createRateLimiter(tuning)`
    - Mutable controller with `active`, `max`, `consecutiveThrottles`
    - `onGroupSuccess()`: `active = min(active + 5, max)`, reset `consecutiveThrottles` to 0
    - `onThrottle()`: `active = max(1, floor(active / 2))`, increment `consecutiveThrottles`
    - `backoffDelayMs()`: `min(1000 * 2^(n-1), 60000)`
    - Keep `active` within `[1, max]` at all times
    - _Requirements: 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [x]* 2.2 Write property test for rate-limiter transitions and bounds
    - **Property 8: Rate-limiter transitions and bounds**
    - **Validates: Requirements 2.6, 3.1, 3.2, 3.3, 3.4, 3.6**

  - [x]* 2.3 Write property test for back-off delay formula
    - **Property 9: Back-off delay formula**
    - **Validates: Requirements 3.5**

  - [x] 2.4 Implement `isThrottleError` and extend `writeItemWithVersionCheck`
    - `isThrottleError(err)`: true for `resource-exhausted`, `unavailable`, `aborted`
    - Change `writeItemWithVersionCheck` catch branch to set `isThrottle: true` accordingly (currently hard-coded false); leave all other guard semantics unchanged
    - _Requirements: 3.4, 3.8_

  - [x]* 2.5 Write property test for throttle-error detection
    - **Property 10: Throttle-error detection**
    - **Validates: Requirements 3.8**

- [x] 3. Implement the bounded-concurrency dispatcher
  - [x] 3.1 Implement `runConcurrentGroup(items, limit, worker)`
    - Maintain at most `limit` in-flight promises; pull next item as each settles
    - Never cancel dispatched items; let every item in the group settle
    - Return `{ outcomes, throttled }` with outcomes in input order
    - _Requirements: 1.1, 1.4_

  - [x]* 3.2 Write property test for concurrency never exceeding the active limit
    - **Property 4: Concurrency never exceeds the active limit**
    - **Validates: Requirements 1.1**

  - [x]* 3.3 Write property test for partial-failure isolation and full settlement
    - **Property 6: Partial-failure isolation and full settlement**
    - **Validates: Requirements 1.4, 4.5**

- [x] 4. Implement shared per-item outcome handling
  - [x] 4.1 Implement `applyItemOutcome(db, prepared, result, ctx)`
    - Extract the branch logic from `flushPreparedItems` into one shared function
    - success → `markEntrySent` + collect for syncLog
    - equivalent conflict → `markEntrySent(remoteVersion)`
    - non-equivalent conflict → `reconcileUnreconciledRow`, else `logVersionConflict`
    - throttle → leave row `pending`; access-denied → mark cause, signal post-group abort
    - other failure → `markEntryFailed` with cause; no `markEntrySent` for failed/throttled/denied
    - _Requirements: 3.7, 4.1, 4.2, 4.3, 4.5, 4.7, 4.8, 5.3_

  - [x]* 4.2 Write property test for outcome-to-status and side-effect mapping
    - **Property 11: Outcome-to-status and side-effect mapping**
    - **Validates: Requirements 3.7, 4.8**

  - [x]* 4.3 Write property test for equivalent-conflict acceptance
    - **Property 13: Equivalent-conflict acceptance**
    - **Validates: Requirements 4.2**

  - [x]* 4.4 Write property test for non-equivalent conflict reconciliation then logging
    - **Property 14: Non-equivalent conflict reconciliation then logging**
    - **Validates: Requirements 4.3**

- [x] 5. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Wire Layer 1 into `flushSyncOutbox`
  - [x] 6.1 Replace the sequential per-item loop with the concurrency-controlled dispatcher
    - Resolve tuning + effective drain limit; read pending rows with `readPendingOutboxBatch`
    - Prepare items reusing `processOutboxRow` logic: `canPush` gate, `expandBulkEntry`, `buildFirestoreDoc`
    - Drive group-by-group dispatch via `runConcurrentGroup` + `createRateLimiter` (ramp-up, halve + `backoffDelayMs` sleep on throttle)
    - Route outcomes through `applyItemOutcome`; batch syncLog via `writeSyncLogWithRetry` for sent items
    - Evaluate access-denied abort only after the current group settles; preserve `_flushRunning` single-flight guard
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 4.5, 4.6, 5.1, 5.2, 5.3, 5.4, 5.5, 6.1, 6.4, 9.5_

  - [x]* 6.2 Write property test for parallel dispatch matching the sequential reference
    - **Property 5: Parallel dispatch matches the sequential reference**
    - **Validates: Requirements 1.2, 1.3**

  - [x]* 6.3 Write property test for syncLog batch equaling the sent set
    - **Property 7: syncLog batch equals the sent set**
    - **Validates: Requirements 1.5**

  - [x]* 6.4 Write property test for push-authority gating
    - **Property 17: Push-authority gating**
    - **Validates: Requirements 5.1**

  - [x]* 6.5 Write property test for abort preserving side effects for written items only
    - **Property 16: Abort preserves side effects for written items only**
    - **Validates: Requirements 4.6**

  - [x]* 6.6 Write property test for the single-flight guard
    - **Property 23: Single-flight guard**
    - **Validates: Requirements 9.5**

  - [x]* 6.7 Write unit tests for bulk-entry expansion behavior
    - `expandBulkEntry` invocation ordering before enqueue (Req 5.2)
    - Zero expanded documents → mark entry sent, dispatch none (Req 5.4)
    - Expansion failure → leave entry unmarked, dispatch none, surface error (Req 5.5)
    - _Requirements: 5.2, 5.4, 5.5_

- [x] 7. Implement push metrics and follow-up scheduling
  - [x] 7.1 Implement Push_Metrics, follow-up predicate, and `updatePushMeta` wiring
    - Record `sent`, `failed`, `skipped`, `pending`, `durationMs`, `throughput`, `throttleErrors`, `concurrencyChanges`
    - throughput = `sent / (durationMs/1000)`, or 0 when `durationMs == 0`
    - Schedule follow-up via `scheduleBacklogPush` (within 5s) iff `pending > 0 && sent > 0 && failed == 0`
    - Update `last_push_at` / `last_push_error`; record syncLog-failure error condition; fallback log if recording the error state itself fails
    - _Requirements: 6.3, 8.1, 8.2, 8.3, 8.4, 8.5, 8.6, 8.7, 8.8_

  - [x]* 7.2 Write property test for the follow-up scheduling predicate
    - **Property 21: Follow-up scheduling predicate**
    - **Validates: Requirements 6.3**

  - [x]* 7.3 Write property test for throughput metric computation
    - **Property 22: Throughput metric computation**
    - **Validates: Requirements 8.2, 8.3**

  - [x]* 7.4 Write unit tests for metric recording and error fallback
    - Metric fields recorded (Req 8.1), concurrency-change + throttle-count recording (Req 8.4, 8.5)
    - `updatePushMeta` persistence (Req 8.6), duration-zero throughput edge (Req 8.3)
    - syncLog-error fallback log path (Req 8.8)
    - _Requirements: 8.1, 8.3, 8.4, 8.5, 8.6, 8.8_

- [x] 8. Checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

- [x] 9. Implement the Batched Fast Path (Layer 2)
  - [x] 9.1 Implement the id/commit chunking helper
    - Partition document ids into chunks of `<= s` (30 for bulk reads, 500 for commits), union equals input with no duplicates/omissions
    - _Requirements: 7.1, 7.3_

  - [x]* 9.2 Write property test for bounded, covering chunking
    - **Property 19: Bounded, covering chunking**
    - **Validates: Requirements 7.1, 7.3**

  - [x] 9.3 Implement `runBatchedFastPath(db, firestoreDb, preparedItems, ctx)`
    - Bulk-read remote versions via chunked `where(documentId(), 'in', chunk)` + `getDocs`
    - Partition: local `vL > vR` → batchable survivor; `vR >= vL` or unreadable/not-found → guard-routed
    - Commit survivors via `writeBatch` `set(ref, payload, { merge: true })`, `<= 500` ops/commit; apply `markEntrySent` + collect syncLog identical to per-document path
    - Bulk-read failure → route whole group to guard; commit failure → re-route every item in that commit to guard (nothing marked sent)
    - Return `{ sentItems, guardRoutedItems }`
    - Add `writeBatch`, `where`, `documentId`, `getDocs` to the `firebase/firestore` import; no `BulkWriter`/`firebase-admin`
    - _Requirements: 4.4, 7.1, 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_

  - [x]* 9.4 Write property test for fallback routing to the Version_Guard
    - **Property 18: Fallback routing to the Version_Guard**
    - **Validates: Requirements 4.4, 7.5, 7.6**

  - [x] 9.5 Wire the Batched Fast Path into `flushSyncOutbox` gated on config
    - When `tuning.batchedFastPathEnabled`, run `runBatchedFastPath` as a pre-stage; flow `guardRoutedItems` into the Layer 1 dispatcher
    - When disabled/absent, perform no bulk-read and no `writeBatch`; route all items through Layer 1
    - _Requirements: 7.8_

  - [x]* 9.6 Write property test for the strict version-greater write rule across all paths
    - **Property 12: Strict version-greater write rule across all paths**
    - **Validates: Requirements 4.1, 7.2, 7.4**

  - [x]* 9.7 Write property test for disabled fast path routing everything through Layer 1
    - **Property 20: Disabled fast path routes everything through Layer 1**
    - **Validates: Requirements 7.8**

  - [x]* 9.8 Write property test for side-effect equivalence regardless of push path
    - **Property 15: Side-effect equivalence regardless of push path**
    - **Validates: Requirements 4.7, 5.3, 7.7**

- [x] 10. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional test sub-tasks and can be skipped for a faster MVP.
- Each task references specific requirements (granular clauses) for traceability.
- Property tests use `fast-check` with `{ numRuns: 100 }` minimum and are tagged
  `// Feature: sync-push-throughput-optimization, Property {number}: {property text}`.
- Model-based properties (5, 15) run the current sequential `flushPreparedItems` reference
  against the same deterministic mock Firestore + in-memory `better-sqlite3` state.
- Throughput targets (Req 6.5, 6.6, 7.9) are benchmarks, not properties, and are covered by
  opt-in integration/benchmark tests rather than the default property suite.
- The no-DDL guarantee (Req 9.1) is covered by an integration assertion, not a unit task.
- All work lives in `main/sync/engine.js` plus exportable helpers; no schema migrations.

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["2.1", "1.2", "1.3", "1.4", "1.5"] },
    { "id": 2, "tasks": ["2.4", "2.2", "2.3"] },
    { "id": 3, "tasks": ["3.1", "2.5"] },
    { "id": 4, "tasks": ["4.1", "3.2", "3.3"] },
    { "id": 5, "tasks": ["6.1", "4.2", "4.3", "4.4"] },
    { "id": 6, "tasks": ["7.1", "6.2", "6.3", "6.4", "6.5", "6.6", "6.7"] },
    { "id": 7, "tasks": ["9.1", "7.2", "7.3", "7.4"] },
    { "id": 8, "tasks": ["9.3", "9.2"] },
    { "id": 9, "tasks": ["9.5", "9.4"] },
    { "id": 10, "tasks": ["9.6", "9.7", "9.8"] }
  ]
}
```

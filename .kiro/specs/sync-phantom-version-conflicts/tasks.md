# Implementation Plan

## Overview

This plan fixes the phantom version-conflict flood produced when a device seeded from a shared database backup performs its first push. It follows the exploratory bugfix workflow: first surface the phantom conflicts with a failing bug-condition test, capture preservation behavior on the unfixed code, then implement a reconciliation branch on the push conflict path and verify both fix-checking and preservation-checking.

## Task Dependency Graph

```json
{
  "waves": [
    {
      "wave": 1,
      "tasks": ["1", "2"],
      "description": "Run on UNFIXED code: task 1 (bug condition exploration) is expected to FAIL; task 2 (preservation) is expected to PASS. Independent of each other."
    },
    {
      "wave": 2,
      "tasks": ["3.1"],
      "description": "Implement the reconciliation branch on the push conflict path. Depends on understanding from tasks 1 and 2."
    },
    {
      "wave": 3,
      "tasks": ["3.2", "3.3"],
      "description": "Re-run the same tests from tasks 1 and 2 against the fixed code. Depends on 3.1."
    },
    {
      "wave": 4,
      "tasks": ["4"],
      "description": "Checkpoint: full suite and lint. Depends on 3.2 and 3.3."
    }
  ]
}
```

## Tasks

- [x] 1. Write bug condition exploration test
  - **Property 1: Bug Condition** - Reconcile Unreconciled Seeded Rows Instead of Phantom Conflicts
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the bug exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface counterexamples that demonstrate the phantom conflicts exist before implementing the fix
  - **Scoped PBT Approach**: Generate unreconciled seeded rows across `compensation_tracking`, `settings`, and `system_tags` where `sync_id_map.version` is missing/`0` and `ancestor_data` is null, paired with a fake server document at `version = 1` whose data is semantically identical but NOT byte-equivalent (e.g., differing incidental `updated_at`/whitespace). Scope concrete failing cases for reproducibility.
  - Encode the Bug Condition from design: `isBugCondition(input)` holds when `localUnreconciled` (localVersion null/0 AND localAncestor null) AND `guardTripped` (serverExists AND serverVersion >= pushedVersion, where pushedVersion = (localVersion||0)+1 == 1) AND `notByteEquivalent` (NOT isEquivalentRemoteData(localData, serverData))
  - Run the push flush via an in-memory/fake Firestore transaction on the UNFIXED code
  - The test assertions should match the Expected Behavior Properties from design: assert NO unresolved `sync_conflicts` row is created and that `sync_id_map.version`/`ancestor_data` are reconciled to the server baseline
  - **EXPECTED OUTCOME**: Test FAILS (this is correct - it proves the bug exists; unfixed code records `status = 'unresolved'` rows in `sync_conflicts` for semantically-identical seeded rows)
  - Document counterexamples found (e.g., "settings/compensation_tracking/system_tags seeded row pushed at version=1 against server version=1 records an unresolved conflict instead of reconciling")
  - Mark task complete when test is written, run, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 2. Write preservation property tests (BEFORE implementing fix)
  - **Property 2: Preservation** - Non-Buggy Push and Conflict Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - Observe behavior on UNFIXED code for all inputs where `isBugCondition` returns false, and capture the resulting `sync_outbox` status, `sync_id_map` (version, ancestor_data), and `sync_conflicts` rows:
    - Observe: a reconciled row (`version > 0`, non-null `ancestor_data`) pushes, versions, and logs as today (Requirement 3.5)
    - Observe: a byte-equivalent conflict auto-resolves via `isEquivalentRemoteData` (Requirement 3.4)
    - Observe: genuine concurrent edits to different fields merge cleanly into the union (Requirement 3.1)
    - Observe: genuine concurrent edits to the same field resolve via last-writer-wins and record a real conflict (Requirement 3.2)
    - Observe: a genuine behind-version push is rejected by the version guard and treated as a conflict (Requirement 3.3)
  - Write property-based tests that generate random non-buggy push attempts (reconciled rows, byte-equivalent pairs, genuine concurrent edits, version-lag collisions) and assert the observed `sync_outbox`/`sync_id_map`/`sync_conflicts` state from the Preservation Requirements in design
  - Property-based testing generates many test cases for stronger guarantees that behavior is unchanged across the input domain
  - Run tests on UNFIXED code
  - **EXPECTED OUTCOME**: Tests PASS (this confirms the baseline behavior to preserve)
  - Mark task complete when tests are written, run, and passing on unfixed code
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 3. Fix for phantom version conflicts on unreconciled seeded rows

  - [x] 3.1 Implement the reconciliation branch on the push conflict path
    - In `flushPreparedItems` (`main/sync/engine.js`), when `writeItemWithVersionCheck` returns `{ conflict: true, equivalent: false }`, before calling `logVersionConflict`, read `sync_id_map.version` and `sync_id_map.ancestor_data` for `prepared.item.rowSyncId`
    - Detect the unreconciled-row bug condition: `version` missing or `0` AND `ancestor_data` null
    - Add a helper (e.g. `reconcileUnreconciledRow`) that adopts the server baseline: set `sync_id_map.version = remoteVersion` and `sync_id_map.ancestor_data = JSON.stringify(stripRemoteSyncMetadata(remoteData))` (reuse the existing `stripRemoteSyncMetadata`)
    - Re-run `threeWayMerge(serverData /* ancestor */, localData, serverData /* remote */, localTs, remoteTs)` from `main/sync/merge.js` to determine whether a genuine field-level difference remains
    - Conditional outcome: when no genuine difference (`resolution === 'clean'` and merged equals server data), mark the outbox entry resolved/sent with NO `sync_conflicts` row; when a genuine local change remains, re-push at version `remoteVersion + 1` and record a conflict only if the re-merge reports a real overlap (`conflicts.length > 0`)
    - Continue emitting `logConflictForensics` records, annotating reconciled rows (e.g., `reconciled-seeded`) without schema changes
    - Preserve all other branches unchanged (success path, byte-equivalence auto-resolve path, access-denied/throttle handling, and `logVersionConflict` for already-reconciled rows); gate the reconciliation branch strictly on `isBugCondition`
    - _Bug_Condition: isBugCondition(input) where localUnreconciled AND guardTripped AND notByteEquivalent (from design)_
    - _Expected_Behavior: expectedBehavior(result) — adopt server version+ancestor, re-merge, record conflict only on genuine field-level difference (from design)_
    - _Preservation: Preservation Requirements from design (reconciled-row push, byte-equivalence, genuine concurrent edits, version guard)_
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.2 Verify bug condition exploration test now passes
    - **Property 1: Expected Behavior** - Reconcile Unreconciled Seeded Rows Instead of Phantom Conflicts
    - **IMPORTANT**: Re-run the SAME test from task 1 - do NOT write a new test
    - The test from task 1 encodes the expected behavior
    - When this test passes, it confirms reconciliation occurs (server version + ancestor adopted) and no unresolved conflict is recorded when no genuine local change exists
    - Run bug condition exploration test from step 1
    - **EXPECTED OUTCOME**: Test PASSES (confirms the phantom conflicts are fixed)
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

  - [x] 3.3 Verify preservation tests still pass
    - **Property 2: Preservation** - Non-Buggy Push and Conflict Behavior Unchanged
    - **IMPORTANT**: Re-run the SAME tests from task 2 - do NOT write new tests
    - Run preservation property tests from step 2
    - **EXPECTED OUTCOME**: Tests PASS (confirms no regressions — identical `sync_outbox`/`sync_id_map`/`sync_conflicts` state for all non-buggy inputs)
    - Confirm all tests still pass after fix (no regressions)
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [x] 4. Checkpoint - Ensure all tests pass
  - Run the full suite (`npm test`) and lint (`npm run lint`)
  - Ensure all tests pass, ask the user if questions arise

## Notes

- Tasks 1 and 2 MUST be executed on the UNFIXED code first: task 1 is expected to FAIL (confirming the bug), task 2 is expected to PASS (capturing baseline behavior to preserve).
- Property tasks use the **Property N:** format so hover status reflects pass/fail state.
- The reconciliation branch in 3.1 must be gated strictly on `isBugCondition`; all other push/conflict branches stay byte-for-byte unchanged.
- Re-use existing helpers (`stripRemoteSyncMetadata`, `threeWayMerge`, `logConflictForensics`) rather than introducing new infrastructure.

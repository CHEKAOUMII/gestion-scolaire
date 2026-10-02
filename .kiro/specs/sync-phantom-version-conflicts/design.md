# Sync Phantom Version Conflicts Bugfix Design

## Overview

When a device is provisioned from a shared database backup/seed, its rows already exist on the server (written by another device that seeded from the same source), but the new device has never reconciled those rows against the server. Locally, `sync_id_map.version` is missing or `0` and `ancestor_data` is `null`. On the first push, `buildFirestoreDoc` computes `newVersion = (sync_id_map.version || 0) + 1 = 1`, while the matching server document already holds `version = 1`. The push uses a conditional write (`writeItemWithVersionCheck`) whose guard rejects the write when `existing.version >= item.version`, so `1 >= 1` is treated as a conflict.

Because there is no `ancestor_data`, the conflict cannot be reconciled cleanly: the three-way merge degenerates to last-writer-wins, and since the remote copy is often weeks old (and not byte-equivalent), `isEquivalentRemoteData` returns `false`, so `logVersionConflict` records a persistent **unresolved** conflict in `sync_conflicts`. Repeated across `compensation_tracking`, `settings`, `system_tags`, and other deterministic-id tables, this produces a flood of phantom conflicts that need no human decision and bury genuine conflicts.

The fix introduces a **reconciliation step** on the push path: when a conflict is detected for a row whose local version is unreconciled (version `0`/missing) and whose `ancestor_data` is absent, the system adopts the server version and server data as the ancestor into `sync_id_map`, re-runs the three-way merge with that ancestor, and only records a genuine conflict when a real field-level difference remains. All existing genuine-conflict, version-guard, and byte-equivalence behavior is preserved.

The approach follows the bug condition methodology: an exploratory phase that surfaces the phantom conflicts on unfixed code, **fix checking** (every buggy input reconciles instead of producing a phantom conflict), and **preservation checking** (every non-buggy input behaves byte-for-byte as before).

## Glossary

- **Bug_Condition (C)**: The condition that triggers the bug — a push of a row that is unreconciled locally (`sync_id_map.version` missing or `0`, `ancestor_data` null) where a matching server document already exists with `version >= item.version`, and the stale remote copy is not byte-equivalent to the local copy. Today this yields an unresolved phantom conflict.
- **Property (P)**: The desired behavior under C — reconcile the row by adopting the server version and server data as the ancestor, re-run the three-way merge with that ancestor, and record a conflict only when a genuine field-level difference remains.
- **Preservation**: Existing behavior that must remain unchanged — genuine concurrent-edit merges, the version guard for real version lag, byte-equivalence auto-resolution, and normal push/version/log flow for already-reconciled rows.
- **Reconciliation**: Adopting the server's `version` into `sync_id_map.version` and setting `sync_id_map.ancestor_data` to the server's data for a previously unreconciled row, so subsequent merges and pushes use the correct baseline.
- **`buildFirestoreDoc`**: Function in `main/sync/engine.js` that constructs the push item; it reads `sync_id_map.version`, computes `newVersion = currentVersion + 1`, and is where the `version = 1` originates for unreconciled rows.
- **`writeItemWithVersionCheck`**: Function in `main/sync/engine.js` that performs the conditional Firestore write; its guard `existing.version >= item.version` produces the `1 >= 1` false conflict.
- **`logVersionConflict`**: Function in `main/sync/engine.js` that records an unresolved row in `sync_conflicts` when a non-equivalent version conflict occurs (with `ancestor_data` null for seeded rows).
- **`threeWayMerge`**: Pure function in `main/sync/merge.js`; with a `null` ancestor it cannot distinguish "only remote changed" from a true conflict, so any differing field becomes an LWW conflict.
- **`isEquivalentRemoteData`**: Function in `main/sync/engine.js` using `computeRowChecksum`; returns `false` for stale-but-not-byte-equivalent remotes, defeating auto-resolution.
- **`sync_id_map`**: Local table tracking `row_sync_id`, `table_name`, `local_id`, `version` (default `0`), and `ancestor_data` (TEXT, nullable). Unreconciled rows have `version = 0` and `ancestor_data = null`.
- **Unreconciled row**: A row whose `sync_id_map.version` is missing or `0` and whose `ancestor_data` is `null` — i.e., never confirmed against the server.

## Bug Details

### Bug Condition

The bug manifests when a device pushes a row it has never reconciled against the server (local `sync_id_map.version` missing or `0`, `ancestor_data` null) while a matching server document already exists with a version at least equal to the pushed version. The version guard in `writeItemWithVersionCheck` is correctly rejecting the write, but the downstream handling is wrong: with no ancestor, the system cannot tell that the rows are semantically the same, the stale remote defeats byte-equivalence, and `logVersionConflict` records a persistent unresolved conflict instead of reconciling the row's version tracking.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type PushAttempt {
           rowSyncId, tableName, localData, localVersion (from sync_id_map.version),
           localAncestor (from sync_id_map.ancestor_data),
           serverExists, serverVersion, serverData
         }
  OUTPUT: boolean

  // Unreconciled local version tracking
  localUnreconciled := (input.localVersion == null OR input.localVersion == 0)
                       AND input.localAncestor == null

  // A matching server document already exists at a version that trips the guard.
  // Pushed version for an unreconciled row is (localVersion || 0) + 1 == 1.
  pushedVersion := (input.localVersion == null ? 0 : input.localVersion) + 1
  guardTripped := input.serverExists AND input.serverVersion >= pushedVersion

  // Byte-equivalence does NOT already resolve it (stale-but-not-equal remote)
  notByteEquivalent := NOT isEquivalentRemoteData(input.localData, input.serverData)

  RETURN localUnreconciled AND guardTripped AND notByteEquivalent
END FUNCTION
```

### Examples

- **`settings` seeded row**: Device B starts from Device A's backup. `settings` key `school_name` exists on the server at `version = 1`. Device B pushes with `version = 1`. Expected: reconcile silently (no human-facing change). Actual: unresolved conflict recorded in `sync_conflicts`.
- **`compensation_tracking` seeded row**: Identical compensation row exists locally and remotely at `version = 1`, remote written weeks ago. Expected: reconcile to server version, no conflict. Actual: not byte-equivalent (e.g., differing `updated_at`/whitespace), so phantom unresolved conflict.
- **`system_tags` seeded row**: A daily-observation tag row shared via seed. Expected: adopt server version/ancestor; no conflict. Actual: flood of unresolved conflicts on the settings-sync page on first push.
- **Edge case — genuine difference after reconcile**: Device B edited `system_tags.note_text` before its first push of a seeded row. Expected: after adopting the server ancestor and re-merging, a single genuine conflict (or clean local-wins, if only local changed) — not a phantom one.

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- Genuine concurrent edits to **different** fields of the same row (with an ancestor available) continue to merge cleanly into the union of changes (Requirement 3.1).
- Genuine concurrent edits to the **same** field continue to resolve via the existing last-writer-wins path and record a real conflict where applicable (Requirement 3.2).
- A push whose version is genuinely behind the server due to a real concurrent update continues to be rejected by the version guard and treated as a conflict rather than silently overwritten (Requirement 3.3).
- Byte-equivalent local/remote data for a conflicting row continues to auto-resolve exactly as today via `isEquivalentRemoteData` (Requirement 3.4).
- A row with a properly reconciled version and ancestor data continues to push, version, and log changes exactly as it does today (Requirement 3.5).

**Scope:**
All inputs where `isBugCondition` is `false` must be completely unaffected by this fix. This includes:
- Rows with a reconciled `sync_id_map.version > 0` and non-null `ancestor_data`.
- Conflicts where local and remote are byte-equivalent (already auto-resolved).
- Conflicts that arise from real concurrent edits regardless of ancestor state.
- Non-conflicting pushes (server doc absent, or server version below the pushed version).

**Note:** The expected correct behavior under the bug condition is defined precisely in the Correctness Properties section (Property 1 and Property 2). This section focuses on what must NOT change.

## Hypothesized Root Cause

Based on the bug analysis and the current implementation, the most likely contributing causes are:

1. **Version baseline of `0` for seeded rows**: `buildFirestoreDoc` computes `newVersion = (sync_id_map.version || 0) + 1`. A device seeded from a backup never reconciled its rows, so `version` stays `0` and the pushed version is always `1`, colliding with the server's existing `version = 1`. The root issue is that local version tracking was never synchronized with the server's existing version.

2. **No reconciliation path on the push conflict branch**: In `flushPreparedItems`, a non-equivalent conflict goes straight to `markEntryFailed` + `logVersionConflict`. There is no step that recognizes an *unreconciled* row and adopts the server version/ancestor before deciding whether a conflict is genuine.

3. **Missing ancestor degrades the three-way merge**: `threeWayMerge` with `ancestor = null` cannot distinguish "only remote changed / only local changed" from a true overlap; every differing field becomes an LWW conflict, so a semantically-identical-but-not-byte-equal pair is misclassified.

4. **Byte-equivalence is too strict for stale remotes**: `isEquivalentRemoteData` uses a full-row checksum (minus sensitive fields). A weeks-old remote that differs only in incidental fields fails equivalence, so the phantom conflict is never auto-resolved and persists indefinitely.

The most probable primary cause is **(2) combined with (1)**: the absence of a reconciliation step means an unreconciled row's collision is never converted into an adoption of the server baseline, leaving the missing-ancestor merge and strict byte-equivalence to fail.

## Correctness Properties

Property 1: Bug Condition - Reconcile Unreconciled Seeded Rows Instead of Phantom Conflicts

_For any_ push attempt where the bug condition holds (`isBugCondition` returns true) — an unreconciled row (`sync_id_map.version` missing or `0`, `ancestor_data` null) whose matching server document exists at `version >= pushedVersion` and is not byte-equivalent — the fixed push path SHALL reconcile the row by adopting the server `version` into `sync_id_map.version` and the server data into `sync_id_map.ancestor_data`, then re-run the three-way merge against that adopted ancestor. It SHALL record an unresolved conflict ONLY when the re-merge against the adopted ancestor yields a genuine field-level difference; when no genuine local change remains, it SHALL complete reconciliation without recording any unresolved conflict.

**Validates: Requirements 2.1, 2.2, 2.3, 2.4, 2.5**

Property 2: Preservation - Non-Buggy Push and Conflict Behavior Unchanged

_For any_ push attempt where the bug condition does NOT hold (`isBugCondition` returns false) — including rows with a reconciled `version > 0` and non-null `ancestor_data`, byte-equivalent conflicts, genuine same-field/different-field concurrent edits, and genuine version-lag collisions — the fixed code SHALL produce the same observable result as the original code: the same `sync_outbox` status transitions, the same `sync_id_map.version`/`ancestor_data` updates, and the same `sync_conflicts` rows (genuine conflicts recorded, version guard enforced, byte-equivalent collisions auto-resolved).

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

Assuming our root cause analysis is correct, the fix introduces a reconciliation branch on the push conflict path and a helper that adopts the server baseline.

**File**: `main/sync/engine.js`

**Functions**: the push conflict handling in `flushPreparedItems` (and a new helper, e.g. `reconcileUnreconciledRow`), with supporting reads from `sync_id_map` and a re-merge via `threeWayMerge` from `main/sync/merge.js`.

**Specific Changes**:

1. **Detect the unreconciled-row conflict**: When `writeItemWithVersionCheck` returns `{ conflict: true, equivalent: false }`, before calling `logVersionConflict`, read `sync_id_map.version` and `sync_id_map.ancestor_data` for `prepared.item.rowSyncId`. Identify the bug condition: `version` is missing or `0` AND `ancestor_data` is null.

2. **Adopt the server baseline (reconcile)**: For an unreconciled row, set `sync_id_map.version = remoteVersion` and `sync_id_map.ancestor_data = JSON.stringify(stripRemoteSyncMetadata(remoteData))`. This is the mechanism required by Requirement 2.4 and reuses the same `stripRemoteSyncMetadata` already applied in `logVersionConflict`.

3. **Re-run the three-way merge with the adopted ancestor**: Call `threeWayMerge(serverData /* ancestor */, localData, serverData /* remote */, localTs, remoteTs)`. Because the adopted ancestor equals the current remote, fields the local device did not change collapse to "no change" and only genuinely locally-changed fields survive as differences. Determine whether a genuine field-level difference exists.

4. **Conditional outcome**:
   - **No genuine difference** (re-merge `resolution === 'clean'` and merged equals server data): mark the outbox entry as resolved/sent without recording an unresolved conflict, leaving `sync_id_map` reconciled (Requirements 2.1, 2.3, 2.5). No `sync_conflicts` row is created.
   - **Genuine local change remains**: re-push the entry with the corrected version `remoteVersion + 1` so the next conditional write succeeds (Requirement 2.2), and only record a conflict if the re-merge reports a real overlap (`conflicts.length > 0`) (Requirement 2.5).

5. **Preserve all other branches unchanged**: The `result.success` path, the `result.conflict && result.equivalent` byte-equivalence auto-resolve path, the access-denied/throttle handling, and `logVersionConflict` for rows that are already reconciled (non-null ancestor / `version > 0`) must remain exactly as today (Requirements 3.1–3.5). The reconciliation branch is gated strictly on `isBugCondition`.

6. **Forensics continuity**: Continue emitting `logConflictForensics` records; for reconciled rows, annotate with a note (e.g., `reconciled-seeded`) so the existing forensics analysis distinguishes reconciliation from genuine conflicts without changing its schema.

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, surface counterexamples that demonstrate the phantom conflicts on the unfixed code, then verify the fix reconciles buggy inputs (fix checking) and leaves all non-buggy inputs byte-for-byte unchanged (preservation checking). The pure logic in `threeWayMerge` and the reconciliation decision are the primary targets for property-based testing; the Firestore conditional write is exercised via an in-memory/fake transaction.

### Exploratory Bug Condition Checking

**Goal**: Surface counterexamples that demonstrate the phantom conflicts BEFORE implementing the fix. Confirm or refute the root cause analysis (unreconciled `version = 0` → pushed `version = 1` → `1 >= 1` guard trip → missing-ancestor LWW → strict byte-equivalence failure → unresolved conflict). If refuted, re-hypothesize.

**Test Plan**: Construct a local DB seeded so that `sync_id_map.version = 0` and `ancestor_data = null` for sample `settings`, `compensation_tracking`, and `system_tags` rows, with a fake server document at `version = 1` whose data is semantically identical but not byte-equivalent (e.g., differing incidental field). Run the push flush on the UNFIXED code and assert (expecting failure) that no unresolved `sync_conflicts` row is created.

**Test Cases**:
1. **Settings phantom conflict**: Push an unreconciled `settings` row against an equal-but-stale server doc at `version = 1` (will fail on unfixed code — unresolved conflict recorded).
2. **Compensation phantom conflict**: Same setup for `compensation_tracking` (will fail on unfixed code).
3. **System tags phantom conflict**: Same setup for `system_tags` (will fail on unfixed code).
4. **Edge — genuine local change present**: Unreconciled row where the local device changed one field before first push; assert exactly one genuine conflict/clean local-wins, not a phantom flood (may behave incorrectly on unfixed code due to missing ancestor).

**Expected Counterexamples**:
- `sync_conflicts` gains `status = 'unresolved'` rows for semantically-identical seeded rows.
- Forensics shows high `noAncestorPct` and repeated rows.
- Possible causes: `version = 0` baseline, no reconciliation branch, missing ancestor in `threeWayMerge`, strict `isEquivalentRemoteData`.

### Fix Checking

**Goal**: Verify that for all inputs where the bug condition holds, the fixed push path reconciles the row (adopts server version + ancestor) and records an unresolved conflict only when a genuine field-level difference remains.

**Pseudocode:**
```
FOR ALL input WHERE isBugCondition(input) DO
  result := pushFlush_fixed(input)
  // Reconciliation always happens
  ASSERT syncIdMap(input.rowSyncId).version == input.serverVersion
  ASSERT syncIdMap(input.rowSyncId).ancestor_data == strip(input.serverData)
  // Conflict only on genuine difference
  remerge := threeWayMerge(input.serverData, input.localData, input.serverData, localTs, remoteTs)
  IF hasGenuineFieldDifference(remerge) THEN
    ASSERT result.recordedConflict == true
  ELSE
    ASSERT result.recordedConflict == false
    ASSERT result.unresolvedConflictCount == 0
  END IF
END FOR
```

### Preservation Checking

**Goal**: Verify that for all inputs where the bug condition does NOT hold, the fixed code produces the same result as the original code.

**Pseudocode:**
```
FOR ALL input WHERE NOT isBugCondition(input) DO
  ASSERT pushFlush_original(input) == pushFlush_fixed(input)
  // observable result: sync_outbox status, sync_id_map (version, ancestor_data),
  // and sync_conflicts rows must be identical
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many test cases automatically across the input domain (varied versions, ancestor states, byte-equivalence, and field overlaps).
- It catches edge cases that manual unit tests might miss.
- It provides strong guarantees that behavior is unchanged for all non-buggy inputs.

**Test Plan**: Observe behavior on UNFIXED code first for reconciled rows, byte-equivalent conflicts, and genuine concurrent edits, capture the resulting `sync_outbox`/`sync_id_map`/`sync_conflicts` state, then write property-based tests asserting the fixed code yields identical state.

**Test Cases**:
1. **Reconciled-row push preservation**: Observe that a row with `version > 0` and non-null `ancestor_data` pushes, versions, and logs exactly as today; verify unchanged after fix (Requirement 3.5).
2. **Byte-equivalent auto-resolution preservation**: Observe that a byte-equivalent conflict auto-resolves via `isEquivalentRemoteData`; verify unchanged after fix (Requirement 3.4).
3. **Genuine concurrent-edit preservation**: Observe different-field merge (clean union) and same-field LWW conflict with ancestor present; verify unchanged after fix (Requirements 3.1, 3.2).
4. **Genuine version-lag preservation**: Observe that a real behind-version push is rejected by the guard and treated as a conflict; verify unchanged after fix (Requirement 3.3).

### Unit Tests

- Reconciliation helper: unreconciled row + equal stale remote → adopts server version/ancestor, no conflict recorded.
- Reconciliation helper: unreconciled row + genuine local change → re-pushes at `remoteVersion + 1`; conflict only on true overlap.
- Guard untouched for reconciled rows (`version > 0`, ancestor present) — genuine version-lag still conflicts.
- Byte-equivalent conflict still auto-resolves.
- Edge: server doc absent or `serverVersion < pushedVersion` → normal push, no reconciliation branch entered.

### Property-Based Tests

- **Fix property**: Generate random unreconciled seeded rows and semantically-identical (non-byte-equal) server docs across `compensation_tracking`, `settings`, `system_tags`; assert reconciliation occurs and zero unresolved conflicts when no genuine local change exists.
- **Preservation property**: Generate random non-buggy push attempts (reconciled rows, byte-equivalent pairs, genuine concurrent edits, version-lag) and assert original-vs-fixed produce identical `sync_outbox`/`sync_id_map`/`sync_conflicts` state.
- **Merge invariant**: For an adopted ancestor equal to the remote, `threeWayMerge` reports `clean` exactly when the local row has no field differing from the server row.

### Integration Tests

- Full first-push flow from a seeded device across all three affected tables: assert the settings-sync surface shows zero unresolved conflicts afterward and `sync_id_map` versions match the server.
- Mixed batch: seeded-but-identical rows plus one genuinely-edited row → exactly one genuine conflict surfaces, the rest reconcile silently.
- Subsequent push after reconciliation: a later genuine local edit pushes at the correct incremented version and is accepted by the guard (no regression to phantom conflicts).

# Research: Integrity & Conflict Resolution (Phase 5)

**Feature Branch**: `005-integrity-conflict-resolution`
**Date**: 2026-03-21

## Research Tasks & Findings

### R1: How should the re-snapshot checker detect drift?

**Decision**: Row-level checksum comparison using SQLite's built-in hashing, with a fast pre-check using table-level aggregate checksums.

**Rationale**: The app runs on modest school hardware with tables typically under 10,000 rows. A simple approach works:
1. **Fast path (pre-check)**: Compute a quick aggregate checksum per table (e.g., `GROUP_CONCAT` of `id || '|' || updated_at` hashed) and compare against the stored snapshot. If unchanged, skip the table entirely.
2. **Slow path (row-level)**: When the aggregate differs, compute per-row checksums by concatenating all non-sensitive column values and comparing against stored row checksums. This identifies exactly which rows changed.

SQLite doesn't have a native `MD5` or `SHA` function, but we can use a simple string-based checksum approach: concatenate column values in a deterministic order, then compare the full concatenated string. For performance, we store the last-seen row data hash per `row_sync_id` in a new `sync_snapshots` table.

**Alternatives considered**:
- **SQLite change tracking / triggers**: Would require adding triggers to every synced table — invasive, brittle with migrations, and contradicts the non-invasive sync design philosophy.
- **File-level DB checksum**: Too coarse — a single byte change re-syncs everything. Unacceptable for 30-minute intervals.
- **WAL tracking**: Not portable across backup restores and direct writes.

---

### R2: How should version numbers work for cloud writes?

**Decision**: Increment version number on each push. Track the last-pushed version per `row_sync_id` in `sync_id_map` (add a `version` column). Use DynamoDB conditional writes (`attribute_not_exists(version) OR version < :v`) for ALL pushes, not just re-pushes.

**Rationale**: Currently `buildDynamoItem` hardcodes `version: 1`, and the conditional write path (`writeItemWithCondition`) only activates when `version > 1` — meaning version guards are effectively dead code. Phase 5 must:
1. Track the current cloud version per record in `sync_id_map.version`.
2. Increment the version on each push attempt.
3. Route ALL items through `writeItemWithCondition` (not batch writes) when version tracking is active.
4. On `ConditionalCheckFailedException`, fetch the current cloud record and initiate conflict resolution.

**Alternatives considered**:
- **Keep batch writes, add version post-hoc**: Batch writes don't support conditional expressions. Would require switching to individual `PutCommand` calls anyway.
- **Optimistic locking with ETags**: DynamoDB doesn't natively support ETags. Version numbers achieve the same effect.
- **Timestamp-based versioning**: Less precise than integer versions; clock skew across PCs could cause issues.

---

### R3: How should field-level merge work (three-way merge)?

**Decision**: Three-way merge using a stored common ancestor. Compare each field in local and remote against the ancestor to classify changes as: local-only, remote-only, both-same, or conflicting.

**Rationale**: A two-way diff (local vs. remote) cannot distinguish "field A was changed locally" from "field A was unchanged locally but different from remote." The ancestor provides the baseline.

**Merge algorithm**:
```
For each field in UNION(ancestor, local, remote):
  ancestor_val = ancestor[field]
  local_val    = local[field]
  remote_val   = remote[field]

  if local_val == remote_val:
    → result[field] = local_val  (no conflict)
  elif local_val == ancestor_val:
    → result[field] = remote_val  (remote-only change)
  elif remote_val == ancestor_val:
    → result[field] = local_val   (local-only change)
  else:
    → result[field] = LWW(local_val, remote_val, local_ts, remote_ts)
    → log conflict for this field
```

**Where to store the ancestor**: Add an `ancestor_data` column to `sync_id_map`. Updated after each successful push or pull application. This is the last version both local and cloud agreed on.

**Alternatives considered**:
- **Two-way diff only**: Cannot distinguish unchanged fields from conflicting ones. Would over-report conflicts.
- **CRDT-based merge**: Overkill for this use case. School data is structured records, not collaborative documents.
- **Full operational transform**: Far too complex. The data model is simple key-value fields, not text sequences.

---

### R4: How should the re-snapshot checker coordinate with push/pull engines?

**Decision**: Lightweight mutex using module-level boolean flags (consistent with existing `_pullRunning` / `_flushRunning` pattern).

**Rationale**: The existing codebase already uses boolean re-entrancy guards (`_pullRunning`, `_flushRunning`). The snapshot checker should:
1. Check `_pullRunning` before starting — if pull is active, defer to next interval.
2. Set its own `_snapshotRunning` flag.
3. The pull engine should check `_snapshotRunning` before starting — if snapshot is active, proceed anyway (snapshot is read-only and won't conflict with pull writes).

Actually, the snapshot checker writes to `sync_outbox` (enqueuing missed changes), which could overlap with pull's conflict detection (which reads from `sync_outbox`). So the safer approach is: snapshot defers if pull is running, and pull does NOT defer for snapshot (pull is higher priority).

**Alternatives considered**:
- **Database-level locking**: `better-sqlite3` is single-connection synchronous — there's no real concurrency concern at the DB level. The coordination is about logical consistency, not thread safety.
- **Event-based coordination**: Adds complexity without benefit. The timer-based approach is simpler and matches existing patterns.

---

### R5: What is the performance envelope for row-level checksum comparison?

**Decision**: Acceptable. Benchmarking estimate: ~10,000 rows × 17 tables × ~1ms per row = ~170 seconds worst case. But with the fast pre-check (aggregate checksum), most tables will be skipped entirely in normal operation, reducing actual time to under 10 seconds.

**Rationale**: In normal operation (no backup restore, no direct writes), the capture layer catches all changes. The snapshot checker is a safety net. Most cycles will find zero drift and complete in milliseconds via the aggregate pre-check.

For the worst case (backup restore affecting all tables), 170 seconds exceeds the 60-second target. Mitigation: process tables in priority order (students, grades, absences first) and use a configurable per-table row limit. If a table is too large, snapshot only the changed subset using `WHERE rowid > last_checked_rowid`.

**Alternatives considered**:
- **Hash entire table via GROUP_CONCAT**: Fast for small tables but memory-intensive for large ones.
- **Use `updated_at` column as change indicator**: Not all tables have `updated_at`. Would require schema changes.

---

### R6: How should the conflict log be pruned?

**Decision**: Automatic pruning during snapshot cycles. Delete resolved conflicts where `resolved_at < datetime('now', '-30 days')`. Unresolved conflicts are never pruned.

**Rationale**: The snapshot cycle already runs every 30 minutes. Adding a cleanup step is trivial. 30 days gives administrators ample time to review auto-resolved conflicts. Unresolved conflicts persist indefinitely because they represent data discrepancies that need human attention.

---

### R7: What new database schema is needed?

**Decision**: Two schema changes via new migration:

1. **New table `sync_snapshots`**: Stores per-row checksums for the snapshot checker.
   - `row_sync_id TEXT PRIMARY KEY` — links to `sync_id_map`
   - `table_name TEXT NOT NULL`
   - `checksum TEXT NOT NULL` — hash of all non-sensitive column values
   - `updated_at DATETIME DEFAULT CURRENT_TIMESTAMP`

2. **Extended `sync_conflicts` table**: Add columns for enriched conflict data.
   - `ancestor_data TEXT` — common ancestor version
   - `conflicting_fields TEXT` — JSON array of field names that conflicted
   - `resolution_method TEXT CHECK(resolution_method IN ('merged','lww','manual'))` — how it was resolved
   - `resolved_data TEXT` — the final merged/chosen data

3. **Extended `sync_id_map` table**: Add columns for version tracking and ancestor storage.
   - `version INTEGER DEFAULT 0` — last pushed/pulled version number
   - `ancestor_data TEXT` — last agreed-upon state (for three-way merge)

4. **Extended `sync_config` table**: Add snapshot configuration.
   - `snapshot_interval_minutes INTEGER DEFAULT 30`
   - `last_snapshot_at DATETIME`
   - `last_snapshot_error TEXT`

---

### R8: Existing code gap — `school_events` table missing from ENTITY_TYPE_REGISTRY

**Decision**: Out of scope for Phase 5. Document as a known gap. The `school_events` table is registered in `CHANNEL_REGISTRY` (capture.js) but not in `ENTITY_TYPE_REGISTRY` (authority.js). This means events are captured to the outbox but fail silently at push time. This should be fixed in a separate patch.

**Rationale**: Adding `school_events` to the entity registry is a Phase 3/push-engine concern, not a Phase 5 integrity concern. The snapshot checker should skip tables not in `ENTITY_TYPE_REGISTRY` to maintain consistency with the push engine.

---

### R9: Current pull conflict behavior — remote data applied even on conflict

**Decision**: Phase 5 changes this behavior. When a conflict is detected and field-level merge is possible, apply the merged result instead of blindly applying the remote version. When merge produces overlapping conflicts, apply the LWW result. In both cases, log the conflict with full details.

**Rationale**: The current pull engine applies remote data unconditionally even when a conflict is detected (the local outbox entry is left pending). This means the local change will be pushed again on the next flush, potentially creating a ping-pong effect. Phase 5's merge logic resolves this by producing a single agreed-upon version.

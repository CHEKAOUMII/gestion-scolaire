# Data Model: Sync Settings UI

**Feature**: 006-sync-settings-ui
**Date**: 2026-03-21

This feature is a **pure UI layer** — it does not create new database tables or modify existing schemas. All data is consumed from existing backend IPC channels that read/write to sync tables created in Phases 1–5.

## Entities (Read from Backend)

### Sync Configuration

Represents the sync engine's operational parameters. Stored in `sync_config` table (single row).

| Field | Type | Constraints | UI Usage |
|-------|------|-------------|----------|
| enabled | boolean | required | Toggle control |
| syncIntervalMinutes | number | 1–30, integer | Number input with validation |
| awsRegion | string | non-empty when enabled | Text input |
| authLambdaUrl | string \| null | non-empty when enabled | Text input |
| schoolId | string \| null | non-empty when enabled | Text input |
| pushBatchSize | number | positive integer | Advanced settings (number input) |
| maxRetries | number | positive integer | Advanced settings (number input) |
| retentionDays | number | positive integer | Advanced settings (number input) |
| snapshotIntervalMinutes | number | positive integer | Advanced settings (number input) |

**Source**: `window.api.sync.getConfig()` (read), `window.api.sync.setConfig(updates)` (write, admin-only)

**Note**: `snapshotIntervalMinutes` is writable via `setConfig` but NOT returned by `getConfig`. It is only surfaced in `getStatus`. The UI must read it from `getStatus` to populate the form.

---

### Sync Status

A real-time snapshot of the sync engine state. Computed on-demand from multiple sources (timers, outbox counts, conflict counts, credential state).

| Field | Type | UI Usage |
|-------|------|----------|
| enabled | boolean | Master status indicator |
| pushRunning | boolean | "Push active" indicator |
| pullRunning | boolean | "Pull active" indicator |
| lastPushAt | string \| null | "Last push" timestamp display |
| lastPullAt | string \| null | "Last pull" timestamp display |
| lastPushError | string \| null | Error message display |
| lastPullError | string \| null | Error message display |
| pendingCount | number | KPI card: pending changes |
| failedCount | number | KPI card: failed items |
| conflictCount | number | KPI card: unresolved conflicts (links to conflict log) |
| pullCursor | string \| null | Not displayed (internal) |
| authenticated | boolean | Connection state indicator |
| snapshotRunning | boolean | "Snapshot active" indicator |
| lastSnapshotAt | string \| null | "Last snapshot" timestamp display |
| lastSnapshotError | string \| null | Error message display |
| snapshotIntervalMinutes | number | Config form: snapshot interval value |

**Source**: `window.api.sync.getStatus()` (read, polled every 10 seconds)

**Derived state for sidebar indicator**:
- `connected` = enabled && authenticated && !lastPushError && !lastPullError
- `syncing` = pushRunning || pullRunning || snapshotRunning
- `offline` = enabled && !authenticated
- `error` = enabled && (lastPushError || lastPullError)
- `disabled` = !enabled

---

### Conflict Record

An individual data conflict between local and remote versions.

| Field | Type | UI Usage |
|-------|------|----------|
| id | number | Internal key for resolution calls |
| tableName | string | Display: entity source table |
| rowSyncId | string | Display: unique row identifier |
| entityType | string | Display: human-readable entity type (e.g., "STUDENT", "GRADE") |
| localData | object \| null | Detail view: local version (JSON formatted) |
| remoteData | object \| null | Detail view: remote version (JSON formatted) |
| remoteVersion | number | Not displayed directly |
| remoteDeviceHash | string | Display: which device made the remote change |
| status | 'unresolved' \| 'resolved' | Filter criteria, badge styling |
| resolution | 'local' \| 'remote' \| 'merged' \| null | Display: how it was resolved |
| resolvedAt | string \| null | Display: resolution timestamp |
| createdAt | string | Display: when conflict occurred |
| ancestorData | object \| null | Not displayed (used internally for merge context) |
| conflictingFields | string[] | Detail view: highlighted field names |
| resolutionMethod | 'lww' \| 'merged' \| 'manual' \| null | Display: auto vs. manual |
| resolvedData | object \| null | Detail view: final winning data |

**Source**: `window.api.sync.getConflictLog(options)` (read, with pagination/filtering)

**Resolution action**: `window.api.sync.resolveConflict({ conflictId, resolution: 'local' | 'remote' })` (write, admin-only)

---

### Manual Sync Result

Transient result from a triggered sync cycle. Not persisted — displayed once after `triggerNow` completes.

| Field | Type | UI Usage |
|-------|------|----------|
| success | boolean | Overall result indicator |
| push.sentCount | number | "Pushed X changes" |
| push.failedCount | number | "X push failures" |
| pull.appliedCount | number | "Applied X remote changes" |
| pull.conflictCount | number | "X new conflicts" |
| snapshot.changesDetected | number | "Snapshot found X drifted rows" |
| error | string \| null | Error message display |

**Source**: `window.api.sync.triggerNow()` (write, admin-only)

---

## State Transitions

### Sync Enable/Disable Flow

```
disabled ──(admin enables + saves config)──→ enabled/offline
enabled/offline ──(credentials authenticated)──→ enabled/connected
enabled/connected ──(network loss)──→ enabled/offline
enabled/connected ──(sync error)──→ enabled/error
enabled/* ──(admin disables)──→ disabled
```

### Conflict Lifecycle

```
(auto-created by push/pull engine)
    │
    ▼
unresolved ──(admin clicks "Accept Local")──→ resolved (resolution='local', method='manual')
                                                └──→ local data re-queued to sync_outbox
unresolved ──(admin clicks "Accept Remote")──→ resolved (resolution='remote', method='manual')
```

Note: Most conflicts are auto-resolved during pull (method='lww' or 'merged') and stored as `resolved` immediately. Only push-path `ConditionalCheckFailedException` conflicts arrive as `unresolved`.

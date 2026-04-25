# Plan: Complete DynamoDB Sync Implementation

## Context

The sync system has 6 phases fully implemented (foundation, AWS infra, push engine, pull engine, integrity/conflict resolution, settings UI). However, a thorough audit revealed **critical gaps** where data changes are silently lost or never synced. This plan addresses those gaps in priority order.

---

## Gap Summary

| # | Gap | Severity | Status |
|---|-----|----------|--------|
| 1 | Bulk DELETE operations silently lost | **HIGH** | `preCapture: true` flag exists but is never acted upon |
| 2 | Pull INSERT fails silently on UNIQUE constraint | **MEDIUM-HIGH** | Row permanently dropped |
| 3 | Users table not synced | **HIGH** | No CHANNEL_REGISTRY entries |
| 4 | LWW merge uses version instead of timestamp | **MEDIUM** | Remote almost never wins |
| 5 | Conflict `remote_data` always empty | **LOW** | Manual review impossible |
| 6 | `reports:updateIdentity` not captured | **MEDIUM** | School identity doesn't sync |
| 7 | Notifications not synced | **LOW** | Intentionally skip — device-local state |

---

## Phase A: Fix Bulk DELETE Capture (GAP 1)

**Problem:** `preCapture: true` is declared on 7 channels in CHANNEL_REGISTRY but `wrapWithSyncCapture` never checks it — all channels run capture AFTER the handler. For DEL channels, rows are already gone, and `expandBulkEntry()` finds nothing to expand.

**Files:** [capture.js](main/sync/capture.js), [engine.js](main/sync/engine.js)

**Changes in `capture.js`:**

1. Add new function `captureBeforeDelete(db, channel, entry, handlerArgs)`:
   - Query affected rows BEFORE deletion using `school_year` or `id` from args
   - Return array of `{ tableName, localId, rowData, schoolYear }` objects
   - Handle cascading deletes (e.g., `students:deleteByYear` cascades to grades, absences, etc.)

2. Modify `wrapWithSyncCapture` (line 274):
   - Before calling `originalHandler`, check `registryEntry.preCapture`
   - If true, call `captureBeforeDelete()` to collect rows
   - After handler succeeds, iterate pre-collected rows and call `recordOutboxEntry()` with `operation='DEL'` for each
   - Skip the normal `captureAfterWrite` for pre-captured channels

3. Add helper `buildPreCaptureQuery(channel, handlerArgs)` that returns the correct SQL per channel:
   - `absences:deleteByYear` → `SELECT * FROM absences WHERE school_year = ?`
   - `students:deleteByYear` → students + cascading tables by school_year
   - `grades:deleteByYear` → `SELECT * FROM grades WHERE school_year = ?`
   - `grades:deleteBySemester` → `SELECT * FROM grades WHERE school_year = ? AND semester = ?`
   - `teachers:delete` → `SELECT * FROM teachers WHERE id = ?` + cascading tables
   - `teachers:deleteByYear` → teachers + cascading tables by school_year

**Changes in `engine.js`:**

4. Add defensive guard in `expandBulkEntry()`: if `operation === 'DEL'` and `_bulk: true`, log warning and return empty (legacy entries — snapshot checker will catch drift)

---

## Phase B: Fix Pull INSERT on UNIQUE Constraint (GAP 2)

**Problem:** Line 937-946 in engine.js — when pulling a row with no `sync_id_map` entry, a plain INSERT is attempted. If the business key already exists locally (e.g., same student `code`), it fails silently and the row is permanently dropped.

**Files:** [engine.js](main/sync/engine.js), [authority.js](main/sync/authority.js)

**Changes:**

1. Add helper `findExistingRowByBusinessKey(db, tableName, data)`:
   - Uses `ENTITY_TYPE_REGISTRY[tableName].keyFields` to build WHERE clause
   - Returns existing row's `id` if found, null otherwise

2. Modify the INSERT block (line 930-950):
   - Wrap INSERT in try/catch for UNIQUE constraint error
   - On failure: call `findExistingRowByBusinessKey()` to get existing `id`
   - If found: UPDATE the existing row + create `sync_id_map` entry linking remote `rowSyncId` → local `id`
   - Count as `appliedCount++` instead of `failedCount++`

---

## Phase C: Sync the Users Table (GAP 3)

**Security note:** `SENSITIVE_FIELDS = ['password_hash', 'pin_hash']` are already stripped in `capture.js` line 9. Synced user records arrive without passwords — user must set password locally. This is correct behavior.

**Files:** [authority.js](main/sync/authority.js), [capture.js](main/sync/capture.js), [engine.js](main/sync/engine.js), [auth.js](main/ipc/auth.js), [system.js](main/ipc/system.js)

**Changes in `authority.js`:**

1. Add to `ENTITY_TYPE_REGISTRY`:
   ```js
   users: { entityType: 'user', skPrefix: 'USER', keyFields: ['id'] }
   ```

2. Add to `WRITER_AUTHORITY`:
   ```js
   users: ['admin']
   ```

**Changes in `capture.js`:**

3. Add CHANNEL_REGISTRY entries:
   - `users:add` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'lastInsertRowid' }`
   - `users:updateRole` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'argId' }`
   - `users:disable` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'argId' }`
   - `users:resetAdminPassword` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'literal', literalId: 1 }` (admin is always id=1)
   - `auth:register` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'lastInsertRowid' }`
   - `auth:changePassword` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'resultId' }`
   - `auth:setupPin` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'resultId' }`
   - `auth:removePin` → `{ tables: ['users'], operation: 'PUT', idExtractor: 'resultId' }`

4. Add `'resultId'` extractor case in `captureAfterWrite`: reads `handlerResult.userId` to fetch the row

**Changes in `auth.js`:**

5. Modify `auth:changePassword`, `auth:setupPin`, `auth:removePin` handlers to include `userId` in their return object (currently return `{ success: true }`)

6. Wrap these handlers with `wrapWithSyncCapture` — import it from capture.js and apply at registration

**Changes in `system.js`:**

7. Wrap `users:add`, `users:updateRole`, `users:disable`, `users:resetAdminPassword` handlers with `wrapWithSyncCapture`

**Changes in `engine.js`:**

8. Add `'users'` to `TOPO_ORDER_PUT` (early, before `students` — no FK deps)

---

## Phase D: Fix LWW Timestamp (GAP 4)

**Problem:** Line 865 in engine.js uses `item.version` (monotonic counter, typically 1-100) as `remoteTs`, compared against `Date.now()/1000` (~1.7 billion). Local always wins.

**Files:** [engine.js](main/sync/engine.js)

**Changes:**

1. Add `updatedAt` to the mapped item object (line 809-819):
   ```js
   updatedAt: item.updatedAt,
   ```

2. Replace `remoteTs` assignment (line ~865):
   ```js
   const remoteTs = item.updatedAt || Math.floor(Date.now() / 1000);
   ```

3. Improve `localTs`: use outbox entry's `created_at` timestamp (available via `pending.outboxId`) instead of `Date.now()`:
   ```js
   const outboxRow = db.prepare('SELECT created_at FROM sync_outbox WHERE id = ?').get(pending.outboxId);
   const localTs = outboxRow ? Math.floor(new Date(outboxRow.created_at).getTime() / 1000) : Math.floor(Date.now() / 1000);
   ```

---

## Phase E: Fetch Conflict remote_data (GAP 5)

**Problem:** Line 362 in engine.js writes `''` for `remote_data` on push conflicts.

**Files:** [engine.js](main/sync/engine.js)

**Changes:**

1. Import `GetCommand` from `@aws-sdk/lib-dynamodb`

2. After `ConditionalCheckFailedException` (before conflict INSERT, ~line 351), fetch the winning remote item:
   ```js
   let remoteData = '';
   try {
       const getResult = await docClient.send(new GetCommand({
           TableName: tableName,
           Key: { PK: prepared.item.PK, SK: prepared.item.SK }
       }));
       remoteData = JSON.stringify(getResult.Item?.data || {});
   } catch (_) { /* fallback to empty */ }
   ```

3. Use `remoteData` instead of `''` in the conflict INSERT

---

## Phase F: Capture reports:updateIdentity (GAP 6)

**Files:** [authority.js](main/sync/authority.js), [capture.js](main/sync/capture.js), [engine.js](main/sync/engine.js), reports IPC handler file

**Changes:**

1. Add to `ENTITY_TYPE_REGISTRY`: `school_identity: { entityType: 'school_identity', skPrefix: 'SCHOOL_ID', keyFields: ['key'] }`
2. Add to `WRITER_AUTHORITY`: `school_identity: ['admin']`
3. Add to `CHANNEL_REGISTRY`: `'reports:updateIdentity': { tables: ['school_identity'], operation: 'PUT', idExtractor: 'argKey' }`
4. Add `'school_identity'` to `TOPO_ORDER_PUT` (no FK deps)
5. Wrap handler with `wrapWithSyncCapture`

---

## Phase G: Notifications — Intentionally Skipped

Notifications are device-local UI state. mark-as-read on Device A has no meaning on Device B. Notification triggers fire independently on each device when underlying data arrives via pull. **No action needed.**

---

## Implementation Order

```
Phase A (Bulk DEL fix)     ← highest impact, foundational
Phase B (Pull UPSERT)      ← can parallelize with A
Phase C (Users sync)       ← largest scope change
Phase D (LWW timestamp)    ← surgical fix
Phase E (Conflict data)    ← surgical fix, can parallelize with D
Phase F (Identity capture) ← incremental addition
```

## Verification

1. **Phase A:** Invoke `absences:deleteByYear` → verify `sync_outbox` has individual DEL entries (not `_bulk` placeholder)
2. **Phase B:** Insert student locally, simulate pull with same `code` → verify UPDATE (not duplicate or drop)
3. **Phase C:** Call `users:add` → verify outbox entry exists with `password_hash` stripped
4. **Phase D:** Unit test `threeWayMerge` with higher remote `updatedAt` → confirm remote wins
5. **Phase E:** Force a version conflict → verify `remote_data` populated in `sync_conflicts`
6. **Phase F:** Call `reports:updateIdentity` → verify outbox entry created
7. Run `npm run test:smoke` after all phases to confirm IPC parity
8. Run `npm run lint` to confirm no lint errors

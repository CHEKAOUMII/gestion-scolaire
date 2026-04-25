# IPC Contracts: Sync Integration (Phase 7.8)

**Feature**: 015-sync-integration
**Date**: 2026-03-23

## Modified IPC Channels

Phase 7.8 does not add new IPC channels. It modifies the **behavior** of existing channels and the **internal wiring** between the sync engine and the linking/device management flows.

---

### `linking:setup-new-institution` (existing — behavior change)

**Current behavior**: Writes `schoolId: massarCode` to `sync_config`. Sync remains disabled.

**New behavior**: Same write, but also ensures `sync_config.school_id` is explicitly set to `institution_config.massar_code` (already the case — no code change needed, but the contract is now formalized).

**Request**: No change.
```
{ massarCode: string, institutionName?: string, adminName: string, adminPassword: string }
```

**Response**: No change.
```
{ success: true, massarCode: string }
```

---

### `linking:verify-and-link` (existing — behavior change)

**Current behavior**: Receives sync config from Device 1, writes all six fields to `sync_config`.

**New behavior**: Same, plus:
1. If the device was previously revoked (`linked_devices.status = 'revoked'`), update the row to `status = 'active'`, clear `revoked_at`, update `linked_by` and `linked_at`.
2. Sync is enabled automatically if Device 1's config has `enabled = true`.

**Request**: No change.
```
{ massarCode: string, otp: string }
```

**Response**: No change to shape, but `syncConfigured: true` is now guaranteed when Device 1 has sync enabled.
```
{ success: true, massarCode: string, institutionName?: string, syncConfigured: boolean }
```

---

### `linking:revoke-device` (existing — behavior change)

**Current behavior**: Sets `linked_devices.status = 'revoked'` and `revoked_at = CURRENT_TIMESTAMP`.

**New behavior**: Same local write, plus the revocation is now **enforced via cloud sync** — the next push cycle writes a `device_revocation` record to DynamoDB.

**Additional guard**: If `deviceHash` matches `institution_config.setup_device_hash`, reject with error `'Cannot revoke the origin device'`.

**Request**: No change.
```
{ deviceHash: string }
```

**Response**: No change.
```
{ success: true }
```

**Error (new)**:
```
{ success: false, error: 'Cannot revoke the origin device' }
```

---

## Internal Engine Contracts (not IPC — module-to-module)

These are internal function contracts within the sync engine, not exposed to the renderer.

### Heartbeat Update (new internal behavior)

**Called by**: `flushSyncOutbox()` and `pullRemoteChanges()` in `engine.js`
**When**: After each successful sync cycle completion
**Action**: `UPDATE linked_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_hash = ? AND status = 'active'`
**Input**: Current device hash from `getDeviceHash()`
**Output**: None (fire-and-forget, errors logged but not propagated)

### Revocation Push (new internal behavior)

**Called by**: `flushSyncOutbox()` in `engine.js`
**When**: During each push cycle, after regular outbox entries are processed
**Action**: Query `linked_devices WHERE status = 'revoked'`, write `device_revocation` items to DynamoDB
**DynamoDB item shape**:
```
{
  PK: "SCHOOL#<schoolId>",
  SK: "REVOCATION#<revokedDeviceHash>",
  GSI1PK: "SCHOOL#<schoolId>",
  GSI1SK: "<timestamp>#device_revocation#<revokedDeviceHash>",
  entityType: "device_revocation",
  revokedDeviceHash: string,
  revokedAt: string (ISO),
  revokedBy: string (admin deviceHash),
  operation: "PUT",
  deviceHash: string (pusher deviceHash, truncated to 16 chars),
  version: number,
  expiresAt: number (90 days TTL)
}
```

### Revocation Pull Check (new internal behavior)

**Called by**: `pullRemoteChanges()` in `engine.js`
**When**: After fetching DynamoDB items, before applying changes
**Action**: Filter fetched items for `entityType === 'device_revocation'` where `revokedDeviceHash` matches current device hash
**On match**:
1. `UPDATE sync_config SET enabled = 0 WHERE id = 1`
2. Log warning with revocation details
3. Return `{ success: false, error: 'device_revoked', revokedAt: string }`
**On no match**: Continue normal pull flow

### MASSAR-to-schoolId Sync (new internal behavior)

**Called by**: Startup sequence in `main.js` or `init.js`
**When**: After DB initialization, before sync engine starts
**Action**: If `institution_config.massar_code` is set and `sync_config.school_id` differs, update `sync_config.school_id` to match
**Query**:
```sql
UPDATE sync_config SET school_id = (
  SELECT massar_code FROM institution_config WHERE id = 1
) WHERE id = 1 AND (
  school_id IS NULL OR school_id != (SELECT massar_code FROM institution_config WHERE id = 1)
)
```

# Data Model: Sync Integration (Phase 7.8)

**Feature**: 015-sync-integration
**Date**: 2026-03-23

## Existing Entities (Modified)

### sync_config (singleton, id=1)

The existing `sync_config` table is the per-device sync configuration. Phase 7.8 does not add new columns — it changes how existing columns are populated.

| Column | Type | Phase 7.8 Change |
|--------|------|-------------------|
| `school_id` | TEXT | Now populated automatically from `institution_config.massar_code` during setup/linking. Previously required manual entry. |
| `enabled` | INTEGER | Now set to `1` automatically on linked devices when admin device has sync enabled. |
| `auth_lambda_url` | TEXT | Now auto-populated on linked devices from admin device config. |
| `aws_region` | TEXT | Now auto-populated on linked devices from admin device config. |
| `license_key` | TEXT | Now auto-populated on linked devices from admin device config. |
| `sync_interval_minutes` | INTEGER | Now auto-populated on linked devices from admin device config. |

**State transitions for `school_id`**:
- `NULL` → `<massar_code>` (on first-run setup via `setupNewInstitution`)
- `NULL` → `<massar_code>` (on device linking via `verifyAndLink`)
- `<legacy_value>` → `<massar_code>` (on migration for existing installations)

**State transitions for `enabled`**:
- `0` → `0` (linked device, admin has sync disabled)
- `0` → `1` (linked device, admin has sync enabled)
- `1` → `0` (self-revocation detected during pull)

### linked_devices

The existing `linked_devices` table gains behavioral significance in Phase 7.8 — the `last_seen_at` column is now actively updated by the sync engine, and revocation status is enforced via sync.

| Column | Type | Phase 7.8 Change |
|--------|------|-------------------|
| `last_seen_at` | DATETIME | Now updated by sync engine after each push/pull cycle. Previously only set at link time. |
| `status` | TEXT | `'revoked'` status now has cloud enforcement — revoked devices are pushed to DynamoDB and detected on pull. |
| `revoked_at` | DATETIME | Used to determine which revocations need to be pushed to the cloud. |

**State transitions for `status`**:
- `'active'` → `'revoked'` (admin revokes via device management UI — existing behavior)
- `'revoked'` → `'active'` (device re-links via new OTP)

### institution_config (singleton, id=1)

No column changes. Phase 7.8 establishes `massar_code` as the canonical source of truth for `sync_config.school_id`.

| Column | Phase 7.8 Role |
|--------|----------------|
| `massar_code` | Authoritative school identifier — flows into `sync_config.school_id` |
| `setup_device_hash` | Used to prevent revocation of the origin device |

---

## New Entity

### Device Revocation Record (DynamoDB)

A synthetic entity type stored in DynamoDB alongside regular sync data. Not a SQLite table — exists only in the cloud as a DynamoDB item.

| Attribute | Type | Description |
|-----------|------|-------------|
| `PK` | String | `SCHOOL#<massar_code>` — same partition as all sync data |
| `SK` | String | `REVOCATION#<revoked_device_hash>` |
| `GSI1PK` | String | `SCHOOL#<massar_code>` |
| `GSI1SK` | String | `<timestamp>#device_revocation#<revoked_device_hash>` |
| `entityType` | String | `'device_revocation'` |
| `revokedDeviceHash` | String | The device hash of the revoked device |
| `revokedAt` | String | ISO timestamp of revocation |
| `revokedBy` | String | Device hash of the admin who revoked |
| `operation` | String | `'PUT'` (revocations are additive, never DEL) |
| `deviceHash` | String | Device hash of the device that pushed this record |
| `version` | Number | Monotonically increasing version |
| `expiresAt` | Number | TTL — 90 days (revocations should persist longer than regular data) |

**Lifecycle**:
1. Admin revokes device → `linked_devices.status = 'revoked'` (local)
2. Next push cycle → device revocation record written to DynamoDB
3. Revoked device's next pull → detects `entityType: 'device_revocation'` with matching `revokedDeviceHash` → disables sync locally
4. Re-link via OTP → `linked_devices.status = 'active'` (local) → revocation record in DynamoDB becomes stale but harmless (re-linked device has fresh local status)

---

## Relationships

```
institution_config.massar_code ──────► sync_config.school_id
                                            │
                                            ▼
                                    DynamoDB PK: SCHOOL#<massar_code>
                                            │
                                    ┌───────┴───────┐
                                    │               │
                              Sync Data Items   Revocation Records
                              (students,        (device_revocation)
                               grades, etc.)

linked_devices.device_hash ──────► sync engine heartbeat (last_seen_at)
linked_devices.status='revoked' ──► DynamoDB revocation record (push)
DynamoDB revocation record ────────► sync_config.enabled=0 (pull, self-check)

institution_config.setup_device_hash ──► origin device protection (revokeDevice guard)
```

---

## Validation Rules

1. `sync_config.school_id` MUST equal `institution_config.massar_code` at all times after setup is complete
2. `linked_devices.last_seen_at` MUST be updated only for devices with `status = 'active'`
3. Revocation records in DynamoDB MUST use `operation: 'PUT'` only — they are never deleted by the sync engine
4. The device hash in `institution_config.setup_device_hash` MUST NOT appear as the target of a `revokeDevice` call
5. When `verifyAndLink` re-links a previously revoked device, the `linked_devices` row MUST be updated (not duplicated) due to the `UNIQUE` constraint on `device_hash`

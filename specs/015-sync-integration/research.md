# Research: Sync Integration (Phase 7.8)

**Feature**: 015-sync-integration
**Date**: 2026-03-23

## Research Tasks & Findings

### R1: How does `schoolId` currently flow through the sync engine?

**Decision**: The MASSAR code from `institution_config.massar_code` will become the canonical `schoolId` written to `sync_config.school_id`, which the push/pull engines already consume.

**Rationale**: The sync engine already uses `sync_config.school_id` (added via migration) as the DynamoDB partition key (`SCHOOL#<schoolId>`). The push engine reads it at `engine.js:528` (`credentials.schoolId || config.school_id`) and the pull engine at `engine.js:742` (`config.school_id || credentials.schoolId`). The column exists and is functional — it just needs to be populated from `institution_config.massar_code` during setup/linking.

**Alternatives considered**:
- Using `school_id_hash` (the original column from the base DDL) — rejected because the engine already uses `school_id` (added by migration), and `school_id_hash` is unused/legacy.
- Hashing the MASSAR code before storing — rejected because the push/pull engines use the raw value as-is in `SCHOOL#<schoolId>` and the Lambda auth response also returns a raw `schoolId`.

---

### R2: What sync config fields are transferred during device linking?

**Decision**: All six fields are already transferred: `schoolId`, `authLambdaUrl`, `awsRegion`, `licenseKey`, `syncIntervalMinutes`, `enabled`. No new fields need to be added.

**Rationale**: `buildLinkBootstrapPayload()` in `lan.js:58-97` constructs the full config payload from `sync_config` + `institution_config` + `licenses`. The `normalizeSyncConfig()` function in `linking.js:177-194` accepts both snake_case and camelCase variants. `upsertSyncConfig()` in `linking.js:247-293` writes all six columns. Both LAN (unencrypted JSON) and server (AES-256-GCM encrypted) paths carry the same payload.

**Alternatives considered**: None needed — the transfer mechanism is complete.

---

### R3: Where should the MASSAR-to-schoolId bridge be placed?

**Decision**: Two bridge points:
1. **`setupNewInstitution`** in `linking.js:483` — already writes `schoolId: massarCode` to `sync_config`. Confirmed working.
2. **`verifyAndLink`** in `linking.js:627` — already writes the full `importedPayload.syncConfig` (including `schoolId`) via `upsertSyncConfig`. Confirmed working.

A third bridge is needed for **migration of existing installations**: the institution migration (`2026-03-035-institution-device-linking`) seeds `institution_config.massar_code` from `sync_config.school_id`, but does NOT write back in the reverse direction. A new migration or startup hook must ensure `sync_config.school_id` is populated from `institution_config.massar_code` if it is empty or different.

**Rationale**: The MASSAR code is the authoritative identity. If an existing installation has `sync_config.school_id` already set (from manual configuration), it was used to seed `institution_config.massar_code` during the Phase 7.1 migration. Going forward, `institution_config.massar_code` must always be the source of truth that flows into `sync_config.school_id`.

---

### R4: Where should device heartbeat be injected?

**Decision**: Update `linked_devices.last_seen_at` at the end of both `flushSyncOutbox()` and `pullRemoteChanges()` in `engine.js`, using the current device's `deviceHash` to look up the row.

**Rationale**: Both push and pull cycles have clean completion points:
- Push: after all outbox entries are processed, before returning the result (around `engine.js:650`)
- Pull: after cursor advance and `sync_pull_state` updates (around `engine.js:1008`)

The `getDeviceHash()` function in `capture.js:208-221` is already available in the engine module. The heartbeat update is a single `UPDATE linked_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_hash = ? AND status = 'active'` — fast and idempotent.

**Alternatives considered**:
- Separate heartbeat timer — rejected as over-engineering; the sync cycle already runs on a configurable interval.
- Heartbeat via DynamoDB write — rejected because `linked_devices` is a local table and the admin on the same device can see it; remote device status is conveyed by the existing `last_push_at`/`last_pull_at` fields in `sync_config`.

---

### R5: Where should revocation enforcement be injected?

**Decision**: Two-part approach:
1. **Push side**: During `flushSyncOutbox()`, after resolving `schoolId`, query `linked_devices` for rows with `status = 'revoked'` and `revoked_at` after the last push of revocation data. Write a synthetic DynamoDB item with `entityType: 'device_revocation'` and the revoked device hash.
2. **Pull side**: At the beginning of `pullRemoteChanges()`, after fetching DynamoDB items but before applying changes, filter for `entityType: 'device_revocation'` items. If any match the current device's `deviceHash`, disable sync (`UPDATE sync_config SET enabled = 0`) and return an error.

**Rationale**: The push/pull engine already handles entity types via `ENTITY_TYPE_REGISTRY` in `authority.js`. Adding `device_revocation` as a new entity type fits the existing pattern. The pull-side check happens before any data is applied, so a revoked device never processes new data.

**Alternatives considered**:
- Lambda-side revocation (403 on credential refresh) — rejected because it requires Lambda changes and the credential cache would bypass immediate enforcement.
- Checking revocation at `credentials.js:readLicenseKey()` — rejected because license revocation and device revocation are different concepts.

---

### R6: How should re-linking after revocation work?

**Decision**: When a previously revoked device re-links via a new OTP through `verifyAndLink`, the `linking.js` handler should:
1. Update the existing `linked_devices` row: set `status = 'active'`, clear `revoked_at`, update `linked_by` and `linked_at`.
2. Re-enable sync by setting `sync_config.enabled = 1` as part of the config upsert.
3. No special handling needed in the sync engine — the pull-side revocation check reads the local `linked_devices` status, which is now `active`.

**Rationale**: The `linked_devices` table has a `UNIQUE` constraint on `device_hash`, so re-linking must update the existing row rather than insert a duplicate. The OTP verification is the authorization mechanism — if the admin generated a new OTP and the device verified it, the admin intends to re-authorize.

---

### R7: Origin device protection

**Decision**: The `revokeDevice` handler in `linking.js` must check if the target `device_hash` matches `institution_config.setup_device_hash`. If it does, reject with an error. This is a local-only check.

**Rationale**: `institution_config.setup_device_hash` is written during `setupNewInstitution` (linking.js:477) and uniquely identifies the device that created the institution. This device holds the original admin account and is the source of all OTPs — revoking it would orphan the institution.

---

### R8: Schema column naming — `school_id` vs `school_id_hash`

**Decision**: Continue using `sync_config.school_id` (the migration-added column). The original `school_id_hash` column from the base DDL in `schema.js` is legacy and unused — leave it in place (no DDL removal) but do not use it.

**Rationale**: All existing sync engine code references `school_id`, not `school_id_hash`. The IPC layer (`sync.js:fieldMap`) maps `schoolId` → `school_id`. Renaming or removing `school_id_hash` would require a migration with no benefit.

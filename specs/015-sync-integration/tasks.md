# Tasks: Sync Integration (Phase 7.8)

**Input**: Design documents from `/specs/015-sync-integration/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ipc-contracts.md, quickstart.md

**Organization**: Tasks are grouped by user story to enable independent implementation and testing. Each task includes exact file paths, line numbers, and code snippets so a cheaper LLM model can implement without additional context.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3, US4)
- All file paths are relative to the repository root (`D:\pencil2`)

---

## Phase 1: Foundational (Blocking Prerequisites)

**Purpose**: Database migration and startup logic that MUST be complete before any user story can be implemented. These establish the MASSAR→schoolId identity bridge that all other tasks depend on.

**CRITICAL**: No user story work can begin until this phase is complete.

- [x] T001 Add MASSAR-to-schoolId sync migration in `main/db/migrations.js`

    **What to do**: Add a new migration entry to the `MIGRATIONS` array (currently ends at line 698). This migration ensures `sync_config.school_id` matches `institution_config.massar_code` for existing installations that upgraded through Phase 7.1.

    **Where to insert**: After the last migration entry (version `'2026-03-035-institution-device-linking'` at line 675). Add a new object before the closing `];` at line 698.

    **Exact code to add**:

    ```js
    {
        version: '2026-03-038-massar-schoolid-sync',
        up: () => {
            const db = getDb();
            const inst = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get();
            if (inst && inst.massar_code) {
                db.prepare(
                    `UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP
                     WHERE id = 1 AND (school_id IS NULL OR school_id != ?)`
                ).run(inst.massar_code, inst.massar_code);
            }
        },
        recordsVersionInternally: false
    }
    ```

    **Important context**:
    - `getDb()` is imported at the top of migrations.js from `./context`
    - The migration pattern uses `ensureColumn()` for ALTER TABLE but plain SQL for data migrations
    - The `institution_config` table may not have a row yet (fresh install) — the `if (inst && inst.massar_code)` guard handles this
    - The `sync_config` table always has a row (id=1) seeded by `ensureSyncSchema()`
    - Version strings follow the format `YYYY-MM-NNN-description`

    **Verification**: After running, check that `SELECT school_id FROM sync_config WHERE id = 1` returns the same value as `SELECT massar_code FROM institution_config WHERE id = 1`.

- [x] T002 Add startup MASSAR-to-schoolId consistency check in `main.js`

    **What to do**: Add a runtime consistency check that ensures `sync_config.school_id` matches `institution_config.massar_code` every time the app starts. This covers cases where the migration ran before `institution_config` was populated (e.g., fresh install where setup happens after first boot).

    **Where to insert**: In `main.js`, inside the `createWindow()` function, at line 164. The code currently reads:

    ```js
    // line 163
    const setupDb = getDb();
    // line 164
    const inst = setupDb.prepare('SELECT setup_completed FROM institution_config WHERE id = 1').get();
    // line 165
    const targetPage = !inst || !inst.setup_completed ? 'setup.html' : 'index.html';
    ```

    **Change line 164** to also fetch `massar_code`, then add the sync check between lines 164 and 165:

    ```js
    const inst = setupDb.prepare('SELECT setup_completed, massar_code FROM institution_config WHERE id = 1').get();

    // Phase 7.8: Ensure sync_config.school_id matches institution massar_code
    if (inst && inst.massar_code) {
        setupDb
            .prepare(
                `UPDATE sync_config SET school_id = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = 1 AND (school_id IS NULL OR school_id != ?)`
            )
            .run(inst.massar_code, inst.massar_code);
    }

    const targetPage = !inst || !inst.setup_completed ? 'setup.html' : 'index.html';
    ```

    **Important context**:
    - `getDb()` is imported at line 8: `const { getDb } = require('./main/db/context');`
    - `initDatabase()` is called at line 179 inside `app.whenReady()`, which runs before `createWindow()`, so the DB is guaranteed to be ready
    - `setupDb` is already available as a local variable at this point
    - The UPDATE is idempotent — it only runs when `school_id` actually differs from `massar_code`
    - This does NOT add a new variable or function — it's 5 lines of inline code

    **Verification**: Start app → complete first-run setup with MASSAR code → restart app → check `sync_config.school_id` still equals the MASSAR code.

**Checkpoint**: MASSAR identity bridge is established. `sync_config.school_id` is guaranteed to equal `institution_config.massar_code` after both migration and every startup.

---

## Phase 2: User Story 1 — MASSAR Code as Canonical School Identity (Priority: P1) MVP

**Goal**: The MASSAR code from institution setup becomes the canonical school identifier used by the sync engine for DynamoDB partitioning (`SCHOOL#<massar_code>`).

**Independent Test**: Complete first-run setup with MASSAR code "M320456" → read `sync_config` → verify `school_id` equals "M320456". Then trigger a sync push → verify DynamoDB items use `PK: SCHOOL#M320456`.

**Why this works after Phase 1**: The migration (T001) and startup check (T002) already handle the identity bridge. The sync engine at `engine.js:528` already reads `config.school_id` and uses it as `SCHOOL#${schoolId}` at line 171. No code changes are needed in the sync engine itself for US1 — the data flow is:

1. Setup writes `massar_code` to `institution_config` (Phase 7.5 — already done)
2. Setup writes `schoolId: massarCode` to `sync_config` via `upsertSyncConfig` (Phase 7.6 — already done at `linking.js:483`)
3. T001/T002 ensure consistency for upgrade/restart scenarios
4. Push/pull engines read `sync_config.school_id` (Phases 1-6 — already done)

### Implementation for User Story 1

- [x] T003 [US1] Verify the existing `setupNewInstitution` handler writes MASSAR as schoolId in `main/ipc/linking.js`

    **What to do**: This is a **verification task, not a code change**. Read `main/ipc/linking.js` at line 483 and confirm it contains:

    ```js
    upsertSyncConfig(db, { schoolId: massarCode });
    ```

    If this line exists and `massarCode` comes from the function parameter, US1 is already working for new institution setup. No changes needed.

    If the line does NOT exist or uses a different variable, add it inside the `setupNewInstitution` handler (starts at line 430) after the `institution_config` INSERT, before the `return ok(...)` statement.

    **Important context**:
    - `upsertSyncConfig` is defined at line 247 of the same file
    - It writes to `sync_config` columns: `school_id`, `auth_lambda_url`, `aws_region`, `license_key`, `sync_interval_minutes`, `enabled`
    - When called with only `{ schoolId: massarCode }`, the other fields remain at their DB defaults (NULL or 0)

    **Verification**: Delete `institution_config` row → restart app → complete "مؤسسة جديدة" setup with MASSAR "M320456" → query `SELECT school_id FROM sync_config WHERE id = 1` → should return "M320456".

- [x] T004 [US1] Verify the existing `verifyAndLink` handler writes schoolId from Device 1 config in `main/ipc/linking.js`

    **What to do**: This is a **verification task, not a code change**. Read `main/ipc/linking.js` at line 627 and confirm it contains:

    ```js
    upsertSyncConfig(db, importedPayload.syncConfig);
    ```

    Also verify that `importedPayload.syncConfig` includes `schoolId` by checking `normalizeSyncConfig()` at lines 177-194 — it should extract `schoolId` from either `config.school_id` or `config.schoolId`.

    If both exist, US1 is already working for device linking. No changes needed.

    **Verification**: On Device 1, set `sync_config.school_id = 'M320456'` → generate OTP → on Device 2, link via OTP → query `SELECT school_id FROM sync_config WHERE id = 1` on Device 2 → should return "M320456".

**Checkpoint**: US1 complete. MASSAR code flows from institution setup into sync_config.school_id, which the push engine uses as `SCHOOL#<massar_code>` for DynamoDB partitioning. The migration handles legacy upgrades.

---

## Phase 3: User Story 2 — Automatic Sync Configuration on Device Linking (Priority: P1)

**Goal**: When Device 2 links via OTP, all six sync config fields (schoolId, authLambdaUrl, awsRegion, licenseKey, syncIntervalMinutes, enabled) are auto-populated from Device 1. Re-linking a previously revoked device clears the revocation.

**Independent Test**: Device 1 has sync enabled with all fields configured → generate OTP → Device 2 links via OTP → Device 2's sync settings page shows all fields pre-populated and sync enabled.

### Implementation for User Story 2

- [x] T005 [US2] Update `verifyAndLink` handler to clear revocation on re-link in `main/ipc/linking.js`

    **What to do**: The `upsertLinkedDevice()` helper at lines 144-175 already handles re-linking via `ON CONFLICT(device_hash) DO UPDATE SET ... status = 'active', revoked_at = NULL` (lines 158-159). This means re-linking automatically clears any previous revocation. **Verify this is working correctly** — no code change should be needed here.

    However, when a revoked device re-links, `sync_config.enabled` needs to be explicitly restored. Check that `upsertSyncConfig(db, importedPayload.syncConfig)` at line 627 writes the `enabled` field from Device 1's config. If Device 1 has `enabled = 1`, this should automatically re-enable sync on Device 2.

    **Verify by reading** `upsertSyncConfig()` at line 247: confirm the `ON CONFLICT` UPDATE clause includes the `enabled` column. It should — the function writes all six fields.

    **If a gap exists** (e.g., `enabled` is NOT written by `upsertSyncConfig`): add `enabled` to the column list in the INSERT and UPDATE clauses.

    **Verification**: Link Device 2 → revoke Device 2 from Device 1 → re-generate OTP on Device 1 → re-link Device 2 → verify `linked_devices.status = 'active'` and `linked_devices.revoked_at IS NULL` and `sync_config.enabled = 1` on Device 2.

- [x] T006 [US2] Add defensive schoolId consistency check after upsertSyncConfig in `main/ipc/linking.js`

    **What to do**: In the `verifyAndLink` handler (starts at line 521), after the `upsertSyncConfig(db, importedPayload.syncConfig)` call at line 627, add a defensive check to ensure `sync_config.school_id` matches `institution_config.massar_code`.

    **Where to insert**: After line 627 (`upsertSyncConfig(db, importedPayload.syncConfig);`), add:

    ```js
    // Defensive: ensure school_id matches institution massar_code
    const instCheck = db.prepare('SELECT massar_code FROM institution_config WHERE id = 1').get();
    if (instCheck && instCheck.massar_code) {
        db.prepare('UPDATE sync_config SET school_id = ? WHERE id = 1 AND school_id != ?').run(
            instCheck.massar_code,
            instCheck.massar_code
        );
    }
    ```

    **Important context**:
    - This is a safety net — normally `importedPayload.syncConfig.schoolId` already equals the MASSAR code
    - The `db` variable is injected by the `handleWriteSoftAuth` wrapper
    - This runs inside the same handler as the existing upsert, so it's within the same execution context

    **Verification**: Manually set `sync_config.school_id` to a wrong value → link via OTP → verify `sync_config.school_id` is corrected to match `institution_config.massar_code`.

**Checkpoint**: US2 complete. Device linking auto-populates all sync config fields. Re-linking clears revocation and re-enables sync. The schoolId is defensively checked for consistency.

---

## Phase 4: User Story 3 — Device Heartbeat During Sync (Priority: P2)

**Goal**: Each completed sync cycle (push or pull) updates `linked_devices.last_seen_at` for the current device, enabling the admin to monitor device activity from the device management screen.

**Independent Test**: Trigger a sync cycle (via sync settings "مزامنة الآن" button) → query `SELECT last_seen_at FROM linked_devices WHERE device_hash = '<current>'` → should show current timestamp.

### Implementation for User Story 3

- [x] T007 [US3] Add `updateDeviceHeartbeat()` helper function in `main/sync/engine.js`

    **What to do**: Add a new internal helper function near the top of the file (after the existing imports and before `buildDynamoItem` at line 140). This function updates `linked_devices.last_seen_at` for the current device.

    **Where to insert**: After the module-level variable declarations (lines 12-15) and before the first function definition. A good spot is around **line 17** (after any existing helper declarations).

    **Exact code to add**:

    ```js
    /**
     * Update the current device's last_seen_at timestamp in linked_devices.
     * Called after each successful push or pull cycle.
     * Fire-and-forget: errors are logged but not propagated.
     */
    function updateDeviceHeartbeat(db) {
        try {
            const deviceHash = getDeviceHash();
            if (!deviceHash) return;
            db.prepare(
                'UPDATE linked_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_hash = ? AND status = ?'
            ).run(deviceHash, 'active');
        } catch (err) {
            console.warn('[sync] Heartbeat update failed:', err.message);
        }
    }
    ```

    **Important context**:
    - `getDeviceHash` is already imported at line 5 from `./capture`
    - `db` is obtained inside `flushSyncOutbox` and `pullRemoteChanges` via `getDb()` — it will be passed as a parameter
    - The `try/catch` ensures heartbeat failures never crash the sync cycle
    - Only updates rows with `status = 'active'` — revoked devices don't get heartbeats
    - The `linked_devices` table has an index `idx_linked_devices_status` on `status`

    **Verification**: Function exists and can be called without errors.

- [x] T008 [US3] Call `updateDeviceHeartbeat()` at the end of `flushSyncOutbox()` in `main/sync/engine.js`

    **What to do**: Add a heartbeat call after the push cycle completes successfully, just before the final return statement.

    **Where to insert**: At **line 659**, just before the `return` at line 660. The current code is:

    ```js
    // ... push loop ends ...
    // line 659: (empty or last statement before return)
    // line 660: return { success: failedCount === 0, sentCount, failedCount, skippedCount, pendingCount, lastError };
    ```

    **Add this line before the return**:

    ```js
    updateDeviceHeartbeat(db);
    ```

    **Important context**:
    - `db` is already available as a local variable inside `flushSyncOutbox()` — it's obtained via `getDb()` earlier in the function (around line 512-513)
    - The heartbeat runs even if some pushes failed (`failedCount > 0`) — the device was still active
    - The `try/catch` inside `updateDeviceHeartbeat` prevents any heartbeat error from affecting the return value

    **Verification**: Trigger a sync push → check `linked_devices.last_seen_at` is updated to current timestamp.

- [x] T009 [US3] Call `updateDeviceHeartbeat()` at the end of `pullRemoteChanges()` in `main/sync/engine.js`

    **What to do**: Add a heartbeat call after the pull cycle completes successfully, just before the final return statement.

    **Where to insert**: At approximately **line 1009**, just before the `return` at line 1010. The current code is:

    ```js
    // line 1001-1008: sync_pull_state upsert loop
    // line 1009: (empty or last statement before return)
    // line 1010: return { success: failedCount === 0, appliedCount, ...
    ```

    **Add this line before the return**:

    ```js
    updateDeviceHeartbeat(db);
    ```

    **Important context**:
    - `db` is already available as a local variable inside `pullRemoteChanges()` — obtained via `getDb()` earlier in the function
    - This runs after the cursor advance (line 992) and `sync_pull_state` updates (lines 999-1008), so it's the very end of a successful pull
    - The heartbeat only executes when the pull actually fetched and processed items — the early returns (e.g., `_pullRunning` guard at line 710, no-credentials at line 728) skip this code entirely

    **Verification**: Trigger a sync pull → check `linked_devices.last_seen_at` is updated to current timestamp.

**Checkpoint**: US3 complete. Every successful push or pull cycle updates the device's heartbeat timestamp. The admin can see "آخر ظهور" (last seen) in the device management table.

---

## Phase 5: User Story 4 — Revocation Enforcement via Sync (Priority: P2)

**Goal**: When an admin revokes a device, the revocation is pushed to DynamoDB. The revoked device detects self-revocation on its next pull and disables sync. The origin device cannot be revoked.

**Independent Test**: Link two devices → revoke Device 2 from Device 1 → trigger push on Device 1 → trigger pull on Device 2 → verify Device 2's sync is disabled. Also: attempt to revoke the origin device → verify rejection.

### Implementation for User Story 4

- [x] T010 [P] [US4] Register `device_revocation` entity type in `main/sync/authority.js`

    **What to do**: Add a new entry to `ENTITY_TYPE_REGISTRY` (starts at line 21, closes at line 59) for the `device_revocation` entity type.

    **Where to insert**: Before the closing `};` of `ENTITY_TYPE_REGISTRY` at line 59. Add:

    ```js
    device_revocation: {
        entityType: 'device_revocation',
        skPrefix: 'REVOCATION',
        keyFields: ['revokedDeviceHash']
    }
    ```

    **Also add** to `WRITER_AUTHORITY` (lines 1-19) — only admins can push revocations:

    ```js
    device_revocation: ['admin'];
    ```

    **Important context**:
    - `ENTITY_TYPE_REGISTRY` is keyed by table name. For `device_revocation` there is no SQLite table — this is a DynamoDB-only entity. The key `'device_revocation'` is used as the `tableName` parameter in `buildDynamoItem()` and `buildSortKey()`
    - `skPrefix: 'REVOCATION'` means the sort key will be `REVOCATION#<revokedDeviceHash>`
    - `keyFields: ['revokedDeviceHash']` means `buildSortKey()` will extract `revokedDeviceHash` from the row data to build the SK
    - `WRITER_AUTHORITY` controls who can push items — restrict to admin only

    **Verification**: `buildSortKey('device_revocation', { revokedDeviceHash: 'abc123' })` should return `'REVOCATION#abc123'`.

- [x] T011 [P] [US4] Add origin device protection guard to `revokeDevice` handler in `main/ipc/linking.js`

    **What to do**: In the `revokeDevice` handler (starts at line 778), add a guard that prevents revoking the device that created the institution (the "origin" device).

    **Where to insert**: After `targetDeviceHash` is extracted (around line 790) and before the existing guards (current device check), add:

    ```js
    // Phase 7.8: Prevent revoking the origin device
    const instConfig = db.prepare('SELECT setup_device_hash FROM institution_config WHERE id = 1').get();
    if (instConfig && instConfig.setup_device_hash && instConfig.setup_device_hash === targetDeviceHash) {
        return { success: false, error: 'لا يمكن إلغاء الجهاز الأصلي للمؤسسة' };
    }
    ```

    **Important context**:
    - `institution_config.setup_device_hash` is written during `setupNewInstitution` at line 477 — it contains the device hash of the device that first created the institution
    - The handler already has a guard against revoking the current device (comparing to `deviceContext.deviceHash`) — the origin device guard is different because the origin device might not be the current device (e.g., if an admin logs in from a different device)
    - Error message is in Arabic: "لا يمكن إلغاء الجهاز الأصلي للمؤسسة" (Cannot revoke the institution's origin device)
    - The return format matches the existing handler pattern: `{ success: false, error: string }`

    **Verification**: Attempt to revoke the device whose hash matches `institution_config.setup_device_hash` → should return error. Revoking any other device should still work.

- [x] T012 [US4] Add revocation push logic to `flushSyncOutbox()` in `main/sync/engine.js`

    **What to do**: After the regular outbox processing loop completes (around line 655) and before the heartbeat call (T008), add logic to push revocation records for any locally-revoked devices to DynamoDB.

    **Where to insert**: After the regular outbox loop ends and before `updateDeviceHeartbeat(db)` (added in T008). This is approximately at **line 655-659**.

    **Exact code to add**:

    ```js
    // Phase 7.8: Push device revocation records to DynamoDB
    try {
        const revokedDevices = db
            .prepare('SELECT device_hash, revoked_at FROM linked_devices WHERE status = ? AND revoked_at IS NOT NULL')
            .all('revoked');

        for (const revoked of revokedDevices) {
            const revocationItem = {
                PK: `SCHOOL#${schoolId}`,
                SK: `REVOCATION#${revoked.device_hash}`,
                GSI1PK: `SCHOOL#${schoolId}`,
                GSI1SK: `${Math.floor(Date.now() / 1000)}#device_revocation#${revoked.device_hash}`,
                entityType: 'device_revocation',
                revokedDeviceHash: revoked.device_hash,
                revokedAt: revoked.revoked_at,
                revokedBy: String(deviceHash).substring(0, 16),
                operation: 'PUT',
                deviceHash: String(deviceHash).substring(0, 16),
                version: 1,
                expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60
            };

            try {
                const { PutCommand } = require('@aws-sdk/lib-dynamodb');
                const client = getDynamoClient(credentials);
                await client.send(
                    new PutCommand({
                        TableName: 'pencil2-sync',
                        Item: revocationItem,
                        ConditionExpression: 'attribute_not_exists(PK) OR version < :v',
                        ExpressionAttributeValues: { ':v': revocationItem.version }
                    })
                );
            } catch (putErr) {
                if (putErr.name !== 'ConditionalCheckFailedException') {
                    console.error('[sync] Failed to push revocation for', revoked.device_hash, putErr.message);
                }
                // ConditionalCheckFailedException means revocation already exists — safe to ignore
            }
        }
    } catch (revErr) {
        console.error('[sync] Revocation push failed:', revErr.message);
    }
    ```

    **Important context**:
    - `schoolId` is already resolved earlier in `flushSyncOutbox()` at line 528: `const schoolId = credentials.schoolId || config.school_id;`
    - `deviceHash` is already resolved at line 527: `const deviceHash = getDeviceHash();`
    - `credentials` is already available from line 518: `const credentials = await getCredentials();`
    - `getDynamoClient` is already used elsewhere in the file (check imports at top — it may be called `getDocClient` or similar; use the same function as `writeBatchToDynamo` uses)
    - The `PutCommand` import pattern should match how it's done elsewhere in the file (check line ~187 for `writeItemWithCondition`)
    - `ConditionalCheckFailedException` means the revocation was already pushed — idempotent, safe to ignore
    - `expiresAt`: 90 days TTL (longer than regular data's 30-day TTL)
    - The `version: 1` is static because revocations are write-once (they never get updated versions)

    **IMPORTANT**: Before writing this code, read the top of `engine.js` to find the exact import pattern for DynamoDB client and PutCommand. The code above uses placeholder names — adapt to match the existing patterns in the file. Look for:
    1. How `PutCommand` is imported (line ~1-10)
    2. How the DynamoDB client is obtained (look for `getDynamoClient`, `getDocClient`, or similar)
    3. The `writeItemWithCondition` function (around line 215) for the exact conditional write pattern

    **Verification**: Revoke a device locally → trigger sync push → check DynamoDB for a `REVOCATION#<device_hash>` sort key under the school's partition.

- [x] T013 [US4] Add self-revocation detection to `pullRemoteChanges()` in `main/sync/engine.js`

    **What to do**: After fetching DynamoDB items (Step 1, around line 780) and before filtering out self-originated records (Step 2, line 798), add a check for device revocation records that target the current device.

    **Where to insert**: Between lines 780 (end of DynamoDB pagination loop) and 798 (self-origin filter). Approximately at **line 795**.

    **Exact code to add**:

    ```js
    // Phase 7.8: Check for self-revocation before processing any items
    const selfRevocations = allItems.filter(
        (item) => item.entityType === 'device_revocation' && item.revokedDeviceHash === localDeviceHash
    );
    if (selfRevocations.length > 0) {
        // Check local status first — if locally active (re-linked), ignore cloud revocation
        const localDevice = db.prepare('SELECT status FROM linked_devices WHERE device_hash = ?').get(getDeviceHash());

        if (!localDevice || localDevice.status !== 'active') {
            // Self-revocation confirmed — disable sync
            db.prepare('UPDATE sync_config SET enabled = 0, updated_at = CURRENT_TIMESTAMP WHERE id = 1').run();
            console.warn('[sync] Device revocation detected. Sync disabled.', {
                revokedAt: selfRevocations[0].revokedAt,
                revokedBy: selfRevocations[0].revokedBy
            });
            return {
                success: false,
                error: 'device_revoked',
                revokedAt: selfRevocations[0].revokedAt,
                appliedCount: 0,
                skippedCount: 0,
                conflictCount: 0,
                failedCount: 0,
                totalFetched: allItems.length,
                newCursor: cursor,
                lastError: 'تم إلغاء هذا الجهاز من قبل المسؤول'
            };
        }
    }
    ```

    **Important context**:
    - `allItems` is the array of fetched DynamoDB items from the pagination loop (lines 761-780)
    - `localDeviceHash` is defined at line 758: `const localDeviceHash = getDeviceHash().substring(0, 16);`
    - `getDeviceHash()` (without truncation) is needed for the `linked_devices` query because device hashes in that table are stored full-length
    - `db` is available as a local variable (obtained via `getDb()`)
    - `cursor` is the current pull cursor from `sync_config.pull_cursor`
    - The return shape matches the normal pull result at lines 1010-1019
    - The local status check (line `localDevice.status !== 'active'`) prevents false positives when a device has been re-linked (US2/T005) — the cloud revocation record is stale but the local status is `'active'`
    - Error message in Arabic: "تم إلغاء هذا الجهاز من قبل المسؤول" (This device has been revoked by the administrator)
    - The cursor is NOT advanced on revocation — the device should re-check on next cycle (if somehow re-enabled)

    **Verification**: Push a revocation record for Device 2 → trigger pull on Device 2 → verify `sync_config.enabled = 0` and the pull returns `error: 'device_revoked'`.

- [x] T014 [US4] Add sync re-enable prevention for revoked devices in `main/ipc/sync.js`

    **What to do**: In the `sync:setConfig` handler (starts at line 65), add a guard that prevents re-enabling sync on a revoked device.

    **Where to insert**: After the `syncIntervalMinutes` validation (around line 80) and before the dynamic UPDATE construction, add:

    ```js
    // Phase 7.8: Prevent re-enabling sync on a revoked device
    if (updates.enabled === 1 || updates.enabled === true) {
        const deviceHash = getDeviceHash();
        const deviceRow = db.prepare('SELECT status FROM linked_devices WHERE device_hash = ?').get(deviceHash);
        if (deviceRow && deviceRow.status === 'revoked') {
            return { success: false, error: 'تم إلغاء هذا الجهاز. يجب إعادة ربطه أولاً' };
        }
    }
    ```

    **Important context**:
    - `getDeviceHash` needs to be imported at the top of `sync.js`. Check if it's already imported — if not, add: `const { getDeviceHash } = require('../sync/capture');`
    - `db` is injected by the `handleWrite` wrapper
    - `updates` is the payload from the renderer (the second argument after `db` and `_event`)
    - Error message in Arabic: "تم إلغاء هذا الجهاز. يجب إعادة ربطه أولاً" (This device has been revoked. It must be re-linked first)
    - This guard only fires when `enabled` is being set to `1`/`true` — other config changes are allowed

    **Verification**: Revoke a device (set `linked_devices.status = 'revoked'`) → attempt to call `sync:setConfig` with `{ enabled: 1 }` → should return error.

- [x] T015 [P] [US4] Add `device_revocation` to `CHANNEL_REGISTRY` in `main/sync/capture.js`

    **What to do**: Add an excluded entry for `device_revocation` so the sync capture layer knows about this entity type but doesn't try to create outbox entries for it.

    **Where to insert**: After the existing linking entries at line 199, add:

    ```js
    // === device_revocation (Phase 7.8) ===
    'device_revocation': { tables: [], operation: 'PUT', idExtractor: 'none', exclude: true },
    ```

    **Important context**:
    - This follows the exact same pattern as the linking entries at lines 191-199
    - `exclude: true` means `wrapWithSyncCapture` (line 287) will skip this entry
    - The `tables: []` and `idExtractor: 'none'` values don't matter for excluded entries but are required for the registry format

    **Verification**: `CHANNEL_REGISTRY['device_revocation']` should exist and have `exclude: true`.

**Checkpoint**: US4 complete. Revoked devices are pushed to DynamoDB. Self-revocation is detected on pull. Re-enabling sync on a revoked device is blocked. Origin device cannot be revoked.

---

## Phase 6: Polish & Validation

**Purpose**: Final validation to ensure all changes work together and pass CI.

- [x] T016 Run `npm run lint` and fix any linting errors in modified files

    **What to do**: Run `npm run lint` from the repository root. Fix any reported errors in:
    - `main/sync/engine.js`
    - `main/sync/authority.js`
    - `main/sync/capture.js`
    - `main/ipc/linking.js`
    - `main/ipc/sync.js`
    - `main/db/migrations.js`
    - `main.js`

    **Common issues to watch for**:
    - `no-unused-vars`: Any new variable that's not used (warnings for args starting with `_` are exempt)
    - `no-empty`: Empty catch blocks need a comment
    - Missing semicolons (Prettier enforces them)
    - Single quotes (Prettier enforces them)

    **Fix command**: `npm run format` will auto-fix most Prettier issues. Then re-run `npm run lint`.

- [x] T017 Run `npm run test:smoke` and verify all tests pass

    **What to do**: Run `npm run test:smoke` from the repository root. This validates:
    1. **IPC parity**: Channels in `preload.js` match handlers in `main/ipc/*.js` — should pass because we didn't add new IPC channels
    2. **Module integrity**: All required modules can be loaded
    3. **No CDN references**: All vendor libraries are bundled
    4. **Tailwind output**: CSS build output exists

    **Expected result**: All tests pass. The smoke test channel count should NOT change because Phase 7.8 adds no new IPC channels.

    **If IPC parity fails**: Check that no accidental `ipcMain.handle()` calls were added in the modified files. All Phase 7.8 changes are internal to existing handlers.

- [x] T018 Run `npm run format` to ensure Prettier compliance in all modified files

    **What to do**: Run `npm run format` — this formats all JS files with single quotes, no trailing commas, 4-space indent, 120-char line width, semicolons.

    **Verification**: Run `npm run lint` again after formatting — zero errors.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Foundational)**: No dependencies — can start immediately. BLOCKS all user stories.
- **Phase 2 (US1 - MASSAR Identity)**: Depends on Phase 1 completion. Mostly verification tasks.
- **Phase 3 (US2 - Auto-Config)**: Depends on Phase 1 completion. Can run in parallel with US1.
- **Phase 4 (US3 - Heartbeat)**: Depends on Phase 1 completion. Can run in parallel with US1/US2.
- **Phase 5 (US4 - Revocation)**: Depends on Phase 1 completion. T013 (self-revocation pull check) should run after T012 (revocation push) for testing purposes, but the code changes are independent.
- **Phase 6 (Polish)**: Depends on all user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Standalone — depends only on Phase 1 foundational tasks
- **US2 (P1)**: Standalone — depends only on Phase 1 foundational tasks
- **US3 (P2)**: Standalone — depends only on Phase 1 foundational tasks
- **US4 (P2)**: Standalone — T014 modifies `sync.js` (different file from T010-T013); T011 modifies `linking.js` (different file from T012-T013)

### Within-Phase Parallelism

- **Phase 1**: T001 and T002 touch different files (`migrations.js` vs `main.js`) — can run in parallel
- **Phase 5 (US4)**: T010 (`authority.js`), T011 (`linking.js`), and T015 (`capture.js`) are all marked [P] — different files, can run in parallel. T012 and T013 both modify `engine.js` — must run sequentially. T014 modifies `sync.js` — can run in parallel with T012/T013.

### Parallel Opportunities

```
Phase 1: T001 ─┐  (parallel — different files)
                ├─► Phase 2-5 unlocked
         T002 ─┘

Phase 5: T010 (authority.js) ─┐
         T011 (linking.js)    ├─ parallel (different files)
         T015 (capture.js)    ┘

         T012 (engine.js) ──► T013 (engine.js)  sequential (same file)

         T014 (sync.js)  ─── parallel with everything else
```

---

## Implementation Strategy

### MVP First (US1 Only)

1. Complete Phase 1: T001, T002 (foundational — MASSAR bridge)
2. Complete Phase 2: T003, T004 (verification — confirm US1 already works)
3. **STOP and VALIDATE**: First-run setup → `sync_config.school_id` equals MASSAR code
4. This MVP ensures the core identity plumbing is correct before adding heartbeat/revocation

### Incremental Delivery

1. Phase 1 (T001-T002) → MASSAR identity bridge ✓
2. Phase 2 (T003-T004) → Verify US1 ✓ — can deploy
3. Phase 3 (T005-T006) → Auto-config on linking ✓ — can deploy
4. Phase 4 (T007-T009) → Device heartbeat ✓ — can deploy
5. Phase 5 (T010-T015) → Revocation enforcement ✓ — can deploy
6. Phase 6 (T016-T018) → Polish and CI validation ✓ — ready for merge

### Key Decision Points

- After T004: If US1 verification reveals that `setupNewInstitution` does NOT write `schoolId`, you'll need to add that line before proceeding
- After T012: Before writing T013, read the DynamoDB client pattern used in T012 to ensure consistency
- After T015: Run smoke tests early to catch any registry issues

---

## Notes

- **No new files** are created in this feature — all 18 tasks modify existing files
- **No new IPC channels** are added — smoke test channel count should not change
- **No new npm dependencies** are needed
- Code style: single quotes, 4-space indent, 120-char line width, semicolons (Prettier enforced)
- All Arabic text uses RTL — ensure no mixed-direction issues in error messages
- The `engine.js` file is the most heavily modified (~1115 lines) — take care with line numbers as earlier edits may shift subsequent line references
- When in doubt about import patterns or variable names, **read the existing code** at the referenced line numbers before writing

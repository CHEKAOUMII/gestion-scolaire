const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { getDb } = require('../db/context');
const { getCredentials, clearCredentials } = require('./credentials');
const { getDeviceHash, stripSensitiveFields, ensureSyncIdMapping, CHANNEL_REGISTRY } = require('./capture');
const { canPush, buildSortKey, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');
const { threeWayMerge, computeRowChecksum } = require('./merge');
const { SENSITIVE_FIELDS } = require('./capture');

const SYNC_TABLE_NAME = 'pencil2-sync';

let _syncTimer = null;
let _flushRunning = false;
let _pullTimer = null;
let _pullRunning = false;
let _dynamoClient = null;
let _lastAccessKeyId = null;

// Topological order for FK-safe insert/update (parents before children)
const TOPO_ORDER_PUT = [
    'students',
    'teachers',
    'exams',
    'settings',
    'page_visibility',
    'grades',
    'absences',
    'correspondence',
    'student_files',
    'student_movements',
    'teacher_aliases',
    'teacher_absences',
    'staff_attendance',
    'compensation_tracking',
    'exam_proctors',
    'exam_rooms',
    'tests'
];

// Reverse order for FK-safe deletions (children before parents)
const TOPO_ORDER_DEL = [...TOPO_ORDER_PUT].reverse();

function sortByTopology(items) {
    const puts = items.filter((i) => i.operation === 'PUT');
    const dels = items.filter((i) => i.operation === 'DEL');

    puts.sort((a, b) => {
        const aIdx = TOPO_ORDER_PUT.indexOf(a.tableName);
        const bIdx = TOPO_ORDER_PUT.indexOf(b.tableName);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    dels.sort((a, b) => {
        const aIdx = TOPO_ORDER_DEL.indexOf(a.tableName);
        const bIdx = TOPO_ORDER_DEL.indexOf(b.tableName);
        return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });

    return [...dels, ...puts];
}

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
}

function updateDeviceHeartbeat(db) {
    try {
        const deviceHash = getDeviceHash();
        if (!deviceHash) {
            return;
        }

        db.prepare(
            'UPDATE linked_devices SET last_seen_at = CURRENT_TIMESTAMP WHERE device_hash = ? AND status = ?'
        ).run(deviceHash, 'active');
    } catch (err) {
        console.warn('[sync] Heartbeat update failed:', err.message);
    }
}

function getDynamoClient(region, credentials) {
    if (_dynamoClient && credentials.accessKeyId === _lastAccessKeyId) {
        return _dynamoClient;
    }

    const client = new DynamoDBClient({
        region,
        credentials: {
            accessKeyId: credentials.accessKeyId,
            secretAccessKey: credentials.secretAccessKey,
            sessionToken: credentials.sessionToken
        }
    });

    _dynamoClient = DynamoDBDocumentClient.from(client, {
        marshallOptions: { removeUndefinedValues: true }
    });
    _lastAccessKeyId = credentials.accessKeyId;

    return _dynamoClient;
}

function parseLocalIdFromRowSyncId(rowSyncId, tableName) {
    const prefix = `:${tableName}:`;
    const index = String(rowSyncId || '').indexOf(prefix);
    if (index === -1) return null;
    return String(rowSyncId).slice(index + prefix.length);
}

function normalizeSortKeyRowData(entry, rowData) {
    const normalized = { ...(rowData || {}) };
    const localId = parseLocalIdFromRowSyncId(entry.row_sync_id, entry.table_name);

    if (normalized.school_year == null && entry.school_year != null) {
        normalized.school_year = entry.school_year;
    }

    if (localId !== null && normalized.id == null) {
        normalized.id = localId;
    }

    if (entry.table_name === 'page_visibility' && normalized.key == null && normalized.page_key != null) {
        normalized.key = normalized.page_key;
    }

    if (entry.table_name === 'staff_attendance' && normalized.date == null && normalized.attendance_date != null) {
        normalized.date = normalized.attendance_date;
    }

    if (entry.table_name === 'teacher_absences' && normalized.date == null && normalized.absence_date != null) {
        normalized.date = normalized.absence_date;
    }

    if (entry.table_name === 'student_files' && normalized.student_code == null && normalized.student_id != null) {
        normalized.student_code = normalized.student_id;
    }

    if (entry.table_name === 'exam_rooms') {
        if (normalized.room_id == null) {
            normalized.room_id = normalized.id || localId || normalized.room_name || '';
        }
    }

    if (entry.table_name === 'students' && normalized.code == null && localId != null) {
        normalized.code = localId;
    }

    if (entry.table_name === 'settings' && normalized.key == null && localId != null) {
        normalized.key = localId;
    }

    return normalized;
}

function buildDynamoItem(db, entry, schoolId, deviceHash) {
    let parsedRowData = {};

    try {
        parsedRowData = entry.row_data ? JSON.parse(entry.row_data) : {};
    } catch (err) {
        console.warn(`[sync:push] Failed to parse row_data for entry ${entry.id}:`, err.message);
        return null;
    }

    const rowData = stripSensitiveFields(parsedRowData) || {};
    const entityType = getEntityType(entry.table_name);
    if (!entityType) {
        console.warn(`[sync:push] Unknown entity type for table '${entry.table_name}'`);
        return null;
    }

    const sortKey = buildSortKey(entry.table_name, normalizeSortKeyRowData(entry, rowData));
    if (!sortKey) {
        console.warn(`[sync:push] Failed to build sort key for table '${entry.table_name}'`);
        return null;
    }

    const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
    const currentVersion = Number(mapping?.version || 0);
    const newVersion = currentVersion + 1;

    const updatedAt = Math.floor(Date.now() / 1000);
    const expiresAt = entry.operation === 'DEL' ? updatedAt + 259200 : updatedAt + 30 * 86400;

    return {
        PK: `SCHOOL#${schoolId}`,
        SK: sortKey,
        GSI1PK: `SCHOOL#${schoolId}`,
        GSI1SK: `${updatedAt}#${entityType}#${entry.row_sync_id}`,
        entityType,
        schoolYear: entry.school_year || '',
        updatedAt,
        version: newVersion,
        operation: entry.operation,
        rowSyncId: entry.row_sync_id,
        deviceHash: String(deviceHash || '').substring(0, 16),
        data: rowData,
        expiresAt
    };
}

async function writeBatchToDynamo(docClient, items) {
    if (!items.length) return { success: true, failedItems: [] };

    const requestItems = {
        [SYNC_TABLE_NAME]: items.map((item) => ({
            PutRequest: { Item: item }
        }))
    };

    try {
        const result = await docClient.send(new BatchWriteCommand({ RequestItems: requestItems }));
        const unprocessed = result.UnprocessedItems?.[SYNC_TABLE_NAME] || [];
        return {
            success: unprocessed.length === 0,
            failedItems: unprocessed,
            error: unprocessed.length ? 'Batch write returned unprocessed items' : null,
            errorName: null,
            isThrottle: false,
            isAccessDenied: false
        };
    } catch (err) {
        const isThrottle = err.name === 'ProvisionedThroughputExceededException' || err.name === 'ThrottlingException';
        const isAccessDenied = err.name === 'AccessDeniedException';
        if (isAccessDenied) {
            clearCredentials();
        }
        return {
            success: false,
            error: err.message,
            errorName: err.name,
            isThrottle,
            isAccessDenied,
            failedItems: items.map((item) => ({ PutRequest: { Item: item } }))
        };
    }
}

async function writeItemWithCondition(docClient, item) {
    try {
        await docClient.send(
            new PutCommand({
                TableName: SYNC_TABLE_NAME,
                Item: item,
                ConditionExpression: 'attribute_not_exists(version) OR version < :v',
                ExpressionAttributeValues: { ':v': item.version }
            })
        );
        return { success: true };
    } catch (err) {
        if (err.name === 'ConditionalCheckFailedException') {
            return { success: false, conflict: true, error: 'Version conflict', errorName: err.name };
        }

        const isThrottle = err.name === 'ProvisionedThroughputExceededException' || err.name === 'ThrottlingException';
        const isAccessDenied = err.name === 'AccessDeniedException';
        if (isAccessDenied) {
            clearCredentials();
        }

        return {
            success: false,
            error: err.message,
            errorName: err.name,
            isThrottle,
            isAccessDenied
        };
    }
}

async function pushDeviceRevocations(db, docClient, schoolId, deviceHash) {
    const result = {
        sentCount: 0,
        failedCount: 0,
        lastError: null,
        abort: false
    };

    try {
        const revokedDevices = db
            .prepare('SELECT device_hash, revoked_at FROM linked_devices WHERE status = ? AND revoked_at IS NOT NULL')
            .all('revoked');

        for (const revoked of revokedDevices) {
            const revokedDeviceHash = String(revoked.device_hash || '').trim();
            const revokedAt = revoked.revoked_at;
            const sortKey = buildSortKey('device_revocation', { revokedDeviceHash });

            if (!revokedDeviceHash || !revokedAt || !sortKey) {
                continue;
            }

            const revocationItem = {
                PK: `SCHOOL#${schoolId}`,
                SK: sortKey,
                GSI1PK: `SCHOOL#${schoolId}`,
                GSI1SK: `${Math.floor(Date.now() / 1000)}#device_revocation#${revokedDeviceHash}`,
                entityType: 'device_revocation',
                revokedDeviceHash,
                revokedAt,
                revokedBy: String(deviceHash || '').substring(0, 16),
                operation: 'PUT',
                deviceHash: String(deviceHash || '').substring(0, 16),
                version: 1,
                expiresAt: Math.floor(Date.now() / 1000) + 90 * 24 * 60 * 60
            };

            const writeResult = await writeItemWithCondition(docClient, revocationItem);
            if (writeResult.success) {
                result.sentCount += 1;
                continue;
            }

            if (writeResult.conflict) {
                continue;
            }

            result.failedCount += 1;
            result.lastError = writeResult.error || 'Failed to push device revocation';
            console.error('[sync] Failed to push revocation for', revokedDeviceHash, result.lastError);

            if (writeResult.isAccessDenied) {
                result.abort = true;
                break;
            }
        }
    } catch (err) {
        result.failedCount += 1;
        result.lastError = err.message;
        console.error('[sync] Revocation push failed:', err.message);
    }

    return result;
}

function markEntrySent(db, entryId) {
    db.prepare(
        "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
    ).run(entryId);

    // Update version and ancestor in sync_id_map for the pushed entry
    const entry = db.prepare('SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?').get(entryId);
    if (entry && entry.row_sync_id) {
        db.prepare('UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?').run(
            entry.row_data,
            entry.row_sync_id
        );
    }
}

function markEntryFailed(db, entryId, error, maxRetries, ignoreMaxRetries = false, forceFailed = false) {
    const entry = db.prepare('SELECT retries FROM sync_outbox WHERE id = ?').get(entryId);
    const retries = Number(entry?.retries || 0);
    const newStatus = forceFailed ? 'failed' : !ignoreMaxRetries && retries >= maxRetries ? 'failed' : 'pending';

    db.prepare(
        'UPDATE sync_outbox SET retries = ?, last_attempt_at = CURRENT_TIMESTAMP, last_error = ?, status = ? WHERE id = ?'
    ).run(retries, error, newStatus, entryId);
}

function updatePushMeta(db, lastPushAt, lastPushError) {
    db.prepare(
        'UPDATE sync_config SET last_push_at = ?, last_push_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(lastPushAt, lastPushError);
}

function getCurrentRole() {
    try {
        const { getActiveSessions } = require('../ipc/auth');
        const sessions = getActiveSessions();
        if (!sessions || sessions.size === 0) return null;

        for (const session of sessions.values()) {
            if (session.role === 'admin') return 'admin';
        }

        for (const session of sessions.values()) {
            if (session.role === 'staff') return 'staff';
        }

        return null;
    } catch {
        return null;
    }
}

function buildItemKey(item) {
    return `${item.PK}||${item.SK}`;
}

async function flushPreparedItems(db, docClient, preparedItems, maxRetries) {
    if (!preparedItems.length) {
        return { sentCount: 0, failedCount: 0, lastError: null, abort: false };
    }

    // Always use conditional writes for version-guarded pushes
    {
        let sentCount = 0;
        let failedCount = 0;
        let lastError = null;

        for (const prepared of preparedItems) {
            const result = await writeItemWithCondition(docClient, prepared.item);
            if (result.success) {
                markEntrySent(db, prepared.entryId);
                sentCount += 1;
                continue;
            }

            lastError = result.error || 'Conditional write failed';
            markEntryFailed(
                db,
                prepared.entryId,
                lastError,
                maxRetries,
                result.isThrottle || result.isAccessDenied,
                result.conflict
            );
            failedCount += 1;

            if (result.conflict) {
                // Log enriched conflict entry for version conflicts
                try {
                    const ancestorMapping = db
                        .prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')
                        .get(prepared.item.rowSyncId);
                    const conflictTableName =
                        Object.keys(ENTITY_TYPE_REGISTRY).find(
                            (k) => ENTITY_TYPE_REGISTRY[k].entityType === prepared.item.entityType
                        ) || '';
                    db.prepare(
                        `
                        INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
                            remote_version, remote_device_hash, local_outbox_id, ancestor_data, resolution_method, status)
                        VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, 'lww', 'unresolved')
                    `
                    ).run(
                        conflictTableName,
                        prepared.item.rowSyncId || '',
                        prepared.item.entityType || '',
                        JSON.stringify(prepared.item.data || {}),
                        '', // remote_data unknown until fetched — placeholder
                        prepared.item.version,
                        prepared.item.deviceHash || '',
                        prepared.entryId,
                        ancestorMapping?.ancestor_data || null
                    );
                } catch {
                    // Non-critical — don't fail the push over conflict logging
                }
            }

            if (result.isAccessDenied) {
                return { sentCount, failedCount, lastError, abort: true };
            }
        }

        return { sentCount, failedCount, lastError, abort: false };
    }
}

function isKnownSyncTable(tableName) {
    return !!ENTITY_TYPE_REGISTRY[tableName];
}

function expandBulkEntry(db, entry, _deviceHash) {
    let bulkData = {};

    try {
        bulkData = JSON.parse(entry.row_data || '{}');
    } catch (err) {
        console.warn(`[sync:push] Bulk expansion failed for entry ${entry.id}:`, err.message);
        return [];
    }

    const tableName = entry.table_name;
    const schoolYear = entry.school_year || '';
    const bulkChannel = bulkData.channel;

    if (bulkChannel && !CHANNEL_REGISTRY[bulkChannel]) {
        console.warn(`[sync:push] Unknown bulk channel '${bulkChannel}' for entry ${entry.id}`);
        return [];
    }

    if (!isKnownSyncTable(tableName)) {
        console.warn(`[sync:push] Bulk expansion rejected for unknown table '${tableName}'`);
        return [];
    }

    let rows = [];

    try {
        const columns = db.prepare(`PRAGMA table_info("${tableName}")`).all();
        const hasSchoolYear = columns.some((column) => column.name === 'school_year');

        if (hasSchoolYear && schoolYear) {
            rows = db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
        } else {
            rows = db.prepare(`SELECT * FROM "${tableName}"`).all();
        }
    } catch (err) {
        console.warn(`[sync:push] Bulk expansion failed for table '${tableName}':`, err.message);
        return [];
    }

    const expanded = [];
    for (const row of rows) {
        const localId = row.id ?? row.code ?? row.key ?? row.page_key;
        if (localId == null) continue;

        const rowSyncId = ensureSyncIdMapping(db, tableName, localId);
        const cleanData = stripSensitiveFields({ ...row });

        expanded.push({
            table_name: tableName,
            row_sync_id: rowSyncId,
            operation: 'PUT',
            row_data: JSON.stringify(cleanData),
            school_year: schoolYear
        });
    }

    return expanded;
}

async function flushExpandedEntries(db, docClient, entryId, expandedEntries, schoolId, deviceHash, maxRetries, role) {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let lastError = null;
    let abort = false;

    for (let index = 0; index < expandedEntries.length; index += 25) {
        const chunk = expandedEntries.slice(index, index + 25);
        const items = [];

        for (const expanded of chunk) {
            if (!canPush(expanded.table_name, role)) {
                skippedCount += 1;
                continue;
            }

            const dynamoItem = buildDynamoItem(db, expanded, schoolId, deviceHash);
            if (!dynamoItem) {
                failedCount += 1;
                lastError = 'Failed to build DynamoDB item — unknown entity type';
                continue;
            }
            items.push(dynamoItem);
        }

        if (!items.length) {
            continue;
        }

        const result = await writeBatchToDynamo(docClient, items);
        const failedItemKeys = new Set(
            (result.failedItems || []).map((request) => buildItemKey(request.PutRequest?.Item || {}))
        );

        for (const item of items) {
            if (failedItemKeys.has(buildItemKey(item))) {
                failedCount += 1;
                lastError = result.error || 'Batch write failed';
            } else {
                sentCount += 1;
            }
        }

        if (result.isAccessDenied) {
            abort = true;
            lastError = result.error || 'Access denied';
            break;
        }
    }

    if (failedCount === 0) {
        markEntrySent(db, entryId);
    } else {
        markEntryFailed(db, entryId, lastError || 'Batch write failed', maxRetries, abort);
    }

    return { sentCount, failedCount, skippedCount, lastError, abort };
}

async function flushSyncOutbox(limit) {
    if (_flushRunning) return { success: true, skipped: true, reason: 'already_running' };
    _flushRunning = true;

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (!Number(config.enabled)) return { success: true, skipped: true, reason: 'disabled' };

        const role = getCurrentRole();
        if (!role) return { success: true, skipped: true, reason: 'no_active_session' };

        const credentials = await getCredentials();
        if (!credentials) {
            updatePushMeta(db, null, 'Failed to obtain credentials');
            return { success: false, error: 'credentials_unavailable' };
        }

        const batchSize = Number(config.push_batch_size) || 100;
        const maxRetries = Number(config.max_retries) || 10;
        const effectiveLimit = Number(limit) || batchSize;
        const deviceHash = getDeviceHash();
        const schoolId = credentials.schoolId || config.school_id;
        const awsRegion = config.aws_region || 'us-east-1';

        if (!schoolId) {
            updatePushMeta(db, null, 'Missing school identifier');
            return { success: false, error: 'school_id_unavailable' };
        }

        const docClient = getDynamoClient(awsRegion, credentials);
        let sentCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        let lastError = null;
        let batchBuffer = [];
        const pendingRows = db
            .prepare("SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?")
            .all(effectiveLimit);

        const flushBuffer = async () => {
            if (!batchBuffer.length) return false;

            const result = await flushPreparedItems(db, docClient, batchBuffer, maxRetries);
            sentCount += result.sentCount;
            failedCount += result.failedCount;
            lastError = result.lastError || lastError;
            batchBuffer = [];

            return result.abort;
        };

        for (const row of pendingRows) {
            if (!canPush(row.table_name, role)) {
                skippedCount += 1;
                console.log(`[sync:push] Skipped entry ${row.id} — role '${role}' cannot push to '${row.table_name}'`);
                continue;
            }

            let rowData = {};
            try {
                rowData = row.row_data ? JSON.parse(row.row_data) : {};
            } catch (err) {
                db.prepare(
                    'UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?'
                ).run(row.id);
                markEntryFailed(db, row.id, `Invalid row_data JSON: ${err.message}`, maxRetries);
                failedCount += 1;
                lastError = err.message;
                continue;
            }

            if (rowData._bulk) {
                const aborted = await flushBuffer();
                if (aborted) break;

                db.prepare(
                    'UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?'
                ).run(row.id);

                const expandedEntries = expandBulkEntry(db, row, deviceHash);
                if (expandedEntries.length === 0) {
                    markEntrySent(db, row.id);
                    continue;
                }

                const expandedResult = await flushExpandedEntries(
                    db,
                    docClient,
                    row.id,
                    expandedEntries,
                    schoolId,
                    deviceHash,
                    maxRetries,
                    role
                );
                sentCount += expandedResult.sentCount;
                failedCount += expandedResult.failedCount;
                skippedCount += expandedResult.skippedCount;
                lastError = expandedResult.lastError || lastError;

                if (expandedResult.abort) {
                    break;
                }

                continue;
            }

            db.prepare(
                'UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?'
            ).run(row.id);

            const dynamoItem = buildDynamoItem(db, row, schoolId, deviceHash);
            if (!dynamoItem) {
                markEntryFailed(db, row.id, 'Failed to build DynamoDB item — unknown entity type', maxRetries);
                failedCount += 1;
                lastError = 'Failed to build DynamoDB item — unknown entity type';
                continue;
            }

            batchBuffer.push({ entryId: row.id, item: dynamoItem });

            if (batchBuffer.length >= 25) {
                const aborted = await flushBuffer();
                if (aborted) break;
            }
        }

        const aborted = await flushBuffer();
        if (aborted) {
            lastError = lastError || 'Access denied';
        }

        const revocationResult = await pushDeviceRevocations(db, docClient, schoolId, deviceHash);
        failedCount += revocationResult.failedCount;
        lastError = revocationResult.lastError || lastError;
        updateDeviceHeartbeat(db);

        updatePushMeta(
            db,
            sentCount > 0 || revocationResult.sentCount > 0 ? new Date().toISOString() : null,
            lastError
        );

        const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;
        if (sentCount > 0 || revocationResult.sentCount > 0) {
            console.log(
                `[sync:push] Pushed ${sentCount} entries, ${revocationResult.sentCount} revocations, ${failedCount} failed, ${skippedCount} skipped, ${pendingCount} pending`
            );
        }

        return {
            success: failedCount === 0,
            sentCount,
            failedCount,
            skippedCount,
            pendingCount,
            lastError,
            revocationCount: revocationResult.sentCount
        };
    } finally {
        _flushRunning = false;
    }
}

function startSyncPushBackground() {
    if (_syncTimer) return;

    try {
        const db = getDb();
        const config = readSyncConfig(db);

        if (!Number(config.enabled) || !config.auth_lambda_url) {
            return;
        }

        void flushSyncOutbox();

        const intervalMinutes = Math.max(1, Math.min(30, Number(config.sync_interval_minutes) || 5));
        const intervalMs = intervalMinutes * 60 * 1000;

        _syncTimer = setInterval(() => {
            void flushSyncOutbox();
        }, intervalMs);

        if (typeof _syncTimer.unref === 'function') {
            _syncTimer.unref();
        }

        console.log(`[sync:push] Background push started (interval: ${intervalMinutes}min)`);
    } catch (err) {
        console.warn('[sync:push] Failed to start push background:', err.message);
    }
}

function stopSyncPushBackground() {
    if (_syncTimer) {
        clearInterval(_syncTimer);
        _syncTimer = null;
        console.log('[sync:push] Background push stopped');
    }
}

function restartSyncPushBackground() {
    stopSyncPushBackground();
    startSyncPushBackground();
}

async function pullRemoteChanges() {
    if (_pullRunning) return { success: false, skipped: true };
    _pullRunning = true;
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !config.enabled) {
            return {
                success: true,
                appliedCount: 0,
                skippedCount: 0,
                conflictCount: 0,
                failedCount: 0,
                totalFetched: 0,
                newCursor: null,
                lastError: null
            };
        }

        const credentials = await getCredentials();
        if (!credentials) {
            return {
                success: false,
                appliedCount: 0,
                skippedCount: 0,
                conflictCount: 0,
                failedCount: 0,
                totalFetched: 0,
                newCursor: null,
                lastError: 'No credentials available'
            };
        }

        const schoolId = config.school_id || credentials.schoolId;
        if (!schoolId) {
            return {
                success: false,
                appliedCount: 0,
                skippedCount: 0,
                conflictCount: 0,
                failedCount: 0,
                totalFetched: 0,
                newCursor: null,
                lastError: 'No school_id configured'
            };
        }

        const region = config.aws_region || 'us-east-1';
        const cursor = config.pull_cursor || '0';
        const currentDeviceHash = getDeviceHash();
        const localDeviceHash = currentDeviceHash.substring(0, 16);
        const docClient = getDynamoClient(region, credentials);

        // Step 1: Query DynamoDB SyncGSI for changes since last cursor
        const allItems = [];
        let lastEvaluatedKey = undefined;
        do {
            const cmd = new QueryCommand({
                TableName: 'pencil2-sync',
                IndexName: 'SyncGSI',
                KeyConditionExpression: 'GSI1PK = :pk AND GSI1SK > :cursor',
                ExpressionAttributeValues: {
                    ':pk': `SCHOOL#${schoolId}`,
                    ':cursor': cursor
                },
                ScanIndexForward: true,
                Limit: 500,
                ExclusiveStartKey: lastEvaluatedKey
            });
            const resp = await docClient.send(cmd);
            if (resp.Items) allItems.push(...resp.Items);
            lastEvaluatedKey = resp.LastEvaluatedKey;
        } while (lastEvaluatedKey);

        if (allItems.length === 0) {
            db.prepare(
                'UPDATE sync_config SET last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
            ).run();
            updateDeviceHeartbeat(db);
            return {
                success: true,
                appliedCount: 0,
                skippedCount: 0,
                conflictCount: 0,
                failedCount: 0,
                totalFetched: 0,
                newCursor: cursor,
                lastError: null
            };
        }

        const selfRevocations = allItems.filter(
            (item) => item.entityType === 'device_revocation' && item.revokedDeviceHash === currentDeviceHash
        );
        if (selfRevocations.length > 0) {
            const localDevice = db
                .prepare('SELECT status FROM linked_devices WHERE device_hash = ?')
                .get(currentDeviceHash);
            if (!localDevice || localDevice.status !== 'active') {
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

        // Step 2: Filter out self-originated records
        const remoteItems = allItems.filter(
            (item) => item.entityType !== 'device_revocation' && item.deviceHash !== localDeviceHash
        );
        const skippedCount = allItems.length - remoteItems.length;

        // Step 3: Map DynamoDB items to internal format
        const mapped = [];
        for (const item of remoteItems) {
            const tableName = Object.keys(ENTITY_TYPE_REGISTRY).find(
                (k) => ENTITY_TYPE_REGISTRY[k].entityType === item.entityType
            );
            if (!tableName) continue;
            mapped.push({
                tableName,
                operation: item.operation,
                rowSyncId: item.rowSyncId,
                data: item.data || {},
                version: item.version,
                deviceHash: item.deviceHash,
                entityType: item.entityType,
                schoolYear: item.schoolYear,
                GSI1SK: item.GSI1SK
            });
        }

        // Step 4: Sort by topological order for FK safety
        const sorted = sortByTopology(mapped);

        // Step 5: Pre-load pending outbox row_sync_ids for conflict detection
        const pendingRows = db
            .prepare("SELECT row_sync_id, id, row_data FROM sync_outbox WHERE status = 'pending'")
            .all();
        const pendingMap = new Map();
        for (const row of pendingRows) {
            pendingMap.set(row.row_sync_id, { outboxId: row.id, rowData: row.row_data });
        }

        // Step 6: Apply changes in a single transaction
        let appliedCount = 0;
        let conflictCount = 0;
        let failedCount = 0;

        const applyChanges = db.transaction(() => {
            for (const item of sorted) {
                try {
                    // Check for conflicts
                    const pending = pendingMap.get(item.rowSyncId);
                    if (pending) {
                        // Load ancestor for three-way merge
                        const ancestorRow = db
                            .prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')
                            .get(item.rowSyncId);
                        let ancestor = null;
                        try {
                            ancestor = ancestorRow?.ancestor_data ? JSON.parse(ancestorRow.ancestor_data) : null;
                        } catch {
                            /* no ancestor */
                        }

                        // Load current local data from the pending outbox entry
                        let localData = {};
                        try {
                            localData = pending.rowData ? JSON.parse(pending.rowData) : {};
                        } catch {
                            /* empty */
                        }

                        const localTs = Math.floor(Date.now() / 1000); // local change time (approximate)
                        const remoteTs = item.version || 0; // use version as proxy for timestamp ordering

                        // Save original remote data before merge overwrites it
                        const originalRemoteData = JSON.stringify(item.data);

                        const mergeResult = threeWayMerge(ancestor, localData, item.data, localTs, remoteTs);

                        // Use merged data instead of raw remote data
                        item.data = mergeResult.merged;

                        if (mergeResult.resolution === 'clean') {
                            // Perfect merge — discard pending outbox entry
                            db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
                        } else {
                            // Log enriched conflict entry
                            const resolutionMethod = mergeResult.resolution === 'lww' ? 'lww' : 'merged';
                            db.prepare(
                                `
                                INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
                                    remote_version, remote_device_hash, local_outbox_id, ancestor_data,
                                    conflicting_fields, resolution_method, resolved_data, status, resolution, resolved_at)
                                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, CURRENT_TIMESTAMP)
                            `
                            ).run(
                                item.tableName,
                                item.rowSyncId,
                                item.entityType,
                                pending.rowData,
                                originalRemoteData,
                                item.version,
                                item.deviceHash,
                                pending.outboxId,
                                ancestorRow?.ancestor_data || null,
                                JSON.stringify(mergeResult.conflicts),
                                resolutionMethod,
                                JSON.stringify(mergeResult.merged),
                                mergeResult.conflicts.length > 0 ? 'remote' : 'merged'
                            );
                            // Discard the pending outbox entry since we've merged
                            db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
                            conflictCount++;
                        }
                    }

                    // Look up sync_id_map for existing local mapping
                    const mapping = db
                        .prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?')
                        .get(item.rowSyncId);

                    if (item.operation === 'PUT') {
                        if (mapping) {
                            const columns = Object.keys(item.data).filter((k) => k !== 'id');
                            if (columns.length > 0) {
                                const setClause = columns.map((c) => `"${c}" = ?`).join(', ');
                                const values = columns.map((c) => item.data[c]);
                                values.push(mapping.local_id);
                                try {
                                    db.prepare(`UPDATE "${item.tableName}" SET ${setClause} WHERE id = ?`).run(
                                        ...values
                                    );
                                } catch {
                                    failedCount++;
                                    continue;
                                }
                            }
                        } else {
                            const columns = Object.keys(item.data).filter((k) => k !== 'id');
                            if (columns.length > 0) {
                                const colNames = columns.map((c) => `"${c}"`).join(', ');
                                const placeholders = columns.map(() => '?').join(', ');
                                const values = columns.map((c) => item.data[c]);
                                let info;
                                try {
                                    info = db
                                        .prepare(
                                            `INSERT INTO "${item.tableName}" (${colNames}) VALUES (${placeholders})`
                                        )
                                        .run(...values);
                                } catch {
                                    failedCount++;
                                    continue;
                                }
                                db.prepare(
                                    'INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)'
                                ).run(item.rowSyncId, item.tableName, info.lastInsertRowid);
                            }
                        }
                        appliedCount++;

                        // Update ancestor to the applied version + snapshot checksum
                        try {
                            db.prepare(
                                'UPDATE sync_id_map SET ancestor_data = ?, version = ? WHERE row_sync_id = ?'
                            ).run(JSON.stringify(item.data), item.version, item.rowSyncId);
                            const checksum = computeRowChecksum(item.data, SENSITIVE_FIELDS);
                            db.prepare(
                                `
                                INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
                                VALUES(?, ?, ?, CURRENT_TIMESTAMP)
                                ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP
                            `
                            ).run(item.rowSyncId, item.tableName, checksum, checksum);
                        } catch {
                            /* non-critical */
                        }
                    } else if (item.operation === 'DEL') {
                        if (mapping) {
                            try {
                                db.prepare(`DELETE FROM "${item.tableName}" WHERE id = ?`).run(mapping.local_id);
                            } catch {
                                failedCount++;
                                continue;
                            }
                            appliedCount++;
                        } else {
                            appliedCount++;
                        }
                    }
                } catch {
                    failedCount++;
                }
            }
        });

        applyChanges();

        // Step 7: Advance cursor to highest GSI1SK seen
        const newCursor = allItems[allItems.length - 1].GSI1SK || cursor;

        // Step 8: Update sync_config
        db.prepare(
            'UPDATE sync_config SET pull_cursor = ?, last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
        ).run(newCursor);

        // Step 9: Update sync_pull_state per affected table
        const affectedTables = [...new Set(sorted.map((i) => i.tableName))];
        const upsertPullState = db.prepare(`
            INSERT INTO sync_pull_state(table_name, last_pulled_at, updated_at)
            VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = CURRENT_TIMESTAMP, last_pull_error = NULL, updated_at = CURRENT_TIMESTAMP
        `);
        for (const table of affectedTables) {
            upsertPullState.run(table);
        }

        updateDeviceHeartbeat(db);

        return {
            success: failedCount === 0,
            appliedCount,
            skippedCount: skippedCount + (mapped.length - sorted.length),
            conflictCount,
            failedCount,
            totalFetched: allItems.length,
            newCursor,
            lastError: null
        };
    } catch (err) {
        try {
            const db = getDb();
            db.prepare('UPDATE sync_config SET last_pull_error = ?, last_pull_at = CURRENT_TIMESTAMP WHERE id = 1').run(
                err.message
            );
        } catch {
            /* ignore */
        }

        if (err.name === 'AccessDeniedException' || err.Code === 'AccessDeniedException') {
            clearCredentials();
        }

        return {
            success: false,
            appliedCount: 0,
            skippedCount: 0,
            conflictCount: 0,
            failedCount: 0,
            totalFetched: 0,
            newCursor: null,
            lastError: err.message
        };
    } finally {
        _pullRunning = false;
    }
}

function isPushTimerRunning() {
    return _syncTimer !== null;
}

function isPullTimerRunning() {
    return _pullTimer !== null;
}

function isPullCycleRunning() {
    return _pullRunning;
}

function startSyncPullBackground() {
    if (_pullTimer) return;

    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !config.enabled || !config.auth_lambda_url) return;

        const intervalMs = Math.max(1, Math.min(30, config.sync_interval_minutes || 10)) * 60 * 1000;

        void pullRemoteChanges();

        _pullTimer = setInterval(() => {
            void pullRemoteChanges();
        }, intervalMs);

        if (typeof _pullTimer.unref === 'function') {
            _pullTimer.unref();
        }

        console.log(
            `[sync:pull] Background pull started (interval: ${Math.max(1, Math.min(30, config.sync_interval_minutes || 10))}min)`
        );
    } catch (err) {
        console.warn('[sync:pull] Failed to start pull background:', err.message);
    }
}

function stopSyncPullBackground() {
    if (_pullTimer) {
        clearInterval(_pullTimer);
        _pullTimer = null;
        console.log('[sync:pull] Background pull stopped');
    }
}

function restartSyncPullBackground() {
    stopSyncPullBackground();
    startSyncPullBackground();
}

module.exports = {
    flushSyncOutbox,
    startSyncPushBackground,
    stopSyncPushBackground,
    restartSyncPushBackground,
    pullRemoteChanges,
    startSyncPullBackground,
    stopSyncPullBackground,
    restartSyncPullBackground,
    isPushTimerRunning,
    isPullTimerRunning,
    isPullCycleRunning
};

const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, BatchWriteCommand, PutCommand } = require('@aws-sdk/lib-dynamodb');
const { getDb } = require('../db/context');
const { getCredentials, clearCredentials } = require('./credentials');
const { getDeviceHash, stripSensitiveFields, ensureSyncIdMapping, CHANNEL_REGISTRY } = require('./capture');
const { canPush, buildSortKey, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');

const SYNC_TABLE_NAME = 'pencil2-sync';

let _syncTimer = null;
let _flushRunning = false;
let _dynamoClient = null;
let _lastAccessKeyId = null;

function readSyncConfig(db) {
    return db.prepare('SELECT * FROM sync_config WHERE id = 1').get() || {};
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

function buildDynamoItem(entry, schoolId, deviceHash) {
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
        version: 1,
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

function markEntrySent(db, entryId) {
    db.prepare(
        "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
    ).run(entryId);
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

    if (preparedItems.some((prepared) => prepared.item.version > 1)) {
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

            if (result.isAccessDenied) {
                return { sentCount, failedCount, lastError, abort: true };
            }
        }

        return { sentCount, failedCount, lastError, abort: false };
    }

    const result = await writeBatchToDynamo(
        docClient,
        preparedItems.map((prepared) => prepared.item)
    );

    const failedItemKeys = new Set(
        (result.failedItems || []).map((request) => buildItemKey(request.PutRequest?.Item || {}))
    );

    let sentCount = 0;
    let failedCount = 0;
    let lastError = result.error || null;

    for (const prepared of preparedItems) {
        if (failedItemKeys.has(buildItemKey(prepared.item))) {
            markEntryFailed(
                db,
                prepared.entryId,
                result.error || 'Batch write failed',
                maxRetries,
                result.isThrottle || result.isAccessDenied
            );
            failedCount += 1;
            continue;
        }

        markEntrySent(db, prepared.entryId);
        sentCount += 1;
    }

    return {
        sentCount,
        failedCount,
        lastError,
        abort: !!result.isAccessDenied
    };
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

            const dynamoItem = buildDynamoItem(expanded, schoolId, deviceHash);
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
        const pendingRows = db
            .prepare("SELECT * FROM sync_outbox WHERE status = 'pending' ORDER BY id ASC LIMIT ?")
            .all(effectiveLimit);

        if (!pendingRows.length) {
            return {
                success: true,
                sentCount: 0,
                failedCount: 0,
                skippedCount: 0,
                pendingCount: 0,
                lastError: null
            };
        }

        let sentCount = 0;
        let failedCount = 0;
        let skippedCount = 0;
        let lastError = null;
        let batchBuffer = [];

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

            const dynamoItem = buildDynamoItem(row, schoolId, deviceHash);
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

        updatePushMeta(db, sentCount > 0 ? new Date().toISOString() : null, lastError);

        const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;
        if (sentCount > 0) {
            console.log(
                `[sync:push] Pushed ${sentCount} entries, ${failedCount} failed, ${skippedCount} skipped, ${pendingCount} pending`
            );
        }

        return { success: failedCount === 0, sentCount, failedCount, skippedCount, pendingCount, lastError };
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

module.exports = {
    flushSyncOutbox,
    startSyncPushBackground,
    stopSyncPushBackground,
    restartSyncPushBackground
};

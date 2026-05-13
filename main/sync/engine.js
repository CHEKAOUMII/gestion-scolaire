'use strict';

const {
    collection,
    doc,
    limit: firestoreLimit,
    onSnapshot,
    orderBy,
    query,
    runTransaction
} = require('firebase/firestore');
const { getFirestoreDb } = require('../firebase/config');
const { getCollectionPath, buildDocumentId, COLLECTION_MAP } = require('../firebase/collections');
const { logChangeBatch, pullChanges, bootstrapFromCollections } = require('../firebase/sync-log');
const { getDb } = require('../db/context');
const { getCredentials, clearCredentials } = require('./credentials');
const { getDeviceHash, getDeviceName, stripSensitiveFields, ensureSyncIdMapping, CHANNEL_REGISTRY } = require('./capture');
const { canPush, getEntityType, ENTITY_TYPE_REGISTRY } = require('./authority');
const { threeWayMerge, computeRowChecksum } = require('./merge');
const { SENSITIVE_FIELDS } = require('./capture');

let _syncTimer = null;
let _flushRunning = false;
let _pullTimer = null;
let _pullRunning = false;
let _pullListenerUnsubscribe = null;
let _pullDebounceTimer = null;
let _backlogPushTimer = null;

const REMOTE_PULL_DEBOUNCE_MS = 4000;
const BACKLOG_PUSH_DELAY_MS = 2500;

// Cache of valid column names per table (populated from PRAGMA table_info)
const _schemaColumnsCache = new Map();

function isPullDebugEnabled() {
    return String(process.env.SYNC_PULL_DEBUG || '').trim() === '1';
}

function pullDebug(...args) {
    if (isPullDebugEnabled()) {
        console.log('[sync:pull:debug]', ...args);
    }
}

function summarizePullItem(item) {
    return {
        changeId: item.changeId || item.id || null,
        tableName: item.tableName || null,
        entityType: item.entityType || null,
        operation: item.operation || null,
        rowSyncId: item.rowSyncId || null,
        updatedAt: item.updatedAt || null,
        version: item.version || null
    };
}

function getValidColumns(db, tableName) {
    if (_schemaColumnsCache.has(tableName)) return _schemaColumnsCache.get(tableName);
    const cols = db.prepare(`PRAGMA table_info("${tableName}")`).all().map((c) => c.name);
    const colSet = new Set(cols);
    _schemaColumnsCache.set(tableName, colSet);
    return colSet;
}

function filterToValidColumns(db, tableName, columns) {
    const valid = getValidColumns(db, tableName);
    return columns.filter((c) => valid.has(c));
}

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
    'tests',
    'system_tags'
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
        if (!deviceHash) return;

        const table = db
            .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'linked_devices'")
            .get();
        if (!table) return;

        const existing = db.prepare('SELECT id FROM linked_devices WHERE device_hash = ? LIMIT 1').get(deviceHash);
        if (existing) {
            db.prepare(
                `
                UPDATE linked_devices
                SET last_seen_at = CURRENT_TIMESTAMP,
                    status = COALESCE(NULLIF(status, ''), 'active')
                WHERE device_hash = ?
            `
            ).run(deviceHash);
            return;
        }

        db.prepare(
            `
            INSERT INTO linked_devices(device_hash, device_name, os_platform, linked_at, last_seen_at, status)
            VALUES(?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP, 'active')
        `
        ).run(deviceHash, getDeviceName(), process.platform);
    } catch (err) {
        console.warn('[sync] Failed to update device heartbeat:', err.message);
    }
}

function parseLocalIdFromRowSyncId(rowSyncId, tableName) {
    const prefix = `:${tableName}:`;
    const index = String(rowSyncId || '').indexOf(prefix);
    if (index === -1) return null;
    return String(rowSyncId).slice(index + prefix.length);
}

function parsePullCursor(value) {
    if (value == null || value === '') {
        return { updatedAt: 0, changeId: '' };
    }

    if (typeof value === 'number') {
        return { updatedAt: Number.isFinite(value) ? Math.max(0, Math.floor(value)) : 0, changeId: '' };
    }

    const normalized = String(value).trim();
    if (!normalized) {
        return { updatedAt: 0, changeId: '' };
    }

    if (/^\d+$/.test(normalized)) {
        return { updatedAt: Number(normalized) || 0, changeId: '' };
    }

    try {
        const parsed = JSON.parse(normalized);
        return {
            updatedAt: Number(parsed?.updatedAt) || 0,
            changeId: String(parsed?.changeId || '').trim()
        };
    } catch {
        return { updatedAt: Number(normalized) || 0, changeId: '' };
    }
}

function serializePullCursor(cursor) {
    return JSON.stringify({
        updatedAt: Number(cursor?.updatedAt) || 0,
        changeId: String(cursor?.changeId || '').trim()
    });
}

function resolveStudentCode(db, studentId, schoolYear) {
    if (studentId == null || String(studentId).trim() === '') {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT code FROM students WHERE id = ? AND school_year = ?').get(studentId, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT code FROM students WHERE id = ?').get(studentId);
    }

    const code = String(row?.code || '').trim();
    return code || null;
}

function resolveStudentId(db, studentCode, schoolYear) {
    const normalizedCode = String(studentCode || '').trim();
    if (!normalizedCode) {
        return null;
    }

    let row = null;
    if (schoolYear) {
        row = db.prepare('SELECT id FROM students WHERE code = ? AND school_year = ?').get(normalizedCode, schoolYear);
    }
    if (!row) {
        row = db.prepare('SELECT id FROM students WHERE code = ? ORDER BY id ASC LIMIT 1').get(normalizedCode);
    }

    return row?.id ?? null;
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

function buildFirestoreDoc(db, entry, schoolId, deviceHash) {
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

    const normalizedData = normalizeSortKeyRowData(entry, rowData);

    if (entry.table_name === 'student_files') {
        if (normalizedData.doc_key == null && normalizedData.file_id != null) {
            normalizedData.doc_key = normalizedData.file_id;
        }

        if (normalizedData.student_code == null) {
            normalizedData.student_code = resolveStudentCode(db, normalizedData.student_id, normalizedData.school_year);
        }

        if (!normalizedData.student_code) {
            console.warn(`[sync:push] Failed to resolve student_code for student_files entry ${entry.id || entry.row_sync_id}`);
            return null;
        }

        delete normalizedData.student_id;
        delete normalizedData.file_id;
        delete normalizedData.id;
    }

    const documentId = buildDocumentId(entry.table_name, normalizedData);
    if (!documentId) {
        console.warn(`[sync:push] Failed to build document ID for table '${entry.table_name}'`);
        return null;
    }

    const mapping = db.prepare('SELECT version FROM sync_id_map WHERE row_sync_id = ?').get(entry.row_sync_id);
    const currentVersion = Number(mapping?.version || 0);
    const newVersion = currentVersion + 1;
    const updatedAt = Math.floor(Date.now() / 1000);

    return {
        collectionPath: getCollectionPath(schoolId, entry.table_name),
        documentId,
        entityType,
        entityId: documentId,
        data: normalizedData,
        version: newVersion,
        operation: entry.operation,
        rowSyncId: entry.row_sync_id,
        deviceHash: String(deviceHash || '').substring(0, 16),
        schoolYear: entry.school_year || '',
        updatedAt
    };
}

function buildFirestorePayload(item) {
    return {
        ...item.data,
        version: item.version,
        operation: item.operation,
        rowSyncId: item.rowSyncId,
        deviceHash: item.deviceHash,
        schoolYear: item.schoolYear,
        updatedAt: item.updatedAt
    };
}

const REMOTE_SYNC_METADATA_FIELDS = ['version', 'operation', 'rowSyncId', 'deviceHash', 'schoolYear', 'updatedAt', 'ttl'];

function stripRemoteSyncMetadata(data) {
    const clean = { ...(data || {}) };
    for (const field of REMOTE_SYNC_METADATA_FIELDS) {
        delete clean[field];
    }
    return clean;
}

function isEquivalentRemoteData(localData, remoteData) {
    const localChecksum = computeRowChecksum(localData || {}, SENSITIVE_FIELDS);
    const remoteChecksum = computeRowChecksum(stripRemoteSyncMetadata(remoteData), SENSITIVE_FIELDS);
    return localChecksum === remoteChecksum;
}

async function writeItemWithVersionCheck(firestoreDb, item) {
    try {
        const docRef = doc(firestoreDb, item.collectionPath, item.documentId);
        const transactionResult = await runTransaction(firestoreDb, async (transaction) => {
            const existing = await transaction.get(docRef);
            if (existing.exists() && Number(existing.data().version || 0) >= item.version) {
                return { conflict: true, remoteData: existing.data() || {} };
            }

            transaction.set(docRef, buildFirestorePayload(item), { merge: true });
            return { conflict: false };
        });

        if (transactionResult?.conflict) {
            const remoteData = transactionResult.remoteData || {};
            return {
                success: false,
                conflict: true,
                equivalent: isEquivalentRemoteData(item.data, remoteData),
                error: 'Version conflict',
                errorName: 'VERSION_CONFLICT',
                remoteData,
                remoteVersion: Number(remoteData.version || 0),
                remoteDeviceHash: remoteData.deviceHash || ''
            };
        }

        return { success: true };
    } catch (err) {
        const isAccessDenied = err.code === 'permission-denied';
        return { success: false, error: err.message, errorName: err.code, isAccessDenied, isThrottle: false };
    }
}

function markEntrySent(db, entryId, versionOverride = null, rowSyncId = null, rowData = null) {
    // Read row_sync_id and row_data BEFORE marking sent to avoid TOCTOU with cleanup
    if (!rowSyncId || rowData === null) {
        const entry = db.prepare('SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?').get(entryId);
        if (entry) {
            rowSyncId = rowSyncId || entry.row_sync_id;
            rowData = rowData !== null ? rowData : entry.row_data;
        }
    }

    db.prepare(
        "UPDATE sync_outbox SET status = 'sent', sent_at = CURRENT_TIMESTAMP, last_error = NULL WHERE id = ?"
    ).run(entryId);

    if (rowSyncId) {
        if (versionOverride != null && Number.isFinite(Number(versionOverride))) {
            db.prepare('UPDATE sync_id_map SET version = ?, ancestor_data = ? WHERE row_sync_id = ?').run(
                Number(versionOverride),
                rowData,
                rowSyncId
            );
        } else {
            db.prepare('UPDATE sync_id_map SET version = version + 1, ancestor_data = ? WHERE row_sync_id = ?').run(
                rowData,
                rowSyncId
            );
        }
        db.prepare(
            `
            UPDATE sync_conflicts
            SET status = 'resolved',
                resolution = 'merged',
                resolved_data = COALESCE(resolved_data, local_data),
                resolved_at = CURRENT_TIMESTAMP
            WHERE local_outbox_id = ?
              AND status = 'unresolved'
        `
        ).run(entryId);
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

function reopenVersionConflictOutbox(db) {
    try {
        db.prepare(
            `
            UPDATE sync_outbox
            SET status = 'pending',
                last_error = NULL
            WHERE status = 'failed'
              AND last_error = 'Version conflict'
              AND id IN (
                  SELECT local_outbox_id
                  FROM sync_conflicts
                  WHERE status = 'unresolved'
                    AND local_outbox_id IS NOT NULL
              )
        `
        ).run();
    } catch (err) {
        console.warn('[sync:push] Failed to reopen version-conflict outbox rows:', err.message);
    }
}

function updatePushMeta(db, lastPushAt, lastPushError) {
    db.prepare(
        'UPDATE sync_config SET last_push_at = ?, last_push_error = ?, updated_at = CURRENT_TIMESTAMP WHERE id = 1'
    ).run(lastPushAt, lastPushError);
}

function compactPendingOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'superseded',
                    last_error = NULL
                WHERE status = 'pending'
                  AND id NOT IN (
                      SELECT MAX(id)
                      FROM sync_outbox
                      WHERE status = 'pending'
                      GROUP BY row_sync_id
                  )
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Compacted ${result.changes} superseded pending outbox entries`);
        }
        return result.changes || 0;
    } catch (err) {
        console.warn('[sync:push] Pending outbox compaction failed:', err.message);
        return 0;
    }
}

function reopenRecoverableOutbox(db) {
    try {
        const result = db
            .prepare(
                `
                UPDATE sync_outbox
                SET status = 'pending',
                    retries = 0,
                    last_error = NULL
                WHERE (
                    status = 'failed'
                    OR retries >= COALESCE((SELECT max_retries FROM sync_config WHERE id = 1), 10)
                )
                  AND last_error LIKE 'Invalid document reference.%'
            `
            )
            .run();
        if (result.changes > 0) {
            console.log(`[sync:push] Reopened ${result.changes} recoverable document-path failures`);
        }
    } catch (err) {
        console.warn('[sync:push] Failed to reopen recoverable outbox rows:', err.message);
    }
}

function scheduleBacklogPush() {
    if (_backlogPushTimer || _flushRunning) {
        return;
    }

    _backlogPushTimer = setTimeout(() => {
        _backlogPushTimer = null;
        void flushSyncOutbox().catch((err) => {
            console.warn('[sync:push] Backlog push failed:', err.message);
        });
    }, BACKLOG_PUSH_DELAY_MS);

    if (typeof _backlogPushTimer.unref === 'function') {
        _backlogPushTimer.unref();
    }
}

function getCurrentRole() {
    try {
        const { resolveRole } = require('../auth/permissions');
        const { getActiveSessions } = require('../ipc/auth');
        const sessions = getActiveSessions();
        const priority = ['admin', 'principal', 'supervisor', 'external-guardian', 'internal-guardian', 'admin-assistant', 'educational-specialist', 'social-specialist', 'teacher', 'viewer', 'staff'];

        if (sessions && sessions.size > 0) {
            for (const role of priority) {
                for (const session of sessions.values()) {
                    const resolved = resolveRole(String(session.role || '').trim());
                    if (resolved === resolveRole(role)) return resolved;
                }
            }
        }

        const db = getDb();
        const config = readSyncConfig(db);
        const email = String(config.firebase_email || '').trim().toLowerCase();
        if (!email) return null;

        const user = db
            .prepare(
                `
                SELECT role
                FROM users
                WHERE lower(email) = ?
                  AND COALESCE(disabled, 0) = 0
                LIMIT 1
            `
            )
            .get(email);
        const role = resolveRole(String(user?.role || '').trim());
        return priority.map((item) => resolveRole(item)).includes(role) ? role : null;
    } catch (err) {
        console.warn('[sync:push] getCurrentRole failed:', err.message);
        return null;
    }
}

function logVersionConflict(db, prepared, result) {
    try {
        const ancestorMapping = db
            .prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')
            .get(prepared.item.rowSyncId);
        const conflictTableName =
            Object.keys(ENTITY_TYPE_REGISTRY).find(
                (k) => ENTITY_TYPE_REGISTRY[k].entityType === prepared.item.entityType
            ) || '';
        const remoteData = stripRemoteSyncMetadata(result.remoteData || {});
        const existing = db
            .prepare(
                `
                SELECT id
                FROM sync_conflicts
                WHERE local_outbox_id = ?
                  AND status = 'unresolved'
                LIMIT 1
            `
            )
            .get(prepared.entryId);

        if (existing) {
            db.prepare(
                `
                UPDATE sync_conflicts
                SET remote_data = ?,
                    remote_version = ?,
                    remote_device_hash = ?,
                    ancestor_data = COALESCE(ancestor_data, ?)
                WHERE id = ?
            `
            ).run(
                JSON.stringify(remoteData),
                result.remoteVersion || prepared.item.version,
                result.remoteDeviceHash || '',
                ancestorMapping?.ancestor_data || null,
                existing.id
            );
            return;
        }

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
            JSON.stringify(remoteData),
            result.remoteVersion || prepared.item.version,
            result.remoteDeviceHash || '',
            prepared.entryId,
            ancestorMapping?.ancestor_data || null
        );
    } catch (conflictErr) {
        console.warn(`[sync:push] Failed to log conflict for entry ${prepared.entryId}:`, conflictErr.message);
    }
}

async function writeSyncLogWithRetry(firestoreDb, schoolId, batch, maxAttempts = 3) {
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            await logChangeBatch(firestoreDb, schoolId, batch);
            return true;
        } catch (err) {
            console.warn(`[sync:push] syncLog batch attempt ${attempt}/${maxAttempts} failed:`, err.message);
            if (attempt < maxAttempts) {
                await new Promise((r) => setTimeout(r, 1000 * attempt));
            }
        }
    }
    console.error(`[sync:push] syncLog batch PERMANENTLY failed for ${batch.length} items — other devices may not receive these changes`);
    return false;
}

async function flushPreparedItems(db, firestoreDb, preparedItems, maxRetries, schoolId) {
    if (!preparedItems.length) {
        return { sentCount: 0, failedCount: 0, lastError: null, abort: false, syncLogWritten: true };
    }

    // Always use conditional writes for version-guarded pushes
    {
        let sentCount = 0;
        let failedCount = 0;
        let lastError = null;
        const successfulItems = [];

        for (const prepared of preparedItems) {
            const result = await writeItemWithVersionCheck(firestoreDb, prepared.item);
            if (result.success) {
                markEntrySent(db, prepared.entryId);
                sentCount += 1;
                successfulItems.push(prepared.item);
                continue;
            }

            if (result.conflict && result.equivalent) {
                markEntrySent(db, prepared.entryId, result.remoteVersion || prepared.item.version);
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
                logVersionConflict(db, prepared, result);
            }

            if (result.isAccessDenied) {
                return { sentCount, failedCount, lastError, abort: true };
            }
        }

        // Batch-log successfully sent items to syncLog (with retry)
        let syncLogWritten = true;
        if (successfulItems.length > 0 && schoolId) {
            syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, successfulItems);
        }

        return { sentCount, failedCount, lastError, abort: false, syncLogWritten };
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

async function flushExpandedEntries(db, firestoreDb, entryId, expandedEntries, schoolId, deviceHash, maxRetries, role) {
    let sentCount = 0;
    let failedCount = 0;
    let skippedCount = 0;
    let lastError = null;
    let abort = false;
    const successfulItems = [];

    for (let index = 0; index < expandedEntries.length; index += 25) {
        const chunk = expandedEntries.slice(index, index + 25);
        const items = [];

        for (const expanded of chunk) {
            if (!canPush(expanded.table_name, role)) {
                skippedCount += 1;
                continue;
            }

            const firestoreDoc = buildFirestoreDoc(db, expanded, schoolId, deviceHash);
            if (!firestoreDoc) {
                failedCount += 1;
                lastError = 'Failed to build Firestore document — unknown entity type';
                continue;
            }
            items.push(firestoreDoc);
        }

        if (!items.length) {
            continue;
        }

        for (const item of items) {
            const result = await writeItemWithVersionCheck(firestoreDb, item);
            if (result.conflict && result.equivalent) {
                sentCount += 1;
                continue;
            }
            if (!result.success) {
                failedCount += 1;
                lastError = result.error || 'Conditional write failed';
                if (result.isAccessDenied) {
                    abort = true;
                    break;
                }
                continue;
            }

            sentCount += 1;
            successfulItems.push(item);
        }

        if (abort) {
            break;
        }
    }

    let syncLogWritten = true;
    if (successfulItems.length > 0 && schoolId) {
        syncLogWritten = await writeSyncLogWithRetry(firestoreDb, schoolId, successfulItems);
    }

    if (failedCount === 0 && syncLogWritten) {
        markEntrySent(db, entryId);
    } else {
        markEntryFailed(db, entryId, lastError || 'Batch write failed', maxRetries, abort);
    }

    return { sentCount, failedCount, skippedCount, lastError, abort, syncLogWritten };
}

function readPendingOutboxBatch(db, maxRetries, limit) {
    return db
        .prepare(
            `SELECT *
             FROM sync_outbox
             WHERE status = 'pending'
               AND retries < ?
             ORDER BY id ASC
             LIMIT ?`
        )
        .all(maxRetries, limit);
}

function bumpRetryCount(db, entryId) {
    db.prepare(
        'UPDATE sync_outbox SET retries = retries + 1, last_attempt_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).run(entryId);
}

async function processOutboxRow(db, firestoreDb, row, ctx) {
    const { role, schoolId, deviceHash, maxRetries } = ctx;

    if (!canPush(row.table_name, role)) {
        ctx.skippedCount += 1;
        console.log(`[sync:push] Skipped entry ${row.id} — role '${role}' cannot push to '${row.table_name}'`);
        markEntryFailed(db, row.id, `Role '${role}' cannot push to '${row.table_name}'`, maxRetries, false, true);
        return 'continue';
    }

    let rowData = {};
    try {
        rowData = row.row_data ? JSON.parse(row.row_data) : {};
    } catch (err) {
        bumpRetryCount(db, row.id);
        markEntryFailed(db, row.id, `Invalid row_data JSON: ${err.message}`, maxRetries);
        ctx.failedCount += 1;
        ctx.lastError = err.message;
        return 'continue';
    }

    if (rowData._bulk) {
        const aborted = await ctx.flushBuffer();
        if (aborted) return 'break';

        bumpRetryCount(db, row.id);
        const expandedEntries = expandBulkEntry(db, row, deviceHash);
        if (expandedEntries.length === 0) {
            markEntrySent(db, row.id);
            return 'continue';
        }

        const result = await flushExpandedEntries(db, firestoreDb, row.id, expandedEntries, schoolId, deviceHash, maxRetries, role);
        ctx.sentCount += result.sentCount;
        ctx.failedCount += result.failedCount;
        ctx.skippedCount += result.skippedCount;
        if (!result.syncLogWritten) ctx.syncLogOk = false;
        ctx.lastError = result.lastError || ctx.lastError;
        return result.abort ? 'break' : 'continue';
    }

    bumpRetryCount(db, row.id);
    const firestoreDoc = buildFirestoreDoc(db, row, schoolId, deviceHash);
    if (!firestoreDoc) {
        markEntryFailed(db, row.id, 'Failed to build Firestore document — unknown entity type', maxRetries);
        ctx.failedCount += 1;
        ctx.lastError = 'Failed to build Firestore document — unknown entity type';
        return 'continue';
    }

    ctx.batchBuffer.push({ entryId: row.id, item: firestoreDoc });
    if (ctx.batchBuffer.length >= 25) {
        const aborted = await ctx.flushBuffer();
        if (aborted) return 'break';
    }
    return 'continue';
}

async function flushSyncOutbox(limit) {
    if (_flushRunning) return { success: true, skipped: true, reason: 'already_running' };
    _flushRunning = true;
    console.log('[sync:push] Push cycle starting...');

    try {
        const db = getDb();
        const config = readSyncConfig(db);
        if (!Number(config.enabled)) {
            console.log('[sync:push] Skipped: sync not enabled');
            return { success: true, skipped: true, reason: 'not_configured' };
        }
        reopenVersionConflictOutbox(db);
        reopenRecoverableOutbox(db);
        const compactedCount = compactPendingOutbox(db);

        const role = getCurrentRole();
        if (!role) {
            console.log('[sync:push] Skipped: no active session');
            return { success: true, skipped: true, reason: 'no_active_session' };
        }

        const credentials = await getCredentials();
        if (!credentials) {
            console.warn('[sync:push] Failed to obtain credentials');
            updatePushMeta(db, null, 'Failed to obtain credentials');
            return { success: false, error: 'credentials_unavailable' };
        }

        const maxRetries = Number(config.max_retries) || 10;
        const effectiveLimit = Number(limit) || Number(config.push_batch_size) || 100;
        const deviceHash = getDeviceHash();
        const schoolId = credentials.schoolId || config.school_id;

        if (!schoolId) {
            updatePushMeta(db, null, 'Missing school identifier');
            return { success: false, error: 'school_id_unavailable' };
        }

        const firestoreDb = getFirestoreDb();
        const pendingRows = readPendingOutboxBatch(db, maxRetries, effectiveLimit);

        const ctx = {
            role, schoolId, deviceHash, maxRetries,
            sentCount: 0, failedCount: 0, skippedCount: 0,
            lastError: null, syncLogOk: true, batchBuffer: [],
            flushBuffer: null
        };
        ctx.flushBuffer = async () => {
            if (!ctx.batchBuffer.length) return false;
            const result = await flushPreparedItems(db, firestoreDb, ctx.batchBuffer, maxRetries, schoolId);
            ctx.sentCount += result.sentCount;
            ctx.failedCount += result.failedCount;
            if (!result.syncLogWritten) ctx.syncLogOk = false;
            ctx.lastError = result.lastError || ctx.lastError;
            ctx.batchBuffer = [];
            return result.abort;
        };

        for (const row of pendingRows) {
            const action = await processOutboxRow(db, firestoreDb, row, ctx);
            if (action === 'break') break;
        }

        const aborted = await ctx.flushBuffer();
        if (aborted) ctx.lastError = ctx.lastError || 'Access denied';
        if (!ctx.syncLogOk) ctx.lastError = ctx.lastError || 'syncLog write failed — other devices may not receive changes';

        updatePushMeta(db, ctx.sentCount > 0 ? new Date().toISOString() : null, ctx.lastError);

        const pendingCount = db.prepare("SELECT COUNT(*) AS c FROM sync_outbox WHERE status = 'pending'").get().c || 0;
        if (ctx.sentCount > 0) {
            console.log(
                `[sync:push] Pushed ${ctx.sentCount} entries, ${ctx.failedCount} failed, ${ctx.skippedCount} skipped, ${pendingCount} pending${ctx.syncLogOk ? '' : ' (syncLog FAILED)'}`
            );
        }
        if (pendingCount > 0 && ctx.sentCount > 0 && ctx.failedCount === 0) {
            scheduleBacklogPush();
        }

        return {
            success: ctx.failedCount === 0 && ctx.syncLogOk,
            sentCount: ctx.sentCount,
            failedCount: ctx.failedCount,
            skippedCount: ctx.skippedCount,
            pendingCount,
            compactedCount,
            lastError: ctx.lastError
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

        if (!Number(config.enabled) || !config.firebase_functions_url || !config.school_id) {
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
    if (_backlogPushTimer) {
        clearTimeout(_backlogPushTimer);
        _backlogPushTimer = null;
    }
}

function restartSyncPushBackground() {
    stopSyncPushBackground();
    startSyncPushBackground();
}

function scheduleDebouncedPull() {
    if (_pullDebounceTimer) {
        clearTimeout(_pullDebounceTimer);
    }

    _pullDebounceTimer = setTimeout(() => {
        _pullDebounceTimer = null;
        void pullRemoteChanges().catch((err) => {
            console.warn('[sync:pull] Debounced pull failed:', err.message);
        });
    }, REMOTE_PULL_DEBOUNCE_MS);

    if (typeof _pullDebounceTimer.unref === 'function') {
        _pullDebounceTimer.unref();
    }
}

function stopRemoteChangeListener() {
    if (_pullListenerUnsubscribe) {
        try {
            _pullListenerUnsubscribe();
        } catch (err) {
            console.warn('[sync:pull] Failed to stop remote change listener:', err.message);
        }
        _pullListenerUnsubscribe = null;
    }

    if (_pullDebounceTimer) {
        clearTimeout(_pullDebounceTimer);
        _pullDebounceTimer = null;
    }
}

function startRemoteChangeListener(schoolId) {
    stopRemoteChangeListener();

    if (!schoolId) {
        return;
    }

    try {
        const firestoreDb = getFirestoreDb();
        if (!firestoreDb) {
            return;
        }

        const changesRef = collection(firestoreDb, 'syncLog', schoolId, 'changes');
        const q = query(changesRef, orderBy('updatedAt', 'desc'), firestoreLimit(1));
        let initialized = false;

        _pullListenerUnsubscribe = onSnapshot(
            q,
            (snapshot) => {
                if (!initialized) {
                    initialized = true;
                    return;
                }
                if (!snapshot.empty) {
                    scheduleDebouncedPull();
                }
            },
            (err) => {
                console.warn('[sync:pull] Remote change listener failed:', err.message);
            }
        );
    } catch (err) {
        console.warn('[sync:pull] Failed to start remote change listener:', err.message);
    }
}

function buildPullResult(overrides = {}) {
    return {
        success: true,
        appliedCount: 0,
        skippedCount: 0,
        conflictCount: 0,
        failedCount: 0,
        totalFetched: 0,
        newCursor: null,
        lastError: null,
        ...overrides
    };
}

function mapRemoteItems(remoteItems) {
    const mapped = [];
    const unknownEntityTypes = [];
    for (const item of remoteItems) {
        const tableName = Object.keys(ENTITY_TYPE_REGISTRY).find(
            (k) => ENTITY_TYPE_REGISTRY[k].entityType === item.entityType
        );
        if (!tableName) {
            unknownEntityTypes.push(item.entityType || '(missing)');
            continue;
        }
        mapped.push({
            tableName,
            operation: item.operation,
            rowSyncId: item.rowSyncId,
            data: item.data || {},
            version: item.version,
            updatedAt: item.updatedAt || 0,
            deviceHash: item.deviceHash,
            entityType: item.entityType,
            schoolYear: item.schoolYear,
            changeId: item.id
        });
    }
    if (unknownEntityTypes.length > 0) {
        console.warn('[sync:pull] Skipped unknown entity types:', [...new Set(unknownEntityTypes)].join(', '));
    }
    return { mapped, unknownEntityTypes };
}

function handlePullConflict(db, item, pending) {
    const ancestorRow = db
        .prepare('SELECT ancestor_data FROM sync_id_map WHERE row_sync_id = ?')
        .get(item.rowSyncId);
    let ancestor = null;
    try {
        ancestor = ancestorRow?.ancestor_data ? JSON.parse(ancestorRow.ancestor_data) : null;
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse ancestor_data for ${item.rowSyncId}:`, parseErr.message);
    }

    let localData = {};
    try {
        localData = pending.rowData ? JSON.parse(pending.rowData) : {};
    } catch (parseErr) {
        console.warn(`[sync:pull] Failed to parse local outbox data for ${item.rowSyncId}:`, parseErr.message);
    }

    const localTs = Math.floor(Date.now() / 1000);
    const remoteTs = item.updatedAt || 0;
    const originalRemoteData = JSON.stringify(item.data);
    const mergeResult = threeWayMerge(ancestor, localData, item.data, localTs, remoteTs);

    item.data = mergeResult.merged;

    if (mergeResult.resolution === 'clean') {
        db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
        return false;
    }

    const resolutionMethod = mergeResult.resolution === 'lww' ? 'lww' : 'merged';
    db.prepare(
        `INSERT INTO sync_conflicts(table_name, row_sync_id, entity_type, local_data, remote_data,
            remote_version, remote_device_hash, local_outbox_id, ancestor_data,
            conflicting_fields, resolution_method, resolved_data, status, resolution, resolved_at)
         VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'resolved', ?, CURRENT_TIMESTAMP)`
    ).run(
        item.tableName, item.rowSyncId, item.entityType,
        pending.rowData, originalRemoteData, item.version, item.deviceHash,
        pending.outboxId, ancestorRow?.ancestor_data || null,
        JSON.stringify(mergeResult.conflicts), resolutionMethod,
        JSON.stringify(mergeResult.merged),
        mergeResult.conflicts.length > 0 ? 'remote' : 'merged'
    );
    db.prepare("UPDATE sync_outbox SET status = 'sent' WHERE id = ?").run(pending.outboxId);
    return true;
}

function applyPutOperation(db, item, mapping) {
    const columnKeys = Object.keys(item.data).filter((k) => k !== 'id');

    // Detect the primary key column for this table (defaults to 'id')
    var pkColumn = 'id';
    try {
        const tableInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
        const pkCol = tableInfo.find(col => col.pk === 1);
        if (pkCol) pkColumn = pkCol.name;
    } catch (e) { /* fallback to 'id' */ }

    if (mapping) {
        const columns = filterToValidColumns(db, item.tableName, columnKeys.filter(k => k !== pkColumn));
        if (columns.length > 0) {
            const setClause = columns.map((c) => `"${c}" = ?`).join(', ');
            const values = columns.map((c) => item.data[c]);
            values.push(mapping.local_id);
            try {
                db.prepare(`UPDATE "${item.tableName}" SET ${setClause} WHERE "${pkColumn}" = ?`).run(...values);
            } catch (updateErr) {
                console.warn(`[sync:pull] UPDATE failed for ${item.tableName} ${pkColumn}=${mapping.local_id}:`, updateErr.message);
                return false;
            }
        }
    } else {
        const columns = filterToValidColumns(db, item.tableName, columnKeys);
        if (columns.length > 0) {
            const colNames = columns.map((c) => `"${c}"`).join(', ');
            const placeholders = columns.map(() => '?').join(', ');
            const values = columns.map((c) => item.data[c]);
            let info;
            try {
                info = db
                    .prepare(`INSERT OR REPLACE INTO "${item.tableName}" (${colNames}) VALUES (${placeholders})`)
                    .run(...values);
            } catch (insertErr) {
                console.warn(`[sync:pull] INSERT failed for ${item.tableName} (${item.rowSyncId}):`, insertErr.message);
                return false;
            }
            db.prepare(
                'INSERT OR IGNORE INTO sync_id_map(row_sync_id, table_name, local_id) VALUES(?, ?, ?)'
            ).run(item.rowSyncId, item.tableName, info.lastInsertRowid);
        }
    }

    try {
        db.prepare(
            'UPDATE sync_id_map SET ancestor_data = ?, version = ? WHERE row_sync_id = ?'
        ).run(JSON.stringify(item.data), item.version, item.rowSyncId);
        const checksum = computeRowChecksum(item.data, SENSITIVE_FIELDS);
        db.prepare(
            `INSERT INTO sync_snapshots(row_sync_id, table_name, checksum, updated_at)
             VALUES(?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(row_sync_id) DO UPDATE SET checksum = ?, updated_at = CURRENT_TIMESTAMP`
        ).run(item.rowSyncId, item.tableName, checksum, checksum);
    } catch (snapshotErr) {
        console.warn(`[sync:pull] Ancestor/snapshot update failed for ${item.rowSyncId}:`, snapshotErr.message);
    }
    return true;
}

function applySingleItem(db, item, pendingMap, deferredStudentFiles, stats, isDeferred) {
    try {
        const pending = pendingMap.get(item.rowSyncId);
        if (pending) {
            if (handlePullConflict(db, item, pending)) {
                stats.conflictCount++;
            }
        }

        if (item.tableName === 'student_files' && item.operation === 'PUT') {
            const studentCode = String(item.data?.student_code || '').trim();
            const docKey = String(item.data?.doc_key || item.data?.file_id || '').trim();
            const schoolYear = String(item.data?.school_year || item.schoolYear || '').trim();
            const studentId = resolveStudentId(db, studentCode, schoolYear);

            if (studentId == null) {
                if (!isDeferred) {
                    deferredStudentFiles.push(item);
                    return;
                }
                console.error(
                    `[sync:pull] Failed to resolve student_id for student_files row '${item.rowSyncId || item.changeId || docKey}' (student_code='${studentCode}', school_year='${schoolYear || '-'}')`
                );
                stats.failedCount++;
                return;
            }

            item.data = { ...item.data, student_id: studentId, doc_key: docKey, school_year: schoolYear };
            delete item.data.student_code;
            delete item.data.file_id;
        }

        const mapping = db
            .prepare('SELECT local_id FROM sync_id_map WHERE row_sync_id = ?')
            .get(item.rowSyncId);

        if (item.operation === 'PUT') {
            if (applyPutOperation(db, item, mapping)) {
                stats.appliedCount++;
            } else {
                stats.failedCount++;
            }
        } else if (item.operation === 'DEL') {
            if (mapping) {
                try {
                    // Detect primary key column for this table
                    var delPkColumn = 'id';
                    try {
                        const tInfo = db.prepare(`PRAGMA table_info("${item.tableName}")`).all();
                        const pkC = tInfo.find(col => col.pk === 1);
                        if (pkC) delPkColumn = pkC.name;
                    } catch (e) { /* fallback to 'id' */ }
                    db.prepare(`DELETE FROM "${item.tableName}" WHERE "${delPkColumn}" = ?`).run(mapping.local_id);
                } catch (delErr) {
                    console.warn(`[sync:pull] DELETE failed for ${item.tableName} key=${mapping.local_id}:`, delErr.message);
                    stats.failedCount++;
                    return;
                }
            }
            stats.appliedCount++;
        }
    } catch (applyErr) {
        console.warn(`[sync:pull] Failed to apply item ${item.rowSyncId} (${item.operation} ${item.tableName}):`, applyErr.message);
        stats.failedCount++;
    }
}

async function pullRemoteChanges() {
    if (_pullRunning) return { success: false, skipped: true };
    _pullRunning = true;
    const startedAt = Date.now();
    console.log('[sync:pull] Pull cycle starting...');
    try {
        const db = getDb();
        const config = db.prepare('SELECT * FROM sync_config WHERE id = 1').get();
        if (!config || !config.enabled || !config.school_id) {
            console.log('[sync:pull] Skipped: sync disabled or school_id missing');
            return buildPullResult();
        }
        pullDebug('config loaded', {
            enabled: !!config.enabled,
            schoolId: config.school_id || null,
            pullCursor: config.pull_cursor || null,
            lastPullAt: config.last_pull_at || null,
            lastPullError: config.last_pull_error || null
        });

        pullDebug('getting credentials...');
        const credentials = await getCredentials();
        if (!credentials) {
            console.warn('[sync:pull] Skipped: no Firebase credentials available');
            return buildPullResult({ success: false, lastError: 'No credentials available' });
        }
        pullDebug('credentials ready', {
            schoolId: credentials.schoolId,
            userEmail: credentials.user?.email || null,
            expiresAt: credentials.expiresAt
        });

        const schoolId = config.school_id || credentials.schoolId;
        if (!schoolId) {
            console.warn('[sync:pull] Skipped: no school_id configured');
            return buildPullResult({ success: false, lastError: 'No school_id configured' });
        }

        const firestoreDb = getFirestoreDb();
        const cursor = parsePullCursor(config.pull_cursor);
        const currentDeviceHash = getDeviceHash();
        const localDeviceHash = currentDeviceHash.substring(0, 16);
        pullDebug('remote fetch starting', {
            schoolId,
            cursor: serializePullCursor(cursor),
            localDeviceHash
        });

        const localDataExists = db.prepare('SELECT COUNT(*) as c FROM students').get().c > 0;
        const needsBootstrap = !localDataExists;

        let allItems = await pullChanges(firestoreDb, schoolId, cursor);

        if (allItems.length === 0 && needsBootstrap) {
            console.log('[sync:pull] Bootstrapping from entity collections (syncLog empty, local DB empty)...');
            try {
                allItems = await bootstrapFromCollections(firestoreDb, schoolId, COLLECTION_MAP, ENTITY_TYPE_REGISTRY);
                console.log(`[sync:pull] Bootstrap fetched ${allItems.length} documents from entity collections (${Date.now() - startedAt}ms)`);
            } catch (bootstrapErr) {
                console.error('[sync:pull] Bootstrap from collections failed:', bootstrapErr.message);
            }
        }

        if (allItems.length === 0) {
            db.prepare(
                'UPDATE sync_config SET last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
            ).run();
            console.log(`[sync:pull] Completed: 0 fetched, 0 applied, 0 conflicts, 0 failed (${Date.now() - startedAt}ms)`);
            return buildPullResult({ newCursor: serializePullCursor(cursor) });
        }

        let remoteItems;
        if (needsBootstrap) {
            remoteItems = allItems;
        } else {
            remoteItems = allItems.filter((item) => item.deviceHash !== localDeviceHash);
        }
        const skippedCount = allItems.length - remoteItems.length;
        pullDebug('self-origin filter completed', {
            fetched: allItems.length,
            remoteItems: remoteItems.length,
            skippedSelfOriginated: skippedCount
        });

        const { mapped, unknownEntityTypes } = mapRemoteItems(remoteItems);
        pullDebug('mapping completed', {
            mapped: mapped.length,
            unknownEntityTypeCount: unknownEntityTypes.length,
            sample: mapped.slice(0, 5).map(summarizePullItem)
        });

        const sorted = sortByTopology(mapped);
        pullDebug('topological sort completed', {
            sorted: sorted.length,
            sample: sorted.slice(0, 5).map(summarizePullItem)
        });

        const pendingRows = db
            .prepare("SELECT row_sync_id, id, row_data FROM sync_outbox WHERE status = 'pending'")
            .all();
        const pendingMap = new Map();
        for (const row of pendingRows) {
            pendingMap.set(row.row_sync_id, { outboxId: row.id, rowData: row.row_data });
        }
        pullDebug('pending outbox loaded', { pendingRows: pendingRows.length });

        const stats = { appliedCount: 0, conflictCount: 0, failedCount: 0 };
        pullDebug('local apply transaction starting', { itemCount: sorted.length });

        const applyChanges = db.transaction(() => {
            const deferredStudentFiles = [];
            for (const item of sorted) {
                applySingleItem(db, item, pendingMap, deferredStudentFiles, stats, false);
            }
            for (const item of deferredStudentFiles) {
                applySingleItem(db, item, pendingMap, deferredStudentFiles, stats, true);
            }
        });

        applyChanges();
        pullDebug('local apply transaction completed', {
            appliedCount: stats.appliedCount,
            conflictCount: stats.conflictCount,
            failedCount: stats.failedCount,
            elapsedMs: Date.now() - startedAt
        });

        const lastItem = allItems[allItems.length - 1] || {};
        const newCursor = serializePullCursor({
            updatedAt: Number(lastItem.updatedAt) || cursor.updatedAt || 0,
            changeId: String(lastItem.id || '').trim()
        });

        db.prepare(
            'UPDATE sync_config SET pull_cursor = ?, last_pull_at = CURRENT_TIMESTAMP, last_pull_error = NULL WHERE id = 1'
        ).run(newCursor);
        pullDebug('sync_config updated', { newCursor });

        const affectedTables = [...new Set(sorted.map((i) => i.tableName))];
        const upsertPullState = db.prepare(`
            INSERT INTO sync_pull_state(table_name, last_pulled_at, updated_at)
            VALUES(?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
            ON CONFLICT(table_name) DO UPDATE SET last_pulled_at = CURRENT_TIMESTAMP, last_pull_error = NULL, updated_at = CURRENT_TIMESTAMP
        `);
        for (const table of affectedTables) {
            upsertPullState.run(table);
        }
        pullDebug('sync_pull_state updated', { affectedTables });

        updateDeviceHeartbeat(db);

        console.log(
            `[sync:pull] Completed: ${allItems.length} fetched, ${stats.appliedCount} applied, ${stats.conflictCount} conflicts, ${stats.failedCount} failed (${Date.now() - startedAt}ms)`
        );

        return buildPullResult({
            success: stats.failedCount === 0,
            appliedCount: stats.appliedCount,
            skippedCount: skippedCount + (mapped.length - sorted.length),
            conflictCount: stats.conflictCount,
            failedCount: stats.failedCount,
            totalFetched: allItems.length,
            newCursor
        });
    } catch (err) {
        console.error('[sync:pull] Pull cycle failed:', err.message);
        try {
            const db = getDb();
            db.prepare('UPDATE sync_config SET last_pull_error = ?, last_pull_at = CURRENT_TIMESTAMP WHERE id = 1').run(
                err.message
            );
        } catch (dbErr) {
            console.warn('[sync:pull] Failed to record pull error in DB:', dbErr.message);
        }

        if (err.code === 'permission-denied') {
            clearCredentials();
        }

        return buildPullResult({ success: false, lastError: err.message });
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
        if (!config || !config.enabled || !config.firebase_functions_url || !config.school_id) return;

        const intervalMs = Math.max(1, Math.min(30, config.sync_interval_minutes || 10)) * 60 * 1000;

        void pullRemoteChanges();
        startRemoteChangeListener(config.school_id);

        _pullTimer = setInterval(async () => {
            const result = await pullRemoteChanges();
            if (result && !result.success && !result.skipped) {
                const retryDelay = setTimeout(() => void pullRemoteChanges(), 5000);
                if (typeof retryDelay.unref === 'function') retryDelay.unref();
            }
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
    stopRemoteChangeListener();
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
    isPullCycleRunning,
    parsePullCursor,
    serializePullCursor
};

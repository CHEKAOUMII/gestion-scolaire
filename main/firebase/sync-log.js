'use strict';

const {
    collection, doc, setDoc, getDocs,
    query, orderBy, limit, startAfter,
    Timestamp, writeBatch, documentId
} = require('firebase/firestore');

function normalizeUpdatedAt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.floor(Date.now() / 1000);
    }

    return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function buildChangeId(entry) {
    const updatedAt = normalizeUpdatedAt(entry.updatedAt);
    const version = Number(entry.version) || 1;
    const entityType = String(entry.entityType || 'unknown').trim() || 'unknown';
    const rowSyncId = String(entry.rowSyncId || entry.entityId || '').trim();
    return `${updatedAt}_${version}_${entityType}_${rowSyncId}`;
}

/**
 * Writes a sync log entry when a document is pushed to Firestore.
 * Path: syncLog/{schoolId}/changes/{changeId}
 */
async function logChange(db, schoolId, entityType, entityId, operation, data, version, deviceHash, rowSyncId, schoolYear) {
    const updatedAt = normalizeUpdatedAt(Date.now());
    const changeId = buildChangeId({ updatedAt, version, entityType, rowSyncId, entityId });

    const changeRef = doc(db, 'syncLog', schoolId, 'changes', changeId);
    await setDoc(changeRef, {
        entityType,
        entityId,
        operation,
        data: data || {},
        version,
        deviceHash: String(deviceHash || '').substring(0, 16),
        rowSyncId: rowSyncId || '',
        schoolYear: schoolYear || '',
        updatedAt,
        ttl: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
    });

    return changeId;
}

/**
 * Batch-writes multiple sync log entries.
 */
async function logChangeBatch(db, schoolId, entries) {
    const batch = writeBatch(db);

    for (const entry of entries) {
        const updatedAt = normalizeUpdatedAt(entry.updatedAt);
        const changeId = buildChangeId({ ...entry, updatedAt });
        const changeRef = doc(db, 'syncLog', schoolId, 'changes', changeId);

        batch.set(changeRef, {
            entityType: entry.entityType,
            entityId: entry.entityId || '',
            operation: entry.operation,
            data: entry.data || {},
            version: entry.version,
            deviceHash: String(entry.deviceHash || '').substring(0, 16),
            rowSyncId: entry.rowSyncId || '',
            schoolYear: entry.schoolYear || '',
            updatedAt,
            ttl: Timestamp.fromDate(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000))
        });
    }

    await batch.commit();
}

/**
 * Pull changes since a cursor timestamp.
 * Equivalent to: GSI1PK = :schoolPk AND GSI1SK > :cursor
 */
async function pullChanges(db, schoolId, cursor, maxResults = 500) {
    const changesRef = collection(db, 'syncLog', schoolId, 'changes');
    const normalizedCursor =
        cursor && typeof cursor === 'object'
            ? {
                  updatedAt: normalizeUpdatedAt(cursor.updatedAt || 0),
                  changeId: String(cursor.changeId || '').trim()
              }
            : {
                  updatedAt: normalizeUpdatedAt(cursor || 0),
                  changeId: ''
              };

    const clauses = [
        orderBy('updatedAt'),
        orderBy(documentId())
    ];

    if (normalizedCursor.changeId) {
        clauses.push(startAfter(normalizedCursor.updatedAt, normalizedCursor.changeId));
    } else if (normalizedCursor.updatedAt > 0) {
        clauses.push(startAfter(normalizedCursor.updatedAt));
    }

    clauses.push(limit(maxResults));

    const q = query(
        changesRef,
        ...clauses
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = { logChange, logChangeBatch, pullChanges, buildChangeId, normalizeUpdatedAt };

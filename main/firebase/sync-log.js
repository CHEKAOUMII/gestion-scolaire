'use strict';

const {
    collection, doc, setDoc, getDocs,
    query, where, orderBy, limit,
    Timestamp, writeBatch
} = require('firebase/firestore');

/**
 * Writes a sync log entry when a document is pushed to Firestore.
 * Path: syncLog/{schoolId}/changes/{changeId}
 */
async function logChange(db, schoolId, entityType, entityId, operation, data, version, deviceHash, rowSyncId, schoolYear) {
    const updatedAt = Math.floor(Date.now() / 1000);
    const changeId = `${updatedAt}_${version}_${entityType}_${rowSyncId}`;

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
        const updatedAt = entry.updatedAt || Math.floor(Date.now() / 1000);
        const changeId = `${updatedAt}_${entry.version}_${entry.entityType}_${entry.rowSyncId}`;
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
async function pullChanges(db, schoolId, cursorTimestamp, maxResults = 500) {
    const changesRef = collection(db, 'syncLog', schoolId, 'changes');
    const cursor = Number(cursorTimestamp) || 0;

    const q = query(
        changesRef,
        where('updatedAt', '>', cursor),
        orderBy('updatedAt'),
        limit(maxResults)
    );

    const snapshot = await getDocs(q);
    return snapshot.docs.map((d) => ({ id: d.id, ...d.data() }));
}

module.exports = { logChange, logChangeBatch, pullChanges };

'use strict';

const crypto = require('crypto');
const {
    collection, doc, setDoc, getDocs,
    query, orderBy, limit, startAfter,
    Timestamp, writeBatch, documentId
} = require('firebase/firestore');

const BOOTSTRAP_PAGE_SIZE = 500;

function normalizeUpdatedAt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return Math.floor(Date.now() / 1000);
    }

    return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function normalizeCursorUpdatedAt(value) {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) {
        return 0;
    }

    return numeric > 9999999999 ? Math.floor(numeric / 1000) : Math.floor(numeric);
}

function buildChangeId(entry) {
    const updatedAt = normalizeUpdatedAt(entry.updatedAt);
    const version = Number(entry.version) || 1;
    const entityType = String(entry.entityType || 'unknown').trim() || 'unknown';
    const rowSyncId = String(entry.rowSyncId || entry.entityId || '').trim();
    const identity = rowSyncId || String(entry.entityId || '').trim() || 'unknown';
    const shard = crypto.createHash('sha1').update(`${entityType}:${identity}`).digest('hex').slice(0, 8);
    const safeIdentity = identity.replace(/[/.]/g, '_').slice(0, 80);
    return `${shard}_${entityType}_${updatedAt}_${version}_${safeIdentity}`;
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
                  updatedAt: normalizeCursorUpdatedAt(cursor.updatedAt || 0),
                  changeId: String(cursor.changeId || '').trim()
              }
            : {
                  updatedAt: normalizeCursorUpdatedAt(cursor || 0),
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

const SYNC_METADATA_KEYS = ['version', 'operation', 'rowSyncId', 'deviceHash', 'schoolYear', 'updatedAt', 'ttl'];

/**
 * Bootstrap pull: reads directly from entity collections instead of syncLog.
 * Used on first pull (pull_cursor is NULL) when syncLog entries may have expired.
 */
async function bootstrapFromCollections(db, schoolId, collectionMap, entityTypeRegistry) {
    const items = [];

    for (const [tableName, entry] of Object.entries(collectionMap)) {
        const entityInfo = entityTypeRegistry[tableName];
        if (!entityInfo) continue;

        const collectionPath = `schools/${schoolId}/${entry.collection}`;
        let colRef;
        try {
            colRef = collection(db, collectionPath);
        } catch (err) {
            console.warn(`[sync:bootstrap] Failed to reference collection ${collectionPath}:`, err.message);
            continue;
        }

        try {
            let fetchedCount = 0;
            let lastDoc = null;

            while (true) {
                const clauses = [orderBy(documentId())];
                if (lastDoc) {
                    clauses.push(startAfter(lastDoc));
                }
                clauses.push(limit(BOOTSTRAP_PAGE_SIZE));

                const snapshot = await getDocs(query(colRef, ...clauses));
                if (snapshot.empty) {
                    break;
                }

                for (const docSnap of snapshot.docs) {
                    const raw = docSnap.data() || {};
                    const cleanData = { ...raw };
                    for (const key of SYNC_METADATA_KEYS) {
                        delete cleanData[key];
                    }

                    items.push({
                        id: docSnap.id,
                        entityType: entityInfo.entityType,
                        entityId: raw.rowSyncId || docSnap.id,
                        operation: 'PUT',
                        data: cleanData,
                        version: raw.version || 1,
                        deviceHash: raw.deviceHash || '',
                        rowSyncId: raw.rowSyncId || '',
                        schoolYear: raw.schoolYear || '',
                        updatedAt: raw.updatedAt || Math.floor(Date.now() / 1000)
                    });
                }

                fetchedCount += snapshot.docs.length;
                lastDoc = snapshot.docs[snapshot.docs.length - 1];

                if (snapshot.docs.length < BOOTSTRAP_PAGE_SIZE) {
                    break;
                }
            }

            if (fetchedCount > 0) {
                console.log(`[sync:bootstrap] Fetched ${fetchedCount} docs from ${collectionPath}`);
            }
        } catch (err) {
            console.warn(`[sync:bootstrap] Failed to read ${collectionPath}:`, err.message);
        }
    }

    return items;
}

module.exports = { logChange, logChangeBatch, pullChanges, bootstrapFromCollections, buildChangeId, normalizeUpdatedAt };

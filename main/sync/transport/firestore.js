'use strict';

/**
 * Firestore sync data-plane (WP3).
 * App/auth configuration stays in main/firebase/config.js.
 *
 * createFirestoreTransport(deps) injects SDK / helpers for unit tests.
 * Default export methods use the live Firebase SDK.
 */

function createFirestoreTransport(deps) {
    deps = deps || {};
    const sdk = deps.sdk || require("firebase/firestore");
    const {
        collection,
        doc,
        documentId,
        getCountFromServer,
        getDocs,
        limit: firestoreLimit,
        onSnapshot,
        orderBy,
        query,
        runTransaction,
        where,
        writeBatch
    } = sdk;

    const firebaseConfig = deps.firebaseConfig || require("../../firebase/config");
    const getFirestoreDb = deps.getFirestoreDb || firebaseConfig.getFirestoreDb;
    const recoverFirestoreClient = deps.recoverFirestoreClient || firebaseConfig.recoverFirestoreClient;

    const syncLog = deps.syncLog || require("../../firebase/sync-log");
    const { logChangeBatch, pullChanges, bootstrapFromCollections } = syncLog;

    const collections = deps.collections || require("../../firebase/collections");
    const { getCollectionPath } = collections;

    const docBuild = deps.docBuild || require("../engine/doc-build");
    const { buildFirestorePayload, isEquivalentRemoteData } = docBuild;

    const helpers = deps.helpers || require("../engine/helpers");
    const { isThrottleError, isAssertionOrAuthNetworkError, chunkArray } = helpers;

    const outbox = deps.outbox || require("../engine/outbox");
    const { markEntrySent } = outbox;

    async function writeItemWithVersionCheck(firestoreDb, item) {
        try {
            const docRef = doc(firestoreDb, item.collectionPath, item.documentId);
            const legacyId =
                item.legacyDocumentId && item.legacyDocumentId !== item.documentId ? item.legacyDocumentId : null;
            const legacyRef = legacyId ? doc(firestoreDb, item.collectionPath, legacyId) : null;
    
            const transactionResult = await runTransaction(firestoreDb, async (transaction) => {
                const existing = await transaction.get(docRef);
                let remoteData = existing.exists() ? existing.data() || {} : null;
                let remoteVersion = existing.exists() ? Number(remoteData.version || 0) : 0;
    
                // D1: when the canonical doc is missing, adopt the legacy code-only baseline
                // so we do not clobber higher remote versions that still live under the old id.
                if (legacyRef) {
                    const legacySnap = await transaction.get(legacyRef);
                    if (legacySnap.exists()) {
                        const legacyData = legacySnap.data() || {};
                        const legacyVersion = Number(legacyData.version || 0);
                        if (!existing.exists() || legacyVersion > remoteVersion) {
                            if (!existing.exists()) {
                                remoteData = legacyData;
                                remoteVersion = legacyVersion;
                            }
                        }
                    }
                }
    
                if (remoteData && remoteVersion >= item.version) {
                    return { conflict: true, remoteData };
                }
    
                if (item.operation === 'DEL') {
                    // Physically remove the mirrored entity doc rather than writing a
                    // merge-tombstone. The DEL is still recorded in syncLog/changes for
                    // incremental peers; leaving a { operation:'DEL' } doc behind pollutes
                    // the collection and breaks bootstrap (which reads the collection
                    // directly and can't distinguish a tombstone from a live row).
                    transaction.delete(docRef);
                    // Also remove any legacy twin so year-scoped deletes do not leave orphans.
                    if (legacyRef) {
                        transaction.delete(legacyRef);
                    }
                } else {
                    // Writers use the canonical document id only; legacy retirement is separate.
                    transaction.set(docRef, buildFirestorePayload(item), { merge: true });
                }
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
            // Bug-domain recovery path (firestore-sync-assertion-crash-fix): a
            // mid-transaction auth-token refresh failure (`auth/network-request-failed`)
            // or the Firestore internal-assertion leak is treated as a transient,
            // recoverable error. We return a unified result WITHOUT letting the error
            // throw/leak so the affected row stays `pending` and the cycle can trigger
            // client recovery (terminate + re-init). Other errors keep their existing
            // classification unchanged (Req 2.1, 2.2).
            if (isAssertionOrAuthNetworkError(err)) {
                return { success: false, isRecoverable: true, isTransient: true, errorName: err.code };
            }
            const isAccessDenied = err.code === 'permission-denied';
            return {
                success: false,
                error: err.message,
                errorName: err.code,
                isAccessDenied,
                isThrottle: isThrottleError(err)
            };
        }
    }
    
    async function runBatchedFastPath(db, firestoreDb, preparedItems, _ctx) {
        const list = Array.isArray(preparedItems) ? preparedItems : [];
        const sentItems = [];
        const guardRoutedItems = [];
    
        if (list.length === 0) {
            return { sentItems, guardRoutedItems };
        }
    
        // --- Group by collection path (documentId() 'in' queries are per-collection). ---
        const groups = new Map(); // collectionPath -> prepared[]
        for (const prepared of list) {
            const collectionPath = prepared.item.collectionPath;
            if (!groups.has(collectionPath)) {
                groups.set(collectionPath, []);
            }
            groups.get(collectionPath).push(prepared);
        }
    
        // --- Bulk read + partition into batchable survivors vs. guard-routed. ---
        const survivors = []; // prepared[] safe to write (vL > vR)
    
        for (const [collectionPath, groupItems] of groups) {
            // documentId() 'in' accepts at most 30 ids per query (Req 7.1).
            const chunks = chunkArray(groupItems, 30);
    
            for (const chunk of chunks) {
                // Dedupe ids for the query while keeping every prepared record routed.
                const ids = [...new Set(chunk.map((p) => p.item.documentId))];
    
                let remoteVersionById = null;
                try {
                    const snapshot = await getDocs(
                        query(collection(firestoreDb, collectionPath), where(documentId(), 'in', ids))
                    );
                    remoteVersionById = new Map();
                    snapshot.forEach((docSnap) => {
                        remoteVersionById.set(docSnap.id, Number(docSnap.data()?.version || 0));
                    });
                } catch {
                    // Bulk-read failure → route the WHOLE chunk to guard (Req 7.5). Nothing
                    // is marked sent for these items.
                    for (const prepared of chunk) {
                        guardRoutedItems.push(prepared);
                    }
                    continue;
                }
    
                for (const prepared of chunk) {
                    const docId = prepared.item.documentId;
                    const localVersion = Number(prepared.item.version || 0);
    
                    if (!remoteVersionById.has(docId)) {
                        // Not found / unreadable → cannot evaluate the strict rule here;
                        // route to the per-document Version_Guard (Req 4.4, 7.4).
                        guardRoutedItems.push(prepared);
                        continue;
                    }
    
                    const remoteVersion = remoteVersionById.get(docId);
                    if (localVersion > remoteVersion) {
                        survivors.push(prepared); // batchable (Req 7.2)
                    } else {
                        // vR >= vL → guard-routed (Req 7.4).
                        guardRoutedItems.push(prepared);
                    }
                }
            }
        }
    
        // --- Commit survivors via writeBatch, <= 500 ops per commit (Req 7.3). ---
        const commitChunks = chunkArray(survivors, 500);
    
        for (const commitChunk of commitChunks) {
            try {
                const batch = writeBatch(firestoreDb);
                for (const prepared of commitChunk) {
                    const ref = doc(firestoreDb, prepared.item.collectionPath, prepared.item.documentId);
                    if (prepared.item.operation === 'DEL') {
                        // Physically delete the mirrored entity doc instead of writing a
                        // merge-tombstone (see writeItemWithVersionCheck). The DEL is still
                        // captured in syncLog/changes for incremental pull.
                        batch.delete(ref);
                        // D1: also drop legacy code-only twin when present.
                        const legacyId = prepared.item.legacyDocumentId;
                        if (legacyId && legacyId !== prepared.item.documentId) {
                            batch.delete(doc(firestoreDb, prepared.item.collectionPath, legacyId));
                        }
                    } else {
                        batch.set(ref, buildFirestorePayload(prepared.item), { merge: true });
                    }
                }
                await batch.commit();
    
                // Successful commit → apply markEntrySent + collect for the syncLog batch,
                // identical to the per-document success path (Req 7.7).
                for (const prepared of commitChunk) {
                    markEntrySent(db, prepared.entryId);
                    sentItems.push(prepared.item);
                }
            } catch {
                // Commit failure → re-route every item in this commit to the Version_Guard;
                // nothing in a failed commit is marked sent (Req 7.6).
                for (const prepared of commitChunk) {
                    guardRoutedItems.push(prepared);
                }
            }
        }
    
        return { sentItems, guardRoutedItems };
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
        console.error(
            `[sync:push] syncLog batch PERMANENTLY failed for ${batch.length} items — other devices may not receive these changes`
        );
        return false;
    }

    return {
        collection,
        doc,
        documentId,
        getCountFromServer,
        getDocs,
        firestoreLimit,
        onSnapshot,
        orderBy,
        query,
        runTransaction,
        where,
        writeBatch,
        getFirestoreDb,
        recoverFirestoreClient,
        logChangeBatch,
        pullChanges,
        bootstrapFromCollections,
        getCollectionPath,
        writeItemWithVersionCheck,
        runBatchedFastPath,
        writeSyncLogWithRetry
    };
}

const defaultTransport = createFirestoreTransport();

module.exports = Object.assign({ createFirestoreTransport }, defaultTransport);

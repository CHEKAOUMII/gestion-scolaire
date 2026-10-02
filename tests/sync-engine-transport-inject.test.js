'use strict';

/**
 * WP3: push transport can be constructed with injected fakes (no live Firestore).
 */

const assert = require('assert');
const { createFirestoreTransport } = require('../main/sync/transport/firestore');

console.log('[test] WP3 injectable firestore transport');

function createFakeSdk(remoteById) {
    return {
        collection: () => ({}),
        doc: (_db, _path, id) => ({ id: String(id) }),
        documentId: () => 'documentId',
        getCountFromServer: async () => ({ data: () => ({ count: 0 }) }),
        getDocs: async () => ({
            empty: true,
            docs: [],
            forEach() {}
        }),
        limit: (n) => n,
        onSnapshot: () => () => {},
        orderBy: () => ({}),
        query: () => ({}),
        where: () => ({}),
        writeBatch: () => ({
            set() {},
            delete() {},
            commit: async () => {}
        }),
        runTransaction: async (_db, fn) => {
            const transaction = {
                get: async (ref) => {
                    const hit = remoteById.get(ref.id);
                    return {
                        exists: () => !!hit,
                        data: () => (hit ? { ...hit } : undefined)
                    };
                },
                set: (ref, payload) => {
                    remoteById.set(ref.id, { ...payload });
                },
                delete: (ref) => {
                    remoteById.delete(ref.id);
                }
            };
            return fn(transaction);
        }
    };
}

const remote = new Map();
remote.set('LEGACY_CODE', { version: 4, code: 'S1', school_year: '2025/2026', full_name: 'Legacy' });

const transport = createFirestoreTransport({
    sdk: createFakeSdk(remote),
    firebaseConfig: {
        getFirestoreDb: () => ({ __fake: true }),
        recoverFirestoreClient: async () => {}
    },
    syncLog: {
        logChangeBatch: async () => {},
        pullChanges: async () => [],
        bootstrapFromCollections: async () => []
    },
    collections: {
        getCollectionPath: () => 'schools/S1/students'
    },
    docBuild: {
        buildFirestorePayload: (item) => ({ ...item.data, version: item.version }),
        isEquivalentRemoteData: () => false
    },
    helpers: {
        isThrottleError: () => false,
        isAssertionOrAuthNetworkError: () => false,
        chunkArray: (items, size) => {
            const list = [...items];
            const out = [];
            for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
            return out;
        }
    },
    outbox: {
        markEntrySent: () => {}
    }
});

(async () => {
    // Canonical missing, legacy present at v4 → local v3 conflicts
    const conflict = await transport.writeItemWithVersionCheck(
        {},
        {
            collectionPath: 'schools/S1/students',
            documentId: '2025%2F2026__S1',
            legacyDocumentId: 'LEGACY_CODE',
            version: 3,
            operation: 'PUT',
            data: { code: 'S1', school_year: '2025/2026', full_name: 'Local' }
        }
    );
    assert.strictEqual(conflict.conflict, true, 'should conflict against legacy baseline version');
    assert.strictEqual(conflict.remoteVersion, 4);

    // Local v5 beats legacy v4 → writes canonical
    const ok = await transport.writeItemWithVersionCheck(
        {},
        {
            collectionPath: 'schools/S1/students',
            documentId: '2025%2F2026__S1',
            legacyDocumentId: 'LEGACY_CODE',
            version: 5,
            operation: 'PUT',
            data: { code: 'S1', school_year: '2025/2026', full_name: 'Local' }
        }
    );
    assert.strictEqual(ok.success, true);
    assert.ok(remote.has('2025%2F2026__S1'), 'canonical doc written');
    assert.ok(remote.has('LEGACY_CODE'), 'legacy left in place on PUT');

    console.log('  [ok] writeItemWithVersionCheck dual-read with fake transport');
    console.log('[test] WP3 injectable firestore transport OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

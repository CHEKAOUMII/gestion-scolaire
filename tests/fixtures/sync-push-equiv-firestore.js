'use strict';

// Test fixture — sync-push-throughput-optimization (Property 5 & 7 support)
//
// A deterministic, in-memory mock of the Firestore Web SDK primitives that
// `main/sync/engine.js` consumes, PLUS a capturing mock of the
// `main/firebase/sync-log` `logChangeBatch` path. It exists so the REAL exported
// push functions (`flushPreparedItems`, `flushPreparedItemsConcurrent`, which both
// call the real `writeItemWithVersionCheck`) can run against a controllable remote
// state with NO network and FULLY deterministic outcomes.
//
// This is a NEW, separate fixture. It does NOT modify the read-only
// `tests/fixtures/sync-outbox-db.js`. It is intentionally named distinctly from any
// other mock-firestore helper so multiple specs/tasks can coexist without clashing.
//
// WHY a require-cache install (not dependency injection):
//   `engine.js` destructures `doc` / `runTransaction` from `require('firebase/firestore')`
//   and `logChangeBatch` from `require('../firebase/sync-log')` at MODULE-LOAD time.
//   Those bindings are captured before any test runs, so the only way to substitute
//   them is to seed `require.cache` with mock module objects BEFORE `engine.js` is
//   first required.
//
//   => A test MUST `require('./fixtures/sync-push-equiv-firestore')` BEFORE it
//      `require('../main/sync/engine')`. Requiring this file performs the install as
//      a side effect (idempotent).
//
// MULTI-INSTANCE: unlike a closure-state mock, every SDK function here operates on
// the `db` object threaded through it by the engine. A test can therefore create
// TWO independent mock firestore instances (e.g. one for the sequential reference
// and one for the concurrent dispatcher) and compare their observable state.
//
// FAITHFULNESS:
//   - `doc(db, path, id)` → ref carrying the document key.
//   - `runTransaction(db, fn)` → runs `fn(transaction)`; `transaction.get(ref)`
//     returns `{ exists(), data() }` from the remote store; `transaction.set(ref,
//     payload, { merge })` merges into the store. Transactions are SERIALIZED on a
//     per-db chain so the optimistic guard sees a consistent snapshot even under
//     concurrent dispatch (mirrors Firestore serializable isolation).
//   - Per-document injected transaction errors reproduce throttling
//     (`resource-exhausted` / `unavailable` / `aborted`), access-denied
//     (`permission-denied`), and generic failures.
//   - `logChangeBatch(db, schoolId, entries)` records the exact batch onto the db so
//     a test can assert the syncLog batch equals the sent set.

const path = require('path');

function codedError(code, message) {
    const err = new Error(message || code || 'mock-firestore error');
    err.code = code;
    return err;
}

function mockDoc(db, collectionPath, documentId) {
    return { _db: db, path: collectionPath, id: documentId, key: `${collectionPath}/${documentId}` };
}

function mockRunTransaction(db, updateFn) {
    const run = db._txChain.then(async () => {
        const transaction = {
            get: async (ref) => {
                const injected = ref._db.txErrors.get(ref.key);
                if (injected) {
                    ref._db.errorObservations.push({ key: ref.key, code: injected.code });
                    throw codedError(injected.code, injected.message);
                }
                const exists = ref._db.store.has(ref.key);
                const data = exists ? ref._db.store.get(ref.key) : undefined;
                return { exists: () => exists, data: () => data };
            },
            set: (ref, payload, options) => {
                const existing = ref._db.store.get(ref.key) || {};
                const next = options && options.merge ? { ...existing, ...payload } : { ...payload };
                ref._db.store.set(ref.key, next);
                ref._db.writeCount += 1;
                return transaction;
            }
        };
        return updateFn(transaction);
    });
    // Keep the per-db chain alive regardless of this transaction's outcome.
    db._txChain = run.then(() => {}, () => {});
    return run;
}

const noop = () => {};
const passthrough = (x) => x;

const firestoreMock = {
    collection: (...args) => ({ _mockCollection: true, args }),
    doc: mockDoc,
    limit: passthrough,
    onSnapshot: noop,
    orderBy: passthrough,
    query: (...args) => ({ _mockQuery: true, args }),
    runTransaction: mockRunTransaction,
    // Forward-compat (Layer 2 / pull) so future engine imports resolve.
    getDocs: async () => ({ docs: [], forEach: noop }),
    writeBatch: () => ({ set: noop, delete: noop, commit: async () => {} }),
    where: (...args) => ({ _mockWhere: true, args }),
    documentId: () => '__name__',
    getFirestore: () => ({})
};

const syncLogMock = {
    logChangeBatch: async (db, schoolId, entries) => {
        const captured = Array.isArray(entries) ? entries.slice() : [];
        db.syncLogBatches.push({ schoolId, entries: captured });
        return true;
    },
    logChange: async () => true,
    pullChanges: async () => [],
    bootstrapFromCollections: async () => ({}),
    buildChangeId: (...args) => args.join(':'),
    normalizeUpdatedAt: (v) => v
};

let _installed = false;

function installMocks() {
    if (_installed) return;

    const firestorePath = require.resolve('firebase/firestore');
    require.cache[firestorePath] = {
        id: firestorePath,
        filename: firestorePath,
        loaded: true,
        exports: firestoreMock,
        children: [],
        paths: []
    };

    const syncLogPath = require.resolve(path.join(__dirname, '..', '..', 'main', 'firebase', 'sync-log.js'));
    require.cache[syncLogPath] = {
        id: syncLogPath,
        filename: syncLogPath,
        loaded: true,
        exports: syncLogMock,
        children: [],
        paths: []
    };

    _installed = true;
}

// Install on require so callers only need to require this file before engine.js.
installMocks();

// Create an independent mock firestore instance.
//   opts.docs:   [{ path, id, data }]                    pre-seeded remote documents
//   opts.errors: [{ path, id, code, message }]           per-document injected tx errors
function createMockFirestore(opts = {}) {
    const db = {
        _kind: 'mock-firestore',
        store: new Map(),
        txErrors: new Map(),
        _txChain: Promise.resolve(),
        syncLogBatches: [],
        errorObservations: [],
        writeCount: 0
    };
    if (Array.isArray(opts.docs)) {
        for (const d of opts.docs) db.store.set(`${d.path}/${d.id}`, d.data);
    }
    if (Array.isArray(opts.errors)) {
        for (const e of opts.errors) db.txErrors.set(`${e.path}/${e.id}`, { code: e.code, message: e.message || e.code });
    }
    return db;
}

function getSyncLogEntries(db) {
    const out = [];
    for (const batch of db.syncLogBatches) {
        for (const entry of batch.entries) out.push(entry);
    }
    return out;
}

function getSyncLogBatchCount(db) {
    return db.syncLogBatches.length;
}

function getRemoteDoc(db, collectionPath, documentId) {
    return db.store.get(`${collectionPath}/${documentId}`);
}

module.exports = {
    installMocks,
    createMockFirestore,
    getSyncLogEntries,
    getSyncLogBatchCount,
    getRemoteDoc,
    firestoreMock,
    syncLogMock
};

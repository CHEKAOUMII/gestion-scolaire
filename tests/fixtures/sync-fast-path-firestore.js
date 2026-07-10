'use strict';

// Test fixture — sync-push-throughput-optimization (Layer 2 / Batched Fast Path support)
//
// A deterministic, in-memory mock of the Firestore Web SDK primitives the Layer 2
// Batched Fast Path (`runBatchedFastPath`) ACTUALLY exercises — `collection`, `doc`,
// `documentId`, `where`, `query`, `getDocs`, and `writeBatch` — PLUS `runTransaction`
// for the per-document Version_Guard (`writeItemWithVersionCheck`) and a capturing
// `logChangeBatch`. It exists so the REAL exported push functions in
// `main/sync/engine.js` can run against a controllable remote state with NO network
// and FULLY deterministic outcomes.
//
// WHY a NEW fixture (and not the existing ones):
//   - `tests/fixtures/sync-push-equiv-firestore.js` deliberately STUBS `getDocs` to
//     return an empty snapshot and `writeBatch` to a no-op (forward-compat only). It
//     cannot drive `runBatchedFastPath`'s bulk-read / batch-commit logic.
//   - `tests/fixtures/sync-mock-firestore.js` supports only `doc` + `runTransaction`.
//   Neither models the Layer 2 read/commit surface, and the task forbids modifying the
//   existing fixtures — so this is a single, clearly-named, additive fixture.
//
// WHY a require-cache install (not dependency injection):
//   `engine.js` destructures `collection` / `doc` / `documentId` / `getDocs` / `query`
//   / `where` / `writeBatch` / `runTransaction` from `require('firebase/firestore')` and
//   `logChangeBatch` from `require('../firebase/sync-log')` at MODULE-LOAD time. The
//   only way to substitute them is to seed `require.cache` BEFORE `engine.js` is first
//   required. Requiring this file performs that install as an idempotent side effect, so
//   a test MUST require this file BEFORE `require('../main/sync/engine')`.
//
// MULTI-INSTANCE: every SDK function operates on the `db` handle threaded through it
// (queries/refs/batches all carry `_db`), so a single test can create multiple
// independent mock-firestore instances (e.g. fast-path-enabled vs disabled runs) and
// compare their observable state and call records.
//
// OBSERVABILITY / SEAMS (per instance):
//   getDocsCalls     — [{ path, ids }] for every bulk read attempted (Property 20 forbids
//                      these in the disabled path; Property 18 drives read failures).
//   writeBatchCount  — number of writeBatch() objects created (Property 20 forbids these
//                      in the disabled path).
//   commitCount      — number of writeBatch.commit() calls.
//   committedIds     — document ids successfully committed via a batch.
//   txWrites         — document ids written via a runTransaction set (the Version_Guard).
//   runTransactionCount — number of Version_Guard transactions opened.
//   syncLogBatches   — captured logChangeBatch payloads.
//
// FAILURE INJECTION (per instance):
//   readFailPaths    — Set of collectionPaths whose getDocs throws (whole-chunk bulk-read
//                      failure → guard routing, Req 7.5 / Property 18).
//   commitFail       — when true, every writeBatch.commit() throws (whole-commit failure →
//                      re-route to guard, Req 7.6 / Property 18).
//   txErrors         — Map(key -> code) so a runTransaction.get raises a coded error
//                      (throttle / permission-denied / generic), mirroring the equiv mock.

const path = require('path');

function codedError(code, message) {
    const err = new Error(message || code || 'mock-firestore error');
    err.code = code;
    return err;
}

// --- ref / collection / query primitives -----------------------------------

function mockDoc(db, collectionPath, documentId) {
    return { _db: db, path: collectionPath, id: String(documentId), key: `${collectionPath}/${documentId}` };
}

function mockCollection(db, collectionPath) {
    return { _db: db, _collection: true, path: collectionPath };
}

function mockWhere(field, op, value) {
    return { _where: true, field, op, value };
}

function mockQuery(coll, whereClause) {
    // Carry the db + collection path + the requested ids so getDocs can resolve
    // against the per-instance remote store.
    return {
        _query: true,
        _db: coll && coll._db,
        path: coll && coll.path,
        ids: whereClause && Array.isArray(whereClause.value) ? whereClause.value.slice() : []
    };
}

// --- getDocs: chunked bulk read --------------------------------------------

async function mockGetDocs(q) {
    const db = q && q._db;
    if (!db) throw codedError('internal', 'mock getDocs called without a db-bearing query');
    db.getDocsCalls.push({ path: q.path, ids: q.ids.slice() });

    if (db.readFailPaths.has(q.path)) {
        throw codedError(db.readFailCode || 'unavailable', `bulk read failed for ${q.path}`);
    }

    const docs = [];
    for (const id of q.ids) {
        const key = `${q.path}/${id}`;
        if (db.store.has(key)) {
            const data = db.store.get(key);
            docs.push({ id: String(id), data: () => data });
        }
    }
    return {
        size: docs.length,
        docs,
        forEach: (cb) => docs.forEach(cb)
    };
}

// --- writeBatch: <=500 ops/commit ------------------------------------------

function mockWriteBatch(db) {
    db.writeBatchCount += 1;
    const ops = [];
    const batch = {
        set: (ref, payload, options) => {
            ops.push({ ref, payload, merge: !!(options && options.merge) });
            return batch;
        },
        delete: (ref) => {
            ops.push({ ref, _delete: true });
            return batch;
        },
        commit: async () => {
            db.commitCount += 1;
            if (db.commitFail) {
                db.commitFailCount += 1;
                throw codedError(db.commitFailCode || 'unavailable', 'writeBatch commit failed');
            }
            for (const op of ops) {
                const key = op.ref.key;
                if (op._delete) {
                    db.store.delete(key);
                } else {
                    const existing = db.store.get(key) || {};
                    db.store.set(key, op.merge ? { ...existing, ...op.payload } : { ...op.payload });
                }
                db.committedIds.push(op.ref.id);
                db.writeCount += 1;
            }
        }
    };
    return batch;
}

// --- runTransaction: the per-document Version_Guard -------------------------

function mockRunTransaction(db, updateFn) {
    db.runTransactionCount += 1;
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
                ref._db.txWrites.push(ref.id);
                ref._db.writeCount += 1;
                return transaction;
            }
        };
        return updateFn(transaction);
    });
    db._txChain = run.then(() => {}, () => {});
    return run;
}

const noop = () => {};
const passthrough = (x) => x;

const firestoreMock = {
    collection: mockCollection,
    doc: mockDoc,
    documentId: () => '__name__',
    getDocs: mockGetDocs,
    where: mockWhere,
    query: mockQuery,
    writeBatch: mockWriteBatch,
    runTransaction: mockRunTransaction,
    // Harmless stubs for the remaining destructured names (pull path / queries).
    limit: passthrough,
    onSnapshot: noop,
    orderBy: passthrough,
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
//   opts.docs:          [{ path, id, data }]            pre-seeded remote documents
//   opts.readFailPaths: [collectionPath, ...]           collections whose getDocs throws
//   opts.commitFail:    boolean                         every writeBatch.commit() throws
//   opts.txErrors:      [{ path, id, code, message }]   per-document runTransaction errors
function createMockFirestore(opts = {}) {
    const db = {
        _kind: 'fast-path-firestore',
        store: new Map(),
        txErrors: new Map(),
        readFailPaths: new Set(Array.isArray(opts.readFailPaths) ? opts.readFailPaths : []),
        readFailCode: opts.readFailCode || 'unavailable',
        commitFail: !!opts.commitFail,
        commitFailCode: opts.commitFailCode || 'unavailable',
        _txChain: Promise.resolve(),
        // observability
        getDocsCalls: [],
        writeBatchCount: 0,
        commitCount: 0,
        commitFailCount: 0,
        committedIds: [],
        txWrites: [],
        runTransactionCount: 0,
        errorObservations: [],
        writeCount: 0,
        syncLogBatches: []
    };
    if (Array.isArray(opts.docs)) {
        for (const d of opts.docs) db.store.set(`${d.path}/${d.id}`, d.data);
    }
    if (Array.isArray(opts.txErrors)) {
        for (const e of opts.txErrors) db.txErrors.set(`${e.path}/${e.id}`, { code: e.code, message: e.message || e.code });
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

function syncLogIdSet(db) {
    return new Set(getSyncLogEntries(db).map((e) => `${e.collectionPath}/${e.documentId}`));
}

function getRemoteDoc(db, collectionPath, documentId) {
    return db.store.get(`${collectionPath}/${documentId}`);
}

module.exports = {
    installMocks,
    createMockFirestore,
    getSyncLogEntries,
    syncLogIdSet,
    getRemoteDoc,
    firestoreMock,
    syncLogMock
};

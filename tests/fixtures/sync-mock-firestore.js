'use strict';

// Test fixture — sync-push-throughput-optimization
//
// A deterministic, in-memory mock of the `firebase/firestore` surface that the
// push engine actually uses, so the REAL `writeItemWithVersionCheck` /
// `flushPreparedItemsConcurrent` from `main/sync/engine.js` can be exercised
// without a live Firestore. This is a NEW, separate fixture — the existing
// `tests/fixtures/sync-outbox-db.js` (the local better-sqlite3 / emulator) is
// reused read-only and is NOT modified.
//
// engine.js destructures, at module load time:
//   const { collection, doc, limit, onSnapshot, orderBy, query, runTransaction }
//       = require('firebase/firestore');
//
// and `writeItemWithVersionCheck` uses ONLY `doc(db, path, id)` +
// `runTransaction(db, fn)`, where the transaction exposes `.get(ref)` (a snapshot
// with `.exists()` / `.data()`) and `.set(ref, payload, opts)`. This mock provides
// exactly that, plus harmless stubs for the other destructured names.
//
// Because the names are captured when engine.js is first required, the mock MUST
// be installed into the require cache BEFORE `require('../main/sync/engine')`.
// `installMockFirestore()` does that.
//
// Per-document behavior is configured by Firestore documentId:
//   setRemote(documentId, version, data) — a remote doc exists at `version`
//                                          (drives the Version_Guard conflict path).
//   setDenied(documentId)                — runTransaction throws permission-denied
//                                          (access-denied / abort).
//   setError(documentId, code)           — runTransaction throws an arbitrary code
//                                          (e.g. a throttle code).
//
// Observability:
//   dispatched — ordered list of documentIds for which a transaction was actually
//                opened (i.e. the item reached Firestore).
//   writes     — ordered list of documentIds committed via transaction.set.

function createMockFirestore() {
    const remote = new Map(); // documentId -> { version, data }
    const denied = new Set(); // documentIds that throw permission-denied
    const errors = new Map(); // documentId -> error code thrown from runTransaction
    const dispatched = []; // documentIds that reached a transaction
    const writes = []; // documentIds committed via transaction.set

    // The opaque Firestore "db" handle the engine threads through. Its identity is
    // irrelevant to the mock; the closures below own all state.
    const db = { __mockFirestore: true };

    function setRemote(documentId, version, data) {
        remote.set(String(documentId), { version: Number(version) || 0, data: data || {} });
    }
    function setDenied(documentId) {
        denied.add(String(documentId));
    }
    function setError(documentId, code) {
        errors.set(String(documentId), code);
    }
    // Clear all configured behavior and observability. Because the engine captures the
    // mock's doc()/runTransaction() closures at module-load time, a SINGLE mock instance
    // must be reused for the whole process; reset() returns it to a clean slate between
    // property-test runs.
    function reset() {
        remote.clear();
        denied.clear();
        errors.clear();
        dispatched.length = 0;
        writes.length = 0;
    }

    function throwCoded(code) {
        const err = new Error(code);
        err.code = code;
        throw err;
    }

    const mockModule = {
        // --- used by writeItemWithVersionCheck ---
        doc: (_db, collectionPath, documentId) => ({
            __ref: true,
            path: collectionPath,
            id: String(documentId)
        }),
        runTransaction: async (_db, updateFn) => {
            const transaction = {
                get: async (ref) => {
                    const id = ref.id;
                    dispatched.push(id);
                    // Injected hard failures are raised at the read step, exactly as a
                    // Firestore transaction would surface them, so writeItemWithVersionCheck's
                    // catch branch classifies them (permission-denied -> access-denied).
                    if (denied.has(id)) throwCoded('permission-denied');
                    if (errors.has(id)) throwCoded(errors.get(id));

                    const entry = remote.get(id);
                    return {
                        exists: () => !!entry,
                        data: () => (entry ? { ...entry.data, version: entry.version } : {})
                    };
                },
                set: (ref) => {
                    writes.push(ref.id);
                }
            };
            // Mirror Firestore: the updater's return value is the transaction result.
            return updateFn(transaction);
        },

        // --- harmless stubs for the other destructured names (pull path / queries) ---
        collection: (_db, path) => ({ __collection: true, path }),
        query: (...args) => ({ __query: true, args }),
        orderBy: (...args) => ({ __orderBy: true, args }),
        limit: (n) => ({ __limit: true, n }),
        onSnapshot: () => () => {}
    };

    return {
        db,
        mockModule,
        setRemote,
        setDenied,
        setError,
        reset,
        dispatched,
        writes,
        get dispatchedSet() {
            return new Set(dispatched);
        },
        get writeSet() {
            return new Set(writes);
        }
    };
}

// Install a mock `firebase/firestore` module into the require cache so that a
// subsequent `require('../main/sync/engine')` captures the mock's functions.
// MUST be called before engine.js is required in this process.
function installMockFirestore(mockModule) {
    const resolved = require.resolve('firebase/firestore');
    require.cache[resolved] = {
        id: resolved,
        filename: resolved,
        loaded: true,
        exports: mockModule,
        children: [],
        paths: []
    };
    return resolved;
}

module.exports = { createMockFirestore, installMockFirestore };

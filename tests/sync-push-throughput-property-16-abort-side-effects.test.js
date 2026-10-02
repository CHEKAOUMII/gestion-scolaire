'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.5 — Property 16: Abort preserves side effects for written items only
//
// **Validates: Requirements 4.6**
//
// Exercises the REAL exported `flushPreparedItemsConcurrent` from main/sync/engine.js
// against a deterministic mock Firestore (tests/fixtures/sync-mock-firestore.js) and
// the real-schema local DB (tests/fixtures/sync-outbox-db.js, reused read-only). A
// Firestore access-denied (`permission-denied`) is injected at an arbitrary position;
// the dispatcher must abort the cycle only AFTER the access-denied item's group fully
// settles, and:
//
//   - items written (settled-as-sent) BEFORE the abort keep their markEntrySent side
//     effects (sync_outbox 'sent', sync_id_map.version bumped, related conflict resolved);
//   - the access-denied item is NOT marked sent (row stays 'pending', version untouched,
//     conflict unresolved);
//   - items AFTER the abort are never dispatched and are left exactly 'pending' — never
//     partially applied (no version bump, no conflict resolution).
//
// The main property runs strictly one-at-a-time (active concurrency pinned to 1 via a
// rate limiter with max == 1) so "before" / "after" the abort is unambiguous. A
// higher-concurrency anchor additionally shows that siblings already written within the
// aborting group keep their side effects while later groups stay pending.
//
// Feature: sync-push-throughput-optimization, Property 16: For any cycle that aborts on
// access-denied, markEntrySent side effects exist for exactly the items already written
// before the abort and for no item that had not yet been written.

const assert = require('assert');
const fc = require('fast-check');

// Install the deterministic mock Firestore BEFORE requiring the engine so that
// writeItemWithVersionCheck captures the mock's doc()/runTransaction().
const { createMockFirestore, installMockFirestore } = require('./fixtures/sync-mock-firestore');
const sharedMock = createMockFirestore();
installMockFirestore(sharedMock.mockModule);

const { flushPreparedItemsConcurrent, createRateLimiter } = require('../main/sync/engine');
const {
    createSyncDb,
    dbKind,
    seedOutboxRow,
    seedIdMap,
    seedConflict,
    getOutboxRow,
    getIdMap,
    getUnresolvedConflictsForEntry
} = require('./fixtures/sync-outbox-db');

const MIN_RUNS = 120;
const MAX_RETRIES = 10;

// Build a prepared { entryId, item } record AND seed its backing rows.
//   - sync_outbox row (pending), so markEntrySent can flip it to 'sent'
//   - sync_id_map mapping at `seedVersion`, so a version bump is observable
//   - one unresolved sync_conflict (local_outbox_id = entryId), so resolution is observable
function seedPrepared(db, mock, { table, localId, seq, seedVersion, behavior }) {
    const rowSyncId = `SCHOOL1:${table}:${localId}_${seq}`;
    const documentId = `${table}__${localId}_${seq}`;
    const localData = { id: localId, value: `v${seq}`, school_year: '2025/2026' };
    const rowDataJson = JSON.stringify(localData);

    const entryId = seedOutboxRow(db, { tableName: table, rowSyncId, rowData: rowDataJson });
    seedIdMap(db, { rowSyncId, tableName: table, localId, version: seedVersion, ancestorData: JSON.stringify({ base: true }) });
    seedConflict(db, {
        tableName: table,
        rowSyncId,
        entityType: 'setting',
        localData: rowDataJson,
        remoteData: '{}',
        remoteVersion: seedVersion,
        localOutboxId: entryId
    });

    // Configure the mock Firestore for this document id.
    if (behavior === 'denied') {
        mock.setDenied(documentId);
    }
    // 'success' behavior needs no remote doc: the Version_Guard sees exists()==false
    // and performs the merge set -> success.

    const prepared = {
        entryId,
        tableName: table,
        item: {
            collectionPath: `schools/SCHOOL1/${table}`,
            documentId,
            entityType: 'setting',
            entityId: documentId,
            data: localData,
            version: seedVersion + 1, // local strictly greater -> would write on success
            operation: 'PUT',
            rowSyncId,
            deviceHash: 'devLOCAL000000aa',
            schoolYear: '2025/2026',
            updatedAt: 1726000000 + seq
        },
        documentId,
        rowSyncId,
        seedVersion,
        behavior
    };
    return prepared;
}

console.log('[pbt] sync-push-throughput Property 16: abort preserves side effects for written items only');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.record({
                total: fc.integer({ min: 1, max: 12 }),
                deniedAt: fc.nat(),
                seedVersions: fc.array(fc.integer({ min: 0, max: 50 }), { minLength: 12, maxLength: 12 })
            }),
            async ({ total, deniedAt, seedVersions }) => {
                const deniedIndex = deniedAt % total; // arbitrary position in [0, total)
                const db = createSyncDb();
                const mock = sharedMock;
                mock.reset(); // engine captured this instance's fns at load; clear per-run state
                backing = dbKind(db);

                const prepared = [];
                for (let i = 0; i < total; i += 1) {
                    const behavior = i === deniedIndex ? 'denied' : 'success';
                    prepared.push(
                        seedPrepared(db, mock, {
                            table: 'settings',
                            localId: 1000 + i,
                            seq: i,
                            seedVersion: seedVersions[i],
                            behavior
                        })
                    );
                }

                // Pin active concurrency to 1 so groups are size-1 and processing is strictly
                // sequential — "before" = indices < deniedIndex, "after" = indices > deniedIndex.
                const rateLimiter = createRateLimiter({ initialConcurrency: 1, maxConcurrency: 1 });

                // schoolId omitted (null) so the syncLog batch write is skipped; this property
                // is about markEntrySent side effects, which are independent of syncLog.
                const result = await flushPreparedItemsConcurrent(
                    db,
                    mock.db,
                    prepared,
                    MAX_RETRIES,
                    /* schoolId */ null,
                    rateLimiter
                );

                // The cycle aborted on the access-denied item.
                assert.strictEqual(result.abort, true, 'cycle must abort on access-denied');
                assert.strictEqual(result.sentCount, deniedIndex, 'exactly the items before the abort are sent');
                assert.strictEqual(result.failedCount, 1, 'only the denied item is counted failed');

                const dispatched = mock.dispatchedSet;

                for (let i = 0; i < total; i += 1) {
                    const p = prepared[i];
                    const row = getOutboxRow(db, p.entryId);
                    const mapping = getIdMap(db, p.rowSyncId);
                    const unresolved = getUnresolvedConflictsForEntry(db, p.entryId).length;

                    if (i < deniedIndex) {
                        // Written before the abort → full markEntrySent side effects.
                        assert.strictEqual(row.status, 'sent', `item ${i} (before abort) must be 'sent'`);
                        assert.strictEqual(
                            Number(mapping.version),
                            p.seedVersion + 1,
                            `item ${i} (before abort) must bump sync_id_map.version`
                        );
                        assert.strictEqual(unresolved, 0, `item ${i} (before abort) must have its conflict resolved`);
                        assert.ok(dispatched.has(p.documentId), `item ${i} (before abort) must have been dispatched`);
                    } else if (i === deniedIndex) {
                        // Access-denied → NOT written: no side effects.
                        assert.notStrictEqual(row.status, 'sent', 'denied item must not be marked sent');
                        assert.strictEqual(row.status, 'pending', 'denied item is retained pending');
                        assert.strictEqual(
                            Number(mapping.version),
                            p.seedVersion,
                            'denied item must NOT bump version'
                        );
                        assert.strictEqual(unresolved, 1, 'denied item conflict stays unresolved');
                        assert.ok(dispatched.has(p.documentId), 'denied item was dispatched (then failed the guard)');
                    } else {
                        // After the abort → never dispatched, left exactly pending, never partial.
                        assert.strictEqual(row.status, 'pending', `item ${i} (after abort) must stay 'pending'`);
                        assert.strictEqual(
                            Number(mapping.version),
                            p.seedVersion,
                            `item ${i} (after abort) must NOT bump version`
                        );
                        assert.strictEqual(unresolved, 1, `item ${i} (after abort) conflict stays unresolved`);
                        assert.ok(!dispatched.has(p.documentId), `item ${i} (after abort) must NOT be dispatched`);
                    }
                }

                checks += 1;
                return true;
            }
        ),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Higher-concurrency anchor: active limit pinned to 3, 9 items, denied at index 4.
    //   group0 = [0,1,2]  -> all sent
    //   group1 = [3,4,5]  -> 3 and 5 settle-as-sent (written before abort), 4 denied
    //   abort after group1 settles -> group2 = [6,7,8] never dispatched (stay pending)
    // Demonstrates: siblings already written within the aborting group keep their side
    // effects; the denied item does not; later groups are left pending.
    // -----------------------------------------------------------------------
    {
        const db = createSyncDb();
        const mock = sharedMock;
        mock.reset();

        const prepared = [];
        for (let i = 0; i < 9; i += 1) {
            prepared.push(
                seedPrepared(db, mock, {
                    table: 'settings',
                    localId: 5000 + i,
                    seq: i,
                    seedVersion: 7,
                    behavior: i === 4 ? 'denied' : 'success'
                })
            );
        }

        const rateLimiter = createRateLimiter({ initialConcurrency: 3, maxConcurrency: 3 });
        const result = await flushPreparedItemsConcurrent(db, mock.db, prepared, MAX_RETRIES, null, rateLimiter);

        assert.strictEqual(result.abort, true, 'anchor: cycle aborts on access-denied');

        const dispatched = mock.dispatchedSet;
        const sentIdx = [0, 1, 2, 3, 5];
        const pendingAfterIdx = [6, 7, 8];

        for (const i of sentIdx) {
            const p = prepared[i];
            assert.strictEqual(getOutboxRow(db, p.entryId).status, 'sent', `anchor item ${i} must be sent (written before abort)`);
            assert.strictEqual(Number(getIdMap(db, p.rowSyncId).version), 8, `anchor item ${i} version bumped`);
            assert.ok(dispatched.has(p.documentId), `anchor item ${i} dispatched`);
        }
        // Denied item 4.
        assert.strictEqual(getOutboxRow(db, prepared[4].entryId).status, 'pending', 'anchor denied item pending');
        assert.strictEqual(Number(getIdMap(db, prepared[4].rowSyncId).version), 7, 'anchor denied item version untouched');
        assert.ok(dispatched.has(prepared[4].documentId), 'anchor denied item dispatched then failed guard');
        // Later group never dispatched.
        for (const i of pendingAfterIdx) {
            const p = prepared[i];
            assert.strictEqual(getOutboxRow(db, p.entryId).status, 'pending', `anchor item ${i} stays pending`);
            assert.strictEqual(Number(getIdMap(db, p.rowSyncId).version), 7, `anchor item ${i} version untouched`);
            assert.ok(!dispatched.has(p.documentId), `anchor item ${i} not dispatched`);
        }
        assert.strictEqual(result.sentCount, 5, 'anchor: five items written before abort');
        assert.strictEqual(result.failedCount, 1, 'anchor: one denied item');
    }

    console.log(`[pass] Property 16 held across ${checks} generated cycles + concurrency anchor (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 16', err && err.stack ? err.stack : err);
    process.exit(1);
});

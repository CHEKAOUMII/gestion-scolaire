'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 9.8 — Property 15: Side-effect equivalence regardless of push path
//
// **Validates: Requirements 4.7, 5.3, 7.7**
//
// MODEL-BASED. The SAME generated items + remote state are pushed two ways, each on its
// OWN identically-seeded in-memory DB and its OWN recording mock Firestore, by driving the
// REAL exported dispatch functions through the EXACT `flushSyncOutbox` buffer-flush gate:
//   - ENABLED  (Layer 2 on):  runBatchedFastPath -> survivors committed via writeBatch
//                             (preSent), the rest flow into flushPreparedItemsConcurrent.
//   - DISABLED (Layer 2 off): flushPreparedItemsConcurrent over every item (no bulk-read,
//                             no writeBatch).
// After both settle the test asserts the OBSERVABLE DB side effects are equivalent:
//   - sync_outbox status per entry
//   - sync_id_map version per row
//   - sync_conflicts (per-entry unresolved + total counts)
//   - the syncLog batch compared as a SET of document ids
// i.e. an item successfully sent has identical markEntrySent side effects and syncLog entry
// whether it was committed by the Batched Fast Path or dispatched through the per-document
// Layer 1 path (the no-conflict survivors are the items that travel different physical paths
// between the two runs, yet must land in the same observable state).
//
// Feature: sync-push-throughput-optimization, Property 15: For any item successfully sent,
// the markEntrySent side effects and the syncLog entry are identical whether the item was
// committed via the Batched_Fast_Path, dispatched through the Layer 1 transaction, or
// produced by bulk expansion — matching the single-item reference path.

const assert = require('assert');
const fc = require('fast-check');

const { createMockFirestore, syncLogIdSet } = require('./fixtures/sync-fast-path-firestore');

const {
    resolvePushTuning,
    createRateLimiter,
    runBatchedFastPath,
    flushPreparedItemsConcurrent
} = require('../main/sync/engine');

const {
    createSyncDb,
    dbKind,
    seedOutboxRow,
    seedIdMap,
    getOutboxRow,
    getIdMap,
    countConflicts,
    getUnresolvedConflictsForEntry
} = require('./fixtures/sync-outbox-db');

const MIN_RUNS = 120;
const MAX_RETRIES = 10;
const SCHOOL_ID = 'SCHOOL1';
const COLL = `schools/${SCHOOL_ID}/settings`;

// The classes that physically travel different paths between the two runs. The two
// SUCCESS classes are the "no-conflict survivors" (fast-path committed vs. Layer-1 sent);
// the conflict classes are included to show equivalence holds across the whole mix.
const CLS = {
    SUCCESS_NEW: 'success-remote-absent',     // remote absent
    SUCCESS_LOWER: 'success-remote-lower',    // remote present, vR < vL
    EQUIV: 'equivalent-conflict',             // remote vR >= vL, byte-equivalent
    NONEQUIV: 'nonequivalent-conflict'        // remote vR >= vL, different payload
};

const itemArb = fc.record({
    cls: fc.constantFrom(...Object.values(CLS)),
    localVersion: fc.integer({ min: 1, max: 50 }),
    idMapVersion: fc.integer({ min: 1, max: 50 }),   // > 0 -> reconcile falls through deterministically
    remoteDelta: fc.integer({ min: 0, max: 20 }),    // remote = local + delta for conflict classes
    lowerGap: fc.integer({ min: 1, max: 20 }),       // remote = max(0, local - gap) for SUCCESS_LOWER
    payload: fc.integer({ min: 0, max: 1000 })
});

const scenarioArb = fc.array(itemArb, { minLength: 0, maxLength: 18 });

function planItem(spec, index) {
    const documentId = `doc-${index}`;
    const rowSyncId = `${SCHOOL_ID}:settings:${index}`;
    const localData = { id: index, value: `v${spec.payload}`, school_year: '2025/2026' };
    const item = {
        collectionPath: COLL,
        documentId,
        entityType: 'setting',
        entityId: documentId,
        data: localData,
        version: spec.localVersion,
        operation: 'PUT',
        rowSyncId,
        deviceHash: 'devLOCAL000000aa',
        schoolYear: '2025/2026',
        updatedAt: 1726000000 + index
    };

    let remoteDoc = null;
    const remoteVersion = spec.localVersion + spec.remoteDelta; // >= local
    switch (spec.cls) {
        case CLS.SUCCESS_NEW:
            break; // no remote
        case CLS.SUCCESS_LOWER:
            remoteDoc = { path: COLL, id: documentId, data: { ...localData, value: 'stale-remote', version: Math.max(0, spec.localVersion - spec.lowerGap) } };
            break;
        case CLS.EQUIV:
            remoteDoc = {
                path: COLL, id: documentId,
                data: { ...localData, version: remoteVersion, operation: 'PUT', rowSyncId, deviceHash: 'devREMOTE0000bb', schoolYear: '2025/2026', updatedAt: 1700000000 }
            };
            break;
        case CLS.NONEQUIV:
            remoteDoc = {
                path: COLL, id: documentId,
                data: { value: 'remote-different-content', extra: 'remote-only-field', version: remoteVersion, rowSyncId, deviceHash: 'devREMOTE0000bb' }
            };
            break;
        default:
            throw new Error(`unhandled class ${spec.cls}`);
    }
    return { spec, index, documentId, rowSyncId, localData, item, remoteDoc };
}

function seedDb(db, plans) {
    const prepared = [];
    for (const plan of plans) {
        seedIdMap(db, {
            rowSyncId: plan.rowSyncId,
            tableName: 'settings',
            localId: plan.index,
            version: plan.spec.idMapVersion,
            ancestorData: JSON.stringify({ value: 'ancestor' })
        });
        const entryId = seedOutboxRow(db, {
            tableName: 'settings',
            rowSyncId: plan.rowSyncId,
            rowData: JSON.stringify(plan.localData),
            retries: 0
        });
        prepared.push({ entryId, tableName: 'settings', item: plan.item, _plan: plan });
    }
    return prepared;
}

function makeLimiter() {
    const limiter = createRateLimiter({ initialConcurrency: 5, maxConcurrency: 10 });
    limiter.backoffDelayMs = () => 0; // timing is irrelevant to side-effect equivalence
    return limiter;
}

// The EXACT flushBuffer gate from flushSyncOutbox, parameterised on `tuning`.
async function dispatchViaGate(tuning, db, firestoreDb, items, rateLimiter) {
    let dispatchItems = items;
    let preSentItems = [];
    if (tuning.batchedFastPathEnabled) {
        const fastPath = await runBatchedFastPath(db, firestoreDb, items, { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID });
        preSentItems = fastPath.sentItems;
        dispatchItems = fastPath.guardRoutedItems;
    }
    return flushPreparedItemsConcurrent(db, firestoreDb, dispatchItems, MAX_RETRIES, SCHOOL_ID, rateLimiter, preSentItems);
}

const ENABLED = resolvePushTuning({ push_batched_fast_path_enabled: true });
const DISABLED = resolvePushTuning({ push_batched_fast_path_enabled: false });

console.log('[pbt] sync-push-throughput Property 15: side-effect equivalence regardless of push path');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (specs) => {
            const plans = specs.map((s, i) => planItem(s, i));
            const remoteDocs = plans.filter((p) => p.remoteDoc).map((p) => p.remoteDoc);

            // --- ENABLED run (fast path + Layer 1 residual). ---
            const dbEn = createSyncDb();
            backing = dbKind(dbEn);
            const preparedEn = seedDb(dbEn, plans);
            const fsEn = createMockFirestore({ docs: remoteDocs.map((d) => ({ ...d, data: { ...d.data } })) });
            const resEn = await dispatchViaGate(ENABLED, dbEn, fsEn, preparedEn, makeLimiter());

            // --- DISABLED run (Layer 1 only). ---
            const dbDis = createSyncDb();
            const preparedDis = seedDb(dbDis, plans);
            const fsDis = createMockFirestore({ docs: remoteDocs.map((d) => ({ ...d, data: { ...d.data } })) });
            const resDis = await dispatchViaGate(DISABLED, dbDis, fsDis, preparedDis, makeLimiter());

            // Aggregate sent/failed counts must agree.
            assert.strictEqual(resEn.sentCount, resDis.sentCount, `sentCount mismatch (enabled=${resEn.sentCount}, disabled=${resDis.sentCount})`);
            assert.strictEqual(resEn.failedCount, resDis.failedCount, `failedCount mismatch (enabled=${resEn.failedCount}, disabled=${resDis.failedCount})`);

            // Per-entry observable side effects must be identical.
            for (let i = 0; i < plans.length; i += 1) {
                const plan = plans[i];
                const entryEn = preparedEn[i].entryId;
                const entryDis = preparedDis[i].entryId;

                assert.strictEqual(
                    getOutboxRow(dbEn, entryEn).status,
                    getOutboxRow(dbDis, entryDis).status,
                    `outbox status mismatch for ${plan.documentId} (class ${plan.spec.cls})`
                );
                assert.strictEqual(
                    Number(getIdMap(dbEn, plan.rowSyncId).version),
                    Number(getIdMap(dbDis, plan.rowSyncId).version),
                    `sync_id_map version mismatch for ${plan.documentId} (class ${plan.spec.cls})`
                );
                assert.strictEqual(
                    getUnresolvedConflictsForEntry(dbEn, entryEn).length,
                    getUnresolvedConflictsForEntry(dbDis, entryDis).length,
                    `unresolved conflict count mismatch for ${plan.documentId} (class ${plan.spec.cls})`
                );
            }

            // Total conflict counts must agree.
            assert.strictEqual(countConflicts(dbEn), countConflicts(dbDis), 'total conflict count mismatch');
            assert.strictEqual(countConflicts(dbEn, 'unresolved'), countConflicts(dbDis, 'unresolved'), 'unresolved conflict count mismatch');

            // syncLog batch contents must agree as a set of document ids.
            const enSet = [...syncLogIdSet(fsEn)].sort();
            const disSet = [...syncLogIdSet(fsDis)].sort();
            assert.deepStrictEqual(enSet, disSet, 'syncLog batch document-id set mismatch between push paths');

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors.
    // -----------------------------------------------------------------------
    async function runBoth(specs) {
        const plans = specs.map((s, i) => planItem(s, i));
        const remoteDocs = plans.filter((p) => p.remoteDoc).map((p) => p.remoteDoc);

        const dbEn = createSyncDb();
        const preparedEn = seedDb(dbEn, plans);
        const fsEn = createMockFirestore({ docs: remoteDocs.map((d) => ({ ...d, data: { ...d.data } })) });
        await dispatchViaGate(ENABLED, dbEn, fsEn, preparedEn, makeLimiter());

        const dbDis = createSyncDb();
        const preparedDis = seedDb(dbDis, plans);
        const fsDis = createMockFirestore({ docs: remoteDocs.map((d) => ({ ...d, data: { ...d.data } })) });
        await dispatchViaGate(DISABLED, dbDis, fsDis, preparedDis, makeLimiter());

        return { plans, dbEn, dbDis, fsEn, fsDis, preparedEn, preparedDis };
    }

    // Anchor A: pure no-conflict survivors — committed by the fast path (enabled) vs sent by
    // Layer 1 (disabled). Both runs must reach identical sent state + syncLog set, and the
    // enabled run must have actually used a writeBatch.
    {
        const specs = [
            { cls: CLS.SUCCESS_LOWER, localVersion: 9, idMapVersion: 4, remoteDelta: 0, lowerGap: 3, payload: 1 },
            { cls: CLS.SUCCESS_NEW, localVersion: 5, idMapVersion: 2, remoteDelta: 0, lowerGap: 1, payload: 2 },
            { cls: CLS.SUCCESS_LOWER, localVersion: 7, idMapVersion: 3, remoteDelta: 0, lowerGap: 2, payload: 3 }
        ];
        const { plans, dbEn, dbDis, fsEn, fsDis, preparedEn, preparedDis } = await runBoth(specs);
        for (let i = 0; i < plans.length; i += 1) {
            assert.strictEqual(getOutboxRow(dbEn, preparedEn[i].entryId).status, 'sent', 'anchor A: enabled survivor sent');
            assert.strictEqual(getOutboxRow(dbDis, preparedDis[i].entryId).status, 'sent', 'anchor A: disabled survivor sent');
            assert.strictEqual(
                Number(getIdMap(dbEn, plans[i].rowSyncId).version),
                Number(getIdMap(dbDis, plans[i].rowSyncId).version),
                'anchor A: id_map version equal'
            );
        }
        assert.ok(fsEn.writeBatchCount > 0, 'anchor A: enabled run used writeBatch for the survivors');
        assert.strictEqual(fsDis.writeBatchCount, 0, 'anchor A: disabled run used no writeBatch');
        assert.deepStrictEqual([...syncLogIdSet(fsEn)].sort(), [...syncLogIdSet(fsDis)].sort(), 'anchor A: syncLog sets equal');
    }

    // Anchor B: empty input — both runs no-op identically.
    {
        const { dbEn, dbDis, fsEn, fsDis } = await runBoth([]);
        assert.strictEqual(countConflicts(dbEn), countConflicts(dbDis), 'anchor B: no conflicts either side');
        assert.strictEqual(syncLogIdSet(fsEn).size, 0, 'anchor B: enabled syncLog empty');
        assert.strictEqual(syncLogIdSet(fsDis).size, 0, 'anchor B: disabled syncLog empty');
    }

    // Anchor C: a non-equivalent conflict reaches the guard in BOTH runs -> identical
    // unresolved conflict and unchanged id_map version.
    {
        const specs = [{ cls: CLS.NONEQUIV, localVersion: 4, idMapVersion: 3, remoteDelta: 1, lowerGap: 1, payload: 9 }];
        const { plans, dbEn, dbDis, preparedEn, preparedDis } = await runBoth(specs);
        assert.strictEqual(
            getUnresolvedConflictsForEntry(dbEn, preparedEn[0].entryId).length,
            getUnresolvedConflictsForEntry(dbDis, preparedDis[0].entryId).length,
            'anchor C: unresolved conflict count equal'
        );
        assert.strictEqual(
            Number(getIdMap(dbEn, plans[0].rowSyncId).version),
            Number(getIdMap(dbDis, plans[0].rowSyncId).version),
            'anchor C: id_map version unchanged equally'
        );
    }

    console.log(`[pass] Property 15 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 15', err && err.stack ? err.stack : err);
    process.exit(1);
});

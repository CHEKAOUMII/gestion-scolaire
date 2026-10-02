'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.2 — Property 5: Parallel dispatch matches the sequential reference
//
// **Validates: Requirements 1.2, 1.3**
//
// MODEL-BASED. The SAME generated set of prepared items is run against BOTH the
// REAL exported push paths:
//   - `flushPreparedItems`            (the sequential per-document reference)
//   - `flushPreparedItemsConcurrent`  (the Layer 1 bounded-concurrency dispatcher)
// Each path runs against its OWN identically-seeded in-memory DB instance and its
// OWN identically-seeded deterministic mock Firestore (same remote documents, same
// per-document injected errors). After both settle, the test asserts OBSERVABLE
// EQUIVALENCE:
//   - same sentCount / failedCount
//   - same final sync_outbox row status per entry
//   - same sync_id_map version per row
//   - same number of logged (unresolved) conflicts, per entry and overall
//   - same syncLog batch contents, compared as a set of document ids
// Both paths apply the Version_Guard (the real `writeItemWithVersionCheck`) to
// every item via the shared `applyItemOutcome`.
//
// DOMAIN NOTE: the access-denied class is intentionally excluded from this
// equivalence property. By design the sequential path aborts IMMEDIATELY after the
// denied item (skipping remaining items and the syncLog write), whereas the Layer 1
// path lets the current group fully settle before aborting (Req 1.4 / Req 4.5).
// That deliberate timing difference is covered by Property 6 (settlement) and
// Property 16 (abort side effects); mixing it in here would compare two paths that
// are SPECIFIED to differ. Every other terminal outcome (sent, equivalent-conflict
// accepted, reconciled-to-conflict-logged, throttled, generic failure) is included.
//
// Feature: sync-push-throughput-optimization, Property 5: For any set of prepared
// items and any fixed deterministic remote state, dispatching through the
// Concurrency_Controller produces the same multiset of per-item terminal outcomes
// (sent, equivalent-conflict accepted, reconciled, failed) and the same final
// sync_outbox, sync_id_map, and sync_conflicts state as the original sequential
// per-document implementation, with the Version_Guard applied to every item.

const assert = require('assert');
const fc = require('fast-check');

// IMPORTANT: install the firestore + sync-log mocks BEFORE requiring the engine,
// so engine.js captures the mock `doc` / `runTransaction` / `logChangeBatch`.
const {
    createMockFirestore,
    getSyncLogEntries
} = require('./fixtures/sync-push-equiv-firestore');

const {
    flushPreparedItems,
    flushPreparedItemsConcurrent,
    createRateLimiter
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

// Per-item terminal outcome classes (access-denied deliberately excluded — see header).
const CLASS = {
    SUCCESS_NEW: 'success-remote-absent',
    SUCCESS_LOWER: 'success-remote-lower-version',
    EQUIV: 'equivalent-conflict',
    NONEQUIV: 'nonequivalent-conflict',
    THROTTLE: 'throttle',
    GENERIC_FAIL: 'generic-failure'
};

const THROTTLE_CODES = ['resource-exhausted', 'unavailable', 'aborted'];

const itemArb = fc.record({
    cls: fc.constantFrom(...Object.values(CLASS)),
    localVersion: fc.integer({ min: 1, max: 50 }),
    idMapVersion: fc.integer({ min: 1, max: 50 }), // > 0 → reconcile falls through deterministically
    remoteDelta: fc.integer({ min: 0, max: 20 }), // remote = local + delta for conflict classes
    lowerGap: fc.integer({ min: 1, max: 20 }), // remote = local - gap for SUCCESS_LOWER
    payload: fc.integer({ min: 0, max: 1000 }),
    throttleCode: fc.constantFrom(...THROTTLE_CODES),
    table: fc.constantFrom('settings', 'compensation_tracking', 'system_tags')
});

const scenarioArb = fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 18 }),
    initialConcurrency: fc.integer({ min: 1, max: 6 }),
    maxConcurrency: fc.integer({ min: 1, max: 8 })
});

// Build the per-item plan: a distinct document id/rowSyncId, the prepared record,
// the remote doc seed (if any), and the injected transaction error (if any).
function planItem(spec, index) {
    const table = spec.table;
    const collectionPath = `schools/${SCHOOL_ID}/${table}`;
    const documentId = `doc-${index}`;
    const rowSyncId = `${SCHOOL_ID}:${table}:${index}`;
    const localData = { id: index, value: `v${spec.payload}`, school_year: '2025/2026' };

    const item = {
        collectionPath,
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

    const plan = {
        spec,
        index,
        table,
        collectionPath,
        documentId,
        rowSyncId,
        localData,
        item,
        remoteDoc: null, // { path, id, data }
        error: null // { path, id, code }
    };

    const remoteVersion = spec.localVersion + spec.remoteDelta; // >= local
    switch (spec.cls) {
        case CLASS.SUCCESS_NEW:
            // No remote doc → guard writes → success.
            break;
        case CLASS.SUCCESS_LOWER: {
            // Remote present but strictly older → guard writes → success.
            const rv = Math.max(0, spec.localVersion - spec.lowerGap);
            if (rv >= spec.localVersion) {
                // degenerate (localVersion 1, gap forces 0) — fine, rv < local guaranteed by max(0,..) only if local>gap
            }
            plan.remoteDoc = {
                path: collectionPath,
                id: documentId,
                data: { ...localData, value: 'stale-remote', version: rv }
            };
            break;
        }
        case CLASS.EQUIV:
            // Remote >= local AND byte-equivalent payload → equivalent-conflict accepted.
            plan.remoteDoc = {
                path: collectionPath,
                id: documentId,
                data: {
                    ...localData,
                    version: remoteVersion,
                    operation: 'PUT',
                    rowSyncId,
                    deviceHash: 'devREMOTE0000bb',
                    schoolYear: '2025/2026',
                    updatedAt: 1700000000
                }
            };
            break;
        case CLASS.NONEQUIV:
            // Remote >= local AND different payload → conflict logged (idMap version > 0
            // ⇒ reconcileUnreconciledRow returns handled:false).
            plan.remoteDoc = {
                path: collectionPath,
                id: documentId,
                data: {
                    value: 'remote-different-content',
                    extra: 'remote-only-field',
                    version: remoteVersion,
                    rowSyncId,
                    deviceHash: 'devREMOTE0000bb'
                }
            };
            break;
        case CLASS.THROTTLE:
            plan.error = { path: collectionPath, id: documentId, code: spec.throttleCode };
            break;
        case CLASS.GENERIC_FAIL:
            plan.error = { path: collectionPath, id: documentId, code: 'internal' };
            break;
        default:
            throw new Error(`unhandled class ${spec.cls}`);
    }

    return plan;
}

// Seed a fresh DB instance from the plans; returns the array of prepared records.
function seedDb(db, plans) {
    const prepared = [];
    for (const plan of plans) {
        seedIdMap(db, {
            rowSyncId: plan.rowSyncId,
            tableName: plan.table,
            localId: plan.index,
            version: plan.spec.idMapVersion,
            ancestorData: JSON.stringify({ value: 'ancestor' })
        });
        const entryId = seedOutboxRow(db, {
            tableName: plan.table,
            rowSyncId: plan.rowSyncId,
            rowData: JSON.stringify(plan.localData),
            retries: 0
        });
        prepared.push({ entryId, tableName: plan.table, item: plan.item });
    }
    return prepared;
}

function buildFirestore(plans) {
    return createMockFirestore({
        docs: plans.filter((p) => p.remoteDoc).map((p) => p.remoteDoc),
        errors: plans.filter((p) => p.error).map((p) => p.error)
    });
}

function syncLogIdSet(firestoreDb) {
    return new Set(getSyncLogEntries(firestoreDb).map((e) => `${e.collectionPath}/${e.documentId}`));
}

function multisetSorted(set) {
    return [...set].sort();
}

console.log('[pbt] sync-push-throughput Property 5: parallel dispatch matches the sequential reference');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
            const plans = scenario.items.map((spec, i) => planItem(spec, i));

            // --- Reference (sequential) path: own DB + own mock firestore ---
            const dbRef = createSyncDb();
            backing = dbKind(dbRef);
            const preparedRef = seedDb(dbRef, plans);
            const fsRef = buildFirestore(plans);
            const refResult = await flushPreparedItems(
                dbRef,
                fsRef,
                preparedRef,
                MAX_RETRIES,
                SCHOOL_ID
            );

            // --- Layer 1 (concurrent) path: own DB + own mock firestore ---
            const dbCon = createSyncDb();
            const preparedCon = seedDb(dbCon, plans);
            const fsCon = buildFirestore(plans);

            const maxConcurrency = Math.max(scenario.initialConcurrency, scenario.maxConcurrency);
            const limiter = createRateLimiter({
                initialConcurrency: scenario.initialConcurrency,
                maxConcurrency
            });
            // Neutralize real back-off sleeps — timing is not what this property checks
            // (Property 9 owns the back-off formula). Observable DB state is unaffected.
            limiter.backoffDelayMs = () => 0;

            const conResult = await flushPreparedItemsConcurrent(
                dbCon,
                fsCon,
                preparedCon,
                MAX_RETRIES,
                SCHOOL_ID,
                limiter
            );

            // --- 1. Aggregate counts equal ---
            assert.strictEqual(
                conResult.sentCount,
                refResult.sentCount,
                `sentCount mismatch (ref=${refResult.sentCount}, con=${conResult.sentCount})`
            );
            assert.strictEqual(
                conResult.failedCount,
                refResult.failedCount,
                `failedCount mismatch (ref=${refResult.failedCount}, con=${conResult.failedCount})`
            );
            // Neither path aborts (no access-denied in the domain).
            assert.strictEqual(refResult.abort, false, 'reference path must not abort');
            assert.strictEqual(conResult.abort, false, 'concurrent path must not abort');

            // --- 2. Per-entry sync_outbox status + sync_id_map version equal ---
            for (const plan of plans) {
                const entryId = preparedRef[plan.index].entryId;
                const rowRef = getOutboxRow(dbRef, entryId);
                const rowCon = getOutboxRow(dbCon, entryId);
                assert.strictEqual(
                    rowCon.status,
                    rowRef.status,
                    `outbox status mismatch for ${plan.rowSyncId} (class ${plan.spec.cls}): ref=${rowRef.status} con=${rowCon.status}`
                );

                const mapRef = getIdMap(dbRef, plan.rowSyncId);
                const mapCon = getIdMap(dbCon, plan.rowSyncId);
                assert.strictEqual(
                    Number(mapCon.version),
                    Number(mapRef.version),
                    `sync_id_map version mismatch for ${plan.rowSyncId} (class ${plan.spec.cls})`
                );

                // Per-entry unresolved-conflict count equal.
                assert.strictEqual(
                    getUnresolvedConflictsForEntry(dbCon, entryId).length,
                    getUnresolvedConflictsForEntry(dbRef, entryId).length,
                    `unresolved conflict count mismatch for entry ${entryId} (class ${plan.spec.cls})`
                );
            }

            // --- 3. Total conflicts logged equal ---
            assert.strictEqual(
                countConflicts(dbCon),
                countConflicts(dbRef),
                'total conflict count mismatch'
            );
            assert.strictEqual(
                countConflicts(dbCon, 'unresolved'),
                countConflicts(dbRef, 'unresolved'),
                'unresolved conflict count mismatch'
            );

            // --- 4. syncLog batch contents equal (compared as a set of doc ids) ---
            assert.deepStrictEqual(
                multisetSorted(syncLogIdSet(fsCon)),
                multisetSorted(syncLogIdSet(fsRef)),
                'syncLog batch document-id set mismatch'
            );

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors — explicit small scenarios for fast, readable coverage.
    // -----------------------------------------------------------------------
    async function runBoth(plans, initial, max) {
        const dbRef = createSyncDb();
        const preparedRef = seedDb(dbRef, plans);
        const fsRef = buildFirestore(plans);
        const refResult = await flushPreparedItems(dbRef, fsRef, preparedRef, MAX_RETRIES, SCHOOL_ID);

        const dbCon = createSyncDb();
        const preparedCon = seedDb(dbCon, plans);
        const fsCon = buildFirestore(plans);
        const limiter = createRateLimiter({ initialConcurrency: initial, maxConcurrency: max });
        limiter.backoffDelayMs = () => 0;
        const conResult = await flushPreparedItemsConcurrent(dbCon, fsCon, preparedCon, MAX_RETRIES, SCHOOL_ID, limiter);

        return { dbRef, dbCon, fsRef, fsCon, refResult, conResult, preparedRef };
    }

    // Anchor A: a mixed group of every included class, concurrency 3.
    {
        const specs = [
            { cls: CLASS.SUCCESS_NEW, localVersion: 5, idMapVersion: 4, remoteDelta: 0, lowerGap: 1, payload: 1, throttleCode: 'unavailable', table: 'settings' },
            { cls: CLASS.EQUIV, localVersion: 3, idMapVersion: 2, remoteDelta: 2, lowerGap: 1, payload: 2, throttleCode: 'aborted', table: 'settings' },
            { cls: CLASS.NONEQUIV, localVersion: 4, idMapVersion: 3, remoteDelta: 1, lowerGap: 1, payload: 3, throttleCode: 'unavailable', table: 'system_tags' },
            { cls: CLASS.THROTTLE, localVersion: 6, idMapVersion: 5, remoteDelta: 0, lowerGap: 1, payload: 4, throttleCode: 'resource-exhausted', table: 'settings' },
            { cls: CLASS.GENERIC_FAIL, localVersion: 7, idMapVersion: 6, remoteDelta: 0, lowerGap: 1, payload: 5, throttleCode: 'unavailable', table: 'compensation_tracking' },
            { cls: CLASS.SUCCESS_LOWER, localVersion: 9, idMapVersion: 8, remoteDelta: 0, lowerGap: 3, payload: 6, throttleCode: 'unavailable', table: 'settings' }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const { refResult, conResult, dbRef, dbCon, fsRef, fsCon } = await runBoth(plans, 3, 6);
        assert.strictEqual(conResult.sentCount, refResult.sentCount, 'anchor A sentCount');
        assert.strictEqual(conResult.failedCount, refResult.failedCount, 'anchor A failedCount');
        // 2 successes (NEW + LOWER) + 1 equivalent-accepted = 3 sent.
        assert.strictEqual(refResult.sentCount, 3, 'anchor A expected 3 sent');
        assert.strictEqual(countConflicts(dbCon), countConflicts(dbRef), 'anchor A conflicts');
        assert.deepStrictEqual(multisetSorted(syncLogIdSet(fsCon)), multisetSorted(syncLogIdSet(fsRef)), 'anchor A syncLog set');
        // Only the two plain successes are in the syncLog batch (equivalent-accepted is NOT).
        assert.strictEqual(syncLogIdSet(fsRef).size, 2, 'anchor A syncLog has exactly the 2 plain successes');
    }

    // Anchor B: empty input — both paths no-op identically.
    {
        const { refResult, conResult, fsRef, fsCon } = await runBoth([], 1, 1);
        assert.strictEqual(refResult.sentCount, 0);
        assert.strictEqual(conResult.sentCount, 0);
        assert.strictEqual(syncLogIdSet(fsRef).size, 0);
        assert.strictEqual(syncLogIdSet(fsCon).size, 0);
    }

    // Anchor C: concurrency 1 must behave identically to the sequential reference.
    {
        const specs = [
            { cls: CLASS.SUCCESS_NEW, localVersion: 2, idMapVersion: 1, remoteDelta: 0, lowerGap: 1, payload: 1, throttleCode: 'unavailable', table: 'settings' },
            { cls: CLASS.NONEQUIV, localVersion: 2, idMapVersion: 1, remoteDelta: 3, lowerGap: 1, payload: 2, throttleCode: 'unavailable', table: 'settings' }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const { refResult, conResult, dbRef, dbCon } = await runBoth(plans, 1, 1);
        assert.strictEqual(conResult.sentCount, refResult.sentCount, 'anchor C sentCount');
        assert.strictEqual(conResult.failedCount, refResult.failedCount, 'anchor C failedCount');
        assert.strictEqual(countConflicts(dbCon, 'unresolved'), countConflicts(dbRef, 'unresolved'), 'anchor C unresolved conflicts');
    }

    console.log(`[pass] Property 5 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 5', err && err.stack ? err.stack : err);
    process.exit(1);
});

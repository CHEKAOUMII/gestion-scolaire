'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.3 — Property 7: syncLog batch equals the sent set
//
// **Validates: Requirements 1.5**
//
// Drives the REAL exported Layer 1 dispatcher `flushPreparedItemsConcurrent` against
// a deterministic mock Firestore (real `writeItemWithVersionCheck` + a capturing
// `logChangeBatch`). For an arbitrary settled group it asserts that the multiset of
// items handed to the syncLog batch (`writeSyncLogWithRetry` → `logChangeBatch`)
// equals EXACTLY the set of items marked sent via the SUCCESS path.
//
// KEY DISTINCTION (per the property + Req 4.2): an EQUIVALENT-conflict item is
// "sent" (it bumps sentCount and is marked sent in sync_outbox) but is NOT collected
// for the syncLog batch — only items that took the plain `result.success` branch are
// logged. The test therefore proves a two-sided equality:
//   syncLog batch  ==  { plain-success items }
//   syncLog batch  ⊉  { equivalent-conflict items }        (sent, but excluded)
//   sentCount      ==  |plain-success| + |equivalent-conflict|
//
// Feature: sync-push-throughput-optimization, Property 7: For any settled group, the
// multiset of items passed to writeSyncLogWithRetry equals exactly the multiset of
// items marked sent in that group.

const assert = require('assert');
const fc = require('fast-check');

// Install firestore + sync-log mocks BEFORE requiring the engine.
const {
    createMockFirestore,
    getSyncLogEntries,
    getSyncLogBatchCount
} = require('./fixtures/sync-push-equiv-firestore');

const {
    flushPreparedItemsConcurrent,
    flushPreparedItems,
    createRateLimiter
} = require('../main/sync/engine');

const {
    createSyncDb,
    dbKind,
    seedOutboxRow,
    seedIdMap,
    getOutboxRow
} = require('./fixtures/sync-outbox-db');

const MIN_RUNS = 150;
const MAX_RETRIES = 10;
const SCHOOL_ID = 'SCHOOL1';

const CLASS = {
    SUCCESS_NEW: 'success-remote-absent', // plain success → IN syncLog
    SUCCESS_LOWER: 'success-remote-lower', // plain success → IN syncLog
    EQUIV: 'equivalent-conflict', // sent, but NOT in syncLog
    NONEQUIV: 'nonequivalent-conflict', // not sent
    THROTTLE: 'throttle', // not sent
    GENERIC_FAIL: 'generic-failure' // not sent
};

// Classes that take the plain `result.success` branch (collected for syncLog).
const PLAIN_SUCCESS = new Set([CLASS.SUCCESS_NEW, CLASS.SUCCESS_LOWER]);
// Classes that count as sent (marked sent in sync_outbox) — plain success + equivalent.
const SENT = new Set([CLASS.SUCCESS_NEW, CLASS.SUCCESS_LOWER, CLASS.EQUIV]);

const THROTTLE_CODES = ['resource-exhausted', 'unavailable', 'aborted'];

const itemArb = fc.record({
    cls: fc.constantFrom(...Object.values(CLASS)),
    localVersion: fc.integer({ min: 2, max: 40 }),
    idMapVersion: fc.integer({ min: 1, max: 40 }),
    remoteDelta: fc.integer({ min: 0, max: 15 }),
    lowerGap: fc.integer({ min: 1, max: 1 }),
    payload: fc.integer({ min: 0, max: 1000 }),
    throttleCode: fc.constantFrom(...THROTTLE_CODES),
    table: fc.constantFrom('settings', 'system_tags', 'compensation_tracking')
});

const scenarioArb = fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 20 }),
    initialConcurrency: fc.integer({ min: 1, max: 6 }),
    maxConcurrency: fc.integer({ min: 1, max: 8 })
});

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

    const plan = { spec, index, table, collectionPath, documentId, rowSyncId, localData, item, remoteDoc: null, error: null };
    const remoteVersion = spec.localVersion + spec.remoteDelta;

    switch (spec.cls) {
        case CLASS.SUCCESS_NEW:
            break;
        case CLASS.SUCCESS_LOWER:
            plan.remoteDoc = { path: collectionPath, id: documentId, data: { ...localData, value: 'stale', version: spec.localVersion - spec.lowerGap } };
            break;
        case CLASS.EQUIV:
            plan.remoteDoc = {
                path: collectionPath,
                id: documentId,
                data: { ...localData, version: remoteVersion, operation: 'PUT', rowSyncId, deviceHash: 'devREMOTE0000bb', schoolYear: '2025/2026', updatedAt: 1700000000 }
            };
            break;
        case CLASS.NONEQUIV:
            plan.remoteDoc = { path: collectionPath, id: documentId, data: { value: 'different', extra: 'x', version: remoteVersion, rowSyncId } };
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

function seedDb(db, plans) {
    const prepared = [];
    for (const plan of plans) {
        seedIdMap(db, { rowSyncId: plan.rowSyncId, tableName: plan.table, localId: plan.index, version: plan.spec.idMapVersion, ancestorData: JSON.stringify({ value: 'ancestor' }) });
        const entryId = seedOutboxRow(db, { tableName: plan.table, rowSyncId: plan.rowSyncId, rowData: JSON.stringify(plan.localData), retries: 0 });
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

const keyOf = (plan) => `${plan.collectionPath}/${plan.documentId}`;
const sorted = (set) => [...set].sort();

console.log('[pbt] sync-push-throughput Property 7: syncLog batch equals the sent set');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
            const plans = scenario.items.map((spec, i) => planItem(spec, i));

            const db = createSyncDb();
            backing = dbKind(db);
            const prepared = seedDb(db, plans);
            const firestoreDb = buildFirestore(plans);

            const maxConcurrency = Math.max(scenario.initialConcurrency, scenario.maxConcurrency);
            const limiter = createRateLimiter({ initialConcurrency: scenario.initialConcurrency, maxConcurrency });
            limiter.backoffDelayMs = () => 0; // skip real back-off sleeps; irrelevant to this property

            const result = await flushPreparedItemsConcurrent(db, firestoreDb, prepared, MAX_RETRIES, SCHOOL_ID, limiter);

            // Expected sets derived purely from the plan (the ground truth).
            const expectedSyncLog = new Set(plans.filter((p) => PLAIN_SUCCESS.has(p.spec.cls)).map(keyOf));
            const expectedSentEntryIds = new Set(
                plans.filter((p) => SENT.has(p.spec.cls)).map((p) => prepared[p.index].entryId)
            );
            const expectedEquivKeys = new Set(plans.filter((p) => p.spec.cls === CLASS.EQUIV).map(keyOf));

            // Actual syncLog batch contents (document-id set).
            const actualSyncLog = new Set(getSyncLogEntries(firestoreDb).map((e) => `${e.collectionPath}/${e.documentId}`));

            // CORE: syncLog batch == plain-success set.
            assert.deepStrictEqual(
                sorted(actualSyncLog),
                sorted(expectedSyncLog),
                'syncLog batch does not equal the plain-success sent set'
            );

            // Equivalent-conflict items are sent but EXCLUDED from the syncLog batch.
            for (const k of expectedEquivKeys) {
                assert.ok(!actualSyncLog.has(k), `equivalent-conflict item ${k} must NOT appear in the syncLog batch`);
            }

            // sentCount accounts for plain successes AND equivalent-conflict acceptances.
            assert.strictEqual(
                result.sentCount,
                expectedSentEntryIds.size,
                `sentCount (${result.sentCount}) must equal plain-success + equivalent (${expectedSentEntryIds.size})`
            );

            // Every counted-sent entry is actually marked 'sent' in sync_outbox; the
            // syncLog batch is a strict SUBSET of those sent rows (excludes equivalents).
            for (const plan of plans) {
                const entryId = prepared[plan.index].entryId;
                const row = getOutboxRow(db, entryId);
                if (SENT.has(plan.spec.cls)) {
                    assert.strictEqual(row.status, 'sent', `sent class ${plan.spec.cls} must be 'sent' in sync_outbox`);
                }
            }
            assert.ok(
                [...actualSyncLog].every((k) => expectedSentEntryIds.size >= actualSyncLog.size),
                'syncLog batch must be a subset of the sent set'
            );

            // At most one batch write per cycle (collected once, after all groups settle);
            // zero when there were no plain successes.
            const expectBatch = expectedSyncLog.size > 0 ? 1 : 0;
            assert.strictEqual(getSyncLogBatchCount(firestoreDb), expectBatch, 'exactly one batch write iff there is a sent item to log');

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors.
    // -----------------------------------------------------------------------

    // Anchor A: equivalent-conflict is sent yet absent from the syncLog batch.
    {
        const specs = [
            { cls: CLASS.SUCCESS_NEW, localVersion: 5, idMapVersion: 4, remoteDelta: 0, lowerGap: 1, payload: 1, throttleCode: 'unavailable', table: 'settings' },
            { cls: CLASS.EQUIV, localVersion: 3, idMapVersion: 2, remoteDelta: 2, lowerGap: 1, payload: 2, throttleCode: 'unavailable', table: 'settings' }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const db = createSyncDb();
        const prepared = seedDb(db, plans);
        const fsdb = buildFirestore(plans);
        const limiter = createRateLimiter({ initialConcurrency: 2, maxConcurrency: 4 });
        const result = await flushPreparedItemsConcurrent(db, fsdb, prepared, MAX_RETRIES, SCHOOL_ID, limiter);

        assert.strictEqual(result.sentCount, 2, 'anchor A: both items count as sent');
        const ids = new Set(getSyncLogEntries(fsdb).map((e) => `${e.collectionPath}/${e.documentId}`));
        assert.strictEqual(ids.size, 1, 'anchor A: only the plain success is logged');
        assert.ok(ids.has(`${plans[0].collectionPath}/doc-0`), 'anchor A: plain success present');
        assert.ok(!ids.has(`${plans[1].collectionPath}/doc-1`), 'anchor A: equivalent-conflict absent');
    }

    // Anchor B: no plain successes (only failures + equivalents) → batch count 0,
    // but equivalents still marked sent.
    {
        const specs = [
            { cls: CLASS.EQUIV, localVersion: 3, idMapVersion: 2, remoteDelta: 1, lowerGap: 1, payload: 9, throttleCode: 'unavailable', table: 'settings' },
            { cls: CLASS.THROTTLE, localVersion: 4, idMapVersion: 3, remoteDelta: 0, lowerGap: 1, payload: 8, throttleCode: 'resource-exhausted', table: 'settings' },
            { cls: CLASS.NONEQUIV, localVersion: 4, idMapVersion: 3, remoteDelta: 2, lowerGap: 1, payload: 7, throttleCode: 'unavailable', table: 'system_tags' }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const db = createSyncDb();
        const prepared = seedDb(db, plans);
        const fsdb = buildFirestore(plans);
        const limiter = createRateLimiter({ initialConcurrency: 1, maxConcurrency: 2 });
        limiter.backoffDelayMs = () => 0;
        const result = await flushPreparedItemsConcurrent(db, fsdb, prepared, MAX_RETRIES, SCHOOL_ID, limiter);
        assert.strictEqual(getSyncLogBatchCount(fsdb), 0, 'anchor B: no batch write without a plain success');
        assert.strictEqual(getSyncLogEntries(fsdb).length, 0, 'anchor B: empty syncLog');
        assert.strictEqual(result.sentCount, 1, 'anchor B: the equivalent-conflict still counts as sent');
    }

    // Anchor C: sequential reference produces the SAME syncLog set as Layer 1 (the
    // sent-set definition is path-independent).
    {
        const specs = [
            { cls: CLASS.SUCCESS_NEW, localVersion: 5, idMapVersion: 4, remoteDelta: 0, lowerGap: 1, payload: 1, throttleCode: 'unavailable', table: 'settings' },
            { cls: CLASS.EQUIV, localVersion: 3, idMapVersion: 2, remoteDelta: 2, lowerGap: 1, payload: 2, throttleCode: 'unavailable', table: 'system_tags' },
            { cls: CLASS.SUCCESS_LOWER, localVersion: 6, idMapVersion: 5, remoteDelta: 0, lowerGap: 1, payload: 3, throttleCode: 'unavailable', table: 'settings' }
        ];
        const plans = specs.map((s, i) => planItem(s, i));

        const dbSeq = createSyncDb();
        const preparedSeq = seedDb(dbSeq, plans);
        const fsSeq = buildFirestore(plans);
        await flushPreparedItems(dbSeq, fsSeq, preparedSeq, MAX_RETRIES, SCHOOL_ID);

        const dbCon = createSyncDb();
        const preparedCon = seedDb(dbCon, plans);
        const fsCon = buildFirestore(plans);
        const limiter = createRateLimiter({ initialConcurrency: 2, maxConcurrency: 4 });
        await flushPreparedItemsConcurrent(dbCon, fsCon, preparedCon, MAX_RETRIES, SCHOOL_ID, limiter);

        const seqIds = sorted(new Set(getSyncLogEntries(fsSeq).map((e) => `${e.collectionPath}/${e.documentId}`)));
        const conIds = sorted(new Set(getSyncLogEntries(fsCon).map((e) => `${e.collectionPath}/${e.documentId}`)));
        assert.deepStrictEqual(conIds, seqIds, 'anchor C: sequential and Layer 1 produce the same syncLog set');
        assert.deepStrictEqual(conIds, [`${plans[0].collectionPath}/doc-0`, `${plans[2].collectionPath}/doc-2`].sort(), 'anchor C: only the two plain successes');
    }

    console.log(`[pass] Property 7 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 7', err && err.stack ? err.stack : err);
    process.exit(1);
});

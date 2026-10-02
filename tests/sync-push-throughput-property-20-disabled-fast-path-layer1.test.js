'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 9.7 — Property 20: Disabled fast path routes everything through Layer 1
//
// **Validates: Requirements 7.8**
//
// `flushSyncOutbox`'s buffer-flush stage decides the push path with a single gate
// (main/sync/engine.js, the `ctx.flushBuffer` closure):
//
//     let dispatchItems = ctx.batchBuffer;
//     let preSentItems = [];
//     if (tuning.batchedFastPathEnabled) {
//         const fastPath = await runBatchedFastPath(db, firestoreDb, ctx.batchBuffer, ...);
//         preSentItems   = fastPath.sentItems;
//         dispatchItems  = fastPath.guardRoutedItems;
//     }
//     await flushPreparedItemsConcurrent(db, firestoreDb, dispatchItems, ..., preSentItems);
//
// This test reproduces that exact gate, feeding `tuning` from the REAL
// `resolvePushTuning(config)`, and drives it with the SAME recording mock Firestore
// (`tests/fixtures/sync-fast-path-firestore.js`, which counts getDocs / writeBatch /
// runTransaction calls). For every config where `push_batched_fast_path_enabled` is
// false or absent it asserts the disabled push performs NO bulk-read (getDocs), NO
// writeBatch, and dispatches EVERY item through the Layer 1 per-document Version_Guard
// (one runTransaction per item). An enabled control run confirms the same inputs DO
// trigger getDocs/writeBatch — so the absence in the disabled run is meaningful.
//
// Feature: sync-push-throughput-optimization, Property 20: For any set of prepared items,
// when push_batched_fast_path_enabled is false or absent the push performs no bulk-read and
// no writeBatch, makes no version-comparison or batch-routing decision, and dispatches every
// item through the Layer 1 bounded-concurrency path.

const assert = require('assert');
const fc = require('fast-check');

const { createMockFirestore } = require('./fixtures/sync-fast-path-firestore');

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
    getOutboxRow
} = require('./fixtures/sync-outbox-db');

const MIN_RUNS = 120;
const MAX_RETRIES = 10;
const SCHOOL_ID = 'SCHOOL1';
const COLL = `schools/${SCHOOL_ID}/settings`;

// Falsey / absent flag values that MUST resolve to batchedFastPathEnabled === false.
const DISABLED_FLAGS = [undefined, null, 0, '0', false, 'false', '', 'no', 2, 'maybe'];

const itemArb = fc.record({
    localVersion: fc.integer({ min: 1, max: 50 }),
    remoteVersion: fc.integer({ min: 0, max: 50 }),
    payload: fc.integer({ min: 0, max: 1000 }),
    hasRemote: fc.boolean()
});

const scenarioArb = fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 16 }),
    flagIndex: fc.integer({ min: 0, max: DISABLED_FLAGS.length - 1 }),
    pushConcurrency: fc.integer({ min: 1, max: 6 })
});

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
    const remoteDoc = spec.hasRemote
        ? { path: COLL, id: documentId, data: { value: 'remote', version: spec.remoteVersion } }
        : null;
    return { spec, index, documentId, rowSyncId, localData, item, remoteDoc };
}

function seedDb(db, plans) {
    const prepared = [];
    for (const plan of plans) {
        seedIdMap(db, { rowSyncId: plan.rowSyncId, tableName: 'settings', localId: plan.index, version: 1 });
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
    const limiter = createRateLimiter({ initialConcurrency: 4, maxConcurrency: 8 });
    limiter.backoffDelayMs = () => 0;
    return limiter;
}

// The EXACT flushBuffer gating from flushSyncOutbox, parameterised on `tuning`.
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

console.log('[pbt] sync-push-throughput Property 20: disabled fast path routes everything through Layer 1');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
            const plans = scenario.items.map((spec, i) => planItem(spec, i));
            const remoteDocs = plans.filter((p) => p.remoteDoc).map((p) => p.remoteDoc);
            const flagValue = DISABLED_FLAGS[scenario.flagIndex];

            // Resolve tuning from a config whose fast-path flag is falsey/absent.
            const config = { push_concurrency: scenario.pushConcurrency };
            if (flagValue !== undefined) config.push_batched_fast_path_enabled = flagValue;
            const tuning = resolvePushTuning(config);

            // Precondition the property depends on: a falsey/absent flag disables Layer 2.
            assert.strictEqual(
                tuning.batchedFastPathEnabled,
                false,
                `flag ${JSON.stringify(flagValue)} must resolve batchedFastPathEnabled=false`
            );

            // --- Disabled run: drive the gate with the resolved (false) tuning. ---
            const db = createSyncDb();
            backing = dbKind(db);
            const prepared = seedDb(db, plans);
            const fs = createMockFirestore({ docs: remoteDocs });
            await dispatchViaGate(tuning, db, fs, prepared, makeLimiter());

            // 1. No bulk-read and no writeBatch were ever issued (Req 7.8).
            assert.strictEqual(fs.getDocsCalls.length, 0, 'disabled path must perform NO bulk-read (getDocs)');
            assert.strictEqual(fs.writeBatchCount, 0, 'disabled path must perform NO writeBatch');
            assert.strictEqual(fs.commitCount, 0, 'disabled path must perform NO batch commit');

            // 2. Every item was dispatched through the Layer 1 per-document Version_Guard —
            //    exactly one runTransaction per prepared item, in input order.
            assert.strictEqual(
                fs.runTransactionCount,
                prepared.length,
                'every item must open exactly one per-document Version_Guard transaction'
            );

            // 3. Sanity: a vL > vR (or remote-absent) item is sent through Layer 1, proving
            //    the dispatch actually flowed through the per-document path.
            for (const pr of prepared) {
                const p = pr._plan;
                const wrote = !p.remoteDoc || p.spec.localVersion > p.spec.remoteVersion;
                if (wrote) {
                    assert.strictEqual(getOutboxRow(db, pr.entryId).status, 'sent', `Layer 1 must send vL>vR item ${p.documentId}`);
                }
            }

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Enabled control + targeted anchors.
    // -----------------------------------------------------------------------

    // Control: identical inputs WITH the flag enabled DO trigger getDocs (and a writeBatch
    // when survivors exist) — so the disabled run's zero-counts are meaningful, not vacuous.
    {
        const plans = [
            planItem({ localVersion: 9, remoteVersion: 2, payload: 1, hasRemote: true }, 0), // survivor -> committed
            planItem({ localVersion: 3, remoteVersion: 8, payload: 2, hasRemote: true }, 1)  // conflict -> guard
        ];
        const db = createSyncDb();
        const prepared = seedDb(db, plans);
        const fs = createMockFirestore({ docs: plans.map((p) => p.remoteDoc) });
        const enabledTuning = resolvePushTuning({ push_batched_fast_path_enabled: 1 });
        assert.strictEqual(enabledTuning.batchedFastPathEnabled, true, 'control: flag 1 enables fast path');
        await dispatchViaGate(enabledTuning, db, fs, prepared, makeLimiter());
        assert.ok(fs.getDocsCalls.length > 0, 'control (enabled): a bulk read SHOULD occur');
        assert.ok(fs.writeBatchCount > 0, 'control (enabled): a writeBatch SHOULD occur for the survivor');
    }

    // Anchor: empty input, disabled — no reads, no batches, no transactions.
    {
        const db = createSyncDb();
        const fs = createMockFirestore({ docs: [] });
        const tuning = resolvePushTuning({});
        await dispatchViaGate(tuning, db, fs, [], makeLimiter());
        assert.strictEqual(fs.getDocsCalls.length, 0, 'anchor empty: no getDocs');
        assert.strictEqual(fs.writeBatchCount, 0, 'anchor empty: no writeBatch');
        assert.strictEqual(fs.runTransactionCount, 0, 'anchor empty: no transactions');
    }

    console.log(`[pass] Property 20 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 20', err && err.stack ? err.stack : err);
    process.exit(1);
});

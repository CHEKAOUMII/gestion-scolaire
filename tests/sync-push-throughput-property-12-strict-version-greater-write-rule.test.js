'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 9.6 — Property 12: Strict version-greater write rule across all paths
//
// **Validates: Requirements 4.1, 7.2, 7.4**
//
// For the SAME generated items and the SAME observed remote versions, this test
// exercises BOTH real write paths from main/sync/engine.js and asserts the identical
// strict rule governs whether a write/send happens:
//   - Batched Fast Path  (`runBatchedFastPath`): an item is committed/sent (lands in
//     `sentItems`) IFF its local version vL is strictly greater than the remote version
//     vR observed in the bulk read; vR >= vL routes to the guard and is NOT batch-written
//     (Req 7.2, 7.4).
//   - Per-document Version_Guard (`writeItemWithVersionCheck`): the transaction performs a
//     `set` (and returns success) IFF vL > vR; vR >= vL yields a conflict and NO
//     unconditional write (Req 4.1).
// The two paths must agree exactly: the set of fast-path-sent ids equals the set of
// guard-written ids equals { items where vL > vR }.
//
// Feature: sync-push-throughput-optimization, Property 12: For any item with local version
// vL and observed remote version vR, a write (per-document transaction set, or inclusion in
// a writeBatch) occurs if and only if vL > vR; when vL <= vR no unconditional write is
// performed.

const assert = require('assert');
const fc = require('fast-check');

const { createMockFirestore } = require('./fixtures/sync-fast-path-firestore');

// `writeItemWithVersionCheck` is not exported; we drive the real per-document guard
// through the exported sequential reference `flushPreparedItems` and observe the actual
// transaction `set` calls recorded by the mock firestore (`txWrites`). A recorded set is
// exactly the "unconditional write" the property is about — distinct from "marked sent",
// since an equivalent-conflict is marked sent WITHOUT any write.
const { runBatchedFastPath, flushPreparedItems } = require('../main/sync/engine');

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
const COLL = `schools/${SCHOOL_ID}/settings`;

// Each item has an explicit local version vL and a remote doc present at version vR, so
// the only thing in play is the vL-vs-vR comparison. We sample the three regions:
// vL < vR, vL == vR, vL > vR.
const itemArb = fc.record({
    localVersion: fc.integer({ min: 1, max: 60 }),
    remoteVersion: fc.integer({ min: 0, max: 60 }),
    payload: fc.integer({ min: 0, max: 1000 }),
    // Whether the remote payload is byte-equivalent to the local data (affects the
    // guard's `equivalent` flag, but NEVER whether an unconditional write happens).
    equivalentRemote: fc.boolean()
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

    // Remote doc ALWAYS present so vR is well-defined for the strict comparison.
    const remoteData = spec.equivalentRemote
        ? { ...localData, version: spec.remoteVersion, operation: 'PUT', rowSyncId, deviceHash: 'devREMOTE0000bb', schoolYear: '2025/2026', updatedAt: 1700000000 }
        : { value: 'remote-different', extra: 'remote-only', version: spec.remoteVersion };

    const remoteDoc = { path: COLL, id: documentId, data: remoteData };
    const shouldWrite = spec.localVersion > spec.remoteVersion; // the strict rule

    return { spec, index, documentId, rowSyncId, localData, item, remoteDoc, shouldWrite };
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

console.log('[pbt] sync-push-throughput Property 12: strict version-greater write rule across all paths');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (specs) => {
            const plans = specs.map((s, i) => planItem(s, i));
            const writeExpected = new Set(plans.filter((p) => p.shouldWrite).map((p) => p.documentId));

            // --- Path A: Batched Fast Path (own DB + own firestore, reads + commit OK). ---
            const dbFast = createSyncDb();
            backing = dbKind(dbFast);
            const preparedFast = seedDb(dbFast, plans);
            const fsFast = createMockFirestore({ docs: plans.map((p) => p.remoteDoc) });
            const { sentItems, guardRoutedItems } = await runBatchedFastPath(
                dbFast, fsFast, preparedFast, { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID }
            );
            const fastSent = new Set(sentItems.map((it) => it.documentId));
            const fastGuard = new Set(guardRoutedItems.map((p) => p.item.documentId));

            // Fast path writes (commits) IFF vL > vR.
            assert.deepStrictEqual([...fastSent].sort(), [...writeExpected].sort(), 'fast-path sent set must equal { vL > vR }');
            // Everything else (vL <= vR) is guard-routed, never batch-written. Iterate the
            // prepared records (they carry the entryId; the plan is on `_plan`).
            for (const pr of preparedFast) {
                const p = pr._plan;
                if (!p.shouldWrite) {
                    assert.ok(fastGuard.has(p.documentId), `vR >= vL item ${p.documentId} must be guard-routed (not batch-written)`);
                    assert.ok(!fastSent.has(p.documentId), `vR >= vL item ${p.documentId} must NOT be batch-written`);
                    // markEntrySent must NOT have fired for it.
                    assert.strictEqual(getOutboxRow(dbFast, pr.entryId).status, 'pending', `vR >= vL item ${p.documentId} must remain pending`);
                }
            }

            // --- Path B: per-document Version_Guard transaction, same remote versions. ---
            // Drive the real guard via flushPreparedItems; an actual transaction `set`
            // (recorded in fsGuard.txWrites) is the unconditional write under test.
            const dbGuard = createSyncDb();
            const preparedGuard = seedDb(dbGuard, plans);
            const fsGuard = createMockFirestore({ docs: plans.map((p) => p.remoteDoc) });
            await flushPreparedItems(dbGuard, fsGuard, preparedGuard, MAX_RETRIES, SCHOOL_ID);
            const guardWritten = new Set(fsGuard.txWrites);

            // The guard performs an unconditional `set` IFF vL > vR.
            assert.deepStrictEqual([...guardWritten].sort(), [...writeExpected].sort(), 'guard-written set must equal { vL > vR }');
            // No write may target a vR >= vL item in either path.
            for (const p of plans) {
                if (!p.shouldWrite) {
                    assert.ok(!guardWritten.has(p.documentId), `vR >= vL item ${p.documentId} must NOT be guard-written`);
                }
            }

            // --- Both paths agree exactly on the written set. ---
            assert.deepStrictEqual([...fastSent].sort(), [...guardWritten].sort(), 'fast-path and guard paths must write the same items');

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors covering the three comparison regions explicitly.
    // -----------------------------------------------------------------------
    async function bothPaths(specs) {
        const plans = specs.map((s, i) => planItem(s, i));
        const dbFast = createSyncDb();
        const preparedFast = seedDb(dbFast, plans);
        const fsFast = createMockFirestore({ docs: plans.map((p) => p.remoteDoc) });
        const fast = await runBatchedFastPath(dbFast, fsFast, preparedFast, { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID });

        const fsGuard = createMockFirestore({ docs: plans.map((p) => p.remoteDoc) });
        const dbGuard = createSyncDb();
        const preparedGuard = seedDb(dbGuard, plans);
        await flushPreparedItems(dbGuard, fsGuard, preparedGuard, MAX_RETRIES, SCHOOL_ID);
        const guardWritten = [...new Set(fsGuard.txWrites)];
        return { plans, fast, guardWritten };
    }

    {
        // vL > vR -> written by both.
        const { fast, guardWritten } = await bothPaths([{ localVersion: 5, remoteVersion: 2, payload: 1, equivalentRemote: false }]);
        assert.deepStrictEqual(fast.sentItems.map((i) => i.documentId), ['doc-0'], 'anchor vL>vR: fast writes');
        assert.deepStrictEqual(guardWritten, ['doc-0'], 'anchor vL>vR: guard writes');
    }
    {
        // vL == vR -> written by neither.
        const { fast, guardWritten } = await bothPaths([{ localVersion: 4, remoteVersion: 4, payload: 1, equivalentRemote: false }]);
        assert.strictEqual(fast.sentItems.length, 0, 'anchor vL==vR: fast does not write');
        assert.strictEqual(guardWritten.length, 0, 'anchor vL==vR: guard does not write');
    }
    {
        // vL < vR -> written by neither, even when remote payload is equivalent.
        const { fast, guardWritten } = await bothPaths([{ localVersion: 3, remoteVersion: 7, payload: 1, equivalentRemote: true }]);
        assert.strictEqual(fast.sentItems.length, 0, 'anchor vL<vR: fast does not write');
        assert.strictEqual(guardWritten.length, 0, 'anchor vL<vR (equivalent): guard does not unconditionally write');
    }

    console.log(`[pass] Property 12 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 12', err && err.stack ? err.stack : err);
    process.exit(1);
});

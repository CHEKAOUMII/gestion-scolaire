'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 9.4 — Property 18: Fallback routing to the Version_Guard
//
// **Validates: Requirements 4.4, 7.5, 7.6**
//
// Drives the REAL exported `runBatchedFastPath` from main/sync/engine.js against a
// deterministic Layer-2 mock Firestore (`tests/fixtures/sync-fast-path-firestore.js`,
// which models the real `getDocs` / `writeBatch` surface and can inject bulk-read and
// commit failures) and a real-schema in-memory DB (`tests/fixtures/sync-outbox-db.js`,
// reused read-only). For every generated mix it asserts the Batched Fast Path routes
// EXACTLY these four fallback categories to `guardRoutedItems` and marks NONE of them
// sent:
//   1. vR >= vL                 — remote version >= local (Req 7.4)
//   2. not-found / unreadable   — item missing from the bulk-read snapshot (Req 4.4)
//   3. bulk-read failure        — the whole chunk whose getDocs threw (Req 7.5)
//   4. commit failure           — every item in a writeBatch commit that threw (Req 7.6)
// and that the committed survivors (vL > vR, read OK, commit OK) are the EXACT contents
// of `sentItems`, each `markEntrySent` (outbox row -> 'sent'), while every guard-routed
// item is left untouched (outbox row still 'pending').
//
// Feature: sync-push-throughput-optimization, Property 18: For any item that the
// Batched_Fast_Path cannot evaluate (missing/unreadable bulk-read version), any item in a
// group whose bulk read failed, and any item in a writeBatch commit that failed, the item
// is routed to the per-document Version_Guard transaction and is never marked sent without
// a successful guarded write.

const assert = require('assert');
const fc = require('fast-check');

// Install the Layer-2 firestore + sync-log mocks BEFORE requiring the engine.
const { createMockFirestore } = require('./fixtures/sync-fast-path-firestore');

const { runBatchedFastPath } = require('../main/sync/engine');

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
const NORMAL_COLL = `schools/${SCHOOL_ID}/normal`;
const READFAIL_COLL = `schools/${SCHOOL_ID}/readfail`;

// Fallback categories + the one survivor (committed) class.
const CLS = {
    SURVIVOR: 'survivor-vL-greater',        // remote present, vR < vL  -> committed survivor
    CONFLICT_GE: 'conflict-vR-ge-vL',       // remote present, vR >= vL  -> guard (Req 7.4)
    NOT_FOUND: 'not-found',                 // remote absent             -> guard (Req 4.4)
    READ_FAIL: 'bulk-read-failure'          // collection getDocs throws -> guard (Req 7.5)
};

const itemArb = fc.record({
    cls: fc.constantFrom(...Object.values(CLS)),
    localVersion: fc.integer({ min: 2, max: 50 }),
    lowerGap: fc.integer({ min: 1, max: 20 }),   // vR = vL - gap (>= 0) for SURVIVOR
    geDelta: fc.integer({ min: 0, max: 20 }),    // vR = vL + delta for CONFLICT_GE
    payload: fc.integer({ min: 0, max: 1000 })
});

const scenarioArb = fc.record({
    items: fc.array(itemArb, { minLength: 0, maxLength: 16 }),
    // When true the single writeBatch commit fails -> every survivor is re-routed to the
    // guard and nothing is marked sent (Req 7.6 / commit-failure category).
    commitWillFail: fc.boolean()
});

function planItem(spec, index) {
    const isReadFail = spec.cls === CLS.READ_FAIL;
    const collectionPath = isReadFail ? READFAIL_COLL : NORMAL_COLL;
    const documentId = `doc-${index}`;
    const rowSyncId = `${SCHOOL_ID}:${collectionPath}:${index}`;
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

    let remoteDoc = null;
    if (spec.cls === CLS.SURVIVOR) {
        const vR = Math.max(0, spec.localVersion - spec.lowerGap); // guaranteed < vL (gap >= 1, vL >= 2)
        remoteDoc = { path: collectionPath, id: documentId, data: { value: 'stale-remote', version: vR } };
    } else if (spec.cls === CLS.CONFLICT_GE) {
        const vR = spec.localVersion + spec.geDelta; // >= vL
        remoteDoc = { path: collectionPath, id: documentId, data: { value: 'remote', version: vR } };
    }
    // NOT_FOUND -> no remote doc; READ_FAIL -> getDocs for its collection throws.

    return { spec, index, cls: spec.cls, collectionPath, documentId, rowSyncId, localData, item, remoteDoc };
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

function buildFirestore(plans, commitWillFail) {
    return createMockFirestore({
        docs: plans.filter((p) => p.remoteDoc).map((p) => p.remoteDoc),
        readFailPaths: [READFAIL_COLL],
        commitFail: commitWillFail
    });
}

const idOf = (prepared) => prepared.item.documentId;

console.log('[pbt] sync-push-throughput Property 18: fallback routing to the Version_Guard');

let checks = 0;
let backing = null;

(async () => {
    await fc.assert(
        fc.asyncProperty(scenarioArb, async (scenario) => {
            const plans = scenario.items.map((spec, i) => planItem(spec, i));
            const db = createSyncDb();
            backing = dbKind(db);
            const prepared = seedDb(db, plans);
            const fs = buildFirestore(plans, scenario.commitWillFail);

            const { sentItems, guardRoutedItems } = await runBatchedFastPath(
                db,
                fs,
                prepared,
                { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID }
            );

            // Expected partitions by document id.
            const survivors = prepared.filter((p) => p._plan.cls === CLS.SURVIVOR);
            const sentExpected = new Set(
                scenario.commitWillFail ? [] : survivors.map(idOf)
            );
            const guardExpected = new Set(
                prepared
                    .filter((p) => {
                        if (p._plan.cls === CLS.SURVIVOR) return scenario.commitWillFail; // commit-failure category
                        return true; // CONFLICT_GE / NOT_FOUND / READ_FAIL always guard-routed
                    })
                    .map(idOf)
            );

            const sentSet = new Set(sentItems.map((it) => it.documentId));
            const guardSet = new Set(guardRoutedItems.map((p) => p.item.documentId));

            // 1. sentItems == exactly the committed survivors (Req 7.2 survivors only).
            assert.deepStrictEqual(
                [...sentSet].sort(),
                [...sentExpected].sort(),
                `sentItems mismatch (commitWillFail=${scenario.commitWillFail})`
            );

            // 2. guardRoutedItems == exactly the four fallback categories (Req 4.4, 7.5, 7.6).
            assert.deepStrictEqual(
                [...guardSet].sort(),
                [...guardExpected].sort(),
                `guardRoutedItems mismatch (commitWillFail=${scenario.commitWillFail})`
            );

            // 3. Partition is total + disjoint: every prepared item lands in exactly one set.
            assert.strictEqual(sentSet.size + guardSet.size, prepared.length, 'partition must cover every item exactly once');
            for (const id of sentSet) assert.ok(!guardSet.has(id), `item ${id} cannot be both sent and guard-routed`);

            // 4. Side effects: committed survivors are markEntrySent ('sent'); every
            //    guard-routed item is untouched ('pending') — nothing in a fallback
            //    category is ever marked sent without a guarded write (Req 7.6).
            for (const p of prepared) {
                const row = getOutboxRow(db, p.entryId);
                if (sentExpected.has(idOf(p))) {
                    assert.strictEqual(row.status, 'sent', `committed survivor ${idOf(p)} must be 'sent'`);
                } else {
                    assert.strictEqual(row.status, 'pending', `guard-routed ${idOf(p)} (${p._plan.cls}) must remain 'pending'`);
                }
            }

            // 5. A bulk-read failure routes its WHOLE chunk to guard: when any READ_FAIL
            //    item exists, getDocs was attempted for the readfail collection and threw.
            const hadReadFail = plans.some((p) => p.cls === CLS.READ_FAIL);
            if (hadReadFail) {
                assert.ok(
                    fs.getDocsCalls.some((c) => c.path === READFAIL_COLL),
                    'a bulk read should have been attempted against the read-fail collection'
                );
            }

            checks += 1;
            return true;
        }),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors.
    // -----------------------------------------------------------------------

    // Anchor A: one of each category, commit succeeds -> only the survivor is sent.
    {
        const specs = [
            { cls: CLS.SURVIVOR, localVersion: 9, lowerGap: 3, geDelta: 0, payload: 1 },
            { cls: CLS.CONFLICT_GE, localVersion: 5, lowerGap: 1, geDelta: 2, payload: 2 },
            { cls: CLS.NOT_FOUND, localVersion: 4, lowerGap: 1, geDelta: 0, payload: 3 },
            { cls: CLS.READ_FAIL, localVersion: 7, lowerGap: 1, geDelta: 0, payload: 4 }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const db = createSyncDb();
        const prepared = seedDb(db, plans);
        const fs = buildFirestore(plans, false);
        const { sentItems, guardRoutedItems } = await runBatchedFastPath(db, fs, prepared, { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID });

        assert.deepStrictEqual(sentItems.map((i) => i.documentId), ['doc-0'], 'anchor A: only the survivor is sent');
        assert.deepStrictEqual(
            guardRoutedItems.map((p) => p.item.documentId).sort(),
            ['doc-1', 'doc-2', 'doc-3'],
            'anchor A: the other three are guard-routed'
        );
        assert.strictEqual(getOutboxRow(db, prepared[0].entryId).status, 'sent', 'anchor A: survivor sent');
        for (const idx of [1, 2, 3]) {
            assert.strictEqual(getOutboxRow(db, prepared[idx].entryId).status, 'pending', `anchor A: doc-${idx} pending`);
        }
    }

    // Anchor B: commit failure re-routes every survivor to guard; nothing marked sent.
    {
        const specs = [
            { cls: CLS.SURVIVOR, localVersion: 9, lowerGap: 3, geDelta: 0, payload: 1 },
            { cls: CLS.SURVIVOR, localVersion: 8, lowerGap: 2, geDelta: 0, payload: 2 }
        ];
        const plans = specs.map((s, i) => planItem(s, i));
        const db = createSyncDb();
        const prepared = seedDb(db, plans);
        const fs = buildFirestore(plans, true); // commit throws
        const { sentItems, guardRoutedItems } = await runBatchedFastPath(db, fs, prepared, { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID });

        assert.strictEqual(sentItems.length, 0, 'anchor B: commit failure -> nothing sent');
        assert.deepStrictEqual(
            guardRoutedItems.map((p) => p.item.documentId).sort(),
            ['doc-0', 'doc-1'],
            'anchor B: both survivors re-routed to guard'
        );
        assert.strictEqual(fs.commitFailCount, 1, 'anchor B: exactly one commit was attempted and failed');
        for (const p of prepared) {
            assert.strictEqual(getOutboxRow(db, p.entryId).status, 'pending', 'anchor B: commit-failed items remain pending');
        }
    }

    // Anchor C: empty input -> empty partitions, no reads, no commits.
    {
        const db = createSyncDb();
        const fs = buildFirestore([], false);
        const { sentItems, guardRoutedItems } = await runBatchedFastPath(db, fs, [], { maxRetries: MAX_RETRIES, schoolId: SCHOOL_ID });
        assert.strictEqual(sentItems.length, 0, 'anchor C: no sent');
        assert.strictEqual(guardRoutedItems.length, 0, 'anchor C: no guard-routed');
        assert.strictEqual(fs.getDocsCalls.length, 0, 'anchor C: no bulk reads');
        assert.strictEqual(fs.writeBatchCount, 0, 'anchor C: no writeBatch');
    }

    console.log(`[pass] Property 18 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);
})().catch((err) => {
    console.error('[fail] Property 18', err && err.stack ? err.stack : err);
    process.exit(1);
});

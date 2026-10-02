'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 4.4 — Property 14: Non-equivalent conflict reconciliation then logging
//
// **Validates: Requirements 4.3**
//
// Exercises the REAL exported `applyItemOutcome` from main/sync/engine.js (which
// internally calls the genuine `reconcileUnreconciledRow` and `logVersionConflict`)
// against the production sync_outbox / sync_id_map / sync_conflicts schema (real
// better-sqlite3 when its native binding loads, otherwise a faithful in-memory SQL
// emulator — see tests/fixtures/sync-outbox-db.js).
//
// Proof that `reconcileUnreconciledRow` is INVOKED for every non-equivalent
// conflict: the SAME non-equivalent-conflict result produces DIFFERENT, mutually
// exclusive outcomes determined solely by the sync_id_map reconciliation state of
// the row — which is only observable if reconcileUnreconciledRow was consulted:
//
//   • UNRECONCILED row (sync_id_map.version 0/absent AND ancestor null):
//       reconcileUnreconciledRow ADOPTS the server baseline and (because its
//       internal re-merge uses ancestor == remote, so no field overlap can remain)
//       HANDLES the item — marked sent at the remote version, NO conflict logged.
//   • RECONCILED row (version > 0 OR ancestor present):
//       reconcileUnreconciledRow does not handle it → falls through to
//       `logVersionConflict`, which records the conflict, and the entry is failed.
//
// Feature: sync-push-throughput-optimization, Property 14: For any item whose
// remote version is >= its local version and whose remote data is not equivalent,
// reconcileUnreconciledRow is invoked, and when it does not handle the item the
// conflict is recorded via logVersionConflict.

const assert = require('assert');
const fc = require('fast-check');

const { applyItemOutcome } = require('../main/sync/engine');
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

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Smart generators — non-equivalent conflict input space (remote >= local).
// ---------------------------------------------------------------------------
const scenarioArb = fc.record({
    localVersion: fc.integer({ min: 1, max: 500 }), // pushed item version
    remoteDelta: fc.integer({ min: 0, max: 200 }), // remoteVersion = localVersion + delta
    reconciledVersion: fc.integer({ min: 1, max: 500 }), // version for the RECONCILED row
    reconciledHasAncestor: fc.boolean(),
    tableName: fc.constantFrom('settings', 'compensation_tracking', 'system_tags'),
    localId: fc.integer({ min: 1, max: 9999 })
});

function buildPrepared(entryId, tableName, rowSyncId, localData, version) {
    return {
        entryId,
        tableName,
        item: {
            collectionPath: tableName,
            documentId: rowSyncId,
            entityType: 'setting',
            entityId: rowSyncId,
            data: localData,
            version,
            operation: 'PUT',
            rowSyncId,
            deviceHash: 'devLOCAL000000aa',
            schoolYear: '2025/2026',
            updatedAt: 1726000000
        }
    };
}

console.log(
    '[pbt] sync-push-throughput Property 14: non-equivalent conflict reconciliation then logging'
);

let checks = 0;
let backing = null;

fc.assert(
    fc.property(scenarioArb, (s) => {
        const remoteVersion = s.localVersion + s.remoteDelta;
        // Local vs remote differ (non-equivalent). The exact bytes are irrelevant to
        // applyItemOutcome here — `result.equivalent === false` drives the branch.
        const localData = { id: s.localId, value: 'محلي', school_year: '2025/2026' };
        const serverData = { id: s.localId, value: 'بعيد-مختلف', school_year: '2025/2026' };

        const baseResult = {
            success: false,
            conflict: true,
            equivalent: false,
            remoteVersion,
            remoteData: { ...serverData, version: remoteVersion, updatedAt: 1726500000 },
            remoteDeviceHash: 'devSEEDER00000bb',
            error: 'Version conflict'
        };

        // =====================================================================
        // (A) RECONCILED row → reconcile does NOT handle → logVersionConflict.
        // =====================================================================
        {
            const db = createSyncDb();
            backing = dbKind(db);
            const rowSyncId = `school:${s.tableName}:${s.localId}`;

            seedIdMap(db, {
                rowSyncId,
                tableName: s.tableName,
                localId: s.localId,
                version: s.reconciledVersion, // > 0 → reconciled
                ancestorData: s.reconciledHasAncestor ? JSON.stringify({ value: 'سلف' }) : null
            });
            const entryId = seedOutboxRow(db, {
                tableName: s.tableName,
                rowSyncId,
                rowData: JSON.stringify(localData)
            });
            const prepared = buildPrepared(entryId, s.tableName, rowSyncId, localData, s.localVersion);

            const beforeVersion = Number(getIdMap(db, rowSyncId).version);
            const outcome = applyItemOutcome(db, prepared, baseResult, { maxRetries: 10, schoolId: 'school1' });

            // Not handled → conflict logged, entry failed, NOT sent.
            assert.strictEqual(outcome.status, 'conflict-logged', 'reconciled non-equivalent conflict is logged');
            assert.strictEqual(outcome.sent, 0, 'logged conflict is not counted sent');
            assert.strictEqual(outcome.failed, 1, 'logged conflict counts as one failure');
            assert.strictEqual(outcome.abort, false, 'a conflict never aborts the cycle');
            assert.strictEqual(outcome.syncLogItem, null, 'logged conflict is not added to syncLog');

            const row = getOutboxRow(db, entryId);
            assert.strictEqual(row.status, 'failed', 'sync_outbox row marked failed (forceFailed on conflict)');

            // Exactly one unresolved conflict recorded via logVersionConflict.
            assert.strictEqual(
                getUnresolvedConflictsForEntry(db, entryId).length,
                1,
                'exactly one unresolved conflict logged for the entry'
            );

            // sync_id_map left unchanged — a reconciled row is never re-baselined.
            assert.strictEqual(
                Number(getIdMap(db, rowSyncId).version),
                beforeVersion,
                'reconciled row sync_id_map.version unchanged when conflict is logged'
            );
        }

        // =====================================================================
        // (B) UNRECONCILED row → reconcileUnreconciledRow HANDLES it (sent),
        //     proving the reconcile attempt occurs before any logging.
        // =====================================================================
        {
            const db = createSyncDb();
            const rowSyncId = `school:${s.tableName}:${s.localId}`;

            seedIdMap(db, {
                rowSyncId,
                tableName: s.tableName,
                localId: s.localId,
                version: 0, // unreconciled
                ancestorData: null
            });
            const entryId = seedOutboxRow(db, {
                tableName: s.tableName,
                rowSyncId,
                rowData: JSON.stringify(localData)
            });
            const prepared = buildPrepared(entryId, s.tableName, rowSyncId, localData, s.localVersion);

            const outcome = applyItemOutcome(db, prepared, baseResult, { maxRetries: 10, schoolId: 'school1' });

            // Reconcile adopted the server baseline and marked the entry sent.
            assert.strictEqual(outcome.status, 'sent', 'unreconciled non-equivalent conflict is reconciled (sent)');
            assert.strictEqual(outcome.sent, 1, 'reconciled-seeded row counts sent');
            assert.strictEqual(outcome.failed, 0, 'reconciled-seeded row records no failure');
            assert.strictEqual(outcome.syncLogItem, null, 'reconciled-seeded send is not added to syncLog');

            const row = getOutboxRow(db, entryId);
            assert.strictEqual(row.status, 'sent', 'sync_outbox row marked sent after reconciliation');

            // NO conflict is logged when reconcile handles the item.
            assert.strictEqual(
                countConflicts(db),
                0,
                'reconcileUnreconciledRow handled the item — no conflict logged'
            );

            // The server baseline was adopted (version == remote) — observable proof
            // that reconcileUnreconciledRow was invoked before any logging path.
            assert.strictEqual(
                Number(getIdMap(db, rowSyncId).version),
                remoteVersion,
                'unreconciled row adopts the remote version during reconciliation'
            );
        }

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

console.log(`[pass] Property 14 held across ${checks} generated scenarios (backing store: ${backing})`);

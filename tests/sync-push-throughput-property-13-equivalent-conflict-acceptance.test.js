'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 4.3 — Property 13: Equivalent-conflict acceptance
//
// **Validates: Requirements 4.2**
//
// Exercises the REAL exported `applyItemOutcome` from main/sync/engine.js against
// the production sync_outbox / sync_id_map / sync_conflicts schema (real
// better-sqlite3 when its native binding loads, otherwise a faithful in-memory
// SQL emulator that implements the exact statements the engine helpers run — see
// tests/fixtures/sync-outbox-db.js). Only the SQL execution layer is substituted;
// the branch logic and `markEntrySent` side effects are the genuine production
// functions.
//
// Feature: sync-push-throughput-optimization, Property 13: For any item whose
// remote version is >= its local version and whose remote data is byte-equivalent
// to the local data, the entry is marked sent using the remote version.

const assert = require('assert');
const fc = require('fast-check');

const { applyItemOutcome } = require('../main/sync/engine');
const {
    createSyncDb,
    dbKind,
    seedOutboxRow,
    seedIdMap,
    seedConflict,
    getOutboxRow,
    getIdMap,
    countConflicts,
    getUnresolvedConflictsForEntry
} = require('./fixtures/sync-outbox-db');

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Smart generators — constrain to the equivalent-conflict input space:
//   localVersion  in [1, 500]   (the version the item is being pushed at)
//   remoteVersion >= localVersion (Req 4.2 precondition: remote >= local)
//   localVersion seeded into sync_id_map may be reconciled (with ancestor) or
//   freshly seeded — equivalent-conflict acceptance is independent of that.
// ---------------------------------------------------------------------------
const scenarioArb = fc
    .record({
        localVersion: fc.integer({ min: 1, max: 500 }),
        remoteDelta: fc.integer({ min: 0, max: 200 }), // remoteVersion = localVersion + delta (>= local)
        idMapVersion: fc.integer({ min: 0, max: 500 }), // sync_id_map.version before the push
        hasAncestor: fc.boolean(),
        hasPriorConflict: fc.boolean(),
        tableName: fc.constantFrom('settings', 'compensation_tracking', 'system_tags'),
        localId: fc.integer({ min: 1, max: 9999 })
    });

console.log(
    '[pbt] sync-push-throughput Property 13: equivalent-conflict acceptance'
);

let checks = 0;
let backing = null;

fc.assert(
    fc.property(scenarioArb, (s) => {
        const db = createSyncDb();
        backing = dbKind(db);

        const rowSyncId = `school:${s.tableName}:${s.localId}`;
        const localData = { id: s.localId, value: 'محتوى محلي', school_year: '2025/2026' };
        const rowDataJson = JSON.stringify(localData);
        const remoteVersion = s.localVersion + s.remoteDelta;

        // Seed sync_id_map (the entry being pushed already has a mapping).
        seedIdMap(db, {
            rowSyncId,
            tableName: s.tableName,
            localId: s.localId,
            version: s.idMapVersion,
            ancestorData: s.hasAncestor ? JSON.stringify({ value: 'سلف' }) : null
        });

        const entryId = seedOutboxRow(db, {
            tableName: s.tableName,
            rowSyncId,
            rowData: rowDataJson
        });

        // Optionally seed a pre-existing unresolved conflict tied to this entry —
        // equivalent acceptance marks it resolved as part of markEntrySent.
        if (s.hasPriorConflict) {
            seedConflict(db, {
                tableName: s.tableName,
                rowSyncId,
                entityType: 'setting',
                localData: rowDataJson,
                remoteData: '{}',
                remoteVersion,
                localOutboxId: entryId
            });
        }

        const prepared = {
            entryId,
            tableName: s.tableName,
            item: {
                collectionPath: s.tableName,
                documentId: rowSyncId,
                entityType: 'setting',
                entityId: rowSyncId,
                data: localData,
                version: s.localVersion,
                operation: 'PUT',
                rowSyncId,
                deviceHash: 'devLOCAL000000aa',
                schoolYear: '2025/2026',
                updatedAt: 1726000000
            }
        };

        // Equivalent conflict: remote version >= local AND remote data equivalent.
        const result = {
            success: false,
            conflict: true,
            equivalent: true,
            remoteVersion,
            remoteData: { ...localData, version: remoteVersion },
            remoteDeviceHash: 'devSEEDER00000bb'
        };

        const outcome = applyItemOutcome(db, prepared, result, { maxRetries: 10, schoolId: 'school1' });

        // --- Return contract: counted sent, NOT collected for syncLog batch -----
        assert.strictEqual(outcome.status, 'sent', 'equivalent conflict reports status sent');
        assert.strictEqual(outcome.sent, 1, 'equivalent conflict counts as one sent');
        assert.strictEqual(outcome.failed, 0, 'equivalent conflict records no failure');
        assert.strictEqual(outcome.abort, false, 'equivalent conflict never aborts');
        assert.strictEqual(
            outcome.syncLogItem,
            null,
            'equivalent conflict is NOT added to the syncLog batch (syncLogItem null)'
        );

        // --- Side effects: entry marked sent at the REMOTE version --------------
        const row = getOutboxRow(db, entryId);
        assert.strictEqual(row.status, 'sent', 'sync_outbox row marked sent');

        const mapping = getIdMap(db, rowSyncId);
        assert.strictEqual(
            Number(mapping.version),
            remoteVersion,
            `sync_id_map.version adopted from the remote version (${remoteVersion}), got ${mapping.version}`
        );
        assert.strictEqual(
            mapping.ancestor_data,
            rowDataJson,
            'markEntrySent sets ancestor_data to the pushed row_data'
        );

        // A prior unresolved conflict for this entry is resolved by markEntrySent.
        if (s.hasPriorConflict) {
            assert.strictEqual(
                getUnresolvedConflictsForEntry(db, entryId).length,
                0,
                'prior unresolved conflict resolved on equivalent acceptance'
            );
        }
        // No NEW conflict is ever logged for an equivalent acceptance.
        assert.strictEqual(
            countConflicts(db, 'unresolved'),
            0,
            'no unresolved conflicts remain after equivalent acceptance'
        );

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors.
// ---------------------------------------------------------------------------

// Anchor 1: remote version exactly equals local version (boundary of >=).
{
    const db = createSyncDb();
    const rowSyncId = 'school:settings:1';
    const localData = { key: 'school_name', value: 'ثانوية' };
    const entryId = seedOutboxRow(db, { tableName: 'settings', rowSyncId, rowData: JSON.stringify(localData) });
    seedIdMap(db, { rowSyncId, tableName: 'settings', localId: 1, version: 5 });
    const prepared = {
        entryId,
        tableName: 'settings',
        item: { rowSyncId, entityType: 'setting', data: localData, version: 7, updatedAt: 1 }
    };
    const outcome = applyItemOutcome(db, prepared, { success: false, conflict: true, equivalent: true, remoteVersion: 7, remoteData: localData }, { maxRetries: 10 });
    assert.strictEqual(outcome.status, 'sent');
    assert.strictEqual(getIdMap(db, rowSyncId).version, 7, 'version == remote == local boundary');
    assert.strictEqual(outcome.syncLogItem, null);
}

// Anchor 2: falsy remoteVersion falls back to the local item version (markEntrySent || item.version).
{
    const db = createSyncDb();
    const rowSyncId = 'school:settings:2';
    const localData = { key: 'k', value: 'v' };
    const entryId = seedOutboxRow(db, { tableName: 'settings', rowSyncId, rowData: JSON.stringify(localData) });
    seedIdMap(db, { rowSyncId, tableName: 'settings', localId: 2, version: 3 });
    const prepared = {
        entryId,
        tableName: 'settings',
        item: { rowSyncId, entityType: 'setting', data: localData, version: 9, updatedAt: 1 }
    };
    // remoteVersion 0 is falsy → markEntrySent uses item.version (9).
    const outcome = applyItemOutcome(db, prepared, { success: false, conflict: true, equivalent: true, remoteVersion: 0, remoteData: localData }, { maxRetries: 10 });
    assert.strictEqual(outcome.status, 'sent');
    assert.strictEqual(getIdMap(db, rowSyncId).version, 9, 'falsy remoteVersion falls back to item.version');
}

console.log(`[pass] Property 13 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);

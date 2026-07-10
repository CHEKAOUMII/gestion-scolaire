'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 4.2 — Property 11: Outcome-to-status and side-effect mapping
//
// **Validates: Requirements 3.7, 4.8**
//
// Exercises the REAL exported `applyItemOutcome` from main/sync/engine.js against
// the production sync_outbox / sync_id_map / sync_conflicts schema (real
// better-sqlite3 when its native binding loads, otherwise a faithful in-memory SQL
// emulator — see tests/fixtures/sync-outbox-db.js). For an arbitrary write result,
// the test asserts the returned status + sent/failed counts AND the resulting DB
// side effects match the documented mapping:
//
//   sent              → sync_outbox 'sent';   markEntrySent side effects applied
//   throttled         → sync_outbox 'pending' (retry); NO markEntrySent side effects
//   access-denied     → sync_outbox 'pending' (retry); abort signalled; NO side effects
//   non-terminal fail → sync_outbox 'pending' (retry < max); NO side effects
//   terminal fail     → sync_outbox 'failed'  (retry >= max); NO side effects
//   logged conflict   → sync_outbox 'failed';  conflict recorded; NO markEntrySent
//
// markEntrySent side effects = bump sync_id_map.version + resolve the entry's
// unresolved sync_conflicts. These are applied IF AND ONLY IF the item was sent.
//
// Feature: sync-push-throughput-optimization, Property 11: For any dispatched item,
// its resulting sync_outbox status matches its outcome class — sent → sent,
// throttled → pending, non-terminal failure → pending (retry), terminal failure →
// failed — and markEntrySent side effects (bump sync_id_map.version, resolve
// related sync_conflicts) are applied if and only if the item was sent.

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

const MIN_RUNS = 300;
const MAX_RETRIES = 10;

// Outcome classes spanning the full mapping domain.
const CLASS = {
    SUCCESS: 'success',
    EQUIV: 'equiv-conflict',
    CONFLICT_LOGGED: 'nonequiv-conflict-logged',
    THROTTLE: 'throttle',
    DENIED: 'access-denied',
    FAIL_NONTERMINAL: 'other-failure-nonterminal',
    FAIL_TERMINAL: 'other-failure-terminal'
};

const scenarioArb = fc.record({
    cls: fc.constantFrom(...Object.values(CLASS)),
    localVersion: fc.integer({ min: 1, max: 500 }),
    idMapVersion: fc.integer({ min: 1, max: 500 }),
    remoteDelta: fc.integer({ min: 0, max: 100 }),
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

console.log('[pbt] sync-push-throughput Property 11: outcome-to-status and side-effect mapping');

let checks = 0;
let backing = null;

fc.assert(
    fc.property(scenarioArb, (s) => {
        const db = createSyncDb();
        backing = dbKind(db);

        const rowSyncId = `school:${s.tableName}:${s.localId}`;
        const localData = { id: s.localId, value: 'محتوى', school_year: '2025/2026' };
        const rowDataJson = JSON.stringify(localData);
        const remoteVersion = s.localVersion + s.remoteDelta;

        // sync_id_map is RECONCILED (version > 0) so the non-equivalent conflict class
        // deterministically falls through to logVersionConflict rather than being
        // reconciled-and-sent (that reconciliation path is owned by Property 14).
        seedIdMap(db, {
            rowSyncId,
            tableName: s.tableName,
            localId: s.localId,
            version: s.idMapVersion,
            ancestorData: JSON.stringify({ value: 'سلف' })
        });

        // Seed retries to control terminal vs non-terminal failure classification.
        const retries =
            s.cls === CLASS.FAIL_TERMINAL ? MAX_RETRIES : s.cls === CLASS.FAIL_NONTERMINAL ? 0 : 0;
        const entryId = seedOutboxRow(db, {
            tableName: s.tableName,
            rowSyncId,
            rowData: rowDataJson,
            retries
        });

        // Every entry carries a pre-existing unresolved conflict so we can assert that
        // markEntrySent resolves it IFF the item was sent. (For the CONFLICT_LOGGED
        // class a NEW conflict is additionally logged.)
        seedConflict(db, {
            tableName: s.tableName,
            rowSyncId,
            entityType: 'setting',
            localData: rowDataJson,
            remoteData: '{}',
            remoteVersion,
            localOutboxId: entryId
        });

        const prepared = buildPrepared(entryId, s.tableName, rowSyncId, localData, s.localVersion);

        // Build the write result for this class.
        let result;
        switch (s.cls) {
            case CLASS.SUCCESS:
                result = { success: true };
                break;
            case CLASS.EQUIV:
                result = { success: false, conflict: true, equivalent: true, remoteVersion, remoteData: { ...localData, version: remoteVersion } };
                break;
            case CLASS.CONFLICT_LOGGED:
                result = { success: false, conflict: true, equivalent: false, remoteVersion, remoteData: { value: 'different', version: remoteVersion }, remoteDeviceHash: 'dev' };
                break;
            case CLASS.THROTTLE:
                result = { success: false, isThrottle: true, error: 'resource-exhausted' };
                break;
            case CLASS.DENIED:
                result = { success: false, isAccessDenied: true, error: 'permission-denied' };
                break;
            case CLASS.FAIL_NONTERMINAL:
            case CLASS.FAIL_TERMINAL:
                result = { success: false, error: 'network timeout' };
                break;
            default:
                throw new Error(`unhandled class ${s.cls}`);
        }

        const beforeVersion = Number(getIdMap(db, rowSyncId).version);
        const outcome = applyItemOutcome(db, prepared, result, { maxRetries: MAX_RETRIES, schoolId: 'school1' });

        const row = getOutboxRow(db, entryId);
        const mappingAfter = getIdMap(db, rowSyncId);
        const versionChanged = Number(mappingAfter.version) !== beforeVersion;
        const priorConflictResolved = getUnresolvedConflictsForEntry(db, entryId).length === 0;

        const wasSent = outcome.sent === 1 && outcome.status === 'sent';

        switch (s.cls) {
            case CLASS.SUCCESS:
                assert.strictEqual(outcome.status, 'sent', 'success → status sent');
                assert.strictEqual(outcome.sent, 1);
                assert.strictEqual(outcome.failed, 0);
                assert.strictEqual(outcome.abort, false);
                assert.deepStrictEqual(outcome.syncLogItem, prepared.item, 'success collects item for syncLog');
                assert.strictEqual(row.status, 'sent', 'success → sync_outbox sent');
                assert.strictEqual(Number(mappingAfter.version), beforeVersion + 1, 'success bumps version by 1');
                assert.ok(priorConflictResolved, 'success resolves the unresolved conflict');
                break;

            case CLASS.EQUIV:
                assert.strictEqual(outcome.status, 'sent', 'equivalent conflict → status sent');
                assert.strictEqual(outcome.sent, 1);
                assert.strictEqual(outcome.failed, 0);
                assert.strictEqual(outcome.syncLogItem, null, 'equivalent conflict not collected for syncLog');
                assert.strictEqual(row.status, 'sent', 'equivalent → sync_outbox sent');
                assert.strictEqual(Number(mappingAfter.version), remoteVersion, 'equivalent adopts remote version');
                assert.ok(priorConflictResolved, 'equivalent acceptance resolves the unresolved conflict');
                break;

            case CLASS.CONFLICT_LOGGED:
                assert.strictEqual(outcome.status, 'conflict-logged', 'non-equivalent conflict → conflict-logged');
                assert.strictEqual(outcome.sent, 0);
                assert.strictEqual(outcome.failed, 1);
                assert.strictEqual(outcome.abort, false);
                assert.strictEqual(outcome.syncLogItem, null);
                assert.strictEqual(row.status, 'failed', 'logged conflict → sync_outbox failed');
                assert.strictEqual(versionChanged, false, 'logged conflict does not bump version');
                // No markEntrySent → the entry retains an unresolved conflict (the seeded
                // one is updated in place by logVersionConflict; still unresolved).
                assert.ok(
                    getUnresolvedConflictsForEntry(db, entryId).length >= 1,
                    'logged conflict leaves an unresolved conflict recorded'
                );
                break;

            case CLASS.THROTTLE:
                assert.strictEqual(outcome.status, 'throttled', 'throttle → status throttled');
                assert.strictEqual(outcome.sent, 0);
                assert.strictEqual(outcome.failed, 1);
                assert.strictEqual(outcome.abort, false);
                assert.strictEqual(outcome.syncLogItem, null);
                assert.strictEqual(row.status, 'pending', 'throttle leaves sync_outbox row pending (retry)');
                assert.strictEqual(versionChanged, false, 'throttle applies NO markEntrySent version bump');
                assert.ok(!priorConflictResolved, 'throttle does NOT resolve the conflict');
                break;

            case CLASS.DENIED:
                assert.strictEqual(outcome.status, 'access-denied', 'denied → status access-denied');
                assert.strictEqual(outcome.sent, 0);
                assert.strictEqual(outcome.failed, 1);
                assert.strictEqual(outcome.abort, true, 'access-denied signals abort');
                assert.strictEqual(outcome.syncLogItem, null);
                assert.strictEqual(row.status, 'pending', 'access-denied leaves the row pending (retry)');
                assert.strictEqual(versionChanged, false, 'access-denied applies NO markEntrySent version bump');
                assert.ok(!priorConflictResolved, 'access-denied does NOT resolve the conflict');
                break;

            case CLASS.FAIL_NONTERMINAL:
                assert.strictEqual(outcome.status, 'failed', 'plain failure → status failed');
                assert.strictEqual(outcome.sent, 0);
                assert.strictEqual(outcome.failed, 1);
                assert.strictEqual(outcome.abort, false);
                assert.strictEqual(row.status, 'pending', 'non-terminal failure (retry < max) → pending');
                assert.strictEqual(versionChanged, false, 'failure applies NO version bump');
                assert.ok(!priorConflictResolved, 'failure does NOT resolve the conflict');
                break;

            case CLASS.FAIL_TERMINAL:
                assert.strictEqual(outcome.status, 'failed', 'plain failure → status failed');
                assert.strictEqual(outcome.sent, 0);
                assert.strictEqual(outcome.failed, 1);
                assert.strictEqual(row.status, 'failed', 'terminal failure (retry >= max) → failed');
                assert.strictEqual(versionChanged, false, 'failure applies NO version bump');
                assert.ok(!priorConflictResolved, 'failure does NOT resolve the conflict');
                break;

            default:
                throw new Error('unreachable');
        }

        // Universal Req 4.8 cross-check: markEntrySent side effects (version bump and/or
        // conflict resolution) occur IFF the item was sent.
        const sideEffectsApplied = versionChanged || priorConflictResolved;
        assert.strictEqual(
            sideEffectsApplied,
            wasSent,
            `markEntrySent side effects applied iff sent (class ${s.cls}: sent=${wasSent}, sideEffects=${sideEffectsApplied})`
        );

        checks += 1;
        return true;
    }),
    { numRuns: MIN_RUNS }
);

// ---------------------------------------------------------------------------
// Targeted anchors — one per class for fast, explicit coverage.
// ---------------------------------------------------------------------------
function anchor(cls, result, retries, expect) {
    const db = createSyncDb();
    const rowSyncId = `school:settings:anchor-${cls}`;
    const localData = { key: 'k', value: 'v' };
    seedIdMap(db, { rowSyncId, tableName: 'settings', localId: Math.floor(Math.random() * 1e6), version: 4, ancestorData: '{}' });
    const entryId = seedOutboxRow(db, { tableName: 'settings', rowSyncId, rowData: JSON.stringify(localData), retries });
    const prepared = buildPrepared(entryId, 'settings', rowSyncId, localData, 5);
    const outcome = applyItemOutcome(db, prepared, result, { maxRetries: MAX_RETRIES });
    assert.strictEqual(outcome.status, expect.status, `anchor ${cls}: status`);
    assert.strictEqual(getOutboxRow(db, entryId).status, expect.row, `anchor ${cls}: row status`);
    assert.strictEqual(outcome.abort, expect.abort, `anchor ${cls}: abort`);
}

anchor(CLASS.SUCCESS, { success: true }, 0, { status: 'sent', row: 'sent', abort: false });
anchor(CLASS.THROTTLE, { success: false, isThrottle: true, error: 'unavailable' }, MAX_RETRIES, { status: 'throttled', row: 'pending', abort: false });
anchor(CLASS.DENIED, { success: false, isAccessDenied: true, error: 'permission-denied' }, MAX_RETRIES, { status: 'access-denied', row: 'pending', abort: true });
anchor(CLASS.FAIL_NONTERMINAL, { success: false, error: 'boom' }, 0, { status: 'failed', row: 'pending', abort: false });
anchor(CLASS.FAIL_TERMINAL, { success: false, error: 'boom' }, MAX_RETRIES, { status: 'failed', row: 'failed', abort: false });

console.log(`[pass] Property 11 held across ${checks} generated scenarios + anchors (backing store: ${backing})`);

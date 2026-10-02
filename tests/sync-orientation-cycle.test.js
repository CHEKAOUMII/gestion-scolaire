'use strict';

/**
 * Sync contract for the student_orientation cycle_code snapshot (multi-stage plan,
 * slice S3 — "stays within keyFields/requiredColumns and the sync contract").
 *
 * The student_orientation table gains a cycle_code column (derived in main from the
 * students table). The entity is cycle-carrying — a student is the same person
 * whichever cycle they study in — so identity stays school_year + student_code, but
 * the column is declared required so a device on an older schema quarantines the rows
 * instead of writing them cycle-stripped. Self-contained: it creates the table inline
 * and never depends on the wave-1 cycle-code migration existing.
 */

const assert = require('assert');

const registry = require('../main/sync/entity-registry');
const { clearSchemaColumnsCache } = require('../main/sync/engine/helpers');
const { checkLocalContract, applySingleItem } = require('../main/sync/engine/apply');
const { countQuarantinedRows } = require('../main/sync/engine/helpers');
const { captureInputUpserts } = require('../main/sync/capture');

console.log('[test] student_orientation cycle sync contract');

// ── Registry shape ─────────────────────────────────────────────────────────
assert.ok(registry.getEntity('student_orientation'), 'student_orientation is registered');
assert.deepStrictEqual(
    registry.getRequiredColumns('student_orientation'),
    ['cycle_code'],
    'the cycle snapshot column is required'
);
assert.strictEqual(registry.getContractVersion('student_orientation'), 2, 'contract bumped to v2');
assert.deepStrictEqual(
    registry.getLocalKeyFields('student_orientation'),
    ['school_year', 'student_code'],
    'cycle-carrying: identity keeps school_year + student_code'
);
assert.strictEqual(
    registry.isCycleKeyed('student_orientation'),
    false,
    'it stays cycle-carrying, not cycle-keyed'
);
assert.deepStrictEqual(
    registry.getRemoteIdFields('student_orientation'),
    ['school_year', 'student_code'],
    'remote idFields unchanged'
);
assert.deepStrictEqual(
    registry.validateEntityRegistry(),
    [],
    'registry satisfies its own contract rules'
);
console.log('  [ok] registry declares the cycle snapshot without touching identity');

// ── In-memory schema fixtures (self-contained, no migration dependency) ────
function openDb() {
    try {
        const Database = require('better-sqlite3');
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        return new DatabaseSync(':memory:');
    }
}

function createSyncSchema(db) {
    db.exec(`
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL, row_data TEXT, school_year TEXT, status TEXT DEFAULT 'pending',
            retries INTEGER DEFAULT 0
        );
        CREATE TABLE sync_id_map (
            row_sync_id TEXT PRIMARY KEY, table_name TEXT NOT NULL, local_id TEXT NOT NULL,
            version INTEGER DEFAULT 1, ancestor_data TEXT
        );
    `);
}

function createOrientationTable(db, withCycleCode) {
    db.exec(`
        CREATE TABLE student_orientation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_year TEXT NOT NULL,
            student_code TEXT NOT NULL,
            orientation_type TEXT${withCycleCode ? ',\n            cycle_code TEXT' : ''}
        );
    `);
}

// ── Capture: the outbox payload keeps the cycle snapshot ───────────────────
// captureInputUpserts re-reads the mutated row with SELECT * and serializes the full
// row object, so any column present on the local table — cycle_code included — lands
// in the outbox payload verbatim.
const captureDb = openDb();
createSyncSchema(captureDb);
createOrientationTable(captureDb, true);
captureDb
    .prepare(
        'INSERT INTO student_orientation(school_year, student_code, orientation_type, cycle_code) VALUES(?, ?, ?, ?)'
    )
    .run('2025/2026', 'S-001', 'excellence', 'primary');

captureInputUpserts(captureDb, {
    tableName: 'student_orientation',
    keyFields: ['school_year', 'student_code'],
    operation: 'PUT',
    items: [{ school_year: '2025/2026', student_code: 'S-001' }]
});

const capturedRow = captureDb
    .prepare('SELECT row_data FROM sync_outbox WHERE table_name = ?')
    .get('student_orientation');
assert.ok(capturedRow, 'an outbox row is written for the upsert');
const capturedData = JSON.parse(capturedRow.row_data);
assert.strictEqual(capturedData.cycle_code, 'primary', 'the payload carries the cycle snapshot');
assert.strictEqual(capturedData.student_code, 'S-001', 'the payload keeps the student identity');
console.log('  [ok] orientation:bulkUpsert capture serializes cycle_code (column-agnostic)');

// ── Apply gate on a stale schema: refuse and quarantine, never strip ───────
// A device that predates the cycle_code column would otherwise have it removed by
// filterToValidColumns and write the row cycle-less. checkLocalContract must refuse
// it and route the row to pull quarantine instead.
const staleDb = openDb();
createSyncSchema(staleDb);
createOrientationTable(staleDb, false);
staleDb.exec(`
    CREATE TABLE sync_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT, row_sync_id TEXT NOT NULL UNIQUE,
        table_name TEXT NOT NULL, operation TEXT NOT NULL, contract_version INTEGER DEFAULT 1,
        reason TEXT NOT NULL, item_json TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0,
        quarantined_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

const payload = {
    school_year: '2025/2026',
    student_code: 'S-002',
    orientation_type: 'excellence',
    cycle_code: 'primary'
};
const remoteItem = {
    tableName: 'student_orientation',
    operation: 'PUT',
    rowSyncId: 'remote-orientation-1',
    data: payload,
    version: 1,
    updatedAt: 0,
    deviceHash: 'remote-device',
    entityType: 'student_orientation',
    schoolYear: '2025/2026',
    changeId: 'c1'
};

clearSchemaColumnsCache();
const staleContract = checkLocalContract(staleDb, remoteItem);
assert.ok(staleContract, 'a device without the column refuses the row');
assert.ok(staleContract.includes('cycle_code'), 'the reason names the missing column');
assert.ok(staleContract.includes('contract v2'), 'the reason carries the contract version');

const staleStats = { appliedCount: 0, failedCount: 0, conflictCount: 0, failures: [], quarantinedCount: 0, quarantined: [] };
applySingleItem(staleDb, remoteItem, new Map(), [], [], [], staleStats, false);
assert.strictEqual(staleStats.appliedCount, 0, 'nothing is written on the stale device');
assert.strictEqual(staleStats.quarantinedCount, 1, 'the row is routed to pull quarantine');
assert.strictEqual(staleStats.failedCount, 0, 'quarantine does not hold the pull cursor');
assert.strictEqual(
    staleDb.prepare('SELECT COUNT(*) AS c FROM student_orientation').get().c,
    0,
    'the row is never silently written column-stripped'
);
assert.strictEqual(countQuarantinedRows(staleDb), 1, 'the held row is stored for replay');

const [replayed] = staleDb
    .prepare('SELECT item_json FROM sync_quarantine WHERE row_sync_id = ?')
    .all('remote-orientation-1')
    .map((row) => JSON.parse(row.item_json));
assert.strictEqual(replayed.data.cycle_code, 'primary', 'the stored payload keeps the cycle for replay');
console.log('  [ok] stale schema quarantines the row with an update-this-device reason');

// ── Apply gate on an up-to-date schema: the row applies with its cycle ─────
const currentDb = openDb();
createSyncSchema(currentDb);
createOrientationTable(currentDb, true);

clearSchemaColumnsCache();
assert.strictEqual(
    checkLocalContract(currentDb, remoteItem),
    null,
    'an up-to-date device applies normally'
);
const currentStats = { appliedCount: 0, failedCount: 0, conflictCount: 0, failures: [], quarantinedCount: 0, quarantined: [] };
applySingleItem(currentDb, remoteItem, new Map(), [], [], [], currentStats, false);
assert.strictEqual(currentStats.appliedCount, 1, 'the row is applied on an up-to-date device');
assert.strictEqual(currentStats.quarantinedCount, 0, 'no quarantine for a passing contract');
const written = currentDb
    .prepare('SELECT cycle_code FROM student_orientation WHERE student_code = ?')
    .get('S-002');
assert.ok(written, 'the row exists locally');
assert.strictEqual(written.cycle_code, 'primary', 'the cycle snapshot is preserved');

clearSchemaColumnsCache();
assert.ok(
    checkLocalContract(currentDb, { ...remoteItem, data: { school_year: '2025/2026', student_code: 'S-003' } }),
    'a payload missing the cycle value is refused even when the column exists'
);
console.log('  [ok] up-to-date schema applies the row with its cycle intact');

console.log('[test] student_orientation cycle sync contract OK');

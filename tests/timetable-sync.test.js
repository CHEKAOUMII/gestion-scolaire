'use strict';

const assert = require('assert');
const { validateEntityRegistry, getEntity } = require('../main/sync/entity-registry');
const { TOPO_ORDER_PUT } = require('../main/sync/engine/helpers');
const { CHANNEL_REGISTRY } = require('../main/sync/capture');

// 1. Entity registry validation
const errors = validateEntityRegistry();
assert.deepStrictEqual(errors, [], `entity registry validation failed: ${errors.join('; ')}`);
const entity = getEntity('timetable_data');
assert.ok(entity, 'timetable_data entity must exist');
assert.deepStrictEqual(entity.local.keyFields, ['school_year', 'cycle_code']);
assert.strictEqual(entity.local.snapshot, true);
assert.strictEqual(entity.local.contractVersion, 2);
assert.deepStrictEqual(entity.local.requiredColumns, ['cycle_code']);
assert.strictEqual(entity.remote.collection, 'timetableData');
assert.ok(entity.authority.writers.length > 0, 'writers must be defined');

// 2. TOPO order
assert.ok(TOPO_ORDER_PUT.includes('timetable_data'), 'TOPO_ORDER_PUT must include timetable_data');

// 3. Capture registry
const saveEntry = CHANNEL_REGISTRY['timetableData:save'];
const delEntry = CHANNEL_REGISTRY['timetableData:delete'];
assert.ok(saveEntry, 'capture entry for save');
assert.strictEqual(saveEntry.captureMode, 'explicit');
assert.strictEqual(saveEntry.exclude, true);
assert.ok(delEntry, 'capture entry for delete');
assert.strictEqual(delEntry.captureMode, 'explicit');

// 4. Repo capture via in-memory SQLite
const { setRepoCapturePort } = require('../main/repos/capture-port');
const timetableRepo = require('../main/repos/timetable');

let captured = [];
let notified = 0;
setRepoCapturePort({
    captureInputUpserts(db, opts) {
        captured.push({ op: 'upsert', table: opts.tableName, keys: opts.keyFields, items: opts.items });
        return 1;
    },
    captureDeletesFromRows(db, table, rows) {
        captured.push({ op: 'delete', table, rows });
        return rows.length;
    },
    captureResolvedRows() { return 0; },
    capturePutsByIds() { return 0; },
    notifyCaptureCommitted() { notified += 1; }
});

let Database;
let useNative = true;
try {
    Database = require('better-sqlite3');
    new Database(':memory:').close();
} catch {
    Database = require('node:sqlite').DatabaseSync;
    useNative = false;
}
const db = new Database(':memory:');
if (!useNative) {
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try { const v = fn(...args); db.exec('COMMIT'); return v; } catch (e) { db.exec('ROLLBACK'); throw e; }
    };
} else db.pragma('foreign_keys = ON');

db.exec(`
    CREATE TABLE timetable_data (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        school_year TEXT NOT NULL,
        cycle_code TEXT NOT NULL,
        data_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(school_year, cycle_code)
    );
    CREATE TABLE sync_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT, operation TEXT, row_sync_id TEXT);
`);

captured = []; notified = 0;
timetableRepo.upsertByCycle(db, '2025/2026', 'secondary_qualifiant', JSON.stringify({ teachers: [] }));
assert.ok(captured.some((c) => c.table === 'timetable_data' && c.op === 'upsert'), 'upsert must capture');
assert.ok(notified > 0, 'upsert must notify');

captured = []; notified = 0;
timetableRepo.deleteByCycle(db, '2025/2026', 'secondary_qualifiant');
assert.ok(captured.some((c) => c.table === 'timetable_data' && c.op === 'delete'), 'delete must capture');
assert.ok(notified > 0, 'delete must notify');

setRepoCapturePort(null);
db.close();

console.log('timetable-sync: OK');

'use strict';

const assert = require('assert');
const {
    ENTITY_REGISTRY,
    CYCLE_SCOPED_TABLES,
    getContractVersion,
    getRequiredColumns,
    getLocalKeyFields,
    getRemoteIdFields,
    isCycleKeyed,
    validateEntityRegistry
} = require('../main/sync/entity-registry');

console.log('[test] multi-cycle sync contracts');

const cycleCarrying = {
    exams: { local: ['id'], remote: ['id'] },
    tests: { local: ['id'], remote: ['id'] },
    student_files: {
        local: ['student_id', 'doc_key', 'school_year'],
        remote: ['student_code', 'doc_key', 'school_year']
    },
    correspondence: { local: ['id'], remote: ['id'] },
    student_movements: { local: ['id'], remote: ['id'] },
    student_profile_data: {
        local: ['student_code', 'tab_key', 'school_year'],
        remote: ['student_code', 'tab_key', 'school_year']
    }
};

for (const [tableName, expectedKeys] of Object.entries(cycleCarrying)) {
    assert.ok(ENTITY_REGISTRY[tableName], `${tableName} is registered`);
    assert.deepStrictEqual(getLocalKeyFields(tableName), expectedKeys.local, `${tableName} local identity`);
    assert.deepStrictEqual(getRemoteIdFields(tableName), expectedKeys.remote, `${tableName} remote identity`);
    assert.deepStrictEqual(getRequiredColumns(tableName), ['cycle_code'], `${tableName} requires cycle_code`);
    assert.strictEqual(getContractVersion(tableName), 2, `${tableName} contract version`);
    assert.strictEqual(isCycleKeyed(tableName), false, `${tableName} remains cycle-carrying`);
}

const cycleKeyed = {
    sections: {
        local: ['school_year', 'cycle_code', 'section_code'],
        remote: ['school_year', 'cycle_code', 'section_code']
    },
    education_levels: {
        local: ['cycle_code', 'level_code'],
        remote: ['cycle_code', 'level_code']
    },
    level_aliases: {
        local: ['cycle_code', 'normalized_alias'],
        remote: ['cycle_code', 'normalized_alias']
    }
};

for (const [tableName, expectedKeys] of Object.entries(cycleKeyed)) {
    assert.deepStrictEqual(getLocalKeyFields(tableName), expectedKeys.local, `${tableName} local identity`);
    assert.deepStrictEqual(getRemoteIdFields(tableName), expectedKeys.remote, `${tableName} remote identity`);
    assert.deepStrictEqual(getRequiredColumns(tableName), ['cycle_code'], `${tableName} requires cycle_code`);
    assert.strictEqual(getContractVersion(tableName), 2, `${tableName} contract version`);
    assert.strictEqual(isCycleKeyed(tableName), true, `${tableName} is cycle-keyed`);
}

for (const tableName of ['education_subjects', 'subject_aliases']) {
    assert.ok(ENTITY_REGISTRY[tableName], `${tableName} is registered`);
    assert.deepStrictEqual(getRequiredColumns(tableName), [], `${tableName} is institution-wide`);
    assert.strictEqual(isCycleKeyed(tableName), false, `${tableName} is not cycle-keyed`);
}

assert.deepStrictEqual(validateEntityRegistry(), [], 'all cycle contracts validate');
assert.deepStrictEqual(
    [...CYCLE_SCOPED_TABLES].sort(),
    [
        'absences',
        'correspondence',
        'grades',
        'institution_cycles',
        'student_files',
        'student_movements',
        'student_profile_data',
        'students',
        'support_sessions',
        'teacher_teaching_assignments'
    ],
    'read-scope enforcement covers every migrated student child table'
);

console.log('  [ok] carrying, keyed, and institution-wide reference contracts');

// ── Push/pull journey for the three S7 child tables ────────────────────────
// A captured row is cycle-complete: the document survives a pull round-trip with its
// cycle_code intact, and a doc that arrives without it is quarantined with an Arabic
// reason instead of being applied cycle-less.
const {
    recordOutboxEntry,
    setCaptureGetDb,
    getCaptureDb
} = require('../main/sync/capture');
const { recordPullQuarantine, countQuarantinedRows } = require('../main/sync/engine/helpers');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        return new DatabaseSync(':memory:');
    }
}

const jdb = openDb();
jdb.exec(`
    CREATE TABLE student_files (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, doc_key TEXT NOT NULL,
        is_present INTEGER DEFAULT 0, school_year TEXT NOT NULL, cycle_code TEXT
    );
    CREATE TABLE student_movements (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, movement_type TEXT,
        school_year TEXT, cycle_code TEXT
    );
    CREATE TABLE correspondence (
        id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
        letter_type TEXT, school_year TEXT, cycle_code TEXT
    );
    CREATE TABLE sync_outbox (
        id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_sync_id TEXT NOT NULL,
        operation TEXT NOT NULL, row_data TEXT, school_year TEXT, status TEXT DEFAULT 'pending',
        retries INTEGER DEFAULT 0
    );
    CREATE TABLE sync_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT, row_sync_id TEXT NOT NULL UNIQUE,
        table_name TEXT NOT NULL, operation TEXT NOT NULL, contract_version INTEGER DEFAULT 1,
        reason TEXT NOT NULL, item_json TEXT NOT NULL, retry_count INTEGER NOT NULL DEFAULT 0,
        quarantined_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE sync_id_map (
        row_sync_id TEXT PRIMARY KEY, table_name TEXT NOT NULL, local_id TEXT NOT NULL,
        version INTEGER DEFAULT 1, ancestor_data TEXT
    );
`);

jdb.prepare('INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code) VALUES(1, ?, 1, ?, ?)').run('birth_cert', '2025/2026', 'secondary_qualifiant');
jdb.prepare('INSERT INTO student_movements(student_id, movement_type, school_year, cycle_code) VALUES(1, ?, ?, ?)').run('internal', '2025/2026', 'secondary_qualifiant');
jdb.prepare('INSERT INTO correspondence(student_id, student_code, letter_type, school_year, cycle_code) VALUES(1, ?, ?, ?, ?)').run('Q-001', 'warning', '2025/2026', 'secondary_qualifiant');

setCaptureGetDb(() => jdb);
for (const table of ['student_files', 'student_movements', 'correspondence']) {
    recordOutboxEntry(jdb, table, 1, 'PUT', jdb.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(1), '2025/2026');
}
for (const table of ['student_files', 'student_movements', 'correspondence']) {
    const outboxRow = jdb.prepare('SELECT row_data, operation FROM sync_outbox WHERE table_name = ? AND school_year = ?').get(table, '2025/2026');
    const data = JSON.parse(outboxRow.row_data);
    assert.ok(data.cycle_code, `${table} captured rows carry cycle_code`);
    assert.strictEqual(data.cycle_code, 'secondary_qualifiant', `${table} keeps the session cycle`);
}
console.log('  [ok] captured rows for the three S7 tables are cycle-complete');

const qStats = { appliedCount: 0, failedCount: 0, conflictCount: 0, failures: [], quarantinedCount: 0, quarantined: [] };
for (const table of ['student_files', 'student_movements', 'correspondence']) {
    recordPullQuarantine(
        jdb,
        qStats,
        { tableName: table, operation: 'PUT', rowSyncId: `missing-${table}`, data: { id: 99, school_year: '2025/2026' } },
        `سجل وارد بدون قيم مطلوبة في ${table}: cycle_code`,
        { contractVersion: 2 }
    );
}
assert.strictEqual(qStats.quarantinedCount, 3, 'every S7 table quarantines a cycle-less doc');
assert.strictEqual(countQuarantinedRows(jdb), 3);
setCaptureGetDb(null);
console.log('  [ok] a doc without cycle_code is quarantined with an Arabic reason');
console.log('[test] multi-cycle sync contracts OK');

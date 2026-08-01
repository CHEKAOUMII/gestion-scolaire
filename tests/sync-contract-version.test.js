'use strict';

/**
 * Sync entity contract enforcement (multi-cycle plan §9.2).
 *
 * Devices in one institution are not upgraded together. Before this contract, a device
 * whose schema lacked a column simply had it removed by filterToValidColumns and wrote
 * the row anyway — a cycle-scoped record could land with its cycle silently stripped and
 * then show up inside another cycle's lists. These tests pin the replacement behavior:
 * declare the column, and the row is refused and recorded instead of quietly degraded.
 */

const assert = require('assert');

const registry = require('../main/sync/entity-registry');
const { clearSchemaColumnsCache } = require('../main/sync/engine/helpers');
const { checkLocalContract, applySingleItem } = require('../main/sync/engine/apply');

console.log('[test] sync entity contract versioning');

// ── Registry declarations ──────────────────────────────────────────────────
assert.deepStrictEqual(registry.getRequiredColumns('institution_cycles'), ['cycle_code']);
assert.strictEqual(registry.getContractVersion('institution_cycles'), 2);
assert.deepStrictEqual(registry.getRequiredColumns('teachers'), [], 'undeclared entities stay unconstrained');
assert.strictEqual(registry.getContractVersion('teachers'), 1, 'undeclared entities are contract v1');
// Students are cycle-carrying: the column is required, but identity keeps its own shape.
assert.deepStrictEqual(registry.getRequiredColumns('students'), ['cycle_code']);
assert.strictEqual(registry.getContractVersion('students'), 2);
assert.deepStrictEqual(registry.getLocalKeyFields('students'), ['school_year', 'code']);
assert.strictEqual(registry.isCycleKeyed('students'), false, 'a student keeps school_year+code identity');
assert.strictEqual(registry.isCycleKeyed('institution_cycles'), false, 'the membership table is not itself keyed by cycle');
assert.deepStrictEqual(registry.validateEntityRegistry(), [], 'shipped registry satisfies its own contract rules');
console.log('  [ok] contract metadata is declared and the registry validates');

// ── Registry validation catches malformed cycle-scoped entities ────────────
function validationErrorsFor(entity) {
    const name = '__probe__';
    registry.ENTITY_REGISTRY[name] = entity;
    try {
        return registry.validateEntityRegistry().filter((error) => error.startsWith(name));
    } finally {
        delete registry.ENTITY_REGISTRY[name];
    }
}

const badScoped = validationErrorsFor({
    entityType: 'probe',
    local: { table: 'probe', keyFields: ['school_year', 'code'], cycleKeyed: true, contractVersion: 2 },
    remote: { collection: 'probe', idFields: ['code'] },
    authority: { writers: [] }
});
assert.strictEqual(badScoped.length, 3, 'missing cycle_code is reported for keys, required columns and remote ids');
assert.ok(badScoped.some((error) => error.includes('local.keyFields')));
assert.ok(badScoped.some((error) => error.includes('must require cycle_code')));
assert.ok(badScoped.some((error) => error.includes('remote.idFields')));

const goodScoped = validationErrorsFor({
    entityType: 'probe',
    local: {
        table: 'probe',
        keyFields: ['school_year', 'cycle_code', 'code'],
        cycleKeyed: true,
        contractVersion: 2,
        requiredColumns: ['cycle_code']
    },
    remote: { collection: 'probe', idFields: ['cycle_code', 'code'] },
    authority: { writers: [] }
});
assert.deepStrictEqual(goodScoped, [], 'a correctly declared cycle-keyed entity passes');

const unversioned = validationErrorsFor({
    entityType: 'probe',
    local: { table: 'probe', keyFields: ['code'], requiredColumns: ['cycle_code'] },
    remote: { collection: 'probe', idFields: ['code'] },
    authority: { writers: [] }
});
assert.ok(
    unversioned.some((error) => error.includes('contractVersion')),
    'adding required columns without bumping the contract version is rejected'
);
console.log('  [ok] cycle-keyed entities cannot ship without cycle_code in their merge keys');

// ── Apply-time behavior ────────────────────────────────────────────────────
// The column cache is keyed by table name, so each simulated device must start clean —
// the same reason a restore has to clear it (see clearSchemaColumnsCache).
function dbWithColumns(columns) {
    clearSchemaColumnsCache();
    return {
        prepare(sql) {
            if (/PRAGMA table_info/i.test(sql)) {
                return { all: () => columns.map((name) => ({ name, pk: name === 'id' ? 1 : 0 })) };
            }
            throw new Error(`[test-db] unexpected SQL: ${sql}`);
        }
    };
}

const STALE_COLUMNS = ['id', 'profile_version'];
const CURRENT_COLUMNS = ['id', 'cycle_code', 'profile_version', 'is_active'];
const incoming = {
    tableName: 'institution_cycles',
    operation: 'PUT',
    rowSyncId: 'r1',
    data: { cycle_code: 'secondary_collegial', is_active: 1 }
};

const staleFailure = checkLocalContract(dbWithColumns(STALE_COLUMNS), incoming);
assert.ok(staleFailure, 'a device without the column must refuse the row');
assert.ok(staleFailure.includes('cycle_code'), 'the reason names the missing column');
assert.ok(staleFailure.includes('contract v2'), 'the reason carries the contract version');
assert.strictEqual(
    checkLocalContract(dbWithColumns(CURRENT_COLUMNS), incoming),
    null,
    'an up-to-date device applies normally'
);

assert.strictEqual(
    checkLocalContract(dbWithColumns(CURRENT_COLUMNS), { ...incoming, data: { is_active: 1 } }),
    'سجل وارد بدون قيم مطلوبة في institution_cycles: cycle_code',
    'a payload missing the value is refused even when the column exists'
);
// The S7 student child tables enforce the same contract: a pushed doc without
// cycle_code is refused before it can be applied cycle-less.
for (const table of ['student_files', 'student_movements', 'correspondence', 'student_profile_data']) {
    assert.strictEqual(
        checkLocalContract(dbWithColumns(['id', 'school_year', 'cycle_code']), {
            ...incoming,
            tableName: table,
            data: { id: 1, school_year: '2025/2026' }
        }),
        `سجل وارد بدون قيم مطلوبة في ${table}: cycle_code`,
        `${table} refuses a cycle-less payload`
    );
}
assert.strictEqual(
    checkLocalContract(dbWithColumns(STALE_COLUMNS), { ...incoming, operation: 'DEL' }),
    null,
    'deletes are not blocked by column contracts'
);
assert.strictEqual(
    checkLocalContract(dbWithColumns(STALE_COLUMNS), { ...incoming, tableName: 'teachers' }),
    null,
    'entities that declare no contract are unaffected'
);
// A device that has not run migration 071 must refuse students rather than store them
// with no cycle at all — the same protection, on the first cycle-carrying domain table.
assert.ok(
    checkLocalContract(dbWithColumns(['id', 'code', 'full_name', 'school_year']), {
        ...incoming,
        tableName: 'students',
        data: { code: 'S1', school_year: '2025/2026', cycle_code: 'secondary_qualifiant' }
    }),
    'a pre-migration device refuses incoming students'
);
console.log('  [ok] stale schemas refuse scoped rows instead of stripping columns');

// ── The refusal is quarantined, not swallowed and not treated as a failure ──
// Without a quarantine store the reason lands in the retryable failure path, which holds
// the pull cursor. That is the fallback, kept so a row is never lost — but it is also why
// the store must exist: a permanent contract violation retried forever would stop every
// other entity from syncing on that device.
const fallbackStats = { appliedCount: 0, failedCount: 0, conflictCount: 0, failures: [] };
applySingleItem(dbWithColumns(STALE_COLUMNS), { ...incoming }, new Map(), [], [], [], fallbackStats, false);
assert.strictEqual(fallbackStats.appliedCount, 0, 'nothing is written on a stale device');
assert.strictEqual(fallbackStats.failedCount, 1, 'with no quarantine store the row falls back to retry');
assert.ok(
    fallbackStats.failures[0].reason.includes('هذا الجهاز يحتاج تحديثاً'),
    'the operator sees an Arabic "update this device" reason'
);
console.log('  [ok] a row is never dropped, even when it cannot be quarantined');

// ── Quarantine on a device with the store present ──────────────────────────
const {
    recordPullQuarantine,
    loadQuarantinedPullItems,
    releaseQuarantinedItem,
    countQuarantinedRows
} = require('../main/sync/engine/helpers');

function openDb() {
    try {
        const Database = require('better-sqlite3');
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        return new DatabaseSync(':memory:');
    }
}

const qdb = openDb();
qdb.exec(`
    CREATE TABLE sync_quarantine (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        row_sync_id TEXT NOT NULL UNIQUE,
        table_name TEXT NOT NULL,
        operation TEXT NOT NULL,
        contract_version INTEGER DEFAULT 1,
        reason TEXT NOT NULL,
        item_json TEXT NOT NULL,
        retry_count INTEGER NOT NULL DEFAULT 0,
        quarantined_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        last_attempt_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
`);

const qStats = { appliedCount: 0, failedCount: 0, conflictCount: 0, failures: [], quarantinedCount: 0, quarantined: [] };
recordPullQuarantine(qdb, qStats, incoming, 'هذا الجهاز يحتاج تحديثاً لاستقبال بيانات institution_cycles', {
    contractVersion: 2
});
assert.strictEqual(qStats.quarantinedCount, 1, 'the row is counted as quarantined');
assert.strictEqual(qStats.failedCount, 0, 'a quarantined row is not a failure, so it does not hold the cursor');
assert.strictEqual(countQuarantinedRows(qdb), 1);

// The stored payload must be replayable verbatim once the device catches up.
const [replayed] = loadQuarantinedPullItems(qdb);
assert.deepStrictEqual(replayed, incoming, 'the full payload survives quarantine');

// Re-quarantining the same row updates it in place and counts the attempt, rather than
// growing an unbounded queue of duplicates on every pull cycle.
recordPullQuarantine(qdb, qStats, incoming, 'same reason', { contractVersion: 2 });
assert.strictEqual(countQuarantinedRows(qdb), 1, 'a repeat quarantine updates the held row');
assert.strictEqual(
    Number(qdb.prepare('SELECT retry_count AS c FROM sync_quarantine WHERE row_sync_id = ?').get('r1').c),
    1,
    'the retry count records how long the device has been behind'
);

releaseQuarantinedItem(qdb, 'r1');
assert.strictEqual(countQuarantinedRows(qdb), 0, 'a row that now passes the contract leaves quarantine');
console.log('  [ok] contract violations are held for replay without stalling the pull cursor');
console.log('[test] sync entity contract versioning: all checks passed');

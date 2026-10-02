'use strict';

// Unit tests — bulk-entry expansion (SOLID WP0/WP1 / plan D3)
//
// Desired semantics (replaces unsafe mark-sent-on-failure baseline):
//   - expandBulkEntry returns typed { status, entries, error }
//   - Malformed / unknown channel / unknown table / legacy summary → status 'error'
//   - processOutboxRow never marks 'error' expansions as sent
//   - Valid empty exact expansion → mark sent
//   - Buffer still flushes before bulk expansion (ordering)

const assert = require('assert');

const { expandBulkEntry, processOutboxRow } = require('../main/sync/engine');

let checks = 0;

console.log('[unit] sync bulk-entry expansion (typed outcomes D3)');

function createRecordingDb(opts = {}) {
    const {
        byIdRows = {},
        throwOnRead = false,
        outboxRow = { row_sync_id: 'rs-1', row_data: '{"_bulk":true}' }
    } = opts;

    const events = [];

    function norm(sql) {
        return String(sql).replace(/\s+/g, ' ').trim();
    }

    const db = {
        events,
        transaction(fn) {
            return (...args) => fn(...args);
        },
        prepare(sqlRaw) {
            const sql = norm(sqlRaw);
            events.push({ type: 'sql', sql });

            if (sql.startsWith('PRAGMA table_info')) {
                return { all: () => [{ name: 'id' }, { name: 'school_year' }] };
            }
            if (/^SELECT \* FROM ".*" WHERE id = \?/.test(sql)) {
                return {
                    get: (id) => {
                        if (throwOnRead) throw new Error('simulated read failure: no such table');
                        return byIdRows[id] || null;
                    }
                };
            }
            if (/^SELECT \* FROM "/.test(sql)) {
                return {
                    all: () => {
                        if (throwOnRead) throw new Error('simulated read failure: no such table');
                        return [];
                    },
                    get: () => null
                };
            }
            if (sql.startsWith('INSERT OR IGNORE INTO sync_id_map') || sql.startsWith('INSERT INTO sync_id_map')) {
                return { run: () => ({ changes: 1 }) };
            }
            if (sql.startsWith('UPDATE sync_outbox SET retries = retries + 1')) {
                return { run: () => ({ changes: 1 }) };
            }
            if (sql.startsWith('SELECT row_sync_id, row_data FROM sync_outbox')) {
                return { get: () => outboxRow };
            }
            if (sql.startsWith("UPDATE sync_outbox SET status = 'sent'")) {
                return { run: () => ({ changes: 1 }) };
            }
            if (sql.startsWith('UPDATE sync_id_map')) {
                return { run: () => ({ changes: 1 }) };
            }
            if (sql.startsWith('UPDATE sync_conflicts')) {
                return { run: () => ({ changes: 1 }) };
            }
            if (sql.startsWith('SELECT retries FROM sync_outbox')) {
                return { get: () => ({ retries: 0 }) };
            }
            if (sql.startsWith('UPDATE sync_outbox SET retries = ?') || sql.startsWith('UPDATE sync_outbox SET')) {
                return { run: () => ({ changes: 1 }) };
            }
            throw new Error('[recording db] Unhandled SQL statement: ' + sql);
        }
    };
    return db;
}

const NO_DISPATCH_FIRESTORE = new Proxy(
    {},
    {
        get() {
            throw new Error('firestoreDb must not be touched when no documents are dispatched');
        }
    }
);

function makeCtx(db, { batchBuffer = [], flushReturns = false } = {}) {
    const ctx = {
        role: 'admin',
        schoolId: 'school1',
        deviceHash: 'device-hash',
        maxRetries: 10,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        throttleErrors: 0,
        lastError: null,
        syncLogOk: true,
        batchBuffer: batchBuffer.slice(),
        dispatchThreshold: 1000,
        flushCalls: 0,
        flushBuffer: null
    };
    ctx.flushBuffer = async () => {
        ctx.flushCalls += 1;
        db.events.push({ type: 'flush', bufferLenAtFlush: ctx.batchBuffer.length });
        ctx.batchBuffer = [];
        return flushReturns;
    };
    return ctx;
}

function bulkRow(over = {}) {
    return Object.assign(
        {
            id: 1,
            table_name: 'students',
            row_sync_id: 'rs-1',
            operation: 'PUT',
            row_data: JSON.stringify({ _bulk: true }),
            school_year: '2025/2026'
        },
        over
    );
}

function captureWarn(fn) {
    const original = console.warn;
    const messages = [];
    console.warn = (...args) => {
        messages.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
    };
    try {
        const result = fn();
        return { result, messages };
    } finally {
        console.warn = original;
    }
}

// ===========================================================================
// Buffer flush still precedes bulk handling
// ===========================================================================
(async () => {
    const db = createRecordingDb();
    const ctx = makeCtx(db, { batchBuffer: [{ entryId: 99, item: { documentId: 'd99' } }] });

    // Legacy bulk without keys → error (no full-table read)
    const action = await processOutboxRow(db, NO_DISPATCH_FIRESTORE, bulkRow(), ctx);

    assert.strictEqual(ctx.flushCalls, 1, 'buffer must flush before bulk expansion');
    checks += 1;

    const flushIndex = db.events.findIndex((e) => e.type === 'flush');
    assert.ok(flushIndex >= 0, 'flush event recorded');
    checks += 1;

    const markedFailed = db.events.some(
        (e) => e.type === 'sql' && (e.sql.includes("status = 'failed'") || e.sql.startsWith('SELECT retries FROM sync_outbox'))
    );
    assert.ok(markedFailed || ctx.failedCount >= 1, 'legacy bulk without keys must fail, not skip as sent');
    checks += 1;

    assert.strictEqual(action, 'continue');
    checks += 1;
})()
    .then(async () => {
        const db = createRecordingDb();
        const ctx = makeCtx(db, {
            batchBuffer: [{ entryId: 5, item: { documentId: 'd5' } }],
            flushReturns: true
        });

        const action = await processOutboxRow(db, NO_DISPATCH_FIRESTORE, bulkRow(), ctx);
        assert.strictEqual(action, 'break', 'aborting pre-expansion flush must break');
        assert.strictEqual(ctx.flushCalls, 1);
        checks += 1;
    })
    // ===========================================================================
    // Typed expandBulkEntry outcomes
    // ===========================================================================
    .then(() => {
        // (a) Malformed JSON → error
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow({ row_data: '{ not valid json' }), 'device-hash')
            );
            assert.strictEqual(result.status, 'error', 'parse failure → error');
            assert.deepStrictEqual(result.entries, []);
            assert.ok(messages.length > 0);
            checks += 1;
        }

        // (b) Unknown channel → error
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(
                    db,
                    bulkRow({
                        row_data: JSON.stringify({ _bulk: true, channel: '__nonexistent_channel__' })
                    }),
                    'device-hash'
                )
            );
            assert.strictEqual(result.status, 'error', 'unknown channel → error');
            assert.ok(messages.some((m) => m.includes('Unknown bulk channel')));
            checks += 1;
        }

        // (c) Unknown table → error
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow({ table_name: '__unknown_table__' }), 'device-hash')
            );
            assert.strictEqual(result.status, 'error', 'unknown table → error');
            assert.ok(messages.some((m) => m.includes('unknown table')));
            checks += 1;
        }

        // (d) Legacy summary without keys → error (never full-table expand)
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() => expandBulkEntry(db, bulkRow(), 'device-hash'));
            assert.strictEqual(result.status, 'error', 'legacy bulk without keys → error');
            assert.ok(messages.some((m) => m.includes('cannot be expanded safely') || m.includes('Legacy bulk')));
            const didFullTable = db.events.some((e) => e.type === 'sql' && /^SELECT \* FROM "students"$/.test(e.sql));
            assert.ok(!didFullTable, 'must not full-table SELECT for legacy bulk');
            checks += 1;
        }

        // (e) Exact empty localIds → empty
        {
            const db = createRecordingDb();
            const result = expandBulkEntry(
                db,
                bulkRow({
                    row_data: JSON.stringify({ _bulk: true, channel: 'students:addBulk', localIds: [] })
                }),
                'device-hash'
            );
            assert.strictEqual(result.status, 'empty');
            assert.deepStrictEqual(result.entries, []);
            checks += 1;
        }

        // (f) Exact localIds → expanded
        {
            const db = createRecordingDb({
                byIdRows: {
                    7: { id: 7, code: 'S1', school_year: '2025/2026', full_name: 'A' }
                }
            });
            const result = expandBulkEntry(
                db,
                bulkRow({
                    row_data: JSON.stringify({ _bulk: true, channel: 'students:addBulk', localIds: [7] })
                }),
                'device-hash'
            );
            assert.strictEqual(result.status, 'expanded');
            assert.strictEqual(result.entries.length, 1);
            assert.strictEqual(result.entries[0].table_name, 'students');
            checks += 1;
        }
    })
    // ===========================================================================
    // processOutboxRow: empty exact → mark sent; error → mark failed
    // ===========================================================================
    .then(async () => {
        const db = createRecordingDb();
        const ctx = makeCtx(db);
        const action = await processOutboxRow(
            db,
            NO_DISPATCH_FIRESTORE,
            bulkRow({
                row_data: JSON.stringify({ _bulk: true, channel: 'students:addBulk', localIds: [] })
            }),
            ctx
        );
        const markedSent = db.events.some((e) => e.type === 'sql' && e.sql.startsWith("UPDATE sync_outbox SET status = 'sent'"));
        assert.ok(markedSent, 'exact empty expansion may mark sent');
        assert.strictEqual(action, 'continue');
        checks += 1;
    })
    .then(async () => {
        const db = createRecordingDb();
        const ctx = makeCtx(db);
        const originalWarn = console.warn;
        console.warn = () => {};
        try {
            await processOutboxRow(
                db,
                NO_DISPATCH_FIRESTORE,
                bulkRow({ row_data: JSON.stringify({ _bulk: true, channel: '__nonexistent_channel__' }) }),
                ctx
            );
        } finally {
            console.warn = originalWarn;
        }

        assert.strictEqual(ctx.sentCount, 0);
        assert.ok(ctx.failedCount >= 1, 'expansion error must increment failedCount');
        const markedSent = db.events.some((e) => e.type === 'sql' && e.sql.startsWith("UPDATE sync_outbox SET status = 'sent'"));
        assert.ok(!markedSent, 'expansion error must NOT mark sent');
        checks += 1;
    })
    .then(() => {
        console.log(`[pass] bulk-entry expansion behavior held across ${checks} assertions`);
    })
    .catch((err) => {
        console.error('[fail] bulk-entry expansion behavior:', err && err.stack ? err.stack : err);
        process.exit(1);
    });

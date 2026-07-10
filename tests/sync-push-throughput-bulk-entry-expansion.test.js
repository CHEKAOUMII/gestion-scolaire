'use strict';

// Unit tests — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.7 — Bulk-entry expansion behavior:
//   - `expandBulkEntry` invocation ordering before enqueue: the prepared-item
//     buffer is flushed BEFORE a bulk entry is expanded/dispatched, so bulk
//     entries are never interleaved into a concurrent group with preceding
//     non-bulk items (Req 5.2).
//   - Zero expanded documents -> mark the bulk entry sent, dispatch none (Req 5.4).
//   - Expansion failure (parse failure / unknown table / unknown channel /
//     read failure) -> dispatch none and surface the error; the entry is handled
//     (skipped) rather than dispatched (Req 5.5).
//
// Exercises the REAL exported `expandBulkEntry` and `processOutboxRow` from
// main/sync/engine.js. Only the SQLite execution layer is substituted with a
// faithful recording stub (same philosophy as tests/fixtures/sync-outbox-db.js):
// the engine functions under test are the genuine production functions. No
// Firestore is touched — every assertion below keeps the expansion result empty,
// so `flushExpandedEntries` (the only path that dispatches documents) is never
// reached, and the `firestoreDb` argument is a guard that throws if used.

const assert = require('assert');

const { expandBulkEntry, processOutboxRow } = require('../main/sync/engine');

let checks = 0;

console.log('[unit] sync-push-throughput bulk-entry expansion (Req 5.2, 5.4, 5.5)');

// ---------------------------------------------------------------------------
// Test doubles
// ---------------------------------------------------------------------------

// A recording SQLite stub. It records every prepared statement (normalized) into
// `db.events` and returns faithful run/get/all shapes for exactly the closed set
// of statements `expandBulkEntry`, `bumpRetryCount`, and `markEntrySent` execute.
// Any unrecognized statement throws loudly so a future engine change surfaces here.
function createRecordingDb(opts = {}) {
    const {
        // Columns returned by PRAGMA table_info("<table>").
        pragmaColumns = [{ name: 'id' }, { name: 'school_year' }],
        // Rows returned by SELECT * FROM "<table>".
        selectRows = [],
        // When true, SELECT * FROM "<table>" throws (simulates a read failure).
        throwOnRead = false,
        // Backing values markEntrySent reads from sync_outbox.
        outboxRow = { row_sync_id: 'rs-1', row_data: '{"_bulk":true}' }
    } = opts;

    const events = [];

    function norm(sql) {
        return String(sql).replace(/\s+/g, ' ').trim();
    }

    const db = {
        events,
        // Mirror better-sqlite3's db.transaction(fn): markEntrySent now wraps its writes
        // in a transaction, so the stub must expose the same API (pass-through here).
        transaction(fn) {
            return (...args) => fn(...args);
        },
        prepare(sqlRaw) {
            const sql = norm(sqlRaw);
            events.push({ type: 'sql', sql });

            if (sql.startsWith('PRAGMA table_info')) {
                return { all: () => pragmaColumns };
            }
            if (/^SELECT \* FROM "/.test(sql)) {
                return {
                    all: () => {
                        if (throwOnRead) throw new Error('simulated read failure: no such table');
                        return selectRows;
                    }
                };
            }
            // bumpRetryCount
            if (sql.startsWith('UPDATE sync_outbox SET retries = retries + 1')) {
                return { run: () => ({ changes: 1 }) };
            }
            // markEntrySent: pre-read of row_sync_id / row_data
            if (sql.startsWith('SELECT row_sync_id, row_data FROM sync_outbox')) {
                return { get: () => outboxRow };
            }
            // markEntrySent: status -> 'sent'
            if (sql.startsWith("UPDATE sync_outbox SET status = 'sent'")) {
                return { run: () => ({ changes: 1 }) };
            }
            // markEntrySent: sync_id_map version bump
            if (sql.startsWith('UPDATE sync_id_map')) {
                return { run: () => ({ changes: 1 }) };
            }
            // markEntrySent: resolve related conflicts
            if (sql.startsWith('UPDATE sync_conflicts')) {
                return { run: () => ({ changes: 1 }) };
            }
            // markEntryFailed: retry read + write (should NOT be reached in these tests)
            if (sql.startsWith('SELECT retries FROM sync_outbox')) {
                return { get: () => ({ retries: 0 }) };
            }
            if (sql.startsWith('UPDATE sync_outbox SET retries = ?')) {
                return { run: () => ({ changes: 1 }) };
            }
            throw new Error('[recording db] Unhandled SQL statement: ' + sql);
        }
    };
    return db;
}

// A `firestoreDb` that throws on ANY property access. If the engine ever tries to
// dispatch a document down the no-document path, the test fails loudly.
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
        // Record the flush event AND the buffer length at flush time so ordering
        // assertions can prove the buffer was drained before expansion.
        db.events.push({ type: 'flush', bufferLenAtFlush: ctx.batchBuffer.length });
        ctx.batchBuffer = [];
        return flushReturns; // truthy => abort
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

// Capture console.warn for "surface the error" assertions.
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

function firstExpansionSqlIndex(events) {
    return events.findIndex(
        (e) =>
            e.type === 'sql' &&
            (e.sql.startsWith('PRAGMA table_info') || /^SELECT \* FROM "/.test(e.sql))
    );
}

// ===========================================================================
// Req 5.2 — The prepared-item buffer is flushed BEFORE a bulk entry is
// expanded/dispatched. Bulk entries are not interleaved into a concurrent group
// with preceding non-bulk items.
// ===========================================================================
(async () => {
    const db = createRecordingDb({ selectRows: [] }); // known table, zero rows -> expanded == []
    // A non-bulk prepared item is already buffered (would dispatch as a group).
    const ctx = makeCtx(db, { batchBuffer: [{ entryId: 99, item: { documentId: 'd99' } }] });

    const action = await processOutboxRow(db, NO_DISPATCH_FIRESTORE, bulkRow(), ctx);

    // The buffer was flushed exactly once, draining the pending non-bulk item.
    assert.strictEqual(ctx.flushCalls, 1, 'the prepared-item buffer must be flushed once before bulk expansion');
    checks += 1;

    const flushIndex = db.events.findIndex((e) => e.type === 'flush');
    const expansionIndex = firstExpansionSqlIndex(db.events);
    assert.ok(flushIndex >= 0, 'a flush event must have been recorded');
    assert.ok(expansionIndex >= 0, 'expandBulkEntry must have read the source table');
    assert.ok(
        flushIndex < expansionIndex,
        `buffer flush (index ${flushIndex}) must precede bulk expansion (index ${expansionIndex})`
    );
    checks += 1;

    // The flushed buffer contained the preceding non-bulk item (it was not left
    // to interleave with the bulk entry's documents).
    const flushEvent = db.events[flushIndex];
    assert.strictEqual(flushEvent.bufferLenAtFlush, 1, 'the preceding non-bulk item must be in the buffer at flush time');
    assert.strictEqual(ctx.batchBuffer.length, 0, 'the buffer must be empty after the pre-expansion flush');
    checks += 1;

    assert.strictEqual(action, 'continue', 'processing a (zero-doc) bulk row should continue the cycle');
    checks += 1;
})()
    // ===========================================================================
    // Req 5.2 — When the pre-expansion flush signals an access-denied abort, the
    // bulk entry is NOT expanded/dispatched at all (it breaks before expansion).
    // ===========================================================================
    .then(async () => {
        const db = createRecordingDb({ selectRows: [] });
        const ctx = makeCtx(db, {
            batchBuffer: [{ entryId: 5, item: { documentId: 'd5' } }],
            flushReturns: true // flush reports abort
        });

        const action = await processOutboxRow(db, NO_DISPATCH_FIRESTORE, bulkRow(), ctx);

        assert.strictEqual(action, 'break', 'an aborting pre-expansion flush must break before expanding the bulk entry');
        assert.strictEqual(ctx.flushCalls, 1, 'the buffer flush must have been attempted');
        assert.strictEqual(
            firstExpansionSqlIndex(db.events),
            -1,
            'no bulk expansion may occur once the pre-expansion flush aborts'
        );
        checks += 1;
    })
    // ===========================================================================
    // Req 5.4 — Zero expanded documents: mark the originating entry sent and
    // dispatch nothing.
    // ===========================================================================
    .then(async () => {
        const db = createRecordingDb({ selectRows: [] }); // known table, no rows
        const ctx = makeCtx(db);

        const action = await processOutboxRow(db, NO_DISPATCH_FIRESTORE, bulkRow(), ctx);

        // markEntrySent ran (status -> 'sent') for the originating entry.
        const markedSent = db.events.some((e) => e.type === 'sql' && e.sql.startsWith("UPDATE sync_outbox SET status = 'sent'"));
        assert.ok(markedSent, 'a zero-document bulk entry must be marked sent');
        checks += 1;

        // No documents dispatched: the per-item counters are untouched because
        // flushExpandedEntries was never entered.
        assert.strictEqual(ctx.sentCount, 0, 'no per-document sent count when zero documents expand');
        assert.strictEqual(ctx.failedCount, 0, 'no failures when zero documents expand');
        assert.strictEqual(ctx.skippedCount, 0, 'no skips when zero documents expand');
        checks += 1;

        // markEntryFailed must NOT have run (no failure path for a clean zero-doc entry).
        const markedFailed = db.events.some((e) => e.type === 'sql' && e.sql.startsWith('SELECT retries FROM sync_outbox'));
        assert.ok(!markedFailed, 'a zero-document bulk entry must not be marked failed');
        checks += 1;

        assert.strictEqual(action, 'continue', 'a zero-document bulk entry continues the cycle');
        checks += 1;
    })
    // ===========================================================================
    // Req 5.5 — Expansion failures surface the error and dispatch no documents.
    // `expandBulkEntry` swallows every failure mode into an empty result while
    // logging a warning (the surfaced error), so nothing is ever dispatched.
    // ===========================================================================
    .then(() => {
        // (a) Malformed JSON row_data -> parse failure.
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow({ row_data: '{ not valid json' }), 'device-hash')
            );
            assert.deepStrictEqual(result, [], 'parse failure must expand to zero documents');
            assert.ok(messages.length > 0, 'parse failure must surface a warning');
            assert.strictEqual(firstExpansionSqlIndex(db.events), -1, 'parse failure must not read any source table');
            checks += 1;
        }

        // (b) Unknown bulk channel.
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow({ row_data: JSON.stringify({ _bulk: true, channel: '__nonexistent_channel__' }) }), 'device-hash')
            );
            assert.deepStrictEqual(result, [], 'unknown channel must expand to zero documents');
            assert.ok(
                messages.some((m) => m.includes('Unknown bulk channel')),
                'unknown channel must surface a warning naming the channel'
            );
            assert.strictEqual(firstExpansionSqlIndex(db.events), -1, 'unknown channel must not read any source table');
            checks += 1;
        }

        // (c) Unknown table.
        {
            const db = createRecordingDb();
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow({ table_name: '__unknown_table__' }), 'device-hash')
            );
            assert.deepStrictEqual(result, [], 'unknown table must expand to zero documents');
            assert.ok(
                messages.some((m) => m.includes('unknown table')),
                'unknown table must surface a warning'
            );
            assert.strictEqual(firstExpansionSqlIndex(db.events), -1, 'unknown table must not read any source table');
            checks += 1;
        }

        // (d) Source-table read failure.
        {
            const db = createRecordingDb({ throwOnRead: true });
            const { result, messages } = captureWarn(() =>
                expandBulkEntry(db, bulkRow(), 'device-hash')
            );
            assert.deepStrictEqual(result, [], 'a read failure must expand to zero documents');
            assert.ok(messages.length > 0, 'a read failure must surface a warning');
            checks += 1;
        }
    })
    // ===========================================================================
    // Req 5.5 — Through `processOutboxRow`, an expansion failure for an authorized
    // bulk row dispatches NO documents (firestoreDb is never touched) and the
    // entry is handled without crashing. The current engine treats the failed
    // expansion as a skip (markEntrySent) — see the note in the suite report.
    // ===========================================================================
    .then(async () => {
        // students is authorized for 'admin' (canPush true), but the unknown
        // channel makes expansion fail INSIDE the _bulk branch.
        const db = createRecordingDb();
        const ctx = makeCtx(db);

        // processOutboxRow is async and the warning fires after an internal await,
        // so capture console.warn across the full awaited execution.
        const originalWarn = console.warn;
        const messages = [];
        console.warn = (...args) => {
            messages.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
        };
        let resolved;
        try {
            resolved = await processOutboxRow(
                db,
                NO_DISPATCH_FIRESTORE,
                bulkRow({ row_data: JSON.stringify({ _bulk: true, channel: '__nonexistent_channel__' }) }),
                ctx
            );
        } finally {
            console.warn = originalWarn;
        }

        assert.ok(
            messages.some((m) => m.includes('Unknown bulk channel')),
            'expansion failure must surface a warning'
        );
        checks += 1;

        // Dispatch none: no per-document counters moved and firestoreDb untouched.
        assert.strictEqual(ctx.sentCount, 0, 'expansion failure dispatches no documents (sentCount)');
        assert.strictEqual(ctx.failedCount, 0, 'expansion failure dispatches no documents (failedCount)');
        checks += 1;

        assert.strictEqual(resolved, 'continue', 'an expansion failure must let the cycle continue');
        checks += 1;
    })
    .then(() => {
        console.log(`[pass] bulk-entry expansion behavior held across ${checks} assertions`);
    })
    .catch((err) => {
        console.error('[fail] bulk-entry expansion behavior:', err && err.stack ? err.stack : err);
        process.exit(1);
    });

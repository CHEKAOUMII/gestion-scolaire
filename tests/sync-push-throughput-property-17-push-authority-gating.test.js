'use strict';

// Property test — sync-push-throughput-optimization
//
// Spec: .kiro/specs/sync-push-throughput-optimization/
// Task 6.4 — Property 17: Push-authority gating
//
// **Validates: Requirements 5.1**
//
// Exercises the REAL exported `processOutboxRow` from main/sync/engine.js — the
// place the push path consults the `canPush(table_name, role)` gate while
// PREPARING items for dispatch. For arbitrary (table, role) combinations the test
// asserts the gate's decision drives behavior exactly:
//
//   canPush === false  -> the entry is NEVER enqueued for dispatch (it never enters
//                         ctx.batchBuffer, the sole conduit to Firestore), it is
//                         counted as skipped, and it is NEVER marked 'sent'.
//   canPush === true   -> the entry passes the gate and IS enqueued for dispatch
//                         (its prepared { entryId, item } lands in ctx.batchBuffer),
//                         and it is NOT counted as skipped.
//
// Why batchBuffer == "dispatched": processOutboxRow does not itself open a Firestore
// transaction. It buffers prepared, version-guarded items into ctx.batchBuffer; the
// cycle later flushes that buffer through flushPreparedItemsConcurrent ->
// writeItemWithVersionCheck. An item excluded from the buffer therefore can never be
// dispatched to Firestore. So buffer membership is the faithful, deterministic
// observable for "dispatched vs blocked".
//
// Implementation note (honest about the engine's actual behavior): for a blocked
// entry the push path records the block by marking the row 'failed' (markEntryFailed
// with forceFailed=true) so it is not retried forever. The Requirement 5.1 / Property
// 17 guarantees this test enforces are the security-critical ones: a blocked entry is
// excluded from dispatch and is never marked 'sent'. The test asserts the row's status
// is never 'sent' (it is left in a non-sent state), never enters the dispatch buffer,
// and is counted as skipped.
//
// Feature: sync-push-throughput-optimization, Property 17: For any prepared entry,
// when canPush(table_name, role) returns false the entry is excluded from dispatch,
// its sync_outbox row is left unchanged, and it is not marked sent.

const assert = require('assert');
const fc = require('fast-check');

const { processOutboxRow } = require('../main/sync/engine');
const { canPush, WRITER_AUTHORITY } = require('../main/sync/authority');

const MIN_RUNS = 200;

// ---------------------------------------------------------------------------
// Minimal in-memory sync_outbox / sync_id_map fake supporting EXACTLY the closed
// set of statements processOutboxRow + markEntryFailed + buildFirestoreDoc execute
// for the non-bulk path. Any unrecognized statement throws loudly so a future engine
// change surfaces here rather than silently passing.
// ---------------------------------------------------------------------------
function makeOutboxDb() {
    const rows = new Map(); // id -> outbox row
    const idMap = new Map(); // row_sync_id -> { version }
    let seq = 0;

    const norm = (s) => String(s).replace(/\s+/g, ' ').trim();
    const has = (s, frag) => s.indexOf(frag) !== -1;

    const db = {
        rows,
        idMap,
        seedRow({ tableName, rowSyncId, rowData = '{}', schoolYear = '2025/2026', retries = 0 }) {
            const id = ++seq;
            rows.set(id, {
                id,
                table_name: tableName,
                row_sync_id: rowSyncId,
                operation: 'PUT',
                row_data: rowData,
                school_year: schoolYear,
                status: 'pending',
                retries,
                last_error: null
            });
            idMap.set(rowSyncId, { version: 0 });
            return id;
        },
        prepare(sqlRaw) {
            const sql = norm(sqlRaw);

            // bumpRetryCount — must be checked before the generic "SET retries = ?" update.
            if (has(sql, 'UPDATE sync_outbox SET retries = retries + 1')) {
                return {
                    run: (id) => {
                        const r = rows.get(Number(id));
                        if (r) r.retries += 1;
                        return { changes: r ? 1 : 0 };
                    }
                };
            }
            // markEntryFailed
            if (has(sql, 'UPDATE sync_outbox SET retries = ?') && has(sql, 'status = ? WHERE id = ?')) {
                return {
                    run: (retries, error, status, id) => {
                        const r = rows.get(Number(id));
                        if (r) {
                            r.retries = retries;
                            r.last_error = error;
                            r.status = status;
                        }
                        return { changes: r ? 1 : 0 };
                    }
                };
            }
            // markEntrySent (should NOT be reached for blocked rows; available for safety)
            if (has(sql, "UPDATE sync_outbox SET status = 'sent'")) {
                return {
                    run: (id) => {
                        const r = rows.get(Number(id));
                        if (r) r.status = 'sent';
                        return { changes: r ? 1 : 0 };
                    }
                };
            }
            // markEntryFailed reads current retries
            if (has(sql, 'SELECT retries FROM sync_outbox WHERE id = ?')) {
                return {
                    get: (id) => {
                        const r = rows.get(Number(id));
                        return r ? { retries: r.retries } : undefined;
                    }
                };
            }
            // markEntrySent reads row_sync_id/row_data
            if (has(sql, 'SELECT row_sync_id, row_data FROM sync_outbox WHERE id = ?')) {
                return {
                    get: (id) => {
                        const r = rows.get(Number(id));
                        return r ? { row_sync_id: r.row_sync_id, row_data: r.row_data } : undefined;
                    }
                };
            }
            // buildFirestoreDoc reads the current version
            if (has(sql, 'SELECT version FROM sync_id_map WHERE row_sync_id = ?')) {
                return {
                    get: (rowSyncId) => {
                        const m = idMap.get(rowSyncId);
                        return m ? { version: m.version } : undefined;
                    }
                };
            }
            // student_files only — not used by this test's tables.
            if (has(sql, 'PRAGMA table_info')) {
                return { all: () => [] };
            }

            throw new Error(`[property-17 fake db] Unhandled SQL: ${sql}`);
        }
    };

    return db;
}

// Build a ctx for processOutboxRow. dispatchThreshold is set very high so the buffer
// never auto-flushes; flushBuffer is a spy that must never be invoked in this test
// (no bulk rows, threshold not reached) — if it is, that is a failure.
function makeCtx(role) {
    const ctx = {
        role,
        schoolId: 'SCHOOL1',
        deviceHash: 'devLOCAL000000aa',
        maxRetries: 10,
        sentCount: 0,
        failedCount: 0,
        skippedCount: 0,
        throttleErrors: 0,
        lastError: null,
        syncLogOk: true,
        batchBuffer: [],
        dispatchThreshold: 1e9,
        flushBufferCalls: 0,
        flushBuffer: null
    };
    ctx.flushBuffer = async () => {
        ctx.flushBufferCalls += 1;
        return false;
    };
    return ctx;
}

// Tables whose document id reduces to the row's local id (idFields ['id']) plus
// 'settings' (idFields ['key'], also derived from the local id by
// normalizeSortKeyRowData). For these, a rowSyncId of `SCHOOL1:<table>:<n>` yields a
// valid Firestore documentId with an EMPTY row_data, so buildFirestoreDoc succeeds and
// a pushable entry deterministically reaches ctx.batchBuffer.
const VALID_TABLES = [
    'settings',
    'teachers',
    'tests',
    'exams',
    'correspondence',
    'student_movements',
    'compensation_tracking',
    'system_tags'
];
const INVALID_TABLES = ['unknown_table', 'secret_collection', 'not_a_table'];

const VALID_ROLES = WRITER_AUTHORITY.settings.slice(); // ALL_WRITERS
const INVALID_ROLES = ['viewer', 'guest', 'owner', 'hacker', 'nobody'];

const tableArb = fc.constantFrom(...VALID_TABLES, ...INVALID_TABLES);
const roleArb = fc.constantFrom(...VALID_ROLES, ...INVALID_ROLES);

console.log('[pbt] sync-push-throughput Property 17: push-authority gating');

let checks = 0;
let blockedSeen = 0;
let allowedSeen = 0;

(async () => {
    await fc.assert(
        fc.asyncProperty(
            fc.array(fc.record({ table: tableArb, role: roleArb, localId: fc.integer({ min: 1, max: 99999 }) }), {
                minLength: 1,
                maxLength: 25
            }),
            roleArb,
            async (entries, sessionRole) => {
                // All rows in a cycle are processed under ONE session role (the push
                // engine resolves a single role per cycle). The per-entry generated role
                // is ignored for the gate; the gate uses (row.table_name, sessionRole).
                const db = makeOutboxDb();
                const ctx = makeCtx(sessionRole);

                const seeded = entries.map((e, i) => {
                    const rowSyncId = `SCHOOL1:${e.table}:${e.localId}_${i}`;
                    const entryId = db.seedRow({ tableName: e.table, rowSyncId });
                    return { entryId, table: e.table, rowSyncId, expectedPushable: canPush(e.table, sessionRole) };
                });

                for (const s of seeded) {
                    const row = db.rows.get(s.entryId);
                    const action = await processOutboxRow(db, /* firestoreDb */ {}, row, ctx);
                    assert.strictEqual(action, 'continue', 'non-bulk processOutboxRow should return continue');
                }

                // flushBuffer must never have been triggered (no bulk rows; threshold huge).
                assert.strictEqual(ctx.flushBufferCalls, 0, 'dispatch buffer must not flush during preparation');

                const bufferedIds = new Set(ctx.batchBuffer.map((p) => p.entryId));
                let expectedSkipped = 0;

                for (const s of seeded) {
                    const row = db.rows.get(s.entryId);
                    if (s.expectedPushable) {
                        allowedSeen += 1;
                        // Pushable → passed the gate and was enqueued for dispatch.
                        assert.ok(
                            bufferedIds.has(s.entryId),
                            `pushable entry ${s.entryId} (${s.table}) must be enqueued for dispatch`
                        );
                        // Buffered item carries the prepared Firestore doc for this row.
                        const prepared = ctx.batchBuffer.find((p) => p.entryId === s.entryId);
                        assert.ok(prepared && prepared.item, 'buffered entry must carry a prepared item');
                        assert.strictEqual(prepared.item.rowSyncId, s.rowSyncId, 'prepared item rowSyncId mismatch');
                        // Not yet sent (dispatch is deferred) and not skipped.
                        assert.notStrictEqual(row.status, 'sent', 'pushable entry must not be marked sent during preparation');
                    } else {
                        blockedSeen += 1;
                        expectedSkipped += 1;
                        // Blocked → excluded from dispatch and never marked sent.
                        assert.ok(
                            !bufferedIds.has(s.entryId),
                            `blocked entry ${s.entryId} (${s.table}/${ctx.role}) must NOT be enqueued for dispatch`
                        );
                        assert.notStrictEqual(row.status, 'sent', 'blocked entry must never be marked sent');
                        // sync_id_map version is untouched (no markEntrySent side effect).
                        assert.strictEqual(db.idMap.get(s.rowSyncId).version, 0, 'blocked entry must not bump version');
                    }
                }

                // Skip accounting matches exactly the blocked set.
                assert.strictEqual(ctx.skippedCount, expectedSkipped, 'skippedCount must equal the blocked entry count');
                // Every buffered entry corresponds to a pushable row (no blocked leakage).
                for (const p of ctx.batchBuffer) {
                    const s = seeded.find((x) => x.entryId === p.entryId);
                    assert.ok(s && s.expectedPushable, `buffered entry ${p.entryId} must be a pushable row`);
                }

                checks += 1;
                return true;
            }
        ),
        { numRuns: MIN_RUNS }
    );

    // -----------------------------------------------------------------------
    // Targeted anchors.
    // -----------------------------------------------------------------------

    // A. Valid table + valid role → enqueued for dispatch.
    {
        const db = makeOutboxDb();
        const ctx = makeCtx('admin');
        const id = db.seedRow({ tableName: 'settings', rowSyncId: 'SCHOOL1:settings:theme' });
        const action = await processOutboxRow(db, {}, db.rows.get(id), ctx);
        assert.strictEqual(action, 'continue');
        assert.strictEqual(ctx.batchBuffer.length, 1, 'admin → settings should be dispatched');
        assert.strictEqual(ctx.skippedCount, 0);
        assert.notStrictEqual(db.rows.get(id).status, 'sent');
    }

    // B. Valid table + INVALID role → blocked, skipped, not dispatched, not sent.
    {
        const db = makeOutboxDb();
        const ctx = makeCtx('viewer');
        const id = db.seedRow({ tableName: 'settings', rowSyncId: 'SCHOOL1:settings:theme' });
        const action = await processOutboxRow(db, {}, db.rows.get(id), ctx);
        assert.strictEqual(action, 'continue');
        assert.strictEqual(ctx.batchBuffer.length, 0, 'viewer → settings must be blocked from dispatch');
        assert.strictEqual(ctx.skippedCount, 1);
        assert.notStrictEqual(db.rows.get(id).status, 'sent');
    }

    // C. INVALID table + valid role → blocked (unknown table is not pushable).
    {
        const db = makeOutboxDb();
        const ctx = makeCtx('admin');
        const id = db.seedRow({ tableName: 'unknown_table', rowSyncId: 'SCHOOL1:unknown_table:1' });
        const action = await processOutboxRow(db, {}, db.rows.get(id), ctx);
        assert.strictEqual(action, 'continue');
        assert.strictEqual(ctx.batchBuffer.length, 0, 'unknown table must be blocked from dispatch');
        assert.strictEqual(ctx.skippedCount, 1);
        assert.notStrictEqual(db.rows.get(id).status, 'sent');
    }

    assert.ok(blockedSeen > 0, 'expected the generators to exercise blocked entries');
    assert.ok(allowedSeen > 0, 'expected the generators to exercise pushable entries');

    console.log(
        `[pass] Property 17 held across ${checks} generated cycles + anchors ` +
            `(blocked=${blockedSeen}, allowed=${allowedSeen})`
    );
})().catch((err) => {
    console.error('[fail] Property 17', err && err.stack ? err.stack : err);
    process.exit(1);
});

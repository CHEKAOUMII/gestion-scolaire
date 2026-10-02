/**
 * Sync capture DI: setCaptureGetDb / wrapWithSyncCapture options.getDb
 */
const assert = require('assert');
const {
    setCaptureGetDb,
    getCaptureDb,
    wrapWithSyncCapture,
    CHANNEL_REGISTRY
} = require('../main/sync/capture');

function makeFakeDb(opts = {}) {
    const outbox = [];
    const rows = opts.rows || {};
    return {
        outbox,
        prepare(sql) {
            const text = String(sql);
            return {
                get(...params) {
                    if (text.includes('FROM sync_id_map')) {
                        return null;
                    }
                    if (text.includes('SELECT * FROM') && opts.fetchById) {
                        return opts.fetchById(...params);
                    }
                    return rows.get || null;
                },
                run(...params) {
                    if (text.includes('INSERT INTO sync_outbox')) {
                        outbox.push({ sql: text, params });
                    }
                    if (text.includes('INSERT INTO sync_id_map')) {
                        return { lastInsertRowid: 1 };
                    }
                    return { changes: 1, lastInsertRowid: opts.lastInsertRowid || 42 };
                },
                all() {
                    return [];
                }
            };
        }
    };
}

function testSetCaptureGetDb() {
    const fake = makeFakeDb();
    setCaptureGetDb(() => fake);
    assert.strictEqual(getCaptureDb(), fake);
    setCaptureGetDb(null);
    // Restored default may throw if DB not init — just ensure setCaptureGetDb accepts null
    setCaptureGetDb(() => fake);
    assert.strictEqual(getCaptureDb(), fake);
    setCaptureGetDb(null);
    console.log('  [ok] setCaptureGetDb round-trip');
}

async function testWrapInjectsDb() {
    // Pick a simple PUT channel that uses lastInsertRowid
    const channel = 'absences:save';
    assert.ok(CHANNEL_REGISTRY[channel], 'registry has absences:save');

    const fake = makeFakeDb({ lastInsertRowid: 99 });
    let handlerRan = false;

    const wrapped = wrapWithSyncCapture(
        channel,
        async () => {
            handlerRan = true;
            return { success: true, id: 99 };
        },
        { getDb: () => fake }
    );

    const result = await wrapped({}, { student_code: 'X', school_year: '2025/2026' });
    assert.strictEqual(handlerRan, true);
    assert.strictEqual(result.success, true);
    // Capture may or may not insert depending on row fetch — must not throw
    console.log('  [ok] wrapWithSyncCapture options.getDb');
}

async function run() {
    console.log('[test] sync capture DI');
    try {
        testSetCaptureGetDb();
        await testWrapInjectsDb();
        console.log('[test] sync capture DI OK');
    } finally {
        setCaptureGetDb(null);
    }
}

run().catch((err) => {
    setCaptureGetDb(null);
    console.error(err);
    process.exit(1);
});

'use strict';

/**
 * Capture-port injectability (027-layering-remediation).
 * Plain Node — no Electron, no better-sqlite3 ABI required for no-op tests.
 */

const assert = require('assert');
const {
    createNoOpCapturePort,
    createDefaultCapturePort,
    setRepoCapturePort,
    getCapturePort,
    captureInputUpserts,
    notifyCaptureCommitted,
    deleteBySchoolYearWithCapture
} = require('../main/repos/capture-port');

function createTinyDb() {
    const absences = [];
    return {
        prepare(sql) {
            const s = String(sql);
            if (s.includes('DELETE FROM') && s.includes('absences')) {
                return {
                    run(year) {
                        const before = absences.length;
                        for (let i = absences.length - 1; i >= 0; i -= 1) {
                            if (absences[i].school_year === year) absences.splice(i, 1);
                        }
                        return { changes: before - absences.length };
                    }
                };
            }
            if (s.includes('SELECT * FROM') && s.includes('absences')) {
                return {
                    all(year) {
                        return absences.filter((r) => r.school_year === year);
                    }
                };
            }
            throw new Error('unexpected sql: ' + s);
        }
    };
}

function run() {
    // Reset
    setRepoCapturePort(null);

    const noop = createNoOpCapturePort();
    assert.strictEqual(typeof noop.captureInputUpserts, 'function');
    assert.strictEqual(typeof noop.notifyCaptureCommitted, 'function');

    setRepoCapturePort(noop);
    assert.strictEqual(getCapturePort(), noop);

    // Bound helpers use override
    assert.strictEqual(captureInputUpserts({}, { tableName: 'students', keyFields: ['code'], items: [] }), 0);
    notifyCaptureCommitted(); // must not throw

    const db = createTinyDb();
    // seed via no-op select path is empty; delete still works
    const deleted = deleteBySchoolYearWithCapture(db, 'absences', '2025/2026');
    assert.strictEqual(deleted, 0);

    setRepoCapturePort(null);
    const def = createDefaultCapturePort();
    assert.ok(def && typeof def.captureInputUpserts === 'function');
    assert.ok(typeof def.notifyCaptureCommitted === 'function');

    // Default port is the real capture module surface
    assert.strictEqual(typeof getCapturePort().captureInputUpserts, 'function');

    console.log('repos-capture-port.test.js: OK');
}

run();

'use strict';

/**
 * Orientation delete contract — import-pipeline review F5.
 *
 * - clearYear runs in one SQLite transaction and writes DEL tombstones for every
 *   deleted row through the capture port inside that transaction (sync-visible).
 * - deleteById writes its single DEL tombstone in the repo transaction too
 *   (CHANNEL_REGISTRY 'orientation:delete' is captureMode 'explicit'), so a
 *   mid-capture failure rolls the delete back and no duplicate outbox row exists.
 * - A capture failure mid-transaction rolls the whole clear back — rows survive.
 */

const assert = require('assert');

const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const orientationRepo = require('../main/repos/orientation');

const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';
const PREV_YEAR = '2024/2025';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        // Native ABI mismatch (module built for Electron) — fall back to node:sqlite.
    }
    const { DatabaseSync } = require('node:sqlite');
    const db = new DatabaseSync(':memory:');
    db.pragma = (statement) => db.prepare(`PRAGMA ${statement}`).all();
    db.transaction = (fn) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = fn(...args);
            db.exec('COMMIT');
            return result;
        } catch (err) {
            db.exec('ROLLBACK');
            throw err;
        }
    };
    return db;
}

function createProductionSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            full_name TEXT NOT NULL,
            gender TEXT,
            section TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT
        );
        CREATE TABLE student_orientation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_code TEXT NOT NULL,
            full_name TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            origin_stream TEXT NOT NULL,
            choice_1 TEXT,
            choice_2 TEXT,
            choice_3 TEXT,
            assigned_stream TEXT,
            decision_status TEXT,
            average REAL,
            rank_num INTEGER,
            notes TEXT,
            cycle_code TEXT,
            school_year TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_code, school_year)
        );
    `);
}

function insertOrientation(db, code, originStream, year) {
    db.prepare(
        `INSERT INTO student_orientation(student_code, full_name, origin_stream, cycle_code, school_year)
         VALUES(?, ?, ?, ?, ?)`
    ).run(code, `تلميذ ${code}`, originStream, QUALIFIANT, year);
}

function orientationCount(db, year) {
    return db.prepare('SELECT COUNT(*) AS c FROM student_orientation WHERE school_year = ?').get(year).c;
}

function createCapturingPort(log) {
    return {
        captureInputUpserts() {
            return 0;
        },
        captureResolvedRows() {
            return 0;
        },
        capturePutsByIds() {
            return 0;
        },
        captureDeletesFromRows(db, tableName, rows) {
            if (!rows || !rows.length) return 0;
            log.push({ tableName, operation: 'DEL', rows: rows.map((row) => ({ ...row })) });
            return rows.length;
        },
        selectRowsBySchoolYear(db, tableName, schoolYear) {
            return db.prepare(`SELECT * FROM "${tableName}" WHERE school_year = ?`).all(schoolYear);
        },
        deleteBySchoolYearWithCapture(db, tableName, schoolYear) {
            return db.prepare(`DELETE FROM "${tableName}" WHERE school_year = ?`).run(schoolYear).changes;
        },
        notifyCaptureCommitted() {}
    };
}

function createFailingCapturePort() {
    const port = createNoOpCapturePort();
    port.captureDeletesFromRows = () => {
        throw new Error('[sync:capture] outbox write failed');
    };
    return port;
}

(async () => {
    const db = openDb();
    createProductionSchema(db);
    const captureLog = [];
    setRepoCapturePort(createCapturingPort(captureLog));

    // ── (a) clearYear captures exact DEL tombstones inside the transaction ───────
    insertOrientation(db, 'S1', 'علوم', YEAR);
    insertOrientation(db, 'S2', 'آداب', YEAR);
    insertOrientation(db, 'S1', 'علوم', PREV_YEAR);

    const cleared = orientationRepo.clearYear(db, YEAR);
    assert.strictEqual(cleared.success, true);
    assert.strictEqual(cleared.deleted, 2, 'both YEAR rows are cleared');
    assert.strictEqual(orientationCount(db, YEAR), 0, 'YEAR rows deleted');
    assert.strictEqual(orientationCount(db, PREV_YEAR), 1, 'other-year rows survive');

    const delEntries = captureLog.filter(
        (entry) => entry.operation === 'DEL' && entry.tableName === 'student_orientation'
    );
    assert.strictEqual(delEntries.length, 1, 'one DEL capture call for the whole clear');
    assert.strictEqual(delEntries[0].rows.length, 2, 'both deleted rows are captured');
    assert.deepStrictEqual(
        delEntries[0].rows.map((row) => row.student_code).sort(),
        ['S1', 'S2'],
        'captured rows carry the full identity'
    );
    assert.ok(
        delEntries[0].rows.every((row) => row.school_year === YEAR && row.cycle_code === QUALIFIANT),
        'captured rows carry school_year and the cycle snapshot'
    );
    console.log('  [ok] clearYear deletes + captures DEL tombstones in one transaction');

    // ── (b) clearing an empty year is a no-op (no capture, no throw) ─────────────
    const logBefore = captureLog.length;
    const empty = orientationRepo.clearYear(db, '2030/2031');
    assert.strictEqual(empty.success, true);
    assert.strictEqual(empty.deleted, 0);
    assert.strictEqual(captureLog.length, logBefore, 'no capture rows for an empty clear');
    console.log('  [ok] clearing an empty year is a no-op');

    // ── (c) a capture failure rolls the clear back ───────────────────────────────
    setRepoCapturePort(createFailingCapturePort());
    insertOrientation(db, 'S3', 'علوم', YEAR);
    assert.throws(
        () => orientationRepo.clearYear(db, YEAR),
        /\[sync:capture\]/,
        'capture failure propagates out of the clear'
    );
    assert.strictEqual(orientationCount(db, YEAR), 1, 'the DELETE rolled back with the failed capture');
    setRepoCapturePort(createCapturingPort(captureLog));
    console.log('  [ok] capture failure rolls the whole clear back');

    // ── (d) deleteById: DEL tombstone inside the repo transaction ───────────────
    const logBeforeDelete = captureLog.length;
    const deletedOne = orientationRepo.deleteById(db, db.prepare('SELECT id FROM student_orientation WHERE student_code = ?').get('S3').id);
    assert.strictEqual(deletedOne.success, true);
    assert.strictEqual(orientationCount(db, YEAR), 0, 'the row is gone');
    const delByIdEntries = captureLog
        .slice(logBeforeDelete)
        .filter((entry) => entry.operation === 'DEL' && entry.tableName === 'student_orientation');
    assert.strictEqual(delByIdEntries.length, 1, 'exactly one DEL capture call');
    assert.strictEqual(delByIdEntries[0].rows.length, 1, 'one tombstone row');
    assert.strictEqual(delByIdEntries[0].rows[0].student_code, 'S3', 'tombstone carries the row identity');

    // ── (e) deleteById: a capture failure rolls the delete back ─────────────────
    insertOrientation(db, 'S4', 'علوم', YEAR);
    setRepoCapturePort(createFailingCapturePort());
    assert.throws(
        () => orientationRepo.deleteById(db, db.prepare('SELECT id FROM student_orientation WHERE student_code = ?').get('S4').id),
        /\[sync:capture\]/,
        'capture failure propagates out of the delete'
    );
    assert.strictEqual(orientationCount(db, YEAR), 1, 'the DELETE rolled back with the failed capture');
    setRepoCapturePort(createCapturingPort(captureLog));

    for (const badId of [0, -1, 'abc', null, undefined]) {
        assert.throws(
            () => orientationRepo.deleteById(db, badId),
            /معرّف غير صالح/,
            `invalid id ${String(badId)} is rejected`
        );
    }
    console.log('  [ok] deleteById captures inside its transaction and rolls back on capture failure');

    db.close();
    setRepoCapturePort(null);
    console.log('[test] orientation clear/capture contract OK');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

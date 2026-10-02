'use strict';

// node tests/orientation/ipc-bulk-safety.test.js

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const { setRepoCapturePort, createNoOpCapturePort } = require('../../main/repos/capture-port');
const orientationRepo = require('../../main/repos/orientation');
const {
    prepareBulkUpsertPayload,
    handleBulkUpsert,
    coerceSchoolYearStrict
} = require('../../main/ipc/orientation');

assert.strictEqual(coerceSchoolYearStrict('2025/2026'), '2025/2026');
assert.strictEqual(coerceSchoolYearStrict('2025-2026'), '2025/2026');
assert.strictEqual(coerceSchoolYearStrict('bad'), null);

const prep = prepareBulkUpsertPayload(
    {
        schoolYear: '2025/2026',
        rows: [
            { code: 'a1', origin_stream: 'SMC', moyenne: '12,5', affectation: 'SEF' },
            { massar_code: 'a1', origin_stream: 'SMC', choice1: 'Eco' },
            { student_code: 'b2', school_year: '2024/2025', origin_stream: 'SMC' },
            { full_name: 'NoCode', origin_stream: 'X' },
            { student_code: 'c3', choix1: 'Phys', currentLevel: 'TCSF' }
        ]
    },
    '2025/2026'
);
assert.strictEqual(prep.duplicatesInFile, 1);
assert.strictEqual(prep.preSkipped, 2);
assert.strictEqual(prep.rows.length, 2);
const a1 = prep.rows.find((r) => r.student_code === 'A1');
assert.ok(a1);
assert.strictEqual(a1.choice_1, 'Eco');
assert.strictEqual(a1.school_year, '2025/2026');
const c3 = prep.rows.find((r) => r.student_code === 'C3');
assert.ok(c3);
assert.strictEqual(c3.origin_stream, 'TCSF');
assert.strictEqual(c3.choice_1, 'Phys');

let Database;
try {
    Database = require('better-sqlite3');
    const probe = new Database(':memory:');
    probe.close();
} catch {
    console.log('orientation ipc-bulk-safety: OK (prepare only — no better-sqlite3)');
    process.exit(0);
}

setRepoCapturePort(createNoOpCapturePort());
const file = path.join(os.tmpdir(), `orient-tx-${Date.now()}.db`);
const db = new Database(file);
db.exec(`
CREATE TABLE student_orientation (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  student_code TEXT NOT NULL,
  full_name TEXT, gender TEXT, section TEXT, level TEXT,
  origin_stream TEXT, choice_1 TEXT, choice_2 TEXT, choice_3 TEXT,
  assigned_stream TEXT, decision_status TEXT, average REAL, rank_num REAL,
  notes TEXT, school_year TEXT NOT NULL,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT
);
CREATE TABLE students (
  id INTEGER PRIMARY KEY, code TEXT, full_name TEXT, gender TEXT, section TEXT, school_year TEXT
);
CREATE UNIQUE INDEX uq_orient ON student_orientation(student_code, school_year);
`);

try {
    let r = orientationRepo.bulkUpsert(
        db,
        {
            rows: [
                {
                    student_code: 'S1',
                    full_name: 'Ali',
                    origin_stream: 'SMC',
                    choice_1: 'Eco',
                    average: 12,
                    notes: 'keep-me'
                }
            ]
        },
        '2025/2026',
        (y) => y,
        { duplicatesInFile: 0 }
    );
    assert.strictEqual(r.inserted, 1);
    assert.strictEqual(r.duplicatesInFile, 0);

    r = orientationRepo.bulkUpsert(
        db,
        {
            rows: [
                {
                    student_code: 'S1',
                    origin_stream: 'SMC',
                    average: null,
                    choice_1: null,
                    notes: '',
                    assigned_stream: 'SEF'
                }
            ]
        },
        '2025/2026',
        (y) => y
    );
    assert.strictEqual(r.updated, 1);
    const row = db.prepare('SELECT * FROM student_orientation WHERE student_code=?').get('S1');
    assert.strictEqual(row.choice_1, 'Eco');
    assert.strictEqual(row.notes, 'keep-me');
    assert.strictEqual(row.average, 12);
    assert.strictEqual(row.assigned_stream, 'SEF');
    assert.strictEqual(row.school_year, '2025/2026');

    r = orientationRepo.bulkUpsert(
        db,
        { rows: [{ student_code: 'S1', origin_stream: 'SMC' }] },
        '2025/2026',
        (y) => y
    );
    assert.strictEqual(r.unchanged, 1);

    r = orientationRepo.bulkUpsert(
        db,
        { rows: [{ student_code: 'S1', origin_stream: 'SMC', average: 0, rank_num: 0 }] },
        '2025/2026',
        (y) => y
    );
    assert.strictEqual(r.updated, 1);
    const row2 = db.prepare('SELECT average, rank_num FROM student_orientation WHERE student_code=?').get('S1');
    assert.strictEqual(row2.average, 0);
    assert.strictEqual(row2.rank_num, 0);

    // Transaction rollback on capture failure — no partial insert
    setRepoCapturePort({
        captureInputUpserts() {
            throw new Error('[sync:capture] boom');
        },
        notifyCaptureCommitted() {}
    });
    const before = db.prepare('SELECT COUNT(*) AS c FROM student_orientation').get().c;
    assert.throws(() => {
        orientationRepo.bulkUpsert(
            db,
            { rows: [{ student_code: 'NEW1', origin_stream: 'X', full_name: 'N' }] },
            '2025/2026',
            (y) => y
        );
    });
    const after = db.prepare('SELECT COUNT(*) AS c FROM student_orientation').get().c;
    assert.strictEqual(before, after);
    assert.strictEqual(
        db.prepare('SELECT 1 AS x FROM student_orientation WHERE student_code=?').get('NEW1'),
        undefined
    );

    setRepoCapturePort(createNoOpCapturePort());
    const res = handleBulkUpsert(db, {
        schoolYear: '2025/2026',
        rows: [
            { code: 'H1', filiere: 'SMC', choix1: 'A', moyenne: '10' },
            { code: 'H1', filiere: 'SMC', choix1: 'B' },
            { student_code: 'H2', schoolYear: '2020/2021', origin_stream: 'Y' }
        ]
    });
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.duplicatesInFile, 1);
    assert.ok(res.skipped >= 1);
    assert.ok(res.inserted >= 1);
    assert.strictEqual(res.schoolYear, '2025/2026');
    assert.ok(Array.isArray(res.details));

    // Invalid school year at IPC
    const badYear = handleBulkUpsert(db, { schoolYear: 'nope', rows: [{ code: 'Z', origin_stream: 'A' }] });
    assert.strictEqual(badYear.success, false);
    assert.strictEqual(badYear.code, 'INVALID_SCHOOL_YEAR');
} finally {
    db.close();
    try {
        fs.unlinkSync(file);
    } catch {
        /* ignore */
    }
    setRepoCapturePort(null);
}

console.log('orientation ipc-bulk-safety: OK');

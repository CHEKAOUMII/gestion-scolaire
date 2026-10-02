'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const orientationRepo = require('../main/repos/orientation');

function openDb() {
    let Database;
    try {
        Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
    } catch {
        return null;
    }
    const file = path.join(os.tmpdir(), `orient-repo-${Date.now()}.db`);
    const db = new Database(file);
    db.exec(`
        CREATE TABLE student_orientation (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_code TEXT NOT NULL,
            full_name TEXT,
            gender TEXT,
            section TEXT,
            level TEXT,
            origin_stream TEXT,
            choice_1 TEXT,
            choice_2 TEXT,
            choice_3 TEXT,
            assigned_stream TEXT,
            decision_status TEXT,
            average REAL,
            rank_num REAL,
            notes TEXT,
            school_year TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP,
            updated_at TEXT
        );
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT,
            full_name TEXT,
            gender TEXT,
            section TEXT,
            school_year TEXT
        );
        CREATE UNIQUE INDEX uq_orient ON student_orientation(student_code, school_year);
    `);
    db.__file = file;
    return db;
}

function run() {
    // Pure helpers
    assert.strictEqual(orientationRepo.normalizeCode(' ab '), 'AB');
    assert.strictEqual(orientationRepo.toNumberOrNull('12,5'), 12.5);
    const mapped = orientationRepo.mapRow({ code: 'x1', full_name: 'Ali', origin_stream: 'SMC' });
    assert.strictEqual(mapped.student_code, 'X1');
    assert.strictEqual(mapped.origin_stream, 'SMC');

    setRepoCapturePort(createNoOpCapturePort());
    const db = openDb();
    if (!db) {
        console.log('repos-orientation.test.js: OK (pure helpers only)');
        setRepoCapturePort(null);
        return;
    }
    try {
        const year = '2025/2026';
        const result = orientationRepo.bulkUpsert(
            db,
            {
                school_year: year,
                rows: [{ student_code: 'S1', full_name: 'Test', origin_stream: 'SMC' }]
            },
            year,
            (y) => y
        );
        assert.strictEqual(result.success, true);
        assert.strictEqual(result.inserted, 1);

        const listed = orientationRepo.list(db, year, {});
        assert.strictEqual(listed.rows.length, 1);

        const cleared = orientationRepo.clearYear(db, year);
        assert.strictEqual(cleared.deleted, 1);
    } finally {
        db.close();
        try {
            fs.unlinkSync(db.__file);
        } catch {
            /* ignore */
        }
        setRepoCapturePort(null);
    }
    console.log('repos-orientation.test.js: OK');
}

run();

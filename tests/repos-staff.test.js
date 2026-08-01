'use strict';

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const staffRepo = require('../main/repos/staff');

function openDb() {
    let Database;
    try {
        Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
    } catch (err) {
        console.log('repos-staff.test.js: SKIP (better-sqlite3 unavailable:', err.code || err.message, ')');
        return null;
    }
    const file = path.join(os.tmpdir(), `staff-repo-${Date.now()}.db`);
    const db = new Database(file);
    db.exec(`
        CREATE TABLE teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ppr TEXT,
            cin TEXT,
            full_name TEXT NOT NULL,
            full_name_fr TEXT,
            subject TEXT,
            gender TEXT,
            birth_date TEXT,
            birth_place TEXT,
            phone TEXT,
            email TEXT,
            address TEXT,
            grade TEXT,
            cadre TEXT,
            echelon INTEGER,
            hire_date TEXT,
            marital_status TEXT,
            function_title TEXT,
            is_surplus INTEGER DEFAULT 0,
            source TEXT,
            school_year TEXT NOT NULL,
            active INTEGER DEFAULT 1
        );
        CREATE TABLE teacher_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER,
            alias_name TEXT,
            alias_normalized TEXT,
            school_year TEXT,
            source TEXT
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_teacher_ppr_year ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '';
    `);
    db.__file = file;
    return db;
}

function run() {
    setRepoCapturePort(createNoOpCapturePort());
    const emptyImport = staffRepo.importBulk({}, []);
    assert.strictEqual(emptyImport.success, false);

    const db = openDb();
    if (!db) {
        console.log('repos-staff.test.js: OK (validation only)');
        setRepoCapturePort(null);
        return;
    }
    try {
        const year = '2025/2026';
        const added = staffRepo.addTeacher(db, { full_name: 'أستاذ تجريبي', school_year: year });
        assert.strictEqual(added.success, true);
        const list = staffRepo.listByYear(db, year);
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].full_name, 'أستاذ تجريبي');

        const bad = staffRepo.deleteTeacher(db, -5);
        assert.strictEqual(bad.success, false);
    } finally {
        db.close();
        try {
            fs.unlinkSync(db.__file);
        } catch {
            /* ignore */
        }
        setRepoCapturePort(null);
    }
    console.log('repos-staff.test.js: OK');
}

run();

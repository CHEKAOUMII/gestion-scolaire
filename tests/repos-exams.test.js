'use strict';

/**
 * Exams repo unit tests — plain Node with better-sqlite3 if available, else skip heavy SQL.
 */

const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const examsRepo = require('../main/repos/exams');

function openDb() {
    let Database;
    try {
        Database = require('better-sqlite3');
        // Probe native load (Electron ABI may differ from system Node)
        const probe = new Database(':memory:');
        probe.close();
    } catch (err) {
        console.log('repos-exams.test.js: SKIP (better-sqlite3 unavailable:', err.code || err.message, ')');
        return null;
    }
    const file = path.join(os.tmpdir(), `exams-repo-${Date.now()}.db`);
    const db = new Database(file);
    db.exec(`
        CREATE TABLE exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            section TEXT,
            subject TEXT,
            exam_date TEXT,
            exam_time TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            created_at TEXT DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE exam_proctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER,
            teacher_id INTEGER,
            teacher_name TEXT,
            room TEXT,
            date TEXT,
            session TEXT,
            school_year TEXT
        );
        CREATE TABLE exam_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_name TEXT,
            capacity INTEGER,
            equipment TEXT,
            school_year TEXT
        );
    `);
    db.__file = file;
    return db;
}

function run() {
    setRepoCapturePort(createNoOpCapturePort());
    const db = openDb();
    if (!db) {
        // Still assert pure validation paths that don't need full tables
        const fail = examsRepo.deleteExam({ prepare() { throw new Error('no'); } }, -1, 'secondary_qualifiant');
        assert.strictEqual(fail.success, false);
        console.log('repos-exams.test.js: OK (validation only)');
        setRepoCapturePort(null);
        return;
    }

    try {
        const year = '2025/2026';
        const cycle = 'secondary_qualifiant';
        const saved = examsRepo.saveExam(db, { title: 'Test Exam', school_year: year }, cycle);
        assert.strictEqual(saved.success, true);
        const list = examsRepo.listExams(db, year, cycle);
        assert.strictEqual(list.length, 1);
        assert.strictEqual(list[0].title, 'Test Exam');

        const emptyBulk = examsRepo.bulkImportProctors(db, { rows: [] }, year);
        assert.strictEqual(emptyBulk.success, false);

        const room = examsRepo.saveRoom(db, { room_name: 'A1', capacity: 30 }, year);
        assert.strictEqual(room.success, true);
        assert.strictEqual(examsRepo.listRooms(db, year).length, 1);
    } finally {
        db.close();
        try {
            fs.unlinkSync(db.__file);
        } catch {
            /* ignore */
        }
        setRepoCapturePort(null);
    }
    console.log('repos-exams.test.js: OK');
}

run();

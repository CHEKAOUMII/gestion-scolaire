'use strict';

const assert = require('assert');
const examsRepo = require('../main/repos/exams');
const profileRepo = require('../main/repos/student-profile');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');

const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';
const YEAR = '2025/2026';

function openDb() {
    try {
        const Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
        return new Database(':memory:');
    } catch {
        const { DatabaseSync } = require('node:sqlite');
        const db = new DatabaseSync(':memory:');
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const result = fn(...args);
                db.exec('COMMIT');
                return result;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL UNIQUE,
            full_name TEXT NOT NULL,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            created_at TEXT
        );
        CREATE TABLE sections (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            section_code TEXT NOT NULL,
            raw_name TEXT NOT NULL,
            normalized_name TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            level_code TEXT,
            stream_code TEXT,
            school_year TEXT NOT NULL,
            is_active INTEGER NOT NULL DEFAULT 1,
            UNIQUE(section_code, cycle_code, school_year)
        );
        CREATE TABLE exams (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            section TEXT,
            subject TEXT,
            exam_date TEXT,
            exam_time TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            created_at TEXT
        );
        CREATE TABLE exam_proctors (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exam_id INTEGER NOT NULL,
            teacher_id INTEGER,
            teacher_name TEXT,
            room TEXT,
            date TEXT,
            session TEXT,
            school_year TEXT NOT NULL
        );
        CREATE TABLE exam_rooms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            room_name TEXT NOT NULL,
            capacity INTEGER DEFAULT 0,
            equipment TEXT,
            school_year TEXT NOT NULL,
            created_at TEXT
        );
        CREATE TABLE tests (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            section TEXT,
            subject TEXT,
            teacher_id INTEGER,
            teacher_name TEXT,
            status TEXT,
            test_date TEXT,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            created_at TEXT
        );
        CREATE TABLE teachers (id INTEGER PRIMARY KEY, full_name TEXT, subject TEXT, school_year TEXT, active INTEGER DEFAULT 1);
        CREATE TABLE teacher_aliases (
            teacher_id INTEGER, alias_name TEXT, alias_normalized TEXT, source TEXT, school_year TEXT,
            UNIQUE(teacher_id, school_year, alias_normalized)
        );
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER NOT NULL,
            student_code TEXT NOT NULL,
            tab_key TEXT NOT NULL,
            data_json TEXT NOT NULL,
            school_year TEXT NOT NULL,
            cycle_code TEXT NOT NULL,
            updated_at TEXT,
            updated_by TEXT,
            UNIQUE(student_code, tab_key, school_year)
        );
        CREATE TABLE student_risk_snapshot (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT NOT NULL,
            risk_score INTEGER,
            risk_level TEXT,
            school_year TEXT NOT NULL,
            updated_at TEXT,
            updated_by TEXT,
            UNIQUE(student_code, school_year)
        );
    `);
}

function run() {
    console.log('[test] S5/S7 cycle isolation');
    const db = openDb();
    createSchema(db);
    setRepoCapturePort(createNoOpCapturePort());
    try {
        db.prepare('INSERT INTO students(code, full_name, school_year, cycle_code) VALUES(?, ?, ?, ?)').run('Q1', 'تأهيلي', YEAR, QUALIFIANT);
        db.prepare('INSERT INTO students(code, full_name, school_year, cycle_code) VALUES(?, ?, ?, ?)').run('C1', 'إعدادي', YEAR, COLLEGIAL);
        const insertSection = db.prepare(
            `INSERT INTO sections(section_code, raw_name, normalized_name, cycle_code, school_year)
             VALUES(?, ?, ?, ?, ?)`
        );
        insertSection.run('1A', '1A', '1A', QUALIFIANT, YEAR);
        insertSection.run('1A', '1A', '1A', COLLEGIAL, YEAR);

        assert.throws(() => examsRepo.listExams(db, YEAR), /السلك التعليمي غير محدد/);
        assert.throws(() => profileRepo.listProfileTabs(db, 'Q1', YEAR), /السلك التعليمي غير محدد/);

        const qualifiantExam = examsRepo.saveExam(
            db,
            { title: 'Q exam', school_year: YEAR, section: '1A', exam_date: '2025-11-01', exam_time: '09:00' },
            QUALIFIANT
        );
        const collegialExam = examsRepo.saveExam(
            db,
            { title: 'C exam', school_year: YEAR, exam_date: '2025-11-01', exam_time: '09:00' },
            COLLEGIAL
        );
        const qExamId = db.prepare('SELECT id FROM exams WHERE title = ?').get('Q exam').id;
        const cExamId = db.prepare('SELECT id FROM exams WHERE title = ?').get('C exam').id;
        assert.strictEqual(qualifiantExam.success, true);
        assert.strictEqual(collegialExam.success, true);
        assert.deepStrictEqual(examsRepo.listExams(db, YEAR, QUALIFIANT).map((row) => row.title), ['Q exam']);
        assert.deepStrictEqual(examsRepo.listExams(db, YEAR, COLLEGIAL).map((row) => row.title), ['C exam']);
        assert.strictEqual(examsRepo.deleteExam(db, cExamId, QUALIFIANT).success, false);
        assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM exams WHERE id = ?').get(cExamId).count, 1);

        examsRepo.saveProctorManual(db, { exam_id: qExamId, teacher_name: 'مراقب', room: 'R1' }, YEAR, QUALIFIANT);
        assert.strictEqual(examsRepo.listProctors(db, YEAR, QUALIFIANT).length, 1);
        assert.strictEqual(examsRepo.listProctors(db, YEAR, COLLEGIAL).length, 0);
        assert.throws(
            () => examsRepo.saveProctorManual(db, { exam_id: qExamId, teacher_name: 'مراقب' }, YEAR, COLLEGIAL),
            /لا ينتمي|غير موجود/
        );
        assert.throws(
            () => examsRepo.saveProctorManual(db, { exam_id: cExamId, teacher_name: 'مراقب', room: 'R1' }, YEAR, COLLEGIAL),
            /محجوزة/
        );

        examsRepo.saveTest(db, { title: 'Q test', school_year: YEAR }, YEAR, QUALIFIANT);
        examsRepo.saveTest(db, { title: 'C test', school_year: YEAR }, YEAR, COLLEGIAL);
        assert.deepStrictEqual(examsRepo.listTests(db, YEAR, QUALIFIANT).map((row) => row.title), ['Q test']);
        assert.deepStrictEqual(examsRepo.listTests(db, YEAR, COLLEGIAL).map((row) => row.title), ['C test']);

        profileRepo.saveProfileTab(
            db,
            { student_code: 'Q1', tab_key: 'social', school_year: YEAR, student_id: 999 },
            '{"guardian":"valid"}',
            QUALIFIANT
        );
        assert.strictEqual(profileRepo.listProfileTabs(db, 'Q1', YEAR, QUALIFIANT).length, 1);
        assert.throws(
            () => profileRepo.listProfileTabs(db, 'C1', YEAR, QUALIFIANT),
            /لا ينتمي/
        );
        assert.throws(
            () => profileRepo.saveProfileTab(db, { student_code: 'C1', tab_key: 'social', school_year: YEAR }, '{}', QUALIFIANT),
            /لا ينتمي/
        );
        profileRepo.saveRiskSnapshot(db, { student_code: 'Q1', school_year: YEAR, student_id: 999, risk_score: 4 }, QUALIFIANT);
        assert.strictEqual(db.prepare('SELECT student_id FROM student_risk_snapshot WHERE student_code = ?').get('Q1').student_id, 1);

        const room = examsRepo.saveRoom(db, { room_name: 'قاعة مشتركة', capacity: 30 }, YEAR);
        assert.strictEqual(room.success, true);
        assert.strictEqual(examsRepo.listRooms(db, YEAR).length, 1);
        console.log('[test] S5/S7 cycle isolation: all checks passed');
    } finally {
        setRepoCapturePort(null);
        if (typeof db.close === 'function') db.close();
    }
}

run();

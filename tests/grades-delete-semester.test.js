'use strict';

/**
 * Grades deleteBySemester contract — import-pipeline review F27.
 *
 * - Only semester 1 or 2 is accepted; any falsy/unparseable semester throws a
 *   clear Arabic error instead of silently deleting semester 1 (`parseInt || 1`).
 * - A valid semester deletes only that semester's rows and captures exact DEL
 *   tombstones inside the same transaction.
 */

const assert = require('assert');

const { setRepoCapturePort } = require('../main/repos/capture-port');
const gradesRepo = require('../main/repos/grades');

const QUALIFIANT = 'secondary_qualifiant';
const YEAR = '2025/2026';

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

function createGradesSchema(db) {
    db.exec(`
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT,
            subject TEXT,
            semester INTEGER,
            grade REAL,
            school_year TEXT,
            cycle_code TEXT NOT NULL
        );
    `);
}

function insertGrade(db, studentCode, subject, semester, grade, year) {
    db.prepare(
        `INSERT INTO grades(student_code, subject, semester, grade, school_year, cycle_code)
         VALUES(?, ?, ?, ?, ?, ?)`
    ).run(studentCode, subject, semester, grade, year, QUALIFIANT);
}

function gradeCount(db, year) {
    return db.prepare('SELECT COUNT(*) AS c FROM grades WHERE school_year = ?').get(year).c;
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

(async () => {
    const db = openDb();
    createGradesSchema(db);
    const captureLog = [];
    setRepoCapturePort(createCapturingPort(captureLog));

    insertGrade(db, 'S1', 'رياضيات', 1, 14, YEAR);
    insertGrade(db, 'S1', 'علوم', 1, 12, YEAR);
    insertGrade(db, 'S1', 'رياضيات', 2, 15, YEAR);
    insertGrade(db, 'S2', 'علوم', 2, 13, YEAR);

    // ── (a) falsy/unparseable semesters are rejected fail-closed ────────────────
    for (const badSemester of [0, '', null, undefined, 'x', 1.5, 3, -1]) {
        assert.throws(
            () => gradesRepo.deleteBySemester(db, YEAR, badSemester, QUALIFIANT),
            /الفصل الدراسي يجب أن يكون 1 أو 2/,
            `semester ${String(badSemester)} must be rejected, not mapped to semester 1`
        );
    }
    assert.strictEqual(gradeCount(db, YEAR), 4, 'no rows deleted by any rejected semester');
    assert.strictEqual(captureLog.length, 0, 'no DEL tombstones for rejected semesters');
    console.log('  [ok] falsy/unparseable semesters throw instead of deleting semester 1');

    // ── (b) a valid semester deletes only its own rows, with DEL capture ─────────
    const deleted1 = gradesRepo.deleteBySemester(db, YEAR, '1', QUALIFIANT);
    assert.strictEqual(deleted1, 2, 'both semester-1 rows are deleted (string semester accepted)');
    assert.strictEqual(gradeCount(db, YEAR), 2, 'semester-2 rows survive');
    assert.strictEqual(captureLog.length, 1, 'one DEL capture call');
    assert.deepStrictEqual(
        captureLog[0].rows.map((row) => row.subject).sort(),
        ['رياضيات', 'علوم'],
        'exactly the deleted semester-1 rows are captured'
    );

    const deleted2 = gradesRepo.deleteBySemester(db, YEAR, 2, QUALIFIANT);
    assert.strictEqual(deleted2, 2, 'both semester-2 rows are deleted');
    assert.strictEqual(gradeCount(db, YEAR), 0, 'no rows remain');
    assert.strictEqual(captureLog.length, 2, 'a second DEL capture call for the semester-2 rows');
    assert.ok(captureLog[1].rows.every((row) => Number(row.semester) === 2), 'only semester-2 rows captured');
    console.log('  [ok] valid semesters delete only their own rows with exact DEL tombstones');

    // ── (c) rows of another year are never touched ───────────────────────────────
    insertGrade(db, 'S9', 'رياضيات', 1, 10, '2024/2025');
    const otherYear = gradesRepo.deleteBySemester(db, '2024/2025', 1, QUALIFIANT);
    assert.strictEqual(otherYear, 1, 'the other-year row is the only match for that year');
    assert.strictEqual(captureLog.length, 3, 'its DEL tombstone is captured');
    console.log('  [ok] semester deletes stay scoped to the requested year');

    db.close();
    setRepoCapturePort(null);
    console.log('[test] grades deleteBySemester contract OK');
    process.exit(0);
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

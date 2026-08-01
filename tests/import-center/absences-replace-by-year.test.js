'use strict';

// node tests/import-center/absences-replace-by-year.test.js
// Package 5.2 — narrowly scoped atomic absences replaceByYear

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const absencesRepo = require('../../main/repos/absences.js');
const capture = require('../../main/sync/capture.js');
const { CHANNEL_REGISTRY } = capture;

// --- Registry / preload / handler surface ---
assert.ok(CHANNEL_REGISTRY['absences:replaceByYear'], 'capture registry entry required');
assert.strictEqual(CHANNEL_REGISTRY['absences:replaceByYear'].captureMode, 'explicit');
assert.strictEqual(CHANNEL_REGISTRY['absences:replaceByYear'].exclude, true);

const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
assert.ok(preload.includes('absences:replaceByYear'), 'preload must expose replaceByYear');

const ipcSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'ipc', 'absences.js'), 'utf8');
assert.ok(ipcSrc.includes("'absences:replaceByYear'"), 'IPC handler registered');

const pageSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'js', 'pages', 'settings-imports.js'), 'utf8');
assert.ok(pageSrc.includes('replaceByYear'), 'import path prefers replaceByYear');

const matrix = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'import-center', 'atomicity-matrix.md'),
    'utf8'
);
assert.ok(matrix.includes('replaceByYear') || matrix.includes('absences:replaceByYear'));
assert.ok(matrix.includes('Not supported') || matrix.includes('لا') || matrix.includes('cross-type'));
assert.ok(!/claims broad rollback|full batch rollback guaranteed/i.test(matrix));

// --- In-memory SQLite behavior if better-sqlite3 native ABI matches ---
let ranSqlite = false;
try {
    const Database = require('better-sqlite3');
    const db = new Database(':memory:');
    db.pragma('foreign_keys = ON');
    db.exec(`
        CREATE TABLE IF NOT EXISTS absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            student_id INTEGER,
            student_code TEXT NOT NULL,
            absence_date TEXT,
            month TEXT NOT NULL,
            absence_type TEXT NOT NULL,
            hours REAL,
            days REAL,
            reason TEXT,
            school_year TEXT NOT NULL,
            UNIQUE(student_code, month, school_year, absence_type)
        );
    `);

    const year = '2026-2027';
    const row = (code, month, type, hours) => ({
        student_id: null,
        student_code: code,
        absence_date: '2026-01-01',
        month,
        absence_type: type,
        hours,
        days: 0,
        reason: '',
        school_year: year
    });

    absencesRepo.saveBulk(db, [row('S1', '1', 'unjustified', 2), row('S2', '1', 'unjustified', 3)], {
        validate() {}
    });
    let all = absencesRepo.listByYear(db, year);
    assert.ok(all.length >= 2);

    const res = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '1', 'unjustified', 5), row('S3', '2', 'justified', 1)],
        { validate() {} }
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 2);

    all = absencesRepo.listByYear(db, year);
    assert.strictEqual(all.length, 2);
    assert.ok(all.some((r) => r.student_code === 'S1' && Number(r.hours) === 5));
    assert.ok(all.some((r) => r.student_code === 'S3'));
    assert.ok(!all.some((r) => r.student_code === 'S2'), 'old S2 must be gone after replace');

    let threw = false;
    try {
        absencesRepo.replaceByYear(db, year, [row('S9', '1', 'unjustified', 1)], {
            validate() {
                throw new Error('bad_row');
            }
        });
    } catch (e) {
        threw = /bad_row/.test(e.message);
    }
    assert.ok(threw, 'validation error should throw and roll back transaction');
    all = absencesRepo.listByYear(db, year);
    assert.strictEqual(all.length, 2, 'prior successful replace must remain after failed replace');

    db.close();
    ranSqlite = true;
} catch (e) {
    // Electron-native better-sqlite3 often mismatches host Node ABI — surface tests still count.
    if (!/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|Could not locate the bindings/i.test(String(e && e.message))) {
        throw e;
    }
}

console.log(
    ranSqlite
        ? 'absences-replace-by-year: OK (with sqlite)'
        : 'absences-replace-by-year: OK (surface checks; sqlite native ABI skipped)'
);

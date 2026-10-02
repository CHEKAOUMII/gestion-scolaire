'use strict';

// node tests/import-center/absences-replace-by-year.test.js
// Package 5.2 — narrowly scoped atomic absences replaceByYear

const assert = require('assert');
const fs = require('fs');
const path = require('path');

const absencesRepo = require('../../main/repos/absences.js');
const capture = require('../../main/sync/capture.js');
const { importSourceIncludes } = require('../helpers/import-source.js');
const { CHANNEL_REGISTRY } = capture;
const { setRepoCapturePort, createNoOpCapturePort } = require('../../main/repos/capture-port');
setRepoCapturePort(createNoOpCapturePort());

// --- Registry / preload / handler surface ---
assert.ok(CHANNEL_REGISTRY['absences:replaceByYear'], 'capture registry entry required');
assert.strictEqual(CHANNEL_REGISTRY['absences:replaceByYear'].captureMode, 'explicit');
assert.strictEqual(CHANNEL_REGISTRY['absences:replaceByYear'].exclude, true);

const preload = fs.readFileSync(path.join(__dirname, '..', '..', 'preload.js'), 'utf8');
assert.ok(preload.includes('absences:replaceByYear'), 'preload must expose replaceByYear');

const ipcSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'ipc', 'absences.js'), 'utf8');
assert.ok(ipcSrc.includes("'absences:replaceByYear'"), 'IPC handler registered');

assert.ok(importSourceIncludes('replaceByYear'), 'import path prefers replaceByYear');

// --- F8 / F7 surface: coverage guard, confirm flow, per-row validation ---
assert.ok(ipcSrc.includes('validateAbsenceRow'), 'IPC must validate each absence row (F7)');
assert.ok(ipcSrc.includes('options && options.confirm === true'), 'IPC must accept an explicit confirm flag (F8)');
const repoSrc = fs.readFileSync(path.join(__dirname, '..', '..', 'main', 'repos', 'absences.js'), 'utf8');
assert.ok(repoSrc.includes('INCOMPLETE_COVERAGE'), 'repo must report incomplete coverage (F8)');
assert.ok(repoSrc.includes('missingMonths'), 'repo must list the missing months (F8)');
assert.ok(repoSrc.includes('confirm !== true'), 'coverage guard must be bypassed only by confirm');
assert.ok(repoSrc.includes('missingKeys'), 'repo must sample the uncovered row keys (T1.3)');
assert.ok(importSourceIncludes('INCOMPLETE_COVERAGE'), 'import page must handle the coverage response');
assert.ok(importSourceIncludes('showConfirm('), 'import page must ask before a destructive replace');
// The guard compares row keys, not months: a section-by-section file covers all
// months and still reports INCOMPLETE_COVERAGE with an EMPTY missingMonths list.
// Gating the override dialog on missingMonths would leave the operator refused
// with no way to confirm — the exact dead end T1.3 must not create.
assert.ok(
    !importSourceIncludes("absenceRes.code === 'INCOMPLETE_COVERAGE' && Array.isArray(absenceRes.missingMonths) && absenceRes.missingMonths.length"),
    'the override dialog must not be gated on a non-empty missingMonths list'
);
assert.ok(
    importSourceIncludes("if (absenceRes?.code === 'INCOMPLETE_COVERAGE')"),
    'the override dialog must trigger on the code alone'
);
assert.ok(importSourceIncludes('absenceRes.missingKeys'), 'the dialog detail must fall back to the uncovered row keys');
assert.ok(
    preload.includes('ipcRenderer.invoke(\'absences:replaceByYear\', schoolYear, absences, options)'),
    'preload must bridge the confirm options payload'
);

const matrix = fs.readFileSync(
    path.join(__dirname, '..', '..', 'docs', 'import-center', 'atomicity-matrix.md'),
    'utf8'
);
assert.ok(matrix.includes('replaceByYear') || matrix.includes('absences:replaceByYear'));
assert.ok(matrix.includes('Not supported') || matrix.includes('لا') || matrix.includes('cross-type'));
assert.ok(!/claims broad rollback|full batch rollback guaranteed/i.test(matrix));

// --- In-memory SQLite behavior (better-sqlite3, with node:sqlite fallback) ---
let ranSqlite = false;
try {
    let Database;
    let useNative = true;
    try {
        Database = require('better-sqlite3');
        const probe = new Database(':memory:');
        probe.close();
    } catch {
        Database = require('node:sqlite').DatabaseSync;
        useNative = false;
    }
    const db = new Database(':memory:');
    if (!useNative) {
        db.transaction = (fn) => (...args) => {
            db.exec('BEGIN');
            try {
                const value = fn(...args);
                db.exec('COMMIT');
                return value;
            } catch (e) {
                db.exec('ROLLBACK');
                throw e;
            }
        };
    } else {
        db.pragma('foreign_keys = ON');
    }
    db.exec(`
        CREATE TABLE IF NOT EXISTS students (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            code TEXT NOT NULL,
            full_name TEXT,
            family_name TEXT,
            section TEXT,
            cycle_code TEXT NOT NULL,
            school_year TEXT NOT NULL
        );
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
            cycle_code TEXT,
            UNIQUE(student_code, month, school_year, absence_type)
        );
    `);

    const year = '2026-2027';
    const CYCLE = 'secondary_qualifiant';
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('S1', CYCLE, year);
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('S2', CYCLE, year);
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('S3', CYCLE, year);
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('S4', CYCLE, year);
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('OLD-YEAR', CYCLE, '2025-2026');
    db.prepare('INSERT INTO students (code, cycle_code, school_year) VALUES (?, ?, ?)').run('FOREIGN', 'secondary_collegial', year);

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

    absencesRepo.saveBulk(db, [row('S1', '1', 'unjustified', 2), row('S2', '1', 'unjustified', 3)], CYCLE, {
        validate() {}
    });
    let all = absencesRepo.listByYear(db, year, CYCLE);
    assert.ok(all.length >= 2);

    const res = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '1', 'unjustified', 5), row('S3', '2', 'justified', 1)],
        CYCLE,
        { validate() {}, confirm: true }
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(res.count, 2);

    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 2);
    assert.ok(all.some((r) => r.student_code === 'S1' && Number(r.hours) === 5));
    assert.ok(all.some((r) => r.student_code === 'S3'));
    assert.ok(!all.some((r) => r.student_code === 'S2'), 'old S2 must be gone after replace');

    let threw = false;
    try {
        absencesRepo.replaceByYear(db, year, [row('S9', '1', 'unjustified', 1)], CYCLE, {
            validate() {
                throw new Error('bad_row');
            }
        });
    } catch (e) {
        threw = /bad_row/.test(e.message);
    }
    assert.ok(threw, 'validation error should throw before any write');
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 2, 'prior successful replace must remain after failed replace');

    // ── F8: incomplete month coverage is refused without confirm ─────────────
    const blocked = absencesRepo.replaceByYear(db, year, [row('S1', '1', 'unjustified', 7)], CYCLE, {
        validate() {}
    });
    assert.strictEqual(blocked.success, false, 'partial-file replace must be refused without confirm');
    assert.strictEqual(blocked.code, 'INCOMPLETE_COVERAGE');
    assert.deepStrictEqual(blocked.missingMonths, ['2']);
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 2, 'nothing may be deleted while coverage is incomplete');
    assert.ok(all.some((r) => r.student_code === 'S1' && Number(r.hours) === 5), 'S1 row untouched');

    // ── F8: the same call with confirm:true proceeds and wipes the year ──────
    const confirmed = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '1', 'unjustified', 7), row('S3', '2', 'justified', 4)],
        CYCLE,
        { validate() {}, confirm: true }
    );
    assert.strictEqual(confirmed.success, true);
    assert.strictEqual(confirmed.count, 2);
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 2);
    assert.ok(all.some((r) => r.student_code === 'S1' && Number(r.hours) === 7));

    // ── F8: full month coverage proceeds without confirm ─────────────────────
    const full = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '1', 'unjustified', 8), row('S3', '2', 'justified', 2), row('S4', '3', 'unjustified', 1)],
        CYCLE,
        { validate() {} }
    );
    assert.strictEqual(full.success, true);
    assert.strictEqual(full.count, 3);
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 3);

    // ── T1.3: row-key coverage guard (same months, missing student/section) ──
    // Re-seed two sections X and Y across months 9 and 10 (four rows).
    absencesRepo.replaceByYear(db, year, [
        row('S1', '9', 'unjustified', 2),
        row('S1', '10', 'unjustified', 1),
        row('S2', '9', 'unjustified', 3),
        row('S2', '10', 'unjustified', 2)
    ], CYCLE, { validate() {}, confirm: true });

    // Case A: file covers ONLY section X, months 9 and 10 (months fully covered)
    // → must be refused: the guard keys on (student_code, month, absence_type).
    const rowKeyBlocked = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '9', 'unjustified', 5), row('S1', '10', 'unjustified', 4)],
        CYCLE,
        { validate() {} }
    );
    assert.strictEqual(rowKeyBlocked.success, false, 'case A: partial-student file must be refused');
    assert.strictEqual(rowKeyBlocked.code, 'INCOMPLETE_COVERAGE');
    assert.deepStrictEqual(rowKeyBlocked.missingMonths, [], 'months are covered; the guard must not rely on months alone');
    assert.ok(rowKeyBlocked.missingKeys.length >= 2, 'uncovered (student, month, type) keys must be reported');
    assert.ok(
        rowKeyBlocked.missingKeys.every((k) => String(k).startsWith('S2|')),
        'only the uncovered section Y rows are listed'
    );
    let afterBlock = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(afterBlock.length, 4, 'case A: nothing may be deleted while coverage is incomplete');
    assert.ok(afterBlock.some((r) => r.student_code === 'S2'), 'case A: section Y rows must still exist');

    // Case B: same seed, file covers X and Y, months 9 and 10 → clean replace.
    const rowKeyFull = absencesRepo.replaceByYear(
        db,
        year,
        [
            row('S1', '9', 'unjustified', 5),
            row('S1', '10', 'unjustified', 4),
            row('S2', '9', 'unjustified', 6),
            row('S2', '10', 'unjustified', 3)
        ],
        CYCLE,
        { validate() {} }
    );
    assert.strictEqual(rowKeyFull.success, true, 'case B: full row-key coverage must proceed');
    assert.strictEqual(rowKeyFull.count, 4);
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 4);

    // Case C: confirm:true with a partial file → explicit override is preserved.
    const rowKeyConfirmed = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '9', 'unjustified', 9)],
        CYCLE,
        { validate() {}, confirm: true }
    );
    assert.strictEqual(rowKeyConfirmed.success, true, 'case C: confirm bypasses the coverage guard');
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 1, 'case C: partial replace deletes the uncovered rows');

    // Case D: empty table + any file → first import is unaffected.
    absencesRepo.replaceByYear(db, year, [], CYCLE, { validate() {}, confirm: true });
    const firstImport = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '11', 'unjustified', 1), row('S2', '11', 'unjustified', 2)],
        CYCLE,
        { validate() {} }
    );
    assert.strictEqual(firstImport.success, true, 'case D: first import must succeed');
    assert.strictEqual(firstImport.code, undefined);
    all = absencesRepo.listByYear(db, year, CYCLE);
    assert.strictEqual(all.length, 2);

    // ── F8: canonical month comparison — '09' vs '9' vs '2025-09' ────────────
    absencesRepo.replaceByYear(db, year, [row('S1', '09', 'unjustified', 1)], CYCLE, { validate() {}, confirm: true });
    const canonical = absencesRepo.replaceByYear(
        db,
        year,
        [row('S1', '9', 'unjustified', 2), row('S2', '2025-09', 'justified', 3)],
        CYCLE,
        { validate() {} }
    );
    assert.strictEqual(canonical.success, true, "'09' and '9' and '2025-09' must count as the same month");

    // Replacement scope is fail-closed before the destructive DELETE.
    const beforeScopeGuard = absencesRepo.listByYear(db, year, CYCLE);
    const wrongYear = { ...row('OLD-YEAR', '1', 'unjustified', 1), school_year: '2025-2026' };
    assert.throws(
        () => absencesRepo.replaceByYear(db, year, [wrongYear], CYCLE, { validate() {}, confirm: true }),
        (error) => error.code === 'SCHOOL_YEAR_MISMATCH'
    );
    assert.deepStrictEqual(absencesRepo.listByYear(db, year, CYCLE), beforeScopeGuard, 'year mismatch must not delete current data');

    assert.throws(
        () => absencesRepo.replaceByYear(db, year, [row('FOREIGN', '1', 'unjustified', 1)], CYCLE, { validate() {}, confirm: true }),
        (error) => error.code === 'CYCLE_SCOPE_MISMATCH'
    );
    assert.deepStrictEqual(absencesRepo.listByYear(db, year, CYCLE), beforeScopeGuard, 'foreign-cycle rows must not delete current data');

    db.close();
    ranSqlite = true;
} catch (e) {
    // Electron-native better-sqlite3 often mismatches host Node ABI — surface tests still count.
    if (!/NODE_MODULE_VERSION|ERR_DLOPEN_FAILED|Could not locate the bindings/i.test(String(e && e.message))) {
        throw e;
    }
}

// --- F7: per-row validation unit checks (main-side, IPC layer) ---
{
    const { validateAbsenceRow } = require('../../main/ipc/absences.js');

    const year = '2026/2027';
    const valid = (overrides) => ({
        student_code: 'S1',
        month: '9',
        absence_date: '',
        absence_type: 'unjustified',
        hours: 2,
        days: 0,
        school_year: year,
        ...overrides
    });
    assert.doesNotThrow(() => validateAbsenceRow(valid()), 'month-only row must pass (matrix mode)');
    assert.doesNotThrow(() => validateAbsenceRow(valid({ absence_date: '2026-01-01' })), 'date + month must pass');
    assert.doesNotThrow(
        () => validateAbsenceRow(valid({ month: '2025-09', absence_date: '' })),
        'YYYY-MM month must pass'
    );
    assert.doesNotThrow(() => validateAbsenceRow(valid({ month: 'سنوي' })), 'annual month must pass');
    assert.doesNotThrow(
        () => validateAbsenceRow(valid({ absence_date: '2026-01-01', month: '' })),
        'date-only row must pass (simple mode)'
    );
    assert.doesNotThrow(() => validateAbsenceRow(valid({ hours: 24 })), 'hours at the 24h ceiling must pass');
    assert.doesNotThrow(() => validateAbsenceRow(valid({ days: 31 })), 'days at the 31d ceiling must pass');

    assert.throws(() => validateAbsenceRow(valid({ month: '13' })), /صيغة الشهر/);
    assert.throws(() => validateAbsenceRow(valid({ month: '2025/09' })), /صيغة الشهر/);
    assert.throws(() => validateAbsenceRow(valid({ absence_date: '', month: '' })), /الشهر/);
    assert.throws(() => validateAbsenceRow(valid({ hours: 25 })), /ساعات|hours/);
    assert.throws(() => validateAbsenceRow(valid({ hours: 'abc' })), /رقم/);
    assert.throws(() => validateAbsenceRow(valid({ days: 32 })), /أيام|days/);
    assert.throws(() => validateAbsenceRow(valid({ days: -1 })), /بين/);
    assert.throws(() => validateAbsenceRow(valid({ absence_date: '01-01-2026' })), /التاريخ/);
}

console.log(
    ranSqlite
        ? 'absences-replace-by-year: OK (with sqlite)'
        : 'absences-replace-by-year: OK (surface checks; sqlite native ABI skipped)'
);

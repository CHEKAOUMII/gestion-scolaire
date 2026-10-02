'use strict';

/**
 * Slice 6 transition-seam contract (isolation plan §Slice 6 + Validation Plan):
 * inter-year happy path (new row in toYear, source snapshot kept), intra-year
 * correction (child rows realigned, join intact), idempotent retry, single-cycle
 * actor refused, audit + outbox rows asserted.
 *
 * Runs with the REAL capture port (not the no-op stub): outbox assertions are
 * the point. Uses in-memory DBs only, so parallel suite runs cannot collide.
 */

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { ensureStageTransitionSchema } = require('../main/db/stage-transition-schema');
const stageTransitionRepo = require('../main/repos/stage-transition');
const studentsRepo = require('../main/repos/students');
const gradesRepo = require('../main/repos/grades');
const { setRepoCapturePort } = require('../main/repos/capture-port');
const context = require('../main/db/context');
const { registerStageTransitionIpc } = require('../main/ipc/stage-transition');
const { getActiveSessions } = require('../main/ipc/auth');
const { getEntity } = require('../main/sync/entity-registry');

const COLLEGIAL = 'secondary_collegial';
const QUALIFIANT = 'secondary_qualifiant';
const FROM_Y = '2024/2025';
const YEAR = '2025/2026';

const ADMIN = { userId: 1, role: 'admin', name: 'Admin', email: 'admin@school.local' };
const DUAL = { userId: 2, role: 'teacher', name: 'Dual Teacher', email: 'dual@school.local' };
const SINGLE = { userId: 3, role: 'teacher', name: 'Single Teacher', email: 'single@school.local' };

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
                const value = fn(...args);
                db.exec('COMMIT');
                return value;
            } catch (error) {
                db.exec('ROLLBACK');
                throw error;
            }
        };
        return db;
    }
}

function buildFixture({ skipTransitionTable = false } = {}) {
    const db = openDb();
    db.exec(`
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, full_name TEXT NOT NULL,
            family_name TEXT, birth_date TEXT, birth_place TEXT, gender TEXT, section TEXT,
            level TEXT, school_name TEXT, school_year TEXT, status TEXT DEFAULT 'active',
            registration_type TEXT DEFAULT 'new',
            cycle_code TEXT NOT NULL, UNIQUE(code, school_year)
        );
        CREATE UNIQUE INDEX uidx_students_id_cycle ON students(id, cycle_code);
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            teacher_id INTEGER, subject TEXT, grade REAL, semester INTEGER, teacher_name TEXT,
            level TEXT, section TEXT, school_year TEXT, cycle_code TEXT NOT NULL,
            teacher_resolution TEXT DEFAULT 'unresolved', source_file_name TEXT,
            UNIQUE(student_code, subject, semester, school_year)
        );
        CREATE TABLE absences (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            absence_date TEXT, month TEXT, absence_type TEXT, hours REAL, days REAL, reason TEXT,
            school_year TEXT, cycle_code TEXT NOT NULL,
            UNIQUE(student_code, month, school_year, absence_type)
        );
        CREATE TABLE correspondence (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            letter_type TEXT, letter_date TEXT, total_hours REAL, school_year TEXT,
            cycle_code TEXT NOT NULL, printed INTEGER DEFAULT 0,
            FOREIGN KEY(student_id) REFERENCES students(id),
            FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)
        );
        CREATE TABLE student_files (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL, doc_key TEXT NOT NULL,
            is_present INTEGER DEFAULT 0, school_year TEXT, cycle_code TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(student_id, doc_key, school_year),
            FOREIGN KEY(student_id) REFERENCES students(id),
            FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)
        );
        CREATE TABLE student_movements (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            movement_type TEXT, from_section TEXT, to_section TEXT, movement_date TEXT,
            notes TEXT, school_year TEXT, cycle_code TEXT NOT NULL,
            FOREIGN KEY(student_id) REFERENCES students(id),
            FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)
        );
        CREATE TABLE student_profile_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER NOT NULL,
            student_code TEXT NOT NULL, tab_key TEXT NOT NULL, data_json TEXT,
            school_year TEXT NOT NULL, cycle_code TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_by TEXT,
            UNIQUE(student_code, tab_key, school_year),
            FOREIGN KEY(student_id) REFERENCES students(id),
            FOREIGN KEY(student_id, cycle_code) REFERENCES students(id, cycle_code)
        );
        CREATE TABLE system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT, action TEXT NOT NULL, details TEXT,
            entity_type TEXT, entity_id TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE users (
            id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, email TEXT, role TEXT DEFAULT 'staff'
        );
        CREATE TABLE user_cycle_access (user_id INTEGER NOT NULL, cycle_code TEXT NOT NULL);
        CREATE TABLE sync_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT, table_name TEXT NOT NULL, row_sync_id TEXT NOT NULL,
            operation TEXT NOT NULL CHECK(operation IN ('PUT','DEL')), row_data TEXT, school_year TEXT,
            status TEXT NOT NULL DEFAULT 'pending', retries INTEGER DEFAULT 0,
            last_attempt_at DATETIME, sent_at DATETIME, last_error TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE sync_id_map (
            row_sync_id TEXT PRIMARY KEY, table_name TEXT NOT NULL, local_id INTEGER NOT NULL,
            UNIQUE(table_name, local_id)
        );
    `);
    if (!skipTransitionTable) ensureStageTransitionSchema(db);
    const insertUser = db.prepare('INSERT INTO users (name, email, role) VALUES (?, ?, ?)');
    insertUser.run('Admin', 'admin@school.local', 'admin');
    insertUser.run('Dual Teacher', 'dual@school.local', 'teacher');
    insertUser.run('Single Teacher', 'single@school.local', 'teacher');
    const grant = db.prepare('INSERT INTO user_cycle_access (user_id, cycle_code) VALUES (?, ?)');
    grant.run(2, COLLEGIAL);
    grant.run(2, QUALIFIANT);
    grant.run(3, COLLEGIAL);
    return db;
}

function student(code, name, year, section) {
    return {
        code,
        full_name: name,
        family_name: '',
        birth_date: '2010-01-01',
        birth_place: '',
        gender: 'M',
        section,
        level: String(section).split('-')[0],
        school_name: 'المؤسسة',
        school_year: year,
        status: 'active',
        registration_type: 'new'
    };
}

function expectCode(fn, code, label) {
    try {
        fn();
    } catch (err) {
        assert.strictEqual(
            err && err.code,
            code,
            `${label}: expected code ${code}, got ${err && err.code} (${err && err.message})`
        );
        return err;
    }
    assert.fail(`${label}: expected throw with code ${code}`);
}

console.log('[test] stage-transition contract (Slice 6)');
setRepoCapturePort(null); // real capture: outbox rows are asserted, not stubbed

// ── S1: DDL exact columns + idempotence + zero outbox rows ───────────────────
{
    const db = buildFixture({ skipTransitionTable: true });
    ensureStageTransitionSchema(db);
    ensureStageTransitionSchema(db);
    const cols = db.prepare('PRAGMA table_info(student_stage_transitions)').all();
    assert.deepStrictEqual(
        cols.map((c) => c.name),
        [
            'id', 'student_id', 'student_code', 'from_school_year', 'to_school_year',
            'from_cycle_code', 'to_cycle_code', 'transition_type',
            'idempotency_key', 'effective_date', 'reason', 'created_at'
        ]
    );
    const notNull = Object.fromEntries(cols.map((c) => [c.name, c.notnull]));
    for (const name of [
        'student_id', 'student_code', 'from_school_year', 'to_school_year',
        'from_cycle_code', 'to_cycle_code', 'transition_type', 'idempotency_key', 'effective_date'
    ]) {
        assert.strictEqual(notNull[name], 1, `${name} must be NOT NULL`);
    }
    const uniqueIndexes = db.prepare('PRAGMA index_list(student_stage_transitions)').all();
    const keyIsUnique = uniqueIndexes.some((idx) => {
        if (Number(idx.unique) !== 1) return false;
        const info = db.prepare(`PRAGMA index_info("${idx.name}")`).all();
        return info.some((entry) => cols[entry.cid] && cols[entry.cid].name === 'idempotency_key');
    });
    assert.ok(keyIsUnique, 'idempotency_key must be UNIQUE');
    assert.strictEqual(
        db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c,
        0,
        'DDL must write zero outbox rows'
    );
    assert.strictEqual(
        getEntity('student_stage_transitions'),
        null,
        'transition table is local audit, not a sync entity'
    );
    console.log('  [ok] S1 DDL exact columns + idempotent + zero outbox');
}

// ── S2: inter-year progression happy path ────────────────────────────────────
const interDb = buildFixture();
studentsRepo.insertOne(interDb, student('TR1', 'تلميذ منتقل', FROM_Y, '3APIC-1'), COLLEGIAL);
const interSrc = studentsRepo.getByCode(interDb, 'TR1', FROM_Y, COLLEGIAL);
interDb
    .prepare(
        'INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year, cycle_code) VALUES(?,?,?,?,?,?,?)'
    )
    .run(interSrc.id, 'TR1', 'الرياضيات', 14, 1, FROM_Y, COLLEGIAL);
interDb
    .prepare(
        'INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, school_year, cycle_code) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .run(interSrc.id, 'TR1', '2024-10-01', '2024-10', 'unjustified', 2, 0, FROM_Y, COLLEGIAL);
const interRes = stageTransitionRepo.transferStudent(
    interDb,
    {
        studentCode: 'TR1', fromYear: FROM_Y, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
        transitionType: 'inter_year_progression', idempotencyKey: 'key-inter-1',
        effectiveDate: '2025-09-15', reason: 'نجاح'
    },
    { actor: ADMIN }
);
assert.strictEqual(interRes.success, true);
assert.strictEqual(interRes.idempotentReplay, false);
{
    const created = studentsRepo.getByCode(interDb, 'TR1', YEAR, QUALIFIANT);
    assert.ok(created, 'new row must exist in toYear/toCycle');
    assert.strictEqual(created.full_name, 'تلميذ منتقل');
    assert.strictEqual(created.section, '3APIC-1');
    assert.strictEqual(created.status, 'active');
    assert.strictEqual(interRes.studentId, created.id);
    const stillSrc = studentsRepo.getByCode(interDb, 'TR1', FROM_Y, COLLEGIAL);
    assert.ok(stillSrc, 'source row must survive');
    assert.strictEqual(stillSrc.id, interSrc.id);
    assert.strictEqual(
        interDb.prepare('SELECT cycle_code AS c FROM grades WHERE student_code = ? AND school_year = ?').get('TR1', FROM_Y).c,
        COLLEGIAL,
        'source grades keep the source cycle snapshot'
    );
    assert.strictEqual(
        interDb.prepare('SELECT cycle_code AS c FROM absences WHERE student_code = ? AND school_year = ?').get('TR1', FROM_Y).c,
        COLLEGIAL,
        'source absences keep the source cycle snapshot'
    );
    const tr = interDb.prepare('SELECT * FROM student_stage_transitions WHERE idempotency_key = ?').get('key-inter-1');
    assert.strictEqual(tr.student_id, created.id);
    assert.strictEqual(tr.student_code, 'TR1');
    assert.strictEqual(tr.from_school_year, FROM_Y);
    assert.strictEqual(tr.to_school_year, YEAR);
    assert.strictEqual(tr.from_cycle_code, COLLEGIAL);
    assert.strictEqual(tr.to_cycle_code, QUALIFIANT);
    assert.strictEqual(tr.transition_type, 'inter_year_progression');
    assert.strictEqual(tr.effective_date, '2025-09-15');
    assert.strictEqual(tr.reason, 'نجاح');
    const mv = interDb.prepare('SELECT * FROM student_movements WHERE school_year = ? AND cycle_code = ?').get(YEAR, QUALIFIANT);
    assert.strictEqual(mv.student_id, created.id);
    assert.strictEqual(mv.movement_type, 'arrival');
    assert.strictEqual(mv.movement_date, '2025-09-15');
    const logs = interDb.prepare("SELECT * FROM system_logs WHERE action = 'STAGE_TRANSITION'").all();
    assert.strictEqual(logs.length, 1);
    assert.strictEqual(logs[0].entity_type, 'student_stage_transition');
    assert.strictEqual(logs[0].entity_id, String(tr.id));
    const details = JSON.parse(logs[0].details);
    assert.strictEqual(details.actor.userId, 1);
    assert.strictEqual(details.actor.role, 'admin');
    assert.strictEqual(details.transitionType, 'inter_year_progression');
    assert.strictEqual(details.idempotencyKey, 'key-inter-1');
    assert.strictEqual(details.reason, 'نجاح');
    const outbox = interDb
        .prepare('SELECT table_name, operation FROM sync_outbox ORDER BY id')
        .all()
        .map((row) => ({ table_name: row.table_name, operation: row.operation }));
    assert.deepStrictEqual(outbox, [
        { table_name: 'students', operation: 'PUT' },
        { table_name: 'student_movements', operation: 'PUT' }
    ]);
    assert.strictEqual(
        JSON.parse(interDb.prepare("SELECT row_data AS d FROM sync_outbox WHERE table_name = 'students'").get().d).code,
        'TR1'
    );
    console.log('  [ok] S2 inter-year progression: new row, snapshot kept, audit + outbox');
}

// ── S3: intra-year reclassification happy path ───────────────────────────────
const intraDb = buildFixture();
studentsRepo.insertOne(intraDb, student('RC1', 'تلميذ مصحح', YEAR, '2APIC-3'), COLLEGIAL);
studentsRepo.insertOne(intraDb, student('RC2', 'تلميذ شاهد', YEAR, '2APIC-3'), COLLEGIAL);
const rc1 = studentsRepo.getByCode(intraDb, 'RC1', YEAR, COLLEGIAL);
const rc2 = studentsRepo.getByCode(intraDb, 'RC2', YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year, cycle_code) VALUES(?,?,?,?,?,?,?)'
    )
    .run(rc1.id, 'RC1', 'الفرنسية', 12, 1, YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO grades(student_id, student_code, subject, grade, semester, school_year, cycle_code) VALUES(?,?,?,?,?,?,?)'
    )
    .run(rc2.id, 'RC2', 'الفرنسية', 11, 1, YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO absences(student_id, student_code, absence_date, month, absence_type, hours, days, school_year, cycle_code) VALUES(?,?,?,?,?,?,?,?,?)'
    )
    .run(rc1.id, 'RC1', '2025-10-05', '2025-10', 'unjustified', 1, 0, YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO correspondence(student_id, student_code, letter_type, letter_date, total_hours, school_year, cycle_code) VALUES(?,?,?,?,?,?,?)'
    )
    .run(rc1.id, 'RC1', 'warning', '2025-10-06', 3, YEAR, COLLEGIAL);
intraDb
    .prepare('INSERT INTO student_files(student_id, doc_key, is_present, school_year, cycle_code) VALUES(?,?,?,?,?)')
    .run(rc1.id, 'birth_cert', 1, YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO student_movements(student_id, movement_type, from_section, to_section, movement_date, school_year, cycle_code) VALUES(?,?,?,?,?,?,?)'
    )
    .run(rc1.id, 'internal', '2APIC-2', '2APIC-3', '2025-10-01', YEAR, COLLEGIAL);
intraDb
    .prepare(
        'INSERT INTO student_profile_data(student_id, student_code, tab_key, data_json, school_year, cycle_code) VALUES(?,?,?,?,?,?)'
    )
    .run(rc1.id, 'RC1', 'health', '{}', YEAR, COLLEGIAL);
const intraRes = stageTransitionRepo.transferStudent(
    intraDb,
    {
        studentCode: 'RC1', fromYear: YEAR, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
        transitionType: 'intra_year_reclassification', idempotencyKey: 'key-intra-1',
        effectiveDate: '2025-11-20', reason: 'تصحيح'
    },
    { actor: ADMIN }
);
assert.strictEqual(intraRes.success, true);
assert.deepStrictEqual(intraRes.realigned, {
    grades: 1, absences: 1, correspondence: 1, student_files: 1, student_movements: 1, student_profile_data: 1
});
{
    assert.strictEqual(studentsRepo.getByCode(intraDb, 'RC1', YEAR, QUALIFIANT).id, rc1.id);
    assert.strictEqual(studentsRepo.getByCode(intraDb, 'RC2', YEAR, COLLEGIAL).id, rc2.id, 'decoy untouched');
    for (const table of ['grades', 'absences', 'correspondence', 'student_files', 'student_movements', 'student_profile_data']) {
        const cycles = intraDb
            .prepare(`SELECT DISTINCT cycle_code AS c FROM "${table}" WHERE student_id = ? AND school_year = ?`)
            .all(rc1.id, YEAR)
            .map((r) => r.c);
        assert.deepStrictEqual(cycles, [QUALIFIANT], `${table} realigned`);
    }
    assert.strictEqual(
        intraDb.prepare('SELECT cycle_code AS c FROM grades WHERE student_code = ? AND school_year = ?').get('RC2', YEAR).c,
        COLLEGIAL,
        'decoy grade untouched'
    );
    // Join intact: the (student_id, cycle_code) join resolves names in the new cycle.
    const qualGrades = gradesRepo.listByYear(intraDb, YEAR, QUALIFIANT);
    assert.deepStrictEqual(qualGrades.map((r) => r.student_code), ['RC1']);
    assert.strictEqual(qualGrades[0].full_name, 'تلميذ مصحح');
    assert.deepStrictEqual(
        gradesRepo.listByYear(intraDb, YEAR, COLLEGIAL).map((r) => r.student_code),
        ['RC2']
    );
    const tr = intraDb.prepare('SELECT * FROM student_stage_transitions WHERE idempotency_key = ?').get('key-intra-1');
    assert.strictEqual(tr.student_id, rc1.id);
    assert.strictEqual(tr.transition_type, 'intra_year_reclassification');
    const companion = intraDb
        .prepare('SELECT * FROM student_movements WHERE student_id = ? AND movement_date = ?')
        .get(rc1.id, '2025-11-20');
    assert.strictEqual(companion.movement_type, 'internal');
    assert.strictEqual(companion.cycle_code, QUALIFIANT);
    const counts = {};
    for (const row of intraDb.prepare("SELECT table_name FROM sync_outbox WHERE operation = 'PUT'").all()) {
        counts[row.table_name] = (counts[row.table_name] || 0) + 1;
    }
    assert.deepStrictEqual(counts, {
        students: 1, grades: 1, absences: 1, correspondence: 1,
        student_files: 1, student_profile_data: 1, student_movements: 2
    });
    console.log('  [ok] S3 intra-year reclassification: children realigned, join intact, outbox');
}

// ── S4: idempotent retry ─────────────────────────────────────────────────────
{
    const before = {
        students: interDb.prepare('SELECT COUNT(*) AS c FROM students').get().c,
        movements: interDb.prepare('SELECT COUNT(*) AS c FROM student_movements').get().c,
        transitions: interDb.prepare('SELECT COUNT(*) AS c FROM student_stage_transitions').get().c,
        outbox: interDb.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c,
        logs: interDb.prepare('SELECT COUNT(*) AS c FROM system_logs').get().c
    };
    const replay = stageTransitionRepo.transferStudent(
        interDb,
        {
            studentCode: 'TR1', fromYear: FROM_Y, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
            transitionType: 'inter_year_progression', idempotencyKey: 'key-inter-1',
            effectiveDate: '2025-09-15', reason: 'نجاح'
        },
        { actor: ADMIN }
    );
    assert.strictEqual(replay.success, true);
    assert.strictEqual(replay.idempotentReplay, true);
    assert.strictEqual(replay.transitionId, interRes.transitionId);
    assert.strictEqual(replay.studentId, interRes.studentId);
    assert.deepStrictEqual(
        {
            students: interDb.prepare('SELECT COUNT(*) AS c FROM students').get().c,
            movements: interDb.prepare('SELECT COUNT(*) AS c FROM student_movements').get().c,
            transitions: interDb.prepare('SELECT COUNT(*) AS c FROM student_stage_transitions').get().c,
            outbox: interDb.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c,
            logs: interDb.prepare('SELECT COUNT(*) AS c FROM system_logs').get().c
        },
        before,
        'retry must not duplicate any row'
    );
    expectCode(
        () =>
            stageTransitionRepo.transferStudent(
                interDb,
                {
                    studentCode: 'TRX', fromYear: FROM_Y, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
                    transitionType: 'inter_year_progression', idempotencyKey: 'key-inter-1',
                    effectiveDate: '2025-09-15'
                },
                { actor: ADMIN }
            ),
        'TRANSITION_CONFLICT',
        'S4 reused key with a different payload'
    );
    console.log('  [ok] S4 idempotent retry replays; key reuse with new payload conflicts');
}

// ── S5: single-cycle actor refused, dual-grant teacher allowed ───────────────
{
    const db = buildFixture();
    studentsRepo.insertOne(db, student('SG1', 'تلميذ أحادي', FROM_Y, '3APIC-1'), COLLEGIAL);
    studentsRepo.insertOne(db, student('SG2', 'تلميذ أحادي 2', YEAR, '2APIC-1'), COLLEGIAL);
    expectCode(
        () =>
            stageTransitionRepo.transferStudent(
                db,
                {
                    studentCode: 'SG1', fromYear: FROM_Y, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
                    transitionType: 'inter_year_progression', idempotencyKey: 'key-single-1',
                    effectiveDate: '2025-09-15'
                },
                { actor: SINGLE }
            ),
        'FORBIDDEN',
        'S5 single-grant inter-year'
    );
    expectCode(
        () =>
            stageTransitionRepo.transferStudent(
                db,
                {
                    studentCode: 'SG2', fromYear: YEAR, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
                    transitionType: 'intra_year_reclassification', idempotencyKey: 'key-single-2',
                    effectiveDate: '2025-11-20'
                },
                { actor: SINGLE }
            ),
        'FORBIDDEN',
        'S5 single-grant intra-year'
    );
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM student_stage_transitions').get().c, 0);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c, 0);
    console.log('  [ok] S5 single-cycle actor refused on both paths, nothing written');
}
{
    const db = buildFixture();
    studentsRepo.insertOne(db, student('DG1', 'تلميذ مزدوج', YEAR, '2APIC-1'), COLLEGIAL);
    const res = stageTransitionRepo.transferStudent(
        db,
        {
            studentCode: 'DG1', fromYear: YEAR, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
            transitionType: 'intra_year_reclassification', idempotencyKey: 'key-dual-1',
            effectiveDate: '2025-11-20'
        },
        { actor: DUAL }
    );
    assert.strictEqual(res.success, true);
    assert.strictEqual(studentsRepo.getByCode(db, 'DG1', YEAR, QUALIFIANT).code, 'DG1');
    console.log('  [ok] S5 dual-grant teacher transfer succeeds');
}

// ── S6: fail-closed validation + data conflicts ──────────────────────────────
{
    const db = buildFixture();
    studentsRepo.insertOne(db, student('V1', 'تلميذ تحقق', FROM_Y, '3APIC-1'), COLLEGIAL);
    studentsRepo.insertOne(db, student('V1', 'تلميذ تحقق', YEAR, 'TCS-1'), COLLEGIAL);
    studentsRepo.insertOne(db, student('VQ', 'تلميذ مؤهل', YEAR, 'TCS-2'), QUALIFIANT);
    const base = {
        studentCode: 'V1', fromYear: FROM_Y, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
        transitionType: 'inter_year_progression', idempotencyKey: 'key-valid-1', effectiveDate: '2025-09-15'
    };
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, toCycle: 'primary' }, { actor: ADMIN }), 'FORBIDDEN', 'S6 preview target');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, fromCycle: 'nope' }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 unknown cycle');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, toCycle: COLLEGIAL }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 same cycle');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, toYear: FROM_Y }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 inter same year');
    expectCode(
        () => stageTransitionRepo.transferStudent(db, { ...base, transitionType: 'intra_year_reclassification' }, { actor: ADMIN }),
        'INVALID_TRANSITION',
        'S6 intra across years'
    );
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, fromYear: '2025' }, { actor: ADMIN }), 'INVALID_SCHOOL_YEAR', 'S6 bad year');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, transitionType: 'teleport' }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 bad type');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, idempotencyKey: '' }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 missing key');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, effectiveDate: 'soon' }, { actor: ADMIN }), 'INVALID_TRANSITION', 'S6 bad date');
    expectCode(() => stageTransitionRepo.transferStudent(db, { ...base, studentCode: 'GHOST' }, { actor: ADMIN }), 'STUDENT_NOT_FOUND', 'S6 missing source');
    expectCode(() => stageTransitionRepo.transferStudent(db, base, { actor: ADMIN }), 'TRANSITION_CONFLICT', 'S6 existing target');
    expectCode(
        () =>
            stageTransitionRepo.transferStudent(
                db,
                {
                    studentCode: 'VQ', fromYear: YEAR, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
                    transitionType: 'intra_year_reclassification', idempotencyKey: 'key-valid-2',
                    effectiveDate: '2025-11-20'
                },
                { actor: ADMIN }
            ),
        'TRANSITION_CONFLICT',
        'S6 already in target cycle'
    );
    expectCode(() => stageTransitionRepo.transferStudent(db, base), 'FORBIDDEN', 'S6 missing actor');
    expectCode(() => stageTransitionRepo.transferStudent(db, base, { actor: null }), 'FORBIDDEN', 'S6 null actor');
    console.log('  [ok] S6 fail-closed validation + data conflicts');
}

// ── S7: IPC wiring — channel registered, auth matrix, preload parity ─────────
(async () => {
    const db = buildFixture();
    studentsRepo.insertOne(db, student('IP1', 'تلميذ IPC', YEAR, '2APIC-1'), COLLEGIAL);
    context.setDb(db);
    const handlers = {};
    registerStageTransitionIpc({ handle(channel, handler) { handlers[channel] = handler; } });
    assert.strictEqual(typeof handlers['stageTransition:transferStudent'], 'function', 'channel registered');
    const payload = {
        studentCode: 'IP1', fromYear: YEAR, toYear: YEAR, fromCycle: COLLEGIAL, toCycle: QUALIFIANT,
        transitionType: 'intra_year_reclassification', idempotencyKey: 'key-ipc-1', effectiveDate: '2025-11-20'
    };
    const sessions = getActiveSessions();
    sessions.set(3, { userId: 3, role: 'teacher', locked: false });
    const denied = await handlers['stageTransition:transferStudent']({ sender: { id: 3 } }, payload);
    assert.strictEqual(denied.success, false);
    assert.strictEqual(denied.code, 'FORBIDDEN', 'single-grant teacher refused over IPC');
    sessions.set(9, { userId: 9, role: 'viewer', locked: false });
    const viewerRes = await handlers['stageTransition:transferStudent']({ sender: { id: 9 } }, payload);
    assert.strictEqual(viewerRes.code, 'FORBIDDEN', 'viewer refused by role gate');
    const anonRes = await handlers['stageTransition:transferStudent']({ sender: { id: 99 } }, payload);
    assert.strictEqual(anonRes.code, 'UNAUTHENTICATED', 'no session refused');
    sessions.set(2, { userId: 2, role: 'teacher', locked: false });
    const allowed = await handlers['stageTransition:transferStudent']({ sender: { id: 2 } }, payload);
    assert.strictEqual(allowed.success, true, `dual-grant teacher succeeds over IPC: ${JSON.stringify(allowed)}`);
    assert.strictEqual(studentsRepo.getByCode(db, 'IP1', YEAR, QUALIFIANT).code, 'IP1');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS c FROM sync_outbox').get().c, 2, 'student + movement (no children seeded)');
    const preloadSrc = fs.readFileSync(path.join(__dirname, '..', 'preload.js'), 'utf8');
    assert.ok(
        preloadSrc.includes("ipcRenderer.invoke('stageTransition:transferStudent'"),
        'preload exposes the channel'
    );
    sessions.clear();
    console.log('  [ok] S7 IPC channel + auth matrix + preload parity');
    console.log('[test] stage-transition contract (Slice 6) OK');
})().catch((err) => {
    console.error(err);
    process.exit(1);
});

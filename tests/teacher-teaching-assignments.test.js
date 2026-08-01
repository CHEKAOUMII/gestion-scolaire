'use strict';

const assert = require('assert');
const { DatabaseSync } = require('node:sqlite');
const { createNoOpCapturePort, setRepoCapturePort } = require('../main/repos/capture-port');
const staffRepo = require('../main/repos/staff');
const gradesRepo = require('../main/repos/grades');
const { ensureTeacherTeachingAssignmentsSchema } = require('../main/db/schema');
const { setDb } = require('../main/db/context');
const { MIGRATIONS } = require('../main/db/migrations');
const {
    inferCycleFromSection,
    inferCycleFromLevel,
    inferEducationPlacement
} = require('../js/shared/education/cycles');

const YEAR = '2025/2026';
const QUALIFIANT = 'secondary_qualifiant';
const COLLEGIAL = 'secondary_collegial';

function openDb() {
    const db = new DatabaseSync(':memory:');
    db.transaction = (callback) => (...args) => {
        db.exec('BEGIN');
        try {
            const result = callback(...args);
            db.exec('COMMIT');
            return result;
        } catch (error) {
            db.exec('ROLLBACK');
            throw error;
        }
    };
    return db;
}

function createSchema(db) {
    db.exec(`
        CREATE TABLE teachers (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ppr TEXT, cin TEXT, full_name TEXT NOT NULL,
            full_name_fr TEXT, subject TEXT, specialty_subject TEXT, gender TEXT, birth_date TEXT,
            birth_place TEXT, phone TEXT, email TEXT, address TEXT, grade TEXT, cadre TEXT,
            echelon INTEGER, hire_date TEXT, marital_status TEXT, function_title TEXT, position TEXT,
            statut TEXT, diploma_school TEXT, diploma_professional TEXT, seniority_admin TEXT,
            seniority_grade TEXT, echelon_date TEXT, titularization_date TEXT, total_hours REAL,
            overtime_hours REAL, num_classes REAL, is_surplus INTEGER DEFAULT 0, source TEXT,
            school_year TEXT NOT NULL, active INTEGER DEFAULT 1, source_function_code TEXT,
            source_assignment_mode TEXT, source_cycle_code TEXT,
            scope_type TEXT NOT NULL DEFAULT 'teaching_assignment', source_updated_at TEXT,
            source_activity_json TEXT
        );
        CREATE UNIQUE INDEX idx_test_teacher_ppr_year
            ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '';
        CREATE TABLE teacher_aliases (
            id INTEGER PRIMARY KEY AUTOINCREMENT, teacher_id INTEGER, alias_name TEXT,
            alias_normalized TEXT, source TEXT, school_year TEXT,
            UNIQUE(teacher_id, school_year, alias_normalized)
        );
        CREATE TABLE students (
            id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, full_name TEXT NOT NULL,
            section TEXT, level TEXT, school_year TEXT, status TEXT DEFAULT 'active',
            cycle_code TEXT NOT NULL, UNIQUE(code, school_year)
        );
        CREATE TABLE grades (
            id INTEGER PRIMARY KEY AUTOINCREMENT, student_id INTEGER, student_code TEXT,
            teacher_id INTEGER, subject TEXT, grade REAL, semester INTEGER, teacher_name TEXT,
            level TEXT, section TEXT, school_year TEXT, cycle_code TEXT NOT NULL,
            UNIQUE(student_code, subject, semester, school_year)
        );
    `);
    ensureTeacherTeachingAssignmentsSchema(db);
}

function addTeacher(db, name, scopeType = 'teaching_assignment') {
    return db
        .prepare('INSERT INTO teachers(ppr, full_name, school_year, active, scope_type) VALUES (?, ?, ?, 1, ?)')
        .run(`PPR-${name}`, name, YEAR, scopeType).lastInsertRowid;
}

function addStudent(db, code, section, level, cycleCode) {
    return db
        .prepare('INSERT INTO students(code, full_name, section, level, school_year, cycle_code) VALUES (?, ?, ?, ?, ?, ?)')
        .run(code, `تلميذ ${code}`, section, level, YEAR, cycleCode).lastInsertRowid;
}

function suggestAndConfirm(db, teacherId, cycleCode, section, level, subject) {
    const suggestion = staffRepo.createAssignmentSuggestions(db, [{
        teacher_id: teacherId,
        teacher_name: 'أستاذ مشترك',
        teacher_resolution: 'resolved',
        school_year: YEAR,
        section,
        level,
        subject
    }], cycleCode, { source: 'test' });
    assert.strictEqual(suggestion.success, true);
    const assignment = db.prepare('SELECT * FROM teacher_teaching_assignments ORDER BY id DESC LIMIT 1').get();
    return staffRepo.reviewTeachingAssignment(db, {
        assignment_id: assignment.id,
        confidence: 'confirmed'
    }, { role: 'principal', userId: 7 }).assignment;
}

function testMigrationIsIdempotent() {
    const db = openDb();
    db.exec('CREATE TABLE teachers (id INTEGER PRIMARY KEY, full_name TEXT, school_year TEXT)');
    const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-073-cross-cycle-teaching-assignments');
    assert.ok(migration, 'cross-cycle assignment migration must be registered');
    setDb(db);
    migration.up();
    migration.up();
    const teacherColumns = db.prepare('PRAGMA table_info(teachers)').all().map((column) => column.name);
    assert.ok(teacherColumns.includes('source_activity_json'));
    assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'teacher_teaching_assignments'").get());
    db.close();
}

function testTimetableMigrationIsIdempotentAndCycleKeyed() {
    const db = openDb();
    db.exec(`
        CREATE TABLE schema_migrations(version TEXT PRIMARY KEY);
        CREATE TABLE timetable_data(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            school_year TEXT NOT NULL,
            data_json TEXT NOT NULL,
            updated_at TEXT
        );
        INSERT INTO timetable_data(school_year, data_json) VALUES ('2025/2026', '{}');
    `);
    const migration = MIGRATIONS.find((entry) => entry.version === '2026-07-075-timetable-cycle-key');
    assert.ok(migration, 'cycle-keyed timetable migration must be registered');
    setDb(db);
    migration.up();
    migration.up();
    const columns = db.prepare('PRAGMA table_info(timetable_data)').all().map((column) => column.name);
    assert.ok(columns.includes('cycle_code'));
    assert.strictEqual(db.prepare('SELECT cycle_code FROM timetable_data WHERE school_year = ?').get(YEAR).cycle_code, QUALIFIANT);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM schema_migrations WHERE version = ?').get('2026-07-075-timetable-cycle-key').count, 1);
    db.close();
}

function testPlacementClassification() {
    assert.strictEqual(inferCycleFromSection('1APIC-2'), COLLEGIAL);
    assert.strictEqual(inferCycleFromSection('2BACSP-1'), QUALIFIANT);
    assert.strictEqual(inferCycleFromLevel('الأولى باكالوريا'), QUALIFIANT);
    assert.strictEqual(inferEducationPlacement({ section: '1APIC-2', level: '1APIC' }), COLLEGIAL);
    assert.strictEqual(inferEducationPlacement({ section: 'unknown', level: 'unknown' }), null);
    assert.strictEqual(inferEducationPlacement({ section: '1APIC-2', level: '1BAC' }), null);
}

function testTeacherCanHaveAssignmentsInBothCycles() {
    const db = openDb();
    createSchema(db);
    const teacherId = addTeacher(db, 'أستاذ مشترك');
    addTeacher(db, 'موظف إداري', 'institution_wide');

    suggestAndConfirm(db, teacherId, COLLEGIAL, '1APIC-2', '1APIC', 'التربية الإسلامية');
    suggestAndConfirm(db, teacherId, QUALIFIANT, '1BACSE-1', '1BAC', 'اللغة العربية');

    assert.strictEqual(staffRepo.listByYear(db, YEAR).filter((row) => row.id === teacherId).length, 1);
    assert.strictEqual(staffRepo.listByYearAndCycle(db, YEAR, COLLEGIAL).filter((row) => row.id === teacherId).length, 1);
    assert.strictEqual(staffRepo.listByYearAndCycle(db, YEAR, QUALIFIANT).filter((row) => row.id === teacherId).length, 1);
    assert.strictEqual(staffRepo.listByYearAndCycle(db, YEAR, COLLEGIAL).length, 2);
    assert.strictEqual(staffRepo.listByYearAndCycle(db, YEAR, QUALIFIANT).length, 2);
    db.close();
}

function testGradeImportCreatesIdempotentSuggestion() {
    const db = openDb();
    createSchema(db);
    const teacherId = addTeacher(db, 'أستاذ النقط');
    const studentId = addStudent(db, 'C-1', '1APIC-2', '1APIC', COLLEGIAL);
    const grade = {
        student_id: studentId,
        student_code: 'C-1',
        teacher_id: teacherId,
        teacher_name: 'أستاذ النقط',
        teacher_resolution: 'resolved',
        subject: 'الرياضيات',
        grade: 15,
        semester: 1,
        level: '1APIC',
        section: '1APIC-2',
        school_year: YEAR
    };
    const options = {
        resolveRow: (row) => row,
        onTeacherAssignments: (connection, rows, cycleCode) =>
            staffRepo.createAssignmentSuggestions(connection, rows, cycleCode, { inTransaction: true })
    };
    const first = gradesRepo.saveBulk(db, [grade], COLLEGIAL, options);
    const second = gradesRepo.saveBulk(db, [grade], COLLEGIAL, options);
    assert.strictEqual(first.assignmentResult.created, 1);
    assert.strictEqual(second.assignmentResult.created, 0);
    assert.strictEqual(second.assignmentResult.preserved, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_teaching_assignments').get().count, 1);

    const ambiguous = gradesRepo.saveBulk(db, [{ ...grade, student_code: 'C-1', teacher_id: null, teacher_resolution: 'ambiguous' }], COLLEGIAL, options);
    assert.strictEqual(ambiguous.assignmentResult.created, 0);
    assert.strictEqual(ambiguous.assignmentResult.unresolved.length, 1);
    db.close();
}

function testAssignmentReviewQueueAndResolution() {
    const db = openDb();
    createSchema(db);
    db.exec("ALTER TABLE grades ADD COLUMN teacher_resolution TEXT DEFAULT 'unresolved'; ALTER TABLE grades ADD COLUMN source_file_name TEXT;");
    const firstTeacherId = addTeacher(db, 'اسم غامض');
    const secondTeacherId = db
        .prepare('INSERT INTO teachers(ppr, full_name, school_year, active, scope_type) VALUES (?, ?, ?, 1, ?)')
        .run('PPR-REVIEW-2', 'اسم غامض', YEAR, 'teaching_assignment').lastInsertRowid;
    const studentId = addStudent(db, 'C-REVIEW', '1APIC-1', '1APIC', COLLEGIAL);
    db.prepare(
        `INSERT INTO grades(student_id, student_code, teacher_id, subject, grade, semester, teacher_name, level, section, school_year, cycle_code, teacher_resolution, source_file_name)
         VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, 'ambiguous', ?)`
    ).run(studentId, 'C-REVIEW', 'الرياضيات', 14, 1, 'اسم غامض', '1APIC', '1APIC-1', YEAR, COLLEGIAL, 'grades-review.xlsx');

    const queue = staffRepo.listTeacherAssignmentReviewQueue(db, YEAR, COLLEGIAL);
    const unresolved = queue.find((item) => item.queue_type === 'grade');
    assert.ok(unresolved, 'ambiguous grade identity must be visible in the review queue');
    assert.strictEqual(unresolved.grade_count, 1);
    assert.strictEqual(unresolved.candidates.length, 2);
    assert.ok(unresolved.candidates.some((candidate) => Number(candidate.id) === Number(secondTeacherId)));

    const resolved = staffRepo.resolveUnresolvedGradeAssignment(db, {
        teacher_id: secondTeacherId,
        teacher_name: 'اسم غامض',
        school_year: YEAR,
        level_code: '1APIC',
        section: '1APIC-1',
        subject_code: 'الرياضيات'
    }, { role: 'principal', cycleCode: COLLEGIAL, userId: 7 });
    assert.strictEqual(resolved.success, true);
    assert.strictEqual(resolved.updated, 1);
    const savedGrade = db.prepare('SELECT teacher_id, teacher_resolution FROM grades WHERE student_code = ?').get('C-REVIEW');
    assert.strictEqual(Number(savedGrade.teacher_id), Number(secondTeacherId));
    assert.strictEqual(savedGrade.teacher_resolution, 'resolved');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_teaching_assignments WHERE teacher_id = ?').get(secondTeacherId).count, 1);
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_teaching_assignments WHERE teacher_id = ?').get(firstTeacherId).count, 0);
    db.close();
}

function testManagerTransferAndNonManagerProtection() {
    const db = openDb();
    createSchema(db);
    const teacherId = addTeacher(db, 'أستاذ النقل');
    const assignment = suggestAndConfirm(db, teacherId, COLLEGIAL, '1APIC-1', '1APIC', 'الفرنسية');
    assert.throws(
        () => staffRepo.reviewTeachingAssignment(db, { assignment_id: assignment.id, confidence: 'confirmed', target_cycle_code: QUALIFIANT }, { role: 'teacher', userId: 9 }),
        /صلاحية/
    );
    const transferred = staffRepo.reviewTeachingAssignment(db, {
        assignment_id: assignment.id,
        confidence: 'confirmed',
        target_cycle_code: QUALIFIANT
    }, { role: 'admin', userId: 1 }).assignment;
    assert.strictEqual(transferred.cycle_code, QUALIFIANT);
    db.close();
}

function testMinistrySourceDataDoesNotCreateAssignment() {
    const db = openDb();
    createSchema(db);
    const importResult = staffRepo.importBulk(db, [{
        ppr: 'PPR-XML',
        full_name: 'أستاذ XML',
        school_year: YEAR,
        source: 'agent_xml',
        source_function_code: 'E001',
        source_cycle_code: '2A',
        source_updated_at: '2026-07-28',
        source_activity_json: JSON.stringify([{ cd_cycle: '2A', cd_fonc: 'E001' }])
    }], { validateSchoolYear: (schoolYear) => assert.strictEqual(schoolYear, YEAR) });
    assert.strictEqual(importResult.success, true);
    const importedTeacher = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR-XML');
    assert.strictEqual(importedTeacher.source_cycle_code, '2A');
    assert.strictEqual(importedTeacher.source_function_code, 'E001');
    assert.strictEqual(db.prepare('SELECT COUNT(*) AS count FROM teacher_teaching_assignments').get().count, 0);
    db.close();
}

setRepoCapturePort(createNoOpCapturePort());
try {
    testMigrationIsIdempotent();
    testTimetableMigrationIsIdempotentAndCycleKeyed();
    testPlacementClassification();
    testTeacherCanHaveAssignmentsInBothCycles();
    testGradeImportCreatesIdempotentSuggestion();
    testAssignmentReviewQueueAndResolution();
    testManagerTransferAndNonManagerProtection();
    testMinistrySourceDataDoesNotCreateAssignment();
    console.log('teacher-teaching-assignments.test.js: OK');
} finally {
    setRepoCapturePort(null);
}

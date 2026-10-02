'use strict';

/**
 * Phase 1 (docs/reviews/2026-08-04-import-pipeline-review.md §5.5, items 6-10) —
 * deterministic order-variant alias seeding + ordered-key fallback.
 *
 *   (a) importBulk (Ministry roster, agent_xml) seeds original + reversed-order
 *       variants for Arabic AND Latin names in teacher_aliases.
 *   (b) Re-importing the same roster is idempotent — no duplicate alias rows.
 *   (c) A variant that would collide with a DIFFERENT teacher's existing alias
 *       is skipped silently (never throws); swapped-name pairs stay ambiguous.
 *   (d) resolveTeacherIdentity resolves a family-first FET-style name against a
 *       teacher that only exists first-first via the ordered-key fallback.
 *   (e) Two teachers sharing one token multiset stay unresolved (manual review).
 */

const assert = require('assert');
const { ensureInstitutionCyclesSchema } = require('../main/db/schema');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
const staffRepo = require('../main/repos/staff');
const {
    resolveTeacherIdentity,
    normalizeTeacherName
} = require('../main/teachers/identity');

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

function buildFixture() {
    const db = openDb();
    ensureInstitutionCyclesSchema(db);
    db.exec(`
        CREATE TABLE teachers(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ppr TEXT,
            cin TEXT,
            full_name TEXT NOT NULL,
            full_name_fr TEXT,
            subject TEXT,
            specialty_subject TEXT,
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
            position TEXT,
            statut TEXT,
            diploma_school TEXT,
            diploma_professional TEXT,
            seniority_admin TEXT,
            seniority_grade TEXT,
            echelon_date TEXT,
            titularization_date TEXT,
            total_hours REAL,
            overtime_hours REAL,
            num_classes REAL,
            is_surplus INTEGER DEFAULT 0,
            source TEXT DEFAULT 'manual',
            school_year TEXT,
            active INTEGER DEFAULT 1,
            source_function_code TEXT,
            source_assignment_mode TEXT,
            source_cycle_code TEXT,
            scope_type TEXT NOT NULL DEFAULT 'teaching_assignment',
            source_updated_at TEXT,
            source_activity_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
        CREATE TABLE teacher_aliases(
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            teacher_id INTEGER NOT NULL,
            alias_name TEXT NOT NULL,
            alias_normalized TEXT NOT NULL,
            source TEXT,
            school_year TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            UNIQUE(teacher_id, school_year, alias_normalized)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_teachers_ppr_year
            ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '';
        CREATE INDEX IF NOT EXISTS idx_teacher_aliases_lookup
            ON teacher_aliases(school_year, alias_normalized);
    `);
    return db;
}

function aliasRowsFor(db, teacherId) {
    return db
        .prepare(
            'SELECT alias_name, alias_normalized, source FROM teacher_aliases WHERE teacher_id = ? ORDER BY id'
        )
        .all(teacherId);
}

function run() {
    setRepoCapturePort(createNoOpCapturePort());

    const ministryTeacher = {
        ppr: 'PPR-100',
        full_name: 'نور الدين السعيدي',
        full_name_fr: 'EL SAIDI Noureddine',
        subject: 'الرياضيات',
        source: 'agent_xml',
        school_year: YEAR
    };

    let db = buildFixture();
    staffRepo.importBulk(db, [ministryTeacher]);
    const teacherRow = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR-100');
    assert.ok(teacherRow, 'Ministry teacher inserted');

    const aliases = aliasRowsFor(db, teacherRow.id);
    assert.strictEqual(aliases.length, 4, 'two canonical + two reversed variants');
    const byNormalized = Object.fromEntries(aliases.map((row) => [row.alias_normalized, row.alias_name]));
    assert.strictEqual(byNormalized[normalizeTeacherName('نور الدين السعيدي')], 'نور الدين السعيدي');
    assert.strictEqual(byNormalized[normalizeTeacherName('EL SAIDI Noureddine')], 'EL SAIDI Noureddine');
    assert.strictEqual(byNormalized[normalizeTeacherName('السعيدي نور الدين')], 'السعيدي نور الدين');
    assert.strictEqual(byNormalized[normalizeTeacherName('Noureddine EL SAIDI')], 'Noureddine EL SAIDI');
    for (const row of aliases) {
        assert.strictEqual(row.source, 'agent_xml', 'variant seeds reuse the import source');
    }

    const fetchByFamilyFirst = resolveTeacherIdentity(db, {
        teacher_name: 'السعيدي نور الدين',
        school_year: YEAR
    });
    assert.strictEqual(fetchByFamilyFirst.teacher_id, teacherRow.id, 'family-first FET name hits the variant alias');
    const rendererAliases = staffRepo.listNameAliases(db, 'teacher', YEAR);
    assert.ok(rendererAliases.some((row) => Number(row.canonical_id) === teacherRow.id && row.alias_text === 'السعيدي نور الدين'), 'renderer alias API includes teacher_aliases rows');

    staffRepo.importBulk(db, [ministryTeacher]);
    assert.strictEqual(aliasRowsFor(db, teacherRow.id).length, 4, 're-import does not duplicate aliases');

    db = buildFixture();
    staffRepo.importBulk(db, [
        { ppr: 'PPR-1', full_name: 'محمد أحمد', source: 'agent_xml', school_year: YEAR },
        { ppr: 'PPR-2', full_name: 'أحمد محمد', source: 'agent_xml', school_year: YEAR }
    ]);
    const first = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR-1');
    const second = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR-2');
    assert.deepStrictEqual(
        aliasRowsFor(db, first.id).map((row) => row.alias_normalized),
        [normalizeTeacherName('محمد أحمد'), normalizeTeacherName('أحمد محمد')],
        'first teacher keeps canonical + its own reversed variant'
    );
    assert.deepStrictEqual(
        aliasRowsFor(db, second.id).map((row) => row.alias_normalized),
        [normalizeTeacherName('أحمد محمد')],
        'second teacher\'s reversed variant is skipped on cross-teacher collision'
    );
    const swappedLookup = resolveTeacherIdentity(db, { teacher_name: 'أحمد محمد', school_year: YEAR });
    assert.strictEqual(swappedLookup.teacher_id, null, 'swapped-name pair stays ambiguous');
    assert.strictEqual(swappedLookup.ambiguous, true);
    const ownLookup = resolveTeacherIdentity(db, { teacher_name: 'محمد أحمد', school_year: YEAR });
    assert.strictEqual(ownLookup.teacher_id, null, 'shared token collision stays unresolved even for canonical order');
    assert.strictEqual(ownLookup.ambiguous, true);

    db = buildFixture();
    staffRepo.importBulk(db, [
        { ppr: 'PPR-400', full_name: 'فاطمة علي', source: 'agent_xml', school_year: YEAR },
        { ppr: 'PPR-401', full_name: 'فاطمه علي', source: 'agent_xml', school_year: YEAR }
    ]);
    const foldedCollision = resolveTeacherIdentity(db, { teacher_name: 'علي فاطمة', school_year: YEAR });
    assert.strictEqual(foldedCollision.teacher_id, null, 'Arabic-fold collision must remain unresolved');
    assert.strictEqual(foldedCollision.ambiguous, true);

    db = buildFixture();
    const directInsert = db.prepare(
        'INSERT INTO teachers(ppr, full_name, subject, source, school_year) VALUES (?, ?, ?, ?, ?)'
    );
    const insertId = Number(
        directInsert.run('PPR-200', 'نور الدين السعيدي', 'الفيزياء', 'agent_xml', YEAR).lastInsertRowid
    );
    assert.strictEqual(aliasRowsFor(db, insertId).length, 0, 'direct insert carries no aliases');
    const fallback = resolveTeacherIdentity(db, { teacher_name: 'السعيدي نور الدين', school_year: YEAR });
    assert.strictEqual(fallback.teacher_id, insertId, 'ordered-key fallback resolves family-first name');
    assert.strictEqual(fallback.teacher_name, 'نور الدين السعيدي');
    const fallbackAgain = resolveTeacherIdentity(db, { teacher_name: 'السعيدي نور الدين', school_year: YEAR });
    assert.strictEqual(fallbackAgain.teacher_id, insertId, 'first fallback persists the alias');
    const otherYear = resolveTeacherIdentity(db, { teacher_name: 'السعيدي نور الدين', school_year: '2024/2025' });
    assert.strictEqual(otherYear.teacher_id, null, 'fallback is school-year scoped');
    assert.strictEqual(otherYear.ambiguous, false);

    db = buildFixture();
    const directInsertAmbiguous = db.prepare(
        'INSERT INTO teachers(ppr, full_name, subject, source, school_year) VALUES (?, ?, ?, ?, ?)'
    );
    directInsertAmbiguous.run('PPR-300', 'محمد أحمد خالد', null, 'agent_xml', YEAR);
    directInsertAmbiguous.run('PPR-301', 'أحمد خالد محمد', null, 'agent_xml', YEAR);
    const ambiguous = resolveTeacherIdentity(db, { teacher_name: 'خالد محمد أحمد', school_year: YEAR });
    assert.strictEqual(ambiguous.teacher_id, null, 'shared token multiset stays unresolved');
    assert.strictEqual(ambiguous.ambiguous, true, 'shared token multiset flagged ambiguous');

    setRepoCapturePort(null);
    console.log('staff-aliases-seeding.test.js: OK');
}

run();

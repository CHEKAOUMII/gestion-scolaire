'use strict';

// node tests/staff-import-upsert.test.js
// T1.6 — ministry XML re-import must not null manually-entered teacher columns.
// The ON CONFLICT(ppr, school_year) upsert keeps identity + descriptive columns
// via COALESCE; only import-event markers (source, source_updated_at) and the
// boolean flags (active, is_surplus) stay unconditional.

const assert = require('assert');
const staffRepo = require('../main/repos/staff.js');
const { setRepoCapturePort, createNoOpCapturePort } = require('../main/repos/capture-port');
setRepoCapturePort(createNoOpCapturePort());

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

function openDb() {
    const db = new Database(':memory:');
    if (!useNative) {
        // node:sqlite is stricter than better-sqlite3: binding an object that
        // carries keys not used by the statement throws ERR_INVALID_STATE.
        // Filter bound objects down to the statement's @named parameters.
        const origPrepare = db.prepare.bind(db);
        db.prepare = (sql) => {
            const stmt = origPrepare(sql);
            const named = new Set();
            const re = /@([A-Za-z_][A-Za-z0-9_]*)/g;
            let m;
            while ((m = re.exec(String(sql)))) named.add(m[1]);
            if (!named.size) return stmt;
            const filter = (args) =>
                args.map((a) => {
                    if (a && typeof a === 'object' && !Array.isArray(a)) {
                        const filtered = {};
                        for (const k of named) {
                            if (Object.prototype.hasOwnProperty.call(a, k)) filtered[k] = a[k];
                        }
                        return filtered;
                    }
                    return a;
                });
            return {
                run: (...args) => stmt.run(...filter(args)),
                get: (...args) => stmt.get(...filter(args)),
                all: (...args) => stmt.all(...filter(args)),
                iterate: (...args) => stmt.iterate(...filter(args)),
                raw: stmt.raw ? (...args) => stmt.raw(...filter(args)) : undefined,
                columns: () => stmt.columns()
            };
        };
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
    }
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
            FOREIGN KEY(teacher_id) REFERENCES teachers(id),
            UNIQUE(teacher_id, school_year, alias_normalized)
        );
        CREATE UNIQUE INDEX idx_teacher_ppr_year ON teachers(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '';
    `);
    return db;
}

const year = '2025/2026';
const teacher = (overrides) => ({
    ppr: 'PPR001',
    cin: 'CIN001',
    full_name: 'أستاذ تجريبي',
    full_name_fr: 'Professeur Test',
    subject: 'الرياضيات',
    specialty_subject: 'رياضيات',
    gender: 'ذكر',
    birth_date: '1980-01-01',
    grade: 'أستاذ مبرز',
    cadre: 'التعليم الثانوي التأهيلي',
    position: 'أستاذ',
    statut: 'رسمي',
    seniority_admin: '15',
    seniority_grade: '12',
    echelon_date: '2015-09-01',
    titularization_date: '2005-09-01',
    total_hours: 21,
    overtime_hours: 2,
    num_classes: 4,
    source: 'agent_xml',
    school_year: year,
    active: 1,
    source_function_code: 'F001',
    source_assignment_mode: 'primary',
    source_cycle_code: 'secondary_qualifiant',
    source_updated_at: '2026-03-01T10:00:00Z',
    source_activity_json: '{"a":1}',
    ...overrides
});

const db = openDb();

// Case A: second import with descriptive fields absent must keep original values
const first = staffRepo.importBulk(db, [teacher({})]);
assert.strictEqual(first.success, true);
const partial = staffRepo.importBulk(db, [teacher({
    specialty_subject: null,
    grade: null,
    cadre: null,
    position: null,
    statut: null,
    seniority_admin: null,
    seniority_grade: null,
    echelon_date: null,
    titularization_date: null,
    total_hours: null,
    overtime_hours: null,
    num_classes: null,
    source_function_code: null,
    source_assignment_mode: null,
    source_cycle_code: null,
    source_activity_json: null,
    source_updated_at: '2026-03-02T10:00:00Z'
})]);
assert.strictEqual(partial.success, true);
const afterPartial = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR001');
assert.strictEqual(afterPartial.specialty_subject, 'رياضيات', 'case A: specialty_subject must survive a partial re-import');
assert.strictEqual(afterPartial.grade, 'أستاذ مبرز', 'case A: grade must survive');
assert.strictEqual(afterPartial.cadre, 'التعليم الثانوي التأهيلي', 'case A: cadre must survive');
assert.strictEqual(afterPartial.position, 'أستاذ');
assert.strictEqual(afterPartial.statut, 'رسمي');
assert.strictEqual(Number(afterPartial.total_hours), 21);
assert.strictEqual(Number(afterPartial.num_classes), 4);
assert.strictEqual(afterPartial.source_cycle_code, 'secondary_qualifiant');

// Case B: a second import that DOES carry new values must win
const updated = staffRepo.importBulk(db, [teacher({
    specialty_subject: 'رياضيات تطبيقية',
    grade: 'أستاذ ممتاز',
    cadre: 'التعليم الثانوي',
    total_hours: 18,
    source_updated_at: '2026-03-03T10:00:00Z'
})]);
assert.strictEqual(updated.success, true);
const afterUpdated = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR001');
assert.strictEqual(afterUpdated.specialty_subject, 'رياضيات تطبيقية', 'case B: new specialty_subject wins');
assert.strictEqual(afterUpdated.grade, 'أستاذ ممتاز', 'case B: new grade wins');
assert.strictEqual(Number(afterUpdated.total_hours), 18, 'case B: new total_hours wins');

// Case C: source_updated_at always reflects the latest import
assert.strictEqual(afterUpdated.source_updated_at, '2026-03-03T10:00:00Z', 'case C: freshness marker tracks the latest import');

// Case E: empty-string payload must not overwrite descriptive columns (T1.6 — '' is the absent marker)
const emptyStringProbe = staffRepo.importBulk(db, [teacher({
    specialty_subject: '',
    grade: '',
    cadre: '',
    position: '',
    statut: '',
    seniority_admin: '',
    seniority_grade: '',
    echelon_date: '',
    titularization_date: '',
    diploma_school: '',
    diploma_professional: '',
    source_function_code: '',
    source_assignment_mode: '',
    source_cycle_code: '',
    source_activity_json: '',
    source_updated_at: '2026-03-04T10:00:00Z'
})]);
assert.strictEqual(emptyStringProbe.success, true);
const afterEmpty = db.prepare('SELECT * FROM teachers WHERE ppr = ?').get('PPR001');
assert.strictEqual(afterEmpty.specialty_subject, 'رياضيات تطبيقية', 'case E: empty specialty_subject must not overwrite');
assert.strictEqual(afterEmpty.grade, 'أستاذ ممتاز', 'case E: empty grade must not overwrite');
assert.strictEqual(afterEmpty.cadre, 'التعليم الثانوي', 'case E: empty cadre must not overwrite');
assert.strictEqual(afterEmpty.position, 'أستاذ');
assert.strictEqual(afterEmpty.statut, 'رسمي');
assert.strictEqual(afterEmpty.diploma_school, afterUpdated.diploma_school);
assert.strictEqual(afterEmpty.source_cycle_code, 'secondary_qualifiant', 'case E: empty source_cycle_code must not overwrite');

// Case D: teachers with no PPR take the insert-by-name path unchanged
const noPpr = staffRepo.importBulk(db, [teacher({ ppr: null, full_name: 'أستاذ بلا بطاقة' })]);
assert.strictEqual(noPpr.success, true);
const byName = db.prepare('SELECT * FROM teachers WHERE full_name = ? AND school_year = ?').get('أستاذ بلا بطاقة', year);
assert.ok(byName, 'case D: no-PPR teacher inserted by name');
const reImport = staffRepo.importBulk(db, [teacher({ ppr: null, full_name: 'أستاذ بلا بطاقة', subject: 'الفيزياء' })]);
assert.strictEqual(reImport.success, true);
const sameName = db.prepare("SELECT COUNT(*) AS n FROM teachers WHERE full_name = ? AND school_year = ?").get('أستاذ بلا بطاقة', year);
assert.strictEqual(sameName.n, 1, 'case D: re-import must not duplicate by-name rows');
const byNameAfter = db.prepare('SELECT * FROM teachers WHERE full_name = ? AND school_year = ?').get('أستاذ بلا بطاقة', year);
// insert-by-name keeps the existing subject (COALESCE + WHERE subject IS NULL).
assert.strictEqual(byNameAfter.subject, 'الرياضيات', 'case D: by-name path must not overwrite an existing subject');

// Backwards compat: source provenance marker always reflects the newest file
const sourceProbe = staffRepo.importBulk(db, [teacher({ source: 'manual' })]);
assert.strictEqual(sourceProbe.success, true);
const afterSource = db.prepare('SELECT source FROM teachers WHERE ppr = ?').get('PPR001');
assert.strictEqual(afterSource.source, 'manual', 'source must be unconditional (import event marker)');

console.log('staff-import-upsert: OK' + (useNative ? '' : ' (node:sqlite)'));

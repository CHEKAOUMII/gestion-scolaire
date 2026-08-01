'use strict';

/**
 * Exact atomic bulk capture for students/grades/absences (WP1).
 * Uses a pure in-memory SQL stub so tests run under plain Node (no better-sqlite3 ABI).
 */

const assert = require('assert');
const { setCaptureGetDb, CHANNEL_REGISTRY, captureInputUpserts } = require('../main/sync/capture');
const studentsRepo = require('../main/repos/students');
const CYCLE = 'secondary_qualifiant';
const gradesRepo = require('../main/repos/grades');
const absencesRepo = require('../main/repos/absences');

function createMemoryDb() {
    const tables = {
        students: [],
        grades: [],
        absences: [],
        sync_outbox: [],
        sync_id_map: []
    };
    let seq = { students: 1, grades: 1, absences: 1, sync_outbox: 1 };

    function norm(sql) {
        return String(sql).replace(/\s+/g, ' ').trim();
    }

    // Production column sets, so the fake exercises the same optional-column branches
    // gradesRepo.createUpsert takes against a real schema. Drifting from these is how a
    // fake DB silently stops testing what ships.
    const TABLE_COLUMNS = {
        students: [
            'id', 'code', 'full_name', 'family_name', 'birth_date', 'birth_place', 'gender',
            'section', 'level', 'school_name', 'school_year', 'status', 'registration_type', 'cycle_code'
        ],
        grades: [
            'id', 'student_id', 'student_code', 'teacher_id', 'subject', 'grade', 'semester',
            'teacher_name', 'level', 'section', 'school_year', 'cycle_code',
            'teacher_resolution', 'source_file_name'
        ],
        absences: [
            'id', 'student_id', 'student_code', 'absence_date', 'month', 'absence_type',
            'hours', 'days', 'reason', 'school_year', 'cycle_code'
        ]
    };

    const db = {
        _tables: tables,
        pragma(statement) {
            const match = /table_info\(\s*"?(\w+)"?\s*\)/i.exec(String(statement));
            const columns = match ? TABLE_COLUMNS[match[1]] : null;
            if (!columns) throw new Error('[memory-db] Unhandled pragma: ' + statement);
            return columns.map((name) => ({ name, pk: name === 'id' ? 1 : 0 }));
        },
        transaction(fn) {
            return (...args) => {
                // Snapshot for rollback
                const snap = JSON.stringify(tables);
                const seqSnap = JSON.stringify(seq);
                try {
                    return fn(...args);
                } catch (err) {
                    const restored = JSON.parse(snap);
                    Object.keys(tables).forEach((k) => {
                        tables[k] = restored[k];
                    });
                    seq = JSON.parse(seqSnap);
                    throw err;
                }
            };
        },
        prepare(sqlRaw) {
            const sql = norm(sqlRaw);

            if (sql.startsWith('INSERT INTO students') && sql.includes('ON CONFLICT')) {
                return {
                    run(...params) {
                        const values =
                            params.length >= 12
                                ? params
                                : [
                                      params[0],
                                      params[1],
                                      params[2],
                                      params[3],
                                      params[4],
                                      params[5],
                                      params[6],
                                      '',
                                      '',
                                      params[7],
                                      params[8],
                                      params[9]
                                  ];
                        const [code, full_name, family_name, birth_date, birth_place, gender, section, level, school_name, school_year, status, registration_type, cycle_code = CYCLE] =
                            values;
                        const existing = tables.students.find((r) => r.code === code && r.school_year === school_year);
                        if (existing) {
                            Object.assign(existing, {
                                full_name,
                                family_name,
                                birth_date,
                                birth_place,
                                gender,
                                section,
                                level: level || existing.level || '',
                                school_name: school_name || existing.school_name || '',
                                status,
                                registration_type
                            });
                            return { changes: 1, lastInsertRowid: existing.id };
                        }
                        const row = {
                            id: seq.students++,
                            code,
                            full_name,
                            family_name,
                            birth_date,
                            birth_place,
                            gender,
                            section,
                            level,
                            school_name,
                            school_year,
                            status,
                            registration_type,
                            cycle_code
                        };
                        tables.students.push(row);
                        return { changes: 1, lastInsertRowid: row.id };
                    }
                };
            }

            if (sql.startsWith('SELECT id, code, cycle_code FROM students')) {
                return {
                    get(code, schoolYear) {
                        const student = tables.students.find((row) => row.code === code && row.school_year === schoolYear);
                        return student ? { id: student.id, code: student.code, cycle_code: student.cycle_code || CYCLE } : undefined;
                    }
                };
            }

            if (sql.startsWith('SELECT * FROM "students" WHERE') || sql.startsWith('SELECT * FROM students WHERE')) {
                return {
                    get(...params) {
                        // school_year, code order from keyFields
                        if (sql.includes('school_year') && sql.includes('code')) {
                            return (
                                tables.students.find((r) => r.school_year === params[0] && r.code === params[1]) || null
                            );
                        }
                        if (sql.includes('id = ?')) {
                            return tables.students.find((r) => r.id === params[0]) || null;
                        }
                        return null;
                    },
                    all(...params) {
                        if (sql.includes('school_year = ?') && !sql.includes('code')) {
                            return tables.students.filter((r) => r.school_year === params[0]);
                        }
                        return [];
                    }
                };
            }

            if (sql.startsWith('DELETE FROM "students"') || sql.startsWith('DELETE FROM students')) {
                return {
                    run(...params) {
                        if (sql.includes('school_year = ?')) {
                            const before = tables.students.length;
                            tables.students = tables.students.filter((r) => r.school_year !== params[0]);
                            return { changes: before - tables.students.length };
                        }
                        return { changes: 0 };
                    }
                };
            }

            if (sql.startsWith('INSERT INTO grades') && sql.includes('ON CONFLICT')) {
                return {
                    run(...params) {
                        const [
                            student_id, student_code, teacher_id, subject, grade, semester,
                            teacher_name, level, section, school_year, cycle_code = CYCLE,
                            teacher_resolution = 'unresolved', source_file_name = null
                        ] = params;
                        const existing = tables.grades.find(
                            (r) =>
                                r.student_code === student_code &&
                                r.subject === subject &&
                                r.semester === semester &&
                                r.school_year === school_year
                        );
                        if (existing) {
                            // The upsert guard: a stored row belonging to another cycle is
                            // left untouched and reported as changes:0 (plan §5.3).
                            if (existing.cycle_code !== cycle_code) {
                                return { changes: 0, lastInsertRowid: existing.id };
                            }
                            Object.assign(existing, {
                                student_id,
                                teacher_id,
                                grade,
                                teacher_name,
                                level,
                                section,
                                teacher_resolution,
                                source_file_name: source_file_name ?? existing.source_file_name ?? null
                            });
                            return { changes: 1, lastInsertRowid: existing.id };
                        }
                        const row = {
                            id: seq.grades++,
                            student_id,
                            student_code,
                            teacher_id,
                            subject,
                            grade,
                            semester,
                            teacher_name,
                            level,
                            section,
                            school_year,
                            cycle_code,
                            teacher_resolution,
                            source_file_name
                        };
                        tables.grades.push(row);
                        return { changes: 1, lastInsertRowid: row.id };
                    }
                };
            }

            // Existence probe used by gradesRepo.saveBulk to tell inserts from updates.
            // Parameter order here is the SQL's own (student_code, subject, semester,
            // school_year), not the entity registry's key-field order used below.
            if (sql.startsWith('SELECT 1 FROM grades WHERE')) {
                return {
                    get(...params) {
                        const found = tables.grades.find(
                            (r) =>
                                r.student_code === params[0] &&
                                r.subject === params[1] &&
                                String(r.semester) === String(params[2]) &&
                                r.school_year === params[3]
                        );
                        return found ? { 1: 1 } : undefined;
                    }
                };
            }

            if (sql.startsWith('SELECT * FROM "grades" WHERE') || sql.startsWith('SELECT * FROM grades WHERE')) {
                return {
                    get(...params) {
                        // keyFields order: school_year, student_code, subject, semester
                        return (
                            tables.grades.find(
                                (r) =>
                                    r.school_year === params[0] &&
                                    r.student_code === params[1] &&
                                    r.subject === params[2] &&
                                    r.semester === params[3]
                            ) || null
                        );
                    }
                };
            }

            if (sql.startsWith('INSERT INTO absences') && sql.includes('ON CONFLICT')) {
                return {
                    run(...params) {
                        const [student_id, student_code, absence_date, month, absence_type, hours, days, reason, school_year, cycle_code = CYCLE] =
                            params;
                        const existing = tables.absences.find(
                            (r) =>
                                r.student_code === student_code &&
                                r.month === month &&
                                r.school_year === school_year &&
                                r.absence_type === absence_type
                        );
                        if (existing) {
                            existing.hours = hours;
                            existing.days = days;
                            return { changes: 1, lastInsertRowid: existing.id };
                        }
                        const row = {
                            id: seq.absences++,
                            student_id,
                            student_code,
                            absence_date,
                            month,
                            absence_type,
                            hours,
                            days,
                            reason,
                            school_year,
                            cycle_code
                        };
                        tables.absences.push(row);
                        return { changes: 1, lastInsertRowid: row.id };
                    }
                };
            }

            if (sql.startsWith('SELECT * FROM "absences" WHERE') || sql.startsWith('SELECT * FROM absences WHERE')) {
                return {
                    get(...params) {
                        // school_year, student_code, month, absence_type
                        return (
                            tables.absences.find(
                                (r) =>
                                    r.school_year === params[0] &&
                                    r.student_code === params[1] &&
                                    r.month === params[2] &&
                                    r.absence_type === params[3]
                            ) || null
                        );
                    }
                };
            }

            if (sql.startsWith('INSERT OR IGNORE INTO sync_id_map') || sql.includes('INSERT OR IGNORE INTO sync_id_map')) {
                return {
                    run(rowSyncId, tableName, localId) {
                        if (!tables.sync_id_map.find((m) => m.row_sync_id === rowSyncId)) {
                            tables.sync_id_map.push({ row_sync_id: rowSyncId, table_name: tableName, local_id: localId });
                        }
                        return { changes: 1 };
                    }
                };
            }

            if (sql.startsWith('INSERT INTO sync_outbox')) {
                return {
                    run(tableName, rowSyncId, operation, rowData, schoolYear) {
                        tables.sync_outbox.push({
                            id: seq.sync_outbox++,
                            table_name: tableName,
                            row_sync_id: rowSyncId,
                            operation,
                            row_data: rowData,
                            school_year: schoolYear,
                            status: 'pending'
                        });
                        return { changes: 1 };
                    }
                };
            }

            if (sql.includes('SELECT COUNT(*)')) {
                return {
                    get() {
                        return { c: tables.students.length };
                    }
                };
            }

            throw new Error('[memory-db] Unhandled SQL: ' + sql);
        }
    };

    return db;
}

function outboxRows(db, table) {
    return db._tables.sync_outbox.filter((r) => r.table_name === table);
}

console.log('[test] exact bulk capture');

assert.strictEqual(CHANNEL_REGISTRY['students:addBulk'].captureMode, 'explicit');
assert.strictEqual(CHANNEL_REGISTRY['grades:saveBulk'].captureMode, 'explicit');
assert.strictEqual(CHANNEL_REGISTRY['absences:saveBulk'].captureMode, 'explicit');
console.log('  [ok] channels marked explicit');

const db = createMemoryDb();
setCaptureGetDb(() => db);

try {
    studentsRepo.addBulk(db, [
        {
            code: 'A1',
            full_name: 'Alice',
            level: 'الأولى باكالوريا',
            school_name: 'ثانوية ابن سينا',
            family_name: 'A',
            birth_date: '2008-01-01',
            gender: 'F',
            section: '1BAC-1',
            school_year: '2025/2026'
        },
        {
            code: 'B2',
            full_name: 'Bob',
            level: 'الأولى باكالوريا',
            school_name: 'ثانوية ابن سينا',
            family_name: 'B',
            birth_date: '2008-02-02',
            gender: 'M',
            section: '1BAC-1',
            school_year: '2025/2026'
        }
    ], CYCLE);
    let rows = outboxRows(db, 'students');
    assert.strictEqual(rows.length, 2, 'two student outbox rows');
    for (const r of rows) {
        assert.strictEqual(r.operation, 'PUT');
        const data = JSON.parse(r.row_data);
        assert.ok(data.id);
        assert.ok(data.code);
        assert.strictEqual(data.level, 'الأولى باكالوريا');
        assert.strictEqual(data.school_name, 'ثانوية ابن سينا');
        assert.ok(!data._bulk, 'must not write bulk summary');
    }
    console.log('  [ok] students addBulk exact rows');

    studentsRepo.addBulk(db, [
        {
            code: 'A1',
            full_name: 'Alice Updated',
            family_name: 'A',
            birth_date: '2008-01-01',
            gender: 'F',
            section: '1BAC-1',
            school_year: '2025/2026'
        }
    ], CYCLE);
    rows = outboxRows(db, 'students');
    assert.strictEqual(rows.length, 3, 'only mutated students captured on re-import');
    assert.strictEqual(db._tables.students.find((student) => student.code === 'A1').level, 'الأولى باكالوريا');
    assert.strictEqual(db._tables.students.find((student) => student.code === 'A1').school_name, 'ثانوية ابن سينا');
    console.log('  [ok] students re-import captures only mutated set');

    gradesRepo.saveBulk(db, [
        {
            student_code: 'A1',
            subject: 'MATH',
            grade: 15,
            semester: 'S1',
            school_year: '2025/2026',
            teacher_name: 'T'
        }
    ], CYCLE);
    rows = outboxRows(db, 'grades');
    assert.strictEqual(rows.length, 1);
    assert.ok(!JSON.parse(rows[0].row_data)._bulk);
    console.log('  [ok] grades saveBulk exact row');

    absencesRepo.saveBulk(db, [
        {
            student_code: 'A1',
            month: '2025-10',
            absence_type: 'unjustified',
            hours: 2,
            days: 0,
            school_year: '2025/2026'
        }
    ], CYCLE);
    rows = outboxRows(db, 'absences');
    assert.strictEqual(rows.length, 1);
    assert.ok(!JSON.parse(rows[0].row_data)._bulk);
    console.log('  [ok] absences saveBulk exact row');

    // captureInputUpserts throws when key missing after mutation
    let threw = false;
    try {
        captureInputUpserts(db, {
            tableName: 'students',
            keyFields: ['school_year', 'code'],
            items: [{ school_year: '2025/2026', code: 'MISSING' }]
        });
    } catch {
        threw = true;
    }
    assert.ok(threw, 'missing key must throw');
    console.log('  [ok] missing post-mutation row fails capture');

    // Atomicity: force capture failure rolls back student inserts
    const db2 = createMemoryDb();
    setCaptureGetDb(() => db2);
    // Break outbox insert
    const origPrepare = db2.prepare.bind(db2);
    db2.prepare = (sql) => {
        if (String(sql).includes('INSERT INTO sync_outbox')) {
            return {
                run() {
                    throw new Error('simulated outbox failure');
                }
            };
        }
        return origPrepare(sql);
    };
    threw = false;
    try {
        studentsRepo.addBulk(db2, [
            {
                code: 'Z9',
                full_name: 'Zed',
                family_name: 'Z',
                birth_date: '2008-01-01',
                gender: 'M',
                section: 'X',
                school_year: '2025/2026'
            }
        ], CYCLE);
    } catch {
        threw = true;
    }
    assert.ok(threw);
    assert.strictEqual(db2._tables.students.length, 0, 'mutation rolled back with capture failure');
    console.log('  [ok] atomic rollback when capture fails');

    // captureDeletesFromRows + deleteBySchoolYearWithCapture helpers
    const {
        captureDeletesFromRows,
        deleteBySchoolYearWithCapture,
        capturePutsByIds
    } = require('../main/sync/capture');
    const db3 = createMemoryDb();
    setCaptureGetDb(() => db3);
    studentsRepo.addBulk(db3, [
        {
            code: 'D1',
            full_name: 'Del',
            family_name: 'D',
            birth_date: '2008-01-01',
            gender: 'F',
            section: 'Y',
            school_year: '2025/2026'
        }
    ], CYCLE);
    // clear prior PUTs for clearer DEL assertion
    db3._tables.sync_outbox.length = 0;
    const deleted = db3.transaction(() => deleteBySchoolYearWithCapture(db3, 'students', '2025/2026'))();
    assert.strictEqual(deleted, 1);
    assert.strictEqual(db3._tables.students.length, 0);
    const delRows = outboxRows(db3, 'students');
    assert.strictEqual(delRows.length, 1);
    assert.strictEqual(delRows[0].operation, 'DEL');
    console.log('  [ok] deleteBySchoolYearWithCapture exact DEL');

    // re-seed and capturePutsByIds
    db3._tables.sync_outbox.length = 0;
    studentsRepo.addBulk(db3, [
        {
            code: 'P1',
            full_name: 'Put',
            family_name: 'P',
            birth_date: '2008-01-01',
            gender: 'M',
            section: 'Z',
            school_year: '2025/2026'
        }
    ], CYCLE);
    db3._tables.sync_outbox.length = 0;
    const id = db3._tables.students[0].id;
    capturePutsByIds(db3, 'students', [id], '2025/2026');
    assert.strictEqual(outboxRows(db3, 'students').length, 1);
    assert.strictEqual(outboxRows(db3, 'students')[0].operation, 'PUT');
    console.log('  [ok] capturePutsByIds');
} finally {
    setCaptureGetDb(null);
}

console.log('[test] exact bulk capture OK');

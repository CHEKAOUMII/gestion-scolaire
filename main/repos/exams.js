'use strict';

/**
 * Exams domain repository (027-layering-remediation).
 * Owns SQL for exams, proctors, rooms, tests, invitations, attendance.
 * IPC stays auth/validation/orchestration.
 *
 * EXAM CENTER INDEPENDENCE CONTRACT (see docs/plans/2026-07-20-exam-center-independence-plan.md)
 *  C1 Independent by default — never require teachers/students rows to function.
 *  C2 Fetch only at the whitelisted import/assign entry points; each copies a snapshot.
 *  C3 No read-time merge — list/read paths are snapshot-only (no JOIN teachers/students).
 *      (Internal joins within the exam domain, e.g. exam_proctors→exams, are allowed.)
 *  C4 No ad-hoc reads of teachers/students in new exam code.
 */

const { resolveTeacherIdentity, teacherIdOrNull } = require('../teachers/identity');
const {
    captureDeletesFromRows,
    captureResolvedRows,
    capturePutsByIds,
    deleteBySchoolYearWithCapture,
    notifyCaptureCommitted
} = require('./capture-port');
const { requireCycle } = require('./student-cycle');

function upsertExamAttendanceRecord(db, rec) {
    const { year, sessionKey, teacherId, name, role, status } = rec;
    const sessionLabel = rec.session_label || null;
    const sessionDate = rec.session_date || null;
    const notes = rec.notes || null;

    if (teacherId) {
        return db
            .prepare(
                `INSERT INTO exam_attendance(school_year, session_key, session_label, session_date,
                    teacher_id, teacher_name, role, status, notes)
                 VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                 ON CONFLICT(school_year, session_key, teacher_id) WHERE teacher_id IS NOT NULL DO UPDATE SET
                    teacher_name = excluded.teacher_name,
                    role = excluded.role,
                    status = excluded.status,
                    notes = excluded.notes,
                    session_label = excluded.session_label,
                    session_date = excluded.session_date,
                    recorded_at = CURRENT_TIMESTAMP`
            )
            .run(year, sessionKey, sessionLabel, sessionDate, teacherId, name, role, status, notes);
    }

    return db
        .prepare(
            `INSERT INTO exam_attendance(school_year, session_key, session_label, session_date,
                teacher_id, teacher_name, role, status, notes)
             VALUES(?, ?, ?, ?, NULL, ?, ?, ?, ?)
             ON CONFLICT(school_year, session_key, teacher_name) WHERE teacher_id IS NULL DO UPDATE SET
                role = excluded.role,
                status = excluded.status,
                notes = excluded.notes,
                session_label = excluded.session_label,
                session_date = excluded.session_date,
                recorded_at = CURRENT_TIMESTAMP`
        )
        .run(year, sessionKey, sessionLabel, sessionDate, name, role, status, notes);
}

function tableHasColumn(db, tableName, columnName) {
    const columns = typeof db.pragma === 'function'
        ? db.pragma(`table_info(${tableName})`)
        : db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
}

function sectionLookupColumns(db) {
    const candidates = ['section_code', 'raw_name', 'code', 'name'];
    return candidates.filter((columnName) => tableHasColumn(db, 'sections', columnName));
}

function assertSectionBelongsToCycle(db, sectionName, cycleCode) {
    const section = String(sectionName || '').trim();
    if (!section) return;
    const sectionsTable = db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'sections'")
        .get();
    const lookupColumns = sectionsTable ? sectionLookupColumns(db) : [];
    if (!sectionsTable || !tableHasColumn(db, 'sections', 'cycle_code') || !lookupColumns.length) {
        throw new Error('لا يمكن حفظ امتحان بقسم قبل تجهيز جدول الأقسام حسب السلك');
    }

    const predicate = lookupColumns.map((columnName) => `${columnName} = ?`).join(' OR ');
    const values = lookupColumns.map(() => section);
    const owner = db
        .prepare(`SELECT cycle_code FROM sections WHERE (${predicate}) AND cycle_code = ? LIMIT 1`)
        .get(...values, cycleCode);
    if (owner) return;
    const knownSection = db.prepare(`SELECT 1 FROM sections WHERE ${predicate} LIMIT 1`).get(...values);
    if (knownSection) throw new Error(`القسم ${section} لا ينتمي إلى السلك التعليمي النشط`);
    throw new Error(`القسم ${section} غير مسجل في الجدول المرجعي`);
}

function resolveExamForCycle(db, examId, year, cycleCode) {
    const safeId = Number(examId);
    if (!Number.isFinite(safeId) || safeId <= 0) throw new Error('exam_id مطلوب وصحيح لهذه العملية');
    const yearClause = year == null ? '' : ' AND school_year = ?';
    const params = year == null ? [safeId, cycleCode] : [safeId, year, cycleCode];
    const exam = db
        .prepare(`SELECT id, title, exam_date, exam_time, school_year, cycle_code FROM exams WHERE id = ?${yearClause} AND cycle_code = ?`)
        .get(...params);
    if (!exam) throw new Error('الامتحان غير موجود في السلك والسنة الدراسيين المحددين');
    return exam;
}

function assertRoomAvailable(db, exam, roomName, excludedProctorId = null) {
    const room = String(roomName || '').trim();
    if (!room || !exam.exam_date || !exam.exam_time) return;
    const conflict = db
        .prepare(
            `SELECT p.id
             FROM exam_proctors p
             INNER JOIN exams e ON e.id = p.exam_id
             WHERE p.room = ? AND e.school_year = ? AND e.exam_date = ? AND e.exam_time = ?
               AND e.id <> ? AND (? IS NULL OR p.id <> ?)
             LIMIT 1`
        )
        .get(room, exam.school_year, exam.exam_date, exam.exam_time, exam.id, excludedProctorId, excludedProctorId);
    if (conflict) throw new Error(`القاعة ${room} محجوزة في التوقيت نفسه عبر سلك آخر`);
}

function assertTeacherAvailable(db, exam, teacherId, excludedProctorId = null) {
    const safeTeacherId = Number(teacherId);
    if (!Number.isFinite(safeTeacherId) || safeTeacherId <= 0
        || !exam.exam_date || !exam.exam_time) return;
    const conflict = db
        .prepare(
            `SELECT p.id
             FROM exam_proctors p
             INNER JOIN exams e ON e.id = p.exam_id
             WHERE p.teacher_id = ? AND e.school_year = ? AND e.exam_date = ? AND e.exam_time = ?
               AND (? IS NULL OR p.id <> ?)
             LIMIT 1`
        )
        .get(safeTeacherId, exam.school_year, exam.exam_date, exam.exam_time, excludedProctorId, excludedProctorId);
    if (conflict) throw new Error(`الأستاذ المرتبط بالمعرف ${safeTeacherId} محجوز في التوقيت نفسه`);
}

function assertExamAssignmentsAvailable(db, exam) {
    const assignments = db
        .prepare('SELECT id, teacher_id, room FROM exam_proctors WHERE exam_id = ?')
        .all(exam.id);
    for (const assignment of assignments) {
        assertRoomAvailable(db, exam, assignment.room, assignment.id);
        assertTeacherAvailable(db, exam, assignment.teacher_id, assignment.id);
    }
}

function listExams(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            'SELECT id, title, section, subject, exam_date, exam_time, school_year, cycle_code, created_at FROM exams WHERE school_year = ? AND cycle_code = ? ORDER BY exam_date, exam_time'
        )
        .all(year, cycle);
}

function saveExam(db, payload, cycleCode) {
    const cycle = requireCycle(cycleCode);
    assertSectionBelongsToCycle(db, payload.section, cycle);
    if (payload.id) {
        const safeId = Number(payload.id);
        if (!Number.isFinite(safeId) || safeId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const existingExam = db
            .prepare('SELECT id, exam_date, exam_time, school_year FROM exams WHERE id = ? AND school_year = ? AND cycle_code = ?')
            .get(safeId, payload.school_year, cycle);
        if (!existingExam) {
            return { success: false, error: 'Record not found or school year mismatch' };
        }
        const nextExam = Object.assign({}, existingExam, {
            exam_date: payload.exam_date || null,
            exam_time: payload.exam_time || null
        });
        if (existingExam.exam_date !== nextExam.exam_date || existingExam.exam_time !== nextExam.exam_time) {
            assertExamAssignmentsAvailable(db, nextExam);
        }
        const result = db
            .prepare(
                `
                    UPDATE exams SET title = ?, section = ?, subject = ?, exam_date = ?, exam_time = ?, school_year = ?
                    WHERE id = ? AND school_year = ? AND cycle_code = ?
                `
            )
            .run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                payload.exam_date || null,
                payload.exam_time || null,
                payload.school_year,
                safeId,
                payload.school_year,
                cycle
            );
        if (result.changes === 0) {
            return { success: false, error: 'Record not found or school year mismatch' };
        }
    } else {
        db.prepare(
            `
                    INSERT INTO exams(title, section, subject, exam_date, exam_time, school_year, cycle_code)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `
        ).run(
            payload.title,
            payload.section || null,
            payload.subject || null,
            payload.exam_date || null,
            payload.exam_time || null,
            payload.school_year,
            cycle
        );
    }
    return { success: true };
}

function deleteExam(db, id, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const examId = Number(id);
    if (!Number.isFinite(examId) || examId <= 0) {
        return { success: false, error: 'Invalid ID' };
    }
    const del = db.transaction(() => {
        const exam = db.prepare('SELECT id FROM exams WHERE id = ? AND cycle_code = ?').get(examId, cycle);
        if (!exam) return 0;
        db.prepare('DELETE FROM exam_proctors WHERE exam_id = ?').run(exam.id);
        return db.prepare('DELETE FROM exams WHERE id = ? AND cycle_code = ?').run(exam.id, cycle).changes;
    });
    const deleted = del();
    return deleted ? { success: true } : { success: false, error: 'Record not found or cycle mismatch' };
}

// [snapshot-only C3] no teachers/students join.
function listProctors(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            `
            SELECT p.*, e.title as exam_title, e.cycle_code
            FROM exam_proctors p
            INNER JOIN exams e ON e.id = p.exam_id
            WHERE e.school_year = ? AND e.cycle_code = ?
            ORDER BY p.id DESC
        `
        )
        .all(year, cycle);
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function saveProctorManual(db, payload, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const exam = resolveExamForCycle(db, payload.exam_id, year, cycle);
    const resolvedTeacher = resolveTeacherIdentity(db, {
        teacher_id: payload.teacher_id,
        teacher_name: payload.teacher_name,
        school_year: year,
        source: 'examProctors:saveManual'
    });
    if (payload.id) {
        const safeId = Number(payload.id);
        if (!Number.isFinite(safeId) || safeId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        assertRoomAvailable(db, exam, payload.room, safeId);
        assertTeacherAvailable(db, exam, resolvedTeacher.teacher_id, safeId);
        const result = db
            .prepare(
                `
                    UPDATE exam_proctors
                    SET exam_id = ?, teacher_id = ?, teacher_name = ?, room = ?, date = ?, session = ?, school_year = ?
                    WHERE id = ? AND school_year = ?
                      AND exam_id IN (SELECT id FROM exams WHERE school_year = ? AND cycle_code = ?)
                `
            )
            .run(
                exam.id,
                resolvedTeacher.teacher_id || null,
                resolvedTeacher.teacher_name || payload.teacher_name || null,
                payload.room || null,
                payload.date || null,
                payload.session || null,
                year,
                safeId,
                year,
                year,
                cycle
            );
        if (result.changes === 0) {
            return { success: false, error: 'Record not found or school year or cycle mismatch' };
        }
        return { success: true, id: safeId };
    }

    assertRoomAvailable(db, exam, payload.room);
    assertTeacherAvailable(db, exam, resolvedTeacher.teacher_id);
    const result = db
        .prepare(
            `
                INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, date, session, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?)
            `
        )
        .run(
            exam.id,
            resolvedTeacher.teacher_id || null,
            resolvedTeacher.teacher_name || payload.teacher_name || null,
            payload.room || null,
            payload.date || null,
            payload.session || null,
            year
        );
    return { success: true, id: Number(result.lastInsertRowid) };
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
// (special case: round-robin generation requires active teachers by design)
function generateProctorsRoundRobin(db, payload, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const exams = db
        .prepare('SELECT id, exam_date, exam_time, school_year FROM exams WHERE school_year = ? AND cycle_code = ? ORDER BY exam_date, id')
        .all(year, cycle);
    const teachers = db
        .prepare('SELECT id, full_name FROM teachers WHERE school_year = ? AND active = 1 ORDER BY id')
        .all(year);

    if (!exams.length || !teachers.length) return { success: false, error: 'Missing exams or teachers' };

    const generate = db.transaction(() => {
        const existing = listProctors(db, year, cycle);
        captureDeletesFromRows(db, 'exam_proctors', existing);
        db.prepare(
            `DELETE FROM exam_proctors
             WHERE school_year = ?
               AND exam_id IN (SELECT id FROM exams WHERE school_year = ? AND cycle_code = ?)`
        ).run(year, year, cycle);
        const insert = db.prepare(`
                    INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, school_year)
                    VALUES(?, ?, ?, ?, ?)
                `);
        for (let i = 0; i < exams.length; i += 1) {
            const teacher = teachers[i % teachers.length];
            const room = payload.default_room || 'Room A';
            assertRoomAvailable(db, exams[i], room);
            assertTeacherAvailable(db, exams[i], teacher.id);
            insert.run(exams[i].id, teacher.id, teacher.full_name, room, year);
        }
        const created = listProctors(db, year, cycle);
        captureResolvedRows(db, 'exam_proctors', created, 'PUT');
    });
    generate();
    notifyCaptureCommitted();
    return { success: true, count: exams.length };
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function bulkImportProctors(db, payload, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const rows = payload.rows;
    if (!Array.isArray(rows) || !rows.length) {
        return { success: false, error: 'No rows to import' };
    }
    let inserted = 0;
    let skipped = 0;
    const insert = db.prepare(`
            INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, teacher_name_fr, cin, som, room, date, session, gender, specialty, workplace, school_year)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
    const bulkInsert = db.transaction(() => {
        const newIds = [];
        for (const row of rows) {
            const name = (row.teacher_name || '').trim();
            if (!name) {
                skipped++;
                continue;
            }
            const exam = resolveExamForCycle(db, row.exam_id, year, cycle);
            assertRoomAvailable(db, exam, row.room);
            const resolved = resolveTeacherIdentity(db, {
                teacher_name: name,
                school_year: year,
                source: 'examProctors:bulkImport'
            });
            assertTeacherAvailable(db, exam, resolved.teacher_id);
            const result = insert.run(
                exam.id,
                resolved.teacher_id || null,
                resolved.teacher_name || name,
                row.teacher_name_fr || null,
                row.cin || null,
                row.som || null,
                row.room || null,
                row.date || null,
                row.session || null,
                row.gender || null,
                row.specialty || null,
                row.workplace || null,
                year
            );
            if (result.lastInsertRowid) newIds.push(result.lastInsertRowid);
            inserted++;
        }
        if (newIds.length) {
            capturePutsByIds(db, 'exam_proctors', newIds, year);
        }
    });
    bulkInsert();
    notifyCaptureCommitted();
    return { success: true, inserted, skipped };
}

function deleteAllProctors(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const deleted = db.transaction(() => {
        const rows = listProctors(db, year, cycle);
        captureDeletesFromRows(db, 'exam_proctors', rows);
        return db
            .prepare(
                `DELETE FROM exam_proctors
                 WHERE school_year = ?
                   AND exam_id IN (SELECT id FROM exams WHERE school_year = ? AND cycle_code = ?)`
            )
            .run(year, year, cycle).changes;
    })();
    if (deleted) notifyCaptureCommitted();
    return { success: true, deleted };
}

function deleteProctor(db, id, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const proctorId = Number(id);
    if (!Number.isFinite(proctorId) || proctorId <= 0) {
        return { success: false, error: 'Invalid ID' };
    }
    const deleted = db
        .prepare(
            `DELETE FROM exam_proctors
             WHERE id = ?
               AND exam_id IN (SELECT id FROM exams WHERE cycle_code = ?)`
        )
        .run(proctorId, cycle).changes;
    return deleted ? { success: true } : { success: false, error: 'Record not found or cycle mismatch' };
}

// [snapshot-only C3] no teachers/students join.
function listRooms(db, year) {
    return db
        .prepare(
            'SELECT id, room_name, capacity, equipment, school_year, created_at FROM exam_rooms WHERE school_year = ? ORDER BY room_name'
        )
        .all(year);
}

function saveRoom(db, payload, year) {
    if (payload.id) {
        const safeId = Number(payload.id);
        if (!Number.isFinite(safeId) || safeId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const result = db
            .prepare(
                'UPDATE exam_rooms SET room_name = ?, capacity = ?, equipment = ?, school_year = ? WHERE id = ? AND school_year = ?'
            )
            .run(payload.room_name, payload.capacity || 0, payload.equipment || null, year, safeId, year);
        if (result.changes === 0) {
            return { success: false, error: 'Record not found or school year mismatch' };
        }
    } else {
        db.prepare('INSERT INTO exam_rooms (room_name, capacity, equipment, school_year) VALUES (?, ?, ?, ?)').run(
            payload.room_name,
            payload.capacity || 0,
            payload.equipment || null,
            year
        );
    }
    return { success: true };
}

function deleteRoom(db, id) {
    const roomId = Number(id);
    if (!Number.isFinite(roomId) || roomId <= 0) {
        return { success: false, error: 'Invalid ID' };
    }
    db.prepare('DELETE FROM exam_rooms WHERE id = ?').run(roomId);
    return { success: true };
}

// [snapshot-only C3] no teachers/students join.
function listTests(db, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    return db
        .prepare(
            'SELECT id, title, section, subject, teacher_id, teacher_name, status, test_date, school_year, cycle_code, created_at FROM tests WHERE school_year = ? AND cycle_code = ? ORDER BY test_date, id'
        )
        .all(year, cycle);
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function saveTest(db, payload, year, cycleCode) {
    const cycle = requireCycle(cycleCode);
    assertSectionBelongsToCycle(db, payload.section, cycle);
    const resolvedTeacher = resolveTeacherIdentity(db, {
        teacher_id: payload.teacher_id,
        teacher_name: payload.teacher_name,
        school_year: year,
        source: 'tests:save'
    });
    if (payload.id) {
        const safeId = Number(payload.id);
        if (!Number.isFinite(safeId) || safeId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const result = db
            .prepare(
                `
                    UPDATE tests SET title = ?, section = ?, subject = ?, teacher_id = ?, teacher_name = ?, status = ?, test_date = ?, school_year = ?
                    WHERE id = ? AND school_year = ? AND cycle_code = ?
                `
            )
            .run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                resolvedTeacher.teacher_id || null,
                resolvedTeacher.teacher_name || payload.teacher_name || null,
                payload.status || 'planned',
                payload.test_date || null,
                year,
                safeId,
                year,
                cycle
            );
        if (result.changes === 0) {
            return { success: false, error: 'Record not found or school year mismatch' };
        }
    } else {
        db.prepare(
            `
                    INSERT INTO tests(title, section, subject, teacher_id, teacher_name, status, test_date, school_year, cycle_code)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
        ).run(
            payload.title,
            payload.section || null,
            payload.subject || null,
            resolvedTeacher.teacher_id || null,
            resolvedTeacher.teacher_name || payload.teacher_name || null,
            payload.status || 'planned',
            payload.test_date || null,
            year,
            cycle
        );
    }
    return { success: true };
}

function deleteTest(db, id, cycleCode) {
    const cycle = requireCycle(cycleCode);
    const testId = Number(id);
    if (!Number.isFinite(testId) || testId <= 0) {
        return { success: false, error: 'Invalid ID' };
    }
    const deleted = db.prepare('DELETE FROM tests WHERE id = ? AND cycle_code = ?').run(testId, cycle).changes;
    return deleted ? { success: true } : { success: false, error: 'Record not found or cycle mismatch' };
}

// [snapshot-only C3] no teachers/students join.
function listInvitations(db, year) {
    return db
        .prepare(
            'SELECT id, school_year, teacher_id, teacher_name, sent_at, notes, created_at FROM exam_invitations WHERE school_year = ? ORDER BY id DESC'
        )
        .all(year);
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function upsertInvitation(db, payload, year) {
    const name = String(payload.teacher_name || '').trim();
    if (!name) return { success: false, error: 'teacher_name required' };
    const teacherId = teacherIdOrNull(db, payload.teacher_id);
    let result;
    if (teacherId) {
        result = db
            .prepare(
                `INSERT INTO exam_invitations(school_year, teacher_id, teacher_name, sent_at, notes)
                     VALUES(?, ?, ?, ?, ?)
                     ON CONFLICT(school_year, teacher_id) WHERE teacher_id IS NOT NULL DO UPDATE SET
                        teacher_name = excluded.teacher_name,
                        sent_at = excluded.sent_at,
                        notes = excluded.notes`
            )
            .run(year, teacherId, name, payload.sent_at || null, payload.notes || null);
    } else {
        result = db
            .prepare(
                `INSERT INTO exam_invitations(school_year, teacher_id, teacher_name, sent_at, notes)
                     VALUES(?, NULL, ?, ?, ?)
                     ON CONFLICT(school_year, teacher_name) WHERE teacher_id IS NULL DO UPDATE SET
                        sent_at = excluded.sent_at,
                        notes = excluded.notes`
            )
            .run(year, name, payload.sent_at || null, payload.notes || null);
    }
    return { success: true, id: Number(result.lastInsertRowid) };
}

function deleteInvitation(db, id) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return { success: false, error: 'Invalid ID' };
    db.prepare('DELETE FROM exam_invitations WHERE id = ?').run(safeId);
    return { success: true };
}

function deleteAllInvitations(db, year) {
    const deleted = db.transaction((y) => deleteBySchoolYearWithCapture(db, 'exam_invitations', y))(year);
    notifyCaptureCommitted();
    return { success: true, deleted };
}

// [snapshot-only C3] no teachers/students join.
function listAttendance(db, year) {
    return db
        .prepare(
            'SELECT id, school_year, session_key, session_label, session_date, teacher_id, teacher_name, role, status, notes, recorded_at FROM exam_attendance WHERE school_year = ? ORDER BY session_date, session_key, teacher_name'
        )
        .all(year);
}

// [snapshot-only C3] no teachers/students join.
function listAttendanceBySession(db, year, sessionKey) {
    return db
        .prepare(
            'SELECT id, school_year, session_key, session_label, session_date, teacher_id, teacher_name, role, status, notes, recorded_at FROM exam_attendance WHERE school_year = ? AND session_key = ? ORDER BY teacher_name'
        )
        .all(year, String(sessionKey || ''));
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function upsertAttendance(db, payload, year) {
    const name = String(payload.teacher_name || '').trim();
    const sessionKey = String(payload.session_key || '').trim();
    if (!name || !sessionKey) return { success: false, error: 'teacher_name and session_key required' };
    const status = ['present', 'absent', 'late', 'excused'].includes(payload.status) ? payload.status : 'present';
    const role = ['proctor', 'reserve', 'duty'].includes(payload.role) ? payload.role : 'proctor';
    const result = upsertExamAttendanceRecord(db, {
        year,
        sessionKey,
        teacherId: teacherIdOrNull(db, payload.teacher_id),
        name,
        role,
        status,
        session_label: payload.session_label,
        session_date: payload.session_date,
        notes: payload.notes
    });
    return { success: true, id: Number(result.lastInsertRowid) };
}

function deleteAttendance(db, id) {
    const safeId = Number(id);
    if (!Number.isFinite(safeId) || safeId <= 0) return { success: false, error: 'Invalid ID' };
    db.prepare('DELETE FROM exam_attendance WHERE id = ?').run(safeId);
    return { success: true };
}

// [fetch-whitelist C2] reads teachers → snapshot; tolerates NULL teacher_id
function bulkUpsertAttendance(db, payload, year) {
    const records = payload.records;
    if (!Array.isArray(records) || !records.length) {
        return { success: false, error: 'No records to upsert' };
    }
    const selectByTeacherId = db.prepare(
        `SELECT * FROM exam_attendance
             WHERE school_year = ? AND session_key = ? AND teacher_id = ?`
    );
    const selectByName = db.prepare(
        `SELECT * FROM exam_attendance
             WHERE school_year = ? AND session_key = ? AND teacher_name = ? AND teacher_id IS NULL`
    );
    const run = db.transaction((recs) => {
        let count = 0;
        const resolved = [];
        for (const r of recs) {
            const name = String(r.teacher_name || '').trim();
            const sessionKey = String(r.session_key || '').trim();
            if (!name || !sessionKey) continue;
            const status = ['present', 'absent', 'late', 'excused'].includes(r.status) ? r.status : 'present';
            const role = ['proctor', 'reserve', 'duty'].includes(r.role) ? r.role : 'proctor';
            const teacherId = teacherIdOrNull(db, r.teacher_id);
            upsertExamAttendanceRecord(db, {
                year,
                sessionKey,
                teacherId,
                name,
                role,
                status,
                session_label: r.session_label,
                session_date: r.session_date,
                notes: r.notes
            });
            const row = teacherId
                ? selectByTeacherId.get(year, sessionKey, teacherId)
                : selectByName.get(year, sessionKey, name);
            if (row) resolved.push(row);
            count++;
        }
        if (resolved.length) {
            captureResolvedRows(db, 'exam_attendance', resolved, 'PUT');
        }
        return count;
    });
    const count = run(records);
    notifyCaptureCommitted();
    return { success: true, count };
}

function deleteAllAttendance(db, year) {
    const deleted = db.transaction((y) => deleteBySchoolYearWithCapture(db, 'exam_attendance', y))(year);
    notifyCaptureCommitted();
    return { success: true, deleted };
}

module.exports = {
    listExams,
    saveExam,
    deleteExam,
    listProctors,
    saveProctorManual,
    generateProctorsRoundRobin,
    bulkImportProctors,
    deleteAllProctors,
    deleteProctor,
    listRooms,
    saveRoom,
    deleteRoom,
    listTests,
    saveTest,
    deleteTest,
    listInvitations,
    upsertInvitation,
    deleteInvitation,
    deleteAllInvitations,
    listAttendance,
    listAttendanceBySession,
    upsertAttendance,
    deleteAttendance,
    bulkUpsertAttendance,
    deleteAllAttendance
};

const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { resolveTeacherIdentity, teacherIdOrNull } = require('../teachers/identity');
const { requireFields, validateDate } = require('./validation');

// R7 — exam_attendance uniqueness is now teacher_id-scoped (with a teacher_name
// fallback only when teacher_id IS NULL), matching the partial unique indexes added
// in migration 065. Shared by examAttendance:upsert and :bulkUpsert so both honour the
// same conflict targets.
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

function registerExamsIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'exams:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT id, title, section, subject, exam_date, exam_time, school_year, created_at FROM exams WHERE school_year = ? ORDER BY exam_date, exam_time')
            .all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'exams:save', WRITE_ROLES, (db, _event, payload) => {
        requireFields(payload, ['title', 'school_year']);
        requireSchoolYear(payload.school_year);
        if (payload.exam_date) {
            validateDate('exam_date', payload.exam_date);
        }
        if (payload.id) {
            const safeId = Number(payload.id);
            if (!Number.isFinite(safeId) || safeId <= 0) {
                return { success: false, error: 'Invalid ID' };
            }
            const result = db
                .prepare(
                    `
                    UPDATE exams SET title = ?, section = ?, subject = ?, exam_date = ?, exam_time = ?, school_year = ?
                    WHERE id = ? AND school_year = ?
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
                    payload.school_year
                );
            if (result.changes === 0) {
                return { success: false, error: 'Record not found or school year mismatch' };
            }
        } else {
            db.prepare(
                `
                    INSERT INTO exams(title, section, subject, exam_date, exam_time, school_year)
                    VALUES(?, ?, ?, ?, ?, ?)
                `
            ).run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                payload.exam_date || null,
                payload.exam_time || null,
                payload.school_year
            );
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'exams:delete', WRITE_ROLES, (db, _event, id) => {
        const examId = Number(id);
        if (!Number.isFinite(examId) || examId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const del = db.transaction(() => {
            db.prepare('DELETE FROM exam_proctors WHERE exam_id = ?').run(examId);
            db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
        });
        del();
        return { success: true };
    });

    // ── Exam proctors (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'examProctors:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT p.*, e.title as exam_title, t.full_name as teacher_full_name
            FROM exam_proctors p
            LEFT JOIN exams e ON e.id = p.exam_id
            LEFT JOIN teachers t ON t.id = p.teacher_id
            WHERE p.school_year = ?
            ORDER BY p.id DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examProctors:saveManual', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        if (payload.date) {
            validateDate('date', payload.date);
        }
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
            const result = db
                .prepare(
                    `
                    UPDATE exam_proctors
                    SET exam_id = ?, teacher_id = ?, teacher_name = ?, room = ?, date = ?, session = ?, school_year = ?
                    WHERE id = ? AND school_year = ?
                `
                )
                .run(
                    payload.exam_id || null,
                    resolvedTeacher.teacher_id || null,
                    resolvedTeacher.teacher_name || payload.teacher_name || null,
                    payload.room || null,
                    payload.date || null,
                    payload.session || null,
                    year,
                    safeId,
                    year
                );
            if (result.changes === 0) {
                return { success: false, error: 'Record not found or school year mismatch' };
            }
            return { success: true, id: safeId };
        }

        const result = db
            .prepare(
                `
                INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, date, session, school_year)
                VALUES(?, ?, ?, ?, ?, ?, ?)
            `
            )
            .run(
                payload.exam_id || null,
                resolvedTeacher.teacher_id || null,
                resolvedTeacher.teacher_name || payload.teacher_name || null,
                payload.room || null,
                payload.date || null,
                payload.session || null,
                year
            );
        return { success: true, id: Number(result.lastInsertRowid) };
    });

    handleWrite(ipcMain, 'examProctors:generateRoundRobin', ['admin'], (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const exams = db.prepare('SELECT id FROM exams WHERE school_year = ? ORDER BY exam_date, id').all(year);
        const teachers = db
            .prepare('SELECT id, full_name FROM teachers WHERE school_year = ? AND active = 1 ORDER BY id')
            .all(year);

        if (!exams.length || !teachers.length) return { success: false, error: 'Missing exams or teachers' };

        const generate = db.transaction(() => {
            db.prepare('DELETE FROM exam_proctors WHERE school_year = ?').run(year);
            const insert = db.prepare(`
                    INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, school_year)
                    VALUES(?, ?, ?, ?, ?)
                `);
            for (let i = 0; i < exams.length; i += 1) {
                const teacher = teachers[i % teachers.length];
                insert.run(exams[i].id, teacher.id, teacher.full_name, payload.default_room || 'Room A', year);
            }
        });
        generate();
        return { success: true, count: exams.length };
    });

    handleWrite(ipcMain, 'examProctors:bulkImport', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
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
            for (const row of rows) {
                const name = (row.teacher_name || '').trim();
                if (!name) { skipped++; continue; }
                const resolved = resolveTeacherIdentity(db, {
                    teacher_name: name,
                    school_year: year,
                    source: 'examProctors:bulkImport'
                });
                insert.run(
                    row.exam_id || null,
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
                inserted++;
            }
        });
        bulkInsert();
        return { success: true, inserted, skipped };
    });

    handleWrite(ipcMain, 'examProctors:deleteAll', ['admin'], (db, _event, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const result = db.prepare('DELETE FROM exam_proctors WHERE school_year = ?').run(year);
        return { success: true, deleted: result.changes };
    });

    handleWrite(ipcMain, 'examProctors:delete', WRITE_ROLES, (db, _event, id) => {
        const proctorId = Number(id);
        if (!Number.isFinite(proctorId) || proctorId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM exam_proctors WHERE id = ?').run(proctorId);
        return { success: true };
    });

    // ── Exam rooms (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'examRooms:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT id, room_name, capacity, equipment, school_year, created_at FROM exam_rooms WHERE school_year = ? ORDER BY room_name')
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examRooms:save', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
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
    });

    handleWrite(ipcMain, 'examRooms:delete', ['admin'], (db, _event, id) => {
        const roomId = Number(id);
        if (!Number.isFinite(roomId) || roomId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM exam_rooms WHERE id = ?').run(roomId);
        return { success: true };
    });

    // ── Tests (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'tests:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT id, title, section, subject, teacher_id, teacher_name, status, test_date, school_year, created_at FROM tests WHERE school_year = ? ORDER BY test_date, id')
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'tests:save', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
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
                    WHERE id = ? AND school_year = ?
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
                    year
                );
            if (result.changes === 0) {
                return { success: false, error: 'Record not found or school year mismatch' };
            }
        } else {
            db.prepare(
                `
                    INSERT INTO tests(title, section, subject, teacher_id, teacher_name, status, test_date, school_year)
                    VALUES(?, ?, ?, ?, ?, ?, ?, ?)
                `
            ).run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                resolvedTeacher.teacher_id || null,
                resolvedTeacher.teacher_name || payload.teacher_name || null,
                payload.status || 'planned',
                payload.test_date || null,
                year
            );
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'tests:delete', WRITE_ROLES, (db, _event, id) => {
        const testId = Number(id);
        if (!Number.isFinite(testId) || testId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM tests WHERE id = ?').run(testId);
        return { success: true };
    });

    // ── Exam invitations (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'examInvitations:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT id, school_year, teacher_id, teacher_name, sent_at, notes, created_at FROM exam_invitations WHERE school_year = ? ORDER BY id DESC')
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examInvitations:upsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const name = String(payload.teacher_name || '').trim();
        if (!name) return { success: false, error: 'teacher_name required' };
        // R7: dedup by teacher_id when we can resolve one (a rename no longer forks the
        // row, and two same-name teachers no longer collide); fall back to teacher_name
        // only for id-less rows. teacherIdOrNull keeps the teacher_id FK satisfied.
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
    });

    handleWrite(ipcMain, 'examInvitations:delete', WRITE_ROLES, (db, _event, id) => {
        const safeId = Number(id);
        if (!Number.isFinite(safeId) || safeId <= 0) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM exam_invitations WHERE id = ?').run(safeId);
        return { success: true };
    });

    handleWrite(ipcMain, 'examInvitations:deleteAll', ['admin'], (db, _event, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const result = db.prepare('DELETE FROM exam_invitations WHERE school_year = ?').run(year);
        return { success: true, deleted: result.changes };
    });

    // ── Exam attendance (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'examAttendance:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT id, school_year, session_key, session_label, session_date, teacher_id, teacher_name, role, status, notes, recorded_at FROM exam_attendance WHERE school_year = ? ORDER BY session_date, session_key, teacher_name')
            .all(normalizeYear(schoolYear));
    });

    handleRead(ipcMain, 'examAttendance:getBySession', (db, schoolYear, sessionKey) => {
        return db
            .prepare('SELECT id, school_year, session_key, session_label, session_date, teacher_id, teacher_name, role, status, notes, recorded_at FROM exam_attendance WHERE school_year = ? AND session_key = ? ORDER BY teacher_name')
            .all(normalizeYear(schoolYear), String(sessionKey || ''));
    });

    handleWrite(ipcMain, 'examAttendance:upsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
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
    });

    handleWrite(ipcMain, 'examAttendance:delete', WRITE_ROLES, (db, _event, id) => {
        const safeId = Number(id);
        if (!Number.isFinite(safeId) || safeId <= 0) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM exam_attendance WHERE id = ?').run(safeId);
        return { success: true };
    });

    handleWrite(ipcMain, 'examAttendance:bulkUpsert', WRITE_ROLES, (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const records = payload.records;
        if (!Array.isArray(records) || !records.length) {
            return { success: false, error: 'No records to upsert' };
        }
        const run = db.transaction((recs) => {
            let count = 0;
            for (const r of recs) {
                const name = String(r.teacher_name || '').trim();
                const sessionKey = String(r.session_key || '').trim();
                if (!name || !sessionKey) continue;
                const status = ['present', 'absent', 'late', 'excused'].includes(r.status) ? r.status : 'present';
                const role = ['proctor', 'reserve', 'duty'].includes(r.role) ? r.role : 'proctor';
                upsertExamAttendanceRecord(db, {
                    year,
                    sessionKey,
                    teacherId: teacherIdOrNull(db, r.teacher_id),
                    name,
                    role,
                    status,
                    session_label: r.session_label,
                    session_date: r.session_date,
                    notes: r.notes
                });
                count++;
            }
            return count;
        });
        const count = run(records);
        return { success: true, count };
    });

    handleWrite(ipcMain, 'examAttendance:deleteAll', ['admin'], (db, _event, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const result = db.prepare('DELETE FROM exam_attendance WHERE school_year = ?').run(year);
        return { success: true, deleted: result.changes };
    });
}

module.exports = { registerExamsIpc };

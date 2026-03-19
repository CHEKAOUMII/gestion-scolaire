const { handleRead, handleWrite, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { resolveTeacherIdentity } = require('../teachers/identity');
const { requireFields, validateDate } = require('./validation');

function registerExamsIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'exams:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM exams WHERE school_year = ? ORDER BY exam_date, exam_time')
            .all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'exams:save', ['admin', 'staff'], (db, _event, payload) => {
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

    handleWrite(ipcMain, 'exams:delete', ['admin', 'staff'], (db, _event, id) => {
        const examId = Number(id);
        if (!Number.isFinite(examId) || examId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM exams WHERE id = ?').run(examId);
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

    handleWrite(ipcMain, 'examProctors:saveManual', ['admin', 'staff'], (db, _event, payload) => {
        const year = requireSchoolYear(payload.school_year);
        const resolvedTeacher = resolveTeacherIdentity(db, {
            teacher_id: payload.teacher_id,
            teacher_name: payload.teacher_name,
            school_year: year,
            source: 'examProctors:saveManual'
        });
        db.prepare(
            `
                INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, school_year)
                VALUES(?, ?, ?, ?, ?)
            `
        ).run(
            payload.exam_id || null,
            resolvedTeacher.teacher_id || null,
            resolvedTeacher.teacher_name || payload.teacher_name || null,
            payload.room || null,
            year
        );
        return { success: true };
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

    handleWrite(ipcMain, 'examProctors:delete', ['admin', 'staff'], (db, _event, id) => {
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
            .prepare('SELECT * FROM exam_rooms WHERE school_year = ? ORDER BY room_name')
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examRooms:save', ['admin', 'staff'], (db, _event, payload) => {
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
                .run(
                    payload.room_name,
                    payload.capacity || 0,
                    payload.equipment || null,
                    year,
                    safeId,
                    year
                );
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

    // Timetable compatibility endpoints (database-backed timetable is not implemented yet)
    ipcMain.handle('timetable:getByTeacher', async () => []);
    ipcMain.handle('timetable:getByRoom', async () => []);
    ipcMain.handle('timetable:getByClass', async () => []);

    // ── Tests (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'tests:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM tests WHERE school_year = ? ORDER BY test_date, id')
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'tests:save', ['admin', 'staff'], (db, _event, payload) => {
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

    handleWrite(ipcMain, 'tests:delete', ['admin', 'staff'], (db, _event, id) => {
        const testId = Number(id);
        if (!Number.isFinite(testId) || testId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM tests WHERE id = ?').run(testId);
        return { success: true };
    });
}

module.exports = { registerExamsIpc };

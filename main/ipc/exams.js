const { handleRead, handleWrite, normalizeYear } = require('./ipc-helpers');

function registerExamsIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'exams:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM exams WHERE school_year = ? ORDER BY exam_date, exam_time').all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'exams:save', ['admin', 'staff'], (db, _event, payload) => {
        if (payload.id) {
            db.prepare(
                `
                    UPDATE exams SET title = ?, section = ?, subject = ?, exam_date = ?, exam_time = ?, school_year = ?
                    WHERE id = ?
                `
            ).run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                payload.exam_date || null,
                payload.exam_time || null,
                payload.school_year,
                payload.id
            );
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
        db.prepare('DELETE FROM exams WHERE id = ?').run(id);
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
        db.prepare(
            `
                INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, school_year)
                VALUES(?, ?, ?, ?, ?)
            `
        ).run(
            payload.exam_id || null,
            payload.teacher_id || null,
            payload.teacher_name || null,
            payload.room || null,
            payload.school_year
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'examProctors:generateRoundRobin', ['admin'], (db, _event, payload) => {
        const year = normalizeYear(payload.school_year);
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
        db.prepare('DELETE FROM exam_proctors WHERE id = ?').run(id);
        return { success: true };
    });

    handleRead(ipcMain, 'proctors:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT id, teacher_name as teacher, room, date, session
            FROM exam_proctors
            WHERE school_year = ?
            ORDER BY id DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'proctors:save', ['admin', 'staff'], (db, _event, payload) => {
        const year = normalizeYear(payload.school_year);
        if (payload.id) {
            db.prepare(
                `
                    UPDATE exam_proctors
                    SET teacher_name = ?, room = ?, date = ?, session = ?, school_year = ?
                    WHERE id = ?
                `
            ).run(
                payload.teacher || null,
                payload.room || null,
                payload.date || null,
                payload.session || null,
                year,
                payload.id
            );
        } else {
            db.prepare(
                `
                    INSERT INTO exam_proctors(exam_id, teacher_id, teacher_name, room, school_year, date, session)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `
            ).run(
                null,
                null,
                payload.teacher || null,
                payload.room || null,
                year,
                payload.date || null,
                payload.session || null
            );
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'proctors:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM exam_proctors WHERE id = ?').run(id);
        return { success: true };
    });

    // ── Exam rooms (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'examRooms:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM exam_rooms WHERE school_year = ? ORDER BY room_name').all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'examRooms:save', ['admin', 'staff'], (db, _event, payload) => {
        if (payload.id) {
            db.prepare(
                'UPDATE exam_rooms SET room_name = ?, capacity = ?, equipment = ?, school_year = ? WHERE id = ?'
            ).run(
                payload.room_name,
                payload.capacity || 0,
                payload.equipment || null,
                payload.school_year,
                payload.id
            );
        } else {
            db.prepare(
                'INSERT INTO exam_rooms (room_name, capacity, equipment, school_year) VALUES (?, ?, ?, ?)'
            ).run(payload.room_name, payload.capacity || 0, payload.equipment || null, payload.school_year);
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'examRooms:delete', ['admin'], (db, _event, id) => {
        db.prepare('DELETE FROM exam_rooms WHERE id = ?').run(id);
        return { success: true };
    });

    handleRead(ipcMain, 'rooms:getAll', (db, schoolYear) => {
        const rows = db
            .prepare(
                'SELECT id, room_name, capacity, equipment FROM exam_rooms WHERE school_year = ? ORDER BY room_name'
            )
            .all(normalizeYear(schoolYear));
        return rows.map((r) => ({ ...r, name: r.room_name }));
    });

    handleWrite(ipcMain, 'rooms:save', ['admin', 'staff'], (db, _event, payload) => {
        const year = normalizeYear(payload.school_year);
        if (payload.id) {
            db.prepare(
                'UPDATE exam_rooms SET room_name = ?, capacity = ?, equipment = ?, school_year = ? WHERE id = ?'
            ).run(
                payload.name || payload.room_name,
                payload.capacity || 0,
                payload.equipment || null,
                year,
                payload.id
            );
        } else {
            db.prepare(
                'INSERT INTO exam_rooms (room_name, capacity, equipment, school_year) VALUES (?, ?, ?, ?)'
            ).run(payload.name || payload.room_name, payload.capacity || 0, payload.equipment || null, year);
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'rooms:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM exam_rooms WHERE id = ?').run(id);
        return { success: true };
    });

    // Timetable compatibility endpoints (database-backed timetable is not implemented yet)
    ipcMain.handle('timetable:getByTeacher', async () => []);
    ipcMain.handle('timetable:getByRoom', async () => []);
    ipcMain.handle('timetable:getByClass', async () => []);

    // ── Tests (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'tests:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM tests WHERE school_year = ? ORDER BY test_date, id').all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'tests:save', ['admin', 'staff'], (db, _event, payload) => {
        if (payload.id) {
            db.prepare(
                `
                    UPDATE tests SET title = ?, section = ?, subject = ?, teacher_name = ?, status = ?, test_date = ?, school_year = ?
                    WHERE id = ?
                `
            ).run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                payload.teacher_name || null,
                payload.status || 'planned',
                payload.test_date || null,
                payload.school_year,
                payload.id
            );
        } else {
            db.prepare(
                `
                    INSERT INTO tests(title, section, subject, teacher_name, status, test_date, school_year)
                    VALUES(?, ?, ?, ?, ?, ?, ?)
                `
            ).run(
                payload.title,
                payload.section || null,
                payload.subject || null,
                payload.teacher_name || null,
                payload.status || 'planned',
                payload.test_date || null,
                payload.school_year
            );
        }
        return { success: true };
    });

    handleWrite(ipcMain, 'tests:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM tests WHERE id = ?').run(id);
        return { success: true };
    });
}

module.exports = { registerExamsIpc };

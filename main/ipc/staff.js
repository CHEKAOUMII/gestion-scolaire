const { handleRead, handleWrite, normalizeYear } = require('./ipc-helpers');
const { requireFields, validateDate } = require('./validation');

function registerStaffIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'teachers:getAll', (db, schoolYear) => {
        return db.prepare('SELECT * FROM teachers WHERE school_year = ? ORDER BY full_name').all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'teachers:add', ['admin', 'staff'], (db, _event, teacher) => {
        requireFields(teacher, ['full_name', 'school_year']);
        db.prepare(
            `
                INSERT INTO teachers(full_name, subject, phone, email, school_year, active)
                VALUES(?, ?, ?, ?, ?, ?)
            `
        ).run(
            teacher.full_name,
            teacher.subject || null,
            teacher.phone || null,
            teacher.email || null,
            teacher.school_year,
            teacher.active == null ? 1 : teacher.active ? 1 : 0
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:update', ['admin', 'staff'], (db, _event, id, data) => {
        const teacherId = Number(id);
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const ALLOWED_COLUMNS = new Set(['full_name', 'subject', 'phone', 'email', 'school_year', 'active']);
        const safeEntries = Object.entries(data).filter(([k]) => ALLOWED_COLUMNS.has(k));
        if (!safeEntries.length) {
            return { success: false, error: 'No valid fields to update' };
        }
        const fields = safeEntries.map(([k]) => `${k} = ?`).join(', ');
        const values = [...safeEntries.map(([, v]) => v), teacherId];
        db.prepare(`UPDATE teachers SET ${fields} WHERE id = ?`).run(...values);
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:delete', ['admin'], (db, _event, id) => {
        const teacherId = Number(id);
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherId);
        return { success: true };
    });

    // ── Teacher absences (read = open, write = admin/staff) ──

    handleRead(ipcMain, 'teacherAbsences:getAll', (db, schoolYear) => {
        return db
            .prepare(
                `
            SELECT a.*, t.full_name
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.school_year = ?
            ORDER BY a.absence_date DESC
        `
            )
            .all(normalizeYear(schoolYear));
    });

    handleWrite(ipcMain, 'teacherAbsences:save', ['admin', 'staff'], (db, _event, payload) => {
        if (payload.absence_date) {
            validateDate('absence_date', payload.absence_date);
        }
        db.prepare(
            `
                INSERT INTO teacher_absences(teacher_id, absence_date, reason, replacement_teacher, school_year)
                VALUES(?, ?, ?, ?, ?)
            `
        ).run(
            payload.teacher_id,
            payload.absence_date,
            payload.reason || null,
            payload.replacement_teacher || null,
            payload.school_year
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teacherAbsences:delete', ['admin', 'staff'], (db, _event, id) => {
        const absenceId = Number(id);
        if (!Number.isFinite(absenceId) || absenceId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(absenceId);
        return { success: true };
    });

    // ── Daily report aggregate (read = open) ──

    handleRead(ipcMain, 'dailyReport:getData', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);

        // 1. Teacher absences from teacher_absences table (legacy)
        const absences = db.prepare(`
            SELECT a.*, t.full_name, t.subject
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.absence_date = ? AND a.school_year = ?
            ORDER BY t.full_name
        `).all(date, year);

        // 1b. Staff attendance records for the given date (new table)
        const staffRecords = db.prepare(`
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.attendance_date = ? AND sa.school_year = ?
            ORDER BY sa.type, COALESCE(t.full_name, sa.teacher_name)
        `).all(date, year);

        // Fill in missing subjects from grades table
        const recordsNeedingSubject = staffRecords.filter(r => !r.subject && (r.full_name || r.teacher_name));
        if (recordsNeedingSubject.length > 0) {
            const gradeSubjects = {};
            try {
                const gs = db.prepare(`
                    SELECT teacher_name, GROUP_CONCAT(DISTINCT subject) as subject
                    FROM grades WHERE school_year = ?
                      AND teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''
                    GROUP BY teacher_name
                `).all(year);
                gs.forEach(g => { gradeSubjects[g.teacher_name] = g.subject; });
            } catch (_e) { /* ignore */ }
            for (const r of recordsNeedingSubject) {
                r.subject = gradeSubjects[r.full_name] || gradeSubjects[r.teacher_name] || '';
            }
        }

        // Separate into absences and tardiness
        const staffAbsences = staffRecords.filter(r => r.type === 'absence');
        const staffTardiness = staffRecords.filter(r => r.type === 'late');

        // 2. Teacher → sections mapping (derived from grades)
        const teacherSectionRows = db.prepare(`
            SELECT DISTINCT teacher_name, section
            FROM grades
            WHERE school_year = ?
              AND teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''
              AND section IS NOT NULL AND TRIM(section) <> ''
        `).all(year);

        const teacherSections = {};
        for (const row of teacherSectionRows) {
            if (!teacherSections[row.teacher_name]) {
                teacherSections[row.teacher_name] = [];
            }
            teacherSections[row.teacher_name].push(row.section);
        }

        // 3. Student counts per section
        const sectionRows = db.prepare(`
            SELECT section, COUNT(*) as count
            FROM students
            WHERE school_year = ? AND status = 'active'
              AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `).all(year);

        const sectionStudentCounts = {};
        for (const row of sectionRows) {
            sectionStudentCounts[row.section] = row.count;
        }

        // 4. All sections list
        const allSections = sectionRows.map(r => r.section);

        // 5. Affected sections — combine legacy absences + new staff absences
        const affectedSections = {};
        const allAbsenceRecords = [...absences, ...staffAbsences];
        for (const absence of allAbsenceRecords) {
            const name = absence.full_name;
            if (name && teacherSections[name] && !affectedSections[name]) {
                affectedSections[name] = teacherSections[name];
            }
        }

        return {
            absences,
            staffAbsences,
            staffTardiness,
            teacherSections,
            sectionStudentCounts,
            allSections,
            affectedSections
        };
    });
}

module.exports = { registerStaffIpc };

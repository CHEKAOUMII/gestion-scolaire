const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear } = require('./ipc-helpers');
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
                INSERT INTO teachers(ppr, cin, full_name, full_name_fr, subject, gender, birth_date, birth_place,
                    phone, email, address, grade, cadre, echelon, hire_date, marital_status, function_title,
                    source, school_year, active)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
        ).run(
            teacher.ppr || null,
            teacher.cin || null,
            teacher.full_name,
            teacher.full_name_fr || null,
            teacher.subject || null,
            teacher.gender || null,
            teacher.birth_date || null,
            teacher.birth_place || null,
            teacher.phone || null,
            teacher.email || null,
            teacher.address || null,
            teacher.grade || null,
            teacher.cadre || null,
            teacher.echelon != null ? Number(teacher.echelon) || null : null,
            teacher.hire_date || null,
            teacher.marital_status || null,
            teacher.function_title || null,
            teacher.source || 'manual',
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
        const ALLOWED_COLUMNS = new Set([
            'ppr', 'cin', 'full_name', 'full_name_fr', 'subject', 'specialty_subject', 'gender',
            'birth_date', 'birth_place', 'phone', 'email', 'address', 'grade', 'cadre', 'echelon',
            'hire_date', 'marital_status', 'function_title', 'position', 'statut',
            'diploma_school', 'diploma_professional', 'seniority_admin', 'seniority_grade',
            'echelon_date', 'titularization_date', 'total_hours', 'overtime_hours', 'num_classes',
            'source', 'school_year', 'active'
        ]);
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

    handleWrite(ipcMain, 'teachers:deleteByYear', ['admin'], (db, _event, schoolYear) => {
        const year = normalizeYear(schoolYear);
        if (!year) return { success: false, error: 'Invalid school year' };
        const info = db.prepare('DELETE FROM teachers WHERE school_year = ?').run(year);
        return { success: true, count: info.changes };
    });

    // ── Bulk import (UPSERT by PPR or name) ──

    handleWriteSoftAuth(ipcMain, 'teachers:importBulk', ['admin', 'staff'], (db, teachers) => {
        if (!Array.isArray(teachers) || !teachers.length) {
            return { success: false, error: 'No data to import' };
        }

        const upsertByPpr = db.prepare(`
            INSERT INTO teachers(ppr, cin, full_name, full_name_fr, subject, specialty_subject, gender, birth_date, birth_place,
                phone, email, address, grade, cadre, echelon, hire_date, marital_status, function_title,
                position, statut, diploma_school, diploma_professional, seniority_admin, seniority_grade,
                echelon_date, titularization_date, total_hours, overtime_hours, num_classes,
                source, school_year, active)
            VALUES(@ppr, @cin, @full_name, @full_name_fr, @subject, @specialty_subject, @gender, @birth_date, @birth_place,
                @phone, @email, @address, @grade, @cadre, @echelon, @hire_date, @marital_status,
                @function_title, @position, @statut, @diploma_school, @diploma_professional,
                @seniority_admin, @seniority_grade, @echelon_date, @titularization_date,
                @total_hours, @overtime_hours, @num_classes,
                @source, @school_year, @active)
            ON CONFLICT(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '' DO UPDATE SET
                cin              = COALESCE(excluded.cin, cin),
                full_name        = COALESCE(excluded.full_name, full_name),
                full_name_fr     = COALESCE(excluded.full_name_fr, full_name_fr),
                -- specialty_subject وgrade وcadre: دائماً من ملف الوزارة (مصدر موثوق)
                specialty_subject = excluded.specialty_subject,
                grade            = excluded.grade,
                cadre            = excluded.cadre,
                -- subject: نحدّثه فقط إن كان خالياً أو إن القادم من الوزارة غير فارغ
                subject          = CASE
                                     WHEN excluded.subject IS NOT NULL AND excluded.subject != ''
                                     THEN excluded.subject
                                     ELSE COALESCE(subject, excluded.subject)
                                   END,
                gender           = COALESCE(excluded.gender, gender),
                birth_date       = COALESCE(excluded.birth_date, birth_date),
                birth_place      = COALESCE(excluded.birth_place, birth_place),
                phone            = COALESCE(excluded.phone, phone),
                email            = COALESCE(excluded.email, email),
                address          = COALESCE(excluded.address, address),
                echelon          = COALESCE(excluded.echelon, echelon),
                hire_date        = COALESCE(excluded.hire_date, hire_date),
                marital_status   = COALESCE(excluded.marital_status, marital_status),
                function_title   = COALESCE(excluded.function_title, function_title),
                -- الحقول الجديدة من ملف الوزارة (مصدر موثوق = دائماً يُحدَّث)
                position         = excluded.position,
                statut           = excluded.statut,
                diploma_school   = COALESCE(excluded.diploma_school, diploma_school),
                diploma_professional = COALESCE(excluded.diploma_professional, diploma_professional),
                seniority_admin  = excluded.seniority_admin,
                seniority_grade  = excluded.seniority_grade,
                echelon_date     = excluded.echelon_date,
                titularization_date = excluded.titularization_date,
                total_hours      = excluded.total_hours,
                overtime_hours   = excluded.overtime_hours,
                num_classes      = excluded.num_classes,
                source           = excluded.source,
                active           = excluded.active
        `);

        // For FET source (no PPR): insert only if name doesn't exist
        const insertByName = db.prepare(`
            INSERT OR IGNORE INTO teachers(full_name, subject, source, school_year, active)
            SELECT @full_name, @subject, @source, @school_year, 1
            WHERE NOT EXISTS (
                SELECT 1 FROM teachers WHERE full_name = @full_name AND school_year = @school_year
            )
        `);

        // For FET: update subject if teacher exists but has no subject
        const updateSubjectByName = db.prepare(`
            UPDATE teachers SET subject = COALESCE(subject, @subject)
            WHERE full_name = @full_name AND school_year = @school_year AND (subject IS NULL OR TRIM(subject) = '')
        `);

        let imported = 0;
        const txn = db.transaction(() => {
            for (const t of teachers) {
                if (!t.full_name || !t.school_year) continue;
                const row = {
                    ppr: t.ppr || null,
                    cin: t.cin || null,
                    full_name: t.full_name,
                    full_name_fr: t.full_name_fr || null,
                    subject: t.subject || null,
                    specialty_subject: t.specialty_subject || null,
                    gender: t.gender || null,
                    birth_date: t.birth_date || null,
                    birth_place: t.birth_place || null,
                    phone: t.phone || null,
                    email: t.email || null,
                    address: t.address || null,
                    grade: t.grade || null,
                    cadre: t.cadre || null,
                    echelon: t.echelon != null ? Number(t.echelon) || null : null,
                    hire_date: t.hire_date || null,
                    marital_status: t.marital_status || null,
                    function_title: t.function_title || null,
                    position: t.position || null,
                    statut: t.statut || null,
                    diploma_school: t.diploma_school || null,
                    diploma_professional: t.diploma_professional || null,
                    seniority_admin: t.seniority_admin || null,
                    seniority_grade: t.seniority_grade || null,
                    echelon_date: t.echelon_date || null,
                    titularization_date: t.titularization_date || null,
                    total_hours: t.total_hours != null ? Number(t.total_hours) || null : null,
                    overtime_hours: t.overtime_hours != null ? Number(t.overtime_hours) || null : null,
                    num_classes: t.num_classes != null ? Number(t.num_classes) || null : null,
                    source: t.source || 'manual',
                    school_year: t.school_year,
                    active: t.active == null ? 1 : t.active ? 1 : 0
                };

                if (row.ppr) {
                    upsertByPpr.run(row);
                } else {
                    insertByName.run(row);
                    if (row.subject) updateSubjectByName.run(row);
                }
                imported++;
            }
        });
        txn();
        return { success: true, count: imported };
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

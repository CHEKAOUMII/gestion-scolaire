const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { requireFields, validateDate } = require('./validation');
const {
    ensureTeacherAlias,
    normalizeTeacherName,
    seedTeacherAliases,
    resolveTeacherIdentity
} = require('../teachers/identity');

function detachTeacherReferences(db, teacherRows) {
    const teachers = Array.isArray(teacherRows) ? teacherRows.filter((row) => Number(row.id) > 0) : [];
    if (!teachers.length) return;

    const deleteAliases = db.prepare('DELETE FROM teacher_aliases WHERE teacher_id = ?');
    const deleteTeacherAbsences = db.prepare('DELETE FROM teacher_absences WHERE school_year = ? AND teacher_id = ?');
    const clearGrades = db.prepare(
        `
            UPDATE grades
            SET teacher_id = NULL,
                teacher_name = COALESCE(NULLIF(TRIM(teacher_name), ''), ?)
            WHERE school_year = ? AND teacher_id = ?
        `
    );
    const clearTests = db.prepare(
        `
            UPDATE tests
            SET teacher_id = NULL,
                teacher_name = COALESCE(NULLIF(TRIM(teacher_name), ''), ?)
            WHERE school_year = ? AND teacher_id = ?
        `
    );
    const clearAttendance = db.prepare(
        `
            UPDATE staff_attendance
            SET teacher_id = NULL,
                teacher_name = COALESCE(NULLIF(TRIM(teacher_name), ''), ?)
            WHERE school_year = ? AND teacher_id = ?
        `
    );
    const clearProctors = db.prepare(
        `
            UPDATE exam_proctors
            SET teacher_id = NULL,
                teacher_name = COALESCE(NULLIF(TRIM(teacher_name), ''), ?)
            WHERE school_year = ? AND teacher_id = ?
        `
    );
    const clearCompensation = db.prepare(
        `
            UPDATE compensation_tracking
            SET teacher_id = NULL,
                teacher_name = COALESCE(NULLIF(TRIM(teacher_name), ''), ?)
            WHERE school_year = ? AND teacher_id = ?
        `
    );

    for (const teacher of teachers) {
        const teacherId = Number(teacher.id);
        const schoolYear = String(teacher.school_year || '').trim();
        const fullName = String(teacher.full_name || '').trim() || null;
        if (!teacherId || !schoolYear) continue;
        clearGrades.run(fullName, schoolYear, teacherId);
        clearTests.run(fullName, schoolYear, teacherId);
        clearAttendance.run(fullName, schoolYear, teacherId);
        clearProctors.run(fullName, schoolYear, teacherId);
        clearCompensation.run(fullName, schoolYear, teacherId);
        deleteTeacherAbsences.run(schoolYear, teacherId);
        deleteAliases.run(teacherId);
    }
}

function registerStaffIpc(ipcMain) {
    // ── Read handlers (no auth required) ──

    handleRead(ipcMain, 'teachers:getAll', (db, schoolYear) => {
        return db
            .prepare('SELECT * FROM teachers WHERE school_year = ? ORDER BY full_name')
            .all(normalizeYear(schoolYear));
    });

    // ── Write handlers (require admin or staff role) ──

    handleWrite(ipcMain, 'teachers:add', ['admin', 'staff'], (db, _event, teacher) => {
        requireFields(teacher, ['full_name', 'school_year']);
        requireSchoolYear(teacher.school_year);
        const result = db
            .prepare(
                `
                INSERT INTO teachers(ppr, cin, full_name, full_name_fr, subject, gender, birth_date, birth_place,
                    phone, email, address, grade, cadre, echelon, hire_date, marital_status, function_title, is_surplus,
                    source, school_year, active)
                VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `
            )
            .run(
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
                Number(teacher.is_surplus) === 1 ? 1 : 0,
                teacher.source || 'manual',
                teacher.school_year,
                teacher.active == null ? 1 : teacher.active ? 1 : 0
            );
        seedTeacherAliases(
            db,
            {
                id: result.lastInsertRowid,
                school_year: teacher.school_year,
                full_name: teacher.full_name,
                full_name_fr: teacher.full_name_fr || null,
                source: teacher.source || 'manual'
            },
            teacher.source || 'manual'
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:update', ['admin', 'staff'], (db, _event, id, data) => {
        const teacherId = Number(id);
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const ALLOWED_COLUMNS = new Set([
            'ppr',
            'cin',
            'full_name',
            'full_name_fr',
            'subject',
            'specialty_subject',
            'gender',
            'birth_date',
            'birth_place',
            'phone',
            'email',
            'address',
            'grade',
            'cadre',
            'echelon',
            'hire_date',
            'marital_status',
            'function_title',
            'position',
            'statut',
            'diploma_school',
            'diploma_professional',
            'seniority_admin',
            'seniority_grade',
            'echelon_date',
            'titularization_date',
            'total_hours',
            'overtime_hours',
            'num_classes',
            'is_surplus',
            'source',
            'school_year',
            'active'
        ]);
        const safeEntries = Object.entries(data).filter(([k]) => ALLOWED_COLUMNS.has(k));
        if (!safeEntries.length) {
            return { success: false, error: 'No valid fields to update' };
        }
        const current = db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId);
        if (!current) {
            return { success: false, error: 'Teacher not found' };
        }
        const nextSchoolYear = data.school_year || current.school_year;
        const nextSource = data.source || current.source || 'manual';
        if (Object.prototype.hasOwnProperty.call(data || {}, 'school_year')) {
            requireSchoolYear(data.school_year);
        }
        if (current.full_name) {
            ensureTeacherAlias(db, {
                teacher_id: teacherId,
                alias_name: current.full_name,
                school_year: current.school_year,
                source: current.source || 'manual'
            });
        }
        if (current.full_name_fr) {
            ensureTeacherAlias(db, {
                teacher_id: teacherId,
                alias_name: current.full_name_fr,
                school_year: current.school_year,
                source: current.source || 'manual'
            });
        }
        const fields = safeEntries.map(([k]) => `${k} = ?`).join(', ');
        const values = [...safeEntries.map(([, v]) => v), teacherId];
        db.prepare(`UPDATE teachers SET ${fields} WHERE id = ?`).run(...values);
        seedTeacherAliases(
            db,
            {
                id: teacherId,
                school_year: nextSchoolYear,
                full_name: data.full_name || current.full_name,
                full_name_fr: data.full_name_fr || current.full_name_fr,
                source: nextSource
            },
            nextSource
        );
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:delete', ['admin'], (db, _event, id) => {
        const teacherId = Number(id);
        if (!Number.isFinite(teacherId) || teacherId <= 0) {
            return { success: false, error: 'Invalid ID' };
        }
        const teacher = db.prepare('SELECT id, full_name, school_year FROM teachers WHERE id = ?').get(teacherId);
        if (!teacher) {
            return { success: false, error: 'Teacher not found' };
        }
        const txn = db.transaction(() => {
            detachTeacherReferences(db, [teacher]);
            db.prepare('DELETE FROM teachers WHERE id = ?').run(teacherId);
        });
        txn();
        return { success: true };
    });

    handleWriteSoftAuth(ipcMain, 'teachers:deleteByYear', ['admin'], (db, schoolYear) => {
        const year = requireSchoolYear(schoolYear);
        const teachers = db.prepare('SELECT id, full_name, school_year FROM teachers WHERE school_year = ?').all(year);
        const txn = db.transaction(() => {
            detachTeacherReferences(db, teachers);
            return db.prepare('DELETE FROM teachers WHERE school_year = ?').run(year);
        });
        const info = txn();
        return { success: true, count: info.changes };
    });

    handleWriteSoftAuth(ipcMain, 'teachers:saveTafwijAliases', ['admin', 'staff'], (db, payload) => {
        const schoolYear = requireSchoolYear(payload?.school_year);
        const aliases = Array.isArray(payload?.aliases) ? payload.aliases : [];
        if (!aliases.length) {
            return { success: false, error: 'No aliases to save' };
        }

        const teacherById = db.prepare(
            'SELECT id, full_name, school_year FROM teachers WHERE id = ? AND school_year = ?'
        );
        const aliasOwners = db.prepare(
            `
                SELECT ta.teacher_id, t.full_name
                FROM teacher_aliases ta
                LEFT JOIN teachers t ON t.id = ta.teacher_id
                WHERE ta.school_year = ? AND ta.alias_normalized = ?
            `
        );

        const txn = db.transaction((items) => {
            const saved = [];
            for (const item of items) {
                const teacherId = Number(item?.teacher_id);
                const aliasName = String(item?.alias_name || '')
                    .replace(/_/g, ' ')
                    .replace(/\s+/g, ' ')
                    .trim();
                const aliasNormalized = normalizeTeacherName(aliasName);
                if (!Number.isFinite(teacherId) || teacherId <= 0 || !aliasName || !aliasNormalized) {
                    throw new Error('بيانات الربط غير صالحة');
                }
                const teacher = teacherById.get(teacherId, schoolYear);
                if (!teacher) {
                    throw new Error(`تعذر العثور على الأستاذ المحدد (${teacherId})`);
                }
                const conflicts = aliasOwners
                    .all(schoolYear, aliasNormalized)
                    .filter((row) => Number(row.teacher_id) !== teacherId);
                if (conflicts.length) {
                    throw new Error(
                        `الاسم "${aliasName}" مرتبط مسبقاً بالأستاذ ${conflicts[0].full_name || conflicts[0].teacher_id}`
                    );
                }
                ensureTeacherAlias(db, {
                    teacher_id: teacherId,
                    alias_name: aliasName,
                    school_year: schoolYear,
                    source: 'manual:tafwij'
                });
                saved.push({
                    teacher_id: teacherId,
                    alias_name: aliasName,
                    teacher_name: teacher.full_name,
                    school_year: schoolYear
                });
            }
            return saved;
        });

        const saved = txn(aliases);
        return { success: true, count: saved.length, aliases: saved };
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
                echelon_date, titularization_date, total_hours, overtime_hours, num_classes, is_surplus,
                source, school_year, active)
            VALUES(@ppr, @cin, @full_name, @full_name_fr, @subject, @specialty_subject, @gender, @birth_date, @birth_place,
                @phone, @email, @address, @grade, @cadre, @echelon, @hire_date, @marital_status,
                @function_title, @position, @statut, @diploma_school, @diploma_professional,
                @seniority_admin, @seniority_grade, @echelon_date, @titularization_date,
                @total_hours, @overtime_hours, @num_classes, @is_surplus,
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
                is_surplus       = excluded.is_surplus,
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
        const selectByPpr = db.prepare('SELECT * FROM teachers WHERE ppr = ? AND school_year = ?');
        const selectByName = db.prepare('SELECT * FROM teachers WHERE full_name = ? AND school_year = ?');

        let imported = 0;
        const txn = db.transaction(() => {
            for (const t of teachers) {
                if (!t.full_name || !t.school_year) continue;
                requireSchoolYear(t.school_year);
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
                    is_surplus: Number(t.is_surplus) === 1 ? 1 : 0,
                    source: t.source || 'manual',
                    school_year: t.school_year,
                    active: t.active == null ? 1 : t.active ? 1 : 0
                };

                const existingByPpr = row.ppr ? selectByPpr.get(row.ppr, row.school_year) : null;
                if (row.ppr) {
                    upsertByPpr.run(row);
                } else {
                    insertByName.run(row);
                    if (row.subject) updateSubjectByName.run(row);
                }
                const savedTeacher = row.ppr
                    ? selectByPpr.get(row.ppr, row.school_year)
                    : selectByName.get(row.full_name, row.school_year);
                if (existingByPpr && existingByPpr.full_name && existingByPpr.full_name !== row.full_name) {
                    ensureTeacherAlias(db, {
                        teacher_id: existingByPpr.id,
                        alias_name: existingByPpr.full_name,
                        school_year: existingByPpr.school_year,
                        source: existingByPpr.source || row.source
                    });
                }
                if (savedTeacher) {
                    seedTeacherAliases(db, savedTeacher, row.source);
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
        requireSchoolYear(payload.school_year);
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
        const absences = db
            .prepare(
                `
            SELECT a.*, t.full_name, t.subject
            FROM teacher_absences a
            LEFT JOIN teachers t ON t.id = a.teacher_id
            WHERE a.absence_date = ? AND a.school_year = ?
            ORDER BY t.full_name
        `
            )
            .all(date, year);

        // 1b. Staff attendance records for the given date (new table)
        const staffRecords = db
            .prepare(
                `
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.attendance_date = ? AND sa.school_year = ?
            ORDER BY sa.type, COALESCE(t.full_name, sa.teacher_name)
        `
            )
            .all(date, year);

        // Fill in missing subjects from grades table
        const recordsNeedingSubject = staffRecords.filter((r) => !r.subject && (r.full_name || r.teacher_name));
        if (recordsNeedingSubject.length > 0) {
            const gradeSubjects = new Map();
            try {
                const gs = db
                    .prepare(
                        `
                    SELECT teacher_id, teacher_name, subject
                    FROM grades
                    WHERE school_year = ?
                      AND subject IS NOT NULL AND TRIM(subject) <> ''
                      AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
                `
                    )
                    .all(year);
                for (const row of gs) {
                    const key = row.teacher_id ? `id:${row.teacher_id}` : `name:${row.teacher_name}`;
                    const current = gradeSubjects.get(key);
                    if (!current) {
                        gradeSubjects.set(key, new Set());
                    }
                    gradeSubjects.get(key).add(row.subject);
                }
            } catch {
                /* ignore */
            }
            for (const r of recordsNeedingSubject) {
                const byId = r.teacher_id ? gradeSubjects.get(`id:${r.teacher_id}`) : null;
                const byName = gradeSubjects.get(`name:${r.full_name}`) || gradeSubjects.get(`name:${r.teacher_name}`);
                const subjectSet = byId || byName;
                r.subject = subjectSet ? Array.from(subjectSet).join(', ') : '';
            }
        }

        // Separate into absences and tardiness
        const staffAbsences = staffRecords.filter((r) => r.type === 'absence');
        const staffTardiness = staffRecords.filter((r) => r.type === 'late');

        // 2. Teacher → sections mapping (derived from grades)
        const teacherSectionRows = db
            .prepare(
                `
            SELECT teacher_id, teacher_name, section
            FROM grades
            WHERE school_year = ?
              AND section IS NOT NULL AND TRIM(section) <> ''
              AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
        `
            )
            .all(year);

        const teacherSections = {};
        for (const row of teacherSectionRows) {
            const key = row.teacher_id ? `id:${row.teacher_id}` : `name:${row.teacher_name}`;
            if (!teacherSections[key]) {
                teacherSections[key] = [];
            }
            if (!teacherSections[key].includes(row.section)) {
                teacherSections[key].push(row.section);
            }
            if (row.teacher_name) {
                if (!teacherSections[row.teacher_name]) {
                    teacherSections[row.teacher_name] = [];
                }
                if (!teacherSections[row.teacher_name].includes(row.section)) {
                    teacherSections[row.teacher_name].push(row.section);
                }
            }
        }

        // 3. Student counts per section
        const sectionRows = db
            .prepare(
                `
            SELECT section, COUNT(*) as count
            FROM students
            WHERE school_year = ? AND status = 'active'
              AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY section
            ORDER BY section
        `
            )
            .all(year);

        const sectionStudentCounts = {};
        for (const row of sectionRows) {
            sectionStudentCounts[row.section] = row.count;
        }

        // 4. All sections list
        const allSections = sectionRows.map((r) => r.section);

        // 5. Affected sections — combine legacy absences + new staff absences
        const affectedSections = {};
        const allAbsenceRecords = [...absences, ...staffAbsences];
        for (const absence of allAbsenceRecords) {
            const name = absence.full_name;
            const teacherKey = absence.teacher_id ? `id:${absence.teacher_id}` : `name:${name}`;
            if (name && teacherSections[teacherKey] && !affectedSections[name]) {
                affectedSections[name] = teacherSections[teacherKey];
            }
        }

        // 6. School events for this date
        const events = db
            .prepare(
                `
            SELECT * FROM school_events
            WHERE event_date = ? AND school_year = ?
            ORDER BY event_time, id
        `
            )
            .all(date, year);

        // 7. System tags for this date
        let tags = [];
        try {
            tags = db
                .prepare(
                    `SELECT * FROM system_tags
                     WHERE tag_date = ? AND school_year = ?
                     ORDER BY entity_type, entity_name, id`
                )
                .all(date, year);
        } catch { /* table may not exist yet */ }

        return {
            absences,
            staffAbsences,
            staffTardiness,
            teacherSections,
            sectionStudentCounts,
            allSections,
            affectedSections,
            events,
            tags
        };
    });

    // ── School Events CRUD ──

    handleWriteSoftAuth(ipcMain, 'schoolEvents:save', ['admin', 'staff'], (db, payload) => {
        const { id, event_date, event_type, details, event_time, school_year } = payload;
        requireFields(payload, ['event_date', 'event_type', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            db.prepare(
                `
                UPDATE school_events
                SET event_type = ?, details = ?, event_time = ?, event_date = ?, school_year = ?
                WHERE id = ?
            `
            ).run(event_type, details || '', event_time || '', event_date, year, id);
            return { success: true, id };
        } else {
            const result = db
                .prepare(
                    `
                INSERT INTO school_events (event_date, event_type, details, event_time, school_year)
                VALUES (?, ?, ?, ?, ?)
            `
                )
                .run(event_date, event_type, details || '', event_time || '', year);
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'schoolEvents:delete', ['admin', 'staff'], (db, eventId) => {
        if (!eventId) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM school_events WHERE id = ?').run(eventId);
        return { success: true };
    });

    // ── Compensation Tracking ──

    handleRead(ipcMain, 'compensation:getByDate', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.absence_date = ? AND c.school_year = ?
            ORDER BY c.section, c.period_slot
        `
            )
            .all(date, year);
    });

    handleRead(ipcMain, 'compensation:getAll', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.school_year = ?
            ORDER BY c.absence_date DESC, c.section, c.period_slot
        `
            )
            .all(year);
    });

    handleRead(ipcMain, 'compensation:getPending', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
            SELECT c.*,
                COALESCE(t.full_name, c.teacher_name) as teacher_name,
                COALESCE(c.reason, sa.reason) as reason,
                COALESCE(c.notes, sa.notes) as notes
            FROM compensation_tracking c
            LEFT JOIN teachers t ON t.id = c.teacher_id
            LEFT JOIN staff_attendance sa
                ON sa.attendance_date = c.absence_date
                AND (sa.teacher_id = c.teacher_id OR sa.teacher_name = c.teacher_name)
                AND sa.type = 'absence'
            WHERE c.compensated = 0 AND c.school_year = ?
            ORDER BY c.absence_date DESC, c.section, c.period_slot
        `
            )
            .all(year);
    });

    handleWriteSoftAuth(ipcMain, 'compensation:saveBatch', ['admin', 'staff'], (db, sessions) => {
        if (!Array.isArray(sessions) || sessions.length === 0) {
            return { success: true, inserted: 0 };
        }
        const stmt = db.prepare(`
            INSERT OR IGNORE INTO compensation_tracking
                (absence_date, teacher_id, teacher_name, section, period_slot, period_time, subject, school_year, reason, notes)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const txn = db.transaction((items) => {
            let inserted = 0;
            for (const s of items) {
                const resolved = resolveTeacherIdentity(db, {
                    teacher_id: s.teacher_id,
                    teacher_name: s.teacher_name,
                    subject: s.subject,
                    school_year: requireSchoolYear(s.school_year),
                    source: 'compensation'
                });
                const result = stmt.run(
                    s.absence_date,
                    resolved.teacher_id || null,
                    resolved.teacher_name || s.teacher_name || null,
                    s.section,
                    s.period_slot,
                    s.period_time || '',
                    resolved.subject || s.subject || '',
                    requireSchoolYear(s.school_year),
                    s.reason || null,
                    s.notes || null
                );
                if (result.changes > 0) inserted++;
            }
            return inserted;
        });
        const inserted = txn(sessions);
        return { success: true, inserted };
    });

    handleWriteSoftAuth(ipcMain, 'compensation:toggleCompensated', ['admin', 'staff'], (db, id, compensated) => {
        if (!id) return { success: false, error: 'Invalid ID' };
        const val = compensated ? 1 : 0;
        db.prepare(
            `
            UPDATE compensation_tracking
            SET compensated = ?, compensated_date = CASE WHEN ? = 1 THEN date('now') ELSE NULL END
            WHERE id = ?
        `
        ).run(val, val, id);
        return { success: true };
    });

    handleRead(ipcMain, 'supportSessions:list', (db, filters) => {
        const year = normalizeYear(filters && filters.school_year);
        let sql = `
            SELECT ss.*, t.full_name as teacher_full_name
            FROM support_sessions ss
            LEFT JOIN teachers t ON ss.teacher_id = t.id
            WHERE ss.school_year = ?
        `;
        const params = [year];
        if (filters && filters.teacher_id) {
            sql += ' AND ss.teacher_id = ?';
            params.push(filters.teacher_id);
        }
        if (filters && filters.section) {
            sql += ' AND ss.section = ?';
            params.push(filters.section);
        }
        if (filters && filters.subject) {
            sql += ' AND ss.subject = ?';
            params.push(filters.subject);
        }
        if (filters && filters.date_from) {
            sql += ' AND ss.session_date >= ?';
            params.push(filters.date_from);
        }
        if (filters && filters.date_to) {
            sql += ' AND ss.session_date <= ?';
            params.push(filters.date_to);
        }
        sql += ' ORDER BY ss.session_date DESC, ss.time_from DESC';
        return db.prepare(sql).all(...params);
    });

    handleRead(ipcMain, 'supportSessions:stats', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `
                    SELECT
                        COUNT(*) AS total_sessions,
                        ROUND(SUM(duration_hours), 1) AS total_hours,
                        COUNT(DISTINCT COALESCE(teacher_id, teacher_name)) AS total_teachers,
                        COUNT(DISTINCT section) AS total_sections
                    FROM support_sessions
                    WHERE school_year = ?
                `
            )
            .get(year);
    });

    handleWrite(ipcMain, 'supportSessions:add', ['admin', 'staff'], (db, _event, session) => {
        requireFields(session, ['subject', 'section', 'session_date', 'time_from', 'time_to', 'attendance_status', 'school_year']);
        requireSchoolYear(session.school_year);

        const [fromHours, fromMinutes] = session.time_from.split(':').map(Number);
        const [toHours, toMinutes] = session.time_to.split(':').map(Number);
        const duration = Math.round((((toHours * 60 + toMinutes) - (fromHours * 60 + fromMinutes)) / 60) * 100) / 100;

        const result = db
            .prepare(
                `
                    INSERT INTO support_sessions
                        (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                `
            )
            .run(
                session.teacher_id || null,
                session.teacher_name || null,
                session.subject,
                session.section,
                session.room || null,
                session.session_date,
                session.time_from,
                session.time_to,
                duration > 0 ? duration : null,
                session.attendance_status,
                session.school_year
            );
        return { id: result.lastInsertRowid };
    });

    handleWrite(ipcMain, 'supportSessions:delete', ['admin', 'staff'], (db, _event, id) => {
        db.prepare('DELETE FROM support_sessions WHERE id = ?').run(id);
        return { ok: true };
    });

    handleRead(ipcMain, 'supportSessions:export', (db, schoolYear) => {
        const year = normalizeYear(schoolYear);
        const sessions = db
            .prepare(
                `
                    SELECT teacher_id, teacher_name, subject, section, room,
                           session_date, time_from, time_to, duration_hours, attendance_status
                    FROM support_sessions WHERE school_year = ?
                    ORDER BY session_date, time_from
                `
            )
            .all(year);
        return {
            exported_at: new Date().toISOString(),
            school_year: year,
            support_sessions: sessions
        };
    });

    handleRead(ipcMain, 'teachers:getNameAliases', (db, entityType, schoolYear) => {
        return db
            .prepare(
                `SELECT * FROM name_aliases
                 WHERE entity_type = ?
                   AND (school_year = ? OR school_year IS NULL)
                 ORDER BY created_at DESC`
            )
            .all(entityType, schoolYear || null);
    });

    handleWrite(ipcMain, 'teachers:saveNameAlias', ['admin', 'staff'], (db, _event, payload) => {
        const { entity_type, canonical_id, alias_text, alias_normalized, source, school_year, confidence } = payload;
        requireFields(payload, ['entity_type', 'canonical_id', 'alias_text', 'alias_normalized', 'source']);
        db.prepare(
            `INSERT INTO name_aliases
                (entity_type, canonical_id, alias_text, alias_normalized, source, school_year, confidence)
             VALUES (?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(entity_type, alias_normalized, school_year) DO UPDATE SET
                canonical_id = excluded.canonical_id,
                alias_text   = excluded.alias_text,
                source       = excluded.source,
                confidence   = excluded.confidence`
        ).run(entity_type, canonical_id, alias_text, alias_normalized, source, school_year || null, confidence ?? 1.0);
        return { success: true };
    });

    handleWrite(ipcMain, 'teachers:deleteNameAlias', ['admin', 'staff'], (db, _event, id) => {
        const aliasId = Number(id);
        if (!Number.isFinite(aliasId) || aliasId <= 0) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM name_aliases WHERE id = ?').run(aliasId);
        return { success: true };
    });

    handleWrite(ipcMain, 'supportSessions:import', ['admin', 'staff'], (db, _event, payload) => {
        if (!payload || !Array.isArray(payload.support_sessions)) {
            throw new Error('ملف JSON غير صالح');
        }
        const schoolYear = normalizeYear(payload.school_year);
        requireSchoolYear(schoolYear);

        const insert = db.prepare(`
            INSERT OR IGNORE INTO support_sessions
                (teacher_id, teacher_name, subject, section, room, session_date, time_from, time_to, duration_hours, attendance_status, school_year)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        let imported = 0;
        let skipped = 0;

        const transaction = db.transaction(() => {
            for (const session of payload.support_sessions) {
                if (
                    !session.subject ||
                    !session.section ||
                    !session.session_date ||
                    !session.time_from ||
                    !session.time_to ||
                    !session.attendance_status
                ) {
                    skipped++;
                    continue;
                }

                const exists = db
                    .prepare(
                        `
                            SELECT 1 FROM support_sessions
                            WHERE section = ? AND session_date = ? AND time_from = ? AND school_year = ?
                              AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
                        `
                    )
                    .get(
                        session.section,
                        session.session_date,
                        session.time_from,
                        schoolYear,
                        session.teacher_id || null
                    );

                if (exists) {
                    skipped++;
                    continue;
                }

                insert.run(
                    session.teacher_id || null,
                    session.teacher_name || null,
                    session.subject,
                    session.section,
                    session.room || null,
                    session.session_date,
                    session.time_from,
                    session.time_to,
                    session.duration_hours || null,
                    session.attendance_status,
                    schoolYear
                );
                imported++;
            }
        });

        transaction();
        return { imported, skipped };
    });

    // ── System Tags CRUD ──

    handleRead(ipcMain, 'systemTags:getByDate', (db, date, schoolYear) => {
        const year = normalizeYear(schoolYear);
        return db
            .prepare(
                `SELECT * FROM system_tags
                 WHERE tag_date = ? AND school_year = ?
                 ORDER BY entity_type, entity_name, id`
            )
            .all(date, year);
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:save', ['admin', 'staff'], (db, payload) => {
        const { id, tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year } = payload;
        requireFields(payload, ['tag_date', 'entity_type', 'entity_name', 'tag_key', 'tag_label', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (id) {
            db.prepare(
                `UPDATE system_tags
                 SET tag_date = ?, entity_type = ?, entity_id = ?, entity_name = ?,
                     tag_key = ?, tag_label = ?, details = ?, school_year = ?
                 WHERE id = ?`
            ).run(tag_date, entity_type, entity_id || null, entity_name, tag_key, tag_label, details || '', year, id);
            return { success: true, id };
        } else {
            const result = db
                .prepare(
                    `INSERT INTO system_tags (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, details, school_year)
                     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                )
                .run(tag_date, entity_type, entity_id || null, entity_name, tag_key, tag_label, details || '', year);
            return { success: true, id: result.lastInsertRowid };
        }
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:delete', ['admin', 'staff'], (db, tagId) => {
        if (!tagId) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM system_tags WHERE id = ?').run(tagId);
        return { success: true };
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:saveNote', ['admin', 'staff'], (db, payload) => {
        const { tag_date, tag_key, tag_label, note_text, mentions, school_year, details } = payload;
        requireFields(payload, ['tag_date', 'tag_key', 'tag_label', 'note_text', 'school_year']);
        const year = requireSchoolYear(school_year);

        if (!mentions || !mentions.length) {
            return { success: false, error: 'يجب ذكر أستاذ أو قسم واحد على الأقل باستخدام @' };
        }

        const noteGroup = require('crypto').randomUUID();

        const stmt = db.prepare(
            `INSERT INTO system_tags
             (tag_date, entity_type, entity_id, entity_name, tag_key, tag_label, note_group, note_text, details, school_year)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );

        const txn = db.transaction((items) => {
            for (const m of items) {
                stmt.run(tag_date, m.type, m.id || null, m.name, tag_key, tag_label, noteGroup, note_text, details || '', year);
            }
        });

        txn(mentions);
        return { success: true, noteGroup };
    });

    handleWriteSoftAuth(ipcMain, 'systemTags:deleteByGroup', ['admin', 'staff'], (db, noteGroup) => {
        if (!noteGroup) return { success: false, error: 'Invalid group' };
        db.prepare('DELETE FROM system_tags WHERE note_group = ?').run(noteGroup);
        return { success: true };
    });
}

module.exports = { registerStaffIpc };

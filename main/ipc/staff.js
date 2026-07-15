const { handleRead, handleWrite, handleWriteSoftAuth, normalizeYear, requireSchoolYear } = require('./ipc-helpers');
const { ALLOWED_ROLES } = require('../auth/permissions');
const WRITE_ROLES = ALLOWED_ROLES.filter((r) => r !== 'viewer');
const { requireFields } = require('./validation');
const {
    ensureTeacherAlias,
    normalizeTeacherName,
    seedTeacherAliases
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

    handleWrite(ipcMain, 'teachers:add', WRITE_ROLES, (db, _event, teacher) => {
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

    handleWrite(ipcMain, 'teachers:update', WRITE_ROLES, (db, _event, id, data) => {
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

    handleWriteSoftAuth(ipcMain, 'teachers:saveTafwijAliases', WRITE_ROLES, (db, payload) => {
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

    handleWriteSoftAuth(ipcMain, 'teachers:importBulk', WRITE_ROLES, (db, teachers) => {
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
    }, { allowNoSession: true });

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

    handleWrite(ipcMain, 'teachers:saveNameAlias', WRITE_ROLES, (db, _event, payload) => {
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

    handleWrite(ipcMain, 'teachers:deleteNameAlias', WRITE_ROLES, (db, _event, id) => {
        const aliasId = Number(id);
        if (!Number.isFinite(aliasId) || aliasId <= 0) return { success: false, error: 'Invalid ID' };
        db.prepare('DELETE FROM name_aliases WHERE id = ?').run(aliasId);
        return { success: true };
    });
}

module.exports = { registerStaffIpc };

'use strict';

/**
 * Staff/teachers domain repository (027-layering-remediation).
 */

const {
    ensureTeacherAlias,
    normalizeTeacherName,
    seedTeacherAliases
} = require('../teachers/identity');
const {
    captureDeletesFromRows,
    captureInputUpserts,
    capturePutsByIds,
    captureResolvedRows,
    notifyCaptureCommitted
} = require('./capture-port');
const { inferEducationPlacement, isKnownCycleCode } = require('../../js/shared/education/cycles');

const TEACHER_UPDATE_COLUMNS = new Set([
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
    'active',
    'source_function_code',
    'source_assignment_mode',
    'source_cycle_code',
    'scope_type',
    'source_updated_at',
    'source_activity_json'
]);

const ASSIGNMENT_KEY_FIELDS = [
    'teacher_id',
    'school_year',
    'cycle_code',
    'level_code',
    'section',
    'subject_code'
];

function tableExists(db, tableName) {
    return Boolean(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(tableName));
}

function columnExists(db, tableName, columnName) {
    const columns = typeof db.pragma === 'function'
        ? db.pragma(`table_info(${tableName})`)
        : db.prepare(`PRAGMA table_info(${tableName})`).all();
    return columns.some((column) => column.name === columnName);
}

function normalizeAssignmentSubject(value) {
    return String(value || '')
        .replace(/\s*[-—–]\s*(?:الفرض|فرض|نشاط|الأنشطة المندمجة).*$/i, '')
        .replace(/\s*\((?:الفرض|نشاط|الأنشطة المندمجة)[^)]*\)\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
}

function normalizeAssignmentText(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
}

function normalizeAssignmentCycle(cycleCode) {
    const cycle = String(cycleCode || '').trim();
    if (!isKnownCycleCode(cycle)) throw new Error('السلك التعليمي غير معروف');
    return cycle;
}

function teacherSourceValues(teacher = {}) {
    return {
        source_function_code: teacher.source_function_code || null,
        source_assignment_mode: teacher.source_assignment_mode || null,
        source_cycle_code: teacher.source_cycle_code || null,
        scope_type: teacher.scope_type === 'institution_wide' ? 'institution_wide' : 'teaching_assignment',
        source_updated_at: teacher.source_updated_at || null,
        source_activity_json: teacher.source_activity_json || null
    };
}

function applyTeacherSourceValues(db, teacherId, teacher) {
    const fields = Object.keys(teacherSourceValues(teacher)).filter((field) => columnExists(db, 'teachers', field));
    if (!fields.length) return;
    const source = teacherSourceValues(teacher);
    db.prepare(`UPDATE teachers SET ${fields.map((field) => `"${field}" = @${field}`).join(', ')} WHERE id = @id`).run({
        ...source,
        id: teacherId
    });
}

function detachTeacherReferences(db, teacherRows) {
    const teachers = Array.isArray(teacherRows) ? teacherRows.filter((row) => Number(row.id) > 0) : [];
    if (!teachers.length) return;

    const deleteAliases = db.prepare('DELETE FROM teacher_aliases WHERE teacher_id = ?');
    const hasAssignments = tableExists(db, 'teacher_teaching_assignments');
    const assignmentRowsByTeacher = hasAssignments
        ? db.prepare('SELECT * FROM teacher_teaching_assignments WHERE teacher_id = ? AND school_year = ?')
        : null;
    const deleteAssignments = hasAssignments
        ? db.prepare('DELETE FROM teacher_teaching_assignments WHERE teacher_id = ? AND school_year = ?')
        : null;
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
        if (hasAssignments) {
            const assignments = assignmentRowsByTeacher.all(teacherId, schoolYear);
            captureDeletesFromRows(db, 'teacher_teaching_assignments', assignments);
            deleteAssignments.run(teacherId, schoolYear);
        }
        deleteAliases.run(teacherId);
    }
}

function listByYear(db, year) {
    return db.prepare('SELECT * FROM teachers WHERE school_year = ? ORDER BY full_name').all(year);
}

function listByYearAndCycle(db, year, cycleCode, options = {}) {
    const cycle = normalizeAssignmentCycle(cycleCode);
    if (!tableExists(db, 'teacher_teaching_assignments') || !columnExists(db, 'teachers', 'scope_type')) {
        return listByYear(db, year);
    }
    const includeReview = options.includeReview === true;
    const confidenceSql = includeReview ? "('confirmed', 'review_required')" : "('confirmed')";
    return db
        .prepare(
            `SELECT t.*,
                    CASE WHEN t.scope_type = 'institution_wide' THEN 1 ELSE 0 END AS is_institution_wide,
                    (SELECT COUNT(*) FROM teacher_teaching_assignments a
                     WHERE a.teacher_id = t.id AND a.school_year = t.school_year
                       AND a.cycle_code = ? AND a.is_active = 1
                       AND a.confidence IN ${confidenceSql}) AS assignment_count
             FROM teachers t
             WHERE t.school_year = ? AND COALESCE(t.active, 1) = 1
               AND (
                   t.scope_type = 'institution_wide'
                   OR EXISTS (
                       SELECT 1 FROM teacher_teaching_assignments a
                       WHERE a.teacher_id = t.id AND a.school_year = t.school_year
                         AND a.cycle_code = ? AND a.is_active = 1
                         AND a.confidence IN ${confidenceSql}
                   )
               )
             ORDER BY t.full_name, t.id`
        )
        .all(cycle, year, cycle);
}

function listTeachingAssignments(db, year, cycleCode, options = {}) {
    const cycle = normalizeAssignmentCycle(cycleCode);
    if (!tableExists(db, 'teacher_teaching_assignments')) return [];
    const confidence = options.confidence;
    const params = [year, cycle];
    const where = ['a.school_year = ?', 'a.cycle_code = ?'];
    if (options.activeOnly !== false) {
        where.push('a.is_active = 1');
    }
    if (confidence) {
        const values = Array.isArray(confidence) ? confidence : [confidence];
        const valid = values.filter((value) => ['confirmed', 'review_required', 'rejected'].includes(value));
        if (valid.length) {
            where.push(`a.confidence IN (${valid.map(() => '?').join(',')})`);
            params.push(...valid);
        }
    } else if (options.includeReview !== true) {
        where.push("a.confidence = 'confirmed'");
    }
    return db
        .prepare(
            `SELECT a.*, t.full_name, t.full_name_fr, t.ppr, t.scope_type
             FROM teacher_teaching_assignments a
             JOIN teachers t ON t.id = a.teacher_id
             WHERE ${where.join(' AND ')}
             ORDER BY t.full_name, a.level_code, a.section, a.subject_code, a.id`
        )
        .all(...params);
}

function listPendingAssignmentReviews(db, year, cycle) {
    if (!tableExists(db, 'teacher_teaching_assignments')) return [];
    return db.prepare(
        `SELECT 'assignment' AS queue_type, a.id AS assignment_id, a.teacher_id,
                t.full_name AS teacher_name, t.ppr, a.school_year, a.cycle_code,
                a.level_code, a.section, a.subject_code, a.subject_label,
                a.source, a.source_file_name, a.decision_source,
                a.decided_by_user_id, a.decided_at, a.confidence,
                NULL AS grade_count, NULL AS resolution
         FROM teacher_teaching_assignments a
         JOIN teachers t ON t.id = a.teacher_id
         WHERE a.school_year = ? AND a.cycle_code = ?
           AND a.confidence = 'review_required' AND a.is_active = 1
         ORDER BY t.full_name, a.level_code, a.section, a.subject_code, a.id`
    ).all(year, cycle);
}

function listUnresolvedGradeReviews(db, year, cycle) {
    const hasResolution = columnExists(db, 'grades', 'teacher_resolution');
    const hasSourceFile = columnExists(db, 'grades', 'source_file_name');
    return db.prepare(
        `SELECT 'grade' AS queue_type, NULL AS assignment_id, NULL AS teacher_id,
                TRIM(COALESCE(g.teacher_name, '')) AS teacher_name, NULL AS ppr,
                g.school_year, g.cycle_code, g.level AS level_code, g.section,
                g.subject AS subject_code, g.subject AS subject_label,
                'grades_import' AS source, ${hasSourceFile ? 'g.source_file_name' : 'NULL'} AS source_file_name,
                'import_suggestion' AS decision_source, NULL AS decided_by_user_id,
                NULL AS decided_at, 'review_required' AS confidence,
                COUNT(*) AS grade_count,
                ${hasResolution ? 'MAX(g.teacher_resolution)' : "'unresolved'"} AS resolution
         FROM grades g
         WHERE g.school_year = ? AND g.cycle_code = ?
           AND (g.teacher_id IS NULL OR g.teacher_id <= 0)
           AND TRIM(COALESCE(g.teacher_name, '')) <> ''
         GROUP BY g.school_year, g.cycle_code, g.level, g.section, g.subject,
                  TRIM(COALESCE(g.teacher_name, '')), ${hasSourceFile ? 'g.source_file_name' : "''"}
         ORDER BY teacher_name, level_code, section, subject_code`
    ).all(year, cycle);
}

function findTeacherReviewCandidates(db, schoolYear, teacherName) {
    const teachers = db.prepare(
        `SELECT id, full_name, full_name_fr, ppr, subject
         FROM teachers WHERE school_year = ? AND COALESCE(active, 1) = 1
         ORDER BY full_name, id`
    ).all(schoolYear);
    const normalizedName = normalizeTeacherName(teacherName);
    const exactCandidates = teachers.filter(
        (teacher) => normalizeTeacherName(teacher.full_name) === normalizedName
    );
    return (exactCandidates.length ? exactCandidates : teachers).slice(0, 100);
}

function listTeacherAssignmentReviewQueue(db, year, cycleCode) {
    const cycle = normalizeAssignmentCycle(cycleCode);
    const assignmentReviews = listPendingAssignmentReviews(db, year, cycle);
    const gradeReviews = listUnresolvedGradeReviews(db, year, cycle).map((gradeReview) => ({
        ...gradeReview,
        candidates: findTeacherReviewCandidates(db, gradeReview.school_year, gradeReview.teacher_name)
    }));
    return [...assignmentReviews, ...gradeReviews];
}

function setTeacherScope(db, teacherId, scopeType) {
    const id = Number(teacherId);
    const scope = String(scopeType || '').trim();
    if (!Number.isFinite(id) || id <= 0) throw new Error('معرف الأستاذ غير صالح');
    if (!['institution_wide', 'teaching_assignment'].includes(scope)) throw new Error('نطاق الموظف غير صالح');
    const current = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
    if (!current) throw new Error('الأستاذ غير موجود');
    db.prepare('UPDATE teachers SET scope_type = ? WHERE id = ?').run(scope, id);
    const updated = db.prepare('SELECT * FROM teachers WHERE id = ?').get(id);
    captureResolvedRows(db, 'teachers', [updated], 'PUT');
    notifyCaptureCommitted();
    return { success: true, teacher: updated };
}

function resolveUnresolvedGradeAssignment(db, payload = {}, options = {}) {
    const role = String(options.role || '').trim().toLowerCase();
    if (!['admin', 'principal', 'developer'].includes(role)) {
        throw new Error('لا تملك صلاحية حسم مطابقة الأستاذ');
    }
    const cycle = normalizeAssignmentCycle(options.cycleCode || payload.cycle_code);
    const year = normalizeAssignmentText(payload.school_year);
    const teacherId = Number(payload.teacher_id);
    if (!year || !Number.isFinite(teacherId) || teacherId <= 0) throw new Error('بيانات المطابقة غير مكتملة');
    const teacher = db.prepare('SELECT id, full_name FROM teachers WHERE id = ? AND school_year = ?').get(teacherId, year);
    if (!teacher) throw new Error('الأستاذ المحدد غير موجود في السنة الدراسية');
    const teacherName = normalizeAssignmentText(payload.teacher_name);
    const level = normalizeAssignmentText(payload.level_code || payload.level);
    const section = normalizeAssignmentText(payload.section);
    const subject = normalizeAssignmentText(payload.subject_code || payload.subject);
    if (!teacherName || !subject) throw new Error('اسم الأستاذ والمادة مطلوبان');

    const result = db.transaction(() => {
        const where = [
            'school_year = ?',
            'cycle_code = ?',
            'TRIM(COALESCE(teacher_name, \'\')) = ?',
            'TRIM(COALESCE(subject, \'\')) = ?',
            '(teacher_id IS NULL OR teacher_id <= 0)'
        ];
        const params = [year, cycle, teacherName, subject];
        if (level) {
            where.push('TRIM(COALESCE(level, \'\')) = ?');
            params.push(level);
        }
        if (section) {
            where.push('TRIM(COALESCE(section, \'\')) = ?');
            params.push(section);
        }
        const rows = db.prepare(`SELECT * FROM grades WHERE ${where.join(' AND ')}`).all(...params);
        if (!rows.length) throw new Error('لا توجد سجلات نقط غير محسومة بهذه المواصفات');
        const ids = rows.map((row) => Number(row.id)).filter((id) => id > 0);
        db.prepare(
            `UPDATE grades
             SET teacher_id = ?, teacher_name = ?, teacher_resolution = 'resolved'
             WHERE id IN (${ids.map(() => '?').join(',')}) AND cycle_code = ?`
        ).run(teacher.id, teacher.full_name, ...ids, cycle);
        capturePutsByIds(db, 'grades', ids, year);
        const resolvedRows = rows.map((row) => ({
            ...row,
            teacher_id: teacher.id,
            teacher_name: teacher.full_name,
            teacher_resolution: 'resolved'
        }));
        const assignmentResult = createAssignmentSuggestions(db, resolvedRows, cycle, {
            inTransaction: true,
            source: 'manager_review'
        });
        ensureTeacherAlias(db, {
            teacher_id: teacher.id,
            alias_name: teacherName,
            school_year: year,
            source: 'manager:grade-review'
        });
        return { updated: ids.length, assignmentResult };
    })();
    notifyCaptureCommitted();
    return { success: true, ...result };
}

function createAssignmentSuggestions(db, gradeRows, cycleCode, options = {}) {
    const cycle = normalizeAssignmentCycle(cycleCode);
    if (!tableExists(db, 'teacher_teaching_assignments')) {
        return { success: true, created: 0, preserved: 0, suggestions: [], unresolved: [], placementMismatches: [] };
    }
    const rows = Array.isArray(gradeRows) ? gradeRows : [];
    const suggestionItems = new Map();
    const unresolved = [];
    const placementMismatches = [];
    for (const grade of rows) {
        const teacherId = Number(grade?.teacher_id);
        const identityStatus = grade?.teacher_resolution;
        if (!Number.isFinite(teacherId) || teacherId <= 0 || identityStatus === 'ambiguous' || identityStatus === 'unresolved') {
            if (grade?.teacher_name) unresolved.push({
                teacher_name: grade.teacher_name,
                school_year: grade.school_year,
                ambiguous: identityStatus === 'ambiguous'
            });
            continue;
        }
        const inferredCycle = inferEducationPlacement({ section: grade.section, level: grade.level });
        if (!inferredCycle) {
            unresolved.push({
                teacher_id: teacherId,
                teacher_name: grade.teacher_name || '',
                section: grade.section || '',
                level: grade.level || '',
                reason: 'unknown_education_placement'
            });
            continue;
        }
        if (inferredCycle !== cycle) {
            placementMismatches.push({
                teacher_id: teacherId,
                teacher_name: grade.teacher_name || '',
                section: grade.section || '',
                level: grade.level || '',
                inferred_cycle_code: inferredCycle,
                active_cycle_code: cycle
            });
            continue;
        }
        const schoolYear = normalizeAssignmentText(grade.school_year);
        const levelCode = normalizeAssignmentText(grade.level);
        const section = normalizeAssignmentText(grade.section);
        const subjectLabel = normalizeAssignmentText(grade.subject);
        const subjectCode = normalizeAssignmentSubject(grade.subject);
        if (!schoolYear || !subjectCode) continue;
        const item = {
            teacher_id: teacherId,
            school_year: schoolYear,
            cycle_code: inferredCycle,
            level_code: levelCode,
            section,
            subject_code: subjectCode,
            subject_label: subjectLabel || subjectCode,
            source: options.source || 'grades_import',
            source_file_name: options.source_file_name || grade.source_file_name || null
        };
        const key = ASSIGNMENT_KEY_FIELDS.map((field) => String(item[field] ?? '')).join('||');
        suggestionItems.set(key, item);
    }

    const run = () => {
        const upsert = db.prepare(
            `INSERT INTO teacher_teaching_assignments
                (teacher_id, school_year, cycle_code, level_code, section, subject_code,
                 subject_label, source, source_file_name, decision_source, confidence, is_active)
             VALUES (@teacher_id, @school_year, @cycle_code, @level_code, @section, @subject_code,
                     @subject_label, @source, @source_file_name, 'import_suggestion', 'review_required', 1)
             ON CONFLICT(teacher_id, school_year, cycle_code, level_code, section, subject_code)
             DO UPDATE SET
                subject_label = excluded.subject_label,
                source = excluded.source,
                source_file_name = COALESCE(excluded.source_file_name, teacher_teaching_assignments.source_file_name),
                updated_at = CURRENT_TIMESTAMP`
        );
        const existed = db.prepare(
            `SELECT confidence FROM teacher_teaching_assignments
             WHERE teacher_id = @teacher_id AND school_year = @school_year AND cycle_code = @cycle_code
               AND level_code = @level_code AND section = @section AND subject_code = @subject_code`
        );
        const suggestions = [];
        let created = 0;
        let preserved = 0;
        for (const item of suggestionItems.values()) {
            const before = existed.get(
                Object.fromEntries(ASSIGNMENT_KEY_FIELDS.map((field) => [field, item[field]]))
            );
            upsert.run(item);
            if (before) preserved += 1;
            else created += 1;
            suggestions.push(item);
        }
        if (suggestions.length) {
            captureInputUpserts(db, {
                tableName: 'teacher_teaching_assignments',
                keyFields: ASSIGNMENT_KEY_FIELDS,
                items: suggestions,
                operation: 'PUT'
            });
        }
        return { success: true, created, preserved, suggestions, unresolved, placementMismatches };
    };
    if (options.inTransaction) return run();
    return db.transaction(run)();
}

function reviewTeachingAssignment(db, payload = {}, options = {}) {
    if (!tableExists(db, 'teacher_teaching_assignments')) {
        return { success: false, error: 'جدول التعيينات غير متاح' };
    }
    const role = String(options.role || '').trim().toLowerCase();
    const isManager = role === 'admin' || role === 'principal' || role === 'developer';
    if (!isManager) throw new Error('لا تملك صلاحية مراجعة تعيينات الأساتذة');
    const assignmentId = Number(payload.assignment_id || payload.id);
    if (!Number.isFinite(assignmentId) || assignmentId <= 0) throw new Error('معرف التعيين غير صالح');
    const current = db.prepare('SELECT * FROM teacher_teaching_assignments WHERE id = ?').get(assignmentId);
    if (!current) throw new Error('التعيين غير موجود');
    const confidence = String(payload.confidence || payload.status || '').trim();
    if (!['confirmed', 'review_required', 'rejected'].includes(confidence)) {
        throw new Error('حالة التعيين غير صالحة');
    }
    const targetCycle = normalizeAssignmentCycle(payload.target_cycle_code || payload.cycle_code || current.cycle_code);
    const decisionSource = role === 'admin' ? 'admin_decision' : 'principal_decision';
    const decidedBy = Number(options.userId || payload.decided_by_user_id) || null;
    const decidedAt = new Date().toISOString();
    const updated = db.transaction(() => {
        db.prepare(
            `UPDATE teacher_teaching_assignments
             SET cycle_code = ?, confidence = ?, is_active = ?, decision_source = ?,
                 decided_by_user_id = ?, decided_at = ?, updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`
        ).run(targetCycle, confidence, confidence === 'rejected' ? 0 : 1, decisionSource, decidedBy, decidedAt, assignmentId);
        const row = db.prepare('SELECT * FROM teacher_teaching_assignments WHERE id = ?').get(assignmentId);
        captureResolvedRows(db, 'teacher_teaching_assignments', [row], 'PUT');
        return row;
    })();
    notifyCaptureCommitted();
    return { success: true, assignment: updated };
}

function addTeacher(db, teacher) {
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
    applyTeacherSourceValues(db, result.lastInsertRowid, teacher);
    return { success: true };
}

function updateTeacher(db, id, data, options = {}) {
    const teacherId = Number(id);
    if (!Number.isFinite(teacherId) || teacherId <= 0) {
        return { success: false, error: 'Invalid ID' };
    }
    const safeEntries = Object.entries(data || {}).filter(
        ([k]) => TEACHER_UPDATE_COLUMNS.has(k) && columnExists(db, 'teachers', k)
    );
    if (!safeEntries.length) {
        return { success: false, error: 'No valid fields to update' };
    }
    if (Object.prototype.hasOwnProperty.call(data || {}, 'scope_type')) {
        const scopeType = String(data.scope_type || '').trim();
        if (!['institution_wide', 'teaching_assignment'].includes(scopeType)) {
            return { success: false, error: 'نطاق الموظف غير صالح' };
        }
    }
    const current = db.prepare('SELECT * FROM teachers WHERE id = ?').get(teacherId);
    if (!current) {
        return { success: false, error: 'Teacher not found' };
    }
    if (typeof options.onSchoolYear === 'function' && Object.prototype.hasOwnProperty.call(data || {}, 'school_year')) {
        options.onSchoolYear(data.school_year);
    }
    const nextSchoolYear = data.school_year || current.school_year;
    const nextSource = data.source || current.source || 'manual';
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
}

function deleteTeacher(db, id) {
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
}

function deleteByYear(db, year) {
    const teachers = db.prepare('SELECT * FROM teachers WHERE school_year = ?').all(year);
    const txn = db.transaction(() => {
        if (!teachers.length) return 0;
        const teacherIds = teachers.map((t) => Number(t.id)).filter((id) => id > 0);
        const placeholders = teacherIds.map(() => '?').join(',');
        const aliases = teacherIds.length
            ? db.prepare(`SELECT * FROM teacher_aliases WHERE teacher_id IN (${placeholders})`).all(...teacherIds)
            : [];
        const absences = teacherIds.length
            ? db
                  .prepare(
                      `SELECT * FROM teacher_absences WHERE school_year = ? AND teacher_id IN (${placeholders})`
                  )
                  .all(year, ...teacherIds)
            : [];

        const relatedTables = ['grades', 'tests', 'staff_attendance', 'exam_proctors', 'compensation_tracking'];
        const relatedIds = {};
        for (const table of relatedTables) {
            relatedIds[table] = teacherIds.length
                ? db
                      .prepare(
                          `SELECT id FROM "${table}" WHERE school_year = ? AND teacher_id IN (${placeholders})`
                      )
                      .all(year, ...teacherIds)
                      .map((r) => r.id)
                : [];
        }

        detachTeacherReferences(db, teachers);

        for (const table of relatedTables) {
            if (relatedIds[table].length) {
                capturePutsByIds(db, table, relatedIds[table], year);
            }
        }
        captureDeletesFromRows(db, 'teacher_absences', absences);
        captureDeletesFromRows(db, 'teacher_aliases', aliases);
        captureDeletesFromRows(db, 'teachers', teachers);
        return db.prepare('DELETE FROM teachers WHERE school_year = ?').run(year).changes;
    });
    const count = txn();
    notifyCaptureCommitted();
    return { success: true, count };
}

function saveTafwijAliases(db, payload, schoolYear) {
    const aliases = Array.isArray(payload?.aliases) ? payload.aliases : [];
    if (!aliases.length) {
        return { success: false, error: 'No aliases to save' };
    }

    const teacherById = db.prepare('SELECT id, full_name, school_year FROM teachers WHERE id = ? AND school_year = ?');
    const aliasOwners = db.prepare(
        `
                SELECT ta.teacher_id, t.full_name
                FROM teacher_aliases ta
                LEFT JOIN teachers t ON t.id = ta.teacher_id
                WHERE ta.school_year = ? AND ta.alias_normalized = ?
            `
    );
    const selectAlias = db.prepare(
        `SELECT * FROM teacher_aliases
             WHERE teacher_id = ? AND school_year = ? AND alias_normalized = ?`
    );

    const txn = db.transaction((items) => {
        const saved = [];
        const aliasRows = [];
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
            const aliasRow = selectAlias.get(teacherId, schoolYear, aliasNormalized);
            if (aliasRow) aliasRows.push(aliasRow);
            saved.push({
                teacher_id: teacherId,
                alias_name: aliasName,
                teacher_name: teacher.full_name,
                school_year: schoolYear
            });
        }
        if (aliasRows.length) {
            captureResolvedRows(db, 'teacher_aliases', aliasRows, 'PUT');
        }
        return saved;
    });

    const saved = txn(aliases);
    notifyCaptureCommitted();
    return { success: true, count: saved.length, aliases: saved };
}

/**
 * Upsert one teacher alias for another repository transaction. The caller owns
 * the surrounding transaction and captures the returned row when the alias is
 * created or refreshed.
 */
function saveTeacherAlias(db, payload = {}) {
    payload = payload || {};
    const teacherId = Number(payload.teacher_id);
    const schoolYear = String(payload.school_year || '').trim();
    const aliasName = String(payload.alias_name || '')
        .replace(/_/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    const aliasNormalized = normalizeTeacherName(aliasName);
    if (!Number.isFinite(teacherId) || teacherId <= 0 || !schoolYear || !aliasName || !aliasNormalized) return null;

    db.prepare(
        `INSERT INTO teacher_aliases(teacher_id, alias_name, alias_normalized, source, school_year)
         VALUES(?, ?, ?, ?, ?)
         ON CONFLICT(teacher_id, school_year, alias_normalized) DO UPDATE SET
             alias_name = excluded.alias_name,
             source = COALESCE(excluded.source, teacher_aliases.source)`
    ).run(teacherId, aliasName, aliasNormalized, payload.source || null, schoolYear);

    return db
        .prepare(
            `SELECT * FROM teacher_aliases
             WHERE teacher_id = ? AND school_year = ? AND alias_normalized = ?`
        )
        .get(teacherId, schoolYear, aliasNormalized);
}

function importBulk(db, teachers, options = {}) {
    if (!Array.isArray(teachers) || !teachers.length) {
        return { success: false, error: 'No data to import' };
    }

    const upsertByPpr = db.prepare(`
            INSERT INTO teachers(ppr, cin, full_name, full_name_fr, subject, specialty_subject, gender, birth_date, birth_place,
                phone, email, address, grade, cadre, echelon, hire_date, marital_status, function_title,
                position, statut, diploma_school, diploma_professional, seniority_admin, seniority_grade,
                echelon_date, titularization_date, total_hours, overtime_hours, num_classes, is_surplus,
                source, school_year, active, source_function_code, source_assignment_mode, source_cycle_code,
                scope_type, source_updated_at, source_activity_json)
            VALUES(@ppr, @cin, @full_name, @full_name_fr, @subject, @specialty_subject, @gender, @birth_date, @birth_place,
                @phone, @email, @address, @grade, @cadre, @echelon, @hire_date, @marital_status,
                @function_title, @position, @statut, @diploma_school, @diploma_professional,
                @seniority_admin, @seniority_grade, @echelon_date, @titularization_date,
                @total_hours, @overtime_hours, @num_classes, @is_surplus,
                @source, @school_year, @active, @source_function_code, @source_assignment_mode, @source_cycle_code,
                COALESCE(@scope_type, 'teaching_assignment'), @source_updated_at, @source_activity_json)
            ON CONFLICT(ppr, school_year) WHERE ppr IS NOT NULL AND ppr != '' DO UPDATE SET
                cin              = CASE WHEN excluded.cin IS NOT NULL AND excluded.cin != '' THEN excluded.cin ELSE cin END,
                full_name        = CASE WHEN excluded.full_name IS NOT NULL AND excluded.full_name != '' THEN excluded.full_name ELSE full_name END,
                full_name_fr     = CASE WHEN excluded.full_name_fr IS NOT NULL AND excluded.full_name_fr != '' THEN excluded.full_name_fr ELSE full_name_fr END,
                specialty_subject = CASE WHEN excluded.specialty_subject IS NOT NULL AND excluded.specialty_subject != '' THEN excluded.specialty_subject ELSE specialty_subject END,
                grade            = CASE WHEN excluded.grade IS NOT NULL AND excluded.grade != '' THEN excluded.grade ELSE grade END,
                cadre            = CASE WHEN excluded.cadre IS NOT NULL AND excluded.cadre != '' THEN excluded.cadre ELSE cadre END,
                subject          = CASE
                                     WHEN excluded.subject IS NOT NULL AND excluded.subject != ''
                                     THEN excluded.subject
                                     ELSE COALESCE(subject, excluded.subject)
                                   END,
                gender           = CASE WHEN excluded.gender IS NOT NULL AND excluded.gender != '' THEN excluded.gender ELSE gender END,
                birth_date       = CASE WHEN excluded.birth_date IS NOT NULL AND excluded.birth_date != '' THEN excluded.birth_date ELSE birth_date END,
                birth_place      = CASE WHEN excluded.birth_place IS NOT NULL AND excluded.birth_place != '' THEN excluded.birth_place ELSE birth_place END,
                phone            = CASE WHEN excluded.phone IS NOT NULL AND excluded.phone != '' THEN excluded.phone ELSE phone END,
                email            = CASE WHEN excluded.email IS NOT NULL AND excluded.email != '' THEN excluded.email ELSE email END,
                address          = CASE WHEN excluded.address IS NOT NULL AND excluded.address != '' THEN excluded.address ELSE address END,
                echelon          = COALESCE(excluded.echelon, echelon),
                hire_date        = CASE WHEN excluded.hire_date IS NOT NULL AND excluded.hire_date != '' THEN excluded.hire_date ELSE hire_date END,
                marital_status   = CASE WHEN excluded.marital_status IS NOT NULL AND excluded.marital_status != '' THEN excluded.marital_status ELSE marital_status END,
                function_title   = CASE WHEN excluded.function_title IS NOT NULL AND excluded.function_title != '' THEN excluded.function_title ELSE function_title END,
                position         = CASE WHEN excluded.position IS NOT NULL AND excluded.position != '' THEN excluded.position ELSE position END,
                statut           = CASE WHEN excluded.statut IS NOT NULL AND excluded.statut != '' THEN excluded.statut ELSE statut END,
                diploma_school   = CASE WHEN excluded.diploma_school IS NOT NULL AND excluded.diploma_school != '' THEN excluded.diploma_school ELSE diploma_school END,
                diploma_professional = CASE WHEN excluded.diploma_professional IS NOT NULL AND excluded.diploma_professional != '' THEN excluded.diploma_professional ELSE diploma_professional END,
                seniority_admin  = CASE WHEN excluded.seniority_admin IS NOT NULL AND excluded.seniority_admin != '' THEN excluded.seniority_admin ELSE seniority_admin END,
                seniority_grade  = CASE WHEN excluded.seniority_grade IS NOT NULL AND excluded.seniority_grade != '' THEN excluded.seniority_grade ELSE seniority_grade END,
                echelon_date     = CASE WHEN excluded.echelon_date IS NOT NULL AND excluded.echelon_date != '' THEN excluded.echelon_date ELSE echelon_date END,
                titularization_date = CASE WHEN excluded.titularization_date IS NOT NULL AND excluded.titularization_date != '' THEN excluded.titularization_date ELSE titularization_date END,
                total_hours      = COALESCE(excluded.total_hours, total_hours),
                overtime_hours   = COALESCE(excluded.overtime_hours, overtime_hours),
                num_classes      = COALESCE(excluded.num_classes, num_classes),
                -- is_surplus and active are booleans where 0 is meaningful; COALESCE guards only NULL,
                -- but the parser emits 0 for a missing XML tag, so we leave them unconditional and
                -- document the limitation (see settings-imports.js:3765 isSurplus logic).
                is_surplus       = excluded.is_surplus,
                source           = excluded.source,
                active           = excluded.active,
                source_function_code = CASE WHEN excluded.source_function_code IS NOT NULL AND excluded.source_function_code != '' THEN excluded.source_function_code ELSE source_function_code END,
                source_assignment_mode = CASE WHEN excluded.source_assignment_mode IS NOT NULL AND excluded.source_assignment_mode != '' THEN excluded.source_assignment_mode ELSE source_assignment_mode END,
                source_cycle_code = CASE WHEN excluded.source_cycle_code IS NOT NULL AND excluded.source_cycle_code != '' THEN excluded.source_cycle_code ELSE source_cycle_code END,
                scope_type = CASE WHEN excluded.scope_type IS NOT NULL AND excluded.scope_type != '' THEN excluded.scope_type ELSE scope_type END,
                source_updated_at = excluded.source_updated_at,
                source_activity_json = CASE WHEN excluded.source_activity_json IS NOT NULL AND excluded.source_activity_json != '' THEN excluded.source_activity_json ELSE source_activity_json END
        `);

    const insertByName = db.prepare(`
            INSERT OR IGNORE INTO teachers(full_name, subject, source, school_year, active)
            SELECT @full_name, @subject, @source, @school_year, 1
            WHERE NOT EXISTS (
                SELECT 1 FROM teachers WHERE full_name = @full_name AND school_year = @school_year
            )
        `);

    const updateSubjectByName = db.prepare(`
            UPDATE teachers SET subject = COALESCE(subject, @subject)
            WHERE full_name = @full_name AND school_year = @school_year AND (subject IS NULL OR TRIM(subject) = '')
        `);
    const selectByPpr = db.prepare('SELECT * FROM teachers WHERE ppr = ? AND school_year = ?');
    const selectByName = db.prepare('SELECT * FROM teachers WHERE full_name = ? AND school_year = ?');
    const selectAliases = db.prepare('SELECT * FROM teacher_aliases WHERE teacher_id = ? AND school_year = ?');

    let imported = 0;
    const txn = db.transaction(() => {
        const savedTeachers = [];
        for (const t of teachers) {
            if (!t.full_name || !t.school_year) continue;
            if (typeof options.validateSchoolYear === 'function') {
                options.validateSchoolYear(t.school_year);
            }
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
                active: t.active == null ? 1 : t.active ? 1 : 0,
                source_function_code: t.source_function_code || null,
                source_assignment_mode: t.source_assignment_mode || null,
                source_cycle_code: t.source_cycle_code || null,
                scope_type: t.scope_type
                    ? t.scope_type === 'institution_wide'
                        ? 'institution_wide'
                        : 'teaching_assignment'
                    : null,
                source_updated_at: t.source_updated_at || null,
                source_activity_json: t.source_activity_json || null
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
                savedTeachers.push(savedTeacher);
            }
            imported++;
        }
        if (savedTeachers.length) {
            captureResolvedRows(db, 'teachers', savedTeachers, 'PUT');
            const aliasRows = [];
            for (const teacher of savedTeachers) {
                aliasRows.push(...selectAliases.all(teacher.id, teacher.school_year));
            }
            if (aliasRows.length) {
                captureResolvedRows(db, 'teacher_aliases', aliasRows, 'PUT');
            }
        }
        if (typeof options.audit === 'function') options.audit({ success: true, count: imported });
    });
    txn();
    notifyCaptureCommitted();
    return { success: true, count: imported };
}

function listNameAliases(db, entityType, schoolYear) {
    const aliases = [];
    if (tableExists(db, 'name_aliases')) {
        aliases.push(
            ...db
                .prepare(
                    `SELECT * FROM name_aliases
                     WHERE entity_type = ?
                       AND (school_year = ? OR school_year IS NULL)`
                )
                .all(entityType, schoolYear || null)
        );
    }
    if (entityType === 'teacher' && tableExists(db, 'teacher_aliases')) {
        aliases.push(
            ...db
                .prepare(
                    `SELECT id, teacher_id AS canonical_id, alias_name AS alias_text,
                            alias_normalized, source, school_year, created_at
                     FROM teacher_aliases
                     WHERE school_year = ?`
                )
                .all(schoolYear || null)
        );
    }
    return aliases.sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')));
}

function saveNameAlias(db, payload) {
    const { entity_type, canonical_id, alias_text, alias_normalized, source, school_year, confidence } = payload;
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
}

function deleteNameAlias(db, id) {
    const aliasId = Number(id);
    if (!Number.isFinite(aliasId) || aliasId <= 0) return { success: false, error: 'Invalid ID' };
    db.prepare('DELETE FROM name_aliases WHERE id = ?').run(aliasId);
    return { success: true };
}

module.exports = {
    listByYear,
    listByYearAndCycle,
    listTeachingAssignments,
    listTeacherAssignmentReviewQueue,
    createAssignmentSuggestions,
    reviewTeachingAssignment,
    resolveUnresolvedGradeAssignment,
    setTeacherScope,
    addTeacher,
    updateTeacher,
    deleteTeacher,
    deleteByYear,
    saveTafwijAliases,
    saveTeacherAlias,
    importBulk,
    listNameAliases,
    saveNameAlias,
    deleteNameAlias,
    detachTeacherReferences
};

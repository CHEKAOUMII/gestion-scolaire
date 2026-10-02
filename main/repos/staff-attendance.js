'use strict';

/**
 * Staff attendance repository.
 * Owns SQL for `staff_attendance` and the grades-derived teacher options;
 * IPC stays auth, the all-cycle write guard, and payload canonicalization
 * (teacher identity resolution, type/period derivation).
 */

// Build teacher options from canonical teachers first, then append unresolved
// grade-only names. Teachers are institution-wide, but the subjects and the
// unresolved names are derived from `grades`, which is cycle-scoped: without
// the filter a teacher would be listed with the subjects they teach in the
// other cycle.
function listTeachersFromGrades(db, year, cycle) {
    return db
        .prepare(
            `
            WITH canonical_teachers AS (
                SELECT
                    t.id AS id,
                    t.full_name AS full_name,
                    COALESCE(
                        GROUP_CONCAT(DISTINCT NULLIF(TRIM(g.subject), '')),
                        NULLIF(TRIM(t.subject), '')
                    ) AS subject
                FROM teachers t
                LEFT JOIN grades g
                    ON g.school_year = t.school_year
                   AND g.cycle_code = ?
                   AND (
                        g.teacher_id = t.id
                        OR (
                            (g.teacher_id IS NULL OR g.teacher_id <= 0)
                            AND TRIM(COALESCE(g.teacher_name, '')) = TRIM(t.full_name)
                        )
                   )
                WHERE t.school_year = ?
                  AND TRIM(COALESCE(t.full_name, '')) <> ''
                GROUP BY t.id, t.full_name, t.subject
            ),
            unresolved_grade_teachers AS (
                SELECT
                    NULL AS id,
                    TRIM(g.teacher_name) AS full_name,
                    GROUP_CONCAT(DISTINCT NULLIF(TRIM(g.subject), '')) AS subject
                FROM grades g
                LEFT JOIN teachers t
                    ON t.school_year = g.school_year
                   AND TRIM(COALESCE(t.full_name, '')) = TRIM(COALESCE(g.teacher_name, ''))
                WHERE g.school_year = ?
                  AND g.cycle_code = ?
                  AND (g.teacher_id IS NULL OR g.teacher_id <= 0)
                  AND TRIM(COALESCE(g.teacher_name, '')) <> ''
                  AND t.id IS NULL
                GROUP BY TRIM(g.teacher_name), COALESCE(NULLIF(TRIM(g.subject), ''), '')
            )
            SELECT id, full_name, subject
            FROM canonical_teachers
            UNION ALL
            SELECT id, full_name, subject
            FROM unresolved_grade_teachers
            ORDER BY full_name, subject
        `
        )
        .all(cycle, year, year, cycle);
}

function listByYear(db, year) {
    return db
        .prepare(
            `
            SELECT sa.*,
                   COALESCE(t.full_name, sa.teacher_name) as full_name,
                   COALESCE(sa.subject, t.subject, '') as subject
            FROM staff_attendance sa
            LEFT JOIN teachers t ON t.id = sa.teacher_id
            WHERE sa.school_year = ?
            ORDER BY sa.attendance_date DESC, sa.created_at DESC
        `
        )
        .all(year);
}

/**
 * Find an existing attendance row that would duplicate the given record
 * (same teacher identity, date, type — and absence period for absences).
 * `recordId` excludes the row itself when updating.
 */
function findConflict(db, { recordId = null, teacherId, teacherName, attendanceDate, type, absencePeriod, schoolYear }) {
    const teacherIdValue = Number(teacherId) > 0 ? Number(teacherId) : null;
    const teacherNameValue = String(teacherName || '').trim();

    if (type === 'late') {
        return db.prepare(`
            SELECT id
            FROM staff_attendance
            WHERE school_year = ?
              AND attendance_date = ?
              AND type = 'late'
              AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
              AND COALESCE(teacher_name, '') = ?
              AND (? IS NULL OR id != ?)
            LIMIT 1
        `).get(
            schoolYear,
            attendanceDate,
            teacherIdValue,
            teacherNameValue,
            recordId,
            recordId
        );
    }

    return db.prepare(`
        SELECT id
        FROM staff_attendance
        WHERE school_year = ?
          AND attendance_date = ?
          AND type = 'absence'
          AND COALESCE(teacher_id, -1) = COALESCE(?, -1)
          AND COALESCE(teacher_name, '') = ?
          AND COALESCE(absence_period, 'full_day') = ?
          AND (? IS NULL OR id != ?)
        LIMIT 1
    `).get(
        schoolYear,
        attendanceDate,
        teacherIdValue,
        teacherNameValue,
        String(absencePeriod || 'full_day'),
        recordId,
        recordId
    );
}

function insert(db, record) {
    return db.prepare(
        `
            INSERT OR IGNORE INTO staff_attendance(teacher_id, teacher_name, subject, attendance_date, type, late_duration, arrival_time, reason, notes, absence_period, school_year)
            VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `
    ).run(
        record.teacher_id,
        record.teacher_name,
        record.subject,
        record.attendance_date,
        record.type,
        record.late_duration,
        record.arrival_time,
        record.reason,
        record.notes,
        record.absence_period,
        record.school_year
    );
}

function updateById(db, recordId, record) {
    db.prepare(`
        UPDATE staff_attendance
        SET teacher_id = ?, teacher_name = ?, subject = ?, attendance_date = ?,
            type = ?, late_duration = ?, arrival_time = ?, reason = ?, notes = ?,
            absence_period = ?, school_year = ?
        WHERE id = ?
    `).run(
        record.teacher_id,
        record.teacher_name,
        record.subject,
        record.attendance_date,
        record.type,
        record.late_duration,
        record.arrival_time,
        record.reason,
        record.notes,
        record.absence_period,
        record.school_year,
        recordId
    );
}

function deleteById(db, recordId) {
    return db.prepare('DELETE FROM staff_attendance WHERE id = ?').run(recordId);
}

module.exports = { listTeachersFromGrades, listByYear, findConflict, insert, updateById, deleteById };

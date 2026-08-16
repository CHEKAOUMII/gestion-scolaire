'use strict';

/**
 * Daily report repository.
 * Owns the SQL behind the staff daily report aggregation: legacy teacher
 * absences, staff attendance, grades-derived teacher maps, student section
 * counts, school events, system tags, and the timetable rows used for
 * linked-session annotation. Response assembly stays in the IPC layer.
 */

function listKnownCycleCodes(db) {
    return db.prepare(
        `SELECT cycle_code FROM institution_cycles WHERE cycle_code IS NOT NULL AND TRIM(cycle_code) <> '' ORDER BY sort_order, cycle_code`
    ).all();
}

function timetableTableExists(db) {
    return !!db
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'timetable_data'")
        .get();
}

function listTimetableRows(db, year) {
    return db.prepare('SELECT cycle_code, data_json FROM timetable_data WHERE school_year = ?').all(year);
}

function listLegacyAbsencesByDate(db, date, year) {
    return db
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
}

function listStaffAttendanceByDate(db, date, year) {
    return db
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
}

function listGradeTeacherSubjects(db, year, cycleCodes) {
    const cyclePlaceholders = cycleCodes.map(() => '?').join(', ');
    return db
        .prepare(
            `
                    SELECT teacher_id, teacher_name, subject
                    FROM grades
                    WHERE school_year = ? AND cycle_code IN (${cyclePlaceholders})
                      AND subject IS NOT NULL AND TRIM(subject) <> ''
                      AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
                `
        )
        .all(year, ...cycleCodes);
}

function listTeacherSections(db, year, cycleCodes) {
    const cyclePlaceholders = cycleCodes.map(() => '?').join(', ');
    return db
        .prepare(
            `
            SELECT teacher_id, teacher_name, section, cycle_code
            FROM grades
            WHERE school_year = ? AND cycle_code IN (${cyclePlaceholders})
              AND section IS NOT NULL AND TRIM(section) <> ''
              AND ((teacher_id IS NOT NULL AND teacher_id > 0) OR (teacher_name IS NOT NULL AND TRIM(teacher_name) <> ''))
        `
        )
        .all(year, ...cycleCodes);
}

function countActiveStudentsBySection(db, year, cycleCodes) {
    const cyclePlaceholders = cycleCodes.map(() => '?').join(', ');
    return db
        .prepare(
            `
            SELECT section, COUNT(*) as count
            FROM students
            WHERE school_year = ? AND cycle_code IN (${cyclePlaceholders}) AND status = 'active'
              AND section IS NOT NULL AND TRIM(section) <> ''
            GROUP BY cycle_code, section
            ORDER BY cycle_code, section
        `
        )
        .all(year, ...cycleCodes);
}

module.exports = {
    listKnownCycleCodes,
    timetableTableExists,
    listTimetableRows,
    listLegacyAbsencesByDate,
    listStaffAttendanceByDate,
    listGradeTeacherSubjects,
    listTeacherSections,
    countActiveStudentsBySection
};

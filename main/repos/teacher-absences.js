'use strict';

/**
 * Teacher absences repository.
 * Owns SQL for `teacher_absences`; IPC stays auth, date/school-year
 * validation, and response mapping.
 */

function listByYear(db, year) {
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
        .all(year);
}

function insert(db, teacherId, absenceDate, reason, replacementTeacher, schoolYear) {
    db.prepare(
        `
            INSERT INTO teacher_absences(teacher_id, absence_date, reason, replacement_teacher, school_year)
            VALUES(?, ?, ?, ?, ?)
        `
    ).run(teacherId, absenceDate, reason, replacementTeacher, schoolYear);
}

function deleteById(db, id) {
    db.prepare('DELETE FROM teacher_absences WHERE id = ?').run(id);
}

module.exports = { listByYear, insert, deleteById };

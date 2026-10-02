'use strict';

/**
 * Inspectors repository.
 * Owns SQL for the `inspectors` table (pedagogical inspector visits);
 * IPC stays auth, field validation, and response mapping.
 */

function listByYear(db, year) {
    return db
        .prepare('SELECT * FROM inspectors WHERE school_year = ? ORDER BY last_name, first_name')
        .all(year);
}

function getStatsCounts(db, year, monthStart, nextMonth) {
    const total = db
        .prepare('SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ?')
        .get(year).cnt;
    const active = db
        .prepare("SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ? AND status = 'نشط'")
        .get(year).cnt;
    const specialties = db
        .prepare('SELECT COUNT(DISTINCT specialty) AS cnt FROM inspectors WHERE school_year = ?')
        .get(year).cnt;
    const visitsThisMonth = db
        .prepare(
            'SELECT COUNT(*) AS cnt FROM inspectors WHERE school_year = ? AND last_visit_date >= ? AND last_visit_date < ?'
        )
        .get(year, monthStart, nextMonth).cnt;
    return { total, active, specialties, visitsThisMonth };
}

function insert(db, entry) {
    return db
        .prepare(
            `INSERT INTO inspectors(first_name, last_name, specialty, phone, email, status, last_visit_date, notes, school_year)
             VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
            entry.first_name,
            entry.last_name,
            entry.specialty,
            entry.phone,
            entry.email,
            entry.status,
            entry.last_visit_date,
            entry.notes,
            entry.school_year
        );
}

function updateById(db, id, fields) {
    const sets = [];
    const values = [];
    for (const [key, val] of Object.entries(fields)) {
        sets.push(`${key} = ?`);
        values.push(val ?? '');
    }
    values.push(id);
    return db.prepare(`UPDATE inspectors SET ${sets.join(', ')} WHERE id = ?`).run(...values);
}

function deleteById(db, id) {
    return db.prepare('DELETE FROM inspectors WHERE id = ?').run(id);
}

module.exports = { listByYear, getStatsCounts, insert, updateById, deleteById };
